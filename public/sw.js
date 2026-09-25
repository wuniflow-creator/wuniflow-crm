const CACHE_NAME = "wuniflow-pwa-v1";
const STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/wuniflow-icon.svg",
  "/wuniflow-icon-maskable.svg",
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
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
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
      icon: "/wuniflow-icon.svg",
      badge: "/wuniflow-icon.svg",
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
  const url = data.url || "/?view=whatsapp";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          await client.focus();
          if (conversationId) {
            client.postMessage({
              type: "OPEN_WHATSAPP_CONVERSATION",
              conversationId,
            });
          } else {
            client.postMessage({ type: "OPEN_WHATSAPP" });
          }
          return;
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(url);
      }
    }),
  );
});
