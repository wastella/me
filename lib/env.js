// Reads config from ~/Me/.env.local on every call, so pasting new keys into
// the file works without restarting the app. Accepts a few spellings.
import fs from 'node:fs';
import path from 'node:path';

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
function clean(v) {
  return (v || '').trim().replace(/^['"]|['"]$/g, '').trim();
}
const pick = (...keys) => { const f = fileEnv(); for (const k of keys) { const v = clean(f[k]) || clean(process.env[k]); if (v) return v; } return ''; };

export const todoistToken = () => pick('TODOIST_API_TOKEN', 'TODOIST_API', 'TODOIST_TOKEN');
export const googleClient = () => ({ id: pick('GOOGLE_CLIENT_ID'), secret: pick('GOOGLE_CLIENT_SECRET') });
export const APP_URL = 'http://localhost:3737';
