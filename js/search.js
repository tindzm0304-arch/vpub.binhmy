/* Tìm kiếm toàn hệ thống (Ctrl+K hoặc /): công việc, BTV, đơn thư, phản ánh, cán bộ, lịch.
   Không phân biệt dấu; mỗi từ gõ đều phải khớp. Khi chưa gõ gì thì hiện mục gần đây. */
import { store, taskById, petitionById, reflectionById, personById, eventById, deptName } from './store.js';
import { openModal, closeModal } from './modal.js';
import { recentList } from './recent.js';
import { searchPdfs } from './pdfsearch.js';
import { openTaskDetail } from './views/tasks.js';
import { openBtvDetail } from './views/btv.js';
import { openPetitionDetail } from './views/petitions.js';
import { openReflectionDetail } from './views/reflections.js';
import { openPersonDetail } from './views/personnel.js';
import { openEventDetail } from './views/calendar.js';
import { $, esc, fold, formatDate } from './utils.js';

const MAX_RESULTS = 30;
const KIND_LABEL = {
  tasks: 'Giao việc TTUB', btv: 'Giao việc BTV', petitions: 'Đơn thư', reflections: 'Phản ánh 1022',
  personnel: 'Cán bộ', events: 'Lịch công tác',
};

/** Cách mở một hồ sơ: màn hình cần chuyển tới và hàm mở hộp chi tiết. */
const OPENERS = {
  tasks: (id) => {
    const t = taskById(id);
    if (!t) return null;
    return t.source === 'btv'
      ? { view: 'btv', open: () => openBtvDetail(id) }
      : { view: 'tasks', open: () => openTaskDetail(id) };
  },
  petitions: (id) => (petitionById(id) ? { view: 'petitions', open: () => openPetitionDetail(id) } : null),
  reflections: (id) => (reflectionById(id) ? { view: 'reflections', open: () => openReflectionDetail(id) } : null),
  personnel: (id) => (personById(id) ? { view: 'personnel', open: () => openPersonDetail(id) } : null),
  events: (id) => (eventById(id) ? { view: 'calendar', open: () => openEventDetail(id) } : null),
};

/** Mỗi kết quả: loại, mã, tiêu đề, dòng phụ và chuỗi để tìm kiếm. */
function index() {
  const rows = [];
  for (const t of store.tasks) {
    rows.push({
      kind: 'tasks', label: t.source === 'btv' ? 'Giao việc BTV' : 'Giao việc TTUB', id: t.id, title: t.title,
      sub: `${deptName(t.departmentId)} · Hạn ${formatDate(t.deadline)}`,
      haystack: `${t.title} ${t.desc ?? ''} ${deptName(t.departmentId)} ${t.btv?.resolutionNo ?? ''}`,
    });
  }
  for (const p of store.petitions) {
    rows.push({
      kind: 'petitions', id: p.id, title: `${p.code} · ${p.type}${p.citizen?.name ? ` – ${p.citizen.name}` : ''}`,
      sub: `${deptName(p.deptId)} · Hạn ${formatDate(p.deadline)}`,
      haystack: `${p.code} ${p.type} ${p.citizen?.name ?? ''} ${p.citizen?.phone ?? ''} ${p.content ?? ''} ${p.field ?? ''}`,
    });
  }
  for (const r of store.reflections) {
    rows.push({
      kind: 'reflections', id: r.id, title: `${r.code} · ${r.area ?? ''}`,
      sub: `${deptName(r.deptId)} · ${r.status}`,
      haystack: `${r.code} ${r.area ?? ''} ${r.content ?? ''} ${r.field ?? ''}`,
    });
  }
  for (const p of store.personnel) {
    rows.push({
      kind: 'personnel', id: p.id, title: p.name, sub: `${p.title || 'Cán bộ'} · ${deptName(p.deptId)}`,
      haystack: `${p.name} ${p.title ?? ''} ${p.phone ?? ''} ${deptName(p.deptId)}`,
    });
  }
  for (const e of store.events) {
    rows.push({
      kind: 'events', id: e.id, title: e.title, sub: `${formatDate(e.start.slice(0, 10))} ${e.start.slice(11, 16)}${e.location ? ` · ${e.location}` : ''}`,
      haystack: `${e.title} ${e.location ?? ''} ${e.desc ?? ''}`,
    });
  }
  return rows;
}

function search(query) {
  const words = fold(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return index()
    .filter((row) => {
      const hay = fold(row.haystack);
      return words.every((w) => hay.includes(w));
    })
    .slice(0, MAX_RESULTS);
}

/** Đóng ô tìm kiếm, chuyển tới màn hình của hồ sơ rồi mở hộp chi tiết. */
function go({ view, open }) {
  closeModal('search-modal');
  if (location.hash.slice(1) !== view) location.hash = view;
  open();
}

const resultRow = ({ kind, id, title, sub, label }) => `
  <button type="button" class="search-item" role="option" data-kind="${esc(kind)}" data-id="${esc(id)}">
    <span class="search-kind">${esc(label ?? KIND_LABEL[kind] ?? kind)}</span>
    <span class="search-body"><b>${esc(title)}</b><small>${esc(sub ?? '')}</small></span>
  </button>`;

/** Nút tìm trong nội dung PDF, hiện khi đã gõ đủ 3 ký tự. */
const pdfButton = (query) => (query.trim().length >= 3
  ? '<div class="search-pdf"><button type="button" class="btn btn-ghost btn-sm" id="gs-pdf"><i class="fa-regular fa-file-pdf"></i> Tìm trong nội dung PDF đính kèm</button></div>'
  : '');

function render(query) {
  const box = $('#gs-results');
  const found = search(query);
  if (found === null) {
    const recent = recentList()
      .map((r) => ({ kind: r.kind, id: r.id, title: r.title, sub: KIND_LABEL[r.kind] ?? '' }))
      .filter((r) => OPENERS[r.kind]?.(r.id));
    box.innerHTML = recent.length
      ? `<p class="search-group">Gần đây</p>${recent.map(resultRow).join('')}`
      : '<p class="search-hint">Gõ để tìm công việc, đơn thư, phản ánh, cán bộ hoặc lịch công tác.</p>';
    return;
  }
  box.innerHTML = (found.length
    ? found.map(resultRow).join('')
    : '<p class="search-hint">Không tìm thấy kết quả phù hợp.</p>') + pdfButton(query);
}

/** Đọc nội dung các tệp PDF đính kèm và hiện đoạn khớp. */
async function runPdfSearch(query) {
  const box = $('#gs-results');
  box.innerHTML = '<p class="search-hint"><i class="fa-solid fa-spinner fa-spin"></i> Đang chuẩn bị…</p>';
  try {
    const hits = await searchPdfs(query, (text) => {
      box.innerHTML = `<p class="search-hint"><i class="fa-solid fa-spinner fa-spin"></i> ${esc(text)}</p>`;
    });
    box.innerHTML = hits.length
      ? `<p class="search-group">Trong nội dung PDF</p>${hits.map((h) => resultRow({
        kind: h.kind,
        id: h.id,
        label: `PDF · trang ${h.page}`,
        title: h.file,
        sub: `${h.label} — …${h.snippet}…`,
      })).join('')}`
      : '<p class="search-hint">Không có tệp PDF nào chứa nội dung này.</p>';
  } catch (err) {
    console.error(err);
    box.innerHTML = '<p class="search-hint">Không đọc được PDF. Kiểm tra kết nối mạng (cần tải thư viện đọc PDF) rồi thử lại.</p>';
  }
}

function openResult(btn) {
  const opener = OPENERS[btn.dataset.kind]?.(btn.dataset.id);
  if (!opener) return;
  go(opener);
}

export function openSearch() {
  const input = $('#gs-input');
  input.value = '';
  render('');
  openModal('search-modal');
}

export function initSearch() {
  const input = $('#gs-input');
  const results = $('#gs-results');
  input.addEventListener('input', () => render(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      results.querySelector('.search-item')?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const first = results.querySelector('.search-item');
      if (first) openResult(first);
    }
  });
  results.addEventListener('click', (e) => {
    if (e.target.closest('#gs-pdf')) {
      runPdfSearch(input.value);
      return;
    }
    const btn = e.target.closest('.search-item');
    if (btn) openResult(btn);
  });
  results.addEventListener('keydown', (e) => {
    const items = [...results.querySelectorAll('.search-item')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i >= 0) {
      e.preventDefault();
      items[Math.min(i + 1, items.length - 1)].focus();
    } else if (e.key === 'ArrowUp' && i >= 0) {
      e.preventDefault();
      if (i === 0) input.focus();
      else items[i - 1].focus();
    }
  });
  $('#search-open').addEventListener('click', openSearch);
  window.addEventListener('store:change', () => {
    if (!$('#search-modal').hidden) render(input.value);
  });
}
