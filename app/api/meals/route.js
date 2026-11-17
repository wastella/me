import { handle, json, body } from '@/lib/http';
import { meals, connect, disconnect } from '@/lib/meals';
export const GET = handle(async (req) => {
  const p = new URL(req.url).searchParams;
  return json(await meals({ start: p.get('start') || undefined, days: Number(p.get('days')) || 7 }));
});
export const PUT = handle(async (req) => json(await connect((await body(req)).url)));
export const DELETE = handle(async () => { await disconnect(); return json({ ok: true }); });
