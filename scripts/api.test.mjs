// Chạy: node scripts/api.test.mjs
// Gọi thẳng các hàm API với @vercel/blob giả lập trong bộ nhớ (không cần mạng, không cần cài thư viện).
import assert from 'node:assert/strict';
import { register } from 'node:module';

const FAKE_BLOB = `
const files = globalThis.__blobFiles ??= new Map();
export async function get(path) {
  if (!files.has(path)) return null;
  return { statusCode: 200, stream: new Blob([files.get(path)]).stream() };
}
export async function put(path, body) { files.set(path, body); return { pathname: path }; }`;
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === '@vercel/blob') return { url: 'data:text/javascript,${encodeURIComponent(FAKE_BLOB)}', shortCircuit: true };
  return next(specifier, context);
}`)}`);

process.env.AUTH_SECRET = 'x'.repeat(40);
process.env.ADMIN_PASSWORD = 'mat-khau-goc-123';
process.env.CRON_SECRET = 'cron-secret';

const { default: auth } = await import('../api/auth.js');
const { default: users } = await import('../api/users.js');
const { default: data } = await import('../api/data.js');
const { default: remind } = await import('../api/remind.js');
const { allowedChanges, buildReminders, readToken, signToken } = await import('../api/_core.js');

/** Gọi một handler như Vercel: trả về { status, body }. */
async function call(handler, { method = 'GET', body, token, query = {}, headers = {} } = {}) {
  const req = { method, body, query, headers: { host: 'app.test', ...headers, ...(token && { authorization: `Bearer ${token}` }) } };
  let status = 200;
  let payload;
  const res = {
    status(code) { status = code; return res; },
    json(value) { payload = value; return res; },
    end() { return res; },
  };
  await handler(req, res);
  return { status, body: payload };
}

/* ---------- Đăng nhập ---------- */
let r = await call(auth, { method: 'POST', body: { username: 'admin', password: 'sai' } });
assert.equal(r.status, 401);
r = await call(auth, { method: 'POST', body: { username: 'Admin', password: 'mat-khau-goc-123' } });
assert.equal(r.status, 200);
const admin = r.body.token;
assert.equal(r.body.user.role, 'admin');
assert.equal((await call(auth, { token: admin })).body.user.username, 'admin');
assert.equal((await call(data, { token: 'gia.mao' })).status, 401);
assert.equal(readToken(signToken('a', 'k', 0), 'k', 15 * 86400000), null, 'token hết hạn sau 14 ngày');

/* ---------- Tài khoản ---------- */
r = await call(users, { method: 'POST', token: admin, body: { username: 'cb.kt', name: 'Cán bộ KT', role: 'staff', password: 'ngan' } });
assert.equal(r.status, 400, 'mật khẩu quá ngắn');
r = await call(users, { method: 'POST', token: admin, body: { username: 'cb.kt', role: 'staff', password: '12345678' } });
assert.equal(r.status, 400, 'staff phải có phòng');
r = await call(users, { method: 'POST', token: admin, body: { username: 'cb.kt', name: 'Cán bộ KT', role: 'staff', deptId: 'KT', password: '12345678' } });
assert.equal(r.status, 200);
assert.ok(r.body.users.every((u) => !('hash' in u) && !('salt' in u)), 'không trả hash về trình duyệt');
await call(users, { method: 'POST', token: admin, body: { username: 'xem', role: 'viewer', password: '12345678' } });

const staff = (await call(auth, { method: 'POST', body: { username: 'cb.kt', password: '12345678' } })).body.token;
const viewer = (await call(auth, { method: 'POST', body: { username: 'xem', password: '12345678' } })).body.token;
assert.equal((await call(users, { token: staff })).status, 403, 'staff không quản lý tài khoản');

/* ---------- Dữ liệu theo quyền ---------- */
const task = (id, dept, title = id) => ({ id, title, departmentId: dept, collabDeptIds: [], status: 'Chưa thực hiện', deadline: '2026-10-17' });
const seed = {
  departments: [{ id: 'KT', name: 'Phòng Kinh tế', email: 'kt@xa.vn' }, { id: 'LD', name: 'Lãnh đạo', email: 'ld@xa.vn' }, { id: 'VP', name: 'Văn phòng' }],
  tasks: [task('a', 'KT'), task('b', 'VP')],
  petitions: [],
  events: [],
};
assert.equal((await call(data, { method: 'PUT', token: staff, body: { baseVersion: 0, data: seed } })).body.rejected, 1, 'chỉ admin đưa dữ liệu đầu tiên');
r = await call(data, { method: 'PUT', token: admin, body: { baseVersion: 0, data: seed } });
assert.equal(r.body.version, 1);

// Staff KT: sửa việc của KT được, sửa việc VP và đổi tên phòng bị bỏ; thêm đơn thư cho phòng khác được (tiếp nhận)
const edited = structuredClone(seed);
edited.tasks = [task('a', 'KT', 'KT sửa'), task('b', 'VP', 'KT sửa trộm'), task('c', 'VP')];
edited.departments[2].name = 'Đổi tên';
edited.petitions = [{ id: 'p1', deptId: 'VP', collabDeptIds: [], status: 'Chưa thực hiện' }];
r = await call(data, { method: 'PUT', token: staff, body: { baseVersion: 1, data: edited } });
assert.equal(r.status, 200);
assert.equal(r.body.rejected, 3);
assert.deepEqual(r.body.data.tasks.map((t) => t.title), ['KT sửa', 'b']);
assert.equal(r.body.data.departments[2].name, 'Văn phòng');
assert.deepEqual(r.body.data.petitions.map((p) => p.id), ['p1']);

// Viewer: không ghi được gì, phiên bản không tăng
r = await call(data, { method: 'PUT', token: viewer, body: { baseVersion: 2, data: { ...r.body.data, tasks: [] } } });
assert.equal(r.body.version, 2);
assert.equal(r.body.rejected, 1);

// Bản cũ → 409
assert.equal((await call(data, { method: 'PUT', token: admin, body: { baseVersion: 1, data: seed } })).status, 409);

// Lãnh đạo sửa hồ sơ mọi phòng, không sửa danh mục
const leaderView = allowedChanges({ role: 'leader' }, seed, { ...seed, tasks: [task('a', 'KT', 'x'), task('b', 'VP', 'y')], departments: [] });
assert.equal(leaderView.rejected, 3);
assert.deepEqual(leaderView.data.tasks.map((t) => t.title), ['x', 'y']);

// Đặt lại mật khẩu: token cũ hết hiệu lực
await new Promise((ok) => setTimeout(ok, 5));
await call(users, { method: 'PATCH', token: admin, body: { username: 'cb.kt', password: 'moi-12345678' } });
assert.equal((await call(data, { token: staff })).status, 401);

/* ---------- Email nhắc hạn ---------- */
const mails = buildReminders({
  ...seed,
  tasks: [task('a', 'KT'), { ...task('b', 'VP'), deadline: '2026-10-18' }, { ...task('d', 'KT'), status: 'Hoàn thành' }],
}, { today: '2026-10-18', appUrl: 'https://app.test' });
assert.deepEqual(mails.map((m) => [m.deptName, m.count]), [['Phòng Kinh tế', 1], ['Lãnh đạo', 2]]);
assert.ok(mails[0].html.includes('https://app.test/#tasks/a'), 'email có đường dẫn riêng tới hồ sơ');
assert.match(mails[0].subject, /1 quá hạn/);

assert.equal((await call(remind, { headers: { authorization: 'Bearer sai' } })).status, 401);
r = await call(remind, { method: 'POST', token: admin, body: { send: false } });
assert.deepEqual(r.body.missing, ['RESEND_API_KEY', 'REMIND_FROM']);
assert.equal((await call(remind, { method: 'POST', token: admin, body: { send: true } })).status, 400, 'thiếu cấu hình thì không gửi');

console.log('api: OK');
