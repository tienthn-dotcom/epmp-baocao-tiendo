/**
 * ETL — gom dữ liệu 2 app (ePMP "Project Master Plan" + "Chi tiết tiến độ") về 1 SCHEMA THỐNG NHẤT
 * (ProgressRecord). Đây là KHO CHUNG dùng cho: (1) dashboard, (2) thư viện cho AI (RAG sau này).
 *
 * Kiến trúc: Extract + Transform chạy ở CLIENT (vì Cloudflare Worker KHÔNG parse được xlsx — OOM 1102),
 * rồi Load qua server-fn (saveEtlRecords) vào KV `etl:v1:<source>`. Từ kho này:
 *   • Dashboard đọc records có cấu trúc (truy vấn chính xác, không bịa số).
 *   • AI (bước sau) tóm tắt/embbed records → Vectorize để retrieval.
 */
import type { DetailProject, DetailNode } from "@/lib/detail-plan";

export type EtlSource = "epmp" | "detail";

/** 1 đầu việc/nút tiến độ đã CHUẨN HOÁ — chung cho mọi app nguồn. */
export type ProgressRecord = {
  source: EtlSource;
  projectCode: string;       // mã CT (vd CT25-070)
  projectName: string;       // tên dự án
  path: string[];            // đường dẫn phân cấp: [công đoạn, đầu việc, …] (rỗng = dòng dự án)
  level: number;             // 1 = dự án; sâu hơn = cấp con
  stt: string;               // số thứ tự trong dự án
  name: string;              // tên hạng mục/đầu việc
  stage: string;             // mã công đoạn: VT / SX / TC / TKSX…
  owner: string;             // người phụ trách
  start: string;             // dd/mm/yy
  end: string;               // dd/mm/yy
  pctPlan: number | null;    // % dự kiến
  pctActual: number | null;  // % thực tế
  qtyDone: number | null;    // khối lượng đã làm
  qtyTotal: number | null;   // khối lượng tổng
  unit: string;              // đơn vị (m², bộ, cái…)
  isLeaf: boolean;           // true = đầu việc lá (không có con)
};

export type EtlBundle = { source: EtlSource; at: string; count: number; records: ProgressRecord[] };

// ── helpers số ────────────────────────────────────────────────────────────────
const numOf = (s: string): number | null => { const t = (s || "").replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."); const v = parseFloat(t); return isFinite(v) ? v : null; };
const pctOf = (s: string): number | null => { const m = /(-?\d+(?:[.,]\d+)?)/.exec(s || ""); return m ? parseFloat(m[1].replace(",", ".")) : null; };

/** TRANSFORM: cây "Chi tiết tiến độ" (DetailProject[]) → ProgressRecord phẳng (mỗi nút 1 record). */
export function detailToRecords(projects: DetailProject[]): ProgressRecord[] {
  const out: ProgressRecord[] = [];
  // stage được KẾ THỪA từ công đoạn (node có mã VT/SX/TC…) xuống mọi đầu việc con → gom nghẽn theo công đoạn.
  const walk = (n: DetailNode, proj: DetailProject, path: string[], inheritedStage: string) => {
    const stage = (n.ma || "").toUpperCase() || inheritedStage;
    out.push({
      source: "detail",
      projectCode: proj.maCT || "",
      projectName: proj.name || "",
      path,
      level: n.level,
      stt: n.stt || "",
      name: n.name || "",
      stage,
      owner: n.owner || "",
      start: n.start || "",
      end: n.end || "",
      pctPlan: pctOf(n.pctPlan),
      pctActual: pctOf(n.pctActual),
      qtyDone: numOf(n.qtyDone),
      qtyTotal: numOf(n.qtyTotal),
      unit: n.unit || "",
      isLeaf: n.children.length === 0,
    });
    n.children.forEach((c) => walk(c, proj, n.level === 1 ? [] : [...path, n.name], stage));
  };
  projects.forEach((p) => walk(p, p, [], ""));
  return out;
}

/** TRANSFORM ePMP "Project Master Plan" → records. (Điền khi nối vào pipeline compute của ePMP —
 *  nguồn: dòng dự án/công đoạn đã parse + % thực tế + deadline + quá hạn.) */
export function epmpToRecords(_rows: unknown[]): ProgressRecord[] {
  // TODO: map từ dữ liệu đã parse của ePMP (index.tsx) sang ProgressRecord — làm ở bước nối ePMP.
  return [];
}

/** Đóng gói bundle để Load (kèm mốc thời gian ISO client). */
export function toBundle(source: EtlSource, records: ProgressRecord[], atISO: string): EtlBundle {
  return { source, at: atISO, count: records.length, records };
}
