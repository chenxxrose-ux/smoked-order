/* 煙燻滷味：手機通知（網頁關掉也收得到）。通知裡只有「有新訂單」這類文字，沒有客人資料。 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) {}
  e.waitUntil(self.registration.showNotification(String(d.title || "煙燻滷味"), {
    body: String(d.body || "訂單有更新，打開看看"), tag: "orders", renotify: true,
    icon: "icon-192.png", badge: "icon-192.png", data: { url: "./?orders" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      if (new URL(c.url).pathname.endsWith("/stock.html")) continue;
      try { await c.focus(); c.postMessage({ open: "orders" }); return; } catch (err) {}
    }
    await self.clients.openWindow("./?orders");
  })());
});
