import { fmt, parse, addDays } from '@/lib/dates';
import { clockTime } from '@/lib/client';

export const pad = (n) => String(n).padStart(2, '0');
export const hm = (min) => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
export const toMin = (s) => { const [h, m] = (s || '0:0').split(':').map(Number); return h * 60 + m; };
// A Date -> "2026-11-17T18:30:00" in this device's time, the form the API takes.
export const localISO = (d) => `${fmt(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

// Google's event colours, in its own order.
export const EVENT_COLORS = [
  ['11', 'Tomato', '#d50000'], ['4', 'Flamingo', '#e67c73'], ['6', 'Tangerine', '#f4511e'], ['5', 'Banana', '#f6bf26'],
  ['2', 'Sage', '#33b679'], ['10', 'Basil', '#0b8043'], ['7', 'Peacock', '#039be5'], ['9', 'Blueberry', '#3f51b5'],
  ['1', 'Lavender', '#7986cb'], ['3', 'Grape', '#8e24aa'], ['8', 'Graphite', '#616161'],
];

export function whenText(e) {
  const day = (d, o = {}) => d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', ...o });
  if (e.allDay) {
    const last = addDays(e.end, -1);
    return last > e.start ? `${day(parse(e.start), { weekday: 'short' })} – ${day(parse(last), { weekday: 'short' })}` : day(parse(e.start), { month: 'long' });
  }
  const s = new Date(e.start), en = new Date(e.end);
  if (fmt(s) === fmt(en)) return `${day(s)} · ${clockTime(e.start)} – ${clockTime(e.end)}`;
  return `${day(s, { weekday: 'short' })}, ${clockTime(e.start)} – ${day(en, { weekday: 'short' })}, ${clockTime(e.end)}`;
}

export function reminderText(r) {
  const m = r.minutes;
  const amount = m === 0 ? 'At the start' : m % 10080 === 0 ? `${m / 10080} week${m === 10080 ? '' : 's'} before` : m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? '' : 's'} before` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'} before` : `${m} minutes before`;
  return `${amount}${r.method === 'email' ? ' (email)' : ''}`;
}

export const STATUS_WORD = { accepted: 'Going', declined: 'Not going', tentative: 'Maybe', needsAction: 'No reply yet' };
