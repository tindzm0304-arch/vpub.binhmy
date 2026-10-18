/* Quản lý tài khoản, chỉ admin.
   GET                                                   → { users, roles }
   POST   { username, name, role, deptId, email, password } → tạo tài khoản
   PATCH  { username, name?, role?, deptId?, email?, password? } → sửa; có password là đặt lại mật khẩu
   DELETE ?username=...                                  → xóa tài khoản */
import {
  ROLES, hashPassword, publicUser, normUsername, validUsername, PASSWORD_MIN,
} from './_core.js';
import {
  USERS_PATH, readJson, writeJson, adminUsername, builtinAdmin, currentUser,
} from './_store.js';

function clean(body, existing = {}) {
  const role = body.role ?? existing.role ?? 'staff';
  if (!ROLES[role]) throw Object.assign(new Error('Vai trò không hợp lệ'), { status: 400 });
  const deptId = body.deptId === undefined ? existing.deptId : (body.deptId || null);
  if (role === 'staff' && !deptId) throw Object.assign(new Error('Cán bộ phòng cần chọn phòng ban'), { status: 400 });
  return {
    name: String(body.name ?? existing.name ?? '').trim().slice(0, 80),
    role,
    deptId: deptId ?? null,
    email: String(body.email ?? existing.email ?? '').trim().slice(0, 120),
  };
}

function checkPassword(password) {
  if (String(password ?? '').length < PASSWORD_MIN) {
    throw Object.assign(new Error(`Mật khẩu cần ít nhất ${PASSWORD_MIN} ký tự`), { status: 400 });
  }
}

export default async function handler(req, res) {
  try {
    const me = await currentUser(req);
    if (!me) return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn' });
    if (me.role !== 'admin') return res.status(403).json({ error: 'Chỉ quản trị viên quản lý tài khoản' });

    const doc = await readJson(USERS_PATH, { users: [] });
    doc.users ??= [];
    const list = () => res.json({ users: [builtinAdmin(), ...doc.users].map(publicUser), roles: ROLES });

    if (req.method === 'GET') return list();

    const body = req.body ?? {};
    const username = normUsername(req.method === 'DELETE' ? req.query.username : body.username);
    if (username === adminUsername()) return res.status(400).json({ error: 'Không sửa được tài khoản quản trị gốc ở đây' });
    const index = doc.users.findIndex((u) => u.username === username);

    if (req.method === 'POST') {
      if (!validUsername(username)) return res.status(400).json({ error: 'Tên đăng nhập 3–32 ký tự: chữ thường không dấu, số, dấu chấm, gạch' });
      if (index !== -1) return res.status(409).json({ error: 'Tên đăng nhập đã có' });
      checkPassword(body.password);
      doc.users.push({ username, ...clean(body), ...hashPassword(body.password), validFrom: Date.now() });
    } else if (req.method === 'PATCH') {
      if (index === -1) return res.status(404).json({ error: 'Không có tài khoản này' });
      const user = doc.users[index];
      Object.assign(user, clean(body, user));
      if (body.password) {
        checkPassword(body.password);
        Object.assign(user, hashPassword(body.password), { validFrom: Date.now() });
      }
    } else if (req.method === 'DELETE') {
      if (index === -1) return res.status(404).json({ error: 'Không có tài khoản này' });
      doc.users.splice(index, 1);
    } else {
      return res.status(405).end();
    }
    await writeJson(USERS_PATH, doc);
    return list();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
