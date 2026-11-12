import { handle, json, body } from '@/lib/http';
import { snapshot, createNote } from '@/lib/notes';
export const GET = handle(async () => json(await snapshot()));
export const POST = handle(async (req) => json(await createNote(await body(req))));
