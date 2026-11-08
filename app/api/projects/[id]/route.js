import { handle, json, body } from '@/lib/http';
import { db, tx } from '@/lib/db';
export const PATCH = handle(async (req, { params }) => {
  const b = await body(req);
  const q = await db();
  for (const k of ['name', 'color', 'is_favorite', 'archived']) {
    if (k in b) await q.run(`UPDATE projects SET ${k} = ? WHERE id = ? AND is_inbox = 0`, b[k], params.id);
  }
  return json(await q.get('SELECT * FROM projects WHERE id = ?', params.id));
});
export const DELETE = handle(async (_, { params }) => {
  await tx(async (q) => {
    if ((await q.get('SELECT is_inbox FROM projects WHERE id = ?', params.id))?.is_inbox) return;
    await q.run('DELETE FROM tasks WHERE project_id = ?', params.id);
    await q.run('DELETE FROM sections WHERE project_id = ?', params.id);
    await q.run('DELETE FROM projects WHERE id = ?', params.id);
  });
  return json({ ok: true });
});
