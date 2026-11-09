// Upper/lower split every other day (alternating) + posture every day.
import { db, tx, now, newId } from './db.js';
import { todayStr, addDays, diffDays } from './dates.js';

const other = (d) => (d === 'upper' ? 'lower' : 'upper');

// What to do today, based on the last lift.
export function plan(last, today = todayStr()) {
  let status, day, nextDate;
  if (!last) { status = 'due'; day = 'upper'; nextDate = today; }
  else if (last.date === today) { status = 'done'; day = last.day; nextDate = addDays(today, 2); }
  else if (diffDays(today, last.date) === 1) { status = 'rest'; day = other(last.day); nextDate = addDays(today, 1); }
  else { status = 'due'; day = other(last.day); nextDate = today; }
  const nextDay = status === 'done' ? other(last.day) : day;
  return { status, day, nextDay, nextDate, last: last || null };
}

export async function snapshot() {
  const q = await db();
  const today = todayStr();
  const [exercises, posture, postureLog, workouts, sets] = await Promise.all([
    q.all('SELECT * FROM exercises WHERE archived = 0 ORDER BY day, sort, name'),
    q.all('SELECT * FROM posture_steps WHERE archived = 0 ORDER BY sort, name'),
    q.all('SELECT date, step_id FROM posture_log WHERE date >= ?', addDays(today, -60)),
    q.all('SELECT * FROM workouts ORDER BY date DESC, created_at DESC'),
    q.all('SELECT * FROM workout_sets'),
  ]);
  const by = {};
  for (const s of sets) (by[s.workout_id] ||= []).push({ ...s, reps: s.reps ? JSON.parse(s.reps) : null });
  const history = workouts.map((w) => ({ ...w, sets: by[w.id] || [] }));
  // Most recent value per exercise, to prefill the next session.
  const last = {};
  for (const w of history) for (const s of w.sets) if (!last[s.exercise_id]) last[s.exercise_id] = { weight: s.weight, note: s.note, reps: s.reps, date: w.date };
  return { plan: plan(workouts[0], today), exercises, posture, postureLog, last, history, today };
}

export async function saveWorkout({ id, date, day, notes = '', sets = [] }) {
  if (!['upper', 'lower'].includes(day)) throw Object.assign(new Error('day must be upper or lower'), { status: 400 });
  return tx(async (q) => {
    const wid = id || newId();
    if (id) await q.run('UPDATE workouts SET date = ?, day = ?, notes = ? WHERE id = ?', date, day, notes, id);
    else await q.run('INSERT INTO workouts (id, date, day, notes, created_at) VALUES (?, ?, ?, ?, ?)', wid, date || todayStr(), day, notes, now());
    await q.run('DELETE FROM workout_sets WHERE workout_id = ?', wid);
    for (const s of sets) {
      const w = s.weight === '' || s.weight === null || s.weight === undefined ? null : Number(s.weight);
      if (w === null && !String(s.note || '').trim()) continue;
      const reps = Array.isArray(s.reps) && s.reps.some((r) => r !== null) ? JSON.stringify(s.reps.map((r) => (r === null || r === undefined ? null : Number(r)))) : null;
      await q.run('INSERT INTO workout_sets (workout_id, exercise_id, weight, note, reps) VALUES (?, ?, ?, ?, ?)', wid, s.exercise_id, Number.isFinite(w) ? w : null, String(s.note || '').trim(), reps);
    }
    return wid;
  });
}
export async function deleteWorkout(id) {
  await tx(async (q) => { await q.run('DELETE FROM workout_sets WHERE workout_id = ?', id); await q.run('DELETE FROM workouts WHERE id = ?', id); });
}

export async function togglePosture(date, stepId, done) {
  const q = await db();
  if (done) await q.run('INSERT OR IGNORE INTO posture_log (date, step_id) VALUES (?, ?)', date, stepId);
  else await q.run('DELETE FROM posture_log WHERE date = ? AND step_id = ?', date, stepId);
}

const EX_FIELDS = ['name', 'sets', 'reps', 'kind', 'sort', 'archived', 'day'];
export async function upsertExercise(e) {
  const q = await db();
  if (e.id) {
    for (const k of EX_FIELDS) if (k in e) await q.run(`UPDATE exercises SET ${k} = ? WHERE id = ?`, e[k], e.id);
    return e.id;
  }
  const id = newId();
  const { m } = await q.get('SELECT COALESCE(MAX(sort), 0) + 1 m FROM exercises WHERE day = ?', e.day);
  await q.run('INSERT INTO exercises (id, day, name, sets, reps, kind, sort) VALUES (?, ?, ?, ?, ?, ?, ?)', id, e.day, e.name, e.sets || null, e.reps || null, e.kind || 'weight', m);
  return id;
}
export async function upsertPostureStep(p) {
  const q = await db();
  if (p.id) { for (const k of ['name', 'sort', 'archived']) if (k in p) await q.run(`UPDATE posture_steps SET ${k} = ? WHERE id = ?`, p[k], p.id); return p.id; }
  const id = newId();
  const { m } = await q.get('SELECT COALESCE(MAX(sort), 0) + 1 m FROM posture_steps');
  await q.run('INSERT INTO posture_steps (id, name, sort) VALUES (?, ?, ?)', id, p.name, m);
  return id;
}
