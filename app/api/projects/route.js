import { handle, json, body } from '@/lib/http';
import { db, newId } from '@/lib/db';
export const POST = handle(async (req) => {
  const b = await body(req);
  if (!b.name?.trim()) return json({ error: 'name required' }, 400);
  const q = await db();
  const id = newId();
  await q.run('INSERT INTO projects (id, name, color, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort),0)+1 FROM projects WHERE is_inbox = 0))', id, b.name.trim(), b.color || 'charcoal');
  return json(await q.get('SELECT * FROM projects WHERE id = ?', id), 201);
});
