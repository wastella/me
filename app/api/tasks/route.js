import { after } from 'next/server';
import { handle, json, body } from '@/lib/http';
import { snapshot, createTask } from '@/lib/tasks';
import { maybeSync } from '@/lib/school';

export const GET = handle(async () => {
  // Pull new school assignments in the background (at most every 30 min);
  // they show up on the next refresh.
  after(() => maybeSync().catch((e) => console.error('school sync', e)));
  return json(await snapshot());
});
export const POST = handle(async (req) => json(await createTask(await body(req)), 201));
