/**
 * MTLĐ · ENGINE TÍNH CHỈ SỐ trên BẢNG DÀI (spec Phần 1.3). Tính ở mọi cấp gom, trung bình theo
 * cấp con. KHÔNG bịa số — đơn vị null bị bỏ khi lấy trung bình; bất thường đã gắn cờ ở long table.
 * (Phase 1: dùng % TỔNG theo cấp reader đọc được. Bàn giao thô/tinh theo NHÓM hạng mục = phase sau
 * khi reader đọc tới từng ô hạng mục + có phiếu khai báo nhóm.)
 */
import type { LongRow } from "./mtld-longtable";

export type Metrics = {
  duAn: string;
  pctTotal: number | null;                 // A · % hoàn thành tổng (TB các toà)
  nLeaf: number; nDone: number; nDoing: number; nNotStarted: number;  // B · đếm đơn vị lá (căn)
  nToa: number; nToaDone: number;          // C · toà xong (mọi con 100%)
  nTang: number; nTangDone: number;
  byToa: Array<{ toa: string; scope: string; pct: number | null }>;   // cho tile drill
  flags: Array<{ label: string; count: number; samples: string[] }>;  // E · cần rà
};

const isDone = (p: number | null) => p != null && p >= 0.999;

export function computeMetrics(rows: LongRow[], duAn = rows[0]?.duAn ?? ""): Metrics {
  const toaRows = rows.filter((r) => r.level === "toa");
  const tangRows = rows.filter((r) => r.level === "tang");
  const leaf = rows.filter((r) => r.level === "can");
  // % tổng = TB pct các toà (nếu chưa có toà → TB khu vực/tầng tổng).
  const aggPct = (toaRows.length ? toaRows : rows.filter((r) => r.isAgg))
    .map((r) => r.pct).filter((v): v is number => v != null);
  const pctTotal = aggPct.length ? aggPct.reduce((a, b) => a + b, 0) / aggPct.length : null;

  const leafPct = leaf.map((r) => r.pct);
  const nDone = leafPct.filter((p) => isDone(p)).length;
  const nDoing = leafPct.filter((p) => p != null && p > 0 && p < 0.999).length;
  const nNotStarted = leafPct.filter((p) => p === 0).length;

  // Toà/tầng "xong" = chính dòng tổng của nó = 100% (đọc thẳng, tôn trọng số nhập).
  const nToaDone = toaRows.filter((r) => isDone(r.pct)).length;
  const nTangDone = tangRows.filter((r) => isDone(r.pct)).length;

  const flagMap = new Map<string, string[]>();
  for (const r of rows) if (r.flag) {
    const arr = flagMap.get(r.flag) ?? []; if (arr.length < 5) arr.push(`${r.toa}${r.tang ? "/" + r.tang : ""} ${r.donVi}`.trim());
    flagMap.set(r.flag, arr);
  }
  const flags = [...flagMap.entries()].map(([label, samples]) => ({ label, count: samples.length, samples }));

  return {
    duAn, pctTotal,
    nLeaf: leaf.length, nDone, nDoing, nNotStarted,
    nToa: toaRows.length, nToaDone, nTang: tangRows.length, nTangDone,
    byToa: toaRows.map((r) => ({ toa: r.toa, scope: r.scope, pct: r.pct })),
    flags,
  };
}
