/**
 * MỞ POPUP LÀ TỰ LẤY BẢN MỚI — nếu file nguồn đã đổi.
 *
 * Anh Tiến 13/10/2026: *"lúc nào bấm vào thi công lắp đặt -> tự cập nhật lại chart pop up"*.
 *
 * ── CHUYỆN ĐANG XẢY RA ──────────────────────────────────────────────────────────────────────
 * Chart trong popup lấy từ kho cache (KV), và kho đó chỉ được làm mới vào 18:00 với 20:00. BCH sửa
 * ma trận lúc 9 giờ sáng thì tới chiều mở popup vẫn ra bản tối qua — số cũ mà nhìn y như số mới.
 * Muốn thấy bản mới phải tự bấm "Cập nhật lại", mà không ai biết lúc nào cần bấm.
 *
 * ── VÌ SAO KHÔNG ÉP TẢI LẠI MỖI LẦN MỞ ──────────────────────────────────────────────────────
 * Ép Google dựng lại PDF mỗi lần mở là mỗi lần chờ 2-4 giây VÀ một lượt ghi KV. Gói free cho 1.000
 * lượt ghi mỗi ngày, app đã tràn thật một lần (03/10/2026). Mở popup là việc làm cả ngày, nên ép
 * tải lại là vừa chậm vừa đốt hạn mức cho những lần file CHẲNG HỀ đổi.
 *
 * ── CÁCH LÀM: HỎI NGÀY SỬA TRƯỚC, TẢI SAU ───────────────────────────────────────────────────
 * Hỏi Drive ngày sửa cuối của file (một mẩu JSON, nhẹ và nhanh) rồi so với mốc của bản đang xem:
 *   · file mới hơn  → tải lại, người xem thấy số mới mà không phải bấm gì;
 *   · không mới hơn → giữ nguyên bản cache, không tốn gì thêm.
 * Ngày thường thì nhánh thứ hai chạy, tức là gần như không thêm chi phí nào.
 */

/** Chênh lệch đồng hồ cho qua. Mốc cache do Worker đóng (Date.now), còn ngày sửa do Google đóng —
 *  hai đồng hồ lệch nhau vài giây là bình thường, mà lệch kiểu đó thì lần mở nào cũng "thấy mới"
 *  rồi tải lại vô ích. 15 giây đủ nuốt sai số, vẫn bắt được mọi lần sửa thật. */
export const DU_SAI_MS = 15_000;

/**
 * Bản đang xem có CŨ HƠN file nguồn không.
 *
 * @param tsCache      mốc của bản đang xem (getSheetPdf / getSummaryFile trả về `ts`)
 * @param modifiedTime ngày sửa cuối của file trên Drive (ISO), null khi chưa hỏi được
 *
 * Thiếu một trong hai thì trả false — KHÔNG đoán. Không biết mà cứ tải lại thì thành ra ép tải
 * lại mỗi lần mở, đúng cái đang tránh.
 */
export function canLamMoi(tsCache: number | null | undefined, modifiedTime: string | null | undefined): boolean {
  if (!tsCache || !modifiedTime) return false;
  const t = Date.parse(modifiedTime);
  if (!Number.isFinite(t)) return false;
  return t > tsCache + DU_SAI_MS;
}

/** Trạng thái để giao diện nói một câu ngắn. */
export type TrangThaiTuMoi = "cho" | "dang" | "moiNhat" | "daLamMoi" | "hut";

/** Câu hiện cho người xem. Rỗng = không hiện gì (đừng bày chữ khi chẳng có gì để nói). */
export function nhanTuMoi(t: TrangThaiTuMoi): string {
  if (t === "dang") return "Đang xem có bản mới không…";
  if (t === "daLamMoi") return "Đã lấy bản mới nhất";
  return "";
}
