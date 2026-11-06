// Cache hors ligne. Changer VERSION à chaque modification des fichiers listés.
const VERSION = 'seravia-v30';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'logo-seravia.png', 'src/app.js', 'src/triage.js', 'src/demo-data.js', 'src/config.js', 'src/pending-photo.js', 'src/backend.js', 'src/styles.css', 'presentation.html', 'src/presentation.css', 'src/presentation.js', 'src/pro-lead.js'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys()
  .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
  .then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then((hit) => hit ?? fetch(e.request)));
});
