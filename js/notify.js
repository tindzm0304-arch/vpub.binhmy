/* Trung tâm thông báo: nhắc hạn công việc, đơn thư, phản ánh, báo cáo BTV; báo lãnh đạo khi quá hạn lâu;
   lịch hôm nay / ngày mai; báo cáo định kỳ. Có thể bật thông báo trên màn hình máy tính
   (khi ứng dụng đang mở) và sao chép bản tin nhắc việc theo phòng để gửi nhóm Zalo. */
import {
  store, effectiveStatus, deptName, sortedDepartments, tasksOf, personById, PETITION_CLOSED, REFLECTION_CLOSED,
} from './store.js';
import { getSettings } from './settings.js';
import { daysBetween } from './stats.js';
import { areaSpikes, staleTasks } from './insight.js';
import { reportState, openBtvDetail } from './views/btv.js';
import { openTaskDetail } from './views/tasks.js';
import { openPetitionDetail } from './views/petitions.js';
import { openReflectionDetail } from './views/reflections.js';
import { openEventDetail } from './views/calendar.js';
import { openReport } from './views/reports.js';
import {
  $, $$, esc, dateKey, addDays, formatDate, periodBounds, parseDateKey, toast, CLOSED, REVIEW,
} from './utils.js';

const SENSITIVE_TYPES = ['Khiếu nại', 'Tố cáo'];
const DAY_MS = 86400000;

const READ_KEY = 'quan-ly-noi-bo:notify-read';
const PUSHED_KEY = 'quan-ly-noi-bo:notify-pushed';
const CHECK_MS = 5 * 60 * 1000;
const LEVEL_ORDER = { danger: 0, warn: 1, info: 2 };
const GROUPS = [
  ['urgent', 'Cần xử lý ngay'],
  ['due', 'Sắp đến hạn'],
  ['other', 'Lịch và nhắc nhở'],
];

let filter = 'unread';
let current = [];

/* ---------------- Lưu trạng thái đã đọc / đã đẩy ---------------- */

function readMap(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') ?? {};
  } catch {
    return {};
  }
}
function writeMap(key, map) {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    /* Không lưu được: chỉ ảnh hưởng trạng thái đã đọc */
  }
}

/* ---------------- Thu thập thông báo ---------------- */

/** Mức nhắc theo số ngày còn lại tới hạn (âm là đã quá hạn). */
function dueLevel(days, lead, escalate) {
  if (days < 0) {
    const n = -days;
    return n >= escalate
      ? { bucket: 'escalate', level: 'danger', group: 'urgent', label: `Quá hạn ${n} ngày · cần báo cáo lãnh đạo` }
      : { bucket: 'overdue', level: 'danger', group: 'urgent', label: `Quá hạn ${n} ngày` };
  }
  if (days === 0) return { bucket: 'today', level: 'warn', group: 'urgent', label: 'Đến hạn hôm nay' };
  if (days === 1) return { bucket: 'tomorrow', level: 'warn', group: 'due', label: 'Đến hạn ngày mai' };
  if (days <= lead) return { bucket: 'soon', level: 'info', group: 'due', label: `Còn ${days} ngày` };
  return null;
}

/** Mở màn hình và hộp chi tiết của mục được thông báo. */
function go(view, open) {
  return () => {
    if (location.hash.slice(1) !== view) location.hash = view;
    open?.();
  };
}

/** Mọi thông báo hiện có, xếp theo mức độ rồi theo hạn. */
export function collectNotices(today = dateKey()) {
  const {
    leadDays, escalateDays, rulePetitionNoTaskDays, ruleReviewDays, staleDays, meId,
  } = getSettings();
  const list = [];
  const dueItem = ({ key, deadline, title, meta, deptId, icon, open, digest = true }) => {
    const level = dueLevel(daysBetween(today, deadline), leadDays, escalateDays);
    if (!level) return;
    list.push({ key: `${key}:${level.bucket}`, ...level, title, meta, deptId, icon, open, digest, sortKey: deadline });
  };

  for (const t of store.tasks) {
    if (CLOSED.includes(effectiveStatus(t, today))) continue;
    const isBtv = t.source === 'btv';
    dueItem({
      key: `task:${t.id}`,
      deadline: t.deadline,
      title: t.title,
      meta: `${isBtv ? 'Giao việc BTV' : 'Giao việc TTUB'} · ${deptName(t.departmentId)} · Hạn ${formatDate(t.deadline)}`,
      deptId: t.departmentId,
      icon: isBtv ? 'fa-stamp' : 'fa-list-check',
      open: isBtv ? go('btv', () => openBtvDetail(t.id)) : go('tasks', () => openTaskDetail(t.id)),
    });
  }

  // Hạn báo cáo Ban Thường vụ (riêng với hạn hoàn thành)
  for (const t of store.tasks) {
    if (t.source !== 'btv' || !t.btv?.reportDue) continue;
    const state = reportState(t, today);
    const days = daysBetween(today, t.btv.reportDue);
    if (state === 'done' || days > leadDays) continue;
    const late = state === 'late';
    list.push({
      key: `btv-report:${t.id}:${late ? 'late' : days}`,
      level: late || days <= 1 ? 'danger' : 'warn',
      group: late || days <= 0 ? 'urgent' : 'due',
      label: late ? `Trễ báo cáo BTV ${-days} ngày` : (days === 0 ? 'Báo cáo BTV hôm nay' : `Báo cáo BTV còn ${days} ngày`),
      title: t.title,
      meta: `${t.btv.resolutionNo || 'Giao việc BTV'} · ${deptName(t.departmentId)} · Hạn báo cáo ${formatDate(t.btv.reportDue)}`,
      deptId: t.departmentId,
      icon: 'fa-stamp',
      open: go('btv', () => openBtvDetail(t.id)),
      digest: true,
      sortKey: t.btv.reportDue,
    });
  }

  for (const p of store.petitions) {
    if (PETITION_CLOSED.includes(p.status)) continue;
    dueItem({
      key: `petition:${p.id}`,
      deadline: p.deadline,
      title: `${p.type} ${p.code}`,
      meta: `Đơn thư · ${deptName(p.deptId)} · Hạn ${formatDate(p.deadline)}`,
      deptId: p.deptId,
      icon: 'fa-envelope-open-text',
      open: go('petitions', () => openPetitionDetail(p.id)),
    });
  }

  // Quy tắc: đơn Khiếu nại / Tố cáo đã nhận nhiều ngày mà chưa có công việc xử lý
  if (rulePetitionNoTaskDays > 0) {
    for (const p of store.petitions) {
      if (!SENSITIVE_TYPES.includes(p.type) || PETITION_CLOSED.includes(p.status) || tasksOf(p).length) continue;
      const days = daysBetween(p.receivedAt, today);
      if (days < rulePetitionNoTaskDays) continue;
      list.push({
        key: `rule:petition:${p.id}`,
        level: 'warn',
        group: 'urgent',
        label: `${days} ngày chưa có công việc`,
        title: `${p.type} ${p.code}`,
        meta: `Đơn thư · ${deptName(p.deptId)} · Tiếp nhận ${formatDate(p.receivedAt)}`,
        deptId: p.deptId,
        icon: 'fa-envelope-open-text',
        open: go('petitions', () => openPetitionDetail(p.id)),
        digest: true,
        sortKey: p.receivedAt,
      });
    }
  }

  // Quy tắc: công việc đang chờ duyệt quá số ngày đã đặt
  if (ruleReviewDays > 0) {
    for (const t of store.tasks) {
      if (t.status !== REVIEW) continue;
      const days = Math.floor((Date.now() - (t.updatedAt || t.createdAt || Date.now())) / DAY_MS);
      if (days < ruleReviewDays) continue;
      const isBtv = t.source === 'btv';
      list.push({
        key: `rule:review:${t.id}`,
        level: 'warn',
        group: 'due',
        label: `Chờ duyệt ${days} ngày`,
        title: t.title,
        meta: `${isBtv ? 'Giao việc BTV' : 'Giao việc TTUB'} · ${deptName(t.departmentId)} · Chờ lãnh đạo duyệt`,
        deptId: t.departmentId,
        icon: 'fa-user-check',
        open: isBtv ? go('btv', () => openBtvDetail(t.id)) : go('tasks', () => openTaskDetail(t.id)),
        digest: true,
        sortKey: t.deadline,
      });
    }
  }

  for (const r of store.reflections) {
    if (REFLECTION_CLOSED.includes(r.status)) continue;
    dueItem({
      key: `reflection:${r.id}`,
      deadline: r.deadline,
      title: `Phản ánh ${r.code} – ${r.area}`,
      meta: `Phản ánh 1022 · ${deptName(r.deptId)} · Hạn ${formatDate(r.deadline)}`,
      deptId: r.deptId,
      icon: 'fa-tower-broadcast',
      open: go('reflections', () => openReflectionDetail(r.id)),
    });
  }

  // Lịch họp, sự kiện hôm nay và ngày mai (hạn chót đã có ở trên)
  const tomorrow = addDays(today, 1);
  for (const ev of store.events) {
    const day = ev.start.slice(0, 10);
    if (ev.type === 'Hạn chót' || (day !== today && day !== tomorrow)) continue;
    list.push({
      key: `event:${ev.id}:${day}`,
      level: 'info',
      group: 'other',
      label: `${day === today ? 'Hôm nay' : 'Ngày mai'} ${ev.start.slice(11, 16)}`,
      title: ev.title,
      meta: ev.location || 'Lịch công tác',
      icon: 'fa-regular fa-calendar',
      open: go('calendar', () => openEventDetail(ev.id)),
      digest: false,
      sortKey: ev.start,
    });
  }

  // Việc đứng im: đang mở nhưng không có thay đổi nào trong N ngày
  for (const { task: t, idle } of staleTasks(staleDays)) {
    const isBtv = t.source === 'btv';
    list.push({
      key: `stale:${t.id}`,
      level: 'info',
      group: 'other',
      label: `Chưa cập nhật ${idle} ngày`,
      title: t.title,
      meta: `${isBtv ? 'Giao việc BTV' : 'Giao việc TTUB'} · ${deptName(t.departmentId)} · Hạn ${formatDate(t.deadline)}`,
      deptId: t.departmentId,
      icon: 'fa-hourglass-half',
      open: isBtv ? go('btv', () => openBtvDetail(t.id)) : go('tasks', () => openTaskDetail(t.id)),
      digest: false,
      sortKey: t.deadline,
    });
  }

  // Phản ánh đột biến theo khu vực trong tuần này
  const thisWeek = periodBounds('week', today).from;
  for (const s of areaSpikes(today)) {
    list.push({
      key: `spike:${s.area}:${thisWeek}`,
      level: 'warn',
      group: 'due',
      label: `Phản ánh tăng đột biến · ${s.recent} trong 7 ngày`,
      title: `Khu vực ${s.area}`,
      meta: `Trung bình tuần trước đó: ${s.weeklyAvg} phản ánh · cần kiểm tra nguyên nhân`,
      icon: 'fa-chart-line',
      open: go('reflections'),
      digest: false,
      sortKey: thisWeek,
    });
  }

  // Được nhắc (@họ tên) trong ghi chú công việc trong 14 ngày gần đây
  if (meId) {
    const since = addDays(today, -14);
    for (const t of store.tasks) {
      for (const note of t.notes ?? []) {
        if (!note.mentions?.includes(meId) || note.at.slice(0, 10) < since) continue;
        const author = personById(note.authorId)?.name ?? 'Đồng nghiệp';
        list.push({
          key: `mention:${note.id}`,
          level: 'warn',
          group: 'due',
          label: `${author} nhắc bạn trong ghi chú`,
          title: t.title,
          meta: note.text.slice(0, 120),
          deptId: t.departmentId,
          icon: 'fa-at',
          open: go('tasks', () => openTaskDetail(t.id)),
          digest: false,
          sortKey: note.at,
        });
      }
    }
  }

  // Cán bộ đang vắng mặt: nhắc để người được ủy quyền theo dõi việc
  for (const p of store.personnel) {
    const a = p.absence;
    if (!a?.from || !a?.to || a.from > today || a.to < today) continue;
    list.push({
      key: `absence:${p.id}:${a.from}`,
      level: 'info',
      group: 'other',
      label: `Vắng mặt đến ${formatDate(a.to)}`,
      title: p.name,
      meta: `Ủy quyền: ${personById(a.delegateId)?.name ?? 'chưa chọn người thay thế'}`,
      icon: 'fa-user-clock',
      open: go('automation'),
      digest: false,
      sortKey: a.from,
    });
  }

  const hasData = store.tasks.length + store.petitions.length + store.reflections.length > 0;
  // Báo cáo định kỳ: đầu tuần nhắc báo cáo tuần trước, đầu tháng nhắc báo cáo tháng trước
  const d = parseDateKey(today);
  if (hasData && d.getDay() >= 1 && d.getDay() <= 3) {
    const last = periodBounds('week', addDays(today, -7));
    list.push({
      key: `report:last-week:${last.from}`,
      level: 'info',
      group: 'other',
      label: 'Báo cáo tuần',
      title: `Báo cáo tuần trước (${formatDate(last.from)} – ${formatDate(last.to)}) đã sẵn sàng`,
      meta: 'Số liệu tự tổng hợp, có thể in hoặc xuất Excel',
      icon: 'fa-regular fa-file-lines',
      open: () => openReport('last-week'),
      digest: false,
      sortKey: '~',
    });
  }
  if (hasData && d.getDate() <= 5) {
    list.push({
      key: `report:last-month:${d.getFullYear()}-${d.getMonth()}`,
      level: 'info',
      group: 'other',
      label: 'Báo cáo tháng',
      title: `Báo cáo tháng ${d.getMonth() === 0 ? 12 : d.getMonth()} đã sẵn sàng`,
      meta: 'Số liệu tự tổng hợp, có thể in hoặc xuất Excel',
      icon: 'fa-regular fa-file-lines',
      open: () => openReport('last-month'),
      digest: false,
      sortKey: '~',
    });
  }

  return list.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.sortKey.localeCompare(b.sortKey));
}

/* ---------------- Bảng thông báo ---------------- */

const iconClass = (icon) => (icon.startsWith('fa-regular') || icon.startsWith('fa-solid') ? icon : `fa-solid ${icon}`);

function renderPanel() {
  const read = readMap(READ_KEY);
  const shown = filter === 'unread' ? current.filter((n) => !read[n.key]) : current;
  const unread = current.filter((n) => !read[n.key]).length;

  const badge = $('#notify-count');
  badge.hidden = unread === 0;
  badge.textContent = unread > 99 ? '99+' : unread;
  $('#notify-toggle').setAttribute('aria-label', unread ? `Thông báo: ${unread} chưa đọc` : 'Thông báo');
  for (const btn of $$('[data-nf]')) btn.setAttribute('aria-pressed', String(btn.dataset.nf === filter));

  $('#notify-list').innerHTML = shown.length
    ? GROUPS.map(([group, title]) => {
      const items = shown.filter((n) => n.group === group);
      if (!items.length) return '';
      return `
        <p class="notify-group">${esc(title)} <span>${items.length}</span></p>
        ${items.map((n) => `
          <button type="button" class="notify-item lvl-${n.level} ${read[n.key] ? 'is-read' : ''}" data-key="${esc(n.key)}">
            <span class="notify-ico"><i class="${iconClass(n.icon)}"></i></span>
            <span class="notify-body">
              <span class="notify-label">${esc(n.label)}</span>
              <b>${esc(n.title)}</b>
              <small>${esc(n.meta)}</small>
            </span>
          </button>`).join('')}`;
    }).join('')
    : `<div class="notify-empty"><i class="fa-regular fa-bell-slash"></i><p>${filter === 'unread' ? 'Không có thông báo chưa đọc' : 'Không có thông báo'}</p></div>`;
}

export function refreshNotices() {
  current = collectNotices();
  // Bỏ trạng thái đã đọc của thông báo không còn tồn tại, để danh sách lưu không phình ra
  const read = readMap(READ_KEY);
  const live = new Set(current.map((n) => n.key));
  const kept = Object.fromEntries(Object.entries(read).filter(([key]) => live.has(key)));
  if (Object.keys(kept).length !== Object.keys(read).length) writeMap(READ_KEY, kept);
  renderPanel();
}

function markRead(keys) {
  const read = readMap(READ_KEY);
  for (const key of keys) read[key] = true;
  writeMap(READ_KEY, read);
  renderPanel();
}

function setOpen(open) {
  $('#notify-panel').hidden = !open;
  $('#notify-toggle').setAttribute('aria-expanded', String(open));
  if (open) renderPanel();
}

/* ---------------- Bản tin nhắc việc (dán vào Zalo, tin nhắn) ---------------- */

export function digestText(today = dateKey()) {
  const items = current.filter((n) => n.digest);
  if (!items.length) return '';
  const depts = [...sortedDepartments(), { id: null, name: 'Chưa phân phòng' }];
  const lines = [`NHẮC VIỆC NGÀY ${formatDate(today)} — UBND Xã Bình Mỹ`];
  const overdue = items.filter((n) => n.level === 'danger').length;
  lines.push(`Tổng: ${items.length} mục, trong đó ${overdue} mục quá hạn hoặc cần xử lý gấp.`);
  for (const d of depts) {
    const own = items.filter((n) => (n.deptId ?? null) === d.id);
    if (!own.length) continue;
    lines.push('', `▪ ${d.name} (${own.length})`);
    for (const n of own) lines.push(`  - [${n.label}] ${n.title} — ${n.meta.split(' · ').slice(-1)[0]}`);
  }
  return lines.join('\n');
}

export async function copyDigest() {
  const text = digestText();
  if (!text) {
    toast('Không có việc nào cần nhắc', 'info');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  toast('Đã sao chép bản tin nhắc việc — dán vào nhóm Zalo hoặc tin nhắn', 'success');
}

/* ---------------- Thông báo trên màn hình máy tính ---------------- */

export const desktopSupported = () => 'Notification' in window;

/** Đẩy thông báo hệ điều hành cho mục quá hạn / đến hạn chưa từng đẩy (tối đa 3 mục, còn lại gộp một thông báo). */
function pushDesktop() {
  if (!getSettings().desktopNotify || !desktopSupported() || Notification.permission !== 'granted') return;
  const pushed = readMap(PUSHED_KEY);
  const read = readMap(READ_KEY);
  const fresh = current.filter((n) => n.level !== 'info' && !pushed[n.key] && !read[n.key]);
  if (!fresh.length) return;
  const today = dateKey();
  const show = (title, body, onClick) => {
    const note = new Notification(title, { body, tag: title, icon: document.querySelector('link[rel="icon"]')?.href });
    note.onclick = () => {
      window.focus();
      onClick?.();
      note.close();
    };
  };
  for (const n of fresh.slice(0, 3)) show(n.label, `${n.title}\n${n.meta}`, n.open);
  if (fresh.length > 3) show(`Còn ${fresh.length - 3} mục cần chú ý`, 'Mở bảng thông báo để xem chi tiết', () => setOpen(true));
  for (const n of fresh) pushed[n.key] = today;
  // Giữ 60 ngày gần nhất
  const cutoff = addDays(today, -60);
  writeMap(PUSHED_KEY, Object.fromEntries(Object.entries(pushed).filter(([, day]) => day >= cutoff)));
}

/** Hiện thử một thông báo. Trả về false nếu trình duyệt chưa được cấp quyền. */
export function testDesktopNotice() {
  if (!desktopSupported() || Notification.permission !== 'granted') return false;
  new Notification('Quản lý Nội bộ', { body: 'Thông báo trên màn hình đã hoạt động.' });
  return true;
}

/* ---------------- Khởi tạo ---------------- */

export function initNotify() {
  $('#notify-toggle').addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen($('#notify-panel').hidden);
  });
  document.addEventListener('click', (e) => {
    if (!$('#notify-panel').hidden && !e.target.closest('.notify-wrap')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#notify-panel').hidden) {
      setOpen(false);
      $('#notify-toggle').focus();
    }
  });
  for (const btn of $$('[data-nf]')) {
    btn.addEventListener('click', () => {
      filter = btn.dataset.nf;
      renderPanel();
    });
  }
  $('#notify-list').addEventListener('click', (e) => {
    const item = e.target.closest('[data-key]');
    const notice = item && current.find((n) => n.key === item.dataset.key);
    if (!notice) return;
    markRead([notice.key]);
    setOpen(false);
    notice.open();
  });
  $('#notify-read-all').addEventListener('click', () => markRead(current.map((n) => n.key)));
  $('#notify-digest').addEventListener('click', copyDigest);

  const update = () => {
    refreshNotices();
    pushDesktop();
  };
  window.addEventListener('store:change', update);
  window.addEventListener('settings:change', update);
  setInterval(update, CHECK_MS);
  update();
}
