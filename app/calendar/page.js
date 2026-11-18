'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import ConnectGoogle from '@/components/ConnectGoogle';
import { Segmented, Popover, LoadError, Empty, useMounted } from '@/components/ui';
import { api, useApi, clockTime } from '@/lib/client';
import { fmt, addDays, addMonths, parse, todayStr, humanTime, diffDays } from '@/lib/dates';
import { IconChevL, IconChevR, IconPlus, IconSliders, IconSearch, IconX, IconRepeat } from '@/components/Icons';
import EventForm from '@/components/calendar/EventForm';
import EventSheet from '@/components/calendar/EventSheet';
import CalendarsSheet from '@/components/calendar/Calendars';
import { useScope } from '@/components/calendar/Scope';
import { hm, localISO } from '@/components/calendar/util';

const HOUR = 52;
const startOfWeek = (d) => { const x = parse(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return fmt(x); };
const readPref = (k, dflt) => { try { const v = localStorage.getItem(k); return v === null ? dflt : v; } catch { return dflt; } };
const writePref = (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} };
const VIEWS = [['day', 'Day', 'Day (D)'], ['week', 'Week', 'Week (W)'], ['month', 'Month', 'Month (M)'], ['schedule', 'Schedule', 'Schedule (A)']];
const SCHEDULE_DAYS = 30;
const isMobile = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;
const keyOf = (e) => `${e.calendarId}|${e.id}`;

// The dates a view shows, starting from the cursor date.
function rangeFor(view, cursor) {
  if (view === 'day') return [cursor];
  if (view === 'week') { const s = startOfWeek(cursor); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }
  if (view === 'schedule') return Array.from({ length: SCHEDULE_DAYS }, (_, i) => addDays(cursor, i));
  const first = cursor.slice(0, 8) + '01';
  const s = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(s, i));
}

export default function CalendarPage() {
  const { status, tasks, openTask, attempt, showToast } = useApp();
  const mounted = useMounted();
  const connected = status?.google?.connected;
  const today = todayStr();
  const [view, setView] = useState('week');
  const [cursor, setCursor] = useState(today);
  const [showTasks, setShowTasks] = useState(false);
  const [sel, setSel] = useState(null);
  const [creating, setCreating] = useState(null);   // { date, startMin, mins, allDay?, copy? }
  const [editing, setEditing] = useState(null);
  const [managing, setManaging] = useState(false);
  const [draft, setDraft] = useState(null);         // the slot being dragged out: { date, a, b } in minutes
  const [moving, setMoving] = useState(null);       // an event being dragged: { key, start, end } (ISO or dates)
  const [dropDay, setDropDay] = useState(null);     // the month cell an event is being dragged over
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [askScope, scopeDialog] = useScope();
  const dragged = useRef(false);
  const searchRef = useRef(null);
  useEffect(() => {
    setShowTasks(readPref('me.cal.tasks', '0') === '1');
    setView(isMobile() ? 'day' : readPref('me.cal.view', 'week'));
  }, []);
  useEffect(() => { const t = setTimeout(() => setQ(query.trim()), 300); return () => clearTimeout(t); }, [query]);
  const changeView = (v) => { setView(v); if (!isMobile()) writePref('me.cal.view', v); };

  const days = rangeFor(view, cursor);
  const start = parse(days[0]); const end = parse(addDays(days[days.length - 1], 1));
  const ev = useApi(connected ? `/api/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}` : null, { refreshMs: 5 * 60_000 });
  const cals = useApi(connected ? '/api/calendar/calendars' : null);
  const searchRange = useMemo(() => { const a = parse(addMonths(today, -12)), b = parse(addMonths(today, 12)); return `start=${a.toISOString()}&end=${b.toISOString()}`; }, [today]);
  const found = useApi(connected && searching && q ? `/api/calendar/events?q=${encodeURIComponent(q)}&${searchRange}` : null);
  const bodyRef = useRef();
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  // Start at 7:30am, or an hour before now when today is on screen later on.
  useEffect(() => {
    if (!bodyRef.current) return;
    const h = days.includes(todayStr()) ? Math.max(7.5, new Date().getHours() - 1) : 7.5;
    bodyRef.current.scrollTop = HOUR * h;
  }, [connected, view, cursor]); // eslint-disable-line

  const step = (dir) => setCursor((c) => (view === 'day' ? addDays(c, dir) : view === 'week' ? addDays(c, 7 * dir) : view === 'schedule' ? addDays(c, 14 * dir) : addMonths(c, dir)));
  const newEvent = () => setCreating({ date: view === 'day' ? cursor : today, startMin: Math.min(22, now.getHours() + 1) * 60, mins: 60 });
  const openSearch = () => { setSearching(true); setTimeout(() => searchRef.current?.focus(), 0); };
  const closeSearch = () => { setSearching(false); setQuery(''); };

  // D/W/M/A = views, T = today, ←/→ = previous/next, C = new event, / = search.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || sel || creating || editing || managing || document.body.classList.contains('sheet-open')) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === 'd') changeView('day');
      else if (k === 't') setCursor(todayStr());
      else if (k === 'w') changeView('week');
      else if (k === 'm') changeView('month');
      else if (k === 'a') changeView('schedule');
      else if (k === 'c') newEvent();
      else if (k === '/') openSearch();
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
    for (const raw of ev.data || []) {
      const e = moving?.key === keyOf(raw) ? { ...raw, start: moving.start, end: moving.end, moving: true } : raw;
      if (e.allDay) {
        for (let d = e.start; d < e.end; d = addDays(d, 1)) out[d]?.allDay.push(e);
      } else {
        const s = new Date(e.start), en = new Date(e.end);
        for (const d of days) {
          const ds = parse(d), de = parse(addDays(d, 1));
          if (en <= ds || s >= de) continue;
          const a = Math.max(s, ds), b = Math.min(en, de);
          out[d].timed.push({ ...e, top: ((a - ds) / 3600000) * HOUR, height: Math.max(20, ((b - a) / 3600000) * HOUR - 2), a, b, lastPart: en <= de });
        }
      }
    }
    for (const d of days) lanes(out[d].timed);
    return out;
  }, [ev.data, view, cursor, moving]); // eslint-disable-line

  if (status && !connected) return (<><div className="page-head"><h1>Calendar</h1></div><div className="card"><ConnectGoogle what="your calendar" /></div></>);

  const calList = cals.data || [];
  const editable = (e) => e.canEdit ?? !!calList.find((cal) => cal.id === e.calendarId)?.writable;
  const toggleCal = async (c) => {
    cals.setData((list) => list && list.map((x) => (x.id === c.id ? { ...x, visible: !x.visible } : x)));
    await attempt(() => api('/api/calendar/calendars', { method: 'PATCH', body: { id: c.id, visible: !c.visible } }));
    cals.reload(); ev.reload();
  };
  const toggleTasks = () => { setShowTasks((v) => { writePref('me.cal.tasks', v ? '0' : '1'); return !v; }); };
  const tasksOn = (d) => (showTasks ? tasks.filter((t) => t.due_date === d && !t.parent_id).sort((a, b) => (a.due_time || '99').localeCompare(b.due_time || '99') || (a.day_order || 0) - (b.day_order || 0)) : []);
  const openDay = (d) => { setCursor(d); changeView('day'); };
  const open = (e) => { if (!dragged.current) setSel(e); };
  const reload = () => { ev.reload(); if (searching) found.reload(); };

  // Click an empty slot for a one-hour event there; drag with the mouse to set its length.
  const minuteAt = (col, y) => Math.max(0, Math.min(1440, ((y - col.getBoundingClientRect().top) / HOUR) * 60));
  const slotClick = (e, d) => {
    if (e.target !== e.currentTarget || dragged.current) return;
    setCreating({ date: d, startMin: Math.min(1380, Math.floor(minuteAt(e.currentTarget, e.clientY) / 30) * 30), mins: 60 });
  };
  const slotDown = (e, d) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target !== e.currentTarget) return;
    const col = e.currentTarget, y0 = e.clientY, snap = (y) => Math.round(minuteAt(col, y) / 15) * 15, from = snap(y0);
    let range = null;
    const move = (m) => {
      if (!range && Math.abs(m.clientY - y0) < 6) return;
      const to = snap(m.clientY);
      range = { date: d, a: Math.min(from, to), b: Math.max(from, to) };
      setDraft(range);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setDraft(null);
      if (!range) return;
      dragged.current = true; setTimeout(() => { dragged.current = false; }, 0);
      setCreating({ date: d, startMin: Math.min(range.a, 1425), mins: Math.max(15, range.b - range.a) });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  // Saves an event's new time after a drag, asking how far the change goes
  // when it repeats. The event shows in its new place straight away.
  const reschedule = async (e, next) => {
    let scope;
    if (e.recurring) {
      scope = await askScope({ title: 'Move repeating event' });
      if (!scope) { setMoving(null); return; }
    }
    ev.setData((list) => list && list.map((x) => (keyOf(x) === keyOf(e) ? { ...x, ...next } : x)));
    setMoving(null);
    const ok = await attempt(() => api('/api/calendar/events', { method: 'PATCH', body: { calendarId: e.calendarId, id: e.id, ...next, allDay: e.allDay, scope } }));
    if (ok) showToast('Event moved');
    ev.reload();
  };

  // Drag an event to another time or day; drag its bottom edge to change its length.
  const blockDown = (p, e, d, mode) => {
    if (p.pointerType !== 'mouse' || p.button !== 0 || !editable(e)) return;
    p.stopPropagation();
    const col = p.currentTarget.closest('.day-col');
    const x0 = p.clientX, y0 = p.clientY, s0 = new Date(e.start), e0 = new Date(e.end);
    let next = null;
    const move = (m) => {
      if (!next && Math.abs(m.clientY - y0) < 5 && Math.abs(m.clientX - x0) < 5) return;
      if (mode === 'resize') {
        const endAt = new Date(parse(d).getTime() + Math.round(minuteAt(col, m.clientY) / 15) * 15 * 60000);
        next = { start: localISO(s0), end: localISO(new Date(Math.max(endAt, s0.getTime() + 15 * 60000))) };
      } else {
        const over = document.elementFromPoint(m.clientX, m.clientY)?.closest('.day-col')?.dataset.date || d;
        const shift = diffDays(over, d) * 1440 + Math.round(((m.clientY - y0) / HOUR) * 60 / 15) * 15;
        const s = new Date(s0); s.setMinutes(s.getMinutes() + shift);
        next = { start: localISO(s), end: localISO(new Date(s.getTime() + (e0 - s0))) };
      }
      setMoving({ key: keyOf(e), ...next });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (!next) return;
      dragged.current = true; setTimeout(() => { dragged.current = false; }, 0);
      if (new Date(next.start).getTime() === s0.getTime() && new Date(next.end).getTime() === e0.getTime()) { setMoving(null); return; }
      reschedule(e, next);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  // In the month, drag an event onto another day (its time of day stays).
  const monthDown = (p, e, d) => {
    if (p.pointerType !== 'mouse' || p.button !== 0 || !editable(e)) return;
    const x0 = p.clientX, y0 = p.clientY;
    let over = null;
    const move = (m) => {
      if (!over && Math.abs(m.clientY - y0) < 5 && Math.abs(m.clientX - x0) < 5) return;
      over = document.elementFromPoint(m.clientX, m.clientY)?.closest('.mcell')?.dataset.date || d;
      setDropDay(over);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setDropDay(null);
      if (!over) return;
      dragged.current = true; setTimeout(() => { dragged.current = false; }, 0);
      const n = diffDays(over, d);
      if (!n) return;
      if (e.allDay) return reschedule(e, { start: addDays(e.start, n), end: addDays(e.end, n) });
      const s = new Date(e.start), en = new Date(e.end); s.setDate(s.getDate() + n); en.setDate(en.getDate() + n);
      reschedule(e, { start: localISO(s), end: localISO(en) });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const duplicate = (e) => {
    const s = new Date(e.start);
    setSel(null);
    setCreating({
      date: e.allDay ? e.start : fmt(s), startMin: e.allDay ? 540 : s.getHours() * 60 + s.getMinutes(), mins: e.allDay ? 60 : Math.max(5, Math.round((new Date(e.end) - s) / 60000)), allDay: e.allDay,
      copy: {
        title: e.title, location: e.location || '', description: (e.description || '').replace(/<[^>]+>/g, ''), days: e.allDay ? Math.max(1, diffDays(e.end, e.start)) : 1,
        guests: (e.guests || []).filter((g) => !g.self).map((g) => g.email), notify: false, colorId: e.colorId || '', visibility: e.visibility || 'default', busy: e.busy !== false,
        ...(calList.find((cal) => cal.id === e.calendarId)?.writable ? { calendarId: e.calendarId } : {}),
      },
    });
  };

  const c = parse(cursor);
  const phone = mounted && isMobile();
  const title = !mounted ? ' ' : view === 'day'
    ? c.toLocaleDateString(undefined, { weekday: phone ? 'short' : 'long', month: phone ? 'short' : 'long', day: 'numeric' })
    : view === 'month' ? c.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : (() => { const f = parse(days[0]), l = parse(days[view === 'schedule' ? days.length - 1 : 6]); return f.getMonth() === l.getMonth() ? f.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : `${f.toLocaleDateString(undefined, { month: 'short' })} – ${l.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`; })();

  const label = (e) => `${e.title}${e.meal ? ` · ${e.meal}` : ''}`;
  return (
    <>
      <div className="page-head cal-head">
        <div className="cal-title">
          <h1 className="cal-jump" title="Go to a date">{title}{mounted && <input type="date" aria-label="Go to date" value={cursor} onChange={(e) => { if (e.target.value) setCursor(e.target.value); }} onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch {} }} />}</h1>
          <div className="cal-step">
            <button className="icon-btn" title="Previous (←)" aria-label="Previous" onClick={() => step(-1)}><IconChevL /></button>
            <button className="btn ghost sm" title="Today (T)" onClick={() => setCursor(todayStr())}>Today</button>
            <button className="icon-btn" title="Next (→)" aria-label="Next" onClick={() => step(1)}><IconChevR /></button>
          </div>
        </div>
        <div className="cal-tools">
          {(ev.loading || found.loading) && <span className="spin" aria-label="Loading" />}
          <Segmented label="Calendar view" value={view} onChange={(v) => { closeSearch(); changeView(v); }} options={phone ? VIEWS.map(([k, l, t]) => [k, k === 'schedule' ? 'List' : l, t]) : VIEWS} />
          <button className={`icon-btn ${searching ? 'on' : ''}`} aria-label="Search events" title="Search (/)" aria-pressed={searching} onClick={() => (searching ? closeSearch() : openSearch())}><IconSearch /></button>
          <Popover label="Show and hide" className="cal-list" button={({ toggle, open: isOpen, props }) => <button className={`icon-btn ${isOpen ? 'on' : ''}`} onClick={toggle} {...props}><IconSliders /></button>}>
            {(close) => (
              <>
                <label className="pop-item"><input type="checkbox" checked={showTasks} onChange={toggleTasks} /><span>Tasks</span></label>
                <div className="pop-sep" />
                <div className="pop-label">Calendars</div>
                {calList.map((cal) => (
                  <label key={cal.id} className="pop-item" style={{ '--c': cal.color }}>
                    <input type="checkbox" checked={!!cal.visible} onChange={() => toggleCal(cal)} /><span>{cal.name}</span>
                  </label>
                ))}
                {!cals.data && <div className="pop-item muted">Loading…</div>}
                <div className="pop-sep" />
                <button className="pop-item" onClick={() => { close(); setManaging(true); }}>Manage calendars…</button>
              </>
            )}
          </Popover>
          <button className="btn primary" aria-label="New event" title="New event (C)" onClick={newEvent}><IconPlus /><span className="hide-phone">New event</span></button>
        </div>
      </div>
      {searching && (
        <div className="cal-search">
          <IconSearch />
          <input ref={searchRef} className="input" type="search" placeholder="Search events" aria-label="Search events" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') closeSearch(); }} />
          <button className="icon-btn" aria-label="Close search" onClick={closeSearch}><IconX /></button>
        </div>
      )}
      {ev.error && <div style={{ marginBottom: 12 }}><LoadError error={ev.error} onRetry={ev.reload} /></div>}

      {searching ? (
        <div className="card agenda-card">
          {!q ? <Empty>Search titles, places, descriptions and guests, a year back and a year ahead.</Empty>
            : found.error ? <LoadError error={found.error} onRetry={found.reload} />
            : !found.data ? <Empty><span className="spin" aria-label="Searching" /></Empty>
            : !found.data.length ? <Empty>No events match “{q}”.</Empty>
            : <Agenda groups={groupByDay(found.data)} today={today} onOpen={open} label={label} showYear />}
        </div>
      ) : view === 'schedule' ? (
        <div className="card agenda-card">
          {(() => {
            const groups = days.map((d) => ({ date: d, items: [...layout[d].allDay, ...layout[d].timed.filter((e) => !e.declined)], tasks: tasksOn(d) })).filter((g) => g.items.length || g.tasks.length);
            if (!ev.data) return <Empty><span className="spin" aria-label="Loading" /></Empty>;
            return groups.length ? <Agenda groups={groups} today={today} onOpen={open} onTask={openTask} onDay={openDay} label={label} /> : <Empty>Nothing scheduled in these {SCHEDULE_DAYS} days.</Empty>;
          })()}
        </div>
      ) : view === 'month' ? (
        <div className="card month">
          <div className="month-head">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d}>{phone ? d[0] : d}</div>)}</div>
          <div className="month-grid">
            {days.map((d) => {
              const items = [...layout[d].allDay.map((e) => ({ e, all: true })), ...layout[d].timed.filter((e) => !e.declined).map((e) => ({ e, all: false }))];
              const dayTasks = tasksOn(d);
              const max = phone ? 4 : 3;
              const out = d.slice(0, 7) !== cursor.slice(0, 7);
              return (
                <div key={d} data-date={d} className={`mcell ${out ? 'out' : ''} ${d === today ? 'today' : ''} ${dropDay === d ? 'drop' : ''}`} onClick={() => { if (isMobile()) openDay(d); }} onDoubleClick={() => { if (!isMobile()) setCreating({ date: d, startMin: 540, mins: 60, allDay: true }); }}>
                  <button className="mnum" aria-label={parse(d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} onClick={(e) => { e.stopPropagation(); openDay(d); }}>{parse(d).getDate()}</button>
                  {items.slice(0, max).map(({ e, all }) => (
                    <button key={e.id + d} className={`mev ${all ? 'all' : ''}`} style={{ '--c': e.color }} onClick={() => open(e)} onPointerDown={(p) => monthDown(p, e, d)} title={label(e)}>
                      {!all && <i />}{!all && <span className="t">{clockTime(e.start)}</span>}<span className="lbl">{label(e)}</span>
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
                    {layout[d].allDay.map((e) => <button key={e.id} className="ev" style={{ '--c': e.color }} onClick={() => open(e)} title={e.title}>{e.title}</button>)}
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
              <div key={d} data-date={d} className={`day-col ${d === today ? 'today' : ''}`} style={{ height: HOUR * 24 }}
                onClick={(e) => slotClick(e, d)} onPointerDown={(e) => slotDown(e, d)}>
                {draft?.date === d && <div className="ev-draft" style={{ top: (draft.a / 60) * HOUR, height: Math.max(12, ((draft.b - draft.a) / 60) * HOUR) }}>{humanTime(hm(draft.a))} – {humanTime(hm(draft.b))}</div>}
                {mounted && d === today && <div className="now-line" style={{ top: ((now - parse(d)) / 3600000) * HOUR }} />}
                {layout[d].timed.map((e) => (
                  <button key={e.id + d} className={`ev-block ${e.declined ? 'declined' : ''} ${e.myStatus === 'needsAction' || e.myStatus === 'tentative' ? 'unanswered' : ''} ${e.b < now ? 'past' : ''} ${e.moving ? 'moving' : ''} ${editable(e) ? 'can-move' : ''}`}
                    onClick={() => open(e)} onPointerDown={(p) => blockDown(p, e, d, 'move')}
                    style={{ '--c': e.color, top: e.top, height: e.height, left: `calc(${(e.lane / e.lanes) * 100}% + 2px)`, width: `calc(${(100 * e.span) / e.lanes}% - 4px)` }}>
                    <b>{e.title}</b>{e.meal && <span className="ev-meal">{e.meal}</span>}{e.height > (e.meal ? 52 : 34) && <span>{clockTime(e.start)} – {clockTime(e.end)}{view === 'day' && e.location ? ` · ${e.location}` : ''}</span>}
                    {editable(e) && e.lastPart && <span className="ev-resize" aria-hidden="true" onPointerDown={(p) => blockDown(p, e, d, 'resize')} />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="kbd-hint"><span className="kbd">D</span> day · <span className="kbd">W</span> week · <span className="kbd">M</span> month · <span className="kbd">A</span> schedule · <span className="kbd">T</span> today · <span className="kbd">C</span> new · <span className="kbd">/</span> search · drag events to move them, or their bottom edge to resize</p>
      {sel && !editing && <EventSheet e={sel} onEdit={() => setEditing(sel)} onDuplicate={calList.some((cal) => cal.writable) ? () => duplicate(sel) : null} onClose={() => setSel(null)} onChanged={(gone) => { if (gone) setSel(null); reload(); }} />}
      {(creating || editing) && <EventForm init={creating} event={editing} calendars={calList.filter((cal) => cal.writable)} onClose={() => { setCreating(null); setEditing(null); }} onSaved={() => { setCreating(null); setEditing(null); setSel(null); reload(); }} />}
      {managing && <CalendarsSheet calendars={calList} onClose={() => setManaging(false)} onChanged={() => { cals.reload(); ev.reload(); }} />}
      {scopeDialog}
    </>
  );
}

const groupByDay = (list) => {
  const by = {};
  for (const e of list) { const d = e.allDay ? e.start : fmt(new Date(e.start)); (by[d] ||= []).push(e); }
  return Object.keys(by).sort().map((date) => ({ date, items: by[date] }));
};

// A plain list of days and what's on them (the Schedule view and search results).
function Agenda({ groups, today, onOpen, onTask, onDay, label, showYear }) {
  return (
    <ul className="agenda-days">
      {groups.map((g) => {
        const d = parse(g.date);
        return (
          <li key={g.date} className={g.date === today ? 'today' : g.date < today ? 'past' : ''}>
            <button className="agenda-date" disabled={!onDay} onClick={() => onDay?.(g.date)} aria-label={d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}>
              <b>{d.getDate()}</b><span>{d.toLocaleDateString(undefined, { month: 'short', weekday: 'short', ...(showYear ? { year: 'numeric' } : {}) })}</span>
            </button>
            <div className="agenda-items">
              {g.items.map((e) => (
                <button key={e.id + g.date} className="agenda-ev" style={{ '--c': e.color }} onClick={() => onOpen(e)}>
                  <i /><span className="t">{e.allDay ? 'All day' : `${clockTime(e.start)} – ${clockTime(e.end)}`}</span>
                  <span className="lbl">{label(e)}{e.recurring && <IconRepeat />}</span>
                  {e.location && <span className="loc">{e.location}</span>}
                </button>
              ))}
              {(g.tasks || []).map((t) => <button key={t.id} className="agenda-ev task" onClick={() => onTask(t)}><i /><span className="t">{t.due_time ? humanTime(t.due_time) : 'Task'}</span><span className="lbl">{t.content}</span></button>)}
            </div>
          </li>
        );
      })}
    </ul>
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
