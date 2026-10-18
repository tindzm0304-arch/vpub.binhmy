/* Thao tác hàng loạt dùng chung cho Giao việc BTV, Đơn thư và Phản ánh 1022: chọn nhiều dòng, đổi trạng thái / phòng / hạn, xuất Excel, xóa.
   Giao diện giống Giao việc TTUB; mỗi màn hình truyền cấu hình (tiền tố id, loại dữ liệu, trạng thái, cách xuất). */
import {
  persist, trashWithUndo, deptName, sortedDepartments, syncTaskEvent,
} from './store.js';
import { downloadWorkbook } from './excel.js';
import { confirmDialog } from './modal.js';
import { $, $$, esc, fillOptions, formatDate, dateKey, toast } from './utils.js';

/**
 * cfg:
 *  prefix        tiền tố id trong HTML (bt / pt / pa): `#<prefix>-rows`, `#<prefix>-bulk`, ...
 *  kind          mảng trong store (tasks / petitions / reflections)
 *  noun          tên gọi trong thông báo, ví dụ "giao việc BTV"
 *  byId          tra cứu mục theo id
 *  statuses      các trạng thái có thể đổi hàng loạt
 *  setStatus     (mục, giá trị) => cập nhật trạng thái
 *  dept          tên trường phòng xử lý chính (departmentId / deptId)
 *  syncEvent     true nếu mục có lịch đồng bộ (giao việc) thì cập nhật lịch khi đổi
 *  render        vẽ lại màn hình
 *  sheet, exportName, widths, exportHeader, exportRow(mục, stt)  cấu hình file Excel
 */
export function createBulk(cfg) {
  const selected = new Set();
  let visibleIds = [];
  const id = (suffix) => `#${cfg.prefix}-${suffix}`;
  const rowsSel = `#${cfg.prefix}-rows`;

  const items = () => [...selected].map((rowId) => cfg.byId(rowId)).filter(Boolean);

  /** Đồng bộ ô chọn và thanh thao tác với danh sách đang hiện. */
  function sync() {
    for (const rowId of [...selected]) if (!cfg.byId(rowId)) selected.delete(rowId);
    for (const box of $$(`${rowsSel} [data-select]`)) box.checked = selected.has(box.dataset.select);
    for (const row of $$(`${rowsSel} tr[data-id]`)) row.classList.toggle('is-selected', selected.has(row.dataset.id));
    const all = visibleIds.length > 0 && visibleIds.every((rowId) => selected.has(rowId));
    const some = visibleIds.some((rowId) => selected.has(rowId));
    const master = $(id('select-all'));
    master.checked = all;
    master.indeterminate = !all && some;
    $(id('bulk')).hidden = selected.size === 0;
    $(id('bulk-count')).textContent = selected.size;
    const depts = sortedDepartments();
    const deptSelect = $(id('bulk-dept'));
    if (deptSelect.options.length !== depts.length + 1) {
      fillOptions(deptSelect, depts.map((d) => [d.id, d.name]), '<option value="">Chuyển phòng xử lý…</option>');
    }
  }

  function syncEvents(list) {
    if (cfg.syncEvent) for (const item of list) if (item.eventId) syncTaskEvent(item, true);
  }

  /** Đổi các mục đã chọn, có nút hoàn tác ngay trên thông báo. */
  function edit(message, change) {
    const list = items();
    if (!list.length) return;
    const keys = ['status', cfg.dept, 'collabDeptIds', 'deadline', 'timeline'];
    const before = list.map((item) => ({
      item, saved: Object.fromEntries(keys.filter((k) => k in item).map((k) => [k, structuredClone(item[k])])),
    }));
    list.forEach(change);
    syncEvents(list);
    persist();
    toast(message(list.length), 'success', {
      label: 'Hoàn tác',
      onClick: () => {
        for (const b of before) Object.assign(b.item, b.saved);
        syncEvents(list);
        persist();
        toast('Đã hoàn tác', 'success');
        cfg.render();
      },
    });
    cfg.render();
  }

  async function exportSelected() {
    const list = items();
    if (!list.length) return;
    const rows = [cfg.exportHeader, ...list.map((item, i) => cfg.exportRow(item, i + 1))];
    try {
      await downloadWorkbook(`${cfg.exportName}-${dateKey()}.xlsx`, [{ name: cfg.sheet, rows, widths: cfg.widths }]);
    } catch (err) {
      console.error(err);
      toast('Không xuất được Excel. Kiểm tra kết nối mạng rồi thử lại.', 'error');
    }
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    const ok = await confirmDialog({
      title: `Chuyển ${ids.length} ${cfg.noun} vào thùng rác?`,
      message: 'Có thể khôi phục trong 30 ngày từ mục Thùng rác trong menu, hoặc bấm Hoàn tác ngay sau khi xóa.',
      confirmText: 'Chuyển vào thùng rác',
    });
    if (!ok) return;
    selected.clear();
    trashWithUndo(cfg.kind, ids, cfg.noun);
    cfg.render();
  }

  return {
    /** Ô chọn đầu dòng. */
    cell: (rowId) => `<td class="col-check"><input type="checkbox" data-select="${esc(rowId)}" ${selected.has(rowId) ? 'checked' : ''} aria-label="Chọn dòng này"></td>`,
    rowClass: (rowId) => (selected.has(rowId) ? 'is-selected' : ''),
    /** Gọi sau khi vẽ lại bảng, `ids` là các dòng đang hiện (sau lọc). */
    update(ids) {
      visibleIds = ids;
      sync();
    },
    wire() {
      fillOptions($(id('bulk-status')), cfg.statuses, '<option value="">Đổi trạng thái…</option>');
      $(id('select-all')).addEventListener('change', (e) => {
        for (const rowId of visibleIds) if (e.target.checked) selected.add(rowId); else selected.delete(rowId);
        sync();
      });
      $(rowsSel).addEventListener('change', (e) => {
        const box = e.target.closest('[data-select]');
        if (!box) return;
        if (box.checked) selected.add(box.dataset.select); else selected.delete(box.dataset.select);
        sync();
      });
      $(id('bulk-status')).addEventListener('change', (e) => {
        const value = e.target.value;
        e.target.value = '';
        if (value) edit((n) => `Đã đổi trạng thái ${n} ${cfg.noun}`, (item) => cfg.setStatus(item, value));
      });
      $(id('bulk-dept')).addEventListener('change', (e) => {
        const value = e.target.value;
        e.target.value = '';
        if (!value) return;
        edit((n) => `Đã chuyển ${n} ${cfg.noun} sang ${deptName(value)}`, (item) => {
          item[cfg.dept] = value;
          item.collabDeptIds = (item.collabDeptIds ?? []).filter((d) => d !== value);
        });
      });
      $(id('bulk-deadline')).addEventListener('change', (e) => {
        const value = e.target.value;
        e.target.value = '';
        if (value) edit((n) => `Đã đổi hạn chót ${n} ${cfg.noun} sang ${formatDate(value)}`, (item) => { item.deadline = value; });
      });
      $(id('bulk-export')).addEventListener('click', exportSelected);
      $(id('bulk-delete')).addEventListener('click', deleteSelected);
      $(id('bulk-clear')).addEventListener('click', () => {
        selected.clear();
        sync();
      });
    },
  };
}
