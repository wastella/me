'use client';
// One form for a new event and for changing an existing one. Covers what
// Google Calendar's own editor does: repeats, guests, Meet, reminders,
// colour, busy/free, visibility, description and which calendar it's on.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Sheet, useAutoGrow } from '@/components/ui';
import { api } from '@/lib/client';
import { fmt, addDays, diffDays, parse } from '@/lib/dates';
import { parseRule, buildRule, describeRule, presets, DAYS, nthWeekday, isLastWeekday } from '@/lib/rrule';
import { IconX, IconPlus } from '@/components/Icons';
import { hm, toMin, localISO, EVENT_COLORS } from './util';
import { useScope } from './Scope';

const UNITS = [['minutes', 1], ['hours', 60], ['days', 1440], ['weeks', 10080]];
const splitMinutes = (m) => { for (const [u, n] of [...UNITS].reverse()) if (m && m % n === 0) return { amount: m / n, unit: u }; return { amount: m, unit: 'minutes' }; };
const unitSize = (u) => UNITS.find(([k]) => k === u)[1];

function initial(event, init, calendars) {
  const base = { description: '', guests: [], notify: true, repeat: '', remindersDefault: true, reminders: [], colorId: '', visibility: 'default', busy: true, meet: false };
  if (event) {
    const shared = {
      ...base, title: event.title === '(No title)' ? '' : event.title, location: event.location || '', calendarId: event.calendarId,
      description: (event.description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''),
      guests: (event.guests || []).map((g) => g.email), repeat: event.repeat || '',
      remindersDefault: event.reminders?.useDefault !== false, reminders: event.reminders?.overrides || [],
      colorId: event.colorId || '', visibility: event.visibility || 'default', busy: event.busy !== false, meet: !!event.meet,
    };
    if (event.allDay) return { ...shared, date: event.start, start: '09:00', mins: 60, days: Math.max(1, diffDays(event.end, event.start)), allDay: true };
    const s = new Date(event.start);
    return { ...shared, date: fmt(s), start: hm(s.getHours() * 60 + s.getMinutes()), mins: Math.max(5, Math.round((new Date(event.end) - s) / 60000)), days: 1, allDay: false };
  }
  return { ...base, title: '', location: '', date: init.date, start: hm(init.startMin ?? 540), mins: init.mins || 60, days: 1, allDay: !!init.allDay, calendarId: calendars.find((c) => c.primary)?.id || calendars[0]?.id || 'primary', ...(init.copy || {}) };
}

// The form's state as the fields the API takes.
function toFields(f) {
  const s = new Date(`${f.date}T${f.start || '09:00'}`);
  const when = f.allDay
    ? { allDay: true, start: f.date, end: addDays(f.date, Math.max(1, f.days)) }
    : { allDay: false, start: localISO(s), end: localISO(new Date(s.getTime() + f.mins * 60000)) };
  return {
    title: f.title.trim(), when, location: f.location.trim(), description: f.description.trim(), guests: f.guests,
    repeat: f.repeat, reminders: f.remindersDefault ? { useDefault: true } : { useDefault: false, overrides: f.reminders },
    colorId: f.colorId, visibility: f.visibility, busy: f.busy, meet: f.meet,
  };
}

export default function EventForm({ init, event, calendars, onClose, onSaved }) {
  const { showToast } = useApp();
  const [askScope, scopeDialog] = useScope();
  // A repeating event's rule lives on its series; fetch it before editing.
  const [full, setFull] = useState(event && event.recurring ? null : event || {});
  const [loadErr, setLoadErr] = useState(null);
  useEffect(() => {
    if (!event?.recurring) return;
    api(`/api/calendar/events?calendarId=${encodeURIComponent(event.calendarId)}&id=${encodeURIComponent(event.id)}`)
      .then((e) => setFull({ ...event, ...e })).catch((x) => setLoadErr(x.message));
  }, []); // eslint-disable-line

  if (loadErr) return <Sheet title="Edit event" onClose={onClose}><div className="error-box" role="alert">{loadErr}</div></Sheet>;
  if (!full) return <Sheet title="Edit event" onClose={onClose}><div className="empty"><span className="spin" aria-label="Loading" /></div></Sheet>;
  return (
    <>
      <Form init={init} event={event ? full : null} calendars={calendars} onClose={onClose} onSaved={onSaved} showToast={showToast} askScope={askScope} />
      {scopeDialog}
    </>
  );
}

function Form({ init, event, calendars, onClose, onSaved, showToast, askScope }) {
  const first = useMemo(() => initial(event, init, calendars), []); // eslint-disable-line
  const [f, setF] = useState(first);
  const set = (patch) => setF((v) => ({ ...v, ...patch }));
  const hasExtras = !!(first.description || first.guests.length || first.meet || !first.remindersDefault || first.colorId || first.visibility !== 'default' || !first.busy);
  const [more, setMore] = useState(hasExtras);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const desc = useRef(null);
  useAutoGrow(desc, f.description + (more ? '1' : ''), 64);

  const endMin = toMin(f.start) + f.mins;
  const endDate = addDays(f.date, Math.floor(endMin / 1440));
  const setEndTime = (v) => { let d = toMin(v) - toMin(f.start) + Math.floor(endMin / 1440) * 1440; if (d <= 0) d += 1440; set({ mins: d }); };
  const setEndDate = (v) => { if (!v) return; const d = diffDays(v, f.date) * 1440 + (endMin % 1440) - toMin(f.start); set({ mins: d > 0 ? d : f.mins % 1440 || 60 }); };
  const [multi, setMulti] = useState(() => !first.allDay && Math.floor((toMin(first.start) + first.mins) / 1440) > 0 && (toMin(first.start) + first.mins) % 1440 !== 0);

  const submit = async (e) => {
    e.preventDefault();
    if (!f.title.trim() || !f.date || busy) return;
    setErr(null);
    const now = toFields(f), was = toFields(first);
    const { when, ...rest } = now;
    let body;
    if (!event) {
      body = { ...rest, ...when, calendarId: f.calendarId, notify: f.notify && f.guests.length > 0 };
      if (!body.meet) delete body.meet;
    } else {
      // Send only what changed, so nothing else on the event is disturbed.
      body = { calendarId: event.calendarId, id: event.id };
      for (const k of Object.keys(rest)) if (JSON.stringify(rest[k]) !== JSON.stringify(was[k])) body[k] = rest[k];
      if (JSON.stringify(when) !== JSON.stringify(was.when)) Object.assign(body, when);
      if (f.calendarId !== event.calendarId) body.moveTo = f.calendarId;
      if (Object.keys(body).length === 2) { onClose(); return; }
      if (f.guests.length || first.guests.length) body.notify = f.notify;
      if (event.recurring && event.repeat) {
        const scope = await askScope({ title: 'Change repeating event', without: 'repeat' in body ? ['this'] : [] });
        if (!scope) return;
        body.scope = scope;
      }
    }
    setBusy(true);
    try {
      await api('/api/calendar/events', { method: event ? 'PATCH' : 'POST', body });
      showToast(event ? 'Event updated' : `Added “${now.title}”`);
      onSaved();
    } catch (x) { setErr(x.message); setBusy(false); }
  };

  const editable = calendars.filter((c) => c.writable);
  return (
    <Sheet title={event ? 'Edit event' : 'New event'} onClose={onClose} wide={more}>
      <form onSubmit={submit} style={{ display: 'contents' }}>
        <input className="input" data-autofocus required placeholder="Title" aria-label="Title" value={f.title} onChange={(e) => set({ title: e.target.value })} autoComplete="off" />
        <div className="when-row">
          <input className="input" type="date" aria-label="Date" required value={f.date} onChange={(e) => set({ date: e.target.value })} />
          {!f.allDay && <input className="input" type="time" aria-label="Start time" value={f.start} onChange={(e) => set({ start: e.target.value })} />}
          {!f.allDay && <input className="input" type="time" aria-label="End time" value={hm(endMin)} onChange={(e) => e.target.value && setEndTime(e.target.value)} />}
          {f.allDay && <input className="input" type="date" aria-label="End date" min={f.date} value={addDays(f.date, f.days - 1)} onChange={(e) => e.target.value && set({ days: Math.max(1, diffDays(e.target.value, f.date) + 1) })} />}
        </div>
        {!f.allDay && multi && (
          <label className="field-row"><span>Ends on</span><input className="input" type="date" aria-label="End date" min={f.date} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
        )}
        <div className="row">
          <label className="check-row" style={{ padding: 0 }}><input type="checkbox" checked={f.allDay} onChange={(e) => set({ allDay: e.target.checked })} /> All day</label>
          {!f.allDay && !multi && <button type="button" className="btn ghost sm" onClick={() => setMulti(true)}>Ends another day</button>}
        </div>
        <Repeat value={f.repeat} date={f.date} allDay={f.allDay} onChange={(repeat) => set({ repeat })} />
        <input className="input" placeholder="Location" aria-label="Location" value={f.location} onChange={(e) => set({ location: e.target.value })} />
        {editable.length > 1 && (
          <label className="field-row"><span>Calendar</span>
            <select className="input" aria-label="Calendar" value={f.calendarId} onChange={(e) => set({ calendarId: e.target.value })}>
              {editable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}

        {!more && <div><button type="button" className="btn ghost sm" onClick={() => setMore(true)}>More options</button></div>}
        {more && (
          <>
            <Guests guests={f.guests} notify={f.notify} onChange={(guests) => set({ guests })} onNotify={(notify) => set({ notify })} />
            <label className="check-row" style={{ padding: 0 }}><input type="checkbox" checked={f.meet} onChange={(e) => set({ meet: e.target.checked })} /> Google Meet video call{event?.meet && f.meet ? <a className="muted small" href={event.meet} target="_blank" rel="noreferrer" style={{ marginLeft: 6 }}>{event.meet.replace(/^https?:\/\//, '')}</a> : null}</label>
            <textarea ref={desc} className="input" placeholder="Description" aria-label="Description" value={f.description} onChange={(e) => set({ description: e.target.value })} />
            <Reminders useDefault={f.remindersDefault} list={f.reminders} onChange={(remindersDefault, reminders) => set({ remindersDefault, reminders })} />
            <div className="field-row"><span>Colour</span>
              <div className="swatches" role="radiogroup" aria-label="Colour">
                <button type="button" role="radio" aria-checked={!f.colorId} title="Calendar colour" className="sw auto" style={{ '--c': calendars.find((c) => c.id === f.calendarId)?.color }} onClick={() => set({ colorId: '' })} />
                {EVENT_COLORS.map(([id, name, hex]) => <button key={id} type="button" role="radio" aria-checked={f.colorId === id} title={name} aria-label={name} className="sw" style={{ '--c': hex }} onClick={() => set({ colorId: id })} />)}
              </div>
            </div>
            <div className="field-row"><span>Show me as</span>
              <select className="input" aria-label="Show me as" value={f.busy ? 'busy' : 'free'} onChange={(e) => set({ busy: e.target.value === 'busy' })}><option value="busy">Busy</option><option value="free">Free</option></select>
            </div>
            <div className="field-row"><span>Visibility</span>
              <select className="input" aria-label="Visibility" value={f.visibility} onChange={(e) => set({ visibility: e.target.value })}><option value="default">Calendar default</option><option value="public">Public</option><option value="private">Private</option></select>
            </div>
          </>
        )}
        {err && <div className="error-box" role="alert">{err}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !f.title.trim()}>{busy ? 'Saving…' : event ? 'Save' : 'Add event'}</button>
        </div>
      </form>
    </Sheet>
  );
}

/* ---------- Repeat ---------- */
const FREQS = [['DAILY', 'day'], ['WEEKLY', 'week'], ['MONTHLY', 'month'], ['YEARLY', 'year']];
function Repeat({ value, date, allDay, onChange }) {
  const options = useMemo(() => presets(date), [date]);
  const preset = options.find((o) => o.rule === value);
  const [custom, setCustom] = useState(!!value && !preset);
  const o = parseRule(value) || { freq: 'WEEKLY', interval: 1, byDay: [DAYS[parse(date).getDay()]], monthMode: 'date', end: { type: 'never' } };
  const change = (patch) => onChange(buildRule({ ...o, ...patch }, { date, allDay }));
  // A preset is tied to the event's weekday/date: keep it in step when the date changes.
  const key = !value ? 'none' : custom || !preset ? 'custom' : preset.key;
  const prevDate = useRef(date);
  useEffect(() => {
    if (prevDate.current === date) return;
    const before = presets(prevDate.current).find((x) => x.rule === value);
    prevDate.current = date;
    if (before && !custom) { const now = presets(date).find((x) => x.key === before.key); if (now) onChange(now.rule); }
  }, [date]); // eslint-disable-line

  const pick = (k) => {
    if (k === 'none') { setCustom(false); onChange(''); }
    else if (k === 'custom') { setCustom(true); if (!value) change({}); }
    else { setCustom(false); onChange(options.find((x) => x.key === k).rule); }
  };
  return (
    <>
      <label className="field-row"><span>Repeat</span>
        <select className="input" aria-label="Repeat" value={key} onChange={(e) => pick(e.target.value)}>
          <option value="none">Does not repeat</option>
          {options.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          <option value="custom">{key === 'custom' && value ? `Custom: ${describeRule(value, date)}` : 'Custom…'}</option>
        </select>
      </label>
      {key === 'custom' && (
        <div className="repeat-box">
          <div className="row nowrap">
            <span>Every</span>
            <input className="input num" type="number" min="1" max="99" aria-label="Repeat every" value={o.interval} onChange={(e) => change({ interval: Math.max(1, +e.target.value || 1) })} />
            <select className="input" aria-label="Repeat unit" value={o.freq} onChange={(e) => change({ freq: e.target.value, byDay: e.target.value === 'WEEKLY' ? [DAYS[parse(date).getDay()]] : [], monthMode: 'date' })}>
              {FREQS.map(([k, w]) => <option key={k} value={k}>{w}{o.interval > 1 ? 's' : ''}</option>)}
            </select>
          </div>
          {o.freq === 'WEEKLY' && (
            <div className="daypick" role="group" aria-label="Repeat on">
              {DAYS.map((d, i) => {
                const on = o.byDay.includes(d);
                return <button key={d} type="button" aria-pressed={on} aria-label={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]} onClick={() => { const next = on ? o.byDay.filter((x) => x !== d) : [...o.byDay, d]; if (next.length) change({ byDay: next }); }}>{'SMTWTFS'[i]}</button>;
              })}
            </div>
          )}
          {o.freq === 'MONTHLY' && (
            <select className="input" aria-label="Monthly on" value={o.monthMode === 'weekday' ? o.byDay[0] : 'date'} onChange={(e) => change(e.target.value === 'date' ? { monthMode: 'date', byDay: [] } : { monthMode: 'weekday', byDay: [e.target.value] })}>
              <option value="date">On day {parse(date).getDate()}</option>
              <option value={nthWeekday(date)}>{describeRule({ freq: 'MONTHLY', interval: 1, monthMode: 'weekday', byDay: [nthWeekday(date)] }).replace('Monthly on', 'On')}</option>
              {isLastWeekday(date) && <option value={nthWeekday(date, true)}>{describeRule({ freq: 'MONTHLY', interval: 1, monthMode: 'weekday', byDay: [nthWeekday(date, true)] }).replace('Monthly on', 'On')}</option>}
            </select>
          )}
          <div className="row nowrap">
            <span>Ends</span>
            <select className="input" aria-label="Ends" value={o.end.type} onChange={(e) => change({ end: e.target.value === 'until' ? { type: 'until', until: addDays(date, 90) } : e.target.value === 'count' ? { type: 'count', count: 10 } : { type: 'never' } })}>
              <option value="never">Never</option><option value="until">On a date</option><option value="count">After</option>
            </select>
            {o.end.type === 'until' && <input className="input" type="date" aria-label="Repeat until" min={date} value={o.end.until} onChange={(e) => e.target.value && change({ end: { type: 'until', until: e.target.value } })} />}
            {o.end.type === 'count' && <><input className="input num" type="number" min="1" max="730" aria-label="Number of times" value={o.end.count} onChange={(e) => change({ end: { type: 'count', count: Math.max(1, +e.target.value || 1) } })} /><span>times</span></>}
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Guests ---------- */
function Guests({ guests, notify, onChange, onNotify }) {
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const add = () => {
    const found = text.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!found.length) return true;
    if (found.some((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))) { setBad(true); return false; }
    onChange([...new Set([...guests, ...found])]); setText(''); setBad(false);
    return true;
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row nowrap">
        <input className="input" type="email" multiple placeholder="Add guests by email" aria-label="Add guests" aria-invalid={bad} value={text} autoComplete="off"
          onChange={(e) => { setText(e.target.value); setBad(false); }} onBlur={add}
          onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ',') && text.trim()) { e.preventDefault(); add(); } }} />
        <button type="button" className="btn" onClick={add} disabled={!text.trim()}>Add</button>
      </div>
      {bad && <div className="muted small" role="alert">That doesn’t look like an email address.</div>}
      {guests.length > 0 && (
        <>
          <div className="row">{guests.map((g) => <span key={g} className="chip guest">{g}<button type="button" aria-label={`Remove ${g}`} onClick={() => onChange(guests.filter((x) => x !== g))}><IconX /></button></span>)}</div>
          <label className="check-row" style={{ padding: 0 }}><input type="checkbox" checked={notify} onChange={(e) => onNotify(e.target.checked)} /> Email guests about this</label>
        </>
      )}
    </div>
  );
}

/* ---------- Reminders ---------- */
function Reminders({ useDefault, list, onChange }) {
  const update = (i, patch) => onChange(false, list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="stack" style={{ gap: 8 }}>
      <label className="check-row" style={{ padding: 0 }}><input type="checkbox" checked={useDefault} onChange={(e) => onChange(e.target.checked, e.target.checked || list.length ? list : [{ method: 'popup', minutes: 30 }])} /> Use my calendar’s usual reminders</label>
      {!useDefault && list.map((r, i) => {
        const { amount, unit } = splitMinutes(r.minutes);
        return (
          <div key={i} className="row nowrap reminder">
            <select className="input" aria-label="Reminder type" value={r.method} onChange={(e) => update(i, { method: e.target.value })}><option value="popup">Notification</option><option value="email">Email</option></select>
            <input className="input num" type="number" min="0" max="999" aria-label="Reminder amount" value={amount} onChange={(e) => update(i, { minutes: Math.max(0, +e.target.value || 0) * unitSize(unit) })} />
            <select className="input" aria-label="Reminder unit" value={unit} onChange={(e) => update(i, { minutes: amount * unitSize(e.target.value) })}>{UNITS.map(([u]) => <option key={u} value={u}>{u} before</option>)}</select>
            <button type="button" className="icon-btn" aria-label="Remove reminder" onClick={() => onChange(false, list.filter((_, j) => j !== i))}><IconX /></button>
          </div>
        );
      })}
      {!useDefault && list.length < 5 && <div><button type="button" className="btn ghost sm" onClick={() => onChange(false, [...list, { method: 'popup', minutes: 10 }])}><IconPlus /> Add reminder</button></div>}
    </div>
  );
}
