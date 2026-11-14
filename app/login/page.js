'use client';
import { useEffect, useRef, useState } from 'react';

export default function Login() {
  const [state, setState] = useState('idle');   // idle | waiting | error
  const [err, setErr] = useState(null);
  const timer = useRef();
  useEffect(() => () => clearInterval(timer.current), []);

  const fail = (msg) => { clearInterval(timer.current); setErr(msg); setState('error'); };
  const start = async () => {
    setErr(null); setState('waiting');
    let d;
    try {
      const r = await fetch('/api/auth/start', { method: 'POST' });
      d = await r.json();
      if (!r.ok) return fail(d.error || 'Sign-in could not start.');
    } catch { return fail('Can’t reach Me. Check your connection and try again.'); }
    // Opens your browser (Mac app) or Safari (home-screen app); this page
    // waits for the sign-in to finish and then lets you in.
    const w = window.open(d.url, '_blank');
    if (!w && !/Electron/.test(navigator.userAgent)) { window.location.href = d.url; return; }
    clearInterval(timer.current);
    timer.current = setInterval(async () => {
      try {
        const p = await fetch(`/api/auth/poll?nonce=${d.nonce}`);
        const j = await p.json().catch(() => ({}));
        if (j.ok) { clearInterval(timer.current); window.location.href = '/'; }
        else if (!j.pending) fail(j.error || 'Sign-in failed.');
      } catch { /* offline for a moment: keep waiting */ }
    }, 1500);
  };

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand-mark big">Me</div>
        <h1>Me</h1>
        <p className="muted">Sign in with your Google account.</p>
        <button className="btn primary" onClick={start} disabled={state === 'waiting'}>{state === 'waiting' ? 'Waiting for Google…' : state === 'error' ? 'Try again' : 'Sign in with Google'}</button>
        {state === 'waiting' && <p className="muted small">Finish signing in in the window that opened. This page continues on its own.</p>}
        {err && <div className="error-box" role="alert">{err}</div>}
      </div>
    </div>
  );
}
