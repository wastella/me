'use client';
// Shared building blocks: sheets (modals, drawers, bottom sheets on phone),
// in-app confirm/prompt dialogs, popover menus and small display helpers.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { IconX } from './Icons';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const openSheets = [];   // topmost last, so Esc and Tab only affect the front one

/* A dialog surface. variant "modal" is centred, "drawer" slides in from the
   right; on a phone both become a sheet rising from the bottom. Traps focus,
   closes on Esc or a click outside, and returns focus where it came from. */
export function Sheet({ onClose, title, label, tools, variant = 'modal', wide = false, className = '', children }) {
  const ref = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const el = ref.current;
    const before = document.activeElement;
    openSheets.push(el);
    document.body.classList.add('sheet-open');
    (el.querySelector('[data-autofocus]') || el).focus({ preventScroll: true });
    const onKey = (e) => {
      if (openSheets[openSheets.length - 1] !== el) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      openSheets.splice(openSheets.indexOf(el), 1);
      if (!openSheets.length) document.body.classList.remove('sheet-open');
      if (before && document.contains(before)) before.focus?.({ preventScroll: true });
    };
  }, []);
  return (
    <div className={`scrim ${variant}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`sheet ${variant} ${wide ? 'wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-label={label || (typeof title === 'string' ? title : undefined)} tabIndex={-1}>
        <span className="grabber" aria-hidden="true" />
        <header className="sheet-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          <div className="head-tools">{tools}<button type="button" className="icon-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}><IconX /></button></div>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/* In-app replacements for the browser's confirm() and prompt() boxes:
     const { confirm, prompt } = useDialog();
     if (await confirm({ title, body, confirmLabel, danger })) …
     const name = await prompt({ title, label, initial, confirmLabel });   // null when cancelled */
const DialogCtx = createContext(null);
export const useDialog = () => useContext(DialogCtx);

export function DialogProvider({ children }) {
  const [d, setD] = useState(null);
  const [text, setText] = useState('');
  const api = useMemo(() => ({
    confirm: (opts) => new Promise((resolve) => setD({ kind: 'confirm', ...opts, resolve })),
    prompt: (opts) => new Promise((resolve) => { setText(opts.initial || ''); setD({ kind: 'prompt', ...opts, resolve }); }),
  }), []);
  const finish = (value) => { d.resolve(value); setD(null); };
  const cancel = () => finish(d.kind === 'prompt' ? null : false);
  const submit = (e) => {
    e.preventDefault();
    if (d.kind === 'confirm') return finish(true);
    if (text.trim()) finish(text.trim());
  };
  return (
    <DialogCtx.Provider value={api}>
      {children}
      {d && (
        <Sheet className="dialog" title={d.title} onClose={cancel}>
          <form onSubmit={submit} style={{ display: 'contents' }}>
            {d.body && <p className="dialog-text">{d.body}</p>}
            {d.kind === 'prompt' && (
              <input className="input" data-autofocus aria-label={d.label || d.title} placeholder={d.placeholder || d.label || ''} value={text} maxLength={d.maxLength || 80}
                onChange={(e) => setText(e.target.value)} onFocus={(e) => e.target.select()} autoComplete="off" />
            )}
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={cancel}>Cancel</button>
              <button className={`btn ${d.danger ? 'danger-fill' : 'primary'}`} data-autofocus={d.kind === 'confirm' ? '' : undefined} disabled={d.kind === 'prompt' && !text.trim()}>{d.confirmLabel || 'OK'}</button>
            </div>
          </form>
        </Sheet>
      )}
    </DialogCtx.Provider>
  );
}

/* A button that opens a small menu underneath it. `children` can be a
   function receiving close(), for items that should dismiss the menu. */
export function Popover({ button, label, align = 'right', className = '', children }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);
  return (
    <div className="pop-wrap">
      {button({ open, toggle: () => setOpen((v) => !v), props: { 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-label': label, title: label } })}
      {open && (
        <>
          <div className="pop-scrim" onClick={close} />
          <div className={`pop ${align === 'left' ? 'left' : ''} ${className}`} role="menu">{typeof children === 'function' ? children(close) : children}</div>
        </>
      )}
    </div>
  );
}

export function Segmented({ value, onChange, options, small, fill, label, className = '' }) {
  return (
    <div className={`seg ${small ? 'sm' : ''} ${fill ? 'fill' : ''} ${className}`} role="group" aria-label={label}>
      {options.map(([v, text, title, style]) => (
        <button key={v} type="button" aria-pressed={value === v} title={title} style={style} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

export const Skeleton = ({ rows = 4 }) => (
  <div className="skel" role="status" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <i key={i} />)}</div>
);

export function Empty({ title, children }) {
  return <div className="empty">{title && <b>{title}</b>}{children}</div>;
}

// Shown in place of content when a load failed, with a way to try again.
export function LoadError({ error, onRetry }) {
  return (
    <div className="error-box" role="alert">
      <span>{error?.message || 'Couldn’t load this.'}</span>
      {onRetry && <button className="btn sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}

// Grows a textarea to fit what's typed in it.
export function useAutoGrow(ref, value, min = 0) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(min, el.scrollHeight)}px`;
  }, [ref, value, min]);
}

// True once the page is running in the browser (dates and times differ on the server).
export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}
