import test from 'node:test';
import assert from 'node:assert/strict';
import { lib, rejects } from './helpers.mjs';
const M = await lib('memento');
const { db } = await lib('db');
const backdate = async (id, col, msAgo) => (await db()).run(`UPDATE mementos SET ${col} = ? WHERE id = ?`, new Date(Date.now() - msAgo).toISOString(), id);

test('a reminder waits, fires, locks, then can be answered', async () => {
  await rejects(assert, () => M.create({ text: '  ', in_minutes: 5 }), 400);
  await rejects(assert, () => M.create({ text: 'x', due_at: 'nonsense' }), 400);
  await rejects(assert, () => M.create({ text: 'x', due_at: '2020-01-01T00:00:00Z' }), 400);
  const m = await M.create({ text: 'Move the laundry', in_minutes: 30, lock_seconds: 240 });
  assert.equal(m.status, 'pending'); assert.equal(m.lock_seconds, 240);
  let s = await M.tick();
  assert.deepEqual(s.active, []); assert.equal(s.upcoming[0].id, m.id);

  await backdate(m.id, 'due_at', 1000);
  s = await M.tick();
  assert.equal(s.active.length, 1); assert.equal(s.active[0].locked, true);
  assert.ok(new Date(s.active[0].lock_until) - Date.now() > 230_000);
  assert.equal((await M.tick()).active[0].fired_at, s.active[0].fired_at, 'fires once, not on every check');

  // Locked: no "done", no "not yet", no cancelling.
  await rejects(assert, () => M.answer(m.id, 'done'), 423);
  await rejects(assert, () => M.answer(m.id, 'snooze'), 423);
  await rejects(assert, () => M.cancel(m.id), 409);

  // Time's up.
  await backdate(m.id, 'fired_at', 241_000);
  s = await M.tick();
  assert.equal(s.active[0].locked, false);
  await rejects(assert, () => M.answer(m.id, 'maybe'), 400);
  const back = await M.answer(m.id, 'snooze');
  assert.equal(back.status, 'pending'); assert.equal(back.snoozes, 1);
  assert.ok(new Date(back.due_at) - Date.now() > 9 * 60000, 'comes back in ten minutes');
  await backdate(m.id, 'due_at', 1000);
  await M.tick();
  await backdate(m.id, 'fired_at', 241_000);
  assert.equal((await M.answer(m.id, 'done')).status, 'done');
  assert.equal((await M.answer(m.id, 'done')).status, 'done', 'answering twice (two devices) is harmless');
  assert.deepEqual((await M.tick()).active, []);
  assert.equal((await M.recent())[0].id, m.id);
});

test('skip is the emergency exit; cancel works before it fires; long locks are capped', async () => {
  const a = await M.create({ text: 'Take out the trash', in_minutes: 0, lock_seconds: 99999 });
  assert.equal(a.lock_seconds, M.MAX_LOCK);
  await M.tick();
  assert.equal((await M.answer(a.id, 'skip')).status, 'skipped');
  const b = await M.create({ text: 'Later', in_minutes: 60 });
  await M.cancel(b.id);
  assert.deepEqual((await M.tick()).upcoming, []);
  await rejects(assert, () => M.answer('nope', 'done'), 404);
});

test('a reminder nobody answers is marked missed after 12 hours', async () => {
  const m = await M.create({ text: 'Forgotten', in_minutes: 0 });
  await M.tick();
  await backdate(m.id, 'fired_at', 13 * 3600_000);
  assert.deepEqual((await M.tick()).active, []);
  assert.equal((await M.recent()).find((x) => x.id === m.id).status, 'missed');
});

test('devices check in, and the test reminder fires at once without cluttering history', async () => {
  let d = await M.checkIn('MacBook Air');
  assert.deepEqual(d.map((x) => x.name), ['MacBook Air']);
  d = await M.checkIn('Mac mini');
  assert.deepEqual(d.map((x) => x.name).sort(), ['Mac mini', 'MacBook Air']);
  assert.equal((await M.checkIn('')).some((x) => x.name === 'A Mac on an older RemindMe'), true);
  const t = await M.createTest();
  const s = await M.tick();
  assert.equal(s.active.find((x) => x.id === t.id).locked, true);
  await M.answer(t.id, 'skip');
  assert.equal((await M.recent()).some((x) => x.id === t.id), false);
});
