import { handle, json, body } from '@/lib/http';
import { db, newId } from '@/lib/db';
export const POST = handle(async (req) => {
  const b = await body(req);
  const id = newId();
  db().prepare('INSERT INTO sections (id, project_id, name, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort),0)+1 FROM sections WHERE project_id = ?))').run(id, b.project_id, b.name, b.project_id);
  return json({ id }, 201);
});
