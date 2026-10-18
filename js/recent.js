/* Mục gần đây: các hồ sơ vừa mở, lưu trên máy này để mở lại nhanh từ ô tìm kiếm. */
const KEY = 'quan-ly-noi-bo:recent';
const MAX = 8;

export function recentList() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]') ?? [];
  } catch {
    return [];
  }
}

/** Ghi nhớ một hồ sơ vừa mở, đưa lên đầu danh sách. */
export function rememberRecent({ kind, id, title }) {
  const list = recentList().filter((r) => !(r.kind === kind && r.id === id));
  list.unshift({ kind, id, title, at: Date.now() });
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* Trình duyệt chặn lưu trữ: chỉ mất danh sách gần đây */
  }
}
