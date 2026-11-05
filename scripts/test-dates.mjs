import { nextDue, firstDue, parseRecurrence } from '../lib/dates.js';
import { quickAdd } from '../lib/quickadd.js';
const T = '2026-11-04'; // Wednesday
const cases = [
  ['every day', '2026-11-04', '2026-11-05'],
  ['ev day', '2026-11-01', '2026-11-05'],
  ['every! 3 months', '2026-11-07', '2027-02-04'],
  ['ev monday', '2026-11-09', '2026-11-16'],
  ['every saturday', '2026-11-04', '2026-11-07'],
  ['every other sunday', '2026-11-15', '2026-11-29'],
  ['every 4 days', '2026-11-04', '2026-11-08'],
  ['every weekday', '2026-11-06', '2026-11-09'],
  ['every 15th', '2026-11-04', '2026-11-15'],
  ['every mon, wed', '2026-11-04', '2026-11-09'],
];
let fail = 0;
for (const [s, due, want] of cases) {
  const got = nextDue(s, due, T).date;
  if (got !== want) { fail++; console.log('FAIL', s, due, '->', got, 'want', want, parseRecurrence(s)); }
}
console.log('firstDue every monday:', firstDue('every monday', T), 'every day:', firstDue('every day', T));
const qa = quickAdd('Call mom tomorrow 5pm p1 #Family @phone', { projects: [{ id: 'f', name: 'Family' }], labels: [] });
console.log(JSON.stringify(qa));
console.log(JSON.stringify(quickAdd('stretch every day at 7am #Health', { projects: [{ id: 'h', name: 'Health' }] })));
console.log(fail ? `${fail} failures` : 'all recurrence cases pass');
const fd = [['every other sunday', '2026-11-08'], ['every! 2 weeks', T], ['every mon, fri', '2026-11-06'], ['every 15th', '2026-11-15'], ['every wednesday', T]];
for (const [s, want] of fd) { const got = firstDue(s, T); if (got !== want) console.log('FAIL firstDue', s, got, 'want', want); }
console.log('firstDue checks done');
