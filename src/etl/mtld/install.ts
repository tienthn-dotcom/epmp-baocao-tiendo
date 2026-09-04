/**
 * ETL · MTLĐ — trích xuất "Thi công lắp đặt" từ file báo cáo THẬT (mỗi dự án 1 định dạng) → canonical.
 * THUẦN hàm (nhận rows: (string|number|null)[][]) → chạy CLIENT (Worker không parse xlsx).
 *
 * Archetype (soi 4 file thật 17/08/26):
 *   A — "nhãn | %" xếp NGANG, % dạng "80%" (HYATT, TÂY HỒ). ĐÃ verify.
 *   C — bảng DỌC theo căn, trạng thái "HT/ĐT" (TROPICAL). ĐÃ verify.
 *   B — ma trận theo NGÀY, đếm SỐ phòng (MINI HOTEL) — dùng matrix-reader.ts sẵn có / kế tiếp.
 * Bộ trích xuất trả zones + % + overall để ePMP vẽ chart + hiện % tổng.
 */

export type InstallRow = {
  zone: string;              // nhóm: Tầng 1 / Căn hộ đại trà / Khách sạn…
  item: string;              // phòng/tầng/căn cụ thể
  percent: number | null;    // % hoàn thành (0..100)
  source_row: number;        // dòng gốc (lineage)
};
export type ZoneSummary = { zone: string; count: number; avg: number | null };
export type InstallExtract = {
  archetype: "A_percent_pairs" | "C_status_table" | "unknown";
  rows: InstallRow[];
  zones: ZoneSummary[];
  overall: number | null;    // % tổng (trung bình các mục có số)
  asOf?: string;             // ngày chốt (nếu dò được ở tiêu đề)
};

const S = (v: unknown) => (v == null ? "" : String(v).trim());
/** ô % : "80%", "0 %", "80,5%" → 0..100 (bắt BUỘC có dấu %). */
export function pctOf(v: unknown): number | null {
  const m = /^(\d{1,3}(?:[.,]\d+)?)\s*%$/.exec(S(v));
  return m ? Math.max(0, Math.min(100, parseFloat(m[1].replace(",", ".")))) : null;
}
const isPctCell = (v: unknown) => pctOf(v) != null;
// header % chung chung → KHÔNG lấy làm tên zone (dùng header cột nhãn thay)
const GENERIC = /% *ho[àa]n th[àa]nh|% *l[ắa]p|^%|hoàn thành lắp đặt/i;
const asOfOf = (rows: (string | number | null)[][]) => {
  for (let r = 0; r < Math.min(rows.length, 3); r++) {
    for (const cell of rows[r] ?? []) { const m = /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(S(cell)); if (m) return S(cell); }
  }
  return undefined;
};

/** Archetype A: các cặp (cột nhãn, cột %) xếp ngang. Trả về mọi (zone, item, %). */
export function extractPercentPairs(rows: (string | number | null)[][]): InstallExtract {
  const nCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const out: InstallRow[] = [];
  for (let c = 0; c < nCols; c++) {
    // cột % = có >=2 ô "N%"
    let cnt = 0, firstData = -1;
    for (let r = 0; r < rows.length; r++) if (isPctCell(rows[r]?.[c])) { cnt++; if (firstData < 0) firstData = r; }
    if (cnt < 2) continue;
    const labelCol = c - 1; if (labelCol < 0) continue;
    // tên zone = ô header không rỗng gần nhất phía trên (ưu tiên header cột % nếu không generic, else header cột nhãn)
    let zone = "";
    for (let r = firstData - 1; r >= 0 && r >= firstData - 4; r--) {
      const hz = S(rows[r]?.[c]), hl = S(rows[r]?.[labelCol]);
      if (hz && !GENERIC.test(hz) && !isPctCell(hz)) { zone = hz; break; }
      if (hl && !isPctCell(hl)) { zone = hl; break; }
    }
    if (!zone) zone = `Cột ${c + 1}`;
    for (let r = firstData; r < rows.length; r++) {
      const p = pctOf(rows[r]?.[c]); const label = S(rows[r]?.[labelCol]);
      if (p == null || !label || isPctCell(label)) continue;
      out.push({ zone, item: label, percent: p, source_row: r + 1 });
    }
  }
  return finalize(out, "A_percent_pairs", asOfOf(rows));
}

function finalize(rows: InstallRow[], archetype: InstallExtract["archetype"], asOf?: string): InstallExtract {
  const byZone = new Map<string, number[]>();
  for (const r of rows) if (r.percent != null) (byZone.get(r.zone) ?? byZone.set(r.zone, []).get(r.zone)!).push(r.percent);
  const zones: ZoneSummary[] = [...byZone.entries()].map(([zone, vs]) => ({ zone, count: vs.length, avg: vs.length ? Math.round(vs.reduce((s, v) => s + v, 0) / vs.length) : null }));
  const all = rows.map((r) => r.percent).filter((v): v is number => v != null);
  const overall = all.length ? Math.round(all.reduce((s, v) => s + v, 0) / all.length) : null;
  return { archetype: rows.length ? archetype : "unknown", rows, zones, overall, asOf };
}

// ── Archetype C: bảng DỌC theo căn/đơn vị, ô trạng thái "HT" (hoàn thành) / "ĐT" (đang triển khai) ──
// Mỗi CỘT hạng mục = 1 zone; % = số ô HT ÷ (HT + đang làm). Bỏ ô số (dòng tổng kết) + ô trống.
const DONE_TOKEN = /^(ht|htc|xong|done|ho[àa]n th[àa]nh|hoan thanh)$/i;
const PENDING_TOKEN = /^(đt|dt|đang|dang|ch[ưu]a|pending|wip|hl|tc)$/i;
const isDoneCell = (v: unknown) => DONE_TOKEN.test(S(v));
const isStatusCell = (v: unknown) => { const s = S(v); return DONE_TOKEN.test(s) || PENDING_TOKEN.test(s); };

export function extractStatusTable(rows: (string | number | null)[][]): InstallExtract {
  const nCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  // cột trạng thái = cột có ≥3 ô "HT" (đặc hiệu — tránh nhầm cột tên NCC có chữ ngắn)
  const statusCols: number[] = [];
  let firstDataRow = Infinity;
  for (let c = 0; c < nCols; c++) {
    let done = 0, firstAt = Infinity;
    for (let r = 0; r < rows.length; r++) if (isDoneCell(rows[r]?.[c])) { done++; firstAt = Math.min(firstAt, r); }
    if (done >= 3) { statusCols.push(c); firstDataRow = Math.min(firstDataRow, firstAt); }
  }
  if (!statusCols.length) return finalize([], "unknown");
  const firstStatusCol = Math.min(...statusCols);
  // cột NHÃN (mã căn/đơn vị) = cột bên trái vùng trạng thái có NHIỀU giá trị KHÁC nhau nhất ở vùng data
  let labelCol = -1, bestUniq = 0;
  for (let c = 0; c < firstStatusCol; c++) {
    const seen = new Set<string>();
    for (let r = firstDataRow; r < rows.length; r++) { const v = S(rows[r]?.[c]); if (v) seen.add(v); }
    if (seen.size > bestUniq) { bestUniq = seen.size; labelCol = c; }
  }
  // tên zone mỗi cột = ô header DÀI NHẤT phía trên vùng data (thường là tên hạng mục chi tiết)
  const zoneName = (c: number) => {
    let best = "";
    for (let r = 0; r < firstDataRow; r++) { const v = S(rows[r]?.[c]); if (v.length > best.length && !isStatusCell(v)) best = v; }
    return (best || `Cột ${c + 1}`).slice(0, 45);
  };
  const out: InstallRow[] = [];
  for (let r = firstDataRow; r < rows.length; r++) {
    const label = (labelCol >= 0 ? S(rows[r]?.[labelCol]) : "") || `#${r + 1}`;
    for (const c of statusCols) {
      const v = rows[r]?.[c];
      if (!isStatusCell(v)) continue;              // bỏ ô số (tổng kết) + trống
      out.push({ zone: zoneName(c), item: label, percent: isDoneCell(v) ? 100 : 0, source_row: r + 1 });
    }
  }
  return finalize(out, "C_status_table", asOfOf(rows));
}

/** Điểm vào chung: tự nhận diện — thử A (nhãn|%) trước; ít kết quả thì thử C (trạng thái HT). */
export function extractInstall(rows: (string | number | null)[][]): InstallExtract {
  const a = extractPercentPairs(rows);
  if (a.rows.length >= 3) return a;
  const c = extractStatusTable(rows);
  return c.rows.length >= a.rows.length ? c : a;
}
