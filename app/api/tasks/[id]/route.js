import { handle, json, body } from '@/lib/http';
import { getTask, updateTask, deleteTask, completeTask, uncompleteTask } from '@/lib/tasks';
export const GET = handle(async (_, { params }) => json(getTask(params.id)));
export const PATCH = handle(async (req, { params }) => json(updateTask(params.id, await body(req))));
export const DELETE = handle(async (_, { params }) => { deleteTask(params.id); return json({ ok: true }); });
// POST { action: 'complete' | 'uncomplete', previousDue? }
export const POST = handle(async (req, { params }) => {
  const b = await body(req);
  if (b.action === 'complete') return json(completeTask(params.id));
  if (b.action === 'uncomplete') return json(uncompleteTask(params.id, b.previousDue));
  return json({ error: 'unknown action' }, 400);
});
