/**
 * The cache that lets the app open without a network.
 *
 * Everything the app is made of is fetched once and kept. Afterwards the app
 * opens from the cache — in a cellar, a train, a cottage — while anything it
 * talks to (the shared database) still goes to the network, and fails the way
 * the app already knows how to handle.
 *
 * The trap with this kind of cache is leaving people stranded on an old
 * version — and on a phone, where the app on the home screen is resumed rather
 * than reloaded, being stranded can last for ever. So, in order: the cache name
 * carries a version and older caches are deleted on activation; a new worker
 * takes over as soon as it is installed rather than waiting for every tab to
 * close; every network attempt revalidates instead of trusting the browser's own
 * copy; the app registers this file with `updateViaCache: 'none'`, asks for an
 * update each time it comes back to the front, and reloads itself once a new
 * worker takes over. Bump VERSION whenever the app changes — tools/bundle.js
 * checks that it matches both the files it built and the version the page shows.
 */

const VERSION = 'v10';
/** Written by tools/bundle.js from the sources: it moves whenever they do. */
const BUILD = 'f66b90f1';
const CACHE = `marque-points-${VERSION}-${BUILD}`;

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
  './src/dashboard.js',
  './src/ics.js',
  './src/lists.js',
  './src/polls.js',
  './src/spends.js',
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
    //
    // `cache: 'no-cache'` makes that first step revalidate rather than take the
    // browser's own copy: GitHub Pages lets a page be held for ten minutes, and
    // an app just added to a home screen would otherwise open on whatever
    // Safari happened to have kept. It costs one conditional request, answered
    // with a 304 when nothing changed.
    fetch(new Request(request.url, { cache: 'no-cache', credentials: 'same-origin' }))
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
