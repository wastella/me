import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// The desktop app sets ME_DATA_DIR to ~/Library/Application Support/Me.
const DATA_DIR = process.env.ME_DATA_DIR || path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'me.db');

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
  labels TEXT DEFAULT '[]', sort INTEGER DEFAULT 0,
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
`;

function open() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;');
  db.exec(SCHEMA);
  const inbox = db.prepare('SELECT id FROM projects WHERE is_inbox = 1').get();
  if (!inbox) {
    db.prepare("INSERT INTO projects (id, name, is_inbox, sort) VALUES ('inbox', 'Misc', 1, 999)").run();
  }
  return db;
}

export function db() {
  if (!globalThis.__meDb) globalThis.__meDb = open();
  return globalThis.__meDb;
}

export function kvGet(key) {
  const row = db().prepare('SELECT value FROM kv WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}
export function kvSet(key, value) {
  if (value === null || value === undefined) {
    db().prepare('DELETE FROM kv WHERE key = ?').run(key);
  } else {
    db().prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }
}

export function tx(fn) {
  const d = db();
  d.exec('BEGIN');
  try { const r = fn(d); d.exec('COMMIT'); return r; }
  catch (e) { d.exec('ROLLBACK'); throw e; }
}

export const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();
