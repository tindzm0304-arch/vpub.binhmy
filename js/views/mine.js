/* Việc cần xử lý: công việc, đơn thư và phản ánh đang mở của một đơn vị (phòng ban) — thuộc phòng đó hoặc phòng đó phối hợp.
   Lựa chọn "Đơn vị" lưu trên máy này; bộ lọc giữ trong phiên làm việc. */
import { store, deptById, deptName, sortedDepartments, effectiveStatus, taskById, syncTaskEvent, persist } from '../store.js';
import { getSettings, saveSettings } from '../settings.js';
import { openTaskDetail } from './tasks.js';
import { openBtvDetail } from './btv.js';
import { openPetitionDetail } from './petitions.js';
import { openReflectionDetail } from './reflections.js';
import { $, esc, fold, dateKey, addDays, formatDate, parseDateKey, statusBadge, priorityBadge, toast, CLOSED, OVERDUE, REVIEW, DONE } from '../utils.js';

const SOON_DAYS = 7;
const SOURCE_LABEL = { 'noi-bo': 'Giao việc TTUB', btv: 'Giao việc BTV', petition: 'Đơn thư', reflection: 'Phản ánh 1022' };
/* "Mọi đơn vị": mọi việc đang mở, không cần vai trò phòng chính / phối hợp. */
const ALL_DEPTS = { id: null, name: 'Mọi đơn vị', all: true };
const OPEN = {
  task: (id) => (taskById(id)?.source === 'btv' ? openBtvDetail(id) : openTaskDetail(id)),
  petition: openPetitionDetail,
  reflection: openReflectionDetail,
};
/* Bộ lọc giữ trong phiên (tải lại trang thì về mặc định). */
const filters = { source: 'all', role: 'all', due: 'all', q: '' };

const daysBetween = (from, to) => Math.round((parseDateKey(to) - parseDateKey(from)) / 86400000);

/** Gom công việc, đơn thư, phản ánh của phòng: mỗi dòng có vai trò (phòng chính / phối hợp) và trạng thái hiệu lực. */
function rowsOf(dept, today) {
  const rows = [
    ...store.tasks.map((t) => ({
      kind: 'task', src: t.source === 'btv' ? 'btv' : 'noi-bo', item: t, lead: t.departmentId, collab: t.collabDeptIds ?? [],
      title: t.title, text: t.desc,
    })),
    ...store.petitions.map((p) => ({
      kind: 'petition', src: 'petition', item: p, lead: p.deptId, collab: p.collabDeptIds ?? [],
      title: `${p.code} · ${p.type}`, text: `${p.content ?? ''} ${p.citizen?.name ?? ''}`,
    })),
    ...store.reflections.map((r) => ({
      kind: 'reflection', src: 'reflection', item: r, lead: r.deptId, collab: r.collabDeptIds ?? [],
      title: `${r.code} · ${r.area}`, text: r.content ?? '',
    })),
  ];
  return rows
    .map((r) => ({ ...r, role: dept.all || r.lead === dept.id ? 'lead' : (r.collab.includes(dept.id) ? 'collab' : null), status: effectiveStatus(r.item, today) }))
    .filter((r) => r.role && !CLOSED.includes(r.status))
    .sort((a, b) => a.item.deadline.localeCompare(b.item.deadline));
}

function matches(r, today, soon) {
  const { source, role, due, q } = filters;
  if (source !== 'all' && r.src !== source) return false;
  if (role !== 'all' && r.role !== role) return false;
  if (due === 'overdue' && r.status !== OVERDUE) return false;
  if (due === 'soon' && (r.status === OVERDUE || r.item.deadline > soon)) return false;
  if (due === 'later' && r.item.deadline <= soon) return false;
  return !q || fold(`${r.title} ${r.text}`).includes(fold(q));
}

const dueText = (days) => {
  if (days < 0) return `quá ${-days} ngày`;
  return days === 0 ? 'hôm nay' : `còn ${days} ngày`;
};

function mineItem(r, today) {
  const { item } = r;
  const overdue = r.status === OVERDUE;
  const days = daysBetween(today, item.deadline);
  const subs = item.subtasks ?? [];
  const progress = subs.length ? `<small>${subs.filter((s) => s.done).length}/${subs.length} đầu việc</small>` : '';
  const priority = r.kind === 'task' ? priorityBadge(item.priority) : '';
  const role = r.role === 'collab' ? ' · Phối hợp' : '';
  // Nút hoàn thành chỉ có với công việc đang mở và chưa chờ duyệt; đơn thư / phản ánh đóng ở màn hình của chúng.
  const canClose = r.kind === 'task' && r.status !== REVIEW;
  const closeLabel = getSettings().approvalRequired ? 'Gửi duyệt' : 'Hoàn thành';
  return `
    <div class="mine-item ${overdue ? 'is-overdue' : ''}">
      <button type="button" class="mine-open" data-kind="${r.kind}" data-id="${esc(item.id)}">
        <span class="mine-date ${overdue ? 'is-overdue' : ''}">${formatDate(item.deadline)}<small>${dueText(days)}</small></span>
        <span class="mine-body">
          <b>${esc(r.title)}</b>
          <small>${esc(SOURCE_LABEL[r.src])} · ${esc(deptName(r.lead))}${role}</small>
          <span class="mine-meta">${statusBadge(r.status)}${priority}${progress}</span>
        </span>
      </button>
      ${canClose ? `<button type="button" class="btn btn-secondary btn-sm mine-done" data-done="${esc(item.id)}"><i class="fa-solid fa-check"></i> ${closeLabel}</button>` : ''}
    </div>`;
}

export function renderMine() {
  const { mineDeptId } = getSettings();
  const select = $('#mine-dept');
  select.innerHTML = `<option value="">Chọn đơn vị…</option><option value="all"${mineDeptId === 'all' ? ' selected' : ''}>${ALL_DEPTS.name}</option>${sortedDepartments()
    .map((d) => `<option value="${esc(d.id)}"${d.id === mineDeptId ? ' selected' : ''}>${esc(d.name)}</option>`)
    .join('')}`;

  const dept = mineDeptId === 'all' ? ALL_DEPTS : deptById(mineDeptId);
  const body = $('#mine-body');
  if (!dept) {
    body.innerHTML = `
      <div class="empty">
        <i class="fa-regular fa-building"></i>
        <p>Chọn "Đơn vị" để xem việc cần xử lý của đơn vị</p>
        <small>Lựa chọn được lưu trên máy này.</small>
      </div>`;
    return;
  }
  // Lọc vai trò không áp dụng cho "Mọi đơn vị"
  $('#mine-role').disabled = dept.all;
  if (dept.all && filters.role !== 'all') {
    filters.role = 'all';
    $('#mine-role').value = 'all';
  }

  const today = dateKey();
  const soon = addDays(today, SOON_DAYS);
  const all = rowsOf(dept, today);
  const mine = all.filter((r) => matches(r, today, soon));

  const groups = [
    ['Quá hạn', mine.filter((r) => r.status === OVERDUE)],
    [`Đến hạn trong ${SOON_DAYS} ngày`, mine.filter((r) => r.status !== OVERDUE && r.item.deadline <= soon)],
    ['Sau đó', mine.filter((r) => r.item.deadline > soon)],
  ];

  const filtered = Object.values(filters).some((v) => v && v !== 'all');
  if (!all.length) {
    body.innerHTML = `
      <div class="empty">
        <i class="fa-regular fa-circle-check"></i>
        <p>Không có việc cần xử lý</p>
        <small>${dept.all ? 'Các đơn vị' : esc(dept.name)} chưa có công việc, đơn thư hay phản ánh nào đang mở.</small>
      </div>`;
    return;
  }
  body.innerHTML = mine.length
    ? `<p class="mine-count">Hiển thị ${mine.length} / ${all.length} việc</p>${groups.filter(([, list]) => list.length).map(([title, list]) => `
        <h3 class="mine-group">${esc(title)} (${list.length})</h3>
        ${list.map((r) => mineItem(r, today)).join('')}`).join('')}`
    : `
      <div class="empty">
        <i class="fa-solid fa-filter"></i>
        <p>Không có việc khớp bộ lọc</p>
        ${filtered ? '<button type="button" class="btn btn-ghost btn-sm" data-clear>Xóa bộ lọc</button>' : ''}
      </div>`;
}

/** Đánh dấu hoàn thành (hoặc gửi duyệt khi bật "duyệt trước khi hoàn thành"), giống nút trong chi tiết công việc. */
function closeTask(id) {
  const task = taskById(id);
  if (!task) return;
  const approval = getSettings().approvalRequired;
  task.status = approval ? REVIEW : DONE;
  if (task.eventId) syncTaskEvent(task, true);
  persist();
  toast(approval ? 'Đã gửi duyệt — lãnh đạo cần duyệt để hoàn thành' : 'Đã hoàn thành', 'success');
}

const resetFilters = () => {
  Object.assign(filters, { source: 'all', role: 'all', due: 'all', q: '' });
  for (const [id, key] of [['#mine-source', 'source'], ['#mine-role', 'role'], ['#mine-due', 'due'], ['#mine-q', 'q']]) {
    $(id).value = filters[key];
  }
  renderMine();
};

export function initMine() {
  $('#mine-dept').addEventListener('change', (e) => {
    saveSettings({ mineDeptId: e.target.value || null });
    renderMine();
  });
  for (const [id, key] of [['#mine-source', 'source'], ['#mine-role', 'role'], ['#mine-due', 'due']]) {
    $(id).addEventListener('change', (e) => {
      filters[key] = e.target.value;
      renderMine();
    });
  }
  $('#mine-q').addEventListener('input', (e) => {
    filters.q = e.target.value.trim();
    renderMine();
  });
  $('#mine-body').addEventListener('click', (e) => {
    if (e.target.closest('[data-clear]')) return resetFilters();
    const done = e.target.closest('[data-done]');
    if (done) return closeTask(done.dataset.done);
    const open = e.target.closest('[data-kind]');
    if (open) OPEN[open.dataset.kind]?.(open.dataset.id);
  });
}
