import { db, tx, now, newId } from './db.js';
import { nextDue, todayStr, isDate, isTime } from './dates.js';
import { quickAdd } from './quickadd.js';
import { nextColor } from './colors.js';

const fail = (status, msg) => Object.assign(new Error(msg), { status });

// Rejects values that would leave a task in a state the app can't show.
function validate(t) {
  if ('content' in t && !String(t.content ?? '').trim()) throw fail(400, 'Task needs a name');
  if (t.priority != null && t.priority !== '' && ![1, 2, 3, 4].includes(Number(t.priority))) throw fail(400, 'Priority must be 1 to 4');
  for (const k of ['due_date', 'deadline']) if (t[k] != null && t[k] !== '' && !isDate(t[k])) throw fail(400, `${k === 'deadline' ? 'Deadline' : 'Date'} must look like 2026-01-31`);
  if (t.due_time != null && t.due_time !== '' && !isTime(t.due_time)) throw fail(400, 'Time must look like 14:30');
}

const rowToTask = (r) => r && ({ ...r, labels: JSON.parse(r.labels || '[]'), recurring: !!r.recurring });

// Nothing is ever overdue: anything unfinished from an earlier day moves to
// the top of today, keeping the order it had.
export async function rollover() {
  const today = todayStr();
  const late = await (await db()).all('SELECT id FROM tasks WHERE completed_at IS NULL AND due_date < ? ORDER BY due_date, day_order, created_at', today);
  if (!late.length) return 0;
  await tx(async (q) => {
    const { m } = await q.get('SELECT COALESCE(MIN(day_order), 0) m FROM tasks WHERE completed_at IS NULL AND due_date = ?', today);
    for (let i = 0; i < late.length; i++) await q.run('UPDATE tasks SET due_date = ?, day_order = ?, updated_at = ? WHERE id = ?', today, m - late.length + i, now(), late[i].id);
  });
  return late.length;
}

const nextDayOrder = async (q, date) => (date ? (await q.get('SELECT COALESCE(MAX(day_order), 0) + 1 m FROM tasks WHERE completed_at IS NULL AND due_date = ?', date)).m : 0);

export async function snapshot() {
  await rollover();
  const q = await db();
  const [projects, sections, tasks] = await Promise.all([
    q.all('SELECT * FROM projects WHERE archived = 0 ORDER BY is_inbox, sort, name'),
    q.all('SELECT * FROM sections ORDER BY sort, name'),
    q.all('SELECT * FROM tasks WHERE completed_at IS NULL ORDER BY due_date, day_order, sort, created_at'),
  ]);
  return { projects, sections, labels: [], tasks: tasks.map(rowToTask) };
}

export const getTask = async (id, q) => rowToTask(await (q || await db()).get('SELECT * FROM tasks WHERE id = ?', id));

const FIELDS = ['project_id', 'section_id', 'parent_id', 'content', 'description', 'priority', 'due_date', 'due_time', 'due_string', 'recurring', 'deadline', 'duration_min', 'sort', 'day_order'];

export async function createTask(input) {
  let t = { ...input };
  if (input.text) {
    const projects = await (await db()).all('SELECT id, name FROM projects WHERE archived = 0');
    t = { ...quickAdd(input.text, { projects }), ...stripUndef({ project_id: input.project_id, section_id: input.section_id, parent_id: input.parent_id }) };
    if (input.due_date && !t.due_date) t.due_date = input.due_date;
  }
  if (!String(t.content ?? '').trim()) throw fail(400, 'Task needs a name');
  validate(t);
  const id = newId();
  await tx(async (q) => {
    if (t.project_id && !(await q.get('SELECT id FROM projects WHERE id = ?', t.project_id))) throw fail(400, 'That project no longer exists');
    if (t.newProject && !t.project_id) {
      t.project_id = newId();
      const { n } = await q.get('SELECT COUNT(*) n FROM projects WHERE is_inbox = 0');
      await q.run('INSERT INTO projects (id, name, color, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM projects WHERE is_inbox = 0))', t.project_id, String(t.newProject).slice(0, 60), nextColor(n));
    }
    const inbox = (await q.get('SELECT id FROM projects WHERE is_inbox = 1')).id;
    const { m: maxSort } = await q.get('SELECT COALESCE(MAX(sort), 0) m FROM tasks WHERE project_id = ?', t.project_id || inbox);
    await q.run(`INSERT INTO tasks (id, project_id, section_id, parent_id, content, description, priority, due_date, due_time,
      due_string, recurring, deadline, duration_min, labels, sort, day_order, created_at, updated_at, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, 'me')`,
      id, t.project_id || inbox, t.section_id || null, t.parent_id || null, String(t.content).trim(), t.description || '',
      Number(t.priority) || 4, t.due_date || null, t.due_time || null, t.due_string || null, t.recurring ? 1 : 0,
      t.deadline || null, t.duration_min || null, maxSort + 1, await nextDayOrder(q, t.due_date), now(), now());
  });
  return getTask(id);
}

export async function updateTask(id, patch = {}) {
  const q = await db();
  if (!(await q.get('SELECT id FROM tasks WHERE id = ?', id))) throw fail(404, 'That task no longer exists');
  validate(patch);
  if ('content' in patch) patch = { ...patch, content: String(patch.content).trim() };
  // Moving to another day puts the task at the end of that day.
  if (patch.due_date && !('day_order' in patch)) {
    const cur = await q.get('SELECT due_date FROM tasks WHERE id = ?', id);
    if (cur && cur.due_date !== patch.due_date) patch = { ...patch, day_order: await nextDayOrder(q, patch.due_date) };
  }
  const sets = []; const vals = [];
  for (const k of FIELDS) {
    if (!(k in patch)) continue;
    let v = patch[k];
    if (k === 'recurring') v = v ? 1 : 0;
    if (v === '') v = k === 'description' ? '' : null;
    sets.push(`${k} = ?`); vals.push(v ?? null);
  }
  // Clearing the date clears recurrence too.
  if ('due_date' in patch && !patch.due_date) sets.push('due_time = NULL', 'due_string = NULL', 'recurring = 0');
  if (sets.length) await q.run(`UPDATE tasks SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...vals, now(), id);
  return getTask(id);
}

// Completing a recurring task logs it and moves it to the next date.
export async function completeTask(id) {
  return tx(async (q) => {
    const t = await getTask(id, q);
    if (!t) throw fail(404, 'That task no longer exists');
    const at = now();
    await q.run('INSERT INTO completions (task_id, content, project_id, completed_at) VALUES (?, ?, ?, ?)', id, t.content, t.project_id, at);
    if (t.recurring && t.due_string) {
      const n = nextDue(t.due_string, t.due_date, todayStr());
      await q.run('UPDATE tasks SET due_date = ?, day_order = ?, updated_at = ? WHERE id = ?', n.date, await nextDayOrder(q, n.date), at, id);
      return { task: await getTask(id, q), rescheduled: n.date, understood: n.understood };
    }
    // Subtasks still open are finished with it (same timestamp, so undo can find them).
    await q.run('UPDATE tasks SET completed_at = ? WHERE id = ? OR (parent_id = ? AND completed_at IS NULL)', at, id, id);
    return { task: await getTask(id, q) };
  });
}

export async function uncompleteTask(id, previousDue) {
  return tx(async (q) => {
    const last = await q.get('SELECT id FROM completions WHERE task_id = ? ORDER BY completed_at DESC LIMIT 1', id);
    if (last) await q.run('DELETE FROM completions WHERE id = ?', last.id);
    const cur = await q.get('SELECT completed_at FROM tasks WHERE id = ?', id);
    if (!cur) throw fail(404, 'That task no longer exists');
    if (cur.completed_at) await q.run('UPDATE tasks SET completed_at = NULL WHERE parent_id = ? AND completed_at = ?', id, cur.completed_at);
    await q.run('UPDATE tasks SET completed_at = NULL, due_date = COALESCE(?, due_date), updated_at = ? WHERE id = ?', isDate(previousDue) ? previousDue : null, now(), id);
    return getTask(id, q);
  });
}

export async function deleteTask(id) {
  await (await db()).run('DELETE FROM tasks WHERE id = ? OR parent_id = ?', id, id);
}

export async function history(limit = 200) {
  return (await db()).all(`SELECT c.*, p.name project, p.color FROM completions c LEFT JOIN projects p ON p.id = c.project_id
    ORDER BY c.completed_at DESC LIMIT ?`, limit);
}

const stripUndef = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));

// Drag-and-drop: `ids` is the new order of one list (a day or a section).
// The dragged task can also change day/section/project on the way.
export async function reorder({ ids, field, moved, patch = {} }) {
  if (!['day_order', 'sort'].includes(field)) throw fail(400, 'Unknown ordering');
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) throw fail(400, 'Order must be a list of task ids');
  if (patch?.due_date && !isDate(patch.due_date)) throw fail(400, 'Date must look like 2026-01-31');
  return tx(async (q) => {
    if (moved) {
      const allowed = Object.entries(patch || {}).filter(([k]) => ['due_date', 'section_id', 'project_id'].includes(k));
      for (const [k, v] of allowed) await q.run(`UPDATE tasks SET ${k} = ?, updated_at = ? WHERE id = ?`, v ?? null, now(), moved);
      if (allowed.some(([k, v]) => k === 'due_date' && !v)) await q.run('UPDATE tasks SET due_time = NULL, due_string = NULL, recurring = 0 WHERE id = ?', moved);
    }
    for (let i = 0; i < ids.length; i++) await q.run(`UPDATE tasks SET ${field} = ? WHERE id = ?`, i, ids[i]);
    return true;
  });
}
