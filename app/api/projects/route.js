import { handle, json, body } from '@/lib/http';
import { createProject } from '@/lib/projects';
export const POST = handle(async (req) => json(await createProject(await body(req)), 201));
