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

`src/lib/mtld-install.functions.ts` — bốn thay đổi:

1. Thêm `ghiCacheNeuDoiB64(kv, cacheKey, b64, b64Cu, ttlS)` — ghi `{b64, ts}` CHỈ khi phần b64 khác
   bản đang giữ. Trả về có ghi thật hay không. **Xuất ra** để bộ kiểm gọi thẳng code thật.
2. Thêm `nenLamMoiNen(cacheKey, gio)` + một `Map` ở tầng module, cửa sổ 10 phút — chặn tải lặp
   (ràng buộc 4). Không tốn lượt ghi KV nào.
3. `refreshAndStore` nhận thêm tham số cuối `b64Cu?: string`, và ghi qua hàm ở mục 1 thay vì
   `kv.put` vô điều kiện (dòng 164 cũ).
4. Hai nhánh làm mới nền — `getSummaryFile` và `getSheetPdf` (chỗ `kv.put` trong `.then()`, dòng
   ~331 cũ) — đều qua cổng `nenLamMoiNen` và truyền bản cache đang cầm trong tay xuống để so.

`tests/kv-ghi-khi-noi-dung-doi.test.ts` — **mới**, 10 phép kiểm, gọi thẳng hai hàm xuất ở trên.

`src/routes/index.tsx` — thêm mục CHANGELOG `v3.110.0 (24/09/2026)`. `APP_VERSION` tự suy từ
`CHANGELOG[0].v` nên phiên bản app lên 3.110.0 theo.

**VÌ SAO LÀM THẾ**

*So với bản cũ lấy từ đâu — đọc lại KV hay dùng bản đang cầm?* Chọn **bản đang cầm**. Nhánh làm mới
nền vừa đọc cache xong ở ngay trên, bản cũ đã nằm sẵn trong biến; đọc lại KV là tốn thêm một lượt
đọc cho đúng thứ đang có trong tay. Cách này cũng tự thoả ràng buộc 3: chỗ nào không cầm bản cũ thì
tham số là `undefined` và hàm cứ ghi, khỏi phải nhớ thêm luật.

*Vì sao không dùng lại `putNeuKhac` có sẵn trong cùng file.* Hàm đó so **cả chuỗi đã JSON hoá**. Giá
trị ở đây là `{b64, ts}` mà `ts` đổi mỗi lượt, nên so cả chuỗi thì lần nào cũng ra "khác" — đúng con
bug đang phải sửa. Vì vậy so trên riêng phần b64. Đã ghi lý do này ngay trên hàm mới để người sau
đừng "dọn dẹp" bằng cách gộp hai hàm lại.

*Cổng chặn tải lặp đặt ở đâu.* Đặt tại hai nhánh làm mới nền, **không** đặt trong `refreshAndStore`.
Vì `refreshAndStore` còn được gọi ở nhánh cache trượt, nơi người dùng đang ngồi chờ dữ liệu — chặn
chỗ đó là để họ nhìn màn hình trống.

*Cache đời cũ (b64 thô, chưa bọc `{b64, ts}`).* Chỗ này suýt lọt. Nếu đem bản thô ra so mà nội dung
trùng thì lượt ghi bị bỏ, bản cũ nằm lại mãi ở định dạng cũ với `ts = 0`, nên **mỗi** lượt mở đều
kích hoạt tải nền — tiết kiệm lượt ghi nhưng đổi lấy CPU, đúng bẫy L9. Nay bản đời cũ truyền
`undefined` để cứ ghi đúng một lượt và đổi sang định dạng mới, giữ nguyên ý định mà ghi chú cũ trong
code đã nói rõ ("coi như ts=0 để refresh nền 1 lần").

**ĐÃ ĐO**
```
tsc                   : sạch (exit 0)
vitest                : 368 passed | 2 expected fail | 28 file
                        mốc nền Test đo 21/09: 358 passed | 2 expected fail | 27 file
                        chênh +10 đúng bằng số phép kiểm tôi thêm — không test đang xanh nào bị đỏ
build                 : qua, 13,21s
quét byte điều khiển  : 16 byte · 7 file — ĐÚNG BẰNG mốc nền của Test, ba file tôi đụng thêm 0 byte
                        (mtld-install.functions.ts sạch · test mới sạch · index.tsx giữ nguyên 6 byte
                        có sẵn từ trước, thuộc phần việc V1)
                        Dùng lệnh ĐÃ SỬA ở NEN-TANG phần 6, không dùng lệnh cũ (L13)
kiểm trên app         : 1440px — badge phiên bản 3.109.0 → 3.110.0; hộp "CÓ GÌ MỚI" hiện mục mới
                        trên cùng kèm nhãn MỚI NHẤT, ngày 24/09/2026, hai gạch đầu dòng đủ chữ.
                        375px — scrollWidth = clientWidth = 375, KHÔNG tràn ngang; chữ xuống dòng gọn.
                        Console: không lỗi mới. Hai lỗi đang có là của sẵn môi trường dev, không
                        phải của bản sửa: hydration lệch thuộc tính `data-tsd-source` (lệch ở cả
                        `__root.tsx`, file tôi KHÔNG đụng) và `GET /version.json → 404` (file chỉ có
                        sau khi deploy).
ghi KV thêm mỗi lần mở app : 0 — và đây là điểm chính: `getSummaryFile`/`getSheetPdf` KHÔNG chạy lúc
                        mở app. Đã soi 210 lượt mạng của một lần mở: không có lượt nào gọi hai hàm
                        này. Chúng chỉ chạy khi có người bấm mở ma trận lắp đặt / bảng PDF của một
                        dự án. Việc này chỉ BỚT ghi, không thêm đường ghi nào.
cổng demo             : KHÔNG ÁP DỤNG — không phải effect phía client. Đây là server-fn chạy trên
cổng đang tải         : KHÔNG ÁP DỤNG   Worker theo đúng một thao tác người dùng; `dataMode` và
                        `dangTaiKho` là state của client, không tồn tại trong phạm vi này (grep cả
                        file: 0 chỗ). Ghi "có" vào đây là khai man, nên tôi ghi thẳng là không áp dụng.
```

**CHỖ TÔI KHÔNG CHẮC**

1. **`spdf2` có thể tiết kiệm được 0 — rủi ro lớn nhất của bản này.** Bản PDF do Google render. Nếu
   Google nhúng dấu thời gian hoặc ID vào file PDF thì byte đổi mỗi lượt render dù sheet không đổi,
   phép so không bao giờ khớp, và 73 lượt ghi/ngày của `spdf2` giữ nguyên. Tôi **không kiểm được**:
   cần gọi Drive thật. Nếu điều này đúng thì mong đợi "210 xuống dưới 60" của Plan phải hạ xuống còn
   khoảng "137 của `sfile` xuống thấp, `spdf2` giữ nguyên". **Đề nghị Test đo đúng chỗ này trước
   tiên:** tải PDF cùng một tab hai lần cách nhau vài phút, so hai chuỗi b64.

2. **Cổng 10 phút làm dữ liệu mới về chậm hơn, trong tình huống xấu nhất.** Trước đây mỗi lượt mở
   sau mốc quét đều kích hoạt tải nền, nên file vừa sửa trên Drive được bắt ở lượt mở kế tiếp. Nay
   nếu lượt làm mới gần nhất kết luận "không đổi" thì trong 10 phút sau đó không tải lại nữa — ai
   sửa Drive ngay trong khoảng đó phải đợi hết 10 phút. Chỉ xảy ra ở nhánh "không đổi": hễ nội dung
   có đổi thật thì `ts` nhích lên và mốc quét tự chặn phần còn lại của ngày.
   **Đây là bẫy khi Test kiểm tiêu chí quan trọng nhất** ("sửa file trên Drive rồi mở → vẫn ghi"):
   mở lại ngay sau khi sửa có thể vẫn thấy bản cũ, và đó KHÔNG phải bằng chứng bản sửa hỏng. Đợi quá
   10 phút, hoặc bấm nút "Làm mới" (đường `force` đi thẳng, không qua cổng nào).

3. **Đường `force` vẫn ghi vô điều kiện.** Bấm "Làm mới" thì code bỏ qua lượt đọc cache nên không
   cầm bản cũ → cứ ghi, đúng ràng buộc 3. Ai bấm "Làm mới" liên tục thì vẫn tốn lượt ghi như trước.
   Tôi KHÔNG tự mở rộng sang đọc cache ở đường force để so, vì đó là thêm lượt đọc cho một đường
   người dùng chủ động đòi bản mới — nếu Plan muốn khác thì nói, đừng để tôi tự quyết.

4. **Cổng chặn tính theo từng isolate.** Cloudflare chạy nhiều isolate song song, nên con số thật
   không phải "1 lượt tải mỗi 10 phút" mà là "1 lượt mỗi 10 phút **mỗi isolate**". Với 10–17 người
   một ngày thì số isolate cùng lúc nhỏ, nhưng tôi không đo được nên không dám nêu con số.

5. **Chưa chạy trên KV thật lần nào.** Bộ kiểm dùng KV giả đếm lượt `put`; dev không có binding KV.
   Mọi con số lượt ghi thật phải đợi một ngày chạy production rồi đo bằng câu SQL ở tiêu chí 3.

6. **`sheetsnap` không được đụng** (đúng PHẠM VI), nên 79 lượt/ngày của nó giữ nguyên. Con số "289 =
   45% cả ngày" ở phần VIỆC vì thế không phải thứ bản này nhắm tới; phần trong tầm là 210 của
   `sfile` + `spdf2`. Nêu ra để Review khỏi đối chiếu nhầm mốc.

7. **Bốn dòng CHANGELOG tôi thêm làm lệch số dòng của `index.tsx`, và việc V1 đang ghim số dòng.**
   Bảng phạm vi của V1 (`git show 19e81d4`) ghi `src/routes/index.tsx` ở 2555 · 2564 · 3058 · 3976
   (hai chỗ) · 4960. Quét lại sau bản sửa này: **2559 · 2568 · 3062 · 3980 (hai chỗ) · 4964** —
   lệch đúng +4. Nội dung byte không đổi, chỉ số dòng trôi. Ai làm V1 mà cầm bảng cũ sẽ sửa nhầm
   dòng. Tôi KHÔNG tự sửa đặc tả V1 vì đó là mục của Plan.

**CHƯA LÀM**

- **Ba tiêu chí nghiệm thu 1, 2, 3 của Plan** — đều cần KV thật và một ngày chạy production. Tôi chỉ
  làm được tiêu chí 4 (tsc, vitest) và 5 (phép kiểm mới). Tiêu chí 2 là quan trọng nhất và phải có
  người mở app thật, đọc kỹ mục 2 phần trên trước khi kết luận.
- **Không đụng** `sheetsnap` ở `edits.functions.ts:1416`, warmer, `sfile:index`, `CACHE_TTL_S`,
  `lastRefreshBoundary` — đúng phần NGOÀI của PHẠM VI. Cũng không gộp ba kho.
- **Không thêm đường ghi KV nào**, kể cả để lưu mã băm (ràng buộc 5). Mã băm sẽ tốn đúng thứ đang
  khan; so thẳng b64 trong bộ nhớ thì miễn phí.
- **Không sửa lint.** `npx eslint` trên repo ra 10.180 lỗi, gần hết là `Delete ␍` vì repo dùng CRLF
  còn cấu hình prettier đòi LF — hỏng sẵn toàn repo, không phải do bản này, và chạy `--fix` là viết
  lại dấu xuống dòng của hàng trăm file. File mới của tôi dùng CRLF cho khớp phần còn lại.
- **Không deploy.**

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

---

**THỰC THI đề nghị thêm `L14`, và CHƯA tự ghi vào NEN-TANG.md — xin Plan/Test chốt giúp.**

*Vì sao chưa tự ghi:* `docs/NEN-TANG.md` đang có thay đổi CHƯA COMMIT của box Test (bản sửa lệnh
quét + L13). Tôi sửa tiếp vào đó rồi commit là kéo nguyên phần việc đang dở của Test vào commit của
mình dưới một thông điệp không nói gì về nó — đúng L12, đúng thứ luật 5.6 vừa cấm. Nên tôi dừng ở
đề nghị. Test commit xong thì tôi thêm, hoặc Test thêm luôn cũng được.

**L14 · Phép kiểm chốt bằng dấu thời gian có thể XANH GIẢ.** 24/09/2026, lúc viết bộ kiểm cho V2.
Phép kiểm "bỏ ghi thì `ts` đứng yên" chốt bằng `ts` trước == `ts` sau. Đem chạy lên bản ghi vô điều
kiện để xác nhận nó đỏ — **nó vẫn xanh**. Lý do: hai lượt ghi liền nhau rơi vào cùng một milli giây
nên `Date.now()` trả về đúng một số, `ts` sau bằng `ts` trước dù đã ghi đè thật. Phép kiểm đó chứng
minh được đúng con số không. Chốt lại bằng SỐ LƯỢT `put` thì bắt được ngay.
→ Phép kiểm phải chốt vào **thứ mình thật sự muốn cấm** (ở đây: lượt ghi), đừng chốt vào **dấu vết
gián tiếp** của nó. Và mọi phép kiểm mới đều phải đem chạy lên bản chưa sửa một lần — đây là lần
thứ hai trong hai lượt liên tiếp mà việc "đo lại cái thước" bắt được lỗi, xem L13.

*Kèm một chi tiết nhỏ của cùng buổi, thuộc họ L1:* lúc lùi tạm một dòng để thử, tôi thay bằng
`node -e` với chuỗi `'...\n'` — không khớp gì cả vì file dùng CRLF, thế là bộ kiểm báo 9/9 xanh và
suýt nữa tôi ghi "đã xác nhận đỏ" trong khi chưa lùi được dòng nào. Làm lại bằng công cụ sửa file
thì đúng. Đây chính là lý do L1 bảo đừng nhồi nội dung qua shell, chỉ khác là lần này nó cắn ở chiều
ĐỌC chứ không phải chiều ghi.
