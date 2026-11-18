// Minimal Google OAuth + Calendar + Gmail client using fetch. Tokens live in
// the local SQLite kv table and never leave this machine.
import { kvGet, kvSet } from './db.js';
import { googleClient, APP_URL, TZ } from './env.js';

export const REDIRECT_URI = `${APP_URL}/api/google/callback`;
const SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/calendar',       // read + create/edit events
  'https://www.googleapis.com/auth/gmail.modify',   // read, mark read, archive (no delete)
];

export const googleConfigured = async () => { const c = await googleClient(); return !!(c.id && c.secret); };
export const googleConnected = async () => !!(await kvGet('google_tokens'))?.refresh_token;

export async function authUrl(state) {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({
    client_id: (await googleClient()).id, redirect_uri: REDIRECT_URI, response_type: 'code',
    scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return u.toString();
}

async function tokenRequest(params) {
  const { id, secret } = await googleClient();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Google token error: ${body.error_description || body.error}`);
  return body;
}

// Swap the code for tokens and read who signed in (from Google's id_token,
// which came straight from Google over TLS). Nothing is stored here.
export async function exchangeCode(code) {
  const t = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI });
  let email = null;
  try { email = JSON.parse(Buffer.from(t.id_token.split('.')[1], 'base64url').toString()).email?.toLowerCase() || null; } catch {}
  return { tokens: t, email };
}

export async function storeTokens(t, email) {
  const prev = (await kvGet('google_tokens')) || {};
  await kvSet('google_tokens', { ...prev, ...t, refresh_token: t.refresh_token || prev.refresh_token, expires_at: Date.now() + t.expires_in * 1000 });
  if (email) await kvSet('google_email', email);
}

export async function disconnect() { await kvSet('google_tokens', null); await kvSet('google_email', null); }

async function accessToken() {
  const t = await kvGet('google_tokens');
  if (!t?.refresh_token) throw Object.assign(new Error('Google not connected'), { status: 401 });
  if (t.access_token && t.expires_at > Date.now() + 60_000) return t.access_token;
  try {
    const n = await tokenRequest({ refresh_token: t.refresh_token, grant_type: 'refresh_token' });
    await kvSet('google_tokens', { ...t, ...n, expires_at: Date.now() + n.expires_in * 1000 });
    return n.access_token;
  } catch (e) {
    if (/invalid_grant/i.test(e.message) || /expired or revoked/i.test(e.message)) await disconnect();
    throw Object.assign(e, { status: 401 });
  }
}

export async function gfetch(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await accessToken()}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error?.message || `Google ${res.status}`), { status: res.status });
  return body;
}

// ---------- Calendar ----------
const CAL = 'https://www.googleapis.com/calendar/v3';
const enc = encodeURIComponent;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

// Google's eleven event colours (an event without one uses its calendar's).
export const EVENT_COLORS = {
  1: ['Lavender', '#7986cb'], 2: ['Sage', '#33b679'], 3: ['Grape', '#8e24aa'], 4: ['Flamingo', '#e67c73'],
  5: ['Banana', '#f6bf26'], 6: ['Tangerine', '#f4511e'], 7: ['Peacock', '#039be5'], 8: ['Graphite', '#616161'],
  9: ['Blueberry', '#3f51b5'], 10: ['Basil', '#0b8043'], 11: ['Tomato', '#d50000'],
};

export async function listCalendars() {
  const r = await gfetch(`${CAL}/users/me/calendarList?minAccessRole=reader`);
  const hidden = (await kvGet('hidden_calendars')) || [];
  return r.items.map((c) => ({
    id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor, primary: !!c.primary,
    writable: ['owner', 'writer'].includes(c.accessRole), owner: c.accessRole === 'owner', visible: !hidden.includes(c.id),
  }));
}

export async function createCalendar({ name, color }) {
  name = String(name || '').trim();
  if (!name) throw bad('Name the calendar.');
  const c = await gfetch(`${CAL}/calendars`, { method: 'POST', body: JSON.stringify({ summary: name, timeZone: TZ }) });
  if (color) await updateCalendar({ id: c.id, color });
  return { id: c.id, name };
}

// Rename (your own name for it) and/or recolour a calendar in your list.
export async function updateCalendar({ id, name, color }) {
  const body = {};
  if (name !== undefined) { if (!String(name).trim()) throw bad('Name the calendar.'); body.summaryOverride = String(name).trim(); }
  if (color) { if (!/^#[0-9a-f]{6}$/i.test(color)) throw bad('Pick a colour.'); body.backgroundColor = color; body.foregroundColor = '#ffffff'; }
  if (!Object.keys(body).length) return;
  await gfetch(`${CAL}/users/me/calendarList/${enc(id)}?colorRgbFormat=true`, { method: 'PATCH', body: JSON.stringify(body) });
}

// Deletes a calendar you own (with its events); just unsubscribes otherwise.
export async function removeCalendar(id) {
  const cal = (await listCalendars()).find((c) => c.id === id);
  if (!cal) throw bad('That calendar is no longer in your list.', 404);
  if (cal.primary) throw bad('Your main calendar can’t be removed.');
  await gfetch(cal.owner ? `${CAL}/calendars/${enc(id)}` : `${CAL}/users/me/calendarList/${enc(id)}`, { method: 'DELETE' });
}

function shapeEvent(e, c) {
  const self = e.attendees?.find((a) => a.self);
  const video = e.hangoutLink || e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri || null;
  const organizerIsMe = !e.organizer || !!e.organizer.self;
  return {
    id: e.id, calendarId: c.id, calendar: c.name,
    color: EVENT_COLORS[e.colorId]?.[1] || c.color, colorId: e.colorId || '',
    title: e.summary || '(No title)', location: e.location || '', description: e.description || '',
    start: e.start.dateTime || e.start.date, end: e.end.dateTime || e.end.date,
    allDay: !e.start.dateTime, link: e.htmlLink, meet: video,
    recurring: !!(e.recurringEventId || e.recurrence), seriesId: e.recurringEventId || (e.recurrence ? e.id : null),
    guests: (e.attendees || []).filter((a) => !a.resource).map((a) => ({ email: a.email, name: a.displayName || '', status: a.responseStatus || 'needsAction', self: !!a.self, organizer: !!a.organizer, optional: !!a.optional })),
    myStatus: self?.responseStatus || null,
    declined: self?.responseStatus === 'declined',
    organizer: e.organizer ? { email: e.organizer.email, name: e.organizer.displayName || '', self: !!e.organizer.self } : null,
    canEdit: c.writable && (organizerIsMe || !!e.guestsCanModify) && !['birthday', 'fromGmail'].includes(e.eventType),
    reminders: e.reminders ? { useDefault: e.reminders.useDefault !== false && !e.reminders.overrides, overrides: (e.reminders.overrides || []).map((r) => ({ method: r.method, minutes: r.minutes })) } : { useDefault: true, overrides: [] },
    visibility: e.visibility || 'default', busy: e.transparency !== 'transparent',
    kind: e.eventType && e.eventType !== 'default' ? e.eventType : undefined,
  };
}

// q searches titles, descriptions, locations and guests.
export async function listEvents(timeMin, timeMax, { calendarIds, includeHidden, q } = {}) {
  const cals = (await listCalendars()).filter((c) => (includeHidden || c.visible) && (!calendarIds || calendarIds.includes(c.id)));
  const lists = await Promise.all(cals.map(async (c) => {
    const u = new URL(`${CAL}/calendars/${enc(c.id)}/events`);
    u.search = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250', ...(q ? { q } : {}) });
    try {
      const r = await gfetch(u.toString());
      return (r.items || []).filter((e) => e.status !== 'cancelled' && e.start).map((e) => shapeEvent(e, c));
    } catch { return []; }
  }));
  // The same event often lives on several calendars (shared family or school
  // calendars, invites). Show it once and remember every calendar it's on,
  // preferring the copy you can change.
  const seen = new Map();
  for (const e of lists.flat()) {
    const key = `${e.title.trim().toLowerCase()}|${new Date(e.start).getTime()}|${new Date(e.end).getTime()}`;
    const prev = seen.get(key);
    if (!prev) seen.set(key, { ...e, calendars: [e.calendar] });
    else if (!prev.calendars.includes(e.calendar)) {
      prev.calendars.push(e.calendar);
      if ((prev.declined && !e.declined) || (!prev.canEdit && e.canEdit)) Object.assign(prev, { ...e, calendars: prev.calendars });
    }
  }
  return [...seen.values()].sort((a, b) => a.start.localeCompare(b.start));
}

const evUrl = (calendarId, id = '') => `${CAL}/calendars/${enc(calendarId)}/events${id ? `/${enc(id)}` : ''}`;
const rawEvent = (calendarId, id) => gfetch(evUrl(calendarId, id));
const withParams = (url, params) => { const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null)); return q.size ? `${url}?${q}` : url; };

// One event with everything the editor needs, including its repeat rule
// (which Google keeps on the series, not on each occurrence).
export async function getEvent(calendarId, id) {
  const cal = (await listCalendars()).find((c) => c.id === calendarId);
  if (!cal) throw bad('That calendar is no longer in your list.', 404);
  const e = await rawEvent(calendarId, id);
  const master = e.recurringEventId ? await rawEvent(calendarId, e.recurringEventId).catch(() => null) : e;
  const rule = (master?.recurrence || []).find((l) => /^RRULE:/i.test(l)) || '';
  const first = !e.recurringEventId || sameStart(e.originalStartTime, master?.start);
  return { ...shapeEvent(e, cal), repeat: rule, firstOfSeries: first };
}

const wall = (t) => (t.dateTime ? t.dateTime.slice(0, 19) : t.date);
const sameStart = (a, b) => !!a && !!b && (a.dateTime && b.dateTime ? new Date(a.dateTime).getTime() === new Date(b.dateTime).getTime() : wall(a) === wall(b));
const pad = (n) => String(n).padStart(2, '0');
// Wall-clock arithmetic ("2026-11-17T18:30:00" + ms), ignoring timezones.
const naive = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +(s.slice(11, 13) || 0), +(s.slice(14, 16) || 0));
const fromNaive = (ms, dateOnly) => { const d = new Date(ms); const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; return dateOnly ? day : `${day}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`; };
const times = (start, end, allDay) => ({
  // null clears the other form, so a timed event can become all-day and back.
  start: allDay ? { date: start.slice(0, 10), dateTime: null, timeZone: null } : { dateTime: start, timeZone: TZ, date: null },
  end: allDay ? { date: end.slice(0, 10), dateTime: null, timeZone: null } : { dateTime: end, timeZone: TZ, date: null },
});

// Turns the editor's fields into Google's shape. Only fields that were
// passed are included, so a patch leaves everything else alone.
function eventBody(f, existing) {
  const b = {};
  if (f.title !== undefined) b.summary = String(f.title).trim() || '(No title)';
  if (f.location !== undefined) b.location = f.location || '';
  if (f.description !== undefined) b.description = f.description || '';
  if (f.start && f.end) Object.assign(b, times(f.start, f.end, !!f.allDay));
  if (f.guests !== undefined) {
    const old = Object.fromEntries((existing?.attendees || []).map((a) => [a.email.toLowerCase(), a]));
    const emails = [...new Set(f.guests.map((g) => String(g.email || g).trim().toLowerCase()).filter(Boolean))];
    for (const e of emails) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad(`“${e}” isn’t an email address.`);
    b.attendees = emails.map((email) => old[email] || { email });
  }
  if (f.reminders !== undefined) {
    b.reminders = f.reminders.useDefault ? { useDefault: true } : {
      useDefault: false,
      overrides: (f.reminders.overrides || []).slice(0, 5).map((r) => ({ method: r.method === 'email' ? 'email' : 'popup', minutes: Math.max(0, Math.min(40320, Math.round(r.minutes) || 0)) })),
    };
  }
  if (f.colorId !== undefined) b.colorId = EVENT_COLORS[f.colorId] ? String(f.colorId) : null;
  if (f.visibility !== undefined) b.visibility = ['public', 'private'].includes(f.visibility) ? f.visibility : 'default';
  if (f.busy !== undefined) b.transparency = f.busy ? 'opaque' : 'transparent';
  if (f.meet === true && !existing?.hangoutLink) b.conferenceData = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  if (f.meet === false && (existing?.conferenceData || existing?.hangoutLink)) b.conferenceData = null;
  return b;
}
const sendOpts = (f, body) => ({ sendUpdates: f.notify ? 'all' : 'none', conferenceDataVersion: 'conferenceData' in body ? 1 : undefined });
const recurrenceWith = (lines, rule) => (rule ? [...(lines || []).filter((l) => !/^RRULE:/i.test(l)), rule] : null);

export async function createEvent(f) {
  const calendarId = f.calendarId || 'primary';
  if (!f.start || !f.end) throw bad('The event needs a start and an end.');
  const body = eventBody({ title: '', ...f });
  if (f.repeat) body.recurrence = [f.repeat];
  return gfetch(withParams(evUrl(calendarId), sendOpts(f, body)), { method: 'POST', body: JSON.stringify(body) });
}

// Ends a repeating series just before one of its occurrences.
async function endSeriesBefore(calendarId, master, inst, notify) {
  const o = inst.originalStartTime || inst.start;
  let until;
  if (o.date) until = fromNaive(naive(o.date) - 86400000, true).replace(/-/g, '');
  else { const d = new Date(new Date(o.dateTime).getTime() - 1000); until = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; }
  const recurrence = (master.recurrence || []).map((l) => (/^RRULE:/i.test(l)
    ? `${l.split(';').filter((p) => !/^(UNTIL|COUNT)=/i.test(p)).join(';')};UNTIL=${until}` : l));
  await gfetch(withParams(evUrl(calendarId, master.id), { sendUpdates: notify ? 'all' : 'none' }), { method: 'PATCH', body: JSON.stringify({ recurrence }) });
}

// How many times the series happens before `inst` (for "after N times" rules).
async function occurrencesBefore(calendarId, master, inst) {
  const o = inst.originalStartTime || inst.start;
  const timeMax = o.dateTime ? new Date(o.dateTime).toISOString() : new Date(naive(o.date)).toISOString();
  const r = await gfetch(withParams(`${evUrl(calendarId, master.id)}/instances`, { timeMax, maxResults: 2500, fields: 'items(id)', showDeleted: 'true' }));
  return (r.items || []).length;
}

/* Changes an event. Only the fields passed are touched. For a repeating
   event, `scope` says how far the change reaches:
     'this'      – just this occurrence (the default)
     'following' – this and every later one (the series is split in two)
     'all'       – the whole series
   `moveTo` moves it to another calendar. */
export async function updateEvent({ calendarId = 'primary', id, scope = 'this', moveTo, ...f }) {
  const inst = await rawEvent(calendarId, id);
  const save = (targetId, body) => gfetch(withParams(evUrl(calendarId, targetId), sendOpts(f, body)), { method: 'PATCH', body: JSON.stringify(body) });
  let resultId = id;

  if (!inst.recurringEventId) {
    // A one-off event, or the series itself.
    const body = eventBody(f, inst);
    if (f.repeat !== undefined) body.recurrence = recurrenceWith(inst.recurrence, f.repeat);
    await save(id, body);
  } else if (scope === 'this') {
    await save(id, eventBody(f, inst));
  } else {
    const master = await rawEvent(calendarId, inst.recurringEventId);
    const first = sameStart(inst.originalStartTime, master.start);
    const origStart = wall(inst.originalStartTime || inst.start);
    const timed = f.start && f.end && (f.start.slice(0, 19) !== wall(inst.start) || f.end.slice(0, 19) !== wall(inst.end) || !!f.allDay !== !inst.start.dateTime);

    if (scope === 'all' || first) {
      const { start, end, ...rest } = f;
      const body = eventBody(rest, master);
      if (timed) {
        // Shift the series by however far this occurrence was moved.
        const allDay = !!f.allDay;
        const shift = naive(start) - naive(origStart);
        const length = naive(end) - naive(start);
        const s = naive(wall(master.start)) + shift;
        Object.assign(body, times(fromNaive(s, allDay), fromNaive(s + length, allDay), allDay));
      }
      if (f.repeat !== undefined) body.recurrence = recurrenceWith(master.recurrence, f.repeat);
      await save(master.id, body);
      resultId = master.id;
    } else {
      // This and following: end the old series here, start a new one.
      let rule = f.repeat !== undefined ? f.repeat : (master.recurrence || []).find((l) => /^RRULE:/i.test(l)) || '';
      const count = rule.match(/COUNT=(\d+)/i);
      if (count && f.repeat === undefined) {
        const left = +count[1] - (await occurrencesBefore(calendarId, master, inst));
        rule = rule.replace(/COUNT=\d+/i, `COUNT=${Math.max(1, left)}`);
      }
      await endSeriesBefore(calendarId, master, inst, f.notify);
      const copy = {
        summary: master.summary, description: master.description, location: master.location, attendees: master.attendees,
        reminders: master.reminders, colorId: master.colorId, visibility: master.visibility, transparency: master.transparency,
        start: { ...inst.start }, end: { ...inst.end },
      };
      if (copy.start.dateTime) { copy.start.timeZone = master.start.timeZone || TZ; copy.end.timeZone = master.end.timeZone || TZ; }
      const body = { ...copy, ...eventBody(f, master) };
      for (const k of ['start', 'end']) body[k] = Object.fromEntries(Object.entries(body[k]).filter(([, v]) => v !== null));
      if (rule) body.recurrence = [rule];
      const made = await gfetch(withParams(evUrl(calendarId), sendOpts(f, body)), { method: 'POST', body: JSON.stringify(body) });
      resultId = made.id;
    }
  }

  if (moveTo && moveTo !== calendarId) {
    const src = await rawEvent(calendarId, resultId);
    await gfetch(withParams(`${evUrl(calendarId, src.recurringEventId || resultId)}/move`, { destination: moveTo, sendUpdates: f.notify ? 'all' : 'none' }), { method: 'POST' });
  }
  return { id: resultId };
}

// scope works as in updateEvent.
export async function deleteEvent(calendarId, eventId, { scope = 'this', notify = false } = {}) {
  const del = (id) => gfetch(withParams(evUrl(calendarId, id), { sendUpdates: notify ? 'all' : 'none' }), { method: 'DELETE' });
  if (scope === 'this') return del(eventId);
  const inst = await rawEvent(calendarId, eventId);
  if (!inst.recurringEventId) return del(eventId);
  const master = await rawEvent(calendarId, inst.recurringEventId);
  if (scope === 'all' || sameStart(inst.originalStartTime, master.start)) return del(master.id);
  return endSeriesBefore(calendarId, master, inst, notify);
}

// Answer an invitation: 'accepted' | 'declined' | 'tentative'.
export async function respondToEvent({ calendarId = 'primary', id, status, scope = 'this' }) {
  if (!['accepted', 'declined', 'tentative'].includes(status)) throw bad('Answer yes, no or maybe.');
  let e = await rawEvent(calendarId, id);
  if (scope === 'all' && e.recurringEventId) e = await rawEvent(calendarId, e.recurringEventId);
  if (!e.attendees?.some((a) => a.self)) throw bad('You’re not on the guest list for this event.');
  const attendees = e.attendees.map((a) => (a.self ? { ...a, responseStatus: status } : a));
  await gfetch(withParams(evUrl(calendarId, e.id), { sendUpdates: 'all' }), { method: 'PATCH', body: JSON.stringify({ attendees }) });
}

// ---------- Gmail ----------
const GM = 'https://gmail.googleapis.com/gmail/v1/users/me';
const header = (m, name) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

function parseFrom(v) {
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  return m ? { name: m[1].trim() || m[2], email: m[2] } : { name: v, email: v };
}

export async function listMessages({ q = 'in:inbox', max = 30, pageToken } = {}) {
  const u = new URL(`${GM}/messages`);
  u.search = new URLSearchParams({ q, maxResults: String(max), ...(pageToken ? { pageToken } : {}) });
  const r = await gfetch(u.toString());
  const msgs = await Promise.all((r.messages || []).map((m) =>
    gfetch(`${GM}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)));
  return {
    nextPageToken: r.nextPageToken || null,
    messages: msgs.map((m) => ({
      id: m.id, threadId: m.threadId, snippet: decodeEntities(m.snippet || ''),
      from: parseFrom(header(m, 'From')), subject: header(m, 'Subject') || '(no subject)',
      date: Number(m.internalDate), unread: m.labelIds?.includes('UNREAD'),
      important: m.labelIds?.includes('IMPORTANT'), starred: m.labelIds?.includes('STARRED'),
      category: (m.labelIds || []).find((l) => l.startsWith('CATEGORY_'))?.slice(9).toLowerCase() || null,
    })),
  };
}

export async function unreadCount() {
  const r = await gfetch(`${GM}/labels/INBOX`);
  return r.messagesUnread;
}

const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
function findPart(p, type) {
  if (p.mimeType === type && p.body?.data) return b64(p.body.data);
  for (const c of p.parts || []) { const r = findPart(c, type); if (r) return r; }
  return null;
}
function attachments(p, out = []) {
  if (p.filename && p.body?.attachmentId) out.push({ name: p.filename, size: p.body.size, type: p.mimeType });
  for (const c of p.parts || []) attachments(c, out);
  return out;
}

export async function getMessage(id) {
  const m = await gfetch(`${GM}/messages/${id}?format=full`);
  const html = findPart(m.payload, 'text/html');
  const text = findPart(m.payload, 'text/plain');
  return {
    id: m.id, threadId: m.threadId, subject: header(m, 'Subject') || '(no subject)',
    from: parseFrom(header(m, 'From')), to: header(m, 'To'), cc: header(m, 'Cc'),
    date: Number(m.internalDate), html, text, attachments: attachments(m.payload),
    unread: m.labelIds?.includes('UNREAD'), starred: m.labelIds?.includes('STARRED'),
  };
}

export async function modifyMessage(id, { add = [], remove = [] }) {
  return gfetch(`${GM}/messages/${id}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }) });
}

function decodeEntities(s) {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
}
