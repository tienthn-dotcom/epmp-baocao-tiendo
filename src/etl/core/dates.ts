/** ETL core · dates — chuẩn hoá NGÀY từ nhiều format; giữ cờ ambiguity khi không rõ dd/mm hay mm/dd. */
const MONTHS_EN: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export type ParsedDate = { iso: string | null; ambiguous: boolean };

/** dd/mm/yy(yy) → ms UTC (mặc định VN dd/mm). null nếu không parse được. */
export function parseVN(s: string): number | null {
  const m = /(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(s || "");
  if (!m) return null;
  let y = +m[3]; if (y < 100) y += 2000;
  return Date.UTC(y, +m[2] - 1, +m[1]);
}

/** Chuẩn hoá → "YYYY-MM-DD". Xử lý: dd/mm/yyyy · yyyy-mm-dd · "12 Aug 2026" · Excel serial. */
export function toIsoDate(v: unknown, opts: { prefer?: "dmy" | "mdy" } = {}): ParsedDate {
  if (v == null || v === "") return { iso: null, ambiguous: false };
  if (typeof v === "number" && v > 366 && v < 80000) {          // Excel serial
    const ms = Date.UTC(1899, 11, 30) + Math.round(v) * 86400000;
    return { iso: new Date(ms).toISOString().slice(0, 10), ambiguous: false };
  }
  const s = String(v).trim();
  let mm = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);              // ISO
  if (mm) return { iso: `${mm[1]}-${pad(+mm[2])}-${pad(+mm[3])}`, ambiguous: false };
  mm = /^(\d{1,2})\s*[-/ ]\s*([A-Za-z]{3,})\s*[-/ ]\s*(\d{2,4})/.exec(s);   // 12 Aug 2026
  if (mm) { const mo = MONTHS_EN[mm[2].slice(0, 3).toLowerCase()]; if (mo) return { iso: `${yr(+mm[3])}-${pad(mo)}-${pad(+mm[1])}`, ambiguous: false }; }
  mm = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(s);      // numeric d/m or m/d
  if (mm) {
    const a = +mm[1], b = +mm[2], y = yr(+mm[3]);
    const ambiguous = a <= 12 && b <= 12;                        // cả hai ≤12 → không chắc
    const dmy = opts.prefer !== "mdy";
    const day = dmy ? a : b, mon = dmy ? b : a;
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) return { iso: `${y}-${pad(mon)}-${pad(day)}`, ambiguous };
  }
  return { iso: null, ambiguous: false };
}

const pad = (n: number) => String(n).padStart(2, "0");
const yr = (y: number) => (y < 100 ? 2000 + y : y);
