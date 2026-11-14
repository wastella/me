'use client';
import { useEffect, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import { Sheet, Segmented, useAutoGrow } from './ui';
import { IconTrash } from './Icons';
import { parseRecurrence, firstDue } from '@/lib/dates';
import { quickAdd } from '@/lib/quickadd';
import { TaskList } from './TaskItem';
import QuickAdd from './QuickAdd';

const PRIORITIES = [[1, 'P1', 'Highest', { '--c': 'var(--p1)' }], [2, 'P2', 'High', { '--c': 'var(--p2)' }], [3, 'P3', 'Medium', { '--c': 'var(--p3)' }], [4, 'None', 'No priority', { '--c': 'var(--text)' }]];

// Task details: a side panel on a computer, a sheet on a phone. Every field
// saves as soon as you leave it; there is no Save button.
export default function TaskEditor({ task, onClose }) {
  const { updateTask, deleteTask, projects, sections, tasks } = useApp();
  const [f, setF] = useState(task);
  const [repeat, setRepeat] = useState(task.recurring ? task.due_string || '' : '');
  const [repeatErr, setRepeatErr] = useState(false);
  const titleRef = useRef(null);
  const notesRef = useRef(null);
  useEffect(() => { setF(task); setRepeat(task.recurring ? task.due_string || '' : ''); setRepeatErr(false); }, [task.id]); // eslint-disable-line
  useAutoGrow(titleRef, f.content);
  useAutoGrow(notesRef, f.description, 44);

  const save = (patch) => { setF((x) => ({ ...x, ...patch })); updateTask(task.id, patch); };

  const setDate = (value) => {
    if (value) return save({ due_date: value });
    setRepeat('');
    save({ due_date: null, due_time: null, due_string: null, recurring: false });   // no date means no time or repeat either
  };
  const applyRepeat = () => {
    const s = repeat.trim();
    setRepeatErr(false);
    if (!s) { if (f.recurring) save({ recurring: false, due_string: null }); return; }
    if (s === (f.recurring ? f.due_string : '')) return;
    if (!parseRecurrence(s)) { setRepeatErr(true); return; }
    const time = quickAdd(`x ${s}`).due_time;
    save({ due_string: s, recurring: true, due_date: f.due_date || firstDue(s), ...(time ? { due_time: time } : {}) });
  };

  const projSections = sections.filter((s) => s.project_id === f.project_id);
  const subtasks = tasks.filter((t) => t.parent_id === task.id);

  return (
    <Sheet variant="drawer" label="Task details" onClose={onClose}
      title={(
        <select className="input auto" aria-label="Project" value={f.project_id || ''} onChange={(e) => save({ project_id: e.target.value, section_id: null })}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
      tools={<button className="icon-btn" title="Delete task" aria-label="Delete task" onClick={() => deleteTask(task)}><IconTrash /></button>}>
      <div>
        <textarea ref={titleRef} className="title-input" rows={1} aria-label="Task name" value={f.content}
          onChange={(e) => setF({ ...f, content: e.target.value.replace(/\n/g, ' ') })}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
          onBlur={() => { const c = f.content.trim(); if (!c) setF({ ...f, content: task.content }); else if (c !== task.content) save({ content: c }); }} />
        <textarea ref={notesRef} className="editor-notes" placeholder="Notes" aria-label="Notes" value={f.description || ''}
          onChange={(e) => setF({ ...f, description: e.target.value })}
          onBlur={() => (f.description || '') !== (task.description || '') && save({ description: f.description || '' })} />
      </div>

      <div className="props">
        <label htmlFor="te-date">Date</label>
        <div className="row nowrap">
          <input id="te-date" className="input" type="date" value={f.due_date || ''} onChange={(e) => setDate(e.target.value)} />
          <input className="input" type="time" aria-label="Time" value={f.due_time || ''} disabled={!f.due_date} onChange={(e) => save({ due_time: e.target.value || null })} />
        </div>
        <label htmlFor="te-repeat">Repeat</label>
        <div className="field">
          <input id="te-repeat" className="input" placeholder="Doesn’t repeat" value={repeat} autoComplete="off" autoCapitalize="none"
            onChange={(e) => { setRepeat(e.target.value); setRepeatErr(false); }} onBlur={applyRepeat}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} aria-invalid={repeatErr} aria-describedby="te-repeat-hint" />
          {repeatErr
            ? <span id="te-repeat-hint" style={{ color: 'var(--danger)' }}>Try “every monday”, “every other sunday” or “every 2 weeks”.</span>
            : !f.recurring && <span id="te-repeat-hint" className="field-hint">For example “every saturday” or “every 3 days”.</span>}
        </div>
        <label htmlFor="te-deadline">Deadline</label>
        <input id="te-deadline" className="input" type="date" value={f.deadline || ''} onChange={(e) => save({ deadline: e.target.value || null })} />
        <label>Priority</label>
        <Segmented className="prio-seg" label="Priority" value={f.priority} onChange={(p) => save({ priority: p })} options={PRIORITIES} />
        {projSections.length > 0 && (
          <>
            <label htmlFor="te-section">Section</label>
            <select id="te-section" className="input" value={f.section_id || ''} onChange={(e) => save({ section_id: e.target.value || null })}>
              <option value="">None</option>
              {projSections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </>
        )}
      </div>

      {!task.parent_id && (
        <div>
          <div className="sub-head">Subtasks</div>
          <TaskList tasks={subtasks} showProject={false} showDate={false} />
          <div style={{ marginTop: 8 }}>
            <QuickAdd hotkey={false} placeholder="Add a subtask" defaults={{ parent_id: task.id, project_id: task.project_id, section_id: task.section_id }} />
          </div>
        </div>
      )}
      <div className="sheet-foot">
        <span>Added {new Date(task.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      </div>
    </Sheet>
  );
}
