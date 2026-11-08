// Signed session cookie (HMAC-SHA256 via Web Crypto, so it also runs in
// middleware). Sign-in is only required when SESSION_SECRET is set, i.e. when
// the app is hosted; local dev stays open on localhost.
export const COOKIE = 'me_session';
export const MAX_AGE = 60 * 60 * 24 * 180;           // 180 days
export const authRequired = () => !!process.env.SESSION_SECRET;

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function key() {
  return crypto.subtle.importKey('raw', enc.encode(process.env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signSession(email) {
  const body = b64(enc.encode(JSON.stringify({ email, exp: Date.now() + MAX_AGE * 1000 })));
  const sig = b64(await crypto.subtle.sign('HMAC', await key(), enc.encode(body)));
  return `${body}.${sig}`;
}

export async function verifySession(token) {
  if (!token || !process.env.SESSION_SECRET) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(), unb64(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64(body)));
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

export function sessionCookie(token) {
  return { name: COOKIE, value: token, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: MAX_AGE };
}
