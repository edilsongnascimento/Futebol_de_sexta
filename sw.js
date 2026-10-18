const CACHE = "futebol-de-sexta-v4";
const CORE = ["./","./index.html","./socio.html","./admin.html","./style.css","./app.js","./socio.js","./admin.js","./install.js","./config.js","./manifest.json","./icon.svg","./icon-192.png","./icon-512.png"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("futebol-de-sexta-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response && response.ok && !new URL(event.request.url).search) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
    }
    return response;
  }).catch(async () => {
    const requestURL = new URL(event.request.url);
    requestURL.search = "";
    const cached = await caches.match(requestURL.href);
    return cached || (event.request.mode === "navigate" ? caches.match("./index.html") : Response.error());
  }));
});
self.addEventListener("push", event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    console.error("Notificação push recebida em formato inválido.", error);
  }
  event.waitUntil(self.registration.showNotification(payload.title || "Futebol de Sexta", {
    body: payload.body || "Há uma atualização sobre o próximo jogo.",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    tag: payload.tag || "futebol-de-sexta",
    data: { url: payload.url || "./socio.html" }
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./socio.html", self.registration.scope);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async clients => {
    for (const client of clients) {
      const clientUrl = new URL(client.url);
      if (clientUrl.origin === target.origin && clientUrl.pathname === target.pathname && "focus" in client) {
        await client.navigate(target.href);
        return client.focus();
      }
    }
    return self.clients.openWindow(target.href);
  }));
});
