// RemindMe: reminders that take over the screen. When one comes due it
// "fires": every device shows it full-screen, and for lock_seconds (how long
// the thing takes to go and do) it can't be dismissed. After that you answer
// Done or Not yet. The server's clock decides everything, so all devices
// lock and unlock together.
import { db, kvGet, kvSet, now, newId } from './db.js';
import { send } from './push.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
export const MAX_LOCK = 60 * 60;            // never hold the screen longer than an hour
const MISSED_AFTER = 12 * 3600_000;         // an unanswered reminder gives up after 12 hours
const SNOOZE_MIN = 10;

const shape = (m, t = Date.now()) => {
  const lockUntil = m.fired_at ? new Date(m.fired_at).getTime() + m.lock_seconds * 1000 : null;
  return {
    id: m.id, text: m.text, due_at: m.due_at, lock_seconds: m.lock_seconds, status: m.status, snoozes: m.snoozes,
    fired_at: m.fired_at || undefined, ended_at: m.ended_at || undefined,
    lock_until: lockUntil ? new Date(lockUntil).toISOString() : undefined,
    locked: m.status === 'firing' && lockUntil > t,
  };
};

export async function create({ text, due_at, in_minutes, lock_seconds = 0, source }) {
  text = String(text || '').trim().slice(0, 200);
  if (!text) throw bad('Say what to be reminded of.');
  let due;
  if (in_minutes !== undefined && in_minutes !== null) due = new Date(Date.now() + Math.max(0, Number(in_minutes) || 0) * 60000);
  else due = new Date(due_at);
  if (Number.isNaN(due.getTime())) throw bad('Say when to be reminded.');
  if (due.getTime() < Date.now() - 60_000) throw bad('That time has already passed.');
  const lock = Math.max(0, Math.min(MAX_LOCK, Math.round(Number(lock_seconds) || 0)));
  const m = { id: newId(), text, due_at: due.toISOString(), lock_seconds: lock, status: 'pending', fired_at: null, ended_at: null, snoozes: 0, created_at: now(), source: source || null };
  await (await db()).run('INSERT INTO mementos (id, text, due_at, lock_seconds, status, snoozes, created_at, source) VALUES (?, ?, ?, ?, ?, 0, ?, ?)', m.id, m.text, m.due_at, m.lock_seconds, m.status, m.created_at, m.source);
  return shape(m);
}

// Fires anything that has come due (telling the phone), retires anything left
// unanswered for too long, and returns what should be on screen now.
export async function tick() {
  const q = await db();
  const t = Date.now(), iso = new Date(t).toISOString();
  for (const m of await q.all("SELECT * FROM mementos WHERE status = 'pending' AND due_at <= ?", iso)) {
    // Only the first device to notice it fires it (and sends the push).
    const { changes } = await q.run("UPDATE mementos SET status = 'firing', fired_at = ? WHERE id = ? AND status = 'pending'", iso, m.id);
    if (changes) await send({ title: 'RemindMe', body: m.text, url: '/remindme', tag: `memento-${m.id}` }).catch(() => 0);
  }
  await q.run("UPDATE mementos SET status = 'missed', ended_at = ? WHERE status = 'firing' AND fired_at <= ?", iso, new Date(t - MISSED_AFTER).toISOString());
  const active = (await q.all("SELECT * FROM mementos WHERE status = 'firing' ORDER BY fired_at")).map((m) => shape(m, t));
  const upcoming = (await q.all("SELECT * FROM mementos WHERE status = 'pending' ORDER BY due_at LIMIT 20")).map((m) => shape(m, t));
  return { now: iso, active, upcoming };
}

export async function recent(limit = 20) {
  return (await (await db()).all("SELECT * FROM mementos WHERE status IN ('done', 'skipped', 'missed') AND COALESCE(source, '') != 'test' ORDER BY ended_at DESC LIMIT ?", limit)).map((m) => shape(m));
}

// Each Mac says who it is when it checks in, so you can see that every device
// is really connected. Saved at most once a minute per device.
export async function checkIn(name) {
  name = String(name || '').trim().slice(0, 60) || 'A Mac on an older RemindMe';
  const all = (await kvGet('memento_devices')) || {};
  const t = Date.now();
  if (!all[name] || t - new Date(all[name]).getTime() > 60_000) {
    for (const k of Object.keys(all)) if (t - new Date(all[k]).getTime() > 14 * 86400_000) delete all[k];
    all[name] = new Date(t).toISOString();
    await kvSet('memento_devices', all);
  }
  return Object.entries(all).map(([device, seen]) => ({ name: device, seen })).sort((a, b) => b.seen.localeCompare(a.seen));
}

// The app's test button: a real reminder, right now, on every device.
export const TEST_LOCK = 15;
export const createTest = () => create({ text: 'Test: this should be on every Mac', in_minutes: 0, lock_seconds: TEST_LOCK, source: 'test' });

/* Answer a reminder that's on screen:
     done   – you did it (only once the lock time is up)
     snooze – not yet: it comes back in 10 minutes and locks again (same rule)
     skip   – the emergency way out, allowed any time and recorded as skipped */
export async function answer(id, action) {
  const q = await db();
  const m = await q.get('SELECT * FROM mementos WHERE id = ?', id);
  if (!m) throw bad('That reminder no longer exists.', 404);
  if (m.status !== 'firing') return shape(m);   // already answered on another device
  const t = Date.now(), iso = new Date(t).toISOString();
  const locked = new Date(m.fired_at).getTime() + m.lock_seconds * 1000 > t;
  if (action === 'skip') await q.run("UPDATE mementos SET status = 'skipped', ended_at = ? WHERE id = ?", iso, id);
  else if (locked) throw bad('Not until the time is up.', 423);
  else if (action === 'done') await q.run("UPDATE mementos SET status = 'done', ended_at = ? WHERE id = ?", iso, id);
  else if (action === 'snooze') await q.run("UPDATE mementos SET status = 'pending', due_at = ?, fired_at = NULL, snoozes = snoozes + 1 WHERE id = ?", new Date(t + SNOOZE_MIN * 60000).toISOString(), id);
  else throw bad('Answer done, snooze or skip.');
  return shape(await q.get('SELECT * FROM mementos WHERE id = ?', id));
}

// Reminders can be cancelled until they fire; after that they must be answered.
export async function cancel(id) {
  const { changes } = await (await db()).run("DELETE FROM mementos WHERE id = ? AND status = 'pending'", id);
  if (!changes) throw bad('That reminder has already gone off (or doesn’t exist), so it can’t be cancelled.', 409);
}
