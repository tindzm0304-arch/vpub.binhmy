/* Trợ lý phân loại đơn thư và phản ánh — chạy hoàn toàn trên trình duyệt, không gửi dữ liệu ra ngoài.
   Gồm: gợi ý lĩnh vực và phòng xử lý từ nội dung, phát hiện đơn có thể trùng, tính hạn xử lý. */
import { fold, addDays } from './utils.js';

export const PETITION_TYPES = ['Khiếu nại', 'Tố cáo', 'Kiến nghị', 'Phản ánh'];
export const CHANNELS = ['Trực tiếp', 'Bưu điện', 'Trực tuyến', 'Điện thoại', 'Hộp thư góp ý'];

/** Thời hạn xử lý mặc định (ngày) theo loại đơn. Hãy đối chiếu với quy định hiện hành trước khi dùng chính thức. */
export const DEFAULT_SLA = { 'Khiếu nại': 30, 'Tố cáo': 30, 'Kiến nghị': 15, 'Phản ánh': 7 };

/* Luật từ khóa: mỗi lĩnh vực có danh sách cụm từ (đã bỏ dấu) và tên phòng thường xử lý. */
const RULES = [
  {
    field: 'Đất đai – bồi thường', dept: 'kinh te',
    words: ['dat', 'boi thuong', 'thu hoi', 'so do', 'giay chung nhan', 'tai dinh cu', 'ranh gioi', 'ho so dat'],
  },
  {
    field: 'Xây dựng – Môi trường', dept: 'kinh te',
    words: ['xay dung', 'giay phep', 'nha o', 'moi truong', 'o nhiem', 'nuoc thai', 'cong trinh', 'rac thai'],
  },
  {
    field: 'Giáo dục – Y tế', dept: 'van hoa',
    words: ['truong hoc', 'giao duc', 'hoc sinh', 'benh vien', 'y te', 'tram y te', 'hoc phi'],
  },
  {
    field: 'Chính sách xã hội', dept: 'van hoa',
    words: ['nguoi co cong', 'ho ngheo', 'tro cap', 'bao hiem', 'chinh sach', 'an sinh'],
  },
  {
    field: 'An ninh – Trật tự', dept: 'van phong',
    words: ['trom cap', 'cuop', 'an ninh', 'trat tu', 'danh nhau', 'gay roi'],
  },
  {
    field: 'Hành chính – Công vụ', dept: 'van phong',
    words: ['can bo', 'cong chuc', 'thu tuc', 'tiep dan', 'cham tre', 'nhung nhieu'],
  },
];

export const FIELD_NAMES = [...RULES.map((r) => r.field), 'Khác'];

const norm = (text) => fold(text).replace(/\s+/g, ' ');
const hasWord = (text, word) => new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`).test(text);

/**
 * Gợi ý lĩnh vực và phòng xử lý.
 * `confidence` tăng theo số cụm từ khớp (0 = không khớp, 1 = khớp từ hai cụm trở lên).
 */
export function classify(text, departments) {
  const t = norm(text);
  let best = null;
  let bestHits = 0;
  for (const rule of RULES) {
    const hits = rule.words.filter((w) => hasWord(t, w)).length;
    if (hits > bestHits) {
      best = rule;
      bestHits = hits;
    }
  }
  const wanted = best?.dept ?? 'khac';
  const dept = departments.find((d) => fold(d.name).includes(wanted))
    ?? departments.find((d) => fold(d.name).includes('khac'))
    ?? null;
  return {
    field: best?.field ?? 'Khác',
    deptId: dept?.id ?? null,
    deptName: dept?.name ?? null,
    confidence: Math.min(1, bestHits / 2),
  };
}

const STOP = new Set(['khong', 'nhung', 'duoc', 'cua', 'cho', 'tai', 'trong', 'mot', 'cac', 'nhu', 'voi', 'nguoi', 'hien', 'dang', 'khi', 'rat', 'nay', 'the', 'toi', 've', 'da', 'se', 'la', 'va', 'co']);
const tokens = (text) => new Set(norm(text).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));

/** Hệ số Jaccard giữa hai nội dung (0–1), bỏ qua từ nối và từ quá ngắn. */
export function similarity(a, b) {
  const sa = tokens(a);
  const sb = tokens(b);
  if (!sa.size || !sb.size) return 0;
  let common = 0;
  for (const w of sa) if (sb.has(w)) common++;
  return common / (sa.size + sb.size - common);
}

/** Đơn có thể trùng: cùng số điện thoại, hoặc nội dung giống từ 45% trở lên. */
export function findSimilar(petitions, { phone = '', content = '', exceptId = null } = {}) {
  const digits = phone.replace(/\D/g, '');
  return petitions
    .filter((p) => p.id !== exceptId)
    .map((p) => ({
      petition: p,
      score: similarity(content, p.content || ''),
      samePhone: digits.length >= 9 && (p.citizen?.phone || '').replace(/\D/g, '') === digits,
    }))
    .filter((r) => r.samePhone || r.score >= 0.45)
    .sort((a, b) => Number(b.samePhone) - Number(a.samePhone) || b.score - a.score)
    .slice(0, 3);
}

export function dueDateFor(type, receivedKey) {
  return addDays(receivedKey, DEFAULT_SLA[type] ?? 15);
}
