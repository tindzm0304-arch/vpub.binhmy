// Xác thực phía server. Token = HMAC(SYNC_SECRET, hash mật khẩu admin).
// Đổi mật khẩu admin hoặc đổi SYNC_SECRET là thu hồi mọi token cũ. Token không có hạn dùng.
import crypto from 'node:crypto';
import { ADMIN_CONFIG } from '../js/admin-config.js';

export function tokenFor() {
  const secret = process.env.SYNC_SECRET;
  if (!secret) throw new Error('Thiếu biến môi trường SYNC_SECRET trên Vercel');
  return crypto.createHmac('sha256', secret).update(`admin:${ADMIN_CONFIG.hash}`).digest('hex');
}

export function isAuthorized(req) {
  const given = (req.headers.authorization || '').replace(/^Bearer /, '');
  const want = tokenFor();
  return given.length === want.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want));
}
