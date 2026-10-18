/* Đồng bộ dữ liệu giữa các máy qua /api (Vercel Blob). Chỉ chạy khi admin đã đăng nhập trong tab này.
   Mỗi thay đổi được gửi lên server sau 1 giây. Xung đột: bản server thắng; bản của máy này được lưu vào khóa dự phòng trước khi ghi đè.
   ponytail: ghi toàn bộ dữ liệu theo phiên bản (last-write-wins), không gộp từng mục. Hai máy sửa cùng lúc thì bản sửa đến sau thắng.
   Nâng cấp: gộp theo updatedAt từng mục và thêm tombstone cho mục đã xóa. */
import { toast } from './utils.js';
import { snapshot, applyRemote } from './store.js';

const TOKEN_KEY = 'quan-ly-noi-bo:sync';
const BACKUP_KEY = 'quan-ly-noi-bo:truoc-dong-bo';
const DEBOUNCE_MS = 1000;

let token = null;
// null: chưa tải được dữ liệu từ server. Khi đó không ghi lên, tránh đè dữ liệu thật bằng dữ liệu mẫu của máy mới.
let baseVersion = null;
let timer = null;
let pushing = false;
let again = false;
let applying = false;

async function errText(res) {
  const body = await res.json().catch(() => ({}));
  return body.error || `HTTP ${res.status}`;
}

function api(method, url, body) {
  return fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
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
  const res = await api('GET', '/api/data');
  if (res.status === 401) return disconnectSync('Phiên đồng bộ đã hết hạn. Đăng nhập lại admin.');
  if (!res.ok) throw new Error(await errText(res));
  const doc = await res.json();
  if (baseVersion !== null && doc.version === baseVersion) return;
  if (doc.data) {
    keepLocalBackup();
    adopt(doc);
  } else {
    // Server chưa có dữ liệu: máy này là nguồn đầu tiên
    baseVersion = doc.version;
    pushNow();
  }
}

async function pushNow() {
  if (!token || baseVersion === null) return;
  if (pushing) {
    again = true;
    return;
  }
  pushing = true;
  try {
    const res = await api('PUT', '/api/data', { baseVersion, data: snapshot() });
    if (res.status === 401) return disconnectSync('Phiên đồng bộ đã hết hạn. Đăng nhập lại admin.');
    if (res.status === 409) {
      const doc = await res.json();
      keepLocalBackup();
      adopt(doc);
      again = false;
      toast('Máy khác vừa cập nhật dữ liệu. Đã tải bản mới; bản sửa vừa rồi của máy này được lưu dự phòng.', 'warning');
    } else if (res.ok) {
      baseVersion = (await res.json()).version;
    } else {
      throw new Error(await errText(res));
    }
  } catch (err) {
    console.warn(err);
    toast(`Đồng bộ lỗi: ${err.message}`, 'error');
  } finally {
    pushing = false;
  }
  if (again) {
    again = false;
    pushNow();
  }
}

/** Ngắt đồng bộ: gọi khi đăng xuất admin, hoặc khi token hết hạn (kèm thông báo). */
export function disconnectSync(message) {
  token = null;
  baseVersion = null;
  clearTimeout(timer);
  timer = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* Trình duyệt chặn lưu trữ */
  }
  if (message) toast(message, 'warning');
}

/** Gọi khi admin đăng nhập: lấy token từ server rồi tải dữ liệu chung. */
export async function connectSync(user, password) {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, password }),
  });
  if (!res.ok) throw new Error(await errText(res));
  token = (await res.json()).token;
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* Giữ trong bộ nhớ đến khi tải lại trang */
  }
  await pull();
}

/** Gọi khi khởi động: nếu tab này đã đăng nhập từ trước thì tải lại dữ liệu chung. */
export function initSync() {
  try {
    token = sessionStorage.getItem(TOKEN_KEY);
  } catch {
    token = null;
  }
  window.addEventListener('store:change', () => {
    if (!token || applying) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      pushNow();
    }, DEBOUNCE_MS);
  });
  // Quay lại tab: lấy thay đổi từ máy khác (bỏ qua nếu đang có thay đổi chờ gửi)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && token && !timer) {
      pull().catch((err) => console.warn(err));
    }
  });
  if (token) pull().catch((err) => toast(`Chưa tải được dữ liệu chung: ${err.message}`, 'error'));
}
