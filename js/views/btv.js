/* Giao việc Ban Thường vụ: công việc theo nghị quyết / thông báo, hạn hoàn thành và hạn báo cáo BTV riêng. */
import {
  store, taskById, effectiveStatus, syncTaskEvent, removeTask, libraryWithUndo, persist, addTimeline, petitionById, deptName, deptNames,
} from '../store.js';
import { openModal, closeModal, confirmDialog } from '../modal.js';
import { drawDonut } from '../donut.js';
import { rememberRecent } from '../recent.js';
import { fillLeadSelect, renderCollabList, readCollabList, wireLeadSelect, deptLines } from '../assign.js';
import {
  $, $$, esc, fold, uid, dateKey, addDays, formatDate, statusBadge, priorityBadge, fillOptions, toast,
  wirePeriodFilter, inRange, PRIORITIES, STATUSES, CLOSED, statusChoices,
} from '../utils.js';

const BTV_STATUS_COLORS = {
  'Chưa thực hiện': '#94a3b8', 'Sắp đến hạn': '#f59e0b', 'Quá hạn': '#ef4444', 'Hoàn thành': '#10b981',
};
const REPORT_LABEL ={ done: 'Đã báo cáo', late: 'Quá hạn báo cáo', soon: 'Sắp đến hạn báo cáo', wait: 'Chờ báo cáo' };
const REPORT_BADGE = { done: 'badge-done', late: 'badge-overdue', soon: 'badge-deadline', wait: 'badge-doing' };

let period = null;
let formId = null;
let formSourceId = null;
let detailId = null;

/** Trạng thái báo cáo BTV: đã báo cáo, quá hạn, sắp đến hạn (trong 3 ngày) hoặc chờ. */
export function reportState(task, today = dateKey()) {
  const b = task.btv ?? {};
  if (b.reported) return 'done';
  if (b.reportDue < today) return 'late';
  if (b.reportDue <= addDays(today, 3)) return 'soon';
  return 'wait';
}

/* ---------------- Khởi tạo ---------------- */

export function initBtv() {
  $('#bt-search').addEventListener('input', renderBtv);
  $('#bt-state').addEventListener('change', renderBtv);
  // Bấm thẻ KPI: lọc danh sách theo thẻ đó (giữ nguyên các bộ lọc khác); bấm lại thẻ đang chọn để bỏ lọc
  for (const btn of $$('[data-bt-state]')) {
    btn.addEventListener('click', () => {
      const select = $('#bt-state');
      select.value = select.value === btn.dataset.btState ? 'all' : btn.dataset.btState;
      renderBtv();
      $('#bt-rows').closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  wireLeadSelect($('#bt-f-dept'), $('#bt-collab-list'));
  period = wirePeriodFilter({
    select: $('#bt-period'), range: $('#bt-range'), from: $('#bt-from'), to: $('#bt-to'), onChange: renderBtv,
  });
  $('#bt-new').addEventListener('click', () => openBtvForm());
  $('#bt-rows').addEventListener('click', onRowClick);
  $('#bt-rows').addEventListener('change', onStatusChange);
  $('#bt-rows').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('tr[data-id]')) openBtvDetail(e.target.dataset.id);
  });
  $('#btd-edit').addEventListener('click', () => {
    closeModal('btv-detail-modal');
    openBtvForm(detailId);
  });
  $('#bt-form').addEventListener('submit', submitBtv);
}

/* ---------------- Danh sách ---------------- */

export function renderBtv() {
  const today = dateKey();
  const all = store.tasks.filter((t) => t.source === 'btv');
  const counts = { wait: 0, late: 0, done: 0 };
  for (const t of all) {
    const s = reportState(t, today);
    if (s === 'late') counts.late++;
    else if (s === 'done') counts.done++;
    else counts.wait++;
  }
  $('#bt-doing').textContent = all.length;
  $('#bt-wait').textContent = counts.wait;
  $('#bt-late').textContent = counts.late;
  const statusCounts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const t of all) statusCounts[effectiveStatus(t, today)]++;
  drawDonut('bt-status', STATUSES.map((s) => ({ label: s, value: statusCounts[s], color: BTV_STATUS_COLORS[s] })), all.length, 'giao việc');
  $('#bt-done').textContent = counts.done;

  const q = fold($('#bt-search').value.trim());
  const state = $('#bt-state').value;
  const bounds = period.bounds();
  const rows = all
    .filter((t) => {
      const hay = fold(`${t.title} ${t.desc ?? ''} ${t.btv?.resolutionNo ?? ''}`);
      const s = reportState(t, today);
      const stateOk = state === 'all'
        || (state === 'wait' ? (s === 'wait' || s === 'soon') : state === 'doing' ? !CLOSED.includes(effectiveStatus(t, today)) : s === state);
      return (!q || hay.includes(q)) && stateOk && inRange(t.btv?.issuedAt, bounds);
    })
    .sort((a, b) => (reportState(a, today) === 'done') - (reportState(b, today) === 'done')
      || (a.btv?.reportDue ?? '').localeCompare(b.btv?.reportDue ?? ''));

  $('#bt-rows').innerHTML = rows.map((t, i) => btvRow(t, today, i + 1)).join('');
  $('#bt-empty').hidden = rows.length > 0;
  for (const btn of $$('[data-bt-state]')) btn.setAttribute('aria-pressed', String(btn.dataset.btState === state));
}

function btvRow(t, today, stt) {
  const b = t.btv ?? {};
  const state = reportState(t, today);
  const status = effectiveStatus(t, today);
  const fromPetition = t.sourceId && petitionById(t.sourceId);
  return `
    <tr data-id="${esc(t.id)}" tabindex="0" class="${state === 'late' ? 'is-overdue' : ''}">
      <td class="col-stt">${stt}</td>
      <td>
        <div class="task-title"><span class="code">${esc(b.resolutionNo || 'Chưa có số')}</span></div>
        <div class="meta-line"><i class="fa-regular fa-calendar"></i> Ban hành ${formatDate(b.issuedAt)}</div>
      </td>
      <td>
        <div class="task-title">${esc(t.title)}</div>
        <div class="task-desc">${esc(t.desc || 'Không có ghi chú')}</div>
        ${fromPetition ? `<div class="meta-line"><i class="fa-solid fa-link"></i> Từ đơn ${esc(fromPetition.code)}</div>` : ''}
      </td>
      <td>${deptLines(t.departmentId, t.collabDeptIds)}</td>
      <td><span class="date-chip">${formatDate(t.deadline)}</span></td>
      <td>
        <select class="status-select" data-action="status" aria-label="Trạng thái giao việc BTV">
          ${statusChoices(status).map((s) => `<option value="${esc(s)}"${s === status ? ' selected' : ''}>${esc(s)}</option>`).join('')}
        </select>
      </td>
      <td class="t-right">
        <div class="row-actions">
          <button type="button" class="icon-btn" data-action="library" title="Lưu vào thư viện" aria-label="Lưu vào thư viện"><i class="fa-solid fa-box-archive"></i></button>
          <button type="button" class="icon-btn" data-action="view" title="Xem chi tiết" aria-label="Xem chi tiết"><i class="fa-regular fa-eye"></i></button>
          <button type="button" class="icon-btn" data-action="edit" title="Chỉnh sửa" aria-label="Chỉnh sửa"><i class="fa-regular fa-pen-to-square"></i></button>
          <button type="button" class="icon-btn is-danger" data-action="delete" title="Xóa" aria-label="Xóa"><i class="fa-regular fa-trash-can"></i></button>
        </div>
      </td>
    </tr>`;
}

function onRowClick(e) {
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'status') return;
  if (action === 'library') libraryWithUndo('tasks', [row.dataset.id], 'giao việc BTV');
  else if (action === 'delete') deleteWithConfirm(row.dataset.id);
  else if (action === 'edit') openBtvForm(row.dataset.id);
  else openBtvDetail(row.dataset.id);
}

function onStatusChange(e) {
  const select = e.target.closest('select[data-action="status"]');
  const task = taskById(select?.closest('tr[data-id]')?.dataset.id);
  if (!task) return;
  task.status = select.value;
  if (task.eventId) syncTaskEvent(task, true);
  persist();
  toast('Đã cập nhật tiến độ', 'success');
  renderBtv();
}

/* ---------------- Chi tiết ---------------- */

/** Mở cửa sổ xem thông tin giao việc BTV. Muốn sửa thì bấm “Chỉnh sửa giao việc” trong cửa sổ này. */
export function openBtvDetail(id) {
  const task = taskById(id);
  if (task) rememberRecent({ kind: 'tasks', id, title: task.title });
  if (!task) return;
  detailId = task.id;
  const today = dateKey();
  const b = task.btv ?? {};
  const state = reportState(task, today);
  const collab = deptNames(task.collabDeptIds);
  const petition = task.sourceId ? petitionById(task.sourceId) : null;

  $('#btd-resolution').textContent = b.resolutionNo || 'Chưa có số nghị quyết';
  $('#btd-title').textContent = task.title;
  $('#btd-meta').innerHTML = priorityBadge(task.priority)
    + statusBadge(effectiveStatus(task, today))
    + `<span class="badge ${REPORT_BADGE[state]}">${REPORT_LABEL[state]}</span>`;
  $('#btd-source').hidden = !petition;
  $('#btd-source').innerHTML = petition ? `<i class="fa-solid fa-link"></i> Từ đơn ${esc(petition.code)}` : '';
  $('#btd-issued').textContent = formatDate(b.issuedAt);
  $('#btd-deadline').textContent = formatDate(task.deadline);
  $('#btd-report-due').textContent = formatDate(b.reportDue);
  $('#btd-lead').textContent = deptName(task.departmentId);
  $('#btd-collab-row').hidden = !collab;
  $('#btd-collab').textContent = collab;
  $('#btd-desc').textContent = task.desc || 'Không có yêu cầu chi tiết.';
  openModal('btv-detail-modal');
}

async function deleteWithConfirm(id) {
  const task = taskById(id);
  if (!task) return;
  const ok = await confirmDialog({
    title: 'Xóa giao việc BTV?',
    message: `"${task.title}" và lịch đồng bộ (nếu có) sẽ bị xóa.`,
    confirmText: 'Xóa',
  });
  if (!ok) return;
  removeTask(id);
}

/* ---------------- Form ---------------- */

/**
 * Mở form giao việc BTV. Khi `prefill` có `sourceId`, đây là việc chuyển từ đơn thư lên BTV
 * và nhật ký của đơn sẽ ghi lại việc chuyển.
 */
export function openBtvForm(id = null, prefill = null) {
  const task = id ? taskById(id) : null;
  const b = task?.btv ?? {};
  formId = task?.id ?? null;
  formSourceId = prefill?.sourceId ?? null;

  $('#bt-form').reset();
  fillLeadSelect($('#bt-f-dept'), task ? (task.departmentId ?? '') : (prefill?.deptId ?? ''), '<option value="" disabled>Chọn phòng xử lý chính…</option>');
  renderCollabList($('#bt-collab-list'), $('#bt-f-dept').value, task ? (task.collabDeptIds ?? []) : (prefill?.collabDeptIds ?? []));
  fillOptions($('#bt-f-priority'), PRIORITIES);

  $('#bt-f-resolution').value = b.resolutionNo ?? prefill?.resolutionNo ?? '';
  $('#bt-f-issued').value = b.issuedAt ?? dateKey();
  $('#bt-f-title').value = task?.title ?? prefill?.title ?? '';
  $('#bt-f-deadline').value = task?.deadline ?? addDays(dateKey(), 14);
  $('#bt-f-report').value = b.reportDue ?? addDays(dateKey(), 7);
  $('#bt-f-priority').value = task?.priority ?? 'Cao';
  $('#bt-f-desc').value = task?.desc ?? prefill?.desc ?? '';
  $('#bt-sync').checked = task ? Boolean(task.eventId) : true;

  $('#bt-modal-title').textContent = task
    ? 'Cập nhật giao việc BTV'
    : (prefill ? 'Chuyển đơn thư lên Ban Thường vụ' : 'Giao việc Ban Thường vụ');
  $('#bt-submit').innerHTML = task
    ? '<i class="fa-solid fa-check"></i> Lưu cập nhật'
    : '<i class="fa-solid fa-stamp"></i> Ghi nhận giao việc';
  openModal('btv-modal');
}

function submitBtv(e) {
  e.preventDefault();
  const departmentId = $('#bt-f-dept').value || null;
  const data = {
    title: $('#bt-f-title').value.trim(),
    desc: $('#bt-f-desc').value.trim(),
    departmentId,
    collabDeptIds: readCollabList($('#bt-collab-list'), departmentId),
    deadline: $('#bt-f-deadline').value,
    priority: $('#bt-f-priority').value,
  };
  const btv = {
    resolutionNo: $('#bt-f-resolution').value.trim(),
    issuedAt: $('#bt-f-issued').value,
    reportDue: $('#bt-f-report').value,
  };

  if (!data.title || !data.departmentId || !data.deadline || !btv.reportDue) {
    toast('Vui lòng nhập đủ nội dung, phòng xử lý chính, hạn hoàn thành và hạn báo cáo', 'error');
    return;
  }

  let task = taskById(formId);
  if (task) {
    Object.assign(task, data);
    task.btv = { ...(task.btv ?? {}), ...btv };
    toast('Đã cập nhật giao việc BTV', 'success');
  } else {
    task = {
      id: uid(), ...data, status: 'Chưa thực hiện', eventId: null, files: [], createdAt: Date.now(),
      source: 'btv', sourceId: formSourceId, btv: { ...btv, reported: false, reportedAt: null },
    };
    store.tasks.push(task);
    const petition = formSourceId ? petitionById(formSourceId) : null;
    if (petition) {
      addTimeline(petition, `Chuyển lên Ban Thường vụ: ${btv.resolutionNo || task.title}`);
    }
    toast('Đã ghi nhận giao việc BTV', 'success');
  }
  syncTaskEvent(task, $('#bt-sync').checked);
  persist();
  closeModal('btv-modal');
}
