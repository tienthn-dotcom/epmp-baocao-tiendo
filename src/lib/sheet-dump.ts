/**
 * ĐỔ NGUYÊN 1 SHEET → HTML (như "chụp màn hình") — dùng cho tab CHƯA đồng bộ form.
 * App gọi khi tên sheet KHÔNG phải "Summary"/"Public Summary". Hiện: giá trị (đã format .w),
 * fill TĨNH, màu chữ, gộp ô. LƯU Ý: màu do "tô màu điều kiện" KHÔNG đọc được (SheetJS) → chỉ ra
 * màu tĩnh. Có GIỚI HẠN kích thước để tránh sheet khổng lồ (vd DATA) làm nặng.
 */
import * as XLSX from "xlsx";
import { legendCodeColors } from "@/lib/summary-render";

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

/** FORM = "bố cục người dùng" đè lên dữ liệu sống: độ rộng cột / cao dòng (giữ khi số liệu đổi), màu theo MÃ
 *  (áp cho mọi ô cùng mã → data mới vẫn đúng màu), màu/chữ theo Ô (cố định), ẩn cột/dòng. Khoá ô = "r:c"
 *  (toạ độ TUYỆT ĐỐI trong sheet, không đổi khi chỉnh vùng). Lưu 1 form / 1 link → "bê form lên số liệu khác". */
/** LUẬT TÔ MÀU THÔNG MINH (conditional-formatting) áp theo GIÁ TRỊ trong 1 khối → BỀN khi số liệu đổi.
 *  scale = thang % đỏ(từ)→xanh(đến) cho ô là phần trăm (KIỂU 1); steps = bảng màu theo BẬC: ô trống→colors[0],
 *  mã 1→colors[1]… (KIỂU 2, 7 màu người dùng gửi); palette = tự chia màu mỗi mã 1 màu (ngẫu nhiên ổn định). */
export type FormRule = { r1: number; c1: number; r2: number; c2: number; mode: "scale" | "palette" | "steps"; from?: number; to?: number; colors?: string[] };

export type FormSpec = {
  colW?: Record<string, number>;      // cột tuyệt đối → px
  rowH?: Record<string, number>;      // dòng tuyệt đối → px
  cellColor?: Record<string, string>; // "r:c" → nền
  cellFg?: Record<string, string>;    // "r:c" → màu chữ
  codeColor?: Record<string, string>; // giá-trị-ô (trim) → nền (áp mọi ô cùng mã)
  cellText?: Record<string, string>;  // "r:c" → chữ đè (nhãn cố định)
  hiddenC?: number[];                 // cột tuyệt đối bị ẩn
  hiddenR?: number[];                 // dòng tuyệt đối bị ẩn
  rules?: FormRule[];                 // tô màu thông minh theo giá trị (áp cả số liệu mới)
  boxW?: number;                      // cỡ KHUNG CHIẾU ma trận (px) — admin kéo, lưu vào form
  boxH?: number;                      // → mọi người mở lên thấy đúng khung admin đã chốt
  zones?: { cols: number; h?: number };   // bố cục BẢNG KHU (dự án không heatmap) — rangeToHtml không dùng
};

/** "85%" / "0,85" / số 0–1 → phần trăm 0–100; không phải % → null (không tô thang). */
function pctOf(raw: string): number | null {
  const s = raw.trim();
  const m = /^(-?\d+(?:[.,]\d+)?)\s*%$/.exec(s);
  if (m) return parseFloat(m[1].replace(",", "."));
  const f = /^-?\d+(?:[.,]\d+)?$/.test(s) ? parseFloat(s.replace(",", ".")) : NaN;
  if (!isNaN(f) && f >= 0 && f <= 1) return f * 100;   // 0..1 = tỉ lệ
  return null;
}
const PALETTE = ["#fca5a5", "#fdba74", "#fde047", "#86efac", "#67e8f9", "#93c5fd", "#c4b5fd", "#f9a8d4", "#a7f3d0", "#fbcfe8", "#bef264", "#fca5f1"];
function hashStr(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
/** Màu cho 1 ô theo LUẬT khớp (khối chứa ô); luật SAU đè luật trước. undefined = không luật nào áp.
 *  disp = chuỗi HIỂN THỊ ("38%") — parse % chắc hơn giá trị thô; val = giá trị thô (để hash palette theo mã). */
function ruleColorOf(rules: FormRule[] | undefined, r: number, c: number, val: string, disp: string): string | undefined {
  if (!rules) return undefined;
  let out: string | undefined;
  for (const rl of rules) {
    if (r < rl.r1 || r > rl.r2 || c < rl.c1 || c > rl.c2) continue;
    if (rl.mode === "palette") { if (val) out = PALETTE[hashStr(val) % PALETTE.length]; }
    else if (rl.mode === "steps") {                                     // KIỂU 2: ô trống→colors[0], "1"→colors[1]…
      const cs = rl.colors || []; if (!cs.length) continue;
      const s = (disp || val).trim();
      let idx: number | null = null;
      if (s === "") idx = 0;                                            // trống = bậc thấp nhất
      else if (/^\d+$/.test(s)) idx = Math.min(parseInt(s, 10), cs.length - 1);   // mã 1..N
      if (idx != null && idx >= 0) out = cs[idx];                       // "X"/chữ khác → không tô
    }
    else { const p = pctOf(disp) ?? pctOf(val); if (p != null) { const lo = rl.from ?? 0, hi = rl.to ?? 100; const t = hi === lo ? 1 : (p - lo) / (hi - lo); const hue = Math.max(0, Math.min(120, t * 120)); out = `hsl(${Math.round(hue)}, 70%, 72%)`; } }
  }
  return out;
}

/** ColInfo/RowInfo của SheetJS → px. Ưu tiên px thật; else quy đổi từ ký-tự/point; else undefined (mặc định). */
function colPx(ci: { wpx?: number; wch?: number; width?: number; hidden?: boolean } | undefined): number | undefined {
  if (!ci) return undefined;
  if (typeof ci.wpx === "number") return Math.round(ci.wpx);
  if (typeof ci.wch === "number") return Math.round(ci.wch * 7 + 5);   // ~7px/ký tự + đệm
  if (typeof ci.width === "number") return Math.round(ci.width * 7 + 5);
  return undefined;
}
function rowPx(ri: { hpx?: number; hpt?: number; hidden?: boolean } | undefined): number | undefined {
  if (!ri) return undefined;
  if (typeof ri.hpx === "number") return Math.round(ri.hpx);
  if (typeof ri.hpt === "number") return Math.round((ri.hpt * 96) / 72);   // point → px
  return undefined;
}

/** RENDER ĐÚNG 1 VÙNG (A1, vd "B2:M45" hoặc "Sheet!B2:M45") → HTML — KHÔNG hiểu cấu trúc, chỉ vẽ y hệt ô
 *  (giá trị + màu). Màu: ưu tiên FORM (theo ô, theo mã) → conditional-formatting theo MÃ (codeColors) → fill
 *  tĩnh. Độ rộng cột/cao dòng: FORM đè lên KÍCH THƯỚC THẬT đọc từ file (!cols/!rows). Mỗi ô mang data-r/data-c
 *  (toạ độ tuyệt đối) để lớp "chỉnh như Excel" bám vào. Vùng rỗng → cả sheet (cap kích thước). */
export function rangeToHtml(sh: XLSX.WorkSheet, rangeStr?: string, codeColors?: Record<string, string>, spec?: FormSpec, hideText?: boolean): string {
  const ref = sh["!ref"]; if (!ref) return `<div class="sd-empty">Sheet rỗng.</div>`;
  const full = XLSX.utils.decode_range(ref);
  let b = full;
  const rs = (rangeStr ?? "").trim().replace(/^[^!]*!/, "");   // bỏ tiền tố "Sheet!" nếu có
  if (rs) { try { b = XLSX.utils.decode_range(rs); } catch { b = full; } }
  const sR = Math.max(b.s.r, 0), sC = Math.max(b.s.c, 0);
  const eR = Math.min(b.e.r, sR + MAX_R - 1), eC = Math.min(b.e.c, sC + MAX_C - 1);
  if (eR < sR || eC < sC) return `<div class="sd-empty">Vùng không hợp lệ.</div>`;
  type Cell = XLSX.CellObject & { s?: { fgColor?: { rgb?: string }; font?: { color?: { rgb?: string }; bold?: boolean } }; w?: string };
  const cell = (r: number, c: number) => sh[XLSX.utils.encode_cell({ r, c })] as Cell | undefined;
  const merges = (sh["!merges"] ?? []);
  const cover = (r: number, c: number) => merges.find((m) => r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c);
  const cols = (sh["!cols"] ?? []) as { wpx?: number; wch?: number; width?: number; hidden?: boolean }[];
  const rowsInfo = (sh["!rows"] ?? []) as { hpx?: number; hpt?: number; hidden?: boolean }[];
  const hidC = new Set(spec?.hiddenC ?? []);
  const hidR = new Set(spec?.hiddenR ?? []);
  const key = (r: number, c: number) => `${r}:${c}`;
  // MÀU CHUẨN theo TRẠNG THÁI (legend "Tăng hôm nay"/diễn giải) — thắng CF đọc từ file, nhưng form tay vẫn ưu tiên.
  const cc: Record<string, string> = { ...(codeColors ?? {}), ...legendCodeColors(sh) };

  // ── KHOANH VÙNG "Ô TRẠNG THÁI CỦA CĂN" (lưới thật) — dùng cho 2 việc: tô ô TRỐNG = bậc thấp nhất
  // của legend ("Chưa bàn giao"), và ẨN CHỮ heatmap ĐÚNG chỗ (nhãn Toà/số phòng/tầng + dòng tổng vẫn
  // đọc được). Nhận hàng header block bằng DÃY ≥4 ô SỐ ở CỘT LIỀN NHAU và TĂNG ĐÚNG 1 — số căn mỗi
  // file gõ một kiểu: "01","02","03" (Mini Hotel) hay "1","2","3" (Hyatt Hạ Long) nên nhận 1-3 chữ số,
  // bù lại đòi ≥4 ô liên tiếp → nới sang 2 phía lấy trọn cột đơn vị (kể cả "HL"); các dòng dưới có ≥1 ô có chữ trong
  // tập cột đó là DÒNG CĂN, tới dòng trắng thì hết block. Nhờ vậy dòng tổng ("Lũy kế" 84/82/59… cũng
  // 2 chữ số nhưng không tăng dần 1) KHÔNG bị coi là lưới.
  const blankBg = cc[""];
  const txtOf = (r: number, c: number) => { const x = cell(r, c); return x?.w != null ? String(x.w).trim() : (x?.v != null ? String(x.v).trim() : ""); };
  const isUnit = (t: string) => /^\d{1,3}$/.test(t) || /^HL$/i.test(t);
  const gridCell = new Set<string>();
  {
    let unit: number[] = [];
    for (let r = sR; r <= eR; r++) {
      const two: number[] = [];
      for (let c = sC; c <= eC; c++) if (/^\d{1,3}$/.test(txtOf(r, c))) two.push(c);
      let run = 1, best = 0, bEnd = -1;
      for (let i = 1; i < two.length; i++) {
        run = (two[i] === two[i - 1] + 1 && +txtOf(r, two[i]) === +txtOf(r, two[i - 1]) + 1) ? run + 1 : 1;
        if (run > best) { best = run; bEnd = two[i]; }
      }
      if (best >= 4) {                                                           // → hàng header block
        let a = bEnd - best + 1, z = bEnd;
        while (a - 1 >= sC && isUnit(txtOf(r, a - 1))) a--;
        while (z + 1 <= eC && isUnit(txtOf(r, z + 1))) z++;
        unit = []; for (let c = a; c <= z; c++) unit.push(c);
        continue;
      }
      if (!unit.length) continue;
      if (!unit.some((c) => txtOf(r, c) !== "")) { unit = []; continue; }         // hết block (dòng trắng)
      for (const c of unit) gridCell.add(`${r}:${c}`);
    }
  }

  // XOÁ CỘT/DÒNG (hiddenC/hiddenR) = KHÔNG VẼ RA, các cột còn lại dồn sát nhau — đúng như xoá cột/hàng
  // trong Excel. (Cách cũ đặt width:0 KHÔNG ăn thua vì `.sd-tb td` có `min-width:42px` đè lên → cột "ẩn"
  // vẫn chiếm chỗ, nhìn như nút không có tác dụng.)
  let colgroup = "<colgroup>";
  for (let c = sC; c <= eC; c++) {
    if (hidC.has(c)) continue;
    const w = spec?.colW?.[c] ?? colPx(cols[c]);
    colgroup += w != null ? `<col style="width:${w}px">` : "<col>";
  }
  colgroup += "</colgroup>";
  /** Ô CÒN LẠI đầu tiên của 1 khối gộp (ô neo gốc có thể vừa bị xoá) + số hàng/cột còn lại của khối. */
  const liveOf = (m: { s: { r: number; c: number }; e: { r: number; c: number } }) => {
    let fr = -1, fc = -1, nr = 0, nc = 0;
    for (let rr = Math.max(m.s.r, sR); rr <= Math.min(m.e.r, eR); rr++) if (!hidR.has(rr)) { if (fr < 0) fr = rr; nr++; }
    for (let cc = Math.max(m.s.c, sC); cc <= Math.min(m.e.c, eC); cc++) if (!hidC.has(cc)) { if (fc < 0) fc = cc; nc++; }
    return { fr, fc, nr, nc };
  };

  let body = "";
  for (let r = sR; r <= eR; r++) {
    if (hidR.has(r)) continue;
    const rh = spec?.rowH?.[r] ?? rowPx(rowsInfo[r]);
    body += `<tr data-r="${r}"${rh != null ? ` style="height:${rh}px"` : ""}>`;
    for (let c = sC; c <= eC; c++) {
      if (hidC.has(c)) continue;
      const cv = cover(r, c);
      // Ô gộp: vẽ tại ô CÒN LẠI đầu tiên và lấy nội dung từ ô neo gốc — nếu ô neo nằm trong hàng/cột vừa
      // xoá thì phần còn lại của khối vẫn phải hiện, không thì dòng bị hụt ô, bảng lệch cột.
      const src = cv ? { r: cv.s.r, c: cv.s.c } : { r, c };
      if (cv) { const lv = liveOf(cv); if (r !== lv.fr || c !== lv.fc) continue; }
      const cl = cell(src.r, src.c);
      const k = key(src.r, src.c);   // form BÁM Ô NEO của khối gộp (giữ nguyên form đã lưu trước đây)
      const fileRaw = cl?.w != null ? cl.w : (cl?.v != null ? String(cl.v) : "");
      const raw = spec?.cellText?.[k] ?? fileRaw;   // FORM đè chữ (nhãn cố định)
      const val = cl?.v != null ? String(cl.v).trim() : "";
      // LƯU Ý `??`: dùng `val ? x : undefined` (KHÔNG dùng `val && x`) — ô trống cho `""`, mà `"" ?? y`
      // trả về `""` nên chặn đứng cả chuỗi ưu tiên phía sau (ô trống bị mất màu).
      const bg = spec?.cellColor?.[k]                                  // 1) màu theo Ô (form)
        ?? (val ? spec?.codeColor?.[val] : undefined)                          // 2) màu theo MÃ (form)
        ?? ruleColorOf(spec?.rules, src.r, src.c, val, raw)                            // 3) luật tô thông minh (thang %/palette)
        ?? (val ? cc[val] : undefined)                                         // 4) MÀU CHUẨN (legend) → CF file
        ?? (val.toUpperCase() === "X" ? "#A6A6A6" : undefined)                 // 4b) "X" = không có thi công → xám chuẩn
        ?? (!val && blankBg && gridCell.has(k) ? blankBg : undefined)  // 4c) ô TRỐNG trong lưới = bậc thấp nhất
        ?? argb(cl?.s?.fgColor?.rgb);                                          // 5) fill tĩnh
      let fg = spec?.cellFg?.[k] ?? argb(cl?.s?.font?.color?.rgb);
      if (!fg) fg = bg && lum(bg) < 140 ? "#fff" : "#111";
      // ẨN CHỮ heatmap: chỉ ô TRẠNG THÁI TRONG LƯỚI → chữ đồng màu nền (thấy màu, không thấy mã). Nhãn
      // Toà / số phòng / tầng và các dòng tổng VẪN đọc được — không thì bấm ô nào cũng không biết là căn nào.
      if (hideText && bg && gridCell.has(k)) fg = bg;
      const bold = cl?.s?.font?.bold ? "font-weight:700;" : "";
      let span = "";
      if (cv) { const lv = liveOf(cv); if (lv.nc > 1) span += ` colspan="${lv.nc}"`; if (lv.nr > 1) span += ` rowspan="${lv.nr}"`; }
      body += `<td data-r="${src.r}" data-c="${src.c}"${span} style="background:${bg ?? "transparent"};color:${fg};${bold}">${esc(raw).replace(/\n/g, "<br>")}</td>`;
    }
    body += "</tr>";
  }
  return `<div class="sd-wrap"><div class="sd-scroll"><table class="sd-tb" style="table-layout:fixed">${colgroup}${body}</table></div></div>`;
}

export const SHEET_DUMP_CSS = `
.sd-wrap{font:11px 'Segoe UI',Arial;color:#111}
.sd-scroll{overflow:auto;max-height:88vh}
.sd-tb{border-collapse:collapse;table-layout:auto}
/* Ô GỌN + ĐỀU: header dài TỰ WRAP 2-3 dòng (max-width) để bớt scroll ngang; ô ngắn (vd 100%) vẫn tối thiểu bằng nhau. */
.sd-tb td{border:1px solid #d0d5db;padding:2px 5px;white-space:normal;word-break:break-word;text-align:center;vertical-align:middle;min-width:42px;max-width:104px;font-size:10.5px;line-height:1.18}
.sd-note{margin-top:8px;font-size:11px;color:#b45309}
.sd-empty{padding:24px;text-align:center;color:#64748b}`;
