// Pure date helpers shared by server and client. All dates are local
// calendar dates in YYYY-MM-DD form.

const pad = (n) => String(n).padStart(2, '0');
export const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
// On the server (which runs in UTC when hosted) "today" follows ME_TZ, your
// timezone; in the browser it's the device's own date.
const SERVER_TZ = typeof window === 'undefined' ? (globalThis.process?.env?.ME_TZ || null) : null;
export const todayStr = () => (SERVER_TZ ? new Intl.DateTimeFormat('en-CA', { timeZone: SERVER_TZ }).format(new Date()) : fmt(new Date()));
export function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); }
export function addMonths(s, n) {
  const d = parse(s); const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last)); return fmt(d);
}
export const dow = (s) => parse(s).getDay();
export const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 86400000);

const DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
function dayIndex(word) {
  const k = word.slice(0, 3);
  return k in DAYS && /^(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/.test(word) ? DAYS[k] : null;
}

// Turns a Todoist-style recurrence string into a rule, or null.
export function parseRecurrence(str) {
  if (!str) return null;
  let s = str.toLowerCase().trim();
  const m = s.match(/^(every|ev)(!?)\s+(.*)$/);
  if (!m) {
    if (/^(daily|weekly|monthly|yearly|annually)\b/.test(s)) s = s.replace(/^(\w+)/, 'every $1');
    else return null;
    return parseRecurrence(s);
  }
  const fromCompletion = m[2] === '!';
  let rest = m[3]
    .replace(/\s+(at|@)\s+.*$/, '')
    .replace(/\s+(starting|from|until|for)\s+.*$/, '')
    .replace(/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/, '')
    .trim();
  let interval = 1;
  if (/^other\s+/.test(rest)) { interval = 2; rest = rest.replace(/^other\s+/, ''); }
  const n = rest.match(/^(\d+)\s+(.*)$/);
  if (n) { interval = Number(n[1]); rest = n[2]; }
  rest = rest.replace(/s$/, '');
  const unitMap = { day: 'day', daily: 'day', week: 'week', weekly: 'week', month: 'month', monthly: 'month', year: 'year', yearly: 'year', annually: 'year' };
  if (unitMap[rest]) return { kind: 'interval', unit: unitMap[rest], interval, fromCompletion };
  if (rest === 'weekday' || rest === 'workday') return { kind: 'days', days: [1, 2, 3, 4, 5], interval: 1, fromCompletion };
  if (rest === 'weekend') return { kind: 'days', days: [0, 6], interval: 1, fromCompletion };
  const words = rest.split(/\s*(?:,|\band\b|\s)\s*/).filter(Boolean);
  const days = words.map(dayIndex);
  if (days.length && days.every((d) => d !== null)) return { kind: 'days', days: [...new Set(days)].sort(), interval, fromCompletion };
  const nth = rest.match(/^(\d{1,2})(st|nd|rd|th)?$/);
  if (nth) return { kind: 'monthday', day: Number(nth[1]), interval, fromCompletion };
  return null;
}

function step(rule, from) {
  switch (rule.kind) {
    case 'interval':
      if (rule.unit === 'day') return addDays(from, rule.interval);
      if (rule.unit === 'week') return addDays(from, 7 * rule.interval);
      if (rule.unit === 'month') return addMonths(from, rule.interval);
      return addMonths(from, 12 * rule.interval);
    case 'days': {
      if (rule.interval > 1 && rule.days.length === 1) return addDays(from, 7 * rule.interval);
      let d = addDays(from, 1);
      for (let i = 0; i < 8 && !rule.days.includes(dow(d)); i++) d = addDays(d, 1);
      return d;
    }
    case 'monthday': {
      const d = parse(from);
      let next = new Date(d.getFullYear(), d.getMonth(), rule.day);
      if (fmt(next) <= from) next = new Date(d.getFullYear(), d.getMonth() + rule.interval, rule.day);
      return fmt(next);
    }
  }
  return addDays(from, 1);
}

// Next due date after completing a recurring task. Unknown patterns fall
// back to tomorrow so a repeating task is never lost.
export function nextDue(dueString, dueDate, today = todayStr()) {
  const rule = parseRecurrence(dueString);
  if (!rule) return { date: addDays(today, 1), understood: false };
  if (rule.fromCompletion) return { date: step(rule, today), understood: true };
  let d = step(rule, dueDate || today);
  for (let i = 0; d <= today && i < 1000; i++) d = step(rule, d);
  return { date: d, understood: true };
}

// First date a brand-new recurring task should land on.
export function firstDue(dueString, today = todayStr()) {
  const rule = parseRecurrence(dueString);
  if (!rule || rule.kind === 'interval') return today;
  if (rule.kind === 'days') {
    let d = today;
    for (let i = 0; i < 7 && !rule.days.includes(dow(d)); i++) d = addDays(d, 1);
    return d;
  }
  return step({ ...rule, interval: 1 }, addDays(today, -1));
}

export function humanDate(s, today = todayStr()) {
  if (!s) return '';
  const diff = diffDays(s, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const d = parse(s);
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  const sameYear = d.getFullYear() === parse(today).getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function humanTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return m ? `${h12}:${pad(m)}${ap}` : `${h12}${ap}`;
}
