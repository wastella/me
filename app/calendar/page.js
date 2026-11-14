'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import ConnectGoogle from '@/components/ConnectGoogle';
import { Sheet, Segmented, Popover, LoadError, useDialog, useMounted } from '@/components/ui';
import { api, useApi, clockTime } from '@/lib/client';
import { fmt, addDays, addMonths, parse, todayStr, humanTime } from '@/lib/dates';
import { IconChevL, IconChevR, IconExt, IconTrash, IconPlus, IconSliders, IconMap, IconClock } from '@/components/Icons';

const HOUR = 52;
const startOfWeek = (d) => { const x = parse(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return fmt(x); };
const readPref = (k, dflt) => { try { const v = localStorage.getItem(k); return v === null ? dflt : v; } catch { return dflt; } };
const writePref = (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} };
const VIEWS = [['day', 'Day', 'Day (D)'], ['week', 'Week', 'Week (W)'], ['month', 'Month', 'Month (M)']];
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
  const { status, tasks, openTask, attempt } = useApp();
  const mounted = useMounted();
  const connected = status?.google?.connected;
  const today = todayStr();
  const [view, setView] = useState('week');
  const [cursor, setCursor] = useState(today);
  const [showTasks, setShowTasks] = useState(false);
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

  // D = day, W = week, M = month, T = jump to today, ←/→ = previous/next.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || sel || creating || document.body.classList.contains('sheet-open')) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === 'd') changeView('day');
      else if (k === 't') setCursor(todayStr());
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
    cals.setData((list) => list && list.map((x) => (x.id === c.id ? { ...x, visible: !x.visible } : x)));
    await attempt(() => api('/api/calendar/calendars', { method: 'PATCH', body: { id: c.id, visible: !c.visible } }));
    cals.reload(); ev.reload();
  };
  const toggleTasks = () => { setShowTasks((v) => { writePref('me.cal.tasks', v ? '0' : '1'); return !v; }); };
  const tasksOn = (d) => (showTasks ? tasks.filter((t) => t.due_date === d && !t.parent_id).sort((a, b) => (a.due_time || '99').localeCompare(b.due_time || '99') || (a.day_order || 0) - (b.day_order || 0)) : []);
  const openDay = (d) => { setCursor(d); changeView('day'); };

  const c = parse(cursor);
  const phone = mounted && isMobile();
  const title = !mounted ? '\u00a0' : view === 'day'
    ? c.toLocaleDateString(undefined, { weekday: phone ? 'short' : 'long', month: phone ? 'short' : 'long', day: 'numeric' })
    : view === 'month' ? c.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : (() => { const f = parse(days[0]), l = parse(days[6]); return f.getMonth() === l.getMonth() ? f.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : `${f.toLocaleDateString(undefined, { month: 'short' })} – ${l.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`; })();

  return (
    <>
      <div className="page-head cal-head">
        <div className="cal-title">
          <h1>{title}</h1>
          <div className="cal-step">
            <button className="icon-btn" title="Previous (←)" aria-label="Previous" onClick={() => step(-1)}><IconChevL /></button>
            <button className="btn ghost sm" title="Today (T)" onClick={() => setCursor(todayStr())}>Today</button>
            <button className="icon-btn" title="Next (→)" aria-label="Next" onClick={() => step(1)}><IconChevR /></button>
          </div>
        </div>
        <div className="cal-tools">
          {ev.loading && <span className="spin" aria-label="Loading" />}
          <Segmented label="Calendar view" value={view} onChange={changeView} options={VIEWS} />
          <Popover label="Show and hide" className="cal-list" button={({ toggle, open, props }) => <button className={`icon-btn ${open ? 'on' : ''}`} onClick={toggle} {...props}><IconSliders /></button>}>
            <label className="pop-item"><input type="checkbox" checked={showTasks} onChange={toggleTasks} /><span>Tasks</span></label>
            <div className="pop-sep" />
            <div className="pop-label">Calendars</div>
            {(cals.data || []).map((cal) => (
              <label key={cal.id} className="pop-item" style={{ '--c': cal.color }}>
                <input type="checkbox" checked={!!cal.visible} onChange={() => toggleCal(cal)} /><span>{cal.name}</span>
              </label>
            ))}
            {!cals.data && <div className="pop-item muted">Loading…</div>}
          </Popover>
          <button className="btn primary" aria-label="New event" onClick={() => setCreating({ date: view === 'day' ? cursor : today, hour: Math.min(22, now.getHours() + 1) })}><IconPlus /><span className="hide-phone">New event</span></button>
        </div>
      </div>
      {ev.error && <div style={{ marginBottom: 12 }}><LoadError error={ev.error} onRetry={ev.reload} /></div>}

      {view === 'month' ? (
        <div className="card month">
          <div className="month-head">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d}>{phone ? d[0] : d}</div>)}</div>
          <div className="month-grid">
            {days.map((d) => {
              const items = [...layout[d].allDay.map((e) => ({ e, all: true })), ...layout[d].timed.filter((e) => !e.declined).map((e) => ({ e, all: false }))];
              const dayTasks = tasksOn(d);
              const max = phone ? 4 : 3;
              const out = d.slice(0, 7) !== cursor.slice(0, 7);
              return (
                <div key={d} className={`mcell ${out ? 'out' : ''} ${d === today ? 'today' : ''}`} onClick={() => { if (isMobile()) openDay(d); }} onDoubleClick={() => { if (!isMobile()) setCreating({ date: d, hour: 9 }); }}>
                  <button className="mnum" aria-label={parse(d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} onClick={(e) => { e.stopPropagation(); openDay(d); }}>{parse(d).getDate()}</button>
                  {items.slice(0, max).map(({ e, all }) => (
                    <button key={e.id + d} className={`mev ${all ? 'all' : ''}`} style={{ '--c': e.color }} onClick={() => setSel(e)} title={e.title}>
                      {!all && <i />}{!all && <span className="t">{clockTime(e.start)}</span>}<span className="lbl">{e.title}</span>
                    </button>
                  ))}
                  {dayTasks.slice(0, Math.max(0, max - items.length)).map((t) => <button key={t.id} className="mev task" onClick={() => openTask(t)}><i /><span className="lbl">{t.content}</span></button>)}
                  {items.length + dayTasks.length > max && <button className="mmore" onClick={() => openDay(d)}>+{items.length + dayTasks.length - max} more</button>}
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
                    {layout[d].allDay.map((e) => <button key={e.id} className="ev" style={{ '--c': e.color }} onClick={() => setSel(e)} title={e.title}>{e.title}</button>)}
                    {dayTasks.slice(0, cap).map((t) => <button key={t.id} className="tk" onClick={() => openTask(t)} title={t.content}>{t.content}</button>)}
                    {dayTasks.length > cap && <Link className="tk more" href={d === today ? '/tasks?view=today' : '/tasks?view=upcoming'}>+{dayTasks.length - cap} more</Link>}
                  </div>
                );
              })}
            </div>
          )}
          <div className="week-body" ref={bodyRef} style={{ '--hour': `${HOUR}px` }}>
            <div className="hours" aria-hidden="true">{Array.from({ length: 24 }, (_, h) => <div key={h}>{h === 0 ? '' : humanTime(`${h}:00`)}</div>)}</div>
            {days.map((d) => (
              <div key={d} className={`day-col ${d === today ? 'today' : ''}`} style={{ height: HOUR * 24 }}
                onDoubleClick={(e) => { if (e.target !== e.currentTarget) return; const r = e.currentTarget.getBoundingClientRect(); setCreating({ date: d, hour: Math.max(0, Math.min(23, Math.floor((e.clientY - r.top) / HOUR))) }); }}>
                {mounted && d === today && <div className="now-line" style={{ top: ((now - parse(d)) / 3600000) * HOUR }} />}
                {layout[d].timed.map((e) => (
                  <button key={e.id + d} className={`ev-block ${e.declined ? 'declined' : ''} ${e.b < now ? 'past' : ''}`} onClick={() => setSel(e)}
                    style={{ '--c': e.color, top: e.top, height: e.height, left: `calc(${(e.lane / e.lanes) * 100}% + 2px)`, width: `calc(${(100 * e.span) / e.lanes}% - 4px)` }}>
                    <b>{e.title}</b>{e.height > 34 && <span>{clockTime(e.start)} – {clockTime(e.end)}{view === 'day' && e.location ? ` · ${e.location}` : ''}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="kbd-hint"><span className="kbd">D</span> day · <span className="kbd">W</span> week · <span className="kbd">M</span> month · <span className="kbd">T</span> today · <span className="kbd">←</span> <span className="kbd">→</span> move · double-click an empty slot to add an event</p>
      {sel && <EventSheet e={sel} onClose={() => setSel(null)} onDeleted={() => { setSel(null); ev.reload(); }} />}
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

function EventSheet({ e, onClose, onDeleted }) {
  const { attempt, showToast } = useApp();
  const { confirm } = useDialog();
  const del = async () => {
    if (!(await confirm({ title: 'Delete this event?', body: `“${e.title}” will be removed from Google Calendar.`, confirmLabel: 'Delete', danger: true }))) return;
    const ok = await attempt(() => api(`/api/calendar/events?calendarId=${encodeURIComponent(e.calendarId)}&id=${encodeURIComponent(e.id)}`, { method: 'DELETE' }));
    if (ok) { showToast('Event deleted'); onDeleted(); }
  };
  const when = e.allDay
    ? parse(e.start).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    : `${new Date(e.start).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} · ${clockTime(e.start)} – ${clockTime(e.end)}`;
  return (
    <Sheet title={e.title} onClose={onClose}>
      <div className="row nowrap ev-when"><IconClock style={{ width: 15, height: 15, flex: 'none' }} /><span>{when}</span></div>
      {e.location && <div className="row nowrap ev-when"><IconMap style={{ width: 15, height: 15, flex: 'none' }} /><span>{e.location}</span></div>}
      <div className="row">{(e.calendars || [e.calendar]).filter(Boolean).map((c) => <span key={c} className="chip"><i style={{ background: e.color, borderRadius: '50%' }} />{c}</span>)}</div>
      {e.description && <div className="ev-desc">{e.description.replace(/<[^>]+>/g, ' ').trim()}</div>}
      <div className="row" style={{ marginTop: 4 }}>
        {e.meet && <a className="btn primary" href={e.meet} target="_blank" rel="noreferrer">Join call</a>}
        {e.link && <a className="btn" href={e.link} target="_blank" rel="noreferrer"><IconExt /> Open in Google</a>}
        <span className="grow" />
        {e.canDelete !== false && <button className="btn ghost danger" onClick={del}><IconTrash /> Delete</button>}
      </div>
    </Sheet>
  );
}

function NewEvent({ init, calendars, onClose, onCreated }) {
  const { showToast } = useApp();
  const pad = (n) => String(n).padStart(2, '0');
  const [f, setF] = useState({ title: '', date: init.date, start: `${pad(init.hour)}:00`, mins: 60, allDay: false, location: '', calendarId: calendars.find((c) => c.primary)?.id || 'primary' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!f.title.trim() || !f.date || busy) return;
    setBusy(true); setErr(null);
    try {
      const s = new Date(`${f.date}T${f.start || '09:00'}`);
      const en = new Date(s.getTime() + f.mins * 60000);
      const iso = (d) => `${fmt(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
      await api('/api/calendar/events', { method: 'POST', body: f.allDay
        ? { title: f.title.trim(), allDay: true, start: f.date, end: addDays(f.date, 1), location: f.location, calendarId: f.calendarId }
        : { title: f.title.trim(), start: iso(s), end: iso(en), location: f.location, calendarId: f.calendarId } });
      showToast(`Added “${f.title.trim()}”`);
      onCreated();
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Sheet title="New event" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'contents' }}>
        <input className="input" data-autofocus required placeholder="Title" aria-label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoComplete="off" />
        <div className="when-row">
          <input className="input" type="date" aria-label="Date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          {!f.allDay && <input className="input" type="time" aria-label="Start time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />}
          {!f.allDay && (
            <select className="input auto" aria-label="Length" value={f.mins} onChange={(e) => setF({ ...f, mins: Number(e.target.value) })}>
              {[15, 30, 45, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} hr`}</option>)}
            </select>
          )}
        </div>
        <label className="check-row" style={{ padding: 0 }}><input type="checkbox" checked={f.allDay} onChange={(e) => setF({ ...f, allDay: e.target.checked })} /> All day</label>
        <input className="input" placeholder="Location (optional)" aria-label="Location" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
        {calendars.length > 1 && (
          <select className="input" aria-label="Calendar" value={f.calendarId} onChange={(e) => setF({ ...f, calendarId: e.target.value })}>
            {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {err && <div className="error-box" role="alert">{err}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !f.title.trim()}>{busy ? 'Adding…' : 'Add event'}</button>
        </div>
      </form>
    </Sheet>
  );
}
