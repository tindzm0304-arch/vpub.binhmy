/* Đăng nhập admin: chặn sửa, xóa, tạo mới và đổi trạng thái ở các màn quản trị khi chưa đăng nhập.
   Chỉ là khóa phía trình duyệt: ai mở được mã nguồn đều thấy tài khoản. Không dùng cho dữ liệu thật cần bảo mật. */
import { $, toast } from './utils.js';
import { openModal, closeModal, confirmDialog } from './modal.js';
import { ADMIN_CONFIG } from './admin-config.js';
import { connectSync, disconnectSync } from './sync.js';

// Mật khẩu không nằm trong mã nguồn: chỉ có salt + hash PBKDF2 (đổi bằng: node scripts/admin-password.mjs)
const AUTH_KEY = 'quan-ly-noi-bo:admin';

const bytesFromHex = (hex) => Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));
const hexFromBytes = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** So khớp mật khẩu với hash đã lưu. Ném lỗi nếu trình duyệt không có WebCrypto (ví dụ trang HTTP thường). */
async function passwordMatches(password) {
  if (!globalThis.crypto?.subtle) throw new Error('Trình duyệt không hỗ trợ mã hóa cần thiết để đăng nhập.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: bytesFromHex(ADMIN_CONFIG.salt),
    iterations: ADMIN_CONFIG.iterations,
    hash: 'SHA-256',
  }, key, 256);
  return hexFromBytes(new Uint8Array(bits)) === ADMIN_CONFIG.hash;
}

/** Màn cần admin để sửa/xóa: chỉ cụm Quản lý chung và Cài đặt. Công việc & tiếp dân dùng được khi chưa đăng nhập. */
const GATED_VIEWS = ['personnel', 'departments', 'notify', 'automation', 'health', 'trash', 'activity', 'backup'];
const onGatedView = () => GATED_VIEWS.some((key) => !document.getElementById(`view-${key}`)?.hidden);
const WRITE_CLICK = '.btn-primary, .btn-danger, #detail-hint-btn, [data-action]:not([data-action="view"]):not([data-action="open-task"])';
// Mở form chỉnh sửa được phép khi chưa đăng nhập; chỉ lưu (submit) mới cần admin
const EDIT_OPEN = '[data-action="edit"], #detail-edit, #btd-edit';
const WRITE_CHANGE = '[data-action="status"], #detail-status, #ptd-status, #pad-status, [id^="task-bulk-"]';

// Dự phòng khi trình duyệt chặn sessionStorage: nhớ trong bộ nhớ đến khi tải lại trang
let adminInMemory = false;

export function isAdmin() {
  if (adminInMemory) return true;
  try {
    return sessionStorage.getItem(AUTH_KEY) === '1';
  } catch {
    return false;
  }
}

function setAdmin(on) {
  adminInMemory = on;
  if (!on) disconnectSync();
  try {
    if (on) sessionStorage.setItem(AUTH_KEY, '1');
    else sessionStorage.removeItem(AUTH_KEY);
  } catch {
    /* Trình duyệt chặn lưu trữ: chỉ giữ trong bộ nhớ */
  }
  renderAuth();
}

/** Nút trên header: hiện trạng thái đăng nhập; bấm để đăng nhập hoặc đăng xuất. */
function renderAuth() {
  const on = isAdmin();
  const chip = $('#auth-toggle');
  chip.classList.toggle('is-admin', on);
  chip.querySelector('i').className = on ? 'fa-solid fa-user-check' : 'fa-solid fa-user-lock';
  $('#auth-text').textContent = on ? 'Admin · Đăng xuất' : 'Chưa đăng nhập';
  chip.setAttribute('aria-label', on ? 'Đang đăng nhập admin. Bấm để đăng xuất' : 'Chưa đăng nhập. Bấm để đăng nhập admin');
  document.querySelectorAll('[data-admin-group]').forEach((el) => {
    el.hidden = !on;
  });
}

/** Đang ở màn cần admin và thao tác này là sửa/xóa/tạo mới. Bỏ qua chính hộp đăng nhập và hộp xác nhận. */
function isGatedWrite(target, selector) {
  if (isAdmin() || !onGatedView()) return false;
  if (target.closest('#login-modal, #confirm-modal')) return false;
  if (selector === 'click') {
    const el = target.closest('button, a, [data-action]');
    if (el?.matches(EDIT_OPEN)) return false;
    return Boolean(el?.matches(WRITE_CLICK));
  }
  if (selector === 'change') {
    const settings = target.closest('#view-notify, #view-automation');
    return Boolean(settings || target.matches(WRITE_CHANGE));
  }
  return true; // submit và drop luôn là ghi dữ liệu
}

function askLogin(e) {
  e.preventDefault();
  e.stopPropagation();
  $('#login-err').hidden = true;
  $('#login-pass').value = '';
  // Đổi trạng thái/thiết lập bị chặn: vẽ lại màn để ô chọn trở về giá trị đã lưu
  if (e.type === 'change') window.dispatchEvent(new Event('store:change'));
  openModal('login-modal');
}

export function initAuth() {
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = $('#login-form button[type="submit"]');
    submit.disabled = true;
    let ok = false;
    try {
      ok = $('#login-user').value.trim() === ADMIN_CONFIG.user && await passwordMatches($('#login-pass').value);
    } catch (err) {
      console.warn(err);
      toast(err.message, 'error');
    } finally {
      submit.disabled = false;
    }
    if (!ok) {
      $('#login-err').hidden = false;
      $('#login-pass').select();
      return;
    }
    setAdmin(true);
    closeModal('login-modal');
    toast('Đã đăng nhập admin. Bấm lại thao tác để tiếp tục.', 'success');
    connectSync($('#login-user').value.trim(), $('#login-pass').value)
      .catch((err) => toast(`Chưa đồng bộ được: ${err.message}`, 'error'));
  });

  $('#auth-toggle').addEventListener('click', async () => {
    if (!isAdmin()) {
      openModal('login-modal');
      return;
    }
    const ok = await confirmDialog({
      title: 'Đăng xuất admin?',
      message: 'Sau khi đăng xuất, sửa và xóa ở các màn quản trị sẽ cần đăng nhập lại.',
      confirmText: 'Đăng xuất',
      danger: false,
    });
    if (!ok) return;
    setAdmin(false);
    toast('Đã đăng xuất admin.', 'info');
  });

  // Chặn ở pha capture để không chạy trình xử lý của phần tử đích
  document.addEventListener('click', (e) => {
    if (isGatedWrite(e.target, 'click')) askLogin(e);
  }, true);
  document.addEventListener('change', (e) => {
    if (isGatedWrite(e.target, 'change')) askLogin(e);
  }, true);
  document.addEventListener('submit', (e) => {
    if (isGatedWrite(e.target, 'submit')) askLogin(e);
  }, true);
  // Kéo thẻ sang cột khác trên "Bảng theo trạng thái" cũng đổi trạng thái
  document.addEventListener('drop', (e) => {
    if (isGatedWrite(e.target, 'drop')) askLogin(e);
  }, true);

  renderAuth();
}
