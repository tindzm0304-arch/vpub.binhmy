/* Phản ánh 1022: tiếp nhận nhanh theo khu vực, thống kê theo khu vực, chuyển thành đơn thư hoặc công việc. */
import {
  store, reflectionById, petitionById, dueState, nextCode, addTimeline, createTaskFor, removeReflection, libraryWithUndo, persist,
  deptName, deptNames, tasksOf, effectiveStatus, REFLECTION_STATUSES, REFLECTION_CLOSED,
} from '../store.js';
import { openModal, closeModal, confirmDialog } from '../modal.js';
import { DEFAULT_SLA } from '../classify.js';
import { openPetitionForm, openPetitionDetail } from './petitions.js';
import { openTaskDetail } from './tasks.js';
import { drawDonut } from '../donut.js';
import { rememberRecent } from '../recent.js';
import {
  wireSuggestion, dueBadge, renderTimeline, fillFieldSelect, actionBtn,
} from './intake.js';
import { fillLeadSelect, renderCollabList, readCollabList, wireLeadSelect, deptLines } from '../assign.js';import {
  $, esc, fold, uid, dateKey, addDays, formatDate, fillOptions, statusBadge, toast, wirePeriodFilter, wireKpiFilter, inRange,
  TODO, SOON, OVERDUE, DONE,
} from '../utils.js';

const AREA_HINTS = ['Thôn 1', 'Thôn 2', 'Thôn 3', 'Thôn 4', 'Thôn 5', 'Khu dân cư'];
const isClosed = (r) => REFLECTION_CLOSED.includes(r.status);
/* Biểu đồ trạng thái hiển thị: thứ tự và màu. */
const DONUT_ORDER = [TODO, SOON, OVERDUE, DONE];
const DONUT_COLORS = { [TODO]: '#94a3b8', [SOON]: '#f59e0b', [OVERDUE]: '#ef4444', [DONE]: '#10b981' };

let period = null;
let formId = null;
let detailId = null;
let suggest = null;

/* ---------------- Khởi tạo ---------------- */

export function initReflections() {
  for (const el of [$('#pa-search'), $('#pa-state'), $('#pa-area')]) {
    el.addEventListener('input', renderReflections);
    el.addEventListener('change', renderReflections);
  }
  period = wirePeriodFilter({
    select: $('#pa-period'), range: $('#pa-range'), from: $('#pa-from'), to: $('#pa-to'), onChange: renderReflections,
  });
  wireKpiFilter($('#view-reflections'), $('#pa-state'), $('#pa-rows').closest('.card'));
  $('#pa-new').addEventListener('click', () => openReflectionForm());
  $('#pa-rows').addEventListener('click', onRowClick);
  $('#pa-rows').addEventListener('change', onStatusChange);
  $('#pa-rows').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('tr[data-id]')) openReflectionDetail(e.target.dataset.id);
  });

  $('#pa-form').addEventListener('submit', submitReflection);
  suggest = wireSuggestion({
    content: $('#pa-f-content'), field: $('#pa-f-field'), dept: $('#pa-f-dept'), chip: $('#pa-suggest'),
  });
  wireLeadSelect($('#pa-f-dept'), $('#pa-f-collab-list'));

  $('#pad-status').addEventListener('change', (e) => setStatus(reflectionById(detailId), e.target.value));
  $('#pad-actions').addEventListener('click', onDetailAction);
  $('#pad-tasks').addEventListener('click', (e) => {
    const task = e.target.closest('[data-open-task]');
    const petition = e.target.closest('[data-open-petition]');
    if (task) openTaskDetail(task.dataset.openTask);
    if (petition) openPetitionDetail(petition.dataset.openPetition);
  });
}

/* ---------------- Danh sách và thống kê ---------------- */

function areasOf() {
  const found = store.reflections.map((r) => r.area).filter(Boolean);
  return [...new Set([...AREA_HINTS, ...found])].sort((a, b) => a.localeCompare(b, 'vi'));
}

export function renderReflections() {
  const areaSel = $('#pa-area');
  const previous = areaSel.value;
  fillOptions(areaSel, areasOf(), '<option value="all">Mọi khu vực</option>');
  areaSel.value = [...areaSel.options].some((o) => o.value === previous) ? previous : 'all';

  const today = dateKey();
  const counts = { total: store.reflections.length, done: 0, soon: 0, overdue: 0 };
  for (const r of store.reflections) {
    if (isClosed(r)) counts.done++;
    if (dueState(r, isClosed(r), today) === 'soon') counts.soon++;
    if (dueState(r, isClosed(r), today) === 'overdue') counts.overdue++;
  }
  $('#pa-total').textContent = counts.total;
  $('#pa-done').textContent = counts.done;
  $('#pa-doing').textContent = counts.soon;
  $('#pa-overdue').textContent = counts.overdue;
  drawDonut('pa-status', DONUT_ORDER.map((s) => ({
    label: s, value: store.reflections.filter((r) => effectiveStatus(r, today) === s).length, color: DONUT_COLORS[s],
  })), store.reflections.length, 'phản ánh');

  const q = fold($('#pa-search').value.trim());
  const state = $('#pa-state').value;
  const bounds = period.bounds();
  const rows = store.reflections
    .filter((r) => {
      const hay = fold(`${r.code} ${r.area} ${r.content} ${r.citizen?.name ?? ''} ${r.result ?? ''}`);
      const stateOk = state === 'all' || effectiveStatus(r, today) === state;
      return (!q || hay.includes(q)) && (areaSel.value === 'all' || r.area === areaSel.value) && stateOk
        && inRange(r.receivedAt, bounds);
    })
    .sort((a, b) => (isClosed(a) - isClosed(b)) || a.deadline.localeCompare(b.deadline));

  $('#pa-rows').innerHTML = rows.map((r, i) => reflectionRow(r, today, i + 1)).join('');
  $('#pa-empty').hidden = rows.length > 0;
}

function reflectionRow(r, today, stt) {
  const s = dueState(r, isClosed(r), today);
  return `
    <tr data-id="${esc(r.id)}" tabindex="0" class="${s === 'overdue' ? 'is-overdue' : ''}">
      <td class="col-stt">${stt}</td>
      <td>
        <div class="task-title"><span class="code">${esc(r.code)}</span></div>
        <div class="meta-line"><i class="fa-regular fa-calendar"></i> Nhận ${formatDate(r.receivedAt)}</div>
        ${r.petitionId ? '<div class="meta-line"><i class="fa-solid fa-link"></i> Đã thành đơn thư</div>' : ''}
      </td>
      <td><div class="task-desc clamp">${esc(r.content)}</div></td>
      <td><span class="chip"><i class="fa-solid fa-location-dot"></i> ${esc(r.area)}</span></td>
      <td>${esc(r.field)}${deptLines(r.deptId, r.collabDeptIds)}</td>
      <td><span class="date-chip ${s === 'overdue' ? 'is-overdue' : ''}">${formatDate(r.deadline)}</span></td>
      <td>
        <select class="status-select" data-action="status" aria-label="Tình trạng phản ánh">
          ${REFLECTION_STATUSES.map((st) => `<option value="${esc(st)}"${st === r.status ? ' selected' : ''}>${esc(st)}</option>`).join('')}
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
  if (action === 'library') libraryWithUndo('reflections', [row.dataset.id], 'phản ánh');
  else if (action === 'edit') openReflectionForm(row.dataset.id);
  else if (action === 'delete') deleteReflection(reflectionById(row.dataset.id));
  else openReflectionDetail(row.dataset.id);
}

/* ---------------- Form tiếp nhận ---------------- */

export function openReflectionForm(id = null) {
  const r = id ? reflectionById(id) : null;
  formId = r?.id ?? null;
  $('#pa-form').reset();
  fillOptions($('#area-options'), areasOf());
  fillFieldSelect($('#pa-f-field'), r?.field);
  fillLeadSelect($('#pa-f-dept'), r?.deptId ?? '');
  renderCollabList($('#pa-f-collab-list'), $('#pa-f-dept').value, r?.collabDeptIds ?? []);
  fillOptions($('#pa-f-status'), REFLECTION_STATUSES);

  $('#pa-f-received').value = r?.receivedAt ?? dateKey();
  $('#pa-f-area').value = r?.area ?? '';
  $('#pa-f-name').value = r?.citizen?.name ?? '';
  $('#pa-f-phone').value = r?.citizen?.phone ?? '';
  $('#pa-f-content').value = r?.content ?? '';
  $('#pa-f-result').value = r?.result ?? '';
  $('#pa-f-status').value = r?.status ?? TODO;
  $('#pa-f-status-wrap').hidden = !r;
  $('#pa-sync').checked = r ? r.calendarSync !== false : true;

  $('#pa-modal-title').textContent = r ? `Cập nhật ${r.code}` : 'Tiếp nhận phản ánh 1022';
  $('#pa-submit').innerHTML = r
    ? '<i class="fa-solid fa-check"></i> Lưu cập nhật'
    : '<i class="fa-solid fa-floppy-disk"></i> Tiếp nhận phản ánh';
  suggest.refresh();
  openModal('reflection-modal');
}

function submitReflection(e) {
  e.preventDefault();
  const area = $('#pa-f-area').value.trim();
  const content = $('#pa-f-content').value.trim();
  if (!area || !content) {
    toast('Vui lòng nhập khu vực và nội dung phản ánh', 'error');
    return;
  }
  const receivedAt = $('#pa-f-received').value;
  const deptId = $('#pa-f-dept').value || null;
  const existing = reflectionById(formId);
  const fields = {
    area,
    receivedAt,
    citizen: { name: $('#pa-f-name').value.trim(), phone: $('#pa-f-phone').value.trim() },
    content,
    field: $('#pa-f-field').value,
    deptId,
    collabDeptIds: readCollabList($('#pa-f-collab-list'), deptId),
    // Giữ hạn đang có (có thể nhập từ Excel) nếu ngày tiếp nhận không đổi
    deadline: existing?.receivedAt === receivedAt ? existing.deadline : addDays(receivedAt, DEFAULT_SLA['Phản ánh']),
    result: $('#pa-f-result').value.trim(),
    calendarSync: $('#pa-sync').checked,
  };

  if (existing) {
    const before = existing.status;
    const beforeResult = existing.result ?? '';
    Object.assign(existing, fields, { status: $('#pa-f-status').value });
    addTimeline(existing, 'Cập nhật thông tin phản ánh');
    if (before !== existing.status) addTimeline(existing, `Tình trạng: ${existing.status}`);
    if (beforeResult !== existing.result) addTimeline(existing, 'Cập nhật kết quả xử lý');
    toast('Đã cập nhật phản ánh', 'success');
  } else {
    const r = {
      id: uid(), code: nextCode('PA', store.reflections), ...fields,
      status: TODO, petitionId: null, timeline: [],
    };
    store.reflections.push(r);
    addTimeline(r, `Tiếp nhận phản ánh từ ${area}`);
    toast(`Đã tiếp nhận ${r.code}`, 'success');
  }
  persist();
  closeModal('reflection-modal');
}

/* ---------------- Chi tiết ---------------- */

export function openReflectionDetail(id) {
  const r = reflectionById(id);
  if (r) rememberRecent({ kind: 'reflections', id: r.id, title: `${r.code} · ${r.area}` });
  if (!r) return;
  detailId = r.id;
  const s = dueState(r, isClosed(r));

  $('#pad-code').textContent = r.code;
  const status = $('#pad-status');
  fillOptions(status, REFLECTION_STATUSES);
  status.value = r.status;
  status.dataset.status = r.status;

  $('#pad-area').textContent = r.area;
  $('#pad-meta').innerHTML = `
    ${dueBadge(s)}
    <span><i class="fa-regular fa-clock"></i> Hạn <b>${formatDate(r.deadline)}</b></span>
    <span><i class="fa-regular fa-calendar"></i> Nhận <b>${formatDate(r.receivedAt)}</b></span>
    <span><i class="fa-solid fa-sitemap"></i> <b>${esc(deptName(r.deptId))}</b></span>
    ${r.collabDeptIds?.length ? `<span><i class="fa-solid fa-users"></i> Phối hợp: <b>${esc(deptNames(r.collabDeptIds))}</b></span>` : ''}
    <span><i class="fa-solid fa-layer-group"></i> <b>${esc(r.field)}</b></span>`;
  $('#pad-people').innerHTML = `
    <div class="person-line">
      <span class="mini-ico"><i class="fa-solid fa-user"></i></span>
      <div><small>Người phản ánh</small><b>${esc(r.citizen?.name || 'Ẩn danh')}</b></div>
    </div>
    <div class="person-line">
      <span class="mini-ico"><i class="fa-solid fa-phone"></i></span>
      <div><small>Điện thoại</small><b>${esc(r.citizen?.phone || 'Chưa có')}</b></div>
    </div>`;
  $('#pad-content').textContent = r.content;
  $('#pad-result').textContent = r.result ?? '';
  $('#pad-result-wrap').hidden = !r.result;
  renderLinked(r);
  renderTimeline($('#pad-timeline'), r);
  renderActions(r);
  openModal('reflection-detail-modal');
}

function renderLinked(r) {
  const petition = r.petitionId ? petitionById(r.petitionId) : null;
  const tasks = tasksOf(r);
  const petitionHtml = petition ? `
    <button type="button" class="stack-item stack-link" data-open-petition="${esc(petition.id)}">
      <div class="stack-main"><b>Đơn thư ${esc(petition.code)}</b><small>${esc(petition.type)} · ${esc(petition.status)}</small></div>
      <i class="fa-solid fa-chevron-right muted"></i>
    </button>` : '';
  const taskHtml = tasks.map((t) => `
    <button type="button" class="stack-item stack-link" data-open-task="${esc(t.id)}">
      <div class="stack-main">
        <b>${esc(t.title)}</b>
        <small>${esc(deptName(t.departmentId))} · Hạn ${formatDate(t.deadline)}</small>
      </div>
      ${statusBadge(effectiveStatus(t))}
    </button>`).join('');
  $('#pad-tasks').innerHTML = (petitionHtml + taskHtml)
    || '<div class="empty-inline">Chưa có công việc liên kết. Tạo công việc hoặc chuyển thành đơn thư để xử lý.</div>';
}

function renderActions(r) {
  const closed = isClosed(r);
  const left = [];
  if (!closed && !tasksOf(r).length) {
    left.push(actionBtn('create-task', 'btn-primary', 'fa-list-check', 'Tạo công việc xử lý'));
  }
  if (!closed && !r.petitionId) {
    left.push(actionBtn('convert', 'btn-secondary', 'fa-envelope-open-text', 'Chuyển thành đơn thư'));
  }  const right = [
    actionBtn('edit', 'btn-secondary', 'fa-pen-to-square', 'Chỉnh sửa'),
    actionBtn('delete', 'btn-danger-ghost', 'fa-trash-can', 'Xóa'),
  ];
  $('#pad-actions').innerHTML = `<div class="btn-group">${left.join('')}</div><div class="btn-group">${right.join('')}</div>`;
}

function onDetailAction(e) {
  const btn = e.target.closest('[data-action]');
  const r = reflectionById(detailId);
  if (!btn || !r) return;
  switch (btn.dataset.action) {
    case 'create-task':
      createTaskFromReflection(r);
      break;
    case 'convert':
      closeModal('reflection-detail-modal');
      openPetitionForm(null, {
        reflectionId: r.id,
        type: 'Kiến nghị',
        receivedAt: r.receivedAt,
        citizen: { ...r.citizen },
        content: r.content,
        field: r.field,
        deptId: r.deptId,
        collabDeptIds: r.collabDeptIds ?? [],
        channel: 'Trực tiếp',
      });
      break;
    case 'edit':
      closeModal('reflection-detail-modal');
      openReflectionForm(r.id);
      break;
    case 'delete':
      deleteReflection(r);
      break;
    default:
      break;
  }
}

/** Tạo công việc xử lý, giao cho phòng xử lý chính và các phòng phối hợp của phản ánh. */
function createTaskFromReflection(r) {
  if (!r.deptId) {
    toast('Chọn phòng xử lý chính trong phần chỉnh sửa trước khi tạo công việc', 'error');
    return;
  }
  createTaskFor(r, 'phan-anh', {
    title: `Xử lý phản ánh ${r.code} – ${r.area}`,
    desc: r.content,
    deadline: r.deadline,
    priority: 'Trung bình',
    departmentId: r.deptId,
    collabDeptIds: r.collabDeptIds ?? [],
  });
  persist();
  toast(`Đã tạo công việc và giao cho ${deptName(r.deptId)}`, 'success');
  openReflectionDetail(r.id);
}

/** Đổi tình trạng ngay trong bảng (không mở cửa sổ chi tiết). */
function onStatusChange(e) {
  const select = e.target.closest('select[data-action="status"]');
  const reflection = reflectionById(select?.closest('tr[data-id]')?.dataset.id);
  if (!reflection || reflection.status === select.value) return;
  reflection.status = select.value;
  addTimeline(reflection, `Tình trạng: ${reflection.status}`);
  persist();
  toast('Đã cập nhật tình trạng', 'success');
  renderReflections();
}

function setStatus(r, status) {
  if (!r || r.status === status) return;
  r.status = status;
  addTimeline(r, `Tình trạng: ${status}`);
  persist();
  openReflectionDetail(r.id);
}

async function deleteReflection(r) {
  if (!r) return;
  const ok = await confirmDialog({
    title: 'Xóa phản ánh?',
    message: `Phản ánh ${r.code} sẽ bị xóa. Công việc liên quan (nếu có) được giữ lại như công việc thường.`,
    confirmText: 'Xóa phản ánh',
  });
  if (!ok) return;
  closeModal('reflection-detail-modal');
  removeReflection(r.id);
}
