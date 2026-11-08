'use client';
import { useState } from 'react';
import { api } from '@/lib/client';
import { addDays, parse } from '@/lib/dates';

const short = (d) => parse(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// Daily posture checklist with a streak and a 30-day consistency strip.
export default function Posture({ data, reload, compact }) {
  const { posture, postureLog, today } = data;
  const doneToday = new Set(postureLog.filter((l) => l.date === today).map((l) => l.step_id));
  const [local, setLocal] = useState(null);
  const done = local || doneToday;
  const toggle = async (s) => {
    const next = new Set(done); const on = !next.has(s.id);
    on ? next.add(s.id) : next.delete(s.id);
    setLocal(next);
    await api('/api/training/posture', { method: 'POST', body: { date: today, step_id: s.id, done: on } });
    reload(); setLocal(null);
  };
  const byDay = {};
  for (const l of postureLog) byDay[l.date] = (byDay[l.date] || 0) + 1;
  const total = posture.length || 1;
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const day = addDays(today, -i);
    if ((byDay[day] || 0) >= total) streak++;
    else if (i > 0) break;
  }
  const allDone = posture.length > 0 && done.size >= posture.length;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Posture<span className="count">{done.size}/{posture.length}</span></h2>
        {streak > 0 && <span className="more">{streak} day streak</span>}
      </div>
      <div className="card-body">
        <ul className="checklist">
          {posture.map((s) => (
            <li key={s.id} className={done.has(s.id) ? 'on' : ''} onClick={() => toggle(s)}>
              <span className="box">{done.has(s.id) && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}</span>{s.name}
            </li>
          ))}
        </ul>
        {allDone && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Done for today.</div>}
        {!compact && (
          <div className="consistency" title="Last 30 days">
            {Array.from({ length: 30 }, (_, i) => addDays(today, i - 29)).map((day) => {
              const f = Math.min(1, (byDay[day] || 0) / total);
              return <i key={day} title={`${short(day)}: ${byDay[day] || 0}/${posture.length}`} style={{ opacity: f ? 0.25 + 0.75 * f : 1 }} className={f ? 'f' : ''} />;
            })}
          </div>
        )}
      </div>
    </section>
  );
}

