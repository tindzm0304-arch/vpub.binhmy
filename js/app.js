/* Điểm vào ứng dụng: điều hướng theo hash, giao diện sáng/tối, đồng hồ, menu. */
import {
  loadStore, persist, store, effectiveStatus, dueState, PETITION_CLOSED, REFLECTION_CLOSED,
} from './store.js';
import { $, dateKey, formatLongDate } from './utils.js';
import { initModals } from './modal.js';
import { initAuth } from './auth.js';
import { initSync } from './sync.js';
import { initTasks, renderTasks } from './views/tasks.js';
import { initCalendar, renderCalendar } from './views/calendar.js';
import { initPersonnel, renderPersonnel } from './views/personnel.js';
import { initDepartments, renderDepartments } from './views/departments.js';
import { initPetitions, renderPetitions } from './views/petitions.js';
import { initReflections, renderReflections } from './views/reflections.js';
import { initBtv, renderBtv, reportState } from './views/btv.js';
import { initLibrary, renderLibrary } from './views/library.js';
import { initOverview, renderOverview } from './views/overview.js';
import { initImport } from './views/import.js';
import { initReports, renderReports } from './views/reports.js';
import { initMine, renderMine } from './views/mine.js';
import { initAutomation, renderAutomation } from './views/automation.js';
import { initHealth, renderHealth } from './views/health.js';
import {
  initSettingsPanel, renderBackup, renderNotify, renderTrash, renderActivity,
} from './views/settings-panel.js';
import { initNotify } from './notify.js';
import { initSearch, openSearch } from './search.js';
import { initShortcuts } from './shortcuts.js';
import { autoBackupIfDue } from './backup.js';

const AUTO_BACKUP_CHECK_MS = 30 * 60 * 1000;

const VIEWS = {
  overview: { title: 'Dashboard hệ thống', subtitle: 'Tiến độ xử lý toàn bộ công việc, đơn thư, phản ánh và lịch', render: renderOverview },
  reports: { title: 'Báo cáo định kỳ', subtitle: 'Tự tổng hợp theo tuần, tháng, quý; in hoặc xuất Excel', render: renderReports },
  tasks: { title: 'Quản lý Giao việc TTUB', subtitle: 'Theo dõi tiến độ và hạn chót nhiệm vụ', render: renderTasks },
  mine: { title: 'Việc cần xử lý', subtitle: 'Công việc, đơn thư, phản ánh đang mở của đơn vị, theo mốc hạn', render: renderMine },
  calendar: { title: 'Lịch công tác', subtitle: 'Sự kiện, cuộc họp và hạn chót', render: renderCalendar },
  personnel: { title: 'Quản lý Nhân sự', subtitle: 'Hồ sơ cán bộ và phân bổ nguồn lực', render: renderPersonnel },
  departments: { title: 'Quản lý Phòng ban', subtitle: 'Danh mục phòng ban và số cán bộ, công việc theo phòng', render: renderDepartments },
  petitions: { title: 'Đơn thư, PAKN', subtitle: 'Tiếp nhận, phân loại và theo dõi hạn xử lý đơn thư', render: renderPetitions },
  reflections: { title: 'Phản ánh 1022', subtitle: 'Tiếp nhận phản ánh theo khu vực và thống kê xu hướng', render: renderReflections },
  btv: { title: 'Giao việc BTV', subtitle: 'Nghị quyết, thông báo của Ban Thường vụ và hạn báo cáo', render: renderBtv },
  library: { title: 'Thư viện', subtitle: 'Nội dung đã lưu từ Giao việc BTV, TTUB, Đơn thư và Phản ánh 1022', render: renderLibrary },
  backup: { title: 'Sao lưu dữ liệu', subtitle: 'Tải bản sao lưu, khôi phục và bản tự động trên trình duyệt', render: renderBackup },
  notify: { title: 'Thông báo, nhắc hạn', subtitle: 'Nhắc hạn, quy tắc tự động và thông báo trên màn hình', render: renderNotify },
  automation: { title: 'Tự động hóa', subtitle: 'Công việc định kỳ, quy tắc hành động, mẫu trả lời và ủy quyền', render: renderAutomation },
  health: { title: 'Kiểm tra dữ liệu', subtitle: 'Việc đứng im, dữ liệu thiếu, đơn cùng người gửi và phản ánh đột biến', render: renderHealth },
  trash: { title: 'Thùng rác', subtitle: 'Mục đã xóa, có thể khôi phục trong 30 ngày', render: renderTrash },
  activity: { title: 'Nhật ký thay đổi', subtitle: 'Các thay đổi gần nhất trên máy này', render: renderActivity },
};
const THEME_KEY = 'quan-ly-noi-bo:theme';
const MOBILE = window.matchMedia('(max-width: 960px)');

let activeView = 'overview';
let lastDay = dateKey();

// Mở hệ thống lần đầu (không có #hash) sẽ vào Dashboard hệ thống
function routeName() {
  const name = location.hash.slice(1);
  return VIEWS[name] ? name : 'overview';
}

function showView(name) {
  activeView = name;
  for (const key of Object.keys(VIEWS)) {
    const isActive = key === name;
    $(`#view-${key}`).hidden = !isActive;
    const link = $(`[data-nav="${key}"]`);
    link.classList.toggle('is-active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  $('#page-title').textContent = VIEWS[name].title;
  $('#page-subtitle').textContent = VIEWS[name].subtitle;
  document.title = `${VIEWS[name].title} · UBND Xã Bình Mỹ`;
  $('#app').classList.remove('nav-open');
  renderActive();
}

function renderActive() {
  VIEWS[activeView].render();
  renderNav();
}

/** Mỗi mục menu hiện số mục của riêng nó đang quá hạn hoặc trễ hạn; bằng 0 thì ẩn. */
function renderNav() {
  const today = dateKey();
  const counts = {
    btv: store.tasks.filter((t) => t.source === 'btv'
      && (effectiveStatus(t, today) === 'Quá hạn' || reportState(t, today) === 'late')).length,
    tasks: store.tasks.filter((t) => effectiveStatus(t, today) === 'Quá hạn').length,
    petitions: store.petitions.filter((p) => dueState(p, PETITION_CLOSED.includes(p.status), today) === 'overdue').length,
    reflections: store.reflections.filter((r) => dueState(r, REFLECTION_CLOSED.includes(r.status), today) === 'overdue').length,
  };
  for (const [key, n] of Object.entries(counts)) {
    const badge = $(`[data-nav-count="${key}"]`);
    badge.hidden = n === 0;
    badge.textContent = n;
  }
}

function toggleNav() {
  const app = $('#app');
  if (MOBILE.matches) app.classList.toggle('nav-open');
  else app.classList.toggle('is-collapsed');
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = $('#theme-toggle');
  btn.querySelector('i').className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  btn.setAttribute('aria-label', theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối');
}

function initTheme() {
  applyTheme(document.documentElement.dataset.theme || 'light');
  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    renderActive(); // biểu đồ đọc lại màu theo giao diện
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* Trình duyệt chặn lưu trữ: giao diện vẫn đổi được trong phiên này */
    }
  });
}

function tick() {
  const now = new Date();
  $('#clock-date').textContent = formatLongDate(now);
  $('#clock-time').textContent = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  // Sang ngày mới thì công việc có thể vừa chuyển sang "Quá hạn"
  const today = dateKey(now);
  if (today !== lastDay) {
    lastDay = today;
    persist(); // sang ngày mới: tạo công việc định kỳ của kỳ mới nếu có
    renderActive();
  }
}

function init() {
  loadStore();
  persist(); // tạo công việc định kỳ của kỳ hiện tại nếu chưa có
  initTheme();
  initModals();
  initAuth();
  initSync();
  initTasks();
  initMine();
  initAutomation();
  initHealth();
  initCalendar();
  initPersonnel();
  initDepartments();
  initPetitions();
  initReflections();
  initBtv();
  initLibrary();
  initOverview();
  initImport();
  initReports();
  initSettingsPanel();
  initNotify();
  initSearch();
  initShortcuts({ openSearch });
  autoBackupIfDue();
  setInterval(autoBackupIfDue, AUTO_BACKUP_CHECK_MS);

  $('#menu-toggle').addEventListener('click', toggleNav);
  $('#scrim').addEventListener('click', () => $('#app').classList.remove('nav-open'));
  window.addEventListener('hashchange', () => showView(routeName()));
  window.addEventListener('store:change', renderActive);

  tick();
  setInterval(tick, 1000);
  showView(routeName());
}

init();
