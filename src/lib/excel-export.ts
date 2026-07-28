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
  const COL_NAME = 3, COL_DEPT = 4, COL_START = 5, COL_END = 6;
  const COL_PCTPLAN = 7, COL_PCTACT = 8, COL_OVERDUE = 9, COL_NOTE = 10;

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
