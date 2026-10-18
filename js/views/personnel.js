/* Màn hình Quản lý Nhân sự: danh sách, lọc, thêm–sửa–xóa cán bộ, hồ sơ chi tiết. */
import { store, personById, persist, removePerson, effectiveStatus, deptName, sortedDepartments } from '../store.js';
import { openModal, closeModal, confirmDialog } from '../modal.js';
import { rememberRecent } from '../recent.js';
import {
  $, esc, fold, uid, dateKey, timeKey, formatDate, avatar,
  personCell, statusBadge, fillOptions, toast, TITLES, CLOSED,
} from '../utils.js';

const NO_DEPT = '<option value="">Chưa phân phòng</option>';
const deptPairs = () => sortedDepartments().map((d) => [d.id, d.name]);

let formId = null;
let detailId = null;

/* ---------------- Khởi tạo ---------------- */

export function initPersonnel() {
  fillOptions($('#title-options'), TITLES);

  for (const el of [$('#person-search'), $('#person-dept-filter')]) {
    el.addEventListener('input', renderPersonnel);
    el.addEventListener('change', renderPersonnel);
  }
  $('#person-new').addEventListener('click', () => openPersonForm());
  $('#person-rows').addEventListener('click', onRowClick);
  $('#person-rows').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('tr[data-id]')) openPersonDetail(e.target.dataset.id);
  });
  $('#person-form').addEventListener('submit', submitPerson);
  $('#pd-edit').addEventListener('click', () => {
    closeModal('person-detail-modal');
    openPersonForm(detailId);
  });
}

/** Bộ lọc phòng ban giữ nguyên lựa chọn nếu phòng đó vẫn còn. */
function refreshDeptFilter() {
  const filter = $('#person-dept-filter');
  const previous = filter.value;
  fillOptions(filter, deptPairs(), '<option value="all">Tất cả phòng ban</option><option value="none">Chưa phân phòng</option>');
  filter.value = [...filter.options].some((o) => o.value === previous) ? previous : 'all';
}

/* ---------------- Danh sách ---------------- */

export function renderPersonnel() {
  refreshDeptFilter();
  const q = fold($('#person-search').value.trim());
  const dept = $('#person-dept-filter').value;
  const today = dateKey();

  const busy = new Set(
    store.tasks
      .filter((t) => !CLOSED.includes(effectiveStatus(t, today)))
      .flatMap((t) => [t.departmentId, ...(t.collabDeptIds ?? [])])
      .filter(Boolean),
  );
  $('#pk-total').textContent = store.personnel.length;
  $('#pk-busy').textContent = busy.size;

  const list = store.personnel.filter((p) => {
    const deptOk = dept === 'all' || (dept === 'none' ? !p.deptId : p.deptId === dept);
    return deptOk && (!q || fold(p.name).includes(q) || (p.phone || '').includes(q));
  });

  $('#person-rows').innerHTML = list.map(personRow).join('');
  $('#person-empty').hidden = list.length > 0;
}

function personRow(p) {
  return `
    <tr data-id="${esc(p.id)}" tabindex="0">
      <td>${personCell(p)}</td>
      <td><span class="chip">${esc(deptName(p.deptId))}</span></td>
      <td>${p.phone ? `<a class="tel" href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : '<span class="muted">Chưa cập nhật</span>'}</td>
      <td class="t-right">
        <div class="row-actions">
          <button type="button" class="icon-btn" data-action="view" title="Xem hồ sơ" aria-label="Xem hồ sơ"><i class="fa-regular fa-eye"></i></button>
          <button type="button" class="icon-btn" data-action="edit" title="Chỉnh sửa" aria-label="Chỉnh sửa"><i class="fa-regular fa-pen-to-square"></i></button>
          <button type="button" class="icon-btn is-danger" data-action="delete" title="Xóa" aria-label="Xóa"><i class="fa-regular fa-trash-can"></i></button>
        </div>
      </td>
    </tr>`;
}

function onRowClick(e) {
  if (e.target.closest('a')) return;
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'edit') openPersonForm(row.dataset.id);
  else if (action === 'delete') deletePersonWithConfirm(row.dataset.id);
  else openPersonDetail(row.dataset.id);
}

async function deletePersonWithConfirm(id) {
  const person = personById(id);
  if (!person) return;
  const ok = await confirmDialog({
    title: 'Xóa cán bộ?',
    message: `Xóa "${person.name}" khỏi danh sách. Tên người này sẽ được gỡ khỏi lịch công tác liên quan.`,
    confirmText: 'Xóa cán bộ',
  });
  if (!ok) return;
  removePerson(id);
}

/* ---------------- Form thêm / sửa ---------------- */

export function openPersonForm(id = null) {
  const person = id ? personById(id) : null;
  formId = person?.id ?? null;
  $('#person-form').reset();
  $('#person-name').value = person?.name ?? '';
  $('#person-phone').value = person?.phone ?? '';
  $('#person-title').value = person?.title ?? '';

  fillOptions($('#person-dept'), deptPairs(), NO_DEPT);
  $('#person-dept').value = person
    ? (person.deptId ?? '')
    : (sortedDepartments()[0]?.id ?? '');

  $('#person-modal-title').textContent = person ? 'Cập nhật thông tin cán bộ' : 'Thêm cán bộ mới';
  $('#person-submit').innerHTML = person
    ? '<i class="fa-solid fa-check"></i> Lưu cập nhật'
    : '<i class="fa-solid fa-floppy-disk"></i> Lưu cán bộ';
  openModal('person-modal');
}

function submitPerson(e) {
  e.preventDefault();
  const name = $('#person-name').value.trim();
  if (!name) return;

  const fields = {
    name,
    phone: $('#person-phone').value.trim(),
    title: $('#person-title').value.trim(),
    deptId: $('#person-dept').value || null,
  };

  const existing = personById(formId);
  if (existing) {
    Object.assign(existing, fields);
    toast('Đã cập nhật thông tin cán bộ', 'success');
  } else {
    store.personnel.push({ id: uid(), ...fields });
    toast('Đã thêm cán bộ mới', 'success');
  }
  persist();
  closeModal('person-modal');
}

/* ---------------- Hồ sơ chi tiết ---------------- */

export function openPersonDetail(id) {
  const person = personById(id);
  if (!person) return;
  rememberRecent({ kind: 'personnel', id: person.id, title: person.name });
  detailId = person.id;

  const now = new Date();
  const nowKey = `${dateKey(now)}T${timeKey(now)}`;
  // Công việc giao theo phòng: hồ sơ cán bộ hiển thị việc của phòng mình (xử lý chính hoặc phối hợp)
  const deptId = person.deptId;
  const tasks = store.tasks
    .filter((t) => deptId && (t.departmentId === deptId || t.collabDeptIds?.includes(deptId)) && !CLOSED.includes(effectiveStatus(t)))
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  const events = store.events
    .filter((ev) => ev.attendeeIds.includes(id) && ev.end >= nowKey)
    .sort((a, b) => a.start.localeCompare(b.start));

  $('#pd-avatar').innerHTML = avatar(person, 'lg');
  $('#pd-name').textContent = person.name;
  $('#pd-title').textContent = person.title;
  $('#pd-dept').textContent = deptName(person.deptId);
  $('#pd-phone').textContent = person.phone || 'Chưa cập nhật';

  $('#pd-task-count').textContent = `${tasks.length} việc`;
  $('#pd-tasks').innerHTML = tasks.length
    ? tasks.map((t) => `
        <div class="stack-item">
          <div class="stack-main">
            <b>${esc(t.title)}</b>
            <small>${t.departmentId === deptId ? 'Phòng xử lý chính' : 'Phòng phối hợp'} · <i class="fa-regular fa-clock"></i> Hạn ${formatDate(t.deadline)}</small>
          </div>
          ${statusBadge(effectiveStatus(t))}
        </div>`).join('')
    : '<div class="empty-inline">Phòng chưa có công việc đang xử lý.</div>';

  $('#pd-event-count').textContent = `${events.length} sự kiện`;
  $('#pd-events').innerHTML = events.length
    ? events.map((ev) => {
      const [, month, day] = ev.start.slice(0, 10).split('-');
      return `
        <div class="stack-item">
          <div class="date-badge"><small>Tháng ${Number(month)}</small><b>${day}</b></div>
          <div class="stack-main">
            <b>${esc(ev.title)}</b>
            <small><i class="fa-regular fa-clock"></i> ${ev.start.slice(11, 16)} – ${ev.end.slice(11, 16)} · ${esc(ev.location || 'Tại cơ quan')}</small>
          </div>
        </div>`;
    }).join('')
    : '<div class="empty-inline">Không có lịch công tác sắp tới.</div>';

  openModal('person-detail-modal');
}
