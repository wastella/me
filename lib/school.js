// School on autopilot: assignments from Google Classroom (read through the
// Google Calendar API) and from Blackboard / Brightspace calendar links
// become tasks in the project you pick for each course.
import { db, tx, kvGet, kvSet, now, newId } from './db.js';
import { parseICS } from './ics.js';
import { listCalendars, listEvents, googleConnected } from './google.js';
import { todayStr, addDays } from './dates.js';
import { zonedISO, localDate, localTime } from './tz.js';

const KEY = 'school';
const AHEAD = 120;                 // days of upcoming work to import
export async function getConfig() { return (await kvGet(KEY)) || { feeds: [], courses: {}, classroom: true }; }
async function saveConfig(c) { await kvSet(KEY, c); }

export async function addFeed({ name, url }) {
  url = String(url || '').trim().replace(/^webcal:\/\//i, 'https://');
  if (!/^https:\/\/[^\s]+$/i.test(url)) throw Object.assign(new Error('Paste the full calendar link (https:// or webcal://).'), { status: 400 });
  const c = await getConfig();
  c.feeds.push({ id: newId().slice(0, 8), name: String(name || 'School').trim().slice(0, 40), url });
  await saveConfig(c);
}
export async function removeFeed(id) { const c = await getConfig(); c.feeds = c.feeds.filter((f) => f.id !== id); await saveConfig(c); }
export async function setClassroom(on) { const c = await getConfig(); c.classroom = !!on; await saveConfig(c); }

// Course -> project id, or 'skip'. Remapping moves that course's open tasks.
export async function mapCourse(course, projectId) {
  const c = await getConfig();
  c.courses[course] = { ...(c.courses[course] || {}), project: projectId };
  await saveConfig(c);
  if (projectId && projectId !== 'skip') {
    await (await db()).run("UPDATE tasks SET project_id = ? WHERE source = 'school' AND completed_at IS NULL AND source_course = ?", projectId, course);
  }
}

// Brightspace/Blackboard noise that isn't an assignment.
const NOT_WORK = /(availability|available|start date|end date|course (starts|ends)|office hours|class (starts|ends)|^lecture)/i;
const cleanTitle = (s) => s.replace(/\s*[-–]\s*(due|due date)$/i, '').replace(/^assignment:\s*/i, '').trim();

async function fromFeed(feed) {
  const res = await fetch(feed.url, { headers: { Accept: 'text/calendar' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${feed.name}: link returned ${res.status}`);
  const text = await res.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error(`${feed.name}: that link didn't return a calendar`);
  return parseICS(text).filter((e) => e.summary && !NOT_WORK.test(e.summary) && e.status !== 'CANCELLED').map((e) => {
    const when = e.due || e.start;
    const course = (e.location || e.categories || (e.description || '').split(/[\n,]/)[0] || feed.name).trim().slice(0, 60);
    return { uid: `${feed.id}:${e.uid}`, title: cleanTitle(e.summary), date: when?.date, time: when?.time, course, source: feed.name, notes: [(e.description || '').slice(0, 500), e.url].filter(Boolean).join('\n') };
  });
}

async function fromClassroom() {
  if (!(await googleConnected())) return [];
  const cals = (await listCalendars()).filter((c) => /classroom/i.test(c.id));
  if (!cals.length) return [];
  const today = todayStr();
  const evs = await listEvents(zonedISO(today), zonedISO(addDays(today, AHEAD)), { calendarIds: cals.map((c) => c.id), includeHidden: true });
  return evs.map((e) => ({
    uid: `classroom:${e.id}`, title: cleanTitle(e.title), course: e.calendar, source: 'Google Classroom',
    date: e.allDay ? e.start : localDate(e.start), time: e.allDay ? null : localTime24(e.start),
    notes: [(e.description || '').replace(/<[^>]+>/g, ' ').slice(0, 500), e.link].filter(Boolean).join('\n'),
  }));
}
const localTime24 = (iso) => { const t = localTime(iso); const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i); if (!m) return null; let h = Number(m[1]) % 12; if (/pm/i.test(m[3])) h += 12; return `${String(h).padStart(2, '0')}:${m[2]}`; };

export async function sync() {
  const c = await getConfig();
  const errors = [];
  const items = [];
  if (c.classroom) { try { items.push(...await fromClassroom()); } catch (e) { errors.push(`Google Classroom: ${e.message}`); } }
  for (const f of c.feeds) { try { items.push(...await fromFeed(f)); } catch (e) { errors.push(e.message); } }

  const today = todayStr(); const until = addDays(today, AHEAD);
  const q = await db();
  const fallback = (await q.get("SELECT id FROM projects WHERE name = 'School' AND archived = 0"))?.id || (await q.get('SELECT id FROM projects WHERE is_inbox = 1')).id;
  // Remember every course seen so Settings can map it.
  for (const it of items) if (!c.courses[it.course]) c.courses[it.course] = { project: null, source: it.source };
  let added = 0, updated = 0;
  await tx(async (t) => {
    for (const it of items) {
      // Only upcoming work: past assignments are assumed handled.
      if (!it.date || it.date < today || it.date > until) continue;
      const map = c.courses[it.course]?.project;
      if (map === 'skip') continue;
      const project = map || fallback;
      const existing = await t.get('SELECT id, due_date, due_time, source_due, completed_at FROM tasks WHERE source_id = ?', `school:${it.uid}`);
      if (existing) {
        if (existing.completed_at) continue;
        // Follow the school's date only if you haven't moved the task yourself.
        const moved = existing.source_due && existing.due_date !== existing.source_due;
        await t.run('UPDATE tasks SET content = ?, description = ?, due_date = ?, due_time = ?, source_due = ?, updated_at = ? WHERE id = ?',
          it.title, it.notes, moved ? existing.due_date : it.date, moved ? existing.due_time : it.time, it.date, now(), existing.id);
        updated++;
        continue;
      }
      const twin = await t.get("SELECT id FROM tasks WHERE completed_at IS NULL AND lower(content) = lower(?) AND (due_date IS NULL OR due_date = ? OR due_date = ?) AND (source IS NULL OR source != 'school')", it.title, it.date, today);
      if (twin) {
        await t.run("UPDATE tasks SET source = 'school', source_id = ?, source_course = ?, source_due = ? WHERE id = ?", `school:${it.uid}`, it.course, it.date, twin.id);
        updated++;
        continue;
      }
      const { m } = await t.get('SELECT COALESCE(MAX(day_order), 0) + 1 m FROM tasks WHERE completed_at IS NULL AND due_date = ?', it.date);
      await t.run(`INSERT INTO tasks (id, project_id, content, description, priority, due_date, due_time, labels, sort, day_order, created_at, updated_at, source, source_id, source_course, source_due)
        VALUES (?, ?, ?, ?, 2, ?, ?, '[]', 0, ?, ?, ?, 'school', ?, ?, ?)`, newId(), project, it.title, it.notes, it.date, it.time, m, now(), now(), `school:${it.uid}`, it.course, it.date);
      added++;
    }
  });
  c.last_sync = now();
  c.last_result = { added, updated, found: items.length, errors };
  await saveConfig(c);
  return c.last_result;
}

// Called when the app loads tasks; syncs at most every 30 minutes.
export async function maybeSync() {
  const c = await getConfig();
  if (!c.classroom && !c.feeds.length) return;
  if (c.last_sync && Date.now() - new Date(c.last_sync).getTime() < 30 * 60_000) return;
  await sync();
}
