/**
 * RENDER SHEET "Summary" → HTML tô màu y hệt Excel (popup "Thi công lắp đặt").
 * Thuần, chạy browser + node. 3 phần:
 *   1) TOP: bảng Ngày/Tổng/Hôm trước/Hôm nay/Lũy kế/Còn lại (×B1-B5 cho giao thô/tinh/xoá) +
 *      data-bar 3 ô tổng + panel "Tốc độ xoá list Defect".
 *   2) BLOCKS: mỗi B1..B9 một bảng riêng → mọi ô màu BẰNG NHAU (tách merge ngang), bỏ L01.
 *   3) LEGEND: swatch + diễn giải + số lượng (đọc thẳng từ file).
 * Bảng màu (từ conditional-formatting gốc): 1=kem · 2=cyan · 3=xanh dương · 4=cam · 5=xanh lá ·
 *   " "=đỏ đậm(chưa bàn giao) · X=xám. Ô % block: giao tinh=xanh dương, xoá defect=xanh lá.
 */
import * as XLSX from "xlsx";

const CFMAP: Record<string, [string, string]> = {
  "1": ["#FDF2D0", "#5a4a1a"], "2": ["#00FFFF", "#04343a"], "3": ["#5884E1", "#fff"],
  "4": ["#FF9900", "#3a2200"], "5": ["#00FF00", "#063a06"],
};
const esc = (s: string) => String(s).replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]!));
const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return (n >> 16 & 255) * 0.299 + (n >> 8 & 255) * 0.587 + (n & 255) * 0.114; };

function gridColor(v: unknown): [string | null, string, string] {
  const s = String(v ?? "").trim().toUpperCase();
  if (CFMAP[s]) return [CFMAP[s][0], CFMAP[s][1], ""];
  if (s === "X") return ["#BFBFBF", "#555", "X"];
  if (s === "" || s === " ") return ["#C00000", "#fff", ""];
  return [null, "#111", esc(s)];
}

/** Màu swatch legend suy TỪ CHỮ diễn giải để LUÔN KHỚP màu lưới (không đọc fill trong file —
 *  SheetJS hay đọc sai fill của ô legend → ra hồng/trắng). */
function legendColor(text: string): string {
  const t = text.toLowerCase();
  if (/chưa bàn giao/.test(t)) return "#C00000";
  if (/thi công/.test(t)) return "#FDF2D0";
  if (/giao thô/.test(t)) return "#00FFFF";
  if (/giao tinh/.test(t)) return "#5884E1";
  if (/xo[áa]/.test(t)) return "#00FF00";
  if (/defect|vận hành/.test(t)) return "#FF9900";
  return "#e5e7eb";
}

export function summaryToHtml(sh: XLSX.WorkSheet): string {
  const ec = XLSX.utils.encode_cell, dc = XLSX.utils.decode_cell, decR = XLSX.utils.decode_range;
  const cell = (r: number, c: number) => sh[ec({ r, c })] as (XLSX.CellObject & { s?: { fgColor?: { rgb?: string } } }) | undefined;
  const merges = (sh["!merges"] ?? []).map((m) => decR(XLSX.utils.encode_range(m)));
  const cover = (r: number, c: number) => merges.find((m) => r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c);
  const valAt = (r: number, c: number): unknown => { const cv = cover(r, c); const a = cv ? cell(cv.s.r, cv.s.c) : cell(r, c); return a && a.v != null ? a.v : ""; };
  const wAt = (r: number, c: number): string => { const cl = cell(r, c); return cl && cl.w != null ? String(cl.w) : String(valAt(r, c)); };
  const argb = (x: { rgb?: string } | undefined): string | null => (x?.rgb ? "#" + String(x.rgb).replace(/^FF/, "") : null);
  let maxR = 0; for (const a in sh) { if (a[0] === "!") continue; const { r } = dc(a); if (r < 70) maxR = Math.max(maxR, r); }
  const total = Number(valAt(1, 1)) || 427;

  // ── 1) TOP REGION: honor merge + fill trực tiếp + formatted text + data-bar 3 ô tổng ──
  const bars: Record<string, string> = { "0_3": "#00FFFF", "0_8": "#5884E1", "0_13": "#00FF00" };
  const region = (r0: number, r1: number, c0: number, c1: number, metric = false): string => {
    let h = `<table class="mtld-top">`;
    for (let r = r0; r <= r1; r++) {
      // Ở bảng chỉ số: hàng DỮ LIỆU (Hôm trước/Hôm nay/Lũy kế/Còn lại) KHÔNG bê nguyên tô nền
      // từ file (trước đây file tô vàng cả hàng "Hôm nay" + cột cuối) — thay bằng highlight ĐỘNG:
      // CHỈ tô vàng ô "Hôm nay" có giá trị ≠ 0 (tức ô vừa thay đổi trong ngày).
      const rowLabel = String(valAt(r, 0)).toLowerCase();
      const isDataRow = metric && /hôm|lũy|còn/.test(rowLabel);
      const isToday = metric && /hôm nay/.test(rowLabel);
      h += "<tr>";
      for (let c = c0; c <= c1; c++) {
        const cov = cover(r, c);
        if (cov && !(cov.s.r === r && cov.s.c === c)) continue;
        const cl = cell(r, c); const v = cl && cl.v != null ? cl.v : "";
        let bg: string | null = null, fg = "#111";
        const dl = argb(cl?.s?.fgColor);
        if (dl && dl !== "#000000" && !isDataRow) { bg = dl; fg = lum(dl) < 140 ? "#fff" : "#111"; }
        // Highlight ô THAY ĐỔI: hàng "Hôm nay", ô là số khác 0.
        if (isToday && typeof v === "number" && v !== 0) { bg = "#FFE14D"; fg = "#111"; }
        let span = "";
        if (cov) { const cs = Math.min(cov.e.c, c1) - c + 1, rs = cov.e.r - cov.s.r + 1; if (cs > 1) span += ` colspan="${cs}"`; if (rs > 1) span += ` rowspan="${rs}"`; }
        const bcol = bars[r + "_" + c]; let bar = "";
        if (bcol && typeof v === "number") { const w = Math.max(3, Math.min(100, v / total * 100)); bar = `<span class="mtld-sb" style="width:${w}%;background:${bcol}"></span>`; bg = "#1F3864"; fg = "#fff"; }
        h += `<td${span} style="background:${bg ?? "transparent"};color:${fg}">${bar}<span class="mtld-st">${esc(wAt(r, c))}</span></td>`;
      }
      h += "</tr>";
    }
    return h + "</table>";
  };
  const metricTable = region(0, 5, 0, 18, true);
  const speedTable = region(0, 5, 19, 20); // tới B5 thôi — bỏ hàng "HL / Đã giao tinh" (header block lọt vào)

  // ── 2) BLOCKS: mỗi block 1 bảng, ô màu ĐỀU, bỏ L01 ──
  let blocks = "";
  for (let r = 0; r <= maxR; r++) {
    if (!/^B\d$/.test(String(valAt(r, 0)).trim())) continue;
    const bname = String(valAt(r, 0)).trim();
    // Nhận diện 3 cột % theo CHỮ header (không phụ thuộc vị trí — file chèn thêm cột vẫn đúng):
    //   giao thô (mới) → giao tinh → xoá list Defect. giao thô có thể KHÔNG có (file cũ) ⇒ bỏ qua.
    let colGTho = -1, colGT = -1, colXD = -1;
    for (let c = 1; c <= 30; c++) {
      const t = String(valAt(r, c)).toLowerCase();
      if (colGTho < 0 && /giao\s*th[ôo]/.test(t)) colGTho = c;
      if (colGT < 0 && /tinh/.test(t)) colGT = c;
      if (colXD < 0 && /defect|xo[áa]/.test(t)) colXD = c;
    }
    if (colGT < 0) colGT = colXD; if (colXD < 0) colXD = colGT; if (colGT < 0) continue;
    // Cột % ĐẦU TIÊN (giao thô nếu có, else giao tinh) → mọi cột trước nó là ô ĐƠN VỊ (phòng).
    const firstPct = Math.min(...[colGTho, colGT, colXD].filter((c) => c > 0));
    const hasTho = colGTho > 0;
    const units: number[] = []; for (let c = 1; c <= firstPct - 1; c++) units.push(c);
    const dataRows: number[] = [];
    for (let rr = r + 1; rr <= r + 6; rr++) { const lab = String(valAt(rr, 0)).trim(); if (/^L01$/i.test(lab)) continue; if (/^L0[2-6]$/i.test(lab)) dataRows.push(rr); }
    const findPct = (col: number): number | null => { if (col < 0) return null; for (const rr of dataRows) { const v = valAt(rr, col); if (typeof v === "number" && v > 0 && v <= 1) return v; } return null; };
    const gtho = findPct(colGTho), gt = findPct(colGT), xd = findPct(colXD);
    const nPct = hasTho ? 3 : 2;
    const cg = `<col style="width:34px">` + units.map(() => `<col style="width:24px">`).join("") + `<col style="width:46px">`.repeat(nPct);
    let t = `<table class="mtld-blk"><colgroup>${cg}</colgroup>`;
    t += `<tr><td class="mtld-lbl mtld-bn">${esc(bname)}</td>` + units.map((c) => `<td class="mtld-hd">${esc(wAt(r, c))}</td>`).join("")
       + (hasTho ? `<td class="mtld-hd sm">Đã giao thô</td>` : "") + `<td class="mtld-hd sm">Đã giao tinh</td><td class="mtld-hd sm">Xoá list Defect</td></tr>`;
    dataRows.forEach((rr, i) => {
      t += `<tr><td class="mtld-lbl">${esc(String(valAt(rr, 0)))}</td>`;
      for (const c of units) { const [bg, fg, tx] = gridColor(valAt(rr, c)); t += `<td class="mtld-cell" style="background:${bg ?? "transparent"};color:${fg}">${tx}</td>`; }
      if (i === 0) {
        const rs = dataRows.length;
        const pctCell = (v: number | null, col: string) => v == null ? `<td rowspan="${rs}" class="mtld-pct"></td>`
          : `<td rowspan="${rs}" class="mtld-pct"><span class="mtld-sb" style="width:${Math.round(v * 100)}%;background:${col}"></span><span class="mtld-st">${Math.round(v * 100)}%</span></td>`;
        // giao thô = CYAN #00FFFF (khớp data-bar giao thô ở khối TOP + màu ô/legend giao thô).
        t += (hasTho ? pctCell(gtho, "#00FFFF") : "") + pctCell(gt, "#5884E1") + pctCell(xd, "#00FF00");
      }
      t += "</tr>";
    });
    blocks += t + "</table>";
  }

  // ── 3) LEGEND ──
  let legend = `<table class="mtld-lg"><tr><td class="lh">Màu</td><td class="lh">Diễn giải</td><td class="lh">Số lượng</td></tr>`;
  for (let r = 1; r <= 6; r++) {
    const dg = wAt(r, 26); if (!dg || dg === "undefined") continue;
    legend += `<tr><td style="background:${legendColor(dg)};width:26px"></td><td class="ld">${esc(dg)}</td><td class="lc">${esc(wAt(r, 30))}</td></tr>`;
  }
  legend += "</table>";

  return `<div class="mtld-summary"><div class="mtld-top-row">${metricTable}${speedTable}${legend}</div><div class="mtld-body">${blocks}</div></div>`;
}

/** CSS đi kèm — nhúng 1 lần trong popup. */
export const SUMMARY_CSS = `
.mtld-summary{font:11px 'Segoe UI',Arial;color:#111;background:#fff}
.mtld-top-row{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;margin-bottom:12px}
.mtld-top{border-collapse:collapse}
.mtld-top td{border:1px solid #333;padding:1px 6px;text-align:center;font-size:10px;font-weight:600;position:relative;white-space:nowrap;height:18px}
.mtld-sb{position:absolute;left:0;top:0;bottom:0;opacity:.9}.mtld-st{position:relative;z-index:1}
.mtld-body{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}
.mtld-blk{border-collapse:collapse;table-layout:fixed;margin:0 0 12px}
.mtld-blk td{border:1px solid #333;height:20px;text-align:center;font-size:10px;overflow:hidden;padding:0}
.mtld-lbl{background:#1F3864;color:#fff;font-weight:700}.mtld-bn{background:#0f2547}
.mtld-hd{background:#2f4a78;color:#fff;font-weight:700}.mtld-hd.sm{white-space:normal;font-size:8.5px;line-height:1.05}
.mtld-cell{font-weight:700}
.mtld-pct{position:relative;background:#eef1f6;font-weight:700;text-align:center}
.mtld-lg{border-collapse:collapse;font-size:10px}.mtld-lg td{border:1px solid #333;padding:1px 6px}
.mtld-lg .lh{background:#1F3864;color:#fff;font-weight:700;text-align:center}.mtld-lg .ld{white-space:nowrap}.mtld-lg .lc{text-align:right;font-weight:700}`;
