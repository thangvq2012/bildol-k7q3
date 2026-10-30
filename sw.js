/* Bildol PWA: dữ liệu (*.json) luôn lấy mạng trước (fallback bản đã lưu khi mất mạng); file giao diện lấy bản lưu rồi cập nhật ngầm. */
const CACHE = "bildol-v33";
const SHELL = ["./", "index.html", "app.js", "smc.js", "style.css", "manifest.webmanifest", "icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;   // Binance, CDN: để trình duyệt tự xử lý
  if (u.pathname.endsWith(".json")) {
    e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(u.pathname, c)); return r; })
      .catch(() => caches.match(u.pathname)));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => {
    const net = fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
