import { handle, json, body } from '@/lib/http';
import { kvSet } from '@/lib/db';
export const PATCH = handle(async (req) => {
  const b = await body(req);
  if ('name' in b) kvSet('name', String(b.name || '').trim() || null);
  return json({ ok: true });
});
