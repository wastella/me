import { handle, json } from '@/lib/http';
import { importTodoist } from '@/lib/todoist';
export const POST = handle(async () => json(await importTodoist()));
