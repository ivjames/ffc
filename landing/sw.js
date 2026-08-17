// Kill-switch service worker for the platform apex. Before the landing-page
// cutover this origin served the player PWA; installed apps still hold this
// origin's SW registration and would keep replaying a cached app shell whose
// /api calls no longer resolve here. Browsers refetch /sw.js on navigation
// (the landing vhost serves it uncached), so this replacement wins the update:
// it clears every cache, unregisters itself, and re-navigates open clients so
// they hit the nginx 301s over to the default org's subdomain.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) await caches.delete(key);
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: "window" })) {
        client.navigate(client.url);
      }
    })(),
  );
});
