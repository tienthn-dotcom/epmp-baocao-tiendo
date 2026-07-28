/**
 * HỆ SỐ CO GIÃN CỦA BẢNG — một nguồn duy nhất cho cả màn hình lẫn Xuất PDF.
 *
 * Nguyên tắc auto-fit: cỡ chữ bảng TỈ LỆ THUẬN với bề rộng BẢNG. Độ rộng cột là %, và
 * mọi kích thước bên trong tính bằng `em`, nên tỉ lệ chữ/cột không đổi ở mọi bề rộng
 * ⇒ bảng không bao giờ đè chữ, màn nào cũng y hệt nhau, chỉ khác cỡ.
 *
 * Hệ số = 11px ÷ 1532px — 1532px là bề rộng thật của bảng ở màn 1920 (layout có
 * max-w-[1600px]), và 11px là cỡ chữ PMO đang dùng. Giữ đúng con số này nghĩa là màn
 * 1920 KHÔNG đổi gì so với trước.
 *
 * Hai nơi tiêu thụ, PHẢI dùng chung hằng số này, nếu không PDF sẽ khác màn hình:
 *   • Màn hình  — routes/index.tsx: font-size: <TABLE_FONT_CSS> (đơn vị cqw, đo theo
 *     div bọc có container-type: inline-size).
 *   • Xuất PDF  — lib/pdf-export.ts: ép bảng về PDF_TABLE_WIDTH px nên `cqw` không còn
 *     đúng (div bọc vẫn giữ bề rộng thật) → phải ép luôn cỡ chữ bằng PDF_TABLE_FONT_PX.
 */
export const TABLE_FONT_RATIO = 11 / 1532;

/** Giá trị CSS cho cỡ chữ bảng trên màn hình (cqw = 1% bề rộng div bọc). */
export const TABLE_FONT_CSS = `${(TABLE_FONT_RATIO * 100).toFixed(3)}cqw`;

/** Bề rộng cố định khi chụp PDF — để PDF giống nhau trên mọi màn/trình duyệt. */
export const PDF_TABLE_WIDTH = 1280;

/** Cỡ chữ tương ứng khi chụp PDF. Trước đây ghi cứng 11px cho bảng 1280px — SAI tỉ lệ
 *  (11px là cỡ dành cho bảng 1532px), làm badge rộng hơn cột và tràn trong bản PDF. */
export const PDF_TABLE_FONT_PX = +(PDF_TABLE_WIDTH * TABLE_FONT_RATIO).toFixed(2);
