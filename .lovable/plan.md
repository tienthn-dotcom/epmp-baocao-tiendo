## Tóm tắt

Tinh chỉnh bề rộng 11 cột trong bảng "Việc cần xử lý" (web + bản in) cho khít nội dung, dồn phần dư vào cột Vướng mắc. Giữ nguyên toàn bộ cách hiển thị chữ, màu, logic, sort hiện tại.

## Chi tiết thực hiện

### 1. Cột "Hạng mục" — đúng 2 chữ/dòng, tối đa 2 dòng

- Giữ nguyên `whiteSpace: "normal"`, thêm `wordBreak: "keep-all"` + `overflowWrap: "normal"`.
- Bề rộng cột giảm từ 7.5% → 7%.
- Cách ngắt dòng do trình duyệt tự xử lý theo chiều rộng mới (2 chữ/dòng).

### 2. Cột "Mã CT" — khít 1 mã, 2 mã xuống dòng

- Giữ nguyên cách render tách dòng khi có dấu phẩy.
- Bề rộng giảm từ 6% → 5.5%.

### 3. Các cột dư khoảng trắng — bóp hẹp

- "% thực tế": 5% → 4.5% (vừa "100%").
- "Trễ deadline": 6% → 5.5% (vừa "276 ngày").
- "Tình trạng": 8.5% → 7.5% (khít badge 2 dòng).
- 3 cột ngày giữ 6% không đổi.

### 4. Bề rộng 11 cột (cập nhật `<colgroup>`)

Tổng các % người dùng đưa ra là 104% (5.5+17+6+7+8+6+6+4.5+5.5+7.5+31). Để tổng đúng 100% với `table-layout: fixed`, tỉ lệ sẽ được co về tương đối:

```text
Mã CT          5.29%
Tên dự án      16.35%
Mốc bàn giao   5.77%
Hạng mục       6.73%
Nhân sự        7.69%
Ngày bắt đầu   5.77%
Deadline       5.77%
% thực tế      4.33%
Trễ deadline   5.29%
Tình trạng     7.21%
Vướng mắc      29.81%  (≈30%)
```

> **Lưu ý:** Vui lòng xác nhận nếu muốn giữ số nguyên gốc và chấp nhận vượt 100% (trình duyệt sẽ tự phân bổ), hoặc điều chỉnh lại 1–2 cột (ví dụ Vướng mắc xuống 27% thay vì 31%).

### 6. Giữ nguyên

- Chiều cao hàng đều (`align-middle`).
- Badge Tình trạng (màu, 2 dòng, cỡ hiện tại).
- `white-space: nowrap` ở ngày/số/Mã CT.
- Không cắt chữ ở bất kỳ ô nào.