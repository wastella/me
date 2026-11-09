// Data lives in Turso (hosted SQLite) when TURSO_DATABASE_URL is set, so the
// Mac app and phone share it; otherwise in a local SQLite file for dev.
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.ME_DATA_DIR || path.join(process.cwd(), 'data');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT 'charcoal',
  parent_id TEXT, sort INTEGER DEFAULT 0, is_inbox INTEGER DEFAULT 0,
  is_favorite INTEGER DEFAULT 0, archived INTEGER DEFAULT 0,
  source TEXT, source_id TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
  sort INTEGER DEFAULT 0, source_id TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT DEFAULT 'charcoal',
  sort INTEGER DEFAULT 0, source_id TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, project_id TEXT, section_id TEXT, parent_id TEXT,
  content TEXT NOT NULL, description TEXT DEFAULT '',
  priority INTEGER DEFAULT 4,           -- 1 = most urgent (like Todoist's p1)
  due_date TEXT, due_time TEXT,         -- YYYY-MM-DD, HH:MM (local)
  due_string TEXT, recurring INTEGER DEFAULT 0,
  deadline TEXT, duration_min INTEGER,
  labels TEXT DEFAULT '[]', sort INTEGER DEFAULT 0, day_order INTEGER DEFAULT 0,
  completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT,
  source TEXT, source_id TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS tasks_open ON tasks(completed_at, due_date);
CREATE TABLE IF NOT EXISTS completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, content TEXT,
  project_id TEXT, completed_at TEXT NOT NULL, source_id TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, content TEXT NOT NULL,
  posted_at TEXT NOT NULL, source_id TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
-- Training: an upper/lower split plus a daily posture routine.
CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY, day TEXT NOT NULL,            -- 'upper' | 'lower'
  name TEXT NOT NULL, sets INTEGER, reps TEXT,       -- reps can be '8' or '45 sec'
  kind TEXT NOT NULL DEFAULT 'weight',               -- 'weight' (lb) | 'note'
  sort INTEGER DEFAULT 0, archived INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS workouts (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, day TEXT NOT NULL, notes TEXT DEFAULT '',
  created_at TEXT NOT NULL, source TEXT
);
CREATE INDEX IF NOT EXISTS workouts_date ON workouts(date);
CREATE TABLE IF NOT EXISTS workout_sets (
  workout_id TEXT NOT NULL, exercise_id TEXT NOT NULL,
  weight REAL, note TEXT DEFAULT '',
  PRIMARY KEY (workout_id, exercise_id)
);
CREATE TABLE IF NOT EXISTS posture_steps (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER DEFAULT 0, archived INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS posture_log (date TEXT NOT NULL, step_id TEXT NOT NULL, PRIMARY KEY (date, step_id));
`;

function client() {
  if (globalThis.__meClient) return globalThis.__meClient;
  let url = process.env.TURSO_DATABASE_URL;
  if (!url) { fs.mkdirSync(DATA_DIR, { recursive: true }); url = `file:${path.join(DATA_DIR, 'me.db')}`; }
  globalThis.__meClient = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  return globalThis.__meClient;
}

const clean = (args) => args.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
const plain = (rs) => rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));

// A tiny query API over a client or an open transaction:
//   await q.all(sql, ...args)  -> rows
//   await q.get(sql, ...args)  -> first row | undefined
//   await q.run(sql, ...args)  -> { changes }
function api(exec) {
  return {
    all: async (sql, ...args) => plain(await exec({ sql, args: clean(args) })),
    get: async (sql, ...args) => plain(await exec({ sql, args: clean(args) }))[0],
    run: async (sql, ...args) => ({ changes: (await exec({ sql, args: clean(args) })).rowsAffected }),
  };
}

async function init() {
  const c = client();
  await c.executeMultiple(SCHEMA);
  const cols = plain(await c.execute('PRAGMA table_info(tasks)')).map((r) => r.name);
  if (!cols.includes('day_order')) await c.execute('ALTER TABLE tasks ADD COLUMN day_order INTEGER DEFAULT 0');
  if (!cols.includes('source_due')) await c.execute('ALTER TABLE tasks ADD COLUMN source_due TEXT');
  const inbox = plain(await c.execute('SELECT id FROM projects WHERE is_inbox = 1'))[0];
  if (!inbox) await c.execute("INSERT INTO projects (id, name, is_inbox, sort) VALUES ('inbox', 'Misc', 1, 999)");
}

// Resolves once the schema is in place; returns the query API.
export async function db() {
  globalThis.__meReady ||= init().catch((e) => { globalThis.__meReady = null; throw e; });
  await globalThis.__meReady;
  return api((stmt) => client().execute(stmt));
}

// Runs fn(q) inside a write transaction.
export async function tx(fn) {
  await db();
  const t = await client().transaction('write');
  try { const r = await fn(api((stmt) => t.execute(stmt))); await t.commit(); return r; }
  catch (e) { await t.rollback().catch(() => {}); throw e; }
  finally { t.close(); }
}

export async function kvGet(key) {
  const row = await (await db()).get('SELECT value FROM kv WHERE key = ?', key);
  return row ? JSON.parse(row.value) : null;
}
export async function kvSet(key, value) {
  const q = await db();
  if (value === null || value === undefined) await q.run('DELETE FROM kv WHERE key = ?', key);
  else await q.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

export const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();
