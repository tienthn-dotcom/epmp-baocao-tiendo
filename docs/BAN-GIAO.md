# SỔ BÀN GIAO

Bốn box nói chuyện với nhau qua đúng file này.

**Luật dùng sổ:**
- Mỗi box **đọc từ đầu sổ** trước khi làm, để biết chuyện đã tới đâu
- Chỉ **ghi thêm** phần của mình, **không sửa, không xoá** phần của box khác
- Một việc xong thì chuyển cả khối xuống `docs/BAN-GIAO-CU.md` và dọn sổ này cho việc mới
- Nền tảng chung (con số, luật, sổ lỗi) nằm ở `docs/NEN-TANG.md`, **không chép lại vào đây**

---

# VIỆC ĐANG LÀM

**V1 · Dọn ký tự ngăn cách vô hình trong mã nguồn, rồi chốt lại bằng phép kiểm**
Plan mở ngày 21/09/2026. Việc đầu tiên chạy thử dây chuyền bốn box.

---

## ① PLAN

**VIỆC**
Thay 14 byte điều khiển **thật** đang nằm trong 6 file mã nguồn bằng escape đọc được (`\u0000`, `\u0001`), rồi thêm một phép kiểm quét toàn repo để lớp lỗi này không quay lại được nữa.

**VÌ SAO CẦN**
Các byte này là dấu ngăn cách cố ý trong khoá (`toa` + `can`, `code` + `name`, `pm` + `dpm`), nhưng viết bằng **byte thật** nên **không thấy trong editor, không thấy trong diff, không thấy khi review**.

Đã đo: hiện tại **chúng vẫn khớp nhau**, app không sai số. Đây là rủi ro tiềm ẩn, không phải lỗi đang chạy - đừng phóng to hơn thế. Nhưng L1 cho thấy lớp lỗi này **từng lên tới production một lần**, và cái giá là hai chỗ dựng khoá lệch nhau trong im lặng. Ai viết thêm code cần dựng đúng khoá đó sẽ gõ dấu ngăn nhìn thấy được, rồi nó lệch mà không ai biết.

**LÀM XONG THÌ NHÌN THẤY GÌ**
Người dùng **không thấy gì cả**. Đây là việc làm sạch nền, không đổi hành vi. Một ký tự hiển thị khác đi cũng là làm sai.

**PHẠM VI**
- Trong: đúng 12 dòng ở 6 file dưới đây, cộng một file kiểm mới.
- NGOÀI: không đổi tên biến, không đổi cấu trúc khoá, không đổi byte này thành byte khác, không dọn dẹp gì quanh đó, không sửa CRLF, không chạm file nào khác.

| File | Dòng | Byte | Đổi thành |
|---|---|---|---|
| src/lib/can-media-app.tsx | 499, 511, 1169 | 0x00 | `\u0000` |
| src/lib/can-media.functions.ts | 256 | 0x00 | `\u0000` |
| src/lib/compliance.ts | 203 | **0x01** | `\u0001` |
| src/lib/filter.ts | 269 | 0x00 | `\u0000` |
| src/lib/parser.ts | 869 | 0x00 hai chỗ | `\u0000` |
| src/routes/index.tsx | 2555, 2564, 3058, 3976 (hai chỗ), 4960 | 0x00 | `\u0000` |

**DÙNG CHUNG - CODE NÀO BỊ ĐỤNG TỚI**
Đây là điểm nguy hiểm duy nhất của việc này. Mỗi byte là một **dấu ngăn trong khoá**, mà khoá thì hai đầu phải khớp:
- `toa` + `can`: dựng ở `can-media.functions.ts:256` (server), đọc ở `can-media-app.tsx:499/511/1169` (client). **Hai bên phải cùng byte.**
- `code` + `name`: dựng ở `filter.ts:269`, `index.tsx:2555`, `index.tsx:3058`; đọc ở `index.tsx:2564`. **Bốn chỗ phải cùng byte.**
- `pm` + `dpm` ở `compliance.ts:203` dùng **0x01**, không phải 0x00. Đã soát: khoá này không dựng ở đâu khác. **Giữ đúng 0x01, đừng thống nhất về 0x00** - thống nhất là đổi hành vi.
- `dupKey` ở `parser.ts:869` và khoá hàng ở `index.tsx:3976` dùng NUL **hai lần** trong một chuỗi. Đổi thiếu một cái là lệch.

**RÀNG BUỘC**
1. `${a}\u0000${b}` phải sinh ra **đúng chuỗi cũ, từng byte**. Đây là phép thay tương đương, không phải phép sửa.
2. Không đổi 0x01 của `compliance.ts` thành 0x00.
3. Không đụng byte 0x0d (CR) - đó là dòng Windows bình thường, không phải rác.
4. Khoá nào đi vào KV mà đổi byte thì **mọi dữ liệu người dùng đã lưu thành rác**. Vì vậy ràng buộc 1 là tuyệt đối.

**ĐÃ ĐO TRƯỚC** (Plan đo 21/09/2026, cây làm việc sạch ở commit 440464d)
```
Quét src/ tests/ scripts/ docs/ : 14 byte điều khiển · 6 file · 12 dòng
Byte đang dùng                  : 0x00 mười ba chỗ · 0x01 một chỗ
Đã lệch nhau chưa               : CHƯA - mọi khoá code|name và toa|can đều dùng 0x00
Khoá pm|dpm (0x01)              : chỉ dựng ở compliance.ts:203, không đọc nơi khác
tsc                             : sạch
vitest                          : 346 passed / 26 file
Bẫy cần biết trước              : grep coi can-media-app.tsx là "Binary file" nên grep
                                  THƯỜNG không tìm thấy gì trong file đó - phải dùng grep -a
```

**CHỖ CÒN MƠ HỒ**
Không có. Danh sách 12 dòng là danh sách đóng, đã đo. Nếu Thực thi quét ra con số **khác 14**, nghĩa là có ai vừa sửa file - **dừng lại, báo Plan**, đừng tự quyết.

**CÁCH BIẾT LÀ ĐÚNG**
1. Quét lại: **0 byte** điều khiển trong `src/ tests/ scripts/ docs/` (trước: 14).
2. `tsc` sạch · `vitest` **346 passed, không hơn không kém** ở bước này.
3. **Phép kiểm mới** `tests/khong-byte-dieu-khien.test.ts`: quét mọi file `.ts .tsx .js .mjs .cjs .gs .md .json` trong `src/ tests/ scripts/ docs/`, đỏ nếu gặp byte trong dải 0x00-0x08, 0x0b, 0x0c, 0x0e-0x1f. Thông báo lỗi phải in **tên file, số dòng, tên byte**. Bỏ qua 0x09 (tab) và 0x0d (CR).
   → Sau khi thêm: **347 passed**.
4. Phép kiểm đó phải **đỏ trên bản chưa sửa**. Test xác nhận bằng `git stash` và nêu rõ trong mục ③.
5. **Chứng minh tương đương** - phép đo quan trọng nhất. Với mỗi dòng đã sửa, chuỗi sinh ra phải **giống hệt bản cũ**: trước khi sửa ghi ra `scratchpad/khoa-truoc.json` một mẫu khoá dựng từ dữ liệu thật, sau khi sửa dựng lại và so **từng byte**.
6. Không cần soi 1440px/375px vì việc này không đổi pixel nào. Nhưng **phải mở app trên localhost** xác nhận ma trận Media vẫn hiện chấm và vẫn mở được ô - đó là đường dùng khoá `toa|can` xuyên server-client.

**HẠN MỨC**
Việc này **không thêm đường ghi KV nào**. Lượt ghi mỗi lần mở app phải **không đổi**. Đổi là dấu hiệu đã phạm ràng buộc 1.

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

**PHÁN QUYẾT** — ĐẠT / ĐẠT KÈM LƯU Ý / KHÔNG ĐẠT

**ĐÃ VIẾT**
<số> phép kiểm trong <file>
Đã xác nhận ĐỎ trên bản chưa sửa: <có, phép nào> / <không, vì sao>

**RANH GIỚI ĐÃ SOI**
<bảng: từng mốc, cả hai phía, kết quả>

**CHẠY**
```
vitest : <số> passed / <số> failed
tsc    : sạch / lỗi
```

**LỖI TÌM ĐƯỢC**
<mỗi lỗi: hiện tượng, cách tái hiện, mức nghiêm trọng. KHÔNG tự sửa.>

**CHƯA KIỂM ĐƯỢC**
<thành thật: cần dữ liệu gì, quyền gì, môi trường nào.>

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

<Box nào phát hiện bẫy chưa có trong sổ lỗi thì ghi vào NEN-TANG.md phần 4, và ghi ở đây là đã thêm mục nào. Không có thì viết "không".>
