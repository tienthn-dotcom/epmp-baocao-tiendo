# SỔ BÀN GIAO

Bốn box nói chuyện với nhau qua đúng file này.

**Luật dùng sổ:**
- Mỗi box **đọc từ đầu sổ** trước khi làm, để biết chuyện đã tới đâu
- Chỉ **ghi thêm** phần của mình, **không sửa, không xoá** phần của box khác
- Một việc xong thì chuyển cả khối xuống `docs/BAN-GIAO-CU.md` và dọn sổ này cho việc mới
- Nền tảng chung (con số, luật, sổ lỗi) nằm ở `docs/NEN-TANG.md`, **không chép lại vào đây**

---

# VIỆC ĐANG LÀM

**V4a · Xuất Excel: ô THẬT thay vì ô chữ**
Plan mở 25/09/2026. Người dùng chốt "làm đủ cả hai" nên chẻ hai vòng: **V4a ô thật** (vòng này) rồi **V4b phần nhìn**.

*Đang chờ người dùng:* **V2b** (mã băm vào bảng đếm D1) đã xong ② và Test cho **ĐẠT KÈM LƯU Ý** ở ③. Kẹt ở chỗ chưa ai bấm deploy, và chưa có box nào nhận vai Review. Không liên quan V4.

*Hàng đợi:* **V4b** phần nhìn · **V3** thẻ MTLĐ hiện đủ tên (15 dự án, 9 bị giấu tên) · **V1** dọn 14 byte điều khiển.

---

## ① PLAN

**VIỆC**
Trong `exportTableXlsx`, ghi ngày ra **kiểu ngày**, phần trăm và số ngày quá hạn ra **kiểu số**, thay vì ghi tất cả thành chữ như hiện nay.

**VÌ SAO CẦN**
Chú thích của chính app hứa: *"Xuất Excel giống hệt bảng/PDF nhưng là ô THẬT (lọc / sắp xếp / sửa ngay trong Excel)"* (`index.tsx:1127`). Hiện lời hứa đó **chưa đúng**: `XlsxTableRow.cells` khai là `string[]`, mọi ô đều là chữ.

Hậu quả đo được: cột ngày đang là chữ `dd/mm/yy`, nên bấm sắp xếp theo ngày trong Excel ra **thứ tự chữ cái chứ không phải thứ tự thời gian** - `01/12/25` đứng trước `02/01/26`. Cột % và Quá hạn cũng không cộng, không lọc "lớn hơn", không dựng biểu đồ được.

Người nhận file mở ra, bấm sắp xếp theo hạn, và **tin vào một thứ tự sai**. Đây không phải chuyện thẩm mỹ.

**LÀM XONG THÌ NHÌN THẤY GÌ**
Nhìn **y hệt hiện nay** - vẫn `dd/mm/yy`, vẫn căn giữa, vẫn màu như cũ. Khác ở chỗ bấm sắp xếp theo ngày thì ra đúng thứ tự thời gian, và bôi đen cột Quá hạn thì Excel cộng được.

**PHẠM VI**
- Trong: `src/lib/excel-export.ts` - `XlsxTableRow.cells` và vòng ghi dòng trong `exportTableXlsx` (dòng 571-681). Và chỗ dựng `cells` trong `src/routes/index.tsx` (`onExportExcel`, ~4597).
- NGOÀI: **không** đổi màu, **không** đổi cột, **không** đổi thứ tự cột, **không** bỏ ẩn dòng con, **không** đụng `exportMatrixXlsx` (đường xuất ma trận, việc khác), **không** đụng đường xuất PDF. Phần nhìn để dành V4b.

**GIỮ NGUYÊN, NGƯỜI DÙNG ĐÃ CHỐT**
Dòng công đoạn con **vẫn ẩn sẵn nhưng nhóm lại được để bấm xổ** - đúng như `row.outlineLevel = 1` + `row.hidden = true` đang làm. Đừng đổi. Nhưng **kiểm giúp** là nút xổ thật sự hiện ra trong Excel, vì `summaryBelow: false` đang gán qua `as any`.

**DÙNG CHUNG - CODE NÀO BỊ ĐỤNG TỚI**
`XlsxTableRow` là kiểu dùng chung giữa `excel-export.ts` và `index.tsx`. Đổi `cells: string[]` thành kiểu rộng hơn thì **mọi chỗ dựng `cells` phải sửa theo** - trình biên dịch sẽ chỉ ra, nhưng đếm trước cho biết phạm vi.
`exportMatrixXlsx` **cũng ở trong file này** nhưng là đường khác, không dùng `XlsxTableRow`. Đừng sửa lây.

**RÀNG BUỘC**
1. **Ô trống phải là Ô TRỐNG, không phải 0, không phải ngày 1900.** Đây là luật 5.2 và là chỗ dễ sai nhất của việc này: `fmtDateVN2(null)` hiện trả `""`, `clampPct` trả `null`. Ghi `0` vào ô % của dòng chưa có số là **báo cáo sai sự thật** - dòng chưa đo thành dòng 0%.
2. Ngày ghi ra kiểu ngày, định dạng hiển thị `dd/mm/yy` để **nhìn không đổi**.
3. % ghi ra số. Chọn một trong hai và **nói rõ đã chọn cái nào**: lưu `85` với định dạng `0"%"`, hoặc lưu `0.85` với định dạng `0%`. Cái sau đúng kiểu Excel hơn nhưng ai copy sang chỗ khác sẽ thấy `0.85`.
4. Quá hạn ghi ra số nguyên.
5. Cột chữ (Mã, Tên, Người phụ trách, Tình trạng, Vướng mắc, Giải pháp) **giữ nguyên là chữ**. Mã dự án kiểu `CT26-032` mà để Excel tự đoán là nguy hiểm.
6. Dòng nhóm dự án không có % và Quá hạn - hiện đang đẩy `""`. Giữ **trống**, đừng thành 0.

**ĐÃ ĐO TRƯỚC** (Plan 25/09/2026)
```
Duong xuat Excel  : index.tsx ~4597 -> excel-export.ts exportTableXlsx (dong 590-681)
Thu vien          : exceljs, nap dong (await import)
11 cot, chi so 0-based:
   0 Ngay update   -> NGAY      4 Ngay bat dau  -> NGAY     8 Tinh trang  giu CHU
   1 Ma            giu CHU      5 Ngay ket thuc -> NGAY      9 Vuong mac   giu CHU
   2 Ten du an     giu CHU      6 % thuc te     -> SO       10 Giai phap   giu CHU
   3 Nguoi p.trach giu CHU      7 Qua han       -> SO
Da co san (DUNG sua o V4a) : thanh tieu de, dong pham vi loc, dong header dong bang (ySplit 3),
   autoFilter tu dong 3, to mau Tinh trang do/vang/xanh, to do o ngay ket thuc khi qua han,
   outline nhom dong con
```

**CHỖ CÒN MƠ HỒ**
Ràng buộc 3 (`85` hay `0.85`) là chỗ Thực thi chọn, nhưng **phải nêu rõ vì sao** trong mục ②. Nếu thấy có lý do mạnh để chọn khác thì báo Plan.

**CÁCH BIẾT LÀ ĐÚNG**
1. **Phép đo quan trọng nhất:** mở file xuất ra, bấm sắp xếp cột "Ngày kết thúc" tăng dần → ra **đúng thứ tự thời gian**. Trước khi sửa, việc này ra sai. Nêu cụ thể trước và sau.
2. Bôi đen cột "Quá hạn" → Excel hiện **Sum** ở thanh dưới. Trước: không hiện.
3. **Dòng chưa có số thì ô % TRỐNG**, không phải 0. Soi thẳng file xuất ra, đừng chỉ tin test.
4. Nhìn bằng mắt: ngày vẫn hiện `dd/mm/yy`, màu không đổi, cột không xê dịch.
5. Nút xổ nhóm vẫn bấm được, dòng con vẫn ẩn sẵn.
6. `tsc` sạch · `vitest` không phép nào đang xanh bị đỏ. Thêm phép kiểm cho hàm dựng ô: trống → trống (không phải 0), ngày hợp lệ → kiểu ngày, % null → trống, % 0 → **số 0 thật** (0% khác với chưa có, đừng gộp).
7. Không có đường ghi KV nào trong việc này. Lượt ghi phải **không đổi**.

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
