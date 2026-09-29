/* No API responses, authenticated pages or task data are cached. */
const CACHE = 'nhactoi-public-v1';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('nhactoi-public-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.mode !== 'navigate' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
});
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* Show a generic notification for empty or malformed payloads. */ }
  const id = typeof data.notificationId === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(data.notificationId) ? data.notificationId : null;
  event.waitUntil(self.registration.showNotification('Nhắc tôi', {
    body: 'Bạn có cập nhật mới. Mở ứng dụng để xem chi tiết.',
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    tag: id ? `nhactoi-${id}` : 'nhactoi-update',
    data: { path: id ? `/dashboard?notification=${encodeURIComponent(id)}` : '/dashboard' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  // Never navigate to a URL supplied by the push sender.
  const candidate = event.notification.data?.path;
  const path = typeof candidate === 'string' && /^\/dashboard(?:\?notification=[a-zA-Z0-9_-]{1,200})?$/.test(candidate) ? candidate : '/dashboard';
  const url = new URL(path, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
    const client = clients.find(item => new URL(item.url).origin === self.location.origin);
    if (client) { await client.navigate(url); await client.focus(); }
    else await self.clients.openWindow(url);
  }));
});
