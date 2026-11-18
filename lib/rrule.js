// Repeat rules for calendar events, in Google's format (RFC 5545 RRULE):
// read one into plain options, build one back, and say it in words.
import { parse, fmt } from './dates.js';

export const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORD = ['first', 'second', 'third', 'fourth', 'fifth'];
const UNIT = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' };
const pad = (n) => String(n).padStart(2, '0');

// The RRULE line out of an event's `recurrence` list (which can also hold
// EXDATE lines and the like).
export const ruleOf = (recurrence) => (recurrence || []).find((l) => /^RRULE:/i.test(l)) || '';

// "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20270101T045959Z" ->
// { freq, interval, byDay, monthMode, end: { type, until, count } }
export function parseRule(rule) {
  if (!rule) return null;
  const p = Object.fromEntries(rule.replace(/^RRULE:/i, '').split(';').filter(Boolean).map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i).toUpperCase(), kv.slice(i + 1)]; }));
  if (!UNIT[p.FREQ]) return null;
  const o = { freq: p.FREQ, interval: Math.max(1, parseInt(p.INTERVAL || '1', 10) || 1), byDay: [], monthMode: 'date', end: { type: 'never' } };
  if (p.BYDAY) {
    const parts = p.BYDAY.split(',');
    if (p.FREQ === 'MONTHLY') { o.monthMode = 'weekday'; o.byDay = parts; if (p.BYSETPOS && !/\d/.test(parts[0])) o.byDay = parts.map((d) => `${p.BYSETPOS}${d}`); }
    else o.byDay = parts.map((d) => d.replace(/^[+-]?\d+/, '')).filter((d) => DAYS.includes(d));
  }
  if (p.COUNT) o.end = { type: 'count', count: Math.max(1, parseInt(p.COUNT, 10) || 1) };
  else if (p.UNTIL) {
    const m = p.UNTIL.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
    if (m) {
      const until = m[4] !== undefined && /Z$/.test(p.UNTIL) ? fmt(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))) : `${m[1]}-${m[2]}-${m[3]}`;
      o.end = { type: 'until', until };
    }
  }
  return o;
}

// Which "nth weekday" of its month a date is: 2026-11-17 -> "3TU"; the last
// one counts as "-1TU" when `last` is asked for.
export function nthWeekday(date, last = false) {
  const d = parse(date);
  const code = DAYS[d.getDay()];
  if (last) return `-1${code}`;
  return `${Math.ceil(d.getDate() / 7)}${code}`;
}
export function isLastWeekday(date) {
  const d = parse(date); const next = new Date(d); next.setDate(d.getDate() + 7);
  return next.getMonth() !== d.getMonth();
}

// Options -> "RRULE:…". `date` is the event's first day; `allDay` picks the
// form of the end date Google expects.
export function buildRule(o, { date, allDay = false } = {}) {
  if (!o || !UNIT[o.freq]) return '';
  const parts = [`FREQ=${o.freq}`];
  if (o.interval > 1) parts.push(`INTERVAL=${Math.floor(o.interval)}`);
  if (o.freq === 'WEEKLY') {
    const days = (o.byDay?.length ? o.byDay : date ? [DAYS[parse(date).getDay()]] : []).filter((d) => DAYS.includes(d));
    if (days.length) parts.push(`BYDAY=${[...new Set(days)].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b)).join(',')}`);
  }
  if (o.freq === 'MONTHLY' && o.monthMode === 'weekday') parts.push(`BYDAY=${o.byDay?.[0] && /\d/.test(o.byDay[0]) ? o.byDay[0] : nthWeekday(date)}`);
  if (o.end?.type === 'count' && o.end.count > 0) parts.push(`COUNT=${Math.floor(o.end.count)}`);
  if (o.end?.type === 'until' && o.end.until) {
    const u = o.end.until.replace(/-/g, '');
    if (allDay) parts.push(`UNTIL=${u}`);
    else {
      const end = new Date(`${o.end.until}T23:59:59`);   // end of that day, here
      parts.push(`UNTIL=${end.getUTCFullYear()}${pad(end.getUTCMonth() + 1)}${pad(end.getUTCDate())}T${pad(end.getUTCHours())}${pad(end.getUTCMinutes())}${pad(end.getUTCSeconds())}Z`);
    }
  }
  return `RRULE:${parts.join(';')}`;
}

const list = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const nthWords = (code) => {
  const m = code.match(/^(-?\d+)([A-Z]{2})$/);
  if (!m) return '';
  return `${+m[1] < 0 ? 'last' : ORD[+m[1] - 1] || `${m[1]}th`} ${DAY_NAMES[DAYS.indexOf(m[2])]}`;
};

// "Weekly on Monday and Wednesday, until Jan 1, 2027"
export function describeRule(rule, date) {
  const o = typeof rule === 'string' ? parseRule(rule) : rule;
  if (!o) return rule ? 'Repeats' : 'Does not repeat';
  const every = o.interval > 1 ? `Every ${o.interval} ${UNIT[o.freq]}s` : { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', YEARLY: 'Annually' }[o.freq];
  let on = '';
  const d = date ? parse(date) : null;
  if (o.freq === 'WEEKLY') {
    const days = o.byDay?.length ? o.byDay : d ? [DAYS[d.getDay()]] : [];
    const sorted = [...days].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));
    if (sorted.join() === 'MO,TU,WE,TH,FR') on = o.interval > 1 ? ' on weekdays' : '';
    else if (sorted.length === 7) on = ' on all days';
    else if (sorted.length) on = ` on ${list(sorted.map((x) => DAY_NAMES[DAYS.indexOf(x)]))}`;
    if (sorted.join() === 'MO,TU,WE,TH,FR' && o.interval === 1) return `Every weekday${endWords(o)}`;
  } else if (o.freq === 'MONTHLY') {
    if (o.monthMode === 'weekday' && o.byDay?.[0]) on = ` on the ${nthWords(o.byDay[0])}`;
    else if (d) on = ` on day ${d.getDate()}`;
  } else if (o.freq === 'YEARLY' && d) on = ` on ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`;
  return `${every}${on}${endWords(o)}`;
}
function endWords(o) {
  if (o.end?.type === 'count') return `, ${o.end.count} time${o.end.count === 1 ? '' : 's'}`;
  if (o.end?.type === 'until' && o.end.until) return `, until ${parse(o.end.until).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  return '';
}

// The ready-made choices Google offers for an event starting on `date`.
export function presets(date) {
  const d = parse(date);
  const day = DAYS[d.getDay()];
  const base = { interval: 1, byDay: [], monthMode: 'date', end: { type: 'never' } };
  const out = [
    ['daily', { ...base, freq: 'DAILY' }],
    ['weekly', { ...base, freq: 'WEEKLY', byDay: [day] }],
    ['monthly-nth', { ...base, freq: 'MONTHLY', monthMode: 'weekday', byDay: [nthWeekday(date)] }],
  ];
  if (isLastWeekday(date) && Math.ceil(d.getDate() / 7) === 4) out.push(['monthly-last', { ...base, freq: 'MONTHLY', monthMode: 'weekday', byDay: [nthWeekday(date, true)] }]);
  out.push(['yearly', { ...base, freq: 'YEARLY' }]);
  out.push(['weekdays', { ...base, freq: 'WEEKLY', byDay: ['MO', 'TU', 'WE', 'TH', 'FR'] }]);
  return out.map(([key, o]) => ({ key, rule: buildRule(o, { date }), label: describeRule(o, date) }));
}
