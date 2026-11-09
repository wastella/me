// Secrets derived from SESSION_SECRET (so there's nothing extra to store):
// the Siri Shortcut token. Compare with timing-safe equality.
import { createHmac, timingSafeEqual } from 'node:crypto';
export const derived = (purpose) => (process.env.SESSION_SECRET ? createHmac('sha256', process.env.SESSION_SECRET).update(`me:${purpose}`).digest('base64url') : null);
export function bearerMatches(req, expected) {
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected || !got || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
