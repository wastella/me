import test from 'node:test';
import assert from 'node:assert/strict';
import { lib, rejects } from './helpers.mjs';
const R = await lib('rrule');
const G = await lib('google');
const { kvSet } = await lib('db');

test('repeat rules: read, build and describe', () => {
  const w = R.parseRule('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10');
  assert.deepEqual(w, { freq: 'WEEKLY', interval: 2, byDay: ['MO', 'WE'], monthMode: 'date', end: { type: 'count', count: 10 } });
  assert.equal(R.buildRule(w, { date: '2026-11-16' }), 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10');
  assert.equal(R.describeRule(w, '2026-11-16'), 'Every 2 weeks on Monday and Wednesday, 10 times');
  assert.equal(R.describeRule('RRULE:FREQ=DAILY'), 'Daily');
  assert.equal(R.describeRule('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'), 'Every weekday');
  assert.equal(R.describeRule('RRULE:FREQ=MONTHLY;BYDAY=3TU', '2026-11-17'), 'Monthly on the third Tuesday');
  assert.equal(R.describeRule('RRULE:FREQ=MONTHLY;BYDAY=-1FR', '2026-11-27'), 'Monthly on the last Friday');
  assert.equal(R.describeRule('RRULE:FREQ=MONTHLY', '2026-11-17'), 'Monthly on day 17');
  assert.equal(R.describeRule('RRULE:FREQ=YEARLY', '2026-11-17'), 'Annually on November 17');
  assert.equal(R.describeRule('RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261231', '2026-11-17'), 'Weekly on Tuesday, until Dec 31, 2026');
  assert.equal(R.describeRule(''), 'Does not repeat');
  assert.equal(R.parseRule('RRULE:FREQ=SECONDLY'), null);
  assert.equal(R.buildRule({ freq: 'WEEKLY', interval: 1, byDay: [], end: { type: 'until', until: '2026-12-31' } }, { date: '2026-11-17', allDay: true }), 'RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261231');
  assert.match(R.buildRule({ freq: 'DAILY', interval: 1, end: { type: 'until', until: '2026-12-31' } }, { date: '2026-11-17' }), /^RRULE:FREQ=DAILY;UNTIL=202\d{5}T\d{6}Z$/);
  assert.equal(R.nthWeekday('2026-11-17'), '3TU');
  assert.equal(R.isLastWeekday('2026-11-24'), true);
  assert.equal(R.isLastWeekday('2026-11-17'), false);
  assert.deepEqual(R.presets('2026-11-17').map((p) => p.label), ['Daily', 'Weekly on Tuesday', 'Monthly on the third Tuesday', 'Annually on November 17', 'Every weekday']);
  assert.ok(R.presets('2026-11-24').some((p) => p.label === 'Monthly on the last Tuesday'));
  assert.equal(R.ruleOf(['EXDATE:20261124', 'RRULE:FREQ=DAILY']), 'RRULE:FREQ=DAILY');
});

// A pretend Google: answers from `events`, records what was asked of it.
function fakeGoogle(events) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const path = decodeURIComponent(u.pathname.replace('/calendar/v3', ''));
    calls.push({ method, path, query: Object.fromEntries(u.searchParams), body });
    const ok = (data) => new Response(JSON.stringify(data), { status: 200 });
    if (path === '/users/me/calendarList') return ok({ items: [{ id: 'me', summary: 'William', backgroundColor: '#4f86e8', accessRole: 'owner', primary: true }, { id: 'school', summary: 'School', backgroundColor: '#0b8043', accessRole: 'reader' }] });
    const m = path.match(/^\/calendars\/[^/]+\/events(?:\/([^/]+))?(\/instances|\/move)?$/);
    if (m && method === 'GET' && m[2] === '/instances') return ok({ items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    if (m && method === 'GET' && m[1]) return events[m[1]] ? ok(events[m[1]]) : new Response(JSON.stringify({ error: { message: 'Not Found' } }), { status: 404 });
    if (m && method === 'POST') return ok({ id: 'new1' });
    if (method === 'DELETE') return new Response(null, { status: 204 });
    return ok({ id: m?.[1] });
  };
  return { calls, writes: () => calls.filter((c) => c.method !== 'GET'), restore: () => { globalThis.fetch = real; } };
}
await kvSet('google_tokens', { refresh_token: 'r', access_token: 'a', expires_at: Date.now() + 3600_000 });

const MASTER = { id: 'series', summary: 'Supper', start: { dateTime: '2026-11-03T18:30:00-05:00', timeZone: 'America/New_York' }, end: { dateTime: '2026-11-03T19:15:00-05:00', timeZone: 'America/New_York' }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=10', 'EXDATE;TZID=America/New_York:20261110T183000'], attendees: [{ email: 'mom@example.com', responseStatus: 'accepted' }, { email: 'me@example.com', self: true, responseStatus: 'needsAction' }] };
const INST = { id: 'series_20261117T233000Z', recurringEventId: 'series', summary: 'Supper', start: { dateTime: '2026-11-17T18:30:00-05:00' }, end: { dateTime: '2026-11-17T19:15:00-05:00' }, originalStartTime: { dateTime: '2026-11-17T18:30:00-05:00' }, attendees: MASTER.attendees };
const FIRST = { ...INST, id: 'series_20261103T233000Z', start: MASTER.start, end: MASTER.end, originalStartTime: { dateTime: '2026-11-03T18:30:00-05:00' } };
const ONEOFF = { id: 'one', summary: 'Dentist', start: { dateTime: '2026-11-17T12:00:00-05:00' }, end: { dateTime: '2026-11-17T13:00:00-05:00' }, attendees: [{ email: 'mom@example.com', responseStatus: 'accepted' }], hangoutLink: 'https://meet.google.com/abc' };
const ALL = { series: MASTER, [INST.id]: INST, [FIRST.id]: FIRST, one: ONEOFF };

test('creating an event sends everything Google needs', async () => {
  const g = fakeGoogle(ALL);
  try {
    await G.createEvent({ calendarId: 'me', title: 'Study group', start: '2026-11-18T15:00:00', end: '2026-11-18T16:00:00', guests: ['Sam@Example.com', 'sam@example.com'], notify: true, repeat: 'RRULE:FREQ=WEEKLY;BYDAY=WE', meet: true, reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 60 }] }, colorId: '7', busy: false, visibility: 'private', description: 'Bring notes' });
    const [c] = g.writes();
    assert.equal(c.method, 'POST'); assert.equal(c.path, '/calendars/me/events');
    assert.deepEqual(c.query, { sendUpdates: 'all', conferenceDataVersion: '1' });
    assert.equal(c.body.summary, 'Study group');
    assert.deepEqual(c.body.start, { dateTime: '2026-11-18T15:00:00', timeZone: 'America/New_York', date: null });
    assert.deepEqual(c.body.attendees, [{ email: 'sam@example.com' }]);
    assert.deepEqual(c.body.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=WE']);
    assert.equal(c.body.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
    assert.deepEqual(c.body.reminders, { useDefault: false, overrides: [{ method: 'email', minutes: 60 }] });
    assert.equal(c.body.colorId, '7'); assert.equal(c.body.transparency, 'transparent'); assert.equal(c.body.visibility, 'private');
    await rejects(assert, () => G.createEvent({ title: 'x', start: '2026-11-18', end: '2026-11-19', allDay: true, guests: ['nope'] }), 400);
    await rejects(assert, () => G.createEvent({ title: 'x' }), 400);
  } finally { g.restore(); }
});

test('changing a one-off event touches only what was passed', async () => {
  const g = fakeGoogle(ALL);
  try {
    await G.updateEvent({ calendarId: 'me', id: 'one', title: 'Dentist (moved)', guests: ['mom@example.com', 'dad@example.com'], meet: false, repeat: 'RRULE:FREQ=YEARLY' });
    const [c] = g.writes();
    assert.equal(c.method, 'PATCH'); assert.equal(c.path, '/calendars/me/events/one');
    assert.deepEqual(Object.keys(c.body).sort(), ['attendees', 'conferenceData', 'recurrence', 'summary']);
    assert.deepEqual(c.body.attendees, [{ email: 'mom@example.com', responseStatus: 'accepted' }, { email: 'dad@example.com' }], 'existing guests keep their replies');
    assert.equal(c.body.conferenceData, null);
    assert.equal(c.query.sendUpdates, 'none');
    g.calls.length = 0;
    await G.updateEvent({ calendarId: 'me', id: 'one', start: '2026-11-20', end: '2026-11-21', allDay: true, moveTo: 'other' });
    const w = g.writes();
    assert.deepEqual(w[0].body.start, { date: '2026-11-20', dateTime: null, timeZone: null });
    assert.equal(w[1].path, '/calendars/me/events/one/move'); assert.equal(w[1].query.destination, 'other');
  } finally { g.restore(); }
});

test('repeating events: this one, all of them, or this and following', async () => {
  const g = fakeGoogle(ALL);
  try {
    // Just this one.
    await G.updateEvent({ calendarId: 'me', id: INST.id, start: '2026-11-17T19:00:00', end: '2026-11-17T19:45:00', repeat: 'RRULE:FREQ=DAILY' });
    assert.equal(g.writes()[0].path, `/calendars/me/events/${INST.id}`);
    assert.equal(g.writes()[0].body.recurrence, undefined, 'one occurrence can’t carry a repeat rule');

    // All: moving this occurrence 30 minutes later moves the whole series 30 minutes later.
    g.calls.length = 0;
    await G.updateEvent({ calendarId: 'me', id: INST.id, scope: 'all', title: 'Family supper', start: '2026-11-17T19:00:00', end: '2026-11-17T20:00:00' });
    let [c] = g.writes();
    assert.equal(c.path, '/calendars/me/events/series');
    assert.equal(c.body.summary, 'Family supper');
    assert.equal(c.body.start.dateTime, '2026-11-03T19:00:00'); assert.equal(c.body.end.dateTime, '2026-11-03T20:00:00');

    // All, with only the title changed, leaves the times alone.
    g.calls.length = 0;
    await G.updateEvent({ calendarId: 'me', id: INST.id, scope: 'all', title: 'Dinner', start: '2026-11-17T18:30:00', end: '2026-11-17T19:15:00' });
    assert.deepEqual(Object.keys(g.writes()[0].body), ['summary']);

    // All, with a new rule: other lines (skipped dates) are kept.
    g.calls.length = 0;
    await G.updateEvent({ calendarId: 'me', id: INST.id, scope: 'all', repeat: 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH' });
    assert.deepEqual(g.writes()[0].body.recurrence, ['EXDATE;TZID=America/New_York:20261110T183000', 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH']);

    // This and following: the old series ends just before, a new one starts here.
    g.calls.length = 0;
    await G.updateEvent({ calendarId: 'me', id: INST.id, scope: 'following', start: '2026-11-17T17:00:00', end: '2026-11-17T17:45:00' });
    const w = g.writes();
    assert.equal(w[0].path, '/calendars/me/events/series');
    assert.deepEqual(w[0].body.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261117T232959Z', 'EXDATE;TZID=America/New_York:20261110T183000']);
    assert.equal(w[1].method, 'POST'); assert.equal(w[1].path, '/calendars/me/events');
    assert.equal(w[1].body.summary, 'Supper');
    assert.deepEqual(w[1].body.start, { dateTime: '2026-11-17T17:00:00', timeZone: 'America/New_York' });
    assert.deepEqual(w[1].body.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=7'], '10 times minus the 3 already gone');
    assert.equal(w[1].body.attendees.length, 2);

    // "Following" from the very first occurrence is the whole series.
    g.calls.length = 0;
    await G.updateEvent({ calendarId: 'me', id: FIRST.id, scope: 'following', title: 'Renamed' });
    assert.equal(g.writes().length, 1); assert.equal(g.writes()[0].path, '/calendars/me/events/series');
  } finally { g.restore(); }
});

test('deleting and replying', async () => {
  const g = fakeGoogle(ALL);
  try {
    await G.deleteEvent('me', INST.id);
    assert.deepEqual([g.writes()[0].method, g.writes()[0].path], ['DELETE', `/calendars/me/events/${INST.id}`]);
    g.calls.length = 0;
    await G.deleteEvent('me', INST.id, { scope: 'all', notify: true });
    assert.deepEqual([g.writes()[0].method, g.writes()[0].path, g.writes()[0].query.sendUpdates], ['DELETE', '/calendars/me/events/series', 'all']);
    g.calls.length = 0;
    await G.deleteEvent('me', INST.id, { scope: 'following' });
    assert.equal(g.writes()[0].method, 'PATCH'); assert.match(g.writes()[0].body.recurrence[0], /UNTIL=20261117T232959Z$/);
    g.calls.length = 0;
    await G.deleteEvent('me', FIRST.id, { scope: 'following' });
    assert.deepEqual([g.writes()[0].method, g.writes()[0].path], ['DELETE', '/calendars/me/events/series']);

    g.calls.length = 0;
    await G.respondToEvent({ calendarId: 'me', id: INST.id, status: 'accepted' });
    assert.deepEqual(g.writes()[0].body.attendees.map((a) => a.responseStatus), ['accepted', 'accepted']);
    await rejects(assert, () => G.respondToEvent({ calendarId: 'me', id: 'one', status: 'accepted' }), 400);   // not a guest
    await rejects(assert, () => G.respondToEvent({ calendarId: 'me', id: INST.id, status: 'perhaps' }), 400);
  } finally { g.restore(); }
});

test('reading one event gives the editor its repeat rule and what can be changed', async () => {
  const g = fakeGoogle(ALL);
  try {
    const e = await G.getEvent('me', INST.id);
    assert.equal(e.repeat, 'RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=10');
    assert.equal(e.recurring, true); assert.equal(e.firstOfSeries, false); assert.equal(e.canEdit, true);
    assert.equal(e.myStatus, 'needsAction');
    assert.deepEqual(e.guests.map((x) => x.email), ['mom@example.com', 'me@example.com']);
    assert.equal((await G.getEvent('me', FIRST.id)).firstOfSeries, true);
    assert.equal((await G.getEvent('school', 'one')).canEdit, false, 'read-only calendar');
  } finally { g.restore(); }
});
