/* Màn hình Lịch công tác: xem theo tháng/tuần, tạo–sửa–xóa sự kiện, chi tiết sự kiện. */
import {
  store, eventById, taskById, petitionById, reflectionById, personById, persist, removeEvent, deptName,
} from '../store.js';
import { openModal, closeModal, confirmDialog } from '../modal.js';
import { openTaskDetail } from './tasks.js';
import { rememberRecent } from '../recent.js';
import {
  $, $$, esc, uid, dateKey, addDays, addHours, parseDateKey, formatDateTime, avatar, toast, CLOSED,
} from '../utils.js';

let mode = 'month';
let cursor = startOfDay(new Date());
let formEventId = null;
let detailEventId = null;

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/* ---------------- Khởi tạo ---------------- */

export function initCalendar() {
  for (const btn of $$('[data-cal]')) {
    btn.addEventListener('click', () => {
      if (btn.dataset.cal === 'today') cursor = startOfDay(new Date());
      else shiftCursor(btn.dataset.cal === 'next' ? 1 : -1);
      renderCalendar();
    });
  }
  for (const btn of $$('[data-cal-view]')) {
    btn.addEventListener('click', () => {
      mode = btn.dataset.calView;
      renderCalendar();
    });
  }

  $('#event-new').addEventListener('click', () => openEventForm());
  $('#calendar-grid').addEventListener('click', onGridClick);
  $('#calendar-grid').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-date]')) openEventForm(null, e.target.dataset.date);
  });

  $('#event-form').addEventListener('submit', submitEventForm);
  $('#event-start').addEventListener('change', () => {
    const start = $('#event-start').value;
    const end = $('#event-end').value;
    if (start && (!end || end <= start)) $('#event-end').value = addHours(start, 1);
  });
  $('#event-detail-actions').addEventListener('click', onDetailAction);
}

function shiftCursor(direction) {
  if (mode === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
  else cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + direction * 7);
}

/* ---------------- Render lưới ---------------- */

function monthDays(base) {
  const first = new Date(base.getFullYear(), base.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // tuần bắt đầu từ thứ Hai
  return Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), 1 - offset + i));
}

function weekDays(base) {
  const offset = (base.getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => new Date(base.getFullYear(), base.getMonth(), base.getDate() - offset + i));
}

const dayMonth = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
const longLabel = (d) => d.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export function renderCalendar() {
  const days = mode === 'month' ? monthDays(cursor) : weekDays(cursor);
  const last = days[days.length - 1];
  $('#calendar-title').textContent = mode === 'month'
    ? `Tháng ${cursor.getMonth() + 1} / ${cursor.getFullYear()}`
    : `${dayMonth(days[0])} – ${dayMonth(last)}/${last.getFullYear()}`;

  $$('[data-cal-view]').forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.calView === mode)));

  const byDay = new Map();
  for (const ev of store.events) {
    if (isDone(ev)) continue;
    const key = ev.start.slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(ev);
  }

  const today = dateKey();
  const limit = mode === 'month' ? 3 : Infinity;
  const grid = $('#calendar-grid');
  grid.classList.toggle('is-week', mode === 'week');
  grid.innerHTML = days.map((day) => {
    const key = dateKey(day);
    const list = (byDay.get(key) ?? []).sort((a, b) => a.start.localeCompare(b.start));
    const classes = ['cal-cell'];
    if (mode === 'month' && day.getMonth() !== cursor.getMonth()) classes.push('is-muted');
    if (day.getDay() === 0 || day.getDay() === 6) classes.push('is-weekend');
    if (key === today) classes.push('is-today');
    const more = list.length > limit
      ? `<button type="button" class="ev-more" data-more="${key}">+${list.length - limit} sự kiện</button>`
      : '';
    return `
      <div class="${classes.join(' ')}" data-date="${key}" tabindex="0" aria-label="${esc(longLabel(day))}">
        <span class="day-num">${day.getDate()}</span>
        ${list.slice(0, limit).map(eventChip).join('')}
        ${more}
      </div>`;
  }).join('');
}

/** Việc / đơn / phản ánh đã đóng thì không hiện trên lịch. */
function isDone(ev) {
  if (ev.taskId) return CLOSED.includes(taskById(ev.taskId)?.status);
  const item = itemOf(ev);
  return Boolean(item) && CLOSED.includes(item.record.status);
}

function eventChip(ev) {
  const kind = ev.type === 'Hạn chót' ? 'ev-deadline' : '';
  return `
    <button type="button" class="ev ${kind}" data-event="${esc(ev.id)}" title="${esc(ev.title)}">
      <span class="ev-time">${ev.start.slice(11, 16)}</span>
      <span class="ev-title">${esc(ev.title)}</span>
    </button>`;
}

function onGridClick(e) {
  const eventBtn = e.target.closest('[data-event]');
  if (eventBtn) return openEventDetail(eventBtn.dataset.event);
  const more = e.target.closest('[data-more]');
  if (more) {
    cursor = parseDateKey(more.dataset.more);
    mode = 'week';
    renderCalendar();
    return undefined;
  }
  const cell = e.target.closest('[data-date]');
  if (cell) openEventForm(null, cell.dataset.date);
  return undefined;
}

/* ---------------- Form sự kiện ---------------- */

export function openEventForm(id = null, dateStr = null) {
  const ev = id ? eventById(id) : null;
  formEventId = ev?.id ?? null;
  $('#event-form').reset();

  $('#event-attendees').innerHTML = store.personnel.length
    ? store.personnel.map((p) => `
        <label class="check-item">
          <input type="checkbox" name="attendee" value="${esc(p.id)}" ${ev?.attendeeIds.includes(p.id) ? 'checked' : ''}>
          <span>${esc(p.name)}<small>${esc(deptName(p.deptId))}</small></span>
        </label>`).join('')
    : '<p class="muted">Chưa có cán bộ nào trong danh sách.</p>';

  if (ev) {
    $('#event-title').value = ev.title;
    $('#event-start').value = ev.start;
    $('#event-end').value = ev.end;
    $('#event-location').value = ev.location || '';
    $('#event-desc').value = ev.desc || '';
  } else {
    const start = dateStr ? `${dateStr}T08:00` : `${addDays(dateKey(), 1)}T08:00`;
    $('#event-start').value = start;
    $('#event-end').value = addHours(start, 2);
  }

  $('#event-modal-title').textContent = ev ? 'Cập nhật lịch công tác' : 'Thêm lịch công tác';
  $('#event-submit').innerHTML = ev
    ? '<i class="fa-solid fa-check"></i> Lưu cập nhật'
    : '<i class="fa-solid fa-floppy-disk"></i> Lưu lịch';
  openModal('event-modal');
}

function submitEventForm(e) {
  e.preventDefault();
  const title = $('#event-title').value.trim();
  const start = $('#event-start').value;
  const end = $('#event-end').value;
  if (!title || !start || !end) return;
  if (end < start) {
    toast('Thời gian kết thúc phải sau thời gian bắt đầu', 'error');
    return;
  }

  const fields = {
    title,
    start,
    end,
    location: $('#event-location').value.trim(),
    desc: $('#event-desc').value.trim(),
    attendeeIds: $$('input[name="attendee"]:checked', $('#event-attendees')).map((input) => input.value),
  };

  const existing = eventById(formEventId);
  if (existing) {
    Object.assign(existing, fields);
    toast('Đã cập nhật lịch', 'success');
  } else {
    store.events.push({ id: uid(), type: 'Sự kiện', taskId: null, ...fields });
    toast('Đã lưu lịch công tác', 'success');
  }
  cursor = startOfDay(parseDateKey(start.slice(0, 10)));
  persist();
  closeModal('event-modal');
}

/* ---------------- Chi tiết sự kiện ---------------- */

export function openEventDetail(id) {
  const ev = eventById(id);
  if (!ev) return;
  detailEventId = ev.id;
  rememberRecent({ kind: 'events', id: ev.id, title: ev.title });
  const linkedTask = ev.taskId ? taskById(ev.taskId) : null;
  const linkedItem = itemOf(ev);
  const isDeadline = ev.type === 'Hạn chót';

  $('#event-detail-title').textContent = isDeadline ? 'Hạn chót công việc' : 'Chi tiết lịch công tác';
  const type = $('#event-detail-type');
  type.className = `badge ${isDeadline ? 'badge-deadline' : 'badge-doing'}`;
  type.textContent = isDeadline ? 'Hạn chót · đồng bộ' : 'Sự kiện';
  $('#event-detail-name').textContent = ev.title;
  $('#event-detail-start').textContent = formatDateTime(ev.start);
  $('#event-detail-end').textContent = formatDateTime(ev.end);
  $('#event-detail-location').textContent = ev.location || 'Chưa có địa điểm';
  $('#event-detail-desc').textContent = ev.desc || 'Không có ghi chú.';

  const people = ev.attendeeIds.map((pid) => personById(pid)).filter(Boolean);
  $('#event-detail-attendees').innerHTML = people.length
    ? people.map((p) => `<span class="chip-person">${avatar(p, 'sm')}${esc(p.name)}</span>`).join('')
    : '<span class="muted">Chưa có thành phần tham dự</span>';

  $('#event-detail-actions').innerHTML = linkedItem
    ? `<span class="chip"><i class="fa-solid fa-link"></i> Đồng bộ từ ${esc(linkedItem.source)}</span>
       <div class="btn-group">
         <button type="button" class="btn btn-danger-ghost" data-action="delete"><i class="fa-regular fa-trash-can"></i> Gỡ lịch</button>
       </div>`
    : linkedTask
    ? `<span class="chip"><i class="fa-solid fa-link"></i> Đồng bộ từ Giao việc</span>
       <div class="btn-group">
         <button type="button" class="btn btn-danger-ghost" data-action="delete"><i class="fa-regular fa-trash-can"></i> Gỡ lịch</button>
         <button type="button" class="btn btn-primary" data-action="open-task"><i class="fa-solid fa-arrow-up-right-from-square"></i> Mở công việc</button>
       </div>`
    : `<button type="button" class="btn btn-danger-ghost" data-action="delete"><i class="fa-regular fa-trash-can"></i> Xóa</button>
       <div class="btn-group">
         <button type="button" class="btn btn-secondary" data-close="event-detail-modal">Đóng</button>
         <button type="button" class="btn btn-primary" data-action="edit"><i class="fa-solid fa-pen-to-square"></i> Chỉnh sửa</button>
       </div>`;

  openModal('event-detail-modal');
}

async function onDetailAction(e) {
  const btn = e.target.closest('[data-action]');
  const ev = eventById(detailEventId);
  if (!btn || !ev) return;

  if (btn.dataset.action === 'edit') {
    closeModal('event-detail-modal');
    openEventForm(ev.id);
  } else if (btn.dataset.action === 'open-task') {
    closeModal('event-detail-modal');
    openTaskDetail(ev.taskId);
  } else if (btn.dataset.action === 'delete') {
    const item = itemOf(ev);
    const linked = Boolean(ev.taskId) || Boolean(item);
    const ok = await confirmDialog({
      title: linked ? 'Gỡ lịch đồng bộ?' : 'Xóa lịch này?',
      message: linked
        ? `"${ev.title}" sẽ bị gỡ khỏi Lịch công tác. ${item ? 'Đơn / phản ánh vẫn được giữ nguyên.' : 'Công việc vẫn được giữ nguyên.'}`
        : `"${ev.title}" sẽ bị xóa khỏi Lịch công tác.`,
      confirmText: linked ? 'Gỡ lịch' : 'Xóa lịch',
    });
    if (!ok) return;
    if (item) {
      // Tắt đồng bộ ở đơn / phản ánh; lần lưu sau sẽ tự gỡ sự kiện
      item.record.calendarSync = false;
      persist();
      toast('Đã gỡ lịch đồng bộ', 'success');
    } else {
      removeEvent(ev.id); // vào thùng rác, có nút hoàn tác
    }
    closeModal('event-detail-modal');
  }
}

/** Đơn thư hoặc phản ánh mà sự kiện được đồng bộ từ đó (null nếu không có). */
function itemOf(ev) {
  if (!ev.itemRef) return null;
  const [kind, id] = ev.itemRef.split(':');
  if (kind === 'petition') {
    const record = petitionById(id);
    return record ? { record, source: 'Đơn thư' } : null;
  }
  const record = reflectionById(id);
  return record ? { record, source: 'Phản ánh 1022' } : null;
}
