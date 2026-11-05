import { db, tx, now, newId } from './db.js';
import { nextDue, todayStr } from './dates.js';
import { quickAdd } from './quickadd.js';

const rowToTask = (r) => r && ({ ...r, labels: JSON.parse(r.labels || '[]'), recurring: !!r.recurring });

export function snapshot() {
  const d = db();
  return {
    projects: d.prepare('SELECT * FROM projects WHERE archived = 0 ORDER BY is_inbox, sort, name').all(),
    sections: d.prepare('SELECT * FROM sections ORDER BY sort, name').all(),
    labels: d.prepare('SELECT * FROM labels ORDER BY sort, name').all(),
    tasks: d.prepare('SELECT * FROM tasks WHERE completed_at IS NULL ORDER BY sort, created_at').all().map(rowToTask),
  };
}

export const getTask = (id) => rowToTask(db().prepare('SELECT * FROM tasks WHERE id = ?').get(id));

const FIELDS = ['project_id', 'section_id', 'parent_id', 'content', 'description', 'priority', 'due_date', 'due_time', 'due_string', 'recurring', 'deadline', 'duration_min', 'labels', 'sort'];

function ensureLabels(names) {
  const ins = db().prepare('INSERT OR IGNORE INTO labels (id, name) VALUES (?, ?)');
  for (const n of names) ins.run(newId(), n);
}

export function createTask(input) {
  return tx((d) => {
    let t = { ...input };
    if (input.text) {
      const s = snapshot();
      t = { ...quickAdd(input.text, s), ...stripUndef({ project_id: input.project_id, section_id: input.section_id, parent_id: input.parent_id }) };
      if (t.newProject && !t.project_id) {
        const id = newId();
        d.prepare('INSERT INTO projects (id, name, sort) VALUES (?, ?, 999)').run(id, t.newProject);
        t.project_id = id;
      }
      if (input.due_date && !t.due_date) t.due_date = input.due_date;
    }
    if (!t.content?.trim()) throw new Error('Task needs a name');
    const inbox = d.prepare('SELECT id FROM projects WHERE is_inbox = 1').get().id;
    const labels = [];
    const maxSort = d.prepare('SELECT COALESCE(MAX(sort), 0) m FROM tasks WHERE project_id = ?').get(t.project_id || inbox).m;
    const id = newId();
    d.prepare(`INSERT INTO tasks (id, project_id, section_id, parent_id, content, description, priority, due_date, due_time,
      due_string, recurring, deadline, duration_min, labels, sort, created_at, updated_at, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'me')`).run(
      id, t.project_id || inbox, t.section_id || null, t.parent_id || null, t.content.trim(), t.description || '',
      t.priority || 4, t.due_date || null, t.due_time || null, t.due_string || null, t.recurring ? 1 : 0,
      t.deadline || null, t.duration_min || null, JSON.stringify(labels), maxSort + 1, now(), now());
    return getTask(id);
  });
}

export function updateTask(id, patch) {
  const sets = []; const vals = [];
  for (const k of FIELDS) {
    if (!(k in patch)) continue;
    let v = patch[k];
    if (k === 'labels') { ensureLabels(v); v = JSON.stringify(v); }
    if (k === 'recurring') v = v ? 1 : 0;
    if (v === '') v = k === 'description' ? '' : null;
    sets.push(`${k} = ?`); vals.push(v ?? null);
  }
  // Clearing the date clears recurrence too.
  if ('due_date' in patch && !patch.due_date) { sets.push('due_time = NULL', 'due_string = NULL', 'recurring = 0'); }
  if (sets.length) db().prepare(`UPDATE tasks SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...vals, now(), id);
  return getTask(id);
}

// Completing a recurring task logs it and moves it to the next date.
export function completeTask(id) {
  return tx((d) => {
    const t = getTask(id);
    if (!t) throw new Error('Not found');
    const at = now();
    d.prepare('INSERT INTO completions (task_id, content, project_id, completed_at) VALUES (?, ?, ?, ?)').run(id, t.content, t.project_id, at);
    if (t.recurring && t.due_string) {
      const n = nextDue(t.due_string, t.due_date, todayStr());
      d.prepare('UPDATE tasks SET due_date = ?, updated_at = ? WHERE id = ?').run(n.date, at, id);
      return { task: getTask(id), rescheduled: n.date, understood: n.understood };
    }
    d.prepare('UPDATE tasks SET completed_at = ? WHERE id = ? OR parent_id = ?').run(at, id, id);
    return { task: getTask(id) };
  });
}

export function uncompleteTask(id, previousDue) {
  return tx((d) => {
    const last = d.prepare('SELECT id FROM completions WHERE task_id = ? ORDER BY completed_at DESC LIMIT 1').get(id);
    if (last) d.prepare('DELETE FROM completions WHERE id = ?').run(last.id);
    d.prepare('UPDATE tasks SET completed_at = NULL, due_date = COALESCE(?, due_date), updated_at = ? WHERE id = ?').run(previousDue || null, now(), id);
    return getTask(id);
  });
}

export function deleteTask(id) {
  db().prepare('DELETE FROM tasks WHERE id = ? OR parent_id = ?').run(id, id);
}

export function history(limit = 200) {
  return db().prepare(`SELECT c.*, p.name project, p.color FROM completions c LEFT JOIN projects p ON p.id = c.project_id
    ORDER BY c.completed_at DESC LIMIT ?`).all(limit);
}

export function stats() {
  const d = db();
  const today = todayStr();
  const byDay = d.prepare(`SELECT substr(datetime(completed_at, 'localtime'), 1, 10) day, COUNT(*) n FROM completions
    WHERE completed_at >= datetime('now', '-30 days') GROUP BY day`).all();
  return {
    completedToday: byDay.find((r) => r.day === today)?.n || 0,
    last30: byDay,
    overdue: d.prepare('SELECT COUNT(*) n FROM tasks WHERE completed_at IS NULL AND due_date < ?').get(today).n,
    dueToday: d.prepare('SELECT COUNT(*) n FROM tasks WHERE completed_at IS NULL AND due_date = ?').get(today).n,
  };
}

const stripUndef = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));
