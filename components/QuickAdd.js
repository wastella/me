'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import { quickAdd } from '@/lib/quickadd';
import { humanDate, humanTime } from '@/lib/dates';

export default function QuickAdd({ defaults = {}, placeholder = 'Add a task — try “Call mom tomorrow 5pm p1 #Inbox”', autoFocus, hotkey = true }) {
  const { addTask, projects, labels, projectById } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef();

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e) => {
      if (e.key === 'q' && !e.metaKey && !e.ctrlKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        e.preventDefault(); ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkey]);

  const preview = useMemo(() => (text.trim() ? quickAdd(text, { projects, labels }) : null), [text, projects, labels]);

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await addTask({ text, ...defaults });
      setText('');
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit}>
      <div className="quickadd">
        <span className="plus">+</span>
        <input ref={ref} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
          onKeyDown={(e) => e.key === 'Escape' && (setText(''), e.currentTarget.blur())} />
        {hotkey && !text && <span className="kbd" style={{ marginRight: 8 }}>Q</span>}
        {text && <button className="btn primary" disabled={busy}>Add</button>}
      </div>
      {preview && (
        <div className="qa-preview">
          {preview.due_date && <span className="chip date">📅 {humanDate(preview.due_date)}{preview.due_time ? ` ${humanTime(preview.due_time)}` : ''}{preview.recurring ? ' · repeats' : ''}</span>}
          {preview.priority < 4 && <span className="chip" style={{ color: `var(--p${preview.priority})` }}>P{preview.priority}</span>}
          {preview.project_id && <span className="chip"># {projectById[preview.project_id]?.name}</span>}
          {preview.newProject && <span className="chip"># {preview.newProject} (new)</span>}
          {preview.labels.map((l) => <span className="chip" key={l}>@{l}</span>)}
        </div>
      )}
    </form>
  );
}
