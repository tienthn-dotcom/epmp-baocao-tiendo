/**
 * BÁO CÁO TUÂN THỦ — NHÃN THÁNG.
 *
 * MODULE NÀY TỪNG LÀM MỘT VIỆC KHÁC và việc đó ĐÃ BỊ BỎ ngày 01/10/2026. Nó từng chấm lại tháng
 * cũ từ lịch sử ngày cập nhật của app (`updates:v1`) vì tưởng rằng "file tuân thủ trên Drive chỉ
 * giữ tháng đang chạy". TIỀN ĐỀ ĐÓ SAI: đọc thẳng file sáng 01/10/2026 thấy nó giữ ĐỦ 24 cột tuần
 * từ 06/05 tới 28/10, tức cả lịch sử.
 *
 * Hậu quả của việc chấm lại: tháng 9 hiện ra 67/84 dự án, có dự án −10 và −30 điểm, một rừng dấu
 * ✕ — vì kho của app dừng ở 24/09 nên cả cột 30/09 thành "không cập nhật", trong khi FILE ghi cột
 * đó là 63 ✓ / 21 ✕.
 *
 * Anh Tiến: *"việc của app, là lấy dấu tick, dấu X từ file này lên, hiểu không?, chỉ có thế thôi"*.
 *
 * Nay xem tháng cũ = truyền `thangXem` cho `parseComplianceFile`, nó lọc đúng nhóm cột tuần của
 * tháng đó trong CHÍNH file. Không còn đường nào trong app tự sinh ra dấu ✓/✕.
 * Đừng dựng lại `doiSangDangFile` / `thangCoTheCham` / `ngayChamThang` — git còn giữ bản cũ.
 */

/** "2026-09" → "09/2026", đúng kiểu nhãn file tuân thủ đang dùng. */
export function nhanThang(monthKey: string): string {
  return `${monthKey.slice(5, 7)}/${monthKey.slice(0, 4)}`;
}
