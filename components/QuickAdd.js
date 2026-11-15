'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import { quickAdd } from '@/lib/quickadd';
import { humanDate, humanTime } from '@/lib/dates';
import { IconPlus } from './Icons';

// One-line task entry. Understands dates, repeats, p1–p4 and #Project as you
// type, and shows what it understood underneath before you press Enter.
export default function QuickAdd({ defaults = {}, placeholder = 'Add a task', hotkey = true, label, autoFocus = false, onAdded }) {
  const { addTask, projects, projectById } = useApp();
  const [text, setText] = useState('');
  const ref = useRef();

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e) => {
      if (e.key !== 'q' || e.metaKey || e.ctrlKey || e.altKey) return;
      const a = document.activeElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(a?.tagName) || a?.isContentEditable || document.body.classList.contains('sheet-open')) return;
      e.preventDefault(); ref.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkey]);

  const preview = useMemo(() => (text.trim() ? quickAdd(text, { projects }) : null), [text, projects]);

  const submit = async (e) => {
    e.preventDefault();
    const sent = text;
    if (!sent.trim()) return;
    setText(''); ref.current?.focus();   // ready for the next one straight away
    const added = await addTask({ text: sent, ...defaults });
    if (added) onAdded?.();
    else setText((now) => now || sent);   // if it didn't save, the text comes back so nothing is lost
  };

  const chips = preview && [
    preview.due_date && <span key="d" className="chip date">{humanDate(preview.due_date)}{preview.due_time ? ` ${humanTime(preview.due_time)}` : ''}{preview.recurring ? ' · repeats' : ''}</span>,
    preview.priority < 4 && <span key="p" className="chip" style={{ color: `var(--p${preview.priority})` }}>P{preview.priority}</span>,
    preview.project_id && <span key="j" className="chip">{projectById[preview.project_id]?.name}</span>,
    preview.newProject && <span key="n" className="chip">New project: {preview.newProject}</span>,
  ].filter(Boolean);

  return (
    <form onSubmit={submit}>
      <div className="quickadd">
        <span className="plus" aria-hidden="true"><IconPlus /></span>
        <input ref={ref} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={label || placeholder}
          enterKeyHint="done" autoComplete="off" autoCapitalize="sentences" data-qa-hotkey={hotkey ? '' : undefined} data-autofocus={autoFocus ? '' : undefined}
          onKeyDown={(e) => { if (e.key === 'Escape') { setText(''); e.currentTarget.blur(); } }} />
        {hotkey && !text && <span className="kbd" aria-hidden="true">Q</span>}
        {text.trim() && <button className="btn primary sm">Add</button>}
      </div>
      {chips?.length > 0 && <div className="qa-preview" aria-live="polite">{chips}</div>}
    </form>
  );
}
