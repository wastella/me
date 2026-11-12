import { handle, json, body } from '@/lib/http';
import { createCategory } from '@/lib/notes';
export const POST = handle(async (req) => json(await createCategory(await body(req))));
