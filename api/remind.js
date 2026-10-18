/* Email nhắc hạn: mỗi phòng có email nhận danh sách việc quá hạn / đến hạn / sắp đến hạn của phòng;
   phòng Lãnh đạo nhận bản tổng hợp toàn xã. Gửi qua Resend (https://resend.com), không cần thư viện.
   GET  (Vercel Cron, vercel.json: 7:00 sáng thứ 2–6 giờ Việt Nam) → gửi, mỗi ngày tối đa một lần.
   POST { send: false } (admin) → xem trước danh sách email và kiểm tra cấu hình.
   POST { send: true }  (admin) → gửi ngay.
   Biến môi trường: RESEND_API_KEY, REMIND_FROM (vd "Nhắc hạn Bình Mỹ <nhac-han@ten-mien.vn>"), CRON_SECRET, APP_URL (tùy chọn). */
import { buildReminders, vnToday } from './_core.js';
import {
  DATA_PATH, REMIND_LOG_PATH, readJson, writeJson, currentUser,
} from './_store.js';

function config(req) {
  const missing = ['RESEND_API_KEY', 'REMIND_FROM'].filter((k) => !process.env[k]);
  const appUrl = (process.env.APP_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/+$/, '');
  return { missing, appUrl };
}

async function sendOne(mail) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.REMIND_FROM, to: mail.to, subject: mail.subject, html: mail.html }),
  });
  if (!res.ok) throw new Error(`${mail.deptName}: ${(await res.json().catch(() => ({}))).message || `HTTP ${res.status}`}`);
}

async function run(req, { send }) {
  const { missing, appUrl } = config(req);
  const today = vnToday();
  const doc = await readJson(DATA_PATH, { data: null });
  const mails = doc.data ? buildReminders(doc.data, { today, appUrl }) : [];
  const preview = mails.map(({ deptName, to, subject, count }) => ({ deptName, to, subject, count }));
  if (!send) return { today, missing, mails: preview };
  if (missing.length) throw Object.assign(new Error(`Thiếu biến môi trường: ${missing.join(', ')}`), { status: 400 });
  const errors = [];
  for (const mail of mails) await sendOne(mail).catch((err) => errors.push(err.message));
  await writeJson(REMIND_LOG_PATH, { lastSent: today, at: new Date().toISOString(), sent: mails.length - errors.length, errors });
  return { today, missing, mails: preview, sent: mails.length - errors.length, errors };
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const want = process.env.CRON_SECRET;
      if (!want || req.headers.authorization !== `Bearer ${want}`) return res.status(401).json({ error: 'Chỉ Vercel Cron gọi được' });
      const log = await readJson(REMIND_LOG_PATH, {});
      if (log.lastSent === vnToday()) return res.json({ skipped: 'Hôm nay đã gửi' });
      return res.json(await run(req, { send: true }));
    }
    if (req.method === 'POST') {
      const user = await currentUser(req);
      if (!user) return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn' });
      if (user.role !== 'admin') return res.status(403).json({ error: 'Chỉ quản trị viên gửi email nhắc hạn' });
      return res.json(await run(req, { send: Boolean(req.body?.send) }));
    }
    return res.status(405).end();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
