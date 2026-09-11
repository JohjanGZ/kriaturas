/**
 * TOMBSTONE SERVICE WORKER — this project does not use service workers.
 *
 * `localhost` is a single origin shared by every project you have ever run on
 * it. A service worker another app registered at /sw.js keeps living there, and
 * keeps intercepting requests for THIS app: it serves chunks from its own stale
 * cache, the browser gets JavaScript that no longer matches the page, and the
 * result is "Application error: a client-side exception has occurred" — while
 * the server is perfectly healthy and a fresh browser profile works fine.
 *
 * A ghost like that re-fetches its own script to check for updates. Serving
 * this file at that path is what lets it be killed: the browser installs this
 * worker, and the first thing it does on activation is unregister itself, wipe
 * every cache it can reach, and reload the open tabs.
 *
 * Deleting this file would simply let the old ghost keep 404ing and haunting
 * the origin, so it stays.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.registration.unregister();

      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));

      /** Reload whatever is open so it comes back straight from the network. */
      const windows = await self.clients.matchAll({ type: 'window' });
      for (const client of windows) {
        client.navigate(client.url);
      }
    })(),
  );
});

/** Until it is gone, pass everything straight through — never serve from cache. */
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
