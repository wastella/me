import { handle, json, body } from '@/lib/http';
import { kvGet, kvSet } from '@/lib/db';
export const PATCH = handle(async (req) => {
  const b = await body(req);
  if ('name' in b) await kvSet('name', String(b.name || '').trim() || null);
  if ('googleClientId' in b) {
    const id = String(b.googleClientId || '').trim();
    const secret = String(b.googleClientSecret || '').trim();
    if (id && !/\.apps\.googleusercontent\.com$/.test(id)) return json({ error: 'That doesn’t look like a Google client ID (it ends in .apps.googleusercontent.com).' }, 400);
    await kvSet('google_client', id && secret ? { id, secret } : null);
  }
  if (b.pushPrefs && typeof b.pushPrefs === 'object') {
    const keys = ['morning', 'tasks', 'lift', 'posture'];
    await kvSet('push_prefs', Object.fromEntries(keys.map((k) => [k, b.pushPrefs[k] !== false])));
  }
  return json({ ok: true });
});
export const GET = handle(async () => json({ pushPrefs: (await kvGet('push_prefs')) || { morning: true, tasks: true, lift: true, posture: true } }));
