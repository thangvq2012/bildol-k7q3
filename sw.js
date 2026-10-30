/* Bildol PWA (v34b): LUÔN lấy bản mới nhất từ mạng trước (giao diện + dữ liệu), chỉ dùng bản đã lưu khi mất mạng.
   (Bản cũ lấy giao diện từ bộ nhớ trước nên điện thoại có thể chạy app.js cũ.) */
const CACHE = "bildol-v34b";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;   // Binance, CDN: để trình duyệt tự xử lý
  e.respondWith(
    fetch(e.request, { cache: "no-store" })
      .then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(u.pathname, c)); } return r; })
      .catch(() => caches.match(u.pathname))
  );
});
