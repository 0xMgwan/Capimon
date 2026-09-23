/*
 * The service worker, which exists for one job: receiving push notifications.
 *
 * Deliberately not a cache. An offline cache for an app whose whole point is
 * live prices and a settled balance would be a way of showing somebody a
 * confident, wrong number — the page fetches what it needs and says when it
 * cannot, which is the honest behaviour. So there is no fetch handler here,
 * and the worker stays out of the way of every request.
 */

self.addEventListener("install", () => {
  // Take over straight away rather than waiting for every tab to close:
  // somebody who just turned notifications on should get the next one.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "CAPX", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "CAPX";
  const options = {
    body: data.body || "",
    icon: "/apple-icon",
    badge: "/apple-icon",
    // Collapses an older notification about the same event rather than
    // stacking two of them.
    tag: data.tag || undefined,
    data: { url: data.url || "/portfolio" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/portfolio";

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Reuse a window that is already open, rather than piling up tabs.
    for (const client of all) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(url);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
