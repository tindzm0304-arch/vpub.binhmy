import crypto from 'node:crypto';
import { ADMIN_CONFIG } from '../js/admin-config.js';
import { tokenFor } from '../lib/auth.js';

// Kiểm tra mật khẩu admin trên server (cùng salt/hash với trình duyệt), trả về token đồng bộ.
export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { user, password } = req.body || {};
  const hash = crypto
    .pbkdf2Sync(String(password ?? ''), Buffer.from(ADMIN_CONFIG.salt, 'hex'), ADMIN_CONFIG.iterations, 32, 'sha256')
    .toString('hex');
  if (user !== ADMIN_CONFIG.user || hash !== ADMIN_CONFIG.hash) {
    return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
  }
  try {
    res.json({ token: tokenFor() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
