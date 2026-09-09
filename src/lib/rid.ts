/**
 * RID — mã dòng do PMO tự điền ở cột đầu. Đây là KHOÁ BỀN NHẤT của một đầu việc: ghi chú, dòng ẩn,
 * ngày hoàn thành đều bám vào nó, nên đánh lại STT cũng không làm note lạc dòng.
 *
 * 09/09/2026 nguồn ĐỔI CÁCH GHI: trước là số trần ("1"), nay có tiền tố ("ePMP 1") cho chắc, khỏi
 * lẫn với STT. Đổi cách ghi mà không xử lý thì mọi ghi chú đang nằm ở khoá `rid:1` hoá mồ côi —
 * dòng vẫn đó nhưng note biến mất.
 *
 * Nên ở đây:
 *   · khoá CHÍNH lấy dạng chuẩn hoá (bỏ khoảng trắng, in hoa) → "ePMP 1", "ePMP1", "epmp 1" cùng
 *     ra một khoá, người điền gõ kiểu nào cũng trúng;
 *   · kèm khoá DỰ PHÒNG dạng cũ (phần số) để note viết trước ngày đổi vẫn hiện nguyên.
 *
 * KHÔNG di trú KV hàng loạt — đúng cách app đang xử lý mấy đời khoá trước đó (xem itemKeysOf trong
 * routes/index.tsx): đọc dự phòng theo thứ tự, ghi mới vào khoá nào ĐANG CÓ dữ liệu.
 */

const gon = (s: string): string => s.trim().replace(/\s+/g, "");

/** Dạng chuẩn của RID để làm khoá. "ePMP 1" · "ePMP1" · "epmp  1" → "EPMP1". */
export function ridChuan(rid: string): string {
  return gon(rid).toUpperCase();
}

/**
 * Các khoá `rid:` của một dòng, theo thứ tự ưu tiên:
 *   1. dạng chuẩn — đích GHI của note mới;
 *   2. đúng chữ trong file — phòng khi có note đã ghi trước lúc chuẩn hoá;
 *   3. phần số trần — đời cũ, khi RID chưa có tiền tố.
 * Trả mảng rỗng nếu dòng không có RID (nguồn cũ chưa thêm cột).
 */
export function ridKeys(rid: string | undefined | null): string[] {
  const raw = (rid ?? "").trim();
  if (!raw) return [];
  const ks = [`rid:${ridChuan(raw)}`];
  const them = (k: string) => { if (!ks.includes(k)) ks.push(k); };
  them(`rid:${raw}`);
  const so = raw.replace(/\D+/g, "");
  // Chỉ thêm khoá số khi RID THẬT SỰ có tiền tố; RID vốn là số trần thì khoá số chính là khoá chuẩn.
  if (so && so !== gon(raw)) them(`rid:${so}`);
  return ks;
}
