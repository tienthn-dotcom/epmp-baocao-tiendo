# Kho câu hỏi Trợ lý

Mỗi lần ai đó hỏi Trợ lý, app ghi lại **câu hỏi**, **màn đang đứng**, **email người hỏi** và
**trợ lý có trả lời được hay không**. Không ghi câu trả lời, không ghi số liệu dự án.

## Nằm ở đâu

- KV `PMO_EDITS`, khoá `troly:hoi:v1` — giữ 500 câu gần nhất, mới nhất đứng đầu.
- Bản sao lưu KV hằng đêm của warmer (23:30 VN) kéo luôn khoá này ra Drive, nên không cần
  dựng thêm đường xuất.

## Đọc ra

```bash
npx wrangler kv key get "troly:hoi:v1" --namespace-id 2bdbce7b49014e538ee3156728ab9548 --remote
```

Hoặc gọi server function `docCauHoiTroLy` (chỉ admin/OCC).

## Dùng để làm gì

Lọc các câu có `traLoiDuoc: false`. Đó là danh sách việc cần bổ sung vào
`src/lib/tro-ly/kien-thuc.ts` — biết chắc người dùng đang bí chỗ nào, không phải đoán.
