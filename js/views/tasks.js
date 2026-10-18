/* Màn hình Quản lý Giao việc: KPI, biểu đồ, bảng lọc, chọn nhiều dòng, form giao việc, chi tiết,
   đầu việc con, bước duyệt và tệp đính kèm. */
import {
  store, taskById, effectiveStatus, syncTaskEvent, removeTask, persist, deptName, deptNames, sortedDepartments, trashWithUndo, libraryWithUndo,
  addNote, personById,
} from '../store.js';
import { saveBlob, getBlob, deleteBlobs } from '../files.js';
import { openModal, closeModal, confirmDialog } from '../modal.js';
import { fillLeadSelect, fillAssignerSelect, renderCollabList, readCollabList, wireLeadSelect, deptLines } from '../assign.js';
import { getSettings } from '../settings.js';
import { deptDurations, taskRisk } from '../insight.js';
import { rememberRecent } from '../recent.js';
import { drawDonut } from '../donut.js';
import { downloadWorkbook, dateCell } from '../excel.js';
import {
  $, $$, esc, fold, uid, dateKey, addDays, formatDate, formatDateTime, fileItem, fillOptions,
  priorityBadge, sourceBadge, toast, wirePeriodFilter, wireKpiFilter, inRange,
  PRIORITIES, STATUSES, MANUAL_STATUSES, TODO, SOON, DONE, OVERDUE, REVIEW, CLOSED, statusChoices,
} from '../utils.js';

const STATUS_COLORS = {
  [TODO]: '#94a3b8', [SOON]: '#f59e0b', [OVERDUE]: '#ef4444', [REVIEW]: '#8b5cf6', [DONE]: '#10b981',
};
/* Cột bảng theo trạng thái hiển thị. Thả thẻ vào "Sắp đến hạn" hoặc "Quá hạn" thì lưu thành "Chưa thực hiện" (hai trạng thái này tự tính). */
const BOARD_COLUMNS = [TODO, SOON, OVERDUE, REVIEW, DONE];
const FILTER_KEY = 'quan-ly-noi-bo:filters-tasks';

let period = null;
let boardMode = false; // false: danh sách, true: bảng cột theo trạng thái
let form = { id: null, files: [] };
let detailId = null;
const selected = new Set(); // công việc đã chọn để thao tác hàng loạt
let visibleIds = []; // công việc đang hiện trong bảng (sau lọc)

/* ---------------- Khởi tạo ---------------- */

export function initTasks() {
  for (const el of [$('#task-search'), $('#task-status-filter')]) {
    el.addEventListener('input', renderTasks);
    el.addEventListener('change', renderTasks);
  }
  period = wirePeriodFilter({
    select: $('#task-period'), range: $('#task-range'), from: $('#task-from'), to: $('#task-to'), onChange: renderTasks,
  });
  fillOptions($('#task-status-filter'), STATUSES, '<option value="all">Tất cả trạng thái</option>');
  wireKpiFilter($('#view-tasks'), $('#task-status-filter'), $('#task-rows').closest('.card'));
  fillOptions($('#task-priority'), PRIORITIES);
  wireLeadSelect($('#task-dept'), $('#task-collab-list'));

  $('#task-new').addEventListener('click', () => openTaskForm());
  $('#task-rows').addEventListener('click', onRowClick);
  $('#task-rows').addEventListener('change', onRowSelect);
  $('#task-rows').addEventListener('change', onRowStatus);
  $('#task-rows').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('tr[data-id]')) openTaskDetail(e.target.dataset.id);
  });
  $('#task-select-all').addEventListener('change', (e) => {
    for (const id of visibleIds) if (e.target.checked) selected.add(id); else selected.delete(id);
    syncBulk();
  });
  initBulk();
  $('#task-form').addEventListener('submit', submitTaskForm);
  bindDropzone();

  $('#detail-status').addEventListener('change', onDetailStatusChange);
  $('#detail-edit').addEventListener('click', () => {
    closeModal('task-detail-modal');
    openTaskForm(detailId);
  });
  $('#detail-add-file').addEventListener('click', () => $('#detail-file-input').click());
  $('#detail-file-input').addEventListener('change', onDetailFileInput);
  $('#detail-file-list').addEventListener('click', onDetailFilesClick);
  initChecklist();
  initNotes();
  initBoard();
  initSavedFilters();
  $('#detail-approve').addEventListener('click', approveDetail);
  $('#detail-hint-btn').addEventListener('click', () => setDetailStatus(DONE));
}

/**
 * Trạng thái lưu khi người dùng chọn: "Sắp đến hạn" / "Quá hạn" tự tính nên lưu thành "Chưa thực hiện";
 * khi bật duyệt thì "Hoàn thành" chuyển thành "Chờ duyệt".
 */
const resolveStatus = (value) => {
  const stored = [SOON, OVERDUE].includes(value) ? TODO : value;
  return stored === DONE && getSettings().approvalRequired ? REVIEW : stored;
};

/* ---------------- Danh sách & KPI ---------------- */

export function renderTasks() {
  const today = dateKey();
  const counts = { total: store.tasks.length, done: 0, soon: 0, todo: 0, review: 0, overdue: 0 };
  for (const task of store.tasks) {
    const status = effectiveStatus(task, today);
    if (CLOSED.includes(status)) counts.done++;
    else if (status === OVERDUE) counts.overdue++;
    else if (status === SOON) counts.soon++;
    else if (status === REVIEW) counts.review++;
    else counts.todo++;
  }
  $('#kpi-total').textContent = counts.total;
  $('#kpi-done').textContent = counts.done;
  $('#kpi-doing').textContent = counts.soon;
  $('#kpi-overdue').textContent = counts.overdue;
  renderChart(counts);

  const q = fold($('#task-search').value.trim());
  const statusFilter = $('#task-status-filter').value;
  const bounds = period.bounds();
  const durations = deptDurations(today);

  const rows = store.tasks
    .filter((t) => {
      const status = effectiveStatus(t, today);
      return (!q || fold(`${t.title} ${t.desc ?? ''}`).includes(q))
        && (statusFilter === 'all' || status === statusFilter)
        && inRange(t.deadline, bounds);
    })
    .sort((a, b) => CLOSED.includes(effectiveStatus(a, today)) - CLOSED.includes(effectiveStatus(b, today))
      || a.deadline.localeCompare(b.deadline));

  visibleIds = rows.map((t) => t.id);
  $('#task-rows').closest('.card').hidden = boardMode;
  $('#task-board').hidden = !boardMode;
  if (boardMode) {
    renderBoard(rows, today);
  } else {
    $('#task-rows').innerHTML = rows.map((t, i) => taskRow(t, today, i + 1, durations)).join('');
    $('#task-empty').hidden = rows.length > 0;
  }
  refreshDeptOptions();
  syncBulk();
}

/* ---------------- Bảng theo trạng thái (kéo thẻ để đổi trạng thái) ---------------- */

/** Cột của công việc: trạng thái hiển thị (đã tính theo hạn). */
const columnOf = (t) => effectiveStatus(t);

function renderBoard(rows, today) {
  $('#task-board').innerHTML = BOARD_COLUMNS.map((col) => {
    const items = rows.filter((t) => columnOf(t) === col);
    return `
      <section class="board-col" data-col="${esc(col)}" aria-label="${esc(col)}">
        <h3 class="board-head">${esc(col)} <span>${items.length}</span></h3>
        <div class="board-list">
          ${items.map((t) => {
            const overdue = effectiveStatus(t, today) === OVERDUE;
            return `
              <article class="board-card ${overdue ? 'is-overdue' : ''}" draggable="true" tabindex="0" data-id="${esc(t.id)}">
                <b>${esc(t.title)}</b>
                <small>${esc(deptName(t.departmentId))}</small>
                <div class="board-meta"><span class="date-chip ${overdue ? 'is-overdue' : ''}">${formatDate(t.deadline)}</span>${priorityBadge(t.priority)}</div>
              </article>`;
          }).join('') || '<p class="board-empty">Không có công việc</p>'}
        </div>
      </section>`;
  }).join('');
}

function initBoard() {
  const board = $('#task-board');
  const toggle = $('#task-view-toggle');
  toggle.addEventListener('click', () => {
    boardMode = !boardMode;
    toggle.setAttribute('aria-pressed', String(boardMode));
    toggle.innerHTML = boardMode
      ? '<i class="fa-solid fa-list"></i> Danh sách'
      : '<i class="fa-solid fa-table-columns"></i> Bảng';
    renderTasks();
  });
  board.addEventListener('click', (e) => {
    const card = e.target.closest('.board-card');
    if (card) openTaskDetail(card.dataset.id);
  });
  board.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.board-card')) openTaskDetail(e.target.dataset.id);
  });
  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.board-card');
    if (!card) return;
    e.dataTransfer.setData('text/plain', card.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('is-dragging');
  });
  board.addEventListener('dragend', (e) => {
    e.target.closest?.('.board-card')?.classList.remove('is-dragging');
  });
  board.addEventListener('dragover', (e) => {
    const col = e.target.closest('.board-col');
    if (!col) return;
    e.preventDefault();
    col.classList.add('is-drop');
  });
  board.addEventListener('dragleave', (e) => {
    e.target.closest?.('.board-col')?.classList.remove('is-drop');
  });
  board.addEventListener('drop', (e) => {
    e.preventDefault();
    const col = e.target.closest('.board-col');
    col?.classList.remove('is-drop');
    const task = taskById(e.dataTransfer.getData('text/plain'));
    if (!task || !col || columnOf(task) === col.dataset.col) return;
    const next = resolveStatus(col.dataset.col);
    task.status = next;
    if (task.eventId) syncTaskEvent(task, true);
    persist();
    const sentForReview = next === REVIEW;
    toast(sentForReview ? 'Đã gửi duyệt — lãnh đạo cần duyệt để hoàn thành' : 'Đã chuyển cột', sentForReview ? 'info' : 'success');
  });
}

/* ---------------- Bộ lọc đã lưu (lưu trên máy này) ---------------- */

function readFilters() {
  try {
    return JSON.parse(localStorage.getItem(FILTER_KEY) || '[]') ?? [];
  } catch {
    return [];
  }
}

function writeFilters(list) {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(list));
  } catch {
    toast('Trình duyệt không lưu được bộ lọc', 'error');
  }
}

function renderSavedFilters(selectedId = '') {
  $('#task-saved').innerHTML = `<option value="">Bộ lọc đã lưu…</option>${readFilters()
    .map((f) => `<option value="${esc(f.id)}"${f.id === selectedId ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}`;
}

function initSavedFilters() {
  renderSavedFilters();
  $('#task-save-filter').addEventListener('click', () => {
    const name = window.prompt('Tên bộ lọc (ví dụ: Việc Phòng Kinh tế quá hạn)', '')?.trim();
    if (!name) return;
    const filter = {
      id: uid(),
      name,
      q: $('#task-search').value,
      status: $('#task-status-filter').value,
      period: $('#task-period').value,
      from: $('#task-from').value,
      to: $('#task-to').value,
    };
    writeFilters([...readFilters(), filter]);
    renderSavedFilters(filter.id);
    toast(`Đã lưu bộ lọc "${name}"`, 'success');
  });
  $('#task-saved').addEventListener('change', (e) => {
    const filter = readFilters().find((f) => f.id === e.target.value);
    if (!filter) return;
    $('#task-search').value = filter.q ?? '';
    $('#task-status-filter').value = filter.status ?? 'all';
    $('#task-period').value = filter.period ?? 'all';
    // Đổi mốc sẽ tự điền khoảng ngày; đặt lại từ–đến sau khi đổi để giữ đúng khoảng đã lưu
    $('#task-period').dispatchEvent(new Event('change'));
    if (filter.period === 'custom') {
      $('#task-from').value = filter.from ?? '';
      $('#task-to').value = filter.to ?? '';
    }
    renderTasks();
  });
  $('#task-del-filter').addEventListener('click', () => {
    const id = $('#task-saved').value;
    if (!id) return toast('Chọn một bộ lọc để xóa', 'info');
    writeFilters(readFilters().filter((f) => f.id !== id));
    renderSavedFilters();
    toast('Đã xóa bộ lọc', 'success');
  });
}

/* ---------------- Ghi chú và nhắc tên ---------------- */

/** Nội dung ghi chú đã escape, tô sáng các "@họ tên" đang nhắc. */
function noteHtml(note) {
  let html = esc(note.text);
  for (const id of note.mentions ?? []) {
    const name = personById(id)?.name;
    if (!name) continue;
    const token = esc(`@${name}`);
    html = html.split(token).join(`<mark>${token}</mark>`);
  }
  return html;
}

function renderNotes(task) {
  const notes = task.notes ?? [];
  $('#detail-note-count').textContent = notes.length ? `${notes.length}` : '';
  $('#detail-notes').innerHTML = notes.length
    ? [...notes].reverse().map((n) => `
      <li class="note-item">
        <div class="note-head">
          <b>${esc(personById(n.authorId)?.name ?? 'Ẩn danh')}</b>
          <small>${esc(formatDateTime(n.at))}</small>
        </div>
        <p>${noteHtml(n)}</p>
      </li>`).join('')
    : '<li class="empty-inline">Chưa có ghi chú. Gõ @ và họ tên để nhắc người khác.</li>';
}

function initNotes() {
  const input = $('#detail-note-input');
  const send = () => {
    const task = taskById(detailId);
    const text = input.value.trim();
    if (!task || !text) return;
    addNote(task, getSettings().meId, text);
    renderNotes(task);
    input.value = '';
    toast('Đã thêm ghi chú', 'success');
    input.focus();
  };
  $('#detail-note-add').addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    }
  });
}

/** Thứ tự và màu giống các biểu đồ trạng thái khác: vòng tròn, số ở giữa và chú thích dùng chung (donut.js). */
function renderChart(c) {
  drawDonut('tk-status', [
    { label: TODO, value: c.todo, color: STATUS_COLORS[TODO] },
    { label: SOON, value: c.soon, color: STATUS_COLORS[SOON] },
    { label: OVERDUE, value: c.overdue, color: STATUS_COLORS[OVERDUE] },
    { label: REVIEW, value: c.review, color: STATUS_COLORS[REVIEW] },
    { label: DONE, value: c.done, color: STATUS_COLORS[DONE] },
  ], c.total, 'công việc');
}

const riskBadge = (risk) => (risk
  ? `<span class="risk-badge risk-${risk.level}" title="${esc(risk.detail)}"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(risk.label)}</span>`
  : '');

function taskRow(t, today, stt, durations) {
  const status = effectiveStatus(t, today);
  const overdue = status === OVERDUE;
  const risk = taskRisk(t, today, durations);
  const files = t.files.length ? `<div class="meta-line"><i class="fa-solid fa-paperclip"></i>${t.files.length} tệp đính kèm</div>` : '';
  const subs = t.subtasks ?? [];
  const subLine = subs.length
    ? `<div class="meta-line"><i class="fa-solid fa-list-check"></i>${subs.filter((s) => s.done).length}/${subs.length} đầu việc</div>`
    : '';
  const sync = t.eventId ? ' <i class="fa-solid fa-calendar-check sync-icon" title="Đã đồng bộ Lịch công tác"></i>' : '';
  const checked = selected.has(t.id) ? 'checked' : '';
  return `
    <tr data-id="${esc(t.id)}" tabindex="0" class="${overdue ? 'is-overdue' : ''} ${selected.has(t.id) ? 'is-selected' : ''}">
      <td class="col-check"><input type="checkbox" data-select="${esc(t.id)}" ${checked} aria-label="Chọn: ${esc(t.title)}"></td>
      <td class="col-stt">${stt}</td>
      <td>
        <div class="task-title">${esc(t.title)}${sync} ${sourceBadge(t.source)}</div>
        <div class="task-desc">${esc(t.desc || 'Không có ghi chú')}</div>
        ${files}${subLine}
      </td>
      <td>${deptLines(t.departmentId, t.collabDeptIds)}</td>
      <td><span class="date-chip ${overdue ? 'is-overdue' : ''}">${formatDate(t.deadline)}</span></td>
      <td>${priorityBadge(t.priority)}</td>
      <td>
        <select class="status-select" data-action="status" aria-label="Trạng thái công việc">
          ${statusChoices(status).map((s) => `<option value="${esc(s)}"${s === status ? ' selected' : ''}>${esc(s)}</option>`).join('')}
        </select>
        ${risk ? `<div class="meta-line">${riskBadge(risk)}</div>` : ''}
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
  if (!row || e.target.closest('[data-select]')) return;
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'status') return;
  if (action === 'library') libraryWithUndo('tasks', [row.dataset.id], taskById(row.dataset.id)?.source === 'btv' ? 'giao việc BTV' : 'giao việc TTUB');
  else if (action === 'edit') openTaskForm(row.dataset.id);
  else if (action === 'delete') deleteTaskWithConfirm(row.dataset.id);
  else openTaskDetail(row.dataset.id);
}

/** Đổi trạng thái ngay trong bảng (không mở cửa sổ chi tiết); áp dụng luật duyệt như trong cửa sổ chi tiết. */
function onRowStatus(e) {
  const select = e.target.closest('select[data-action="status"]');
  const task = taskById(select?.closest('tr[data-id]')?.dataset.id);
  if (!task) return;
  const next = resolveStatus(select.value);
  task.status = next;
  if (task.eventId) syncTaskEvent(task, true);
  persist();
  const sentForReview = next === REVIEW;
  toast(sentForReview ? 'Đã gửi duyệt — lãnh đạo cần duyệt để hoàn thành' : 'Đã cập nhật tiến độ', sentForReview ? 'info' : 'success');
  renderTasks();
}

function onRowSelect(e) {
  const box = e.target.closest('[data-select]');
  if (!box) return;
  if (box.checked) selected.add(box.dataset.select);
  else selected.delete(box.dataset.select);
  syncBulk();
}

async function deleteTaskWithConfirm(id) {
  const task = taskById(id);
  if (!task) return;
  const ok = await confirmDialog({
    title: 'Xóa công việc?',
    message: `"${task.title}" sẽ được chuyển vào thùng rác và có thể khôi phục trong 30 ngày. Lịch công tác đồng bộ (nếu có) được gỡ và sẽ tự khôi phục cùng công việc.`,
    confirmText: 'Chuyển vào thùng rác',
  });
  if (!ok) return;
  selected.delete(id);
  removeTask(id);
}

/* ---------------- Thao tác hàng loạt ---------------- */

function initBulk() {
  fillOptions($('#task-bulk-status'), MANUAL_STATUSES, '<option value="">Đổi trạng thái…</option>');
  $('#task-bulk-status').addEventListener('change', (e) => {
    const value = e.target.value;
    e.target.value = '';
    if (value) bulkStatus(value);
  });
  $('#task-bulk-dept').addEventListener('change', (e) => {
    const value = e.target.value;
    e.target.value = '';
    if (value) bulkDept(value);
  });
  $('#task-bulk-deadline').addEventListener('change', (e) => {
    const value = e.target.value;
    e.target.value = '';
    if (value) bulkDeadline(value);
  });
  $('#task-bulk-export').addEventListener('click', exportSelected);
  $('#task-bulk-delete').addEventListener('click', deleteSelected);
  $('#task-bulk-clear').addEventListener('click', () => {
    selected.clear();
    syncBulk();
  });
}

/** Đồng bộ ô chọn và thanh thao tác với danh sách đang hiện. */
function syncBulk() {
  for (const id of [...selected]) if (!taskById(id)) selected.delete(id);
  for (const box of $$('#task-rows [data-select]')) box.checked = selected.has(box.dataset.select);
  for (const row of $$('#task-rows tr[data-id]')) row.classList.toggle('is-selected', selected.has(row.dataset.id));
  const all = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const some = visibleIds.some((id) => selected.has(id));
  const master = $('#task-select-all');
  master.checked = all;
  master.indeterminate = !all && some;
  $('#task-bulk').hidden = selected.size === 0;
  $('#task-bulk-count').textContent = selected.size;
}

/** Danh sách phòng trong thanh thao tác luôn theo đúng danh mục hiện có. */
function refreshDeptOptions() {
  const select = $('#task-bulk-dept');
  const depts = sortedDepartments();
  if (select.options.length === depts.length + 1) return;
  fillOptions(select, depts.map((d) => [d.id, d.name]), '<option value="">Chuyển phòng xử lý…</option>');
}

/** Đổi các công việc đã chọn, có nút hoàn tác ngay trên thông báo. */
function bulkEdit(tasks, message, change) {
  const keys = ['status', 'departmentId', 'collabDeptIds', 'deadline'];
  const before = tasks.map((t) => ({ id: t.id, saved: Object.fromEntries(keys.map((k) => [k, JSON.parse(JSON.stringify(t[k] ?? null))])) }));
  tasks.forEach(change);
  persist();
  toast(message, 'success', {
    label: 'Hoàn tác',
    onClick: () => {
      for (const b of before) {
        const t = taskById(b.id);
        if (t) Object.assign(t, b.saved);
      }
      persist();
      toast('Đã hoàn tác', 'success');
    },
  });
}

function bulkStatus(value) {
  const tasks = selectedTasks();
  if (!tasks.length) return;
  const next = resolveStatus(value);
  const note = next === REVIEW ? ' (chờ lãnh đạo duyệt)' : '';
  bulkEdit(tasks, `Đã đổi trạng thái ${tasks.length} công việc${note}`, (t) => { t.status = next; });
  syncBulk();
}

function bulkDept(deptId) {
  const tasks = selectedTasks();
  if (!tasks.length) return;
  bulkEdit(tasks, `Đã chuyển ${tasks.length} công việc sang ${deptName(deptId)}`, (t) => {
    t.departmentId = deptId;
    t.collabDeptIds = (t.collabDeptIds ?? []).filter((d) => d !== deptId);
  });
  syncBulk();
}

function bulkDeadline(day) {
  const tasks = selectedTasks();
  if (!tasks.length) return;
  bulkEdit(tasks, `Đã đổi hạn chót ${tasks.length} công việc sang ${formatDate(day)}`, (t) => { t.deadline = day; });
  syncBulk();
}

function selectedTasks() {
  return [...selected].map((id) => taskById(id)).filter(Boolean);
}

async function exportSelected() {
  const tasks = selectedTasks();
  if (!tasks.length) return;
  const rows = [
    ['STT', 'Công việc', 'Phòng xử lý chính', 'Phòng phối hợp', 'Hạn chót', 'Ưu tiên', 'Trạng thái', 'Nội dung chi tiết'],
    ...tasks.map((t, i) => [
      i + 1, t.title, deptName(t.departmentId), deptNames(t.collabDeptIds), dateCell(t.deadline),
      t.priority, effectiveStatus(t), t.desc ?? '',
    ]),
  ];
  try {
    await downloadWorkbook(`cong-viec-da-chon-${dateKey()}.xlsx`, [{ name: 'Công việc', rows, widths: [6, 40, 24, 30, 14, 12, 16, 50] }]);
  } catch (err) {
    console.error(err);
    toast('Không xuất được Excel. Kiểm tra kết nối mạng rồi thử lại.', 'error');
  }
}

async function deleteSelected() {
  const ids = [...selected];
  if (!ids.length) return;
  const ok = await confirmDialog({
    title: `Chuyển ${ids.length} công việc vào thùng rác?`,
    message: 'Có thể khôi phục trong 30 ngày từ mục Thùng rác trong menu, hoặc bấm Hoàn tác ngay sau khi xóa.',
    confirmText: 'Chuyển vào thùng rác',
  });
  if (!ok) return;
  selected.clear();
  trashWithUndo('tasks', ids, 'công việc');
  syncBulk();
}

/* ---------------- Form giao việc ---------------- */

export function openTaskForm(id = null) {
  const task = id ? taskById(id) : null;
  form = { id: task?.id ?? null, files: task ? task.files.map((f) => ({ ...f })) : [] };

  $('#task-form').reset();
  fillLeadSelect(
    $('#task-dept'),
    task ? (task.departmentId ?? '') : (sortedDepartments()[0]?.id ?? ''),
    '<option value="" disabled>Chọn phòng xử lý chính…</option>',
  );
  renderCollabList($('#task-collab-list'), $('#task-dept').value, task?.collabDeptIds ?? []);
  fillAssignerSelect($('#task-assigner'), task?.assignerId ?? '');

  $('#task-name').value = task?.title ?? '';
  $('#task-deadline').value = task?.deadline ?? addDays(dateKey(), 7);
  $('#task-priority').value = task?.priority ?? 'Trung bình';
  const current = task ? effectiveStatus(task) : TODO;
  fillOptions($('#task-status'), statusChoices(current));
  $('#task-status').value = current;
  $('#task-desc').value = task?.desc ?? '';
  $('#task-sync').checked = task ? Boolean(task.eventId) : true;

  $('#task-modal-title').textContent = task ? 'Cập nhật giao việc' : 'Giao việc mới';
  $('#task-submit').innerHTML = task
    ? '<i class="fa-solid fa-check"></i> Lưu cập nhật'
    : '<i class="fa-solid fa-paper-plane"></i> Giao việc';
  renderFormFiles();
  openModal('task-modal');
}

function bindDropzone() {
  const zone = $('#task-dropzone');
  const input = $('#task-file-input');
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  for (const type of ['dragenter', 'dragover']) {
    zone.addEventListener(type, (e) => {
      e.preventDefault();
      zone.classList.add('is-drag');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    zone.addEventListener(type, (e) => {
      e.preventDefault();
      zone.classList.remove('is-drag');
    });
  }
  zone.addEventListener('drop', (e) => addFormFiles(e.dataTransfer.files));
  input.addEventListener('change', () => {
    addFormFiles(input.files);
    input.value = '';
  });
  $('#task-file-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    form.files = form.files.filter((f) => f.id !== btn.dataset.remove);
    renderFormFiles();
  });
}

function addFormFiles(fileList) {
  for (const file of Array.from(fileList)) {
    form.files.push({ id: uid(), name: file.name, type: file.type, size: file.size, blob: file });
  }
  renderFormFiles();
}

function renderFormFiles() {
  $('#task-file-count').textContent = `${form.files.length} tệp`;
  $('#task-file-list').innerHTML = form.files.map((f) => fileItem(f,
    `<button type="button" class="icon-btn is-danger" data-remove="${esc(f.id)}" aria-label="Gỡ ${esc(f.name)}" title="Gỡ tệp"><i class="fa-solid fa-xmark"></i></button>`,
  )).join('');
}

async function submitTaskForm(e) {
  e.preventDefault();
  const departmentId = $('#task-dept').value || null;
  const data = {
    title: $('#task-name').value.trim(),
    deadline: $('#task-deadline').value,
    departmentId,
    assignerId: $('#task-assigner').value || null,
    collabDeptIds: readCollabList($('#task-collab-list'), departmentId),
    priority: $('#task-priority').value,
    status: resolveStatus($('#task-status').value),
    desc: $('#task-desc').value.trim(),
  };
  const syncCalendar = $('#task-sync').checked;

  if (!data.title || !data.deadline || !data.departmentId) {
    toast('Vui lòng nhập đủ thông tin bắt buộc, gồm phòng xử lý chính', 'error');
    return;
  }

  try {
    await Promise.all(form.files.filter((f) => f.blob).map((f) => saveBlob(f.id, f.blob)));
  } catch (err) {
    console.error(err);
    toast('Không lưu được tệp đính kèm trên trình duyệt này', 'error');
    return;
  }

  const files = form.files.map(({ id, name, type, size, sample }) => ({ id, name, type, size, sample: Boolean(sample) }));
  let task = taskById(form.id);
  if (task) {
    const removed = task.files.filter((old) => !files.some((f) => f.id === old.id)).map((f) => f.id);
    if (removed.length) deleteBlobs(removed).catch((err) => console.warn(err));
    Object.assign(task, data, { files });
    toast('Đã cập nhật công việc', 'success');
  } else {
    task = { id: uid(), ...data, files, subtasks: [], eventId: null, createdAt: Date.now(), source: 'noi-bo', sourceId: null };
    store.tasks.push(task);
    toast('Đã giao việc thành công', 'success');
  }
  syncTaskEvent(task, syncCalendar);
  persist();
  closeModal('task-modal');
}

/* ---------------- Chi tiết công việc ---------------- */

export function openTaskDetail(id) {
  const task = taskById(id);
  if (!task) return;
  detailId = task.id;
  rememberRecent({ kind: 'tasks', id: task.id, title: task.title });
  const collab = deptNames(task.collabDeptIds);

  $('#detail-task-title').textContent = task.title;
  $('#detail-priority').innerHTML = priorityBadge(task.priority) + sourceBadge(task.source);
  $('#detail-deadline').textContent = formatDate(task.deadline);
  $('#detail-lead').textContent = deptName(task.departmentId);
  $('#detail-collab-row').hidden = !collab;
  $('#detail-collab').textContent = collab;
  $('#detail-desc').textContent = task.desc || 'Không có mô tả chi tiết.';

  paintDetailStatus(task);
  renderDetailFiles(task);
  openModal('task-detail-modal');
}

/** Cập nhật phần trạng thái, nút duyệt, gợi ý hoàn thành và đầu việc con của hộp chi tiết. */
function paintDetailStatus(task) {
  const status = effectiveStatus(task);
  const select = $('#detail-status');
  fillOptions(select, statusChoices(status));
  select.value = status;
  select.dataset.status = status;
  $('#detail-approve').hidden = task.status !== REVIEW;
  const subs = task.subtasks ?? [];
  const allDone = subs.length > 0 && subs.every((s) => s.done);
  const canClose = allDone && !CLOSED.includes(status) && task.status !== REVIEW;
  $('#detail-hint').hidden = !canClose;
  $('#detail-hint-btn').innerHTML = getSettings().approvalRequired
    ? '<i class="fa-solid fa-paper-plane"></i> Gửi duyệt'
    : '<i class="fa-solid fa-circle-check"></i> Đánh dấu hoàn thành';
  renderChecklist(task);
  renderNotes(task);
}

function setDetailStatus(value, message = 'Đã cập nhật tiến độ') {
  const task = taskById(detailId);
  if (!task) return;
  const next = resolveStatus(value);
  task.status = next;
  if (task.eventId) syncTaskEvent(task, true);
  persist();
  const sentForReview = next === REVIEW;
  const note = sentForReview ? 'Đã gửi duyệt — lãnh đạo cần duyệt để hoàn thành' : message;
  toast(note, sentForReview ? 'info' : 'success');
  paintDetailStatus(task);
}

/** Lãnh đạo duyệt: chuyển thẳng sang "Hoàn thành", không đi qua bước chờ duyệt. */
function approveDetail() {
  const task = taskById(detailId);
  if (!task) return;
  task.status = DONE;
  if (task.eventId) syncTaskEvent(task, true);
  persist();
  toast('Đã duyệt và hoàn thành', 'success');
  paintDetailStatus(task);
}

function onDetailStatusChange(e) {
  setDetailStatus(e.target.value);
}

/* ---------- Đầu việc con ---------- */

function renderChecklist(task) {
  const subs = task.subtasks ?? [];
  $('#detail-sub-count').textContent = subs.length ? `${subs.filter((s) => s.done).length}/${subs.length}` : '';
  $('#detail-checklist').innerHTML = subs.length
    ? subs.map((s) => `
      <li class="sub-item">
        <label>
          <input type="checkbox" data-sub="${esc(s.id)}" ${s.done ? 'checked' : ''}>
          <span class="${s.done ? 'is-done' : ''}">${esc(s.text)}</span>
        </label>
        <button type="button" class="icon-btn is-danger" data-sub-del="${esc(s.id)}" aria-label="Xóa đầu việc: ${esc(s.text)}"><i class="fa-solid fa-xmark"></i></button>
      </li>`).join('')
    : '<li class="empty-inline">Chưa có đầu việc con. Chia nhỏ công việc để theo dõi từng bước.</li>';
}

function initChecklist() {
  const addSub = () => {
    const input = $('#detail-sub-input');
    const text = input.value.trim();
    const task = taskById(detailId);
    if (!text || !task) return;
    task.subtasks = [...(task.subtasks ?? []), { id: uid(), text, done: false }];
    input.value = '';
    persist();
    paintDetailStatus(task);
    input.focus();
  };
  $('#detail-sub-add').addEventListener('click', addSub);
  $('#detail-sub-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSub();
    }
  });
  $('#detail-checklist').addEventListener('change', (e) => {
    const box = e.target.closest('[data-sub]');
    const task = taskById(detailId);
    if (!box || !task) return;
    const sub = (task.subtasks ?? []).find((s) => s.id === box.dataset.sub);
    if (!sub) return;
    sub.done = box.checked;
    persist();
    paintDetailStatus(task);
  });
  $('#detail-checklist').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sub-del]');
    const task = taskById(detailId);
    if (!btn || !task) return;
    task.subtasks = (task.subtasks ?? []).filter((s) => s.id !== btn.dataset.subDel);
    persist();
    paintDetailStatus(task);
  });
}

/* ---------- Tệp đính kèm trong chi tiết ---------- */

function renderDetailFiles(task) {
  $('#detail-file-count').textContent = task.files.length;
  $('#detail-file-list').innerHTML = task.files.length
    ? task.files.map((f) => fileItem(f, `
        <button type="button" class="icon-btn" data-download-file="${esc(f.id)}" title="Tải xuống" aria-label="Tải xuống ${esc(f.name)}"><i class="fa-solid fa-download"></i></button>
        <button type="button" class="icon-btn is-danger" data-delete-file="${esc(f.id)}" title="Xóa tệp" aria-label="Xóa ${esc(f.name)}"><i class="fa-regular fa-trash-can"></i></button>`)).join('')
    : '<div class="empty-inline">Chưa có tài liệu đính kèm.</div>';
}

function currentFile(fileId) {
  return taskById(detailId)?.files.find((f) => f.id === fileId) ?? null;
}

async function onDetailFileInput(e) {
  const task = taskById(detailId);
  const picked = Array.from(e.target.files);
  e.target.value = '';
  if (!task || !picked.length) return;
  try {
    for (const file of picked) {
      const id = uid();
      await saveBlob(id, file);
      task.files.push({ id, name: file.name, type: file.type, size: file.size, sample: false });
    }
    toast(`Đã thêm ${picked.length} tệp`, 'success');
  } catch (err) {
    console.error(err);
    toast('Không lưu được tệp đính kèm', 'error');
  }
  persist();
  renderDetailFiles(task);
}

function onDetailFilesClick(e) {
  const download = e.target.closest('[data-download-file]');
  if (download) {
    downloadFile(currentFile(download.dataset.downloadFile));
    return;
  }
  const remove = e.target.closest('[data-delete-file]');
  if (remove) {
    deleteDetailFile(remove.dataset.deleteFile);
    return;
  }
}

async function deleteDetailFile(fileId) {
  const task = taskById(detailId);
  const file = currentFile(fileId);
  if (!task || !file) return;
  const ok = await confirmDialog({
    title: 'Xóa tệp đính kèm?',
    message: `Tệp "${file.name}" sẽ bị gỡ khỏi công việc này.`,
    confirmText: 'Xóa tệp',
  });
  if (!ok) return;
  task.files = task.files.filter((f) => f.id !== fileId);
  deleteBlobs([fileId]).catch((err) => console.warn(err));
  persist();
  renderDetailFiles(task);
  toast('Đã xóa tệp', 'success');
}

async function downloadFile(file) {
  if (!file) return;
  if (file.sample) {
    toast('Tệp mẫu không có nội dung để tải xuống', 'info');
    return;
  }
  try {
    const blob = await getBlob(file.id);
    if (!blob) {
      toast('Không tìm thấy nội dung tệp', 'error');
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: file.name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    console.error(err);
    toast('Không tải được tệp', 'error');
  }
}
