import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function worker(overrides = {}) {
  const handlers = {}, notifications = [], opened = [], cached = [];
  const context = {
    URL, Promise,
    self: { location: { origin: 'https://app.example.test' }, addEventListener: (name, fn) => handlers[name] = fn,
      registration: { showNotification: async (...args) => notifications.push(args) },
      skipWaiting: async () => {},
      clients: { claim: async () => {}, matchAll: async () => [], openWindow: async url => opened.push(url) },
    },
    caches: { open: async () => ({ addAll: async values => cached.push(...values) }), keys: async () => [], match: async value => ({ offline: value }) },
    fetch: async () => { throw new Error('offline'); }, ...overrides,
  };
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  return { handlers, notifications, opened, cached, context };
}

test('service worker caches public fallback only and leaves API requests untouched', async () => {
  const w = worker();
  let done;
  w.handlers.install({ waitUntil: promise => { done = promise; } }); await done;
  assert.deepEqual([...w.cached], ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png']);
  let response;
  const request = { mode: 'navigate', url: 'https://app.example.test/tasks' };
  w.handlers.fetch({ request, respondWith: p => { response = p; } });
  assert.deepEqual(await response, { offline: '/offline.html' });
  for (const req of [{ ...request, mode: 'cors', url: 'https://app.example.test/api/tasks' }, { ...request, url: 'https://app.example.test/api/tasks' }, { ...request, url: 'https://other.example.test/' }]) {
    let handled = false; w.handlers.fetch({ request: req, respondWith: () => { handled = true; } }); assert.equal(handled, false);
  }
});

test('push content is generic and clicks never follow untrusted destinations', async () => {
  const w = worker(); let done;
  w.handlers.push({ data: { json: () => ({ notificationId: 'notice_123', title: 'Secret', message: 'Private', url: 'https://evil.test' }) }, waitUntil: p => { done = p; } }); await done;
  assert.equal(w.notifications[0][0], 'Nhắc tôi');
  assert.equal(w.notifications[0][1].body, 'Bạn có cập nhật mới. Mở ứng dụng để xem chi tiết.');
  assert.equal(w.notifications[0][1].data.path, '/dashboard?notification=notice_123');
  for (const path of ['https://evil.test', '//evil.test', '/dashboard?notification=x&redirect=https://evil.test', '/dashboard?notification=notice_123']) {
    w.handlers.notificationclick({ notification: { data: { path }, close() {} }, waitUntil: p => { done = p; } }); await done;
  }
  assert.deepEqual(w.opened, ['https://app.example.test/dashboard', 'https://app.example.test/dashboard', 'https://app.example.test/dashboard', 'https://app.example.test/dashboard?notification=notice_123']);
});

test('manifest references valid PNG icons inside the application scope', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.display, 'standalone'); assert.equal(manifest.scope, '/'); assert.equal(manifest.start_url, '/today');
  for (const icon of manifest.icons) {
    const png = readFileSync(new URL(`../public${icon.src}`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
});
