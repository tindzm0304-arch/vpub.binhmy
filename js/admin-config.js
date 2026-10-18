// Tạo bởi scripts/admin-password.mjs — không lưu mật khẩu, chỉ lưu salt và hash PBKDF2-SHA256.
export const ADMIN_CONFIG = {
  user: 'admin',
  iterations: 310000,
  salt: 'db2d7e1be94cb857efc3d2c3035b7c49',
  hash: '55cda0e316e682200a162d743f28de51d545ddcdb9fa75c4212582225467771b',
};
