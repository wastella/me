'use client';
import { useState } from 'react';
import { useApp } from './AppProvider';
import { humanDate, humanTime, todayStr, diffDays } from '@/lib/dates';
import { colorHex } from '@/lib/colors';
import { IconCheck, IconRepeat, IconTrash } from './Icons';

const PRIO = { 1: 'var(--p1)', 2: 'var(--p2)', 3: 'var(--p3)', 4: 'var(--p4)' };

export function dueClass(date) {
  if (!date) return '';
  const d = diffDays(date, todayStr());
  return d < 0 ? 'overdue' : d === 0 ? 'today' : d === 1 ? 'soon' : '';
}

export default function TaskItem({ task, showProject = true, sub = false }) {
  const { completeTask, openTask, deleteTask, projectById } = useApp();
  const [done, setDone] = useState(false);
  const project = projectById[task.project_id];

  const onCheck = (e) => {
    e.stopPropagation();
    setDone(true);
    setTimeout(() => { completeTask(task).finally(() => setDone(false)); }, 220);
  };

  return (
    <li className={`task ${sub ? 'sub' : ''} ${done ? 'done' : ''}`}>
      <button className={`check ${done ? 'done' : ''}`} style={{ '--prio': PRIO[task.priority] }} onClick={onCheck} aria-label="Complete task">
        <IconCheck />
      </button>
      <div className="task-main" onClick={() => openTask(task)}>
        <div className="task-title">{task.content}</div>
        {task.description && <div className="task-desc">{task.description.split('\n')[0]}</div>}
        <div className="task-meta">
          {task.due_date && (
            <span className={dueClass(task.due_date)}>
              {humanDate(task.due_date)}{task.due_time ? ` ${humanTime(task.due_time)}` : ''}
              {task.recurring && <IconRepeat style={{ width: 12, height: 12, marginLeft: 4, verticalAlign: -2 }} />}
            </span>
          )}
          {task.deadline && <span className={dueClass(task.deadline) === 'overdue' ? 'overdue' : ''}>⚑ {humanDate(task.deadline)}</span>}
          {task.labels.map((l) => <span key={l}>@{l}</span>)}
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

// Renders tasks with their subtasks nested underneath.
export function TaskList({ tasks, allTasks, showProject = true, empty }) {
  const ids = new Set(tasks.map((t) => t.id));
  const roots = tasks.filter((t) => !t.parent_id || !ids.has(t.parent_id));
  const pool = allTasks || tasks;
  if (!roots.length) return empty ? <div className="empty">{empty}</div> : null;
  return (
    <ul className="task-list">
      {roots.map((t) => (
        <FragmentWithKids key={t.id} task={t} pool={pool} showProject={showProject} />
      ))}
    </ul>
  );
}
function FragmentWithKids({ task, pool, showProject }) {
  const kids = pool.filter((k) => k.parent_id === task.id);
  return (
    <>
      <TaskItem task={task} showProject={showProject} />
      {kids.map((k) => <TaskItem key={k.id} task={k} showProject={false} sub />)}
    </>
  );
}

export function sortTasks(a, b) {
  return (a.due_date || '9999').localeCompare(b.due_date || '9999')
    || (a.due_time || '99').localeCompare(b.due_time || '99')
    || a.priority - b.priority || a.sort - b.sort;
}
