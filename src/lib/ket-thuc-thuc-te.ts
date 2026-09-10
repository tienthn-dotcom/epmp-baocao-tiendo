/**
 * NGÀY KẾT THÚC THỰC TẾ của một đầu việc — ngày lần đầu đạt 100%.
 *
 * Kho ngày (`completed:v1`) và ô "% thực tế" là HAI NGUỒN KHÁC NHAU: kho ghi theo khoá dòng và chỉ
 * đổi khi có đợt đồng bộ, còn % đọc thẳng từ file nguồn mỗi lần nạp. Hai nguồn lệch nhau là chuyện
 * bình thường:
 *   · gõ nhầm 100% rồi sửa lại xuống — kho vẫn giữ ngày cũ;
 *   · hai dòng lỡ dùng chung một khoá — ngày của dòng đã xong hiện sang dòng chưa xong.
 * Cả hai đều đọc lên thành "việc này đã kết thúc" trong khi nó mới 39%.
 *
 * Nên chốt chặn NGAY CHỖ HIỂN THỊ, không chờ kho dọn: chưa đủ 100% thì không có ngày kết thúc thực
 * tế, chấm hết. Kho sai thì đợt đồng bộ sau sẽ dọn, còn bảng thì không được nói sai một giây nào.
 */
export type KhoNgayXong = Record<string, string>;

export function ngayKetThucThucTe(
  kho: KhoNgayXong,
  khoa: string,
  pct: number | null | undefined,
): string | null {
  if (!(pct != null && pct >= 100)) return null;
  return kho[khoa] ?? null;
}
