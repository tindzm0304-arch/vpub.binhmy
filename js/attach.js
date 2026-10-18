/* Tệp đính kèm dùng chung cho Giao việc BTV, Đơn thư và Phản ánh 1022: chọn hoặc kéo thả từ máy tính,
   nội dung lưu trên trình duyệt (IndexedDB). Form giữ tệp chờ lưu; chi tiết thêm, mở, tải, xóa tệp đã lưu. */
import { saveBlob, getBlob, deleteBlobs } from './files.js';
import { confirmDialog } from './modal.js';
import { esc, uid, fileItem, toast } from './utils.js';

/* Vùng kéo thả và ô chọn tệp. `onPick` đọc FileList ngay (đồng bộ), vì ô chọn bị xóa giá trị sau đó. */
function wireDropzone(zone, input, onPick) {
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  for (const type of ['dragenter', 'dragover']) {
    zone.addEventListener(type, (e) => {
      e.preventDefault();
      zone.classList.add('is-drag');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    zone.addEventListener(type, (e) => {
      e.preventDefault();
      zone.classList.remove('is-drag');
    });
  }
  zone.addEventListener('drop', (e) => onPick(e.dataTransfer.files));
  input.addEventListener('change', () => {
    onPick(input.files);
    input.value = '';
  });
}

/** Khu tệp trong form (chưa lưu). `state.files` là danh sách; `state.render()` vẽ lại. Tệp đã có sẵn của mục không có `blob`. */
export function formFiles(zone, input, list, count) {
  const state = {
    files: [],
    render() {
      count.textContent = `${state.files.length} tệp`;
      list.innerHTML = state.files.map((f) => fileItem(f,
        `<button type="button" class="icon-btn is-danger" data-remove="${esc(f.id)}" aria-label="Gỡ ${esc(f.name)}" title="Gỡ tệp"><i class="fa-solid fa-xmark"></i></button>`,
      )).join('');
    },
  };
  wireDropzone(zone, input, (fileList) => {
    state.files.push(...Array.from(fileList, (file) => ({ id: uid(), name: file.name, type: file.type, size: file.size, blob: file })));
    state.render();
  });
  list.addEventListener('click', (e) => {
    const id = e.target.closest('[data-remove]')?.dataset.remove;
    if (!id) return;
    state.files = state.files.filter((f) => f.id !== id);
    state.render();
  });
  return state;
}

/** Ghi tệp mới của form xuống trình duyệt, trả về danh sách tệp để lưu vào mục. Ném lỗi nếu không ghi được. */
export async function commitFiles(list) {
  await Promise.all(list.filter((f) => f.blob).map((f) => saveBlob(f.id, f.blob)));
  return list.map(({ id, name, type, size, sample }) => ({ id, name, type, size, sample: Boolean(sample) }));
}

/** Xóa nội dung các tệp đã bị gỡ khỏi mục (tệp nào không còn trong `kept`). */
export function dropRemoved(oldFiles = [], kept = []) {
  const ids = oldFiles.filter((old) => !kept.some((f) => f.id === old.id)).map((f) => f.id);
  if (ids.length) deleteBlobs(ids).catch((err) => console.warn(err));
}

/* ---------- Tài liệu đã lưu trong chi tiết ---------- */

export function renderSaved(list, count, files = []) {
  count.textContent = files.length;
  list.innerHTML = files.length
    ? files.map((f) => fileItem(f, `
        <button type="button" class="icon-btn" data-file-action="open" data-file-id="${esc(f.id)}" title="Mở" aria-label="Mở ${esc(f.name)}"><i class="fa-regular fa-eye"></i></button>
        <button type="button" class="icon-btn" data-file-action="download" data-file-id="${esc(f.id)}" title="Tải xuống" aria-label="Tải xuống ${esc(f.name)}"><i class="fa-solid fa-download"></i></button>
        <button type="button" class="icon-btn is-danger" data-file-action="delete" data-file-id="${esc(f.id)}" title="Xóa tệp" aria-label="Xóa ${esc(f.name)}"><i class="fa-regular fa-trash-can"></i></button>`))
      .join('')
    : '<div class="empty-inline">Chưa có tài liệu đính kèm.</div>';
}

/** Mở, tải, xóa tệp đã lưu. `owner()` trả về mục đang xem; `changed()` ghi dữ liệu và vẽ lại. */
export function wireSaved(list, owner, changed) {
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-file-action]');
    const item = owner();
    const file = item?.files?.find((f) => f.id === btn?.dataset.fileId);
    if (!file) return;
    if (btn.dataset.fileAction === 'delete') removeSaved(item, file, changed);
    else openSaved(file, btn.dataset.fileAction === 'download');
  });
}

/** Thêm tệp từ ô chọn của khu chi tiết vào mục. Trả về số tệp đã thêm; người gọi ghi dữ liệu và vẽ lại. */
export async function addSaved(item, input) {
  const picked = Array.from(input.files);
  input.value = '';
  item.files = item.files ?? [];
  let added = 0;
  try {
    for (const file of picked) {
      const id = uid();
      await saveBlob(id, file);
      item.files.push({ id, name: file.name, type: file.type, size: file.size, sample: false });
      added++;
    }
  } catch (err) {
    console.error(err);
    toast('Không lưu được tệp đính kèm', 'error');
  }
  return added;
}

async function removeSaved(item, file, changed) {
  const ok = await confirmDialog({
    title: 'Xóa tệp đính kèm?',
    message: `Tệp "${file.name}" sẽ bị gỡ khỏi mục này.`,
    confirmText: 'Xóa tệp',
  });
  if (!ok) return;
  item.files = item.files.filter((f) => f.id !== file.id);
  deleteBlobs([file.id]).catch((err) => console.warn(err));
  changed();
  toast('Đã xóa tệp', 'success');
}

async function openSaved(file, download) {
  if (file.sample) {
    toast('Tệp mẫu không có nội dung để mở', 'info');
    return;
  }
  try {
    const blob = await getBlob(file.id);
    if (!blob) {
      toast('Không tìm thấy nội dung tệp trên thiết bị này', 'error');
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, target: '_blank', rel: 'noopener' });
    if (download) link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    console.error(err);
    toast('Không mở được tệp', 'error');
  }
}
