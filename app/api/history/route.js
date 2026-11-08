import { handle, json } from '@/lib/http';
import { history } from '@/lib/tasks';
export const GET = handle(async () => json({ items: await history(300) }));
