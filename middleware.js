import { NextResponse } from 'next/server';
// "Me" only ever runs on this machine. Reject requests whose Host or Origin
// isn't local, so other websites can't poke the API from your browser.
const OK_HOSTS = new Set(['localhost:3737', '127.0.0.1:3737']);
export function middleware(req) {
  const host = req.headers.get('host');
  if (!OK_HOSTS.has(host)) return new NextResponse('Forbidden host', { status: 403 });
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.get('origin');
    if (origin && !OK_HOSTS.has(origin.replace(/^https?:\/\//, ''))) return new NextResponse('Forbidden origin', { status: 403 });
  }
  return NextResponse.next();
}
export const config = { matcher: '/api/:path*' };
