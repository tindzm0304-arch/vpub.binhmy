/* Đồng bộ dữ liệu giữa các máy qua /api/data (Vercel Blob). Tự chạy khi mở trang, không cần đăng nhập.
   Mỗi thay đổi được gửi lên server sau 1 giây; cứ 60 giây (và khi quay lại tab) tải bản mới từ máy khác.
   Xung đột: bản server thắng; bản của máy này được lưu vào khóa dự phòng trước khi ghi đè.
   ponytail: ghi toàn bộ dữ liệu theo phiên bản (last-write-wins), không gộp từng mục. Hai máy sửa cùng lúc thì bản sửa đến sau thắng.
   Nâng cấp: gộp theo updatedAt từng mục và thêm tombstone cho mục đã xóa. */
import { toast } from './utils.js';
import { snapshot, applyRemote, seededFresh } from './store.js';

const BACKUP_KEY = 'quan-ly-noi-bo:truoc-dong-bo';
const DEBOUNCE_MS = 1000;
const POLL_MS = 60000;

// null: chưa tải được dữ liệu từ server. Khi đó không ghi lên, tránh đè dữ liệu thật bằng bản cũ của máy này.
let baseVersion = null;
let timer = null;
let pushing = false;
let again = false;
let applying = false;
let offline = false;

async function errText(res) {
  const body = await res.json().catch(() => ({}));
  return body.error || `HTTP ${res.status}`;
}

const api = (method, body) => fetch('/api/data', {
  method,
  headers: body ? { 'Content-Type': 'application/json' } : {},
  body: body && JSON.stringify(body),
});

/** Báo lỗi một lần cho mỗi đợt mất kết nối, không lặp lại mỗi 60 giây. */
function reportError(err) {
  console.warn(err);
  if (!offline) toast(`Đồng bộ lỗi: ${err.message}`, 'error');
  offline = true;
}

/** Giữ bản đang có trên máy này trước khi bị bản server ghi đè (một khóa, ghi đè bản cũ). */
function keepLocalBackup() {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify({ at: new Date().toISOString(), data: snapshot() }));
  } catch {
    /* Hết chỗ lưu trữ: bỏ qua bản dự phòng */
  }
}

/** Nhận bản từ server và nạp vào giao diện. Cờ `applying` chặn sự kiện store:change do chính việc nạp gây ra. */
function adopt(doc) {
  baseVersion = doc.version;
  applying = true;
  try {
    applyRemote(doc.data);
    window.dispatchEvent(new CustomEvent('store:change'));
  } finally {
    applying = false;
  }
}

async function pull() {
  const res = await api('GET');
  if (!res.ok) throw new Error(await errText(res));
  const doc = await res.json();
  offline = false;
  if (baseVersion !== null && doc.version === baseVersion) return;
  if (doc.data) {
    keepLocalBackup();
    adopt(doc);
    return;
  }
  // Server chưa có dữ liệu: máy này là nguồn đầu tiên. Máy mới chỉ có dữ liệu mẫu thì chờ đến khi có thay đổi thật.
  baseVersion = doc.version;
  if (!seededFresh) pushNow();
}

async function pushNow() {
  if (baseVersion === null) return;
  if (pushing) {
    again = true;
    return;
  }
  pushing = true;
  try {
    const res = await api('PUT', { baseVersion, data: snapshot() });
    if (res.status === 409) {
      const doc = await res.json();
      keepLocalBackup();
      adopt(doc);
      again = false;
      toast('Máy khác vừa cập nhật dữ liệu. Đã tải bản mới; bản sửa vừa rồi của máy này được lưu dự phòng.', 'warning');
    } else if (res.ok) {
      baseVersion = (await res.json()).version;
      offline = false;
    } else {
      throw new Error(await errText(res));
    }
  } catch (err) {
    reportError(err);
  } finally {
    pushing = false;
  }
  if (again) {
    again = false;
    pushNow();
  }
}

/** Tải bản mới nếu không có thay đổi đang chờ gửi. */
function refresh() {
  if (document.visibilityState !== 'visible' || timer || pushing) return;
  pull().catch(reportError);
}

/** Gọi khi khởi động, sau loadStore(). */
export function initSync() {
  window.addEventListener('store:change', () => {
    if (applying) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      // Chưa tải được bản server (mất mạng lúc mở trang): thử tải lại trước, thay đổi của máy này nằm trong bản dự phòng
      if (baseVersion === null) refresh();
      else pushNow();
    }, DEBOUNCE_MS);
  });
  document.addEventListener('visibilitychange', refresh);
  setInterval(refresh, POLL_MS);
  pull().catch(reportError);
}
