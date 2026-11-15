import { handle, json, body } from '@/lib/http';
import { listEvents, createEvent, updateEvent, deleteEvent } from '@/lib/google';
export const GET = handle(async (req) => {
  const u = new URL(req.url);
  return json(await listEvents(u.searchParams.get('start'), u.searchParams.get('end')));
});
export const POST = handle(async (req) => json(await createEvent(await body(req)), 201));
export const PATCH = handle(async (req) => { await updateEvent(await body(req)); return json({ ok: true }); });
export const DELETE = handle(async (req) => {
  const u = new URL(req.url);
  await deleteEvent(u.searchParams.get('calendarId'), u.searchParams.get('id'));
  return json({ ok: true });
});
