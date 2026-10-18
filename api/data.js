import { allowedChanges } from './_core.js';
import {
  DATA_PATH, readJson, writeJson, currentUser,
} from './_store.js';

// Một file JSON duy nhất chứa toàn bộ dữ liệu nghiệp vụ. Store phải tạo ở chế độ Private.
// Mỗi yêu cầu cần token đăng nhập (api/auth.js). Thay đổi ngoài quyền của tài khoản bị bỏ, giữ bản server (api/_core.js).
const readDoc = () => readJson(DATA_PATH, { version: 0, data: null });

export default async function handler(req, res) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Chưa đăng nhập hoặc phiên đã hết hạn' });
    if (req.method === 'GET') return res.json(await readDoc());

    if (req.method === 'PUT') {
      const { baseVersion, data } = req.body || {};
      if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Thiếu dữ liệu' });
      const current = await readDoc();
      // Máy này đang sửa từ bản cũ: trả bản server để máy kia tải về, không ghi đè
      if (current.version !== (baseVersion ?? 0)) return res.status(409).json(current);
      const { data: allowed, rejected } = allowedChanges(user, current.data, data);
      // Không còn gì được phép thay đổi: không tăng phiên bản, trả lại bản server kèm số thay đổi bị bỏ
      if (JSON.stringify(allowed) === JSON.stringify(current.data)) return res.json({ ...current, rejected });
      const doc = {
        version: current.version + 1, savedAt: new Date().toISOString(), savedBy: user.username, data: allowed,
      };
      await writeJson(DATA_PATH, doc);
      return res.json({ ...doc, rejected });
    }

    return res.status(405).end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
