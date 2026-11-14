// Each test file gets its own empty database in a temp folder, so tests
// never touch data/me.db or the real cloud database.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
process.env.ME_TZ = 'America/New_York';
process.env.ME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'me-test-'));

export const lib = (name) => import(`../lib/${name}.js`);
export async function rejects(assert, fn, status) {
  await assert.rejects(fn, (e) => { assert.equal(e.status, status, `expected status ${status}, got ${e.status}: ${e.message}`); return true; });
}
