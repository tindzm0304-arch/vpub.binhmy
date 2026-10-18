/* Cập nhật đồng loạt từ Excel cho 4 chức năng Công việc & tiếp dân: Giao việc BTV, Giao việc TTUB,
   Đơn thư PAKN và Phản ánh 1022.
   Đọc file → tự nhận trang tính, dòng tiêu đề và tên cột → xem trước từng dòng (thêm mới / cập nhật /
   không đổi / lỗi) → ghi vào hệ thống. Ô trống trong Excel không xóa dữ liệu đang có. */
import {
  store, persist, addTimeline, nextCode, syncTaskEvent, deptName, sortedDepartments,
  PETITION_STATUSES, REFLECTION_STATUSES,
} from '../store.js';
import { openModal, closeModal } from '../modal.js';
import { PETITION_TYPES, CHANNELS, DEFAULT_SLA, classify, dueDateFor } from '../classify.js';
import {
  loadXlsx, readWorkbook, detectHeader, normHeader, isBlank, cellText, toDateKey, toFlag, dateCell, downloadWorkbook,
} from '../excel.js';
import {
  $, $$, esc, fold, uid, dateKey, dateTimeKey, addDays, formatDate, fillOptions, toast, PRIORITIES, MANUAL_STATUSES, TODO, DONE,
} from '../utils.js';

/* ---------------- Chuẩn hóa giá trị ---------------- */

const norm = (text) => fold(text ?? '').replace(/\s+/g, ' ').trim();
const sorted = (list = []) => [...list].sort();

/** Gán các trường có giá trị; bỏ qua undefined / null để ô trống không xóa dữ liệu cũ. */
function assignDefined(target, fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) target[key] = value;
  }
  return target;
}

/** Tên trường đã đổi giữa hai ảnh chụp (xem `snapshot` của từng chức năng). */
function diffKeys(before, after) {
  return Object.keys(after).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
}

/**
 * Chọn giá trị chuẩn: trùng hẳn một lựa chọn, hoặc chứa một cụm từ đồng nghĩa (xét theo thứ tự,
 * nên cụm phủ định như "chưa hoàn thành" phải đứng trước "hoàn thành"). Không nhận ra thì trả về null.
 */
function matchOption(text, options, synonyms = []) {
  const t = normHeader(text);
  const exact = options.find((o) => normHeader(o) === t);
  if (exact) return exact;
  for (const [option, words] of synonyms) {
    if (words.some((w) => ` ${t} `.includes(` ${w} `))) return option;
  }
  return null;
}

/* Chữ trong Excel → trạng thái. "Sắp đến hạn" / "Quá hạn" trong file được lưu thành "Chưa thực hiện" (hai trạng thái này tự tính). */
const TASK_STATUS_WORDS = [
  [TODO, ['chua thuc hien', 'chua lam', 'chua trien khai', 'moi giao', 'moi', 'chua hoan thanh', 'chua xong', 'dang', 'gia han', 'trong han', 'sap den han', 'qua han', 'tre han']],
  [DONE, ['hoan thanh', 'xong', 'da thuc hien', 'da xu ly', 'da giai quyet', 'da dong', 'ket thuc', 'luu ho so']],
];
const PETITION_STATUS_WORDS = [
  [TODO, ['tiep nhan', 'moi', 'chua xu ly', 'chua thuc hien', 'chua hoan thanh', 'chua giai quyet', 'dang', 'trong han', 'qua han', 'tre han', 'gia han', 'sap den han']],
  [DONE, ['da giai quyet', 'da dong', 'hoan thanh', 'xong', 'da xu ly', 'da thuc hien', 'da tra loi', 'ket thuc', 'luu ho so']],
];
const REFLECTION_STATUS_WORDS = [
  [DONE, ['da chuyen don', 'chuyen don thu', 'da xu ly', 'hoan thanh', 'xong', 'da dong', 'da giai quyet', 'da tra loi', 'ket thuc', 'luu ho so']],
  [TODO, ['chua hoan thanh', 'dang', 'trong han', 'gia han', 'moi', 'tiep nhan', 'chua xu ly', 'qua han', 'tre han', 'sap den han']],
];
const PRIORITY_WORDS = [
  ['Cao', ['cao', 'khan', 'gap', 'hoa toc', 'quan trong']],
  ['Thấp', ['thap']],
  ['Trung bình', ['trung binh', 'binh thuong', 'tb']],
];
const CHANNEL_WORDS = [
  ['Bưu điện', ['buu dien', 'buu chinh']],
  ['Trực tuyến', ['truc tuyen', 'online', 'email', 'thu dien tu', 'cong thong tin', 'zalo']],
  ['Điện thoại', ['dien thoai']],
  ['Hộp thư góp ý', ['hop thu']],
  ['Trực tiếp', ['truc tiep', 'tiep dan']],
];

/** Loại đơn: lấy loại xuất hiện đầu tiên ("Kiến nghị, Phản ánh" → Kiến nghị). */
function pickType(text) {
  const t = ` ${normHeader(text)} `;
  let best = null;
  let at = Infinity;
  for (const type of PETITION_TYPES) {
    const i = t.indexOf(` ${normHeader(type)} `);
    if (i !== -1 && i < at) {
      best = type;
      at = i;
    }
  }
  return best;
}

/** Số điện thoại bị Excel lưu thành số thì mất số 0 đầu: 912345678 → 0912345678. */
const phoneText = (text) => (text && /^\d{9}$/.test(text) ? `0${text}` : text);

/** Khu vực lấy từ nội dung khi file không có cột Khu vực: "... ấp 13 ..." → "Ấp 13". */
function guessArea(content) {
  const m = (content ?? '').normalize('NFC').match(/(?:^|[^\p{L}])(ấp|thôn|khu phố)\s+(\d{1,3})(?!\d)/iu);
  if (!m) return 'Chưa xác định';
  const kind = m[1].toLowerCase();
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} ${m[2]}`;
}

/**
 * Khớp gần đúng (không có mã): bỏ qua bản ghi đã được dòng trước trong file khớp (`taken`),
 * ưu tiên bản ghi cùng ngày. Nhờ vậy hai đơn cùng họ tên và nội dung vẫn là hai đơn riêng.
 */
function pickFree(list, taken, prefer) {
  const free = list.filter((item) => !taken?.has(item.id));
  return free.find(prefer) ?? free[0] ?? null;
}

function dateWarnings(warnings, { start, end, startLabel, endLabel }) {
  if (start && start > dateKey()) {
    warnings.push(`${startLabel} ${formatDate(start)} ở tương lai — kiểm tra lại ngày/tháng trong Excel`);
  }
  if (start && end && end < start) {
    warnings.push(`${endLabel} ${formatDate(end)} trước ${startLabel.toLowerCase()} ${formatDate(start)}`);
  }
}

/* ---------------- Phòng ban ---------------- */

/** Khóa so khớp tên phòng: "Phòng Hạ tầng xã", "Phòng Hạ Tầng" và "Hạ tầng" là cùng một phòng. */
const deptKey = (name) => normHeader(name).replace(/^phong\s+/, '').replace(/\s+xa$/, '').trim();
const NO_DEPT = new Set(['khong', 'khong co', 'chua', 'chua co']);
const splitNames = (text) => (text ?? '').split(/[;,+\n]/).map((s) => s.trim()).filter(Boolean);

/**
 * Ngữ cảnh của một lần đọc file. Phòng chưa có trong hệ thống được ghi tạm là `new:<khóa>`
 * và chỉ được tạo thật khi bấm cập nhật.
 */
function makeContext(fileName) {
  const newDepts = new Map();
  return {
    fileName,
    newDepts,
    dept(name) {
      const key = deptKey(name);
      if (!key || NO_DEPT.has(key)) return undefined;
      const found = store.departments.find((d) => deptKey(d.name) === key);
      if (found) return found.id;
      if (!newDepts.has(key)) newDepts.set(key, name.trim());
      return `new:${key}`;
    },
    deptLabel(id) {
      if (!id) return 'Chưa phân phòng';
      return id.startsWith('new:') ? `${newDepts.get(id.slice(4))} (mới)` : deptName(id);
    },
  };
}

/** Ô "Phòng xử lý chính" có nhiều phòng (cách nhau bằng ;) thì phòng đầu là xử lý chính, các phòng sau là phối hợp. */
function readDepts(r, ctx) {
  const lead = splitNames(r.text('dept'));
  const extra = [...lead.slice(1), ...splitNames(r.text('collab'))];
  const deptId = lead.length ? ctx.dept(lead[0]) : undefined;
  const collabDeptIds = extra.length
    ? [...new Set(extra.map((n) => ctx.dept(n)))].filter((id) => id && id !== deptId)
    : undefined;
  return { deptId, collabDeptIds };
}

function deptText(ctx, lead, collab = []) {
  const name = ctx.deptLabel(lead);
  return collab.length ? `${name} · +${collab.length} phối hợp` : name;
}

/** Đọc một dòng theo bảng ghép cột; cảnh báo về ô không đọc được được gom vào `warnings`. */
function rowReader(row, map, warnings) {
  const raw = (key) => (map[key] == null ? null : row[map[key]]);
  return {
    raw,
    warn: (message) => warnings.push(message),
    has: (key) => !isBlank(raw(key)),
    text: (key) => cellText(raw(key)) || undefined,
    date(key, label) {
      const value = raw(key);
      if (isBlank(value)) return undefined;
      const k = toDateKey(value);
      if (!k) warnings.push(`Không đọc được ${label} "${cellText(value)}" — bỏ qua ô này`);
      return k || undefined;
    },
    option(key, label, options, words) {
      const value = raw(key);
      if (isBlank(value)) return undefined;
      const picked = matchOption(cellText(value), options, words);
      if (!picked) warnings.push(`Không rõ ${label} "${cellText(value)}" — bỏ qua ô này`);
      return picked ?? undefined;
    },
  };
}

/* ---------------- Cột dùng chung ---------------- */

const DEPT_COL = {
  key: 'dept', label: 'Phòng xử lý chính',
  aliases: ['phong xu ly chinh', 'phong xu ly', 'phong chu tri', 'don vi chu tri', 'chu tri', 'don vi xu ly', 'co quan chu tri', 'phong ban', 'phong', 'don vi'],
  note: 'Tên phòng như trong mục Phòng ban; phòng chưa có sẽ được tạo mới. Ghi nhiều phòng cách nhau bằng dấu ; thì phòng đầu là xử lý chính, các phòng sau là phối hợp.',
};
const COLLAB_COL = {
  key: 'collab', label: 'Phòng phối hợp',
  aliases: ['phong phoi hop', 'don vi phoi hop', 'co quan phoi hop', 'phoi hop'],
  note: 'Nhiều phòng cách nhau bằng dấu ;',
};
const PRIORITY_COL = {
  key: 'priority', label: 'Mức độ ưu tiên', aliases: ['muc do uu tien', 'do uu tien', 'uu tien', 'muc do'], note: PRIORITIES.join(', '),
};
const TASK_STATUS_COL = {
  key: 'status', label: 'Trạng thái', aliases: ['trang thai', 'tinh trang', 'tien do thuc hien', 'tien do'],
  note: `${MANUAL_STATUSES.join(', ')}; hoặc Sắp đến hạn, Quá hạn (tự tính theo hạn chót)`,
};
const PHONE_COL = { key: 'phone', label: 'Số điện thoại', aliases: ['so dien thoai', 'dien thoai', 'sdt', 'so dt'] };
const FIELD_COL = { key: 'field', label: 'Lĩnh vực', aliases: ['linh vuc'], note: 'Ghi tự do. Để trống thì hệ thống gợi ý theo nội dung.' };

/** Hai tên phòng dùng cho dòng ví dụ của file mẫu: ưu tiên các phòng chuyên môn. */
function sampleDepts() {
  const names = sortedDepartments().map((d) => d.name);
  const picks = [...names.filter((n) => /^phòng/i.test(n)), ...names];
  const lead = picks[0] ?? 'Phòng Kinh tế';
  return [lead, picks.find((n) => n !== lead) ?? ''];
}

/* ---------------- Giao việc BTV ---------------- */

const BTV = {
  title: 'Giao việc BTV',
  noun: 'giao việc BTV',
  file: 'mau-cap-nhat-giao-viec-BTV.xlsx',
  match: 'Dòng trùng Số nghị quyết và Nội dung giao việc với hệ thống sẽ được cập nhật, còn lại được thêm mới.',
  defaults: 'Thiếu ngày ban hành thì lấy ngày hôm nay, thiếu hạn báo cáo thì lấy bằng hạn hoàn thành, thiếu mức ưu tiên thì là Cao.',
  required: ['title'],
  keyError: 'Thiếu nội dung giao việc',
  columns: [
    { key: 'resolutionNo', label: 'Số nghị quyết / thông báo', aliases: ['so nghi quyet thong bao', 'so nghi quyet', 'so thong bao', 'so van ban', 'so hieu', 'so ky hieu', 'so nq', 'nghi quyet', 'thong bao', 'van ban'] },
    { key: 'issuedAt', label: 'Ngày ban hành', aliases: ['ngay ban hanh', 'ngay ky', 'ngay van ban', 'ngay nghi quyet'] },
    { key: 'title', label: 'Nội dung giao việc', need: 'Có', aliases: ['noi dung giao viec', 'noi dung', 'nhiem vu', 'ten cong viec', 'cong viec', 'trich yeu', 'tieu de'] },
    { ...DEPT_COL, need: 'Khi thêm mới' },
    COLLAB_COL,
    { key: 'deadline', label: 'Hạn hoàn thành', need: 'Khi thêm mới', aliases: ['han hoan thanh', 'han chot', 'thoi han', 'han xu ly', 'han thuc hien', 'ngay hoan thanh'] },
    { key: 'reportDue', label: 'Hạn báo cáo BTV', aliases: ['han bao cao btv', 'han bao cao', 'ngay bao cao'] },
    PRIORITY_COL,
    TASK_STATUS_COL,
    { key: 'reported', label: 'Đã báo cáo BTV', aliases: ['da bao cao btv', 'da bao cao', 'bao cao btv'], note: 'Ghi "Có", "x" hoặc "Đã báo cáo"; "Chưa" nghĩa là chưa báo cáo.' },
    { key: 'desc', label: 'Ghi chú', aliases: ['ghi chu', 'mo ta', 'chi tiet', 'noi dung chi tiet'] },
  ],
  example() {
    const [lead, other] = sampleDepts();
    const today = dateKey();
    return {
      resolutionNo: '05-NQ/BTV', issuedAt: dateCell(addDays(today, -3)),
      title: 'Triển khai Nghị quyết về thu ngân sách quý IV', dept: lead, collab: other,
      deadline: dateCell(addDays(today, 14)), reportDue: dateCell(addDays(today, 7)),
      priority: 'Cao', status: 'Chưa thực hiện', reported: 'Chưa', desc: 'Báo cáo tiến độ theo kế hoạch',
    };
  },
  parse(r, ctx) {
    const { deptId, collabDeptIds } = readDepts(r, ctx);
    return {
      resolutionNo: r.text('resolutionNo'),
      issuedAt: r.date('issuedAt', 'ngày ban hành'),
      title: r.text('title'),
      desc: r.text('desc'),
      departmentId: deptId,
      collabDeptIds,
      deadline: r.date('deadline', 'hạn hoàn thành'),
      reportDue: r.date('reportDue', 'hạn báo cáo'),
      priority: r.option('priority', 'mức ưu tiên', PRIORITIES, PRIORITY_WORDS),
      status: r.option('status', 'trạng thái', MANUAL_STATUSES, TASK_STATUS_WORDS),
      reported: r.has('reported') ? toFlag(r.raw('reported')) : undefined,
    };
  },
  key: (f) => (f.title ? `${norm(f.resolutionNo)}|${norm(f.title)}` : null),
  find(f, taken) {
    const title = norm(f.title);
    const list = store.tasks.filter((t) => t.source === 'btv' && norm(t.title) === title
      && (f.resolutionNo === undefined || norm(t.btv?.resolutionNo) === norm(f.resolutionNo)));
    return pickFree(list, taken, (t) => t.btv?.issuedAt === f.issuedAt);
  },
  build(f) {
    return {
      id: uid(), title: f.title ?? '', desc: f.desc ?? '',
      departmentId: f.departmentId ?? null, collabDeptIds: f.collabDeptIds ?? [],
      deadline: f.deadline ?? '', priority: f.priority ?? 'Cao', status: f.status ?? 'Chưa thực hiện',
      eventId: null, files: [], createdAt: Date.now(), source: 'btv', sourceId: null,
      btv: {
        resolutionNo: f.resolutionNo ?? '', issuedAt: f.issuedAt ?? dateKey(), reportDue: f.reportDue ?? f.deadline ?? '',
        reported: f.reported ?? false, reportedAt: f.reported ? dateTimeKey() : null,
      },
    };
  },
  merge(t, f) {
    assignDefined(t, {
      title: f.title, desc: f.desc, departmentId: f.departmentId, collabDeptIds: f.collabDeptIds,
      deadline: f.deadline, priority: f.priority, status: f.status,
    });
    t.collabDeptIds = (t.collabDeptIds ?? []).filter((id) => id !== t.departmentId);
    t.btv = assignDefined({ ...(t.btv ?? {}) }, {
      resolutionNo: f.resolutionNo, issuedAt: f.issuedAt, reportDue: f.reportDue, reported: f.reported,
    });
  },
  check(t, f, isNew, errors, warnings) {
    if (isNew && !t.departmentId) errors.push('Thiếu phòng xử lý chính');
    if (isNew && !t.deadline) errors.push('Thiếu hạn hoàn thành');
    if (isNew && t.deadline && !f.reportDue) warnings.push('Không có hạn báo cáo — lấy bằng hạn hoàn thành');
    if (f.issuedAt || f.deadline) {
      dateWarnings(warnings, { start: t.btv.issuedAt, end: t.deadline, startLabel: 'Ngày ban hành', endLabel: 'Hạn hoàn thành' });
    }
  },
  snapshot: (t) => ({
    'số nghị quyết': t.btv?.resolutionNo, 'ngày ban hành': t.btv?.issuedAt, 'nội dung': t.title, 'ghi chú': t.desc,
    'phòng xử lý': t.departmentId, 'phòng phối hợp': sorted(t.collabDeptIds), 'hạn hoàn thành': t.deadline,
    'hạn báo cáo': t.btv?.reportDue, 'ưu tiên': t.priority, 'trạng thái': t.status, 'báo cáo BTV': t.btv?.reported,
  }),
  display: (t, ctx) => ({
    code: t.btv.resolutionNo || 'Chưa có số', title: t.title, sub: t.desc,
    dept: deptText(ctx, t.departmentId, t.collabDeptIds), due: t.deadline,
    extra: t.btv.reportDue ? `Báo cáo ${formatDate(t.btv.reportDue)}` : '', status: t.status,
  }),
  add(t) {
    store.tasks.push(t);
    syncTaskEvent(t, true);
  },
  updated(t, changed) {
    if (changed.includes('báo cáo BTV')) t.btv.reportedAt = t.btv.reported ? dateTimeKey() : null;
    syncTaskEvent(t, Boolean(t.eventId));
  },
};

/* ---------------- Giao việc TTUB ---------------- */

const TASKS = {
  title: 'Giao việc TTUB',
  noun: 'công việc',
  file: 'mau-cap-nhat-giao-viec-TTUB.xlsx',
  match: 'Dòng trùng Tên công việc với hệ thống sẽ được cập nhật, còn lại được thêm mới.',
  defaults: 'Thiếu mức ưu tiên thì là Trung bình, thiếu trạng thái thì là Chưa thực hiện.',
  required: ['title'],
  keyError: 'Thiếu tên công việc',
  columns: [
    { key: 'title', label: 'Tên công việc', need: 'Có', aliases: ['ten cong viec', 'cong viec', 'ten nhiem vu', 'nhiem vu', 'noi dung cong viec', 'noi dung', 'tieu de', 'trich yeu'] },
    { key: 'desc', label: 'Nội dung chi tiết', aliases: ['noi dung chi tiet', 'mo ta', 'chi tiet', 'ghi chu'] },
    { ...DEPT_COL, need: 'Khi thêm mới' },
    COLLAB_COL,
    { key: 'deadline', label: 'Hạn chót', need: 'Khi thêm mới', aliases: ['han chot', 'han hoan thanh', 'thoi han', 'han xu ly', 'han thuc hien', 'ngay hoan thanh'] },
    PRIORITY_COL,
    TASK_STATUS_COL,
  ],
  example() {
    const [lead, other] = sampleDepts();
    return {
      title: 'Báo cáo tổng kết công tác quý IV', desc: 'Tổng hợp số liệu từ các bộ phận',
      dept: lead, collab: other, deadline: dateCell(addDays(dateKey(), 10)), priority: 'Trung bình', status: 'Chưa thực hiện',
    };
  },
  parse(r, ctx) {
    const { deptId, collabDeptIds } = readDepts(r, ctx);
    return {
      title: r.text('title'),
      desc: r.text('desc'),
      departmentId: deptId,
      collabDeptIds,
      deadline: r.date('deadline', 'hạn chót'),
      priority: r.option('priority', 'mức ưu tiên', PRIORITIES, PRIORITY_WORDS),
      status: r.option('status', 'trạng thái', MANUAL_STATUSES, TASK_STATUS_WORDS),
    };
  },
  key: (f) => (f.title ? norm(f.title) : null),
  find(f, taken) {
    const title = norm(f.title);
    // Chỉ khớp công việc TTUB (nội bộ, đơn thư, phản ánh); công việc BTV có màn riêng nên không bị ghi đè từ file này
    const list = store.tasks.filter((t) => t.source !== 'btv' && norm(t.title) === title);
    return pickFree(list, taken, (t) => t.deadline === f.deadline);
  },
  build(f) {
    return {
      id: uid(), title: f.title ?? '', desc: f.desc ?? '',
      departmentId: f.departmentId ?? null, assignerId: null, collabDeptIds: f.collabDeptIds ?? [],
      deadline: f.deadline ?? '', priority: f.priority ?? 'Trung bình', status: f.status ?? 'Chưa thực hiện',
      eventId: null, files: [], createdAt: Date.now(), source: 'noi-bo', sourceId: null,
    };
  },
  merge(t, f) {
    assignDefined(t, {
      title: f.title, desc: f.desc, departmentId: f.departmentId, collabDeptIds: f.collabDeptIds,
      deadline: f.deadline, priority: f.priority, status: f.status,
    });
    t.collabDeptIds = (t.collabDeptIds ?? []).filter((id) => id !== t.departmentId);
  },
  check(t, f, isNew, errors) {
    if (isNew && !t.departmentId) errors.push('Thiếu phòng xử lý chính');
    if (isNew && !t.deadline) errors.push('Thiếu hạn chót');
  },
  snapshot: (t) => ({
    'tên': t.title, 'nội dung': t.desc, 'phòng xử lý': t.departmentId, 'phòng phối hợp': sorted(t.collabDeptIds),
    'hạn chót': t.deadline, 'ưu tiên': t.priority, 'trạng thái': t.status,
  }),
  display: (t, ctx) => ({
    title: t.title, sub: t.desc, dept: deptText(ctx, t.departmentId, t.collabDeptIds),
    due: t.deadline, extra: `Ưu tiên ${t.priority}`, status: t.status,
  }),
  add(t) {
    store.tasks.push(t);
    syncTaskEvent(t, true);
  },
  updated(t) {
    syncTaskEvent(t, Boolean(t.eventId));
  },
};

/* ---------------- Đơn thư, PAKN ---------------- */

const PETITIONS = {
  title: 'Đơn thư, PAKN',
  noun: 'đơn thư',
  file: 'mau-cap-nhat-don-thu.xlsx',
  match: 'Dòng có Mã đơn trùng với hệ thống sẽ được cập nhật; file không có cột Mã đơn thì khớp theo Họ tên công dân và Nội dung đơn. Còn lại được thêm mới.',
  defaults: 'Thiếu loại đơn thì là Kiến nghị, thiếu hạn xử lý thì tính theo loại đơn, thiếu hình thức thì là Trực tiếp.',
  required: ['content', 'code'],
  keyError: 'Thiếu nội dung đơn',
  columns: [
    { key: 'code', label: 'Mã đơn', aliases: ['ma don', 'ma ho so', 'ma so', 'ma'], note: 'Để trống khi thêm đơn mới (hệ thống tự cấp mã). Ghi mã để cập nhật đúng đơn đã có.' },
    { key: 'name', label: 'Họ tên công dân', aliases: ['ho ten cong dan', 'ho va ten', 'ho ten', 'ten cong dan', 'nguoi gui don', 'nguoi gui', 'nguoi dung don', 'cong dan'] },
    PHONE_COL,
    { key: 'address', label: 'Địa chỉ', aliases: ['dia chi', 'noi cu tru', 'noi o'] },
    { key: 'content', label: 'Nội dung đơn', need: 'Khi thêm mới', aliases: ['noi dung don', 'noi dung', 'tom tat noi dung', 'trich yeu'] },
    { key: 'type', label: 'Loại đơn', aliases: ['loai don', 'phan loai don', 'phan loai', 'loai'], note: PETITION_TYPES.join(', ') },
    { key: 'channel', label: 'Hình thức tiếp nhận', aliases: ['hinh thuc tiep nhan', 'hinh thuc', 'kenh tiep nhan', 'nguon don', 'nguon'], note: CHANNELS.join(', ') },
    FIELD_COL,
    DEPT_COL,
    COLLAB_COL,
    { key: 'receivedAt', label: 'Ngày tiếp nhận', aliases: ['ngay tiep nhan', 'ngay nhan don', 'ngay nhan', 'ngay giao', 'ngay chuyen'] },
    { key: 'deadline', label: 'Hạn xử lý', aliases: ['han xu ly', 'han giai quyet', 'han hoan thanh', 'ngay hoan thanh', 'thoi han', 'han chot'] },
    { key: 'status', label: 'Tình trạng', aliases: ['tinh trang han', 'tinh trang xu ly', 'tinh trang', 'trang thai'], note: `${PETITION_STATUSES.join(', ')}; hoặc Sắp đến hạn, Quá hạn (→ Chưa thực hiện), Đã đóng (→ Hoàn thành)` },
    { key: 'result', label: 'Kết quả / tiến độ xử lý', aliases: ['ket qua tien do xu ly', 'ket qua xu ly', 'ket qua giai quyet', 'ket qua', 'tien do thuc hien', 'tien do xu ly', 'tien do'] },
  ],
  example() {
    const [lead] = sampleDepts();
    const today = dateKey();
    return {
      code: '', name: 'Nguyễn Văn A', phone: '0912345678', address: 'Ấp 1, xã Bình Mỹ',
      content: 'Đề nghị xem xét cấp giấy chứng nhận quyền sử dụng đất', type: 'Kiến nghị', channel: 'Trực tiếp',
      field: 'Đất đai – bồi thường', dept: lead, collab: '', receivedAt: dateCell(today),
      deadline: dateCell(dueDateFor('Kiến nghị', today)), status: TODO, result: '',
    };
  },
  parse(r, ctx) {
    const { deptId, collabDeptIds } = readDepts(r, ctx);
    let type;
    if (r.has('type')) {
      type = pickType(r.text('type')) ?? undefined;
      if (!type) r.warn(`Không rõ loại đơn "${r.text('type')}" — bỏ qua ô này`);
    }
    return {
      code: r.text('code'),
      name: r.text('name'),
      phone: phoneText(r.text('phone')),
      address: r.text('address'),
      content: r.text('content'),
      type,
      channel: r.option('channel', 'hình thức tiếp nhận', CHANNELS, CHANNEL_WORDS),
      field: r.text('field'),
      deptId,
      collabDeptIds,
      receivedAt: r.date('receivedAt', 'ngày tiếp nhận'),
      deadline: r.date('deadline', 'hạn xử lý'),
      status: r.option('status', 'tình trạng', PETITION_STATUSES, PETITION_STATUS_WORDS),
      result: r.text('result'),
    };
  },
  key(f) {
    if (f.code) return `ma:${norm(f.code)}`;
    return f.content ? `nd:${norm(f.name)}|${norm(f.content)}` : null;
  },
  exact: (f) => Boolean(f.code),
  find(f, taken) {
    if (f.code) return store.petitions.find((p) => norm(p.code) === norm(f.code)) ?? null;
    const content = norm(f.content);
    const name = norm(f.name);
    const list = store.petitions.filter((p) => norm(p.content) === content && norm(p.citizen?.name) === name);
    return pickFree(list, taken, (p) => p.receivedAt === f.receivedAt);
  },
  build(f) {
    const receivedAt = f.receivedAt ?? dateKey();
    const type = f.type ?? 'Kiến nghị';
    const content = f.content ?? '';
    return {
      id: uid(), code: f.code ?? null, type, channel: f.channel ?? 'Trực tiếp', receivedAt,
      citizen: { name: f.name ?? '', phone: f.phone ?? '', address: f.address ?? '' },
      content, field: f.field ?? classify(content, store.departments).field,
      deptId: f.deptId ?? null, collabDeptIds: f.collabDeptIds ?? [],
      deadline: f.deadline ?? dueDateFor(type, receivedAt), status: f.status ?? TODO, result: f.result ?? '',
      reflectionId: null, timeline: [], files: [], calendarSync: true,
    };
  },
  merge(p, f) {
    assignDefined(p, {
      type: f.type, channel: f.channel, receivedAt: f.receivedAt, content: f.content, field: f.field,
      deptId: f.deptId, collabDeptIds: f.collabDeptIds, deadline: f.deadline, status: f.status, result: f.result,
    });
    p.collabDeptIds = (p.collabDeptIds ?? []).filter((id) => id !== p.deptId);
    p.citizen = assignDefined({ ...(p.citizen ?? {}) }, { name: f.name, phone: f.phone, address: f.address });
  },
  check(p, f, isNew, errors, warnings) {
    if (isNew && !p.content) errors.push('Thiếu nội dung đơn');
    if (isNew && !f.receivedAt) warnings.push('Không có ngày tiếp nhận — tạm lấy ngày hôm nay');
    if (f.receivedAt || f.deadline) {
      dateWarnings(warnings, { start: p.receivedAt, end: p.deadline, startLabel: 'Ngày tiếp nhận', endLabel: 'Hạn xử lý' });
    }
  },
  snapshot: (p) => ({
    'loại đơn': p.type, 'hình thức': p.channel, 'ngày tiếp nhận': p.receivedAt, 'họ tên': p.citizen?.name,
    'điện thoại': p.citizen?.phone, 'địa chỉ': p.citizen?.address, 'nội dung': p.content, 'lĩnh vực': p.field,
    'phòng xử lý': p.deptId, 'phòng phối hợp': sorted(p.collabDeptIds), 'hạn xử lý': p.deadline,
    'tình trạng': p.status, 'kết quả': p.result,
  }),
  display: (p, ctx) => ({
    code: p.code || 'Mã tự cấp', title: `${p.citizen.name || 'Công dân ẩn danh'} · ${p.type}`, sub: p.content,
    dept: deptText(ctx, p.deptId, p.collabDeptIds), due: p.deadline,
    extra: `Nhận ${formatDate(p.receivedAt)}`, status: p.status,
  }),
  add(p, ctx) {
    p.code ??= nextCode('DT', store.petitions);
    store.petitions.push(p);
    addTimeline(p, `Nhập từ Excel (${ctx.fileName})`);
    if (p.status !== TODO) addTimeline(p, `Tình trạng: ${p.status}`);
  },
  updated(p, changed) {
    addTimeline(p, `Cập nhật từ Excel: ${changed.join(', ')}`);
    if (changed.includes('tình trạng')) addTimeline(p, `Tình trạng: ${p.status}`);
  },
};

/* ---------------- Phản ánh 1022 ---------------- */

const REFLECTIONS = {
  title: 'Phản ánh 1022',
  noun: 'phản ánh',
  file: 'mau-cap-nhat-phan-anh-1022.xlsx',
  match: 'Dòng có Mã phản ánh (mã trên Cổng 1022) trùng với hệ thống sẽ được cập nhật; file không có cột mã thì khớp theo Nội dung. Còn lại được thêm mới.',
  defaults: 'Thiếu khu vực thì lấy theo nội dung (ấp, thôn, khu phố) hoặc ghi "Chưa xác định"; thiếu hạn xử lý thì tính 7 ngày từ ngày tiếp nhận. Cột "đã xử lý" / "chưa xử lý" đánh dấu 1 cũng được dùng làm tình trạng.',
  required: ['content', 'code'],
  keyError: 'Thiếu mã và nội dung phản ánh',
  columns: [
    { key: 'code', label: 'Mã phản ánh', aliases: ['ma phan anh', 'ma pakn', 'ma ho so', 'ma so', 'ma'], note: 'Mã trên Cổng 1022, ví dụ PAKN20261016-000001. Để trống thì hệ thống tự cấp mã.' },
    { key: 'receivedAt', label: 'Ngày tiếp nhận', aliases: ['ngay tiep nhan', 'ngay nhan'] },
    { key: 'area', label: 'Khu vực', aliases: ['khu vuc', 'dia ban', 'dia diem', 'ap khu pho', 'ap', 'thon', 'khu pho'] },
    { key: 'name', label: 'Người phản ánh', aliases: ['nguoi phan anh', 'ho va ten', 'ho ten', 'cong dan'] },
    PHONE_COL,
    { key: 'content', label: 'Nội dung phản ánh', need: 'Khi thêm mới', aliases: ['noi dung phan anh', 'noi dung'] },
    FIELD_COL,
    DEPT_COL,
    COLLAB_COL,
    { key: 'deadline', label: 'Hạn xử lý', aliases: ['han xu ly', 'thoi han', 'han chot'] },
    { key: 'status', label: 'Tình trạng', aliases: ['tinh trang', 'trang thai'], note: REFLECTION_STATUSES.join(', ') },
    { key: 'result', label: 'Kết quả xử lý', aliases: ['ket qua xu ly', 'ket qua', 'tien do xu ly', 'tien do'] },
    { key: 'done', label: 'Đã xử lý', aliases: ['da xu ly'], template: false },
    { key: 'pending', label: 'Chưa xử lý', aliases: ['chua xu ly'], template: false },
  ],
  example() {
    const [lead] = sampleDepts();
    const today = dateKey();
    return {
      code: `PAKN${today.replaceAll('-', '')}-000001`, receivedAt: dateCell(today), area: 'Ấp 1', name: '', phone: '',
      content: 'Đèn chiếu sáng trên tuyến đường liên ấp bị hỏng nhiều ngày', field: 'Hạ tầng đô thị',
      dept: lead, collab: '', deadline: dateCell(addDays(today, DEFAULT_SLA['Phản ánh'])), status: TODO, result: '',
    };
  },
  parse(r, ctx) {
    const { deptId, collabDeptIds } = readDepts(r, ctx);
    let status = r.option('status', 'tình trạng', REFLECTION_STATUSES, REFLECTION_STATUS_WORDS);
    if (status === undefined && (r.has('done') || r.has('pending'))) {
      if (toFlag(r.raw('done'))) status = DONE;
      else if (toFlag(r.raw('pending'))) status = TODO;
    }
    return {
      code: r.text('code'),
      receivedAt: r.date('receivedAt', 'ngày tiếp nhận'),
      area: r.text('area'),
      name: r.text('name'),
      phone: phoneText(r.text('phone')),
      content: r.text('content'),
      field: r.text('field'),
      deptId,
      collabDeptIds,
      deadline: r.date('deadline', 'hạn xử lý'),
      status,
      result: r.text('result'),
    };
  },
  key(f) {
    if (f.code) return `ma:${norm(f.code)}`;
    return f.content ? `nd:${norm(f.content)}` : null;
  },
  exact: (f) => Boolean(f.code),
  find(f, taken) {
    if (f.code) return store.reflections.find((r) => norm(r.code) === norm(f.code)) ?? null;
    const content = norm(f.content);
    const list = store.reflections.filter((r) => norm(r.content) === content);
    return pickFree(list, taken, (r) => r.receivedAt === f.receivedAt);
  },
  build(f) {
    const receivedAt = f.receivedAt ?? dateKey();
    const content = f.content ?? '';
    const deptId = f.deptId ?? null;
    return {
      id: uid(), code: f.code ?? null, receivedAt, area: f.area ?? guessArea(content),
      citizen: { name: f.name ?? '', phone: f.phone ?? '' },
      content, field: f.field ?? classify(content, store.departments).field,
      deptId, collabDeptIds: f.collabDeptIds ?? [],
      deadline: f.deadline ?? addDays(receivedAt, DEFAULT_SLA['Phản ánh']),
      status: f.status ?? TODO, result: f.result ?? '',
      petitionId: null, timeline: [], calendarSync: true,
    };
  },
  merge(r, f) {
    assignDefined(r, {
      receivedAt: f.receivedAt, area: f.area, content: f.content, field: f.field, deptId: f.deptId,
      collabDeptIds: f.collabDeptIds, deadline: f.deadline, status: f.status, result: f.result,
    });
    r.collabDeptIds = (r.collabDeptIds ?? []).filter((id) => id !== r.deptId);
    r.citizen = assignDefined({ ...(r.citizen ?? {}) }, { name: f.name, phone: f.phone });
  },
  check(r, f, isNew, errors, warnings) {
    if (isNew && !r.content) errors.push('Thiếu nội dung phản ánh');
    if (isNew && !f.receivedAt) warnings.push('Không có ngày tiếp nhận — tạm lấy ngày hôm nay');
    if (f.receivedAt || f.deadline) {
      dateWarnings(warnings, { start: r.receivedAt, end: r.deadline, startLabel: 'Ngày tiếp nhận', endLabel: 'Hạn xử lý' });
    }
  },
  snapshot: (r) => ({
    'ngày tiếp nhận': r.receivedAt, 'khu vực': r.area, 'người phản ánh': r.citizen?.name, 'điện thoại': r.citizen?.phone,
    'nội dung': r.content, 'lĩnh vực': r.field, 'phòng xử lý': r.deptId, 'phòng phối hợp': sorted(r.collabDeptIds),
    'hạn xử lý': r.deadline, 'tình trạng': r.status, 'kết quả': r.result,
  }),
  display: (r, ctx) => ({
    code: r.code || 'Mã tự cấp', title: `${r.area} · ${r.field}`, sub: r.content,
    dept: deptText(ctx, r.deptId, r.collabDeptIds), due: r.deadline,
    extra: `Nhận ${formatDate(r.receivedAt)}`, status: r.status,
  }),
  add(r, ctx) {
    r.code ??= nextCode('PA', store.reflections);
    store.reflections.push(r);
    addTimeline(r, `Nhập từ Excel (${ctx.fileName})`);
    if (r.status !== TODO) addTimeline(r, `Tình trạng: ${r.status}`);
  },
  updated(r, changed) {
    addTimeline(r, `Cập nhật từ Excel: ${changed.join(', ')}`);
    if (changed.includes('tình trạng')) addTimeline(r, `Tình trạng: ${r.status}`);
  },
};

const SPECS = { btv: BTV, tasks: TASKS, petitions: PETITIONS, reflections: REFLECTIONS };

/* ---------------- Hộp thoại ---------------- */

const ACTIONS = {
  create: ['badge-done', 'fa-plus', 'Thêm mới'],
  update: ['badge-doing', 'fa-pen', 'Cập nhật'],
  same: ['badge-todo', 'fa-equals', 'Không đổi'],
  error: ['badge-overdue', 'fa-circle-exclamation', 'Lỗi'],
};
const willWrite = (plan) => plan.action === 'create' || plan.action === 'update';

/** Trạng thái của lần cập nhật đang mở: chức năng, file, trang tính, dòng tiêu đề và kế hoạch từng dòng. */
let state = null;

export function initImport() {
  for (const btn of $$('[data-import]')) btn.addEventListener('click', () => openImport(btn.dataset.import));

  const zone = $('#im-dropzone');
  const input = $('#im-file');
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  for (const type of ['dragenter', 'dragover']) {
    zone.addEventListener(type, (e) => {
      e.preventDefault();
      zone.classList.add('is-drag');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    zone.addEventListener(type, (e) => {
      e.preventDefault();
      zone.classList.remove('is-drag');
    });
  }
  zone.addEventListener('drop', (e) => readFile(e.dataTransfer.files[0]));
  input.addEventListener('change', () => {
    readFile(input.files[0]);
    input.value = '';
  });

  $('#im-change').addEventListener('click', () => input.click());
  $('#im-template').addEventListener('click', downloadTemplate);
  $('#im-sheet').addEventListener('change', (e) => useSheet(Number(e.target.value)));
  $('#im-summary').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn || !state) return;
    state.filter = state.filter === btn.dataset.filter ? 'all' : btn.dataset.filter;
    renderPreview();
  });
  $('#im-apply').addEventListener('click', applyImport);
}

function openImport(kind) {
  const spec = SPECS[kind];
  state = { spec, filter: 'all', plans: [] };
  $('#im-title').textContent = `Cập nhật đồng loạt từ Excel · ${spec.title}`;
  $('#im-hint').textContent = `${spec.match} Ô trống trong Excel không xóa dữ liệu đang có. ${spec.defaults}`;
  $('#im-col-list').innerHTML = spec.columns
    .filter((c) => c.template !== false)
    .map((c) => `<span class="chip ${c.need ? 'is-req' : ''}" title="${esc(c.need ? `Bắt buộc: ${c.need.toLowerCase()}` : 'Không bắt buộc')}">${esc(c.label)}</span>`)
    .join('');
  showStep('pick');
  openModal('import-modal');
  loadXlsx().catch(() => { /* Báo lỗi khi người dùng chọn file */ });
}

function showStep(step) {
  $('#im-pick').hidden = step !== 'pick';
  $('#im-preview').hidden = step !== 'preview';
  updateApply();
}

function setBusy(busy) {
  const zone = $('#im-dropzone');
  zone.classList.toggle('is-busy', busy);
  zone.querySelector('strong').textContent = busy ? 'Đang đọc file…' : 'Nhấn để chọn hoặc kéo thả file Excel vào đây';
}

async function readFile(file) {
  if (!file || !state) return;
  setBusy(true);
  let sheets;
  try {
    await loadXlsx();
  } catch (err) {
    console.error(err);
    setBusy(false);
    toast('Không tải được thư viện đọc Excel. Kiểm tra kết nối mạng rồi thử lại.', 'error');
    return;
  }
  try {
    sheets = await readWorkbook(file);
  } catch (err) {
    console.error(err);
    toast('Không đọc được file. Hãy dùng file .xlsx, .xls hoặc .csv.', 'error');
    return;
  } finally {
    setBusy(false);
  }

  state.fileName = file.name;
  state.sheets = sheets.filter((s) => s.rows.some((row) => row?.some((cell) => !isBlank(cell))));
  if (!state.sheets.length) {
    toast('File không có dữ liệu', 'error');
    return;
  }
  // Mặc định chọn trang tính có dòng tiêu đề khớp nhiều cột nhất
  let best = 0;
  let bestHits = 0;
  state.sheets.forEach((sheet, i) => {
    const hits = detectHeader(sheet, state.spec.columns)?.hits ?? 0;
    if (hits > bestHits) {
      best = i;
      bestHits = hits;
    }
  });
  $('#im-file-name').textContent = file.name;
  fillOptions($('#im-sheet'), state.sheets.map((s, i) => [String(i), s.name]));
  $('#im-sheet').value = String(best);
  $('#im-sheet-wrap').hidden = state.sheets.length < 2;
  useSheet(best);
  showStep('preview');
}

function useSheet(index) {
  const { spec } = state;
  const sheet = state.sheets[index];
  const header = detectHeader(sheet, spec.columns);
  const requiredLabels = spec.required.map((k) => spec.columns.find((c) => c.key === k).label).join(' hoặc ');
  state.sheetIndex = index;
  state.header = header;
  state.filter = 'all';
  state.problem = !header
    ? 'Không tìm thấy dòng tiêu đề phù hợp trong trang tính này.'
    : (spec.required.some((k) => k in header.map) ? '' : `Không tìm thấy cột ${requiredLabels}.`);
  state.ctx = makeContext(state.fileName);
  state.plans = state.problem ? [] : buildPlans(sheet, header);
  renderPreview();
}

/**
 * Lập kế hoạch cho từng dòng mà chưa ghi gì vào hệ thống: dòng khớp dữ liệu có sẵn được ghép thử
 * trên bản sao để biết trường nào đổi. Dòng trùng mã với dòng trước trong file sẽ ghi đè dòng đó;
 * dòng chỉ trùng nội dung (không có mã) được giữ thành bản ghi riêng.
 */
function buildPlans(sheet, header) {
  const { spec, ctx } = state;
  const seen = new Map();
  const taken = new Set();
  const plans = [];
  const cols = Object.values(header.map);
  for (let i = header.headerIndex + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] ?? [];
    if (cols.every((idx) => isBlank(row[idx]))) continue;
    const rowNo = sheet.firstRow + i;
    const warnings = [];
    const errors = [];
    const fields = spec.parse(rowReader(row, header.map, warnings), ctx);
    const key = spec.key(fields);
    let action = 'create';
    let item = null;
    let changed = [];
    if (!key) {
      errors.push(spec.keyError);
    } else {
      const exact = spec.exact?.(fields) ?? false;
      const existing = spec.find(fields, exact ? null : taken);
      if (existing && !exact) taken.add(existing.id);
      const dup = seen.get(key);
      seen.set(key, rowNo);
      if (existing) {
        item = structuredClone(existing);
        spec.merge(item, fields);
        changed = diffKeys(spec.snapshot(existing), spec.snapshot(item));
        action = changed.length ? 'update' : 'same';
      } else {
        item = spec.build(fields);
        if (dup && exact) {
          action = 'update';
          warnings.push(`Trùng mã với dòng ${dup} trong file — dòng này ghi đè dòng trước`);
        } else if (dup) {
          warnings.push(`Giống dòng ${dup} trong file — được thêm thành bản ghi riêng`);
        }
      }
      spec.check(item, fields, !existing, errors, warnings);
    }
    if (errors.length) action = 'error';
    plans.push({ rowNo, action, fields, item, changed, errors, warnings });
  }
  return plans;
}

function renderPreview() {
  const { spec, plans, header, problem, ctx, filter } = state;
  const sheet = state.sheets[state.sheetIndex];
  $('#im-meta').textContent = header
    ? `Trang "${sheet.name}" · dòng tiêu đề số ${sheet.firstRow + header.headerIndex} · ${plans.length} dòng dữ liệu`
    : `Trang "${sheet.name}"`;

  const problemBox = $('#im-problem');
  problemBox.hidden = !problem;
  problemBox.innerHTML = problem
    ? `<i class="fa-solid fa-circle-exclamation"></i> ${esc(problem)} Bấm "Tải file mẫu" để xem tên cột cần có.`
    : '';
  $('#im-mapping').innerHTML = header ? mappingHtml(sheet.rows[header.headerIndex] ?? [], header.map, spec) : '';

  const counts = { create: 0, update: 0, same: 0, error: 0 };
  for (const p of plans) counts[p.action]++;
  $('#im-summary').hidden = Boolean(problem);
  $('#im-summary').innerHTML = Object.entries(ACTIONS).map(([action, [, icon, label]]) => `
    <button type="button" class="im-filter is-${action}" data-filter="${action}" aria-pressed="${filter === action}">
      <i class="fa-solid ${icon}" aria-hidden="true"></i> ${label} <b>${counts[action]}</b>
    </button>`).join('');

  const usedNew = new Set(plans.filter(willWrite).flatMap((p) => [p.item.deptId ?? p.item.departmentId, ...(p.item.collabDeptIds ?? [])]));
  const newNames = [...ctx.newDepts].filter(([key]) => usedNew.has(`new:${key}`)).map(([, name]) => name);
  const deptBox = $('#im-depts');
  deptBox.hidden = !newNames.length;
  deptBox.innerHTML = newNames.length
    ? `<i class="fa-solid fa-sitemap"></i> Sẽ tạo phòng ban mới: <b>${esc(newNames.join(', '))}</b>. Nếu đây là phòng đã có với tên khác, hãy sửa tên trong file hoặc đổi tên ở mục Phòng ban trước.`
    : '';

  const rows = plans.filter((p) => filter === 'all' || p.action === filter);
  $('#im-table').hidden = Boolean(problem);
  $('#im-rows').innerHTML = rows.map(planRow).join('');
  $('#im-empty').hidden = Boolean(problem) || rows.length > 0;
  updateApply();
}

/** Cột Excel nào được dùng cho trường nào, và các cột bị bỏ qua. */
function mappingHtml(headerRow, map, spec) {
  const byIdx = new Map(Object.entries(map).map(([key, idx]) => [idx, spec.columns.find((c) => c.key === key)]));
  const used = [];
  const skipped = [];
  headerRow.forEach((cell, idx) => {
    const text = cellText(cell);
    if (!text) return;
    const col = byIdx.get(idx);
    if (!col) skipped.push(`<span class="chip is-off">${esc(text)}</span>`);
    else if (normHeader(text) === normHeader(col.label)) used.push(`<span class="chip is-on"><i class="fa-solid fa-check"></i> ${esc(col.label)}</span>`);
    else used.push(`<span class="chip is-on"><i class="fa-solid fa-check"></i> ${esc(text)} → ${esc(col.label)}</span>`);
  });
  return `
    <div class="im-cols"><span class="im-cols-label">Cột được dùng</span>${used.join('')}</div>
    ${skipped.length ? `<div class="im-cols"><span class="im-cols-label">Bỏ qua</span>${skipped.join('')}</div>` : ''}`;
}

function planRow(p) {
  const [cls, icon, label] = ACTIONS[p.action];
  const d = p.item ? state.spec.display(p.item, state.ctx) : null;
  const notes = [
    ...p.errors.map((m) => `<li class="is-error"><i class="fa-solid fa-circle-xmark"></i><span>${esc(m)}</span></li>`),
    ...p.warnings.map((m) => `<li class="is-warn"><i class="fa-solid fa-triangle-exclamation"></i><span>${esc(m)}</span></li>`),
    ...(p.action === 'update' && p.changed.length
      ? [`<li><i class="fa-solid fa-pen"></i><span>Đổi ${esc(p.changed.join(', '))}</span></li>`] : []),
  ];
  return `
    <tr class="${p.action === 'error' ? 'is-overdue' : ''} ${p.action === 'same' ? 'is-same' : ''}">
      <td class="im-rowno">${p.rowNo}</td>
      <td><span class="badge ${cls}"><i class="fa-solid ${icon}"></i>${label}</span></td>
      <td>
        ${d?.code ? `<span class="code">${esc(d.code)}</span>` : ''}
        ${d ? `<div class="im-main">${esc(d.title || '—')}</div>` : '—'}
        ${d?.sub ? `<div class="task-desc">${esc(d.sub)}</div>` : ''}
      </td>
      <td>${d ? esc(d.dept) : '—'}</td>
      <td>
        ${d?.due ? `<span class="date-chip">${formatDate(d.due)}</span>` : '—'}
        ${d?.extra ? `<div class="meta-line">${esc(d.extra)}</div>` : ''}
      </td>
      <td>${d ? esc(d.status) : '—'}</td>
      <td>${notes.length ? `<ul class="im-notes">${notes.join('')}</ul>` : ''}</td>
    </tr>`;
}

function updateApply() {
  const count = state?.plans?.filter(willWrite).length ?? 0;
  const btn = $('#im-apply');
  btn.disabled = !count || $('#im-preview').hidden;
  btn.innerHTML = `<i class="fa-solid fa-check"></i> ${count ? `Cập nhật ${count} dòng` : 'Cập nhật'}`;
}

function applyImport() {
  const { spec, plans, ctx } = state;
  const todo = plans.filter(willWrite);
  if (!todo.length) return;

  // Tạo các phòng ban mới mà các dòng sẽ ghi có dùng tới
  const ids = {};
  const realId = (id) => ids[id] ?? id;
  for (const plan of todo) {
    const f = plan.fields;
    for (const id of [f.deptId, f.departmentId, ...(f.collabDeptIds ?? [])]) {
      if (!id?.startsWith('new:') || ids[id]) continue;
      const key = id.slice(4);
      const dept = store.departments.find((d) => deptKey(d.name) === key) ?? { id: uid(), name: ctx.newDepts.get(key) };
      if (!store.departments.includes(dept)) store.departments.push(dept);
      ids[id] = dept.id;
    }
  }

  let created = 0;
  let updated = 0;
  const taken = new Set();
  for (const plan of todo) {
    const f = { ...plan.fields };
    if (f.deptId) f.deptId = realId(f.deptId);
    if (f.departmentId) f.departmentId = realId(f.departmentId);
    if (f.collabDeptIds) f.collabDeptIds = [...new Set(f.collabDeptIds.map(realId))];
    // Tìm lại trên dữ liệu hiện tại: dòng trùng mã trong file sẽ cập nhật bản vừa thêm ở dòng trước
    const exact = spec.exact?.(f) ?? false;
    const existing = spec.find(f, exact ? null : taken);
    if (existing) {
      if (!exact) taken.add(existing.id);
      const before = spec.snapshot(existing);
      spec.merge(existing, f);
      const changed = diffKeys(before, spec.snapshot(existing));
      if (changed.length) {
        spec.updated(existing, changed, ctx);
        updated++;
      }
    } else {
      const item = spec.build(f);
      spec.add(item, ctx);
      taken.add(item.id);
      created++;
    }
  }
  persist({ quiet: true });
  closeModal('import-modal');
  const parts = [created && `thêm ${created}`, updated && `cập nhật ${updated}`].filter(Boolean).join(', ');
  toast(parts ? `Đã ${parts} ${spec.noun} từ Excel` : 'Không có thay đổi nào', 'success');
}

async function downloadTemplate() {
  const { spec } = state;
  const cols = spec.columns.filter((c) => c.template !== false);
  const example = spec.example();
  const guide = [
    ['Cột', 'Bắt buộc', 'Ghi chú'],
    ...cols.map((c) => [c.label, c.need ?? '', c.note ?? '']),
    [],
    ['Cách cập nhật', '', `${spec.match} Ô trống không xóa dữ liệu đang có. ${spec.defaults}`],
    ['Tên cột', '', 'Không cần đúng thứ tự; tên cột gần giống (không dấu, viết tắt thường gặp) vẫn được nhận. Dòng tiêu đề có thể nằm dưới vài dòng tiêu đề trang.'],
    ['Ngày tháng', '', 'Nhập dạng ngày/tháng/năm, ví dụ 16/10/2026.'],
  ];
  try {
    await downloadWorkbook(spec.file, [
      {
        name: 'Dữ liệu',
        rows: [cols.map((c) => c.label), cols.map((c) => example[c.key] ?? '')],
        widths: cols.map((c) => Math.max(16, c.label.length + 6)),
      },
      { name: 'Hướng dẫn', rows: guide, widths: [28, 16, 100] },
    ]);
  } catch (err) {
    console.error(err);
    toast('Không tạo được file mẫu. Kiểm tra kết nối mạng rồi thử lại.', 'error');
  }
}
