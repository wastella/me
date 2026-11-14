import { handle, json, body } from '@/lib/http';
import { updateProject, deleteProject } from '@/lib/projects';
export const PATCH = handle(async (req, { params }) => json(await updateProject(params.id, await body(req))));
export const DELETE = handle(async (_, { params }) => json({ ok: true, ...(await deleteProject(params.id)) }));
