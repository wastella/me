import test from 'node:test';
import assert from 'node:assert/strict';
import { lib, rejects } from './helpers.mjs';
const P = await lib('projects');
const T = await lib('tasks');

test('projects: create, no duplicates, rename, validation', async () => {
  const p = await P.createProject({ name: '  College   Apps ' });
  assert.equal(p.name, 'College Apps');
  assert.equal((await P.createProject({ name: 'college-apps' })).id, p.id, 'same name returns the existing project');
  await rejects(assert, () => P.createProject({ name: '  ' }), 400);
  await rejects(assert, () => P.createProject(), 400);
  assert.equal((await P.updateProject(p.id, { name: 'Applications', color: 'blue' })).name, 'Applications');
  assert.equal((await P.updateProject(p.id, { color: 'not-a-colour' })).color, 'blue', 'unknown colours are ignored');
  await rejects(assert, () => P.updateProject(p.id, { name: '' }), 400);
  await rejects(assert, () => P.updateProject('missing', { name: 'x' }), 404);
});

test('Misc is protected', async () => {
  await rejects(assert, () => P.updateProject('inbox', { name: 'Inbox' }), 400);
  await rejects(assert, () => P.deleteProject('inbox'), 400);
  assert.ok((await T.snapshot()).projects.some((p) => p.id === 'inbox' && p.name === 'Misc'));
});

test('sections keep their tasks when removed; deleting a project removes everything in it', async () => {
  const p = await P.createProject({ name: 'CS' });
  const s = await P.createSection({ project_id: p.id, name: 'Labs' });
  await rejects(assert, () => P.createSection({ project_id: 'missing', name: 'x' }), 400);
  await rejects(assert, () => P.createSection({ project_id: p.id, name: '' }), 400);
  assert.equal((await P.updateSection(s.id, { name: 'Lab work' })).name, 'Lab work');
  const t = await T.createTask({ content: 'Enumerators lab', project_id: p.id, section_id: s.id });
  await P.deleteSection(s.id);
  const kept = await T.getTask(t.id);
  assert.equal(kept.section_id, null);
  assert.equal(kept.project_id, p.id);
  const other = await T.createTask({ content: 'Elsewhere' });
  assert.deepEqual(await P.deleteProject(p.id), { deleted: 1 });
  assert.equal(await T.getTask(t.id), undefined);
  assert.ok(await T.getTask(other.id), 'tasks in other projects are untouched');
  assert.deepEqual(await P.deleteProject(p.id), { deleted: 0 }, 'deleting twice is harmless');
});
