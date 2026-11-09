'use client';
import { useEffect, useId, useState } from 'react';
import { useApp } from './AppProvider';
import { humanDate, humanTime, todayStr, diffDays } from '@/lib/dates';
import { colorHex } from '@/lib/colors';
import { IconCheck, IconRepeat, IconTrash } from './Icons';

const PRIO = { 1: 'var(--p1)', 2: 'var(--p2)', 3: 'var(--p3)', 4: 'var(--p4)' };

// Unfinished tasks roll forward each day, so "past" just means today.
export function dueClass(date) {
  if (!date) return '';
  const d = diffDays(date, todayStr());
  return d <= 0 ? 'today' : d === 1 ? 'soon' : '';
}

export default function TaskItem({ task, showProject = true, sub = false, drag }) {
  const { completeTask, openTask, deleteTask, projectById, justDragged } = useApp();
  const [done, setDone] = useState(false);
  const project = projectById[task.project_id];

  const onCheck = (e) => {
    e.stopPropagation();
    setDone(true);
    setTimeout(() => { completeTask(task).finally(() => setDone(false)); }, 220);
  };

  return (
    <li className={`task ${sub ? 'sub' : ''} ${done ? 'done' : ''} ${drag?.className || ''}`} {...(drag?.props || {})}>
      <button className={`check ${done ? 'done' : ''}`} style={{ '--prio': PRIO[task.priority] }} onClick={onCheck} aria-label="Complete task">
        <IconCheck />
      </button>
      <div className="task-main" onClick={() => { if (!justDragged()) openTask(task); }}>
        <div className="task-title">{task.content}</div>
        {task.description && <div className="task-desc">{task.description.split('\n')[0]}</div>}
        <div className="task-meta">
          {task.due_date && (
            <span className={dueClass(task.due_date)}>
              {humanDate(task.due_date)}{task.due_time ? ` ${humanTime(task.due_time)}` : ''}
              {task.recurring && <IconRepeat style={{ width: 12, height: 12, marginLeft: 4, verticalAlign: -2 }} />}
            </span>
          )}
          {task.source === 'school' && task.source_course && <span className="course">{task.source_course}</span>}
          {task.deadline && <span className={diffDays(task.deadline, todayStr()) < 0 ? 'overdue' : ''}>⚑ {humanDate(task.deadline)}</span>}
          {showProject && project && (
            <span className="proj"><i style={{ background: colorHex(project.color) }} />{project.name}</span>
          )}
        </div>
      </div>
      <div className="task-actions">
        <button className="icon-btn" title="Delete" onClick={() => deleteTask(task)}><IconTrash /></button>
      </div>
    </li>
  );
}

// Renders tasks with their subtasks nested underneath. Pass `reorder` to
// make root tasks draggable: { field: 'day_order' | 'sort', patch } where
// `patch` is applied to a task dragged in from another list (new day,
// section or project). Dragging itself lives in AppProvider.
export function TaskList({ tasks, allTasks, showProject = true, empty, reorder }) {
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
    return empty ? <div className="empty">{empty}</div> : null;
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
          <FragmentWithKids key={t.id} task={t} kids={kids} showProject={showProject} drag={rowDrag}
            kidDrag={reorder ? (j) => ({ className: lastOfList && j === kids.length - 1 && target === roots.length ? 'drop-after' : '', props: { 'data-list': key, 'data-index': i, 'data-kid': '1' } }) : null} />
        );
      })}
    </ul>
  );
}
function FragmentWithKids({ task, kids, showProject, drag, kidDrag }) {
  return (
    <>
      <TaskItem task={task} showProject={showProject} drag={drag} />
      {kids.map((k, j) => <TaskItem key={k.id} task={k} showProject={false} sub drag={kidDrag ? kidDrag(j) : null} />)}
    </>
  );
}

// Order within a day is manual (drag to change); new tasks go to the end.
export function sortTasks(a, b) {
  return (a.due_date || '9999').localeCompare(b.due_date || '9999')
    || (a.day_order || 0) - (b.day_order || 0)
    || (a.created_at || '').localeCompare(b.created_at || '');
}
