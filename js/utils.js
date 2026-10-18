/* Tiện ích dùng chung: DOM, ngày giờ, định dạng, thông báo. */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export const DEPARTMENTS = ['Lãnh đạo', 'Văn phòng HĐND và UBND', 'Phòng Kinh tế', 'Phòng Văn hóa - Xã hội', 'Khác'];
export const TITLES = ['Chủ tịch', 'Phó Chủ tịch', 'Chánh Văn phòng', 'Chuyên viên', 'Nhân viên'];
export const PRIORITIES = ['Cao', 'Trung bình', 'Thấp'];
/* Bốn trạng thái chung của công việc, đơn thư, phản ánh, giao việc BTV. "Sắp đến hạn" và "Quá hạn" tự tính theo hạn chót.
   "Lưu hồ sơ" đã bỏ khỏi danh sách chọn; mục cũ mang trạng thái này được chuyển thành "Hoàn thành" khi tải dữ liệu (xem migrate trong store.js). */
export const TODO = 'Chưa thực hiện';
export const SOON = 'Sắp đến hạn';
export const OVERDUE = 'Quá hạn';
export const DONE = 'Hoàn thành';
export const FILED = 'Lưu hồ sơ';
export const STATUSES = [TODO, SOON, OVERDUE, DONE];
/** Trạng thái người dùng tự chọn; hai trạng thái còn lại do hạn chót quyết định. */
export const MANUAL_STATUSES = [TODO, DONE];
export const CLOSED = [DONE, FILED];
export const SOON_DAYS = 2;
/* Chờ duyệt: chỉ có khi bật "duyệt trước khi hoàn thành" trong cài đặt (công việc). */
export const REVIEW = 'Chờ duyệt';
/** Các lựa chọn cho ô trạng thái: luôn có ba lựa chọn tay; thêm trạng thái hiện tại nếu là trạng thái tự tính. */
export const statusChoices = (current) => (!current || MANUAL_STATUSES.includes(current) ? MANUAL_STATUSES : [...MANUAL_STATUSES, current]);

const pad = (n) => String(n).padStart(2, '0');

/** Escape HTML để nội dung người dùng nhập không thể chèn mã. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Chuỗi viết thường, bỏ dấu — tìm kiếm tiếng Việt không phân biệt dấu. */
export function fold(text = '') {
  return String(text)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase();
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------- Ngày giờ (theo múi giờ địa phương, không dùng toISOString) ---------- */
export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
export function timeKey(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function dateTimeKey(date = new Date()) {
  return `${dateKey(date)}T${timeKey(date)}`;
}
export function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function parseDateTime(value) {
  const [day, time = '00:00'] = value.split('T');
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
}
export function addDays(key, days) {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}
export function addHours(value, hours) {
  const d = parseDateTime(value);
  d.setHours(d.getHours() + hours);
  return dateTimeKey(d);
}
export function formatDate(key) {
  if (!key) return '—';
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
}
export function formatDateTime(value) {
  if (!value) return '—';
  const [day, time] = value.split('T');
  return `${time} · ${formatDate(day)}`;
}
export function formatLongDate(date) {
  return date.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/* ---------- Bộ lọc mốc thời gian: tuần, tháng, quý hoặc tùy chọn ---------- */
export const PERIOD_OPTIONS = [
  ['all', 'Mọi thời gian'], ['week', 'Tuần này'], ['month', 'Tháng này'], ['quarter', 'Quý này'], ['custom', 'Tùy chọn'],
];

/** Khoảng [from, to] của tuần (từ thứ Hai), tháng hoặc quý chứa ngày `today`. Rỗng nghĩa là không giới hạn. */
export function periodBounds(period, today = dateKey()) {
  const d = parseDateKey(today);
  const y = d.getFullYear();
  if (period === 'week') {
    const from = addDays(today, -((d.getDay() + 6) % 7));
    return { from, to: addDays(from, 6) };
  }
  if (period === 'month') {
    return { from: dateKey(new Date(y, d.getMonth(), 1)), to: dateKey(new Date(y, d.getMonth() + 1, 0)) };
  }
  if (period === 'quarter') {
    const start = Math.floor(d.getMonth() / 3) * 3;
    return { from: dateKey(new Date(y, start, 1)), to: dateKey(new Date(y, start + 3, 0)) };
  }
  return { from: '', to: '' };
}

/** Ngày `key` nằm trong khoảng [from, to]; khoảng rỗng thì không lọc. */
export function inRange(key, { from, to }) {
  if (!from && !to) return true;
  if (!key) return false;
  return (!from || key >= from) && (!to || key <= to);
}

/**
 * Gắn bộ lọc mốc thời gian vào `select`; chọn "Tùy chọn" thì hiện ô từ–đến (điền sẵn khoảng của mốc vừa chọn).
 * `onChange` chạy khi mốc hoặc khoảng đổi. Trả về `bounds()` để đọc khoảng hiện tại.
 */
export function wirePeriodFilter({ select, range, from, to, onChange }) {
  fillOptions(select, PERIOD_OPTIONS);
  let previous = select.value;
  select.addEventListener('change', () => {
    const custom = select.value === 'custom';
    range.hidden = !custom;
    if (custom && previous !== 'custom') {
      const b = periodBounds(previous);
      from.value = b.from;
      to.value = b.to;
    }
    previous = select.value;
    onChange();
  });
  for (const el of [from, to]) {
    el.addEventListener('input', onChange);
    el.addEventListener('change', onChange);
  }
  range.hidden = select.value !== 'custom';
  return {
    bounds: () => (select.value === 'custom' ? { from: from.value, to: to.value } : periodBounds(select.value)),
  };
}

/**
 * Thẻ KPI bấm được (`data-kpi-filter="giá trị"`) trong `section`: bấm thẻ thì đặt `select` theo giá trị của thẻ
 * và chạy lại danh sách qua sự kiện `change`; các bộ lọc khác giữ nguyên. Bấm lại thẻ đang chọn để về "all".
 * Thẻ đang khớp bộ lọc có `aria-pressed="true"`. `scrollTo` (nếu có) được cuộn tới sau khi lọc.
 */
export function wireKpiFilter(section, select, scrollTo = null) {
  const buttons = $$('[data-kpi-filter]', section);
  const sync = () => {
    for (const btn of buttons) btn.setAttribute('aria-pressed', String(btn.dataset.kpiFilter === select.value));
  };
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      const value = btn.dataset.kpiFilter;
      select.value = select.value === value ? 'all' : value;
      select.dispatchEvent(new Event('change'));
      scrollTo?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  select.addEventListener('change', sync);
  sync();
}

/* ---------- Tệp đính kèm ---------- */
export function formatBytes(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${Number((bytes / 1024 ** i).toFixed(1))} ${units[i]}`;
}

export function fileMeta(type = '', name = '') {
  const lower = name.toLowerCase();
  if (type === 'application/pdf' || lower.endsWith('.pdf')) return { icon: 'fa-file-pdf', cls: 'ft-pdf' };
  if (type.startsWith('image/')) return { icon: 'fa-file-image', cls: 'ft-img' };
  if (type.includes('word') || /\.docx?$/.test(lower)) return { icon: 'fa-file-word', cls: 'ft-doc' };
  if (type.includes('sheet') || type.includes('excel') || /\.xlsx?$/.test(lower)) return { icon: 'fa-file-excel', cls: 'ft-xls' };
  if (type.includes('presentation') || /\.pptx?$/.test(lower)) return { icon: 'fa-file-powerpoint', cls: 'ft-ppt' };
  return { icon: 'fa-file-lines', cls: 'ft-other' };
}

/** Một dòng tệp; `actions` là HTML nút bấm, `attrs` là thuộc tính gắn thêm cho dòng. */
export function fileItem(file, actions = '', attrs = '') {
  const meta = fileMeta(file.type, file.name);
  const note = file.sample ? ' · tệp mẫu' : '';
  return `
    <div class="file-item" ${attrs}>
      <span class="file-icon ${meta.cls}"><i class="fa-solid ${meta.icon}"></i></span>
      <div class="file-info">
        <span class="file-name" title="${esc(file.name)}">${esc(file.name)}</span>
        <span class="file-size">${formatBytes(file.size)}${note}</span>
      </div>
      ${actions ? `<div class="file-actions">${actions}</div>` : ''}
    </div>`;
}

/* ---------- Người, nhãn, ô chọn ---------- */
export function initial(name = '') {
  return (name.trim().charAt(0) || '?').toUpperCase();
}
export function avatarTone(seed = '') {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return `av-${hash % 6}`;
}
export function avatar(person, size = '') {
  if (!person) return `<span class="avatar av-none ${size}" aria-hidden="true"><i class="fa-solid fa-user"></i></span>`;
  return `<span class="avatar ${avatarTone(person.name)} ${size}" aria-hidden="true">${esc(initial(person.name))}</span>`;
}
export function personCell(person) {
  if (!person) {
    return `<div class="person">${avatar(null)}<div class="person-meta"><div class="person-name muted">Chưa phân công</div></div></div>`;
  }
  return `<div class="person">${avatar(person)}<div class="person-meta">
    <div class="person-name">${esc(person.name)}</div>
    <div class="person-sub">${esc(person.title)}</div>
  </div></div>`;
}

export function statusBadge(status) {
  const map = {
    'Hoàn thành': ['badge-done', 'fa-circle-check'],
    'Lưu hồ sơ': ['badge-done', 'fa-box-archive'],
    'Chờ duyệt': ['badge-review', 'fa-hourglass-half'],
    'Quá hạn': ['badge-overdue', 'fa-circle-exclamation'],
    'Sắp đến hạn': ['badge-deadline', 'fa-hourglass-half'],
    'Chưa thực hiện': ['badge-todo', 'fa-circle'],
  };
  const [cls, icon] = map[status] ?? map['Chưa thực hiện'];
  return `<span class="badge ${cls}"><i class="fa-solid ${icon}"></i>${esc(status)}</span>`;
}

export function priorityBadge(priority) {
  const cls = { Cao: 'prio-high', 'Trung bình': 'prio-mid', Thấp: 'prio-low' }[priority] ?? 'prio-mid';
  const icon = priority === 'Cao' ? '<i class="fa-solid fa-fire"></i>' : '';
  return `<span class="badge ${cls}">${icon}${esc(priority)}</span>`;
}

/** Đổ tuỳ chọn vào thẻ <select>. `items` là chuỗi hoặc cặp [giá trị, nhãn]. */
export function fillOptions(select, items, leading = '') {
  select.innerHTML = leading + items.map((item) => {
    const [value, label = value] = Array.isArray(item) ? item : [item, item];
    return `<option value="${esc(value)}">${esc(label)}</option>`;
  }).join('');
}

/** Nhãn nguồn của công việc: BTV, đơn thư, phản ánh 1022. Công việc nội bộ không có nhãn. */
export function sourceBadge(source) {
  const map = {
    btv: ['src-btv', 'Giao việc BTV'],
    'don-thu': ['src-don', 'Đơn thư'],
    'phan-anh': ['src-pa', 'Phản ánh 1022'],
  };
  const entry = map[source];
  return entry ? `<span class="src-badge ${entry[0]}">${entry[1]}</span>` : '';
}

/* ---------- Thông báo ---------- */
/** Thông báo ngắn. `action` (tùy chọn) là { label, onClick } để hiện nút như "Hoàn tác". */
export function toast(message, type = 'info', action = null) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const icon = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' }[type] ?? 'fa-circle-info';
  el.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${esc(message)}</span>`;
  let timer = null;
  const remove = () => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 300);
  };
  if (action) {
    const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'toast-action', textContent: action.label });
    btn.addEventListener('click', () => {
      clearTimeout(timer);
      action.onClick();
      remove();
    });
    el.append(btn);
  }
  $('#toasts').append(el);
  timer = setTimeout(remove, action ? 6000 : 2800);
}
