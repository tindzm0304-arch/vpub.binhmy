/* Màn hình Phòng ban: danh mục phòng ban, thêm–sửa–xóa, số cán bộ và công việc đang mở theo phòng. */
import {
  store, deptById, deptNameTaken, removeDepartment, persist, sortedDepartments, effectiveStatus, PETITION_CLOSED,
} from '../store.js';
import { openModal, closeModal, confirmDialog } from '../modal.js';
import { $, esc, fold, uid, dateKey, toast, CLOSED } from '../utils.js';

let formId = null;

/* ---------------- Khởi tạo ---------------- */

export function initDepartments() {
  $('#dept-search').addEventListener('input', renderDepartments);
  $('#dept-new').addEventListener('click', () => openDeptForm());
  $('#dept-rows').addEventListener('click', onRowClick);
  $('#dept-rows').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('tr[data-id]')) openDeptForm(e.target.dataset.id);
  });
  $('#dept-form').addEventListener('submit', submitDept);
}

/* ---------------- Danh sách ---------------- */

export function renderDepartments() {
  const today = dateKey();
  const openTasks = store.tasks.filter((t) => !CLOSED.includes(effectiveStatus(t, today)));

  $('#dk-total').textContent = store.departments.length;
  $('#dk-unassigned').textContent = store.personnel.filter((p) => !p.deptId).length;

  const q = fold($('#dept-search').value.trim());
  const list = sortedDepartments().filter((d) => !q || fold(d.name).includes(q));
  $('#dept-rows').innerHTML = list.map((d) => deptRow(d, openTasks)).join('');
  $('#dept-empty').hidden = list.length > 0;
}

function deptRow(dept, openTasks) {
  const people = store.personnel.filter((p) => p.deptId === dept.id).length;
  const tasks = openTasks.filter((t) => t.departmentId === dept.id || t.collabDeptIds?.includes(dept.id)).length;
  const petitions = store.petitions.filter((p) => p.deptId === dept.id && !PETITION_CLOSED.includes(p.status)).length;
  return `
    <tr data-id="${esc(dept.id)}" tabindex="0">
      <td>
        <div class="person">
          <span class="dept-icon" aria-hidden="true"><i class="fa-solid fa-building"></i></span>
          <div class="person-meta"><div class="person-name">${esc(dept.name)}</div></div>
        </div>
      </td>
      <td><span class="chip"><i class="fa-solid fa-users"></i> ${people} cán bộ</span></td>
      <td>
        <div class="stack-tags">
          <span class="chip"><i class="fa-solid fa-suitcase"></i> ${tasks} việc đang mở</span>
          <span class="chip"><i class="fa-solid fa-envelope-open-text"></i> ${petitions} đơn đang mở</span>
        </div>
      </td>
      <td class="t-right">
        <div class="row-actions">
          <button type="button" class="icon-btn" data-action="edit" title="Chỉnh sửa" aria-label="Chỉnh sửa ${esc(dept.name)}"><i class="fa-regular fa-pen-to-square"></i></button>
          <button type="button" class="icon-btn is-danger" data-action="delete" title="Xóa" aria-label="Xóa ${esc(dept.name)}"><i class="fa-regular fa-trash-can"></i></button>
        </div>
      </td>
    </tr>`;
}

function onRowClick(e) {
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'delete') deleteDeptWithConfirm(row.dataset.id);
  else openDeptForm(row.dataset.id);
}

/* ---------------- Form thêm / sửa ---------------- */

export function openDeptForm(id = null) {
  const dept = id ? deptById(id) : null;
  formId = dept?.id ?? null;
  $('#dept-form').reset();
  $('#dept-name').value = dept?.name ?? '';
  $('#dept-modal-title').textContent = dept ? 'Cập nhật phòng ban' : 'Thêm phòng ban mới';
  $('#dept-submit').innerHTML = dept
    ? '<i class="fa-solid fa-check"></i> Lưu cập nhật'
    : '<i class="fa-solid fa-floppy-disk"></i> Lưu phòng ban';
  openModal('dept-modal');
}

function submitDept(e) {
  e.preventDefault();
  const name = $('#dept-name').value.trim().replace(/\s+/g, ' ');
  if (!name) return;
  if (deptNameTaken(name, formId)) {
    toast('Tên phòng ban này đã tồn tại', 'error');
    return;
  }

  const existing = deptById(formId);
  if (existing) {
    existing.name = name;
    toast('Đã cập nhật phòng ban', 'success');
  } else {
    store.departments.push({ id: uid(), name });
    toast('Đã thêm phòng ban', 'success');
  }
  persist();
  closeModal('dept-modal');
}

/* ---------------- Xóa ---------------- */

async function deleteDeptWithConfirm(id) {
  const dept = deptById(id);
  if (!dept) return;
  const people = store.personnel.filter((p) => p.deptId === id).length;
  const tasks = store.tasks.filter((t) => t.departmentId === id).length;
  const impact = people || tasks
    ? ` ${people} cán bộ và ${tasks} công việc thuộc phòng này sẽ chuyển sang "Chưa phân phòng".`
    : '';
  const ok = await confirmDialog({
    title: 'Xóa phòng ban?',
    message: `"${dept.name}" sẽ bị xóa.${impact}`,
    confirmText: 'Xóa phòng ban',
  });
  if (!ok) return;
  removeDepartment(id);
  toast('Đã xóa phòng ban', 'success');
}
