/* Màn hình Tự động hóa: mẫu đầu việc con, công việc định kỳ, quy tắc hành động, ủy quyền khi vắng mặt,
   mẫu trả lời công dân. Chạy trên máy, không gửi dữ liệu đi đâu. */
import { store, persist, handOver, deptName, sortedDepartments } from '../store.js';
import { getSettings, saveSettings } from '../settings.js';
import { confirmDialog } from '../modal.js';
import { FIELD_NAMES, PETITION_TYPES } from '../classify.js';
import { $, esc, uid, dateKey, formatDate, toast, PRIORITIES } from '../utils.js';

const CYCLES = [['week', 'Hằng tuần'], ['month', 'Hằng tháng'], ['quarter', 'Hằng quý']];
const CYCLE_LABEL = Object.fromEntries(CYCLES);
const KIND_LABEL = { petitions: 'Đơn thư, PAKN', reflections: 'Phản ánh 1022' };

const opt = (value, label, selected = '') => `<option value="${esc(value)}"${String(value) === String(selected ?? '') ? ' selected' : ''}>${esc(label)}</option>`;
const deptOptions = (selected) => `<option value="">Chọn phòng…</option>${sortedDepartments().map((d) => opt(d.id, d.name, selected)).join('')}`;
const personOptions = (selected) => `<option value="">Chọn cán bộ…</option>${store.personnel.map((p) => opt(p.id, p.name, selected)).join('')}`;
const checklistOptions = (selected) => `<option value="">Không dùng mẫu</option>${store.checklists.map((c) => opt(c.id, c.name, selected)).join('')}`;
const priorityOptions = (selected = 'Trung bình') => PRIORITIES.map((p) => opt(p, p, selected)).join('');
const petitionLabel = (p) => `${p.code} · ${p.type} · ${p.citizen?.name || 'Ẩn danh'}`;

const card = (tone, icon, title, note, body) => `
  <section class="set-card">
    <div class="set-head">
      <span class="set-ico tone-${tone}"><i class="fa-solid ${icon}"></i></span>
      <div>
        <h3>${esc(title)}</h3>
        <p class="set-note">${esc(note)}</p>
      </div>
    </div>
    ${body}
  </section>`;

/** Một dòng trong danh sách: mô tả và các nút thao tác. */
const row = (text, sub, actions, off = false) => `
  <li class="auto-row ${off ? 'is-off' : ''}">
    <div><b>${esc(text)}</b><small>${esc(sub)}</small></div>
    <div class="row-actions">${actions}</div>
  </li>`;

const toggleBtn = (kind, id, enabled) => `<button type="button" class="btn btn-ghost btn-sm" data-act="toggle" data-kind="${kind}" data-id="${esc(id)}">${enabled ? 'Tạm dừng' : 'Bật lại'}</button>`;
const delBtn = (kind, id, label) => `<button type="button" class="icon-btn is-danger" data-act="del" data-kind="${kind}" data-id="${esc(id)}" aria-label="Xóa ${esc(label)}" title="Xóa"><i class="fa-regular fa-trash-can"></i></button>`;
const emptyRow = (text) => `<li class="empty-inline">${esc(text)}</li>`;

function checklistCard() {
  const list = store.checklists.map((c) => row(
    c.name,
    `${c.items.length} bước: ${c.items.slice(0, 3).join('; ')}${c.items.length > 3 ? '…' : ''}`,
    delBtn('checklists', c.id, c.name),
  )).join('') || emptyRow('Chưa có mẫu.');
  return card('green', 'fa-list-check', 'Mẫu đầu việc con (SOP)',
    'Mẫu gồm nhiều bước. Quy tắc hành động và công việc định kỳ dùng mẫu sẽ tự điền đầu việc con.',
    `<ul class="auto-list">${list}</ul>
     <form class="auto-form" data-form="checklist">
       <label class="field"><span class="label">Tên mẫu</span><input class="input" name="name" maxlength="120" required placeholder="Ví dụ: Xử lý khiếu nại"></label>
       <label class="field"><span class="label">Các bước (mỗi dòng một bước)</span><textarea class="input" name="items" rows="4" required></textarea></label>
       <div class="btn-group set-actions"><button class="btn btn-primary btn-sm" type="submit"><i class="fa-solid fa-plus"></i> Thêm mẫu</button></div>
     </form>`);
}

function recurringCard() {
  const list = store.recurring.map((r) => row(
    r.title,
    `${CYCLE_LABEL[r.cycle]} · ${deptName(r.deptId)}${r.lastKey ? ` · kỳ gần nhất ${r.lastKey.split(':')[1]}` : ''}${r.enabled ? '' : ' · đang tạm dừng'}`,
    toggleBtn('recurring', r.id, r.enabled) + delBtn('recurring', r.id, r.title),
    !r.enabled,
  )).join('') || emptyRow('Chưa có công việc định kỳ.');
  return card('blue', 'fa-rotate', 'Công việc định kỳ',
    'Mỗi kỳ (tuần, tháng, quý) tự tạo một công việc cho phòng đã chọn, hạn chót là cuối kỳ. Mỗi kỳ chỉ tạo một lần.',
    `<ul class="auto-list">${list}</ul>
     <form class="auto-form" data-form="recurring">
       <label class="field"><span class="label">Tên công việc</span><input class="input" name="title" maxlength="160" required placeholder="Ví dụ: Báo cáo thu ngân sách"></label>
       <div class="form-grid set-grid">
         <label class="field"><span class="label">Phòng xử lý chính</span><select class="input" name="deptId" required>${deptOptions('')}</select></label>
         <label class="field"><span class="label">Chu kỳ</span><select class="input" name="cycle">${CYCLES.map(([v, l]) => opt(v, l)).join('')}</select></label>
         <label class="field"><span class="label">Mẫu đầu việc con</span><select class="input" name="checklistId">${checklistOptions('')}</select></label>
         <label class="field"><span class="label">Ưu tiên</span><select class="input" name="priority">${priorityOptions()}</select></label>
       </div>
       <div class="btn-group set-actions"><button class="btn btn-primary btn-sm" type="submit"><i class="fa-solid fa-plus"></i> Thêm công việc định kỳ</button></div>
     </form>`);
}

function rulesCard() {
  const list = store.rules.map((r) => row(
    r.title,
    `${KIND_LABEL[r.kind]} · ${r.type || 'mọi loại'} · ${r.field || 'mọi lĩnh vực'} → ${deptName(r.deptId)}, hạn ${r.days} ngày`,
    toggleBtn('rules', r.id, r.enabled) + delBtn('rules', r.id, r.title),
    !r.enabled,
  )).join('') || emptyRow('Chưa có quy tắc.');
  return card('amber', 'fa-bolt', 'Quy tắc hành động',
    'Khi có đơn hoặc phản ánh mới khớp điều kiện, hệ thống tự tạo công việc giao cho phòng đã chọn. Không áp dụng cho dữ liệu nhập từ Excel.',
    `<ul class="auto-list">${list}</ul>
     <form class="auto-form" data-form="rule">
       <label class="field"><span class="label">Tên công việc tạo ra</span><input class="input" name="title" maxlength="160" required placeholder="Ví dụ: Xác minh nội dung khiếu nại"></label>
       <div class="form-grid set-grid">
         <label class="field"><span class="label">Áp dụng cho</span><select class="input" name="kind">${Object.entries(KIND_LABEL).map(([v, l]) => opt(v, l)).join('')}</select></label>
         <label class="field"><span class="label">Loại đơn (chỉ đơn thư)</span><select class="input" name="type"><option value="">Mọi loại</option>${PETITION_TYPES.map((t) => opt(t, t)).join('')}</select></label>
         <label class="field"><span class="label">Lĩnh vực</span><select class="input" name="field"><option value="">Mọi lĩnh vực</option>${FIELD_NAMES.map((f) => opt(f, f)).join('')}</select></label>
         <label class="field"><span class="label">Phòng xử lý chính</span><select class="input" name="deptId" required>${deptOptions('')}</select></label>
         <label class="field"><span class="label">Hạn sau (ngày)</span><input class="input" type="number" name="days" min="1" max="365" value="7"></label>
         <label class="field"><span class="label">Ưu tiên</span><select class="input" name="priority">${priorityOptions()}</select></label>
         <label class="field"><span class="label">Mẫu đầu việc con</span><select class="input" name="checklistId">${checklistOptions('')}</select></label>
       </div>
       <div class="btn-group set-actions"><button class="btn btn-primary btn-sm" type="submit"><i class="fa-solid fa-plus"></i> Thêm quy tắc</button></div>
     </form>`);
}

function absenceCard() {
  const today = dateKey();
  const list = store.personnel.filter((p) => p.absence).map((p) => {
    const a = p.absence;
    const active = a.from <= today && a.to >= today;
    return row(
      p.name,
      `Vắng ${formatDate(a.from)} – ${formatDate(a.to)} · ủy quyền: ${store.personnel.find((x) => x.id === a.delegateId)?.name ?? 'chưa chọn'}${active ? ' · đang vắng' : ''}`,
      `<button type="button" class="btn btn-ghost btn-sm" data-act="absence-clear" data-id="${esc(p.id)}">Bỏ đánh dấu</button>`,
    );
  }).join('') || emptyRow('Không có cán bộ nào đang được đánh dấu vắng mặt.');
  return card('red', 'fa-user-clock', 'Vắng mặt và ủy quyền',
    'Đánh dấu cán bộ vắng mặt. Có thể chuyển các công việc đang mở của người đó (theo người giao việc) cho người thay thế.',
    `<ul class="auto-list">${list}</ul>
     <form class="auto-form" data-form="absence">
       <div class="form-grid set-grid">
         <label class="field"><span class="label">Cán bộ vắng</span><select class="input" name="personId" required>${personOptions('')}</select></label>
         <label class="field"><span class="label">Từ ngày</span><input class="input" type="date" name="from" value="${today}" required></label>
         <label class="field"><span class="label">Đến ngày</span><input class="input" type="date" name="to" value="${today}" required></label>
         <label class="field"><span class="label">Người thay thế</span><select class="input" name="delegateId">${personOptions('')}</select></label>
       </div>
       <div class="btn-group set-actions">
         <button class="btn btn-primary btn-sm" type="submit"><i class="fa-solid fa-floppy-disk"></i> Lưu vắng mặt</button>
         <button class="btn btn-secondary btn-sm" type="button" data-act="handover"><i class="fa-solid fa-right-left"></i> Chuyển việc đang mở</button>
       </div>
     </form>`);
}

function templatesCard() {
  const templates = getSettings().replyTemplates;
  const list = templates.map((t) => row(t.name, t.body.split('\n')[0].slice(0, 90), delBtn('templates', t.id, t.name))).join('')
    || emptyRow('Chưa có mẫu trả lời.');
  const petitions = [...store.petitions].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return card('blue', 'fa-file-signature', 'Mẫu trả lời công dân',
    'Mẫu dùng các biến {ten} {ma} {loai} {linh_vuc} {phong} {ngay_nhan} {han} {ket_qua}. Chọn đơn để soạn sẵn nội dung, rồi sao chép.',
    `<ul class="auto-list">${list}</ul>
     <form class="auto-form" data-form="template">
       <label class="field"><span class="label">Tên mẫu</span><input class="input" name="name" maxlength="120" required></label>
       <label class="field"><span class="label">Nội dung</span><textarea class="input" name="body" rows="5" required></textarea></label>
       <div class="btn-group set-actions"><button class="btn btn-primary btn-sm" type="submit"><i class="fa-solid fa-plus"></i> Thêm mẫu</button></div>
     </form>
     <form class="auto-form compose" data-form="compose">
       <h4 class="eyebrow">Soạn thư trả lời</h4>
       <div class="form-grid set-grid">
         <label class="field"><span class="label">Đơn thư / PAKN</span><select class="input" name="petitionId"><option value="">Chọn đơn…</option>${petitions.map((p) => opt(p.id, petitionLabel(p))).join('')}</select></label>
         <label class="field"><span class="label">Mẫu</span><select class="input" name="templateId"><option value="">Chọn mẫu…</option>${templates.map((t) => opt(t.id, t.name)).join('')}</select></label>
       </div>
       <label class="field"><span class="label">Nội dung soạn sẵn (có thể sửa trước khi sao chép)</span><textarea class="input compose-out" id="auto-out" rows="8"></textarea></label>
       <div class="btn-group set-actions"><button class="btn btn-secondary btn-sm" type="button" data-act="copy"><i class="fa-regular fa-copy"></i> Sao chép</button></div>
     </form>`);
}

/** Điền biến của mẫu bằng dữ liệu đơn. Biến chưa có dữ liệu thì giữ nguyên để người soạn tự điền. */
export function fillTemplate(body, p) {
  const values = {
    ten: p.citizen?.name || 'Ông/Bà',
    ma: p.code,
    loai: p.type,
    linh_vuc: p.field || '',
    phong: deptName(p.deptId),
    ngay_nhan: formatDate(p.receivedAt),
    han: formatDate(p.deadline),
    ket_qua: p.result || '[nhập kết quả xử lý]',
  };
  return body.replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : match));
}

function render() {
  $('#auto-root').innerHTML = [checklistCard(), recurringCard(), rulesCard(), absenceCard(), templatesCard()].join('');
}

export function renderAutomation() {
  render();
}

/* ---------------- Gửi form ---------------- */

const field = (data, key) => String(data[key] ?? '').trim();

function submitChecklist(data) {
  const items = field(data, 'items').split('\n').map((s) => s.trim()).filter(Boolean);
  if (!field(data, 'name') || !items.length) return toast('Nhập tên mẫu và ít nhất một bước', 'error');
  store.checklists.push({ id: uid(), name: field(data, 'name'), items });
  persist();
  toast('Đã thêm mẫu đầu việc con', 'success');
}

function submitRecurring(data) {
  if (!field(data, 'title') || !field(data, 'deptId')) return toast('Nhập tên và phòng xử lý chính', 'error');
  store.recurring.push({
    id: uid(), title: field(data, 'title'), deptId: field(data, 'deptId'), cycle: field(data, 'cycle') || 'month',
    checklistId: field(data, 'checklistId') || null, priority: field(data, 'priority') || 'Trung bình', enabled: true, lastKey: null,
  });
  persist();
  toast('Đã thêm — công việc của kỳ hiện tại được tạo ngay', 'success');
}

function submitRule(data) {
  if (!field(data, 'title') || !field(data, 'deptId')) return toast('Nhập tên và phòng xử lý chính', 'error');
  store.rules.push({
    id: uid(), title: field(data, 'title'), kind: field(data, 'kind') || 'petitions', type: field(data, 'type'),
    field: field(data, 'field'), deptId: field(data, 'deptId'),
    days: Math.min(365, Math.max(1, Number(data.days) || 7)), priority: field(data, 'priority') || 'Trung bình',
    checklistId: field(data, 'checklistId') || null, enabled: true,
  });
  persist();
  toast('Đã thêm quy tắc — áp dụng cho đơn / phản ánh tạo sau thời điểm này', 'success');
}

function submitAbsence(data) {
  const person = store.personnel.find((p) => p.id === field(data, 'personId'));
  const { from, to } = data;
  if (!person || !from || !to || from > to) return toast('Chọn cán bộ và khoảng ngày hợp lệ', 'error');
  if (data.delegateId === person.id) return toast('Người thay thế phải là người khác', 'error');
  person.absence = { from, to, delegateId: field(data, 'delegateId') || null };
  persist();
  toast(`Đã đánh dấu ${person.name} vắng mặt`, 'success');
}

function submitTemplate(data) {
  if (!field(data, 'name') || !field(data, 'body')) return toast('Nhập tên và nội dung mẫu', 'error');
  saveSettings({ replyTemplates: [...getSettings().replyTemplates, { id: uid(), name: field(data, 'name'), body: data.body }] });
  toast('Đã thêm mẫu trả lời', 'success');
  render();
}

function onSubmit(e) {
  const form = e.target.closest('form[data-form]');
  if (!form || form.dataset.form === 'compose') return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const handlers = {
    checklist: submitChecklist, recurring: submitRecurring, rule: submitRule, absence: submitAbsence, template: submitTemplate,
  };
  handlers[form.dataset.form]?.(data);
}

/* ---------------- Thao tác trong danh sách ---------------- */

const LISTS = { checklists: 'store', recurring: 'store', rules: 'store', templates: 'settings' };

async function onClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const { act, kind, id } = btn.dataset;

  if (act === 'copy') {
    const text = $('#auto-out').value;
    if (!text) return toast('Chưa có nội dung để sao chép', 'info');
    try {
      await navigator.clipboard.writeText(text);
      toast('Đã sao chép nội dung trả lời', 'success');
    } catch {
      $('#auto-out').select();
      toast('Trình duyệt chặn sao chép — hãy bấm Ctrl+C', 'info');
    }
    return;
  }

  if (act === 'toggle') {
    const item = store[kind].find((x) => x.id === id);
    if (!item) return;
    item.enabled = !item.enabled;
    persist();
    return;
  }

  if (act === 'del') {
    const list = LISTS[kind] === 'settings' ? getSettings().replyTemplates : store[kind];
    const item = list.find((x) => x.id === id);
    const ok = await confirmDialog({
      title: 'Xóa mục này?', message: `"${item?.name ?? item?.title ?? ''}" sẽ bị xóa khỏi danh sách.`, confirmText: 'Xóa',
    });
    if (!ok) return;
    if (LISTS[kind] === 'settings') {
      saveSettings({ replyTemplates: getSettings().replyTemplates.filter((x) => x.id !== id) });
      render();
    } else {
      store[kind] = store[kind].filter((x) => x.id !== id);
      persist();
    }
    return;
  }

  if (act === 'absence-clear') {
    const person = store.personnel.find((p) => p.id === id);
    if (!person) return;
    person.absence = null;
    persist();
    return;
  }

  if (act === 'handover') {
    const data = Object.fromEntries(new FormData(btn.closest('form')));
    const from = store.personnel.find((p) => p.id === data.personId);
    const to = store.personnel.find((p) => p.id === data.delegateId);
    if (!from || !to || from.id === to.id) return toast('Chọn cán bộ vắng và người thay thế khác nhau', 'error');
    const ok = await confirmDialog({
      title: `Chuyển việc sang ${to.name}?`,
      message: `Các công việc đang mở do ${from.name} giao sẽ chuyển sang người thay thế. Muốn đưa lại thì phải sửa từng việc.`,
      confirmText: 'Chuyển việc', danger: false,
    });
    if (!ok) return;
    const moved = handOver(from.id, to.id);
    toast(moved ? `Đã chuyển ${moved} công việc sang ${to.name}` : 'Không có công việc đang mở để chuyển', moved ? 'success' : 'info');
  }
}

/** Chọn đơn hoặc mẫu trong phần soạn thư thì điền sẵn nội dung. */
function onChange(e) {
  const form = e.target.closest('form[data-form="compose"]');
  if (!form) return;
  const data = Object.fromEntries(new FormData(form));
  const petition = store.petitions.find((p) => p.id === data.petitionId);
  const template = getSettings().replyTemplates.find((t) => t.id === data.templateId);
  $('#auto-out').value = petition && template ? fillTemplate(template.body, petition) : '';
}

export function initAutomation() {
  const root = $('#auto-root');
  root.addEventListener('submit', onSubmit);
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
}
