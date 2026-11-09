import { handle, json, body } from '@/lib/http';
import { snapshot, createTask } from '@/lib/tasks';
export const GET = handle(async () => json(await snapshot()));
export const POST = handle(async (req) => json(await createTask(await body(req)), 201));
