'use client';
// What you see when you open an event: details, guests and your reply,
// and the things you can do with it.
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Sheet, Segmented, useDialog } from '@/components/ui';
import { api } from '@/lib/client';
import { describeRule } from '@/lib/rrule';
import { fmt } from '@/lib/dates';
import { IconExt, IconTrash, IconMap, IconClock, IconRepeat } from '@/components/Icons';
import { whenText, reminderText, STATUS_WORD } from './util';
import { useScope } from './Scope';

const RSVP = [['accepted', 'Yes'], ['declined', 'No'], ['tentative', 'Maybe']];
const icon = { width: 15, height: 15, flex: 'none' };

// Plain text with clickable links (descriptions from Google can hold HTML).
function Description({ text }) {
  const clean = text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
  if (!clean) return null;
  const parts = clean.split(/(https?:\/\/[^\s<>"]+)/g);
  return <div className="ev-desc">{parts.map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a> : p))}</div>;
}

export default function EventSheet({ e, onEdit, onDuplicate, onClose, onChanged }) {
  const { attempt, showToast } = useApp();
  const { confirm } = useDialog();
  const [askScope, scopeDialog] = useScope();
  const [repeat, setRepeat] = useState(null);
  const [mine, setMine] = useState(e.myStatus);
  useEffect(() => {
    if (!e.recurring) return;
    let live = true;
    api(`/api/calendar/events?calendarId=${encodeURIComponent(e.calendarId)}&id=${encodeURIComponent(e.id)}`).then((x) => { if (live) setRepeat(x.repeat || ''); }).catch(() => {});
    return () => { live = false; };
  }, [e.id]); // eslint-disable-line

  const others = (e.guests || []).filter((g) => !g.self);
  const emailsGuests = e.organizer?.self !== false && others.length > 0;
  const del = async () => {
    let scope = 'this';
    if (e.recurring) {
      scope = await askScope({ title: 'Delete repeating event', confirmLabel: 'Delete', danger: true });
      if (!scope) return;
    } else if (!(await confirm({ title: 'Delete this event?', body: `“${e.title}” will be removed from Google Calendar.${emailsGuests ? ' Guests will be told it’s cancelled.' : ''}`, confirmLabel: 'Delete', danger: true }))) return;
    const ok = await attempt(() => api(`/api/calendar/events?calendarId=${encodeURIComponent(e.calendarId)}&id=${encodeURIComponent(e.id)}&scope=${scope}${emailsGuests ? '&notify=1' : ''}`, { method: 'DELETE' }));
    if (ok) { showToast('Event deleted'); onChanged(true); }
  };
  const reply = async (status) => {
    if (status === mine) return;
    let scope = 'this';
    if (e.recurring) { scope = await askScope({ title: 'Reply to repeating event', without: ['following'] }); if (!scope) return; }
    const before = mine;
    setMine(status);
    const ok = await attempt(() => api('/api/calendar/events', { method: 'PATCH', body: { calendarId: e.calendarId, id: e.id, rsvp: status, scope } }));
    if (ok) { showToast(`Replied: ${STATUS_WORD[status].toLowerCase()}`); onChanged(false); } else setMine(before);
  };

  const going = (e.guests || []).filter((g) => g.status === 'accepted').length;
  const custom = e.reminders && !e.reminders.useDefault;
  return (
    <>
      <Sheet title={<h2><i className="ev-dot" style={{ background: e.color }} />{e.title}</h2>} label={e.title} onClose={onClose}>
        <div className="row nowrap ev-when"><IconClock style={icon} /><span>{whenText(e)}</span></div>
        {e.recurring && <div className="row nowrap ev-when"><IconRepeat style={icon} /><span>{repeat === null ? 'Repeats' : repeat ? describeRule(repeat, e.allDay ? e.start : fmt(new Date(e.start))) : 'Part of a repeating event'}</span></div>}
        {e.meal && <div className="row nowrap ev-when"><span className="muted">Dinner</span><span>{e.meal}</span></div>}
        {e.location && <div className="row nowrap ev-when"><IconMap style={icon} /><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}`} target="_blank" rel="noreferrer">{e.location}</a></div>}
        {e.meet && <div><a className="btn primary" href={e.meet} target="_blank" rel="noreferrer">Join call</a></div>}

        {(e.guests || []).length > 0 && (
          <div className="guests">
            <div className="muted small">{e.guests.length} guest{e.guests.length === 1 ? '' : 's'}{going ? ` · ${going} going` : ''}</div>
            <ul>
              {e.guests.map((g) => (
                <li key={g.email} title={STATUS_WORD[g.status]}>
                  <i className={`rsvp ${g.status}`} aria-hidden="true" />
                  <span>{g.name || g.email}{g.self ? ' (you)' : ''}</span>
                  <span className="muted small">{g.organizer ? 'Organiser' : g.optional ? 'Optional' : ''}{g.status !== 'needsAction' && !g.self ? `${g.organizer || g.optional ? ' · ' : ''}${STATUS_WORD[g.status]}` : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {mine && (
          <div className="row nowrap rsvp-row"><span className="muted">Going?</span><Segmented small label="Your reply" value={mine} onChange={reply} options={RSVP} /></div>
        )}

        <Description text={e.description || ''} />
        <div className="row">
          {(e.calendars || [e.calendar]).filter(Boolean).map((c) => <span key={c} className="chip"><i style={{ background: e.color }} />{c}</span>)}
          {!e.busy && <span className="chip">Free</span>}
          {e.visibility === 'private' && <span className="chip">Private</span>}
          {custom && e.reminders.overrides.map((r, i) => <span key={i} className="chip">{reminderText(r)}</span>)}
        </div>
        <div className="row ev-actions">
          {e.canEdit && <button className="btn" onClick={onEdit}>Edit</button>}
          {onDuplicate && <button className="btn" onClick={onDuplicate}>Duplicate</button>}
          {e.link && <a className="btn ghost" href={e.link} target="_blank" rel="noreferrer"><IconExt /> Google</a>}
          <span className="grow" />
          {e.canEdit && <button className="btn ghost danger" onClick={del}><IconTrash /> Delete</button>}
        </div>
      </Sheet>
      {scopeDialog}
    </>
  );
}
