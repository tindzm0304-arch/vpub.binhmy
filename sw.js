/* Service worker: cho phép cài ứng dụng và mở được khi mất mạng.
   - Tệp của trang (cùng nguồn): lấy từ mạng trước, mất mạng thì dùng bản đã lưu, nên bản mới luôn có ngay khi online.
   - Thư viện CDN (đã ghim phiên bản): dùng bản đã lưu, cập nhật ngầm.
   - /api/*: luôn đi thẳng lên server, không lưu (dữ liệu nằm trong trình duyệt và được đồng bộ riêng).
   Danh sách tệp cần lưu do trang gửi sang (js/pwa.js), không phải liệt kê tay ở đây. */
const CACHE = 'qlnb-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Trang gửi danh sách tệp vừa tải: lưu lại để lần sau mở được khi mất mạng
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'precache') return;
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(
    event.data.urls.map((url) => cache.add(url).catch(() => { /* tệp lỗi: bỏ qua, các tệp khác vẫn lưu */ })),
  )));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    // no-cache: luôn hỏi lại server (304 nếu không đổi), tránh bộ nhớ đệm HTTP của trình duyệt giữ bản cũ
    const res = await fetch(request.mode === 'navigate' ? request.url : request, { cache: 'no-cache' });
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: request.mode === 'navigate' })
      ?? (request.mode === 'navigate' ? await cache.match('./') : undefined);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(event.request);
  const update = fetch(event.request).then((res) => {
    if (res.ok || res.type === 'opaque') cache.put(event.request, res.clone());
    return res;
  });
  if (hit) {
    event.waitUntil(update.catch(() => {}));
    return hit;
  }
  return update;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/api/')) return;
    event.respondWith(networkFirst(request));
  } else if (/^(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event));
  }
});
