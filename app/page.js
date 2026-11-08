'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import QuickAdd from '@/components/QuickAdd';
import { TaskList, sortTasks } from '@/components/TaskItem';
import ConnectGoogle from '@/components/ConnectGoogle';
import { useApi, clockTime } from '@/lib/client';
import { todayStr, fmt } from '@/lib/dates';
import Posture from '@/components/Posture';

const greeting = (h) => (h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');

function useNow(ms = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export default function Home() {
  const { tasks, status, tasksLoading } = useApp();
  const now = useNow();
  const today = todayStr();
  const connected = status?.google?.connected;

  const due = useMemo(() => tasks.filter((t) => t.due_date && t.due_date <= today).sort(sortTasks), [tasks, today]);

  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const events = useApi(connected ? `/api/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}` : null, { refreshMs: 5 * 60_000 });

  const [showPast, setShowPast] = useState(false);
  const todaysEvents = (events.data || []).filter((e) => (e.allDay ? e.start <= today && e.end > today : fmt(new Date(e.start)) === today) && !e.declined);

  return (
    <>
      <div className="hero">
        <div>
          <h1>{greeting(now.getHours())}{status?.name ? `, ${status.name}` : ''}</h1>
          <div className="date">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        </div>
      </div>

      <div className="grid-dash">
        <div className="stack">
          <section className="card h-sched">
            <div className="card-head"><h2>Schedule</h2><Link className="more" href="/calendar">Calendar</Link></div>
            <div className="card-body">
              {!connected ? <ConnectGoogle what="your calendar" /> : events.error ? <div className="error-box">{events.error.message}</div> : !events.data ? <div className="empty"><span className="spin" /></div> : (
                todaysEvents.length === 0 ? <div className="empty">Nothing on the calendar today.</div> : (() => {
                  const isPast = (e) => !e.allDay && new Date(e.end) < now;
                  const pastCount = todaysEvents.filter(isPast).length;
                  const shown = showPast ? todaysEvents : todaysEvents.filter((e) => !isPast(e));
                  return (<>
                  {pastCount > 0 && <button className="btn ghost earlier" onClick={() => setShowPast((v) => !v)}>{showPast ? 'Hide' : 'Show'} {pastCount} earlier</button>}
                  {shown.length === 0 && <div className="empty">That’s everything for today.</div>}
                  <ul className="agenda">
                    {shown.map((e) => {
                      const past = !e.allDay && new Date(e.end) < now;
                      const live = !e.allDay && new Date(e.start) <= now && new Date(e.end) > now;
                      return (
                        <li key={e.calendarId + e.id} className={past ? 'past' : live ? 'now' : ''}>
                          <span className="t">{e.allDay ? 'All day' : clockTime(e.start)}</span>
                          <span className="bar" style={{ background: e.color }} />
                          <a href={e.link} target="_blank" rel="noreferrer">
                            <div className="title">{e.title}</div>
                            {(e.location || !e.allDay) && <div className="loc">{e.allDay ? '' : `until ${clockTime(e.end)}`}{e.location ? `${e.allDay ? '' : ' · '}${e.location}` : ''}</div>}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                  </>);
                })()
              )}
            </div>
          </section>

          <TrainingCard />
        </div>

        <section className="card h-tasks">
          <div className="card-head"><h2>Today’s tasks{due.length ? <span className="count">{due.length}</span> : null}</h2><Link className="more" href="/tasks?view=today">Tasks</Link></div>
          <div className="card-body">
            <QuickAdd defaults={{ due_date: today }} placeholder="Add a task for today…" />
            {tasksLoading && !tasks.length ? <div className="empty"><span className="spin" /></div>
              : <TaskList tasks={due} allTasks={tasks} empty="Nothing due today." reorder={{ field: 'day_order', patch: { due_date: today } }} />}
          </div>
        </section>
      </div>
    </>
  );
}

function TrainingCard() {
  const q = useApi('/api/training');
  const d = q.data;
  if (!d) return null;
  const { plan, today } = d;
  const lifted = d.history.some((w) => w.date === today);
  const label = lifted ? `${plan.day === 'upper' ? 'Upper' : 'Lower'} done`
    : plan.status === 'rest' ? 'Rest day' : `${plan.day === 'upper' ? 'Upper' : 'Lower'} day`;
  return (
    <section className="card h-train">
      <div className="card-head"><h2>Training<span className="count">{label}</span></h2><Link className="more" href="/training">{!lifted && plan.status === 'due' ? 'Log lift' : 'Training'}</Link></div>
      <div className="card-body home-posture"><Posture data={d} reload={q.reload} compact /></div>
    </section>
  );
}
