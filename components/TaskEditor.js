'use client';
import { useEffect, useState } from 'react';
import { useApp } from './AppProvider';
import { IconX, IconTrash } from './Icons';
import { parseRecurrence, firstDue } from '@/lib/dates';
import { quickAdd } from '@/lib/quickadd';
import { TaskList } from './TaskItem';
import QuickAdd from './QuickAdd';

export default function TaskEditor({ task, onClose }) {
  const { updateTask, deleteTask, projects, sections, tasks } = useApp();
  const [f, setF] = useState(task);
  const [dueText, setDueText] = useState(task.due_string || '');
  useEffect(() => { setF(task); setDueText(task.due_string || ''); }, [task.id]); // eslint-disable-line

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const save = (patch) => { setF((x) => ({ ...x, ...patch })); updateTask(task.id, patch); };

  // Free-text due field: "every monday", "next fri 3pm", "" to clear.
  const applyDueText = () => {
    const s = dueText.trim();
    if (!s) return save({ due_date: null, due_time: null, due_string: null, recurring: false });
    if (parseRecurrence(s)) {
      const q = quickAdd(`x ${s}`);
      return save({ due_string: s, recurring: true, due_date: f.recurring && f.due_date ? f.due_date : firstDue(s), due_time: q.due_time || f.due_time || null });
    }
    const q = quickAdd(`x ${s}`);
    if (q.due_date) save({ due_date: q.due_date, due_time: q.due_time, due_string: s, recurring: false });
  };

  const projSections = sections.filter((s) => s.project_id === f.project_id);
  const subtasks = tasks.filter((t) => t.parent_id === task.id);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-label="Edit task">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <select className="input" style={{ width: 'auto' }} value={f.project_id || ''} onChange={(e) => save({ project_id: e.target.value, section_id: null })}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="row" style={{ gap: 2 }}>
            <button className="icon-btn" title="Delete" onClick={() => deleteTask(task)}><IconTrash /></button>
            <button className="icon-btn" title="Close (Esc)" onClick={onClose}><IconX /></button>
          </div>
        </div>
        <input className="title-input" value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })}
          onBlur={() => f.content.trim() && f.content !== task.content && save({ content: f.content.trim() })} />
        <textarea className="input" placeholder="Notes" value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })}
          onBlur={() => f.description !== task.description && save({ description: f.description })} />

        <label className="field">Due — type a date or a repeat (“every other sunday”, “fri 3pm”)
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="input" value={dueText} onChange={(e) => setDueText(e.target.value)} onBlur={applyDueText}
              onKeyDown={(e) => e.key === 'Enter' && applyDueText()} placeholder="No date" />
            <input className="input" type="date" style={{ width: 160 }} value={f.due_date || ''} onChange={(e) => save({ due_date: e.target.value || null, ...(f.recurring ? {} : { due_string: null }) })} />
          </div>
        </label>
        <div className="row">
          <label className="field" style={{ flex: 1 }}>Time
            <input className="input" type="time" value={f.due_time || ''} onChange={(e) => save({ due_time: e.target.value || null })} />
          </label>
          <label className="field" style={{ flex: 1 }}>Deadline
            <input className="input" type="date" value={f.deadline || ''} onChange={(e) => save({ deadline: e.target.value || null })} />
          </label>
        </div>

        <label className="field">Priority
          <div className="prio-pick">
            {[1, 2, 3, 4].map((p) => (
              <button key={p} type="button" className={f.priority === p ? 'on' : ''} style={{ color: `var(--p${p})` }} onClick={() => save({ priority: p })}>P{p}</button>
            ))}
          </div>
        </label>

        {projSections.length > 0 && (
          <label className="field">Section
            <select className="input" value={f.section_id || ''} onChange={(e) => save({ section_id: e.target.value || null })}>
              <option value="">(none)</option>
              {projSections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}


        {!task.parent_id && (
          <div>
            <div className="field" style={{ marginBottom: 6 }}>Subtasks</div>
            <TaskList tasks={subtasks} showProject={false} />
            <div style={{ marginTop: 8 }}>
              <QuickAdd hotkey={false} placeholder="Add subtask" defaults={{ parent_id: task.id, project_id: task.project_id, section_id: task.section_id }} />
            </div>
          </div>
        )}
        <div className="muted" style={{ fontSize: 12, marginTop: 'auto' }}>
          {task.source === 'todoist' ? 'Imported from Todoist · ' : ''}Created {new Date(task.created_at).toLocaleDateString()}
        </div>
      </aside>
    </div>
  );
}
