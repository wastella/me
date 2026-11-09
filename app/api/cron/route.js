// Called every ~15 minutes by the scheduled GitHub workflow (Bearer CRON_SECRET).
import { NextResponse } from 'next/server';
import { runReminders } from '@/lib/reminders';
import { maybeSync } from '@/lib/school';
import { bearerMatches } from '@/lib/tokens';
export async function POST(req) {
  if (!bearerMatches(req, process.env.CRON_SECRET)) return new NextResponse('Not found', { status: 404 });
  const [reminders, school] = await Promise.allSettled([runReminders(), maybeSync()]);
  return NextResponse.json({ reminders: reminders.value ?? String(reminders.reason), school: school.status });
}
