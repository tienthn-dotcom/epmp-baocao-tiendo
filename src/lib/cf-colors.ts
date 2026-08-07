/**
 * ĐỌC BẢN ĐỒ "MÃ Ô → MÀU THẬT" từ CONDITIONAL FORMATTING của 1 sheet trong xlsx.
 *
 * VÌ SAO: ma trận lắp đặt tô màu ô bằng conditional-formatting (mã 5 → xanh lá…). SheetJS KHÔNG đọc
 * được CF → summary-render trước đây ĐOÁN màu theo THỨ TỰ legend, nhưng mã trong lưới KHÔNG khớp thứ
 * tự (vd blank=Chưa bàn giao, 1=Đang thi công, 5=Xoá Defect XANH LÁ) → lệch màu hết. Đọc CF cho ĐÚNG.
 *
 * Cách làm: giải nén xlsx (fflate) → tìm sheet theo tên → đọc <cfRule operator="equal"> (mã → dxfId)
 * + <dxfs> trong styles.xml (dxfId → fill color). Lỗi/không có CF → {} (nơi gọi lùi về đoán legend cũ).
 * Khoá "" = màu của ô "trống/khoảng trắng" (thường = trạng thái đầu, vd Chưa bàn giao).
 */
import { unzipSync, strFromU8 } from "fflate";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function colorFromDxf(x: string): string | null {
  const b = (x.match(/<bgColor[^>]*rgb="([0-9A-Fa-f]{6,8})"/) || [])[1];
  const g = (x.match(/<fgColor[^>]*rgb="([0-9A-Fa-f]{6,8})"/) || [])[1];
  let h = b || g; if (!h) return null;
  if (h.length === 8) h = h.slice(2);
  return /^[0-9A-Fa-f]{6}$/.test(h) ? "#" + h.toUpperCase() : null;
}

export function readCodeColors(bytes: Uint8Array, sheetName: string): Record<string, string> {
  try {
    const zip = unzipSync(bytes);
    const rd = (p: string) => (zip[p] ? strFromU8(zip[p]) : "");

    // 1) tên sheet → r:id → file worksheets/sheetN.xml
    const wbXml = rd("xl/workbook.xml");
    const stag = wbXml.match(new RegExp(`<sheet\\b[^>]*name="${esc(sheetName)}"[^>]*/?>`, "i"));
    if (!stag) return {};
    const rid = (stag[0].match(/r:id="([^"]+)"/) || [])[1];
    if (!rid) return {};
    const rels = rd("xl/_rels/workbook.xml.rels");
    const rel = rels.match(new RegExp(`<Relationship\\b[^>]*Id="${esc(rid)}"[^>]*/?>`));
    let target = rel ? (rel[0].match(/Target="([^"]+)"/) || [])[1] : "";
    if (!target) return {};
    target = target.replace(/^\/?/, "");
    if (!target.startsWith("xl/")) target = "xl/" + target;
    const shXml = rd(target);
    if (!shXml) return {};

    // 2) CF: <cfRule operator="equal" dxfId=N ...><formula>V</formula>
    const rules: { code: string; dxf: number }[] = [];
    for (const m of shXml.matchAll(/<cfRule\b([^>]*)>\s*<formula>([^<]*)<\/formula>/g)) {
      if (!/operator="equal"/.test(m[1])) continue;
      const dxf = (m[1].match(/dxfId="(\d+)"/) || [])[1];
      if (dxf == null) continue;
      let f = m[2].replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();
      if (/^".*"$/.test(f)) f = f.slice(1, -1);           // bỏ nháy chuỗi
      const code = f.trim() === "" ? "" : f.trim().toUpperCase();
      rules.push({ code, dxf: +dxf });
    }
    if (!rules.length) return {};

    // 3) dxfs → màu
    const styles = rd("xl/styles.xml");
    const block = (styles.match(/<dxfs\b[^>]*>([\s\S]*?)<\/dxfs>/) || [])[1] || "";
    const dxfs: string[] = [];
    for (const m of block.matchAll(/<dxf>([\s\S]*?)<\/dxf>/g)) dxfs.push(m[1]);

    const out: Record<string, string> = {};
    for (const r of rules) {
      const col = colorFromDxf(dxfs[r.dxf] || "");
      if (col && !(r.code in out)) out[r.code] = col;
    }
    return out;
  } catch { return {}; }
}
