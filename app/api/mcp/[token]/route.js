// "Ask Me": an MCP server so Claude (claude.ai, the Claude apps, Claude Code)
// can read and change your tasks, calendar and training. The URL carries a
// long secret (MCP_TOKEN); without it every request is refused.
import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { db } from '@/lib/db';
import { snapshot as taskSnapshot, createTask, updateTask, completeTask, deleteTask } from '@/lib/tasks';
import { snapshot as trainingSnapshot, saveWorkout, togglePosture } from '@/lib/training';
import { listEvents, createEvent, googleConnected } from '@/lib/google';
import { todayStr, addDays } from '@/lib/dates';
import { zonedISO, localTime, localDate } from '@/lib/tz';

const text = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const fail = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true });
const PRIO = { 1: 'p1', 2: 'p2', 3: 'p3', 4: 'p4' };

async function projects() { return (await db()).all('SELECT id, name, is_inbox FROM projects WHERE archived = 0 ORDER BY is_inbox, sort, name'); }
async function projectId(name) {
  if (!name) return undefined;
  const list = await projects();
  const norm = (s) => s.toLowerCase().replace(/[\s_-]+/g, '');
  const hit = list.find((p) => norm(p.name) === norm(name));
  if (!hit) throw new Error(`No project named "${name}". Projects: ${list.map((p) => p.name).join(', ')}`);
  return hit.id;
}
function shapeTask(t, byId) {
  return { id: t.id, task: t.content, project: byId[t.project_id]?.name, due: t.due_date, time: t.due_time, repeats: t.recurring ? t.due_string : undefined, priority: PRIO[t.priority], notes: t.description || undefined, subtask_of: t.parent_id || undefined };
}
async function events(start, end) {
  if (!(await googleConnected())) return [];
  const list = await listEvents(zonedISO(start), zonedISO(addDays(end, 1)));
  return list.filter((e) => !e.declined).map((e) => ({
    title: e.title, calendar: e.calendar, location: e.location || undefined,
    date: e.allDay ? e.start : localDate(e.start),
    time: e.allDay ? 'all day' : `${localTime(e.start)} – ${localTime(e.end)}`,
  })).filter((e) => e.date >= start && e.date <= end);
}

const handler = createMcpHandler((server) => {
  server.registerTool('get_today', {
    title: 'Today', description: "Overview of the user's day: date, calendar events, tasks due today (unfinished tasks from earlier days roll into today), today's training (upper/lower lift or rest) and posture routine progress. Call this first for planning questions.",
    inputSchema: z.object({}),
  }, async () => {
    const today = todayStr();
    const [{ tasks, projects: ps }, tr, ev] = await Promise.all([taskSnapshot(), trainingSnapshot(), events(today, today)]);
    const byId = Object.fromEntries(ps.map((p) => [p.id, p]));
    const done = new Set(tr.postureLog.filter((l) => l.date === today).map((l) => l.step_id));
    return text({
      date: today, weekday: new Date(`${today}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' }),
      events: ev,
      tasks_due: tasks.filter((t) => t.due_date && t.due_date <= today).map((t) => shapeTask(t, byId)),
      training: { status: tr.plan.status, lift: tr.plan.status === 'rest' ? 'rest day' : tr.plan.day, next_lift: `${tr.plan.nextDay} on ${tr.plan.nextDate}` },
      posture: tr.posture.map((s) => ({ step: s.name, done: done.has(s.id) })),
    });
  });

  server.registerTool('list_tasks', {
    title: 'List tasks', description: 'List open tasks. view: "today" (due today), "upcoming" (next 14 days), "undated", "all", or filter by project name.',
    inputSchema: z.object({ view: z.enum(['today', 'upcoming', 'undated', 'all']).default('all'), project: z.string().optional() }),
  }, async ({ view, project }) => {
    const { tasks, projects: ps } = await taskSnapshot();
    const byId = Object.fromEntries(ps.map((p) => [p.id, p]));
    const today = todayStr(); const until = addDays(today, 14);
    const pid = project ? await projectId(project) : null;
    const list = tasks.filter((t) => (!pid || t.project_id === pid) && (
      view === 'today' ? t.due_date && t.due_date <= today
      : view === 'upcoming' ? t.due_date && t.due_date > today && t.due_date <= until
      : view === 'undated' ? !t.due_date : true));
    return text(list.map((t) => shapeTask(t, byId)));
  });

  server.registerTool('list_projects', {
    title: 'List projects', description: 'Projects tasks belong to (each task has exactly one; "Misc" is the default).',
    inputSchema: z.object({}),
  }, async () => text((await projects()).map((p) => p.name)));

  server.registerTool('add_task', {
    title: 'Add task',
    description: 'Create a task. `text` accepts quick-add syntax, e.g. "Read ch. 3 friday 5pm p1 #CS" or "Stretch every day at 7am". Optional fields override what the text implies. Priorities: 1 (most urgent) to 4.',
    inputSchema: z.object({
      text: z.string().min(1), project: z.string().optional(), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      due_time: z.string().regex(/^\d{2}:\d{2}$/).optional(), priority: z.number().int().min(1).max(4).optional(), notes: z.string().optional(),
    }),
  }, async (a) => {
    try {
      let t = await createTask({ text: a.text, project_id: await projectId(a.project) });
      const patch = {};
      if (a.due_date) patch.due_date = a.due_date;
      if (a.due_time) patch.due_time = a.due_time;
      if (a.priority) patch.priority = a.priority;
      if (a.notes) patch.description = a.notes;
      if (Object.keys(patch).length) t = await updateTask(t.id, patch);
      const byId = Object.fromEntries((await projects()).map((p) => [p.id, p]));
      return text({ added: shapeTask(t, byId) });
    } catch (e) { return fail(e.message); }
  });

  server.registerTool('update_task', {
    title: 'Update task', description: 'Change a task by id (from list_tasks/get_today). Set due_date to null to remove the date.',
    inputSchema: z.object({
      id: z.string(), task: z.string().optional(), notes: z.string().optional(), project: z.string().optional(),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), due_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
      priority: z.number().int().min(1).max(4).optional(),
    }),
  }, async ({ id, task, notes, project, ...rest }) => {
    try {
      const patch = { ...rest };
      if (task) patch.content = task;
      if (notes !== undefined) patch.description = notes;
      if (project) patch.project_id = await projectId(project);
      const t = await updateTask(id, patch);
      if (!t) return fail('No task with that id.');
      const byId = Object.fromEntries((await projects()).map((p) => [p.id, p]));
      return text({ updated: shapeTask(t, byId) });
    } catch (e) { return fail(e.message); }
  });

  server.registerTool('complete_task', {
    title: 'Complete task', description: 'Mark a task done. Repeating tasks move to their next date.',
    inputSchema: z.object({ id: z.string() }),
  }, async ({ id }) => {
    try { const r = await completeTask(id); return text(r.rescheduled ? `Done. Next due ${r.rescheduled}.` : 'Done.'); }
    catch (e) { return fail(e.message); }
  });

  server.registerTool('delete_task', {
    title: 'Delete task', description: 'Permanently delete a task (and its subtasks). Confirm with the user first.',
    inputSchema: z.object({ id: z.string() }),
  }, async ({ id }) => { await deleteTask(id); return text('Deleted.'); });

  server.registerTool('get_calendar', {
    title: 'Calendar', description: "Events from the user's Google calendars between two dates (inclusive, YYYY-MM-DD, user's timezone).",
    inputSchema: z.object({ start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  }, async ({ start_date, end_date }) => text(await events(start_date, end_date)));

  server.registerTool('create_event', {
    title: 'Create event', description: "Add an event to the user's primary Google Calendar. Times are HH:MM in the user's timezone; omit times for an all-day event.",
    inputSchema: z.object({
      title: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(), end_time: z.string().regex(/^\d{2}:\d{2}$/).optional(), location: z.string().optional(),
    }),
  }, async ({ title, date, start_time, end_time, location }) => {
    try {
      if (!start_time) { await createEvent({ title, allDay: true, start: date, end: addDays(date, 1), location }); return text(`Added "${title}" on ${date} (all day).`); }
      const endT = end_time || (() => { const [h, m] = start_time.split(':').map(Number); const t = h * 60 + m + 60; return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; })();
      await createEvent({ title, start: `${date}T${start_time}:00`, end: `${date}T${endT}:00`, location });
      return text(`Added "${title}" on ${date}, ${start_time}–${endT}.`);
    } catch (e) { return fail(e.message); }
  });

  server.registerTool('get_training', {
    title: 'Training', description: "The user's upper/lower lifting split (every other day, alternating) and daily posture routine: today's plan, each exercise with sets×reps and last weight, and recent sessions.",
    inputSchema: z.object({ sessions: z.number().int().min(0).max(30).default(6) }),
  }, async ({ sessions }) => {
    const d = await trainingSnapshot();
    const byId = Object.fromEntries(d.exercises.map((e) => [e.id, e]));
    return text({
      plan: d.plan.status === 'done' ? `lifted ${d.plan.day} today; next ${d.plan.nextDay} on ${d.plan.nextDate}` : d.plan.status === 'rest' ? `rest day; next ${d.plan.nextDay} on ${d.plan.nextDate}` : `${d.plan.day} day today`,
      exercises: d.exercises.map((e) => ({ day: e.day, exercise: e.name, prescription: e.sets && e.reps ? `${e.sets}x${e.reps}` : undefined, last: d.last[e.id] ? (e.kind === 'weight' && d.last[e.id].weight !== null ? `${d.last[e.id].weight} lb` : d.last[e.id].note) : undefined })),
      recent: d.history.slice(0, sessions).map((w) => ({ date: w.date, day: w.day, sets: w.sets.map((s) => `${byId[s.exercise_id]?.name || '?'}: ${s.weight ?? ''}${s.note ? ` ${s.note}` : ''}`.trim()) })),
    });
  });

  server.registerTool('log_workout', {
    title: 'Log workout', description: 'Record a lifting session. Each entry names an exercise from get_training with the weight in lb (0 = bodyweight) and/or a note.',
    inputSchema: z.object({
      day: z.enum(['upper', 'lower']), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      entries: z.array(z.object({ exercise: z.string(), weight: z.number().min(0).optional(), note: z.string().optional() })).min(1),
    }),
  }, async ({ day, date, entries }) => {
    const d = await trainingSnapshot();
    const find = (n) => d.exercises.find((e) => e.day === day && e.name.toLowerCase() === n.toLowerCase()) || d.exercises.find((e) => e.day === day && e.name.toLowerCase().includes(n.toLowerCase()));
    const missing = entries.filter((x) => !find(x.exercise)).map((x) => x.exercise);
    if (missing.length) return fail(`Unknown ${day} exercise(s): ${missing.join(', ')}. Options: ${d.exercises.filter((e) => e.day === day).map((e) => e.name).join(', ')}`);
    await saveWorkout({ day, date: date || todayStr(), sets: entries.map((x) => ({ exercise_id: find(x.exercise).id, weight: x.weight ?? '', note: x.note || '' })) });
    return text(`Logged ${day} for ${date || todayStr()} (${entries.length} exercises).`);
  });

  server.registerTool('check_posture', {
    title: 'Posture routine', description: "Mark posture steps done (or not) for today. Pass step names, or all=true for the whole routine.",
    inputSchema: z.object({ steps: z.array(z.string()).optional(), all: z.boolean().optional(), done: z.boolean().default(true) }),
  }, async ({ steps = [], all, done }) => {
    const d = await trainingSnapshot();
    const pick = all ? d.posture : d.posture.filter((s) => steps.some((n) => s.name.toLowerCase().includes(n.toLowerCase())));
    if (!pick.length) return fail(`No matching steps. Steps: ${d.posture.map((s) => s.name).join(', ')}`);
    for (const s of pick) await togglePosture(todayStr(), s.id, done);
    return text(`${done ? 'Checked' : 'Unchecked'}: ${pick.map((s) => s.name).join(', ')}`);
  });
}, { serverInfo: { name: 'me', version: '1.0.0' } });

function authorized(token) {
  const want = process.env.MCP_TOKEN || '';
  if (!want || !token || token.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(want));
}

async function guarded(req, ctx) {
  const { token } = await ctx.params;
  if (!authorized(token)) return new Response('Not found', { status: 404 });
  return handler(req);
}
export { guarded as GET, guarded as POST, guarded as DELETE };
