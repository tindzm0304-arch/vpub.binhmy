/* Các trang Thùng rác, Nhật ký và Thông báo: nhắc hạn, thông báo, quy trình duyệt. */
import {
  store, restoreFromTrash, deleteFromTrash, emptyTrash, KIND_LABEL, ACTION_LABEL, TRASH_DAYS,
} from '../store.js';
import { getSettings, saveSettings } from '../settings.js';
import {
  desktopSupported, testDesktopNotice, digestText, copyDigest, collectNotices,
} from '../notify.js';
import {
  exportBackup, readBackup, applyBackup, applyMerge, previewMerge, undoInfo, undoRestore, countsOf, daysSinceBackup,
  COUNT_LABELS, AUTO_KEEP, listAutoSnapshots, restoreAutoSnapshot, removeAutoSnapshot, takeAutoSnapshot, autoBackupIfDue,
} from '../backup.js';
import { confirmDialog } from '../modal.js';
import {
  $, esc, fold, dateKey, dateTimeKey, timeKey, formatDate, formatDateTime, fillOptions, toast,
} from '../utils.js';

const DAY_MS = 86400000;
const TRASH_WARN_DAYS = 5; // còn từng này ngày thì đánh dấu sắp xóa hẳn
const ACTIVITY_PAGE = 50;
const KIND_ICON = {
  tasks: 'fa-solid fa-list-check', petitions: 'fa-solid fa-envelope-open-text', reflections: 'fa-solid fa-tower-broadcast',
  personnel: 'fa-solid fa-user', events: 'fa-regular fa-calendar',
};
let trKind = 'all';
let trQuery = '';
let alKind = 'all';
let alAction = 'all';
let alQuery = '';
let alLimit = ACTIVITY_PAGE;
let pending = null; // bản sao lưu đã chọn, chờ xác nhận: { ...payload, fileName, mode: 'merge' | 'replace' }
const countLine = (counts) => Object.entries(COUNT_LABELS)
  .map(([key, label]) => `${counts[key] ?? 0} ${label}`)
  .join(' · ');

/** Số mục từng loại trên máy → sau khi khôi phục, kèm chênh lệch. */
const diffLine = (now, next) => Object.entries(COUNT_LABELS).map(([key, label]) => {
  const a = now[key] ?? 0;
  const b = next[key] ?? 0;
  const d = b - a;
  return `${label} ${a} → ${b}${d ? ` (${d > 0 ? '+' : ''}${d})` : ''}`;
}).join(' · ');


const short = (text = '', max = 80) => (String(text).length > max ? `${String(text).slice(0, max)}…` : String(text));

/** Tên hiển thị của mục trong thùng rác. */
function entryName({ kind, item }) {
  if (kind === 'petitions') return `${item.code} · ${item.type}`;
  if (kind === 'reflections') return `${item.code} · ${item.area}`;
  if (kind === 'personnel') return item.name;
  return item.title;
}

/** Lưu cài đặt và báo đã lưu. */
function save(patch) {
  saveSettings(patch);
  toast('Đã lưu cài đặt', 'success');
}

/** Tải file sao lưu toàn bộ dữ liệu hiện có. */
async function exportNow(btn) {
  btn.disabled = true;
  try {
    const withFiles = $('#bk-files').checked;
    const { files, missing } = await exportBackup({ withFiles });
    const note = withFiles ? ` kèm ${files} tệp${missing ? ` (${missing} tệp không còn nội dung trên máy)` : ''}` : '';
    toast(`Đã tải bản sao lưu${note}`, 'success');
  } catch (err) {
    console.warn(err);
    toast('Không tạo được bản sao lưu', 'error');
  }
  btn.disabled = false;
  renderBackup();
}

/* ---------------- Sao lưu & khôi phục ---------------- */

export function renderBackup() {
  $('#bk-summary').textContent = countLine(countsOf(store));
  const days = daysSinceBackup();
  const { lastBackupAt: last, backupRemindDays: remind } = getSettings();
  $('#bk-last').innerHTML = last
    ? `Lần sao lưu gần nhất: <b>${esc(formatDateTime(last))}</b>${days >= remind ? ' <span class="badge badge-deadline">Nên sao lưu lại</span>' : ''}`
    : '<span class="badge badge-deadline">Chưa sao lưu lần nào</span>';

  const preview = $('#bk-preview');
  preview.hidden = !pending;
  if (pending) renderPreview(preview);

  const undo = undoInfo();
  const undoBox = $('#bk-undo');
  undoBox.hidden = !undo;
  if (undo) {
    undoBox.innerHTML = `
      <span><i class="fa-solid fa-clock-rotate-left"></i> Dữ liệu trước lần khôi phục / gộp lúc <b>${esc(formatDateTime(undo.at))}</b> vẫn được giữ.</span>
      <button type="button" class="btn btn-ghost btn-sm" id="bk-undo-btn">Hoàn tác</button>`;
  }
  renderAutoList();
}

function renderPreview(box) {
  const merging = pending.mode === 'merge';
  const plan = merging ? previewMerge(pending) : null;
  const labels = { ...COUNT_LABELS, trash: 'thùng rác' };
  const planLines = Object.entries(plan ?? {})
    .filter(([, p]) => p.added || p.updated)
    .map(([key, p]) => `${labels[key] ?? key}: +${p.added} mới, ${p.updated} cập nhật, ${p.localOnly} chỉ có trên máy`);
  box.innerHTML = `
    <div class="bk-file">
      <span class="file-icon ft-other"><i class="fa-solid fa-file-shield"></i></span>
      <div class="file-info">
        <span class="file-name">${esc(pending.fileName)}</span>
        <span class="file-size">Tạo lúc ${esc(formatDateTime(pending.exportedAt))} · ${pending.fileCount} tệp đính kèm</span>
      </div>
    </div>
    <p class="set-note">Trong bản sao lưu: ${esc(countLine(pending.counts))}</p>
    <fieldset class="bk-mode">
      <legend class="label">Cách khôi phục</legend>
      <label class="check-line">
        <input type="radio" name="bk-mode" value="merge" ${merging ? 'checked' : ''}>
        <span><b>Gộp</b> <small>Giữ dữ liệu hiện có. Mục chưa có thì thêm, mục đã có thì lấy bản mới hơn. Phù hợp khi gộp dữ liệu từ máy khác.</small></span>
      </label>
      <label class="check-line">
        <input type="radio" name="bk-mode" value="replace" ${merging ? '' : 'checked'}>
        <span><b>Thay thế</b> <small>Dữ liệu trên máy này được thay bằng đúng bản sao lưu.</small></span>
      </label>
    </fieldset>
    ${merging
    ? `<p class="set-note" id="bk-plan">${planLines.length ? esc(planLines.join(' · ')) : 'Không có gì mới: dữ liệu trên máy đã có đủ nội dung của bản sao lưu.'}</p>`
    : `<p class="set-note" id="bk-plan">Thay đổi số mục: ${esc(diffLine(countsOf(store), pending.counts))}</p>`}
    <div class="btn-group">
      <button type="button" class="btn ${merging ? 'btn-primary' : 'btn-danger'}" id="bk-apply">
        <i class="fa-solid ${merging ? 'fa-code-merge' : 'fa-rotate-left'}"></i> ${merging ? 'Gộp vào dữ liệu' : 'Thay thế bằng bản này'}
      </button>
      ${merging ? '' : '<button type="button" class="btn btn-secondary" id="bk-pre-export"><i class="fa-solid fa-download"></i> Tải dữ liệu hiện tại trước</button>'}
      <button type="button" class="btn btn-secondary" id="bk-cancel">Chọn file khác</button>
    </div>`;
}

/** Danh sách bản tự động trong IndexedDB (mới nhất đứng đầu). */
async function renderAutoList() {
  const box = $('#bk-auto-list');
  if (!box) return;
  const list = await listAutoSnapshots();
  const { autoBackup } = getSettings();
  $('#bk-auto-last').innerHTML = list.length
    ? `Bản tự động gần nhất: <b>${esc(formatDateTime(list[0].at))}</b> · ${list.length}/${AUTO_KEEP} bản${autoBackup ? '' : ' · <span class="badge">đang tắt tự sao lưu</span>'}`
    : `Chưa có bản tự động${autoBackup ? '' : ' · <span class="badge">đang tắt tự sao lưu</span>'}`;
  if (!list.length) {
    box.innerHTML = '<p class="set-note">Ứng dụng tự lưu một bản mỗi ngày khi mở, giữ tối đa 7 bản. Có thể bấm "Lưu một bản ngay" để lưu thêm.</p>';
    return;
  }
  box.innerHTML = list.map((s) => `
    <div class="auto-row">
      <div class="auto-info"><b>${esc(formatDateTime(s.at))}</b><small>${esc(countLine(s.counts))}</small></div>
      <div class="btn-group">
        <button type="button" class="btn btn-ghost btn-sm" data-auto-restore="${esc(s.id)}"><i class="fa-solid fa-rotate-left"></i> Khôi phục</button>
        <button type="button" class="icon-btn is-danger" data-auto-del="${esc(s.id)}" aria-label="Xóa bản tự động này"><i class="fa-regular fa-trash-can"></i></button>
      </div>
    </div>`).join('');
}

async function pickBackup(file) {
  if (!file) return;
  try {
    pending = { ...(await readBackup(file)), fileName: file.name, mode: 'merge' };
  } catch (err) {
    pending = null;
    toast(err.message, 'error');
  }
  renderBackup();
}

async function applyPending() {
  if (!pending) return;
  const merging = pending.mode === 'merge';
  const ok = await confirmDialog({
    title: merging ? 'Gộp bản sao lưu?' : 'Thay thế dữ liệu?',
    message: merging
      ? 'Mục trong bản sao lưu sẽ được thêm, hoặc thay bằng bản mới hơn nếu đã có. Mục chỉ có trên máy này được giữ nguyên.'
      : `Toàn bộ dữ liệu trên máy này (${countLine(countsOf(store))}) sẽ được thay bằng bản sao lưu (${countLine(pending.counts)}). Nên tải dữ liệu hiện tại trước khi thay thế.`,
    confirmText: merging ? 'Gộp' : 'Thay thế',
    danger: !merging,
  });
  if (!ok) return;
  try {
    if (merging) {
      const { undoSaved } = await applyMerge(pending);
      toast(undoSaved ? 'Đã gộp dữ liệu từ bản sao lưu' : 'Đã gộp — trình duyệt không đủ chỗ giữ bản hoàn tác', undoSaved ? 'success' : 'info');
    } else {
      const undoSaved = await applyBackup(pending);
      toast(undoSaved ? 'Đã khôi phục dữ liệu' : 'Đã khôi phục — trình duyệt không đủ chỗ giữ bản hoàn tác', undoSaved ? 'success' : 'info');
    }
    pending = null;
  } catch (err) {
    console.warn(err);
    toast('Không khôi phục được tệp đính kèm. Dữ liệu chưa thay đổi.', 'error');
  }
  renderBackup();
}

async function undoLast() {
  const ok = await confirmDialog({
    title: 'Hoàn tác khôi phục?',
    message: 'Dữ liệu sẽ quay về trạng thái ngay trước lần khôi phục / gộp gần nhất.',
    confirmText: 'Hoàn tác',
  });
  if (!ok) return;
  if (undoRestore()) toast('Đã quay về dữ liệu trước khi khôi phục', 'success');
  renderBackup();
}

async function restoreAuto(id) {
  const ok = await confirmDialog({
    title: 'Khôi phục bản tự động?',
    message: 'Dữ liệu hiện tại sẽ được thay bằng bản tự động này. Dữ liệu cũ được giữ để hoàn tác.',
    confirmText: 'Khôi phục',
  });
  if (!ok) return;
  try {
    await restoreAutoSnapshot(id);
    toast('Đã khôi phục từ bản tự động', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
  renderBackup();
}

/* ---------------- Thùng rác ---------------- */

const trashFiltered = () => store.trash.filter((e) => (trKind === 'all' || e.kind === trKind)
  && (!trQuery || fold(entryName(e)).includes(trQuery)));

export function renderTrash() {
  const kindSelect = $('#tr-kind');
  fillOptions(kindSelect, [
    ['all', `Tất cả loại (${store.trash.length})`],
    ...Object.keys(KIND_ICON).map((kind) => [kind, `${KIND_LABEL[kind]} (${store.trash.filter((e) => e.kind === kind).length})`]),
  ]);
  kindSelect.value = trKind;

  const shown = trashFiltered();
  $('#tr-summary').textContent = store.trash.length
    ? `${store.trash.length} mục · đang hiện ${shown.length} · mục xóa quá ${TRASH_DAYS} ngày sẽ bị xóa hẳn tự động`
    : '';
  $('#tr-list').innerHTML = shown.length
    ? shown.map((e) => {
      const left = Math.max(0, TRASH_DAYS - Math.floor((Date.now() - e.deletedAt) / DAY_MS));
      return `
        <li class="row-item">
          <span class="file-icon ft-other"><i class="${KIND_ICON[e.kind] ?? 'fa-regular fa-trash-can'}"></i></span>
          <div class="row-main">
            <b>${esc(entryName(e))}</b>
            <small>${esc(KIND_LABEL[e.kind] ?? e.kind)} · xóa lúc ${esc(formatDateTime(dateTimeKey(new Date(e.deletedAt))))}</small>
          </div>
          <span class="badge ${left <= TRASH_WARN_DAYS ? 'badge-deadline' : ''}">còn ${left} ngày</span>
          <div class="btn-group row-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-tr-restore="${esc(e.id)}"><i class="fa-solid fa-rotate-left"></i> Khôi phục</button>
            <button type="button" class="icon-btn is-danger" data-tr-del="${esc(e.id)}" aria-label="Xóa hẳn mục này"><i class="fa-regular fa-trash-can"></i></button>
          </div>
        </li>`;
    }).join('')
    : (store.trash.length ? '' : '<li class="set-note">Thùng rác trống.</li>');
  $('#tr-empty-note').hidden = !store.trash.length || shown.length > 0;
  $('#tr-restore-all').disabled = !shown.length;
  $('#tr-empty').disabled = !store.trash.length;
}

/** Khôi phục các mục; mục đã có sẵn trong dữ liệu thì chỉ bỏ khỏi thùng rác. */
function restoreEntries(ids) {
  const n = restoreFromTrash(ids);
  const skipped = ids.length - n;
  if (n) toast(`Đã khôi phục ${n} mục${skipped ? ` · ${skipped} mục đã có sẵn trong dữ liệu nên được bỏ khỏi thùng rác` : ''}`, 'success');
  else toast('Mục này đã có sẵn trong dữ liệu, đã bỏ khỏi thùng rác', 'info');
}

async function purgeEntries(ids) {
  const ok = await confirmDialog({
    title: ids.length === 1 ? 'Xóa hẳn mục này?' : `Xóa hẳn ${ids.length} mục?`,
    message: 'Mục và tệp đính kèm của chúng sẽ bị xóa hẳn. Không thể khôi phục.',
    confirmText: 'Xóa hẳn',
  });
  if (!ok) return;
  const n = deleteFromTrash(ids);
  toast(`Đã xóa hẳn ${n} mục`, 'success');
}

async function emptyTrashWithConfirm() {
  const ok = await confirmDialog({
    title: 'Dọn toàn bộ thùng rác?',
    message: `${store.trash.length} mục và tệp đính kèm của chúng sẽ bị xóa hẳn. Không thể hoàn tác.`,
    confirmText: 'Xóa hẳn',
  });
  if (!ok) return;
  emptyTrash();
  toast('Đã dọn thùng rác', 'success');
}

/* ---------------- Nhật ký ---------------- */

const activityFiltered = () => store.activity.filter((a) => (alKind === 'all' || a.kind === alKind)
  && (alAction === 'all' || a.action === alAction)
  && (!alQuery || fold(a.name ?? '').includes(alQuery)));

export function renderActivity() {
  const kindSelect = $('#al-kind');
  if (!kindSelect.options.length) {
    fillOptions(kindSelect, [['all', 'Mọi loại'], ...Object.entries(KIND_LABEL)]);
    fillOptions($('#al-action'), [['all', 'Mọi hành động'], ...Object.entries(ACTION_LABEL)]);
  }
  kindSelect.value = alKind;
  $('#al-action').value = alAction;

  const rows = activityFiltered();
  const shown = rows.slice(0, alLimit);
  $('#al-count').textContent = `Hiển thị ${shown.length} / ${rows.length} thay đổi`
    + (rows.length !== store.activity.length ? ` (tổng ${store.activity.length})` : '');

  let day = '';
  $('#al-list').innerHTML = shown.map((a) => {
    const d = dateKey(new Date(a.at));
    const head = d === day ? '' : `<li class="act-day">${esc(formatDate(d))}</li>`;
    day = d;
    return `${head}
      <li class="act-row">
        <time>${esc(timeKey(new Date(a.at)))}</time>
        <div class="act-main">
          <span class="chip">${esc(KIND_LABEL[a.kind] ?? a.kind)}</span>
          <b>${esc(ACTION_LABEL[a.action] ?? a.action)}</b>${a.name ? ` · ${esc(short(a.name))}` : ''}
          ${a.changes?.length ? `<ul class="act-changes">${a.changes.map((c) => `
            <li>${esc(c.label)}: <s>${esc(short(c.from, 60))}</s> → <b>${esc(short(c.to, 60))}</b></li>`).join('')}</ul>` : ''}
        </div>
      </li>`;
  }).join('');
  $('#al-empty').hidden = rows.length > 0 || !store.activity.length;
  if (!store.activity.length) $('#al-list').innerHTML = '<li class="set-note">Chưa có hoạt động nào.</li>';
  $('#al-more').hidden = rows.length <= alLimit;
  $('#al-more').textContent = `Xem thêm ${Math.min(ACTIVITY_PAGE, rows.length - alLimit)} thay đổi`;
  $('#al-export').disabled = !rows.length;
}

/** Xuất các thay đổi đang lọc ra CSV (mở được bằng Excel). */
function exportActivityCsv() {
  const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = activityFiltered().map((a) => [
    formatDateTime(dateTimeKey(new Date(a.at))),
    KIND_LABEL[a.kind] ?? a.kind,
    ACTION_LABEL[a.action] ?? a.action,
    a.name ?? '',
    (a.changes ?? []).map((c) => `${c.label}: ${c.from} → ${c.to}`).join('; '),
  ].map(cell).join(','));
  const head = ['Thời điểm', 'Loại', 'Hành động', 'Tên', 'Trường thay đổi'].map(cell).join(',');
  const blob = new Blob([`﻿${[head, ...lines].join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nhat-ky-${dateKey()}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Đã xuất ${lines.length} dòng nhật ký`, 'success');
}

/* ---------------- Thông báo & quy trình ---------------- */

/** Tóm tắt những gì đang cần nhắc, theo cài đặt hiện tại. */
function renderSummary() {
  const notices = collectNotices();
  const pill = (tone, icon, text) => `<span class="notice-pill is-${tone}"><i class="${icon}"></i> ${esc(text)}</span>`;
  const count = (test) => notices.filter(test).length;
  $('#nf-summary').innerHTML = notices.length
    ? [
      pill('danger', 'fa-solid fa-triangle-exclamation', `Quá hạn / trễ: ${count((n) => n.level === 'danger')}`),
      pill('warn', 'fa-solid fa-user-tie', `Cần báo lãnh đạo: ${count((n) => n.key.endsWith(':escalate'))}`),
      pill('info', 'fa-regular fa-hourglass-half', `Sắp đến hạn: ${count((n) => n.group === 'due' && n.level !== 'danger' && !n.key.startsWith('rule:'))}`),
      pill('info', 'fa-regular fa-envelope-open', `Đơn KN/TC chưa có việc: ${count((n) => n.key.startsWith('rule:petition'))}`),
      pill('info', 'fa-solid fa-user-check', `Chờ duyệt quá lâu: ${count((n) => n.key.startsWith('rule:review'))}`),
    ].join('')
    : pill('ok', 'fa-solid fa-circle-check', 'Hiện không có việc nào cần nhắc');
}

export function renderNotify() {
  const s = getSettings();
  $('#nf-lead').value = String(s.leadDays);
  $('#nf-backup').value = String(s.backupRemindDays);
  $('#nf-escalate').value = String(s.escalateDays);
  $('#nf-rule-petition').value = String(s.rulePetitionNoTaskDays);
  $('#nf-rule-review').value = String(s.ruleReviewDays);
  $('#bk-auto').checked = s.autoBackup;
  $('#nf-approval').checked = s.approvalRequired;
  renderSummary();

  const supported = desktopSupported();
  const permission = supported ? Notification.permission : 'unsupported';
  $('#nf-desktop').checked = s.desktopNotify && permission === 'granted';
  $('#nf-desktop').disabled = !supported || permission === 'denied';
  $('#nf-test').disabled = !$('#nf-desktop').checked;
  $('#nf-desktop-state').textContent = {
    unsupported: 'Trình duyệt này không hỗ trợ thông báo trên màn hình.',
    denied: 'Trình duyệt đang chặn thông báo của trang này. Mở biểu tượng ổ khóa cạnh địa chỉ trang để cho phép.',
    granted: s.desktopNotify ? 'Đang bật. Kiểm tra mỗi 5 phút khi trang đang mở.' : 'Đã được phép, đang tắt.',
    default: 'Bấm để bật — trình duyệt sẽ hỏi quyền hiển thị thông báo.',
  }[permission];
}

async function toggleDesktop(e) {
  if (!e.target.checked) {
    saveSettings({ desktopNotify: false });
  } else {
    const permission = await Notification.requestPermission();
    saveSettings({ desktopNotify: permission === 'granted' });
    if (permission !== 'granted') toast('Chưa được phép hiển thị thông báo', 'error');
  }
  renderNotify();
}

/* ---------------- Khởi tạo ---------------- */

export function initSettingsPanel() {
  fillOptions($('#nf-lead'), [1, 2, 3, 5, 7].map((n) => [String(n), `${n} ngày`]));
  fillOptions($('#nf-backup'), [3, 7, 14, 30].map((n) => [String(n), `${n} ngày`]));
  fillOptions($('#nf-escalate'), [3, 5, 7, 10, 15, 30].map((n) => [String(n), `${n} ngày`]));
  const offOrDays = [0, 1, 2, 3, 5, 7].map((n) => [String(n), n === 0 ? 'Tắt' : `sau ${n} ngày`]);
  fillOptions($('#nf-rule-petition'), offOrDays);
  fillOptions($('#nf-rule-review'), offOrDays);

  // Cài đặt đổi từ nơi khác (ví dụ công tắc thông báo): vẽ lại đúng màn đang mở
  window.addEventListener('settings:change', () => {
    if (!$('#view-backup').hidden) renderBackup();
    if (!$('#view-notify').hidden) renderNotify();
  });

  // Sao lưu
  $('#bk-export').addEventListener('click', (e) => exportNow(e.currentTarget));
  const drop = $('#bk-drop');
  drop.addEventListener('click', () => $('#bk-file').click());
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      $('#bk-file').click();
    }
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('is-drag');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-drag'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-drag');
    pickBackup(e.dataTransfer.files[0]);
  });
  $('#bk-file').addEventListener('change', (e) => {
    pickBackup(e.target.files[0]);
    e.target.value = '';
  });
  $('#bk-preview').addEventListener('change', (e) => {
    if (e.target.name !== 'bk-mode' || !pending) return;
    pending.mode = e.target.value;
    renderBackup();
  });
  $('#bk-preview').addEventListener('click', (e) => {
    if (e.target.closest('#bk-apply')) applyPending();
    if (e.target.closest('#bk-pre-export')) exportNow($('#bk-pre-export'));
    if (e.target.closest('#bk-cancel')) {
      pending = null;
      renderBackup();
      $('#bk-file').click();
    }
  });
  $('#bk-undo').addEventListener('click', (e) => {
    if (e.target.closest('#bk-undo-btn')) undoLast();
  });
  $('#bk-auto').addEventListener('change', (e) => {
    save({ autoBackup: e.target.checked });
    if (e.target.checked) autoBackupIfDue();
  });
  $('#bk-auto-now').addEventListener('click', async () => {
    try {
      await takeAutoSnapshot();
      toast('Đã lưu một bản tự động', 'success');
    } catch (err) {
      console.warn(err);
      toast('Không lưu được bản tự động trên trình duyệt này', 'error');
    }
    renderBackup();
  });
  $('#bk-auto-list').addEventListener('click', async (e) => {
    const restore = e.target.closest('[data-auto-restore]');
    const del = e.target.closest('[data-auto-del]');
    if (restore) restoreAuto(restore.dataset.autoRestore);
    if (del) {
      await removeAutoSnapshot(del.dataset.autoDel);
      toast('Đã xóa bản tự động', 'success');
      renderAutoList();
    }
  });

  // Thùng rác
  $('#tr-search').addEventListener('input', (e) => {
    trQuery = fold(e.target.value.trim());
    renderTrash();
  });
  $('#tr-kind').addEventListener('change', (e) => {
    trKind = e.target.value;
    renderTrash();
  });
  $('#tr-list').addEventListener('click', (e) => {
    const restore = e.target.closest('[data-tr-restore]');
    const del = e.target.closest('[data-tr-del]');
    if (restore) restoreEntries([restore.dataset.trRestore]);
    if (del) purgeEntries([del.dataset.trDel]);
  });
  $('#tr-restore-all').addEventListener('click', () => restoreEntries(trashFiltered().map((e) => e.id)));
  $('#tr-empty').addEventListener('click', emptyTrashWithConfirm);

  // Nhật ký
  $('#al-search').addEventListener('input', (e) => {
    alQuery = fold(e.target.value.trim());
    alLimit = ACTIVITY_PAGE;
    renderActivity();
  });
  $('#al-kind').addEventListener('change', (e) => {
    alKind = e.target.value;
    alLimit = ACTIVITY_PAGE;
    renderActivity();
  });
  $('#al-action').addEventListener('change', (e) => {
    alAction = e.target.value;
    alLimit = ACTIVITY_PAGE;
    renderActivity();
  });
  $('#al-more').addEventListener('click', () => {
    alLimit += ACTIVITY_PAGE;
    renderActivity();
  });
  $('#al-export').addEventListener('click', exportActivityCsv);

  // Thông báo & quy trình
  const bindNumber = (id, key) => $(id).addEventListener('change', (e) => save({ [key]: Number(e.target.value) }));
  bindNumber('#nf-lead', 'leadDays');
  bindNumber('#nf-backup', 'backupRemindDays');
  bindNumber('#nf-escalate', 'escalateDays');
  bindNumber('#nf-rule-petition', 'rulePetitionNoTaskDays');
  bindNumber('#nf-rule-review', 'ruleReviewDays');
  $('#nf-approval').addEventListener('change', (e) => save({ approvalRequired: e.target.checked }));
  $('#nf-desktop').addEventListener('change', toggleDesktop);
  $('#nf-test').addEventListener('click', () => {
    if (!testDesktopNotice()) toast('Chưa được phép hiển thị thông báo. Bật công tắc trước.', 'error');
  });
  $('#nf-preview').addEventListener('click', () => {
    const text = digestText();
    $('#nf-digest').hidden = false;
    $('#nf-digest').textContent = text || 'Hiện không có việc nào cần nhắc.';
  });
  $('#nf-copy-digest').addEventListener('click', copyDigest);
}
