// Config comes from environment variables (Vercel project settings when
// hosted, .env.local in dev). Google keys pasted in Settings win.
import fs from 'node:fs';
import path from 'node:path';
import { kvGet } from './db.js';

function fileEnv() {
  try {
    const out = {};
    for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2];
    }
    return out;
  } catch { return {}; }
}
const clean = (v) => (v || '').trim().replace(/^['"]|['"]$/g, '').trim();
export const pick = (...keys) => { const f = fileEnv(); for (const k of keys) { const v = clean(process.env[k]) || clean(f[k]); if (v) return v; } return ''; };

export async function googleClient() {
  const saved = (await kvGet('google_client')) || {};
  return { id: saved.id || pick('GOOGLE_CLIENT_ID'), secret: saved.secret || pick('GOOGLE_CLIENT_SECRET') };
}

// Public address of the app: https://… when hosted, localhost in dev.
export const APP_URL = (pick('APP_URL') || 'http://localhost:3737').replace(/\/$/, '');
export const OWNER_EMAIL = pick('OWNER_EMAIL').toLowerCase();
export const TZ = pick('ME_TZ') || Intl.DateTimeFormat().resolvedOptions().timeZone;
