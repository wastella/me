// Meals from Mealboard. Mealboard can only export its plan into the iPhone's
// Calendar, so the owner shares that iCloud calendar as a public link and Me
// reads it (read-only; Mealboard stays the place to plan).
import { kvGet, kvSet } from './db.js';
import { parseICS } from './ics.js';
import { todayStr, addDays } from './dates.js';
import { localDate } from './tz.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const CACHE_MS = 10 * 60_000;

export function normalizeUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) throw bad('Paste the calendar link.');
  url = url.replace(/^webcals?:\/\//i, 'https://');
  let u;
  try { u = new URL(url); } catch { throw bad('That isn’t a link. It should start with webcal:// or https://'); }
  if (u.protocol !== 'https:') throw bad('The link should start with webcal:// or https://');
  return u.toString();
}

async function download(url) {
  let res;
  try { res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'text/calendar' }, cache: 'no-store' }); }
  catch { throw bad('Couldn’t reach that calendar link.', 502); }
  if (res.status === 404 || res.status === 403) throw bad('That calendar link no longer works. Is the calendar still shared as public?', 502);
  if (!res.ok) throw bad(`The calendar link returned an error (${res.status}).`, 502);
  const text = await res.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw bad('That link isn’t a calendar. Copy the public calendar link, not a web page.');
  return parseICS(text);
}

export async function feed() { return kvGet('meals_feed'); }

export async function connect(rawUrl) {
  const url = normalizeUrl(rawUrl);
  const { calendarName } = await download(url);
  const value = { url, name: calendarName || 'Meals' };
  await kvSet('meals_feed', value);
  globalThis.__meMeals = null;
  return { name: value.name };
}

export async function disconnect() { await kvSet('meals_feed', null); globalThis.__meMeals = null; }

// Fetched at most every 10 minutes (Mealboard changes rarely).
async function events_(url) {
  const c = globalThis.__meMeals;
  if (c && c.url === url && Date.now() - c.at < CACHE_MS) return c.events;
  const { events } = await download(url);
  globalThis.__meMeals = { url, at: Date.now(), events };
  return events;
}

// The calendar entries are the meals: title = what's cooking.
export function shape(list, start, end) {
  const seen = new Set();
  return list
    .filter((e) => e.status !== 'CANCELLED' && e.summary && e.start.date >= start && e.start.date <= end)
    .map((e) => ({ date: e.start.date, time: e.start.time, meal: e.summary, notes: e.description || undefined }))
    .filter((m) => { const k = `${m.date}|${m.time}|${m.meal}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
}

export async function meals({ start = todayStr(), days = 7 } = {}) {
  const f = await feed();
  if (!f) return { connected: false, meals: [] };
  const end = addDays(start, Math.max(1, Math.min(60, days)) - 1);
  return { connected: true, name: f.name, start, end, meals: shape(await events_(f.url), start, end) };
}

// Calendar events named Supper or Dinner ("Supper", "Shabbat dinner") get that
// night's meal attached as `meal`, so it shows wherever the event does.
export const isMealEvent = (title) => /\b(supper|dinner)\b/i.test(title || '');

export async function withMeals(events) {
  const list = events.filter((e) => !e.allDay && isMealEvent(e.title));
  if (!list.length) return events;
  const f = await feed();
  if (!f) return events;
  let all;
  try { all = await events_(f.url); } catch { return events; }   // never break the calendar over meals
  const byDate = {};
  for (const m of shape(all, '0000-01-01', '9999-12-31')) (byDate[m.date] ||= []).push(m.meal);
  for (const e of list) { const ms = byDate[localDate(e.start)]; if (ms) e.meal = ms.join(', '); }
  return events;
}
