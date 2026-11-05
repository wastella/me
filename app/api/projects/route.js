import { handle, json, body } from '@/lib/http';
import { db, newId } from '@/lib/db';
export const POST = handle(async (req) => {
  const b = await body(req);
  if (!b.name?.trim()) return json({ error: 'name required' }, 400);
  const id = newId();
  db().prepare('INSERT INTO projects (id, name, color, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort),0)+1 FROM projects))').run(id, b.name.trim(), b.color || 'charcoal');
  return json(db().prepare('SELECT * FROM projects WHERE id = ?').get(id), 201);
});
