# SỔ BÀN GIAO

Bốn box nói chuyện với nhau qua đúng file này.

**Luật dùng sổ:**
- Mỗi box **đọc từ đầu sổ** trước khi làm, để biết chuyện đã tới đâu
- Chỉ **ghi thêm** phần của mình, **không sửa, không xoá** phần của box khác
- Một việc xong thì chuyển cả khối xuống `docs/BAN-GIAO-CU.md` và dọn sổ này cho việc mới
- Nền tảng chung (con số, luật, sổ lỗi) nằm ở `docs/NEN-TANG.md`, **không chép lại vào đây**

---

# VIỆC ĐANG LÀM

**V2 · Hết ghi lại danh sách MTLĐ khi nó không đổi**
Plan mở 24/09/2026. **Viết lại lần 2** — bản đầu có lý do sai, xem mục "ĐÃ SỬA LẠI" cuối mục ①.

*Hàng đợi:* V1 (dọn 14 byte điều khiển vô hình) — đặc tả xong, xem `git show 19e81d4`.

---

## ① PLAN

**VIỆC**
Danh sách dự án có ma trận (`mtld:install:list:v2`) đang bị ghi đè khoảng 63 lần mỗi ngày dù nội dung không đổi. Chỉ ghi khi danh sách thật sự đổi.

**VÌ SAO CẦN**
Đo 23/09/2026: **651 lượt ghi / trần 1.000 = 65%**, đang leo (477 → 551 → 461 → 651).

Kho `mtld` ăn **63 lượt, tất cả dồn vào ĐÚNG MỘT khoá**. Danh sách dự án có ma trận thì mấy khi đổi, nên gần như toàn bộ 63 lượt là ghi thừa.

Code **đã có** lớp chặn `putNeuKhac` (`mtld-install.functions.ts:230`) nhưng nó so bằng `JSON.stringify`. Mảng `named` được dựng theo **thứ tự duyệt `data.items`** (`index.tsx` ~2508), thứ tự đổi thì chuỗi đổi, lớp chặn coi là khác nên vẫn ghi. Cùng một tập dự án, chỉ khác thứ tự.

**LÀM XONG THÌ NHÌN THẤY GÌ**
Người dùng **không thấy gì khác**. MTLĐ vẫn đủ dự án, vẫn đúng thứ tự hiển thị.

**PHẠM VI**
- Trong: chỗ dựng mảng `named` trong `src/routes/index.tsx` (~2508) — sắp xếp theo khoá ổn định trước khi gọi `saveInstallList`.
- NGOÀI: **không** đụng `sfile`, **không** đụng `spdf2`, **không** đụng `sheetsnap`, không đổi `lastRefreshBoundary`, không đụng warmer, không đổi `putNeuKhac`.

**DÙNG CHUNG - CODE NÀO BỊ ĐỤNG TỚI**
`mtld:install:list:v2` được **đọc** ở app MTLĐ và ở app Hình ảnh. Thực thi phải tự tìm **mọi** chỗ đọc khoá này và xác nhận **không chỗ nào phụ thuộc thứ tự phần tử**. Theo chú thích trong code thì MTLĐ tự gộp lại bằng `dedupInstall()` lúc render, nhưng **đừng tin lời Plan, đi kiểm**. Thấy chỗ nào phụ thuộc thứ tự thì **báo Plan**.

**RÀNG BUỘC**
1. Sắp xếp phải **ổn định và không phụ thuộc dữ liệu biến động** — đừng sắp theo ngày, %, hay trạng thái.
2. Nội dung danh sách **không đổi một phần tử nào**, chỉ đổi thứ tự.
3. Danh sách thật sự đổi (thêm/bớt dự án, đổi vùng gắn link) thì **vẫn phải ghi**.
4. Không thêm đường ghi KV mới.

**ĐÃ ĐO TRƯỚC** (Plan đo 24/09/2026)
```
Cloudflare GraphQL 23/09 UTC : write 651/1.000 = 65% · read 5.366/100.000 = 5% · list 4
24/09 luc 01h47 UTC          : write 2 · read 34 -- khong phai dang chay nuoc rut
Han muc reset                : 00:00 UTC = 07:00 gio Viet Nam
D1 kv_write 23/09 theo kho   : sfile 137 · media 93 · sheetsnap 79 · spdf2 73 · mtld 63
                               fmeta 52 · completed 45 · mpflag 43 · itemfp 30 · sheetview 25
                               tong 646 (khop 651 cua Cloudflare)
Muc tieu cua V2              : chi kho mtld = 63
```

**CHỖ CÒN MƠ HỒ**
Chọn khoá sắp xếp nào (`hid` / `maCT` / `fileId`) là việc của Thực thi — nhưng phải **nói rõ vì sao chọn**, và khoá đó phải có ở mọi phần tử. `hid` là ID cứng nhưng **có thể trống** (`hid?`), nên cần khoá dự phòng.

**CÁCH BIẾT LÀ ĐÚNG**
1. Phép kiểm mới: giả lập `kv` đếm số lần `put`; gọi `saveInstallList` hai lần với **cùng tập dự án nhưng đảo thứ tự** → `put` đúng **1** lần. Phải **đỏ trên bản chưa sửa**.
2. Gắn thêm một dự án mới vào ma trận → **vẫn ghi**. Đây là phép kiểm quan trọng nhất: tiết kiệm mà làm danh sách đứng yên thì **MTLĐ mất dự án**.
3. Mở app bằng hai tài khoản khác nhau → kho `mtld` tăng **0** ở lần thứ hai.
4. Đo lại hôm sau: `mtld` từ 63 xuống **dưới 5**.
5. `tsc` sạch · `vitest` 346 passed (+1 phép mới = 347).

**HẠN MỨC**
Việc này **giảm** lượt ghi. Đo trước và sau, ghi cả hai số vào mục ②.

---

**ĐÃ SỬA LẠI - bản đặc tả đầu tiên sai ở đâu**

Bản đầu (commit `ede1d05`) viết rằng `sfile`/`spdf2` ghi thừa vì "mỗi người mở là một lượt". **Sai.** Người dùng nhớ ra cơ chế thật và Plan kiểm lại thì đúng như người dùng nói:

Mốc quét là **17:30 giờ VN** (`REFRESH_HOUR_VN`/`REFRESH_MIN_VN`, dòng 116-117), khớp cron warmer. Qua mốc đó cache mới thành cũ; ai mở file đầu tiên sau mốc thì làm mới **một lần rồi thôi cả ngày**. Số liệu theo giờ khớp: 17h VN `sfile` 35 (warmer), rồi đợt sáng hôm sau 08h/09h/10h/11h = 5/29/17/8. **Đúng thiết kế, không phải lỗi.** 137 lượt ≈ số khoá cache khác nhau được đụng trong ngày.

Nặng hơn: ràng buộc "bỏ ghi thì `ts` đứng yên, chấp nhận" là đánh đổi **tệ**. Hiện làm mới 1 lần/ngày; bỏ ghi thì app đi kiểm lại **mỗi lần mở** — đổi một lượt ghi lấy hàng chục lượt tải Drive, đúng hướng **L9** (cron chết vì quá 2.010.000 µs).

Muốn tiết kiệm ở `sfile`/`spdf2` thì phải **hỏi Drive xem file có đổi không trước khi tải**. Đó là việc khác, cần đo riêng, **không gộp vào V2**.

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
