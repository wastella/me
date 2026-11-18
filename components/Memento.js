'use client';
// MeMento inside the Me web app (this is what the phone gets): when a
// reminder fires, it covers the whole app and can't be dismissed until its
// lock time is up. The Macs get a real screen lock from the MeMento app.
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/client';

const PHRASE = 'I am skipping this reminder';
const clock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// Asks Me what should be on screen: every 30 seconds, and whenever you come back to the app.
export function useMemento({ recent = false, every = 30_000 } = {}) {
  const [state, setState] = useState(null);
  const skew = useRef(0);   // server clock minus this device's clock
  const load = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const s = await fetch(`/api/memento${recent ? '?recent=1' : ''}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null));
      if (!s) return;
      skew.current = new Date(s.now).getTime() - Date.now();
      setState(s);
    } catch {}
  }, [recent]);
  useEffect(() => {
    load();
    const t = setInterval(load, every);
    const wake = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', wake); window.addEventListener('focus', wake);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', wake); window.removeEventListener('focus', wake); };
  }, [load, every]);
  return { state, reload: load, skew };
}

export default function MementoOverlay() {
  const path = usePathname();
  const { state, reload, skew } = useMemento();
  const m = path === '/login' ? null : state?.active?.[0];
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [typed, setTyped] = useState('');
  const key = m ? m.id + m.fired_at : '';

  useEffect(() => {
    if (!m) return;
    setTyped(''); setProblem(''); setBusy(false);
    const until = new Date(m.lock_until).getTime();
    const tick = () => setLeft(until - (Date.now() + skew.current));
    tick();
    const t = setInterval(tick, 250);
    document.body.classList.add('memento-open');
    try { navigator.vibrate?.([300, 150, 300, 150, 300]); } catch {}
    return () => { clearInterval(t); document.body.classList.remove('memento-open'); };
  }, [key]); // eslint-disable-line

  if (!m) return null;
  const locked = left > 0;
  const answer = async (action) => {
    if (busy) return;
    setBusy(true); setProblem('');
    try { await api('/api/memento', { method: 'PATCH', body: { id: m.id, action } }); await reload(); }
    catch (e) { setProblem(e.status === 423 ? 'Not until the time is up.' : 'Couldn’t reach Me. Try again.'); }
    setBusy(false);
  };
  const total = m.lock_seconds * 1000;
  return (
    <div className="memento" role="alertdialog" aria-modal="true" aria-label={`Reminder: ${m.text}`} key={key}>
      <div className="memento-flash" aria-hidden="true" />
      <div className="memento-brand"><span className="memento-mark">Me</span>MeMento</div>
      <div className="memento-main">
        <h1>{m.text}</h1>
        {locked ? (
          <>
            <div className="memento-ring" style={{ '--p': total ? Math.max(0, Math.min(1, left / total)) : 0 }}><span>{clock(left)}</span></div>
            <p>Go do it. This stays until the time is up.</p>
          </>
        ) : (
          <>
            <p className="ask">Did you do it?</p>
            <div className="memento-buttons">
              <button className="btn" disabled={busy} onClick={() => answer('snooze')}>Not yet · 10 min</button>
              <button className="btn memento-done" disabled={busy} onClick={() => answer('done')}>Done</button>
            </div>
            {problem && <p className="small" role="alert">{problem}</p>}
          </>
        )}
      </div>
      {locked && (
        <div className="memento-exit">
          <label htmlFor="memento-exit">Real emergency? Type “{PHRASE}” to unlock. It’s recorded as skipped.</label>
          <input id="memento-exit" className="input" value={typed} autoComplete="off" autoCapitalize="off" spellCheck={false}
            onChange={(e) => { setTyped(e.target.value); if (e.target.value.trim().toLowerCase() === PHRASE.toLowerCase()) answer('skip'); }} />
          {problem && <p className="small" role="alert">{problem}</p>}
        </div>
      )}
    </div>
  );
}
