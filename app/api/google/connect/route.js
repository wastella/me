import { NextResponse } from 'next/server';
import { authUrl, googleConfigured } from '@/lib/google';
import { kvSet } from '@/lib/db';
import { APP_URL } from '@/lib/env';

// The desktop app opens the Google consent page in your normal browser
// (Google blocks sign-in inside embedded windows), so the anti-forgery
// state is kept server-side rather than in a cookie.
export async function GET() {
  if (!googleConfigured()) return NextResponse.redirect(`${APP_URL}/settings?google=missing`);
  const state = crypto.randomUUID();
  kvSet('google_oauth_state', { state, exp: Date.now() + 10 * 60_000 });
  return NextResponse.redirect(authUrl(state));
}
