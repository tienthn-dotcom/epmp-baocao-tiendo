# SỔ BÀN GIAO

Bốn box nói chuyện với nhau qua đúng file này.

**Luật dùng sổ:**
- Mỗi box **đọc từ đầu sổ** trước khi làm, để biết chuyện đã tới đâu
- Chỉ **ghi thêm** phần của mình, **không sửa, không xoá** phần của box khác
- Một việc xong thì chuyển cả khối xuống `docs/BAN-GIAO-CU.md` và dọn sổ này cho việc mới
- Nền tảng chung (con số, luật, sổ lỗi) nằm ở `docs/NEN-TANG.md`, **không chép lại vào đây**

---

# VIỆC ĐANG LÀM

**V2 · Đừng ghi lại vào KV khi nội dung không đổi**
Plan mở 24/09/2026. Ưu tiên trên V1 vì đụng hạn mức đang leo.

*Hàng đợi:* V1 (dọn 14 byte điều khiển vô hình) — đặc tả đã xong, xem `git show 19e81d4`. Làm sau V2.

---

## ① PLAN

**VIỆC**
Ba kho `sfile`, `spdf2`, `sheetsnap` đang ghi đè vào KV **kể cả khi nội dung giống hệt bản đã có**. Chỉ ghi khi nội dung thật sự đổi.

**VÌ SAO CẦN**
Đo ngày 23/09/2026: **651 lượt ghi / trần 1.000 = 65%**, và đang leo (17/09: 477 · 21/09: 551 · 22/09: 461 · 23/09: 651). Ba kho này chiếm **289 lượt, tức 45% cả ngày**.

Ba kho luôn đi cùng nhau theo tỉ lệ gần như cố định 2:1:1 mỗi giờ (02h 29/16/15 · 03h 17/9/10 · 10h 35/19/18) - dấu hiệu rõ là **một thao tác mở file đẻ ra bốn lượt ghi**.

Cơ chế hiện tại: cache ghim theo ngày. Ai mở file lần đầu sau mốc `lastRefreshBoundary` thì app tải lại từ Drive ở nền rồi ghi đè KV. **File không đổi vẫn tốn một lượt ghi, và mỗi người mở là một lượt.**

**LÀM XONG THÌ NHÌN THẤY GÌ**
Người dùng **không thấy gì khác**. Cùng tốc độ, cùng dữ liệu. Chỉ số lượt ghi giảm.

**PHẠM VI**
- Trong: `src/lib/mtld-install.functions.ts` - `refreshAndStore` (dòng 141-172, cái `kv.put` ở **dòng 164**) và đường `spdf2` (khối `getSheetPdf`, `kv.put` trong `.then()` ở **dòng ~331**).
- NGOÀI: không đụng `sheetsnap` ở `edits.functions.ts:1416` - đó là đường PMO **chủ động lưu**, ghi là đúng. Không đổi `CACHE_TTL_S`, không đổi `lastRefreshBoundary`, không đụng warmer, không đụng `sfile:index`, không gộp ba kho lại.

**DÙNG CHUNG - CODE NÀO BỊ ĐỤNG TỚI**
- `refreshAndStore` được gọi từ **hai** chỗ: nhánh làm mới ở nền (dòng ~288) và nhánh cache trượt (dòng ~295). Nhánh thứ hai **chưa có bản cũ để so** - phải xử lý, đừng để nó thành không bao giờ ghi.
- `lastRefreshBoundary` dùng chung cho cả `sfile` lẫn `spdf2`. Đổi cách hiểu mốc này là đụng cả hai.
- `getWaitUntil` chạy việc ở nền: bỏ ghi thì việc nền **vẫn tải Drive**, chỉ không ghi. Đó là chủ ý, nhưng phải canh CPU - xem L9, cron từng chết vì quá 2.010.000 µs.

**RÀNG BUỘC**
1. So sánh trên **nội dung b64**, không so trên `ts`. Giống nhau thì **không `put`**.
2. Nội dung ĐỔI thì ghi như cũ, kèm `ts` mới.
3. Không có bản cũ trong tay (cache trượt, lần đầu) thì **cứ ghi** - thà thừa một lượt còn hơn mất cache.
4. Bỏ ghi thì `ts` đứng yên, nên lần mở sau lại kích hoạt làm mới nền. Chấp nhận: lượt ghi là thứ hiếm (1.000), còn gọi Drive thì không tính hạn mức. **Nhưng** phải chặn tải lặp trong cùng một isolate bằng một `Map` ở tầng module, nhớ trong khoảng 10 phút - rẻ, không tốn KV.
5. Không thêm bất kỳ đường ghi KV mới nào, kể cả để lưu mã băm.

**ĐÃ ĐO TRƯỚC** (Plan đo 24/09/2026)
```
Cloudflare GraphQL, 23/09 UTC : write 651/1.000 = 65% · read 5.366/100.000 = 5% · list 4
Hom nay 24/09 luc 01h47 UTC   : write 2 · read 34   -- KHONG phai dang chay nuoc rut
Bay ve mui gio                : han muc reset 00:00 UTC = 07:00 gio Viet Nam
D1 kv_write 23/09, theo kho   : sfile 137 · media 93 · sheetsnap 79 · spdf2 73 · mtld 63
                                fmeta 52 · completed 45 · mpflag 43 · itemfp 30 · sheetview 25
                                tong 646 (khop voi 651 cua Cloudflare)
Ba kho muc tieu               : 289 = 45% ca ngay
```

**CHỖ CÒN MƠ HỒ**
Nhánh cache trượt ở dòng ~295 gọi `refreshAndStore` mà không có bản cũ. Ràng buộc 3 nói cứ ghi. Nếu Thực thi thấy lấy được bản cũ rẻ hơn thì **báo Plan**, đừng tự đổi luật.

**CÁCH BIẾT LÀ ĐÚNG**
1. Mở cùng một file hai lần bằng hai tài khoản khác nhau, sau mốc làm mới → lượt ghi `sfile` tăng **0** ở lần thứ hai (trước: tăng 1).
2. Sửa thật file trên Drive rồi mở → **vẫn ghi**, và app hiện đúng dữ liệu mới. Đây là phép kiểm quan trọng nhất: tiết kiệm mà làm dữ liệu cũ đọng lại thì tệ hơn hẳn việc tốn lượt ghi.
3. Đo lại sau một ngày chạy thật:
   ```
   npx wrangler d1 execute pmo-audit --remote --command \
     "SELECT kho, COUNT(*) n FROM kv_write WHERE substr(ts,1,10)='<ngày>' GROUP BY 1 ORDER BY 2 DESC"
   ```
   Mong đợi: `sfile` + `spdf2` từ 210 xuống dưới 60. Tổng ngày từ ~650 xuống dưới 480.
4. `tsc` sạch · `vitest` 346 passed.
5. Phép kiểm mới cho luật "giống thì không ghi": giả lập `kv` đếm số lần `put`, gọi hai lần cùng nội dung → `put` đúng **1** lần; đổi nội dung → thành **2**. Phải đỏ trên bản chưa sửa.

**HẠN MỨC**
Đây là việc **giảm** lượt ghi. Không được thêm đường ghi nào. Đo trước và sau, ghi cả hai số vào mục ②.

---



---

## ② THỰC THI

**ĐÃ LÀM**
<sửa gì, ở file nào>

**VÌ SAO LÀM THẾ**
<quyết định nào có nhiều hơn một đường, và vì sao chọn đường này>

**ĐÃ ĐO**
```
tsc                   : sạch / lỗi
vitest                : <số> passed
build                 : qua / hỏng
quét byte điều khiển  : sạch / có
kiểm trên app         : <số cụ thể trước và sau, ở 1440px và 375px>
ghi KV thêm mỗi lần mở app : <số>
cổng demo             : có / KHÔNG CÓ
cổng đang tải         : có / KHÔNG CÓ
```

**CHỖ TÔI KHÔNG CHẮC**
<liệt kê thẳng. Đây là chỗ Review soi kỹ nhất. Để trống ở một việc không tầm thường là dấu hiệu xấu.>

**CHƯA LÀM**
<phần nào của đặc tả chưa đụng tới, và vì sao>

---

## ③ TEST

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

**TEST đã thêm `L13` vào NEN-TANG.md phần 4** — *Cái thước tự nó sai, và không ai đo lại cái thước.*

Và đã **sửa luôn lệnh quét ở NEN-TANG phần 6**, vì để nguyên thì cả bốn box vẫn đo bằng cái thước
hụt. Lệnh mới: nhận thư mục, tự đi vào trong, phủ đúng dải `0x00-0x08 · 0x0b · 0x0c · 0x0e-0x1f`,
in tên file · số dòng · mã byte. Chạy lên cây hiện tại ra **16 byte**, khớp từng dòng với phép đo
độc lập ở mục ③.

Đây là chỗ đáng nhớ nhất của lượt này: lỗi ① (Plan sót một file) **không phải Plan cẩu thả** - Plan
dùng đúng công cụ mà sổ nền tảng đưa cho, và công cụ đó mù với `0x11`. Sửa người thì hỏng lại,
sửa cái thước thì hết.
