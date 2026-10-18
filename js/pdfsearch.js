/* Tìm trong nội dung tệp PDF đính kèm. pdf.js tải từ CDN ở lần tìm đầu tiên; chữ đã đọc được nhớ trong phiên.
   Tệp không rời khỏi máy: chỉ thư viện đọc PDF được tải về. */
import { store } from './store.js';
import { getBlob } from './files.js';
import { fold } from './utils.js';

const PDFJS_DIR = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
const textCache = new Map(); // mã tệp → [{ no, text }]
let libPromise = null;

function loadLib() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      const script = Object.assign(document.createElement('script'), { src: `${PDFJS_DIR}/pdf.min.js` });
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_DIR}/pdf.worker.min.js`;
        resolve(window.pdfjsLib);
      };
      script.onerror = () => {
        libPromise = null;
        reject(new Error('Không tải được thư viện đọc PDF'));
      };
      document.head.append(script);
    });
  }
  return libPromise;
}

async function pagesOf(file, blob) {
  if (textCache.has(file.id)) return textCache.get(file.id);
  const lib = await loadLib();
  const pdf = await lib.getDocument({ data: await blob.arrayBuffer() }).promise;
  const pages = [];
  for (let no = 1; no <= pdf.numPages; no++) {
    const content = await (await pdf.getPage(no)).getTextContent();
    pages.push({ no, text: content.items.map((item) => item.str).join(' ') });
  }
  textCache.set(file.id, pages);
  return pages;
}

const isPdf = (file) => !file.sample && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name));

/** Mọi tệp đính kèm, kèm hồ sơ chứa nó (để mở đúng chỗ khi bấm kết quả). */
function attachments() {
  return [
    ...store.tasks.map((t) => ({ kind: 'tasks', id: t.id, label: t.title, files: t.files ?? [] })),
    ...store.petitions.map((p) => ({ kind: 'petitions', id: p.id, label: `${p.code} · ${p.type}`, files: p.files ?? [] })),
    ...store.reflections.map((r) => ({ kind: 'reflections', id: r.id, label: `${r.code} · ${r.area ?? ''}`, files: r.files ?? [] })),
  ].flatMap((owner) => owner.files.filter(isPdf).map((file) => ({ ...owner, file })));
}

/**
 * Tìm `query` (không phân biệt dấu) trong các tệp PDF. Mỗi tệp chỉ trả về trang khớp đầu tiên.
 * `onStatus(text)` nhận tiến độ để hiện cho người dùng.
 */
export async function searchPdfs(query, onStatus = () => {}) {
  const needle = fold(query.trim());
  const jobs = attachments();
  const hits = [];
  for (const [i, job] of jobs.entries()) {
    onStatus(`Đang đọc tệp ${i + 1}/${jobs.length}…`);
    const blob = await getBlob(job.file.id).catch(() => null);
    if (!blob) continue;
    let pages;
    try {
      pages = await pagesOf(job.file, blob);
    } catch (err) {
      console.warn(`Không đọc được ${job.file.name}`, err);
      continue;
    }
    for (const page of pages) {
      const at = fold(page.text).indexOf(needle);
      if (at === -1) continue;
      hits.push({
        kind: job.kind,
        id: job.id,
        label: job.label,
        file: job.file.name,
        page: page.no,
        snippet: page.text.slice(Math.max(0, at - 60), at + needle.length + 60),
      });
      break;
    }
  }
  return hits;
}
