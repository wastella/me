import { handle, json, body } from '@/lib/http';
import { subscribe, unsubscribe } from '@/lib/push';
export const POST = handle(async (req) => { const b = await body(req); await subscribe(b.subscription, b.device); return json({ ok: true }); });
export const DELETE = handle(async (req) => { const b = await body(req); await unsubscribe(b.endpoint); return json({ ok: true }); });
