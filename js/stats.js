/* Thống kê theo thời gian, dùng chung cho Báo cáo định kỳ.
   Mọi nguồn (giao việc BTV, giao việc TTUB, đơn thư, phản ánh) được quy về một dạng chung. */
import { store, PETITION_CLOSED, REFLECTION_CLOSED } from './store.js';
import { dateKey, addDays, parseDateKey, CLOSED } from './utils.js';

export const SOURCES = [
  { key: 'btv', label: 'Giao việc BTV', color: '#7c3aed' },
  { key: 'ttub', label: 'Giao việc TTUB', color: '#2563eb' },
  { key: 'petition', label: 'Đơn thư', color: '#0891b2' },
  { key: 'reflection', label: 'Phản ánh 1022', color: '#ea580c' },
];
export const sourceLabel = (key) => SOURCES.find((s) => s.key === key)?.label ?? key;

const msToKey = (ms) => (ms ? dateKey(new Date(ms)) : '');

/** Số ngày từ `a` đến `b` (b − a), theo lịch. */
export function daysBetween(a, b) {
  return Math.round((parseDateKey(b) - parseDateKey(a)) / 86400000);
}

/**
 * Mục theo dõi: `start` là ngày tiếp nhận / giao, `closedAt` là ngày hoàn thành do hệ thống ghi nhận
 * (mục đóng trước khi có tính năng này, hoặc nhập từ Excel đã xong, không có ngày đóng).
 */
export function trackedItems() {
  return [
    ...store.tasks.map((t) => ({
      source: t.source === 'btv' ? 'btv' : 'ttub',
      id: t.id,
      code: t.source === 'btv' ? (t.btv?.resolutionNo ?? '') : '',
      title: t.title,
      start: t.source === 'btv' ? (t.btv?.issuedAt || msToKey(t.createdAt)) : msToKey(t.createdAt),
      deadline: t.deadline,
      closed: CLOSED.includes(t.status),
      closedAt: t.doneAt ?? null,
      deptId: t.departmentId ?? null,
      collabDeptIds: t.collabDeptIds ?? [],
    })),
    ...store.petitions.map((p) => ({
      source: 'petition',
      id: p.id,
      code: p.code,
      title: `${p.type} ${p.code}`,
      start: p.receivedAt,
      deadline: p.deadline,
      closed: PETITION_CLOSED.includes(p.status),
      closedAt: p.closedAt ?? null,
      deptId: p.deptId ?? null,
      collabDeptIds: p.collabDeptIds ?? [],
      field: p.field,
      type: p.type,
    })),
    ...store.reflections.map((r) => ({
      source: 'reflection',
      id: r.id,
      code: r.code,
      title: `Phản ánh ${r.code} – ${r.area}`,
      start: r.receivedAt,
      deadline: r.deadline,
      closed: REFLECTION_CLOSED.includes(r.status),
      closedAt: r.closedAt ?? null,
      deptId: r.deptId ?? null,
      collabDeptIds: r.collabDeptIds ?? [],
      field: r.field,
      area: r.area,
    })),
  ];
}

const inside = (key, { from, to }) => Boolean(key) && key >= from && key <= to;

/** Còn mở tại cuối ngày `day`: đã tiếp nhận và chưa đóng (hoặc đóng sau ngày đó). */
const openAt = (x, day) => Boolean(x.start) && x.start <= day && (!x.closed || (x.closedAt && x.closedAt > day));

/**
 * Chỉ số của một nhóm mục trong khoảng [from, to]:
 * tồn đầu kỳ, tiếp nhận, giải quyết (đúng hạn / trễ hạn), tồn cuối kỳ (quá hạn), thời gian xử lý trung bình.
 */
export function measure(items, range, today = dateKey()) {
  const resolvedList = items.filter((x) => x.closed && inside(x.closedAt, range));
  const onTime = resolvedList.filter((x) => x.closedAt <= x.deadline).length;
  const end = range.to < today ? range.to : today;
  const openEnd = items.filter((x) => openAt(x, end));
  const durations = resolvedList.filter((x) => x.start).map((x) => Math.max(0, daysBetween(x.start, x.closedAt)));
  return {
    carriedIn: items.filter((x) => openAt(x, addDays(range.from, -1))).length,
    received: items.filter((x) => inside(x.start, range)).length,
    resolved: resolvedList.length,
    onTime,
    late: resolvedList.length - onTime,
    openEnd: openEnd.length,
    overdueEnd: openEnd.filter((x) => x.deadline < end).length,
    onTimeRate: resolvedList.length ? onTime / resolvedList.length : null,
    avgDays: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
  };
}

/** Khoảng liền trước, cùng số ngày, để so sánh. */
export function previousRange({ from, to }) {
  const len = daysBetween(from, to) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
}

/** Thay đổi phần trăm so với kỳ trước; null khi kỳ trước bằng 0. */
export function change(now, before) {
  if (!before) return null;
  return (now - before) / before;
}

/** Đếm theo một khóa (lĩnh vực, khu vực, loại đơn...), giảm dần, bỏ giá trị rỗng. */
export function tally(list, keyOf) {
  const map = new Map();
  for (const x of list) {
    const key = keyOf(x);
    if (key) map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'vi'));
}

