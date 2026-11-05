import { exchangeCode } from '@/lib/google';
import { kvGet, kvSet } from '@/lib/db';

const page = (ok, msg) => new Response(`<!doctype html><meta charset="utf-8"><title>Me</title>
<style>body{font:16px -apple-system,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f6f5f2;color:#1d1c1a}
div{text-align:center;max-width:420px;padding:24px}b{font-size:22px;display:block;margin-bottom:8px}p{color:#6f6b63}
@media(prefers-color-scheme:dark){body{background:#141412;color:#ecebe7}p{color:#a29f97}}</style>
<div><b>${ok ? '✓ Google connected' : 'Couldn’t connect Google'}</b><p>${msg}</p></div>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function GET(req) {
  const u = new URL(req.url);
  const saved = kvGet('google_oauth_state');
  if (u.searchParams.get('error')) return page(false, `Google said: ${esc(u.searchParams.get('error'))}. Close this tab and try again from Me.`);
  if (!saved || saved.exp < Date.now() || saved.state !== u.searchParams.get('state')) return page(false, 'This sign-in link expired. Go back to Me and click Connect Google again.');
  kvSet('google_oauth_state', null);
  try { await exchangeCode(u.searchParams.get('code')); }
  catch (e) { console.error(e); return page(false, esc(e.message)); }
  return page(true, 'You can close this tab and go back to Me. Your calendar and inbox are live.');
}
