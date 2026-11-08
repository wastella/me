import { handle, json, body } from '@/lib/http';
import { upsertExercise } from '@/lib/training';
export const PUT = handle(async (req) => json({ id: await upsertExercise(await body(req)) }));
