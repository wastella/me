import { handle, json } from '@/lib/http';
import { snapshot } from '@/lib/training';
export const GET = handle(async () => json(snapshot()));
