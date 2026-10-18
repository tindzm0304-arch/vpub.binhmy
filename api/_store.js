/* Đọc ghi Vercel Blob (store chế độ Private) và xác định người đang gọi API.
   Tài khoản nằm ở quan-ly-noi-bo/users.json; tài khoản quản trị gốc lấy từ biến môi trường
   ADMIN_USERNAME (mặc định "admin") và ADMIN_PASSWORD, luôn đăng nhập được kể cả khi danh sách tài khoản trống. */
import { get, put } from '@vercel/blob';
import { readToken, sameText, normUsername } from './_core.js';

export const DATA_PATH = 'quan-ly-noi-bo/data.json';
export const USERS_PATH = 'quan-ly-noi-bo/users.json';
export const REMIND_LOG_PATH = 'quan-ly-noi-bo/remind-log.json';

export async function readJson(path, fallback) {
  // useCache: false để luôn đọc bản mới nhất, tránh ghi đè bản vừa được máy khác lưu
  const result = await get(path, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) return fallback;
  return JSON.parse(await new Response(result.stream).text());
}

export async function writeJson(path, value) {
  await put(path, JSON.stringify(value), {
    access: 'private',
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: 'application/json',
  });
}

export function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error('Thiếu biến môi trường AUTH_SECRET (chuỗi ngẫu nhiên từ 32 ký tự) trên Vercel');
  return s;
}

export const adminUsername = () => normUsername(process.env.ADMIN_USERNAME || 'admin');

/** Tài khoản quản trị gốc từ biến môi trường. */
export function builtinAdmin() {
  return { username: adminUsername(), name: 'Quản trị hệ thống', role: 'admin', deptId: null, builtin: true };
}

export const builtinPasswordMatches = (password) => Boolean(process.env.ADMIN_PASSWORD) && sameText(password, process.env.ADMIN_PASSWORD);

export const loadUsers = async () => (await readJson(USERS_PATH, { users: [] })).users ?? [];

/** Người gọi API theo token (header Authorization: Bearer ...), hoặc null. Vai trò, phòng đọc mới mỗi lần. */
export async function currentUser(req) {
  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const claims = readToken(token, secret());
  if (!claims) return null;
  if (claims.u === adminUsername()) return builtinAdmin();
  const user = (await loadUsers()).find((u) => u.username === claims.u);
  // Đổi / đặt lại mật khẩu thì token cấp trước đó hết hiệu lực
  if (!user || claims.iat < (user.validFrom ?? 0)) return null;
  return user;
}
