// Fills the LOCAL database (data/me.db, or ME_DATA_DIR) with sample data so
// every screen has something to show. Refuses to touch the cloud database.
//   npm run seed
if (process.env.TURSO_DATABASE_URL) { console.error('Refusing to seed: TURSO_DATABASE_URL is set (that is the real database).'); process.exit(1); }
const { db, kvSet } = await import('../lib/db.js');
const { createTask, completeTask } = await import('../lib/tasks.js');
const { createNote, createCategory } = await import('../lib/notes.js');
const { upsertExercise, upsertPostureStep, saveWorkout, togglePosture } = await import('../lib/training.js');
const { todayStr, addDays } = await import('../lib/dates.js');

const q = await db();
if ((await q.get('SELECT COUNT(*) n FROM tasks')).n > 0 && !process.argv.includes('--force')) {
  console.log('Database already has tasks; nothing to do. Use --force to add sample data anyway.'); process.exit(0);
}
const today = todayStr();
await kvSet('name', 'William');

for (const t of [
  'do sheets every saturday p1 #Chores', 'do whites every saturday p1 #Chores', 'do towels every other sunday #Chores',
  'Workout every day p1 #Fitness', 'work on college apps every day p1 #CollegeApps',
  'Physics 2: MP Ch 19 problems 3-4 today p2 #School', 'English: full rough draft of research essay today p1 #English',
  'Do the enumerators lab next saturday p1 #CS', 'schedule CCP work this week every monday #School',
  'Email counselor about transcript tomorrow p3', 'Renew library books in 3 days', 'Look into summer programs',
  'Read chapter 20 friday #School',
]) await createTask({ text: t });
const essay = (await q.get("SELECT id FROM tasks WHERE content LIKE 'English:%'")).id;
await q.run("UPDATE tasks SET description = ?, deadline = ? WHERE id = ?", 'Real deadline is Sunday 11:59 PM. Check the rubric before submitting.', addDays(today, 1), essay);
for (const s of ['Outline counterargument', 'Find two more sources']) await createTask({ text: s, parent_id: essay, project_id: (await q.get('SELECT project_id p FROM tasks WHERE id = ?', essay)).p });
const done = await createTask({ text: 'Submit stats homework today #School' });
await completeTask(done.id);

const ideas = await createCategory({ name: 'Ideas', color: 'blue' });
const school = await createCategory({ name: 'School', color: 'green' });
await createNote({ body: 'App ideas\nA week-ahead strip on Home.\nDeadlines separate from do-dates.', category_id: ideas.id, pinned: true });
await createNote({ body: 'Essay sources\nJSTOR article on urban heat islands\nEPA 2024 report', category_id: school.id });
await createNote({ body: 'Locker combo is on the sticky note in the desk drawer' });

const ex = {};
const add = async (day, name, sets, reps, kind = 'weight') => { ex[name] = await upsertExercise({ day, name, sets, reps, kind }); };
await add('upper', 'Bench Press', 3, '5'); await add('upper', 'Pullups', 3, '8'); await add('upper', 'Incline DB Bench', 3, '8');
await add('upper', 'Dumbbell Row', 3, '8'); await add('upper', 'DB Curl', 3, '8'); await add('upper', 'Abs', null, null, 'note');
await add('lower', 'Squat', 3, '5'); await add('lower', 'RDL', 3, '8'); await add('lower', 'Split Squat', 3, '8');
await add('lower', 'Calf Raise', 3, '8'); await add('lower', 'Abs ', null, null, 'note');
const upper = (b, p) => [['Bench Press', b], ['Pullups', p], ['Incline DB Bench', 30], ['Dumbbell Row', 25], ['DB Curl', 20]];
const lower = (s, r) => [['Squat', s], ['RDL', r], ['Split Squat', 5], ['Calf Raise', 25]];
const sessions = [[-40, 'upper', upper(95, 0)], [-38, 'lower', lower(95, 85)], [-33, 'upper', upper(100, 10)], [-30, 'lower', lower(105, 95)],
  [-24, 'upper', upper(105, 20)], [-21, 'lower', lower(115, 95)], [-14, 'upper', upper(107.5, 30)], [-10, 'lower', lower(120, 105)], [-3, 'upper', upper(110, 40)]];
for (const [off, day, sets] of sessions) {
  await saveWorkout({ date: addDays(today, off), day, sets: [...sets.map(([n, w]) => ({ exercise_id: ex[n], weight: w })), { exercise_id: ex[day === 'upper' ? 'Abs' : 'Abs '], note: day === 'upper' ? 'Plank 2x45 sec' : 'Toe touches 2x20' }] });
}
const steps = [];
for (const s of ['Wall angels', 'Band over-and-backs', "World's greatest stretch", 'Couch quad stretch', 'Deep squat']) steps.push(await upsertPostureStep({ name: s }));
for (let i = 1; i <= 20; i++) if (i % 4) for (const s of steps.slice(0, i % 3 ? 5 : 3)) await togglePosture(addDays(today, -i), s, true);
await togglePosture(today, steps[0], true);
console.log('Sample data added.');
process.exit(0);
