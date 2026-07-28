/**
 * Số ngày trễ deadline — NGUỒN DUY NHẤT trong toàn app.
 *
 * Công thức Excel gốc:
 *   IF( OR( TODAY() - Finish <= 0 ; %ThựcTế = 100% ) ; 0 ; TODAY() - Finish )
 *
 * Quy ước:
 *  - Thiếu Finish (deadline)            → null   (không tính, hiển thị "—")
 *  - Hôm nay ≤ Finish hoặc đã 100%       → 0     (chưa trễ / đã xong)
 *  - Ngược lại                          → today − Finish (theo ngày, làm tròn)
 *
 * "Hôm nay" mặc định = ngày địa phương (bỏ giờ). So sánh ở mức NGÀY.
 * %ThựcTế chấp nhận cả dạng 1 (decimal) và 100 (percent) đều coi là hoàn thành.
 */

/** Ngày địa phương dạng YYYY-MM-DD (không lệch theo giờ/UTC). */
export function todayLocalIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayDiff(aIso: string, bIso: string): number {
  const a = new Date(aIso.slice(0, 10) + "T00:00:00Z").getTime();
  const b = new Date(bIso.slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((a - b) / 86400000);
}

export type OverdueInput = {
  /** ISO ngày kết thúc/Finish của đầu việc. */
  deadline: string | null;
  /** % thực tế. Coi là hoàn thành nếu = 100 (hoặc = 1 cho nguồn chưa chuẩn hóa). */
  pctActual: number | null;
};

/** Trả về số ngày trễ deadline theo công thức Excel gốc. */
export function getDaysOverdue(
  item: OverdueInput,
  todayIso: string = todayLocalIso(),
): number | null {
  if (!item.deadline) return null;
  const pct = item.pctActual;
  if (pct != null && pct >= 100) return 0;
  const diff = dayDiff(todayIso, item.deadline);
  return diff <= 0 ? 0 : diff;
}
