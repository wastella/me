import { handle, json, body } from '@/lib/http';
import { reorder } from '@/lib/tasks';
export const POST = handle(async (req) => { await reorder(await body(req)); return json({ ok: true }); });
