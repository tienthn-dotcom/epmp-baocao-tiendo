# Báo cáo tuân thủ theo NGÀY - kế hoạch xây dần

Lập 05/10/2026. Chưa viết dòng code nào.

File nguồn: `1NLUB2757Bnw3G_lVZwbykfi-jkfwEBx1z--_4CgvcEY`

---

## 0. Việc chặn trước tiên: quyền đọc file nguồn

**Chưa đọc được file.** Tải thẳng trả HTTP 401, connector Drive trả "không tìm thấy" vì nó gắn tài khoản cá nhân còn file thuộc tài khoản công ty.

Đây không phải chuyện tiện cho em. **App cũng sẽ không đọc được**: mọi nguồn app đang dùng đều đi đường `export?format=xlsx` công khai. Báo cáo tuân thủ tháng đọc file `15pcqb0ExFQ5uF9CuKSx6O6y9GN4kfiNf6IARN98pJbA` theo đúng cách đó, và file đó đang để **Anyone with the link**.

Việc cần làm, một lần:

> Mở file → Share → General access → **Anyone with the link** → quyền **Viewer**.

Mở xong em đọc file trong một phút, rồi điền nốt mục 2 và 4 của kế hoạch này - hai mục duy nhất còn trống, vì chúng phụ thuộc hẳn vào cái gì có trong file. **Không đoán nội dung file.** Đoán ra một luật chấm sai là chấm oan người thật.

---

## 1. Học gì từ báo cáo tuân thủ THÁNG đang chạy

Bản tháng đã chạy thật nhiều tháng, nên lấy nguyên bộ khung chứ không dựng lại từ đầu.

### Cách chia lớp (giữ y nguyên)

| Lớp | File | Việc |
|---|---|---|
| Đọc file | `src/lib/compliance-file.ts` | CSV → `ComplianceFileData`. Module THUẦN, không biết gì về React |
| Chấm điểm | `src/lib/compliance.ts` | Ngày cập nhật → dấu P/o/x theo chu kỳ. Module THUẦN |
| Giao diện | `ComplianceDialog` trong `src/routes/index.tsx` | Bảng, bộ lọc, xuất PDF |
| Lưu form | `edits.functions.ts` · `getComplianceForm` / `saveComplianceForm` | Bề rộng cột, cỡ chữ, khoá form |

Chia như vậy nên hai lớp đầu test được không cần trình duyệt. Bản ngày đi theo đúng cách này: **`compliance-ngay-file.ts` + `compliance-ngay.ts` thuần, rồi mới tới giao diện.**

### Công năng bản tháng đang có

Liệt kê để bản ngày biết mình cần gì, và biết cái gì **không** cần:

1. **Chọn kỳ** - ô chọn tháng, đọc từ `thangCo` (các tháng có cột trong file). Chọn tháng nào thì bảng và PDF theo tháng đó.
2. **Bảng chính** - Vùng · Người phụ trách · Cần PM trình MP BOD · Tên dự án · Điểm dự án · Số lần không cập nhật (thanh màu) · rồi tới các cột kỳ (tuần).
3. **Dấu ba trạng thái** - `✓` đúng hạn, `o` trễ, `✗` không cập nhật, ô trống = **chưa kết luận**. Ô trống là có chủ ý, không được bịa thành `✗`.
4. **Điểm dự án** - chấm theo công thức, tô màu theo ba mốc (≥70 xanh · 50-70 vàng · <50 đỏ).
5. **Điểm PM** - trung bình điểm các dự án PM đó quản, bày thành bảng ở đầu báo cáo kèm công thức.
6. **Bộ lọc** - lọc theo người phụ trách, lọc "Cần PM trình MP BOD", ô tìm tên dự án.
7. **Cột BOD** - hạn trình Master Plan, **quá 2 tuần thì chữ đỏ** (mới thêm 05/10).
8. **Khoá form** - PMO chỉnh bề rộng cột / cỡ chữ / in đậm rồi **khoá** lại; người khác xem bản đã căn chỉnh. Lưu trong KV.
9. **Xuất PDF** - khổ dọc / khổ ngang, dựng từ khối in riêng, xem trước rồi mới tải.
10. **Tên file** - `yymmdd_Tên cố định_Kỳ báo cáo.pdf` (chốt 05/10).
11. **Đẩy Drive** - nút "Cập nhật bản gửi mail" ghi PDF vào Drive cho lệnh gửi mail lấy.

### Mấy cái bẫy đã trả giá ở bản tháng - đừng dẫm lại

- **Đừng dùng `gviz/tq?tqx=out:csv`.** Nó ăn mất hàng tiêu đề của file tuân thủ, ra 0 dòng. Dùng `export?format=csv&gid=` hoặc `export?format=xlsx`.
- **Đường xuất PDF của Google chỉ chọn tab bằng `gid`.** `range=Tên!A1` hay `sheet=Tên` đều trả về CẢ FILE.
- **File giữ cả lịch sử cột kỳ, không chỉ kỳ đang chạy.** Bản tháng từng chấm LẠI tháng cũ bằng luật hiện hành → sai. Luật đúng: **đọc dấu có sẵn trong file**, không tự chấm lại kỳ đã qua.
- **Ô trống ≠ `✗`.** Chưa hết khung thời gian thì để trống.
- **Cron Cloudflare đếm thứ 1 = Chủ Nhật.** Đừng neo thứ vào biểu thức cron, kiểm trong code.

---

## 2. File nguồn mới có gì  ·  **CHƯA ĐIỀN - chờ quyền đọc**

Mở quyền xong em điền:

- danh sách tab, tab nào là tab dữ liệu;
- dòng tiêu đề nằm ở đâu, mỗi cột là gì;
- cột nào là kỳ (ngày), nhãn ghi kiểu gì, có bao nhiêu kỳ, có giữ lịch sử không;
- ô nào mang dấu trạng thái, ký hiệu dùng là gì;
- có sẵn cột điểm chưa, hay app phải tự chấm;
- số dòng, số dự án, có cột Vùng / PM / mã CT không.

Không có mấy câu trả lời này thì mục 4 (luật chấm) và lớp đọc file đều là phỏng đoán.

---

## 3. Khác nhau cốt lõi giữa bản NGÀY và bản THÁNG

Chỗ này quyết định phần lớn công sức, nên nêu trước:

| | Bản tháng | Bản ngày |
|---|---|---|
| Một kỳ là | 1 tuần | 1 ngày |
| Số cột kỳ trên bảng | 4-5 | **20-31** |
| Khung đúng hạn | T3→T4 đúng, T5→T6 trễ | theo giờ trong ngày |
| Bảng rộng | vừa màn hình | **chắc chắn tràn, phải cuộn ngang + ghim cột trái** |
| PDF | 1-5 trang | cần tính lại khổ |

**Bề ngang là rủi ro lớn nhất.** 31 cột ngày cộng 6 cột thông tin là không có màn hình nào chứa nổi. Hai đường đi, chọn trước khi code:

- **(a) Cuộn ngang, ghim cột trái** - giữ đủ mọi ngày, cột tên dự án dính trái. Giống bảng "Chi tiết dự án" vừa làm 05/10, đã chạy tốt ở 375px lẫn 1440px.
- **(b) Gói theo tuần, bấm xổ ra ngày** - bảng gọn, muốn xem chi tiết thì xổ. Đọc nhanh hơn nhưng phải bấm.

Anh chọn (a) hay (b). Em nghiêng về **(a)**, vì báo cáo này in ra PDF gửi đi, mà bản in thì không bấm xổ được.

---

## 4. Luật chấm  ·  **CHƯA ĐIỀN - chờ anh chốt**

Bản tháng khoá cứng theo thứ trong tuần: `✓` = T3/T4, `o` = T5/T6, `✗` = hết T6 không có cập nhật, điểm `100 − 25x − 10o`.

Bản ngày cần anh chốt bốn thứ:

1. **Mốc giờ trong ngày** - trước mấy giờ là đúng hạn, sau mấy giờ là trễ, mấy giờ thì coi như không cập nhật. (Anh từng nêu cho MT TCLĐ: *trước 18:05 đúng, sau là trễ, sau 20:00 là không cập nhật* - bản ngày có dùng đúng mốc này không?)
2. **Ngày nghỉ** - thứ Bảy, Chủ Nhật, lễ có tính không? Không tính thì lấy lịch nghỉ ở đâu?
3. **Công thức điểm** - trừ bao nhiêu cho mỗi `o`, mỗi `✗`.
4. **Kỳ báo cáo** - một bản là một tháng (các ngày trong tháng), hay một tuần, hay 30 ngày gần nhất?

**Em không tự đặt mấy con số này.** Chấm sai một ngày là trừ điểm oan một người thật.

---

## 5. Kế hoạch xây dần

Mỗi chặng chạy được và kiểm được riêng, không chặng nào bắt chờ chặng sau.

### Chặng 1 - Đọc được file  *(nửa ngày, sau khi có quyền)*
- `src/lib/compliance-ngay-file.ts`: tải + dò cột động theo tiêu đề, KHÔNG neo chỉ số cột.
- Test với file thật: đếm đúng số dự án, số cột ngày, số dấu từng loại.
- **Xong khi**: chạy một lệnh ra được bảng số liệu khớp mắt thường nhìn vào file.

### Chặng 2 - Chấm điểm  *(nửa ngày, sau khi anh chốt mục 4)*
- `src/lib/compliance-ngay.ts`: module thuần, vào là ngày cập nhật + mốc giờ, ra là `P/o/x/null`.
- Test phủ các ca biên: đúng mốc phút, qua nửa đêm, ngày nghỉ, chưa tới hạn (phải ra `null` chứ không ra `x`).
- **Xong khi**: test xanh, có ca biên bằng dữ liệu thật.

### Chặng 3 - Bảng xem trong app  *(1 ngày)*
- Hộp thoại mới trong Hệ thống, dựng theo khuôn `ComplianceDialog`.
- Cột trái ghim, cuộn ngang (hoặc gói tuần, tuỳ mục 3).
- Chưa cần bộ lọc, chưa cần PDF.
- **Xong khi**: mở ra thấy đúng bảng, đo ở 375px và 1440px.

### Chặng 4 - Điểm PM + bộ lọc  *(nửa ngày)*
- Bảng điểm PM đầu báo cáo, lọc theo người phụ trách, ô tìm tên dự án.
- **Xong khi**: con số trên bảng điểm PM khớp phần đang lọc.

### Chặng 5 - Xuất PDF + tên file  *(nửa ngày)*
- Dùng lại `exportDashboardPdf` và khối in riêng.
- Tên file theo đúng cú pháp đã chốt: `yymmdd_Báo cáo tuân thủ theo ngày_<kỳ>.pdf`.
- **Xong khi**: PDF mở ra không vỡ, không tràn cột.

### Chặng 6 - Khoá form  *(nửa ngày)*
- Dùng lại `saveComplianceForm`, thêm khoá KV riêng cho bản ngày.
- **Xong khi**: PMO căn chỉnh rồi khoá, người khác mở ra thấy bản đã căn.

### Chặng 7 - Tự động  *(bàn sau)*
- Có cần đẩy Drive / gửi mail như bản tháng không? Nếu có thì thêm một mốc cron ở warmer.
- **Lưu ý trần**: Cloudflare free cho tối đa **5 cron**, warmer đang dùng **4**. Còn đúng một chỗ.

---

## 6. Rủi ro nhìn thấy trước

| Rủi ro | Mức | Chặn bằng |
|---|---|---|
| Chưa có quyền đọc file | **đang chặn** | mở Anyone with the link |
| Luật chấm chưa chốt | **đang chặn chặng 2** | anh trả lời mục 4 |
| 31 cột không vừa màn hình | cao | chốt mục 3 trước khi code giao diện |
| Trần ghi KV 1.000 lượt/ngày | trung bình | bản ngày chỉ ĐỌC file, không ghi KV mỗi lần mở |
| Trần CPU 2s | trung bình | dò cột một lần rồi nhớ, không quét lại mỗi dòng |
| Chấm lại kỳ cũ bằng luật mới | cao | đọc dấu có sẵn trong file, đúng bài học bản tháng |
| Hết chỗ cron | thấp | còn 1 trên 5 |

---

## 7. Em cần anh trả lời

1. **Mở quyền file nguồn** - Anyone with the link, Viewer.
2. **Mục 3**: cuộn ngang ghim cột trái (a), hay gói theo tuần bấm xổ (b)?
3. **Mục 4**: bốn con số - mốc giờ, ngày nghỉ, công thức điểm, kỳ báo cáo.

Có ba thứ này là em chạy được từ chặng 1 tới chặng 3 liền mạch.
