import test from 'node:test';
import assert from 'node:assert/strict';
import { lib, rejects } from './helpers.mjs';
const ICS = await lib('ics');
const M = await lib('meals');

const SAMPLE = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Meals',
  'BEGIN:VEVENT', 'UID:1', 'DTSTART;VALUE=DATE:20261117', 'SUMMARY:Chicken tacos', 'DESCRIPTION:Dinner\\nServes 4', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:2', 'DTSTART;TZID=America/New_York:20261118T180000', 'SUMMARY:Spaghetti\\, meatballs', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:3', 'DTSTART:20261119T230000Z', 'SUMMARY:Salmon', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:4', 'DTSTART;VALUE=DATE:20261120', 'SUMMARY:Cancelled thing', 'STATUS:CANCELLED', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:5', 'DTSTART;VALUE=DATE:20261201', 'SUMMARY:Too far out', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:6', 'DTSTART;VALUE=DATE:20261117', 'SUMMARY:Chicken tacos', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:7', 'DTSTART;VALUE=DATE:20261121', 'SUMMARY:Pizza with a very long line that iCloud', ' folds onto the next line', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('parses an exported meal calendar', () => {
  const { calendarName, events } = ICS.parseICS(SAMPLE);
  assert.equal(calendarName, 'Meals');
  assert.equal(events.length, 7);
  assert.deepEqual(events[0].start, { date: '2026-11-17', time: null });
  assert.equal(events[0].description, 'Dinner\nServes 4');
  assert.equal(events[1].summary, 'Spaghetti, meatballs');
  assert.deepEqual(events[1].start, { date: '2026-11-18', time: '18:00' });
  assert.deepEqual(events[2].start, { date: '2026-11-19', time: '18:00' }, 'UTC converts to New York time');
  assert.equal(events[6].summary, 'Pizza with a very long line that iCloudfolds onto the next line', 'folded lines rejoin');
});

test('shape: range, cancelled, duplicates, order', () => {
  const { events } = ICS.parseICS(SAMPLE);
  const list = M.shape(events, '2026-11-17', '2026-11-23');
  assert.deepEqual(list.map((m) => m.meal), ['Chicken tacos', 'Spaghetti, meatballs', 'Salmon', 'Pizza with a very long line that iCloudfolds onto the next line']);
});

test('links: webcal becomes https, junk is rejected', async () => {
  assert.equal(M.normalizeUrl(' webcal://p1-caldav.icloud.com/published/2/abc '), 'https://p1-caldav.icloud.com/published/2/abc');
  assert.throws(() => M.normalizeUrl(''), /Paste/);
  assert.throws(() => M.normalizeUrl('not a link'), /isn’t a link/);
  assert.throws(() => M.normalizeUrl('http://example.com/cal.ics'), /webcal/);
  assert.deepEqual(await M.meals(), { connected: false, meals: [] });
});

test('connect checks the link is a calendar', async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('<html>hi</html>', { status: 200 });
    await rejects(assert, () => M.connect('https://example.com/page'), 400);
    globalThis.fetch = async () => new Response('', { status: 404 });
    await rejects(assert, () => M.connect('https://example.com/gone'), 502);
    globalThis.fetch = async () => new Response(SAMPLE, { status: 200 });
    assert.deepEqual(await M.connect('webcal://example.com/meals'), { name: 'Meals' });
    const r = await M.meals({ start: '2026-11-17', days: 7 });
    assert.equal(r.connected, true);
    assert.equal(r.meals.length, 4);
    await M.disconnect();
    assert.equal((await M.meals()).connected, false);
  } finally { globalThis.fetch = real; }
});

test('Supper and dinner events get that night’s meal', async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(SAMPLE, { status: 200 });
    const evs = () => [
      { title: 'Supper', allDay: false, start: '2026-11-17T23:30:00Z' },             // 6:30pm Nov 17 in New York
      { title: 'Shabbat dinner', allDay: false, start: '2026-11-19T00:00:00Z' },     // 7pm Nov 18 in New York
      { title: 'Supper', allDay: false, start: '2026-11-25T23:30:00Z' },             // no meal planned
      { title: 'Physics HW', allDay: false, start: '2026-11-17T20:00:00Z' },
      { title: 'Supper', allDay: true, start: '2026-11-17' },
    ];
    assert.equal((await M.withMeals(evs()))[0].meal, undefined, 'nothing attached before meals are connected');
    await M.connect('https://example.com/meals');
    const out = await M.withMeals(evs());
    assert.equal(out[0].meal, 'Chicken tacos');
    assert.equal(out[1].meal, 'Spaghetti, meatballs');
    assert.equal(out[2].meal, undefined);
    assert.equal(out[3].meal, undefined);
    assert.equal(out[4].meal, undefined, 'all-day events are left alone');
    globalThis.__meMeals = null;
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.equal((await M.withMeals(evs()))[0].meal, undefined, 'a broken feed never breaks the calendar');
    await M.disconnect();
  } finally { globalThis.fetch = real; }
});
