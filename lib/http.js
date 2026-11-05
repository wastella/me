import { NextResponse } from 'next/server';
export const json = (data, status = 200) => NextResponse.json(data, { status });
export function handle(fn) {
  return async (req, ctx) => {
    try { return await fn(req, ctx && { params: await ctx.params }); }
    catch (e) { console.error(e); return json({ error: e.message }, e.status || 500); }
  };
}
export const body = async (req) => { try { return await req.json(); } catch { return {}; } };
