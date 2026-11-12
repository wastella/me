// Notes to self. A note is free text; its first line reads as the title.
import { db, tx, now, newId } from './db';

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const norm = (s) => String(s || '').toLowerCase().replace(/[\s_-]+/g, '');

export async function snapshot() {
  const q = await db();
  const [categories, notes] = await Promise.all([
    q.all('SELECT * FROM note_categories ORDER BY sort, name'),
    q.all('SELECT * FROM notes ORDER BY pinned DESC, updated_at DESC'),
  ]);
  return { categories, notes };
}

export async function categoryByName(name) {
  if (!name) return null;
  const list = await (await db()).all('SELECT * FROM note_categories');
  return list.find((c) => norm(c.name) === norm(name)) || null;
}

export async function createCategory({ name, color }) {
  name = String(name || '').trim().slice(0, 60);
  if (!name) throw bad('Name the category.');
  const existing = await categoryByName(name);
  if (existing) return existing;
  const q = await db();
  const { n } = await q.get('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM note_categories');
  const cat = { id: newId(), name, color: color || 'charcoal', sort: n };
  await q.run('INSERT INTO note_categories (id, name, color, sort) VALUES (?, ?, ?, ?)', cat.id, cat.name, cat.color, cat.sort);
  return cat;
}

export async function updateCategory(id, { name, color }) {
  const q = await db();
  if (name !== undefined) { name = String(name).trim().slice(0, 60); if (!name) throw bad('Name the category.'); await q.run('UPDATE note_categories SET name = ? WHERE id = ?', name, id); }
  if (color !== undefined) await q.run('UPDATE note_categories SET color = ? WHERE id = ?', color, id);
}

// Deleting a category keeps its notes; they move to Unsorted.
export async function deleteCategory(id) {
  await tx(async (q) => {
    await q.run('UPDATE notes SET category_id = NULL WHERE category_id = ?', id);
    await q.run('DELETE FROM note_categories WHERE id = ?', id);
  });
}

// Pulls a category out of text said or typed as "#Ideas ..." or "Ideas: ...".
export async function splitCategory(text) {
  const tag = text.match(/(^|\s)#([\p{L}\p{N}_-]+)/u);
  if (tag) {
    const cat = await categoryByName(tag[2]);
    if (cat) return { category: cat, body: text.replace(tag[0], tag[1]).replace(/ {2,}/g, ' ').trim() };
  }
  const lead = text.match(/^([^:\n]{1,40}):\s*([\s\S]+)$/);
  if (lead) {
    const cat = await categoryByName(lead[1]);
    if (cat) return { category: cat, body: lead[2].trim() };
  }
  return { category: null, body: text };
}

export async function createNote({ body, category_id, pinned, source }) {
  body = String(body || '').trim();
  if (!body) throw bad('The note is empty.');
  const q = await db();
  if (category_id && !(await q.get('SELECT id FROM note_categories WHERE id = ?', category_id))) category_id = null;
  const t = now();
  const note = { id: newId(), category_id: category_id || null, body: body.slice(0, 20000), pinned: pinned ? 1 : 0, created_at: t, updated_at: t, source: source || null };
  await q.run('INSERT INTO notes (id, category_id, body, pinned, created_at, updated_at, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
    note.id, note.category_id, note.body, note.pinned, note.created_at, note.updated_at, note.source);
  return note;
}

export async function getNote(id) { return (await db()).get('SELECT * FROM notes WHERE id = ?', id); }

export async function updateNote(id, patch) {
  const q = await db();
  const note = await getNote(id);
  if (!note) throw Object.assign(new Error('Note not found'), { status: 404 });
  const next = { ...note };
  if (patch.body !== undefined) { next.body = String(patch.body).trim().slice(0, 20000); if (!next.body) throw bad('The note is empty.'); }
  if (patch.category_id !== undefined) next.category_id = patch.category_id || null;
  if (patch.pinned !== undefined) next.pinned = patch.pinned ? 1 : 0;
  // Pinning doesn't count as an edit, so it doesn't reshuffle the list.
  if (patch.body !== undefined || patch.category_id !== undefined) next.updated_at = now();
  await q.run('UPDATE notes SET body = ?, category_id = ?, pinned = ?, updated_at = ? WHERE id = ?', next.body, next.category_id, next.pinned, next.updated_at, id);
  return next;
}

export async function deleteNote(id) { await (await db()).run('DELETE FROM notes WHERE id = ?', id); }
