// Web Push to your devices (iPhone home-screen app, desktop browsers).
import webpush from 'web-push';
import { db, now } from './db.js';

let ready = false;
function setup() {
  if (ready) return true;
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:me@example.com', pub, priv);
  return (ready = true);
}
export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

async function table() {
  await (await db()).run('CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, sub TEXT NOT NULL, device TEXT, created_at TEXT)');
}
export async function subscribe(sub, device) {
  if (!sub?.endpoint || !sub?.keys?.p256dh) throw Object.assign(new Error('Bad subscription'), { status: 400 });
  await table();
  await (await db()).run('INSERT OR REPLACE INTO push_subs (endpoint, sub, device, created_at) VALUES (?, ?, ?, ?)', sub.endpoint, JSON.stringify(sub), String(device || '').slice(0, 120), now());
}
export async function unsubscribe(endpoint) { await table(); await (await db()).run('DELETE FROM push_subs WHERE endpoint = ?', endpoint); }
export async function deviceCount() { await table(); return (await (await db()).get('SELECT COUNT(*) n FROM push_subs')).n; }

// Sends to every device; drops ones the browser says are gone.
export async function send({ title, body, url = '/', tag }) {
  if (!setup()) return 0;
  await table();
  const q = await db();
  let sent = 0;
  for (const row of await q.all('SELECT endpoint, sub FROM push_subs')) {
    try { await webpush.sendNotification(JSON.parse(row.sub), JSON.stringify({ title, body, url, tag })); sent++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await q.run('DELETE FROM push_subs WHERE endpoint = ?', row.endpoint); else console.error('push', e.statusCode, e.body); }
  }
  return sent;
}
