import test from 'node:test';
import assert from 'node:assert/strict';
import { lib, rejects } from './helpers.mjs';
const Tr = await lib('training');
const { todayStr, addDays } = await lib('dates');
const today = todayStr();

test('plan: what today should be, from the last lift', () => {
  const T = '2026-11-14';
  assert.deepEqual(pick(Tr.plan(null, T)), { status: 'due', day: 'upper', nextDate: T });
  assert.deepEqual(pick(Tr.plan({ date: T, day: 'upper' }, T)), { status: 'done', day: 'upper', nextDate: '2026-11-16' });
  assert.equal(Tr.plan({ date: T, day: 'upper' }, T).nextDay, 'lower');
  assert.deepEqual(pick(Tr.plan({ date: '2026-11-13', day: 'upper' }, T)), { status: 'rest', day: 'lower', nextDate: '2026-11-15' });
  assert.deepEqual(pick(Tr.plan({ date: '2026-11-12', day: 'lower' }, T)), { status: 'due', day: 'upper', nextDate: T });
  assert.deepEqual(pick(Tr.plan({ date: '2026-10-01', day: 'lower' }, T)), { status: 'due', day: 'upper', nextDate: T });
});
const pick = ({ status, day, nextDate }) => ({ status, day, nextDate });

test('logging, editing and deleting a workout', async () => {
  const squat = await Tr.upsertExercise({ day: 'lower', name: 'Squat', sets: 3, reps: '5' });
  const abs = await Tr.upsertExercise({ day: 'lower', name: 'Abs', kind: 'note' });
  const skipped = await Tr.upsertExercise({ day: 'lower', name: 'RDL' });
  const id = await Tr.saveWorkout({ date: addDays(today, -2), day: 'lower', sets: [
    { exercise_id: squat, weight: '120' }, { exercise_id: abs, note: ' Plank ' }, { exercise_id: skipped, weight: '', note: '' }] });
  let s = await Tr.snapshot();
  assert.equal(s.history.length, 1);
  assert.equal(s.history[0].sets.length, 2, 'blank rows are not saved');
  assert.equal(s.last[squat].weight, 120);
  assert.equal(s.last[abs].note, 'Plank');
  assert.equal(s.plan.status, 'due'); assert.equal(s.plan.day, 'upper');
  await Tr.saveWorkout({ id, date: addDays(today, -2), day: 'lower', sets: [{ exercise_id: squat, weight: 125 }] });
  s = await Tr.snapshot();
  assert.equal(s.history.length, 1, 'editing does not duplicate');
  assert.equal(s.last[squat].weight, 125);
  assert.equal(s.history[0].sets.length, 1);
  await rejects(assert, () => Tr.saveWorkout({ day: 'legs', sets: [] }), 400);
  await rejects(assert, () => Tr.saveWorkout({ day: 'upper', date: 'yesterday', sets: [] }), 400);
  await rejects(assert, () => Tr.saveWorkout({ day: 'upper', sets: [{ exercise_id: squat, weight: -5 }] }), 400);
  await Tr.deleteWorkout(id);
  assert.equal((await Tr.snapshot()).history.length, 0);
});

test('bodyweight (0 lb) is a real logged value', async () => {
  const pull = await Tr.upsertExercise({ day: 'upper', name: 'Pullups' });
  const id = await Tr.saveWorkout({ date: today, day: 'upper', sets: [{ exercise_id: pull, weight: 0 }] });
  const s = await Tr.snapshot();
  assert.equal(s.last[pull].weight, 0);
  assert.equal(s.plan.status, 'done');
  await Tr.deleteWorkout(id);
});

test('routine: rename, archive keeps history, posture toggles', async () => {
  const id = await Tr.upsertExercise({ day: 'upper', name: 'Bench', sets: 3, reps: '5' });
  await Tr.upsertExercise({ id, name: 'Bench Press' });
  assert.equal((await Tr.snapshot()).exercises.find((e) => e.id === id).name, 'Bench Press');
  await rejects(assert, () => Tr.upsertExercise({ day: 'arms', name: 'Curl' }), 400);
  await rejects(assert, () => Tr.upsertExercise({ day: 'upper', name: ' ' }), 400);
  await Tr.upsertExercise({ id, archived: 1 });
  assert.ok(!(await Tr.snapshot()).exercises.some((e) => e.id === id));
  const step = await Tr.upsertPostureStep({ name: 'Wall angels' });
  await Tr.togglePosture(today, step, true);
  await Tr.togglePosture(today, step, true);
  assert.equal((await Tr.snapshot()).postureLog.filter((l) => l.step_id === step).length, 1, 'ticking twice counts once');
  await Tr.togglePosture(today, step, false);
  assert.equal((await Tr.snapshot()).postureLog.length, 0);
});
