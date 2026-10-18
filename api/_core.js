/* Phần lõi của API, không đọc ghi Blob nên chạy thử được trên máy (scripts/api.test.mjs):
   mật khẩu, token đăng nhập, vai trò, lọc thay đổi theo phòng, danh sách nhắc hạn và nội dung email.
   File bắt đầu bằng "_" nên Vercel không biến nó thành một đường dẫn API. */
import crypto from 'node:crypto';
import { CLOSED, fold } from '../js/utils.js';

/* ---------------- Vai trò ---------------- */

/** admin: toàn quyền, quản lý tài khoản. leader: sửa mọi hồ sơ nghiệp vụ. staff: hồ sơ của phòng mình. viewer: chỉ xem. */
export const ROLES = {
  admin: 'Quản trị',
  leader: 'Lãnh đạo',
  staff: 'Cán bộ phòng',
  viewer: 'Chỉ xem',
};

/* ---------------- Mật khẩu (scrypt) ---------------- */

const SCRYPT = { N: 16384, r: 8, p: 1 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32, SCRYPT).toString('hex');
  return { salt, hash };
}

export function passwordMatches(password, { salt, hash }) {
  if (!salt || !hash) return false;
  const got = crypto.scryptSync(String(password), salt, 32, SCRYPT);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** So khớp chuỗi không lộ thời gian (dùng cho mật khẩu admin trong biến môi trường). */
export function sameText(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export const PASSWORD_MIN = 8;

/* ---------------- Token đăng nhập (HMAC-SHA256) ---------------- */

export const TOKEN_DAYS = 14;
const b64 = (buf) => Buffer.from(buf).toString('base64url');

/** Token chỉ chứng minh danh tính và thời điểm cấp; vai trò, phòng luôn đọc lại từ danh sách tài khoản. */
export function signToken(username, secret, now = Date.now()) {
  const body = b64(JSON.stringify({ u: username, iat: now, exp: now + TOKEN_DAYS * 86400000 }));
  return `${body}.${b64(crypto.createHmac('sha256', secret).update(body).digest())}`;
}

export function readToken(token, secret, now = Date.now()) {
  const [body, sig] = String(token ?? '').split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    return claims.exp > now ? claims : null;
  } catch {
    return null;
  }
}

/** Tài khoản an toàn để gửi về trình duyệt (bỏ salt, hash). */
export const publicUser = ({ username, name, role, deptId, email, builtin }) => ({
  username, name: name || username, role, deptId: deptId ?? null, email: email ?? '', builtin: Boolean(builtin),
});

export const normUsername = (s) => String(s ?? '').trim().toLowerCase();
export const validUsername = (s) => /^[a-z0-9._-]{3,32}$/.test(s);

/* ---------------- Lọc thay đổi theo quyền ---------------- */

/** Danh mục và cài đặt chung: chỉ admin sửa. */
const ADMIN_ONLY = ['departments', 'personnel', 'recurring', 'rules', 'checklists'];
/** Hồ sơ gắn với phòng: phòng xử lý chính và phòng phối hợp. */
const SCOPE = {
  tasks: (x) => [x.departmentId, ...(x.collabDeptIds ?? [])],
  petitions: (x) => [x.deptId, ...(x.collabDeptIds ?? [])],
  reflections: (x) => [x.deptId, ...(x.collabDeptIds ?? [])],
};
/** Lịch, thùng rác, thư viện, nhật ký: đi kèm thao tác trên hồ sơ (lịch hạn chót tự sinh), mọi người ghi được trừ viewer. */
const SHARED = ['events', 'trash', 'library', 'activity'];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Cán bộ phòng (staff) được ghi một hồ sơ khi:
 * - sửa / xóa: hồ sơ đang thuộc phòng mình (xử lý chính hoặc phối hợp), kể cả khi chuyển sang phòng khác;
 * - tạo mới: đơn thư, phản ánh thì phòng nào cũng tiếp nhận được; công việc phải giao cho phòng mình.
 */
function staffMay(kind, before, after, deptId) {
  if (!deptId) return false;
  const inScope = (x) => SCOPE[kind](x).includes(deptId);
  if (before) return inScope(before);
  return kind !== 'tasks' || inScope(after);
}

function filterList(kind, current = [], incoming = [], may) {
  const was = new Map(current.map((x) => [x.id, x]));
  const now = new Map(incoming.map((x) => [x.id, x]));
  let rejected = 0;
  const out = [];
  for (const id of new Set([...now.keys(), ...was.keys()])) {
    const before = was.get(id);
    const after = now.get(id);
    if (same(before, after) || may(kind, before, after)) {
      if (after !== undefined) out.push(after);
    } else {
      rejected += 1;
      if (before !== undefined) out.push(before); // giữ bản trên server
    }
  }
  return { list: out, rejected };
}

/**
 * Dữ liệu được phép lưu khi `user` gửi `incoming` lên, so với bản `current` trên server.
 * Thay đổi ngoài quyền bị bỏ, giữ bản server; trả về số thay đổi bị bỏ để báo cho người dùng.
 */
export function allowedChanges(user, current, incoming) {
  if (user.role === 'admin') return { data: incoming, rejected: 0 };
  // Server chưa có dữ liệu: chỉ admin đưa bộ dữ liệu đầu tiên lên
  if (!current) return { data: null, rejected: 1 };
  if (user.role === 'viewer') return { data: current, rejected: same(current, incoming) ? 0 : 1 };
  const may = (kind, before, after) => {
    if (SHARED.includes(kind)) return true;
    if (ADMIN_ONLY.includes(kind)) return false;
    if (!SCOPE[kind]) return false; // khóa lạ: chỉ admin
    return user.role === 'leader' || staffMay(kind, before, after, user.deptId);
  };
  const data = {};
  let rejected = 0;
  for (const key of new Set([...Object.keys(current), ...Object.keys(incoming)])) {
    const a = current[key];
    const b = incoming[key];
    if (Array.isArray(a ?? []) && Array.isArray(b ?? [])) {
      const r = filterList(key, a, b, may);
      data[key] = r.list;
      rejected += r.rejected;
    } else if (same(a, b)) {
      data[key] = b;
    } else {
      data[key] = a;
      rejected += 1;
    }
  }
  return { data, rejected };
}

/* ---------------- Nhắc hạn qua email ---------------- */

export const REMIND_DAYS = 3;

const addDays = (key, n) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Ngày hôm nay theo giờ Việt Nam (UTC+7), dạng YYYY-MM-DD. */
export const vnToday = (now = Date.now()) => new Date(now + 7 * 3600000).toISOString().slice(0, 10);

/** Mỗi hồ sơ đang mở có hạn: loại, tiêu đề, hạn, mức (quá hạn / hôm nay / sắp đến), phòng, đường dẫn riêng. */
export function dueItems(data, today, days = REMIND_DAYS) {
  const soon = addDays(today, days);
  const level = (deadline) => {
    if (!deadline) return null;
    if (deadline < today) return 'overdue';
    if (deadline === today) return 'today';
    return deadline <= soon ? 'soon' : null;
  };
  const out = [];
  const add = (x) => {
    const lv = level(x.deadline);
    if (lv) out.push({ ...x, level: lv });
  };
  for (const t of data.tasks ?? []) {
    if (CLOSED.includes(t.status)) continue;
    const btv = t.source === 'btv';
    const base = {
      kind: btv ? 'Giao việc BTV' : 'Giao việc TTUB', title: t.title, link: `tasks/${t.id}`,
      deptId: t.departmentId ?? null, collabDeptIds: t.collabDeptIds ?? [],
    };
    add({ ...base, deadline: t.deadline });
    if (btv && t.btv?.reportDue && !t.btv.reported) add({ ...base, kind: 'Báo cáo BTV', deadline: t.btv.reportDue });
  }
  for (const p of data.petitions ?? []) {
    if (CLOSED.includes(p.status)) continue;
    add({
      kind: 'Đơn thư', title: `${p.code} · ${p.type}`, link: `petitions/${p.id}`,
      deadline: p.deadline, deptId: p.deptId ?? null, collabDeptIds: p.collabDeptIds ?? [],
    });
  }
  for (const r of data.reflections ?? []) {
    if (CLOSED.includes(r.status)) continue;
    add({
      kind: 'Phản ánh 1022', title: `${r.code} · ${r.area ?? ''}`, link: `reflections/${r.id}`,
      deadline: r.deadline, deptId: r.deptId ?? null, collabDeptIds: r.collabDeptIds ?? [],
    });
  }
  const order = { overdue: 0, today: 1, soon: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level] || a.deadline.localeCompare(b.deadline));
}

const LEVEL_LABEL = { overdue: 'Quá hạn', today: 'Đến hạn hôm nay', soon: `Sắp đến hạn` };
const LEVEL_COLOR = { overdue: '#dc2626', today: '#b45309', soon: '#1d4ed8' };
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const viDate = (key) => key.split('-').reverse().join('/');

function emailHtml({ heading, intro, items, appUrl, deptName }) {
  const rows = items.map((x) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e1e9f6;white-space:nowrap">
        <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:700;color:#fff;background:${LEVEL_COLOR[x.level]}">${LEVEL_LABEL[x.level]}</span>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #e1e9f6">
        <a href="${escHtml(`${appUrl}/#${x.link}`)}" style="color:#0b1d3f;font-weight:700;text-decoration:none">${escHtml(x.title)}</a>
        <div style="font-size:12px;color:#5b6d8f">${escHtml(x.kind)}${deptName ? ` · ${escHtml(deptName(x.deptId))}` : ''}</div>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #e1e9f6;white-space:nowrap;font-variant-numeric:tabular-nums">${viDate(x.deadline)}</td>
    </tr>`).join('');
  return `<!doctype html><html lang="vi"><body style="margin:0;background:#f3f7fe;font-family:Segoe UI,Arial,sans-serif;color:#0b1d3f">
  <div style="max-width:680px;margin:0 auto;padding:24px 16px">
    <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff;border-radius:16px 16px 0 0;padding:20px 24px">
      <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.8">UBND Xã Bình Mỹ · Quản lý nội bộ</div>
      <div style="font-size:20px;font-weight:800;margin-top:4px">${escHtml(heading)}</div>
    </div>
    <div style="background:#fff;border:1px solid #e1e9f6;border-top:none;border-radius:0 0 16px 16px;padding:20px 24px">
      <p style="margin:0 0 16px;color:#3d527a">${escHtml(intro)}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>
      <p style="margin:20px 0 0"><a href="${escHtml(appUrl)}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:10px;font-weight:700;text-decoration:none">Mở hệ thống</a></p>
      <p style="margin:16px 0 0;font-size:12px;color:#5b6d8f">Email gửi tự động mỗi sáng ngày làm việc. Bấm tên hồ sơ để mở thẳng hồ sơ đó.</p>
    </div>
  </div></body></html>`;
}

/**
 * Danh sách email cần gửi hôm nay: mỗi phòng có email nhận việc của phòng (xử lý chính hoặc phối hợp);
 * phòng Lãnh đạo (nếu có email) nhận bản tổng hợp toàn xã. Phòng không có việc thì không gửi.
 */
export function buildReminders(data, { today, appUrl, days = REMIND_DAYS }) {
  const items = dueItems(data, today, days);
  const depts = data.departments ?? [];
  const nameOf = (id) => depts.find((d) => d.id === id)?.name ?? 'Chưa phân phòng';
  const count = (list, lv) => list.filter((x) => x.level === lv).length;
  const summary = (list) => `${count(list, 'overdue')} quá hạn, ${count(list, 'today')} đến hạn hôm nay, ${count(list, 'soon')} sắp đến hạn trong ${days} ngày`;
  const mails = [];
  for (const d of depts) {
    const to = String(d.email ?? '').split(/[,;\s]+/).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (!to.length) continue;
    const leader = fold(d.name) === fold('Lãnh đạo');
    const list = leader ? items : items.filter((x) => x.deptId === d.id || x.collabDeptIds.includes(d.id));
    if (!list.length) continue;
    mails.push({
      deptId: d.id,
      deptName: d.name,
      to,
      count: list.length,
      subject: `[Nhắc hạn ${viDate(today)}] ${d.name}: ${summary(list)}`,
      html: emailHtml({
        heading: leader ? 'Tổng hợp nhắc hạn toàn xã' : `Nhắc hạn · ${d.name}`,
        intro: `Hôm nay ${viDate(today)}: ${summary(list)}.`,
        items: list,
        appUrl,
        deptName: leader ? nameOf : null,
      }),
    });
  }
  return mails;
}
