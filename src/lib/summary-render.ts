/**
 * RENDER sheet "Summary" (ma trận bàn giao/lắp đặt) → HTML tô màu. Thuần (browser + node).
 *
 * BÁM CẤU TRÚC, KHÔNG bám chữ (chạy cho mọi dự án — Mini Hotel B1..Bn, Nam Phương A/B/C/D…):
 *  • Ô lưới chứa MÃ SỐ (1..n); màu THẬT do conditional-formatting (SheetJS đọc KHÔNG ra) → suy màu
 *    qua BẢNG MÃ→MÀU dựng từ LEGEND (ô "Màu" của legend có fill tĩnh, đọc được). Mỗi file 1 bảng riêng.
 *  • Block = hàng header có dãy "01","02","03"… (nhãn block = ô đầu: A/B/C/D hoặc B1..Bn).
 *  • Cột đơn vị = header là SỐ (01..) hoặc "HL"; cột % = header chữ sau đó (Mặt bằng / giao thô/tinh…).
 *  • Dòng dữ liệu = mọi dòng có nhãn ở cột đầu, tới block kế. "X"=không áp dụng (xám); trống=trắng.
 */
import * as XLSX from "xlsx";

const esc = (s: string) => String(s).replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]!));
const S = (v: unknown) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return (n >> 16 & 255) * 0.299 + (n >> 8 & 255) * 0.587 + (n & 255) * 0.114; };
/** Bỏ dấu + gộp khoảng trắng để so khớp diễn giải trạng thái (chạy cho mọi cách gõ hoa/thường/dấu). */
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").replace(/\s+/g, " ").trim();
/** Chuỗi "d9d9d9" / "#D9D9D9" / "FF93C5FD" → "#RRGGBB". Không phải hex → null. */
const hex6 = (s: string): string | null => { let h = String(s || "").trim().replace(/^#/, ""); if (h.length === 8) h = h.slice(2); return /^[0-9a-fA-F]{6}$/.test(h) ? "#" + h.toUpperCase() : null; };
/** QUY ƯỚC MÀU CHUẨN — THANG 7 CẤP CÓ THỨ TỰ (thấp→cao), chốt 03/09/2026, áp cho MỌI bảng render:
 *  Chưa nhận mặt bằng → Đang thi công → Đã giao thô → Đã giao tinh (Nội bộ) → Đã đóng defect PMU
 *  → Đã ra list Defects (Vận hành) → Bàn giao Vận hành.
 *  Mỗi file gọi tên công đoạn một kiểu (vd "Xoá list Defect", "Đã giao VH") nên KHÔNG so tên được:
 *  tô theo THỨ HẠNG dòng legend (dòng 1 = thấp nhất) — xem legendCodeColors. */
export const STD_RAMP = ["#B02418", "#D9D9D9", "#93C5FD", "#4E80EE", "#1E3A8A", "#C2FEBA", "#059669"];
/** Map theo TÊN — chỉ dùng cho ô "X" và khi legend chỉ có 1 dòng (không suy được thứ hạng). */
const STD_STATUS: Record<string, string> = {
  "chua nhan mat bang": "#B02418",
  "chua ban giao": "#B02418",
  "dang thi cong": "#D9D9D9",
  "da giao tho": "#93C5FD",
  "da giao tinh (noi bo)": "#4E80EE",
  "da giao tinh": "#4E80EE",
  "da dong defect pmu": "#1E3A8A",
  "da dong defect tu ban quan ly": "#1E3A8A",       // tên cũ (bảng 28/08) → giữ để file cũ không mất màu
  "da ra list defects (van hanh)": "#C2FEBA",
  "ban giao van hanh": "#059669",
  "da giao van hanh": "#059669",
  "da dong defect tu van hanh": "#059669",          // tên cũ
  "khong co thi cong": "#A6A6A6",
  "x": "#A6A6A6",
};
const NO_WORK = "#A6A6A6";   // ô "X" = không có thi công
/** ARGB/RGB của SheetJS → "#RRGGBB". Bỏ 2 ký tự alpha nếu là 8 ký tự (ARGB). */
function argbColor(rgb: string | undefined): string | null {
  if (!rgb) return null;
  let h = String(rgb).replace(/^#/, "");
  if (h.length === 8) h = h.slice(2);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return "#" + h.toUpperCase();
}

/** BẢNG MÃ→MÀU CHUẨN đọc từ LEGEND của 1 sheet (Màu / Diễn giải / Nhập-Mã / "Tăng hôm nay"=hex).
 *  Ưu tiên hex khai trong legend > map chuẩn theo diễn giải > fill ô. Dùng chung cho MỌI bảng render
 *  (summary-render + rangeToHtml của matrix editor) → áp quy ước màu tự động, khỏi chỉnh tay. {} nếu không có legend. */
export function legendCodeColors(sh: XLSX.WorkSheet): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of legendEntries(sh)) out[e.code] = e.color;
  return out;
}

/** Như trên nhưng trả ĐẦY ĐỦ từng dòng legend: mã ô · DIỄN GIẢI · màu. Dùng để dựng chú giải màu cho
 *  người xem — cần thiết vì heatmap ẩn chữ, mà admin lại hay XOÁ cột legend khỏi bảng cho gọn. */
export function legendEntries(sh: XLSX.WorkSheet): { code: string; text: string; color: string }[] {
  const ec = XLSX.utils.encode_cell;
  const ref = sh["!ref"]; if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const nC = range.e.c, nR = Math.min(range.e.r, 400);
  type Cell = XLSX.CellObject & { s?: { fgColor?: { rgb?: string } } };
  const cell = (r: number, c: number) => sh[ec({ r, c })] as Cell | undefined;
  const merges = sh["!merges"] ?? [];
  const cover = (r: number, c: number) => merges.find((m) => r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c);
  const valAt = (r: number, c: number): unknown => { const cv = cover(r, c); const a = cv ? cell(cv.s.r, cv.s.c) : cell(r, c); return a && a.v != null ? a.v : ""; };
  const fillAt = (r: number, c: number): string | null => { const cl = cell(r, c); return cl?.s?.fgColor?.rgb ? argbColor(cl.s.fgColor.rgb) : null; };
  // 1 file có thể có NHIỀU bảng legend (Mini Hotel: 1 bảng chung + 1 bảng cho mỗi Toà). Lấy bảng ĐẦU
  // TIÊN và CHỈ nhận các cột phụ NẰM TRONG bảng đó (từ "Màu" sang phải, dừng ở ô "Màu" của bảng kế) —
  // nếu quét cả hàng thì "Màu" của bảng sau ghi đè, lệch cột với "Diễn giải" → mã→màu lệch bậc.
  let cMau = -1, cText = -1, cCode = -1, cHex = -1, legR = -1;
  for (let r = 0; r <= Math.min(20, nR) && cMau < 0; r++)
    for (let c = 0; c <= nC; c++) if (S(valAt(r, c)).toLowerCase() === "màu") { cMau = c; legR = r; break; }
  if (cMau < 0) return [];
  let cEnd = nC;
  for (let c = cMau + 1; c <= nC; c++) {
    const t = S(valAt(legR, c)).toLowerCase();
    if (t === "màu") { cEnd = c - 1; break; }                 // sang bảng legend kế tiếp → dừng
    if (/diễn giải|tình trạng/.test(t) && cText < 0) cText = c;
    if (/^nhập$|^mã$/.test(t) && cCode < 0) cCode = c;
    if (/tăng hôm nay|mã màu|^hex$/.test(t) && cHex < 0) cHex = c;
  }
  if (cHex < 0) for (let c = cMau; c <= cEnd && cHex < 0; c++) { if (c === cMau || c === cText || c === cCode) continue; let h = 0; for (let r = legR + 1; r <= Math.min(legR + 12, nR); r++) if (hex6(S(valAt(r, c)))) h++; if (h >= 2) cHex = c; }
  // ── 1) GOM CÁC DÒNG LEGEND (thấp→cao). Dừng khi hết diễn giải / gặp dòng tổng.
  const isTok = (s: string) => /^(x|\d{1,2})$/i.test(s);   // mã ô hợp lệ: 1-2 chữ số hoặc "X"
  type Row = { code: string; text: string; hex: string | null; fill: string | null };
  const rows: Row[] = [];
  for (let r = legR + 1; r <= Math.min(legR + 12, nR); r++) {
    const text = cText >= 0 ? S(valAt(r, cText)) : "";
    const swatch = S(valAt(r, cMau));                       // ô "Màu": có file gõ SẴN MÃ vào đây
    if (!text && !isTok(swatch)) break;                     // hết legend
    if (/phân nhóm|tổng số/.test(text.toLowerCase())) break;
    rows.push({
      code: cCode >= 0 ? S(valAt(r, cCode)) : (isTok(swatch) ? swatch : ""),
      text, hex: cHex >= 0 ? hex6(S(valAt(r, cHex))) : null, fill: fillAt(r, cMau),
    });
  }
  if (!rows.length) return [];
  // Không dòng nào có mã (cột "Màu" chỉ là ô tô màu) → mã = THỨ TỰ dòng 1..n (như trước).
  if (!rows.some((x) => x.code)) rows.forEach((x, i) => { x.code = String(i + 1); });
  // ── 2) MÀU: hex khai trong legend > THANG 7 CẤP theo THỨ HẠNG dòng > tên chuẩn > fill ô legend.
  //    Dòng đầu = thấp nhất (đỏ), dòng cuối = cao nhất (xanh lục); legend n dòng thì rải đều trên thang 7.
  const out: { code: string; text: string; color: string }[] = [];
  const scale = rows.filter((x) => !/^x$/i.test(x.code));   // "X" nằm NGOÀI thang, không chiếm bậc
  const n = scale.length;
  rows.forEach((row) => {
    if (/^x$/i.test(row.code)) { out.push({ code: row.code, text: row.text, color: NO_WORK }); return; }
    const i = scale.indexOf(row);
    const rank = n <= 1 ? -1 : Math.round((i * (STD_RAMP.length - 1)) / (n - 1));
    const color = row.hex || (rank >= 0 ? STD_RAMP[rank] : null) || STD_STATUS[norm(row.text)] || row.fill;
    if (color) out.push({ code: row.code, text: row.text, color });   // code "" = ô TRỐNG trong lưới (bậc thấp nhất)
  });
  return out;
}

/** cfColors = bản đồ "mã ô → màu" ĐỌC TỪ conditional-formatting (cf-colors.ts) — CHÍNH XÁC. Nếu có
 *  (≥1 mã) thì DÙNG NÓ để tô lưới thay vì đoán theo thứ tự legend (mã lưới thường KHÔNG khớp thứ tự
 *  legend). Khoá "" = màu ô "trống/khoảng trắng". Không truyền / rỗng → lùi về đoán legend như cũ. */
export function summaryToHtml(sh: XLSX.WorkSheet, cfColors?: Record<string, string>): string {
  const ec = XLSX.utils.encode_cell;
  const ref = sh["!ref"]; if (!ref) return `<div class="mtld-empty">Sheet rỗng.</div>`;
  const range = XLSX.utils.decode_range(ref);
  const nC = range.e.c, nR = Math.min(range.e.r, 400);
  type Cell = XLSX.CellObject & { s?: { fgColor?: { rgb?: string } }; w?: string };
  const cell = (r: number, c: number) => sh[ec({ r, c })] as Cell | undefined;
  const merges = (sh["!merges"] ?? []).map((m) => m);
  const cover = (r: number, c: number) => merges.find((m) => r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c);
  const valAt = (r: number, c: number): unknown => { const cv = cover(r, c); const a = cv ? cell(cv.s.r, cv.s.c) : cell(r, c); return a && a.v != null ? a.v : ""; };
  const txtAt = (r: number, c: number): string => { const cl = cell(r, c); return cl && cl.w != null ? String(cl.w) : S(valAt(r, c)); };
  const fillAt = (r: number, c: number): string | null => { const cl = cell(r, c); return cl?.s?.fgColor?.rgb ? argbColor(cl.s.fgColor.rgb) : null; };

  // ── 1) LEGEND → bảng MÃ→MÀU (mã theo cột "Nhập/Mã" nếu có, else theo thứ tự) ──
  let cMau = -1, cText = -1, cCode = -1, cQty = -1, cHex = -1, legR = -1;
  for (let r = 0; r <= Math.min(20, nR) && cMau < 0; r++)
    for (let c = 0; c <= nC; c++) {
      const t = S(valAt(r, c)).toLowerCase();
      if (t === "màu") { cMau = c; legR = r; }
      if (/diễn giải|tình trạng/.test(t) && cText < 0) cText = c;
      if (/^nhập$|^mã$/.test(t) && cCode < 0) cCode = c;
      if (/số lượng/.test(t) && cQty < 0) cQty = c;
      if (/tăng hôm nay|mã màu|^hex$|mã\s*hex/.test(t) && cHex < 0) cHex = c;
    }
  // Không thấy header hex → dò cột nào trong vùng legend chứa chuỗi hex (vd d9d9d9) để đọc màu chuẩn.
  if (cMau >= 0 && cHex < 0) {
    for (let c = 0; c <= nC && cHex < 0; c++) {
      if (c === cMau || c === cText || c === cCode) continue;
      let hits = 0; for (let r = legR + 1; r <= Math.min(legR + 12, nR); r++) if (hex6(S(valAt(r, c)))) hits++;
      if (hits >= 2) cHex = c;
    }
  }
  const codeColor: Record<string, string> = {};
  const legend: { color: string; text: string; qty: string }[] = [];
  if (cMau >= 0) {
    let order = 0;
    for (let r = legR + 1; r <= Math.min(legR + 12, nR); r++) {
      const text = cText >= 0 ? S(valAt(r, cText)) : "";
      // MÀU CHUẨN: hex khai trong legend (cột "Tăng hôm nay") > map chuẩn theo diễn giải > fill ô.
      const color = (cHex >= 0 ? hex6(S(valAt(r, cHex))) : null) || STD_STATUS[norm(text)] || fillAt(r, cMau);
      if (!color) { if (/phân nhóm|tổng số/.test(text.toLowerCase())) break; continue; }
      order++;
      const code = cCode >= 0 ? S(valAt(r, cCode)) : String(order);
      if (code) codeColor[code] = color;
      legend.push({ color, text, qty: cQty >= 0 ? txtAt(r, cQty) : "" });
    }
  }
  const legCol = cMau >= 0 ? Math.max(0, cCode >= 0 ? cCode : cMau) : nC + 1;
  const hasCF = !!cfColors && Object.keys(cfColors).length > 0;
  const tone = (bg: string): [string, string, string] => [bg, lum(bg) < 140 ? "#fff" : "#111", ""];
  const gridColorOf = (v: unknown): [string | null, string, string] => {
    const raw = v == null ? "" : String(v);
    const s = S(v).toUpperCase();
    if (hasCF) {
      // ƯU TIÊN màu THẬT từ conditional-formatting.
      if (s === "") {
        // ô chỉ có KHOẢNG TRẮNG (raw không rỗng nhưng trim ra rỗng) = trạng thái "trống" của CF
        // (thường Chưa bàn giao). Ô RỖNG hoàn toàn → trắng.
        const bg = raw !== "" && raw.trim() === "" ? cfColors![""] : undefined;
        return bg ? tone(bg) : [null, "#111", ""];
      }
      if (s === "X") return tone(NO_WORK);                    // không có thi công → xám chuẩn
      const bg = codeColor[s] ?? cfColors![s];                // MÀU CHUẨN (legend hex / diễn giải) THẮNG CF
      if (bg) return tone(bg);
      return [null, "#111", esc(s)];                          // mã lạ → hiện chữ
    }
    // (KHÔNG có CF) → dùng bảng mã→màu chuẩn từ legend.
    if (!s) return [null, "#111", ""];                        // trống → trắng
    if (s === "X") return tone(NO_WORK);                      // không có thi công → xám chuẩn
    const bg = codeColor[s];
    if (bg) return tone(bg);                                  // mã có trong legend → màu
    return [null, "#111", esc(s)];                            // mã lạ → hiện chữ
  };

  // ── 2) BLOCKS: hàng header có "01" & "02" (giới hạn cột < legend để không đụng legend) ──
  const isUnitHdr = (r: number) => { let a = false, b = false; for (let c = 0; c < legCol; c++) { const v = S(valAt(r, c)); if (v === "01") a = true; else if (v === "02") b = true; } return a && b; };
  const blockRows: number[] = []; for (let r = 0; r <= nR; r++) if (isUnitHdr(r)) blockRows.push(r);
  const firstBlockR = blockRows.length ? blockRows[0] : (nR + 1);

  let blocksHtml = "";
  blockRows.forEach((hr, bi) => {
    const label = S(valAt(hr, 0)) || `Block ${bi + 1}`;
    const unitCols: number[] = []; const pctCols: { c: number; label: string }[] = [];
    for (let c = 1; c < legCol; c++) {
      const h = S(valAt(hr, c));
      if (!h) { if (pctCols.length || unitCols.length) break; else continue; }
      if (/^\d{1,3}$/.test(h) || /^hl$/i.test(h)) unitCols.push(c);
      else if (unitCols.length && /mặt\s*bằng|giao\s*th[ôo]|tinh|defect|xo[áa]|đã\s*giao|%/i.test(h)) pctCols.push({ c, label: h });
      else if (unitCols.length) break;
    }
    const next = bi + 1 < blockRows.length ? blockRows[bi + 1] : (nR + 1);
    const dataRows: number[] = [];
    for (let r = hr + 1; r < next; r++) { if (!S(valAt(r, 0))) break; dataRows.push(r); }
    const pctVal = (c: number): number | null => { for (const r of dataRows) { const v = valAt(r, c); if (typeof v === "number" && v >= 0 && v <= 1) return v; } return null; };

    let t = `<table class="mtld-blk">`;
    t += `<tr><td class="mtld-bn">${esc(label)}</td>` + unitCols.map((c) => `<td class="mtld-hd">${esc(S(valAt(hr, c)))}</td>`).join("")
      + pctCols.map((p) => `<td class="mtld-hd sm">${esc(p.label)}</td>`).join("") + `</tr>`;
    dataRows.forEach((r, ri) => {
      t += `<tr><td class="mtld-lbl">${esc(S(valAt(r, 0)))}</td>`;
      for (const c of unitCols) { const [bg, fg, tx] = gridColorOf(valAt(r, c)); t += `<td class="mtld-cell" style="background:${bg ?? "#fff"};color:${fg}">${tx}</td>`; }
      if (ri === 0) {
        const rs = dataRows.length;
        for (const p of pctCols) {
          const v = pctVal(p.c);
          t += v == null ? `<td rowspan="${rs}" class="mtld-pct"></td>`
            : `<td rowspan="${rs}" class="mtld-pct"><span class="mtld-sb" style="width:${Math.round(v * 100)}%"></span><span class="mtld-st">${Math.round(v * 100)}%</span></td>`;
        }
      }
      t += `</tr>`;
    });
    blocksHtml += t + `</table>`;
  });

  // ── 3) TOP: mọi dòng trên block đầu, cột < legend — tô fill tĩnh + giữ merge + giá trị ──
  let top = "";
  if (firstBlockR > 0) {
    const topEndC = Math.min(legCol - 1, nC);
    top = `<table class="mtld-top">`;
    for (let r = 0; r < firstBlockR; r++) {
      top += "<tr>";
      for (let c = 0; c <= topEndC; c++) {
        const cv = cover(r, c); if (cv && !(cv.s.r === r && cv.s.c === c)) continue;
        let span = ""; if (cv) { const cs = Math.min(cv.e.c, topEndC) - c + 1, rs = cv.e.r - cv.s.r + 1; if (cs > 1) span += ` colspan="${cs}"`; if (rs > 1) span += ` rowspan="${rs}"`; }
        const bg = fillAt(r, c); const fg = bg && lum(bg) < 140 ? "#fff" : "#111";
        const txt = txtAt(r, c);
        top += `<td${span} style="background:${bg ?? "transparent"};color:${fg}">${esc(txt)}</td>`;
      }
      top += "</tr>";
    }
    top += "</table>";
  }

  // ── 4) LEGEND html ──
  let legHtml = "";
  if (legend.length) {
    const hasQty = legend.some((l) => l.qty);
    legHtml = `<table class="mtld-lg"><tr><td class="lh">Màu</td><td class="lh">Diễn giải</td>${hasQty ? '<td class="lh">SL</td>' : ""}</tr>`;
    for (const l of legend) legHtml += `<tr><td style="background:${l.color};width:26px"></td><td class="ld">${esc(l.text)}</td>${hasQty ? `<td class="lc">${esc(l.qty)}</td>` : ""}</tr>`;
    legHtml += "</table>";
  }

  return `<div class="mtld-summary"><div class="mtld-top-row">${top}${legHtml}</div><div class="mtld-body">${blocksHtml}</div></div>`;
}

/** CSS đi kèm — nhúng 1 lần trong popup. */
export const SUMMARY_CSS = `
.mtld-summary{font:11px 'Segoe UI',Arial;color:#111;background:#fff}
.mtld-top-row{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;margin-bottom:12px}
.mtld-top{border-collapse:collapse}
.mtld-top td{border:1px solid #333;padding:1px 6px;text-align:center;font-size:10px;font-weight:600;white-space:nowrap;height:18px}
.mtld-body{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}
.mtld-blk{border-collapse:collapse;table-layout:fixed;margin:0 0 12px}
.mtld-blk td{border:1px solid #333;height:20px;min-width:22px;text-align:center;font-size:10px;overflow:hidden;padding:0}
.mtld-bn{background:#0f2547;color:#fff;font-weight:800}
.mtld-hd{background:#2f4a78;color:#fff;font-weight:700}.mtld-hd.sm{white-space:normal;font-size:8.5px;line-height:1.05;min-width:40px}
.mtld-lbl{background:#1F3864;color:#fff;font-weight:700}
.mtld-cell{font-weight:700}
.mtld-pct{position:relative;background:#eef1f6;font-weight:700;text-align:center;min-width:46px}
.mtld-sb{position:absolute;left:0;top:0;bottom:0;background:#4A86E8;opacity:.85}.mtld-st{position:relative;z-index:1}
.mtld-lg{border-collapse:collapse;font-size:10px}.mtld-lg td{border:1px solid #333;padding:1px 6px}
.mtld-lg .lh{background:#1F3864;color:#fff;font-weight:700;text-align:center}.mtld-lg .ld{white-space:nowrap}.mtld-lg .lc{text-align:right;font-weight:700}`;
