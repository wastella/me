'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import QuickAdd from '@/components/QuickAdd';
import { TaskList, sortTasks } from '@/components/TaskItem';
import ConnectGoogle from '@/components/ConnectGoogle';
import { Skeleton, LoadError, Empty, useMounted } from '@/components/ui';
import { IconGear } from '@/components/Icons';
import { useApi, clockTime } from '@/lib/client';
import { todayStr, fmt } from '@/lib/dates';

const greeting = (h) => (h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');

function useNow(ms = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export default function Home() {
  const { tasks, status, tasksLoading, tasksError, reloadTasks } = useApp();
  const mounted = useMounted();   // the greeting and date depend on this device's clock
  const now = useNow();
  const today = todayStr();
  const due = useMemo(() => tasks.filter((t) => t.due_date && t.due_date <= today).sort(sortTasks), [tasks, today]);

  return (
    <>
      <div className="hero">
        <div>
          <h1>{mounted ? `${greeting(now.getHours())}${status?.name ? `, ${status.name}` : ''}` : ' '}</h1>
          <div className="date">{mounted ? now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : ' '}</div>
        </div>
        <Link href="/settings" className="icon-btn only-phone" aria-label="Settings"><IconGear /></Link>
      </div>

      <div className="grid-dash">
        <section className="card" aria-labelledby="h-sched">
          <div className="card-head"><h2 id="h-sched">Schedule</h2><Link className="more" href="/calendar">Calendar</Link></div>
          <div className="card-body">{mounted ? <Schedule now={now} today={today} /> : <Skeleton rows={3} />}</div>
        </section>

        <section className="card" aria-labelledby="h-tasks">
          <div className="card-head"><h2 id="h-tasks">Today{due.length ? <span className="count">{due.length}</span> : null}</h2><Link className="more" href="/tasks?view=today">All tasks</Link></div>
          <div className="card-body">
            <QuickAdd defaults={{ due_date: today }} placeholder="Add a task for today" />
            {tasksError ? <div style={{ marginTop: 10 }}><LoadError error={tasksError} onRetry={reloadTasks} /></div>
              : tasksLoading ? <Skeleton rows={5} />
              : <TaskList tasks={due} allTasks={tasks} showDate={false} empty="Nothing left for today." reorder={{ field: 'day_order', patch: { due_date: today } }} />}
          </div>
        </section>
      </div>
    </>
  );
}

function Schedule({ now, today }) {
  const { status } = useApp();
  const connected = status?.google?.connected;
  const range = useMemo(() => { const s = new Date(); s.setHours(0, 0, 0, 0); const e = new Date(s); e.setDate(e.getDate() + 1); return `start=${s.toISOString()}&end=${e.toISOString()}`; }, [today]); // eslint-disable-line
  const events = useApi(connected ? `/api/calendar/events?${range}` : null, { refreshMs: 5 * 60_000 });
  const [showPast, setShowPast] = useState(false);

  if (!status) return <Skeleton rows={3} />;
  if (!connected) return <ConnectGoogle what="your calendar" />;
  if (events.error && !events.data) return <LoadError error={events.error} onRetry={events.reload} />;
  if (!events.data) return <Skeleton rows={3} />;

  const todays = events.data
    .filter((e) => !e.declined && (e.allDay ? e.start <= today && e.end > today : fmt(new Date(e.start)) === today))
    .sort((a, b) => (a.allDay === b.allDay ? new Date(a.start) - new Date(b.start) : a.allDay ? -1 : 1));
  if (!todays.length) return <Empty>Nothing on the calendar today.</Empty>;

  const isPast = (e) => !e.allDay && new Date(e.end) < now;
  const pastCount = todays.filter(isPast).length;
  const shown = showPast ? todays : todays.filter((e) => !isPast(e));
  return (
    <>
      {pastCount > 0 && <button className="btn ghost sm earlier" onClick={() => setShowPast((v) => !v)}>{showPast ? 'Hide' : 'Show'} {pastCount} earlier</button>}
      {shown.length === 0 && <Empty>That’s everything for today.</Empty>}
      <ul className="agenda">
        {shown.map((e) => {
          const live = !e.allDay && new Date(e.start) <= now && new Date(e.end) > now;
          return (
            <li key={e.calendarId + e.id} className={isPast(e) ? 'past' : live ? 'now' : ''}>
              <a href={e.link} target="_blank" rel="noreferrer" style={{ '--c': e.color }}>
                <span className="t">{e.allDay ? 'All day' : clockTime(e.start)}</span>
                <span className="bar" />
                <div>
                  <div className="title">{e.title}</div>
                  {(e.location || !e.allDay) && <div className="loc">{e.allDay ? '' : `until ${clockTime(e.end)}`}{e.location ? `${e.allDay ? '' : ' · '}${e.location}` : ''}</div>}
                </div>
              </a>
            </li>
          );
        })}
      </ul>
    </>
  );
}

