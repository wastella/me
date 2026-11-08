import { handle, json, body } from '@/lib/http';
import { saveWorkout, deleteWorkout } from '@/lib/training';
export const POST = handle(async (req) => json({ id: saveWorkout(await body(req)) }, 201));
export const DELETE = handle(async (req) => { deleteWorkout(new URL(req.url).searchParams.get('id')); return json({ ok: true }); });
