import { NextResponse } from 'next/server';
export const json = (data, status = 200) => NextResponse.json(data ?? null, { status });
// Wraps a route: errors thrown with a `status` (400, 404…) are sent to the
// app as-is; anything unexpected is logged and reported without internals.
export function handle(fn) {
  return async (req, ctx) => {
    try { return await fn(req, ctx && { params: await ctx.params }); }
    catch (e) {
      const status = Number(e.status) >= 400 && Number(e.status) < 500 ? Number(e.status) : 500;
      if (status === 500) console.error(e);
      return json({ error: status === 500 ? 'Something went wrong on the server. Try again.' : e.message }, status);
    }
  };
}
export const body = async (req) => { try { const b = await req.json(); return b && typeof b === 'object' && !Array.isArray(b) ? b : {}; } catch { return {}; } };
export const notFound = (what = 'That') => Object.assign(new Error(`${what} no longer exists`), { status: 404 });
