import { handle, json } from '@/lib/http';
import { history, stats } from '@/lib/tasks';
export const GET = handle(async () => json({ items: history(300), stats: stats() }));
