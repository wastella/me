// One-way import from Todoist's v1 API. Safe to re-run: rows are matched on
// their Todoist id, so a second run updates instead of duplicating.
import { db, tx, now, newId, kvSet } from './db.js';
import { todoistToken } from './env.js';

const API = 'https://api.todoist.com/api/v1';

async function get(path, token, params = {}) {
  const out = [];
  let cursor = null;
  do {
    const url = new URL(API + path);
    for (const [k, v] of Object.entries({ limit: 200, ...params })) url.searchParams.set(k, v);
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Todoist ${path} → ${res.status} ${await res.text()}`);
    const body = await res.json();
    out.push(...(body.results || body.items || []));
    cursor = body.next_cursor;
  } while (cursor);
  return out;
}

// Todoist due → local date + optional HH:MM
function splitDue(due) {
  if (!due?.date) return { date: null, time: null };
  const raw = due.datetime || due.date;
  if (!raw.includes('T')) return { date: raw, time: null };
  if (/Z$|[+-]\d\d:\d\d$/.test(raw)) {
    const d = new Date(raw);
    const p = (n) => String(n).padStart(2, '0');
    return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
  }
  const [date, t] = raw.split('T');
  return { date, time: t.slice(0, 5) };
}

// Todoist priority: 4 = urgent (shown as p1). We store the human number.
const prio = (p) => 5 - (p || 1);

export async function importTodoist({ historyMonths = 24, log = () => {} } = {}) {
  const token = todoistToken();
  if (!token) throw new Error('No Todoist token in .env.local (TODOIST_API_TOKEN=...)');

  log('Fetching projects, sections, labels, tasks…');
  const [projects, sections, labels, tasks] = await Promise.all([
    get('/projects', token), get('/sections', token), get('/labels', token), get('/tasks', token),
  ]);

  const commentsByTask = {};
  for (const t of tasks.filter((t) => t.note_count > 0)) {
    commentsByTask[t.id] = await get('/comments', token, { task_id: t.id });
  }

  log(`Fetching completed history (${historyMonths} months)…`);
  const completed = [];
  const end = new Date();
  for (let i = 0; i < historyMonths; i += 3) {
    const until = new Date(end); until.setMonth(end.getMonth() - i);
    const since = new Date(end); since.setMonth(end.getMonth() - Math.min(i + 3, historyMonths));
    const items = await get('/tasks/completed/by_completion_date', token, {
      since: since.toISOString(), until: until.toISOString(),
    });
    completed.push(...items);
  }

  const counts = tx((d) => {
    const pid = {}; const sid = {};
    const inbox = d.prepare('SELECT id FROM projects WHERE is_inbox = 1').get().id;

    const upP = d.prepare(`INSERT INTO projects (id, name, color, parent_id, sort, is_inbox, is_favorite, archived, source, source_id)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'todoist', ?)
      ON CONFLICT(source_id) DO UPDATE SET name=excluded.name, color=excluded.color, sort=excluded.sort,
        is_favorite=excluded.is_favorite, archived=excluded.archived`);
    for (const p of projects) {
      if (p.inbox_project) {
        d.prepare("UPDATE projects SET source='todoist', source_id=? WHERE id=?").run(p.id, inbox);
        pid[p.id] = inbox; continue;
      }
      upP.run(newId(), p.name, p.color, null, p.child_order ?? 0, p.is_favorite ? 1 : 0, p.is_archived ? 1 : 0, p.id);
      pid[p.id] = d.prepare('SELECT id FROM projects WHERE source_id=?').get(p.id).id;
    }
    for (const p of projects) {
      if (p.parent_id && pid[p.parent_id]) d.prepare('UPDATE projects SET parent_id=? WHERE id=?').run(pid[p.parent_id], pid[p.id]);
    }

    const upS = d.prepare(`INSERT INTO sections (id, project_id, name, sort, source_id) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET project_id=excluded.project_id, name=excluded.name, sort=excluded.sort`);
    for (const s of sections) {
      if (s.is_archived || s.is_deleted) continue;
      upS.run(newId(), pid[s.project_id] || inbox, s.name, s.section_order ?? 0, s.id);
      sid[s.id] = d.prepare('SELECT id FROM sections WHERE source_id=?').get(s.id).id;
    }

    const upL = d.prepare(`INSERT INTO labels (id, name, color, sort, source_id) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET color=excluded.color, sort=excluded.sort, source_id=excluded.source_id`);
    for (const l of labels) upL.run(newId(), l.name, l.color, l.order ?? 0, l.id);

    const upT = d.prepare(`INSERT INTO tasks (id, project_id, section_id, parent_id, content, description, priority,
        due_date, due_time, due_string, recurring, deadline, duration_min, labels, sort, completed_at, created_at, updated_at, source, source_id)
      VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'todoist', ?)
      ON CONFLICT(source_id) DO UPDATE SET project_id=excluded.project_id, section_id=excluded.section_id,
        content=excluded.content, description=excluded.description, priority=excluded.priority,
        due_date=excluded.due_date, due_time=excluded.due_time, due_string=excluded.due_string,
        recurring=excluded.recurring, deadline=excluded.deadline, duration_min=excluded.duration_min,
        labels=excluded.labels, sort=excluded.sort, updated_at=excluded.updated_at`);
    const tid = {};
    for (const t of tasks) {
      const { date, time } = splitDue(t.due);
      const dur = t.duration ? (t.duration.unit === 'day' ? t.duration.amount * 1440 : t.duration.amount) : null;
      upT.run(newId(), pid[t.project_id] || inbox, sid[t.section_id] || null, t.content, t.description || '',
        prio(t.priority), date, time, t.due?.string || null, t.due?.is_recurring ? 1 : 0,
        t.deadline?.date || null, dur, JSON.stringify(t.labels || []), t.child_order ?? 0,
        t.added_at || now(), now(), t.id);
      tid[t.id] = d.prepare('SELECT id FROM tasks WHERE source_id=?').get(t.id).id;
    }
    for (const t of tasks) {
      if (t.parent_id && tid[t.parent_id]) d.prepare('UPDATE tasks SET parent_id=? WHERE id=?').run(tid[t.parent_id], tid[t.id]);
    }

    const upC = d.prepare(`INSERT INTO comments (id, task_id, content, posted_at, source_id) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET content=excluded.content`);
    let nComments = 0;
    for (const [taskSrc, list] of Object.entries(commentsByTask)) {
      for (const c of list) { if (!c.is_deleted) { upC.run(newId(), tid[taskSrc], c.content, c.posted_at, c.id); nComments++; } }
    }

    const upH = d.prepare(`INSERT INTO completions (task_id, content, project_id, completed_at, source_id) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO NOTHING`);
    for (const c of completed) {
      upH.run(tid[c.id] || null, c.content, pid[c.project_id] || inbox, c.completed_at, `${c.id}@${c.completed_at}`);
    }

    return { projects: projects.length, sections: Object.keys(sid).length, labels: labels.length, tasks: tasks.length, comments: nComments, completed: completed.length };
  });

  kvSet('todoist_last_import', { at: now(), counts });
  log(`Imported ${JSON.stringify(counts)}`);
  return counts;
}
