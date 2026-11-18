'use client';
// RemindMe's list: what's coming up, how recent reminders ended, and a way to
// set one by hand. (Mostly you'll just ask Claude.)
import { useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Empty, Skeleton, useDialog } from '@/components/ui';
import { useMemento } from '@/components/Memento';
import { api } from '@/lib/client';
import { IconTrash } from '@/components/Icons';

const when = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const lockText = (s) => (s ? `locks ${s % 60 === 0 ? s / 60 : Math.round(s / 6) / 10} min` : 'no lock');
const OUTCOME = { done: 'Done', skipped: 'Skipped', missed: 'Never answered' };

export default function MementoPage() {
  const { attempt, showToast } = useApp();
  const { confirm } = useDialog();
  const { state, reload } = useMemento({ recent: true });
  const [f, setF] = useState({ text: '', mins: '10', lock: '3' });
  const [busy, setBusy] = useState(false);

  const add = async (e) => {
    e.preventDefault();
    if (!f.text.trim() || busy) return;
    setBusy(true);
    const ok = await attempt(() => api('/api/memento', { method: 'POST', body: { text: f.text, in_minutes: Number(f.mins) || 0, lock_seconds: Math.round((Number(f.lock) || 0) * 60) } }));
    setBusy(false);
    if (ok) { showToast('Reminder set'); setF({ ...f, text: '' }); reload(); }
  };
  const cancel = async (m) => {
    if (!(await confirm({ title: 'Cancel this reminder?', body: `“${m.text}” won’t go off.`, confirmLabel: 'Cancel reminder', danger: true }))) return;
    if (await attempt(() => api(`/api/memento?id=${encodeURIComponent(m.id)}`, { method: 'DELETE' }))) reload();
  };

  return (
    <>
      <div className="page-head"><div><h1>RemindMe</h1><div className="sub">Reminders that take over your screens until you’ve gone and done the thing.</div></div></div>
      <div className="stack memento-page">
        <section className="card" aria-labelledby="mm-new">
          <div className="card-head"><h2 id="mm-new">New reminder</h2></div>
          <div className="card-body">
            <form onSubmit={add} className="stack" style={{ gap: 10 }}>
              <input className="input" placeholder="What should you go do?" aria-label="Reminder" value={f.text} maxLength={200} onChange={(e) => setF({ ...f, text: e.target.value })} autoComplete="off" />
              <div className="row">
                <label className="row nowrap muted">In <input className="input num" type="number" min="0" max="10080" aria-label="Minutes from now" value={f.mins} onChange={(e) => setF({ ...f, mins: e.target.value })} /> min</label>
                <label className="row nowrap muted">lock for <input className="input num" type="number" min="0" max="60" step="0.5" aria-label="Lock minutes" value={f.lock} onChange={(e) => setF({ ...f, lock: e.target.value })} /> min</label>
                <span className="grow" />
                <button className="btn primary" disabled={!f.text.trim() || busy}>Set reminder</button>
              </div>
            </form>
          </div>
        </section>

        <section className="card" aria-labelledby="mm-up">
          <div className="card-head"><h2 id="mm-up">Coming up</h2></div>
          <div className="card-body">
            {!state ? <Skeleton rows={2} /> : !state.upcoming.length ? <Empty>Nothing coming up. Ask Claude to “remind me to…”.</Empty> : (
              <ul className="memento-list">
                {state.upcoming.map((m) => (
                  <li key={m.id}>
                    <div><b>{m.text}</b><span>{when(m.due_at)} · {lockText(m.lock_seconds)}{m.snoozes ? ` · put off ${m.snoozes}×` : ''}</span></div>
                    <button className="icon-btn" aria-label={`Cancel “${m.text}”`} title="Cancel" onClick={() => cancel(m)}><IconTrash /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {state?.recent?.length > 0 && (
          <section className="card" aria-labelledby="mm-past">
            <div className="card-head"><h2 id="mm-past">Recent</h2></div>
            <div className="card-body">
              <ul className="memento-list">
                {state.recent.map((m) => <li key={m.id}><div><b>{m.text}</b><span>{when(m.ended_at)} · {OUTCOME[m.status] || m.status}</span></div></li>)}
              </ul>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
