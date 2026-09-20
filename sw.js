/**
 * The cache that lets the app open without a network.
 *
 * Everything the app is made of is fetched once and kept. Afterwards the app
 * opens from the cache — in a cellar, a train, a cottage — while anything it
 * talks to (the shared database) still goes to the network, and fails the way
 * the app already knows how to handle.
 *
 * The trap with this kind of cache is leaving people stranded on an old
 * version. So: the cache name carries a version, a new worker takes over as
 * soon as it is installed rather than waiting for every tab to close, and
 * older caches are deleted on activation. Bump VERSION whenever the app
 * changes — tools/bundle.js checks that it matches the files it built.
 */

const VERSION = 'v6';
const CACHE = `marque-points-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './src/app.js',
  './src/games.js',
  './src/model.js',
  './src/scoring.js',
  './src/helpers.js',
  './src/tarot.js',
  './src/stats.js',
  './src/recap.js',
  './src/export-docx.js',
  './src/export-pdf.js',
  './src/stamp.js',
  './src/people.js',
  './src/lists.js',
  './src/polls.js',
  './src/storage.js',
  './src/config.js',
  './src/qr.js',
  './src/lock.js',
  './src/remote.js',
  './src/cloud.js',
  './src/i18n.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // One missing file must not sink the whole install, so each is added on
      // its own and a failure is survivable.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Only ever serve this app's own files from the cache: the shared database
  // and anything else must keep talking to the network.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    // Network first, so a published update is picked up as soon as there is a
    // network; the cache is what makes the app work when there is none.
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match('./index.html')),
      ),
  );
});
