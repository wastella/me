import { NextResponse } from 'next/server';
import { COOKIE, verifySession, authRequired } from './lib/session';

// Hosted: every page and API needs a valid session, except the sign-in flow
// and static assets. Local dev: only requests to localhost are accepted.
// /api/mcp, /api/cron and /api/quick check their own secrets (no cookie).
const PUBLIC = [/^\/api\/mcp\//, /^\/api\/cron$/, /^\/api\/quick$/, /^\/sw\.js$/, /^\/login$/, /^\/api\/auth\//, /^\/api\/google\/callback$/, /^\/manifest\.webmanifest$/, /^\/(icon|apple-touch-icon)/, /^\/favicon/];
const LOCAL_HOSTS = new Set(['localhost:3737', '127.0.0.1:3737']);

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  const host = req.headers.get('host');
  const unsafe = req.method !== 'GET' && req.method !== 'HEAD';
  const origin = req.headers.get('origin');

  if (!authRequired()) {
    if (!LOCAL_HOSTS.has(host)) return new NextResponse('Forbidden host', { status: 403 });
    if (unsafe && origin && !LOCAL_HOSTS.has(origin.replace(/^https?:\/\//, ''))) return new NextResponse('Forbidden origin', { status: 403 });
    return NextResponse.next();
  }

  // Writes must come from this site's own pages.
  if (unsafe && origin && new URL(origin).host !== host) return new NextResponse('Forbidden origin', { status: 403 });
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  if (await verifySession(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Signed out' }, { status: 401 });
  const to = req.nextUrl.clone(); to.pathname = '/login'; to.search = '';
  return NextResponse.redirect(to);
}

export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
