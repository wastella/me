// Projects group tasks (every task has exactly one; "Misc" is the built-in
// inbox and can't be renamed or deleted). Sections split a project up.
import { db, tx, newId } from './db.js';
import { COLORS, nextColor } from './colors.js';

const fail = (status, msg) => Object.assign(new Error(msg), { status });
const cleanName = (name, what) => {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!n) throw fail(400, `Name the ${what}`);
  return n;
};
const norm = (s) => s.toLowerCase().replace(/[\s_-]+/g, '');

export async function createProject({ name, color } = {}) {
  name = cleanName(name, 'project');
  const q = await db();
  const all = await q.all('SELECT * FROM projects WHERE archived = 0');
  const existing = all.find((p) => norm(p.name) === norm(name));
  if (existing) return existing;   // same name again just returns the one you have
  const id = newId();
  await q.run('INSERT INTO projects (id, name, color, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM projects WHERE is_inbox = 0))', id, name, color in COLORS ? color : nextColor(all.filter((p) => !p.is_inbox).length));
  return q.get('SELECT * FROM projects WHERE id = ?', id);
}

export async function updateProject(id, patch = {}) {
  const q = await db();
  const p = await q.get('SELECT * FROM projects WHERE id = ?', id);
  if (!p) throw fail(404, 'That project no longer exists');
  if (p.is_inbox) throw fail(400, 'Misc can’t be changed');
  if ('name' in patch) await q.run('UPDATE projects SET name = ? WHERE id = ?', cleanName(patch.name, 'project'), id);
  if ('color' in patch && patch.color in COLORS) await q.run('UPDATE projects SET color = ? WHERE id = ?', patch.color, id);
  return q.get('SELECT * FROM projects WHERE id = ?', id);
}

// Deletes the project together with its sections and tasks.
export async function deleteProject(id) {
  return tx(async (q) => {
    const p = await q.get('SELECT is_inbox FROM projects WHERE id = ?', id);
    if (!p) return { deleted: 0 };
    if (p.is_inbox) throw fail(400, 'Misc can’t be deleted');
    const { changes } = await q.run('DELETE FROM tasks WHERE project_id = ?', id);
    await q.run('DELETE FROM sections WHERE project_id = ?', id);
    await q.run('DELETE FROM projects WHERE id = ?', id);
    return { deleted: changes };
  });
}

export async function createSection({ project_id, name } = {}) {
  name = cleanName(name, 'section');
  const q = await db();
  if (!(await q.get('SELECT id FROM projects WHERE id = ?', project_id))) throw fail(400, 'That project no longer exists');
  const id = newId();
  await q.run('INSERT INTO sections (id, project_id, name, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM sections WHERE project_id = ?))', id, project_id, name, project_id);
  return { id, project_id, name };
}

export async function updateSection(id, { name } = {}) {
  const q = await db();
  if (!(await q.get('SELECT id FROM sections WHERE id = ?', id))) throw fail(404, 'That section no longer exists');
  await q.run('UPDATE sections SET name = ? WHERE id = ?', cleanName(name, 'section'), id);
  return q.get('SELECT * FROM sections WHERE id = ?', id);
}

// Removing a section keeps its tasks; they move to the top of the project.
export async function deleteSection(id) {
  await tx(async (q) => {
    await q.run('UPDATE tasks SET section_id = NULL WHERE section_id = ?', id);
    await q.run('DELETE FROM sections WHERE id = ?', id);
  });
}
