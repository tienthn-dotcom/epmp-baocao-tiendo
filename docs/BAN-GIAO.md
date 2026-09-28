# SỔ BÀN GIAO

Bốn box nói chuyện với nhau qua đúng file này.

**Luật dùng sổ:**
- Mỗi box **đọc từ đầu sổ** trước khi làm, để biết chuyện đã tới đâu
- Chỉ **ghi thêm** phần của mình, **không sửa, không xoá** phần của box khác
- Một việc xong thì chuyển cả khối xuống `docs/BAN-GIAO-CU.md` và dọn sổ này cho việc mới
- Nền tảng chung (con số, luật, sổ lỗi) nằm ở `docs/NEN-TANG.md`, **không chép lại vào đây**

---

# VIỆC ĐANG LÀM

**V4b · Xuất Excel đạt CHẤT LƯỢNG ngang bản PDF**
Plan mở 28/09/2026, viết lại theo chuẩn người dùng giao trực tiếp.

---

## ⚠ CHUẨN NGHIỆM THU LÀ CỦA NGƯỜI DÙNG, KHÔNG PHẢI CỦA ĐẶC TẢ NÀY

Nguyên văn: *"tôi muốn file excel phải đẹp như PDF luôn, về màu sắc, bố cục, nói chung là nâng cấp cho xuất excel để ra kết quả chất lượng"*.

**Cách chấm:** mở file Excel xuất ra đặt CẠNH bản PDF xuất ra cùng lúc, cùng bộ lọc. Người thứ ba nhìn hai cái phải thấy **cùng một báo cáo, cùng một bộ màu, cùng một bố cục**. Chấm bằng mắt trên file thật, không chấm bằng test xanh.

**V4a (`c188f92`) MỘT MÌNH KHÔNG ĐẠT CHUẨN NÀY** - và đó không phải lỗi của Thực thi. V4a sửa một thứ **đang sai** (sắp xếp ngày ra thứ tự chữ cái) nhưng **người dùng mở file ra gần như không thấy khác**. Nó là nền cho V4b, không phải câu trả lời cho yêu cầu.
→ **Không deploy V4a một mình.** Ghép với V4b rồi lên một lần.

---

## ① PLAN

**VIỆC**
Nâng phần nhìn của file Excel xuất ra: màu, bố cục, và bản in - ngang chất lượng bản PDF.

**VÌ SAO CẦN**
Người dùng gửi file này cho người khác đọc. PDF đẹp vì nó **chụp ảnh nguyên bảng web** (`pdf-export.ts`, `html2canvas`) nên giống app y hệt. Excel dựng từ ô nên hiện đang khô: chữ ghi chú **bị cắt cụt**, không chú giải, không thanh tiến độ, in ra vỡ trang.

**THẲNG THẮN VỀ MỘT ĐIỂM:** không thể làm Excel **giống hệt từng pixel** với PDF, vì PDF là ảnh còn Excel là ô. Nhưng **"đẹp ngang" thì làm được**, và đó mới là thứ người dùng yêu cầu. Excel còn hơn PDF hai thứ: lọc được và sửa được. Đích là một file mà người nhận mở ra thấy **chỉn chu như một báo cáo**, không phải như một bảng dữ liệu thô.

**LÀM XONG THÌ NHÌN THẤY GÌ**
Mở file ra: khối tiêu đề đậm, hàng tiêu đề cột nổi bật, dòng dự án có dải màu riêng tách khỏi dòng công đoạn, ô ghi chú **hiện đủ chữ**, cột % có thanh màu chạy trong ô, cuối bảng có chú giải màu. Bấm Ctrl+P ra bản in gọn gàng, lặp tiêu đề mỗi trang.

**PHẠM VI**
- Trong: `src/lib/excel-export.ts` → `exportTableXlsx`. Và chỗ khai `cols` trong `src/routes/index.tsx` (`onExportExcel`, ~4597) nếu cần thêm thuộc tính cột.
- NGOÀI: không đổi **danh sách cột**, không đổi **thứ tự cột**, không đổi dữ liệu, không bỏ ẩn dòng con, không đụng `exportMatrixXlsx`, không đụng đường PDF.

**BẢY VIỆC, xếp theo mức người dùng cảm nhận được**

**1. Chữ hết bị cắt cụt — NẶNG NHẤT, làm trước.**
`row.height = 20/18` đang đặt cứng, trong khi cột Vướng mắc (rộng 48) và Giải pháp (rộng 48) đều bật xuống dòng. Excel **chỉ tự giãn chiều cao khi hàng KHÔNG có chiều cao đặt tay**. Bỏ `row.height` ở dòng có cột wrap, hoặc tự tính theo số dòng chữ ước lượng. Đây là thứ hỏng rõ nhất khi đặt cạnh PDF.

**2. Dải màu dòng dự án, lấy ĐÚNG màu của app.**
Bảng màu app đang dùng (`index.tsx` ~7509, hằng `GC`) và bảng màu Excel hiện có phải **khớp nhau**:
```
thanh tieu de / header : #334155  (GC.headerBg)      Excel dang dung #16202E / #1E293B -> thong nhat
dong du an             : #334964  (GC.bar)
dong du an DA BAN GIAO : #059669  giu nguyen
nen dong con           : #F8FAFC  (GC.childBg)  -> hien Excel de trang, cho no dai mau nhat
hang qua han           : nen #FCEFDD, mep #E0A458  (GC.overdueBg / overdueEdge)
trang thai do/vang/xanh: #EF4444 / #F59E0B / #059669  giu nguyen
```
Thực thi **tự đọc lại hằng `GC`** để lấy số chính xác, đừng chép từ đây - đây là bản ghi lúc Plan đo, có thể lệch.

**3. Ô "% thực tế" có thanh màu trong ô.**
`ws.addConditionalFormatting` kiểu `dataBar`, màu `#5EE9B5` - **đúng màu "% đã hoàn thành" của Gantt** (`GC.done`). Đây là thứ gần nhất với thanh tiến độ của PDF mà Excel làm được thật.
**Chỉ chạy được nhờ V4a** - data bar cần ô SỐ. Đây là lý do V4a phải đi cùng chứ không lên riêng.

**4. Cột "Quá hạn" tô thang màu** từ nhạt tới đỏ đậm, hoặc tô nền đỏ khi vượt ngưỡng. Lấy ngưỡng đang dùng trong app, đừng tự đặt số mới.

**5. Khối chú giải cuối bảng**, đúng chữ như chú giải trên app:
```
Trễ tiến độ  ·  Cần cắt đầu việc  ·  Cần tập trung  ·  Đã hoàn thành
```
Mỗi mục một ô tô đúng màu của nó. PDF có, Excel chưa.

**6. Đóng băng thêm CỘT.** Hiện chỉ `ySplit: 3`. Thêm `xSplit` qua cột "Tên dự án / Hạng mục" → cuộn sang phải đọc Vướng mắc vẫn thấy đang ở dự án nào. PDF không cần vì in ra thấy cả trang.

**7. Thiết lập trang in** (`ws.pageSetup`): A4 **ngang**, `fitToPage` + `fitToWidth: 1`, lặp hàng tiêu đề mọi trang (`printTitlesRow: "3:3"`), lề hẹp, đánh số trang ở chân. Đây là thứ trả lời thẳng câu "đẹp như PDF": người nhận bấm in trong Excel ra bản gần giống bản PDF.

**DÙNG CHUNG - CODE NÀO BỊ ĐỤNG TỚI**
- Hằng `GC` nằm **trong** component ở `index.tsx`, không export. Muốn Excel dùng chung màu thì phải **kéo ra một chỗ dùng chung** - và kéo ra là đụng cả bảng Gantt đang chạy. Nếu Thực thi thấy rủi ro thì **chép giá trị màu sang `excel-export.ts` kèm ghi chú trỏ về nguồn**, đừng kéo bừa. Báo Plan biết đã chọn đường nào.
- `exportMatrixXlsx` nằm cùng file nhưng là đường khác. Đừng sửa lây.
- `STATUS_FILL` đang dùng cho ô Tình trạng - đổi nó là đổi cả chỗ khác trong hàm.

**RÀNG BUỘC**
1. **Không đổi dữ liệu, chỉ đổi cách trình bày.** Việc này không được làm sai một con số nào.
2. Ô trống vẫn phải **trống** - data bar và thang màu **không được vẽ gì** ở ô chưa có số. Vẽ thanh dài 0 ở ô chưa đo là biến "chưa đo" thành "0%" bằng hình ảnh. Luật 5.2 áp cả cho phần nhìn.
3. Dòng con **vẫn ẩn sẵn, vẫn nhóm lại được để bấm xổ** - người dùng đã chốt, đừng đổi.
4. File không được phình quá mức. Đo dung lượng trước và sau.
5. Màu phải **lấy từ app**, không tự chế bảng màu mới.

**ĐÃ ĐO TRƯỚC** (Plan 28/09/2026)
```
exportTableXlsx      : src/lib/excel-export.ts dong 590-681
Da co san            : thanh tieu de, dong pham vi loc, header dong bang ySplit 3, autoFilter,
                       to mau Tinh trang, to do o ngay ket thuc qua han, outline nhom dong con
Dang THIEU           : chieu cao tu gian, dai mau dong con, data bar, thang mau Qua han,
                       chu giai, xSplit, pageSetup
Duong PDF            : pdf-export.ts - html2canvas chup anh bang web, cat theo ranh gioi hang, A4
Bang mau app         : index.tsx ~7509, hang GC (KHONG export)
Bang mau Excel       : excel-export.ts, STATUS_FILL + cac ma argb roi rac trong exportTableXlsx
```

**CHỖ CÒN MƠ HỒ**
Mục 4 (ngưỡng Quá hạn) - Plan **chưa đo** ngưỡng app đang dùng. Thực thi đọc `OD_ALERT_DAYS` trong `lib/filter` rồi dùng đúng số đó; thấy có nhiều ngưỡng khác nhau thì **báo Plan**, đừng tự chọn một cái.

**CÁCH BIẾT LÀ ĐÚNG**
Chấm bằng **file thật đặt cạnh nhau**, không chấm bằng test xanh.
1. Xuất **cùng lúc** một bản PDF và một bản Excel, **cùng bộ lọc**. Mở cạnh nhau. Nêu rõ chỗ nào còn khác.
2. Ô Vướng mắc dài nhất trong file: **hiện đủ chữ**. Trước: cụt. Nêu cụ thể dự án nào, trước bao nhiêu dòng chữ, sau bao nhiêu.
3. Ctrl+P trong Excel: vừa **một trang bề ngang**, tiêu đề **lặp** ở trang 2 trở đi.
4. Cuộn sang phải tới cột Giải pháp: vẫn thấy tên dự án.
5. Ô % chưa có số: **không có thanh màu nào**. Đây là ràng buộc 2, soi thẳng file.
6. Màu dòng dự án và màu trạng thái **khớp mắt** với bảng trên app.
7. Dung lượng file trước và sau.
8. `tsc` sạch · không phép kiểm nào đang xanh bị đỏ.
9. Không có đường ghi KV nào. Lượt ghi **không đổi**.

**GỬI KÈM CHO NGƯỜI DÙNG:** khi báo xong, đính **chính file Excel xuất ra** để người dùng tự nhìn. Yêu cầu này chấm bằng mắt, mô tả bằng chữ không thay được.

---













---

## ② THỰC THI

> *Mục ② của V2b nằm ở commit `40eae6c`. **Đã nhận lỗi ① của Test ở vòng đó:** mục ② khai `index.tsx`
> chỉ sửa CHANGELOG, thực tế commit còn đổi 16 dòng (2661–2676) từ LF sang CRLF, chiếm 30 trên 36
> dòng diff. Không đổi hành vi nhưng đúng là không khai. Lần này đã soi trước khi commit:
> `git diff --ignore-all-space` ra **đúng** 29/12 như diff thường, tức **không có một dòng nhiễu nào**.*

**ĐÃ LÀM**

`src/lib/excel-export.ts`:
1. Thêm `oNgay(iso)` — ISO → `Date`, không đọc được thì **`null`**. Xuất ra để bộ kiểm gọi thẳng.
2. `XlsxTableRow.cells` từ `string[]` thành `XlsxCell[]` = `string | number | Date | null`.
3. `columns[]` nhận thêm `numFmt?` — **định dạng hiển thị**, để giá trị là ngày/số thật mà bảng vẫn
   nhìn y hệt bản cũ.
4. Trong vòng ghi dòng: đóng `numFmt` cho ô **có giá trị**, ô trống thì để nguyên.

`src/routes/index.tsx` (`onExportExcel`):
5. Ba cột ngày dùng `oNgay(...)` thay `fmtDateVN2(...)`; `% thực tế` đẩy số; `Quá hạn` đẩy số.
6. Khai `numFmt` cho bốn cột đó: `dd/mm/yy`, `0"%"`, `0" ngày"`.
7. Kéo `loadSplit(() => import("@/lib/excel-export"))` lên **trước** vòng dựng ô để mượn `oNgay`.
   KHÔNG import tĩnh — làm thế là kéo `exceljs` vào gói chính, mất công tách gói.
8. Thêm mục CHANGELOG `v3.110.0`.

`tests/excel-o-that.test.ts` — **mới**, 12 phép kiểm.

**VÌ SAO LÀM THẾ**

*Chọn lưu `85` với định dạng `0"%"`, KHÔNG lưu `0.85` với `0%`* (ràng buộc 3 để Thực thi quyết).
Ba lý do, xếp theo sức nặng:
- **Lọc "lớn hơn 80" phải gõ được số 80.** Với `0.85` thì người dùng gõ 80 ra rỗng, phải gõ `0.8`.
  Đây là thao tác người nhận file làm nhiều nhất sau sắp xếp.
- **Copy sang chỗ khác ra đúng thứ đang nhìn thấy.** `0.85` dán sang Word/mail thành "0.85" trong
  khi bảng ghi "85%" — chính chỗ Plan đã lo.
- **Khớp với app.** Trên màn hình cột này là số nguyên phần trăm; file xuất ra nên nói cùng một thứ
  tiếng với bảng mà nó chụp lại.
Trả giá: `0"%"` chỉ là **hậu tố hiển thị**, không phải kiểu phần trăm thật của Excel. Ai dựng biểu đồ
từ cột này phải tự đặt nhãn trục, và đổi định dạng ô về General sẽ thấy `85` chứ không phải `0.85`.
Tôi cho là đổi được: bảng này để đọc và lọc, không phải để dựng biểu đồ.

*Cột "Quá hạn" dùng `0" ngày"` chứ không phải `0`.* Ràng buộc 4 đòi số nguyên, mà phần LÀM XONG THÌ
NHÌN THẤY GÌ đòi nhìn không đổi — bản cũ hiện "5 ngày". Hậu tố trong định dạng thoả **cả hai**: giá
trị vẫn là số 5 nên Excel cộng được, mà mắt vẫn thấy "5 ngày".

*Vì sao `oNgay` cắt chuỗi chứ không `new Date(iso)`.* `new Date("2026-09-15T00:00:00+07:00")` lùi về
**ngày 14** theo giờ UTC, mà exceljs quy `Date` ra số thứ tự Excel theo UTC. Đi đường đó thì một
phần dữ liệu lệch đúng một ngày **trong im lặng**, trên bảng dùng để đánh giá PM. Nên lấy thẳng ba
số Y-M-D rồi dựng UTC midnight — ra đúng ngày `fmtDateVN2` đang hiện, vì hàm đó cũng chỉ cắt chuỗi.

*Giữ nguyên phép kiểm truthy của `overdueDays`.* Bản cũ `it.overdueDays ? ... : ""` nên quá hạn **0
ngày** để trống. Tôi giữ y thế (`? ... : null`). Đổi sang `!= null` là làm hiện thêm một cột "0 ngày"
chưa ai yêu cầu, tức đổi cái nhìn thấy trong vòng không được đổi cái nhìn thấy.

**ĐÃ ĐO**
```
tsc                   : sạch (exit 0). Cũng trả lời luôn câu Plan dặn "đếm trước cho biết phạm vi":
                        đổi kiểu `cells` KHÔNG làm vỡ chỗ nào khác — chỉ có ĐÚNG MỘT chỗ dựng `cells`
                        trong cả cây, ở index.tsx. `exportMatrixXlsx` không đụng tới, đúng như dặn.
vitest                : 398 passed | 2 expected fail | 1 FAILED | 30 file
                        Phép đỏ là `findMatrixSheets` trong tests/matrix-reader.test.ts — KHÔNG phải
                        của tôi, xem mục CHỖ TÔI KHÔNG CHẮC số 4.
                        Trừ nó ra: mốc nền 387 | 2 | 29 → chênh +12 đúng bằng phần tôi thêm.
build                 : qua
quét byte điều khiển  : 16 byte · 7 file — đúng mốc nền. Hai file tôi đụng đều SẠCH.
diff sạch không nhiễu : `git diff --ignore-all-space` = 29/12, khớp diff thường → không dòng nào
                        đổi mỗi ký tự xuống dòng (lỗi ① Test bắt ở vòng trước, lần này không tái diễn)
kiểm trên app         : 1440px badge 3.109.1 → 3.110.0, bảng bình thường, không tràn.
                        375px scrollWidth = clientWidth = 375, không tràn ngang.
                        Không lỗi console mới.
ghi KV thêm mỗi lần mở app : 0. Việc này không có một đường ghi KV nào.
cổng demo             : CÓ SẴN ở index.tsx:2482 — tôi không đụng (đường khác, effect đẩy danh sách).
cổng đang tải         : CÓ SẴN ở index.tsx:2483 — tôi không đụng.
```

**ĐÃ MỞ FILE XUẤT RA VÀ SOI — tiêu chí 1, 2, 3 của ①**

Không chỉ chạy phép kiểm. Tôi bấm **đúng nút "Xuất Excel" trên app đang chạy**, chặn `URL.createObjectURL`
để giữ lại file thật, bung zip bằng `fflate` ngay trong trang rồi đọc `sheet1.xml` và `styles.xml`.
Dữ liệu THẬT, 14 dự án · 38 đầu việc, file 13.246 byte.

*Dòng 4 (dòng dự án CT25-038 "Mini Hotel PQ (B1-B5) Phòng"):*
```
A = 46289  (số, không t="s")   → ngày update
B = t="s"                       → Mã, vẫn là CHỮ
E = 45840 · F = 46295 (số)      → ngày bắt đầu / kết thúc
G, H  KHÔNG CÓ <v>              → % và Quá hạn TRỐNG THẬT trên dòng nhóm
```
*Dòng 5 (đầu việc):* `E = 45940 · F = 46228` (ngày), **`G = 95`** (%), **`H = 62`** (quá hạn) — số thật.
*Dòng 7:* ô `G` **không có `<v>`** → dự án chưa có số thì ô % TRỐNG, không phải 0. Đúng tiêu chí 3.

*Đối chiếu để chắc không lệch ngày:* số thứ tự trong file quy ngược ra
`2026-09-24 · 2025-07-02 · 2026-09-30`; cùng dòng đó trên màn hình hiện `24/09 · 02/07/25 · 30/09/26`.
**Khớp từng ngày một.**

*`styles.xml` của file thật* khai đúng ba định dạng tự đặt:
`164 = dd/mm/yy` · `165 = 0"%"` · `166 = 0" ngày"` → nhìn không đổi.

*Tiêu chí 1 — sắp xếp:* chốt bằng phép kiểm trên file dựng thật. Ba hạn `01/12/25 · 02/01/26 · 15/06/25`:
```
TRƯỚC (chữ)  : 01/12/25 · 02/01/26 · 15/06/25   ← thứ tự CHỮ CÁI, sai
SAU   (ngày) : 15/06/25 · 01/12/25 · 02/01/26   ← đúng thứ tự thời gian
```

*Nút xổ nhóm (Plan nhờ kiểm riêng vì `summaryBelow: false` gán qua `as any`):* đã soi trong file
đọc ngược — `outlineProperties.summaryBelow === false` **có thật trong file**, `outlineLevel` 0 cho
dòng dự án và 1 cho dòng con, `hidden === true` cho dòng con. Đúng như người dùng đã chốt, không đổi.

**Đã xác nhận ĐỎ trên bản chưa sửa:** bỏ đúng một dòng đóng `numFmt` → **3 phép kiểm đỏ** (cột ngày,
cột %, cột Quá hạn). Phục hồi xong 12/12 xanh.

**CHỖ TÔI KHÔNG CHẮC**

1. **Ô ngày trống nay TRỐNG THẬT, trước đây hiện dấu gạch ngang — cái nhìn thấy CÓ ĐỔI.** Đặc tả
   (ràng buộc 1) ghi *"`fmtDateVN2(null)` hiện trả `""`"*. **Không đúng**: hàm đó ở `index.tsx:8225`
   trả **`"—"`**. Nên bản cũ ghi chữ `"—"` vào ô ngày trống, còn bản này để ô rỗng. Tôi theo ràng
   buộc 1 và luật 5.2 (ô trống là ô trống) chứ không theo câu "nhìn y hệt", vì để chữ `"—"` trong
   cột ngày là **phá luôn phép sắp xếp** — đúng thứ việc này sinh ra để sửa. Nhưng đây là thay đổi
   nhìn thấy được, Plan và người dùng nên biết trước khi Review.

2. **Bộ kiểm tự khai lại danh sách cột, không đọc từ `index.tsx`.** Mảng `COLS` trong file kiểm là
   bản chép của `cols` ở `index.tsx`. Ai đổi `numFmt` bên đó mà quên bên này thì phép kiểm vẫn xanh.
   Tôi bù bằng lượt soi file thật ở trên (đường đó đi qua đúng `index.tsx`), nhưng lượt soi ấy là
   **làm tay, không tự động lặp lại**. Muốn chắc lâu dài thì phải kéo chỗ dựng cột ra khỏi callback
   JSX — việc đó ngoài phạm vi vòng này.

3. **`0"%"` không phải kiểu phần trăm thật của Excel.** Đã nêu lý do chọn ở trên. Nếu sau này có
   người cần dựng biểu đồ phần trăm từ file này thì phải đổi sang `0.85` + `0%`, và khi đó cột sẽ
   copy ra thành `0.85`. Đây là đánh đổi tôi chọn, không phải chỗ code còn thiếu.

4. **Một phép kiểm CÓ SẴN đang đỏ trên máy này, không phải do tôi:** `findMatrixSheets` trong
   `tests/matrix-reader.test.ts`, **quá hạn 5.000 ms** (đo được 6.543 / 7.125 / 8.352 ms ở ba lượt).
   Bằng chứng nó không liên quan: file đó chỉ import `src/lib/matrix-reader` và `xlsx`;
   `matrix-reader.ts` chỉ import `xlsx` + một file kiểu — **không có đường nào** tới `excel-export.ts`
   hay `index.tsx`; cả hai file chưa đổi từ commit `ec37fc2`; và nó đỏ **cả khi chạy một mình lẫn khi
   loại hẳn file kiểm mới của tôi ra**. Nhưng mốc nền của Test hôm qua là 0 phép đỏ, nên **có gì đó
   đã chậm đi** — tôi không sửa (ngoài phạm vi, và nâng `testTimeout` là quyết định của Test).

5. **Tôi chưa mở file bằng Excel thật.** Mọi kết luận ở trên đọc từ XML trong file `.xlsx` và từ
   `exceljs`. Chuẩn OOXML nói ô có `numFmtId` trỏ tới `dd/mm/yy` sẽ hiện ra thế, nhưng Excel bản
   thật trên máy người dùng thì tôi không chạy được. Người kiểm cuối nên mở một lần bằng Excel.

**CHƯA LÀM**

- **Phần NHÌN (V4b)** — không đụng màu, cột, thứ tự cột, độ rộng. Đúng phần NGOÀI.
- **Không đụng** `exportMatrixXlsx` (cùng file nhưng đường khác, không dùng `XlsxTableRow`), không
  đụng đường xuất PDF, không bỏ ẩn dòng con.
- **Không sửa** phép kiểm `matrix-reader` đang đỏ — xem mục 4 trên.
- **Không deploy.** V2b của tôi vẫn nguyên trong cây, chưa deploy, tôi không revert gì.
---

## ③ TEST

**PHÁN QUYẾT** — **ĐẠT KÈM LƯU Ý**

Không tìm được lỗi nào chặn được bản này. Ràng buộc 2 (băm hỏng thì không ném) **giữ đúng** dưới mọi
cách tôi phá. Ba lưu ý bên dưới: một chỗ làm thừa ngoài phạm vi khai báo, một lỗ hổng bộ kiểm tôi đã
vá, và một chỗ **đọc số dễ sai** — chỗ thứ ba đáng đọc nhất vì nó ảnh hưởng thẳng tới kết luận mà
cả việc V2b sinh ra để rút.

**ĐÃ VIẾT**

18 phép kiểm trong `tests/kv-dem-bam-ranh-gioi.test.ts`.

*Đã xác nhận ĐỎ trên bản chưa sửa: **có**.* Không dùng `git stash` (luật 5.6 — Thực thi đang mở cùng
cây). Thay vào đó dựng hai bản đối chiếu ra file tạm rồi chạy phép kiểm lên chúng:

| Bản đối chiếu | Dựng bằng | Kết quả |
|---|---|---|
| Bản trước V2b | `git show 40eae6c~1:src/lib/kv-dem.ts` | **ĐỎ** — "dòng đếm mang theo băm", "đường delete băm rỗng ở cột thứ ba" |
| Bản đột biến: bỏ đúng một dòng `ALTER` | `sed` trên bản đang chạy | **ĐỎ** — "lượt dựng bảng đầu tiên phát ra câu ALTER" |
| Bản đang chạy (đối chứng) | nguyên trạng | **XANH** — phép kiểm không đỏ vì lý do khác |

Ba file đo đã xoá ngay sau khi chạy, cây git sạch.

Hai phép kiểm trong bộ mới **tự mang đối chứng**: phép ĐỐI CHỨNG đầu nhóm "ràng buộc 2" chứng minh
cái `crypto` giả thật sự phá được một phép băm không có lớp đỡ. Không có nó thì ba phép sau xanh mà
chẳng chứng minh điều gì.

**RANH GIỚI ĐÃ SOI**

| Ranh giới | Ngay dưới | Đúng bằng | Ngay trên | Kết quả |
|---|---|---|---|---|
| Mốc cắt 128 KB | 131.071 → hai băm **khác** | 131.072 → hai băm **khác** (băm trọn) | 131.073 → hai băm **BẰNG NHAU** | giới hạn đã chốt |
| Độ dài payload | `""` → băm rỗng | `" "` → băm thật 12 hex | `"  "` → băm khác `" "` | ô trống ≠ ô khoảng trắng |
| Nội dung băm được | `undefined` → rỗng | chuỗi thường | 300 KB → vẫn 12 hex | không ném ở đầu nào |
| Chữ tiếng Việt | dựng sẵn (NFC) | tổ hợp (NFD) | HOA / thường | ba thứ ra ba băm khác nhau |
| `crypto.subtle` | ném lỗi → `""` | không có `subtle` → `""` | bình thường → 12 hex | ràng buộc 2 giữ |
| Số lượt dựng bảng | 1 lượt ghi | 3 lượt ghi | — | `CREATE`/`ALTER` chạy đúng **1** lần |
| Tham số thứ hai | thiếu (`delete`) | rỗng | có nội dung | dòng đếm **luôn** được ghi |

**CHẠY**

```
vitest : 387 passed | 2 expected fail | 29 file   (mốc nền 369 | 2 | 28 → chênh +18 đúng phần tôi thêm)
tsc    : sạch (exit 0)
quét byte điều khiển : file mới sạch; toàn cây vẫn 16 byte · 7 file — đúng mốc nền, tôi không đụng
```

Mốc nền 369 | 2 | 28 tôi tự chạy lại, khớp cả báo cáo của Thực thi lẫn của Plan.

**LỖI TÌM ĐƯỢC**

**① · `index.tsx` có 16 dòng bị đổi ký tự cuối dòng, ngoài phạm vi đã khai — MỨC: NHẸ**

Mục ② khai `index.tsx` chỉ sửa "mục CHANGELOG". Thực tế commit `40eae6c` đụng 36 dòng ở file đó:
4 dòng CHANGELOG, còn lại là **16 dòng (2661–2676) đổi từ LF đơn sang CRLF** — khối `danhChiNow`.

```
trước : ... 63 20 76 c3 a0 6f        (hết dòng, không có 0x0d)
sau   : ... 76 c3 a0 6f 0d           (thêm 0x0d)
```

Không đổi hành vi: cả 16 dòng nằm trong một khối ghi chú và mã thường, `\r` cuối dòng ngoài chuỗi
là khoảng trắng với trình biên dịch. Và nó làm file **nhất quán hơn** — 16 dòng đó vốn là chỗ lệch
duy nhất trong file toàn CRLF. Nhưng nó không được khai, và nó chiếm **30 trên 36 dòng** của diff
`index.tsx`, tức là ai soi diff sẽ phải lội qua đống nhiễu để tìm 4 dòng thật. Đề nghị Thực thi chỉ
sửa lại một chữ trong mục ② cho khớp thực tế, không cần đụng code.

**② · Câu `ALTER TABLE` không có phép kiểm nào chốt — MỨC: NHẸ, TÔI ĐÃ VÁ**

`tests/kv-dem-bam.test.ts` không có một lần nhắc nào tới `ALTER` (`grep -c "ALTER"` → **0**), và
hàm trợ giúp `cauCo` dựng ra trong file đó **không được dùng ở đâu cả**. Hệ quả: xoá đúng dòng
`ALTER` đi thì **cả 11 phép kiểm vẫn xanh**, trong khi cột `bam` không bao giờ có trên một bảng đã
tồn tại, câu chèn ba cột hỏng mãi, đường lùi nuốt lỗi — và đồng hồ đứng im mà không ai được báo.
Tôi đã đo đúng tình huống đó (bảng ở mục ĐÃ VIẾT) và thêm phép kiểm chốt lại. Không phải lỗi code.

**③ · Hai chuỗi NHÌN GIỐNG HỆT NHAU ra hai băm khác nhau — MỨC: LƯU Ý KHI ĐỌC SỐ**

Đây là chỗ đáng chú ý nhất, và nó **không phải lỗi** — băm đang làm đúng việc của nó.

Tiếng Việt có hai lối dựng cùng một chữ: dựng sẵn (NFC) và tổ hợp (NFD). `"Dự án Sun Group"` viết
theo hai lối cho ra hai chuỗi byte khác nhau, nên hai băm khác nhau, dù trên màn hình giống hệt.

Vì sao nó quan trọng với đúng việc này: câu hỏi V2b sinh ra để trả lời là *"63 lượt ghi kia là 63
nội dung khác nhau hay một nội dung ghi 63 lần"*. Nếu nguồn Master Plan lẫn cả hai lối gõ — chuyện
thường gặp khi dữ liệu đi qua nhiều máy và nhiều lần dán — thì cột `bam` sẽ báo **"nhiều nội dung
khác nhau"** cho thứ thực chất là một. Đọc thẳng con số đó là kết luận nhầm sang hướng (c), rồi đi
sửa nhầm chỗ. Đã chốt bằng phép kiểm để người đọc số biết mà trừ hao.

**CHƯA KIỂM ĐƯỢC**

- **`crypto.subtle` trên Workers thật.** vitest chạy trên Node. Tôi kiểm được *hành vi khi nó hỏng*
  (băm rỗng, không ném, dòng đếm vẫn ghi) nhưng **không kiểm được nó có chạy hay không** trên
  Workers. Bảng ba nhánh ở cuối mục ① là đường đỡ đúng chỗ này — phải chạy **ngay sau deploy**,
  đừng đợi hết ngày.
- **`ALTER TABLE` trên D1 thật.** Tôi giả lập được cả hai nhánh (thành công, và ném "duplicate
  column"), nhưng chưa ai chạy nó trên D1 production. Cột đã được Plan thêm tay 24/09 nên nhánh sẽ
  chạy là nhánh "đã có cột" — nhánh tôi đã chốt bằng phép kiểm.
- **CPU thêm trên Workers.** Không đo được từ máy. SHA-256 native trên tối đa 128 KB, suy luận là
  nhỏ so với trần 2.010.000 µs, nhưng đó là suy luận — giống hệt điều Thực thi đã tự nêu.
- **App trên localhost.** Tôi không mở lại. Thứ duy nhất người dùng thấy đổi là badge phiên bản
  `3.109.0 → 3.109.1` cộng hai dòng CHANGELOG, và Thực thi đã đo ở 1440px lẫn 375px. Không phép
  kiểm nào của tôi chạm tới đường đó — nói thẳng ra đây chứ không lờ đi.
- **Con số thật.** Việc này cần deploy rồi chờ một ngày mới có số. Đó là điểm của nó.

---

### Vòng trước — V1, soi đặc tả ngày 21/09 (giữ lại, V1 vẫn nằm trong hàng đợi)

**PHÁN QUYẾT** — **KHÔNG ĐẠT (trả về ① PLAN, trước khi Thực thi bắt đầu)**

Mục ② còn trắng nên **chưa có bản sửa nào để kiểm**. Đây là lượt soi ĐẶC TẢ, không phải lượt soi code.
Soi xong thì đặc tả ① hỏng ở một chỗ đủ để làm hỏng cả việc: **danh sách đóng thiếu một file**.

**LỖI TÌM ĐƯỢC**

**① · Danh sách "đóng, đã đo" của Plan thiếu `scripts/bao-cao-hang-ngay.gs` — MỨC: CHẶN**

Tôi đo lại độc lập trên cùng cây làm việc, cùng phạm vi `src/ tests/ scripts/ docs/`, cùng dải byte
mà chính Plan viết ra ở tiêu chí 3 (`0x00-0x08, 0x0b, 0x0c, 0x0e-0x1f`), cùng danh sách đuôi file
mà Plan liệt kê (`.ts .tsx .js .mjs .cjs .gs .md .json`):

| | Plan ghi | Tôi đo |
|---|---|---|
| Byte | 14 | **16** |
| File | 6 | **7** |
| Dòng | 12 | **14** |

Chỗ lệch nằm gọn ở một file Plan không hề nhắc:

```
scripts/bao-cao-hang-ngay.gs:341  [DC1 0x11]
scripts/bao-cao-hang-ngay.gs:342  [DC1 0x11]
```

Trừ hai byte đó ra thì 14/6/12 của Plan khớp tôi từng dòng một. Nói cách khác Plan không đo sai
12 dòng kia - Plan **bỏ sót nguyên một file**.

**Vì sao nó chặn, chứ không phải chuyện nhỏ:** đặc tả ① tự mâu thuẫn với chính nó.
- Tiêu chí 1 đòi **0 byte** trong `src/ tests/ scripts/ docs/` - `scripts/` nằm trong đó.
- Tiêu chí 3 bắt phép kiểm mới quét cả đuôi `.gs`, và dải byte đã nêu **có chứa 0x11**.
- Nhưng PHẠM VI lại ghi "đúng 12 dòng ở 6 file dưới đây" và "**không chạm file nào khác**".

Thực thi làm đúng PHẠM VI thì tiêu chí 1 và 3 đỏ. Làm cho tiêu chí 1 và 3 xanh thì phạm PHẠM VI.
Không có đường nào đi lọt. Và chính Plan đã dặn ở CHỖ CÒN MƠ HỒ: *"quét ra con số khác 14 thì
dừng lại, báo Plan, đừng tự quyết"* - tôi đang làm đúng câu đó.

**Thêm một chi tiết đáng chú ý:** file bị sót lại đúng là file Apps Script. L1 trong sổ lỗi ghi
nguyên văn *"dán vào Apps Script bị nuốt"*. Hai byte này nằm trong **thân ghi chú**, không nằm
trong chuỗi khoá, nên **không đổi hành vi app** - đừng phóng to. Nhưng ghi chú đó đang giải thích
cho người sau *vì sao phải dùng `String.fromCharCode(0)` chứ đừng nhúng byte thẳng*, và nó tự nhúng
byte thẳng để minh hoạ. Dán file vào trình soạn Apps Script là mất.

**Cần Plan quyết một trong hai, đừng để Thực thi tự đoán:**
- (a) Đưa `scripts/bao-cao-hang-ngay.gs:341,342` vào bảng phạm vi → con số chốt thành **16 / 7 / 14**; hoặc
- (b) Giữ nguyên 12 dòng, và sửa tiêu chí 1 + 3 để **loại trừ tường minh** file đó, kèm lý do.

**② · Lệnh quét chính thức ở NEN-TANG phần 6 báo "sạch" cho file CÓ byte lạ — MỨC: CHẶN**

Đây là lỗi nặng hơn lỗi ①, vì nó là **cái thước**. Lệnh ở NEN-TANG phần 6 chỉ dò 5 giá trị
(`0x00, 0x08, 0x0b, 0x0c, 0x1b`). Chạy đúng lệnh đó trên chính các file đang bẩn:

```
scripts/bao-cao-hang-ngay.gs  sach      <- thật ra có 2 byte 0x11
src/lib/compliance.ts         sach      <- thật ra có 1 byte 0x01
src/lib/parser.ts             CO 2 BYTE LA
```

**3 trên 16 byte vô hình với chính công cụ của đội.** Mục "ĐÃ ĐO" của cả bốn box đều có dòng
`quét byte điều khiển: sạch/có`, và dòng đó đang nói dối. Nếu Thực thi dùng lệnh này để tự nghiệm
thu, nó sẽ báo sạch trong khi `compliance.ts` vẫn còn 0x01 - đúng con byte Plan dặn kỹ nhất là
đừng đụng nhầm.

Đã sửa lệnh trong NEN-TANG phần 6 cho phủ hết dải, và ghi **L13**. Xem mục ⑤.

**ĐÃ ĐO - MỐC NỀN ĐỂ SAU NÀY ĐỐI CHIẾU** (đo 21/09/2026, trước khi Thực thi đụng gì)

```
tsc                    : sạch
vitest                 : 358 passed | 2 expected fail | 27 file
byte điều khiển        : 16 byte · 7 file · 14 dòng
   0x00 (NUL)          : 13
   0x01 (SOH)          : 1     src/lib/compliance.ts:203
   0x11 (DC1)          : 2     scripts/bao-cao-hang-ngay.gs:341,342
```

Lệnh quét tôi dùng nằm ở NEN-TANG phần 6 (bản đã sửa) - cùng dải byte, cùng danh sách đuôi file
mà tiêu chí 3 của Plan yêu cầu, nên Thực thi và Review đo lại sẽ ra đúng ba con số trên.

**CHƯA KIỂM ĐƯỢC**

- **Toàn bộ V1.** Chưa có code để kiểm. Khi ② có bản sửa, tôi còn phải soi: chứng minh tương đương
  từng byte (tiêu chí 5), khoá `toa|can` xuyên server-client, khoá `code|name` ở bốn chỗ, và
  **0x01 của `compliance.ts` không bị thống nhất nhầm về 0x00**.
- **Phép kiểm `tests/khong-byte-dieu-khien.test.ts`** chưa tồn tại - Thực thi viết. Tôi sẽ soi hai
  thứ: nó có đỏ trên bản chưa sửa không, và nó có bắt được **cả 0x01 lẫn 0x11** không, hay lại
  chép nhầm dải hẹp của lệnh cũ.
- **Đường dùng khoá trên app thật** (ma trận Media, tiêu chí 6): cần mở app, chưa làm ở lượt này
  vì chưa có gì thay đổi để mà so.

---

## ④ REVIEW

**PHÁN QUYẾT** — ĐẠT / ĐẠT KÈM ĐIỀU KIỆN / KHÔNG ĐẠT

**ĐÃ TỰ CHẠY LẠI**
```
tsc                  : <kết quả>
vitest               : <kết quả>
build                : <kết quả>
quét byte điều khiển : <kết quả>
```

**ĐỐI CHIẾU ĐẶC TẢ**
- Làm đủ: <có / thiếu gì>
- Làm thừa: <không / thừa gì>

**PHẢI SỬA TRƯỚC KHI DEPLOY**
<đánh số. Mỗi mục: chỗ nào, vì sao sai, hỏng ra sao nếu để nguyên.>

**NÊN SỬA, KHÔNG CHẶN**
<đáng cải thiện nhưng không đủ để giữ lại bản này.>

**RỦI RO KHI DEPLOY**
- Ảnh hưởng ai: <ai sẽ thấy thay đổi này>
- Hỏng thì sao: <hậu quả xấu nhất>
- Lùi lại được không: <có, bằng cách nào / không, vì sao>
- Hạn mức KV: <thêm bao nhiêu lượt/ngày>

---

## ⑤ BÀI HỌC MỚI

**Vòng V2b (24/09) — TEST: không thêm mục nào.** Chỗ NFC/NFD ở mục ③ là một cái bẫy thật, nhưng sổ
lỗi phần 4 là sổ **những lần đã hỏng thật, có ngày tháng**. Cái này chưa làm hỏng gì — nó mới chỉ
có thể làm đọc sai một con số chưa được đo. Chốt bằng phép kiểm là đủ; nhét vào sổ lỗi bây giờ là
làm loãng thứ đang có giá trị vì nó toàn chuyện đã xảy ra. Nếu khi đọc số thật mà nó gây kết luận
sai, lúc đó mới thành `L15` kèm ngày và con số.

---

**Vòng V1 (21/09) — TEST đã thêm `L13` vào NEN-TANG.md phần 4** — *Cái thước tự nó sai, và không ai đo lại cái thước.*

Và đã **sửa luôn lệnh quét ở NEN-TANG phần 6**, vì để nguyên thì cả bốn box vẫn đo bằng cái thước
hụt. Lệnh mới: nhận thư mục, tự đi vào trong, phủ đúng dải `0x00-0x08 · 0x0b · 0x0c · 0x0e-0x1f`,
in tên file · số dòng · mã byte. Chạy lên cây hiện tại ra **16 byte**, khớp từng dòng với phép đo
độc lập ở mục ③.

Đây là chỗ đáng nhớ nhất của lượt này: lỗi ① (Plan sót một file) **không phải Plan cẩu thả** - Plan
dùng đúng công cụ mà sổ nền tảng đưa cho, và công cụ đó mù với `0x11`. Sửa người thì hỏng lại,
sửa cái thước thì hết.
