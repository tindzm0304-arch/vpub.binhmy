/* Phần dùng chung cho Đơn thư và Phản ánh 1022: gợi ý phân loại, nhãn trạng thái, nhật ký xử lý. */
import { classify, FIELD_NAMES } from '../classify.js';
import { store, DUE_LABEL } from '../store.js';
import { $, esc, formatDateTime, toast } from '../utils.js';

export { FIELD_NAMES };

export function dueBadge(state) {
  const cls = { overdue: 'badge-overdue', soon: 'badge-deadline', ok: 'badge-doing', closed: 'badge-todo' }[state];
  return `<span class="badge ${cls}">${DUE_LABEL[state]}</span>`;
}

/**
 * Gắn gợi ý phân loại vào ô nội dung: khi người dùng gõ đủ dài, hiện gợi ý lĩnh vực và phòng,
 * bấm "Áp dụng" để điền vào hai ô chọn tương ứng.
 */
export function wireSuggestion({ content, field, dept, chip }) {
  let current = null;
  const refresh = () => {
    const text = content.value.trim();
    current = text.length >= 10 ? classify(text, store.departments) : null;
    chip.hidden = !current || current.confidence === 0;
    if (chip.hidden) return;
    chip.innerHTML = `
      <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
      <span>Gợi ý: <b>${esc(current.field)}</b>${current.deptName ? ` · ${esc(current.deptName)}` : ''}</span>
      <button type="button" class="link-btn" data-apply><i class="fa-solid fa-check"></i> Áp dụng</button>`;
  };
  content.addEventListener('input', refresh);
  chip.addEventListener('click', (e) => {
    if (!e.target.closest('[data-apply]') || !current) return;
    field.value = current.field;
    if (dept && current.deptId) {
      dept.value = current.deptId;
      dept.dispatchEvent(new Event('change'));
    }
    chip.hidden = true;
    toast('Đã áp dụng gợi ý phân loại', 'success');
  });
  return { refresh };
}

/** Nhật ký xử lý, mới nhất ở trên. */
export function renderTimeline(list, item) {
  const entries = [...(item.timeline ?? [])].reverse();
  list.innerHTML = entries.length
    ? entries.map((e) => `
        <li>
          <span class="tl-dot" aria-hidden="true"></span>
          <div><b>${esc(e.text)}</b><small>${formatDateTime(e.at)}</small></div>
        </li>`).join('')
    : '<li class="muted">Chưa có nhật ký.</li>';
}

/** Nút hành động trong chân hộp chi tiết; `action` là giá trị của data-action. */
export function actionBtn(action, cls, icon, text) {
  return `<button type="button" class="btn ${cls} btn-sm" data-action="${action}"><i class="fa-solid ${icon}"></i> ${text}</button>`;
}

/** Ô chọn lĩnh vực; lĩnh vực ngoài danh sách (ví dụ nhập từ Excel) được thêm vào để không bị mất khi lưu. */
export function fillFieldSelect(select, value) {
  const names = value && !FIELD_NAMES.includes(value) ? [...FIELD_NAMES, value] : FIELD_NAMES;
  select.innerHTML = names.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  select.value = value || 'Khác';
}
