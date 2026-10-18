// Tạo hoặc đổi mật khẩu admin. Chạy: node scripts/admin-password.mjs [mật-khẩu-mới]
// Không nhập mật khẩu → tự sinh mật khẩu ngẫu nhiên và in ra một lần duy nhất.
// Ghi js/admin-config.js (chỉ lưu salt + hash PBKDF2, không lưu mật khẩu).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ITERATIONS = 310000;
const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, '..', 'js', 'admin-config.js');

const given = process.argv[2];
const password = given ?? crypto.randomBytes(12).toString('base64url');
if (password.length < 8) {
  console.error('Mật khẩu phải có ít nhất 8 ký tự.');
  process.exit(1);
}
const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
const source = `// Tạo bởi scripts/admin-password.mjs — không lưu mật khẩu, chỉ lưu salt và hash PBKDF2-SHA256.
export const ADMIN_CONFIG = {
  user: 'admin',
  iterations: ${ITERATIONS},
  salt: '${salt.toString('hex')}',
  hash: '${hash.toString('hex')}',
};
`;
fs.writeFileSync(target, source, 'utf8');
console.log(`Đã cập nhật ${path.relative(process.cwd(), target)}`);
if (!given) console.log(`Mật khẩu admin mới (ghi lại ngay, chỉ hiển thị một lần): ${password}`);
