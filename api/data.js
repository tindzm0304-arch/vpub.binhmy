import { get, put } from '@vercel/blob';

// Một file JSON duy nhất chứa toàn bộ dữ liệu nghiệp vụ. Store phải tạo ở chế độ Private.
// Không xác thực: ai mở được trang đều đọc/ghi được dữ liệu (theo yêu cầu: đồng bộ không cần đăng nhập).
const PATH = 'quan-ly-noi-bo/data.json';

async function readDoc() {
  // useCache: false để luôn đọc bản mới nhất, tránh ghi đè bản vừa được máy khác lưu
  const result = await get(PATH, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) return { version: 0, data: null };
  return JSON.parse(await new Response(result.stream).text());
}

export default async function handler(req, res) {
  try {
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
