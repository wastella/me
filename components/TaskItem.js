'use client';
import { useEffect, useId, useState } from 'react';
import { useApp } from './AppProvider';
import { Empty } from './ui';
import { humanDate, humanTime, todayStr, diffDays } from '@/lib/dates';
import { colorHex } from '@/lib/colors';
import { IconCheck, IconRepeat, IconTrash, IconFlag } from './Icons';

const PRIO = { 1: 'var(--p1)', 2: 'var(--p2)', 3: 'var(--p3)', 4: 'var(--p4)' };

// Unfinished tasks roll forward each day, so "past" just means today.
export function dueClass(date) {
  if (!date) return '';
  return diffDays(date, todayStr()) <= 0 ? 'today' : '';
}
function deadlineClass(date) {
  const d = diffDays(date, todayStr());
  return d < 0 ? 'late' : d <= 1 ? 'soon' : '';
}

// One task row. `showDate` is off in lists that are already about one day.
export default function TaskItem({ task, showProject = true, showDate = true, sub = false, drag }) {
  const { completeTask, openTask, deleteTask, projectById, justDragged } = useApp();
  const [done, setDone] = useState(false);
  const project = projectById[task.project_id];

  const onCheck = (e) => {
    e.stopPropagation();
    if (done) return;
    setDone(true);
    // Let the tick animate before the row leaves.
    setTimeout(() => { completeTask(task).finally(() => setDone(false)); }, 260);
  };
  const open = () => { if (!justDragged()) openTask(task); };

  const meta = [];
  if (task.due_date && showDate) meta.push(<span key="d" className={dueClass(task.due_date)}>{humanDate(task.due_date)}{task.due_time ? ` ${humanTime(task.due_time)}` : ''}</span>);
  else if (task.due_time) meta.push(<span key="t">{humanTime(task.due_time)}</span>);
  if (task.recurring) meta.push(<span key="r" title={`Repeats ${task.due_string || ''}`}><IconRepeat />{task.due_string}</span>);
  if (task.deadline) meta.push(<span key="f" className={deadlineClass(task.deadline)}><IconFlag />Due {humanDate(task.deadline).toLowerCase()}</span>);

  return (
    <li className={`task ${sub ? 'sub' : ''} ${done ? 'done' : ''} ${String(task.id).startsWith('tmp-') ? 'pending' : ''} ${drag?.className || ''}`} {...(drag?.props || {})}>
      <button className={`check ${done ? 'done' : ''}`} style={{ '--prio': PRIO[task.priority] }} onClick={onCheck} aria-label={`Complete “${task.content}”`}>
        <IconCheck strokeWidth="2.6" />
      </button>
      <div className="task-main" role="button" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); }}>
        <span className="task-title">{task.content}</span>
        {showProject && project && <span className="task-proj"><i className="swatch" style={{ background: colorHex(project.color) }} />{project.name}</span>}
        {task.description && <div className="task-desc">{task.description.split('\n')[0]}</div>}
        {(meta.length > 0 || (showProject && project)) && (
          <div className="task-meta">{meta}{showProject && project && <span className="proj-m"><i className="swatch" style={{ background: colorHex(project.color) }} />{project.name}</span>}</div>
        )}
      </div>
      <div className="task-actions">
        <button className="icon-btn sm" title="Delete" aria-label={`Delete “${task.content}”`} onClick={() => deleteTask(task)}><IconTrash /></button>
      </div>
    </li>
  );
}

// Renders tasks with their subtasks nested underneath. Pass `reorder` to
// make root tasks draggable: { field: 'day_order' | 'sort', patch } where
// `patch` is applied to a task dragged in from another list (new day,
// section or project). Dragging itself lives in AppProvider.
export function TaskList({ tasks, allTasks, showProject = true, showDate = true, empty, reorder }) {
  const { drag, startDrag, registerList } = useApp();
  const key = useId();
  const ids = new Set(tasks.map((t) => t.id));
  const roots = tasks.filter((t) => !t.parent_id || !ids.has(t.parent_id));
  const pool = allTasks || tasks;
  const order = roots.map((t) => t.id).join(',');
  useEffect(() => (reorder ? registerList(key, { order: order ? order.split(',') : [], reorder }) : undefined),
    [key, order, reorder?.field, JSON.stringify(reorder?.patch)]); // eslint-disable-line

  const target = drag?.target?.list === key ? drag.target.index : null;
  if (!roots.length) {
    if (reorder && drag) return <div className={`drop-zone ${target !== null ? 'on' : ''}`} data-drop-list={key}>Drop here</div>;
    return empty ? <Empty>{empty}</Empty> : null;
  }
  return (
    <ul className="task-list" data-drop-list={reorder ? key : undefined}>
      {roots.map((t, i) => {
        const kids = pool.filter((k) => k.parent_id === t.id);
        const lastOfList = i === roots.length - 1;
        const rowDrag = reorder ? {
          className: [target === i ? 'drop-before' : '', lastOfList && !kids.length && target === roots.length ? 'drop-after' : '', drag?.id === t.id ? 'dragging' : ''].join(' '),
          props: { 'data-list': key, 'data-index': i, onPointerDown: (e) => startDrag(e, t) },
        } : null;
        return (
          <FragmentWithKids key={t.id} task={t} kids={kids} showProject={showProject} showDate={showDate} drag={rowDrag}
            kidDrag={reorder ? (j) => ({ className: lastOfList && j === kids.length - 1 && target === roots.length ? 'drop-after' : '', props: { 'data-list': key, 'data-index': i, 'data-kid': '1' } }) : null} />
        );
      })}
    </ul>
  );
}
function FragmentWithKids({ task, kids, showProject, showDate, drag, kidDrag }) {
  return (
    <>
      <TaskItem task={task} showProject={showProject} showDate={showDate} drag={drag} />
      {kids.map((k, j) => <TaskItem key={k.id} task={k} showProject={false} showDate={false} sub drag={kidDrag ? kidDrag(j) : null} />)}
    </>
  );
}

// Order within a day is manual (drag to change); new tasks go to the end.
export function sortTasks(a, b) {
  return (a.due_date || '9999').localeCompare(b.due_date || '9999')
    || (a.day_order || 0) - (b.day_order || 0)
    || (a.created_at || '').localeCompare(b.created_at || '');
}
