'use client';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '@/components/AppProvider';
import QuickAdd from '@/components/QuickAdd';
import { TaskList, sortTasks } from '@/components/TaskItem';
import { Skeleton, LoadError, Empty, Popover, useDialog, useMounted } from '@/components/ui';
import { IconPlus, IconMore, IconCheck } from '@/components/Icons';
import { api, useApi } from '@/lib/client';
import { todayStr, addDays, humanDate, parse } from '@/lib/dates';
import { colorHex, PALETTE } from '@/lib/colors';

export default function Page() {
  return <Suspense fallback={null}><Tasks /></Suspense>;
}

function Tasks() {
  const app = useApp();
  const { tasks, projects, sections, projectById, tasksLoading, tasksError, reloadTasks, attempt } = app;
  const { prompt } = useDialog();
  const params = useSearchParams();
  const router = useRouter();
  const mounted = useMounted();
  const view = params.get('view') || 'today';
  const go = (v) => router.push(`/tasks?view=${encodeURIComponent(v)}`);
  const today = todayStr();
  const [search, setSearch] = useState('');
  const searchRef = useRef(null);
  // "/" jumps to search.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || document.body.classList.contains('sheet-open')) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      e.preventDefault(); searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const term = search.trim().toLowerCase();

  const counts = useMemo(() => {
    const c = { today: 0 };
    for (const t of tasks) {
      if (t.parent_id) continue;
      if (t.due_date && t.due_date <= today) c.today++;
      c['p:' + t.project_id] = (c['p:' + t.project_id] || 0) + 1;
    }
    return c;
  }, [tasks, today]);

  const newProject = async () => {
    const name = await prompt({ title: 'New project', label: 'Project name', confirmLabel: 'Create' });
    if (!name) return;
    const p = await attempt(() => api('/api/projects', { method: 'POST', body: { name } }));
    if (p) { await reloadTasks(); go('p:' + p.id); }
  };

  const project = view.startsWith('p:') ? projectById[view.slice(2)] : null;
  let title = 'Today', sub = null, body = null, defaults = {}, tools = null;
  if (term) {
    const hits = tasks.filter((t) => `${t.content}\n${t.description || ''}\n${projectById[t.project_id]?.name || ''}`.toLowerCase().includes(term)).sort(sortTasks);
    title = 'Search';
    sub = `${hits.length} ${hits.length === 1 ? 'task' : 'tasks'} found`;
    body = <TaskList tasks={hits} empty="No tasks match." />;
  } else if (view === 'today') {
    defaults = { due_date: today };
    const list = tasks.filter((t) => t.due_date && t.due_date <= today).sort(sortTasks);
    sub = mounted ? parse(today).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : ' ';
    body = <TaskList tasks={list} allTasks={tasks} showDate={false} empty="Nothing left for today." reorder={{ field: 'day_order', patch: { due_date: today } }} />;
  } else if (view === 'upcoming') {
    title = 'Upcoming';
    const days = Array.from({ length: 14 }, (_, i) => addDays(today, i + 1));
    const later = tasks.filter((t) => t.due_date && t.due_date > days[days.length - 1]).sort(sortTasks);
    const undated = tasks.filter((t) => !t.due_date && !t.parent_id).sort(sortTasks);
    body = (
      <>
        {days.map((d, i) => {
          const list = tasks.filter((t) => t.due_date === d).sort(sortTasks);
          return (
            <div key={d}>
              <div className={`group-title ${list.length ? '' : 'quiet'}`}>{i < 6 ? humanDate(d) : parse(d).toLocaleDateString(undefined, { weekday: 'long' })} <span className="count">{parse(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{list.length ? ` · ${list.length}` : ''}</span></div>
              <TaskList tasks={list} allTasks={tasks} showDate={false} reorder={{ field: 'day_order', patch: { due_date: d } }} />
            </div>
          );
        })}
        {later.length > 0 && <><div className="group-title">Later <span className="count">{later.length}</span></div><TaskList tasks={later} allTasks={tasks} /></>}
        <div className="group-title">No date {undated.length > 0 && <span className="count">{undated.length}</span>}</div>
        <TaskList tasks={undated} allTasks={tasks} empty="Everything has a date." reorder={{ field: 'day_order', patch: { due_date: null } }} />
      </>
    );
  } else if (view === 'done') {
    title = 'Completed';
    body = <History />;
  } else if (project) {
    title = project.name;
    defaults = { project_id: project.id };
    const inProj = tasks.filter((t) => t.project_id === project.id);
    const secs = sections.filter((s) => s.project_id === project.id);
    const loose = inProj.filter((t) => !t.section_id).sort((a, b) => a.sort - b.sort);
    tools = <ProjectMenu project={project} onDeleted={() => go('today')} />;
    body = (
      <>
        <TaskList tasks={loose} allTasks={tasks} showProject={false} empty={secs.length ? null : 'No tasks here yet.'} reorder={{ field: 'sort', patch: { section_id: null, project_id: project.id } }} />
        {secs.map((s) => {
          const list = inProj.filter((t) => t.section_id === s.id).sort((a, b) => a.sort - b.sort);
          return (
            <div key={s.id}>
              <div className="group-title">{s.name} <span className="count">{list.length || ''}</span><span className="tools"><SectionMenu section={s} /></span></div>
              <TaskList tasks={list} allTasks={tasks} showProject={false} reorder={{ field: 'sort', patch: { section_id: s.id, project_id: project.id } }} />
              <div style={{ padding: '8px 0 4px' }}><QuickAdd hotkey={false} placeholder={`Add to ${s.name}`} defaults={{ project_id: project.id, section_id: s.id }} /></div>
            </div>
          );
        })}
      </>
    );
  } else {
    title = 'Tasks';
    body = tasksLoading ? null : <Empty title="That project is gone"><button className="btn" onClick={() => go('today')}>Back to Today</button></Empty>;
  }

  return (
    <div className="tasks-layout">
      <nav className="views" aria-label="Task views">
        <ViewBtn on={view === 'today'} onClick={() => go('today')} n={counts.today}>Today</ViewBtn>
        <ViewBtn on={view === 'upcoming'} onClick={() => go('upcoming')}>Upcoming</ViewBtn>
        <ViewBtn on={view === 'done'} onClick={() => go('done')}>Completed</ViewBtn>
        <div className="label">Projects <button className="icon-btn sm" title="New project" aria-label="New project" onClick={newProject}><IconPlus /></button></div>
        {projects.map((p) => (
          <ViewBtn key={p.id} on={view === 'p:' + p.id} onClick={() => go('p:' + p.id)} n={counts['p:' + p.id]}>
            <i className="swatch" style={{ background: colorHex(p.color) }} />{p.name}
          </ViewBtn>
        ))}
        <button className="view-link only-phone" aria-label="New project" onClick={newProject}><IconPlus style={{ width: 14, height: 14 }} /><span className="name">Project</span></button>
      </nav>
      <section>
        <div className="page-head">
          <div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
          <div className="head-tools notes-tools">
            <input ref={searchRef} className="input notes-search" type="search" placeholder="Search tasks" aria-label="Search tasks" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); e.currentTarget.blur(); } }} />
            {!term && tools}
          </div>
        </div>
        {!term && view !== 'done' && (project || view === 'today' || view === 'upcoming') && <div style={{ marginBottom: 6 }}><QuickAdd defaults={defaults} placeholder={view === 'upcoming' ? 'Add a task — try “essay friday p1”' : project ? `Add to ${project.name}` : 'Add a task for today'} /></div>}
        {tasksError ? <LoadError error={tasksError} onRetry={reloadTasks} /> : tasksLoading && (term || view !== 'done') ? <Skeleton rows={6} /> : body}
      </section>
    </div>
  );
}

function ViewBtn({ on, onClick, n, children }) {
  return <button className={`view-link ${on ? 'active' : ''}`} aria-current={on ? 'page' : undefined} onClick={onClick}><span className="name row nowrap">{children}</span>{n ? <span className="n">{n}</span> : null}</button>;
}

function ProjectMenu({ project, onDeleted }) {
  const { reloadTasks, attempt, tasks } = useApp();
  const { confirm, prompt } = useDialog();
  if (project.is_inbox) return null;
  const addSection = async () => {
    const name = await prompt({ title: 'New section', label: 'Section name', confirmLabel: 'Add' });
    if (name && await attempt(() => api('/api/sections', { method: 'POST', body: { project_id: project.id, name } }))) reloadTasks();
  };
  const rename = async () => {
    const name = await prompt({ title: 'Rename project', label: 'Project name', initial: project.name, confirmLabel: 'Rename' });
    if (name && name !== project.name && await attempt(() => api(`/api/projects/${project.id}`, { method: 'PATCH', body: { name } }))) reloadTasks();
  };
  const recolor = async (color) => { if (await attempt(() => api(`/api/projects/${project.id}`, { method: 'PATCH', body: { color } }))) reloadTasks(); };
  const del = async () => {
    const n = tasks.filter((t) => t.project_id === project.id).length;
    const ok = await confirm({ title: `Delete “${project.name}”?`, body: n ? `Its ${n} open task${n === 1 ? '' : 's'} will be deleted too. This can’t be undone.` : 'This can’t be undone.', confirmLabel: 'Delete project', danger: true });
    if (ok && await attempt(() => api(`/api/projects/${project.id}`, { method: 'DELETE' }))) { onDeleted(); reloadTasks(); }
  };
  return (
    <Popover label="Project options" button={({ toggle, open, props }) => <button className={`icon-btn ${open ? 'on' : ''}`} onClick={toggle} {...props}><IconMore /></button>}>
      {(close) => (
        <>
          <button className="pop-item" role="menuitem" onClick={() => { close(); addSection(); }}>Add section</button>
          <button className="pop-item" role="menuitem" onClick={() => { close(); rename(); }}>Rename project</button>
          <div className="pop-sep" />
          <div className="pop-label">Color</div>
          <div className="pop-colors">
            {PALETTE.map((c) => <button key={c} aria-label={c.replace('_', ' ')} aria-pressed={project.color === c} style={{ '--c': colorHex(c) }} onClick={() => { close(); recolor(c); }} />)}
          </div>
          <div className="pop-sep" />
          <button className="pop-item danger" role="menuitem" onClick={() => { close(); del(); }}>Delete project</button>
        </>
      )}
    </Popover>
  );
}

function SectionMenu({ section }) {
  const { reloadTasks, attempt } = useApp();
  const { confirm, prompt } = useDialog();
  const rename = async () => {
    const name = await prompt({ title: 'Rename section', label: 'Section name', initial: section.name, confirmLabel: 'Rename' });
    if (name && name !== section.name && await attempt(() => api('/api/sections', { method: 'PATCH', body: { id: section.id, name } }))) reloadTasks();
  };
  const del = async () => {
    const ok = await confirm({ title: `Remove “${section.name}”?`, body: 'Its tasks stay in the project.', confirmLabel: 'Remove section', danger: true });
    if (ok && await attempt(() => api(`/api/sections?id=${encodeURIComponent(section.id)}`, { method: 'DELETE' }))) reloadTasks();
  };
  return (
    <Popover label="Section options" button={({ toggle, open, props }) => <button className={`icon-btn sm ${open ? 'on' : ''}`} onClick={toggle} {...props}><IconMore /></button>}>
      {(close) => (
        <>
          <button className="pop-item" role="menuitem" onClick={() => { close(); rename(); }}>Rename section</button>
          <button className="pop-item danger" role="menuitem" onClick={() => { close(); del(); }}>Remove section</button>
        </>
      )}
    </Popover>
  );
}

function History() {
  const h = useApi('/api/history');
  if (h.error && !h.data) return <LoadError error={h.error} onRetry={h.reload} />;
  if (!h.data) return <Skeleton rows={6} />;
  if (!h.data.items.length) return <Empty title="Nothing completed yet">Finished tasks show up here.</Empty>;
  const byDay = new Map();
  for (const c of h.data.items) {
    const d = new Date(c.completed_at).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(c);
  }
  return [...byDay].map(([d, list]) => (
    <div key={d}>
      <div className="group-title">{d} <span className="count">{list.length}</span></div>
      <ul className="task-list">
        {list.map((c) => (
          <li key={c.id} className="task">
            <span className="check done" style={{ '--prio': 'var(--ok)' }} aria-hidden="true"><IconCheck strokeWidth="2.6" /></span>
            <div className="task-main" style={{ cursor: 'default' }}>
              <span className="task-title muted">{c.content}</span>
              {c.project && <span className="task-proj"><i className="swatch" style={{ background: colorHex(c.color) }} />{c.project}</span>}
              <div className="task-meta"><span>{new Date(c.completed_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  ));
}
