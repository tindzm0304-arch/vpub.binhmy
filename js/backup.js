/* Sao lưu và khôi phục toàn bộ dữ liệu ra một file JSON, có thể kèm nội dung tệp đính kèm.
   Ngoài ra tự sao lưu hằng ngày vào IndexedDB (giữ 7 bản) để có thể quay lại khi lỡ tay.
   Mọi xử lý chạy trên trình duyệt, không gửi dữ liệu đi đâu. */
import { snapshot, restoreStore, mergeStore, planMerge, store } from './store.js';
import { getBlob, saveBlob, saveSnapshot, listSnapshots, getSnapshot, deleteSnapshot } from './files.js';
import { getSettings, saveSettings } from './settings.js';
import { dateKey, dateTimeKey, timeKey, parseDateTime } from './utils.js';

const FORMAT = 'quan-ly-noi-bo-backup';
const VERSION = 1;
/* Dữ liệu ngay trước lần khôi phục gần nhất, để hoàn tác. */
const UNDO_KEY = 'quan-ly-noi-bo:truoc-khoi-phuc';
const COLLECTIONS = ['departments', 'personnel', 'tasks', 'events', 'petitions', 'reflections'];
export const AUTO_KEEP = 7;
const DAY_MS = 86400000;

export const COUNT_LABELS = {
  tasks: 'công việc', petitions: 'đơn thư', reflections: 'phản ánh', events: 'lịch', personnel: 'cán bộ', departments: 'phòng ban',
};

export function countsOf(data) {
  return Object.fromEntries(COLLECTIONS.map((key) => [key, data[key]?.length ?? 0]));
}

/** Mã các tệp đính kèm thật (bỏ tệp mẫu không có nội dung), kể cả tệp của mục trong thùng rác. */
function attachmentIds(data) {
  const items = [
    ...(data.tasks ?? []), ...(data.petitions ?? []), ...(data.reflections ?? []),
    ...(data.trash ?? []).map((entry) => entry.item).filter(Boolean),
    ...(data.library ?? []).map((entry) => entry.item).filter(Boolean),
  ];
  return items
    .flatMap((item) => item.files ?? [])
    .filter((f) => !f.sample)
    .map((f) => f.id);
}

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

const dataUrlToBlob = (url) => fetch(url).then((res) => res.blob());

function download(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Số ngày từ lần sao lưu gần nhất; null nếu chưa sao lưu lần nào. */
export function daysSinceBackup() {
  const last = getSettings().lastBackupAt;
  if (!last) return null;
  return Math.floor((Date.now() - parseDateTime(last).getTime()) / DAY_MS);
}

/**
 * Tải file sao lưu. `withFiles` kèm nội dung tệp đính kèm (file sẽ lớn hơn).
 * Trả về số tệp đã kèm và số tệp không tìm thấy nội dung trên máy này.
 */
export async function exportBackup({ withFiles = false } = {}) {
  const data = snapshot();
  const files = {};
  let missing = 0;
  if (withFiles) {
    for (const id of attachmentIds(data)) {
      const blob = await getBlob(id);
      if (blob) files[id] = await blobToDataUrl(blob);
      else missing++;
    }
  }
  const payload = { format: FORMAT, version: VERSION, exportedAt: dateTimeKey(), counts: countsOf(data), data, files };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  download(blob, `sao-luu-quan-ly-noi-bo-${dateKey()}-${timeKey().replace(':', '')}.json`);
  saveSettings({ lastBackupAt: dateTimeKey() });
  return { files: Object.keys(files).length, missing };
}

/** Đọc và kiểm tra file sao lưu. Ném lỗi kèm lý do dễ hiểu nếu file không hợp lệ. */
export async function readBackup(file) {
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    throw new Error('File không phải bản sao lưu hợp lệ (không đọc được nội dung JSON).');
  }
  if (payload?.format !== FORMAT || typeof payload.data !== 'object' || !payload.data) {
    throw new Error('File này không phải bản sao lưu của hệ thống Quản lý Nội bộ.');
  }
  if (payload.version > VERSION) {
    throw new Error('Bản sao lưu được tạo từ phiên bản mới hơn. Hãy cập nhật ứng dụng trước khi khôi phục.');
  }
  const bad = COLLECTIONS.find((key) => key in payload.data && !Array.isArray(payload.data[key]));
  if (bad) throw new Error(`Bản sao lưu bị lỗi ở phần "${bad}".`);
  return { ...payload, counts: countsOf(payload.data), fileCount: Object.keys(payload.files ?? {}).length };
}

/** Giữ dữ liệu hiện tại để hoàn tác trước khi ghi đè; trả về false nếu trình duyệt không đủ chỗ. */
function saveUndo() {
  try {
    localStorage.setItem(UNDO_KEY, JSON.stringify({ at: dateTimeKey(), data: snapshot() }));
    return true;
  } catch {
    return false;
  }
}

/** Lưu các tệp đính kèm của bản sao lưu vào máy (trước khi ghi dữ liệu). */
async function restoreFiles(payload) {
  for (const [id, url] of Object.entries(payload.files ?? {})) {
    await saveBlob(id, await dataUrlToBlob(url));
  }
}

/**
 * Ghi đè dữ liệu bằng bản sao lưu. Dữ liệu hiện tại được giữ lại để hoàn tác;
 * trả về false nếu trình duyệt không đủ chỗ giữ bản hoàn tác (vẫn khôi phục).
 */
export async function applyBackup(payload) {
  const undoSaved = saveUndo();
  await restoreFiles(payload);
  restoreStore(payload.data);
  return undoSaved;
}

/** Gộp bản sao lưu vào dữ liệu hiện có (không xóa gì trên máy). Trả về thống kê để hiển thị. */
export async function applyMerge(payload) {
  const undoSaved = saveUndo();
  await restoreFiles(payload);
  const plan = mergeStore(payload.data);
  return { undoSaved, plan };
}

/** Thống kê gộp: mục mới, mục sẽ cập nhật, mục chỉ có trên máy. */
export function previewMerge(payload) {
  return planMerge(payload.data);
}

/** Thời điểm của bản hoàn tác, hoặc null nếu không có. */
export function undoInfo() {
  try {
    const saved = JSON.parse(localStorage.getItem(UNDO_KEY) || 'null');
    return saved ? { at: saved.at, counts: countsOf(saved.data ?? {}) } : null;
  } catch {
    return null;
  }
}

/** Quay lại dữ liệu ngay trước lần khôi phục / gộp gần nhất. */
export function undoRestore() {
  const saved = JSON.parse(localStorage.getItem(UNDO_KEY) || 'null');
  if (!saved?.data) return false;
  restoreStore(saved.data, 'undo-restore');
  localStorage.removeItem(UNDO_KEY);
  return true;
}

/* ---------- Bản sao lưu tự động (IndexedDB, mỗi ngày một bản, giữ 7 bản) ---------- */

/** Lưu một bản tự động ngay bây giờ (không kèm tệp đính kèm để nhẹ). */
export async function takeAutoSnapshot() {
  const data = snapshot();
  const now = Date.now();
  await saveSnapshot({
    id: String(now).padStart(15, '0'),
    at: dateTimeKey(new Date(now)),
    counts: countsOf(data),
    json: JSON.stringify(data),
  });
  const all = await listSnapshots();
  for (const old of all.slice(AUTO_KEEP)) await deleteSnapshot(old.id);
  saveSettings({ lastAutoBackupAt: dateTimeKey(new Date(now)) });
}

/** Nếu đã quá một ngày kể từ bản tự động gần nhất thì lưu thêm một bản. */
export async function autoBackupIfDue() {
  const { autoBackup, lastAutoBackupAt } = getSettings();
  if (!autoBackup) return;
  const hasData = store.tasks.length + store.petitions.length + store.reflections.length + store.personnel.length > 0;
  if (!hasData) return;
  if (lastAutoBackupAt && Date.now() - parseDateTime(lastAutoBackupAt).getTime() < DAY_MS) return;
  try {
    await takeAutoSnapshot();
  } catch (err) {
    console.warn('Không tự sao lưu được trên trình duyệt này.', err);
  }
}

export const listAutoSnapshots = () => listSnapshots().catch(() => []);

/** Khôi phục từ một bản tự động (dữ liệu hiện tại vẫn giữ để hoàn tác). */
export async function restoreAutoSnapshot(id) {
  const entry = await getSnapshot(id);
  if (!entry) throw new Error('Không tìm thấy bản sao lưu tự động này.');
  return applyBackup({ data: JSON.parse(entry.json), files: {} });
}

export const removeAutoSnapshot = (id) => deleteSnapshot(id);
