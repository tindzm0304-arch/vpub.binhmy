/* Gộp ba chiều dữ liệu đồng bộ: bản gốc (lần đồng bộ trước), bản máy này, bản server.
   Theo từng mục (khóa `id`): bên nào đổi so với bản gốc thì lấy bên đó; xóa cũng là một thay đổi.
   Hai bên cùng đổi một mục: lấy bản có updatedAt mới hơn; một bên xóa, một bên sửa: giữ bản đã sửa. */

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function pick(base, mine, theirs) {
  if (same(mine, base)) return theirs;
  if (same(theirs, base)) return mine;
  if (mine === undefined) return theirs; // máy này xóa, server sửa: giữ bản đã sửa
  if (theirs === undefined) return mine;
  return (theirs.updatedAt ?? 0) > (mine.updatedAt ?? 0) ? theirs : mine;
}

function mergeList(base = [], mine = [], theirs = []) {
  const byId = (list) => new Map(list.map((x) => [x.id, x]));
  const b = byId(base);
  const m = byId(mine);
  const t = byId(theirs);
  // Giữ thứ tự của máy này, mục mới từ server nối vào sau
  const ids = [...new Set([...m.keys(), ...t.keys(), ...b.keys()])];
  return ids.map((id) => pick(b.get(id), m.get(id), t.get(id))).filter((x) => x !== undefined);
}

const NEWEST_FIRST = { activity: 'at', trash: 'deletedAt' };

/** base có thể là null (máy chưa đồng bộ lần nào): coi như rỗng, không mất mục nào của hai bên. */
export function merge3(base, mine, theirs) {
  base ??= {};
  const out = {};
  for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    const lists = [base[key], mine[key], theirs[key]];
    if (lists.every((v) => v === undefined || Array.isArray(v))) {
      out[key] = mergeList(...lists);
      const field = NEWEST_FIRST[key];
      if (field) out[key].sort((x, y) => (y[field] ?? 0) - (x[field] ?? 0));
    } else {
      out[key] = pick(...lists);
    }
  }
  return out;
}
