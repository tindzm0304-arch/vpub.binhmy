/* Kiểm tra dữ liệu: liệt kê chỗ thiếu, công việc đứng im, đơn cùng người gửi, phản ánh đột biến.
   Chỉ đọc và mở đúng hồ sơ để sửa; không tự thay đổi dữ liệu. */
import { store, tasksOf, deptName, PETITION_CLOSED } from '../store.js';
import { getSettings } from '../settings.js';
import { areaSpikes, staleTasks, repeatCitizens } from '../insight.js';
import { openTaskDetail } from './tasks.js';
import { openBtvDetail } from './btv.js';
import { openPetitionDetail } from './petitions.js';
import { $, esc, dateKey, formatDate, CLOSED } from '../utils.js';

const go = (view, open) => {
  if (location.hash.slice(1) !== view) location.hash = view;
  open?.();
};

const openTask = (id) => {
  const t = store.tasks.find((x) => x.id === id);
  if (!t) return;
  if (t.source === 'btv') go('btv', () => openBtvDetail(id));
  else go('tasks', () => openTaskDetail(id));
};

const openPetition = (id) => go('petitions', () => openPetitionDetail(id));

/** Một mục kiểm tra: nhãn, dòng phụ và nút mở hồ sơ (nếu có). */
const item = (text, sub, action = '') => `
  <li class="auto-row">
    <div><b>${esc(text)}</b><small>${esc(sub)}</small></div>
    ${action ? `<div class="row-actions">${action}</div>` : ''}
  </li>`;

const openBtn = (kind, id) => `<button type="button" class="btn btn-ghost btn-sm" data-open="${kind}" data-id="${esc(id)}">Mở</button>`;

const section = (tone, icon, title, note, rows, count) => `
  <section class="set-card">
    <div class="set-head">
      <span class="set-ico tone-${tone}"><i class="fa-solid ${icon}"></i></span>
      <div>
        <h3>${esc(title)} <span class="ov-note">${count}</span></h3>
        <p class="set-note">${esc(note)}</p>
      </div>
    </div>
    <ul class="auto-list">${rows || '<li class="empty-inline">Không có mục nào.</li>'}</ul>
  </section>`;

export function renderHealth() {
  const today = dateKey();
  const { staleDays } = getSettings();
  const sections = [];

  const noTask = store.petitions.filter((p) => !PETITION_CLOSED.includes(p.status) && tasksOf(p).length === 0);
  sections.push(section('amber', 'fa-envelope-open-text', 'Đơn thư đang mở chưa có công việc',
    'Đơn đang xử lý nhưng chưa tạo công việc nào. Kiểm tra xem đã phân công xử lý chưa.',
    noTask.map((p) => item(`${p.code} · ${p.type}`, `${deptName(p.deptId)} · Hạn ${formatDate(p.deadline)}`, openBtn('petition', p.id))).join(''),
    noTask.length));

  const noLead = store.tasks.filter((t) => !t.departmentId);
  sections.push(section('red', 'fa-sitemap', 'Công việc thiếu phòng xử lý chính',
    'Công việc chưa gán phòng nên không có ai nhận nhắc hạn.',
    noLead.map((t) => item(t.title, `Hạn ${formatDate(t.deadline)}`, openBtn('task', t.id))).join(''),
    noLead.length));

  const noReport = store.tasks.filter((t) => t.source === 'btv' && !t.btv?.reportDue);
  sections.push(section('red', 'fa-stamp', 'Giao việc BTV thiếu hạn báo cáo',
    'Thiếu hạn báo cáo BTV nên không được nhắc báo cáo.',
    noReport.map((t) => item(t.title, `${t.btv?.resolutionNo || 'Chưa có số nghị quyết'}`, openBtn('btv', t.id))).join(''),
    noReport.length));

  const noDept = store.personnel.filter((p) => !p.deptId);
  sections.push(section('blue', 'fa-user-group', 'Cán bộ chưa thuộc phòng nào',
    'Cán bộ chưa có phòng nên không thấy trong việc của phòng.',
    noDept.map((p) => item(p.name, p.title || 'Cán bộ')).join(''),
    noDept.length));

  const stale = staleTasks(staleDays);
  sections.push(section('amber', 'fa-hourglass-half', `Việc đứng im (từ ${staleDays} ngày không cập nhật)`,
    'Công việc đang mở nhưng không có thay đổi nào. Có thể đã xong mà chưa đánh dấu, hoặc đang bị bỏ quên.',
    stale.map(({ task: t, idle }) => item(t.title, `${idle} ngày không cập nhật · ${deptName(t.departmentId)} · Hạn ${formatDate(t.deadline)}`, openBtn('task', t.id))).join(''),
    stale.length));

  const spikes = areaSpikes(today);
  sections.push(section('red', 'fa-chart-line', 'Khu vực phản ánh tăng đột biến',
    'Trong 7 ngày gần nhất số phản ánh vượt gấp đôi mức trung bình tuần của 4 tuần trước (tối thiểu 3 phản ánh).',
    spikes.map((s) => item(`Khu vực ${s.area}`, `${s.recent} phản ánh trong 7 ngày · trung bình tuần trước ${s.weeklyAvg}`)).join(''),
    spikes.length));

  const repeats = repeatCitizens(today);
  sections.push(section('blue', 'fa-address-book', 'Cùng một người gửi nhiều đơn (365 ngày)',
    'Cùng số điện thoại gửi từ 2 đơn trở lên. Xem lại xem vụ việc đã được giải quyết dứt điểm chưa.',
    repeats.flatMap((r) => r.petitions.map((p) => item(
      `${p.code} · ${p.type} · ${r.name}`,
      `${r.phone} · ${formatDate(p.receivedAt)} · ${p.status}`,
      openBtn('petition', p.id),
    ))).join(''),
    repeats.length));

  const open = store.tasks.filter((t) => !CLOSED.includes(t.status)).length;
  $('#health-body').innerHTML = `
    <div class="notice-summary" aria-live="polite">Kiểm tra ${store.tasks.length} công việc (${open} đang mở), ${store.petitions.length} đơn thư và ${store.reflections.length} phản ánh. Chỉ đọc, không tự sửa.</div>
    ${sections.join('')}`;
}

export function initHealth() {
  $('#health-body').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-open]');
    if (!btn) return;
    if (btn.dataset.open === 'petition') openPetition(btn.dataset.id);
    else openTask(btn.dataset.id);
  });
}
