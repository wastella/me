// Upper/lower split every other day (alternating) + posture every day.
import { db, tx, now, newId } from './db.js';
import { todayStr, addDays, diffDays } from './dates.js';

const other = (d) => (d === 'upper' ? 'lower' : 'upper');

export function exercises(includeArchived = false) {
  return db().prepare(`SELECT * FROM exercises ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY day, sort, name`).all();
}
export const postureSteps = () => db().prepare('SELECT * FROM posture_steps WHERE archived = 0 ORDER BY sort, name').all();

// What to do today, based on the last lift.
export function plan(today = todayStr()) {
  const last = db().prepare('SELECT * FROM workouts ORDER BY date DESC, created_at DESC LIMIT 1').get();
  let status, day, nextDate;
  if (!last) { status = 'due'; day = 'upper'; nextDate = today; }
  else if (last.date === today) { status = 'done'; day = last.day; nextDate = addDays(today, 2); }
  else if (diffDays(today, last.date) === 1) { status = 'rest'; day = other(last.day); nextDate = addDays(today, 1); }
  else { status = 'due'; day = other(last.day); nextDate = today; }
  const nextDay = status === 'done' ? other(last.day) : day;
  return { status, day, nextDay, nextDate, last: last || null };
}

// Most recent value logged for each exercise (to prefill the next session).
export function lastValues() {
  const rows = db().prepare(`SELECT s.exercise_id, s.weight, s.note, w.date FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
    ORDER BY w.date DESC, w.created_at DESC`).all();
  const out = {};
  for (const r of rows) if (!out[r.exercise_id]) out[r.exercise_id] = { weight: r.weight, note: r.note, date: r.date };
  return out;
}

export function history() {
  const ws = db().prepare('SELECT * FROM workouts ORDER BY date DESC, created_at DESC').all();
  const sets = db().prepare('SELECT * FROM workout_sets').all();
  const by = {};
  for (const s of sets) (by[s.workout_id] ||= []).push(s);
  return ws.map((w) => ({ ...w, sets: by[w.id] || [] }));
}

export function postureLog(days = 60) {
  return db().prepare('SELECT date, step_id FROM posture_log WHERE date >= ?').all(addDays(todayStr(), -days));
}

export function snapshot() {
  return { plan: plan(), exercises: exercises(), posture: postureSteps(), postureLog: postureLog(), last: lastValues(), history: history(), today: todayStr() };
}

export function saveWorkout({ id, date, day, notes = '', sets = [] }) {
  if (!['upper', 'lower'].includes(day)) throw Object.assign(new Error('day must be upper or lower'), { status: 400 });
  return tx((d) => {
    const wid = id || newId();
    if (id) d.prepare('UPDATE workouts SET date = ?, day = ?, notes = ? WHERE id = ?').run(date, day, notes, id);
    else d.prepare('INSERT INTO workouts (id, date, day, notes, created_at) VALUES (?, ?, ?, ?, ?)').run(wid, date || todayStr(), day, notes, now());
    d.prepare('DELETE FROM workout_sets WHERE workout_id = ?').run(wid);
    const ins = d.prepare('INSERT INTO workout_sets (workout_id, exercise_id, weight, note) VALUES (?, ?, ?, ?)');
    for (const s of sets) {
      const w = s.weight === '' || s.weight === null || s.weight === undefined ? null : Number(s.weight);
      if (w === null && !String(s.note || '').trim()) continue;
      ins.run(wid, s.exercise_id, Number.isFinite(w) ? w : null, String(s.note || '').trim());
    }
    return wid;
  });
}
export function deleteWorkout(id) {
  tx((d) => { d.prepare('DELETE FROM workout_sets WHERE workout_id = ?').run(id); d.prepare('DELETE FROM workouts WHERE id = ?').run(id); });
}

export function togglePosture(date, stepId, done) {
  if (done) db().prepare('INSERT OR IGNORE INTO posture_log (date, step_id) VALUES (?, ?)').run(date, stepId);
  else db().prepare('DELETE FROM posture_log WHERE date = ? AND step_id = ?').run(date, stepId);
}

export function upsertExercise(e) {
  if (e.id) {
    for (const k of ['name', 'sets', 'reps', 'kind', 'sort', 'archived', 'day']) if (k in e) db().prepare(`UPDATE exercises SET ${k} = ? WHERE id = ?`).run(e[k], e.id);
    return e.id;
  }
  const id = newId();
  const sort = db().prepare('SELECT COALESCE(MAX(sort), 0) + 1 m FROM exercises WHERE day = ?').get(e.day).m;
  db().prepare('INSERT INTO exercises (id, day, name, sets, reps, kind, sort) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, e.day, e.name, e.sets || null, e.reps || null, e.kind || 'weight', sort);
  return id;
}
export function upsertPostureStep(p) {
  if (p.id) { for (const k of ['name', 'sort', 'archived']) if (k in p) db().prepare(`UPDATE posture_steps SET ${k} = ? WHERE id = ?`).run(p[k], p.id); return p.id; }
  const id = newId();
  const sort = db().prepare('SELECT COALESCE(MAX(sort), 0) + 1 m FROM posture_steps').get().m;
  db().prepare('INSERT INTO posture_steps (id, name, sort) VALUES (?, ?, ?)').run(id, p.name, sort);
  return id;
}
