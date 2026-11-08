import { exchangeCode, storeTokens } from '@/lib/google';
import { getLogin, setLogin } from '@/lib/login';
import { OWNER_EMAIL } from '@/lib/env';
import { signSession, sessionCookie, authRequired } from '@/lib/session';
import { NextResponse } from 'next/server';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const page = (ok, msg, redirect) => new NextResponse(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Me</title>
${redirect ? '<meta http-equiv="refresh" content="1;url=/">' : ''}
<style>body{font:16px -apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0c0c0c;color:#ececec}
div{text-align:center;max-width:420px;padding:24px}b{font-size:22px;display:block;margin-bottom:8px}p{color:#8c8c8c}</style>
<div><b>${ok ? '✓ Signed in' : 'Couldn’t sign in'}</b><p>${msg}</p></div>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

export async function GET(req) {
  const u = new URL(req.url);
  const nonce = u.searchParams.get('state');
  const login = await getLogin(nonce);
  if (u.searchParams.get('error')) return page(false, `Google said: ${esc(u.searchParams.get('error'))}. Close this and try again.`);
  if (!login || login.status !== 'pending') return page(false, 'This sign-in link expired. Go back to Me and try again.');
  let tokens, email;
  try { ({ tokens, email } = await exchangeCode(u.searchParams.get('code'))); }
  catch (e) { console.error(e); return page(false, esc(e.message)); }
  if (authRequired() && (!OWNER_EMAIL || email !== OWNER_EMAIL)) {
    await setLogin(nonce, { status: 'denied', error: `${email || 'That account'} isn’t allowed to use this Me.`, exp: login.exp });
    return page(false, `${esc(email || 'That account')} isn’t allowed here.`);
  }
  await storeTokens(tokens, email);
  await setLogin(nonce, { status: 'ok', email, exp: login.exp });
  const res = page(true, 'You can close this and go back to Me.', true);
  if (authRequired()) res.cookies.set(sessionCookie(await signSession(email)));
  return res;
}
