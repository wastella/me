import test from 'node:test';
import assert from 'node:assert/strict';
import { lib, rejects } from './helpers.mjs';
const N = await lib('notes');

test('notes: create, edit, pin, delete', async () => {
  const n = await N.createNote({ body: '  Title line\nrest  ' });
  assert.equal(n.body, 'Title line\nrest');
  assert.equal(n.category_id, null);
  await rejects(assert, () => N.createNote({ body: '   ' }), 400);
  const before = n.updated_at;
  await new Promise((r) => setTimeout(r, 5));
  const pinned = await N.updateNote(n.id, { pinned: true });
  assert.equal(pinned.pinned, 1);
  assert.equal(pinned.updated_at, before, 'pinning does not count as an edit');
  const edited = await N.updateNote(n.id, { body: 'New text' });
  assert.ok(edited.updated_at > before);
  await rejects(assert, () => N.updateNote(n.id, { body: '' }), 400);
  await rejects(assert, () => N.updateNote('missing', { body: 'x' }), 404);
  const snap = await N.snapshot();
  assert.equal(snap.notes[0].id, n.id, 'pinned notes come first');
  await N.deleteNote(n.id);
  assert.equal(await N.getNote(n.id), undefined);
});

test('very long notes are trimmed, not rejected', async () => {
  const n = await N.createNote({ body: 'x'.repeat(25000) });
  assert.equal(n.body.length, 20000);
});

test('categories: no duplicates, deleting keeps the notes', async () => {
  const c = await N.createCategory({ name: 'Ideas' });
  assert.equal((await N.createCategory({ name: ' ideas ' })).id, c.id);
  await rejects(assert, () => N.createCategory({ name: ' ' }), 400);
  const n = await N.createNote({ body: 'An idea', category_id: c.id });
  assert.equal(n.category_id, c.id);
  assert.equal((await N.createNote({ body: 'Orphan', category_id: 'nope' })).category_id, null, 'unknown category becomes Unsorted');
  await N.updateCategory(c.id, { name: 'Big Ideas' });
  assert.equal((await N.categoryByName('big-ideas')).id, c.id);
  await rejects(assert, () => N.updateCategory(c.id, { name: '' }), 400);
  await N.deleteCategory(c.id);
  assert.equal((await N.getNote(n.id)).category_id, null);
  assert.equal(await N.categoryByName('Big Ideas'), null);
});

test('splitCategory reads "#Tag text" and "Tag: text" for known categories only', async () => {
  const c = await N.createCategory({ name: 'School' });
  assert.deepEqual(await N.splitCategory('#school bring calculator'), { category: c, body: 'bring calculator' });
  assert.deepEqual(await N.splitCategory('School: bring calculator'), { category: c, body: 'bring calculator' });
  assert.deepEqual(await N.splitCategory('Reminder: bring calculator'), { category: null, body: 'Reminder: bring calculator' });
  assert.deepEqual(await N.splitCategory('use #hashtags freely'), { category: null, body: 'use #hashtags freely' });
});
