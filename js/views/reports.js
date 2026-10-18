/* Báo cáo định kỳ: tự tổng hợp theo tuần, tháng, quý, năm hoặc khoảng tùy chọn, trình bày theo mẫu báo cáo hành chính.
   In / lưu PDF, xuất Excel; phần nhận xét được viết tự động từ số liệu và có thể sửa trực tiếp. */
import { deptName, sortedDepartments } from '../store.js';
import {
  trackedItems, measure, previousRange, change, tally, SOURCES, sourceLabel, daysBetween,
} from '../stats.js';
import { downloadWorkbook, dateCell } from '../excel.js';
import {
  $, esc, dateKey, addDays, formatDate, periodBounds, parseDateKey, fillOptions, toast,
} from '../utils.js';

const PRESETS = [
  ['week', 'Tuần này'], ['last-week', 'Tuần trước'],
  ['month', 'Tháng này'], ['last-month', 'Tháng trước'],
  ['quarter', 'Quý này'], ['last-quarter', 'Quý trước'],
  ['year', 'Năm nay'], ['custom', 'Tùy chọn'],
];
const OVERDUE_LIMIT = 20;

/* Nhận xét theo kỳ: { html, source: 'auto' | 'edited' }. Chỉ giữ trong phiên làm việc. */
const narratives = new Map();
let current = null;

/* ---------------- Khoảng thời gian ---------------- */

function presetRange(preset, today = dateKey()) {
  const d = parseDateKey(today);
  switch (preset) {
    case 'last-week': return periodBounds('week', addDays(today, -7));
    case 'last-month': return periodBounds('month', dateKey(new Date(d.getFullYear(), d.getMonth() - 1, 1)));
    case 'last-quarter': return periodBounds('quarter', addDays(periodBounds('quarter', today).from, -1));
    case 'year': return { from: `${d.getFullYear()}-01-01`, to: `${d.getFullYear()}-12-31` };
    case 'custom': {
      const from = $('#rp-from').value;
      const to = $('#rp-to').value;
      return from && to && from <= to ? { from, to } : periodBounds('month', today);
    }
    default: return periodBounds(preset, today);
  }
}

/* ---------------- Tổng hợp số liệu ---------------- */

const inside = (key, { from, to }) => Boolean(key) && key >= from && key <= to;
const pct = (value) => (value == null ? '—' : `${Math.round(value * 100)}%`);
const delta = (now, before) => {
  const c = change(now, before);
  if (c == null) return now ? 'mới phát sinh' : '—';
  if (Math.abs(c) < 0.005) return 'không đổi';
  return `${c > 0 ? 'tăng' : 'giảm'} ${Math.round(Math.abs(c) * 100)}%`;
};

/** Toàn bộ số liệu của báo cáo cho khoảng [from, to] (phần sau hôm nay không tính). */
function buildReport(range, today = dateKey()) {
  const eff = { from: range.from, to: range.to < today ? range.to : today };
  const prev = previousRange(eff);
  const items = trackedItems();
  const sources = SOURCES.map((s) => {
    const own = items.filter((x) => x.source === s.key);
    return { ...s, now: measure(own, eff, today), before: measure(own, prev, today) };
  });
  const intake = items.filter((x) => (x.source === 'petition' || x.source === 'reflection') && inside(x.start, eff));
  const depts = [...sortedDepartments(), { id: null, name: 'Chưa phân phòng' }]
    .map((d) => ({ name: d.name, ...measure(items.filter((x) => (x.deptId ?? null) === d.id), eff, today) }))
    .filter((row) => row.carriedIn || row.received || row.resolved || row.openEnd);
  const overdue = items
    .filter((x) => !x.closed && x.deadline && x.deadline < today)
    .map((x) => ({ ...x, days: daysBetween(x.deadline, today) }))
    .sort((a, b) => b.days - a.days);
  const detail = items
    .filter((x) => inside(x.start, eff) || (x.closed && inside(x.closedAt, eff)))
    .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  return {
    range,
    eff,
    prev,
    today,
    total: measure(items, eff, today),
    totalBefore: measure(items, prev, today),
    sources,
    types: tally(intake.filter((x) => x.source === 'petition'), (x) => x.type),
    fields: tally(intake, (x) => x.field || 'Khác'),
    areas: tally(intake.filter((x) => x.source === 'reflection'), (x) => x.area),
    depts,
    overdue,
    detail,
  };
}

/* ---------------- Nhận xét tự động ---------------- */

const top = (rows, n = 3) => rows.slice(0, n).map(([name, count]) => `${name} (${count})`).join(', ');

function autoNarrative(r) {
  const t = r.total;
  const parts = r.sources.filter((s) => s.now.received).map((s) => `${s.now.received} ${s.label.toLowerCase()}`);
  const lines = [];
  lines.push(`Trong kỳ, tiếp nhận và được giao mới ${t.received} hồ sơ, nhiệm vụ${parts.length ? ` (${parts.join('; ')})` : ''}, ${delta(t.received, r.totalBefore.received)} so với kỳ trước.`);
  lines.push(`Đã giải quyết, hoàn thành ${t.resolved} hồ sơ, nhiệm vụ${t.resolved ? `, trong đó ${t.onTime} đúng hạn (tỷ lệ ${pct(t.onTimeRate)})` : ''}${t.avgDays != null ? `; thời gian giải quyết bình quân ${t.avgDays.toFixed(1)} ngày` : ''}.`);
  lines.push(`Tính đến cuối kỳ còn ${t.openEnd} hồ sơ, nhiệm vụ đang xử lý, trong đó ${t.overdueEnd} quá hạn.`);
  if (r.fields.length) lines.push(`Lĩnh vực phát sinh nhiều đơn thư, phản ánh: ${top(r.fields)}.`);
  if (r.areas.length) lines.push(`Khu vực có nhiều phản ánh: ${top(r.areas)}.`);
  const worst = [...r.depts].filter((d) => d.overdueEnd).sort((a, b) => b.overdueEnd - a.overdueEnd)[0];
  if (worst) lines.push(`Đơn vị còn nhiều việc quá hạn nhất: ${worst.name} (${worst.overdueEnd} việc).`);
  if (r.overdue.length) {
    lines.push(`Đề nghị các phòng, đơn vị tập trung giải quyết dứt điểm ${r.overdue.length} hồ sơ, nhiệm vụ đang quá hạn; trường hợp vướng mắc kịp thời báo cáo lãnh đạo để chỉ đạo xử lý.`);
  } else {
    lines.push('Không có hồ sơ, nhiệm vụ quá hạn tại thời điểm lập báo cáo; đề nghị các phòng, đơn vị tiếp tục duy trì tiến độ.');
  }
  return lines.map((l) => `<p>${esc(l)}</p>`).join('');
}

/* ---------------- Hiển thị ---------------- */

const num = (n) => (n ? String(n) : '0');

function measureRow(label, x, before, cls = '') {
  return `
    <tr class="${cls}">
      <td>${esc(label)}</td>
      <td>${num(x.carriedIn)}</td>
      <td>${num(x.received)}</td>
      <td class="rp-muted">${before ? esc(delta(x.received, before.received)) : ''}</td>
      <td>${num(x.resolved)}</td>
      <td>${num(x.onTime)}</td>
      <td>${num(x.openEnd)}</td>
      <td class="${x.overdueEnd ? 'rp-danger' : ''}">${num(x.overdueEnd)}</td>
    </tr>`;
}

function tallyTable(title, rows, empty) {
  return `
    <div>
      <p class="rp-caption">${esc(title)}</p>
      <table class="rp-table">
        <thead><tr><th>Nội dung</th><th>Số lượng</th></tr></thead>
        <tbody>${rows.length ? rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('') : `<tr><td colspan="2" class="rp-muted">${esc(empty)}</td></tr>`}</tbody>
      </table>
    </div>`;
}

const narrativeKey = (r) => `${r.range.from}|${r.range.to}`;
const SOURCE_NOTE = { auto: 'Tự động từ số liệu', edited: 'Đã chỉnh sửa' };

export function renderReports() {
  const preset = $('#rp-period').value;
  $('#rp-range').hidden = preset !== 'custom';
  const r = buildReport(presetRange(preset));
  current = r;
  const d = parseDateKey(r.today);
  const key = narrativeKey(r);
  if (!narratives.has(key) || narratives.get(key).source === 'auto') narratives.set(key, { html: autoNarrative(r), source: 'auto' });
  const narrative = narratives.get(key);
  $('#rp-narrative-state').textContent = SOURCE_NOTE[narrative.source];

  const shownOverdue = r.overdue.slice(0, OVERDUE_LIMIT);
  $('#rp-doc').innerHTML = `
    <header class="rp-header">
      <div class="rp-org">
        <b>ỦY BAN NHÂN DÂN</b>
        <b>XÃ BÌNH MỸ</b>
        <span class="rp-rule"></span>
        <span>Số: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;/BC-UBND</span>
      </div>
      <div class="rp-nation">
        <b>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</b>
        <b>Độc lập - Tự do - Hạnh phúc</b>
        <span class="rp-rule"></span>
        <i>Bình Mỹ, ngày ${String(d.getDate()).padStart(2, '0')} tháng ${String(d.getMonth() + 1).padStart(2, '0')} năm ${d.getFullYear()}</i>
      </div>
    </header>

    <h2 class="rp-title">BÁO CÁO</h2>
    <p class="rp-subtitle">
      Tình hình tiếp nhận, giải quyết đơn thư, phản ánh và thực hiện nhiệm vụ được giao<br>
      (Từ ngày ${formatDate(r.range.from)} đến ngày ${formatDate(r.range.to)})
    </p>
    ${r.range.to > r.today ? `<p class="rp-note">Số liệu tính đến ngày ${formatDate(r.today)}.</p>` : ''}

    <h3>I. TỔNG HỢP SỐ LIỆU</h3>
    <div class="rp-table-wrap">
      <table class="rp-table">
        <thead>
          <tr>
            <th>Nội dung</th><th>Kỳ trước chuyển sang</th><th>Tiếp nhận, giao mới</th><th>So với kỳ trước</th>
            <th>Đã giải quyết, hoàn thành</th><th>Trong đó đúng hạn</th><th>Còn tồn cuối kỳ</th><th>Trong đó quá hạn</th>
          </tr>
        </thead>
        <tbody>
          ${r.sources.map((s) => measureRow(s.label, s.now, s.before)).join('')}
          ${measureRow('Tổng cộng', r.total, r.totalBefore, 'rp-total')}
        </tbody>
      </table>
    </div>
    <p class="rp-note">
      Tỷ lệ giải quyết đúng hạn: <b>${pct(r.total.onTimeRate)}</b> ·
      Thời gian giải quyết bình quân: <b>${r.total.avgDays == null ? '—' : `${r.total.avgDays.toFixed(1)} ngày`}</b> ·
      Kỳ so sánh: ${formatDate(r.prev.from)} – ${formatDate(r.prev.to)}.
      Số giải quyết tính theo ngày hệ thống ghi nhận hoàn thành.
    </p>

    <h3>II. ĐƠN THƯ, PHẢN ÁNH THEO LOẠI, LĨNH VỰC, KHU VỰC</h3>
    <div class="rp-grid">
      ${tallyTable('Đơn thư theo loại', r.types, 'Không có đơn thư')}
      ${tallyTable('Đơn thư, phản ánh theo lĩnh vực', r.fields, 'Không có đơn thư, phản ánh')}
      ${tallyTable('Phản ánh 1022 theo khu vực', r.areas, 'Không có phản ánh')}
    </div>

    <h3>III. KẾT QUẢ THEO PHÒNG, ĐƠN VỊ</h3>
    <div class="rp-table-wrap">
      <table class="rp-table">
        <thead>
          <tr><th>Phòng, đơn vị (xử lý chính)</th><th>Kỳ trước chuyển sang</th><th>Tiếp nhận, được giao</th><th>Đã hoàn thành</th><th>Đúng hạn</th><th>Còn tồn</th><th>Quá hạn</th><th>Tỷ lệ đúng hạn</th></tr>
        </thead>
        <tbody>
          ${r.depts.length ? r.depts.map((x) => `
            <tr>
              <td>${esc(x.name)}</td><td>${num(x.carriedIn)}</td><td>${num(x.received)}</td><td>${num(x.resolved)}</td>
              <td>${num(x.onTime)}</td><td>${num(x.openEnd)}</td><td class="${x.overdueEnd ? 'rp-danger' : ''}">${num(x.overdueEnd)}</td>
              <td>${pct(x.onTimeRate)}</td>
            </tr>`).join('') : '<tr><td colspan="8" class="rp-muted">Không có số liệu trong kỳ</td></tr>'}
        </tbody>
      </table>
    </div>

    <h3>IV. HỒ SƠ, NHIỆM VỤ QUÁ HẠN CẦN TẬP TRUNG CHỈ ĐẠO</h3>
    <p class="rp-note">Tính đến ngày lập báo cáo (${formatDate(r.today)}), xếp theo số ngày quá hạn.</p>
    <div class="rp-table-wrap">
      <table class="rp-table">
        <thead><tr><th>STT</th><th>Nội dung</th><th>Nguồn</th><th>Phòng xử lý chính</th><th>Hạn</th><th>Quá hạn</th></tr></thead>
        <tbody>
          ${shownOverdue.length ? shownOverdue.map((x, i) => `
            <tr>
              <td>${i + 1}</td><td>${esc(x.title)}</td><td>${esc(sourceLabel(x.source))}</td>
              <td>${esc(deptName(x.deptId))}</td><td>${formatDate(x.deadline)}</td><td class="rp-danger">${x.days} ngày</td>
            </tr>`).join('') : '<tr><td colspan="6" class="rp-muted">Không có hồ sơ, nhiệm vụ quá hạn</td></tr>'}
        </tbody>
      </table>
    </div>
    ${r.overdue.length > OVERDUE_LIMIT ? `<p class="rp-note">… và ${r.overdue.length - OVERDUE_LIMIT} mục khác (xem đầy đủ trong file Excel).</p>` : ''}

    <h3>V. NHẬN XÉT, ĐÁNH GIÁ VÀ ĐỀ XUẤT</h3>
    <div class="rp-narrative" id="rp-narrative" contenteditable="true" spellcheck="false" aria-label="Nhận xét, đánh giá — có thể sửa trực tiếp">${narrative.html}</div>

    <div class="rp-sign">
      <div><b>NGƯỜI LẬP BÁO CÁO</b><i>(Ký, ghi rõ họ tên)</i></div>
      <div><b>TM. ỦY BAN NHÂN DÂN</b><i>(Ký, ghi rõ họ tên, đóng dấu)</i></div>
    </div>`;
}

/* ---------------- Thao tác ---------------- */

function resetNarrative() {
  if (!current) return;
  narratives.delete(narrativeKey(current));
  renderReports();
  toast('Đã viết lại nhận xét tự động từ số liệu', 'success');
}

function printReport() {
  const title = document.title;
  document.title = `Bao cao ${current.range.from} den ${current.range.to}`;
  window.addEventListener('afterprint', () => { document.title = title; }, { once: true });
  window.print();
}

async function exportExcel() {
  if (!current) return;
  const r = current;
  const statusOf = (x) => {
    if (x.closed) return x.closedAt ? (x.closedAt <= x.deadline ? 'Hoàn thành đúng hạn' : 'Hoàn thành trễ hạn') : 'Đã hoàn thành';
    return x.deadline < r.today ? 'Quá hạn' : 'Chưa thực hiện';
  };
  const mHead = ['Nội dung', 'Kỳ trước chuyển sang', 'Tiếp nhận, giao mới', 'Đã giải quyết', 'Đúng hạn', 'Trễ hạn', 'Còn tồn cuối kỳ', 'Quá hạn', 'Tỷ lệ đúng hạn', 'Thời gian xử lý TB (ngày)'];
  const mRow = (label, x) => [label, x.carriedIn, x.received, x.resolved, x.onTime, x.late, x.openEnd, x.overdueEnd,
    x.onTimeRate == null ? '' : Math.round(x.onTimeRate * 100) / 100, x.avgDays == null ? '' : Number(x.avgDays.toFixed(1))];
  try {
    await downloadWorkbook(`bao-cao-${r.range.from}-den-${r.range.to}.xlsx`, [
      {
        name: 'Tổng hợp',
        widths: [26, 14, 14, 14, 10, 10, 14, 10, 12, 16],
        rows: [
          ['BÁO CÁO TÌNH HÌNH TIẾP NHẬN, GIẢI QUYẾT ĐƠN THƯ, PHẢN ÁNH VÀ THỰC HIỆN NHIỆM VỤ'],
          ['Từ ngày', dateCell(r.range.from), 'đến ngày', dateCell(r.range.to)],
          [],
          mHead,
          ...r.sources.map((s) => mRow(s.label, s.now)),
          mRow('Tổng cộng', r.total),
        ],
      },
      {
        name: 'Theo phòng',
        widths: [30, 14, 14, 14, 10, 10, 14, 10, 12, 16],
        rows: [mHead.map((h, i) => (i === 0 ? 'Phòng, đơn vị' : h)), ...r.depts.map((d) => mRow(d.name, d))],
      },
      {
        name: 'Loại - lĩnh vực - khu vực',
        widths: [30, 10, 4, 30, 10, 4, 24, 10],
        rows: (() => {
          const n = Math.max(r.types.length, r.fields.length, r.areas.length);
          const rows = [['Loại đơn', 'Số lượng', '', 'Lĩnh vực', 'Số lượng', '', 'Khu vực phản ánh', 'Số lượng']];
          for (let i = 0; i < n; i++) {
            rows.push([...(r.types[i] ?? ['', '']), '', ...(r.fields[i] ?? ['', '']), '', ...(r.areas[i] ?? ['', ''])]);
          }
          return rows;
        })(),
      },
      {
        name: 'Quá hạn',
        widths: [6, 50, 16, 28, 12, 12],
        rows: [
          ['STT', 'Nội dung', 'Nguồn', 'Phòng xử lý chính', 'Hạn', 'Số ngày quá hạn'],
          ...r.overdue.map((x, i) => [i + 1, x.title, sourceLabel(x.source), deptName(x.deptId), dateCell(x.deadline), x.days]),
        ],
      },
      {
        name: 'Chi tiết trong kỳ',
        widths: [16, 14, 50, 28, 14, 14, 16, 22],
        rows: [
          ['Nguồn', 'Mã / số', 'Nội dung', 'Phòng xử lý chính', 'Ngày tiếp nhận, giao', 'Hạn', 'Ngày hoàn thành', 'Tình trạng'],
          ...r.detail.map((x) => [
            sourceLabel(x.source), x.code, x.title, deptName(x.deptId),
            x.start ? dateCell(x.start) : '', x.deadline ? dateCell(x.deadline) : '', x.closedAt ? dateCell(x.closedAt) : '', statusOf(x),
          ]),
        ],
      },
    ]);
    toast('Đã xuất báo cáo ra Excel', 'success');
  } catch (err) {
    console.warn(err);
    toast('Không tạo được file Excel. Kiểm tra kết nối Internet (thư viện Excel tải lần đầu).', 'error');
  }
}

/** Mở Báo cáo định kỳ với kỳ đặt sẵn (dùng từ thông báo). */
export function openReport(preset = 'month') {
  $('#rp-period').value = preset;
  if (location.hash.slice(1) !== 'reports') location.hash = 'reports';
  else renderReports();
}

export function initReports() {
  fillOptions($('#rp-period'), PRESETS);
  $('#rp-period').value = 'month';
  $('#rp-period').addEventListener('change', () => {
    if ($('#rp-period').value === 'custom' && !$('#rp-from').value) {
      const b = periodBounds('month');
      $('#rp-from').value = b.from;
      $('#rp-to').value = b.to;
    }
    renderReports();
  });
  for (const el of [$('#rp-from'), $('#rp-to')]) el.addEventListener('change', renderReports);
  $('#rp-print').addEventListener('click', printReport);
  $('#rp-excel').addEventListener('click', exportExcel);
  $('#rp-reset').addEventListener('click', resetNarrative);
  $('#rp-doc').addEventListener('input', (e) => {
    if (e.target.id !== 'rp-narrative' || !current) return;
    narratives.set(narrativeKey(current), { html: e.target.innerHTML, source: 'edited' });
    $('#rp-narrative-state').textContent = SOURCE_NOTE.edited;
  });
}
