// Service Worker — Sovereign OS Dashboard
// Caches the shell (HTML/CSS/JS) for offline availability.
// API calls are always network-first (dashboard data must be fresh).

const CACHE_NAME = 'sovdash-shell-v3';
const SHELL_FILES = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json', '/favicon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API calls → always network
  if (url.pathname.startsWith('/api/')) return;

  // Shell files → cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
