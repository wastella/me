// Minimal Google OAuth + Calendar + Gmail client using fetch. Tokens live in
// the local SQLite kv table and never leave this machine.
import { kvGet, kvSet } from './db.js';
import { googleClient, APP_URL } from './env.js';

export const REDIRECT_URI = `${APP_URL}/api/google/callback`;
const SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/calendar',       // read + create/edit events
  'https://www.googleapis.com/auth/gmail.modify',   // read, mark read, archive (no delete)
];

export const googleConfigured = () => { const c = googleClient(); return !!(c.id && c.secret); };
export const googleConnected = () => !!kvGet('google_tokens')?.refresh_token;

export function authUrl(state) {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({
    client_id: googleClient().id, redirect_uri: REDIRECT_URI, response_type: 'code',
    scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return u.toString();
}

async function tokenRequest(params) {
  const { id, secret } = googleClient();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Google token error: ${body.error_description || body.error}`);
  return body;
}

export async function exchangeCode(code) {
  const t = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI });
  const prev = kvGet('google_tokens') || {};
  kvSet('google_tokens', { ...prev, ...t, refresh_token: t.refresh_token || prev.refresh_token, expires_at: Date.now() + t.expires_in * 1000 });
  try {
    const p = await gfetch('https://gmail.googleapis.com/gmail/v1/users/me/profile');
    kvSet('google_email', p.emailAddress);
  } catch {}
}

export function disconnect() { kvSet('google_tokens', null); kvSet('google_email', null); }

async function accessToken() {
  const t = kvGet('google_tokens');
  if (!t?.refresh_token) throw Object.assign(new Error('Google not connected'), { status: 401 });
  if (t.access_token && t.expires_at > Date.now() + 60_000) return t.access_token;
  try {
    const n = await tokenRequest({ refresh_token: t.refresh_token, grant_type: 'refresh_token' });
    kvSet('google_tokens', { ...t, ...n, expires_at: Date.now() + n.expires_in * 1000 });
    return n.access_token;
  } catch (e) {
    if (/invalid_grant/i.test(e.message) || /expired or revoked/i.test(e.message)) disconnect();
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

export async function listCalendars() {
  const r = await gfetch(`${CAL}/users/me/calendarList?minAccessRole=reader`);
  const hidden = kvGet('hidden_calendars') || [];
  return r.items.map((c) => ({
    id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor, primary: !!c.primary,
    writable: ['owner', 'writer'].includes(c.accessRole), visible: !hidden.includes(c.id),
  }));
}

export async function listEvents(timeMin, timeMax) {
  const cals = (await listCalendars()).filter((c) => c.visible);
  const lists = await Promise.all(cals.map(async (c) => {
    const u = new URL(`${CAL}/calendars/${encodeURIComponent(c.id)}/events`);
    u.search = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
    try {
      const r = await gfetch(u.toString());
      return (r.items || []).filter((e) => e.status !== 'cancelled').map((e) => ({
        id: e.id, calendarId: c.id, calendar: c.name, color: c.color,
        title: e.summary || '(No title)', location: e.location || '', description: e.description || '',
        start: e.start.dateTime || e.start.date, end: e.end.dateTime || e.end.date,
        allDay: !e.start.dateTime, link: e.htmlLink, meet: e.hangoutLink || e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri || null,
        declined: e.attendees?.some((a) => a.self && a.responseStatus === 'declined') || false,
      }));
    } catch { return []; }
  }));
  return lists.flat().sort((a, b) => a.start.localeCompare(b.start));
}

export async function createEvent({ calendarId = 'primary', title, start, end, allDay, location, description }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body = {
    summary: title, location, description,
    start: allDay ? { date: start } : { dateTime: start, timeZone: tz },
    end: allDay ? { date: end } : { dateTime: end, timeZone: tz },
  };
  return gfetch(`${CAL}/calendars/${encodeURIComponent(calendarId)}/events`, { method: 'POST', body: JSON.stringify(body) });
}

export async function deleteEvent(calendarId, eventId) {
  return gfetch(`${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
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
