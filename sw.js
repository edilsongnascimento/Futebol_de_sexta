const CACHE = "futebol-de-sexta-v3";
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
