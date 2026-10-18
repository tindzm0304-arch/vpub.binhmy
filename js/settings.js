/* Cài đặt của máy này (localStorage): nhắc hạn, thông báo, sao lưu.
   Không nằm trong dữ liệu nghiệp vụ nên không đi vào bản sao lưu. */

const KEY = 'quan-ly-noi-bo:settings';

const DEFAULTS = {
  leadDays: 3, // nhắc trước hạn bao nhiêu ngày
  escalateDays: 7, // quá hạn từ bao nhiêu ngày thì đánh dấu cần báo lãnh đạo
  backupRemindDays: 7, // bao lâu chưa sao lưu thì nhắc
  desktopNotify: false, // thông báo trên màn hình máy tính
  lastBackupAt: null, // 'YYYY-MM-DDTHH:mm' lần tải bản sao lưu gần nhất
  autoBackup: true, // tự sao lưu mỗi ngày vào trình duyệt (giữ 7 bản)
  lastAutoBackupAt: null, // lần tự sao lưu gần nhất
  approvalRequired: false, // bật: chọn "Hoàn thành" sẽ chuyển sang "Chờ duyệt" cho đến khi lãnh đạo duyệt
  rulePetitionNoTaskDays: 2, // Khiếu nại / Tố cáo chưa có công việc sau N ngày (0 = tắt)
  ruleReviewDays: 2, // công việc chờ duyệt quá N ngày thì nhắc (0 = tắt)
  meId: null, // mã cán bộ đang dùng máy này (cho ghi chú)
  mineDeptId: null, // đơn vị đang xem trong "Việc cần xử lý"
  staleDays: 10, // công việc đang mở không có thay đổi sau N ngày thì nhắc "đứng im" (0 = tắt)
  replyTemplates: [ // mẫu trả lời công dân; biến: {ten} {ma} {loai} {linh_vuc} {phong} {ngay_nhan} {han} {ket_qua}
    {
      id: 'tpl-done',
      name: 'Thông báo đã giải quyết',
      body: 'Kính gửi {ten},\n\nUBND Xã Bình Mỹ đã tiếp nhận {loai} mã {ma} ngày {ngay_nhan} và đã giải quyết. Kết quả: {ket_qua}.\n\nTrân trọng.',
    },
    {
      id: 'tpl-pending',
      name: 'Thông báo đang xử lý',
      body: 'Kính gửi {ten},\n\nUBND Xã Bình Mỹ đã tiếp nhận {loai} mã {ma} ngày {ngay_nhan} và đang xử lý tại {phong}. Dự kiến hoàn thành trước ngày {han}; chúng tôi sẽ thông báo khi có kết quả.\n\nTrân trọng.',
    },
  ],
};

let cache = null;

export function getSettings() {
  if (!cache) {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(KEY) || '{}') ?? {};
    } catch {
      /* Trình duyệt chặn lưu trữ: dùng mặc định */
    }
    cache = { ...DEFAULTS, ...saved };
  }
  return cache;
}

export function saveSettings(patch) {
  Object.assign(getSettings(), patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* Không lưu được: giữ trong phiên này */
  }
  window.dispatchEvent(new CustomEvent('settings:change'));
}
