import crypto from 'node:crypto';
import { get, put } from '@vercel/blob';

// Một file JSON duy nhất chứa toàn bộ dữ liệu nghiệp vụ. Store phải tạo ở chế độ Private.
const PATH = 'quan-ly-noi-bo/data.json';

// Mã truy cập chung (biến ACCESS_CODE trên Vercel), mỗi máy nhập một lần. Không phân biệt hoa thường, bỏ dấu cách và gạch nối.
// ponytail: không giới hạn số lần thử; mã dài 12 ký tự đủ chống đoán. Thêm rate limit nếu thấy nhiều yêu cầu 401 lạ trong log.
const norm = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function allowed(req) {
  const want = norm(process.env.ACCESS_CODE);
  if (!want) throw new Error('Thiếu biến môi trường ACCESS_CODE trên Vercel');
  const given = norm(req.headers['x-access-code']);
  return given.length === want.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

async function readDoc() {
  // useCache: false để luôn đọc bản mới nhất, tránh ghi đè bản vừa được máy khác lưu
  const result = await get(PATH, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) return { version: 0, data: null };
  return JSON.parse(await new Response(result.stream).text());
}

export default async function handler(req, res) {
  try {
    if (!allowed(req)) return res.status(401).json({ error: 'Sai mã truy cập' });
    if (req.method === 'GET') return res.json(await readDoc());

    if (req.method === 'PUT') {
      const { baseVersion, data } = req.body || {};
      if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Thiếu dữ liệu' });
      const current = await readDoc();
      // Máy này đang sửa từ bản cũ: trả bản server để máy kia tải về, không ghi đè
      if (current.version !== (baseVersion ?? 0)) return res.status(409).json(current);
      const doc = { version: current.version + 1, savedAt: new Date().toISOString(), data };
      await put(PATH, JSON.stringify(doc), {
        access: 'private',
        allowOverwrite: true,
        addRandomSuffix: false,
        contentType: 'application/json',
      });
      return res.json(doc);
    }

    res.status(405).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
