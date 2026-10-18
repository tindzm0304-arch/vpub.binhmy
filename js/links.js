/* Đường dẫn riêng cho từng hồ sơ: #tasks/<id>, #petitions/<id>, #reflections/<id>, #personnel/<id>, #events/<id>.
   Mở hộp chi tiết thì địa chỉ trang đổi theo (replaceState, không thêm lịch sử); đóng hộp thì trở về màn hình đang xem.
   Gửi địa chỉ này cho đồng nghiệp: mở ra là vào thẳng hồ sơ (máy mới chưa có dữ liệu thì chờ đồng bộ xong rồi mở). */
import { openerFor } from './search.js';
import { toast } from './utils.js';

const RECORD = /^#(tasks|petitions|reflections|personnel|events)\/(.+)$/;
let openKey = '';

/** Địa chỉ dạng #kind/id → { kind, id }; địa chỉ thường → null. */
export function parseRecordHash(hash = location.hash) {
  const m = RECORD.exec(hash);
  return m ? { kind: m[1], id: decodeURIComponent(m[2]) } : null;
}

const activeView = () => document.querySelector('.view:not([hidden])')?.id.slice('view-'.length) ?? 'overview';

/**
 * Mở hồ sơ theo địa chỉ. `showView` là hàm chuyển màn của app.js.
 * Chưa có hồ sơ (dữ liệu chưa tải từ server): thử lại một lần sau lần đồng bộ kế tiếp.
 */
export function openRecordFromHash(rec, showView, retried = false) {
  if (`${rec.kind}/${rec.id}` === openKey) return; // hộp chi tiết này đang mở
  const opener = openerFor(rec.kind, rec.id);
  if (opener) {
    showView(opener.view);
    opener.open();
    return;
  }
  if (!retried) {
    // Thử lại sau lần đồng bộ kế tiếp, hoặc sau 5 giây nếu không có đồng bộ (mất mạng, chạy trên máy)
    const retry = () => {
      clearTimeout(timer);
      window.removeEventListener('store:change', retry);
      openRecordFromHash(rec, showView, true);
    };
    const timer = setTimeout(retry, 5000);
    window.addEventListener('store:change', retry);
    return;
  }
  toast('Không tìm thấy hồ sơ theo đường dẫn này. Có thể hồ sơ đã bị xóa hoặc chưa được đồng bộ.', 'error');
  history.replaceState(null, '', `#${activeView()}`);
}

export function initLinks() {
  // recent.js phát sự kiện này mỗi khi một hộp chi tiết được mở
  window.addEventListener('record:open', (e) => {
    const { kind, id } = e.detail;
    openKey = `${kind}/${id}`;
    history.replaceState(null, '', `#${kind}/${encodeURIComponent(id)}`);
  });
  document.addEventListener('modal:closed', (e) => {
    if (!e.detail.id.endsWith('-detail-modal') || !parseRecordHash()) return;
    openKey = '';
    history.replaceState(null, '', `#${activeView()}`);
  });
  document.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-copy-link]')) return;
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Đã sao chép liên kết tới hồ sơ. Dán vào Zalo hoặc email để gửi đồng nghiệp.', 'success');
    } catch {
      toast(`Không sao chép được. Liên kết: ${location.href}`, 'info');
    }
  });
}
