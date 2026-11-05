'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import ConnectGoogle from '@/components/ConnectGoogle';
import { api, useApi, clockTime } from '@/lib/client';
import { fmt, addDays, parse, todayStr, humanTime } from '@/lib/dates';
import { IconChevL, IconChevR, IconExt, IconTrash, IconX } from '@/components/Icons';

const HOUR = 48;
const startOfWeek = (d) => { const x = parse(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return fmt(x); };

export default function CalendarPage() {
  const { status, tasks, openTask } = useApp();
  const connected = status?.google?.connected;
  const [week, setWeek] = useState(() => startOfWeek(todayStr()));
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const start = parse(days[0]); const end = parse(addDays(days[6], 1));
  const ev = useApi(connected ? `/api/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}` : null, { refreshMs: 5 * 60_000 });
  const cals = useApi(connected ? '/api/calendar/calendars' : null);
  const [sel, setSel] = useState(null);
  const [creating, setCreating] = useState(null);
  const bodyRef = useRef();
  const today = todayStr();
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = HOUR * 7.5; }, [connected]);

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
          out[d].timed.push({ ...e, top: ((a - ds) / 3600000) * HOUR, height: Math.max(18, ((b - a) / 3600000) * HOUR - 2), a, b });
        }
      }
    }
    for (const d of days) lanes(out[d].timed);
    return out;
  }, [ev.data, week]); // eslint-disable-line

  if (status && !connected) return (<><div className="page-head"><h1>Calendar</h1></div><div className="card"><ConnectGoogle what="your calendar" /></div></>);

  const toggleCal = async (c) => {
    await api('/api/calendar/calendars', { method: 'PATCH', body: { id: c.id, visible: !c.visible } });
    cals.reload(); ev.reload();
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{parse(days[0]).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h1>
          <div className="sub">Week of {parse(days[0]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
        </div>
        <div className="cal-toolbar">
          {ev.loading && <span className="spin" />}
          <button className="btn" onClick={() => setWeek(startOfWeek(today))}>Today</button>
          <button className="icon-btn" onClick={() => setWeek(addDays(week, -7))}><IconChevL /></button>
          <button className="icon-btn" onClick={() => setWeek(addDays(week, 7))}><IconChevR /></button>
          <button className="btn primary" onClick={() => setCreating({ date: today, hour: Math.min(22, now.getHours() + 1) })}>+ Event</button>
        </div>
      </div>
      {ev.error && <div className="error-box" style={{ marginBottom: 12 }}>{ev.error.message}</div>}
      <div className="cal-wrap">
        <div className="card week">
          <div className="week-head">
            <div />
            {days.map((d) => (
              <div key={d} className={d === today ? 'today' : ''}>{parse(d).toLocaleDateString(undefined, { weekday: 'short' })}<b>{parse(d).getDate()}</b></div>
            ))}
          </div>
          <div className="allday">
            <div>all-day</div>
            {days.map((d) => (
              <div key={d}>
                {layout[d].allDay.map((e) => <div key={e.id} className="ev" style={{ background: e.color, color: '#fff' }} onClick={() => setSel(e)}>{e.title}</div>)}
                {(() => {
                  const dayTasks = tasks.filter((t) => t.due_date === d && !t.parent_id).sort((a, b) => (a.due_time || '99').localeCompare(b.due_time || '99') || a.priority - b.priority);
                  return (
                    <>
                      {dayTasks.slice(0, 3).map((t) => (
                        <div key={t.id} className="tk" onClick={() => openTask(t)} title={t.content}>○ {t.due_time ? humanTime(t.due_time) + ' ' : ''}{t.content}</div>
                      ))}
                      {dayTasks.length > 3 && <Link className="tk" href={d === today ? '/tasks?view=today' : '/tasks?view=upcoming'}>+{dayTasks.length - 3} more</Link>}
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
          <div className="week-body" ref={bodyRef}>
            <div className="hours">{Array.from({ length: 24 }, (_, h) => <div key={h}>{h === 0 ? '' : humanTime(`${h}:00`)}</div>)}</div>
            {days.map((d) => (
              <div key={d} className={`day-col ${d === today ? 'today' : ''}`} style={{ height: HOUR * 24 }}
                onDoubleClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setCreating({ date: d, hour: Math.floor((e.clientY - r.top) / HOUR) }); }}>
                {d === today && <div className="now-line" style={{ top: ((now - parse(d)) / 3600000) * HOUR }} />}
                {layout[d].timed.map((e) => (
                  <div key={e.id + d} className={`ev-block ${e.declined ? 'declined' : ''}`} onClick={() => setSel(e)}
                    style={{ top: e.top, height: e.height, background: e.color, left: `calc(${(e.lane / e.lanes) * 100}% + 2px)`, width: `calc(${100 / e.lanes}% - 5px)`, right: 'auto' }}>
                    <b>{e.title}</b>{e.height > 30 && <span>{clockTime(e.start)}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <aside className="card">
          <div className="card-head"><h2>Calendars</h2></div>
          <div className="card-body cal-list">
            {(cals.data || []).map((c) => (
              <label key={c.id} style={{ '--c': c.color }}>
                <input type="checkbox" checked={c.visible} onChange={() => toggleCal(c)} />{c.name}
              </label>
            ))}
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>Double-click the grid to add an event.</p>
          </div>
        </aside>
      </div>
      {sel && <EventModal e={sel} onClose={() => setSel(null)} onDeleted={() => { setSel(null); ev.reload(); }} />}
      {creating && <NewEvent init={creating} calendars={(cals.data || []).filter((c) => c.writable)} onClose={() => setCreating(null)} onCreated={() => { setCreating(null); ev.reload(); }} />}
    </>
  );
}

function lanes(list) {
  list.sort((a, b) => a.a - b.a || b.b - a.b);
  let cluster = [], clusterEnd = 0;
  const flush = () => { const n = Math.max(...cluster.map((e) => e.lane)) + 1; cluster.forEach((e) => (e.lanes = n)); cluster = []; };
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
        <div className="row"><span className="chip dot" style={{ color: e.color }}>{e.calendar}</span></div>
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
