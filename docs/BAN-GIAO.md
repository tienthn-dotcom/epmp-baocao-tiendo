# SỔ BÀN GIAO

Bốn box nói chuyện với nhau qua đúng file này.

**Luật dùng sổ:**
- Mỗi box **đọc từ đầu sổ** trước khi làm, để biết chuyện đã tới đâu
- Chỉ **ghi thêm** phần của mình, **không sửa, không xoá** phần của box khác
- Một việc xong thì chuyển cả khối xuống `docs/BAN-GIAO-CU.md` và dọn sổ này cho việc mới
- Nền tảng chung (con số, luật, sổ lỗi) nằm ở `docs/NEN-TANG.md`, **không chép lại vào đây**

---

# VIỆC ĐANG LÀM

*(Plan điền vào đây. Xoá phần mẫu bên dưới khi bắt đầu việc thật.)*

---

## ① PLAN

**VIỆC**
<một câu. Không gọn được trong một câu thì việc còn quá to, chẻ ra.>

**VÌ SAO CẦN**
<ai đang đau ở đâu. Có số đo thì nêu số.>

**LÀM XONG THÌ NHÌN THẤY GÌ**
<mô tả theo góc NGƯỜI DÙNG, không theo góc code.>

**PHẠM VI**
- Trong: <liệt kê>
- NGOÀI: <liệt kê - quan trọng ngang phần trên. Không viết thì Thực thi sẽ "tiện tay sửa luôn" và Review không soi nổi.>

**RÀNG BUỘC**
<luật nghiệp vụ, mốc giờ, công thức, thứ tự sắp xếp. Càng cụ thể càng ít phải hỏi lại.>

**ĐÃ ĐO TRƯỚC**
<số liệu thật đã đo, tên file và số dòng đã đọc. Mục này tiết kiệm nhiều nhất cho Thực thi.>

**CHỖ CÒN MƠ HỒ**
<thành thật. Thực thi gặp chỗ này thì HỎI LẠI PLAN, không tự quyết.>

**CÁCH BIẾT LÀ ĐÚNG**
<phép đo cụ thể: con số nào, trước bao nhiêu, sau bao nhiêu.>

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
