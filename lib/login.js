// One sign-in attempt = a random nonce, used as the OAuth `state`. The window
// that started it polls until Google's callback marks it approved, then gets
// its session cookie. This works even when sign-in happens in another browser
// (the Mac app opens your default browser; iPhone home-screen apps open Safari).
import { kvGet, kvSet } from './db.js';
import { authUrl } from './google.js';

const TTL = 10 * 60_000;
export async function startLogin() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const nonce = Buffer.from(bytes).toString('base64url');
  await kvSet(`login:${nonce}`, { status: 'pending', exp: Date.now() + TTL });
  return { nonce, url: await authUrl(nonce) };
}
export async function getLogin(nonce) {
  if (!nonce || !/^[\w-]{20,64}$/.test(nonce)) return null;
  const l = await kvGet(`login:${nonce}`);
  return l && l.exp > Date.now() ? l : null;
}
export const setLogin = (nonce, value) => kvSet(`login:${nonce}`, value);
