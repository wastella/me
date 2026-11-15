import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMonths, diffDays, dow, parseRecurrence, nextDue, firstDue, humanDate, humanTime, fmt, parse, isDate } from '../lib/dates.js';

const T = '2026-11-04'; // a Wednesday

test('date arithmetic', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09', 'crosses the spring clock change');
  assert.equal(addDays('2026-11-01', 1), '2026-11-02', 'crosses the autumn clock change');
  assert.equal(diffDays('2026-11-02', '2026-10-31'), 2, 'clock change does not lose a day');
  assert.equal(diffDays('2026-03-07', '2026-03-09'), -2);
  assert.equal(dow(T), 3);
  assert.equal(fmt(parse('2026-01-09')), '2026-01-09');
});

test('addMonths clamps to the end of shorter months', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-11-07', 3), '2027-02-07');
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
});

test('isDate accepts only real calendar dates', () => {
  assert.equal(isDate('2026-11-04'), true);
  assert.equal(isDate('2026-02-30'), false);
  assert.equal(isDate('11/04/2026'), false);
  assert.equal(isDate(''), false);
  assert.equal(isDate(null), false);
});

test('parseRecurrence understands the usual phrasings', () => {
  assert.deepEqual(parseRecurrence('every day'), { kind: 'interval', unit: 'day', interval: 1, fromCompletion: false });
  assert.deepEqual(parseRecurrence('ev day'), { kind: 'interval', unit: 'day', interval: 1, fromCompletion: false });
  assert.deepEqual(parseRecurrence('daily'), { kind: 'interval', unit: 'day', interval: 1, fromCompletion: false });
  assert.deepEqual(parseRecurrence('every! 3 months'), { kind: 'interval', unit: 'month', interval: 3, fromCompletion: true });
  assert.deepEqual(parseRecurrence('every other sunday'), { kind: 'days', days: [0], interval: 2, fromCompletion: false });
  assert.deepEqual(parseRecurrence('every mon, wed and fri'), { kind: 'days', days: [1, 3, 5], interval: 1, fromCompletion: false });
  assert.deepEqual(parseRecurrence('every weekday'), { kind: 'days', days: [1, 2, 3, 4, 5], interval: 1, fromCompletion: false });
  assert.deepEqual(parseRecurrence('Every Saturday at 9am'), { kind: 'days', days: [6], interval: 1, fromCompletion: false });
  assert.deepEqual(parseRecurrence('every 15th'), { kind: 'monthday', day: 15, interval: 1, fromCompletion: false });
  assert.deepEqual(parseRecurrence('every 2 weeks'), { kind: 'interval', unit: 'week', interval: 2, fromCompletion: false });
});

test('parseRecurrence rejects things that are not repeats', () => {
  for (const s of ['tomorrow', 'every', 'every so often', 'everything bagel', 'every 32nd', 'every 0 days', '', null]) assert.equal(parseRecurrence(s), null, String(s));
});

test('nextDue moves a completed repeating task to its next date', () => {
  const cases = [
    ['every day', '2026-11-04', '2026-11-05'],
    ['ev day', '2026-11-01', '2026-11-05'],          // missed days are skipped, not replayed
    ['every! 3 months', '2026-11-07', '2027-02-04'], // counts from the day it was done
    ['ev monday', '2026-11-09', '2026-11-16'],
    ['every saturday', '2026-11-04', '2026-11-07'],
    ['every other sunday', '2026-11-15', '2026-11-29'],
    ['every 4 days', '2026-11-04', '2026-11-08'],
    ['every weekday', '2026-11-06', '2026-11-09'],
    ['every weekend', '2026-11-04', '2026-11-07'],
    ['every 15th', '2026-11-04', '2026-11-15'],
    ['every 15th', '2026-11-15', '2026-12-15'],
    ['every mon, wed', '2026-11-04', '2026-11-09'],
    ['every year', '2026-11-04', '2027-11-04'],
  ];
  for (const [s, due, want] of cases) assert.deepEqual(nextDue(s, due, T), { date: want, understood: true }, `${s} from ${due}`);
});

test('nextDue never loses a task it cannot understand', () => {
  assert.deepEqual(nextDue('every blue moon', '2026-11-01', T), { date: '2026-11-05', understood: false });
  assert.deepEqual(nextDue('every day', null, T), { date: '2026-11-05', understood: true });
});

test('monthly repeats on the 29th-31st land on the last day of short months', () => {
  assert.equal(nextDue('every 31st', '2026-01-31', '2026-01-31').date, '2026-02-28');
  assert.equal(nextDue('every 31st', '2026-02-28', '2026-02-28').date, '2026-03-31');
  assert.equal(nextDue('every 30th', '2026-01-30', '2026-02-10').date, '2026-02-28');
  assert.equal(firstDue('every 31st', '2026-04-10'), '2026-04-30');
});

test('firstDue picks where a brand-new repeating task starts', () => {
  assert.equal(firstDue('every day', T), T);
  assert.equal(firstDue('every wednesday', T), T);
  assert.equal(firstDue('every monday', T), '2026-11-09');
  assert.equal(firstDue('every other sunday', T), '2026-11-08');
  assert.equal(firstDue('every mon, fri', T), '2026-11-06');
  assert.equal(firstDue('every 15th', T), '2026-11-15');
  assert.equal(firstDue('every 4th', T), T);
  assert.equal(firstDue('every! 2 weeks', T), T);
});

test('humanDate and humanTime', () => {
  assert.equal(humanDate(T, T), 'Today');
  assert.equal(humanDate('2026-11-05', T), 'Tomorrow');
  assert.equal(humanDate('2026-11-03', T), 'Yesterday');
  assert.equal(humanDate('2026-11-07', T), 'Saturday');
  assert.match(humanDate('2026-11-20', T), /Nov 20/);
  assert.match(humanDate('2027-01-02', T), /2027/);
  assert.equal(humanDate(null, T), '');
  assert.equal(humanTime('09:00'), '9am');
  assert.equal(humanTime('17:30'), '5:30pm');
  assert.equal(humanTime('00:05'), '12:05am');
  assert.equal(humanTime('12:00'), '12pm');
  assert.equal(humanTime(''), '');
});

test('repeat rules read the same however they were typed', async () => {
  const { humanRecurrence } = await import('../lib/dates.js');
  assert.equal(humanRecurrence('ev day'), 'Daily');
  assert.equal(humanRecurrence('every day'), 'Daily');
  assert.equal(humanRecurrence('every day 7am'), 'Daily');
  assert.equal(humanRecurrence('every saturday'), 'Every Sat');
  assert.equal(humanRecurrence('every other sunday'), 'Every other Sun');
  assert.equal(humanRecurrence('every 2 days'), 'Every 2 days');
  assert.equal(humanRecurrence('every 2 weeks'), 'Every other week');
  assert.equal(humanRecurrence('every mon, wed and fri'), 'Every Mon, Wed, Fri');
  assert.equal(humanRecurrence('every weekday'), 'Weekdays');
  assert.equal(humanRecurrence('every 15th'), 'Monthly on the 15th');
  assert.equal(humanRecurrence('whenever'), 'whenever');
});
