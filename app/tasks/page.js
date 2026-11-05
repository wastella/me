'use client';
import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '@/components/AppProvider';
import QuickAdd from '@/components/QuickAdd';
import { TaskList, sortTasks } from '@/components/TaskItem';
import { api, useApi } from '@/lib/client';
import { todayStr, addDays, humanDate, parse } from '@/lib/dates';
import { colorHex } from '@/lib/colors';

export default function Page() {
  return <Suspense fallback={null}><Tasks /></Suspense>;
}

function Tasks() {
  const app = useApp();
  const { tasks, projects, labels, sections, projectById } = app;
  const params = useSearchParams();
  const router = useRouter();
  const inbox = projects.find((p) => p.is_inbox);
  const view = params.get('view') || 'today';
  const go = (v) => router.push(`/tasks?view=${encodeURIComponent(v)}`);
  const today = todayStr();

  const counts = useMemo(() => {
    const c = { today: 0, upcoming: 0 };
    for (const t of tasks) {
      if (t.due_date && t.due_date <= today) c.today++;
      c['p:' + t.project_id] = (c['p:' + t.project_id] || 0) + 1;
      for (const l of t.labels) c['l:' + l] = (c['l:' + l] || 0) + 1;
    }
    return c;
  }, [tasks, today]);

  let title = 'Today', body = null, defaults = {};
  if (view === 'today') {
    defaults = { due_date: today };
    const overdue = tasks.filter((t) => t.due_date && t.due_date < today).sort(sortTasks);
    const td = tasks.filter((t) => t.due_date === today).sort(sortTasks);
    body = (
      <>
        {overdue.length > 0 && <><div className="group-title overdue">Overdue <span className="count">{overdue.length}</span></div><TaskList tasks={overdue} allTasks={tasks} /></>}
        <div className="group-title">{parse(today).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} <span className="count">{td.length}</span></div>
        <TaskList tasks={td} allTasks={tasks} empty="Nothing due today." />
      </>
    );
  } else if (view === 'upcoming') {
    title = 'Upcoming';
    const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
    const later = tasks.filter((t) => t.due_date && t.due_date > days[days.length - 1]).sort(sortTasks);
    body = (
      <>
        {days.map((d) => {
          const list = tasks.filter((t) => t.due_date === d || (d === today && t.due_date < today)).sort(sortTasks);
          return (
            <div key={d}>
              <div className="group-title">{humanDate(d)} <span className="count">{parse(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{list.length ? ` · ${list.length}` : ''}</span></div>
              <TaskList tasks={list} allTasks={tasks} />
            </div>
          );
        })}
        {later.length > 0 && <><div className="group-title">Later <span className="count">{later.length}</span></div><TaskList tasks={later} allTasks={tasks} /></>}
        <div className="group-title">No date</div>
        <TaskList tasks={tasks.filter((t) => !t.due_date && !t.parent_id).sort(sortTasks)} allTasks={tasks} empty="Everything has a date." />
      </>
    );
  } else if (view.startsWith('p:')) {
    const p = projectById[view.slice(2)];
    title = p?.name || 'Project';
    defaults = { project_id: p?.id };
    const inProj = tasks.filter((t) => t.project_id === p?.id);
    const secs = sections.filter((s) => s.project_id === p?.id);
    const loose = inProj.filter((t) => !t.section_id).sort((a, b) => a.sort - b.sort);
    body = (
      <>
        <TaskList tasks={loose} allTasks={tasks} showProject={false} empty={secs.length ? null : 'No tasks here yet.'} />
        {secs.map((s) => {
          const list = inProj.filter((t) => t.section_id === s.id).sort((a, b) => a.sort - b.sort);
          return (
            <div key={s.id}>
              <div className="group-title">{s.name} <span className="count">{list.length}</span></div>
              <TaskList tasks={list} allTasks={tasks} showProject={false} />
              <div style={{ padding: '6px 0 4px' }}><QuickAdd hotkey={false} placeholder={`Add to ${s.name}`} defaults={{ project_id: p.id, section_id: s.id }} /></div>
            </div>
          );
        })}
        {p && !p.is_inbox && <ProjectTools project={p} onDeleted={() => go('today')} />}
      </>
    );
  } else if (view.startsWith('l:')) {
    const l = view.slice(2);
    title = `@${l}`;
    body = <TaskList tasks={tasks.filter((t) => t.labels.includes(l)).sort(sortTasks)} allTasks={tasks} empty="No tasks with this label." />;
  } else if (view === 'done') {
    title = 'Completed';
    body = <History />;
  }

  return (
    <div className="tasks-layout">
      <aside className="views">
        <ViewBtn on={view === 'today'} onClick={() => go('today')} n={counts.today}>☀️ Today</ViewBtn>
        <ViewBtn on={view === 'upcoming'} onClick={() => go('upcoming')}>📅 Upcoming</ViewBtn>
        {inbox && <ViewBtn on={view === 'p:' + inbox.id} onClick={() => go('p:' + inbox.id)} n={counts['p:' + inbox.id]}>📥 Inbox</ViewBtn>}
        <ViewBtn on={view === 'done'} onClick={() => go('done')}>✅ Completed</ViewBtn>
        <div className="label">Projects <NewProject onCreated={(p) => { app.reloadTasks(); go('p:' + p.id); }} /></div>
        {projects.filter((p) => !p.is_inbox).map((p) => (
          <ViewBtn key={p.id} on={view === 'p:' + p.id} onClick={() => go('p:' + p.id)} n={counts['p:' + p.id]}>
            <i style={{ background: colorHex(p.color) }} />{p.name}
          </ViewBtn>
        ))}
        {labels.length > 0 && <div className="label">Labels</div>}
        {labels.filter((l) => counts['l:' + l.name]).map((l) => (
          <ViewBtn key={l.id} on={view === 'l:' + l.name} onClick={() => go('l:' + l.name)} n={counts['l:' + l.name]}>
            <span style={{ color: colorHex(l.color) }}>@</span>{l.name}
          </ViewBtn>
        ))}
      </aside>
      <section>
        <div className="page-head"><h1>{title}</h1></div>
        {view !== 'done' && <div style={{ marginBottom: 8 }}><QuickAdd defaults={defaults} /></div>}
        {body}
      </section>
    </div>
  );
}

function ViewBtn({ on, onClick, n, children }) {
  return <button className={`view-link ${on ? 'active' : ''}`} onClick={onClick}>{children}{n ? <span className="n">{n}</span> : null}</button>;
}

function NewProject({ onCreated }) {
  const add = async () => {
    const name = prompt('New project name');
    if (name?.trim()) onCreated(await api('/api/projects', { method: 'POST', body: { name } }));
  };
  return <button className="icon-btn" style={{ width: 22, height: 22 }} title="New project" onClick={add}>+</button>;
}

function ProjectTools({ project, onDeleted }) {
  const { reloadTasks } = useApp();
  const [busy, setBusy] = useState(false);
  const addSection = async () => {
    const name = prompt('Section name');
    if (!name?.trim()) return;
    await api('/api/sections', { method: 'POST', body: { project_id: project.id, name: name.trim() } });
    reloadTasks();
  };
  const rename = async () => {
    const name = prompt('Rename project', project.name);
    if (!name?.trim()) return;
    await api(`/api/projects/${project.id}`, { method: 'PATCH', body: { name: name.trim() } });
    reloadTasks();
  };
  const del = async () => {
    if (!confirm(`Delete “${project.name}” and all its tasks?`)) return;
    setBusy(true);
    await api(`/api/projects/${project.id}`, { method: 'DELETE' });
    reloadTasks(); onDeleted();
  };
  return (
    <div className="row" style={{ marginTop: 24 }}>
      <button className="btn ghost" onClick={addSection}>+ Section</button>
      <button className="btn ghost" onClick={rename}>Rename</button>
      <button className="btn ghost danger" onClick={del} disabled={busy}>Delete project</button>
    </div>
  );
}

function History() {
  const h = useApi('/api/history');
  if (!h.data) return <div className="empty"><span className="spin" /></div>;
  const byDay = {};
  for (const c of h.data.items) {
    const d = new Date(c.completed_at).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    (byDay[d] ||= []).push(c);
  }
  return Object.entries(byDay).map(([d, list]) => (
    <div key={d}>
      <div className="group-title">{d} <span className="count">{list.length}</span></div>
      <ul className="task-list">
        {list.map((c) => (
          <li key={c.id} className="task done">
            <span className="check done" style={{ '--prio': 'var(--ok)' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
            <div className="task-main"><div className="task-title">{c.content}</div>
              <div className="task-meta"><span>{new Date(c.completed_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                {c.project && <span className="proj"><i style={{ background: colorHex(c.color) }} />{c.project}</span>}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  ));
}
