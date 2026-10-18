/* Phân công theo phòng ban: một phòng xử lý chính và nhiều phòng phối hợp. Không giao cho cá nhân. */
import { deptName, deptNames, sortedDepartments, store } from './store.js';
import { esc, fillOptions, fold } from './utils.js';

const NO_LEAD = '<option value="">Chưa chọn phòng</option>';

/** Điền ô chọn phòng xử lý chính. `leading` là dòng đầu tiên (ví dụ placeholder bắt buộc chọn). */
export function fillLeadSelect(select, value = '', leading = NO_LEAD) {
  fillOptions(select, sortedDepartments().map((d) => [d.id, d.name]), leading);
  select.value = value ?? '';
}

/** Điền ô người giao: chỉ liệt kê cán bộ thuộc phòng Lãnh đạo; giữ lựa chọn cũ nếu người đó vẫn thuộc phòng này. */
export function fillAssignerSelect(select, value = '') {
  const leaderId = store.departments.find((d) => fold(d.name) === fold('Lãnh đạo'))?.id;
  const people = store.personnel
    .filter((p) => leaderId && p.deptId === leaderId)
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const leading = people.length ? '<option value="">Chọn người giao…</option>' : '<option value="">Phòng này chưa có cán bộ</option>';
  fillOptions(select, people.map((p) => [p.id, p.title ? `${p.name} (${p.title})` : p.name]), leading);
  select.value = people.some((p) => p.id === value) ? value : '';
}

/** Danh sách checkbox phòng phối hợp; phòng xử lý chính không xuất hiện trong danh sách này. */
export function renderCollabList(container, leadId, selected = []) {
  const picked = new Set(selected);
  const others = sortedDepartments().filter((d) => d.id !== leadId);
  container.innerHTML = others.length
    ? others.map((d) => `
        <label class="check-item">
          <input type="checkbox" value="${esc(d.id)}" ${picked.has(d.id) ? 'checked' : ''}>
          <span>${esc(d.name)}</span>
        </label>`).join('')
    : '<p class="muted">Chưa có phòng ban nào khác để phối hợp.</p>';
}

/** Các phòng phối hợp đang được chọn; bỏ qua phòng xử lý chính nếu có trùng. */
export function readCollabList(container, leadId = null) {
  return [...container.querySelectorAll('input:checked')]
    .map((input) => input.value)
    .filter((id) => id !== leadId);
}

/** Khi đổi phòng xử lý chính, danh sách phối hợp được vẽ lại và giữ các lựa chọn còn hợp lệ. */
export function wireLeadSelect(select, container) {
  select.addEventListener('change', () => {
    renderCollabList(container, select.value, readCollabList(container, select.value));
  });
}

/** Dòng hiển thị phòng xử lý chính và phòng phối hợp, dùng trong bảng và thẻ chi tiết. */
export function deptLines(leadId, collabIds = []) {
  const collab = deptNames(collabIds);
  return `<div class="meta-line"><i class="fa-solid fa-sitemap"></i> ${esc(deptName(leadId))}</div>`
    + (collab ? `<div class="meta-line"><i class="fa-solid fa-users"></i> Phối hợp: ${esc(collab)}</div>` : '');
}
