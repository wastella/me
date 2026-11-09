// Me service worker: shows push notifications and opens the right page.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: 'Me', body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Me', { body: d.body || '', tag: d.tag, data: { url: d.url || '/' }, icon: '/icon-192.png', badge: '/icon-192.png' }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) { await c.focus(); c.navigate?.(url); return; } }
    await self.clients.openWindow(url);
  })());
});
