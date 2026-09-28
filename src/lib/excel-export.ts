/**
 * Xuất báo cáo Excel (.xlsx) — CẤU TRÚC NHÓM XỔ XUỐNG:
 *   • Dòng cha (outlineLevel 0): dự án, gộp số liệu từ các đầu việc con.
 *   • Dòng con (outlineLevel 1, ẩn mặc định): từng đầu việc theo giai đoạn.
 *   • Nút +/− nằm ở dòng cha (summaryBelow=false). Mở file → nhóm thu lại.
 *
 * Dùng ExcelJS để ghi outline + màu nền ô. KHÔNG dùng xlsx community.
 */

import type ExcelJSType from "exceljs";
import type { ItemRow, ProjectRow } from "./types";
// NOTE: exceljs được import ĐỘNG bên trong exportMatrixXlsx() để tránh nổ ở SSR.



/* ─────────── Stage → Department mapping cho XUẤT EXCEL  ─────────── */
export type ExportDeptKey = "PM" | "SCM" | "NM" | "SD/P" | "QS" | "HR";
export const EXPORT_DEPT_ORDER: ExportDeptKey[] = ["PM", "SCM", "NM", "SD/P", "QS", "HR"];

export function stageToExportDept(rawCode: string): ExportDeptKey | null {
  const c = rawCode.trim().toUpperCase();
  if (/^TKSX|^SD/.test(c)) return "SD/P";
  if (/^TK/.test(c)) return "PM";
  if (/^TC/.test(c)) return "PM";
  if (/^MA|^DM/.test(c)) return "SCM";
  if (/^VT/.test(c)) return "SCM";
  if (/^SX/.test(c)) return "NM";
  if (/^BG/.test(c)) return "QS";
  return null;
}

/* ─────────── Color palette ─────────── */
export type CellColor = "RED" | "ORANGE" | "YELLOW" | "GRAY" | "GREEN";
export const COLOR_BG: Record<CellColor, string> = {
  RED:    "FFC0392B",
  ORANGE: "FFE67E22",
  YELLOW: "FFF1C40F",
  GRAY:   "FFBDC3C7",
  GREEN:  "FF27AE60",
};
export const COLOR_BG_HEX: Record<CellColor, string> = {
  RED: "#C0392B", ORANGE: "#E67E22", YELLOW: "#F1C40F", GRAY: "#BDC3C7", GREEN: "#27AE60",
};
export const COLOR_FG_HEX: Record<CellColor, string> = {
  RED: "#FFFFFF", ORANGE: "#1B1B1B", YELLOW: "#1B1B1B", GRAY: "#1B1B1B", GREEN: "#FFFFFF",
};
const COLOR_FG: Record<CellColor, string> = {
  RED: "FFFFFFFF", ORANGE: "FF1B1B1B", YELLOW: "FF1B1B1B", GRAY: "FF1B1B1B", GREEN: "FFFFFFFF",
};
const COLOR_LABEL_VI: Record<CellColor, string> = {
  RED:    "Đỏ — Lệch lớn hơn ngưỡng (Trễ tiến độ)",
  ORANGE: "Cam — Lệch trong khoảng (½ ngưỡng, ngưỡng]",
  YELLOW: "Vàng — Lệch nhẹ hoặc chỉ quá hạn quá ngưỡng ngày",
  GRAY:   "Xám — Không có đầu việc hoặc chưa tới kỳ",
  GREEN:  "Xanh — Đúng/vượt tiến độ hoặc đã hoàn thành",
};

/* ─────────── Gradient helpers (ARGB) ─────────── */
function hexToRgb(hex: string): [number, number, number] {
  // hex: 8-char ARGB or 6-char RGB
  const h = hex.length === 8 ? hex.slice(2) : hex;
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
function rgbToArgb(r: number, g: number, b: number): string {
  const t = (n: number) => Math.round(Math.max(0,Math.min(255,n))).toString(16).padStart(2,"0").toUpperCase();
  return `FF${t(r)}${t(g)}${t(b)}`;
}
function rgbToHex(r: number, g: number, b: number): string {
  const t = (n: number) => Math.round(Math.max(0,Math.min(255,n))).toString(16).padStart(2,"0");
  return `#${t(r)}${t(g)}${t(b)}`;
}
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function lerpColor(lightArgb: string, darkArgb: string, t: number): { argb: string; hex: string; r:number; g:number; b:number } {
  const [r1,g1,b1] = hexToRgb(lightArgb);
  const [r2,g2,b2] = hexToRgb(darkArgb);
  const r = lerp(r1,r2,t), g = lerp(g1,g2,t), b = lerp(b1,b2,t);
  return { argb: rgbToArgb(r,g,b), hex: rgbToHex(r,g,b), r, g, b };
}
const RED_LIGHT  = "FFFCE9E7";
const RED_DARK   = "FFC0392B";
const YEL_LIGHT  = "FFFEF6D9";
const YEL_DARK   = "FFE6A700";

export function gapShade(planPct: number | null, actualPct: number | null, gapThreshold: number) {
  if (planPct == null || actualPct == null) return null;
  const gap = planPct - actualPct;
  if (gap <= 0) return null;
  const t = Math.min(gap / Math.max(1, gapThreshold), 1);
  const c = lerpColor(RED_LIGHT, RED_DARK, t);
  // luminance for text contrast
  const lum = (0.299*c.r + 0.587*c.g + 0.114*c.b) / 255;
  return { ...c, fg: lum < 0.55 ? "#FFFFFF" : "#1B1B1B", fgArgb: lum < 0.55 ? "FFFFFFFF" : "FF1B1B1B", t };
}
export function overdueShade(overdueDays: number | null | undefined, overdueThreshold: number) {
  const od = overdueDays ?? 0;
  if (od <= 0) return null;
  const t = Math.min(od / Math.max(1, overdueThreshold), 1);
  const c = lerpColor(YEL_LIGHT, YEL_DARK, t);
  const lum = (0.299*c.r + 0.587*c.g + 0.114*c.b) / 255;
  return { ...c, fg: lum < 0.55 ? "#FFFFFF" : "#1B1B1B", fgArgb: lum < 0.55 ? "FFFFFFFF" : "FF1B1B1B", t };
}

/* ─────────── Helper math ─────────── */
function daysInclusive(aIso: string, bIso: string): number {
  const ta = new Date(aIso.slice(0, 10) + "T00:00:00Z").getTime();
  const tb = new Date(bIso.slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((tb - ta) / 86400000) + 1;
}

/** Kẹp giá trị % về [0,100]. Áp dụng cho cả % dự kiến lẫn % thực tế. */
export function clampPct(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, v));
}

export function computePlanPct(startIso: string | null, finishIso: string | null, todayIso: string): number | null {
  if (!startIso || !finishIso) return null;
  const total = daysInclusive(startIso, finishIso);
  if (total <= 0) return null;
  const todayTs = new Date(todayIso.slice(0, 10) + "T00:00:00Z").getTime();
  const startTs = new Date(startIso.slice(0, 10) + "T00:00:00Z").getTime();
  const finishTs = new Date(finishIso.slice(0, 10) + "T00:00:00Z").getTime();
  const minTs = Math.min(todayTs, finishTs);
  const elapsed = Math.round((minTs - startTs) / 86400000) + 1;
  const pct = (elapsed / total) * 100;
  // KẸP về [0,100]: hôm nay trước Bắt đầu → 0%; sau Kết thúc → 100%.
  return Math.max(0, Math.min(100, pct));
}

/** Tính màu cho ô (project × dept) theo thang 5 mức. */
export function computeDeptColor(
  items: ItemRow[],
  todayIso: string,
  gapThreshold: number,
  overdueThreshold: number,
): CellColor {
  if (items.length === 0) return "GRAY";
  const inProgress = items.filter((it) => {
    if (!it.start) return true;
    return it.start.slice(0, 10) <= todayIso.slice(0, 10);
  });
  if (inProgress.length === 0) return "GRAY";

  let worstG = -Infinity;
  let maxO = 0;
  for (const it of inProgress) {
    const plan = computePlanPct(it.start, it.deadline, todayIso);
    const act = clampPct(it.pctActual);
    const g = plan != null && act != null ? plan - act : -Infinity;
    if (g > worstG) worstG = g;
    if ((it.overdueDays ?? 0) > maxO) maxO = it.overdueDays ?? 0;
  }

  if (worstG > gapThreshold) return "RED";
  if (worstG > gapThreshold / 2) return "ORANGE";
  if (worstG > 0) return "YELLOW";
  if (worstG <= 0 && maxO > overdueThreshold) return "YELLOW";
  return "GREEN";
}

/** Màu trạng thái cho TỪNG đầu việc (child row). */
function itemColor(it: ItemRow, todayIso: string, gapThreshold: number, overdueThreshold: number): CellColor {
  const actC = clampPct(it.pctActual);
  if (actC != null && actC >= 100) return "GREEN";
  if (!it.start) return "GRAY";
  if (it.start.slice(0, 10) > todayIso.slice(0, 10)) return "GRAY";
  const plan = computePlanPct(it.start, it.deadline, todayIso);
  const g = plan != null && actC != null ? plan - actC : null;
  const o = it.overdueDays ?? 0;
  if (g != null && g > gapThreshold) return "RED";
  if (o > overdueThreshold) return "RED";
  if (g != null && g > gapThreshold / 2) return "ORANGE";
  if (g != null && g > 0) return "YELLOW";
  return "GREEN";
}

/* ─────────── Project aggregation ─────────── */
type ProjectAgg = {
  project: ProjectRow;
  items: ItemRow[];
  start: string | null;
  finish: string | null;
  days: number | null;
  pctActual: number | null;
  pctPlan: number | null;
  overdueMax: number;
  notes: string;
};

function aggregateProject(project: ProjectRow, items: ItemRow[], todayIso: string): ProjectAgg {
  // Dòng dự án: ngày lấy ĐÚNG ô trên dòng dự án trong file gốc (không min/max của các công đoạn).
  const start = project.start ?? null;
  const finish = project.deadline ?? null;
  const days = start && finish ? daysInclusive(start, finish) : null;

  const actVals = items.map(i => clampPct(i.pctActual)).filter((v): v is number => v != null);
  const pctActual = actVals.length ? actVals.reduce((a, b) => a + b, 0) / actVals.length : null;
  // % dự kiến của DỰ ÁN: tính từ span riêng của dự án, KHÔNG lấy trung bình các công đoạn con.
  const pctPlan = computePlanPct(start, finish, todayIso);

  const overdueMax = items.reduce((m, i) => Math.max(m, i.overdueDays ?? 0), 0);

  const notes = Array.from(new Set(
    items.map(i => (i.note || "").trim()).filter(Boolean)
  )).join("\n");

  return { project, items, start, finish, days, pctActual, pctPlan, overdueMax, notes };
}

/* ─────────── Formatter ─────────── */
function fmtVN(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/* ─────────── Public API ─────────── */
export type ExportOptions = {
  projects: ProjectRow[];
  /** DEPRECATED — giữ để back-compat; ưu tiên visibleProjects nếu có. */
  visibleProjectCodes?: string[];
  /** Khoá nhận diện DỰ ÁN: (code + name) — vì nhiều parent row có thể trùng code
   *  (ví dụ CT25-070 có cả "Lobby" và "Nhà hàng Maxine"). Lọc theo code không đủ. */
  visibleProjects?: Array<{ code: string; name: string }>;
  allItems: ItemRow[];
  todayIso: string;
  gapThreshold: number;
  overdueThreshold: number;
  filterSummary: string;
  updatedAt?: string;
};

export async function exportMatrixXlsx(opts: ExportOptions): Promise<void> {
  const {
    projects, visibleProjectCodes, visibleProjects, allItems, todayIso,
    gapThreshold, overdueThreshold, filterSummary, updatedAt,
  } = opts;

  // Khoá nhận diện DỰ ÁN = code + "\u0000" + name. Một code có thể ứng với nhiều
  // dự án khác nhau (ví dụ CT25-070: "Lobby", "Nhà hàng Maxine"…). Chỉ dùng code
  // sẽ kéo nhầm cả các dự án không thuộc tập đã lọc.
  const keyOf = (code: string, name: string) => `${code}\u0000${name}`;
  const visibleKeySet = visibleProjects
    ? new Set(visibleProjects.map(p => keyOf(p.code, p.name)))
    : null;
  const visibleCodeSet = !visibleKeySet && visibleProjectCodes
    ? new Set(visibleProjectCodes)
    : null;

  void allItems; // intentionally unused (kept in ExportOptions for back-compat)
  const visibleProjectsFiltered = projects.filter(p =>
    visibleKeySet ? visibleKeySet.has(keyOf(p.code, p.name))
    : visibleCodeSet ? visibleCodeSet.has(p.code)
    : true
  );
  // Xuất ĐỦ MỌI giai đoạn của dự án (kể cả đã 100%) — dùng allItems từ parser.
  // Bộ lọc chỉ dùng để CHỌN dự án; KHÔNG cắt bớt dòng giai đoạn của dự án đó.
  const aggs = visibleProjectsFiltered.map(p => aggregateProject(p, p.allItems ?? p.items, todayIso));


  // Pre-compute 6-dept colors per project, keyed by array index (codes may repeat).
  const deptColorsByIdx = new Map<number, Record<ExportDeptKey, CellColor>>();
  aggs.forEach((agg, i) => {
    const colors = {} as Record<ExportDeptKey, CellColor>;
    for (const dept of EXPORT_DEPT_ORDER) {
      if (dept === "HR") { colors[dept] = "GRAY"; continue; }
      const deptItems = agg.items.filter(it => stageToExportDept(it.rawCode) === dept);
      colors[dept] = computeDeptColor(deptItems, todayIso, gapThreshold, overdueThreshold);
    }
    deptColorsByIdx.set(i, colors);
  });

  /* ─── Build workbook (dynamic import — client only) ─── */
  const ExcelJS = ((await import("exceljs")) as any).default ?? (await import("exceljs"));
  const wb: ExcelJSType.Workbook = new ExcelJS.Workbook();
  wb.creator = "PMO Master Plan";
  wb.created = new Date();

  const ws = wb.addWorksheet("Báo cáo", {
    views: [{ state: "frozen", ySplit: 3 }],
    properties: { outlineLevelRow: 1, defaultRowHeight: 16 } as any,
  });
  (ws.properties as any).outlineProperties = { summaryBelow: false, summaryRight: false };

  // Header columns — KHÔNG có "Số ngày", có 6 cột màu bộ phận ở cuối.
  // Cột "Bộ phận" thay cho "Người phụ trách" — gán cứng theo công đoạn, không đọc từ file.
  const HEADERS = [
    "STT", "Mã CT", "Tên dự án / Giai đoạn", "Bộ phận",
    "Bắt đầu", "Kết thúc",
    "% dự kiến", "% thực tế", "Quá hạn", "Vướng mắc / Cần xử lý",
    ...EXPORT_DEPT_ORDER,
  ];
  const N = HEADERS.length;
  const DEPT_START = N - EXPORT_DEPT_ORDER.length + 1; // 11
  // Column indices (1-based) after dropping "Số ngày"
  const COL_START = 5, COL_END = 6;
  const COL_PCTPLAN = 7, COL_PCTACT = 8, COL_OVERDUE = 9;

  // Bảng tra Bộ phận theo công đoạn (CỐ ĐỊNH — không đọc từ file).
  const STAGE_TO_DEPT_LABEL: Record<string, string> = {
    "Phát hành thiết kế":  "PM",
    "Trình duyệt mẫu":     "SCM",
    "LOA/Tạm ứng":         "QS",
    "Đặt vật tư":          "SCM",
    "Triển khai sản xuất": "PM",
    "Sản xuất nhập kho":   "NM",
    "Thi công lắp đặt":    "PM",
  };


  // Fixed row height for ALL data rows
  const ROW_H = 20;

  // Title (row 1) merged
  const titleRow = ws.addRow([
    `Báo cáo tiến độ Master Plan — Số liệu tính đến ${fmtVN(todayIso)}${updatedAt ? ` · Dữ liệu cập nhật ${fmtVN(updatedAt)}` : ""}`,
  ]);
  ws.mergeCells(1, 1, 1, N);
  titleRow.getCell(1).font = { name: "Arial", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF16202E" } };
  titleRow.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  titleRow.height = 24;

  const critRow = ws.addRow([
    `Tiêu chí: lệch > ${gapThreshold} điểm phần trăm · quá hạn > ${overdueThreshold} ngày · Phạm vi: ${filterSummary}`,
  ]);
  ws.mergeCells(2, 1, 2, N);
  critRow.getCell(1).font = { name: "Arial", italic: true, size: 10, color: { argb: "FF5B6B7E" } };
  critRow.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  critRow.height = 18;

  const headerRow = ws.addRow(HEADERS);
  headerRow.eachCell((cell) => {
    cell.font = { name: "Arial", bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF16202E" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top:    { style: "medium", color: { argb: "FF16202E" } },
      bottom: { style: "medium", color: { argb: "FF16202E" } },
      left:   { style: "thin",   color: { argb: "FFE2E6EB" } },
      right:  { style: "thin",   color: { argb: "FFE2E6EB" } },
    };
  });
  headerRow.height = 30;

  const thinBorder = {
    top:    { style: "thin" as const, color: { argb: "FFCBD5E0" } },
    bottom: { style: "thin" as const, color: { argb: "FFCBD5E0" } },
    left:   { style: "thin" as const, color: { argb: "FFCBD5E0" } },
    right:  { style: "thin" as const, color: { argb: "FFCBD5E0" } },
  };

  // Thứ tự hoàn thành dự án (đồng bộ với databar/bảng): TK→BG→MA→VT→SD→SX→TC.
  const STAGE_ORDER: Record<string, number> = {
    "Phát hành thiết kế": 1,
    "LOA/Tạm ứng": 2,
    "Trình duyệt mẫu": 3,
    "Đặt vật tư": 4,
    "Triển khai sản xuất": 5,
    "Sản xuất nhập kho": 6,
    "Thi công lắp đặt": 7,
    "Khác": 99,
  };

  const RIGHT_COLS = new Set([1, COL_PCTPLAN, COL_PCTACT, COL_OVERDUE]);
  const CENTER_COLS = new Set([2, COL_START, COL_END]);

  aggs.forEach((agg, idx) => {
    const p = agg.project;
    const colors = deptColorsByIdx.get(idx)!;

    /* ─── PARENT ROW ─── */
    const parentRow = ws.addRow([
      idx + 1,
      p.maCT || p.code,
      p.name,
      "—", // Bộ phận: trống ở dòng dự án
      fmtVN(agg.start),
      fmtVN(agg.finish),
      "", "", "", // % dự kiến, % thực tế, Quá hạn — không hiện ở dòng dự án
      agg.notes,
      ...EXPORT_DEPT_ORDER.map(() => ""),
    ]);
    parentRow.outlineLevel = 0;
    parentRow.height = ROW_H;

    parentRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF16202E" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDF2F7" } };
      // KHÔNG wrap text ở Tên / Vướng mắc để không kéo cao hàng
      cell.alignment = { vertical: "middle", wrapText: false,
        horizontal: RIGHT_COLS.has(colNumber) ? "right"
                   : CENTER_COLS.has(colNumber) ? "center"
                   : "left" };
      cell.border = thinBorder;
    });

    // 6 dept color cells on parent
    EXPORT_DEPT_ORDER.forEach((dept, i) => {
      const cell = parentRow.getCell(DEPT_START + i);
      const color = colors[dept];
      cell.value = dept;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_BG[color] } };
      cell.font = { name: "Arial", size: 10, bold: true, color: { argb: COLOR_FG[color] } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = thinBorder;
    });

    /* ─── CHILD ROWS — gộp theo giai đoạn: mỗi giai đoạn chỉ MỘT dòng ─── */
    const byStage = new Map<string, ItemRow[]>();
    for (const it of agg.items) {
      const k = it.stage;
      const arr = byStage.get(k) ?? [];
      arr.push(it);
      byStage.set(k, arr);
    }
    type MergedStage = {
      stage: string;
      rawCode: string;
      desc: string;
      owner: string;
      start: string | null;
      deadline: string | null;
      pctActual: number | null;
      overdueDays: number | null;
      note: string;
      representative: ItemRow;
    };
    const merged: MergedStage[] = [];
    for (const [stage, list] of byStage) {
      const sorted = [...list].sort((a, b) => (a.start || "").localeCompare(b.start || ""));
      const starts = sorted.map(i => i.start).filter((s): s is string => !!s).sort();
      const finishes = sorted.map(i => i.deadline).filter((s): s is string => !!s).sort();
      const acts = sorted.map(i => clampPct(i.pctActual)).filter((v): v is number => v != null);
      const owner = sorted.find(i => (i.owner || "").trim())?.owner.trim() || "";
      const descs = Array.from(new Set(sorted.map(i => i.desc.trim()).filter(Boolean))).join(" · ");
      const notes = Array.from(new Set(sorted.map(i => (i.note || "").trim()).filter(Boolean))).join("\n");
      merged.push({
        stage,
        rawCode: sorted[0].rawCode,
        desc: descs,
        owner,
        start: starts[0] ?? null,
        deadline: finishes[finishes.length - 1] ?? null,
        pctActual: acts.length ? acts.reduce((a, b) => a + b, 0) / acts.length : null,
        overdueDays: sorted.reduce((m, i) => Math.max(m, i.overdueDays ?? 0), 0) || null,
        note: notes,
        representative: sorted[0],
      });
    }
    const children = merged.sort((a, b) => {
      const sa = STAGE_ORDER[a.stage] ?? 50;
      const sb = STAGE_ORDER[b.stage] ?? 50;
      if (sa !== sb) return sa - sb;
      return (a.start || "").localeCompare(b.start || "");
    });

    // ── SELF-CHECK tầng QUERY/BUILD: số dòng giai đoạn xuất ra phải bằng
    //    số giai đoạn duy nhất trong nguồn (allItems của project).
    const sourceStages = new Set((p.allItems ?? p.items).map(it => it.stage));
    if (children.length !== sourceStages.size) {
      console.warn(
        `[excel-export] LỆCH STAGE: ${p.code} "${p.name}" — xuất ${children.length} dòng / nguồn ${sourceStages.size} stage`,
        { exported: children.map(c => c.stage), source: [...sourceStages] }
      );
    }
    children.forEach((it, childIdx) => {
      const plan = computePlanPct(it.start, it.deadline, todayIso);
      const repForColor: ItemRow = { ...it.representative, start: it.start, deadline: it.deadline, pctActual: it.pctActual, overdueDays: it.overdueDays };
      const status = itemColor(repForColor, todayIso, gapThreshold, overdueThreshold);

      const r = ws.addRow([
        `${idx + 1}.${childIdx + 1}`,
        it.rawCode,
        `    ${it.desc && it.desc.trim() ? it.desc : it.stage}`,
        STAGE_TO_DEPT_LABEL[it.stage] ?? "—",
        fmtVN(it.start),
        fmtVN(it.deadline),
        plan != null ? Math.round(plan) / 100 : "",
        it.pctActual != null ? Math.round(clampPct(it.pctActual)!) / 100 : "",
        it.overdueDays ?? "",
        it.note || "",
        ...EXPORT_DEPT_ORDER.map(() => ""),
      ]);
      r.outlineLevel = 1;
      r.hidden = true;
      r.height = ROW_H;

      r.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.font = { name: "Arial", size: 10, color: { argb: "FF1B1B1B" } };
        cell.alignment = { vertical: "middle", wrapText: false,
          horizontal: RIGHT_COLS.has(colNumber) ? "right"
                     : CENTER_COLS.has(colNumber) ? "center"
                     : "left" };
        cell.border = thinBorder;
        if (colNumber === COL_PCTPLAN || colNumber === COL_PCTACT) cell.numFmt = "0%;(0%);-";
        if (colNumber === COL_OVERDUE) cell.numFmt = "#,##0;(#,##0);-";
      });

      const stt = r.getCell(1);
      stt.border = {
        ...thinBorder,
        left: { style: "thick", color: { argb: COLOR_BG[status] } },
      };
      const rs = gapShade(plan, clampPct(it.pctActual), gapThreshold);
      if (rs) {
        const c = r.getCell(COL_PCTACT);
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rs.argb } };
        c.font = { name: "Arial", size: 10, bold: true, color: { argb: rs.fgArgb } };
      }
      const os = overdueShade(it.overdueDays, overdueThreshold);
      if (os) {
        const c = r.getCell(COL_OVERDUE);
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: os.argb } };
        c.font = { name: "Arial", size: 10, bold: true, color: { argb: os.fgArgb } };
      }
    });
  });

  // Column widths: STT, Mã CT, Tên, Bộ phận, Bắt đầu, Kết thúc, %DK, %TT, Quá hạn, Vướng mắc, + 6 dept
  const widths = [7, 12, 42, 12, 12, 12, 10, 10, 10, 48, 8, 8, 8, 10, 8, 8];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });



  /* ─── Sheet Chú thích ─── */
  const ws2 = wb.addWorksheet("Chú thích");
  ws2.addRow(["Màu", "Ý nghĩa"]);
  ws2.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws2.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF16202E" } };
  ws2.getRow(1).alignment = { horizontal: "center" };
  (["RED", "ORANGE", "YELLOW", "GRAY", "GREEN"] as CellColor[]).forEach((c) => {
    const r = ws2.addRow(["", COLOR_LABEL_VI[c]]);
    const cell = r.getCell(1);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_BG[c] } };
    cell.font = { bold: true, color: { argb: COLOR_FG[c] } };
    cell.alignment = { horizontal: "center" };
    cell.value = c;
  });
  ws2.addRow([]);
  ws2.addRow(["Cấu trúc", "Mỗi dự án là dòng cha; bấm dấu + ở lề trái để xổ ra các đầu việc con theo giai đoạn."]);
  ws2.addRow(["Quy tắc", `1) Không có đầu việc HOẶC mọi việc chưa tới kỳ → Xám`]);
  ws2.addRow(["",         `2) Lệch (% dự kiến − % thực tế) > ${gapThreshold} điểm phần trăm → Đỏ`]);
  ws2.addRow(["",         `3) Lệch trong khoảng (${gapThreshold / 2}, ${gapThreshold}] điểm → Cam`]);
  ws2.addRow(["",         `4) 0 < Lệch ≤ ${gapThreshold / 2} HOẶC quá hạn > ${overdueThreshold} ngày → Vàng`]);
  ws2.addRow(["",         `5) Còn lại (đúng/vượt tiến độ hoặc đã hoàn thành) → Xanh lá`]);
  ws2.getColumn(1).width = 14;
  ws2.getColumn(2).width = 90;

  /* ─── Save (Blob + <a download>, không cần file-saver) ─── */
  const buf = await wb.xlsx.writeBuffer();
  const dStr = todayIso.replace(/-/g, "");
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `BaoCao_TienDo_${dStr}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ══════════════════════════════════════════════════════════════════════════════════════
 *  XUẤT EXCEL "Y HỆT BẢNG / PDF" — cùng cột, cùng dòng (gộp dự án + xổ công đoạn con), cùng màu
 *  trạng thái. Khác PDF ở chỗ đây là Ô THẬT (lọc/sort/sửa trong Excel được), không phải ảnh chụp.
 *  Nhận DỮ LIỆU ĐÃ DỰNG SẴN từ index.tsx (nơi có đủ helper) để module này không phụ thuộc kiểu nội bộ.
 * ═════════════════════════════════════════════════════════════════════════════════════ */
export type XlsxStatusColor = "RED" | "AMBER" | "GREEN" | null;

/**
 * Giá trị một ô. `Date` và `number` là Ô THẬT — Excel sắp xếp, lọc "lớn hơn", cộng được.
 * `null` là Ô TRỐNG THẬT, khác hẳn `0` và khác hẳn chuỗi rỗng: xem `oNgay` bên dưới.
 */
export type XlsxCell = string | number | Date | null;

/**
 * ISO → `Date` cho ô Excel. Không đọc được thì trả `null`, KHÔNG trả ngày 1900 và không trả 0.
 *
 * VÌ SAO CẮT CHUỖI CHỨ KHÔNG `new Date(iso)`: `new Date("2026-09-15")` là 00:00 giờ UTC, còn
 * `new Date("2026-09-15T00:00:00+07:00")` lùi về 17:00 ngày 14 theo giờ UTC — mà exceljs quy Date
 * ra số thứ tự của Excel theo UTC. Đi đường đó thì một phần dữ liệu **lệch đúng một ngày** trong
 * im lặng, và đây là bảng dùng để đánh giá PM. Nên lấy thẳng ba số Y-M-D trong chuỗi rồi dựng
 * UTC midnight — ra ĐÚNG ngày mà `fmtDateVN2` đang hiện trên bảng, vì hàm đó cũng chỉ cắt chuỗi.
 *
 * Khác một chỗ với `fmtDateVN2`: hàm đó trả chữ `"—"` khi không có ngày, còn đây trả `null` để ô
 * TRỐNG THẬT (luật 5.2). Chữ `"—"` nằm trong cột ngày sẽ phá luôn phép sắp xếp của Excel.
 */
export function oNgay(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

export type XlsxTableRow = {
  kind: "group" | "item";
  /** Giá trị từng cột, ĐÚNG thứ tự columns. */
  cells: XlsxCell[];
  /** Màu ô "Tình trạng". */
  statusColor?: XlsxStatusColor;
  /** Dòng dự án đã bàn giao → tô XANH LÁ (như bảng). */
  delivered?: boolean;
  /** Dòng dự án quá hạn bàn giao → cột ngày kết thúc ĐỎ (như badge trên bảng). */
  late?: boolean;
  /** Đầu việc đang quá hạn → cả hàng tô nền ấm + mép trái, như hàng quá hạn trên app. */
  overdue?: boolean;
};

const STATUS_FILL: Record<"RED" | "AMBER" | "GREEN", { bg: string; fg: string }> = {
  RED:   { bg: "FFEF4444", fg: "FFFFFFFF" },
  AMBER: { bg: "FFF59E0B", fg: "FF1B1B1B" },
  GREEN: { bg: "FF059669", fg: "FFFFFFFF" },
};

/**
 * BẢNG MÀU — CHÉP TỪ APP, nguồn gốc là hằng `GC` trong `src/routes/index.tsx` (~dòng 7530).
 *
 * VÌ SAO CHÉP CHỨ KHÔNG KÉO `GC` RA DÙNG CHUNG: `GC` khai BÊN TRONG component Gantt đang chạy và
 * không export. Kéo nó ra là sửa vào đường render của bảng Gantt để phục vụ một việc thuần trình
 * bày của Excel — đúng loại thay đổi L11 (sửa một chỗ làm gãy chỗ khác, diff sạch, test xanh, giao
 * diện vẫn hỏng). Cái giá của việc chép là hai bảng màu có thể trôi xa nhau, nên đã có
 * `tests/excel-mau-khop-app.test.ts` đọc thẳng `GC` trong index.tsx và bắt lệch.
 *
 * ĐỔI Ở ĐÂY THÌ ĐỔI CẢ `GC`, và ngược lại.
 */
const MAU = {
  header:     "FF334155",   // GC.headerBg  — thanh tiêu đề + hàng tiêu đề cột
  duAn:       "FF334964",   // GC.bar       — dòng dự án
  duAnXong:   "FF059669",   // dự án đã bàn giao (đã dùng sẵn, giữ nguyên)
  nenCon:     "FFF8FAFC",   // GC.childBg   — nền dòng công đoạn con
  quaHanNen:  "FFFCEFDD",   // GC.overdueBg — nền hàng quá hạn
  quaHanMep:  "FFE0A458",   // GC.overdueEdge — mép trái hàng quá hạn
  hoanThanh:  "FF5EE9B5",   // GC.done      — thanh % chạy trong ô
} as const;

export async function exportTableXlsx(opts: {
  /** `numFmt` = định dạng HIỂN THỊ của cột (ví dụ `dd/mm/yy`). Giá trị bên dưới vẫn là ngày/số
   *  thật — đây chỉ là cách Excel vẽ nó ra, để bảng nhìn y hệt bản cũ toàn chữ. */
  columns: { label: string; width: number; wrap?: boolean; align?: "left" | "center"; numFmt?: string }[];
  /** Chỉ số (0-based) cột "Tình trạng" để tô màu ô đó. */
  statusColIndex: number;
  /** Cột ngày kết thúc (0-based) để tô ĐỎ khi dự án quá hạn. -1 nếu không có. */
  finishColIndex: number;
  /** Cột "% thực tế" (0-based) — để chạy thanh màu trong ô. -1 nếu không có. */
  pctColIndex?: number;
  /** Cột "Quá hạn" (0-based) — để tô theo bậc cảnh báo. -1 nếu không có. */
  overdueColIndex?: number;
  /** Ngưỡng quá hạn NẶNG, ngày. Lấy từ `OD_ALERT_DAYS` của lib/filter, đừng đặt số mới ở đây. */
  overdueAlertDays?: number;
  rows: XlsxTableRow[];
  todayIso: string;
  filterSummary: string;
  updatedAt?: string;
}): Promise<void> {
  const ExcelJS = ((await import("exceljs")) as any).default ?? (await import("exceljs"));
  const wb: ExcelJSType.Workbook = new ExcelJS.Workbook();
  wb.creator = "PMO Master Plan";
  wb.created = new Date();

  const ws = wb.addWorksheet("Báo cáo", {
    // Đóng băng CẢ CỘT lẫn hàng: cuộn sang phải đọc Vướng mắc / Giải pháp vẫn thấy đang ở dự án
    // nào. xSplit 3 = giữ lại Ngày update · Mã · Tên dự án.
    // `showGridLines: false` — một dòng nhưng đổi nhiều nhất về cảm nhận. Còn lưới thì mắt đọc ra
    // "bảng tính"; tắt đi, cùng với dải màu và khối tiêu đề, mới đọc ra "báo cáo". Bản PDF không có
    // lưới vì nó chụp giao diện web (card trắng trên nền xám), đây là chỗ Excel bám gần nó nhất.
    views: [{ state: "frozen", xSplit: 3, ySplit: 3, showGridLines: false }],
    properties: { outlineLevelRow: 1, defaultRowHeight: 16 } as any,
    pageSetup: {
      orientation: "landscape", paperSize: 9,              // 9 = A4
      fitToPage: true, fitToWidth: 1, fitToHeight: 0,      // vừa MỘT trang bề ngang, dài bao nhiêu trang cũng được
      printTitlesRow: "3:3",                               // lặp hàng tiêu đề cột ở mọi trang
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
      horizontalCentered: true,
    } as any,
  });
  (ws.properties as any).outlineProperties = { summaryBelow: false, summaryRight: false };
  // Số trang ở chân mỗi trang in — bản in nhiều trang mà không đánh số thì rời ra là lẫn.
  (ws as any).headerFooter = { oddFooter: "&C&9Trang &P / &N", evenFooter: "&C&9Trang &P / &N" };

  const N = opts.columns.length;
  ws.columns = opts.columns.map((c) => ({ width: c.width }));

  // Dòng 1: tiêu đề — dòng 2: phạm vi lọc — dòng 3: header cột (đóng băng).
  const titleRow = ws.addRow([`Báo cáo tiến độ Master Plan — tính đến ${fmtVN(opts.todayIso)}${opts.updatedAt ? ` · Dữ liệu cập nhật ${fmtVN(opts.updatedAt)}` : ""}`]);
  ws.mergeCells(1, 1, 1, N);
  titleRow.getCell(1).font = { name: "Arial", bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: MAU.header } };
  titleRow.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  titleRow.height = 22;

  const critRow = ws.addRow([`Phạm vi: ${opts.filterSummary || "Tất cả"}`]);
  ws.mergeCells(2, 1, 2, N);
  critRow.getCell(1).font = { name: "Arial", italic: true, size: 10, color: { argb: "FF5B6B7E" } };
  critRow.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  critRow.height = 16;

  const headerRow = ws.addRow(opts.columns.map((c) => c.label));
  headerRow.height = 26;
  headerRow.eachCell((cell, col) => {
    cell.font = { name: "Arial", bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MAU.header } };
    cell.alignment = { horizontal: opts.columns[col - 1]?.align === "left" ? "left" : "center", vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: MAU.quaHanMep } } };
  });

  const thin = { style: "thin" as const, color: { argb: "FFE2E8F0" } };
  for (const r of opts.rows) {
    const row = ws.addRow(r.cells);
    const isGroup = r.kind === "group";
    row.outlineLevel = isGroup ? 0 : 1;
    if (!isGroup) row.hidden = true; // công đoạn con thu lại mặc định (mở nhóm để xem)
    // KHÔNG đặt `row.height`. Excel CHỈ tự giãn chiều cao khi hàng không có chiều cao đặt tay —
    // đặt cứng 20/18 như bản cũ thì hai cột Vướng mắc / Giải pháp (rộng 48, có xuống dòng) bị CẮT
    // CỤT, mất hẳn phần chữ phía dưới. Đây là thứ hỏng rõ nhất khi đặt file cạnh bản PDF.
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const cidx = col - 1;
      const c = opts.columns[cidx];
      cell.font = { name: "Arial", size: 9.5, bold: isGroup, color: { argb: isGroup ? "FFFFFFFF" : "FF1B1B1B" } };
      cell.alignment = { horizontal: c?.align === "left" ? "left" : "center", vertical: "middle", wrapText: !!c?.wrap };
      cell.border = { bottom: thin, right: thin };
      // Dòng công đoạn con: nền xám rất nhạt để tách khỏi dòng dự án; đang quá hạn thì nền ấm +
      // mép trái dày, đúng như hàng quá hạn trên app.
      if (!isGroup) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: r.overdue ? MAU.quaHanNen : MAU.nenCon } };
        if (r.overdue && cidx === 0) cell.border = { bottom: thin, right: thin, left: { style: "medium", color: { argb: MAU.quaHanMep } } };
      }
      // Ô có giá trị thật mới đóng định dạng hiển thị. Ô TRỐNG thì để nguyên trống — đóng `dd/mm/yy`
      // lên ô rỗng là mời Excel vẽ ra ngày 00/01/00, tức biến "chưa có" thành một ngày có thật.
      if (c?.numFmt && cell.value != null && cell.value !== "") cell.numFmt = c.numFmt;
      if (isGroup) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: r.delivered ? MAU.duAnXong : MAU.duAn } };
      }
      // Ô ngày kết thúc dự án quá hạn → nền đỏ chữ trắng (như badge đỏ trên bảng).
      if (isGroup && r.late && cidx === opts.finishColIndex) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEF4444" } };
        cell.font = { name: "Arial", size: 9.5, bold: true, color: { argb: "FFFFFFFF" } };
      }
      // Ô "Tình trạng" — tô theo màu trạng thái (đỏ/vàng/xanh) như badge.
      if (cidx === opts.statusColIndex && r.statusColor) {
        const sc = STATUS_FILL[r.statusColor];
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sc.bg } };
        cell.font = { name: "Arial", size: 9.5, bold: true, color: { argb: sc.fg } };
      }
    });
  }

  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: N } };

  const dongDau = 4;                        // 3 dòng đầu là tiêu đề / phạm vi lọc / header cột
  const dongCuoi = 3 + opts.rows.length;
  const chuCot = (i: number) => { let s = "", n = i + 1; while (n > 0) { const d = (n - 1) % 26; s = String.fromCharCode(65 + d) + s; n = Math.floor((n - 1) / 26); } return s; };

  if (opts.rows.length) {
    // ── THANH MÀU TRONG Ô "% THỰC TẾ" ────────────────────────────────────────────────────────
    // Thứ gần nhất với thanh tiến độ của bản PDF mà Excel làm được thật. CHỈ chạy được vì cột này
    // đã là Ô SỐ (việc V4a) — data bar không vẽ gì trên ô chữ.
    // Ô TRỐNG KHÔNG ĐƯỢC VẼ GÌ: Excel bỏ qua ô rỗng khi vẽ data bar, nên "chưa đo" vẫn là một ô
    // trắng trơn chứ không thành thanh dài 0 trông như 0%. Luật 5.2 áp cho cả phần nhìn.
    //
    // THANG 0..100 DÍNH CHẶT VÀO CÁCH CỘT NÀY LƯU SỐ: cột % đang lưu `85` (kèm định dạng hiển thị
    // `0"%"`), không lưu `0.85`. Ai đổi sang lối `0.85` + định dạng `0%` thì PHẢI đổi `cfvo` xuống
    // 0..1, nếu không mọi thanh màu co lại còn khoảng 1% bề ngang ô mà chẳng có gì báo lỗi.
    if (opts.pctColIndex != null && opts.pctColIndex >= 0) {
      const c = chuCot(opts.pctColIndex);
      ws.addConditionalFormatting({
        ref: `${c}${dongDau}:${c}${dongCuoi}`,
        rules: [{
          type: "dataBar", priority: 1, gradient: false,
          minLength: 0, maxLength: 100, showValue: true,
          cfvo: [{ type: "num", value: 0 }, { type: "num", value: 100 }],
          color: { argb: MAU.hoanThanh },
        } as any],
      });
    }

    // ── CỘT "QUÁ HẠN" TÔ THEO BẬC CẢNH BÁO CỦA APP ───────────────────────────────────────────
    // KHÔNG tự chế thang màu liên tục. App chia đúng hai bậc (lib/filter.ts:138):
    // quá hạn >= OD_ALERT_DAYS là bậc A, còn > 0 là bậc B. Tô theo đúng hai bậc đó.
    // Ô trống: Excel coi ô rỗng là không khớp `greaterThan 0`, nên "chưa có số" không bị tô.
    if (opts.overdueColIndex != null && opts.overdueColIndex >= 0) {
      const c = chuCot(opts.overdueColIndex);
      const nguong = opts.overdueAlertDays ?? 14;
      ws.addConditionalFormatting({
        ref: `${c}${dongDau}:${c}${dongCuoi}`,
        rules: [
          { type: "cellIs", operator: "greaterThanOrEqual", priority: 1, formulae: [String(nguong)],
            style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: STATUS_FILL.RED.bg } },
                     font: { bold: true, color: { argb: "FFFFFFFF" } } } } as any,
          { type: "cellIs", operator: "greaterThan", priority: 2, formulae: ["0"],
            style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: MAU.quaHanNen } } } } as any,
        ],
      });
    }
  }

  // ── CHÚ GIẢI CUỐI BẢNG ───────────────────────────────────────────────────────────────────
  // PDF có, Excel chưa. Viết theo ĐÚNG luật của app, và luật đó KHÔNG phải "mỗi nhãn một màu":
  // ghi chú ở index.tsx (~1381) nói rõ màu tách rời nhãn — "Cần tập trung" vàng khi dự án còn xa
  // hạn nhưng ĐỎ khi sắp bàn giao, "Cần cắt đầu việc" vàng ở far và đỏ từ d30 — kèm câu
  // "KHÔNG được suy màu từ kind". Nên chú giải nói MÀU = MỨC NGHIÊM TRỌNG, rồi liệt kê nhãn
  // riêng. Gán chết mỗi nhãn một màu là in ra một luật mà app không chạy theo.
  ws.addRow([]);
  const cgTieuDe = ws.addRow(["CHÚ GIẢI"]);
  cgTieuDe.getCell(1).font = { name: "Arial", bold: true, size: 10, color: { argb: MAU.header } };

  const oMau = (r: ExcelJSType.Row, cot: number, chu: string, bg: string, fg: string) => {
    const o = r.getCell(cot);
    o.value = chu;
    o.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    o.font = { name: "Arial", size: 9, bold: true, color: { argb: fg } };
    o.alignment = { horizontal: "center", vertical: "middle" };
  };

  // CHỮ lấy ĐÚNG chú giải trên app (`index.tsx` ~4802: Hoàn thành · Cảnh báo đỏ · Cảnh báo vàng ·
  // Đang triển khai), để ai đặt file cạnh màn hình không thấy hai cách gọi khác nhau cho một thứ.
  // MÀU thì lấy của chính file này (STATUS_FILL) chứ không lấy màu chip trên app: chú giải phải
  // giải thích đúng những ô đang nằm trong bảng, chứ không phải một sắc độ khác ở chỗ khác.
  const hangMau = ws.addRow([]);
  oMau(hangMau, 1, "Hoàn thành", STATUS_FILL.GREEN.bg, STATUS_FILL.GREEN.fg);
  oMau(hangMau, 2, "Cảnh báo đỏ", STATUS_FILL.RED.bg, STATUS_FILL.RED.fg);
  oMau(hangMau, 3, "Cảnh báo vàng", STATUS_FILL.AMBER.bg, STATUS_FILL.AMBER.fg);
  // Trên app đây là chip xám; trong file thì "đang triển khai" = ô Tình trạng ĐỂ TRỐNG, nên phải
  // nói ra chứ đừng để người đọc tự đoán ô trống nghĩa là thiếu dữ liệu.
  oMau(hangMau, 4, "Đang triển khai (ô trống)", MAU.nenCon, "FF1B1B1B");
  hangMau.getCell(5).value = "Màu nói MỨC NGHIÊM TRỌNG, không dính chết vào nhãn: cùng một nhãn có thể vàng khi dự án còn xa hạn và đỏ khi sắp bàn giao.";
  hangMau.getCell(5).font = { name: "Arial", italic: true, size: 9, color: { argb: "FF5B6B7E" } };

  const hangNhan = ws.addRow([]);
  hangNhan.getCell(1).value = "Nhãn tình trạng:";
  hangNhan.getCell(1).font = { name: "Arial", bold: true, size: 9, color: { argb: "FF1B1B1B" } };
  hangNhan.getCell(2).value = "Trễ tiến độ  ·  Cần cắt đầu việc  ·  Cần tập trung  ·  Đã hoàn thành";
  hangNhan.getCell(2).font = { name: "Arial", size: 9, color: { argb: "FF1B1B1B" } };

  const hangKhac = ws.addRow([]);
  hangKhac.getCell(1).value = "Dòng bảng:";
  hangKhac.getCell(1).font = { name: "Arial", bold: true, size: 9, color: { argb: "FF1B1B1B" } };
  oMau(hangKhac, 2, "Dự án", MAU.duAn, "FFFFFFFF");
  oMau(hangKhac, 3, "Đã bàn giao", MAU.duAnXong, "FFFFFFFF");
  oMau(hangKhac, 4, "Đầu việc quá hạn", MAU.quaHanNen, "FF1B1B1B");
  hangKhac.getCell(5).value = `Cột "Quá hạn" tô đỏ khi từ ${opts.overdueAlertDays ?? 14} ngày trở lên. Ô trống = chưa có số, khác với 0.`;
  hangKhac.getCell(5).font = { name: "Arial", italic: true, size: 9, color: { argb: "FF5B6B7E" } };

  const buf = await wb.xlsx.writeBuffer();
  const dStr = opts.todayIso.replace(/-/g, "");
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `BaoCao_TienDo_${dStr}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
