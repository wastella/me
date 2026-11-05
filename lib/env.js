// Reads config from ~/Me/.env.local on every call, so pasting new keys into
// the file works without restarting the app. Accepts a few spellings.
import fs from 'node:fs';
import path from 'node:path';
import { kvGet } from './db.js';

export const ENV_FILE = process.env.ME_ENV_FILE || path.join(process.cwd(), '.env.local');

function fileEnv() {
  try {
    const out = {};
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2];
    }
    return out;
  } catch { return {}; }
}
function clean(v) {
  return (v || '').trim().replace(/^['"]|['"]$/g, '').trim();
}
const pick = (...keys) => { const f = fileEnv(); for (const k of keys) { const v = clean(f[k]) || clean(process.env[k]); if (v) return v; } return ''; };

export const todoistToken = () => pick('TODOIST_API_TOKEN', 'TODOIST_API', 'TODOIST_TOKEN');
// Keys pasted in Settings (stored in the local db) win over the env file.
export const googleClient = () => {
  const saved = kvGet('google_client') || {};
  return { id: saved.id || pick('GOOGLE_CLIENT_ID'), secret: saved.secret || pick('GOOGLE_CLIENT_SECRET') };
};
export const APP_URL = 'http://localhost:3737';
