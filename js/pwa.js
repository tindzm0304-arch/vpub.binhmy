/* Cài như ứng dụng (PWA): đăng ký service worker (sw.js) và nút "Cài ứng dụng" trên thanh đầu trang.
   Chrome / Edge / Android hiện nút khi trình duyệt cho phép cài. iPhone, iPad: Safari → Chia sẻ → Thêm vào MH chính. */
import { $, toast } from './utils.js';

let deferred = null;

/** Gửi cho service worker danh sách tệp trang vừa tải, để lần sau mở được khi mất mạng. */
function precacheLoaded(sw) {
  const urls = [
    new URL('./', location.href).href,
    ...performance.getEntriesByType('resource').map((e) => e.name).filter((u) => !u.includes('/api/')),
  ];
  sw.postMessage({ type: 'precache', urls: [...new Set(urls)] });
}

export function initPwa() {
  const btn = $('#install-app');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });
  btn.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    btn.hidden = true;
    if (outcome === 'accepted') toast('Đang cài ứng dụng. Mở lại từ biểu tượng trên màn hình hoặc menu Start.', 'success');
  });
  window.addEventListener('appinstalled', () => {
    btn.hidden = true;
  });

  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('./sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then((reg) => precacheLoaded(reg.active))
    .catch((err) => console.warn('Không đăng ký được service worker', err));
}
