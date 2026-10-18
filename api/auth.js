/* Đăng nhập và tài khoản của chính mình.
   POST { username, password }                       → { token, user }
   GET                                               → { user } (kiểm tra phiên)
   POST { action: 'password', oldPassword, newPassword } → đổi mật khẩu của mình, trả token mới */
import {
  signToken, hashPassword, passwordMatches, publicUser, normUsername, PASSWORD_MIN,
} from './_core.js';
import {
  USERS_PATH, readJson, writeJson, secret, adminUsername, builtinAdmin, builtinPasswordMatches, currentUser,
} from './_store.js';

// ponytail: chưa giới hạn số lần thử; scrypt làm mỗi lần thử mất ~50 ms. Thêm khóa tạm theo tài khoản nếu log có nhiều lần sai liên tiếp.
async function login(res, { username, password }) {
  const name = normUsername(username);
  if (!name || !password) return res.status(400).json({ error: 'Nhập tài khoản và mật khẩu' });
  let user = null;
  if (name === adminUsername()) {
    if (builtinPasswordMatches(password)) user = builtinAdmin();
  } else {
    const found = (await readJson(USERS_PATH, { users: [] })).users?.find((u) => u.username === name);
    if (found && passwordMatches(password, found)) user = found;
  }
  if (!user) return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
  return res.json({ token: signToken(user.username, secret()), user: publicUser(user) });
}

async function changePassword(req, res, me) {
  const { oldPassword, newPassword } = req.body ?? {};
  if (me.builtin) return res.status(400).json({ error: 'Tài khoản quản trị gốc đổi mật khẩu bằng biến ADMIN_PASSWORD trên Vercel' });
  if (String(newPassword ?? '').length < PASSWORD_MIN) return res.status(400).json({ error: `Mật khẩu mới cần ít nhất ${PASSWORD_MIN} ký tự` });
  const doc = await readJson(USERS_PATH, { users: [] });
  const user = doc.users.find((u) => u.username === me.username);
  if (!user || !passwordMatches(oldPassword, user)) return res.status(400).json({ error: 'Mật khẩu hiện tại không đúng' });
  Object.assign(user, hashPassword(newPassword), { validFrom: Date.now() });
  await writeJson(USERS_PATH, doc);
  // Token cũ trên các máy khác hết hiệu lực; máy này nhận token mới (cấp sau validFrom)
  return res.json({ token: signToken(user.username, secret(), Date.now() + 1), user: publicUser(user) });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'POST' && req.body?.action !== 'password') return await login(res, req.body ?? {});
    const me = await currentUser(req);
    if (!me) return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn' });
    if (req.method === 'GET') return res.json({ user: publicUser(me) });
    if (req.method === 'POST') return await changePassword(req, res, me);
    return res.status(405).end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
