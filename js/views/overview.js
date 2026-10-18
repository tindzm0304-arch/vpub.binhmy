/* Tổng hợp hệ thống (giai đoạn 1): chỉ đọc dữ liệu từ các chức năng khác, không ghi dữ liệu.
   Gồm: chỉ số tổng, luồng xử lý, việc cần xử lý ngay (điểm ưu tiên), tiến độ theo phòng, lịch 14 ngày tới. */
import {
  store, effectiveStatus, dueState, tasksOf, deptName, sortedDepartments, PETITION_CLOSED, REFLECTION_CLOSED,
} from '../store.js';
import { reportState } from './btv.js';
import { deptDurations, taskRisk, overloadedDepts } from '../insight.js';
import { drawDonut } from '../donut.js';
import { $, esc, dateKey, addDays, formatDate, parseDateKey, CLOSED, OVERDUE } from '../utils.js';

const SOON_DAYS = 3;
const CALENDAR_DAYS = 14;
const ATTENTION_PAGE_SIZE = 5;
const SENSITIVE_TYPES = ['Khiếu nại', 'Tố cáo'];

/* Đích khi bấm vào thẻ chỉ số: màn hình cần mở, và bộ lọc đặt sẵn (nếu có). */
const TARGETS = {
  tasks: { view: 'tasks', filter: ['#task-status-filter', 'all'] },
  btv: { view: 'btv' },
  'petitions-open': { view: 'petitions', filter: ['#pt-state', 'all'] },
  'reflections-open': { view: 'reflections', filter: ['#pa-state', 'open'] },
  attention: { scrollTo: '#ov-attention' },
};

/** Bấm thẻ chỉ số: mở đúng chức năng với bộ lọc tương ứng, hoặc cuộn tới danh sách cần xử lý. */
export function initOverview() {
  $('#ov-attn-pager').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    attnPage = Number(btn.dataset.page);
    renderAttentionPage();
  });
  $('#view-overview').addEventListener('click', (e) => {
    const card = e.target.closest('[data-go]');
    if (!card) return;
    e.preventDefault();
    const target = TARGETS[card.dataset.go];
    if (target.scrollTo) {
      $(target.scrollTo).closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (target.filter) {
      const [selector, value] = target.filter;
      $(selector).value = value;
    }
    $('#content').scrollTop = 0;
    location.hash = target.view;
  });
}

/* ---------------- Trạng thái chung ---------------- */

/** Công việc: 'closed' | 'overdue' | 'soon' | 'ok'. */
function taskState(task, today) {
  const status = effectiveStatus(task, today);
  if (CLOSED.includes(status)) return 'closed';
  if (status === OVERDUE) return 'overdue';
  return task.deadline <= addDays(today, SOON_DAYS) ? 'soon' : 'ok';
}

const petitionState = (p, today) => dueState(p, PETITION_CLOSED.includes(p.status), today);
const reflectionState = (r, today) => dueState(r, REFLECTION_CLOSED.includes(r.status), today);

/* ---------------- Render ---------------- */

export function renderOverview() {
  const today = dateKey();
  const tasks = store.tasks;
  const openTasks = tasks.filter((t) => taskState(t, today) !== 'closed');
  const openPetitions = store.petitions.filter((p) => petitionState(p, today) !== 'closed');
  const openReflections = store.reflections.filter((r) => reflectionState(r, today) !== 'closed');

  const overdueAll = openTasks.filter((t) => taskState(t, today) === 'overdue').length
    + openPetitions.filter((p) => petitionState(p, today) === 'overdue').length
    + openReflections.filter((r) => reflectionState(r, today) === 'overdue').length;

  renderKpis({ today, openTasks, openPetitions, openReflections, overdueAll });
  renderFlow(today);
  renderAttention(today);
  renderDepartments(today);
  renderCalendar(today);
}

/* Màu theo mức hạn, dùng chung cho các biểu đồ. */
const COLORS = { ok: '#10b981', soon: '#f59e0b', overdue: '#ef4444' };

/** Đếm số mục đang mở theo mức hạn: trong hạn, sắp đến hạn, quá hạn. */
function countStates(list, stateOf, today) {
  const counts = { ok: 0, soon: 0, overdue: 0 };
  for (const item of list) {
    const state = stateOf(item, today);
    if (state in counts) counts[state]++;
  }
  return counts;
}

function renderKpis({ today, openTasks, openPetitions, openReflections, overdueAll }) {
  const isBtv = (t) => t.source === 'btv';
  const ttubCounts = countStates(openTasks.filter((t) => !isBtv(t)), taskState, today);
  const btvCounts = countStates(openTasks.filter(isBtv), taskState, today);
  const petitionCounts = countStates(openPetitions, petitionState, today);
  const reflectionCounts = countStates(openReflections, reflectionState, today);

  const byDueState = (c) => [
    { label: 'Trong hạn', value: c.ok, color: COLORS.ok },
    { label: 'Sắp đến hạn', value: c.soon, color: COLORS.soon },
    { label: 'Quá hạn', value: c.overdue, color: COLORS.overdue },
  ];

  drawDonut('ov-c-ttub', byDueState(ttubCounts), ttubCounts.ok + ttubCounts.soon + ttubCounts.overdue, '');
  drawDonut('ov-c-btv', byDueState(btvCounts), btvCounts.ok + btvCounts.soon + btvCounts.overdue, '');
  drawDonut('ov-c-petitions', byDueState(petitionCounts), openPetitions.length, '');
  drawDonut('ov-c-reflections', byDueState(reflectionCounts), openReflections.length, '');
  drawDonut('ov-c-overdue', [
    { label: 'Giao việc TTUB', value: ttubCounts.overdue, color: '#ef4444' },
    { label: 'Giao việc BTV', value: btvCounts.overdue, color: '#f59e0b' },
    { label: 'Đơn thư', value: petitionCounts.overdue, color: '#f97316' },
    { label: 'Phản ánh', value: reflectionCounts.overdue, color: '#f43f5e' },
  ], overdueAll, 'quá hạn');
}

/** Luồng xử lý: đơn thư và phản ánh (chưa chuyển đơn) từ lúc tiếp nhận đến khi giải quyết. */
function renderFlow(today) {
  const items = [
    ...store.petitions.map((p) => ({ item: p, source: 'petition', closed: PETITION_CLOSED.includes(p.status), state: petitionState(p, today) })),
    ...store.reflections.filter((r) => !r.petitionId).map((r) => ({ item: r, source: 'reflection', closed: REFLECTION_CLOSED.includes(r.status), state: reflectionState(r, today) })),
  ].map((x) => ({ ...x, state: x.closed ? 'closed' : x.state }));
  const pct = (n, base) => (base ? Math.round((n / base) * 100) : 0);
  const intake = items.length;
  const withTask = items.filter(({ item }) => tasksOf(item).length > 0);
  const closed = items.filter((x) => x.closed).length;
  const withTaskOpen = withTask.filter((x) => !x.closed).length;

  const steps = [
    { label: 'Tiếp nhận', value: intake, icon: 'fa-inbox', tone: 'tone-slate', sub: `${intake - withTask.length} chưa có công việc` },
    { label: 'Đã có công việc', value: withTask.length, icon: 'fa-list-check', tone: 'tone-blue', sub: `${withTaskOpen} đang xử lý` },
    { label: 'Đã giải quyết', value: closed, icon: 'fa-circle-check', tone: 'tone-green', sub: `${intake - closed} còn mở` },
  ];
  const conv = [pct(withTask.length, intake), pct(closed, withTask.length)];
  const stepHtml = steps.flatMap((s, i) => [
    `<li class="flow-step ${s.tone}">
       <div class="flow-step-head"><span class="flow-icon"><i class="fa-solid ${s.icon}"></i></span>${esc(s.label)}</div>
       <b class="flow-num">${s.value}</b>
       <small>${esc(s.sub)}</small>
     </li>`,
    i < steps.length - 1
      ? `<li class="flow-conn" aria-hidden="true"><i class="fa-solid fa-arrow-right"></i><span>${conv[i]}%</span></li>`
      : '',
  ]).join('');

  const states = [
    { label: 'Trong hạn', value: items.filter((x) => x.state === 'ok').length, color: COLORS.ok },
    { label: 'Sắp đến hạn', value: items.filter((x) => x.state === 'soon').length, color: COLORS.soon },
    { label: 'Quá hạn', value: items.filter((x) => x.state === 'overdue').length, color: COLORS.overdue },
    { label: 'Đã đóng', value: closed, color: '#94a3b8' },
  ];
  const barLabel = states.map((s) => `${s.label}: ${s.value}`).join(', ');
  const segHtml = states.map((s) => `<span style="--c:${s.color};width:${pct(s.value, intake)}%"></span>`).join('');
  const legendHtml = states.map((s) => `<span style="--c:${s.color}">${esc(s.label)} <b>${s.value}</b></span>`).join('');

  const sourceCard = (label, source) => {
    const list = items.filter((x) => x.source === source);
    const done = list.filter((x) => x.closed).length;
    return `<div class="flow-source"><span>${esc(label)}</span><b>${list.length}</b><small>${done} đã giải quyết · ${list.length - done} đang mở</small></div>`;
  };

  $('#ov-flow').innerHTML = `
    <ol class="flow-steps">${stepHtml}</ol>
    <div class="flow-status">
      <div class="flow-status-head"><span>Tình trạng hạn</span></div>
      <div class="flow-status-bar" role="img" aria-label="${esc(barLabel)}">${segHtml}</div>
      <div class="flow-legend">${legendHtml}</div>
    </div>
    <div class="flow-sources">
      ${sourceCard('Đơn thư', 'petition')}
      ${sourceCard('Phản ánh 1022', 'reflection')}
    </div>`;
}

/** Việc cần xử lý ngay, xếp theo điểm ưu tiên: quá hạn, sắp đến hạn, khiếu nại / tố cáo, ưu tiên cao, chưa có công việc. */
function attentionItems(today) {
  const list = [];
  // Dự báo: công việc có nguy cơ trễ hạn theo lịch sử xử lý của phòng
  const durations = deptDurations(today);

  for (const t of store.tasks) {
    const state = taskState(t, today);
    const btvLate = t.source === 'btv' && reportState(t, today) === 'late';
    const risk = taskRisk(t, today, durations);
    if ((state === 'closed' || state === 'ok') && !btvLate && !risk) continue;
    let score = 0;
    const reasons = [];
    if (state === 'overdue') { score += 40; reasons.push('Quá hạn'); }
    if (state === 'soon') { score += 20; reasons.push('Sắp đến hạn'); }
    if (btvLate) { score += 30; reasons.push('Trễ báo cáo BTV'); }
    if (risk) { score += risk.level === 'high' ? 30 : 15; reasons.push(risk.label); }
    if (t.priority === 'Cao') { score += 10; reasons.push('Ưu tiên cao'); }
    const isBtv = t.source === 'btv';
    list.push({
      score,
      reasons,
      deadline: t.deadline,
      title: t.title,
      meta: `${isBtv ? 'Giao việc BTV' : 'Giao việc TTUB'} · ${deptName(t.departmentId)} · Hạn ${formatDate(t.deadline)}`,
      href: isBtv ? '#btv' : '#tasks',
    });
  }

  // Phòng quá tải: nhiều việc đang mở hơn mức trung bình
  for (const d of overloadedDepts()) {
    list.push({
      score: 25,
      reasons: ['Phòng quá tải'],
      deadline: '',
      title: `${d.name} đang quá tải`,
      meta: `${d.count} việc đang mở, trung bình ${d.avg} việc mỗi phòng`,
      href: '#tasks',
    });
  }

  for (const p of store.petitions) {
    const state = petitionState(p, today);
    if (state !== 'overdue' && state !== 'soon') continue;
    let score = state === 'overdue' ? 40 : 20;
    const reasons = [state === 'overdue' ? 'Quá hạn' : 'Sắp đến hạn'];
    if (SENSITIVE_TYPES.includes(p.type)) { score += 20; reasons.push(p.type); }
    if (!tasksOf(p).length) { score += 10; reasons.push('Chưa có công việc'); }
    list.push({
      score,
      reasons,
      deadline: p.deadline,
      title: `${p.type} ${p.code}${p.citizen?.name ? ` – ${p.citizen.name}` : ''}`,
      meta: `Đơn thư · ${deptName(p.deptId)} · Hạn ${formatDate(p.deadline)}`,
      href: '#petitions',
    });
  }

  for (const r of store.reflections) {
    const state = reflectionState(r, today);
    if (state !== 'overdue' && state !== 'soon') continue;
    let score = state === 'overdue' ? 40 : 20;
    const reasons = [state === 'overdue' ? 'Quá hạn' : 'Sắp đến hạn'];
    if (!tasksOf(r).length) { score += 10; reasons.push('Chưa có công việc'); }
    list.push({
      score,
      reasons,
      deadline: r.deadline,
      title: `Phản ánh ${r.code}${r.area ? ` – ${r.area}` : ''}`,
      meta: `Phản ánh 1022 · ${deptName(r.deptId)} · Hạn ${formatDate(r.deadline)}`,
      href: '#reflections',
    });
  }

  return list.sort((a, b) => b.score - a.score || a.deadline.localeCompare(b.deadline));
}

/* Danh sách cần xử lý đã tính và trang đang xem; đổi trang chỉ vẽ lại, không tính lại. */
let attnList = [];
let attnPage = 1;

function renderAttention(today) {
  attnList = attentionItems(today);
  attnPage = Math.min(attnPage, attentionPageCount()) || 1;
  renderAttentionPage();
}

function attentionPageCount() {
  return Math.max(1, Math.ceil(attnList.length / ATTENTION_PAGE_SIZE));
}

function renderAttentionPage() {
  const list = attnList;
  const pages = attentionPageCount();
  const start = (attnPage - 1) * ATTENTION_PAGE_SIZE;
  $('#ov-attn-count').textContent = list.length ? `${list.length} mục` : '';
  $('#ov-attention').innerHTML = list.slice(start, start + ATTENTION_PAGE_SIZE).map((a) => `
    <li>
      <a class="attn-item" href="${esc(a.href)}">
        <span class="attn-score ${a.score >= 40 ? '' : 'is-warn'}" title="Điểm ưu tiên">${a.score}</span>
        <span class="attn-body">
          <b>${esc(a.title)}</b>
          <small>${esc(a.meta)}</small>
          <span class="attn-reasons">${a.reasons.map((r) => `<span class="chip">${esc(r)}</span>`).join('')}</span>
        </span>
      </a>
    </li>`).join('');
  $('#ov-attn-pager').hidden = pages <= 1;
  $('#ov-attn-pager').innerHTML = `
    <button class="btn btn-secondary btn-sm" type="button" data-page="${attnPage - 1}" ${attnPage <= 1 ? 'disabled' : ''} aria-label="Trang trước">
      <i class="fa-solid fa-chevron-left"></i>
    </button>
    <span class="attn-page-info">Trang ${attnPage} / ${pages}</span>
    <button class="btn btn-secondary btn-sm" type="button" data-page="${attnPage + 1}" ${attnPage >= pages ? 'disabled' : ''} aria-label="Trang sau">
      <i class="fa-solid fa-chevron-right"></i>
    </button>`;
  $('#ov-attention-empty').hidden = list.length > 0;
}

/** Tiến độ theo phòng: phòng xử lý chính là chủ đạo, cột "Phối hợp" đếm công việc mà phòng đang phối hợp. */
function renderDepartments(today) {
  const depts = [...sortedDepartments(), { id: null, name: 'Chưa phân phòng' }];
  const heavy = new Set(overloadedDepts().map((x) => x.id));
  $('#ov-dept-rows').innerHTML = depts.map((d) => {
    const lead = store.tasks.filter((t) => (t.departmentId ?? null) === d.id);
    const leadOpen = lead.filter((t) => taskState(t, today) !== 'closed');
    const overdue = leadOpen.filter((t) => taskState(t, today) === 'overdue').length;
    const done = lead.length - leadOpen.length;
    const collab = d.id
      ? store.tasks.filter((t) => taskState(t, today) !== 'closed' && (t.collabDeptIds ?? []).includes(d.id)).length
      : 0;
    const petitions = store.petitions.filter((p) => (p.deptId ?? null) === d.id && petitionState(p, today) !== 'closed').length;
    const reflections = store.reflections.filter((r) => (r.deptId ?? null) === d.id && reflectionState(r, today) !== 'closed').length;
    const pct = leadOpen.length ? Math.round((overdue / leadOpen.length) * 100) : 0;
    return `
      <tr>
        <td><b>${esc(d.name)}</b>${heavy.has(d.id) ? ' <span class="chip chip-warn">Quá tải</span>' : ''}</td>
        <td>${leadOpen.length}</td>
        <td class="${overdue ? 'ov-danger' : ''}">${overdue}</td>
        <td>${collab}</td>
        <td>${petitions}</td>
        <td>${reflections}</td>
        <td>${done}</td>
        <td><span class="ov-bar" role="img" aria-label="Tỷ lệ quá hạn ${pct}%"><i style="width:${pct}%"></i></span>${leadOpen.length ? `${pct}%` : '—'}</td>
      </tr>`;
  }).join('');
}

/** Lịch 14 ngày tới, lấy từ sự kiện (bao gồm hạn chót công việc được đồng bộ tự động). */
function renderCalendar(today) {
  const last = addDays(today, CALENDAR_DAYS - 1);
  const byDay = new Map();
  for (const ev of [...store.events].sort((a, b) => a.start.localeCompare(b.start))) {
    const key = ev.start.slice(0, 10);
    if (key < today || key > last) continue;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(ev);
  }
  $('#ov-calendar').innerHTML = [...byDay.entries()].map(([key, list]) => `
    <div class="cal-day ${key === today ? 'is-today' : ''}">
      <div class="cal-day-label">
        <b>${esc(parseDateKey(key).toLocaleDateString('vi-VN', { weekday: 'long' }))}</b>
        <small>${formatDate(key)}${key === today ? ' · Hôm nay' : ''}</small>
      </div>
      <div class="cal-items">
        ${list.map((ev) => `
          <div class="cal-item ${ev.type === 'Hạn chót' ? 'is-deadline' : ''}">
            <time>${esc(ev.start.slice(11, 16))}</time>
            <span>${esc(ev.title)}</span>
          </div>`).join('')}
      </div>
    </div>`).join('');
  $('#ov-calendar-empty').hidden = byDay.size > 0;
}
