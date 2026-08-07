/**
 * RENDER sheet "Public Summary" → HTML (bảng + biểu đồ cột) cho popup "Thi công lắp đặt".
 * Thuần (browser + node). KHÁC dạng phòng (summary-render = heatmap); app tự chọn theo TÊN sheet.
 *
 * Nguồn (dò cột theo TIÊU ĐỀ — đảo cột trong file KHÔNG hỏng, vẫn bắt đúng theo tên header):
 *   Tiêu đề = A1 · "Ngày báo cáo" = ô cạnh nhãn. Header = dòng có "Các khu" + "% ... thực tế".
 *   THỨ TỰ CỘT HIỂN THỊ (theo mẫu mới của nguồn): STT · Các khu · Ngày bắt đầu · Ngày bàn giao ·
 *        % xong hôm trước · % thực tế · % tăng thêm trong ngày · Cảnh báo trễ tiến độ · Chênh lệch.
 * Biểu đồ: thanh xanh = K (lũy kế hôm trước); chóp = L (tăng trong ngày, xanh nếu ĐẠT/đỏ nếu CHẬM);
 *   đường đỏ nét đứt = G (kế hoạch). Trục 0–100%.
 */
import * as XLSX from "xlsx";

const esc = (s: string) => String(s).replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]!));
const S = (v: unknown) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();

/** Ô → số (chấp nhận 0.97, "97%", "97"). Trả FRACTION (0.97). null nếu không phải số. */
function frac(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[%\s]/g, "").replace(",", ".");
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = parseFloat(s);
  return Math.abs(n) > 1.5 ? n / 100 : n; // "97" → 0.97
}
const pctI = (f: number | null) => (f == null ? "—" : Math.round(f * 100) + "%");
const pctS = (f: number | null) => (f == null ? "—" : (f >= 0 ? "+" : "") + Math.round(f * 100) + "%");
const pct2 = (f: number | null) => (f == null ? "—" : (f * 100).toFixed(2).replace(".", ",") + "%");
const dvn = (v: unknown): string => {
  if (v instanceof Date && !isNaN(v.getTime())) return `${String(v.getDate()).padStart(2, "0")}/${String(v.getMonth() + 1).padStart(2, "0")}/${v.getFullYear()}`;
  // Client parse KHÔNG bật cellDates → ô ngày ra SỐ SERIAL Excel → tự đổi về dd/mm/yyyy
  // (epoch 1899-12-30 để khớp bug năm 1900 của Excel; dùng UTC tránh lệch múi giờ).
  if (typeof v === "number" && v > 1000 && v < 90000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
  }
  const s = S(v);
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);   // chuỗi ISO → dd/mm/yyyy
  if (m) return `${m[3].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[1]}`;
  return s;
};

type Row = { stt: string; khu: string; start: string; deadline: string; plan: number | null; actual: number | null; diff: number | null; warn: string; prev: number | null; today: number | null; ok: boolean };

export function publicSummaryToHtml(sh: XLSX.WorkSheet): string {
  const ref = sh["!ref"]; if (!ref) return `<div class="ps-empty">Sheet rỗng.</div>`;
  const range = XLSX.utils.decode_range(ref);
  const cell = (r: number, c: number) => sh[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
  const val = (r: number, c: number) => cell(r, c)?.v;

  // 1) TIÊU ĐỀ + NGÀY BÁO CÁO
  const title = S(val(0, 0)) || "BÁO CÁO TIẾN ĐỘ LẮP ĐẶT";
  let repDate = "";
  for (let r = 0; r < Math.min(4, range.e.r); r++)
    for (let c = 0; c <= Math.min(20, range.e.c); c++)
      if (/ngày báo cáo/i.test(S(val(r, c)))) { repDate = dvn(val(r, c + 1)) || S(val(r, c + 1)); break; }

  // 2) HEADER ROW = dòng có "các khu" + "thực tế"
  let hr = -1;
  for (let r = 0; r < Math.min(8, range.e.r); r++) {
    const j = []; for (let c = 0; c <= range.e.c; c++) j.push(S(val(r, c)).toLowerCase());
    const s = j.join(" | ");
    if (/các khu|^khu\b/.test(s) && /thực tế/.test(s)) { hr = r; break; }
  }
  if (hr < 0) return `<div class="ps-empty">Không nhận diện được bảng Public Summary (thiếu header “Các khu / % thực tế”).</div>`;
  const find = (re: RegExp) => { for (let c = 0; c <= range.e.c; c++) if (re.test(S(val(hr, c)).toLowerCase())) return c; return -1; };
  const cStt = find(/số thứ tự|^stt/), cKhu = find(/các khu/), cStart = find(/bắt đầu/), cDl = find(/bàn giao/),
    cAct = find(/thực tế/), cDiff = find(/chênh lệch/), cWarn = find(/cảnh báo/),
    cPrev = find(/xong hôm trước/), cToday = find(/tăng thêm/);
  const cKhuData = cKhu >= 0 ? cKhu : 1;
  // ĐƯỜNG KẾ HOẠCH = cột "Kế hoạch <ngày>" / "KH <ngày> (raw)" (mốc lắp đặt), KHÔNG phải "% dự kiến".
  // Có nhiều mốc (15/8, 30/8, 15/9) → chọn cột được ĐIỀN NHIỀU SỐ nhất (mốc đang áp dụng); #N/A bỏ.
  let cPlan = -1, planLabel = "Kế hoạch";
  { let best = -1;
    for (let c = 0; c <= range.e.c; c++) {
      const h = S(val(hr, c));
      if (!(/^kế hoạch\s*\d/i.test(h) || /^kh\s*\d.*\(?\s*raw\)?/i.test(h))) continue;
      let num = 0;
      for (let r = hr + 1; r <= range.e.r; r++) { if (!S(val(r, cKhuData))) break; if (frac(val(r, c)) != null) num++; }
      if (num > best) { best = num; cPlan = c; planLabel = h.replace(/\s*\(?\s*raw\s*\)?/i, "").trim(); }
    }
  }

  // 3) DỮ LIỆU: từ hr+1, dừng khi ô "Các khu" trống
  const rows: Row[] = [];
  for (let r = hr + 1; r <= range.e.r; r++) {
    const khu = S(val(r, cKhu >= 0 ? cKhu : 1));
    if (!khu) break;
    const warn = S(val(r, cWarn));
    rows.push({
      stt: S(val(r, cStt >= 0 ? cStt : 0)), khu,
      start: dvn(val(r, cStart)), deadline: dvn(val(r, cDl)),
      plan: frac(val(r, cPlan)), actual: frac(val(r, cAct)), diff: frac(val(r, cDiff)),
      warn, prev: frac(val(r, cPrev)), today: frac(val(r, cToday)),
      ok: /đạt/i.test(warn) && !/chậm|báo động/i.test(warn),
    });
  }

  // 4) BẢNG (9 cột) — THỨ TỰ CỘT theo mẫu mới của nguồn:
  //    STT · Các khu · Ngày bắt đầu · Ngày bàn giao · % xong hôm trước · % thực tế ·
  //    % tăng thêm trong ngày · Cảnh báo trễ tiến độ · Chênh lệch so với kế hoạch.
  const th = (t: string) => `<th>${esc(t)}</th>`;
  const head = `<tr>${th("STT")}${th("Các khu PUBLIC")}${th("Ngày bắt đầu")}${th("Ngày bàn giao")}${th("% xong hôm trước")}${th("% thực tế")}${th("% tăng thêm trong ngày")}${th("Cảnh báo trễ tiến độ")}${th("Chênh lệch")}</tr>`;
  const body = rows.map((x) => {
    const warnCls = x.ok ? "ps-ok" : /chậm|báo động/i.test(x.warn) ? "ps-late" : "";
    const diffCls = (x.diff ?? 0) < 0 ? "ps-neg" : "ps-pos";
    return `<tr>
      <td class="ps-c">${esc(x.stt)}</td><td class="ps-l">${esc(x.khu)}</td>
      <td class="ps-c">${esc(x.start)}</td><td class="ps-c">${esc(x.deadline)}</td>
      <td class="ps-c ps-blue">${pctI(x.prev)}</td><td class="ps-c ps-b">${pctI(x.actual)}</td>
      <td class="ps-c ${(x.today ?? 0) > 0 ? "ps-hl" : ""}">${pct2(x.today)}</td>
      <td class="ps-c ${warnCls}">${esc(x.warn || "—")}</td>
      <td class="ps-c ${diffCls}">${pctS(x.diff)}</td>
    </tr>`;
  }).join("");
  const table = `<table class="ps-tb"><thead>${head}</thead><tbody>${body}</tbody></table>`;

  // 5) BIỂU ĐỒ CỘT (SVG). Thanh = prev(K); chóp = today(L) xanh/đỏ; đường nét đứt = plan(G).
  const W = 960, H = 400, mL = 44, mR = 16, mT = 24, mB = 74;
  const iw = W - mL - mR, ih = H - mT - mB;
  const n = rows.length || 1;
  const bw = Math.min(58, (iw / n) * 0.62);
  const cx = (i: number) => mL + (iw / n) * (i + 0.5);
  const yOf = (f: number) => mT + ih * (1 - Math.max(0, Math.min(1, f)));
  const grid = [0, 0.25, 0.5, 0.75, 1].map((g) =>
    `<line x1="${mL}" y1="${yOf(g)}" x2="${W - mR}" y2="${yOf(g)}" class="ps-grid"/><text x="${mL - 6}" y="${yOf(g) + 3}" class="ps-yl">${g * 100}%</text>`).join("");
  const bars = rows.map((x, i) => {
    const k = x.prev ?? 0, t = x.today ?? 0, x0 = cx(i) - bw / 2;
    const yK = yOf(k), hK = mT + ih - yK;
    const yT = yOf(k + t), hT = yOf(k) - yT;
    const cap = hT > 0.5 ? `<rect x="${x0}" y="${yT}" width="${bw}" height="${hT}" class="${x.ok ? "ps-inc-ok" : "ps-inc-bad"}"/>` : "";
    const lbl = hK > 16 ? `<text x="${cx(i)}" y="${yK + hK / 2 + 4}" class="ps-barlbl">${pctI(k)}</text>` : `<text x="${cx(i)}" y="${yK - 5}" class="ps-barlbl-o">${pctI(k)}</text>`;
    return `<rect x="${x0}" y="${yK}" width="${bw}" height="${Math.max(0, hK)}" class="ps-bar"/>${cap}${lbl}
      <text x="${cx(i)}" y="${H - mB + 14}" class="ps-xl" transform="rotate(28 ${cx(i)} ${H - mB + 14})">${esc(x.khu)}</text>`;
  }).join("");
  const planPts = rows.map((x, i) => (x.plan == null ? "" : `${cx(i)},${yOf(x.plan)}`)).filter(Boolean).join(" ");
  const planDots = rows.map((x, i) => (x.plan == null ? "" : `<circle cx="${cx(i)}" cy="${yOf(x.plan)}" r="3" class="ps-plan-dot"/>`)).join("");
  const chart = `<svg viewBox="0 0 ${W} ${H}" class="ps-svg" preserveAspectRatio="xMidYMid meet">
    ${grid}${bars}
    <polyline points="${planPts}" class="ps-plan"/>${planDots}
  </svg>`;
  const legend = `<div class="ps-lg">
    <span><i class="d ps-blue-sw"></i>% lũy kế đến hôm trước</span>
    <span><i class="d ps-g-sw"></i>Tăng đạt tốc độ</span>
    <span><i class="d ps-r-sw"></i>Tăng chậm</span>
    <span><i class="l ps-p-sw"></i>${esc(planLabel)}</span>
  </div>`;

  return `<div class="ps-wrap">
    <div class="ps-title">${esc(title)}${repDate ? `<span class="ps-date">Ngày báo cáo: ${esc(repDate)}</span>` : ""}</div>
    <div class="ps-scroll">${table}</div>
    <div class="ps-charttitle">Tiến độ hoàn thành các khu PUBLIC (% thực tế)</div>
    <div class="ps-scroll">${chart}</div>
    ${legend}
  </div>`;
}

export const PUBLIC_SUMMARY_CSS = `
.ps-wrap{font-family:"Segoe UI",system-ui,sans-serif;color:#0f172a}
.ps-title{font-weight:800;font-size:14px;color:#12305a;margin-bottom:10px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline}
.ps-title .ps-date{font-weight:700;color:#b91c1c;font-size:12px;background:#fff7cc;padding:2px 8px;border-radius:5px}
.ps-scroll{overflow-x:auto}
.ps-tb{border-collapse:collapse;width:100%;font-size:11.5px;min-width:820px}
.ps-tb th{background:#1f3b63;color:#fff;font-weight:700;padding:5px 6px;border:1px solid #17304f;text-align:center;line-height:1.15}
.ps-tb td{border:1px solid #d7dee7;padding:3px 6px;white-space:nowrap}
.ps-c{text-align:center} .ps-l{text-align:left} .ps-b{font-weight:800}
.ps-blue{color:#1d4ed8;font-weight:700}
.ps-neg{color:#b91c1c;font-weight:700} .ps-pos{color:#15803d;font-weight:700}
.ps-ok{background:#dcfce7;color:#166534;font-weight:800}
.ps-late{background:#fee2e2;color:#b91c1c;font-weight:800}
.ps-hl{background:#fde68a;font-weight:700}
.ps-charttitle{margin:16px 0 4px;text-align:center;font-weight:700;font-size:12.5px;color:#475569}
.ps-svg{width:100%;min-width:760px;height:auto;display:block}
.ps-grid{stroke:#e5e9f0;stroke-width:1}
.ps-yl{fill:#94a3b8;font-size:10px;text-anchor:end}
.ps-xl{fill:#475569;font-size:10px;text-anchor:start;font-weight:600}
.ps-bar{fill:#4472c4}
.ps-inc-ok{fill:#22a558} .ps-inc-bad{fill:#c0392b}
.ps-barlbl{fill:#fff;font-size:10px;font-weight:800;text-anchor:middle}
.ps-barlbl-o{fill:#334155;font-size:10px;font-weight:800;text-anchor:middle}
.ps-plan{fill:none;stroke:#c00000;stroke-width:2;stroke-dasharray:6 4}
.ps-plan-dot{fill:#c00000}
.ps-lg{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;margin-top:10px;font-size:11px;color:#475569}
.ps-lg span{display:inline-flex;align-items:center;gap:5px}
.ps-lg .d{width:11px;height:11px;border-radius:2px;display:inline-block}
.ps-lg .l{width:16px;height:0;border-top:2px dashed #c00000;display:inline-block}
.ps-blue-sw{background:#4472c4}.ps-g-sw{background:#22a558}.ps-r-sw{background:#c0392b}
`;
