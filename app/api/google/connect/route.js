import { NextResponse } from 'next/server';
import { googleConfigured } from '@/lib/google';
import { startLogin } from '@/lib/login';
import { APP_URL } from '@/lib/env';
// Local (unhosted) mode: Settings → Connect Google.
export async function GET() {
  if (!(await googleConfigured())) return NextResponse.redirect(`${APP_URL}/settings?google=missing`);
  return NextResponse.redirect((await startLogin()).url);
}
