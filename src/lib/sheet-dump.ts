/**
 * ĐỔ NGUYÊN 1 SHEET → HTML (như "chụp màn hình") — dùng cho tab CHƯA đồng bộ form.
 * App gọi khi tên sheet KHÔNG phải "Summary"/"Public Summary". Hiện: giá trị (đã format .w),
 * fill TĨNH, màu chữ, gộp ô. LƯU Ý: màu do "tô màu điều kiện" KHÔNG đọc được (SheetJS) → chỉ ra
 * màu tĩnh. Có GIỚI HẠN kích thước để tránh sheet khổng lồ (vd DATA) làm nặng.
 */
import * as XLSX from "xlsx";

const esc = (s: string) => String(s).replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]!));
function argb(rgb: string | undefined): string | null {
  if (!rgb) return null;
  let h = String(rgb).replace(/^#/, "");
  if (h.length === 8) { if (h.slice(0, 2) === "00") return null; h = h.slice(2); } // alpha 00 = trong suốt
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return "#" + h.toUpperCase();
}
const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return (n >> 16 & 255) * 0.299 + (n >> 8 & 255) * 0.587 + (n & 255) * 0.114; };

const MAX_R = 200, MAX_C = 80;

export function sheetToHtml(sh: XLSX.WorkSheet): string {
  const ref = sh["!ref"]; if (!ref) return `<div class="sd-empty">Sheet rỗng.</div>`;
  const range = XLSX.utils.decode_range(ref);
  // Vùng CÓ NỘI DUNG THẬT (nhiều sheet khai báo thừa hàng/cột trống) → dump gọn.
  let maxR = range.s.r, maxC = range.s.c;
  for (const k in sh) { if (k[0] === "!") continue; const { r, c } = XLSX.utils.decode_cell(k); if (r > maxR) maxR = r; if (c > maxC) maxC = c; }
  const eR = Math.min(maxR, range.s.r + MAX_R - 1), eC = Math.min(maxC, range.s.c + MAX_C - 1);
  const truncated = maxR > eR || maxC > eC;
  type Cell = XLSX.CellObject & { s?: { fgColor?: { rgb?: string }; font?: { color?: { rgb?: string }; bold?: boolean } }; w?: string };
  const cell = (r: number, c: number) => sh[XLSX.utils.encode_cell({ r, c })] as Cell | undefined;
  const merges = (sh["!merges"] ?? []);
  const cover = (r: number, c: number) => merges.find((m) => r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c);

  let body = "";
  for (let r = range.s.r; r <= eR; r++) {
    body += "<tr>";
    for (let c = range.s.c; c <= eC; c++) {
      const cv = cover(r, c);
      if (cv && !(cv.s.r === r && cv.s.c === c)) continue; // ô bị gộp phủ
      const cl = cell(r, c);
      const raw = cl?.w != null ? cl.w : (cl?.v != null ? String(cl.v) : "");
      const bg = argb(cl?.s?.fgColor?.rgb);
      let fg = argb(cl?.s?.font?.color?.rgb);
      if (!fg) fg = bg && lum(bg) < 140 ? "#fff" : "#111";
      const bold = cl?.s?.font?.bold ? "font-weight:700;" : "";
      let span = "";
      if (cv) { const cs = Math.min(cv.e.c, eC) - c + 1, rs = cv.e.r - cv.s.r + 1; if (cs > 1) span += ` colspan="${cs}"`; if (rs > 1) span += ` rowspan="${rs}"`; }
      body += `<td${span} style="background:${bg ?? "transparent"};color:${fg};${bold}">${esc(raw).replace(/\n/g, "<br>")}</td>`;
    }
    body += "</tr>";
  }
  const note = truncated ? `<div class="sd-note">Đã hiện ${eR - range.s.r + 1} dòng × ${eC - range.s.c + 1} cột đầu (sheet lớn hơn — cắt bớt cho nhẹ).</div>` : "";
  return `<div class="sd-wrap"><div class="sd-scroll"><table class="sd-tb">${body}</table></div>${note}</div>`;
}

export const SHEET_DUMP_CSS = `
.sd-wrap{font:11px 'Segoe UI',Arial;color:#111}
.sd-scroll{overflow:auto;max-height:78vh}
.sd-tb{border-collapse:collapse;table-layout:auto}
.sd-tb td{border:1px solid #d0d5db;padding:1px 5px;white-space:nowrap;text-align:center;height:18px;font-size:10.5px;line-height:1.2}
.sd-note{margin-top:8px;font-size:11px;color:#b45309}
.sd-empty{padding:24px;text-align:center;color:#64748b}`;
