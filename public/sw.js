/*
 * Service worker của ePMP — CHỈ để app cài được ra màn hình chính (iOS/Android) và mở nhanh hơn.
 *
 * NGUYÊN TẮC: KHÔNG bao giờ phục vụ dữ liệu cũ.
 *  · Chỉ cache tệp tĩnh có vân tay trong tên (/assets/… do Vite sinh, đổi nội dung là đổi tên) + icon.
 *  · Trang HTML, mọi lời gọi server (/_serverFn/…), mọi thứ khác: đi thẳng ra mạng, không đụng cache.
 *    Báo cáo tiến độ mà hiện số của hôm qua thì còn hại hơn là chậm vài giây.
 *  · Bản mới lên là chiếm quyền ngay (skipWaiting + clients.claim) và dọn sạch cache đời cũ,
 *    khỏi cảnh người dùng phải xoá app mới thấy bản mới.
 */
const CACHE = "epmp-static-v1";
const PRECACHE = ["/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .catch(() => {}),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isHashedAsset = url.pathname.startsWith("/assets/") || url.pathname.startsWith("/_build/");
  const isIcon = PRECACHE.includes(url.pathname);
  if (!isHashedAsset && !isIcon) return;   // còn lại: để trình duyệt tự lo, service worker không xen vào

  e.respondWith(
    caches.match(req).then((hit) =>
      hit ||
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }),
    ),
  );
});
