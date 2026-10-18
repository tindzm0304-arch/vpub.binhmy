/* Lớp dữ liệu: lưu trong trình duyệt (localStorage), phát sự kiện 'store:change' khi thay đổi.
   Các thực thể liên kết: Phản ánh 1022 → Đơn thư → Công việc (nguồn: đơn thư / phản ánh / BTV) → Lịch công tác.
   Mỗi thay đổi được ghi vào nhật ký (`activity`) và đóng dấu `updatedAt`; xóa đưa mục vào thùng rác (`trash`) trong 30 ngày;
   lưu vào thư viện (`library`) gỡ mục khỏi màn hình gốc và giữ lại để xem lại hoặc khôi phục. */
import {
  uid, dateKey, dateTimeKey, addDays, fold, formatDate, toast, periodBounds, DEPARTMENTS, TODO, SOON, DONE, OVERDUE, REVIEW, CLOSED, SOON_DAYS, FILED,
} from './utils.js';
import { deleteBlobs } from './files.js';
import { classify, dueDateFor } from './classify.js';

const STORAGE_KEY = 'quan-ly-noi-bo:v1';
/* Tạm thời: khóa của app "Đánh giá KPI". Dữ liệu KPI cũ được sao chép sang đây một lần (xem loadStore), rồi xóa khi không cần nữa. */
const KPI_HANDOFF_KEY = 'quan-ly-kpi:v1';

/* Đơn thư và phản ánh dùng chung bộ trạng thái với công việc. Phản ánh đã chuyển thành đơn thư thì là "Hoàn thành". */
export const PETITION_STATUSES = [TODO, DONE];
export const PETITION_CLOSED = CLOSED;
export const REFLECTION_STATUSES = [TODO, DONE];
export const REFLECTION_CLOSED = CLOSED;
export const DUE_LABEL = { overdue: 'Quá hạn', soon: 'Sắp đến hạn', ok: 'Trong hạn', closed: 'Đã đóng' };

export const TRASH_DAYS = 30;
const ACTIVITY_KEEP = 500;
export const store = {
  departments: [], personnel: [], tasks: [], events: [], petitions: [], reflections: [], trash: [], library: [], activity: [],
  recurring: [], rules: [], checklists: [],
};

/* ---------- Tên hiển thị, nhãn trường, theo dõi thay đổi ---------- */

const NAMES = {
  tasks: (t) => t.title,
  petitions: (p) => `${p.code} · ${p.type}`,
  reflections: (r) => `${r.code} · ${r.area}`,
  personnel: (p) => p.name,
  events: (e) => e.title,
};

/** Các trường được ghi vào nhật ký khi thay đổi, kèm nhãn tiếng Việt. */
const TRACKED = {
  tasks: {
    title: 'Tên công việc', desc: 'Mô tả', departmentId: 'Phòng xử lý chính', collabDeptIds: 'Phòng phối hợp',
    deadline: 'Hạn chót', priority: 'Ưu tiên', status: 'Trạng thái', subtasks: 'Đầu việc con', files: 'Tài liệu',
  },
  petitions: {
    type: 'Loại đơn', status: 'Trạng thái', deadline: 'Hạn xử lý', deptId: 'Phòng xử lý chính',
    collabDeptIds: 'Phòng phối hợp', field: 'Lĩnh vực', content: 'Nội dung', citizen: 'Thông tin công dân', result: 'Kết quả xử lý',
  },
  reflections: {
    status: 'Trạng thái', deadline: 'Hạn xử lý', deptId: 'Phòng xử lý chính', collabDeptIds: 'Phòng phối hợp',
    area: 'Khu vực', content: 'Nội dung',
  },
  personnel: { name: 'Họ tên', title: 'Chức vụ', phone: 'Điện thoại', deptId: 'Phòng ban' },
};
const TRACKED_KINDS = Object.keys(TRACKED);
const KIND_LABEL = { tasks: 'Công việc', petitions: 'Đơn thư', reflections: 'Phản ánh', personnel: 'Cán bộ', events: 'Lịch', system: 'Hệ thống' };
const ACTION_LABEL = {
  create: 'Tạo mới', update: 'Cập nhật', trash: 'Chuyển vào thùng rác', delete: 'Xóa', restore: 'Khôi phục',
  library: 'Lưu vào thư viện', 'empty-trash': 'Dọn thùng rác', purge: 'Xóa hẳn khỏi thùng rác',
  merge: 'Gộp dữ liệu', 'restore-backup': 'Khôi phục bản sao lưu', 'undo-restore': 'Hoàn tác khôi phục',
};
export { KIND_LABEL, ACTION_LABEL };

/* Bản ghi đã thấy ở lần lưu trước: kind → (id → { json, name }). Dùng để biết mục nào mới, đổi, hoặc bị xóa. */
const seen = Object.fromEntries(TRACKED_KINDS.map((kind) => [kind, new Map()]));

const plain = (item) => {
  const { updatedAt, ...body } = item;
  return body;
};

function prettyValue(key, value) {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return '—';
  if (key === 'departmentId' || key === 'deptId') return deptName(value);
  if (key === 'collabDeptIds') return deptNames(value) || '—';
  if (key === 'deadline') return formatDate(value);
  if (key === 'subtasks') return `${value.filter((s) => s.done).length}/${value.length} đã xong`;
  if (key === 'files') return `${value.length} tệp`;
  if (key === 'citizen') return 'đã sửa';
  return String(value);
}

function diffFields(before, after, fields) {
  const changes = [];
  for (const [key, label] of Object.entries(fields)) {
    if (JSON.stringify(before[key] ?? null) === JSON.stringify(after[key] ?? null)) continue;
    changes.push({ label, from: prettyValue(key, before[key]), to: prettyValue(key, after[key]) });
  }
  return changes;
}

/** Ghi một dòng vào nhật ký hoạt động (mới nhất đứng đầu, giữ tối đa ACTIVITY_KEEP dòng). */
export function addActivity(entry) {
  store.activity.unshift({ id: uid(), at: Date.now(), ...entry });
  if (store.activity.length > ACTIVITY_KEEP) store.activity.length = ACTIVITY_KEEP;
}

/** Ghi nhớ trạng thái hiện tại làm mốc so sánh, không tạo nhật ký (dùng khi nạp dữ liệu). */
function primeTracking() {
  for (const kind of TRACKED_KINDS) {
    seen[kind] = new Map(store[kind].map((item) => {
      item.updatedAt ??= 0;
      const body = plain(item);
      return [item.id, { json: JSON.stringify(body), name: NAMES[kind](body) }];
    }));
  }
}

/* Mục mới tạo kể từ lần tự động hóa trước (dùng để chạy quy tắc hành động). */
const pendingCreates = [];

/** So sánh với mốc trước: mục mới → "Tạo mới", đổi trường → "Cập nhật" (kèm trường đổi), mất khỏi kho → xóa hoặc vào thùng rác. */
function trackChanges(now = Date.now()) {
  for (const kind of TRACKED_KINDS) {
    const known = seen[kind];
    const present = new Set();
    for (const item of store[kind]) {
      present.add(item.id);
      const body = plain(item);
      const json = JSON.stringify(body);
      const before = known.get(item.id);
      if (before?.json === json) continue;
      const name = NAMES[kind](body);
      if (!before) {
        item.updatedAt = now;
        pendingCreates.push({ kind, item });
        addActivity({ kind, action: 'create', name });
      } else {
        item.updatedAt = now;
        const changes = diffFields(JSON.parse(before.json), body, TRACKED[kind]);
        if (changes.length) addActivity({ kind, action: 'update', name, changes });
      }
      known.set(item.id, { json, name });
    }
    for (const [id, before] of known) {
      if (present.has(id)) continue;
      known.delete(id);
      const inTrash = store.trash.some((e) => e.kind === kind && e.item.id === id);
      const inLibrary = store.library.some((e) => e.kind === kind && e.item.id === id);
      addActivity({ kind, action: inTrash ? 'trash' : inLibrary ? 'library' : 'delete', name: before.name });
    }
  }
}

/* ---------- Trạng thái nội bộ để phát hiện hoàn thành, mở / đóng ---------- */

/* Công việc đã hoàn thành ở lần lưu trước. Đơn / phản ánh chỉ tự đóng khi có công việc vừa chuyển sang hoàn thành,
   nhờ vậy người dùng mở lại một đơn đã đóng thì đơn không bị tự đóng lại ngay ở lần lưu tiếp theo. */
let doneTaskIds = new Set();
const doneTaskSet = () => new Set(store.tasks.filter((t) => CLOSED.includes(t.status)).map((t) => t.id));

/* Mục đang mở ở lần lưu trước. Ngày đóng (`doneAt`, `closedAt`) chỉ được ghi khi một mục đang mở chuyển sang đóng,
   nên mục nhập từ Excel ở trạng thái đã xong không bị gán nhầm ngày hôm nay — chúng không có ngày đóng. */
let openIds = new Set();
const openIdSet = () => new Set([
  ...store.tasks.filter((t) => !CLOSED.includes(t.status)).map((t) => t.id),
  ...store.petitions.filter((p) => !PETITION_CLOSED.includes(p.status)).map((p) => p.id),
  ...store.reflections.filter((r) => !REFLECTION_CLOSED.includes(r.status)).map((r) => r.id),
]);

/** Ghi ngày hoàn thành / ngày đóng để tính tỷ lệ đúng hạn và thời gian xử lý; mở lại thì xóa ngày đóng. */
function stampClosures() {
  const today = dateKey();
  const stamp = (item, closed, key) => {
    if (!closed) delete item[key];
    else if (!item[key] && openIds.has(item.id)) item[key] = today;
  };
  for (const t of store.tasks) stamp(t, CLOSED.includes(t.status), 'doneAt');
  for (const p of store.petitions) stamp(p, PETITION_CLOSED.includes(p.status), 'closedAt');
  for (const r of store.reflections) stamp(r, REFLECTION_CLOSED.includes(r.status), 'closedAt');
  openIds = openIdSet();
}

/** Dữ liệu không đọc được: giữ nguyên bản gốc ở khóa riêng trước khi nạp dữ liệu mẫu, tránh ghi đè mất dữ liệu thật. */
function keepUnreadable() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) localStorage.setItem(`${STORAGE_KEY}:khong-doc-duoc:${Date.now()}`, raw);
  } catch {
    /* Hết chỗ lưu trữ: vẫn nạp dữ liệu mẫu */
  }
}

export function loadStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved) {
      store.departments = saved.departments ?? [];
      store.personnel = saved.personnel ?? [];
      store.tasks = saved.tasks ?? [];
      store.events = saved.events ?? [];
      store.petitions = saved.petitions ?? [];
      store.reflections = saved.reflections ?? [];
      store.trash = saved.trash ?? [];
      store.library = saved.library ?? [];
      store.activity = saved.activity ?? [];
      store.recurring = saved.recurring ?? [];
      store.rules = saved.rules ?? [];
      store.checklists = saved.checklists ?? [];
      doneTaskIds = doneTaskSet();
      openIds = openIdSet();
      primeTracking();
      // Tạm thời: sao chép dữ liệu KPI cũ sang app "Đánh giá KPI" (chỉ khi app đó chưa có dữ liệu, không ghi đè)
      if (saved.kpi && !localStorage.getItem(KPI_HANDOFF_KEY)) localStorage.setItem(KPI_HANDOFF_KEY, JSON.stringify(saved.kpi));
      if (migrate()) persist();
      syncItemEvents();
      purgeTrash();
      return;
    }
  } catch (err) {
    console.warn('Không đọc được dữ liệu đã lưu, dùng dữ liệu mẫu.', err);
    keepUnreadable();
  }
  seed();
  doneTaskIds = doneTaskSet();
  openIds = openIdSet();
  primeTracking();
  persist();
}

/**
 * Lưu dữ liệu. Chạy quy tắc hành động cho đơn / phản ánh mới và tạo việc định kỳ của kỳ hiện tại.
 * `quiet: true` (nhập từ Excel) bỏ qua quy tắc hành động để không tự tạo việc cho dữ liệu cũ.
 */
export function persist({ quiet = false } = {}) {
  syncLinks();
  trackChanges();
  const created = pendingCreates.splice(0);
  const byRule = quiet ? false : applyRules(created);
  const byRecurring = runRecurring();
  if (byRule || byRecurring) trackChanges();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    console.warn('Không lưu được dữ liệu vào trình duyệt.', err);
  }
  window.dispatchEvent(new CustomEvent('store:change'));
}

/** Nạp dữ liệu lấy từ server: ghi vào trình duyệt rồi đọc lại. Không đẩy ngược lên server (sync.js lo việc đó). */
export function applyRemote(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  loadStore();
}

/** Bản sao dữ liệu nghiệp vụ (gồm thùng rác, thư viện, nhật ký) dùng cho sao lưu. */
export function snapshot() {
  return JSON.parse(JSON.stringify(store));
}

/** Các mục được gộp khi nhập bản sao lưu (nhật ký không gộp: mỗi máy có nhật ký riêng). */
export const MERGE_KEYS = ['departments', 'personnel', 'tasks', 'events', 'petitions', 'reflections', 'trash', 'library', 'recurring', 'rules', 'checklists'];

/**
 * Thay toàn bộ dữ liệu bằng dữ liệu khôi phục, rồi chuyển đổi mô hình cũ (nếu có) và lưu lại.
 * Bản sao lưu cũ không có một kho nào (ví dụ thư viện) thì kho đó trống.
 */
export function restoreStore(data, action = 'restore-backup') {
  for (const key of Object.keys(store)) store[key] = Array.isArray(data[key]) ? data[key] : [];
  doneTaskIds = doneTaskSet();
  openIds = openIdSet();
  migrate();
  primeTracking();
  addActivity({ kind: 'system', action, name: action === 'restore-backup' ? 'Khôi phục từ bản sao lưu' : 'Quay về dữ liệu trước khi khôi phục' });
  persist();
}

/**
 * Gộp dữ liệu từ bản sao lưu: mục chưa có thì thêm; mục đã có thì lấy bản mới hơn (theo `updatedAt`); mục chỉ có trên máy này giữ nguyên.
 * `planMerge` chỉ đếm để xem trước; `mergeStore` thực hiện.
 */
export function planMerge(data) {
  const plan = {};
  for (const key of MERGE_KEYS) {
    const current = new Map((store[key] ?? []).map((item) => [item.id, item]));
    const incoming = data[key] ?? [];
    let added = 0;
    let updated = 0;
    for (const item of incoming) {
      const cur = current.get(item.id);
      if (!cur) added++;
      else if ((item.updatedAt ?? 0) > (cur.updatedAt ?? 0) && JSON.stringify(plain(item)) !== JSON.stringify(plain(cur))) updated++;
    }
    const incomingIds = new Set(incoming.map((item) => item.id));
    const localOnly = [...current.keys()].filter((id) => !incomingIds.has(id)).length;
    plan[key] = { added, updated, localOnly };
  }
  return plan;
}

export function mergeStore(data) {
  const plan = planMerge(data);
  for (const key of MERGE_KEYS) {
    const list = store[key] ?? [];
    const index = new Map(list.map((item, i) => [item.id, i]));
    for (const item of data[key] ?? []) {
      const i = index.get(item.id);
      if (i === undefined) {
        list.push(item);
        index.set(item.id, list.length - 1);
      } else if ((item.updatedAt ?? 0) > (list[i].updatedAt ?? 0)) {
        list[i] = item;
      }
    }
    store[key] = list;
  }
  doneTaskIds = doneTaskSet();
  openIds = openIdSet();
  migrate();
  primeTracking();
  addActivity({ kind: 'system', action: 'merge', name: 'Gộp từ bản sao lưu' });
  persist();
  return plan;
}

export const personById = (id) => store.personnel.find((p) => p.id === id) ?? null;
export const taskById = (id) => store.tasks.find((t) => t.id === id) ?? null;
export const eventById = (id) => store.events.find((e) => e.id === id) ?? null;
export const petitionById = (id) => store.petitions.find((p) => p.id === id) ?? null;
export const reflectionById = (id) => store.reflections.find((r) => r.id === id) ?? null;

/* ---------- Phòng ban ---------- */
export const deptById = (id) => store.departments.find((d) => d.id === id) ?? null;
export const deptName = (id) => deptById(id)?.name ?? 'Chưa phân phòng';
/** Tên các phòng trong danh sách, ngăn cách bằng dấu phẩy; bỏ qua mã phòng không còn tồn tại. */
export const deptNames = (ids = []) => ids.map((id) => deptById(id)?.name).filter(Boolean).join(', ');
export const sortedDepartments = () => [...store.departments].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
export const deptNameTaken = (name, exceptId = null) => store.departments
  .some((d) => d.id !== exceptId && fold(d.name) === fold(name));

/**
 * Xóa phòng ban: cán bộ, công việc, đơn thư và phản ánh thuộc phòng này chuyển sang "Chưa phân phòng";
 * phòng này cũng được gỡ khỏi danh sách phòng phối hợp.
 */
export function removeDepartment(id) {
  store.departments = store.departments.filter((d) => d.id !== id);
  const dropCollab = (item) => { item.collabDeptIds = (item.collabDeptIds ?? []).filter((d) => d !== id); };
  for (const person of store.personnel) if (person.deptId === id) person.deptId = null;
  for (const task of store.tasks) {
    if (task.departmentId === id) task.departmentId = null;
    dropCollab(task);
  }
  for (const petition of store.petitions) {
    if (petition.deptId === id) petition.deptId = null;
    dropCollab(petition);
  }
  for (const r of store.reflections) {
    if (r.deptId === id) r.deptId = null;
    dropCollab(r);
  }
  persist();
}

/**
 * Trạng thái hiển thị (công việc, đơn thư, phản ánh, giao việc BTV):
 * "Hoàn thành" giữ nguyên; "Chờ duyệt" giữ nguyên khi chưa qua hạn;
 * còn lại tự tính: quá hạn nếu đã qua hạn chót, sắp đến hạn nếu còn cách hạn không quá SOON_DAYS ngày.
 */
export function effectiveStatus(item, today = dateKey()) {
  if (CLOSED.includes(item.status)) return item.status;
  if (item.status === REVIEW && item.deadline >= today) return REVIEW;
  if (item.deadline < today) return OVERDUE;
  if (item.deadline <= addDays(today, SOON_DAYS)) return SOON;
  return TODO;
}

/** Trạng thái hạn của đơn thư / phản ánh (nhãn và màu): quá hạn, sắp đến hạn, trong hạn, hoặc đã đóng. */
export function dueState(item, closed, today = dateKey()) {
  if (closed) return 'closed';
  const s = effectiveStatus(item, today);
  if (s === OVERDUE) return 'overdue';
  return s === SOON ? 'soon' : 'ok';
}

/** Mã hồ sơ tự tăng theo năm, ví dụ DT-2026-004. */
export function nextCode(prefix, list) {
  const head = `${prefix}-${new Date().getFullYear()}-`;
  const max = list.reduce((m, item) => {
    if (!item.code?.startsWith(head)) return m;
    return Math.max(m, Number(item.code.slice(head.length)) || 0);
  }, 0);
  return `${head}${String(max + 1).padStart(3, '0')}`;
}

export function addTimeline(item, text) {
  item.timeline = item.timeline ?? [];
  item.timeline.push({ id: uid(), at: dateTimeKey(), text });
}

/**
 * Tạo công việc từ đơn thư / phản ánh / BTV, giao cho phòng xử lý chính và các phòng phối hợp.
 * Công việc giữ `sourceId` để liên kết ngược, đơn chuyển sang "Chưa thực hiện" và nhật ký ghi lại việc tạo công việc.
 */
export function createTaskFor(item, source, fields) {
  const task = {
    id: uid(),
    title: fields.title,
    desc: fields.desc ?? '',
    departmentId: fields.departmentId ?? null,
    collabDeptIds: fields.collabDeptIds ?? [],
    deadline: fields.deadline,
    priority: fields.priority ?? 'Trung bình',
    status: 'Chưa thực hiện',
    eventId: null,
    files: [],
    subtasks: [],
    createdAt: Date.now(),
    source,
    sourceId: item.id,
  };
  store.tasks.push(task);
  syncTaskEvent(task, true);
  addTimeline(item, `Đã tạo công việc "${task.title}" cho ${deptName(task.departmentId)}`);
  return task;
}

/**
 * Đồng bộ liên kết, chạy trước mỗi lần lưu:
 * - Khi mọi công việc gắn với đơn / phản ánh đã đóng và vừa có công việc chuyển sang đóng,
 *   đơn / phản ánh tự chuyển sang "Hoàn thành".
 * - Làm mới mô tả và tiêu đề các sự kiện hạn chót (ví dụ sau khi đổi tên phòng hoặc đổi trạng thái).
 */
function syncLinks() {
  const finished = (list) => list.length > 0 && list.every((t) => CLOSED.includes(t.status));
  const justFinished = (list) => list.some((t) => CLOSED.includes(t.status) && !doneTaskIds.has(t.id));
  for (const p of store.petitions) {
    const tasks = tasksOf(p);
    if (p.status === TODO && finished(tasks) && justFinished(tasks)) {
      p.status = DONE;
      addTimeline(p, 'Mọi công việc liên kết đã hoàn thành — chuyển sang "Hoàn thành"');
    }
  }
  for (const r of store.reflections) {
    const tasks = tasksOf(r);
    if (r.status === TODO && finished(tasks) && justFinished(tasks)) {
      r.status = DONE;
      addTimeline(r, 'Công việc xử lý đã hoàn thành — chuyển sang "Hoàn thành"');
    }
  }
  stampClosures();
  doneTaskIds = doneTaskSet();
  for (const task of store.tasks) if (task.eventId) syncTaskEvent(task, true);
  syncItemEvents();
}

/**
 * Đồng bộ hạn xử lý đơn thư và phản ánh vào Lịch công tác (bật mặc định; tắt khi `calendarSync === false`).
 * Sự kiện được gắn qua `itemRef`; sự kiện của đơn / phản ánh đã xóa sẽ bị gỡ.
 */
function syncItemEvents() {
  const items = [
    ...store.petitions.map((p) => ({
      item: p,
      ref: `petition:${p.id}`,
      kind: 'Hạn xử lý đơn thư',
      closed: PETITION_CLOSED.includes(p.status),
      title: `${p.code} · ${p.type}`,
    })),
    ...store.reflections.map((r) => ({
      item: r,
      ref: `reflection:${r.id}`,
      kind: 'Hạn xử lý phản ánh',
      closed: REFLECTION_CLOSED.includes(r.status),
      title: `${r.code} · ${r.area}`,
    })),
  ];
  const live = new Set(items.map((x) => x.ref));
  store.events = store.events.filter((e) => !e.itemRef || live.has(e.itemRef));

  for (const { item, ref, kind, closed, title } of items) {
    const existing = store.events.find((e) => e.itemRef === ref);
    if (item.calendarSync === false) {
      store.events = store.events.filter((e) => e !== existing);
      continue;
    }
    const fields = {
      title: `${closed ? '[Đã xong]' : '[Hạn chót]'} ${title}`,
      type: 'Hạn chót',
      start: `${item.deadline}T17:00`,
      end: `${item.deadline}T17:30`,
      location: 'Hệ thống quản trị (tự động)',
      desc: `${kind}: ${title}\nTrạng thái: ${item.status}`,
      attendeeIds: [],
      itemRef: ref,
    };
    if (existing) Object.assign(existing, fields);
    else store.events.push({ id: uid(), taskId: null, ...fields });
  }
}

export function tasksOf(item) {
  return store.tasks.filter((t) => t.sourceId === item.id);
}

/* ---------- Tự động hóa: quy tắc hành động, công việc định kỳ, ghi chú, ủy quyền ---------- */

/** Đầu việc con mới từ mẫu (checklist). Mỗi lần dùng tạo mục mới để công việc không dùng chung trạng thái. */
export const checklistItems = (id) => (store.checklists.find((c) => c.id === id)?.items ?? [])
  .map((text) => ({ id: uid(), text, done: false }));

/** Quy tắc hành động: đơn / phản ánh mới khớp loại và lĩnh vực thì tự tạo công việc giao cho phòng đã chọn. */
function applyRules(created) {
  let changed = false;
  for (const { kind, item } of created) {
    for (const rule of store.rules) {
      if (!rule.enabled || rule.kind !== kind) continue;
      if (rule.type && item.type !== rule.type) continue;
      if (rule.field && fold(item.field ?? '') !== fold(rule.field)) continue;
      const task = createTaskFor(item, 'noi-bo', {
        title: `${rule.title} · ${item.code ?? ''}`.trim(),
        departmentId: rule.deptId ?? null,
        collabDeptIds: (rule.collabDeptIds ?? []).filter((d) => d && d !== rule.deptId),
        deadline: addDays(dateKey(), rule.days ?? 7),
        priority: rule.priority ?? 'Trung bình',
      });
      task.subtasks = checklistItems(rule.checklistId);
      task.ruleId = rule.id;
      changed = true;
    }
  }
  return changed;
}

const CYCLE_LABEL = { week: 'tuần', month: 'tháng', quarter: 'quý' };
/** Nhãn kỳ, ví dụ "tháng 10/2026", "quý 4/2026", "tuần từ 12/10/2026". */
function periodLabel(cycle, from) {
  if (cycle === 'week') return `tuần từ ${formatDate(from)}`;
  if (cycle === 'quarter') return `quý ${Math.floor((Number(from.slice(5, 7)) - 1) / 3) + 1}/${from.slice(0, 4)}`;
  return `tháng ${from.slice(5, 7)}/${from.slice(0, 4)}`;
}

/** Công việc định kỳ: mỗi mẫu tạo đúng một việc cho kỳ hiện tại (hạn chót là cuối kỳ). */
function runRecurring(today = dateKey()) {
  let changed = false;
  for (const rec of store.recurring) {
    if (!rec.enabled) continue;
    const { from, to } = periodBounds(rec.cycle, today);
    const key = `${rec.cycle}:${from}`;
    if (rec.lastKey === key) continue;
    const task = {
      id: uid(),
      title: `${rec.title} (${periodLabel(rec.cycle, from)})`,
      desc: rec.desc ?? '',
      departmentId: rec.deptId ?? null,
      collabDeptIds: (rec.collabDeptIds ?? []).filter((d) => d && d !== rec.deptId),
      deadline: to,
      priority: rec.priority ?? 'Trung bình',
      status: 'Chưa thực hiện',
      eventId: null,
      files: [],
      subtasks: checklistItems(rec.checklistId),
      createdAt: Date.now(),
      source: 'noi-bo',
      sourceId: null,
      recurId: rec.id,
    };
    store.tasks.push(task);
    syncTaskEvent(task, true);
    rec.lastKey = key;
    changed = true;
  }
  return changed;
}

/** Thêm ghi chú vào công việc. Ai được nhắc bằng "@họ tên đầy đủ" sẽ nhận thông báo. */
export function addNote(task, authorId, text) {
  const hay = fold(text);
  const mentions = store.personnel.filter((p) => hay.includes(`@${fold(p.name)}`)).map((p) => p.id);
  task.notes = [...(task.notes ?? []), { id: uid(), at: dateTimeKey(), authorId: authorId ?? null, text, mentions }];
  persist();
}

/** Chuyển các công việc đang mở của người vắng mặt cho người thay thế. Trả về số công việc đã chuyển. */
export function handOver(fromId, toId) {
  let moved = 0;
  for (const t of store.tasks) {
    if (t.assignerId !== fromId || CLOSED.includes(t.status)) continue;
    t.assignerId = toId;
    moved++;
  }
  if (moved) addActivity({ kind: 'system', action: 'update', name: `Ủy quyền ${moved} công việc sang người thay thế` });
  persist();
  return moved;
}

/* ---------- Thùng rác: xóa có thể hoàn tác trong 30 ngày ---------- */

/** Gỡ các liên kết của mục sắp vào thùng rác; trả về phần cần thiết để khôi phục đúng liên kết. */
function detachLinks(kind, item) {
  const releaseTasks = (tasks) => tasks.map((t) => {
    const saved = { id: t.id, source: t.source };
    t.sourceId = null;
    if (t.source !== 'btv') t.source = 'noi-bo';
    return saved;
  });
  if (kind === 'tasks') {
    const wasSynced = Boolean(item.eventId);
    syncTaskEvent(item, false);
    return { wasSynced };
  }
  if (kind === 'petitions') {
    const tasks = releaseTasks(tasksOf(item));
    const reflections = store.reflections.filter((r) => r.petitionId === item.id).map((r) => ({ id: r.id, status: r.status }));
    for (const r of store.reflections) {
      if (r.petitionId !== item.id) continue;
      r.petitionId = null;
      if (r.status === DONE) {
        r.status = TODO;
        addTimeline(r, 'Đơn thư đã chuyển từ phản ánh này đã bị xóa — phản ánh mở lại để xử lý');
      }
    }
    return { tasks, reflections };
  }
  if (kind === 'reflections') {
    const tasks = releaseTasks(tasksOf(item));
    const petitions = store.petitions.filter((p) => p.reflectionId === item.id).map((p) => p.id);
    for (const p of store.petitions) if (p.reflectionId === item.id) p.reflectionId = null;
    return { tasks, petitions };
  }
  if (kind === 'personnel') {
    const events = store.events.filter((e) => e.attendeeIds?.includes(item.id)).map((e) => e.id);
    for (const e of store.events) if (e.attendeeIds?.includes(item.id)) e.attendeeIds = e.attendeeIds.filter((a) => a !== item.id);
    const tasks = store.tasks.filter((t) => t.assignerId === item.id).map((t) => t.id);
    for (const t of store.tasks) if (t.assignerId === item.id) t.assignerId = null;
    return { events, tasks };
  }
  if (kind === 'events' && item.taskId) {
    const task = taskById(item.taskId);
    if (task && task.eventId === item.id) task.eventId = null;
  }
  return {};
}

/** Gắn lại liên kết cho mục vừa khôi phục từ thùng rác. */
function reattach(kind, item, extra) {
  if (kind === 'tasks' && extra.wasSynced) syncTaskEvent(item, true);
  if (kind === 'petitions' || kind === 'reflections') {
    for (const t of extra.tasks ?? []) {
      const task = taskById(t.id);
      if (task) {
        task.sourceId = item.id;
        task.source = t.source;
      }
    }
  }
  if (kind === 'petitions') {
    for (const r of extra.reflections ?? []) {
      const refl = reflectionById(r.id);
      if (refl) {
        refl.petitionId = item.id;
        refl.status = r.status;
      }
    }
  }
  if (kind === 'reflections') {
    for (const pid of extra.petitions ?? []) {
      const p = petitionById(pid);
      if (p) p.reflectionId = item.id;
    }
  }
  if (kind === 'personnel') {
    for (const eid of extra.events ?? []) {
      const ev = eventById(eid);
      if (ev) ev.attendeeIds = [...new Set([...(ev.attendeeIds ?? []), item.id])];
    }
    for (const tid of extra.tasks ?? []) {
      const task = taskById(tid);
      if (task) task.assignerId = item.id;
    }
  }
  if (kind === 'events' && item.taskId) {
    const task = taskById(item.taskId);
    if (task && !task.eventId) task.eventId = item.id;
  }
}

/** Chuyển các mục vào thùng rác (không xóa tệp đính kèm cho tới khi hết hạn). Trả về mã các mục trong thùng rác. */
export function moveToTrash(kind, ids) {
  const entries = [];
  for (const id of ids) {
    const item = store[kind].find((x) => x.id === id);
    if (!item) continue;
    const extra = detachLinks(kind, item);
    store[kind] = store[kind].filter((x) => x !== item);
    const entry = { id: uid(), kind, item, extra, deletedAt: Date.now() };
    store.trash.unshift(entry);
    entries.push(entry.id);
  }
  persist();
  return entries;
}

/** Khôi phục các mục từ thùng rác về đúng nơi cũ, kèm liên kết. */
export function restoreFromTrash(entryIds) {
  let restored = 0;
  for (const entryId of entryIds) {
    const entry = store.trash.find((e) => e.id === entryId);
    if (!entry) continue;
    store.trash = store.trash.filter((e) => e !== entry);
    const { kind, item, extra = {} } = entry;
    if (store[kind].some((x) => x.id === item.id)) continue;
    // Sự kiện tự động của đơn / phản ánh đã được tạo lại khi lưu: không khôi phục thêm một bản trùng
    if (kind === 'events' && item.itemRef && store.events.some((e) => e.itemRef === item.itemRef)) continue;
    store[kind].push(item);
    reattach(kind, item, extra);
    seen[kind]?.set(item.id, { json: JSON.stringify(plain(item)), name: NAMES[kind](item) });
    addActivity({ kind, action: 'restore', name: NAMES[kind](item) });
    restored++;
  }
  persist();
  return restored;
}

/** Đưa các mục trong thùng rác quá 30 ngày vào diện xóa hẳn, kèm tệp đính kèm của chúng. */
export function purgeTrash(now = Date.now()) {
  const cutoff = now - TRASH_DAYS * 86400000;
  const expired = store.trash.filter((e) => e.deletedAt < cutoff);
  if (!expired.length) return 0;
  store.trash = store.trash.filter((e) => e.deletedAt >= cutoff);
  deleteBlobs(attachmentIdsOf(expired)).catch((err) => console.warn(err));
  persist();
  return expired.length;
}

/** Xóa hẳn các mục đã chọn khỏi thùng rác, kèm tệp đính kèm. Trả về số mục đã xóa. */
export function deleteFromTrash(entryIds) {
  const picked = new Set(entryIds);
  const gone = store.trash.filter((e) => picked.has(e.id));
  if (!gone.length) return 0;
  store.trash = store.trash.filter((e) => !picked.has(e.id));
  deleteBlobs(attachmentIdsOf(gone)).catch((err) => console.warn(err));
  addActivity({ kind: 'system', action: 'purge', name: `${gone.length} mục` });
  persist();
  return gone.length;
}

export function emptyTrash() {
  const ids = attachmentIdsOf(store.trash);
  const count = store.trash.length;
  store.trash = [];
  deleteBlobs(ids).catch((err) => console.warn(err));
  addActivity({ kind: 'system', action: 'empty-trash', name: `${count} mục` });
  persist();
}

const attachmentIdsOf = (entries) => entries
  .flatMap((e) => (e.item.files ?? []))
  .filter((f) => !f.sample)
  .map((f) => f.id);

/** Xóa (đưa vào thùng rác) kèm nút "Hoàn tác" trên thông báo. */
export function trashWithUndo(kind, ids, label) {
  const entries = moveToTrash(kind, ids);
  if (!entries.length) return;
  const message = entries.length === 1 ? `Đã chuyển ${label} vào thùng rác` : `Đã chuyển ${entries.length} ${label} vào thùng rác`;
  toast(message, 'success', {
    label: 'Hoàn tác',
    onClick: () => {
      restoreFromTrash(entries);
      toast('Đã khôi phục', 'success');
    },
  });
}

/* ---------- Thư viện: lưu nội dung để xem lại; mục được gỡ khỏi màn hình gốc (kèm liên kết) và không tự hết hạn ---------- */

/** Lưu các mục vào thư viện. `section` cho biết màn hình gốc: btv / tasks / petitions / reflections. Trả về mã các mục trong thư viện. */
export function saveToLibrary(kind, ids) {
  const entries = [];
  for (const id of ids) {
    const item = store[kind].find((x) => x.id === id);
    if (!item) continue;
    const section = kind === 'tasks' && item.source === 'btv' ? 'btv' : kind;
    const extra = detachLinks(kind, item);
    store[kind] = store[kind].filter((x) => x !== item);
    const entry = { id: uid(), kind, section, item, extra, savedAt: Date.now() };
    store.library.unshift(entry);
    entries.push(entry.id);
  }
  persist();
  return entries;
}

/** Lưu vào thư viện kèm nút "Hoàn tác" trên thông báo. */
export function libraryWithUndo(kind, ids, label) {
  const entries = saveToLibrary(kind, ids);
  if (!entries.length) return;
  toast(`Đã lưu ${label} vào thư viện`, 'success', {
    label: 'Hoàn tác',
    onClick: () => {
      restoreFromLibrary(entries);
      toast('Đã khôi phục', 'success');
    },
  });
}

/** Đưa mục từ thư viện về đúng màn hình cũ, kèm liên kết. Mục đã có sẵn trên màn hình thì chỉ bỏ khỏi thư viện. */
export function restoreFromLibrary(entryIds) {
  let restored = 0;
  for (const entryId of entryIds) {
    const entry = store.library.find((e) => e.id === entryId);
    if (!entry) continue;
    store.library = store.library.filter((e) => e !== entry);
    const { kind, item, extra = {} } = entry;
    if (store[kind].some((x) => x.id === item.id)) continue;
    store[kind].push(item);
    reattach(kind, item, extra);
    seen[kind]?.set(item.id, { json: JSON.stringify(plain(item)), name: NAMES[kind](item) });
    addActivity({ kind, action: 'restore', name: NAMES[kind](item) });
    restored++;
  }
  persist();
  return restored;
}

/** Xóa hẳn các mục đã chọn khỏi thư viện, kèm tệp đính kèm. Trả về số mục đã xóa. */
export function deleteFromLibrary(entryIds) {
  const picked = new Set(entryIds);
  const gone = store.library.filter((e) => picked.has(e.id));
  if (!gone.length) return 0;
  store.library = store.library.filter((e) => !picked.has(e.id));
  deleteBlobs(attachmentIdsOf(gone)).catch((err) => console.warn(err));
  addActivity({ kind: 'system', action: 'purge', name: `${gone.length} mục trong thư viện` });
  persist();
  return gone.length;
}

/* ---------- Xóa ---------- */

export function syncTaskEvent(task, enabled) {
  const existing = eventById(task.eventId);
  if (!enabled) {
    if (existing) store.events = store.events.filter((e) => e.id !== existing.id);
    task.eventId = null;
    return;
  }
  const fields = {
    title: `${CLOSED.includes(task.status) ? '[Đã xong]' : '[Hạn chót]'} ${task.title}`,
    type: 'Hạn chót',
    start: `${task.deadline}T17:00`,
    end: `${task.deadline}T17:30`,
    location: 'Hệ thống quản trị (tự động)',
    desc: [
      `Nhiệm vụ: ${task.title}`,
      `Phòng xử lý chính: ${deptName(task.departmentId)}`,
      task.collabDeptIds?.length ? `Phòng phối hợp: ${deptNames(task.collabDeptIds)}` : '',
      `Trạng thái: ${task.status}`,
      `Độ ưu tiên: ${task.priority}`,
      task.desc ? `Chi tiết: ${task.desc}` : '',
    ].filter(Boolean).join('\n'),
    attendeeIds: [],
    taskId: task.id,
  };
  if (existing) {
    Object.assign(existing, fields);
  } else {
    const event = { id: uid(), ...fields };
    store.events.push(event);
    task.eventId = event.id;
  }
}

export const removeTask = (id) => trashWithUndo('tasks', [id], 'công việc');
export const removePetition = (id) => trashWithUndo('petitions', [id], 'đơn thư');
export const removeReflection = (id) => trashWithUndo('reflections', [id], 'phản ánh');
export const removeEvent = (id) => trashWithUndo('events', [id], 'sự kiện');
export const removePerson = (id) => trashWithUndo('personnel', [id], 'cán bộ');

/* Tình trạng cũ của từng mục → tình trạng hiện tại (chỉ dùng khi chuyển dữ liệu). */
const STATUS_REMAP = {
  tasks: { 'Đang thực hiện': TODO, [OVERDUE]: TODO, [FILED]: DONE },
  petitions: { 'Đang xử lý': TODO, 'Tiếp nhận': TODO, 'Mới': TODO, 'Đã giải quyết': DONE, [FILED]: DONE },
  reflections: { 'Mới': TODO, 'Quá hạn': TODO, 'Đang xử lý': TODO, 'Đã xử lý': DONE, 'Đã chuyển đơn thư': DONE, [FILED]: DONE },
};

/**
 * Chuyển dữ liệu cũ sang mô hình hiện tại:
 * - Phòng ban ghi bằng tên (`dept`, `department`) → danh mục có mã (`deptId`, `departmentId`).
 * - Bỏ tên đăng nhập và quyền hệ thống đã xóa khỏi cán bộ.
 * Trả về true nếu có dữ liệu được chuyển đổi.
 */
function migrate() {
  let changed = false;
  if (!store.departments.length && store.personnel.some((p) => 'dept' in p)) {
    store.departments = DEPARTMENTS.map((name) => ({ id: uid(), name }));
    changed = true;
  }
  const idFor = (name) => {
    if (!name) return null;
    let dept = store.departments.find((d) => fold(d.name) === fold(name));
    if (!dept) {
      dept = { id: uid(), name };
      store.departments.push(dept);
    }
    return dept.id;
  };
  store.personnel = store.personnel.map((raw) => {
    if (!('dept' in raw) && !('username' in raw) && !('role' in raw)) return raw;
    changed = true;
    const { username, role, dept, ...person } = raw;
    return { ...person, deptId: idFor(dept) };
  });
  // Công việc giao cho cá nhân → giao cho phòng của cá nhân đó (phòng xử lý chính và phòng phối hợp)
  const deptOfPerson = (pid) => store.personnel.find((p) => p.id === pid)?.deptId ?? null;
  store.tasks = store.tasks.map((raw) => {
    const legacy = ['department', 'assigneeId', 'collabId'].some((key) => key in raw) || !('collabDeptIds' in raw);
    if (!legacy) return raw;
    changed = true;
    const { department, assigneeId, collabId, ...task } = raw;
    const departmentId = (department ? idFor(department) : null) ?? task.departmentId ?? deptOfPerson(assigneeId) ?? null;
    const collabDeptIds = [...(task.collabDeptIds ?? []), deptOfPerson(collabId)]
      .filter((d, i, all) => d && d !== departmentId && all.indexOf(d) === i);
    return { ...task, departmentId, collabDeptIds };
  });
  store.petitions = store.petitions.map((p) => {
    if ('collabDeptIds' in p) return p;
    changed = true;
    return { ...p, collabDeptIds: [] };
  });
  // Trạng thái cũ → bộ trạng thái chung (xem STATUS_REMAP)
  for (const [kind, map] of Object.entries(STATUS_REMAP)) {
    for (const item of store[kind]) {
      if (!(item.status in map)) continue;
      item.status = map[item.status];
      changed = true;
    }
  }
  store.reflections = store.reflections.map((r) => {
    if ('deptId' in r && 'collabDeptIds' in r) return r;
    changed = true;
    return { ...r, deptId: r.deptId ?? classify(r.content ?? '', store.departments).deptId, collabDeptIds: r.collabDeptIds ?? [] };
  });
  // Lịch đồng bộ từ công việc không còn gắn cán bộ
  for (const ev of store.events) {
    if (ev.taskId && ev.attendeeIds?.length) {
      ev.attendeeIds = [];
      changed = true;
    }
  }
  return changed;
}

/* ---------- Dữ liệu mẫu: 5 bản ghi cho mỗi chức năng (ngày tương đối so với hôm nay) ---------- */
function seed() {
  const today = dateKey();
  const year = new Date().getFullYear();
  const at = (days) => addDays(today, days);
  const code = (prefix, n) => `${prefix}-${year}-${String(n).padStart(3, '0')}`;
  store.departments = DEPARTMENTS.map((name) => ({ id: uid(), name }));
  const dept = (name) => store.departments.find((d) => d.name === name).id;
  const LD = 'Lãnh đạo';
  const VP = 'Văn phòng HĐND và UBND';
  const KT = 'Phòng Kinh tế';
  const VH = 'Phòng Văn hóa - Xã hội';

  // Cán bộ
  store.personnel = [
    { id: 'p1', name: 'Lê Minh Quân', title: 'Chủ tịch', deptId: dept(LD), phone: '0901234567' },
    { id: 'p2', name: 'Trần Thị Bích', title: 'Phó Chủ tịch', deptId: dept(LD), phone: '0912345678' },
    { id: 'p3', name: 'Lê Văn Cường', title: 'Chánh Văn phòng', deptId: dept(VP), phone: '0923456789' },
    { id: 'p4', name: 'Phạm Thị Dung', title: 'Chuyên viên', deptId: dept(KT), phone: '0934567890' },
    { id: 'p5', name: 'Hoàng Văn Em', title: 'Chuyên viên', deptId: dept(VH), phone: '0945678901' },
  ];

  // Giao việc TTUB (source 'noi-bo') và Giao việc BTV (source 'btv') cùng nằm trong store.tasks, phân biệt bằng `source`
  const makeTask = (fields) => ({
    desc: '', collabDeptIds: [], files: [], subtasks: [], eventId: null,
    createdAt: Date.now(), source: 'noi-bo', sourceId: null, ...fields,
  });
  store.tasks = [
    makeTask({
      id: 't1', title: 'Báo cáo thu ngân sách tháng này', desc: 'Tổng hợp số liệu thu chi từ các bộ phận.',
      departmentId: dept(VP), deadline: at(5), priority: 'Cao', status: TODO,
      subtasks: [
        { id: 's1', text: 'Thu thập số liệu các phòng', done: true },
        { id: 's2', text: 'Tổng hợp và đối chiếu', done: false },
      ],
    }),
    makeTask({
      id: 't2', title: 'Chuẩn bị hội trường họp giao ban', desc: 'Chuẩn bị âm thanh, ánh sáng, bàn ghế.',
      departmentId: dept(VP), collabDeptIds: [dept(KT)], deadline: at(2), priority: 'Trung bình', status: 'Chưa thực hiện',
    }),
    makeTask({
      id: 't3', title: 'Rà soát hồ sơ bồi thường thôn 2', desc: 'Đối chiếu danh sách hộ bị thu hồi đất với hồ sơ đã lập.',
      departmentId: dept(KT), collabDeptIds: [dept(VP)], deadline: at(-2), priority: 'Cao', status: TODO,
      subtasks: [
        { id: 's3', text: 'Đối chiếu danh sách hộ', done: true },
        { id: 's4', text: 'Kiểm tra phương án bồi thường', done: false },
      ],
    }),
    makeTask({
      id: 't4', title: 'Tổng hợp ý kiến tiếp dân quý', desc: 'Gộp ý kiến từ sổ tiếp dân, phân loại theo lĩnh vực.',
      departmentId: dept(VH), deadline: at(9), priority: 'Thấp', status: 'Chờ duyệt',
      subtasks: [
        { id: 's5', text: 'Gộp số liệu từ sổ tiếp dân', done: true },
        { id: 's6', text: 'Phân loại theo lĩnh vực', done: true },
      ],
    }),
    makeTask({
      id: 't5', title: 'Lập kế hoạch tuyên truyền an toàn giao thông', desc: 'Lịch tuyên truyền tại 5 thôn trong quý.',
      departmentId: dept(VH), collabDeptIds: [dept(VP), dept(KT)], deadline: at(20), priority: 'Trung bình', status: DONE,
    }),
    makeTask({
      id: 'b1', title: 'Triển khai Nghị quyết về thu ngân sách quý', desc: 'Báo cáo tiến độ theo kế hoạch Ban Thường vụ.',
      departmentId: dept(LD), collabDeptIds: [dept(VP)], deadline: at(12), priority: 'Cao', status: TODO, source: 'btv',
      btv: { resolutionNo: 'NQ 05-NQ/BTV', issuedAt: at(-10), reportDue: at(2), reported: false, reportedAt: null },
    }),
    makeTask({
      id: 'b2', title: 'Kết luận về công tác giải phóng mặt bằng', desc: 'Hoàn thành thủ tục thu hồi đất cho dự án đường liên thôn.',
      departmentId: dept(KT), collabDeptIds: [dept(LD)], deadline: at(-4), priority: 'Cao', status: TODO, source: 'btv',
      btv: { resolutionNo: 'TB 03-TB/BTV', issuedAt: at(-30), reportDue: at(-6), reported: false, reportedAt: null },
    }),
    makeTask({
      id: 'b3', title: 'Đẩy mạnh chuyển đổi số trong cấp xã', desc: 'Số hóa quy trình tiếp nhận và trả kết quả.',
      departmentId: dept(VP), collabDeptIds: [dept(KT), dept(VH)], deadline: at(30), priority: 'Trung bình', status: 'Chưa thực hiện', source: 'btv',
      btv: { resolutionNo: 'NQ 08-NQ/BTV', issuedAt: at(-5), reportDue: at(20), reported: false, reportedAt: null },
    }),
    makeTask({
      id: 'b4', title: 'Tổ chức thực hiện đề án xây dựng nông thôn mới', desc: 'Đã hoàn thành các hạng mục theo kế hoạch.',
      departmentId: dept(VH), deadline: at(-3), priority: 'Trung bình', status: DONE, source: 'btv',
      btv: { resolutionNo: 'NQ 02-NQ/BTV', issuedAt: at(-40), reportDue: at(-20), reported: true, reportedAt: `${at(-21)}T09:00` },
    }),
    makeTask({
      id: 'b5', title: 'Tăng cường tiếp dân và giải quyết khiếu nại', desc: 'Giao Thường trực tiếp dân và rà soát vụ việc tồn đọng.',
      departmentId: dept(LD), collabDeptIds: [dept(VP)], deadline: at(45), priority: 'Cao', status: 'Chưa thực hiện', source: 'btv',
      btv: { resolutionNo: 'KL 01-TB/BTV', issuedAt: at(-2), reportDue: at(40), reported: false, reportedAt: null },
    }),
  ];

  // Đơn thư, PAKN. Hạn xử lý theo loại đơn. d1 và d5 cùng số điện thoại, nội dung gần giống (để thử cảnh báo đơn trùng).
  // d3 đã chuyển từ phản ánh r3 (liên kết hai chiều).
  store.petitions = [
    {
      id: 'd1', code: code('DT', 1), type: 'Khiếu nại', channel: 'Trực tiếp', receivedAt: at(-3),
      citizen: { name: 'Nguyễn Văn An', phone: '0977112233', address: 'Thôn 2' },
      field: 'Đất đai – bồi thường', deptId: dept(KT), collabDeptIds: [],
      content: 'Gia đình tôi chưa nhận được tiền bồi thường khi Nhà nước thu hồi đất ở tại thôn 2.',
      deadline: dueDateFor('Khiếu nại', at(-3)), status: TODO, reflectionId: null, timeline: [], files: [],
    },
    {
      id: 'd2', code: code('DT', 2), type: 'Tố cáo', channel: 'Bưu điện', receivedAt: at(-20),
      citizen: { name: 'Trần Văn Bình', phone: '0988000111', address: 'Thôn 5' },
      field: 'Hành chính – Công vụ', deptId: dept(VP), collabDeptIds: [],
      content: 'Đề nghị xem xét việc cán bộ hướng dẫn hồ sơ chậm trễ, gây khó khăn cho người dân.',
      deadline: dueDateFor('Tố cáo', at(-20)), status: TODO, reflectionId: null, timeline: [], files: [],
    },
    {
      id: 'd3', code: code('DT', 3), type: 'Kiến nghị', channel: 'Trực tuyến', receivedAt: at(-12),
      citizen: { name: 'Phạm Thị Hoa', phone: '0966222333', address: 'Thôn 1' },
      field: 'Giáo dục – Y tế', deptId: dept(VH), collabDeptIds: [],
      content: 'Đề nghị bổ sung phòng học cho Trường tiểu học thôn 1 vì lớp học đang quá tải.',
      deadline: dueDateFor('Kiến nghị', at(-12)), status: TODO, reflectionId: 'r3', timeline: [], files: [],
    },
    {
      id: 'd4', code: code('DT', 4), type: 'Phản ánh', channel: 'Điện thoại', receivedAt: at(-40),
      citizen: { name: 'Đỗ Thị Lan', phone: '0955444555', address: 'Thôn 4' },
      field: 'Chính sách xã hội', deptId: dept(VH), collabDeptIds: [],
      content: 'Hộ nghèo chưa được nhận hỗ trợ tiền điện trong quý trước.',
      deadline: dueDateFor('Phản ánh', at(-40)), status: DONE, reflectionId: null, timeline: [], files: [],
    },
    {
      id: 'd5', code: code('DT', 5), type: 'Khiếu nại', channel: 'Trực tiếp', receivedAt: at(-1),
      citizen: { name: 'Nguyễn Văn An', phone: '0977112233', address: 'Thôn 2' },
      field: 'Đất đai – bồi thường', deptId: dept(KT), collabDeptIds: [],
      content: 'Gia đình tôi chưa nhận được tiền bồi thường khi Nhà nước thu hồi đất ở tại thôn 2, đề nghị giải quyết sớm.',
      deadline: dueDateFor('Khiếu nại', at(-1)), status: TODO, reflectionId: null, timeline: [], files: [],
    },
  ];

  // Phản ánh 1022. r1 đã quá hạn (minh họa cảnh báo).
  store.reflections = [
    {
      id: 'r1', code: code('PA', 1), receivedAt: at(-10), area: 'Thôn 3', citizen: { name: '', phone: '' },
      field: 'Xây dựng – Môi trường', deptId: dept(KT), collabDeptIds: [],
      content: 'Nước thải từ cơ sở chăn nuôi chảy ra kênh thôn 3, gây mùi hôi kéo dài.',
      deadline: at(-3), status: TODO, petitionId: null, timeline: [],
    },
    {
      id: 'r2', code: code('PA', 2), receivedAt: at(-6), area: 'Thôn 1', citizen: { name: 'Lê Thị Hạnh', phone: '0944333222' },
      field: 'Xây dựng – Môi trường', deptId: dept(KT), collabDeptIds: [dept(VP)],
      content: 'Đường bê tông liên thôn xuống cấp, nhiều ổ gà vào mùa mưa.',
      deadline: at(1), status: TODO, petitionId: null, timeline: [],
    },
    {
      id: 'r3', code: code('PA', 3), receivedAt: at(-12), area: 'Thôn 1', citizen: { name: 'Phạm Thị Hoa', phone: '0966222333' },
      field: 'Giáo dục – Y tế', deptId: dept(VH), collabDeptIds: [],
      content: 'Trường tiểu học thôn 1 thiếu phòng học, lớp 1 phải học ca ba.',
      deadline: at(-5), status: DONE, petitionId: 'd3', timeline: [],
    },
    {
      id: 'r4', code: code('PA', 4), receivedAt: at(-2), area: 'Khu phố 2', citizen: { name: '', phone: '' },
      field: 'An ninh – Trật tự', deptId: dept(VP), collabDeptIds: [],
      content: 'Nhiều xe tải chạy quá tải, quá giờ qua khu dân cư gây ồn và bụi.',
      deadline: at(5), status: TODO, petitionId: null, timeline: [],
    },
    {
      id: 'r5', code: code('PA', 5), receivedAt: at(-20), area: 'Thôn 4', citizen: { name: '', phone: '' },
      field: 'Chính sách xã hội', deptId: dept(VH), collabDeptIds: [],
      content: 'Hồ sơ người có công chưa được cập nhật đầy đủ trong danh sách hỗ trợ.',
      deadline: at(-13), status: DONE, petitionId: null, timeline: [],
    },
  ];
  store.petitions.forEach((p) => addTimeline(p, `Tiếp nhận đơn qua ${p.channel.toLowerCase()}`));
  store.reflections.forEach((r) => addTimeline(r, 'Tiếp nhận phản ánh'));
  addTimeline(reflectionById('r3'), `Đã chuyển thành đơn thư ${petitionById('d3').code}`);

  // Lịch công tác: 5 sự kiện tự tạo. Hạn chót của công việc, đơn thư, phản ánh được tự động thêm vào lịch (17:00).
  store.events = [
    {
      id: 'e1', title: 'Họp giao ban UBND Xã', type: 'Sự kiện', start: `${at(1)}T08:00`, end: `${at(1)}T09:30`,
      location: 'Phòng họp số 1', desc: 'Giao ban thường kỳ', attendeeIds: ['p1', 'p2', 'p3'], taskId: null,
    },
    {
      id: 'e2', title: 'Kiểm tra thực địa dự án thôn 2', type: 'Sự kiện', start: `${at(3)}T14:00`, end: `${at(3)}T16:30`,
      location: 'Thôn 2', desc: 'Đối chiếu thực tế với hồ sơ bồi thường', attendeeIds: ['p3', 'p4'], taskId: null,
    },
    {
      id: 'e3', title: 'Làm việc với Ban Thường vụ về báo cáo quý', type: 'Sự kiện', start: `${at(6)}T09:00`, end: `${at(6)}T11:00`,
      location: 'Phòng Thường vụ', desc: 'Báo cáo tiến độ Nghị quyết thu ngân sách', attendeeIds: ['p1', 'p2'], taskId: null,
    },
    {
      id: 'e4', title: 'Tiếp công dân định kỳ', type: 'Sự kiện', start: `${at(0)}T14:00`, end: `${at(0)}T16:00`,
      location: 'Phòng tiếp dân', desc: 'Tiếp công dân theo lịch', attendeeIds: ['p3', 'p5'], taskId: null,
    },
    {
      id: 'e5', title: 'Rà soát tiến độ đơn thư tháng', type: 'Sự kiện', start: `${at(-2)}T09:30`, end: `${at(-2)}T10:30`,
      location: 'Phòng họp số 2', desc: 'Kiểm tra các đơn quá hạn', attendeeIds: ['p1', 'p4', 'p5'], taskId: null,
    },
  ];
  store.tasks.forEach((task) => syncTaskEvent(task, true));
}
