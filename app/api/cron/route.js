// Called every ~15 minutes by the scheduled GitHub workflow (Bearer CRON_SECRET).
import { NextResponse } from 'next/server';
import { runReminders } from '@/lib/reminders';
import { tick } from '@/lib/memento';
import { bearerMatches } from '@/lib/tokens';
export async function POST(req) {
  if (!bearerMatches(req, process.env.CRON_SECRET)) return new NextResponse('Not found', { status: 404 });
  const fired = (await tick()).active.length;   // MeMento: fire anything due, so the phone hears about it
  return NextResponse.json({ reminders: await runReminders(), mementos: fired });
}
