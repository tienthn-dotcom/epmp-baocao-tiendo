/**
 * READER MA TRẬN ĐỊNH LƯỢNG — TRÁI TIM DATA của module MTLĐ (Tường Camera Lắp đặt).
 * Port thẳng từ D:\AACORP\AA_DuAn\MTLĐ\BAN-GIAO-ePMP\reader.mjs (logic giữ nguyên, chỉ thêm type).
 *
 * NGUYÊN LÝ (đã kiểm chứng trên 5 ma trận khác cột nhau, số khớp file gốc):
 *  1. KHÔNG đọc cột vật tư (phần biến thiên). Chỉ khoá bộ xương bất biến: header có
 *     Tòa/Tầng/Căn/Khối lượng, và cột "TỔNG" (quét vùng header±2, ưu tiên phải nhất).
 *  2. Phân loại dòng tổng vs lá bằng HƯỚNG công thức (layout-independent): 1 dòng là "tổng"
 *     nếu ô TỔNG HOẶC bất kỳ ô NHÓM nào của nó tham chiếu DÒNG KHÁC (AVERAGE dọc).
 *  3. Cấp bậc theo ô đã điền: chỉ Tòa=toà; Tòa+Căn(tên)+là-tổng=khu vực (Public);
 *     Tòa+Tầng không Căn=tầng (Phòng); đủ 3=căn lá.
 *  4. % = đọc thẳng cột TỔNG ở dòng tổng. "X"=không áp dụng (null), 0=có mà chưa làm.
 *  5. PHẢI bật formula khi read workbook: XLSX.read(buf,{cellFormula:true,cellDates:true}).
 *
 * Reader KHÔNG tự sửa/điền số — chỉ đọc + gắn cờ chất lượng (structural). Sai phải LỘ ra.
 */
import * as XLSX from "xlsx";
import type { MatrixResult, QualityFlag, RawLevel, RawUnit } from "./monitor-types";

/** Đọc 1 worksheet ma trận → cây phân cấp + cờ chất lượng. Hàm thuần (browser + node). */
export function readMatrixSheet(sh: XLSX.WorkSheet): MatrixResult {
  const ref = sh["!ref"];
  if (!ref) return { ok: false, error: "Sheet rỗng (không có !ref)" };
  const range = XLSX.utils.decode_range(ref);
  const cell = (r: number, c: number): XLSX.CellObject | undefined =>
    sh[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
  const S = (r: number, c: number): string => {
    const cl = cell(r, c);
    return cl && cl.v != null ? String(cl.v).replace(/\s+/g, " ").trim() : "";
  };
  const C = (a: string): number => XLSX.utils.decode_col(a);

  // 1) header row: có Tòa & Căn & Khối lượng trong 12 dòng đầu
  let hdr = -1;
  for (let r = range.s.r; r <= Math.min(range.s.r + 12, range.e.r); r++) {
    const j: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cl = cell(r, c);
      if (cl && cl.v != null) j.push(String(cl.v).toLowerCase());
    }
    const s = j.join(" | ");
    if (/tòa|toà/.test(s) && /căn/.test(s) && /khối\s*lượng/.test(s)) { hdr = r; break; }
  }
  if (hdr < 0) return { ok: false, error: "Không tìm thấy header (Tòa/Căn/Khối lượng)" };

  const findCol = (re: RegExp): number => {
    for (let c = range.s.c; c <= range.e.c; c++) if (re.test(S(hdr, c).toLowerCase())) return c;
    return -1;
  };
  const colToa = findCol(/^tòa$|^toà$/), colTang = findCol(/^tầng$/), colCan = findCol(/^căn$/);
  // cột TỔNG: nhãn "TỔNG"/"Tổng" quét [hdr-2 .. hdr], ưu tiên phải nhất
  let colTong = -1;
  for (let c = range.e.c; c >= range.s.c && colTong < 0; c--)
    for (let r = Math.max(range.s.r, hdr - 2); r <= hdr; r++)
      if (/^t[ổo]ng$/i.test(S(r, c))) { colTong = c; break; }
  if (colTong < 0) return { ok: false, error: 'Không tìm thấy cột "TỔNG"' };

  // 2) đọc từng dòng có giá trị TỔNG
  const parseRefRows = (f: string | undefined): number[] => { // dòng (1-based) tham chiếu trong công thức
    if (!f) return [];
    const rows = new Set<number>();
    const re = /\$?[A-Z]+\$?(\d+)(?::\$?[A-Z]+\$?(\d+))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f))) {
      const a = +m[1], b = m[2] ? +m[2] : a;
      for (let r = Math.min(a, b); r <= Math.max(a, b); r++) rows.add(r);
    }
    return [...rows];
  };
  const parseRefCols = (f: string | undefined): number[] => { // cột (0-based) tham chiếu — lấy cột nhóm
    if (!f) return [];
    const cols = new Set<number>();
    const re = /\$?([A-Z]+)\$?\d+(?::\$?([A-Z]+)\$?\d+)?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f))) {
      const a = C(m[1]), b = m[2] ? C(m[2]) : a;
      for (let c = Math.min(a, b); c <= Math.max(a, b); c++) cols.add(c);
    }
    return [...cols];
  };
  const num = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const n = parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };
  // cột NHÓM = các cột tham chiếu trong 1 công thức TỔNG đại diện (cùng dòng)
  let groupCols: number[] = [];
  for (let r = hdr + 1; r <= range.e.r && !groupCols.length; r++) {
    const cl = cell(r, colTong);
    if (cl && cl.f) groupCols = parseRefCols(cl.f).filter((c) => c !== colTong);
  }
  // 1 dòng là "tổng" nếu công thức TỔNG hoặc bất kỳ ô NHÓM nào tham chiếu DÒNG KHÁC
  const rowIsAgg = (r: number): boolean => {
    const check = (cl: XLSX.CellObject | undefined): boolean =>
      !!(cl && cl.f && parseRefRows(cl.f).some((rr) => rr !== r + 1));
    if (check(cell(r, colTong))) return true;
    for (const gc of groupCols) if (check(cell(r, gc))) return true;
    return false;
  };

  const units: RawUnit[] = [];
  let curToa = "", curTang = "";
  for (let r = hdr + 1; r <= range.e.r; r++) {
    const toa = S(r, colToa), tang = S(r, colTang), can = S(r, colCan);
    if (!toa && !tang && !can) continue;
    if (toa) curToa = toa;
    const tongCl = cell(r, colTong);
    if (!tongCl || (tongCl.v == null && !tongCl.f)) { if (tang) curTang = tang; continue; }
    const pct = num(tongCl.v);
    const f = tongCl.f || "";
    const isAgg = f || groupCols.length ? rowIsAgg(r) : !can; // static toàn dòng: cha nếu không có Căn
    // cấp bậc theo ô đã điền
    let level: RawLevel;
    if (toa && !tang && !can) level = "toa";
    else if (can && isAgg) level = "khuvuc";     // Public: Căn = tên khu vực + là tổng
    else if (tang && !can) level = "tang";        // Phòng: dòng tầng tổng
    else level = "can";                           // lá
    if (tang) curTang = tang;
    units.push({
      toa: curToa, tang: level === "toa" ? "" : (tang || curTang), can,
      level, isAgg, pct,
      name: level === "khuvuc" ? can : level === "tang" ? curToa + "/" + tang : level === "toa" ? curToa : can,
      overridden: !!(f === "" && pct != null && (level === "khuvuc" || level === "tang" || level === "toa")),
      hasFormula: !!f,
    });
  }
  const goiCell = (() => {
    for (let r = range.s.r; r < hdr; r++)
      for (let c = range.s.c; c <= range.e.c; c++) if (/^gói:?$/i.test(S(r, c))) return S(r, c + 1);
    return "";
  })();
  const toaCell = (() => {
    for (let r = range.s.r; r < hdr; r++)
      for (let c = range.s.c; c <= range.e.c; c++) if (/^tòa:?$|^toà:?$/i.test(S(r, c))) return S(r, c + 1);
    return "";
  })();

  // ── BỘ KIỂM RÁC (structural, chưa cần ngưỡng nghiệp vụ) ──
  const q: QualityFlag[] = [];
  const add = (id: string, level: "error" | "warn", count: number, label: string, samples: string[]) => {
    if (count > 0) q.push({ id, level, count, label, samples: (samples || []).slice(0, 4) });
  };
  const oor = units.filter((u) => u.pct != null && (u.pct < 0 || u.pct > 1));
  add("pct_range", "error", oor.length, "% ngoài khoảng [0,1] (rác lọt vào ô tổng)", oor.map((u) => `${u.name}=${((u.pct as number) * 100).toFixed(0)}%`));
  const ov = units.filter((u) => u.overridden);
  add("override", "warn", ov.length, "ô tổng NHẬP ĐÈ tay (không phải công thức) — cần rà so trung bình con", ov.map((u) => u.name));
  const blank = units.filter((u) => u.isAgg && u.pct == null);
  add("blank_agg", "warn", blank.length, "dòng tổng RỖNG (khu/tầng có mục con nhưng chưa có số)", blank.map((u) => u.name));
  // toà không có khu vực/tầng con
  const parents = units.filter((u) => u.level === "toa");
  const childless = parents.filter((p) => !units.some((u) => u !== p && u.isAgg && u.level !== "toa" && u.toa === p.toa));
  add("toa_no_child", "warn", childless.length, "toà không có khu vực/tầng con nào", childless.map((u) => u.toa));

  return {
    ok: true, header: hdr + 1, tongCol: XLSX.utils.encode_col(colTong), goi: goiCell, toaLabel: toaCell,
    units, quality: q,
    qlevel: q.some((c) => c.level === "error") ? "error" : q.some((c) => c.level === "warn") ? "warn" : "ok",
  };
}

/** Các sheet có chữ "MA TRẬN ĐỊNH LƯỢNG" (trong 3 dòng đầu). */
export function findMatrixSheets(wb: XLSX.WorkBook): string[] {
  return wb.SheetNames.filter((n) => {
    const sh = wb.Sheets[n];
    if (!sh || !sh["!ref"]) return false;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, defval: null });
    const head = ((rows[0] || []) as unknown[]).concat(rows[1] || [], rows[2] || []).join(" ");
    return /MA\s*TRẬN\s*ĐỊNH\s*LƯỢNG/i.test(head);
  });
}

/** Tiện ích: đọc cả workbook từ buffer → mọi sheet ma trận. PHẢI bật cellFormula (bước phân cấp
 *  cần công thức). Dùng ở FileDrop phía app. */
export function parseMatrixWorkbook(buf: ArrayBuffer): Array<{ sheet: string; result: MatrixResult }> {
  const wb = XLSX.read(buf, { type: "array", cellFormula: true, cellDates: true });
  return findMatrixSheets(wb).map((sheet) => ({ sheet, result: readMatrixSheet(wb.Sheets[sheet]) }));
}
