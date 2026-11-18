// RemindMe for the Mac menu-bar app: "Authorization: Bearer <RemindMe key>"
// (shown in Settings). GET says what should be on screen; POST answers it.
import { NextResponse } from 'next/server';
import { tick, answer } from '@/lib/memento';
import { derived, bearerMatches } from '@/lib/tokens';
export const dynamic = 'force-dynamic';
const allowed = (req) => bearerMatches(req, derived('memento'));
export async function GET(req) {
  if (!allowed(req)) return new NextResponse('Not found', { status: 404 });
  return NextResponse.json(await tick());
}
export async function POST(req) {
  if (!allowed(req)) return new NextResponse('Not found', { status: 404 });
  try { const b = await req.json(); return NextResponse.json(await answer(String(b.id), b.action)); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: e.status || 500 }); }
}
