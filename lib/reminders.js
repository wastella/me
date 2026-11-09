// What to notify about, checked every ~15 minutes. Each reminder is sent at
// most once per day (keys logged in kv).
import { kvGet, kvSet } from './db.js';
import { snapshot as taskSnapshot } from './tasks.js';
import { snapshot as trainingSnapshot } from './training.js';
import { todayStr } from './dates.js';
import { send } from './push.js';
import { TZ } from './env.js';

const nowHM = () => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
const mins = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const pretty = (hm) => { let [h, m] = hm.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`; };

export async function runReminders() {
  const today = todayStr();
  const t = mins(nowHM());
  const logKey = `push_log:${today}`;
  const sentKeys = new Set((await kvGet(logKey)) || []);
  const prefs = (await kvGet('push_prefs')) || { morning: true, tasks: true, lift: true, posture: true };
  const out = [];
  const once = async (key, msg) => { if (sentKeys.has(key)) return; if ((await send(msg)) > 0) { sentKeys.add(key); out.push(key); } };

  const [{ tasks }, tr] = await Promise.all([taskSnapshot(), trainingSnapshot()]);
  const due = tasks.filter((x) => x.due_date && x.due_date <= today && !x.parent_id);
  const lifted = tr.history.some((w) => w.date === today);
  const lift = tr.plan.status === 'due' && !lifted;

  // 7:00 morning rundown
  if (prefs.morning && t >= 7 * 60 && t < 10 * 60) {
    const bits = [`${due.length} task${due.length === 1 ? '' : 's'} today`];
    if (lift) bits.push(`${tr.plan.day} day`);
    await once('morning', { title: 'Good morning', body: bits.join(' · '), url: '/', tag: 'morning' });
  }
  // 15 minutes before timed tasks
  if (prefs.tasks) {
    for (const x of due.filter((x) => x.due_time)) {
      const at = mins(x.due_time);
      if (t >= at - 20 && t < at + 5) await once(`task:${x.id}:${x.due_time}`, { title: x.content, body: `Due at ${pretty(x.due_time)}`, url: '/tasks?view=today', tag: `task-${x.id}` });
    }
  }
  // 16:00 lift nudge
  if (prefs.lift && lift && t >= 16 * 60 && t < 21 * 60) {
    await once('lift', { title: `${tr.plan.day === 'upper' ? 'Upper' : 'Lower'} day`, body: 'Your lift isn’t logged yet.', url: '/training', tag: 'lift' });
  }
  // 20:00 posture reminder
  if (prefs.posture && t >= 20 * 60 && t < 23 * 60) {
    const done = new Set(tr.postureLog.filter((l) => l.date === today).map((l) => l.step_id));
    const left = tr.posture.filter((s) => !done.has(s.id)).length;
    if (left) await once('posture', { title: 'Posture routine', body: `${left} step${left === 1 ? '' : 's'} left today.`, url: '/training', tag: 'posture' });
  }
  if (out.length) await kvSet(logKey, [...sentKeys]);
  return { sent: out, time: nowHM() };
}
