import test from 'node:test';
import assert from 'node:assert/strict';
import { lib, rejects } from './helpers.mjs';

const { db } = await lib('db');
const T = await lib('tasks');
const { todayStr, addDays, dow } = await lib('dates');
const today = todayStr();
const q = await db();
const open = async () => (await T.snapshot()).tasks;
const backdate = (id, days, order = 0) => q.run('UPDATE tasks SET due_date = ?, day_order = ? WHERE id = ?', addDays(today, -days), order, id);

test('a new database has the Misc inbox and nothing else', async () => {
  const s = await T.snapshot();
  assert.deepEqual(s.projects.map((p) => p.name), ['Misc']);
  assert.equal(s.tasks.length, 0);
});

test('createTask from quick-add text', async () => {
  const t = await T.createTask({ text: 'Read ch 3 tomorrow p2 #School' });
  assert.equal(t.content, 'Read ch 3');
  assert.equal(t.priority, 2);
  assert.equal(t.due_date, addDays(today, 1));
  const school = (await T.snapshot()).projects.find((p) => p.name === 'School');
  assert.ok(school, 'a new #project is created');
  assert.equal(t.project_id, school.id);
  const again = await T.createTask({ text: 'Quiz prep #school' });
  assert.equal(again.project_id, school.id, 'and reused next time, whatever the capitals');
});

test('createTask falls back to Misc and to the given default date', async () => {
  const t = await T.createTask({ text: 'Loose end', due_date: today });
  assert.equal(t.project_id, 'inbox');
  assert.equal(t.due_date, today);
  const dated = await T.createTask({ text: 'Later thing friday', due_date: today });
  assert.equal(dow(dated.due_date), 5, 'a date typed in the text wins over the default');
});

test('createTask refuses empty or malformed input', async () => {
  await rejects(assert, () => T.createTask({ text: '   ' }), 400);
  await rejects(assert, () => T.createTask({}), 400);
  await rejects(assert, () => T.createTask({ content: 'x', due_date: 'next week' }), 400);
  await rejects(assert, () => T.createTask({ content: 'x', priority: 9 }), 400);
  await rejects(assert, () => T.createTask({ content: 'x', project_id: 'nope' }), 400);
});

test('new tasks go to the end of their day', async () => {
  const d = addDays(today, 5);
  const a = await T.createTask({ content: 'first', due_date: d });
  const b = await T.createTask({ content: 'second', due_date: d });
  assert.ok(b.day_order > a.day_order);
});

test('updateTask edits fields, validates, and 404s on unknown ids', async () => {
  const t = await T.createTask({ content: 'Edit me', due_date: today });
  const u = await T.updateTask(t.id, { content: 'Edited', priority: 1, description: 'notes', deadline: addDays(today, 2) });
  assert.equal(u.content, 'Edited'); assert.equal(u.priority, 1); assert.equal(u.description, 'notes'); assert.equal(u.deadline, addDays(today, 2));
  assert.equal((await T.updateTask(t.id, { deadline: '' })).deadline, null, 'empty string clears a field');
  await rejects(assert, () => T.updateTask(t.id, { content: '  ' }), 400);
  await rejects(assert, () => T.updateTask(t.id, { priority: 0 }), 400);
  await rejects(assert, () => T.updateTask(t.id, { due_date: '2026-13-40' }), 400);
  await rejects(assert, () => T.updateTask(t.id, { due_time: '25:99' }), 400);
  await rejects(assert, () => T.updateTask('missing', { content: 'x' }), 404);
  const same = await T.updateTask(t.id, { unknown_field: 1 });
  assert.equal(same.content, 'Edited', 'unknown fields are ignored');
});

test('clearing the date also clears time and repeat', async () => {
  const t = await T.createTask({ text: 'Water plants every day at 8am' });
  assert.equal(t.recurring, true);
  const u = await T.updateTask(t.id, { due_date: null });
  assert.equal(u.due_date, null); assert.equal(u.due_time, null); assert.equal(u.recurring, false); assert.equal(u.due_string, null);
});

test('moving a task to another day puts it last there', async () => {
  const d = addDays(today, 9);
  const a = await T.createTask({ content: 'already there', due_date: d });
  const t = await T.createTask({ content: 'mover', due_date: today });
  const u = await T.updateTask(t.id, { due_date: d });
  assert.ok(u.day_order > a.day_order);
});

test('rollover: unfinished past tasks move to the top of today, oldest first', async () => {
  const mine = await T.createTask({ content: 'already today', due_date: today });
  const old = await T.createTask({ content: 'three days late', due_date: today });
  const older = await T.createTask({ content: 'five days late', due_date: today });
  await backdate(old.id, 3); await backdate(older.id, 5);
  const moved = await T.rollover();
  assert.equal(moved, 2);
  const todays = (await open()).filter((t) => t.due_date === today).map((t) => t.content);
  assert.ok(todays.indexOf('five days late') < todays.indexOf('three days late'));
  assert.ok(todays.indexOf('three days late') < todays.indexOf('already today'));
  assert.equal(await T.rollover(), 0, 'running it again changes nothing');
  assert.equal((await q.get('SELECT COUNT(*) n FROM tasks WHERE completed_at IS NULL AND due_date < ?', today)).n, 0);
  for (const t of [mine, old, older]) await T.deleteTask(t.id);
});

test('completing a one-off task removes it and logs it', async () => {
  const t = await T.createTask({ content: 'One-off', due_date: today });
  const r = await T.completeTask(t.id);
  assert.equal(r.rescheduled, undefined);
  assert.ok(!(await open()).some((x) => x.id === t.id));
  assert.equal((await T.history(5))[0].content, 'One-off');
  await rejects(assert, () => T.completeTask('missing'), 404);
});

test('completing a parent completes its subtasks; undo brings them all back', async () => {
  const p = await T.createTask({ content: 'Parent', due_date: today });
  const kid = await T.createTask({ content: 'Kid', parent_id: p.id });
  const doneEarlier = await T.createTask({ content: 'Kid finished earlier', parent_id: p.id });
  await T.completeTask(doneEarlier.id);
  await new Promise((r) => setTimeout(r, 5));
  await T.completeTask(p.id);
  assert.ok(!(await open()).some((x) => [p.id, kid.id].includes(x.id)));
  await T.uncompleteTask(p.id);
  const ids = (await open()).map((x) => x.id);
  assert.ok(ids.includes(p.id) && ids.includes(kid.id), 'parent and its open subtask return');
  assert.ok(!ids.includes(doneEarlier.id), 'a subtask finished separately stays finished');
  assert.ok(!(await T.history(50)).some((h) => h.task_id === p.id), 'the log entry is removed');
});

test('completing a repeating task moves it forward and undo moves it back', async () => {
  const t = await T.createTask({ text: 'Workout every day' });
  const r = await T.completeTask(t.id);
  assert.equal(r.rescheduled, addDays(today, 1));
  assert.equal(r.task.completed_at, null, 'it stays open');
  const back = await T.uncompleteTask(t.id, today);
  assert.equal(back.due_date, today);
  await backdate(t.id, 4);
  assert.equal((await T.completeTask(t.id)).rescheduled, addDays(today, 1), 'missed days are not replayed');
});

test('a repeat it cannot read falls back to tomorrow instead of vanishing', async () => {
  const t = await T.createTask({ content: 'Odd one', due_date: today, due_string: 'every blue moon', recurring: 1 });
  const r = await T.completeTask(t.id);
  assert.equal(r.rescheduled, addDays(today, 1));
  assert.equal(r.understood, false);
});

test('deleting a task deletes its subtasks', async () => {
  const p = await T.createTask({ content: 'Doomed' });
  const k = await T.createTask({ content: 'Doomed kid', parent_id: p.id });
  await T.deleteTask(p.id);
  assert.equal(await T.getTask(p.id), undefined);
  assert.equal(await T.getTask(k.id), undefined);
});

test('reorder saves the new order and can move a task between days', async () => {
  const d1 = addDays(today, 20), d2 = addDays(today, 21);
  const a = await T.createTask({ content: 'a', due_date: d1 });
  const b = await T.createTask({ content: 'b', due_date: d1 });
  const c = await T.createTask({ text: 'c every day' });
  await T.reorder({ ids: [b.id, a.id], field: 'day_order' });
  const order = (await open()).filter((t) => t.due_date === d1).map((t) => t.content);
  assert.deepEqual(order, ['b', 'a']);
  await T.reorder({ ids: [c.id], field: 'day_order', moved: c.id, patch: { due_date: d2, content: 'hacked' } });
  const moved = await T.getTask(c.id);
  assert.equal(moved.due_date, d2);
  assert.equal(moved.content, 'c', 'only day, section and project can change in a drag');
  await T.reorder({ ids: [c.id], field: 'day_order', moved: c.id, patch: { due_date: null } });
  assert.equal((await T.getTask(c.id)).recurring, false, 'dropping on "No date" clears the repeat');
  await rejects(assert, () => T.reorder({ ids: [a.id], field: 'content' }), 400);
  await rejects(assert, () => T.reorder({ ids: 'nope', field: 'sort' }), 400);
});
