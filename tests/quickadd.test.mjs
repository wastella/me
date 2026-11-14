import test from 'node:test';
import assert from 'node:assert/strict';
import { quickAdd } from '../lib/quickadd.js';
import { todayStr, addDays, dow } from '../lib/dates.js';

const projects = [{ id: 'cs', name: 'CS' }, { id: 'ca', name: 'College Apps' }, { id: 'col', name: 'College' }];
const today = todayStr();

test('plain text becomes a plain task', () => {
  const t = quickAdd('Buy milk');
  assert.equal(t.content, 'Buy milk');
  assert.equal(t.due_date, null);
  assert.equal(t.priority, 4);
  assert.equal(t.project_id, null);
  assert.equal(t.recurring, 0);
});

test('priority, with or without the exclamation mark', () => {
  assert.equal(quickAdd('Essay p1').priority, 1);
  assert.equal(quickAdd('Essay !p2 draft').priority, 2);
  assert.equal(quickAdd('Essay p1').content, 'Essay');
  assert.equal(quickAdd('Buy a p5 widget').priority, 4, 'p5 is not a priority');
  assert.equal(quickAdd('Update app1 config').content, 'Update app1 config');
});

test('projects: exact, multi-word, squashed and new', () => {
  assert.equal(quickAdd('Lab #CS', { projects }).project_id, 'cs');
  assert.equal(quickAdd('Lab #cs', { projects }).project_id, 'cs');
  assert.equal(quickAdd('Essay #College Apps', { projects }).project_id, 'ca', 'longest name wins');
  assert.equal(quickAdd('Essay #College Apps', { projects }).content, 'Essay');
  assert.equal(quickAdd('Essay #collegeapps', { projects }).project_id, 'ca');
  assert.equal(quickAdd('Tour #College', { projects }).project_id, 'col');
  const n = quickAdd('Fix bike #Garage', { projects });
  assert.equal(n.project_id, null);
  assert.equal(n.newProject, 'Garage');
  assert.equal(n.content, 'Fix bike');
});

test('an email address or mid-word # is not a project', () => {
  const t = quickAdd('Email bob@example.com about C#', { projects });
  assert.equal(t.project_id, null);
  assert.equal(t.newProject, undefined);
  assert.equal(t.content, 'Email bob@example.com about C#');
});

test('dates and times come out of the title', () => {
  const t = quickAdd('Call mom tomorrow 5pm');
  assert.equal(t.content, 'Call mom');
  assert.equal(t.due_date, addDays(today, 1));
  assert.equal(t.due_time, '17:00');
  const d = quickAdd('Dentist today');
  assert.equal(d.due_date, today);
  assert.equal(d.due_time, null);
  assert.equal(d.content, 'Dentist');
});

test('weekday names always mean the coming one', () => {
  const t = quickAdd('Lab friday');
  assert.equal(dow(t.due_date), 5);
  assert.ok(t.due_date >= today);
});

test('numbers in a title are not mistaken for dates', () => {
  for (const s of ['Physics 2: MP Ch 19 problems 3-4', 'Read chapters 3 and 4', 'Do 20 pushups', 'Problem set 7']) {
    const t = quickAdd(s);
    assert.equal(t.content, s);
    assert.equal(t.due_date, null, s);
  }
});

test('words that only look like dates stay in the title', () => {
  for (const s of ['SAT prep', 'sun screen for the trip', 'march band practice', 'buy 3d printer filament', 'study 1h', 'read 2h of bio', 'run 5k', 'wed dress fitting']) {
    const t = quickAdd(s);
    assert.equal(t.content, s, s);
    assert.equal(t.due_date, null, s);
  }
});

test('the same short words do count as dates at the end of the line', () => {
  assert.equal(dow(quickAdd('essay sat').due_date), 6);
  assert.equal(quickAdd('essay sat').content, 'essay');
  assert.equal(dow(quickAdd('call grandma sun').due_date), 0);
  assert.equal(quickAdd('finish lab in 2 days').due_date, addDays(today, 2));
  assert.equal(quickAdd('finish lab in 2 days').content, 'finish lab');
});

test('a time with no am/pm means the afternoon', () => {
  const t = quickAdd('call dentist at 5');
  assert.equal(t.due_time, '17:00');
  assert.ok([today, addDays(today, 1)].includes(t.due_date));
  assert.equal(t.content, 'call dentist');
  assert.equal(quickAdd('gym tomorrow at 6').due_time, '18:00');
  assert.equal(quickAdd('gym tomorrow at 6').due_date, addDays(today, 1));
  assert.equal(quickAdd('gym tomorrow 6am').due_time, '06:00');
  assert.equal(quickAdd('class tomorrow at 9').due_time, '09:00');
});

test('repeats', () => {
  const t = quickAdd('Stretch every day at 7am #CS p2', { projects });
  assert.equal(t.content, 'Stretch');
  assert.equal(t.recurring, 1);
  assert.equal(t.due_string, 'every day at 7am');
  assert.equal(t.due_time, '07:00');
  assert.equal(t.due_date, today);
  assert.equal(t.project_id, 'cs');
  assert.equal(t.priority, 2);
  const s = quickAdd('do sheets every saturday');
  assert.equal(dow(s.due_date), 6);
  assert.equal(s.content, 'do sheets');
});

test('"every" that is not a repeat stays in the title', () => {
  const t = quickAdd('Thank every volunteer');
  assert.equal(t.content, 'Thank every volunteer');
  assert.equal(t.recurring, 0);
});

test('a title that is only a date keeps its text', () => {
  assert.equal(quickAdd('tomorrow').content, 'tomorrow');
  assert.equal(quickAdd('   ').content, '');
});
