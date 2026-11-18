// RemindMe for the signed-in web app (the phone's home-screen app).
import { handle, json, body } from '@/lib/http';
import { tick, recent, create, answer, cancel } from '@/lib/memento';
export const dynamic = 'force-dynamic';
export const GET = handle(async (req) => json({ ...(await tick()), ...(new URL(req.url).searchParams.get('recent') ? { recent: await recent() } : {}) }));
export const POST = handle(async (req) => json(await create({ ...(await body(req)), source: 'app' }), 201));
export const PATCH = handle(async (req) => { const b = await body(req); return json(await answer(b.id, b.action)); });
export const DELETE = handle(async (req) => { await cancel(new URL(req.url).searchParams.get('id')); return json({ ok: true }); });
