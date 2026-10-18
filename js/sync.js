/* Đồng bộ dữ liệu giữa các máy qua /api/data (Vercel Blob). Tự chạy khi mở trang, không cần đăng nhập;
   mỗi máy nhập mã truy cập chung một lần (lưu trong trình duyệt), nhập lại khi mã bị đổi.
   Mỗi thay đổi được gửi lên server sau 1 giây; cứ 30 giây (và khi quay lại tab) tải bản mới từ máy khác.
   Máy khác đã lưu trước (409) hoặc máy này có thay đổi chưa gửi: gộp ba chiều theo từng mục (js/merge.js), không ghi đè cả bộ.
   Bản gốc của lần đồng bộ gần nhất được lưu trong trình duyệt nên thay đổi chưa gửi vẫn được gộp sau khi tải lại trang. */
import { toast } from './utils.js';
import { snapshot, applyRemote, seededFresh } from './store.js';
import { merge3 } from './merge.js';

const BACKUP_KEY = 'quan-ly-noi-bo:truoc-dong-bo';
const CODE_KEY = 'quan-ly-noi-bo:ma-truy-cap';
const SYNCED_KEY = 'quan-ly-noi-bo:dong-bo-goc';
const DEBOUNCE_MS = 1000;
// ponytail: hỏi server định kỳ; mỗi lần là một thao tác đọc Blob. Cần nhanh hơn thì chuyển sang realtime (WebSocket/SSE).
const POLL_MS = 30000;

// Bản server ở lần đồng bộ gần nhất { version, data }. null: máy này chưa đồng bộ lần nào.
let synced = null;
let timer = null;
let pushing = false;
let again = false;
let applying = false;
let offline = false;
let stopped = false; // không có mã truy cập: dữ liệu chỉ lưu trên máy này đến khi tải lại trang
let code = '';

async function errText(res) {
  const body = await res.json().catch(() => ({}));
  return body.error || `HTTP ${res.status}`;
}

const normCode = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Hỏi mã truy cập. Trả về false nếu người dùng bỏ qua. */
function askCode(message) {
  code = normCode(window.prompt(message));
  try {
    if (code) localStorage.setItem(CODE_KEY, code);
    else localStorage.removeItem(CODE_KEY);
  } catch {
    /* Trình duyệt chặn lưu trữ: chỉ nhớ đến khi tải lại trang */
  }
  if (!code) {
    stopped = true;
    toast('Chưa nhập mã truy cập: dữ liệu chỉ lưu trên máy này. Tải lại trang để nhập mã; thay đổi sẽ được gộp lên server.', 'warning');
  }
  return Boolean(code);
}

const api = (method, body) => fetch('/api/data', {
  method,
  headers: { 'X-Access-Code': code, ...(body && { 'Content-Type': 'application/json' }) },
  body: body && JSON.stringify(body),
});

/** Mã sai hoặc đã đổi: hỏi lại rồi tải bản server (thay đổi của máy này được gộp, không mất). */
function unauthorized() {
  if (askCode('Mã truy cập không đúng hoặc đã được đổi. Nhập mã truy cập:')) return pull();
}

/** Báo lỗi một lần cho mỗi đợt mất kết nối, không lặp lại mỗi lần hỏi server. */
function reportError(err) {
  console.warn(err);
  if (!offline) toast(`Đồng bộ lỗi: ${err.message}`, 'error');
  offline = true;
}

function setSynced(version, data) {
  synced = { version, data };
  try {
    localStorage.setItem(SYNCED_KEY, JSON.stringify(synced));
  } catch {
    /* Hết chỗ lưu trữ: vẫn đồng bộ được, chỉ mất khả năng gộp sau khi tải lại trang */
  }
}

/** Giữ bản đang có trên máy này trước khi gộp (một khóa, ghi đè bản cũ). */
function keepLocalBackup() {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify({ at: new Date().toISOString(), data: snapshot() }));
  } catch {
    /* Hết chỗ lưu trữ: bỏ qua bản dự phòng */
  }
}

/** Máy này có thay đổi chưa gửi lên server không. */
const isDirty = () => !synced?.data || JSON.stringify(snapshot()) !== JSON.stringify(synced.data);

/** Nạp dữ liệu vào giao diện. Cờ `applying` chặn sự kiện store:change do chính việc nạp gây ra. */
function apply(data) {
  applying = true;
  try {
    applyRemote(data);
    window.dispatchEvent(new CustomEvent('store:change'));
  } finally {
    applying = false;
  }
}

/** Nhận bản server mới. Trả về true nếu máy này cần gửi lại (có thay đổi đã gộp hoặc server còn trống). */
function receive(doc) {
  if (!doc.data) {
    // Server chưa có dữ liệu: máy này là nguồn đầu tiên. Máy mới chỉ có dữ liệu mẫu thì chờ đến khi có thay đổi thật.
    setSynced(doc.version, null);
    return !seededFresh;
  }
  if (!isDirty() || (!synced && seededFresh)) {
    apply(doc.data);
    // Lưu bản đã nạp (đã chuẩn hóa khi nạp) làm gốc, để lần so sánh sau không báo thay đổi giả
    setSynced(doc.version, snapshot());
    return false;
  }
  keepLocalBackup();
  const merged = merge3(synced?.data, snapshot(), doc.data);
  setSynced(doc.version, doc.data);
  apply(merged);
  return true;
}

async function pull() {
  const res = await api('GET');
  if (res.status === 401) return unauthorized();
  if (!res.ok) throw new Error(await errText(res));
  const doc = await res.json();
  offline = false;
  if (synced && doc.version === synced.version) {
    if (isDirty()) pushNow();
    return;
  }
  if (receive(doc)) pushNow();
}

async function pushNow() {
  if (!synced || stopped) return;
  if (pushing) {
    again = true;
    return;
  }
  pushing = true;
  try {
    // Mỗi lần 409 là một lần gộp với bản mới hơn rồi gửi lại; giới hạn để không lặp vô hạn khi nhiều máy cùng ghi
    for (let tries = 0; tries < 3; tries++) {
      const data = snapshot();
      const res = await api('PUT', { baseVersion: synced.version, data });
      if (res.status === 401) {
        again = false;
        await unauthorized();
        return;
      }
      if (res.status === 409) {
        if (!receive(await res.json())) return;
        continue;
      }
      if (!res.ok) throw new Error(await errText(res));
      setSynced((await res.json()).version, data);
      offline = false;
      return;
    }
  } catch (err) {
    reportError(err);
  } finally {
    pushing = false;
    if (again) {
      again = false;
      pushNow();
    }
  }
}

/** Tải bản mới nếu không có thay đổi đang chờ gửi. */
function refresh() {
  if (stopped || document.visibilityState !== 'visible' || timer || pushing) return;
  pull().catch(reportError);
}

/** Gọi khi khởi động, sau loadStore(). */
export function initSync() {
  try {
    synced = JSON.parse(localStorage.getItem(SYNCED_KEY) || 'null');
    code = localStorage.getItem(CODE_KEY) || '';
  } catch {
    synced = null;
  }
  window.addEventListener('store:change', () => {
    if (applying || stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      // Chưa tải được bản server lần nào: tải trước, thay đổi của máy này sẽ được gộp
      if (!synced) refresh();
      else pushNow();
    }, DEBOUNCE_MS);
  });
  document.addEventListener('visibilitychange', refresh);
  setInterval(refresh, POLL_MS);
  if (!code && !askCode('Nhập mã truy cập để đồng bộ dữ liệu giữa các máy:')) return;
  pull().catch(reportError);
}
