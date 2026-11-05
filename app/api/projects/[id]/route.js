import { handle, json, body } from '@/lib/http';
import { db, tx } from '@/lib/db';
export const PATCH = handle(async (req, { params }) => {
  const b = await body(req);
  for (const k of ['name', 'color', 'is_favorite', 'archived']) {
    if (k in b) db().prepare(`UPDATE projects SET ${k} = ? WHERE id = ? AND is_inbox = 0`).run(b[k], params.id);
  }
  return json(db().prepare('SELECT * FROM projects WHERE id = ?').get(params.id));
});
export const DELETE = handle(async (_, { params }) => {
  tx((d) => {
    d.prepare('DELETE FROM tasks WHERE project_id = ?').run(params.id);
    d.prepare('DELETE FROM sections WHERE project_id = ?').run(params.id);
    d.prepare('DELETE FROM projects WHERE id = ? AND is_inbox = 0').run(params.id);
  });
  return json({ ok: true });
});
