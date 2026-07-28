/**
 * MTLĐ · "1 LOẠI DATA" — NẤU CHẢY mọi ma trận (khác dạng) về BẢNG DÀI CHUẨN (long table).
 * Ranh giới giữa tầng ĐỌC (matrix-reader) và tầng TÍNH (mtld-metrics). App chỉ tính trên bảng
 * dài này. Xem spec Phần 1.2. Tầng bắt rác gắn cờ NGAY tại đây (không tự điền/suy đoán).
 */
import type { MatrixResult, RawLevel } from "./monitor-types";

/** Quy đổi trạng thái → số (chốt 1 lần, cấu hình được). HT/X=1 · ĐT=0.5 · Chưa/0/trống=0. */
export type StatusMap = Record<string, number>;
export const DEFAULT_STATUS_MAP: StatusMap = { HT: 1, X: 1, "ĐT": 0.5, DT: 0.5, "CHƯA": 0, "0": 0, "": 0 };

export type LongRow = {
  duAn: string;
  vung: string;
  toa: string;
  tang: string;
  donVi: string;        // đơn vị nhỏ nhất đọc được (căn / khu vực / tầng)
  scope: "public" | "rooms" | "other";
  level: RawLevel;
  isAgg: boolean;        // dòng tổng (khu/tầng/toà) hay lá
  pct: number | null;    // 0..1 (đọc thẳng cột TỔNG). null = trống
  flag: string | null;   // ⚠ cần rà (mẫu số lệch / %>100 / trống giữa vùng / trạng thái lạ)
};

/** Nấu chảy kết quả reader (nhiều sheet ma trận của 1 dự án) → bảng dài. */
export function meltToLongTable(
  sheets: Array<{ sheet: string; result: MatrixResult }>,
  duAn: string,
  vung = "(chưa map)",
): LongRow[] {
  const rows: LongRow[] = [];
  for (const { sheet, result } of sheets) {
    if (!result.ok) continue;
    const scope: LongRow["scope"] = /public/i.test(result.goi) || /public/i.test(sheet) ? "public" : "rooms";
    for (const u of result.units) {
      // Tầng bắt rác: %>100 hoặc <0 → cờ (KHÔNG loại, để lộ ra).
      let flag: string | null = null;
      if (u.pct != null && (u.pct < 0 || u.pct > 1)) flag = "% ngoài [0,1] — cần rà";
      else if (u.isAgg && u.pct == null) flag = "dòng tổng rỗng — nghi bỏ sót nhập";
      else if (u.overridden) flag = "ô tổng gõ đè tay — rà so trung bình con";
      rows.push({
        duAn, vung, toa: u.toa, tang: u.tang, donVi: u.name, scope,
        level: u.level, isAgg: u.isAgg, pct: u.pct, flag,
      });
    }
  }
  return rows;
}
