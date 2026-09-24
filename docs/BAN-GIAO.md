# SỔ BÀN GIAO

Bốn box nói chuyện với nhau qua đúng file này.

**Luật dùng sổ:**
- Mỗi box **đọc từ đầu sổ** trước khi làm, để biết chuyện đã tới đâu
- Chỉ **ghi thêm** phần của mình, **không sửa, không xoá** phần của box khác
- Một việc xong thì chuyển cả khối xuống `docs/BAN-GIAO-CU.md` và dọn sổ này cho việc mới
- Nền tảng chung (con số, luật, sổ lỗi) nằm ở `docs/NEN-TANG.md`, **không chép lại vào đây**

---

# VIỆC ĐANG LÀM

**V2b · Đo cho ra vì sao danh sách MTLĐ bị ghi 63 lần/ngày, rồi mới sửa**
Plan mở 24/09/2026. **V2 đã chết** — xem "V2 SAI Ở ĐÂU" cuối mục ①. Không ai được làm theo V2 nữa.

*Hàng đợi:* V1 (dọn 14 byte điều khiển vô hình) — đặc tả ở `git show 19e81d4`, **cần sửa hai chỗ** trước khi giao lại: ghim theo nội dung thay vì số dòng, và mốc test là **358 passed | 2 expected fail | 27 file** chứ không phải 346.

---

## ① PLAN

**VIỆC**
Thêm **mã băm ngắn của payload** vào bảng D1 `kv_write`, chạy thật một ngày, để biết 63 lượt ghi kia là **63 payload khác nhau** hay **một payload ghi 63 lần**. Chưa sửa gì hết.

**VÌ SAO CẦN**
Plan đã đoán sai hai lần liên tiếp về chính con số này. Lần một: "mỗi người mở là một lượt" - sai, thực tế một lượt mỗi khoá mỗi ngày. Lần hai: "thứ tự mảng đổi nên lớp chặn không khớp" - sai, Thực thi truy ra `parser.ts` không sort items, thứ tự là thứ tự dòng trong file, tất định với cùng một file.

Đoán lần thứ ba mà không có số là đúng cách làm ra **L10**. Dừng đoán.

D1 đang dùng ~650 trên trần 100.000 dòng/ngày, tức **0,65%**. Thêm một cột băm không đụng gì tới trần KV.

**LÀM XONG THÌ NHÌN THẤY GÌ**
Người dùng **không thấy gì cả**. Đây là việc gắn đồng hồ đo, không phải việc sửa.

**PHẠM VI**
- Trong: `src/lib/kv-dem.ts` - thêm mã băm ngắn của payload vào dòng ghi D1. Cần thêm cột thì thêm.
- NGOÀI: **không sửa** `putNeuKhac`, **không sửa** `dedupInstall`, **không sắp xếp** `named`, không đụng `sfile`/`spdf2`/`sheetsnap`, không đổi hành vi nào của app.

**DÙNG CHUNG - CODE NÀO BỊ ĐỤNG TỚI**
`demGhiKv` được gọi từ **mọi** đường ghi KV. Hỏng nó là hỏng cả bảng đếm, mà bảng đếm là thứ duy nhất đang soi được hạn mức. Băm phải **rẻ và không bao giờ ném lỗi** - băm hỏng thì bỏ qua, tuyệt đối không được làm hỏng lượt ghi thật.

**RÀNG BUỘC**
1. Băm là **một chiều và ngắn** (8-12 ký tự hex là đủ). **Không** ghi nguyên payload vào D1 - trong đó có tên dự án và dữ liệu nội bộ.
2. Băm lỗi → ghi chuỗi rỗng, **không ném**, không chặn lượt ghi KV.
3. Không thêm lượt ghi **KV** nào. D1 thì được.
4. Không đổi bất kỳ hành vi nào người dùng thấy được.

**ĐÃ ĐO TRƯỚC** (Plan 24/09/2026, đã tự kiểm lại từng chỗ Thực thi chỉ ra)
```
23/09 : write 651/1.000 = 65% · kho mtld 63 luot vao DUNG MOT khoa
dedupInstall (app-shell.tsx:231) : GIU PHAN TU DAU, chu ky fileId|gid|formKey
                                   -> KHONG co danh tinh du an trong chu ky
parser.ts : dung MOT phep .sort, o dong 1058, dung de in chan doan. KHONG sort items.
putNeuKhac (mtld-install:231) : try/catch nuot loi doc roi ROI XUONG put -> doc hong = ghi thua
D1 kv_write : ~650 dong/ngay tren tran 100.000 = 0,65%
```

**CHỖ CÒN MƠ HỒ**
Ba hướng Thực thi nêu, **chưa hướng nào được chứng minh**:
- (a) `putNeuKhac` ghi mỗi khi đọc KV chập chờn
- (b) `sheetViews` đổi thật (PMO sửa link trong ngày)
- (c) payload khác nhau giữa người dùng, vì mỗi máy parse từ bản cache nguồn khác nhau rồi đè lẫn nhau

Mã băm phân biệt được cả ba: băm **giống nhau** cả 63 lượt → hướng (a). Băm **đổi vài lần** → hướng (b). Băm **nhảy qua lại giữa vài giá trị** → hướng (c).

**CÁCH BIẾT LÀ ĐÚNG**
1. Sau một ngày chạy thật, câu lệnh này trả lời được ngay:
   ```
   SELECT kho, bam, COUNT(*) n FROM kv_write
   WHERE substr(ts,1,10)='<ngày>' AND kho='mtld' GROUP BY 1,2 ORDER BY 3 DESC
   ```
2. Số lượt ghi KV mỗi ngày **không tăng** so với trước khi gắn đồng hồ.
3. `tsc` sạch · `vitest` **358 passed | 2 expected fail | 27 file** (mốc hiện tại, không phải 346).
4. Phép kiểm: băm ném lỗi thì `demGhiKv` **vẫn chạy trọn** và lượt ghi KV vẫn đi qua. Chốt bằng **số lượt `put`** - xem L14.

**VIỆC NÀY CẦN DEPLOY MỚI CÓ SỐ.** Test soi → Review phán → người dùng bấm deploy → chờ một ngày → Plan đọc số → mới ra được việc sửa thật.

---

**V2 SAI Ở ĐÂU - giữ lại để không ai đi lại đường cũ**

V2 định sắp xếp mảng `named` cho ổn định trước khi lưu. Thực thi trả về kèm bằng chứng, Plan đã tự kiểm lại từng chỗ và **xác nhận Thực thi đúng cả ba**:

1. **Sắp xếp sẽ ĐỔI CHỮ TRÊN GIAO DIỆN.** `dedupInstall` giữ **phần tử đầu tiên**, chữ ký gộp là `fileId|gid|formKey` - **không có danh tính dự án**. Nhiều dự án gắn chung một ma trận thì phần tử nào đứng trước, tên/mã CT/vùng của dự án đó thắng và hiện lên thẻ MTLĐ. Đổi thứ tự = đổi dự án thắng. Đúng **L11**: sửa một chỗ làm gãy chỗ khác mà không đụng vào nó, diff sạch, test xanh, giao diện vẫn sai. Ba chỗ khác cũng giữ-cái-đầu: `mtld-v2-app.tsx:43`, `perf-chart-app.tsx:613`.
2. **Sắp xếp cũng chẳng cắt được gì.** `parser.ts` không sort items, vòng lặp ở `index.tsx:2488` tất định, hai bộ `seenKey`/`seenSig` đều giữ-cái-đầu. Thứ tự `named` = thứ tự dòng trong file Master Plan, **ổn định với cùng một file**. Nó chỉ đổi khi PMO chèn/đổi dòng - vài lần một ngày là cùng, không phải 63.
3. Tức là V2 **trả giá ở mục 1 mà không thu được gì ở mục 2**.

Plan nhận lỗi: đã ghi "thứ tự đổi nên lớp chặn không khớp" mà **không đi đọc `parser.ts` để kiểm**. Đó đúng là thứ mục ĐÃ ĐO TRƯỚC sinh ra để chặn.

---

**BẪY KHI ĐỌC CODE NÀY** (Thực thi phát hiện, Plan xác nhận)
`grep` coi `can-media-app.tsx` và `index.tsx` là **"Binary file"** vì chúng chứa byte NUL - đúng 14 byte của việc V1. `grep` thường **không in ra gì** trong hai file đó. Phải dùng `grep -a`. Đây là một lý do nữa để làm V1.

---







---

## ② THỰC THI

**ĐÃ LÀM — KHÔNG VIẾT DÒNG CODE NÀO. TRẢ VỀ ① PLAN.**

Đặc tả giao đúng cho tôi một việc tự kiểm chứng: *"tự đi tìm MỌI chỗ đọc `mtld:install:list:v2` và
xác nhận không chỗ nào phụ thuộc thứ tự. Đừng tin lời Plan. Thấy có thì báo lại."*

Đã đi kiểm. **Ba trên bốn chỗ đọc đều phụ thuộc thứ tự**, và riêng cái cớ để sắp xếp thì không đứng
được. Nên tôi dừng trước khi gõ, đúng câu dặn.

Việc duy nhất đã đụng tới cây: **thu hồi bản V2 cũ** (`sfile`/`spdf2`) theo lệnh Plan —
`git revert 81b0ec4` → commit `6de4432`. Mã cũ vẫn nằm nguyên trong lịch sử ở `81b0ec4`, lấy lại
được bất cứ lúc nào nếu sau này muốn.

**LỖI TRONG ĐẶC TẢ — MỨC: CHẶN**

**① · `dedupInstall()` KHÔNG "gộp và sắp lại". Nó GIỮ PHẦN TỬ ĐẦU TIÊN.**

`app-shell.tsx:229`:

```ts
for (const p of arr) { const sig = `${p.fileId}|${p.gid || ""}|${p.formKey || ""}`;
                       if (seen.has(sig)) continue; seen.add(sig); out.push(p); }
```

Chữ ký gộp là `fileId|gid|formKey` — **không có danh tính dự án trong đó**. Mà chính ghi chú ở
`index.tsx:2496-2499` nói rõ **nhiều dự án khác nhau vẫn gắn chung một ma trận**, và mảng `named`
cố ý giữ đủ từng dự án (khoá theo ID cứng ở dòng 2500).

Nên với một ma trận dùng chung, **phần tử nào đứng trước thì dự án đó thắng**, và `name`, `maCT`,
`region`, `groupDA` hiện trên thẻ MTLĐ là của dự án thắng. Đổi thứ tự = đổi dự án thắng = **đổi
chữ trên giao diện**. Thẻ đó còn được `app-shell.tsx:380` gom theo `region`, nên đổi cả nhóm vùng.

Đây đúng là họ **L11**: sửa một chỗ làm gãy chỗ khác mà không đụng vào chỗ đó, diff sạch, test xanh,
giao diện vẫn sai.

**② · Hai chỗ đọc khác cũng giữ-cái-đầu-tiên.**

| Chỗ đọc | Khoá gộp | Phụ thuộc thứ tự? |
|---|---|---|
| `app-shell.tsx:229` `dedupInstall` | `fileId\|gid\|formKey` | **CÓ** — thô hơn danh tính dự án |
| `mtld-v2-app.tsx:43` `pid` | `fileId\|gid\|formKey` | **CÓ** — y hệt. Có `.sort` theo tên nhưng sắp **SAU** khi đã gộp, nên chỉ sửa thứ tự hiện ra, không sửa việc ai thắng |
| `perf-chart-app.tsx:613` `regionMap` | tên dự án chuẩn hoá | **CÓ** — `if (n && !m[n]) m[n] = r` là first-wins. Có `Object.assign` đè bằng `proj:regions` phía sau nên chỉ là đường lùi, nhưng vẫn phụ thuộc thứ tự |
| `can-media-app.tsx:107` | `fileId\|gid\|name` | không — khoá có tên dự án, lại còn sắp lại sau |

*Bẫy khi đi kiểm:* `grep` coi `can-media-app.tsx` và `index.tsx` là **"Binary file"** vì trong đó có
byte NUL (đúng 14 byte của việc V1). Phải `grep -a` mới thấy. Test đã ghi bẫy này ở đặc tả V1 — nó
cắn thật.

**③ · Cái cớ để sắp xếp không đứng được: thứ tự không có nguồn nào làm nó đổi.**

Đặc tả nói *"mảng `named` được dựng theo thứ tự duyệt `data.items`, thứ tự đổi thì chuỗi đổi"*. Đã
truy: `data.items` dựng bằng cách đẩy từng dòng khi đi qua sheet (`parser.ts:560`), và **trong cả
`parser.ts` không có một phép `.sort` nào trên `items`** — phép sort duy nhất là trên `ridTrung`
dòng 1058, dùng để in câu chẩn đoán. Vòng lặp ở `index.tsx:2488` cũng tất định, hai bộ `seenKey`
/`seenSig` đều là giữ-cái-đầu.

Nghĩa là thứ tự `named` = **thứ tự dòng trong file Master Plan**, ổn định với cùng một file. Nó chỉ
đổi khi PMO chèn/dời dòng — tức vài lần một ngày là cùng, không phải 63.

Hệ quả: sắp xếp gần như **không cắt được lượt ghi nào**, mà vẫn phải trả giá ở mục ① và ②. Đổi một
hành vi đang tất định lấy một hành vi tất định khác, không kèm lợi ích đo được.

**VẬY 63 LƯỢT/NGÀY TỪ ĐÂU RA — ba hướng nên đào, tôi chưa chứng minh được cái nào**

1. `putNeuKhac` **ghi khi đọc hỏng**: `try { if ((await kv.get(key)) === giaTri) return false; } catch {}`.
   Mà `bocKv` đã nuốt lỗi đọc và trả `null` rồi, nên `null === giaTri` là sai → **ghi**. Mỗi lượt đọc
   chập chờn là một lượt ghi thừa, im lặng.
2. **Nội dung đổi thật** vì `sheetViews` (nguồn của `cfg`) là kho PMO sửa được — cần biết ngày 23/09
   PMO có sửa link nhiều không.
3. Effect có `dangTaiKho` trong dep array, nên nó chạy lại mỗi lần `useIsFetching()` về 0. Nếu có
   nhịp nào đó cho ra payload khác nhau giữa hai lần về 0 thì mỗi nhịp là một lượt ghi.

**Cách chốt rẻ nhất, đề nghị Plan quyết:** ghi thêm **mã băm ngắn của payload** vào bảng D1 `kv_write`
cạnh tên kho. D1 còn 99% hạn mức (100.000 lượt/ngày, đang dùng ~650) nên không đụng gì tới trần KV.
Một ngày sau là biết ngay 63 lượt đó là 63 payload khác nhau hay 1 payload ghi 63 lần — và câu trả
lời đó chỉ đúng một trong ba hướng trên. Đoán tiếp mà không có số là cách làm ra **L10**.

**ĐÃ ĐO**
```
tsc                   : sạch (sau khi revert)
vitest                : 358 passed | 2 expected fail | 27 file — đúng mốc nền Test đo 21/09
build                 : không chạy lại — không có thay đổi code nào để dựng
quét byte điều khiển  : 16 byte · 7 file — đúng mốc nền, không đổi
kiểm trên app         : không áp dụng — không có thay đổi nào để nhìn
ghi KV thêm mỗi lần mở app : 0 (không đụng gì)
cổng demo             : CÓ SẴN ở index.tsx:2482, tôi không đụng
cổng đang tải         : CÓ SẴN ở index.tsx:2483, tôi không đụng
```

Lưu ý mốc nghiệm thu: tiêu chí 5 của ① ghi `vitest 346 passed (+1 = 347)`. **346 là mốc cũ**, đo
trước khi Test thêm `tests/chu-gach-ngang-ranh-gioi.test.ts` vào cây. Mốc đúng bây giờ là
**358 passed | 2 expected fail | 27 file**. Ai cầm 346 đi đối chiếu sẽ tưởng có 12 test lạ.

**CHỖ TÔI KHÔNG CHẮC**

1. **Tôi không chứng minh được thứ tự KHÔNG BAO GIỜ đổi** — chỉ chứng minh được là trong đường code
   đã đọc thì không có chỗ nào làm nó đổi. Còn `data` có thể bị lọc/sắp ở tầng trên mà tôi chưa soi
   hết. Nếu Plan có bằng chứng thật rằng payload đổi thứ tự (ví dụ hai bản JSON chụp ở hai thời
   điểm), thì đưa ra, tôi làm ngay.
2. **Mức nghiêm trọng của mục ① tuỳ vào việc thực tế có bao nhiêu ma trận dùng chung.** Nếu gần như
   không có dự án nào gắn chung ma trận thì sắp xếp gần như vô hại. Tôi không đo được con số này vì
   nó nằm trong dữ liệu thật (`sheetViews` trên KV). **Đây là số Plan nên đo trước khi quyết.**
3. Tôi **chưa đụng** tới hướng sửa `putNeuKhac` cho nó khỏi ghi khi đọc hỏng, dù tôi nghi hướng đó.
   Đặc tả ghi rõ NGOÀI phạm vi: "không đổi `putNeuKhac`". Không tự mở rộng.

**CHƯA LÀM**

- **Toàn bộ phần sửa code của V2 mới.** Lý do ở trên. Chờ Plan quyết một trong ba đường:
  (a) đo mã băm payload rồi quay lại; (b) đổi khoá gộp của `dedupInstall`/`pid` cho có danh tính dự
  án — nhưng đó là **đổi hành vi hiển thị**, phải hỏi người dùng chứ không phải việc của hai chúng
  ta; (c) bỏ V2, quay sang V1 đang nằm trong hàng đợi.
- Không deploy. Không đụng file nào của box Test.

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
