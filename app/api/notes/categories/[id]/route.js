import { handle, json, body } from '@/lib/http';
import { updateCategory, deleteCategory } from '@/lib/notes';
export const PATCH = handle(async (req, { params }) => { await updateCategory(params.id, await body(req)); return json({ ok: true }); });
export const DELETE = handle(async (_req, { params }) => { await deleteCategory(params.id); return json({ ok: true }); });
