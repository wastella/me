import { handle, json, body } from '@/lib/http';
import { snapshot, createTask } from '@/lib/tasks';
export const GET = handle(async () => json(snapshot()));
export const POST = handle(async (req) => json(createTask(await body(req)), 201));
