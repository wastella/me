import { NextResponse } from 'next/server';
import { getLogin, setLogin } from '@/lib/login';
import { signSession, sessionCookie, authRequired } from '@/lib/session';
export async function GET(req) {
  const nonce = new URL(req.url).searchParams.get('nonce');
  const l = await getLogin(nonce);
  if (!l) return NextResponse.json({ error: 'Sign-in expired. Try again.' }, { status: 410 });
  if (l.status === 'pending') return NextResponse.json({ pending: true });
  if (l.status !== 'ok') return NextResponse.json({ error: l.error || 'Sign-in was not allowed.' }, { status: 403 });
  await setLogin(nonce, null);
  const res = NextResponse.json({ ok: true });
  if (authRequired()) res.cookies.set(sessionCookie(await signSession(l.email)));
  return res;
}
