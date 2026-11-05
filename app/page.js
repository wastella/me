'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import QuickAdd from '@/components/QuickAdd';
import { TaskList, sortTasks } from '@/components/TaskItem';
import ConnectGoogle from '@/components/ConnectGoogle';
import { useApi, relTime, clockTime } from '@/lib/client';
import { todayStr, addDays, fmt } from '@/lib/dates';

function greeting(h) { return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }

function useNow(ms = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export default function Today() {
  const { tasks, status, tasksLoading } = useApp();
  const now = useNow();
  const today = todayStr();
  const connected = status?.google?.connected;
  const name = status?.name;

  const overdue = useMemo(() => tasks.filter((t) => t.due_date && t.due_date < today).sort(sortTasks), [tasks, today]);
  const dueToday = useMemo(() => tasks.filter((t) => t.due_date === today).sort(sortTasks), [tasks, today]);
  const tomorrow = useMemo(() => tasks.filter((t) => t.due_date === addDays(today, 1)).sort(sortTasks), [tasks, today]);

  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 2);
  const events = useApi(connected ? `/api/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}` : null, { refreshMs: 5 * 60_000 });
  const mail = useApi(connected ? '/api/mail?max=8&q=in:inbox' : null, { refreshMs: 2 * 60_000 });
  const hist = useApi('/api/history');

  const todaysEvents = (events.data || []).filter((e) => (e.allDay ? e.start === today : fmt(new Date(e.start)) === today) && !e.declined);
  const nextEvent = (events.data || []).find((e) => !e.allDay && !e.declined && new Date(e.end) > now);

  return (
    <>
      <div className="hero">
        <div>
          <h1>{greeting(now.getHours())}{name ? `, ${name}` : ''}.</h1>
          <div className="date">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
        </div>
        <div className="stat-row">
          <div className={`stat ${overdue.length ? 'alert' : ''}`}><div className="v">{overdue.length}</div><div className="k">Overdue</div></div>
          <div className="stat"><div className="v">{dueToday.length}</div><div className="k">Due today</div></div>
          <div className="stat"><div className="v">{hist.data?.stats.completedToday ?? '–'}</div><div className="k">Done today</div></div>
          {connected && <div className="stat"><div className="v">{mail.data?.unread ?? '–'}</div><div className="k">Unread</div></div>}
        </div>
      </div>

      <div className="grid-dash">
        <div className="stack">
          <section className="card">
            <div className="card-head"><h2>Today’s tasks</h2><Link className="more" href="/tasks?view=today">Open →</Link></div>
            <div className="card-body">
              <QuickAdd defaults={{ due_date: today }} placeholder="Add a task for today…" />
              {tasksLoading && !tasks.length ? <div className="empty"><span className="spin" /></div> : (
                <>
                  {overdue.length > 0 && <div className="group-title overdue">Overdue <span className="count">{overdue.length}</span></div>}
                  <TaskList tasks={overdue} allTasks={tasks} />
                  {overdue.length > 0 && <div className="group-title">Today <span className="count">{dueToday.length}</span></div>}
                  <TaskList tasks={dueToday} allTasks={tasks}
                    empty={!overdue.length && <><div className="big">☀️</div>Nothing due today. Enjoy it.</>} />
                </>
              )}
            </div>
          </section>
          {tomorrow.length > 0 && (
            <section className="card">
              <div className="card-head"><h2>Tomorrow</h2><Link className="more" href="/tasks?view=upcoming">Upcoming →</Link></div>
              <div className="card-body"><TaskList tasks={tomorrow} allTasks={tasks} /></div>
            </section>
          )}
        </div>

        <div className="stack">
          <section className="card">
            <div className="card-head"><h2>Schedule</h2><Link className="more" href="/calendar">Week →</Link></div>
            <div className="card-body">
              {!connected ? <ConnectGoogle what="your calendar" /> : events.error ? <div className="error-box">{events.error.message}</div> : !events.data ? <div className="empty"><span className="spin" /></div> : (
                <>
                  {nextEvent && <NextUp ev={nextEvent} now={now} />}
                  {todaysEvents.length === 0 ? <div className="empty">No events today.</div> : (
                    <ul className="agenda">
                      {todaysEvents.map((e) => {
                        const past = !e.allDay && new Date(e.end) < now;
                        const live = !e.allDay && new Date(e.start) <= now && new Date(e.end) > now;
                        return (
                          <li key={e.calendarId + e.id} className={past ? 'past' : live ? 'now' : ''}>
                            <span className="t">{e.allDay ? 'All day' : `${clockTime(e.start)} – ${clockTime(e.end)}`}</span>
                            <span className="bar" style={{ background: e.color }} />
                            <a href={e.link} target="_blank" rel="noreferrer">
                              <div className="title">{e.title}</div>
                              {e.location && <div className="loc">{e.location}</div>}
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2>Inbox {connected && mail.data ? <span className="chip">{mail.data.unread} unread</span> : null}</h2><Link className="more" href="/mail">Mail →</Link></div>
            <div className="card-body">
              {!connected ? <ConnectGoogle what="your email" /> : mail.error ? <div className="error-box">{mail.error.message}</div> : !mail.data ? <div className="empty"><span className="spin" /></div> : (
                mail.data.messages.length === 0 ? <div className="empty"><div className="big">📭</div>Inbox zero.</div> : (
                  <ul className="mail-mini">
                    {mail.data.messages.slice(0, 6).map((m) => (
                      <li key={m.id} className={m.unread ? 'unread' : ''}>
                        <Link href={`/mail?id=${m.id}`} className="from">{m.from.name}</Link>
                        <span className="time">{relTime(m.date)}</span>
                        <Link href={`/mail?id=${m.id}`} className="subj">{m.subject}</Link>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </div>
          </section>

          <Momentum stats={hist.data?.stats} />
        </div>
      </div>
    </>
  );
}

function NextUp({ ev, now }) {
  const mins = Math.round((new Date(ev.start) - now) / 60000);
  const when = mins <= 0 ? 'Now' : mins < 60 ? `in ${mins}m` : mins < 60 * 24 ? `in ${Math.floor(mins / 60)}h ${mins % 60 ? `${mins % 60}m` : ''}` : clockTime(ev.start);
  return (
    <div className="next-up">
      <div className="when">{when}</div>
      <div className="what"><b>{ev.title}</b><span>{clockTime(ev.start)}{ev.location ? ` · ${ev.location}` : ''}</span></div>
      {ev.meet && <a className="btn" style={{ marginLeft: 'auto' }} href={ev.meet} target="_blank" rel="noreferrer">Join</a>}
    </div>
  );
}

function Momentum({ stats }) {
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(addDays(todayStr(), -i));
  const by = Object.fromEntries((stats?.last30 || []).map((r) => [r.day, r.n]));
  const max = Math.max(1, ...days.map((d) => by[d] || 0));
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) { if (by[days[i]]) streak++; else if (i !== days.length - 1) break; }
  const total = days.reduce((s, d) => s + (by[d] || 0), 0);
  return (
    <section className="card">
      <div className="card-head"><h2>Momentum</h2><Link className="more" href="/tasks?view=done">History →</Link></div>
      <div className="card-body">
        <div className="row" style={{ gap: 18 }}>
          <div><b style={{ fontSize: 18 }}>{total}</b> <span className="muted">done in 14 days</span></div>
          <div><b style={{ fontSize: 18 }}>{streak}</b> <span className="muted">day streak</span></div>
        </div>
        <div className="spark">
          {days.map((d) => <div key={d} className={by[d] ? '' : 'zero'} style={{ height: `${((by[d] || 0) / max) * 100}%` }} title={`${d}: ${by[d] || 0}`} />)}
        </div>
        <div className="spark-labels"><span>2 weeks ago</span><span>Today</span></div>
      </div>
    </section>
  );
}
