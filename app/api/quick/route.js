// Siri / Shortcuts: POST { text } with "Authorization: Bearer <shortcut token>"
// adds a task using quick-add syntax ("call mom tomorrow 5pm p1 #Misc").
import { NextResponse } from 'next/server';
import { createTask } from '@/lib/tasks';
import { derived, bearerMatches } from '@/lib/tokens';
import { humanDate, humanTime } from '@/lib/dates';
export async function POST(req) {
  if (!bearerMatches(req, derived('shortcut'))) return new NextResponse('Not found', { status: 404 });
  let text = '';
  try { const b = await req.json(); text = String(b.text || '').trim(); } catch { text = (await req.text()).trim(); }
  if (!text) return NextResponse.json({ error: 'Say what to add.' }, { status: 400 });
  const t = await createTask({ text: text.slice(0, 300) });
  const when = t.due_date ? ` for ${humanDate(t.due_date).toLowerCase()}${t.due_time ? ` at ${humanTime(t.due_time)}` : ''}` : '';
  return NextResponse.json({ ok: true, message: `Added “${t.content}”${when}.` });
}
