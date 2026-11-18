// RemindMe for the Mac menu-bar app: "Authorization: Bearer <RemindMe key>"
// (shown in Settings). GET says what should be on screen (and which devices
// are connected); POST answers a reminder, or { action: "test" } fires a test
// reminder on every device.
import { NextResponse } from 'next/server';
import { tick, answer, checkIn, createTest } from '@/lib/memento';
import { derived, bearerMatches } from '@/lib/tokens';
export const dynamic = 'force-dynamic';
const allowed = (req) => bearerMatches(req, derived('memento'));
const deviceName = (req) => { try { return decodeURIComponent(req.headers.get('x-device') || ''); } catch { return ''; } };
export async function GET(req) {
  if (!allowed(req)) return new NextResponse('Not found', { status: 404 });
  const devices = await checkIn(deviceName(req));
  return NextResponse.json({ ...(await tick()), devices });
}
export async function POST(req) {
  if (!allowed(req)) return new NextResponse('Not found', { status: 404 });
  try {
    const b = await req.json();
    if (b.action === 'test') { await createTest(); return NextResponse.json(await tick()); }
    return NextResponse.json(await answer(String(b.id), b.action));
  } catch (e) { return NextResponse.json({ error: e.message }, { status: e.status || 500 }); }
}
