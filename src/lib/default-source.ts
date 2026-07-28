/**
 * NGUỒN DỮ LIỆU MẶC ĐỊNH — link Google Sheet (tab Timeline).
 *
 * Khi được set (khác rỗng), mọi người mở app lần đầu sẽ TỰ ĐỘNG kết nối link
 * này và thấy dữ liệu real-time ngay — không phải dán link thủ công.
 * Người dùng vẫn có thể đổi nguồn riêng qua nút "Nguồn dữ liệu" (lưu theo
 * trình duyệt của họ, không ảnh hưởng người khác).
 *
 * Chấp nhận mọi dạng link Google Sheets (link edit thường có #gid, link
 * Publish-to-web CSV, link export…) — server tự chuẩn hóa (sheets.functions.ts).
 *
 * Yêu cầu: Sheet phải share "Anyone with the link" (Viewer) hoặc Publish to web.
 * Đổi link xong: npm run build && npx wrangler deploy.
 */
// Cập nhật 14/07/2026: đổi sang sheet ePMP HIỆN HÀNH của Tiên (1hx8…). Sheet cũ
// 1tPOg9… đã ngừng dùng. Đổi link = sửa đúng dòng dưới rồi `npm run deploy`.
export const DEFAULT_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1hx8yzpoQio4yla3jmooni5cu1g9-M7tu/edit?usp=sharing";
