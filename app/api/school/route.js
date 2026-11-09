import { handle, json, body } from '@/lib/http';
import { getConfig, addFeed, removeFeed, mapCourse, setClassroom, sync } from '@/lib/school';

// Feed links are private (anyone with one can read your course calendar), so
// only their hosts are sent to the page.
export const GET = handle(async () => {
  const c = await getConfig();
  return json({
    classroom: c.classroom, last_sync: c.last_sync || null, last_result: c.last_result || null,
    feeds: c.feeds.map((f) => ({ id: f.id, name: f.name, host: new URL(f.url).host })),
    courses: Object.entries(c.courses).map(([name, v]) => ({ name, project: v.project, source: v.source })).sort((a, b) => a.name.localeCompare(b.name)),
  });
});

// POST { action: 'add_feed' | 'remove_feed' | 'map' | 'classroom' | 'sync', ... }
export const POST = handle(async (req) => {
  const b = await body(req);
  if (b.action === 'add_feed') { await addFeed(b); return json(await sync()); }
  if (b.action === 'remove_feed') { await removeFeed(b.id); return json({ ok: true }); }
  if (b.action === 'map') { await mapCourse(b.course, b.project); return json({ ok: true }); }
  if (b.action === 'classroom') { await setClassroom(b.on); return json({ ok: true }); }
  if (b.action === 'sync') return json(await sync());
  return json({ error: 'unknown action' }, 400);
});
