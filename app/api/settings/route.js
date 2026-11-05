import { handle, json, body } from '@/lib/http';
import { kvSet } from '@/lib/db';
export const PATCH = handle(async (req) => {
  const b = await body(req);
  if ('name' in b) kvSet('name', String(b.name || '').trim() || null);
  if ('googleClientId' in b) {
    const id = String(b.googleClientId || '').trim();
    const secret = String(b.googleClientSecret || '').trim();
    if (id && !/\.apps\.googleusercontent\.com$/.test(id)) return json({ error: 'That doesn’t look like a Google client ID (it ends in .apps.googleusercontent.com).' }, 400);
    kvSet('google_client', id && secret ? { id, secret } : null);
  }
  return json({ ok: true });
});
