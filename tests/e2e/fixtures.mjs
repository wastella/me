// Shared setup for the browser tests: a pretend Google connection with a few
// calendar events (so nothing leaves the machine), and a check after every
// test that the page logged no errors.
import { test as base, expect } from '@playwright/test';

const pad = (n) => String(n).padStart(2, '0');
const at = (dayOffset, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d.toISOString(); };
const day = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ev = (id, title, start, end, extra = {}) => ({
  id, calendarId: 'primary', calendar: 'William', title, start, end, allDay: false, color: '#4f86e8', colorId: '', link: 'https://calendar.google.com/',
  location: '', description: '', recurring: false, guests: [], myStatus: null, declined: false, organizer: null, canEdit: true,
  reminders: { useDefault: true, overrides: [] }, visibility: 'default', busy: true, ...extra,
});
const GUESTS = [
  { email: 'sam@example.com', name: 'Sam', status: 'accepted', self: false, organizer: true, optional: false },
  { email: 'tester@example.com', name: '', status: 'needsAction', self: true, organizer: false, optional: false },
];

export const EVENTS = [
  ev('e1', 'Dentist', at(0, 12), at(0, 13), { location: '123 Main St' }),
  ev('e2', 'Supper', at(0, 18), at(0, 18, 45), { meal: 'Chicken tacos', recurring: true, seriesId: 'series' }),
  ev('e3', 'Club meeting', at(1, 15), at(1, 15, 45), { guests: GUESTS, myStatus: 'needsAction', organizer: { email: 'sam@example.com', name: 'Sam', self: false }, canEdit: false, description: 'Agenda: https://example.com/agenda' }),
  { ...ev('e4', 'Essay due', day(0), day(1)), allDay: true },
];
const STATUS = { name: 'Tester', desktop: false, hosted: false, storage: 'local', mcpUrl: null, shortcut: null, push: { publicKey: null, enabled: false, devices: 0 }, google: { configured: true, connected: true, email: 'tester@example.com', redirectUri: '' }, meals: { connected: true, name: 'Meals' } };
export const MEALS = [{ date: day(0), time: null, meal: 'Chicken tacos' }, { date: day(1), time: '18:00', meal: 'Spaghetti and meatballs' }, { date: day(3), time: null, meal: 'Homemade pizza' }];

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const problems = [];
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    await page.route('**/api/status', (r) => r.fulfill({ json: STATUS }));
    await page.route('**/api/calendar/calendars', (r) => r.fulfill({ json: r.request().method() === 'GET' ? [{ id: 'primary', name: 'William', color: '#4f86e8', visible: true, writable: true, owner: true, primary: true }, { id: 'family', name: 'Family', color: '#0b8043', visible: true, writable: true, owner: false, primary: false }] : { ok: true } }));
    // Every change the page asks for is kept in page.calendarCalls for tests to check.
    page.calendarCalls = [];
    await page.route('**/api/calendar/events**', (r) => {
      const req = r.request(); const p = new URL(req.url()).searchParams;
      if (req.method() !== 'GET') { page.calendarCalls.push({ method: req.method(), query: Object.fromEntries(p), body: req.postDataJSON?.() ?? null }); return r.fulfill({ json: { ok: true } }); }
      if (p.get('id')) return r.fulfill({ json: { ...EVENTS.find((e) => e.id === p.get('id')), repeat: 'RRULE:FREQ=DAILY', firstOfSeries: false } });
      if (p.get('q')) return r.fulfill({ json: EVENTS.filter((e) => e.title.toLowerCase().includes(p.get('q').toLowerCase())) });
      return r.fulfill({ json: EVENTS });
    });
    await page.route('**/api/meals**', (r) => r.fulfill({ json: { connected: true, name: 'Meals', meals: MEALS } }));
    // RemindMe: nothing on screen unless a test sets page.memento = { active, upcoming, recent }.
    page.memento = { active: [], upcoming: [], recent: [] };
    page.mementoCalls = [];
    await page.route('**/api/memento**', (r) => {
      const req = r.request();
      if (req.method() === 'GET') return r.fulfill({ json: { now: new Date().toISOString(), ...page.memento } });
      page.mementoCalls.push({ method: req.method(), body: req.postDataJSON?.() ?? null, url: req.url() });
      if (req.method() === 'PATCH') page.memento = { ...page.memento, active: [] };
      return r.fulfill({ json: { ok: true } });
    });
    page.expectErrors = () => { page.errorsExpected = true; };
    await use(page);
    if (!page.errorsExpected) expect(problems, 'the page should log no errors').toEqual([]);
  },
  phone: async ({}, use, testInfo) => use(testInfo.project.name === 'phone'),
});
export { expect };

// Letters only: digits in a made-up name could be read as a date by quick add.
export const unique = (label) => `${label} ${Array.from({ length: 6 }, () => 'abcdefghjkmnpqrstuvwxyz'[Math.floor(Math.random() * 23)]).join('')}`;
export const quickAdd = (page) => page.getByRole('textbox', { name: /^Add (a task|to )/ }).first();
export async function addTask(page, text) {
  await quickAdd(page).fill(text);
  await quickAdd(page).press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Added' })).toBeVisible();
}
export const row = (page, name) => page.getByRole('listitem').filter({ hasText: name });
export const localDate = (page, offset = 0) => page.evaluate((off) => { const d = new Date(); d.setDate(d.getDate() + off); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }, offset);
