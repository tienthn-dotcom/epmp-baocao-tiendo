/**
 * ETL · TCLĐ (Thi công lắp đặt) — đọc SHEET MẪU dựng sẵn (không đoán định dạng) → canonical.
 * Mẫu cột cố định (tab "TCLD"): maCT · Tên dự án · Loại · Hàng · Cột · % · Ngày chốt.
 *   • Loại = "public" → gom theo HÀNG (khu/tầng) → biểu đồ CỘT (bar %).
 *   • Loại = "phong"  → ma trận HÀNG×CỘT (phòng × hạng mục) → HEATMAP %.
 * THUẦN hàm (rows: (string|number|null)[][]) → chạy CLIENT (Worker không parse xlsx).
 * Khớp dự án bên ePMP bằng maCT + Tên (đọc thẳng trong sheet).
 */
export type TcldCell = { row: string; col: string; percent: number | null };
export type TcldZone = { zone: string; percent: number | null };
export type TcldProject = {
  maCT: string;
  name: string;
  mode: "public" | "phong";
  zones: TcldZone[];        // mode=public: mỗi khu 1 %
  rooms: string[];          // mode=phong: danh sách HÀNG (phòng) theo thứ tự gặp
  cols: string[];           // mode=phong: danh sách CỘT (hạng mục) theo thứ tự gặp
  cells: TcldCell[];        // mode=phong: ô (hàng,cột,%)
  overall: number | null;   // % tổng = trung bình các mục có số
  asOf?: string;            // Ngày chốt (nếu có)
  count: number;            // số dòng dữ liệu
};
export type TcldParse = { projects: TcldProject[]; issues: string[] };

const S = (v: unknown) => (v == null ? "" : String(v).trim());
/** bỏ dấu tiếng Việt + thường hoá để dò tên cột chịu được gõ khác nhau. */
const norm = (v: unknown) =>
  S(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/\s+/g, " ").trim();
const pct = (v: unknown): number | null => {
  const m = /(-?\d+(?:[.,]\d+)?)/.exec(S(v).replace("%", ""));
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
};
const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};

/** Dò hàng tiêu đề (chứa "mact"/"ma ct" + "loai") trong ~8 hàng đầu; map cột theo TÊN. */
function locateHeader(rows: (string | number | null)[][]): { hr: number; col: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const h = (rows[i] ?? []).map(norm);
    const find = (...kw: string[]) => h.findIndex((c) => kw.some((k) => c === k || c.includes(k)));
    const maCT = find("mact", "ma ct", "ma cong trinh");
    const loai = find("loai");
    if (maCT >= 0 && loai >= 0) {
      return {
        hr: i,
        col: {
          maCT,
          name: find("ten du an", "ten"),
          loai,
          hang: find("hang", "khu", "tang", "phong"),
          cot: find("cot", "hang muc"),
          pct: h.findIndex((c) => c === "%" || c.includes("phan tram") || c.includes("hoan thanh")),
          asOf: find("ngay chot", "ngay"),
        },
      };
    }
  }
  return null;
}

export function parseTcldTemplate(rows: (string | number | null)[][]): TcldParse {
  const issues: string[] = [];
  const loc = locateHeader(rows);
  if (!loc) return { projects: [], issues: ["Không thấy hàng tiêu đề có cột “maCT” và “Loại” — kiểm tra tab dữ liệu (mẫu: maCT · Tên dự án · Loại · Hàng · Cột · %)."] };
  const { hr, col } = loc;
  if (col.name < 0) issues.push("Thiếu cột “Tên dự án”.");
  if (col.hang < 0) issues.push("Thiếu cột “Hàng”.");
  if (col.pct < 0) issues.push("Thiếu cột “%”.");

  const g = (r: (string | number | null)[], i: number) => (i >= 0 ? S(r[i]) : "");
  // Gom theo dự án (maCT + Tên). Giữ thứ tự gặp.
  const byKey = new Map<string, TcldProject>();
  let dataRows = 0, badLoai = 0, badPct = 0;
  for (let i = hr + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const maCT = g(r, col.maCT), name = g(r, col.name);
    const hang = g(r, col.hang);
    if (!maCT && !name && !hang) continue;               // dòng trống
    const loaiRaw = norm(g(r, col.loai));
    const mode: "public" | "phong" | null =
      /phong|room/.test(loaiRaw) ? "phong" : /public|khu|cong cong/.test(loaiRaw) ? "public" : null;
    if (!mode) { badLoai++; issues.length < 40 && issues.push(`[dòng ${i + 1}] Loại “${g(r, col.loai)}” không hợp lệ (chỉ nhận public / phong).`); continue; }
    const p = pct(g(r, col.pct));
    if (p == null && g(r, col.pct) !== "") badPct++;
    dataRows++;

    const key = `${maCT.toLowerCase()}||${name.toLowerCase()}`;
    let proj = byKey.get(key);
    if (!proj) { proj = { maCT, name, mode, zones: [], rooms: [], cols: [], cells: [], overall: null, count: 0, asOf: g(r, col.asOf) || undefined }; byKey.set(key, proj); }
    proj.count++;
    if (mode === "public") {
      proj.zones.push({ zone: hang || "—", percent: p });
    } else {
      proj.mode = "phong";                               // 1 dòng phong → cả dự án là phong
      const cot = g(r, col.cot) || "—";
      if (!proj.rooms.includes(hang || "—")) proj.rooms.push(hang || "—");
      if (!proj.cols.includes(cot)) proj.cols.push(cot);
      proj.cells.push({ row: hang || "—", col: cot, percent: p });
    }
  }

  const projects = [...byKey.values()];
  for (const proj of projects) {
    proj.overall = proj.mode === "public" ? avg(proj.zones.map((z) => z.percent)) : avg(proj.cells.map((c) => c.percent));
  }
  if (!projects.length && !issues.length) issues.push("Không có dòng dữ liệu nào dưới hàng tiêu đề.");
  if (badLoai) issues.push(`${badLoai} dòng bị bỏ vì cột Loại không hợp lệ.`);
  if (badPct) issues.push(`${badPct} ô % không đọc được (để trống trong tính toán).`);
  return { projects, issues };
}
