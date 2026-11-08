'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import ConnectGoogle from '@/components/ConnectGoogle';
import { api, useApi, clockTime } from '@/lib/client';
import { fmt, addDays, addMonths, parse, todayStr, humanTime } from '@/lib/dates';
import { IconChevL, IconChevR, IconExt, IconTrash, IconX } from '@/components/Icons';

const HOUR = 52;
const startOfWeek = (d) => { const x = parse(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return fmt(x); };
const readPref = (k, dflt) => { try { const v = localStorage.getItem(k); return v === null ? dflt : v; } catch { return dflt; } };
const writePref = (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} };
const VIEWS = [['day', 'Day', 'T'], ['week', 'Week', 'W'], ['month', 'Month', 'M']];
const isMobile = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;

// The dates a view shows, starting from the cursor date.
function rangeFor(view, cursor) {
  if (view === 'day') return [cursor];
  if (view === 'week') { const s = startOfWeek(cursor); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }
  const first = cursor.slice(0, 8) + '01';
  const s = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(s, i));
}

export default function CalendarPage() {
  const { status, tasks, openTask } = useApp();
  const connected = status?.google?.connected;
  const today = todayStr();
  const [view, setView] = useState('week');
  const [cursor, setCursor] = useState(today);
  const [showTasks, setShowTasks] = useState(false);
  const [calMenu, setCalMenu] = useState(false);
  const [sel, setSel] = useState(null);
  const [creating, setCreating] = useState(null);
  useEffect(() => {
    setShowTasks(readPref('me.cal.tasks', '0') === '1');
    setView(isMobile() ? 'day' : readPref('me.cal.view', 'week'));
  }, []);
  const changeView = (v) => { setView(v); if (!isMobile()) writePref('me.cal.view', v); };

  const days = rangeFor(view, cursor);
  const start = parse(days[0]); const end = parse(addDays(days[days.length - 1], 1));
  const ev = useApi(connected ? `/api/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}` : null, { refreshMs: 5 * 60_000 });
  const cals = useApi(connected ? '/api/calendar/calendars' : null);
  const bodyRef = useRef();
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  // Start at 7:30am, or an hour before now when today is on screen later on.
  useEffect(() => {
    if (!bodyRef.current) return;
    const h = days.includes(todayStr()) ? Math.max(7.5, new Date().getHours() - 1) : 7.5;
    bodyRef.current.scrollTop = HOUR * h;
  }, [connected, view, cursor]); // eslint-disable-line

  const step = (dir) => setCursor((c) => (view === 'day' ? addDays(c, dir) : view === 'week' ? addDays(c, 7 * dir) : addMonths(c, dir)));

  // T = today (day view), W = week, M = month, ←/→ = previous/next.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || sel || creating) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === 't') { changeView('day'); setCursor(todayStr()); }
      else if (k === 'w') changeView('week');
      else if (k === 'm') changeView('month');
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line

  const layout = useMemo(() => {
    const out = Object.fromEntries(days.map((d) => [d, { allDay: [], timed: [] }]));
    for (const e of ev.data || []) {
      if (e.allDay) {
        for (let d = e.start; d < e.end; d = addDays(d, 1)) out[d]?.allDay.push(e);
      } else {
        const s = new Date(e.start), en = new Date(e.end);
        for (const d of days) {
          const ds = parse(d), de = parse(addDays(d, 1));
          if (en <= ds || s >= de) continue;
          const a = Math.max(s, ds), b = Math.min(en, de);
          out[d].timed.push({ ...e, top: ((a - ds) / 3600000) * HOUR, height: Math.max(20, ((b - a) / 3600000) * HOUR - 2), a, b });
        }
      }
    }
    for (const d of days) lanes(out[d].timed);
    return out;
  }, [ev.data, view, cursor]); // eslint-disable-line

  if (status && !connected) return (<><div className="page-head"><h1>Calendar</h1></div><div className="card"><ConnectGoogle what="your calendar" /></div></>);

  const toggleCal = async (c) => {
    await api('/api/calendar/calendars', { method: 'PATCH', body: { id: c.id, visible: !c.visible } });
    cals.reload(); ev.reload();
  };
  const toggleTasks = () => { setShowTasks((v) => { writePref('me.cal.tasks', v ? '0' : '1'); return !v; }); };
  const tasksOn = (d) => (showTasks ? tasks.filter((t) => t.due_date === d && !t.parent_id).sort((a, b) => (a.due_time || '99').localeCompare(b.due_time || '99') || (a.day_order || 0) - (b.day_order || 0)) : []);

  const c = parse(cursor);
  const title = view === 'day'
    ? c.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    : view === 'month' ? c.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : (() => { const f = parse(days[0]), l = parse(days[6]); return f.getMonth() === l.getMonth() ? f.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : `${f.toLocaleDateString(undefined, { month: 'short' })} – ${l.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`; })();

  return (
    <>
      <div className="page-head cal-head">
        <h1>{title}</h1>
        <div className="cal-toolbar">
          {ev.loading && <span className="spin" />}
          <div className="tabs views-switch">
            {VIEWS.map(([k, label, key]) => <button key={k} className={view === k ? 'on' : ''} title={`${label} (${key})`} onClick={() => changeView(k)}>{label}</button>)}
          </div>
          <button className="btn ghost" title="Today (T)" onClick={() => setCursor(todayStr())}>Today</button>
          <button className="icon-btn" title="Previous (←)" onClick={() => step(-1)}><IconChevL /></button>
          <button className="icon-btn" title="Next (→)" onClick={() => step(1)}><IconChevR /></button>
          <span className="tb-sep" />
          <button className={`btn ghost ${showTasks ? 'on' : ''}`} onClick={toggleTasks}>Tasks</button>
          <div className="pop-wrap">
            <button className={`btn ghost ${calMenu ? 'on' : ''}`} onClick={() => setCalMenu((v) => !v)}>Calendars</button>
            {calMenu && (
              <>
                <div className="pop-scrim" onClick={() => setCalMenu(false)} />
                <div className="pop cal-list">
                  {(cals.data || []).map((cal) => (
                    <label key={cal.id} style={{ '--c': cal.color }}>
                      <input type="checkbox" checked={cal.visible} onChange={() => toggleCal(cal)} /><span>{cal.name}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
          <button className="btn primary" onClick={() => setCreating({ date: view === 'day' ? cursor : today, hour: Math.min(22, now.getHours() + 1) })}>New event</button>
        </div>
      </div>
      {ev.error && <div className="error-box" style={{ marginBottom: 12 }}>{ev.error.message}</div>}

      {view === 'month' ? (
        <div className="card month">
          <div className="month-head">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d}>{d}</div>)}</div>
          <div className="month-grid">
            {days.map((d) => {
              const items = [...layout[d].allDay.map((e) => ({ e, all: true })), ...layout[d].timed.filter((e) => !e.declined).map((e) => ({ e, all: false }))];
              const dayTasks = tasksOn(d);
              const max = 3;
              const out = d.slice(0, 7) !== cursor.slice(0, 7);
              return (
                <div key={d} className={`mcell ${out ? 'out' : ''} ${d === today ? 'today' : ''}`} onDoubleClick={() => setCreating({ date: d, hour: 9 })}>
                  <button className="mnum" onClick={() => { setCursor(d); changeView('day'); }}>{parse(d).getDate()}</button>
                  {items.slice(0, max).map(({ e, all }) => (
                    <div key={e.id + d} className={`mev ${all ? 'all' : ''}`} style={{ '--c': e.color }} onClick={() => setSel(e)} title={e.title}>
                      {!all && <i />}{!all && <span className="t">{clockTime(e.start)}</span>}{e.title}
                    </div>
                  ))}
                  {dayTasks.slice(0, Math.max(0, max - items.length)).map((t) => <div key={t.id} className="mev task" onClick={() => openTask(t)}>○ {t.content}</div>)}
                  {items.length + dayTasks.length > max && <button className="mmore" onClick={() => { setCursor(d); changeView('day'); }}>+{items.length + dayTasks.length - max} more</button>}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className={`card week ${view === 'day' ? 'is-day' : ''}`} style={{ '--cols': days.length }}>
          <div className="week-head">
            <div />
            {days.map((d) => (
              <div key={d} className={d === today ? 'today' : ''}><span>{parse(d).toLocaleDateString(undefined, { weekday: 'short' })}</span><b>{parse(d).getDate()}</b></div>
            ))}
          </div>
          {(showTasks || days.some((d) => layout[d].allDay.length)) && (
            <div className="allday">
              <div />
              {days.map((d) => {
                const dayTasks = tasksOn(d);
                const cap = view === 'day' ? 8 : 2;
                return (
                  <div key={d}>
                    {layout[d].allDay.map((e) => <div key={e.id} className="ev" style={{ '--c': e.color }} onClick={() => setSel(e)}>{e.title}</div>)}
                    {dayTasks.slice(0, cap).map((t) => <div key={t.id} className="tk" onClick={() => openTask(t)} title={t.content}>{t.content}</div>)}
                    {dayTasks.length > cap && <Link className="tk more" href={d === today ? '/tasks?view=today' : '/tasks?view=upcoming'}>+{dayTasks.length - cap} more</Link>}
                  </div>
                );
              })}
            </div>
          )}
          <div className="week-body" ref={bodyRef}>
            <div className="hours">{Array.from({ length: 24 }, (_, h) => <div key={h}>{h === 0 ? '' : humanTime(`${h}:00`)}</div>)}</div>
            {days.map((d) => (
              <div key={d} className={`day-col ${d === today ? 'today' : ''}`} style={{ height: HOUR * 24, '--hour': `${HOUR}px` }}
                onDoubleClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setCreating({ date: d, hour: Math.floor((e.clientY - r.top) / HOUR) }); }}>
                {d === today && <div className="now-line" style={{ top: ((now - parse(d)) / 3600000) * HOUR }} />}
                {layout[d].timed.map((e) => (
                  <div key={e.id + d} className={`ev-block ${e.declined ? 'declined' : ''} ${e.b < now ? 'past' : ''}`} onClick={() => setSel(e)}
                    style={{ '--c': e.color, top: e.top, height: e.height, left: `calc(${(e.lane / e.lanes) * 100}% + 2px)`, width: `calc(${(100 * e.span) / e.lanes}% - 4px)` }}>
                    <b>{e.title}</b>{e.height > 34 && <span>{clockTime(e.start)} – {clockTime(e.end)}{view === 'day' && e.location ? ` · ${e.location}` : ''}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="muted kbd-hint">Keys: <span className="kbd">T</span> today · <span className="kbd">W</span> week · <span className="kbd">M</span> month · <span className="kbd">←</span> <span className="kbd">→</span> move · double-click to add</p>
      {sel && <EventModal e={sel} onClose={() => setSel(null)} onDeleted={() => { setSel(null); ev.reload(); }} />}
      {creating && <NewEvent init={creating} calendars={(cals.data || []).filter((cal) => cal.writable)} onClose={() => setCreating(null)} onCreated={() => { setCreating(null); ev.reload(); }} />}
    </>
  );
}

function lanes(list) {
  list.sort((a, b) => a.a - b.a || b.b - a.b);
  let cluster = [], clusterEnd = 0;
  // Each event also stretches right across lanes that are free while it runs.
  const flush = () => {
    const n = Math.max(...cluster.map((e) => e.lane)) + 1;
    for (const e of cluster) {
      e.lanes = n; e.span = 1;
      for (let l = e.lane + 1; l < n; l++) {
        if (cluster.some((o) => o.lane === l && o.a < e.b && o.b > e.a)) break;
        e.span++;
      }
    }
    cluster = [];
  };
  for (const e of list) {
    if (cluster.length && e.a >= clusterEnd) flush();
    const used = new Set(cluster.filter((c) => c.b > e.a).map((c) => c.lane));
    let l = 0; while (used.has(l)) l++;
    e.lane = l; cluster.push(e); clusterEnd = Math.max(clusterEnd, +e.b);
  }
  if (cluster.length) flush();
}

function EventModal({ e, onClose, onDeleted }) {
  const del = async () => {
    if (!confirm(`Delete “${e.title}” from Google Calendar?`)) return;
    await api(`/api/calendar/events?calendarId=${encodeURIComponent(e.calendarId)}&id=${encodeURIComponent(e.id)}`, { method: 'DELETE' });
    onDeleted();
  };
  return (
    <div className="modal-wrap" onMouseDown={(x) => x.target === x.currentTarget && onClose()}>
      <div className="modal">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
          <h2 style={{ fontSize: 18 }}>{e.title}</h2>
          <button className="icon-btn" onClick={onClose}><IconX /></button>
        </div>
        <div className="muted">
          {e.allDay ? parse(e.start).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
            : `${new Date(e.start).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} · ${clockTime(e.start)} – ${clockTime(e.end)}`}
        </div>
        {e.location && <div>📍 {e.location}</div>}
        <div className="row">{(e.calendars || [e.calendar]).map((c) => <span key={c} className="chip dot" style={{ color: e.color }}>{c}</span>)}</div>
        {e.description && <div className="muted" style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', fontSize: 13 }}>{e.description.replace(/<[^>]+>/g, ' ')}</div>}
        <div className="row">
          {e.meet && <a className="btn primary" href={e.meet} target="_blank" rel="noreferrer">Join call</a>}
          <a className="btn" href={e.link} target="_blank" rel="noreferrer"><IconExt style={{ width: 14 }} /> Open in Google</a>
          <button className="btn ghost danger" onClick={del}><IconTrash style={{ width: 14 }} /> Delete</button>
        </div>
      </div>
    </div>
  );
}

function NewEvent({ init, calendars, onClose, onCreated }) {
  const pad = (n) => String(n).padStart(2, '0');
  const [f, setF] = useState({ title: '', date: init.date, start: `${pad(init.hour)}:00`, mins: 60, allDay: false, location: '', calendarId: calendars.find((c) => c.primary)?.id || 'primary' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const s = new Date(`${f.date}T${f.start}`);
      const en = new Date(s.getTime() + f.mins * 60000);
      const iso = (d) => `${fmt(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
      await api('/api/calendar/events', { method: 'POST', body: f.allDay
        ? { title: f.title, allDay: true, start: f.date, end: addDays(f.date, 1), location: f.location, calendarId: f.calendarId }
        : { title: f.title, start: iso(s), end: iso(en), location: f.location, calendarId: f.calendarId } });
      onCreated();
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <div className="modal-wrap" onMouseDown={(x) => x.target === x.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <h2 style={{ fontSize: 17 }}>New event</h2>
        <input className="input" autoFocus required placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          {!f.allDay && <input className="input" type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />}
          {!f.allDay && (
            <select className="input" value={f.mins} onChange={(e) => setF({ ...f, mins: Number(e.target.value) })}>
              {[15, 30, 45, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m < 60 ? `${m}m` : `${m / 60}h`}</option>)}
            </select>
          )}
        </div>
        <label className="row" style={{ fontSize: 13 }}><input type="checkbox" checked={f.allDay} onChange={(e) => setF({ ...f, allDay: e.target.checked })} /> All day</label>
        <input className="input" placeholder="Location (optional)" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
        {calendars.length > 1 && (
          <select className="input" value={f.calendarId} onChange={(e) => setF({ ...f, calendarId: e.target.value })}>
            {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {err && <div className="error-box">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Create'}</button>
        </div>
      </form>
    </div>
  );
}
