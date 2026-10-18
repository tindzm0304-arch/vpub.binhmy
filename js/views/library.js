/* Thư viện: nội dung đã lưu từ Giao việc BTV, Giao việc TTUB, Đơn thư và Phản ánh 1022. Lọc theo loại, trạng thái, phòng, ngày lưu; đưa về màn hình gốc hoặc xóa hẳn. */
import {
  store, effectiveStatus, deptName, sortedDepartments, restoreFromLibrary, deleteFromLibrary,
} from '../store.js';
import { openModal, closeModal, confirmDialog } from '../modal.js';
import {
  $, esc, fold, dateKey, formatDate, fillOptions, toast, inRange, statusBadge, STATUSES, wirePeriodFilter,
} from '../utils.js';

const SECTION_LABEL = {
  btv: 'Giao việc BTV', tasks: 'Giao việc TTUB', petitions: 'Đơn thư, PAKN', reflections: 'Phản ánh 1022',
};
const SECTION_ICON = {
  btv: 'fa-solid fa-stamp', tasks: 'fa-solid fa-list-check', petitions: 'fa-solid fa-envelope-open-text', reflections: 'fa-solid fa-tower-broadcast',
};

let period = null;
let detailId = null;

/** Thông tin hiển thị của một mục trong thư viện, tùy theo loại. */
function infoOf({ kind, section, item }) {
  if (kind === 'petitions') {
    return { code: item.code, title: `${item.code} · ${item.type}`, body: item.content, dept: item.deptId, deadline: item.deadline };
  }
  if (kind === 'reflections') {
    return { code: item.code, title: `${item.code} · ${item.area}`, body: item.content, dept: item.deptId, deadline: item.deadline };
  }
  return {
    code: section === 'btv' ? (item.btv?.resolutionNo ?? '') : '',
    title: item.title, body: item.desc, dept: item.departmentId, deadline: item.deadline,
  };
}

/* ---------------- Khởi tạo ---------------- */

export function initLibrary() {
  $('#lib-search').addEventListener('input', renderLibrary);
  for (const el of [$('#lib-section'), $('#lib-status'), $('#lib-dept')]) el.addEventListener('change', renderLibrary);
  period = wirePeriodFilter({
    select: $('#lib-period'), range: $('#lib-range'), from: $('#lib-from'), to: $('#lib-to'), onChange: renderLibrary,
  });
  fillOptions($('#lib-section'), [['all', 'Mọi loại'], ...Object.entries(SECTION_LABEL)]);
  fillOptions($('#lib-status'), STATUSES, '<option value="all">Mọi trạng thái</option>');
  $('#lib-rows').addEventListener('click', onRowClick);
  $('#lib-rows').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('tr[data-id]')) openDetail(e.target.dataset.id);
  });
  $('#lb-restore').addEventListener('click', () => {
    closeModal('library-modal');
    restoreEntries([detailId]);
  });
  $('#lb-delete').addEventListener('click', () => {
    closeModal('library-modal');
    deleteWithConfirm([detailId]);
  });
}

/* ---------------- Danh sách ---------------- */

/** Phòng trong bộ lọc luôn theo đúng danh mục hiện có, giữ lại lựa chọn đang chọn. */
function refreshDeptOptions() {
  const select = $('#lib-dept');
  const current = select.value;
  fillOptions(select, sortedDepartments().map((d) => [d.id, d.name]), '<option value="all">Mọi phòng xử lý</option>');
  select.value = [...select.options].some((o) => o.value === current) ? current : 'all';
}

export function renderLibrary() {
  const today = dateKey();
  refreshDeptOptions();
  const q = fold($('#lib-search').value.trim());
  const section = $('#lib-section').value;
  const status = $('#lib-status').value;
  const dept = $('#lib-dept').value;
  const bounds = period.bounds();

  const rows = store.library
    .filter((entry) => {
      const info = infoOf(entry);
      const hay = fold(`${info.title} ${info.code} ${info.body ?? ''}`);
      return (!q || hay.includes(q))
        && (section === 'all' || entry.section === section)
        && (status === 'all' || effectiveStatus(entry.item, today) === status)
        && (dept === 'all' || info.dept === dept)
        && inRange(dateKey(new Date(entry.savedAt)), bounds);
    })
    .sort((a, b) => b.savedAt - a.savedAt);

  $('#lib-summary').textContent = store.library.length
    ? `${store.library.length} mục trong thư viện · đang hiện ${rows.length}`
    : '';
  $('#lib-rows').innerHTML = rows.map((entry, i) => libRow(entry, today, i + 1)).join('');
  $('#lib-empty').hidden = rows.length > 0;
}

function libRow(entry, today, stt) {
  const info = infoOf(entry);
  const status = effectiveStatus(entry.item, today);
  return `
    <tr data-id="${esc(entry.id)}" tabindex="0">
      <td class="col-stt">${stt}</td>
      <td>
        <div class="task-title lib-type"><i class="${SECTION_ICON[entry.section]}"></i> ${esc(SECTION_LABEL[entry.section])}</div>
        ${info.code ? `<div class="meta-line"><span class="code">${esc(info.code)}</span></div>` : ''}
      </td>
      <td>
        <div class="task-title">${esc(info.title)}</div>
        <div class="task-desc">${esc(info.body || 'Không có nội dung')}</div>
      </td>
      <td>${esc(deptName(info.dept))}</td>
      <td>
        <span class="date-chip">${formatDate(info.deadline)}</span>
        <div class="meta-line">${statusBadge(status)}</div>
      </td>
      <td>${formatDate(dateKey(new Date(entry.savedAt)))}</td>
      <td class="t-right">
        <div class="row-actions">
          <button type="button" class="icon-btn" data-action="view" title="Xem chi tiết" aria-label="Xem chi tiết"><i class="fa-regular fa-eye"></i></button>
          <button type="button" class="icon-btn" data-action="restore" title="Đưa về màn hình gốc" aria-label="Đưa về màn hình gốc"><i class="fa-solid fa-rotate-left"></i></button>
          <button type="button" class="icon-btn is-danger" data-action="delete" title="Xóa hẳn" aria-label="Xóa hẳn"><i class="fa-regular fa-trash-can"></i></button>
        </div>
      </td>
    </tr>`;
}

function onRowClick(e) {
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'restore') restoreEntries([row.dataset.id]);
  else if (action === 'delete') deleteWithConfirm([row.dataset.id]);
  else openDetail(row.dataset.id);
}

/* ---------------- Chi tiết ---------------- */

function openDetail(id) {
  const entry = store.library.find((e) => e.id === id);
  if (!entry) return;
  detailId = id;
  const info = infoOf(entry);
  $('#lb-section').textContent = SECTION_LABEL[entry.section];
  $('#lb-title').textContent = info.title;
  $('#lb-meta').innerHTML = statusBadge(effectiveStatus(entry.item, dateKey()));
  $('#lb-dept').textContent = deptName(info.dept);
  $('#lb-deadline').textContent = formatDate(info.deadline);
  $('#lb-saved').textContent = formatDate(dateKey(new Date(entry.savedAt)));
  $('#lb-body').textContent = info.body || 'Không có nội dung.';
  openModal('library-modal');
}

/* ---------------- Khôi phục / xóa ---------------- */

/** Đưa mục về màn hình gốc; mục đã có sẵn ở đó thì chỉ bỏ khỏi thư viện. */
function restoreEntries(ids) {
  const n = restoreFromLibrary(ids);
  if (n) toast(`Đã đưa ${n} mục về màn hình gốc`, 'success');
  else toast('Mục này đã có sẵn trên màn hình gốc, đã bỏ khỏi thư viện', 'info');
}

async function deleteWithConfirm(ids) {
  const ok = await confirmDialog({
    title: ids.length === 1 ? 'Xóa hẳn mục này?' : `Xóa hẳn ${ids.length} mục?`,
    message: 'Mục và tệp đính kèm của nó sẽ bị xóa hẳn khỏi thư viện. Không thể khôi phục.',
    confirmText: 'Xóa hẳn',
    danger: true,
  });
  if (!ok) return;
  const n = deleteFromLibrary(ids);
  toast(`Đã xóa hẳn ${n} mục`, 'success');
}
