/* Dự báo và cảnh báo sớm dựa trên lịch sử xử lý có sẵn trên máy: không dùng AI, không gửi dữ liệu đi đâu.
   - Thời gian xử lý trung bình theo phòng (từ lúc giao đến lúc hoàn thành, 180 ngày gần nhất).
   - Nguy cơ trễ hạn của từng công việc đang mở: so số ngày cần với số ngày còn lại.
   - Phòng quá tải: số việc đang mở cao hơn mức trung bình các phòng. */
import { store, sortedDepartments } from './store.js';
import { daysBetween } from './stats.js';
import { dateKey, addDays, CLOSED, REVIEW } from './utils.js';

const LOOKBACK_DAYS = 180;
const DEFAULT_DAYS = 7;
const MIN_SAMPLE = 3; // số công việc đã xong tối thiểu để tin con số trung vị
const OVERLOAD_MIN = 5;
const OVERLOAD_RATIO = 1.5;

const median = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Số ngày xử lý thường gặp của từng phòng (trung vị). Khóa '' là phòng chưa phân, khóa '__all' là toàn hệ thống.
 * Chỉ tính công việc đã xong trong 180 ngày gần nhất và có ngày giao.
 */
export function deptDurations(today = dateKey()) {
  const from = addDays(today, -LOOKBACK_DAYS);
  const byDept = new Map();
  const all = [];
  for (const t of store.tasks) {
    if (!CLOSED.includes(t.status) || !t.doneAt || !t.createdAt || t.doneAt < from) continue;
    const days = Math.max(1, daysBetween(dateKey(new Date(t.createdAt)), t.doneAt));
    const key = t.departmentId ?? '';
    if (!byDept.has(key)) byDept.set(key, []);
    byDept.get(key).push(days);
    all.push(days);
  }
  // Dưới MIN_SAMPLE việc thì con số không đáng tin: bỏ qua, rơi về mức toàn hệ thống hoặc mặc định
  const result = new Map(
    [...byDept].filter(([, list]) => list.length >= MIN_SAMPLE).map(([key, list]) => [key, median(list)]),
  );
  if (all.length >= MIN_SAMPLE) result.set('__all', median(all));
  return result;
}

/**
 * Nguy cơ trễ của công việc đang mở: `need` là số ngày dự kiến còn cần (theo phòng), `left` là số ngày còn lại tới hạn.
 * Trả về null nếu không có nguy cơ, hoặc đã quá hạn (khi đó đã có nhãn quá hạn riêng).
 */
export function taskRisk(task, today, durations) {
  if (CLOSED.includes(task.status) || task.status === REVIEW) return null;
  const left = daysBetween(today, task.deadline);
  if (left < 0) return null;
  const full = durations.get(task.departmentId ?? '') ?? durations.get('__all') ?? DEFAULT_DAYS;
  const need = Math.max(1, Math.round(full));
  const detail = `Thường mất khoảng ${need} ngày, còn ${left} ngày`;
  if (need > left) return { level: 'high', label: 'Nguy cơ trễ cao', detail };
  if (need > left * 0.7) return { level: 'mid', label: 'Nguy cơ trễ', detail };
  return null;
}

/**
 * Các phòng thường phối hợp với đơn cùng lĩnh vực (đếm từ đơn đã tiếp nhận), trừ phòng xử lý chính đang chọn.
 * Trả về [[mã phòng, số đơn], ...] tối đa `limit` phòng; chỉ gồm phòng còn tồn tại.
 */
export function usualCollabs(field, leadId, limit = 2) {
  if (!field) return [];
  const count = new Map();
  for (const p of store.petitions) {
    if (p.field !== field) continue;
    for (const d of p.collabDeptIds ?? []) {
      if (d === leadId) continue;
      count.set(d, (count.get(d) ?? 0) + 1);
    }
  }
  return [...count]
    .filter(([id]) => store.departments.some((d) => d.id === id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

/** Phòng đang có nhiều việc mở hơn mức trung bình (tối thiểu OVERLOAD_MIN việc). */
export function overloadedDepts() {
  const counts = sortedDepartments().map((d) => ({
    id: d.id,
    name: d.name,
    count: store.tasks.filter((t) => (t.departmentId ?? null) === d.id && !CLOSED.includes(t.status)).length,
  }));
  if (!counts.length) return [];
  const avg = counts.reduce((sum, c) => sum + c.count, 0) / counts.length;
  return counts
    .filter((c) => c.count >= OVERLOAD_MIN && c.count >= avg * OVERLOAD_RATIO)
    .map((c) => ({ ...c, avg: Math.round(avg * 10) / 10 }));
}

/* ---------- Phát hiện bất thường: đột biến phản ánh, việc đứng im, đơn cùng người gửi ---------- */

const SPIKE_MIN = 3; // tối thiểu số phản ánh trong 7 ngày gần nhất
const SPIKE_RATIO = 2; // gấp đôi mức trung bình tuần của 4 tuần trước
const DAY_MS = 86400000;

/**
 * Khu vực có phản ánh tăng đột biến: 7 ngày gần nhất ≥ 3 phản ánh và gấp đôi trung bình tuần của 4 tuần trước
 * (khu vực chưa có phản ánh nào trước đó vẫn bị đánh dấu nếu đủ 3 phản ánh gần đây).
 */
export function areaSpikes(today = dateKey()) {
  const weekStart = addDays(today, -6);
  const monthStart = addDays(today, -34);
  const byArea = new Map();
  for (const r of store.reflections) {
    if (!r.area || !r.receivedAt) continue;
    const bucket = byArea.get(r.area) ?? { recent: 0, prior: 0 };
    if (r.receivedAt >= weekStart && r.receivedAt <= today) bucket.recent++;
    else if (r.receivedAt >= monthStart && r.receivedAt < weekStart) bucket.prior++;
    byArea.set(r.area, bucket);
  }
  return [...byArea]
    .map(([area, b]) => ({ area, recent: b.recent, weeklyAvg: Math.round((b.prior / 4) * 10) / 10 }))
    .filter((s) => s.recent >= SPIKE_MIN && s.recent >= SPIKE_RATIO * (s.weeklyAvg));
}

/** Công việc đang mở (chưa hoàn thành, không chờ duyệt) không có thay đổi nào trong `days` ngày. */
export function staleTasks(days) {
  if (!days) return [];
  return store.tasks
    .filter((t) => !CLOSED.includes(t.status) && t.status !== REVIEW)
    .map((t) => ({ task: t, idle: Math.floor((Date.now() - (t.updatedAt || t.createdAt || Date.now())) / DAY_MS) }))
    .filter((x) => x.idle >= days)
    .sort((a, b) => b.idle - a.idle);
}

/** Đơn thư cùng số điện thoại gửi từ 2 lần trở lên trong 365 ngày gần nhất (theo số điện thoại đã bỏ ký tự khác số). */
export function repeatCitizens(today = dateKey()) {
  const from = addDays(today, -365);
  const byPhone = new Map();
  for (const p of store.petitions) {
    const phone = (p.citizen?.phone ?? '').replace(/\D/g, '');
    if (phone.length < 9 || !p.receivedAt || p.receivedAt < from) continue;
    byPhone.set(phone, [...(byPhone.get(phone) ?? []), p]);
  }
  return [...byPhone]
    .filter(([, list]) => list.length >= 2)
    .map(([phone, list]) => ({
      phone,
      name: list.find((p) => p.citizen?.name)?.citizen.name || 'Chưa rõ tên',
      petitions: list.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
    }));
}
