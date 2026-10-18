/* Đơn thư, PAKN: tiếp nhận, gợi ý phân loại, cảnh báo đơn trùng, theo dõi hạn, liên kết công việc, nhật ký xử lý. */
import {
  store, petitionById, dueState, nextCode, addTimeline, createTaskFor, removePetition, libraryWithUndo, persist, deptName, deptNames,
  tasksOf, effectiveStatus, reflectionById, PETITION_STATUSES, PETITION_CLOSED,
} from '../store.js';
import { openModal, closeModal, confirmDialog } from '../modal.js';
import { PETITION_TYPES, CHANNELS, dueDateFor, findSimilar } from '../classify.js';
import {
  wireSuggestion, dueBadge, renderTimeline, fillFieldSelect, actionBtn,
} from './intake.js';
import { fillLeadSelect, renderCollabList, readCollabList, wireLeadSelect, deptLines } from '../assign.js';import { openTaskDetail } from './tasks.js';
import { openBtvForm } from './btv.js';
import { rememberRecent } from '../recent.js';
import { usualCollabs } from '../insight.js';
import { drawDonut } from '../donut.js';
import {
  $, esc, fold, uid, dateKey, formatDate, fillOptions, statusBadge, toast, wirePeriodFilter, wireKpiFilter, inRange,
  TODO, SOON, OVERDUE, DONE,
} from '../utils.js';

const isClosed = (p) => PETITION_CLOSED.includes(p.status);
/* Các phần của biểu đồ "Trạng thái xử lý": Quá hạn (đơn đang mở đã quá hạn), rồi các trạng thái còn lại. */
const PETITION_DONUT = [
  { label: TODO, color: '#94a3b8' },
  { label: SOON, color: '#f59e0b' },
  { label: OVERDUE, color: '#ef4444' },
  { label: DONE, color: '#10b981' },
];

let period = null;
let formId = null;
let formReflectionId = null;
let dueTouched = false;
let detailId = null;
let suggest = null;

/* ---------------- Khởi tạo ---------------- */

export function initPetitions() {
  for (const el of [$('#pt-search'), $('#pt-type'), $('#pt-state')]) {
    el.addEventListener('input', renderPetitions);
    el.addEventListener('change', renderPetitions);
  }
  period = wirePeriodFilter({
    select: $('#pt-period'), range: $('#pt-range'), from: $('#pt-from'), to: $('#pt-to'), onChange: renderPetitions,
  });
  wireKpiFilter($('#view-petitions'), $('#pt-state'), $('#pt-rows').closest('.card'));
  $('#pt-new').addEventListener('click', () => openPetitionForm());
  $('#pt-rows').addEventListener('click', onRowClick);
  $('#pt-rows').addEventListener('change', onStatusChange);
  $('#pt-rows').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('tr[data-id]')) openPetitionDetail(e.target.dataset.id);
  });

  $('#pt-form').addEventListener('submit', submitPetition);
  suggest = wireSuggestion({
    content: $('#pt-f-content'), field: $('#pt-f-field'), dept: $('#pt-f-dept'), chip: $('#pt-suggest'),
  });
  wireLeadSelect($('#pt-f-dept'), $('#pt-f-collab-list'));
  for (const el of [$('#pt-f-field'), $('#pt-f-dept')]) el.addEventListener('change', updateCollabHint);
  $('#pt-f-hint').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-apply-collab]');
    if (!btn) return;
    const ids = new Set(btn.dataset.applyCollab.split(','));
    for (const box of document.querySelectorAll('#pt-f-collab-list input')) if (ids.has(box.value)) box.checked = true;
    updateCollabHint();
  });
  for (const el of [$('#pt-f-phone'), $('#pt-f-content')]) el.addEventListener('input', updateDupes);
  const recalcDeadline = () => {
    if (!dueTouched) $('#pt-f-deadline').value = dueDateFor($('#pt-f-type').value, $('#pt-f-received').value);
  };
  $('#pt-f-type').addEventListener('change', recalcDeadline);
  $('#pt-f-received').addEventListener('change', recalcDeadline);
  $('#pt-f-deadline').addEventListener('input', () => { dueTouched = true; });
  $('#pt-dupes').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-open-petition]');
    if (btn) openPetitionDetail(btn.dataset.openPetition);
  });

  $('#ptd-status').addEventListener('change', (e) => setPetitionStatus(petitionById(detailId), e.target.value));
  $('#ptd-actions').addEventListener('click', onDetailAction);
  $('#ptd-tasks').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-open-task]');
    if (btn) openTaskDetail(btn.dataset.openTask);
  });
}

/* ---------------- Danh sách ---------------- */

export function renderPetitions() {
  const typeSel = $('#pt-type');
  const previous = typeSel.value;
  fillOptions(typeSel, PETITION_TYPES, '<option value="all">Mọi loại đơn</option>');
  typeSel.value = [...typeSel.options].some((o) => o.value === previous) ? previous : 'all';

  const today = dateKey();
  const counts = { total: store.petitions.length, done: 0, soon: 0, overdue: 0 };
  const parts = Object.fromEntries(PETITION_DONUT.map((d) => [d.label, 0]));
  for (const p of store.petitions) {
    const s = dueState(p, isClosed(p), today);
    if (isClosed(p)) counts.done++;
    if (s === 'soon') counts.soon++;
    if (s === 'overdue') counts.overdue++;
    parts[effectiveStatus(p, today)]++;
  }
  $('#pt-total').textContent = counts.total;
  $('#pt-done').textContent = counts.done;
  $('#pt-soon').textContent = counts.soon;
  $('#pt-overdue').textContent = counts.overdue;
  drawDonut('pt-status', PETITION_DONUT.map((d) => ({ ...d, value: parts[d.label] })), store.petitions.length, 'đơn thư');

  const q = fold($('#pt-search').value.trim());
  const state = $('#pt-state').value;
  const bounds = period.bounds();
  const rows = store.petitions
    .filter((p) => {
      const s = dueState(p, isClosed(p), today);
      const hay = fold(`${p.code} ${p.citizen?.name ?? ''} ${p.content ?? ''} ${p.result ?? ''}`);
      const stateOk = state === 'all' || (state === 'done' ? isClosed(p) : s === state);
      return (!q || hay.includes(q)) && (typeSel.value === 'all' || p.type === typeSel.value) && stateOk
        && inRange(p.receivedAt, bounds);
    })
    .sort((a, b) => (isClosed(a) - isClosed(b)) || a.deadline.localeCompare(b.deadline));

  $('#pt-rows').innerHTML = rows.map((p, i) => petitionRow(p, today, i + 1)).join('');
  $('#pt-empty').hidden = rows.length > 0;
}

function petitionRow(p, today, stt) {
  const s = dueState(p, isClosed(p), today);
  const linked = tasksOf(p).length;
  return `
    <tr data-id="${esc(p.id)}" tabindex="0" class="${s === 'overdue' ? 'is-overdue' : ''}">
      <td class="col-stt">${stt}</td>
      <td>
        <div class="task-title"><span class="code">${esc(p.code)}</span></div>
        <div class="meta-line"><i class="fa-regular fa-calendar"></i> Nhận ${formatDate(p.receivedAt)} · ${esc(p.channel)}</div>
        ${p.reflectionId ? '<div class="meta-line"><i class="fa-solid fa-link"></i> Từ phản ánh 1022</div>' : ''}
      </td>
      <td>
        <div class="person-name">${esc(p.citizen?.name || 'Công dân ẩn danh')}</div>
        <div class="task-desc">${esc(p.type)}</div>
      </td>
      <td>
        <div>${esc(p.field)}</div>
        ${deptLines(p.deptId, p.collabDeptIds)}
      </td>
      <td><span class="date-chip ${s === 'overdue' ? 'is-overdue' : ''}">${formatDate(p.deadline)}</span></td>
      <td>
        <select class="status-select" data-action="status" aria-label="Tình trạng đơn thư">
          ${PETITION_STATUSES.map((st) => `<option value="${esc(st)}"${st === p.status ? ' selected' : ''}>${esc(st)}</option>`).join('')}
        </select>
        ${linked ?`<div class="meta-line"><i class="fa-solid fa-list-check"></i> ${linked} công việc liên kết</div>` : ''}
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
  if (action === 'library') libraryWithUndo('petitions', [row.dataset.id], 'đơn thư');
  else if (action === 'edit') openPetitionForm(row.dataset.id);
  else if (action === 'delete') deletePetition(petitionById(row.dataset.id));
  else openPetitionDetail(row.dataset.id);
}

/* ---------------- Form tiếp nhận ---------------- */

/**
 * Mở form đơn thư. `prefill` dùng khi chuyển từ phản ánh 1022 (có `reflectionId`),
 * khi đó đơn mới được liên kết ngược về phản ánh.
 */
export function openPetitionForm(id = null, prefill = null) {
  const p = id ? petitionById(id) : null;
  formId = p?.id ?? null;
  formReflectionId = prefill?.reflectionId ?? null;
  const v = p ?? {
    type: 'Kiến nghị', channel: 'Trực tiếp', receivedAt: dateKey(), citizen: {},
    content: '', field: 'Khác', deptId: null, collabDeptIds: [], status: TODO, ...(prefill ?? {}),
  };

  $('#pt-form').reset();
  fillOptions($('#pt-f-type'), PETITION_TYPES);
  fillOptions($('#pt-f-channel'), CHANNELS);
  fillFieldSelect($('#pt-f-field'), v.field);
  fillLeadSelect($('#pt-f-dept'), v.deptId ?? '');
  renderCollabList($('#pt-f-collab-list'), $('#pt-f-dept').value, v.collabDeptIds ?? []);
  fillOptions($('#pt-f-status'), PETITION_STATUSES);

  $('#pt-f-type').value = v.type;
  $('#pt-f-received').value = v.receivedAt;
  $('#pt-f-channel').value = v.channel;
  $('#pt-f-name').value = v.citizen?.name ?? '';
  $('#pt-f-phone').value = v.citizen?.phone ?? '';
  $('#pt-f-address').value = v.citizen?.address ?? '';
  $('#pt-f-content').value = v.content ?? '';
  $('#pt-f-result').value = v.result ?? '';
  $('#pt-f-status').value = v.status;
  $('#pt-f-status-wrap').hidden = !p;
  $('#pt-sync').checked = p ? p.calendarSync !== false : true;

  dueTouched = Boolean(p);
  $('#pt-f-deadline').value = p?.deadline ?? dueDateFor(v.type, v.receivedAt);
  $('#pt-modal-title').textContent = p
    ? `Cập nhật ${p.code}`
    : (prefill ? 'Tạo đơn thư từ phản ánh 1022' : 'Tiếp nhận đơn thư');
  $('#pt-submit').innerHTML = p
    ? '<i class="fa-solid fa-check"></i> Lưu cập nhật'
    : '<i class="fa-solid fa-floppy-disk"></i> Tiếp nhận đơn';

  suggest.refresh();
  updateDupes();
  updateCollabHint();
  openModal('petition-modal');
}

/** Gợi ý phòng phối hợp theo lịch sử đơn cùng lĩnh vực; bấm "Áp dụng" để tick sẵn. */
function updateCollabHint() {
  const box = $('#pt-f-hint');
  const picks = usualCollabs($('#pt-f-field').value, $('#pt-f-dept').value || null);
  box.hidden = picks.length === 0;
  box.innerHTML = picks.length ? `
    <span><i class="fa-solid fa-lightbulb"></i> Đơn cùng lĩnh vực thường phối hợp: <b>${picks.map(([id, n]) => `${esc(deptName(id))} (${n})`).join(', ')}</b></span>
    <button type="button" class="btn btn-ghost btn-sm" data-apply-collab="${esc(picks.map(([id]) => id).join(','))}">Áp dụng</button>` : '';
}

/** Cảnh báo đơn có thể trùng khi người dùng nhập số điện thoại hoặc nội dung. */
function updateDupes() {
  const box = $('#pt-dupes');
  const matches = findSimilar(store.petitions, {
    phone: $('#pt-f-phone').value,
    content: $('#pt-f-content').value,
    exceptId: formId,
  });
  box.hidden = matches.length === 0;
  box.innerHTML = matches.length ? `
    <div class="dupes-title"><i class="fa-solid fa-triangle-exclamation"></i> Có đơn tương tự — kiểm tra trước khi tiếp nhận</div>
    ${matches.map(({ petition, score, samePhone }) => `
      <button type="button" class="dupe-row" data-open-petition="${esc(petition.id)}">
        <b>${esc(petition.code)}</b> · ${esc(petition.citizen?.name || 'Ẩn danh')} ·
        ${samePhone ? 'cùng số điện thoại' : `nội dung giống ${Math.round(score * 100)}%`}
      </button>`).join('')}` : '';
}

function submitPetition(e) {
  e.preventDefault();
  const name = $('#pt-f-name').value.trim();
  const content = $('#pt-f-content').value.trim();
  if (!name || !content) {
    toast('Vui lòng nhập họ tên công dân và nội dung đơn', 'error');
    return;
  }
  const deptId = $('#pt-f-dept').value || null;
  const fields = {
    type: $('#pt-f-type').value,
    channel: $('#pt-f-channel').value,
    receivedAt: $('#pt-f-received').value,
    citizen: { name, phone: $('#pt-f-phone').value.trim(), address: $('#pt-f-address').value.trim() },
    content,
    field: $('#pt-f-field').value,
    deptId,
    collabDeptIds: readCollabList($('#pt-f-collab-list'), deptId),
    deadline: $('#pt-f-deadline').value,
    result: $('#pt-f-result').value.trim(),
    calendarSync: $('#pt-sync').checked,
  };

  const existing = petitionById(formId);
  if (existing) {
    const before = existing.status;
    const beforeResult = existing.result ?? '';
    Object.assign(existing, fields, { status: $('#pt-f-status').value });
    addTimeline(existing, 'Cập nhật thông tin đơn');
    if (before !== existing.status) addTimeline(existing, `Tình trạng: ${existing.status}`);
    if (beforeResult !== existing.result) addTimeline(existing, 'Cập nhật kết quả xử lý');
    toast('Đã cập nhật đơn thư', 'success');
  } else {
    const petition = {
      id: uid(), code: nextCode('DT', store.petitions), ...fields,
      status: TODO, reflectionId: formReflectionId, timeline: [], files: [],
    };
    store.petitions.push(petition);
    addTimeline(petition, `Tiếp nhận đơn qua ${fields.channel.toLowerCase()}`);
    const reflection = formReflectionId ? reflectionById(formReflectionId) : null;
    if (reflection) {
      reflection.petitionId = petition.id;
      reflection.status = DONE;
      addTimeline(reflection, `Đã chuyển thành đơn thư ${petition.code}`);
      addTimeline(petition, `Chuyển từ phản ánh ${reflection.code}`);
    }
    toast(`Đã tiếp nhận ${petition.code}`, 'success');
  }
  persist();
  closeModal('petition-modal');
}

/* ---------------- Chi tiết ---------------- */

export function openPetitionDetail(id) {
  const p = petitionById(id);
  if (!p) return;
  rememberRecent({ kind: 'petitions', id: p.id, title: `${p.code} · ${p.type}` });
  detailId = p.id;
  const s = dueState(p, isClosed(p));

  $('#ptd-code').textContent = p.code;
  const status = $('#ptd-status');
  fillOptions(status, PETITION_STATUSES);
  status.value = p.status;
  status.dataset.status = p.status;

  $('#ptd-type').innerHTML = `<span class="badge badge-doing">${esc(p.type)}</span> <span class="muted">${esc(p.channel)}</span>`;
  $('#ptd-name').textContent = p.citizen?.name || 'Công dân ẩn danh';
  $('#ptd-meta').innerHTML = `
    ${dueBadge(s)}
    <span><i class="fa-regular fa-clock"></i> Hạn <b>${formatDate(p.deadline)}</b></span>
    <span><i class="fa-regular fa-calendar"></i> Nhận <b>${formatDate(p.receivedAt)}</b></span>
    <span><i class="fa-solid fa-sitemap"></i> <b>${esc(deptName(p.deptId))}</b></span>
    ${p.collabDeptIds?.length ? `<span><i class="fa-solid fa-users"></i> Phối hợp: <b>${esc(deptNames(p.collabDeptIds))}</b></span>` : ''}
    <span><i class="fa-solid fa-layer-group"></i> <b>${esc(p.field)}</b></span>`;
  $('#ptd-people').innerHTML = `
    <div class="person-line">
      <span class="mini-ico"><i class="fa-solid fa-phone"></i></span>
      <div><small>Điện thoại</small><b>${esc(p.citizen?.phone || 'Chưa có')}</b></div>
    </div>
    <div class="person-line">
      <span class="mini-ico"><i class="fa-solid fa-location-dot"></i></span>
      <div><small>Địa chỉ</small><b>${esc(p.citizen?.address || 'Chưa có')}</b></div>
    </div>`;
  $('#ptd-content').textContent = p.content;
  $('#ptd-result').textContent = p.result ?? '';
  $('#ptd-result-wrap').hidden = !p.result;
  renderLinkedTasks(p);
  renderTimeline($('#ptd-timeline'), p);
  renderDetailActions(p);
  openModal('petition-detail-modal');
}

function renderLinkedTasks(p) {
  const tasks = tasksOf(p);
  $('#ptd-tasks').innerHTML = tasks.length
    ? tasks.map((t) => {
      const kind = t.source === 'btv' ? 'Giao việc BTV' : 'Công việc';
      return `
        <button type="button" class="stack-item stack-link" data-open-task="${esc(t.id)}">
          <div class="stack-main">
            <b>${esc(t.title)}</b>
            <small>${kind} · ${esc(deptName(t.departmentId))} · Hạn ${formatDate(t.deadline)}</small>
          </div>
          ${statusBadge(effectiveStatus(t))}
        </button>`;
    }).join('')
    : '<div class="empty-inline">Chưa có công việc liên kết. Tạo công việc để bắt đầu xử lý.</div>';
}

function renderDetailActions(p) {
  const closed = isClosed(p);
  const left = [];
  if (!closed && !tasksOf(p).length) {
    left.push(actionBtn('create-task', 'btn-primary', 'fa-list-check', 'Tạo công việc xử lý'));
  }
  if (!closed) left.push(actionBtn('escalate', 'btn-secondary', 'fa-stamp', 'Chuyển Giao việc BTV'));  const right = [
    actionBtn('edit', 'btn-secondary', 'fa-pen-to-square', 'Chỉnh sửa'),
    actionBtn('delete', 'btn-danger-ghost', 'fa-trash-can', 'Xóa'),
  ];
  $('#ptd-actions').innerHTML = `<div class="btn-group">${left.join('')}</div><div class="btn-group">${right.join('')}</div>`;
}

function onDetailAction(e) {
  const btn = e.target.closest('[data-action]');
  const p = petitionById(detailId);
  if (!btn || !p) return;
  switch (btn.dataset.action) {
    case 'create-task':
      createTaskForPetition(p);
      break;
    case 'escalate':
      closeModal('petition-detail-modal');
      openBtvForm(null, {
        sourceId: p.id,
        title: `Xử lý ${p.code}: ${p.type}${p.citizen?.name ? ` – ${p.citizen.name}` : ''}`,
        desc: p.content,
        deptId: p.deptId,
        collabDeptIds: p.collabDeptIds ?? [],
        resolutionNo: `Đơn ${p.code}`,
      });
      break;
    case 'edit':
      closeModal('petition-detail-modal');
      openPetitionForm(p.id);
      break;
    case 'delete':
      deletePetition(p);
      break;
    default:
      break;
  }
}

/** Tạo công việc xử lý, giao cho phòng xử lý chính và các phòng phối hợp của đơn. */
function createTaskForPetition(p) {
  if (!p.deptId) {
    toast('Chọn phòng xử lý chính trong phần chỉnh sửa trước khi tạo công việc', 'error');
    return;
  }
  createTaskFor(p, 'don-thu', {
    title: `Xử lý ${p.code}: ${p.type} – ${p.citizen?.name || 'công dân'}`,
    desc: p.content,
    deadline: p.deadline,
    priority: ['Khiếu nại', 'Tố cáo'].includes(p.type) ? 'Cao' : 'Trung bình',
    departmentId: p.deptId,
    collabDeptIds: p.collabDeptIds ?? [],
  });
  persist();
  toast(`Đã tạo công việc và giao cho ${deptName(p.deptId)}`, 'success');
  openPetitionDetail(p.id);
}

/** Đổi tình trạng ngay trong bảng (không mở cửa sổ chi tiết). */
function onStatusChange(e) {
  const select = e.target.closest('select[data-action="status"]');
  const petition = petitionById(select?.closest('tr[data-id]')?.dataset.id);
  if (!petition || petition.status === select.value) return;
  petition.status = select.value;
  addTimeline(petition, `Tình trạng: ${petition.status}`);
  persist();
  toast('Đã cập nhật tình trạng', 'success');
  renderPetitions();
}

function setPetitionStatus(p, status) {
  if (!p || p.status === status) return;
  p.status = status;
  addTimeline(p, `Tình trạng: ${status}`);
  persist();
  openPetitionDetail(p.id);
}

async function deletePetition(p) {
  if (!p) return;
  const ok = await confirmDialog({
    title: 'Xóa đơn thư?',
    message: `Đơn ${p.code} sẽ bị xóa. Công việc liên quan (nếu có) được giữ lại như công việc thường.`,
    confirmText: 'Xóa đơn',
  });
  if (!ok) return;
  closeModal('petition-detail-modal');
  removePetition(p.id);
}
