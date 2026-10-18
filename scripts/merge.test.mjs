// Chạy: node scripts/merge.test.mjs
import assert from 'node:assert/strict';
import { merge3 } from '../js/merge.js';

const t = (id, title, updatedAt = 1) => ({ id, title, updatedAt });
const base = { tasks: [t('a', 'A'), t('b', 'B'), t('c', 'C')], trash: [], activity: [{ id: 'x', at: 1 }] };

// Máy này thêm d và xóa b; server sửa c và thêm e → giữ cả bốn thay đổi
let out = merge3(
  base,
  { tasks: [t('a', 'A'), t('c', 'C'), t('d', 'D')], trash: [{ id: 'tb', kind: 'tasks', deletedAt: 5 }], activity: [{ id: 'y', at: 3 }, { id: 'x', at: 1 }] },
  { tasks: [t('a', 'A'), t('b', 'B'), t('c', 'C2', 2), t('e', 'E')], trash: [], activity: [{ id: 'z', at: 2 }, { id: 'x', at: 1 }] },
);
assert.deepEqual(out.tasks.map((x) => x.id + x.title), ['aA', 'cC2', 'dD', 'eE']);
assert.deepEqual(out.trash.map((x) => x.id), ['tb']);
assert.deepEqual(out.activity.map((x) => x.id), ['y', 'z', 'x']);

// Server xóa a, máy này không đụng tới a → a bị xóa (không hồi sinh)
out = merge3(base, base, { ...base, tasks: [t('b', 'B'), t('c', 'C')] });
assert.deepEqual(out.tasks.map((x) => x.id), ['b', 'c']);

// Cùng sửa một mục: bản updatedAt mới hơn thắng
out = merge3(base, { ...base, tasks: [t('a', 'mine', 9)] }, { ...base, tasks: [t('a', 'theirs', 5)] });
assert.equal(out.tasks.find((x) => x.id === 'a').title, 'mine');

// Một bên xóa, một bên sửa → giữ bản sửa
out = merge3(base, { ...base, tasks: [t('b', 'B'), t('c', 'C')] }, { ...base, tasks: [t('a', 'A-sua', 3), t('b', 'B'), t('c', 'C')] });
assert.equal(out.tasks.find((x) => x.id === 'a')?.title, 'A-sua');

// Chưa có bản gốc: hợp hai bên, không mất mục nào
out = merge3(null, { tasks: [t('a', 'A')] }, { tasks: [t('b', 'B')] });
assert.deepEqual(out.tasks.map((x) => x.id).sort(), ['a', 'b']);

console.log('merge3: OK');
