/**
 * ETL · profiler — Structure Profiler. Dò cấu trúc 1 sheet TRƯỚC khi semantic mapping.
 * KHÔNG giả định "row 1 = header": tự tìm hàng tiêu đề + phân loại kiểu từng cột từ mẫu giá trị.
 */
import { toNumber } from "@/etl/core/num";
import { toIsoDate } from "@/etl/core/dates";

export type ColType = "empty" | "number" | "percent" | "currency" | "date" | "id" | "text";
export type ColumnProfile = {
  index: number; header: string; type: ColType;
  nullRate: number; uniqueRate: number; samples: string[];
};
export type SheetProfile = {
  name: string; rows: number; cols: number;
  headerRow: number; dataStartRow: number; columns: ColumnProfile[];
};

const S = (v: unknown) => (v == null ? "" : String(v).trim());
const round = (n: number) => Math.round(n * 100) / 100;
const frac = (a: string[], f: (s: string) => boolean) => (a.length ? a.filter(f).length / a.length : 0);
const isDateLike = (s: string) => /^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/.test(s) || /^\d{4}-\d{2}-\d{2}/.test(s) || toIsoDate(s).iso != null;
const isCurrencyLike = (s: string) => /[₫$]|đ$|vn[dđ]/i.test(s) || (/\d[.,]\d{3}/.test(s) && /[₫đ]/.test(s));
const isPctLike = (s: string) => /%$/.test(s);

/** Tìm hàng tiêu đề: trong ~25 hàng đầu, hàng nhiều ô CHỮ (label) nhất VÀ có dữ liệu bên dưới. */
export function detectHeaderRow(rows: (string | number | null)[][]): number {
  const N = Math.min(rows.length, 25);
  let best = 0, bestScore = -1;
  for (let r = 0; r < N; r++) {
    const row = rows[r] ?? [];
    const nonEmpty = row.filter((v) => S(v) !== "").length;
    if (nonEmpty < 2) continue;
    const textCells = row.filter((v) => { const s = S(v); return s !== "" && toNumber(s) == null && !isDateLike(s); }).length;
    const below = rows[r + 1] ?? [];
    const belowFill = below.filter((v) => S(v) !== "").length;
    const score = textCells * 2 + nonEmpty + (belowFill >= Math.max(2, nonEmpty - 2) ? 3 : 0);
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

export function profileSheet(name: string, rows: (string | number | null)[][]): SheetProfile {
  const headerRow = rows.length ? detectHeaderRow(rows) : 0;
  const dataStartRow = headerRow + 1;
  const header = rows[headerRow] ?? [];
  const nCols = Math.max(header.length, ...rows.map((r) => r?.length ?? 0), 0);
  const total = Math.max(0, rows.length - dataStartRow);
  const columns: ColumnProfile[] = [];
  for (let c = 0; c < nCols; c++) {
    const cells: string[] = [];
    for (let r = dataStartRow; r < rows.length; r++) { const v = S(rows[r]?.[c]); if (v !== "") cells.push(v); }
    columns.push(profileColumn(c, S(header[c]), cells, total));
  }
  return { name, rows: rows.length, cols: nCols, headerRow, dataStartRow, columns };
}

function profileColumn(index: number, header: string, cells: string[], total: number): ColumnProfile {
  const nullRate = total > 0 ? 1 - cells.length / total : 1;
  const uniqueRate = cells.length ? new Set(cells).size / cells.length : 0;
  const sample = cells.slice(0, 60);
  let type: ColType = "empty";
  if (cells.length) {
    if (frac(sample, isPctLike) > 0.5) type = "percent";
    else if (frac(sample, isCurrencyLike) > 0.4) type = "currency";
    else if (frac(sample, isDateLike) > 0.7) type = "date";
    else if (uniqueRate > 0.95 && frac(sample, (s) => /^[A-Za-z0-9._-]+$/.test(s) && /\d/.test(s)) > 0.6) type = "id";
    else if (frac(sample, (s) => toNumber(s) != null) > 0.8) type = "number";
    else type = "text";
  }
  return { index, header, type, nullRate: round(nullRate), uniqueRate: round(uniqueRate), samples: cells.slice(0, 5) };
}
