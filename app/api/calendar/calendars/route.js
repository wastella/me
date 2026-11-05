import { handle, json, body } from '@/lib/http';
import { listCalendars } from '@/lib/google';
import { kvGet, kvSet } from '@/lib/db';
export const GET = handle(async () => json(await listCalendars()));
export const PATCH = handle(async (req) => {
  const { id, visible } = await body(req);
  const hidden = new Set(kvGet('hidden_calendars') || []);
  visible ? hidden.delete(id) : hidden.add(id);
  kvSet('hidden_calendars', [...hidden]);
  return json({ ok: true });
});
