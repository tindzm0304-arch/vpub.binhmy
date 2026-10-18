/* Hộp thoại: mở/đóng, phím Esc, giữ focus trong hộp thoại, và hộp xác nhận. */
import { $, $$ } from './utils.js';

const openIds = [];
let returnFocusEl = null;
let confirmResolve = null;

export function openModal(id) {
  const el = document.getElementById(id);
  if (!el || openIds.includes(id)) return;
  if (!openIds.length) returnFocusEl = document.activeElement;
  el.hidden = false;
  openIds.push(id);
  const target = el.querySelector('[data-autofocus]')
    || el.querySelector('input:not([type="hidden"]):not([type="file"]):not([readonly]), select, textarea')
    || el.querySelector('button');
  target?.focus({ preventScroll: true });
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (!el || el.hidden) return;
  el.hidden = true;
  const idx = openIds.lastIndexOf(id);
  if (idx !== -1) openIds.splice(idx, 1);

  if (id === 'confirm-modal' && confirmResolve) {
    const resolve = confirmResolve;
    confirmResolve = null;
    resolve(false);
  }
  if (!openIds.length) {
    if (returnFocusEl?.isConnected) returnFocusEl.focus({ preventScroll: true });
    returnFocusEl = null;
  }
  document.dispatchEvent(new CustomEvent('modal:closed', { detail: { id } }));
}

/** Hiện hộp xác nhận và chờ người dùng bấm. Trả về true nếu đồng ý. */
export function confirmDialog({ title, message, confirmText = 'Xác nhận', danger = true }) {
  $('#confirm-title').textContent = title;
  $('#confirm-msg').textContent = message;
  const ok = $('#confirm-ok');
  ok.textContent = confirmText;
  ok.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  const icon = $('#confirm-icon');
  icon.className = `confirm-icon ${danger ? 'is-danger' : ''}`;
  icon.innerHTML = `<i class="fa-solid ${danger ? 'fa-trash-can' : 'fa-circle-question'}"></i>`;

  return new Promise((resolve) => {
    if (confirmResolve) confirmResolve(false);
    confirmResolve = resolve;
    openModal('confirm-modal');
  });
}

function settleConfirm(result) {
  if (!confirmResolve) return;
  const resolve = confirmResolve;
  confirmResolve = null;
  closeModal('confirm-modal');
  resolve(result);
}

function trapFocus(id, e) {
  const panel = document.getElementById(id)?.querySelector('.modal-panel');
  if (!panel) return;
  const items = $$(
    'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
    panel,
  ).filter((el) => el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function initModals() {
  document.addEventListener('click', (e) => {
    const closer = e.target.closest('[data-close]');
    if (closer) {
      closeModal(closer.dataset.close);
      return;
    }
    if (e.target.classList.contains('modal')) closeModal(e.target.id);
  });

  $('#confirm-ok').addEventListener('click', () => settleConfirm(true));
  $('#confirm-cancel').addEventListener('click', () => settleConfirm(false));

  document.addEventListener('keydown', (e) => {
    if (!openIds.length) return;
    const topId = openIds[openIds.length - 1];
    if (e.key === 'Escape') closeModal(topId);
    else if (e.key === 'Tab') trapFocus(topId, e);
  });
}
