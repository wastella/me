import { handle, json } from '@/lib/http';
import { disconnect } from '@/lib/google';
export const POST = handle(async () => { await disconnect(); return json({ ok: true }); });
