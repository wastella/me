import { NextResponse } from 'next/server';
import { authUrl, googleConfigured } from '@/lib/google';
export async function GET() {
  if (!googleConfigured()) return NextResponse.redirect('http://localhost:3737/settings?google=missing');
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(authUrl(state));
  res.cookies.set('g_state', state, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600 });
  return res;
}
