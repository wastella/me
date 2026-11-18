import { handle, json, body } from '@/lib/http';
import { listEvents, getEvent, createEvent, updateEvent, deleteEvent, respondToEvent } from '@/lib/google';
import { withMeals } from '@/lib/meals';

// ?start&end lists events (add q to search); ?calendarId&id returns one in full.
export const GET = handle(async (req) => {
  const p = new URL(req.url).searchParams;
  if (p.get('id')) return json(await getEvent(p.get('calendarId') || 'primary', p.get('id')));
  return json(await withMeals(await listEvents(p.get('start'), p.get('end'), { q: p.get('q') || undefined })));
});
export const POST = handle(async (req) => json(await createEvent(await body(req)), 201));
// { rsvp: 'accepted' | 'declined' | 'tentative' } answers an invitation;
// anything else changes the event (scope: 'this' | 'following' | 'all').
export const PATCH = handle(async (req) => {
  const b = await body(req);
  if (b.rsvp) { await respondToEvent({ calendarId: b.calendarId, id: b.id, status: b.rsvp, scope: b.scope }); return json({ ok: true }); }
  return json(await updateEvent(b));
});
export const DELETE = handle(async (req) => {
  const p = new URL(req.url).searchParams;
  await deleteEvent(p.get('calendarId'), p.get('id'), { scope: p.get('scope') || 'this', notify: p.get('notify') === '1' });
  return json({ ok: true });
});
