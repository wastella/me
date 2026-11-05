import { NextResponse } from 'next/server';
import { exchangeCode } from '@/lib/google';
export async function GET(req) {
  const u = new URL(req.url);
  const back = (q) => NextResponse.redirect(`http://localhost:3737/settings?google=${q}`);
  if (u.searchParams.get('error')) return back(encodeURIComponent(u.searchParams.get('error')));
  if (!u.searchParams.get('state') || u.searchParams.get('state') !== req.cookies.get('g_state')?.value) return back('bad_state');
  try { await exchangeCode(u.searchParams.get('code')); }
  catch (e) { console.error(e); return back(encodeURIComponent(e.message)); }
  const res = back('connected');
  res.cookies.delete('g_state');
  return res;
}
