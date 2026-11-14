import { handle, json, body } from '@/lib/http';
import { createSection, updateSection, deleteSection } from '@/lib/projects';
// POST { project_id, name } · PATCH { id, name } · DELETE ?id=
export const POST = handle(async (req) => json(await createSection(await body(req)), 201));
export const PATCH = handle(async (req) => { const b = await body(req); return json(await updateSection(b.id, b)); });
export const DELETE = handle(async (req) => { await deleteSection(new URL(req.url).searchParams.get('id')); return json({ ok: true }); });
