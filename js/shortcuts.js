/* Phím tắt: không chạy khi đang gõ trong ô nhập hoặc khi có hộp thoại mở.
   /  hoặc Ctrl+K   tìm kiếm toàn hệ thống
   N                tạo mới ở màn hình hiện tại
   G rồi chữ cái    chuyển màn hình (G O Dashboard, G T Giao việc TTUB, ...)
   ?                xem bảng phím tắt */
import { openModal } from './modal.js';

export const VIEW_KEYS = [
  ['o', 'Dashboard hệ thống', 'overview'],
  ['r', 'Báo cáo định kỳ', 'reports'],
  ['b', 'Giao việc BTV', 'btv'],
  ['t', 'Giao việc TTUB', 'tasks'],
  ['p', 'Đơn thư, PAKN', 'petitions'],
  ['f', 'Phản ánh 1022', 'reflections'],
  ['c', 'Lịch công tác', 'calendar'],
  ['n', 'Nhân sự', 'personnel'],
  ['d', 'Phòng ban', 'departments'],
];
const NEW_BUTTON = {
  tasks: '#task-new', btv: '#bt-new', petitions: '#pt-new', reflections: '#pa-new',
  calendar: '#event-new', personnel: '#person-new', departments: '#dept-new',
};
const G_WINDOW_MS = 1200;

const isTextField = (el) => {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'file', 'range'].includes(el.type);
};

export function initShortcuts({ openSearch }) {
  let gPressedAt = 0;
  document.addEventListener('keydown', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if ((e.ctrlKey || e.metaKey) && key === 'k') {
      e.preventDefault();
      openSearch();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTextField(document.activeElement) || document.querySelector('.modal:not([hidden])')) return;

    if (key === '/') {
      e.preventDefault();
      openSearch();
      return;
    }
    if (key === '?') {
      e.preventDefault();
      openModal('shortcut-modal');
      return;
    }
    if (gPressedAt && Date.now() - gPressedAt < G_WINDOW_MS) {
      gPressedAt = 0;
      const target = VIEW_KEYS.find(([k]) => k === key);
      if (target) {
        e.preventDefault();
        location.hash = target[2];
      }
      return;
    }
    if (key === 'g') {
      gPressedAt = Date.now();
      return;
    }
    if (key === 'n') {
      const view = location.hash.slice(1);
      const btn = document.querySelector(NEW_BUTTON[view] ?? '#__none__');
      if (btn) {
        e.preventDefault();
        btn.click();
      }
    }
  });
}
