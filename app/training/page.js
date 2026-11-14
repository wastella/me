'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, useApi } from '@/lib/client';
import { addDays, parse, humanDate, diffDays } from '@/lib/dates';
import { IconTrash, IconPlus } from '@/components/Icons';
import { useApp } from '@/components/AppProvider';
import { Sheet, Segmented, Skeleton, LoadError, Empty, useDialog } from '@/components/ui';
import Posture from '@/components/Posture';

const DAY = { upper: 'Upper', lower: 'Lower' };
const fmtW = (w) => (w === null || w === undefined ? '' : w === 0 ? 'BW' : `${+w.toFixed(1)} lb`);
const short = (d) => parse(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const prescription = (e) => (e.sets && e.reps ? `${e.sets}×${e.reps}` : '');

export default function Training() {
  const q = useApi('/api/training');
  const [editing, setEditing] = useState(null);   // workout being edited
  const [routine, setRoutine] = useState(false);
  const d = q.data;
  if (q.error && !d) return <><div className="page-head"><h1>Training</h1></div><LoadError error={q.error} onRetry={q.reload} /></>;
  if (!d) return <><div className="page-head"><h1>Training</h1></div><Skeleton rows={8} /></>;

  const { plan } = d;
  const headline = plan.status === 'due' ? `${DAY[plan.day]} day`
    : plan.status === 'rest' ? 'Rest day'
    : `${DAY[plan.day]} done`;
  const sub = plan.status === 'due' ? 'Posture + lift today'
    : `Posture today · next lift: ${DAY[plan.nextDay]} ${humanDate(plan.nextDate, d.today).toLowerCase()}`;

  return (
    <>
      <div className="page-head">
        <div><h1>{headline}</h1><div className="sub">{sub}</div></div>
        <button className="btn" onClick={() => setRoutine(true)}>Edit routine</button>
      </div>
      <div className="train-grid">
        <div className="stack">
          <Posture data={d} reload={q.reload} />
          <TodayWorkout data={d} reload={q.reload} onEdit={setEditing} />
        </div>
        <div className="stack">
          <Progress data={d} />
          <History data={d} onEdit={setEditing} />
        </div>
      </div>
      {editing && <WorkoutModal data={d} workout={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); q.reload(); }} />}
      {routine && <RoutineModal data={d} onClose={() => { setRoutine(false); q.reload(); }} />}
    </>
  );
}

/* ---------- Today's lift ---------- */
function TodayWorkout({ data, reload, onEdit }) {
  const { plan, today } = data;
  const [force, setForce] = useState(false);
  const todays = data.history.find((w) => w.date === today);
  if (todays) {
    return (
      <section className="card">
        <div className="card-head"><h2>{DAY[todays.day]} day logged</h2><button className="more linkish" onClick={() => onEdit(todays)}>Edit</button></div>
        <div className="card-body"><SessionSummary data={data} w={todays} /></div>
      </section>
    );
  }
  if (plan.status === 'rest' && !force) {
    return (
      <section className="card">
        <div className="card-head"><h2>No lift today</h2></div>
        <div className="card-body">
          <p className="muted" style={{ margin: '2px 0 12px' }}>You lifted {DAY[plan.last.day].toLowerCase()} yesterday. {DAY[plan.nextDay]} is {humanDate(plan.nextDate, today).toLowerCase()}.</p>
          <button className="btn" onClick={() => setForce(true)}>Log a workout anyway</button>
        </div>
      </section>
    );
  }
  return <WorkoutForm data={data} initialDay={plan.status === 'rest' ? plan.nextDay : plan.day} date={today} onSaved={reload} />;
}

function WorkoutForm({ data, initialDay, date: initialDate, workout, onSaved, onCancel }) {
  const [day, setDay] = useState(workout?.day || initialDay);
  const [date, setDate] = useState(workout?.date || initialDate);
  const [vals, setVals] = useState(() => {
    const v = {};
    for (const s of workout?.sets || []) v[s.exercise_id] = { weight: s.weight ?? '', note: s.note || '' };
    return v;
  });
  const [busy, setBusy] = useState(false);
  const { attempt, showToast } = useApp();
  const list = data.exercises.filter((e) => e.day === day);
  const get = (e) => vals[e.id] ?? (workout ? { weight: '', note: '' } : { weight: e.kind === 'weight' ? (data.last[e.id]?.weight ?? '') : '', note: e.kind === 'note' ? (data.last[e.id]?.note || '') : '' });
  const set = (e, patch) => setVals((v) => ({ ...v, [e.id]: { ...get(e), ...patch } }));
  const save = async () => {
    setBusy(true);
    const ok = await attempt(() => api('/api/training/workouts', { method: 'POST', body: { id: workout?.id, date, day, sets: list.map((e) => ({ exercise_id: e.id, ...get(e) })) } }));
    setBusy(false);
    if (ok) { showToast(workout ? 'Workout updated' : `${DAY[day]} day logged`); onSaved(); }
  };
  const bump = (e, by) => set(e, { weight: Math.max(0, (Number(get(e).weight) || 0) + by) });
  return (
    <section className={workout ? '' : 'card'}>
      <div className="card-head" style={workout ? { padding: 0 } : undefined}>
        <h2>{workout ? short(workout.date) : 'Log today’s lift'}</h2>
        <Segmented small label="Workout day" value={day} onChange={setDay} options={[['upper', 'Upper'], ['lower', 'Lower']]} />
      </div>
      <div className="card-body" style={workout ? { padding: 0 } : undefined}>
        <div className="lift-rows">
          {list.map((e) => {
            const last = data.last[e.id];
            const v = get(e);
            return (
              <div key={e.id} className="lift-row">
                <div className="lift-name">
                  <b>{e.name}</b>
                  <span>{prescription(e)}{last ? `${prescription(e) ? ' · ' : ''}last ${e.kind === 'weight' && last.weight !== null ? fmtW(last.weight) : `“${last.note}”`}` : ''}</span>
                </div>
                {e.kind === 'weight' ? (
                  <div className="lift-input">
                    <button type="button" className="icon-btn" onClick={() => bump(e, -5)} aria-label={`${e.name}: 5 lb less`}>−</button>
                    <input className="input num" inputMode="decimal" value={v.weight} placeholder="lb" aria-label={`${e.name} weight in pounds`}
                      onChange={(x) => set(e, { weight: x.target.value.replace(/[^0-9.]/g, '') })} onFocus={(x) => x.target.select()} />
                    <button type="button" className="icon-btn" onClick={() => bump(e, 5)} aria-label={`${e.name}: 5 lb more`}>+</button>
                  </div>
                ) : (
                  <input className="input lift-note" value={v.note} aria-label={`${e.name} notes`} placeholder={last?.note || 'What you did'} onChange={(x) => set(e, { note: x.target.value })} />
                )}
              </div>
            );
          })}
          {!list.length && <Empty title={`No ${DAY[day].toLowerCase()} exercises yet`}>Add some in Edit routine.</Empty>}
        </div>
        <div className="lift-foot">
          <input className="input auto" type="date" aria-label="Workout date" max={data.today} value={date} onChange={(x) => setDate(x.target.value || data.today)} />
          <div className="row">
            {onCancel && <button className="btn" onClick={onCancel}>Cancel</button>}
            <button className="btn primary" disabled={busy || !list.length} onClick={save}>{busy ? 'Saving…' : workout ? 'Save' : 'Finish workout'}</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function SessionSummary({ data, w }) {
  const byId = Object.fromEntries(data.exercises.map((e) => [e.id, e]));
  return (
    <ul className="summary">
      {w.sets.filter((s) => byId[s.exercise_id]).sort((a, b) => byId[a.exercise_id].sort - byId[b.exercise_id].sort).map((s) => (
        <li key={s.exercise_id}><span>{byId[s.exercise_id].name}</span><b>{s.weight !== null ? fmtW(s.weight) : ''}{s.note ? `${s.weight !== null ? ' · ' : ''}${s.note}` : ''}</b></li>
      ))}
    </ul>
  );
}

/* ---------- Progress chart ---------- */
function Progress({ data }) {
  const weighted = data.exercises.filter((e) => e.kind === 'weight');
  const [sel, setSel] = useState(() => weighted[0]?.id);
  const ex = weighted.find((e) => e.id === sel) || weighted[0];
  const points = useMemo(() => {
    if (!ex) return [];
    return data.history.filter((w) => w.day === ex.day).map((w) => ({ date: w.date, s: w.sets.find((s) => s.exercise_id === ex.id) }))
      .filter((p) => p.s && p.s.weight !== null).map((p) => ({ date: p.date, weight: p.s.weight, note: p.s.note })).reverse();
  }, [data.history, ex]);
  if (!ex) return null;
  const first = points[0], last = points[points.length - 1];
  const best = points.reduce((m, p) => (p.weight > (m?.weight ?? -1) ? p : m), null);
  const change = first && last ? last.weight - first.weight : 0;
  return (
    <section className="card">
      <div className="card-head"><h2>Progress</h2></div>
      <div className="card-body">
        <div className="ex-picker">
          {['upper', 'lower'].map((day) => (
            <div key={day}>
              <span className="lbl">{DAY[day]}</span>
              {weighted.filter((e) => e.day === day).map((e) => <button key={e.id} aria-pressed={e.id === ex.id} onClick={() => setSel(e.id)}>{e.name}</button>)}
            </div>
          ))}
        </div>
        <div className="stat-line">
          <div><span>Last</span><b>{last ? fmtW(last.weight) : '–'}</b></div>
          <div><span>Best</span><b>{best ? fmtW(best.weight) : '–'}</b></div>
          <div><span>Since {first ? short(first.date) : '–'}</span><b>{points.length > 1 ? `${change > 0 ? '+' : ''}${+change.toFixed(1)} lb` : '–'}</b></div>
          <div><span>Sessions</span><b>{points.length}</b></div>
        </div>
        <LineChart title={ex.name} points={points} />
      </div>
    </section>
  );
}

function LineChart({ title, points }) {
  const wrap = useRef();
  const [w, setW] = useState(480);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, e.contentRect.width)));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  const H = 200, P = { l: 40, r: 14, t: 12, b: 26 };
  if (points.length === 0) return <div ref={wrap}><Empty>No weights logged for this one yet.</Empty></div>;
  const t = points.map((p) => parse(p.date).getTime());
  const t0 = Math.min(...t), t1 = Math.max(...t) || t0 + 1;
  const ws = points.map((p) => p.weight);
  let lo = Math.min(...ws), hi = Math.max(...ws);
  const pad = Math.max(5, (hi - lo) * 0.15);
  lo = Math.max(0, Math.floor((lo - pad) / 5) * 5); hi = Math.ceil((hi + pad) / 5) * 5;
  const x = (ms) => P.l + (t1 === t0 ? (w - P.l - P.r) / 2 : ((ms - t0) / (t1 - t0)) * (w - P.l - P.r));
  const y = (v) => P.t + (1 - (v - lo) / (hi - lo || 1)) * (H - P.t - P.b);
  const ticks = Array.from({ length: 4 }, (_, i) => lo + ((hi - lo) * i) / 3);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(t[i]).toFixed(1)},${y(p.weight).toFixed(1)}`).join(' ');
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left;
    let bi = 0; for (let i = 1; i < points.length; i++) if (Math.abs(x(t[i]) - mx) < Math.abs(x(t[bi]) - mx)) bi = i;
    setHover(bi);
  };
  const hp = hover !== null ? points[hover] : null;
  const xLabels = [0, Math.floor((points.length - 1) / 2), points.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <div ref={wrap} className="chart" aria-label={`${title} weight over time`}>
      <svg width={w} height={H} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`${title} weight over time`} style={{ touchAction: 'pan-y' }}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={P.l} x2={w - P.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={P.l - 8} y={y(v) + 3.5} textAnchor="end" className="axis">{Math.round(v)}</text>
          </g>
        ))}
        {xLabels.map((i) => <text key={i} x={x(t[i])} y={H - 8} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} className="axis">{short(points[i].date)}</text>)}
        {hp && <line x1={x(t[hover])} x2={x(t[hover])} y1={P.t} y2={H - P.b} className="crosshair" />}
        <path d={path} className="series" />
        {points.map((p, i) => <circle key={i} cx={x(t[i])} cy={y(p.weight)} r={hover === i ? 5 : 4} className="dot-pt" />)}
      </svg>
      {hp && (
        <div className="tip" style={{ left: Math.min(Math.max(x(t[hover]), 70), w - 70), top: y(hp.weight) - 10 }}>
          <span>{parse(hp.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <b>{fmtW(hp.weight)}</b>{hp.note && <em>{hp.note}</em>}
        </div>
      )}
    </div>
  );
}

/* ---------- History ---------- */
function History({ data, onEdit }) {
  const [n, setN] = useState(6);
  const byId = Object.fromEntries(data.exercises.map((e) => [e.id, e]));
  return (
    <section className="card">
      <div className="card-head"><h2>History<span className="count">{data.history.length}</span></h2></div>
      <div className="card-body">
        <ul className="sessions">
          {data.history.slice(0, n).map((w) => {
            const main = w.sets.filter((s) => byId[s.exercise_id]?.kind === 'weight').sort((a, b) => byId[a.exercise_id].sort - byId[b.exercise_id].sort).slice(0, 3);
            return (
              <li key={w.id}>
                <button onClick={() => onEdit(w)} aria-label={`Edit ${DAY[w.day].toLowerCase()} workout from ${short(w.date)}`}>
                  <span className="when">{short(w.date)}</span>
                  <span className="daytag">{DAY[w.day]}</span>
                  <span className="tops">{main.map((s) => `${byId[s.exercise_id].name} ${fmtW(s.weight)}`).join(' · ')}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {!data.history.length && <Empty title="No workouts yet">Your logged lifts will show up here.</Empty>}
        {data.history.length > n && <button className="btn ghost sm earlier" onClick={() => setN(n + 10)}>Show more</button>}
      </div>
    </section>
  );
}

function WorkoutModal({ data, workout, onClose, onSaved }) {
  const { attempt, showToast } = useApp();
  const { confirm } = useDialog();
  const del = async () => {
    if (!(await confirm({ title: 'Delete this workout?', body: `The ${DAY[workout.day].toLowerCase()} workout from ${short(workout.date)} will be removed.`, confirmLabel: 'Delete', danger: true }))) return;
    if (await attempt(() => api(`/api/training/workouts?id=${encodeURIComponent(workout.id)}`, { method: 'DELETE' }))) { showToast('Workout deleted'); onSaved(); }
  };
  return (
    <Sheet wide title="Edit workout" onClose={onClose} tools={<button className="icon-btn" title="Delete workout" aria-label="Delete workout" onClick={del}><IconTrash /></button>}>
      <WorkoutForm data={data} workout={workout} onSaved={onSaved} onCancel={onClose} />
    </Sheet>
  );
}

/* ---------- Routine editor ---------- */
function RoutineModal({ data, onClose }) {
  const { attempt } = useApp();
  const { confirm, prompt } = useDialog();
  const [ex, setEx] = useState(data.exercises);
  const [steps, setSteps] = useState(data.posture);
  const saveEx = async (e, patch) => {
    setEx((list) => list.map((x) => (x.id === e.id ? { ...x, ...patch } : x)));
    await attempt(() => api('/api/training/exercises', { method: 'PUT', body: { id: e.id, ...patch } }));
  };
  const addEx = async (day) => {
    const name = await prompt({ title: `New ${DAY[day].toLowerCase()} exercise`, label: 'Exercise name', confirmLabel: 'Add' });
    if (!name) return;
    const r = await attempt(() => api('/api/training/exercises', { method: 'PUT', body: { day, name, sets: 3, reps: '8', kind: 'weight' } }));
    if (r) setEx((l) => [...l, { id: r.id, day, name, sets: 3, reps: '8', kind: 'weight', sort: 999 }]);
  };
  const removeEx = async (e) => {
    if (await confirm({ title: `Remove ${e.name}?`, body: 'It leaves your routine. Past workouts keep their numbers.', confirmLabel: 'Remove', danger: true })) saveEx(e, { archived: 1 });
  };
  const saveStep = async (s, patch) => {
    setSteps((l) => l.map((x) => (x.id === s.id ? { ...x, ...patch } : x)).filter((x) => !x.archived));
    await attempt(() => api('/api/training/posture', { method: 'PUT', body: { id: s.id, ...patch } }));
  };
  const addStep = async () => {
    const name = await prompt({ title: 'New posture step', label: 'Step name', confirmLabel: 'Add' });
    if (!name) return;
    const r = await attempt(() => api('/api/training/posture', { method: 'PUT', body: { name } }));
    if (r) setSteps((l) => [...l, { id: r.id, name }]);
  };
  const removeStep = async (s) => {
    if (await confirm({ title: `Remove ${s.name}?`, confirmLabel: 'Remove', danger: true })) saveStep(s, { archived: 1 });
  };
  const blurOnEnter = (e) => { if (e.key === 'Enter') e.currentTarget.blur(); };
  return (
    <Sheet wide title="Routine" onClose={onClose}>
      {['upper', 'lower'].map((day) => (
        <div key={day}>
          <div className="group-title" style={{ paddingTop: 4, marginBottom: 6 }}>{DAY[day]} day</div>
          {ex.filter((e) => e.day === day && !e.archived).map((e) => (
            <div key={e.id} className="routine-row">
              <input className="input name" aria-label="Exercise name" defaultValue={e.name} onKeyDown={blurOnEnter} onBlur={(x) => { const v = x.target.value.trim(); if (!v) x.target.value = e.name; else if (v !== e.name) saveEx(e, { name: v }); }} />
              <input className="input num" inputMode="numeric" aria-label="Sets" title="Sets" defaultValue={e.sets ?? ''} placeholder="sets" onKeyDown={blurOnEnter} onBlur={(x) => { const v = x.target.value ? Number(x.target.value) : null; if (v !== (e.sets ?? null) && !Number.isNaN(v)) saveEx(e, { sets: v }); }} />
              <span className="x" aria-hidden="true">×</span>
              <input className="input num" aria-label="Reps" title="Reps" defaultValue={e.reps ?? ''} placeholder="reps" onKeyDown={blurOnEnter} onBlur={(x) => { const v = x.target.value.trim() || null; if (v !== (e.reps ?? null)) saveEx(e, { reps: v }); }} />
              <select className="input auto" aria-label="What you log" value={e.kind} onChange={(x) => saveEx(e, { kind: x.target.value })}><option value="weight">Weight</option><option value="note">Note</option></select>
              <button className="icon-btn" title={`Remove ${e.name}`} aria-label={`Remove ${e.name}`} onClick={() => removeEx(e)}><IconTrash /></button>
            </div>
          ))}
          <button className="btn ghost sm earlier" style={{ marginTop: 4 }} onClick={() => addEx(day)}><IconPlus /> Add exercise</button>
        </div>
      ))}
      <div>
        <div className="group-title" style={{ paddingTop: 4, marginBottom: 6 }}>Posture, every day</div>
        {steps.map((s) => (
          <div key={s.id} className="routine-row" style={{ flexWrap: 'nowrap' }}>
            <input className="input" aria-label="Step name" defaultValue={s.name} onKeyDown={blurOnEnter} onBlur={(x) => { const v = x.target.value.trim(); if (!v) x.target.value = s.name; else if (v !== s.name) saveStep(s, { name: v }); }} />
            <button className="icon-btn" title={`Remove ${s.name}`} aria-label={`Remove ${s.name}`} onClick={() => removeStep(s)}><IconTrash /></button>
          </div>
        ))}
        <button className="btn ghost sm earlier" style={{ marginTop: 4 }} onClick={addStep}><IconPlus /> Add step</button>
      </div>
    </Sheet>
  );
}
