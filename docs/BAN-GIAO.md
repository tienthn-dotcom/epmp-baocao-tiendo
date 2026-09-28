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

> *Mục ② của V4a nằm ở commit `c188f92`. V4a và V4b lên cùng một lần nên gộp vào **đúng một mục
> CHANGELOG `v3.110.0`** — tôi nối thêm ba dòng vào mục V4a đã có thay vì mở `v3.111.0` cho một bản
> chưa từng ra riêng.*

**ĐÃ LÀM — bảy việc của đặc tả, cộng hai thứ làm thêm**

`src/lib/excel-export.ts`:
1. **Chữ hết bị cắt.** Bỏ `row.height` ở mọi dòng dữ liệu. Ba dòng đầu vẫn đặt tay.
2. **Bảng màu `MAU`** chép từ hằng `GC`, thay hết mã màu rời rạc: thanh tiêu đề và hàng tiêu đề cột
   về `#334155`, dòng dự án `#334964`, dòng con `#F8FAFC`, hàng quá hạn nền `#FCEFDD` + mép trái
   `#E0A458`.
3. **Thanh màu trong ô "% thực tế"** — `dataBar` màu `#5EE9B5`, thang cố định 0–100.
4. **Cột "Quá hạn" tô theo bậc** — hai luật `cellIs`: `>= 14` nền đỏ chữ trắng, `> 0` nền ấm.
5. **Khối chú giải cuối bảng.**
6. **Đóng băng thêm cột** — `xSplit: 3`.
7. **Thiết lập trang in** — A4 ngang, `fitToPage` + `fitToWidth: 1` + `fitToHeight: 0`,
   `printTitlesRow: "3:3"`, lề hẹp, căn giữa ngang, và **số trang ở chân** (`&C Trang &P / &N`).

`src/routes/index.tsx`: truyền `pctColIndex` · `overdueColIndex` · `overdueAlertDays`; gắn cờ
`overdue` cho từng đầu việc; nối ba dòng vào mục CHANGELOG `v3.110.0`.

`tests/excel-o-that.test.ts`: 12 → **21** phép kiểm. `tests/excel-mau-khop-app.test.ts`: **mới**, 10 phép.

**HAI THỨ LÀM THÊM NGOÀI BẢY MỤC** — Plan nói cứ làm cho đạt chuẩn rồi khai:
- **Số trang ở chân trang in.** Mục 7 không nhắc. Bản in 8 trang mà không đánh số thì rời ra là lẫn,
  mà "đẹp như PDF" thì phải in được ra tử tế.
- **Phép kiểm chống trôi bảng màu** (`excel-mau-khop-app.test.ts`). Nó đọc thẳng hằng `GC` trong
  `index.tsx` bằng regex rồi so với `MAU`, và chốt luôn là `index.tsx` truyền `OD_ALERT_DAYS` chứ
  không gõ số cứng. Đây là cái giá phải trả cho quyết định chép màu bên dưới — không có nó thì
  người chỉnh màu Gantt sẽ không bao giờ biết mình vừa làm lệch file Excel.

**VÌ SAO LÀM THẾ**

*Chép màu sang `excel-export.ts`, KHÔNG kéo `GC` ra dùng chung* (chỗ Plan để tôi chọn). `GC` khai
**bên trong** component Gantt đang chạy. Kéo nó ra là sửa vào đường render của Gantt để phục vụ một
việc thuần trình bày của Excel — đúng loại **L11**: diff sạch, test xanh, giao diện vẫn hỏng, và
loại đó không soi ra được bằng diff. Cái giá của việc chép là trôi, nên tôi trả giá đó bằng phép
kiểm nói trên chứ không bằng một lời hứa.

*Chú giải nói MÀU = MỨC NGHIÊM TRỌNG, không gán mỗi nhãn một màu.* Đây là chỗ tôi **làm khác đặc
tả**, cố ý. Mục 5 viết "mỗi mục một ô tô đúng màu của nó", ngầm hiểu mỗi nhãn có một màu cố định.
Không có chuyện đó: ghi chú ở `index.tsx` (~dòng 1381) nói nguyên văn *"MÀU TÁCH RỜI NHÃN… 'Cần tập
trung' vàng khi dự án còn xa hạn, nhưng ĐỎ khi dự án sắp bàn giao; 'Cần cắt đầu việc' vàng ở far,
đỏ từ d30. Vì vậy KHÔNG được suy màu từ `kind`"*. In ra một chú giải gán chết nhãn↔màu là **in ra
một luật mà app không chạy theo** — người đọc báo cáo sẽ suy ngược từ màu ra nhãn và suy sai. Nên
chú giải có hai phần: dải màu nói mức (Nặng · Cần chú ý · Đã hoàn thành) kèm đúng câu giải thích,
rồi liệt kê bốn nhãn riêng.

*Cột Quá hạn dùng hai bậc `cellIs`, không dùng thang màu liên tục.* Mục 4 cho chọn "thang màu hoặc
nền đỏ khi vượt ngưỡng". App chia đúng hai bậc (`lib/filter.ts:138`: `>= OD_ALERT_DAYS` là A, `> 0`
là B). Thang màu liên tục là tự chế một luật thứ ba mà app không có.

*Ngưỡng lấy thẳng `OD_ALERT_DAYS` từ `lib/filter`, không gõ lại số 14.* Đã tra: **chỉ có một ngưỡng**
(`filter.ts:34`, `export const OD_ALERT_DAYS = 14`), nên không phải báo Plan. Đổi ngưỡng ở đó thì
file Excel đổi theo, khỏi lệch âm thầm với cảnh báo trên bảng.

**ĐÃ ĐO**
```
tsc                   : sạch (exit 0)
vitest                : 417 passed | 2 expected fail | 1 FAILED | 31 file
                        Trừ phép đỏ (không phải của tôi, xem CHỖ TÔI KHÔNG CHẮC số 4) thì mốc nền
                        398 | 2 | 30 → chênh +19 đúng bằng phần tôi thêm (9 phép nối vào file cũ
                        + 10 phép của file màu mới).
build                 : qua, 11,73s
quét byte điều khiển  : 16 byte · 7 file — đúng mốc nền. File tôi đụng đều sạch.
DUNG LƯỢNG (ràng buộc 4): cùng bộ dữ liệu 69 dự án · 305 đầu việc
                        V4a: 36.959 byte → V4b: 38.353 byte = **+1.394 byte, +3,8%**
kiểm trên app         : 1440px badge 3.110.0, 69 dự án, không tràn. 375px không tràn ngang.
                        Không lỗi console mới.
ghi KV thêm mỗi lần mở app : 0. Việc này không có một đường ghi KV nào.
cổng demo / đang tải  : CÓ SẴN ở index.tsx:2482-2483, tôi không đụng.
```

**ĐÃ MỞ FILE THẬT VÀ SOI** — xuất từ app đang chạy, dữ liệu thật, 69 dự án · 305 đầu việc, 382 dòng:
```
đóng băng     : xSplit 3 · ySplit 3
trang in      : landscape · fitToWidth 1 · printTitlesRow "3:3"
chiều cao     : dòng 1 = 22 · dòng 3 = 26 · dòng 4,5 = KHÔNG ĐẶT → Excel tự giãn
định dạng ĐK  : G4:G377 → dataBar   ·   H4:H377 → cellIs, cellIs
chú giải      : "CHÚ GIẢI · Nặng · Cần chú ý · Đã hoàn thành · Màu nói MỨC NGHIÊM TRỌNG…"
```

*Tiêu chí 2 — ô ghi chú dài nhất:* **571 ký tự**, dòng 135, công đoạn SX
("CẬP NHẬT TIẾN ĐỘ HỌP VỚI LÃNH ĐẠO: Public B1: 25/08 XONG 100%…").
Cột rộng 48 → ước **12 dòng chữ**. TRƯỚC: cao cứng 18pt hiện ~**1 dòng**, cụt 11 dòng.
SAU: hiện đủ **12 dòng**.

*Tiêu chí 5 — ô % chưa có số:* trong file có **305 ô có số** và **69 ô TRỐNG** (đúng bằng số dòng
dự án). Trong 305 ô có số thì **129 ô là số 0 THẬT**. Nếu gộp trống thành 0 thì sẽ có 198 dòng hiện
"0%", tức bịa thêm 69 dòng chưa đo thành đã đo và được 0. Data bar không vẽ gì trên ô rỗng.

*Cột Quá hạn:* **110 ô từ 14 ngày trở lên** sẽ tô đỏ.

**Đã xác nhận ĐỎ trên bản chưa sửa:** đặt lại `row.height = isGroup ? 20 : 18` → phép kiểm "chữ hết
bị cắt" đỏ. Phục hồi xong 21/21 xanh.

**CHỖ TÔI KHÔNG CHẮC**

1. **Tôi chưa mở file bằng Excel thật, và đây là việc chấm bằng mắt.** Mọi kết luận trên đọc từ XML
   trong file và từ `exceljs`. Ba thứ tôi **không tự nghiệm thu được**, cần người mở Excel xem:
   **(a)** chiều cao tự giãn — Excel tính lúc mở, tôi chỉ chứng minh được là đã bỏ chiều cao đặt
   tay, không chứng minh được chữ hiện đủ trên màn hình thật; **(b)** data bar vẽ ra trông thế nào;
   **(c)** Ctrl+P ra đúng một trang bề ngang. **Đã đính kèm file cho người dùng tự nhìn.**

2. **Chưa đặt cạnh bản PDF** (tiêu chí 1 đòi xuất cùng lúc cùng bộ lọc rồi so). Đường PDF dùng
   `html2canvas` chụp giao diện, cần trình duyệt thật và tôi không mở được Excel để so song song.
   **Đây là phần nghiệm thu tôi chưa làm được, không phải phần tôi bỏ qua.**

3. **Chiều cao tự giãn có thể làm bản in dài ra đáng kể.** Một ô 571 ký tự thành 12 dòng thì hàng đó
   cao gấp hơn chục lần. Đổi lại là chữ không mất. Nếu người dùng thấy bản in quá dài thì hướng sửa
   là giới hạn chiều cao tối đa mỗi hàng — nhưng đó là quyết định đánh đổi "gọn" với "đủ chữ", phải
   hỏi chứ tôi không tự chọn.

4. **Phép kiểm `findMatrixSheets` vẫn đỏ, và nay hỏng KHÁC trước.** Vòng V4a nó quá hạn 5.000 ms
   (đo 6.543 / 7.125 / 8.352 ms); lượt này nó đỏ trong **3 ms**. `tests/matrix-reader.test.ts` đang
   có thay đổi chưa commit trong cây — **box khác đang sửa nó**, nên tôi để yên (luật 5.6). Vẫn
   không liên quan tới tôi: file đó chỉ import `matrix-reader` + `xlsx`.

5. **`showValue: true` trên data bar** — tôi chọn để vẫn hiện số "85%" bên cạnh thanh. Nếu muốn chỉ
   thanh không số thì đổi một chữ, nhưng giấu số trên một bảng báo cáo thì tôi cho là dở hơn.

6. **Tôi không đo được ảnh hưởng của xSplit tới bản in.** Đóng băng chỉ ảnh hưởng lúc xem, không
   ảnh hưởng lúc in — theo hiểu biết của tôi về Excel, nhưng tôi không chạy Excel để xác nhận.

**CHƯA LÀM**

- **Không đổi** danh sách cột, thứ tự cột, độ rộng cột, hay bất kỳ giá trị dữ liệu nào. Ràng buộc 1
  giữ nguyên: đây là vòng đổi cách trình bày.
- **Không đụng** `exportMatrixXlsx` (cùng file, đường khác — đã phải neo thêm ngữ cảnh khi sửa vì
  hai hàm có đoạn mã giống hệt nhau, suýt sửa nhầm), không đụng đường PDF, không bỏ ẩn dòng con.
- **Không sửa** phép kiểm `matrix-reader` đang đỏ.
- **Không deploy.** V2b và V4a vẫn nguyên trong cây, tôi không revert gì.
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

Review nhận vai 28/09/2026 (trước đó session này làm Test vòng V1). Hai bản chờ, **mỗi bản một
phán quyết riêng** ở dưới. Tôi chưa đụng vào cả hai bản này ở vòng nào, nên soi được độc lập.

### PHÁN QUYẾT NGẮN

| Bản | Commit | Phán quyết |
|---|---|---|
| **V2b** · băm vào bảng đếm D1 | `40eae6c` (v3.109.1) | **ĐẠT KÈM ĐIỀU KIỆN** |
| **V4a** · xuất Excel ô thật | `c188f92` (v3.110.0) | **ĐẠT KÈM ĐIỀU KIỆN** |

Không tìm được lỗi nào trong hai bản đủ để chặn. Điều kiện là **bốn việc phải làm**, không phải bốn
chỗ phải sửa code — liệt kê ở cuối. Điều kiện số 1 là điều kiện quan trọng nhất, và nó không nằm
trong code của bản nào.

### ĐÃ TỰ CHẠY LẠI

**Đo ở CÂY RIÊNG, ghim vào đúng commit đang phán quyết.** Cây làm việc chung không dùng để đo được
(lý do ở mục kế tiếp), nên tôi dựng `git worktree` tách ra ở `8763e2a` — cây **sạch**, không một
dòng chưa commit — rồi chạy ở đó. Không đụng file nào của ai.

```
worktree tại 8763e2a (chứa cả V2b lẫn V4a), git status TRỐNG:
tsc                  : sạch (exit 0)
vitest               : 387 passed | 0 failed | 0 expected fail | 29 file
build                : qua (exit 0)
quét byte điều khiển : 16 byte · 7 file · 14 dòng — ĐÚNG mốc nền, không bản nào thêm byte
                       (0x00 ×13 · 0x01 ×1 · 0x11 ×2)
cột `bam` trên D1 production : CÓ THẬT — tự đọc, không tin lời khai
```

**Bộ kiểm XANH SẠCH ở commit đang phán quyết — kể cả `matrix-reader`.** 29 trên 29 file, không một
phép đỏ. Nghĩa là phép đỏ mà cả Plan lẫn Thực thi báo **không nằm trong hai bản này**, và ở đây nó
cũng không quá hạn.

*Đo thêm trên cây chung để đối chiếu:* `1 FAILED | 398 passed | 2 expected fail | 30 file`. Chênh
lệch so với số ghim ở trên là do cây chung đang mang việc chưa commit của box khác cộng một file kiểm
chưa theo dõi của tôi từ vòng V1.

**CÂY LÀM VIỆC CHUNG ĐANG MANG CODE CHƯA AI SOI — ĐỌC CHỖ NÀY TRƯỚC KHI BẤM DEPLOY.**

Trong lúc tôi soi, cây chung chuyển từ "chỉ sửa file kiểm" sang có **code sản phẩm chưa commit**:

```
 M src/lib/excel-export.ts   +143 dòng   (không phải chuyện ký tự cuối dòng — diff --ignore-all-space y hệt)
 M src/routes/index.tsx       +11 dòng
 M tests/matrix-reader.test.ts
```

Đọc nội dung thì rõ đây là **V4b** (phần NHÌN) đang được viết: bảng màu `MAU` chép từ `GC`,
`xSplit: 3`, `pageSetup` A4 ngang, `printTitlesRow`, thanh màu trong ô. Nó sửa **đúng
`exportTableXlsx`** — hàm tôi đang phán quyết cho V4a.

**Phán quyết của tôi gắn vào COMMIT, không gắn vào cây:** `40eae6c` cho V2b,
`c188f92` + `8763e2a` cho V4a. **Tôi không phán quyết gì về 154 dòng chưa commit kia** — chưa qua ②,
chưa qua ③, chưa ai soi. `wrangler deploy` dựng từ **cây**, không dựng từ commit, nên bấm deploy lúc
này là **đưa cả V4b chưa soi lên production**. Đúng họ hàng L12: cây git là cây dùng chung.

**PHÉP ĐỎ KHÔNG PHẢI CỦA HAI BẢN NÀY, VÀ KHÔNG PHẢI QUÁ HẠN NHƯ ĐÃ MÔ TẢ.**

Tôi được giao thông tin là `findMatrixSheets` đỏ vì quá hạn 5.000 ms. **Trên cây hiện tại không
phải vậy.** Nó đỏ vì:

```
ReferenceError: wbChung is not defined
   tests/matrix-reader.test.ts:54
```

Bản sửa chưa commit đang nằm trong cây **còn dở**: nó đổi lời gọi sang `wbChung` nhưng **chưa khai
biến đó ở đâu cả**, và khai `HAN_DOC_LAI_FILE = 20_000` rồi **không dùng**. Ai chạy `vitest` lúc này
sẽ thấy một phép đỏ với nguyên nhân hoàn toàn khác nguyên nhân đã báo.

Còn bản **đã commit** của file đó thì **chạy qua trên máy này**, đo ba lượt liền:

```
findMatrixSheets : 1.263 ms · 1.296 ms · 1.263 ms      (mốc mặc định 5.000 ms)
```

Đối chiếu: Plan đo 5.943 ms, Thực thi đo 6.543 / 7.125 / 8.352 ms. Cùng một commit, cùng một file
nguồn. Kết luận: phép kiểm này **phụ thuộc máy và tải**, không phải code chậm đi. Nó nằm ở 25% mốc
trên máy này và vượt mốc trên máy khác. Cả Plan lẫn Thực thi đều báo trung thực những gì họ thấy —
chỉ là cái họ thấy không phải một hằng số. Việc nâng mốc vẫn đáng làm, nhưng **lý do đúng là "phép
kiểm đọc file thật nên thời gian trôi nổi theo máy"**, không phải "có gì đó vừa chậm đi".

**MỘT PHÁT HIỆN KÈM THEO — `tsc` không phủ `tests/`.** `tsconfig.json` khai
`include: ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts", "eslint.config.js"]`. Không có `tests`.
Vì thế `tsc` báo **sạch** ngay trong lúc `tests/matrix-reader.test.ts` gọi một biến không tồn tại.
Dòng `tsc: sạch` trong mục ĐÃ ĐO của cả bốn box **chưa bao giờ nói gì về file kiểm**. Đây đúng họ
hàng L13 (cái thước hụt), nhưng khác chỗ: thước này không sai, nó chỉ hẹp hơn mọi người tưởng.

---

### BẢN 1 · V2b — `40eae6c` — ĐẠT KÈM ĐIỀU KIỆN

**ĐỐI CHIẾU ĐẶC TẢ**

- **Làm đủ: có.** Băm ngắn có, cột `bam` có, đường lùi hai cột có, `demGhiKv` giữ tham số thứ hai
  không bắt buộc nên đường `delete` gọi kiểu cũ vẫn chạy.
- **Làm thừa: không.** Hai file `edits.functions.ts` và `mtld-install.functions.ts` mỗi file đúng
  **một dòng**, ngoài phạm vi khai báo nhưng **không có đường nào khác** — `demGhiKv` không thể băm
  thứ nó không được đưa. Thực thi đã tự khai chỗ này trong thông điệp commit. Đây không phải thừa,
  đây là phạm vi đặc tả viết hụt.

**ĐÃ TỰ KIỂM, KHÔNG TIN LỜI KHAI**

*Cột `bam` trên production.* Plan khai đã tự chạy `ALTER TABLE` ngày 24/09. Tôi đọc thẳng:

```
PRAGMA table_info(kv_write)  →  id INTEGER · ts TEXT · kho TEXT · bam TEXT
```

**Lời khai đứng.** Nghĩa là nhánh sẽ chạy trên production là nhánh "đã có cột" — đúng nhánh Test đã
chốt bằng phép kiểm. Ghi thêm cho người sau: ghi chú cũ của tôi nói `wrangler --remote` bị chặn ở
dự án này; **hôm nay nó chạy được** (served_by v3-prod, colo SIN).

*Chi phí CPU của hàm băm — cả Thực thi lẫn Test đều để ở dạng "suy luận là nhỏ". Tôi đo ra số:*

| Payload | Trung vị | % trần CPU (2.010.000 µs) |
|---|---|---|
| kho `mtld` thật, ~40 KB | **153 µs** | 0,008% |
| đúng mốc cắt 128 KB | **359 µs** | 0,018% |
| `sfile:` 2 MB base64 | **405 µs** | 0,020% |
| `sfile:` 8 MB | **366 µs** | 0,018% |

Hai điều rút ra. Một: chi phí **dưới một phần năm nghìn** trần CPU, không phải chỗ đáng lo. Hai —
đáng hơn: payload **8 MB tốn bằng 128 KB** (366 so với 359 µs). Đó là bằng chứng mốc cắt `CAT_BAM`
**thật sự chặn**, chứ không chỉ có vẻ chặn. Nếu băm trọn, 8 MB sẽ tốn gấp 64 lần. Lo ngại L9 mà
Thực thi nêu ra là lo đúng chỗ, và cách chặn cũng đúng.

*Ràng buộc "băm hỏng thì không ném".* Đọc lại đường code: `bamNgan` bọc trọn trong `try/catch` trả
`""`; `crypto` không có hay `subtle` không có đều rơi vào `catch` đó; `demGhiKv` lại bọc thêm một
lớp `try/catch` ngoài cùng. Ba lớp đỡ, không có đường nào cho lỗi đếm leo lên lượt ghi thật. Đúng
bài học L3.

**PHẢI SỬA TRƯỚC KHI DEPLOY** — không có.

**NÊN SỬA, KHÔNG CHẶN**

1. **Đường lùi hai cột không chốt lại, nên nó thử lại mỗi lượt ghi.** Nếu `ALTER` hỏng vì lý do
   thật (không phải "đã có cột"), `banSan` vẫn thành `true`, rồi **mỗi** lượt ghi KV sau đó sẽ chạy
   câu chèn ba cột (hỏng) rồi mới chèn hai cột — **hai câu D1 cho mỗi lượt ghi**, suốt đời isolate
   đó. Không đốt hạn mức đáng kể (câu hỏng không tính là dòng ghi, mà bảng này chỉ ~500 dòng/ngày),
   nhưng thêm một vòng đi-về D1 cho mỗi lượt ghi thì không cần thiết. Một cờ `coCotBam` nhớ lại kết
   quả lần đầu là xong.
2. **Bảng đếm giờ có cột `bam` nhưng không có gì dọn nó.** Bảng chỉ có `idx_kvw_ts`, không thấy
   đường xoá dòng cũ. Cột thêm vào làm mỗi dòng nặng hơn 12 byte; ~500 dòng/ngày thì lâu dài vẫn
   đáng có một câu dọn theo `ts`. Ngoài phạm vi V2b, ghi vào hàng đợi.

**RỦI RO KHI DEPLOY**

- **Ảnh hưởng ai:** không ai thấy gì. Người dùng chỉ thấy badge `3.109.0 → 3.109.1` và hai dòng
  CHANGELOG. Không đổi số, không đổi màn hình.
- **Hỏng thì sao:** trường hợp xấu nhất là **mất cái băm, không mất dòng đếm** — đã có đường lùi.
  Trường hợp xấu hơn (mất cả dòng đếm) cần D1 hỏng, mà lúc đó bảng đếm hỏng sẵn rồi, không phải do
  bản này. Lượt ghi KV thật **không** nằm trong đường nào có thể hỏng vì băm.
- **Lùi lại được không:** được, `wrangler rollback` hoặc deploy lại commit trước. Cột `bam` để lại
  trên D1 cũng vô hại — bản cũ chèn hai cột, cột thứ ba nhận NULL.
- **Hạn mức KV: thêm 0 lượt/ngày.** Không có đường ghi KV mới; số dòng D1 mỗi ngày không đổi, chỉ
  mỗi dòng mang thêm một cột.

---

### BẢN 2 · V4a — `c188f92` + `8763e2a` — ĐẠT KÈM ĐIỀU KIỆN

**ĐỐI CHIẾU ĐẶC TẢ**

- **Làm đủ: có**, cả bảy tiêu chí của mục ①. Ba cột ngày ra `Date`, `%` và `Quá hạn` ra số, cột chữ
  giữ chữ, `numFmt` giữ cho bảng nhìn như cũ.
- **Làm thừa: không.** Chỗ duy nhất đáng bàn là ô ngày trống nay **rỗng thật** thay vì chữ `—` —
  Plan đã tự duyệt ở phần sửa đặc tả và tôi đồng ý: để chữ `—` trong cột ngày là **phá đúng phép
  sắp xếp mà việc này sinh ra để sửa**. Đây là làm đúng, không phải làm thừa.

**ĐÃ TỰ KIỂM**

*Luật 5.2 — chỗ nguy hiểm nhất của dự án này.* Soi thẳng vào chỗ dựng ô:

```
% thực tế  : it.pctActual != null ? Math.round(it.pctActual) : null     → 0 giữ là 0, chưa đo là TRỐNG  ✓
dòng nhóm  : null, null                                                 → không phải 0  ✓
đóng numFmt: cell.value != null && cell.value !== ""                    → 0 vẫn được đóng định dạng  ✓
                                                                          ô trống KHÔNG bị đóng dd/mm/yy  ✓
```

Chỗ cuối quan trọng hơn vẻ ngoài của nó: đóng `dd/mm/yy` lên ô rỗng là mời Excel vẽ ra `00/01/00`,
tức biến *chưa có* thành *một ngày có thật*. Bản này chặn đúng chỗ đó.

*`XlsxTableRow` mở rộng kiểu có làm lây sang đường xuất ma trận không — Plan dặn kiểm riêng.*
Không. `XlsxTableRow` và `XlsxCell` chỉ xuất hiện ở dòng 577–623, tức khối kiểu ngay **trước**
`exportTableXlsx` (dòng 615). `exportMatrixXlsx` nằm ở dòng 233–570 và **không nhắc tới chúng một
lần nào**. Lời khai của Thực thi đứng.

*Bộ kiểm có thật sự kiểm gì không.* Có, và đây là bộ kiểm tốt. Nó chạy trọn `exportTableXlsx`, bắt
lấy `Blob` thật, **đọc ngược file `.xlsx` bằng exceljs** rồi soi từng ô — không phải đọc mã nguồn.
Phép chốt lý do tồn tại của cả việc (`SẮP XẾP THEO HẠN`) so cả hai chiều: sắp theo `Date` ra
`15/06/25 · 01/12/25 · 02/01/26`, sắp theo chữ ra `01/12/25 · 02/01/26 · 15/06/25`. Có phép riêng
cho `0` khác `TRỐNG`, có phép riêng cho `CT26-032` vẫn là chuỗi.

**PHẢI SỬA TRƯỚC KHI DEPLOY** — không có.

**NÊN SỬA, KHÔNG CHẶN**

1. **Ngày trước năm 1900 ra số thứ tự ÂM, Excel không vẽ được.** Tôi đo thẳng bằng exceljs:

   | ISO trong nguồn | Số thứ tự trong `sheet1.xml` |
   |---|---|
   | `2026-09-15` | 46280 |
   | `1900-01-01` | 2 |
   | `1899-12-30` | **0** |
   | `1899-09-15` | **-106** |
   | `0202-09-15` | **-619923** |

   Số âm thì Excel hiện `########` chứ không hiện ngày. Bản cũ ghi chữ `15/09/1899` — xấu nhưng đọc
   được. **Đã đo trên nguồn thật: không bắn.** 6 file Master Plan, **4.348 ngày**, không ngày nào
   ngoài khoảng 1900–2100. Đây là rủi ro tiềm ẩn, tôi không phóng to hơn thế.

2. **Ngày không tồn tại bị cuộn sang ngày khác, trong im lặng — đáng lo hơn mục 1.**
   `toIso` chỉ chặn `day > 31`, nên `31/02/2026` **đi qua** thành `2026-02-31`. `oNgay` dựng
   `Date.UTC(2026, 1, 31)` = **`2026-03-03`**. Bản cũ hiện chữ `31/02/26`, người đọc thấy ngay là
   nhầm. Bản mới hiện `03/03/26` — **một ngày trông hoàn toàn hợp lệ, và sai**. Trái luật 5.3 (chọn
   cách lộ ra, đừng chọn cách âm thầm), trên cột dùng để đánh giá PM. **Đã đo: cũng không bắn** —
   0 trên 4.348 ngày bị cuộn. Cách chặn gọn: sau khi dựng `Date`, so lại `getUTCDate()` với số ngày
   đã đọc, lệch thì trả `null`. Ba dòng, nhưng **đừng nhét vào V4a** — nó đụng `oNgay` là chỗ đang
   được phán quyết, và nó là việc của `toIso` nhiều hơn.

3. **Cột `Quá hạn` gộp "0 ngày" với "chưa có hạn".** `getDaysOverdue` trả `number | null`: `null`
   khi **không có deadline**, `0` khi **đã đo và không trễ**. Chỗ dựng ô dùng
   `it.overdueDays ? it.overdueDays : null` nên **cả hai** thành ô trống. Đúng thứ luật 5.2 cấm —
   nhưng đây là **hành vi có từ trước**, và Thực thi giữ y thế **có chủ ý**, khai rõ, vì vòng này
   đã chốt "không đổi cái nhìn thấy". Tôi đồng ý với lựa chọn đó ở vòng này. Đáng chú ý là ô ngay
   bên cạnh (`%`) thì **có** phân biệt, nên hai ô cạnh nhau đang dùng hai luật khác nhau. Không sinh
   ra con số sai nào (ô trống không vào tổng, mà 0 cũng cộng ra 0), nên không chặn.

4. **Bộ kiểm tự khai lại danh sách cột.** Thực thi đã tự nêu ở mục ② số 2, Plan đã xếp vào hàng đợi.
   Tôi xác nhận đúng: mảng `COLS` trong file kiểm là bản chép tay của `cols` trong `index.tsx`. Đổi
   `numFmt` một bên mà quên bên kia thì bộ kiểm vẫn xanh. Không chặn, nhưng đây là loại lỗ **tự mở
   rộng theo thời gian**.

**RỦI RO KHI DEPLOY**

- **Ảnh hưởng ai:** ai bấm "Xuất Excel". Thấy đổi đúng hai thứ: sắp xếp theo ngày **ra đúng thứ tự**
  (trước là sai), và ô ngày trống **rỗng** thay vì dấu `—`. Màu, cột, thứ tự cột, độ rộng: không đổi.
- **Hỏng thì sao:** xấu nhất là file xuất ra có ô ngày hiện `########` (mục 1) hoặc một ngày bị cuộn
  (mục 2). Cả hai đều cần dữ liệu nguồn mà hôm nay **không có** — 0 trên 4.348. Không có đường nào
  làm sập app: cả việc nằm trong một nút bấm, không chạm đường nạp dữ liệu.
- **Lùi lại được không:** được, deploy lại commit trước. Không có dữ liệu nào bị biến đổi — chỉ là
  file người dùng tự tải về.
- **Hạn mức KV: thêm 0 lượt/ngày.** Không có đường ghi KV nào trong việc này; tôi đã tự soi diff cả
  hai file, không có `put`, không có `demGhiKv`.

---

### BỔ SUNG 28/09 — Plan đổi chuẩn chấm, và V4b đã kịp lên commit `a914b2f`

Plan gửi chuẩn nghiệm thu mới của người dùng (*"file excel phải đẹp như PDF luôn, về màu sắc, bố
cục"*) kèm ba câu hỏi khác cho V4a, và nhờ soi **đặc tả V4b trước khi Thực thi tốn công**. Trong lúc
tôi soi đặc tả thì V4b đã commit xong (`a914b2f`). Nên phần dưới vừa trả lời ba câu, vừa nói luôn
**lỗ nào của đặc tả V4b đã bịt và lỗ nào chưa** — soi trên code thật thay vì đoán.

**BA CÂU VỀ V4a**

**(a) V4a có làm sai gì không — KHÔNG.** Đã soi ở phần trên: `%` phân biệt `0` với chưa-đo, dòng
nhóm để `null` chứ không `0`, `numFmt` không đóng lên ô rỗng, `CT26-032` vẫn là chuỗi, ngày không
lệch múi giờ. Hai ranh giới tôi tìm được (năm trước 1900 ra số âm; ngày không tồn tại bị cuộn im
lặng) đo trên 6 file thật · **4.348 ngày** · **0 lần bắn**.

**(b) V4a có cản đường V4b không — KHÔNG, ngược lại nó vừa vặn đúng chỗ.** Đây là chỗ đáng nói:

V4b dựng data bar với thang **tuyệt đối** `cfvo: [{type:"num", value:0}, {type:"num", value:100}]`.
Thang đó **chỉ đúng vì V4a chọn lưu `85` chứ không lưu `0.85`**. Nếu V4a đi đường `0.85` + `0%` thì
mọi thanh màu sẽ dài khoảng 1% ô — nhìn như chưa ai làm gì. Thực thi V4a đã chọn `85` vì lý do khác
(lọc "lớn hơn 80" gõ được số 80), nhưng lựa chọn đó **tình cờ cứu luôn V4b**. Ghi lại để sau này ai
định đổi sang `0.85` thì biết là phải đổi cả `cfvo`.

Thêm: ràng buộc 2 của V4b (ô chưa có số **không được vẽ thanh nào**) giữ đúng **nhờ V4a** — vì V4a
để ô trống là trống thật, Excel không khớp `greaterThan 0` nên không tô. Nếu V4a ghi `0` vào đó thì
data bar sẽ vẽ một thanh dài 0 ở ô chưa đo, tức biến *chưa đo* thành *0%* **bằng hình ảnh**.

**(c) Có chỗ nào V4b phải đập đi làm lại — KHÔNG có, nhưng có một cái bẫy đã gài sẵn.**

V4b chỉ thêm hàng ở **cuối** bảng (khối chú giải) nên 32 chỗ neo hàng cứng trong
`tests/excel-o-that.test.ts` (`getRow(4)` = dòng dữ liệu đầu, `ref` bắt đầu `G4`) **không bị xê**.
Không phải làm lại gì.

Nhưng: **32 chỗ neo cứng đó là bẫy cho việc tiếp theo.** Thêm bất kỳ khối nào **phía trên** bảng —
mà đó đúng là thứ tôi đề nghị ở dưới — sẽ đẩy mọi hàng xuống và làm đỏ hàng loạt phép kiểm, trong
khi file xuất ra hoàn toàn đúng. Ai làm việc đó thì **neo động trước** (tìm hàng có nhãn
`"Ngày update"` rồi cộng 1), đừng sửa 32 con số bằng tay.

**BA LỖ TRONG ĐẶC TẢ V4b — V4b KHÔNG BỊT, VÀ ĐÂY MỚI LÀ CHỖ CÁCH BẢN PDF XA NHẤT**

Tôi đọc `pdf-export.ts` rồi đọc chỗ app gọi nó (`index.tsx:4374`). **PDF không phải là cái bảng.**
Nó là bốn thứ ghép lại:

```
title      : #pdf-title
blocks     : #pdf-kpi      — dải 6 thẻ KPI (Dự án hiện hành · Trễ tiến độ · …)
             #pdf-stages   — 7 thẻ giai đoạn, mỗi thẻ một thanh xanh/đỏ/vàng/xám, kèm hàng chú giải
table      : #pdf-table
nền        : #eef1f4 xám nhạt, card trắng nổi lên, KHÔNG có đường lưới
```

Excel xuất ra có: một dòng tiêu đề, một dòng "Phạm vi:", cái bảng, và (sau V4b) khối chú giải cuối.
**Không có KPI. Không có thẻ giai đoạn. Vẫn còn đường lưới.**

Chuẩn chấm của người dùng là *"người thứ ba nhìn hai cái phải thấy cùng một báo cáo, cùng bộ màu,
cùng bố cục"*. Đặt hai file cạnh nhau thì thứ đập vào mắt trước **không phải** chiều cao hàng hay
thanh màu — mà là **bản PDF mở ra có một trang tóm tắt, bản Excel thì vào thẳng bảng dữ liệu**.
Bảy việc trong đặc tả V4b đều nằm **trong** cái bảng; không việc nào nói tới hai khối kia.

| # | Thiếu | Công | Ghi chú |
|---|---|---|---|
| **1** | **Tắt đường lưới** — `ws.views[0].showGridLines = false` | **một dòng** | Đổi nhiều nhất trên mỗi đồng công. Có lưới thì mắt đọc ra "bảng tính"; tắt đi mới ra "báo cáo". PDF không có lưới. Tôi đã grep: chưa có ở đâu trong `excel-export.ts`. |
| **2** | **Dải KPI ở đầu sheet** — 6 ô KPI, mỗi ô một nhãn + một số, tô theo tone như app | trung bình | Đây là **cả trang đầu của bản PDF**. Số đã có sẵn trong `p.projectCount`, `p.lateCount`… ở `index.tsx`; chỉ cần truyền xuống. |
| **3** | **Khối 7 thẻ giai đoạn** — tên giai đoạn + viết tắt + số việc theo bậc màu | nặng hơn | Thanh xếp lớp của app (xanh mờ → đỏ → vàng → xám) Excel không vẽ nổi trong một ô. Làm được: mỗi giai đoạn một hàng, bốn cột số theo bậc màu. **Đừng nhận việc theo cách "vẽ lại đúng cái thanh"** — đó lại là cái bẫy "giống hệt PDF" mà chính Plan đã cảnh báo. |

Việc 1 đáng làm **ngay**, gần như không có giá. Việc 2 và 3 nên để Plan quyết có mở V4c hay không —
nhưng **phải nói với người dùng là Excel hiện chưa có hai khối đó**, đừng để họ mở file ra mới thấy.

**MỘT CHỖ ĐẶC TẢ V4b VIẾT SAI, VÀ THỰC THI ĐÃ KHÔNG CHÉP THEO — GHI LẠI KẺO NGƯỜI SAU "SỬA" NGƯỢC**

Đặc tả mục 5 bảo khối chú giải ghi *"đúng chữ như chú thích trên app"* rồi liệt kê
`Trễ tiến độ · Cần cắt đầu việc · Cần tập trung · Đã hoàn thành`. **Hai câu đó chống nhau.** Chú
giải thật trên app (`index.tsx:4802`) ghi `Hoàn thành · Cảnh báo đỏ · Cảnh báo vàng · Đang triển
khai` — tức **theo MÀU**, kèm ghi chú tại chỗ nói thẳng *"ghi tên nhãn là sai"* vì một màu gom nhiều
nhãn. Bốn chữ đặc tả liệt kê là `ALERT_TXT`, vốn dùng cho **chữ trong ô cột Tình trạng**, không phải
cho chú giải. Đặc tả trộn hai bộ từ vựng khác nhau của app.

**Thực thi đã bắt được chỗ này và làm đúng**, không chép theo đặc tả: khối chú giải trong `a914b2f`
tách làm hai hàng — hàng màu ghi `Nặng / Cần chú ý / Đã hoàn thành` kèm câu *"Màu nói MỨC NGHIÊM
TRỌNG, không dính chết vào nhãn"*, rồi hàng dưới liệt kê bốn nhãn **như từ vựng**, không gán màu.
Đây là cách giải đúng, và tốt hơn cả phương án chép y nguyên chú giải app.

Còn lại một chuyện nhỏ thật: chữ trên Excel (`Nặng / Cần chú ý`) khác chữ trên app (`Cảnh báo đỏ /
Cảnh báo vàng`), và Excel không có mục xám `Đang triển khai`. Chấm cạnh nhau thì người thứ ba sẽ
thấy hai chú giải khác chữ. **Nên thống nhất về đúng chữ của app**, không chặn.

**Plan sửa lại mục 5 của đặc tả** để người sau không đọc đặc tả rồi "sửa" ngược lại thành sai.

**TRẢ LỜI LUÔN CHỖ CÒN MƠ HỒ CỦA ĐẶC TẢ V4b** (ngưỡng Quá hạn, Plan chưa đo): chỉ có **một** ngưỡng,
`OD_ALERT_DAYS = 14` ở `src/lib/filter.ts:34`, và app chia **hai bậc** ở `filter.ts:138`
(`>= 14` → bậc A, `> 0` → bậc B, còn lại C). V4b tô đúng hai bậc đó và **không** tự chế thang màu
liên tục — đúng. Không có ngưỡng thứ hai nào để phải hỏi lại.

**V4b CHƯA CÓ PHÁN QUYẾT.** Phần trên là soi đặc tả và soi ba chỗ Plan hỏi, **không phải** phán quyết
cho `a914b2f`. V4b cần một lượt Review riêng: nó thêm 143 dòng vào `exportTableXlsx`, có bảng màu
chép tay, có định dạng điều kiện, có `pageSetup`. Tôi chưa chạy lại gì trên commit đó.

---

### BỐN ĐIỀU KIỆN — áp cho cả hai bản

**ĐK1 · Deploy phải xuất phát từ CÂY SẠCH ở commit đã có phán quyết. Đây là điều kiện chặn thật.**

*Cập nhật cuối 28/09:* lúc tôi viết điều kiện này, 154 dòng V4b đang nằm trong cây chưa commit. Thực
thi **đã commit chúng** thành `a914b2f`, và commit đó **chỉ gồm 4 đường dẫn code/test** — không kéo
theo mục ④ tôi đang viết. Làm đúng luật 5.6 và L12.

Nên lỗ hổng "deploy dựng từ cây bẩn" đã đóng. Nhưng điều kiện **vẫn còn**, chỉ đổi lý do:

- `a914b2f` (V4b) **chưa có phán quyết Review nào.** Deploy `main` lúc này là đưa V4b lên production
  không qua cửa cuối. Phán quyết ở mục này chỉ phủ `40eae6c` và `c188f92`+`8763e2a`.
- V2b **không nằm trong đường đó**: nó ở `40eae6c`, độc lập hoàn toàn với V4 (không chung file, không
  chung đường gọi). Muốn deploy V2b một mình thì deploy từ một commit không chứa V4b, hoặc chờ V4b
  có phán quyết rồi lên cả ba.

Ai bấm deploy: `git status --short` phải trống ở `src/`, **và** commit đang deploy phải là commit có
phán quyết trong mục này.

**ĐK2 · Dọn phép kiểm đang đỏ trước khi bấm deploy.** Không phải vì nó liên quan hai bản này — nó
không liên quan. Mà vì deploy trong lúc bộ kiểm đỏ là **tự bỏ lưới an toàn**: lần sau ai chạy
`vitest` cũng thấy một phép đỏ và sẽ học cách bỏ qua nó. Box Test kia cần **hoàn thành hoặc hoàn
tác** bản sửa `tests/matrix-reader.test.ts` đang dở (`wbChung` chưa khai). Tôi **không sửa** —
không phải việc của Review, và đó là việc đang làm dở của người khác.

**ĐK3 · V2b: chạy bảng ba nhánh NGAY SAU deploy, đừng đợi hết ngày.** Đây là chỗ không ai kiểm được
từ máy: `crypto.subtle` trên Workers. Bảng ba nhánh ở cuối mục ① là đường đỡ đúng chỗ, và nó **đủ
đỡ** — nó phân biệt được cả ba trường hợp (băm chạy / băm rỗng / dòng đếm mất hẳn) bằng một câu SQL.
Thêm một điều cụ thể: câu kiểm phải bao gồm `SELECT COUNT(*) FROM kv_write WHERE bam IS NULL AND
ts >= <ngày deploy>`. Nếu con số đó **lớn hơn 0**, nghĩa là đường lùi hai cột đang chạy — tức
`crypto.subtle` hoặc cột `bam` có vấn đề, và cái băm đang im lặng không có. Không hỏi câu đó thì
hỏng kiểu đó **không phát ra tiếng nào**, đúng họ hàng L3 mà Plan đã lo.

**ĐK4 · V4a: mở file xuất ra bằng Excel thật, đúng một lần.** Thực thi đã tự khai đây là chỗ họ
không làm được (mục ② số 5) và họ khai đúng. Mọi kết luận — của Thực thi, của Test, và của tôi —
đều đọc XML trong file `.xlsx` chứ không mở Excel. Chuẩn OOXML nói ô mang `numFmtId` trỏ `dd/mm/yy`
sẽ hiện ra thế, và tôi tin, nhưng **một lần mở thật** là rẻ hơn nhiều so với gửi cho Ban điều hành
một file hiện `########`. Việc cần làm đúng ba thứ: bấm sắp xếp cột "Ngày kết thúc" xem có ra đúng
thứ tự thời gian, bôi đen cột "Quá hạn" xem thanh dưới có hiện Sum, và bấm dấu `+` ở lề trái xem
nhóm có xổ ra.

**THỨ TỰ — đã cập nhật sau khi Plan chốt `baef39b`.**

Plan vừa chốt *"không deploy V4a một mình, ghép với V4b rồi lên một lần"*, vì V4a sửa một thứ đang
sai nhưng người dùng mở file ra gần như không thấy khác. Tôi soi V4a về mặt **kỹ thuật** và nó lành;
việc nó có đủ để xuất hiện trước người dùng một mình hay không là **quyết định của Plan và người
dùng**, không phải của Review. Phán quyết ĐẠT KÈM ĐIỀU KIỆN của tôi cho V4a **giữ nguyên** — nó nói
code này an toàn để lên, không nói nó nên lên lúc nào.

Hệ quả gộp lại:

1. **V2b lên trước, một mình, được.** Nó độc lập hoàn toàn với V4: không chung file, không chung
   đường. Deploy nó không phải chờ V4b. Cần ĐK1 (cây sạch) + ĐK2 (bộ kiểm xanh) + ĐK3.
2. **V4a chờ V4b.** Quyết định của Plan làm ĐK1 chỉ còn **một đường**: V4b đi trọn dây chuyền, rồi
   lên cùng V4a. Không còn phải stash gì nữa — nhưng lúc đó **V4b phải có phán quyết Review riêng**,
   và 154 dòng đang nằm trong cây hôm nay **chưa có**.
3. **ĐK4 (mở bằng Excel thật) dịch sang buổi deploy V4a+V4b**, và lúc đó đáng làm gộp một lần: V4b
   sinh ra để sửa phần nhìn, nên dù sao cũng phải mở Excel thật mới nghiệm thu được nó.

---

## ⑤ BÀI HỌC MỚI

**Vòng V2b + V4a (28/09) — REVIEW đã thêm `L15` vào NEN-TANG.md phần 4** — *`tsc` không phủ
`tests/`, nên "tsc sạch" chưa bao giờ nói gì về file kiểm.* Có ngày, có con số, có chỗ nó vừa để lọt
thật (`wbChung` không tồn tại mà `tsc` exit 0).

**Và đã ghim một chỗ TRỐNG ở `L14`.** Commit `40eae6c` ghi *"xem L14"* nhưng mục đó **chưa bao giờ
được viết**. Nội dung thì đọc được từ chính thông điệp commit — *chốt bằng số lượt `put`, không chốt
bằng dấu vết gián tiếp* — nhưng tôi không viết hộ: người viết dòng ấy biết chuyện gì đã xảy ra, tôi
chỉ biết nó được nhắc tới. Tôi đã đánh dấu `L14` là **chưa viết, đừng ai lấy số đó**, và mục của tôi
lấy `L15`. Việc này đúng thứ luật 5.4 dựng ra để chặn: mã lỗi trong ghi chú mà trỏ vào chỗ trống thì
người sau đi tìm không thấy gì, rồi "dọn dẹp" đoạn code kèm nó.

Chỗ đáng nhớ nhất của lượt Review này không phải hai bản code — cả hai đều lành. Nó là chuyện
**cùng một phép kiểm, cùng một commit, ba máy ra ba kết quả**: `findMatrixSheets` chạy 1.263 ms trên
máy này, 5.943 ms ở Plan, 8.352 ms ở Thực thi. Cả ba báo trung thực. Không ai sai. Nhưng nếu chỉ một
người đo rồi kết luận "có gì đó vừa chậm đi", cả đội sẽ đi tìm một nguyên nhân không tồn tại. Phép
kiểm nào đọc file thật thì thời gian của nó **không phải một hằng số** — đừng chốt mốc sát, và đừng
đọc một lần đo như một sự thật.

---

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
