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

**CỘT `bam` ĐÃ ĐƯỢC THÊM SẴN TRÊN PRODUCTION — Plan chạy tay 24/09/2026.**

```
truoc : id, ts, kho
sau   : id, ts, kho, bam
```

Lý do làm trước: Thực thi nêu đúng một rủi ro - `ALTER TABLE` chạy trên D1 thật mà chưa ai chạy lần nào, và vì hàm đếm nuốt lỗi theo thiết kế nên nếu nó hỏng thì **cột rỗng mãi mãi mà không ai được báo**. Thêm tay trước thì rủi ro đó biến mất: cột đã có, `ALTER` trong code sẽ rơi vào nhánh "đã có cột" và nhánh đó có đường lui.

Thêm một cột rỗng không mất dữ liệu, không ai thấy gì, và app chưa đụng tới nó cho tới khi deploy.

**VẪN PHẢI KIỂM NGAY SAU DEPLOY, ĐỪNG ĐỢI HẾT NGÀY.** Cột có rồi không có nghĩa là băm chạy được - `crypto.subtle` trên Workers là chỗ **chưa ai kiểm trên môi trường thật** (vitest chạy trên Node, không phải Workers).

```bash
npx wrangler d1 execute pmo-audit --remote --command \
  "SELECT COUNT(*) tong, COUNT(NULLIF(bam,'')) bam_that FROM kv_write WHERE substr(ts,1,10)='<ngày>'"
```

| Kết quả | Nghĩa là | Làm gì |
|---|---|---|
| `tong` > 0, `bam_that` > 0 | đồng hồ chạy | chờ hết ngày rồi đọc số |
| `tong` > 0, `bam_that` = 0 | băm luôn hỏng, nhiều khả năng `crypto.subtle` không có trên Workers | **lùi bản**, báo Plan |
| `tong` = 0 | không ghi được dòng đếm nào - nặng hơn hẳn | **lùi bản ngay**, đây là mất khả năng soi hạn mức (L9) |

Ai bấm deploy thì chạy luôn câu trên trong **cùng phiên đó**, đừng để sang hôm sau.


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

> *Mục ② của vòng trước (trả V2 về Plan kèm bằng chứng) nằm ở commit `e83028f`. Plan đã thu hết nội
> dung đó vào phần "V2 SAI Ở ĐÂU" của mục ① nên không chép lại ở đây.*

**ĐÃ LÀM**

`src/lib/kv-dem.ts` — gắn đồng hồ đo:

1. Thêm `bamNgan(giaTri)` — SHA-256 qua `crypto.subtle`, lấy **12 ký tự hex đầu**. Không nội dung
   nào ném ra ngoài: hỏng thì trả chuỗi rỗng.
2. `demGhiKv(key)` → `demGhiKv(key, giaTri?)`. Tham số mới **không bắt buộc**, nên đường `delete`
   (không có nội dung) gọi kiểu cũ vẫn chạy, băm rỗng.
3. Bảng D1 thêm cột `bam TEXT`: `CREATE TABLE` mang sẵn cột cho máy mới, kèm một câu `ALTER TABLE
   kv_write ADD COLUMN bam TEXT` cho **bảng đã có sẵn trên production** — `CREATE TABLE IF NOT
   EXISTS` không bao giờ thêm cột cho bảng đang tồn tại.
4. Câu chèn có **đường lùi**: chèn ba cột hỏng thì chèn lại hai cột như cũ.

`src/lib/mtld-install.functions.ts:38` và `src/lib/edits.functions.ts:166` — mỗi file **một dòng**,
truyền nội dung vừa ghi xuống `demGhiKv`.

`tests/kv-dem-bam.test.ts` — **mới**, 11 phép kiểm, gọi thẳng hàm thật.

`src/routes/index.tsx` — mục CHANGELOG `v3.109.1 (24/09/2026)`.

**VÌ SAO LÀM THẾ**

*Đụng ra ngoài PHẠM VI hai dòng — nói trước cho Review khỏi phải đi tìm.* Đặc tả ghi "Trong:
`src/lib/kv-dem.ts`". Nhưng `demGhiKv` **không thể băm thứ nó không được đưa**: nó chỉ nhận mỗi
`key`. Nên hai chỗ gọi phải truyền thêm nội dung. Mỗi chỗ đúng một dòng, chỉ thêm đối số, không đổi
hành vi nào. Tôi quyết làm và nêu rõ ở đây theo phần cuối mục 7 NEN-TANG, thay vì dừng lại hỏi một
việc không có đường nào khác để đi.

*Băm bằng `crypto.subtle` chứ không tự viết vòng lặp.* SHA-256 của runtime là mã máy; một vòng
`for` trong JS chạy trên payload vài trăm KB thì tốn CPU hơn hẳn, mà đây là hàm chạy ở **mọi** lượt
ghi KV. Trần CPU mỗi lượt Worker khoảng 2.010.000 µs — L9, cron đã chết vì chỗ này.

*Chỉ băm 128 KB đầu, và nhét độ dài thật vào phần băm.* Lý do y như trên: kho `sfile:` mang cả file
.xlsx đã base64, có bản trên 2MB. Băm trọn là đốt CPU tỉ lệ với cỡ file, ở đúng chỗ từng chết. Nhét
độ dài vào để hai payload khác cỡ không bao giờ đụng nhau. Đánh đổi: hai payload trùng **cả** 128 KB
đầu **lẫn** độ dài sẽ ra cùng một băm. Với `mtld` (danh sách ~85 dự án, vài chục KB) thì không xảy
ra — mà `mtld` mới là thứ việc này sinh ra để soi.

*12 ký tự hex = 48 bit.* Đủ xa để vài chục payload một ngày không đụng nhau, mà vẫn ngắn và **một
chiều** — không đọc ngược ra tên dự án. Đúng ràng buộc 1: đây là bảng ĐẾM, không phải nhật ký nội
dung, cùng lý do mà cột `kho` chỉ lấy phần trước dấu hai chấm.

*Vì sao có đường lùi cho câu chèn.* Nếu `ALTER` hỏng vì một lý do nào đó ngoài "đã có cột", câu chèn
ba cột sẽ hỏng theo và **mất luôn dòng đếm**. Bảng này là thứ **duy nhất** đang soi được hạn mức ghi
KV; mất nó là mù hẳn, đúng kiểu L9 (cron chết cả tuần mà không ai biết). Thà mất cái băm còn hơn mất
dòng đếm.

*CHANGELOG tăng PATCH (3.109.1) chứ không phải MINOR.* Người dùng không thấy gì đổi. Nhưng bản này
**phải deploy mới có số**, mà `APP_VERSION` suy từ `CHANGELOG[0].v` — không thêm mục thì badge phiên
bản đứng ở 3.109.0 và không ai phân biệt được máy đang chạy bản nào.

**ĐÃ ĐO**
```
tsc                   : sạch (exit 0)
vitest                : 369 passed | 2 expected fail | 28 file
                        mốc nền 358 | 2 | 27 → chênh +11 đúng bằng phần tôi thêm
                        (mốc này là 358, KHÔNG phải 346 như tiêu chí 3 của ① đang ghi)
build                 : qua, 11,60s
quét byte điều khiển  : 16 byte · 7 file — đúng mốc nền. Cả bốn file tôi đụng đều SẠCH
                        (kv-dem.ts · kv-dem-bam.test.ts · mtld-install.functions.ts · edits.functions.ts)
kiểm trên app         : 1440px — badge 3.109.0 → 3.109.1, bảng hiện 75 dự án như thường, không tràn.
                        375px — scrollWidth = clientWidth = 375, không tràn ngang.
                        Console: không lỗi mới. Vẫn đúng hai lỗi dev có sẵn (hydration lệch
                        `data-tsd-source`, lệch ở cả `__root.tsx` là file tôi chưa từng đụng; và
                        `GET /version.json → 404`, file chỉ có sau khi deploy).
ghi KV thêm mỗi lần mở app : 0. Không thêm một đường ghi KV nào — chỉ thêm MỘT CỘT vào dòng D1 vốn
                        đã ghi sẵn cho mỗi lượt ghi KV. Số dòng D1 mỗi ngày KHÔNG đổi (~650 trên
                        trần 100.000). Đúng tiêu chí 2 của ①.
cổng demo             : KHÔNG ÁP DỤNG — `kv-dem.ts` chạy trên Worker, không phải effect phía client;
cổng đang tải         : KHÔNG ÁP DỤNG   `dataMode`/`dangTaiKho` không tồn tại trong phạm vi này.
                        Hai cổng ở `index.tsx:2482-2483` vẫn nguyên, tôi không đụng.
```

Tiêu chí 4 của ① (băm ném lỗi thì `demGhiKv` vẫn chạy trọn, chốt bằng **số lượt `put`** — L14): đã
có, nhóm kiểm cuối trong file test. Dựng đúng hình dạng `bocKv` đang dùng, cho D1 hỏng toàn tập, rồi
chốt `soPut === 1` và caller không thấy lỗi.

**Đã xác nhận ĐỎ trên bản chưa sửa:** lùi tạm câu chèn về đúng dạng cũ (hai cột, bỏ băm) → **3 phép
kiểm đỏ**: "ghi đúng một dòng đếm mang theo băm", "hai payload khác nhau ra hai băm khác nhau",
"đường delete băm rỗng". Phục hồi xong chạy lại 11/11 xanh.

**CHỖ TÔI KHÔNG CHẮC**

1. **`ALTER TABLE` chạy trên D1 production, tôi chưa chạy thật lần nào.** Nếu nó hỏng vì lý do ngoài
   "đã có cột", đường lùi sẽ giữ được dòng đếm nhưng cột `bam` **rỗng mãi mãi và không ai được báo**
   — vì cả hàm này nuốt lỗi theo thiết kế. **Đề nghị: ngay sau khi deploy, chạy một câu kiểm**
   trước khi ngồi đợi cả ngày:
   ```
   npx wrangler d1 execute pmo-audit --remote --command \
     "SELECT COUNT(*) tong, COUNT(bam) co_bam, COUNT(NULLIF(bam,'')) bam_khac_rong FROM kv_write WHERE substr(ts,1,10)='<ngày>'"
   ```
   `co_bam` bằng 0 nghĩa là cột chưa có. `bam_khac_rong` bằng 0 mà `co_bam` khác 0 nghĩa là băm
   luôn hỏng — xem mục 2.

2. **`crypto.subtle` tôi chỉ kiểm được trên Node (vitest), chưa kiểm trên Workers thật.** Tài liệu
   nói Workers có, nhưng tôi không tự xác nhận được nên không dám khẳng định. Không có thì `bamNgan`
   trả rỗng, cả việc này thành công cốc mà vẫn "chạy bình thường". Câu SQL ở mục 1 phát hiện được.

3. **Mốc cắt 128 KB làm mù một phần các kho file lớn.** Hai payload `sfile:` trùng 128 KB đầu và
   trùng độ dài sẽ ra cùng băm. Đừng dùng cột này để kết luận về `sfile`/`spdf2` — nó được cắt cho
   vừa CPU, và chỉ hứa chính xác với `mtld`.

4. **Tôi không đo được CPU thêm trên Workers thật.** SHA-256 native trên tối đa 128 KB mỗi lượt ghi,
   tôi tin là không đáng kể so với trần 2.010.000 µs, nhưng đó là suy luận chứ không phải số đo.

5. **Ba câu lệnh dựng bảng chạy lại mỗi khi có isolate mới** (`banSan` là biến tầng module). Chuyện
   này **có sẵn từ trước**, tôi không thêm — nhưng nay có thêm câu `ALTER` luôn hỏng-và-bị-nuốt nên
   mỗi isolate mới tốn thêm một lượt gọi D1. D1 đang dùng 0,65% hạn mức nên không đáng lo, ghi ra
   đây để Review khỏi tưởng là thứ mới phát sinh.

**CHƯA LÀM**

- **Chưa có con số nào** — đó là điểm của việc này. Tiêu chí 1 của ① cần deploy rồi chờ một ngày.
  Tôi không deploy.
- **Không sửa** `putNeuKhac`, **không sửa** `dedupInstall`, **không sắp xếp** `named`, không đụng
  `sfile`/`spdf2`/`sheetsnap`/warmer — đúng phần NGOÀI. Nghi ngờ của tôi về `putNeuKhac` (đọc hỏng
  thì rơi xuống ghi) vẫn để nguyên đó chờ số, không tự đi sửa.
- **Không đụng** hai file box Test đang làm dở (`docs/NEN-TANG.md`, `tests/chu-gach-ngang-ranh-gioi.test.ts`).
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
