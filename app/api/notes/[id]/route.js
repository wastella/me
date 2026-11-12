import { handle, json, body } from '@/lib/http';
import { updateNote, deleteNote } from '@/lib/notes';
export const PATCH = handle(async (req, { params }) => json(await updateNote(params.id, await body(req))));
export const DELETE = handle(async (_req, { params }) => { await deleteNote(params.id); return json({ ok: true }); });
