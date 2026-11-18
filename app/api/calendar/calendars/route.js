import { handle, json, body } from '@/lib/http';
import { listCalendars, createCalendar, updateCalendar, removeCalendar } from '@/lib/google';
import { kvGet, kvSet } from '@/lib/db';
export const GET = handle(async () => json(await listCalendars()));
export const POST = handle(async (req) => json(await createCalendar(await body(req)), 201));
// visible shows/hides it in Me; name and color change it in Google too.
export const PATCH = handle(async (req) => {
  const { id, visible, name, color } = await body(req);
  if (visible !== undefined) {
    const hidden = new Set((await kvGet('hidden_calendars')) || []);
    visible ? hidden.delete(id) : hidden.add(id);
    await kvSet('hidden_calendars', [...hidden]);
  }
  if (name !== undefined || color) await updateCalendar({ id, name, color });
  return json({ ok: true });
});
export const DELETE = handle(async (req) => { await removeCalendar(new URL(req.url).searchParams.get('id')); return json({ ok: true }); });
