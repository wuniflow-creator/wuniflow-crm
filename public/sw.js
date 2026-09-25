const CACHE_NAME = "wuniflow-pwa-v2";
const NAV_CACHE_NAME = "wuniflow-navigation-v1";
const PENDING_NAV_KEY = "/__wuniflow_pending_navigation__";
const STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/pwa-icon/192",
  "/pwa-icon/512",
  "/wuniflow-icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== NAV_CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request)),
    );
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "Nova atualização no Wuniflow CRM." };
  }

  const title = payload.title || "Wuniflow CRM";
  const body = payload.body || "Você tem uma nova mensagem.";
  const conversationId = payload.conversationId || null;
  const url = payload.url || (conversationId
    ? "/?view=whatsapp&conversation=" + encodeURIComponent(conversationId)
    : "/?view=whatsapp");

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/pwa-icon/192",
      badge: "/pwa-icon/192",
      tag: payload.tag || (conversationId ? "wuniflow-wa-" + conversationId : "wuniflow-crm"),
      renotify: true,
      data: { url, conversationId },
      vibrate: [120, 60, 120],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const conversationId = data.conversationId || null;
  const relativeUrl = data.url || (conversationId
    ? "/?view=whatsapp&conversation=" + encodeURIComponent(conversationId)
    : "/?view=whatsapp");
  const targetUrl = new URL(relativeUrl, self.location.origin).href;

  event.waitUntil((async () => {
    // Persist the navigation intent before opening/focusing the PWA.
    // Android may reuse an existing standalone window and ignore the deep URL,
    // so the app consumes this record when it becomes visible again.
    try {
      const cache = await caches.open(NAV_CACHE_NAME);
      await cache.put(
        PENDING_NAV_KEY,
        new Response(
          JSON.stringify({
            type: conversationId ? "OPEN_WHATSAPP_CONVERSATION" : "OPEN_WHATSAPP",
            conversationId,
            url: relativeUrl,
            createdAt: Date.now(),
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    } catch {
      // URL/message fallbacks below still work if cache persistence fails.
    }

    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

    for (const client of clients) {
      try {
        if ("navigate" in client) await client.navigate(targetUrl);
      } catch {
        // Some Android standalone clients cannot be navigated while backgrounded.
      }

      if ("focus" in client) {
        await client.focus();
        client.postMessage(
          conversationId
            ? { type: "OPEN_WHATSAPP_CONVERSATION", conversationId }
            : { type: "OPEN_WHATSAPP" },
        );
        return;
      }
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
