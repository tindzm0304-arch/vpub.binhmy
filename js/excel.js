/* Đọc và tạo file Excel bằng SheetJS. Thư viện chỉ được tải từ CDN khi cần lần đầu,
   không làm chậm lúc mở trang. Dữ liệu file được đọc ngay trên trình duyệt, không gửi đi đâu. */
import { fold, dateKey, formatDate } from './utils.js';

const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
const DAY_MS = 86400000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const pad = (n) => String(n).padStart(2, '0');

let lib = null;

export function loadXlsx() {
  lib ??= import(SHEETJS_URL).catch((err) => {
    lib = null;
    throw err;
  });
  return lib;
}

/** Tiêu đề cột hoặc giá trị đã chuẩn hóa: bỏ dấu, chữ thường, chỉ giữ chữ và số. */
export const normHeader = (text) => fold(String(text ?? '')).replace(/[^a-z0-9]+/g, ' ').trim();

export const isBlank = (value) => value == null || (typeof value === 'string' && !value.trim());

/** Nội dung ô dạng chữ (ô ngày hiển thị dd/mm/yyyy). */
export function cellText(value) {
  if (value == null) return '';
  if (value instanceof Date) return formatDate(toDateKey(value));
  return String(value).trim();
}

/**
 * Đọc mọi trang tính. Mỗi trang là { name, rows, firstRow } với `rows` là mảng dòng (mỗi dòng là mảng ô)
 * và `firstRow` là số thứ tự trong Excel của dòng đầu tiên.
 */
/**
 * CSV tiếng Việt: Excel lưu theo UTF-8 (có hoặc không có BOM) hoặc Windows-1258 tùy cách xuất.
 * Thử UTF-8 trước, không đúng thì đọc theo Windows-1258 để không bị lỗi dấu.
 */
function decodeCsv(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1258').decode(buf);
  }
}

export async function readWorkbook(file) {
  const XLSX = await loadXlsx();
  const buf = await file.arrayBuffer();
  const isCsv = /\.csv$/i.test(file.name);
  // CSV: giữ nguyên chữ, tránh thư viện tự hiểu 12/08/2026 theo kiểu tháng/ngày của Mỹ
  const wb = isCsv
    ? XLSX.read(decodeCsv(buf), { type: 'string', cellDates: true, raw: true })
    : XLSX.read(buf, { type: 'array', cellDates: true });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    if (!ws['!ref']) return { name, rows: [], firstRow: 1 };
    const range = XLSX.utils.decode_range(ws['!ref']);
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    return { name, rows, firstRow: range.s.r + 1 };
  });
}

function validDate(y, m, d) {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dateKey(dt) : '';
}

/**
 * Ô ngày → 'YYYY-MM-DD'. Nhận ô ngày của Excel, số ngày kiểu Excel, hoặc chữ có ngày
 * dạng 12/8/2026 (ngày/tháng/năm, kể cả "982/VP ngày 09/10/2026") hay 2026-08-12. Không đọc được thì trả về ''.
 */
export function toDateKey(value) {
  if (isBlank(value)) return '';
  if (value instanceof Date) {
    // Làm tròn tới nửa đêm gần nhất: bỏ qua lệch vài giây hoặc lệch múi giờ khi thư viện đổi ngày
    return Number.isNaN(value.getTime()) ? '' : dateKey(new Date(value.getTime() + DAY_MS / 2));
  }
  if (typeof value === 'number') {
    if (value < 20000 || value > 80000) return '';
    const d = new Date(EXCEL_EPOCH + Math.round(value) * DAY_MS);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const text = String(value);
  let m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = text.match(/(?:^|\D)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?!\d)/);
  if (m) return validDate(+m[3], +m[2], +m[1]);
  return '';
}

const YES = new Set(['1', 'x', 'v', 'co', 'roi', 'da', 'dat', 'yes', 'true', 'ok']);

/** Ô đánh dấu: 1, x, "có", "đã …" là đúng; "chưa", "không", 0 là sai. */
export function toFlag(value) {
  if (value === true) return true;
  if (typeof value === 'number') return value > 0;
  const t = normHeader(value);
  return YES.has(t) || t.startsWith('da ');
}

/**
 * Ghép cột Excel với trường dữ liệu theo điểm: trùng hẳn (3) > bắt đầu bằng (2) > chứa cụm từ (1).
 * `columns` là [{ key, aliases }], alias viết dạng đã chuẩn hóa. Mỗi cột và mỗi trường chỉ dùng một lần.
 * Trả về { key: chỉ số cột }.
 */
export function mapColumns(headerRow, columns) {
  const candidates = [];
  headerRow.forEach((cell, idx) => {
    const h = normHeader(cell);
    if (!h) return;
    for (const col of columns) {
      let score = 0;
      for (const alias of col.aliases) {
        if (h === alias) score = 3;
        else if (h.startsWith(`${alias} `)) score = Math.max(score, 2);
        else if (` ${h} `.includes(` ${alias} `)) score = Math.max(score, 1);
      }
      if (score) candidates.push({ idx, key: col.key, score });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.idx - b.idx);
  const map = {};
  const used = new Set();
  for (const c of candidates) {
    if (c.key in map || used.has(c.idx)) continue;
    map[c.key] = c.idx;
    used.add(c.idx);
  }
  return map;
}

/** Tìm dòng tiêu đề (trong 20 dòng đầu) khớp nhiều cột nhất. Trả về { headerIndex, map } hoặc null. */
export function detectHeader(sheet, columns) {
  let best = null;
  const limit = Math.min(sheet.rows.length, 20);
  for (let i = 0; i < limit; i++) {
    const map = mapColumns(sheet.rows[i] ?? [], columns);
    const hits = Object.keys(map).length;
    if (hits >= 2 && (!best || hits > best.hits)) best = { headerIndex: i, map, hits };
  }
  return best;
}

/** Ô ngày dùng trong file mẫu: đặt định dạng dd/mm/yyyy để Excel hiển thị đúng kiểu Việt Nam. */
export const dateCell = (key) => ({ date: key });

/**
 * Tạo và tải về file mẫu. `sheets` là [{ name, rows, widths }]; ô có dạng { date: 'YYYY-MM-DD' }
 * được ghi thành ô ngày thật của Excel.
 */
export async function downloadWorkbook(fileName, sheets) {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const plain = sheet.rows.map((row) => row.map((v) => (v && typeof v === 'object' ? '' : v)));
    const ws = XLSX.utils.aoa_to_sheet(plain);
    sheet.rows.forEach((row, r) => row.forEach((v, c) => {
      if (!v?.date) return;
      const [y, m, d] = v.date.split('-').map(Number);
      ws[XLSX.utils.encode_cell({ r, c })] = { t: 'n', v: (Date.UTC(y, m - 1, d) - EXCEL_EPOCH) / DAY_MS, z: 'dd/mm/yyyy' };
    }));
    if (sheet.widths) ws['!cols'] = sheet.widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }
  XLSX.writeFile(wb, fileName);
}
