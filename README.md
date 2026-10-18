# Quản lý Nội bộ · UBND Xã Bình Mỹ

Ứng dụng web quản lý **giao việc**, **lịch công tác** và **nhân sự** nội bộ.
Viết bằng HTML, CSS và JavaScript thuần (ES Modules), không cần cài đặt thư viện hay bước build.

## Tính năng

- **Dashboard hệ thống**: màn hình mở đầu khi vào hệ thống; tiến độ toàn hệ thống trên một màn hình (chỉ đọc dữ liệu): chỉ số đang mở và quá hạn, luồng xử lý phản ánh → đơn thư → công việc, danh sách cần xử lý ngay theo điểm ưu tiên, tiến độ theo phòng và lịch 14 ngày tới.
- **Báo cáo định kỳ**: tự tổng hợp theo tuần, tháng, quý, năm (kỳ này hoặc kỳ trước) hoặc khoảng tùy chọn, trình bày theo mẫu báo cáo hành chính: tổng hợp số liệu (tồn đầu kỳ, tiếp nhận, giải quyết đúng hạn / trễ hạn, tồn cuối kỳ), theo loại đơn, lĩnh vực, khu vực, theo phòng, danh sách quá hạn. Phần nhận xét viết tự động từ số liệu và sửa trực tiếp được. In / lưu PDF khổ A4 và xuất Excel.
- **Thông báo, nhắc hạn** (biểu tượng chuông): việc quá hạn, đến hạn hôm nay / ngày mai / trong số ngày cài đặt, trễ báo cáo BTV, đánh dấu "cần báo cáo lãnh đạo" khi quá hạn lâu, lịch họp hôm nay và ngày mai, nhắc sao lưu, nhắc báo cáo tuần / tháng. Bấm thông báo để mở đúng hồ sơ. Có thể bật thông báo trên màn hình máy tính (khi trang đang mở) và sao chép "bản tin nhắc việc" gom theo phòng để dán vào nhóm Zalo.
- **Sao lưu và khôi phục** (menu Sao lưu dữ liệu): tải toàn bộ dữ liệu ra một file .json (có thể kèm nội dung tệp đính kèm), khôi phục từ file đó, xem trước số lượng trước khi ghi đè và hoàn tác lần khôi phục gần nhất.
- **Giao việc**: thống kê KPI, biểu đồ trạng thái, lọc theo từ khóa / mốc hạn chót (tuần, tháng, quý hoặc tùy chọn) / trạng thái, giao cho một phòng xử lý chính và nhiều phòng phối hợp, chỉnh sửa, xóa.
- **Tài liệu đính kèm**: kéo thả nhiều tệp, xem trước PDF và hình ảnh, tải xuống.
- **Lịch công tác**: xem theo tháng hoặc tuần, tạo / sửa / xóa sự kiện, chọn thành phần tham dự.
- **Đồng bộ**: hạn chót công việc, giao việc BTV, hạn xử lý đơn thư và phản ánh tự động tạo sự kiện 17:00 trên Lịch công tác và cập nhật khi thay đổi. Mỗi form có ô "Đồng bộ ... vào Lịch công tác" để bật / tắt.
- **Nhân sự**: danh sách cán bộ, tìm kiếm không phân biệt dấu, hồ sơ với công việc của phòng và lịch sắp tới.
- **Đơn thư, PAKN**: tiếp nhận đơn (khiếu nại, tố cáo, kiến nghị, phản ánh), gợi ý lĩnh vực và phòng xử lý từ nội dung, cảnh báo đơn có thể trùng (cùng số điện thoại hoặc nội dung giống), hạn xử lý theo loại đơn, nhật ký xử lý tự ghi, lọc theo ngày tiếp nhận (tuần, tháng, quý hoặc tùy chọn). Một bấm để tạo công việc; công việc được giao cho phòng xử lý chính và các phòng phối hợp (không giao cho cá nhân).
- **Phản ánh 1022**: tiếp nhận nhanh theo khu vực, biểu đồ phản ánh theo khu vực, lọc theo ngày tiếp nhận (tuần, tháng, quý hoặc tùy chọn), chuyển thành đơn thư (có liên kết hai chiều) hoặc tạo công việc.
- **Giao việc BTV**: ghi nhận nghị quyết hoặc thông báo của Ban Thường vụ, giao cho phòng xử lý chính và phòng phối hợp, với hạn hoàn thành và hạn báo cáo BTV riêng; lọc theo ngày ban hành (tuần, tháng, quý hoặc tùy chọn); đánh dấu đã báo cáo. Đơn thư có thể chuyển thẳng lên BTV.
- **Cập nhật đồng loạt từ Excel** (Giao việc BTV, Giao việc TTUB, Đơn thư PAKN, Phản ánh 1022): nút "Cập nhật từ Excel" trên mỗi màn. Chọn file .xlsx / .xls / .csv, hệ thống tự nhận trang tính, dòng tiêu đề và tên cột (không cần đúng thứ tự, nhận cả tên gần giống), rồi hiện bảng xem trước từng dòng: thêm mới, cập nhật (kèm trường nào đổi), không đổi hoặc lỗi; chỉ ghi khi bấm Cập nhật. Dòng khớp theo mã (Mã đơn, Mã phản ánh 1022) hoặc theo nội dung khi file không có mã; ô trống không xóa dữ liệu đang có; phòng ban chưa có được tạo mới. Có cảnh báo ngày nghi bị đảo ngày/tháng và nút tải file mẫu kèm hướng dẫn. Đơn thư và phản ánh có thêm trường "Kết quả xử lý".
- **Liên kết tự động**: phản ánh → đơn thư → công việc → lịch công tác. Khi mọi công việc của một đơn hoàn thành, đơn tự chuyển sang "Đã giải quyết".
- **Đánh giá KPI**: là ứng dụng riêng, không nằm trong bản đưa lên GitHub này.
- **Phòng ban**: tự thêm, đổi tên, xóa phòng ban. Đổi tên được cập nhật ở mọi nơi; xóa phòng thì cán bộ và công việc thuộc phòng chuyển sang "Chưa phân phòng".
- **Tìm kiếm toàn hệ thống** (Ctrl+K hoặc `/`, hoặc biểu tượng kính lúp): tìm công việc, BTV, đơn thư, phản ánh, cán bộ, lịch cùng lúc, không phân biệt dấu. Chưa gõ gì thì hiện mục vừa mở.
- **Phím tắt**: `N` tạo mới ở màn hình hiện tại; `G` rồi chữ cái để chuyển màn hình (G T = Giao việc TTUB, G B = BTV, ...); `?` xem bảng phím tắt.
- **Chọn nhiều dòng (Giao việc TTUB)**: đổi trạng thái, chuyển phòng xử lý, đổi hạn, xuất Excel hoặc chuyển vào thùng rác cho nhiều công việc cùng lúc. Có nút hoàn tác ngay trên thông báo.
- **Thùng rác và hoàn tác**: xóa công việc, đơn thư, phản ánh, cán bộ, lịch đều vào thùng rác trong 30 ngày, khôi phục kèm đủ liên kết (menu Thùng rác).
- **Nhật ký thay đổi** (menu Nhật ký): ghi tạo mới, cập nhật (kèm trường đã đổi, ví dụ trạng thái cũ → mới), xóa, khôi phục, gộp dữ liệu.
- **Gộp dữ liệu khi khôi phục**: chọn "Gộp" để thêm mục mới từ file sao lưu của máy khác, mục đã có thì lấy bản mới hơn, mục chỉ có trên máy này được giữ. Xem trước số mục mới và mục cập nhật trước khi ghi.
- **Tự sao lưu trên trình duyệt**: mỗi ngày khi mở ứng dụng lưu một bản (giữ 7 bản) trong IndexedDB, khôi phục được ngay từ mục Sao lưu dữ liệu.
- **Dự báo nguy cơ trễ hạn** (chỉ dựa trên lịch sử xử lý có sẵn trên máy, không dùng AI): công việc đang mở được gắn nhãn "Nguy cơ trễ" khi số ngày thường cần của phòng lớn hơn số ngày còn lại. Cần ít nhất 3 công việc đã xong để dùng số liệu của phòng; chưa đủ thì dùng số liệu toàn hệ thống hoặc mặc định 7 ngày.
- **Phòng quá tải**: phòng có nhiều việc đang mở hơn mức trung bình (từ 5 việc trở lên) được ghi trên Dashboard và trong bảng tiến độ theo phòng.
- **Đầu việc con**: chia công việc thành các bước có thể đánh dấu. Khi tất cả bước đã xong, hệ thống gợi ý đánh dấu hoàn thành (không tự đóng việc).
- **Duyệt trước khi hoàn thành** (menu Thông báo, nhắc hạn, mặc định tắt): khi bật, chọn "Hoàn thành" sẽ chuyển sang "Chờ duyệt" cho đến khi lãnh đạo bấm "Duyệt và hoàn thành".
- **Quy tắc nhắc tự động** (menu Thông báo, nhắc hạn): nhắc đơn Khiếu nại / Tố cáo chưa có công việc sau số ngày đã chọn, và công việc chờ duyệt quá lâu. Đây là quy tắc có sẵn với mốc thời gian có thể chỉnh, chưa phải bộ quy tắc tùy ý.
- **Gợi ý phòng phối hợp**: khi tiếp nhận đơn, hệ thống gợi ý các phòng thường phối hợp với đơn cùng lĩnh vực, bấm "Áp dụng" để tick sẵn.
- **Việc cần xử lý**: công việc, đơn thư, phản ánh đang mở của một đơn vị, gồm việc thuộc phòng đó và việc phòng đó phối hợp, sắp theo mốc hạn.
- **Thư viện**: nội dung đã lưu từ Giao việc BTV, TTUB, Đơn thư và Phản ánh 1022; lọc theo loại, trạng thái, phòng, ngày lưu; đưa về màn hình gốc hoặc xóa hẳn.
- **Tự động hóa**: mẫu đầu việc con, công việc định kỳ, quy tắc hành động, ủy quyền khi vắng mặt, mẫu trả lời công dân. Chạy trên máy.
- **Kiểm tra dữ liệu**: liệt kê chỗ thiếu, công việc đứng im, đơn cùng người gửi, phản ánh đột biến. Chỉ đọc, không tự sửa dữ liệu.
- **Đăng nhập admin** (nút ở đầu trang): khóa sửa, xóa, tạo mới ở Quản lý chung và Cài đặt. Công việc và tiếp dân dùng được khi chưa đăng nhập. Chỉ là khóa giao diện, xem mục Lưu ý.
- Giao diện sáng / tối, responsive cho điện thoại, hỗ trợ bàn phím và trình đọc màn hình.

## Cấu trúc

```
index.html            Trang chính (khung giao diện và các hộp thoại)
css/styles.css        Hệ thống thiết kế: màu, khoảng cách, thành phần, responsive
js/app.js             Điểm vào: điều hướng, giao diện sáng/tối, đồng hồ
js/store.js           Dữ liệu, quy tắc trạng thái, đồng bộ lịch, dữ liệu mẫu
js/files.js           Lưu nội dung tệp đính kèm trong IndexedDB
js/modal.js           Hộp thoại, phím Esc, giữ focus, hộp xác nhận
js/auth.js            Đăng nhập admin (khóa giao diện, không phải bảo mật)
js/admin-config.js    Salt và hash mật khẩu admin (tạo bởi scripts/admin-password.mjs)
scripts/admin-password.mjs  Tạo hoặc đổi mật khẩu admin
js/pdfsearch.js       Tìm chữ trong nội dung PDF đính kèm (pdf.js tải từ CDN)
js/utils.js           Tiện ích: ngày giờ, định dạng, escape HTML, thông báo
js/excel.js           Đọc / tạo file Excel (SheetJS, tải từ CDN khi dùng lần đầu), nhận dòng tiêu đề, đọc ngày
js/views/overview.js  Màn hình Dashboard hệ thống
js/views/tasks.js     Màn hình Giao việc
js/views/calendar.js  Màn hình Lịch công tác
js/views/personnel.js Màn hình Nhân sự
js/views/departments.js Màn hình Phòng ban
js/views/petitions.js Đơn thư, PAKN
js/views/reflections.js Phản ánh 1022
js/views/btv.js Giao việc Ban Thường vụ
js/views/intake.js Phần dùng chung: gợi ý phân loại, nhật ký
js/views/import.js Cập nhật đồng loạt từ Excel cho 4 chức năng Công việc & tiếp dân
js/views/mine.js      Việc cần xử lý theo đơn vị
js/views/library.js   Thư viện nội dung đã lưu
js/views/automation.js Tự động hóa: mẫu, định kỳ, quy tắc, ủy quyền, mẫu trả lời
js/views/health.js    Kiểm tra dữ liệu (chỉ đọc)
js/assign.js          Phân công theo phòng: phòng xử lý chính và phòng phối hợp
js/classify.js Phân loại từ khóa, phát hiện đơn trùng, tính hạn (chạy trên máy, không gửi dữ liệu đi đâu)
js/settings.js        Cài đặt của máy này: nhắc hạn, thông báo, lần sao lưu gần nhất
js/backup.js          Sao lưu / khôi phục ra file JSON, giữ bản hoàn tác
js/stats.js           Thống kê theo thời gian dùng chung cho Báo cáo định kỳ
js/notify.js          Trung tâm thông báo, thông báo trên màn hình, bản tin nhắc việc
js/views/reports.js   Màn hình Báo cáo định kỳ (in, Excel, nhận xét)
js/views/settings-panel.js Các trang Sao lưu, Thông báo, Thùng rác, Nhật ký: sao lưu, gộp, tự sao lưu, nhắc hạn, quy tắc nhắc
js/recent.js          Danh sách mục vừa mở (hiện trong ô tìm kiếm)
js/insight.js         Dự báo nguy cơ trễ, phòng quá tải, phòng thường phối hợp (chạy trên máy, không AI)
js/search.js          Tìm kiếm toàn hệ thống (Ctrl+K)
js/shortcuts.js       Phím tắt (N, G + chữ cái, ?)
css/features.css      Giao diện các tính năng bổ sung
css/automation.css    Giao diện Tự động hóa, Việc cần xử lý, Kiểm tra dữ liệu, bộ lọc đã lưu
```

## Chạy trên máy

Không mở trực tiếp `index.html` bằng cách nháy đúp, vì trình duyệt chặn ES Modules khi mở từ `file://`.
Hãy chạy qua máy chủ cục bộ, ví dụ:

```bash
python -m http.server 8080
```

Sau đó mở <http://localhost:8080>. Hoặc dùng extension **Live Server** trong VS Code.

## Đưa lên GitHub và triển khai (GitHub Pages)

1. Tạo repository trống trên GitHub (ví dụ `giao-viec-binh-my`), không tick “Add README”.
2. Trong thư mục dự án, chạy lần lượt (chỉ lần đầu):

```bash
git init
```

```bash
git add .
```

```bash
git commit -m "Phiên bản web Quản lý Nội bộ"
```

```bash
git branch -M main
```

```bash
git remote add origin https://github.com/TEN_CUA_BAN/giao-viec-binh-my.git
```

```bash
git push -u origin main
```

3. Trên GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, chọn nhánh `main`, thư mục `/ (root)`, rồi bấm **Save**.
4. Sau vài phút, trang sẽ có địa chỉ dạng `https://TEN_CUA_BAN.github.io/giao-viec-binh-my/`.

## Lưu ý về dữ liệu

- Dữ liệu được lưu trong **trình duyệt của từng máy** (localStorage và IndexedDB). Người dùng khác hoặc thiết bị khác sẽ không thấy cùng dữ liệu. Hãy dùng mục **Sao lưu dữ liệu** trong menu định kỳ; hệ thống nhắc khi quá số ngày đã đặt. File sao lưu cũng dùng để chuyển dữ liệu sang máy khác.
- Tỷ lệ đúng hạn và thời gian xử lý tính theo ngày hệ thống ghi nhận hoàn thành (từ khi có tính năng này). Hồ sơ đã đóng trước đó, hoặc nhập từ Excel ở trạng thái đã xong, không có ngày hoàn thành nên không vào các chỉ số này.
- Để nhiều người cùng dùng chung một dữ liệu, cần một máy chủ và cơ sở dữ liệu (ví dụ backend Java Spring Boot + PostgreSQL). Đây là bước nâng cấp tiếp theo.
- Đăng nhập admin chỉ là khóa phía trình duyệt. Mật khẩu không nằm trong mã nguồn: `js/admin-config.js` chỉ chứa salt và hash PBKDF2-SHA256. Đổi mật khẩu bằng `node scripts/admin-password.mjs [mật-khẩu-mới]` (không nhập gì thì tự sinh mật khẩu mới và in ra một lần). Vẫn không phải bảo mật thật: ai có quyền truy cập máy đều đọc được dữ liệu trong trình duyệt. Khi có máy chủ, chuyển xác thực lên server.
- Đơn khiếu nại, tố cáo có thể chứa SĐT và nội dung của người dân. Dữ liệu này lưu thô trên trình duyệt và trong file sao lưu JSON. Giữ file sao lưu cẩn thận, không gửi qua kênh công khai.
#   v p u b . b i n h m y  
 