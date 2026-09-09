/**
 * LỊCH SỬ THI CÔNG LẮP ĐẶT — mỗi ngày một mốc, cộng dồn dần.
 *
 * Ma trận lắp đặt chỉ nói "hôm nay tới đâu"; hỏi "tuần rồi chạy được bao nhiêu căn" thì chịu, vì
 * không ai giữ lại số của hôm qua. Module này chấm một MỐC NGÀY cho từng khu: phần trăm tổng và
 * số căn đã đạt 100%. Ngày nào không ghi là mất luôn ngày đó, không dựng lại được — nên việc ghi
 * phải rẻ và không phụ thuộc ai bấm nút.
 *
 * Module THUẦN: không import gì của server, để cả client (nơi đã parse sẵn ma trận) lẫn script
 * chạy tay đều dùng chung một cách tính. Kho lưu là CSV trên Drive — mở bằng Excel là đọc được,
 * không khoá vào app.
 */
import type { LongRow } from "./mtld-longtable";

/** Một dòng mốc: một KHU của một dự án tại một NGÀY. */
export type MocNgay = {
  ngay: string;        // ISO "YYYY-MM-DD" — ngày chấm
  maCT: string;
  duAn: string;
  sheet: string;       // tab ma trận (một dự án có thể nhiều toà = nhiều tab)
  khu: string;         // toà / khu vực; rỗng = cả dự án
  scope: string;       // public | rooms | other
  pct: number | null;  // % tổng của khu, 0..100 (null = ma trận để trống)
  canXong: number;     // số căn (đơn vị lá) đã đạt 100%
  canTong: number;     // tổng số căn của khu
};

const COT = ["ngay", "maCT", "duAn", "sheet", "khu", "scope", "pct", "canXong", "canTong"] as const;

/** Làm tròn 2 số lẻ, giữ null. Phần trăm ma trận là 0..1 nên nhân 100 tại đây. */
function pct100(v: number | null | undefined): number | null {
  return v == null || Number.isNaN(v) ? null : Math.round(v * 10000) / 100;
}

/**
 * Dựng mốc ngày từ bảng dài của một dự án (kết quả meltToLongTable).
 * Gom theo TOÀ: mỗi toà một dòng, kèm số căn lá đã đạt 100%. Dự án không chia toà thì cột `khu`
 * lấy tên khu vực đọc được; không có gì thì để trống và coi như một khu duy nhất của dự án.
 */
export function dungMocNgay(
  rows: LongRow[],
  meta: { ngay: string; maCT: string; duAn: string; sheet?: string },
): MocNgay[] {
  const theoKhu = new Map<string, { scope: string; pctAgg: number[]; la: (number | null)[] }>();
  for (const r of rows) {
    const khu = (r.toa || r.vung || "").trim();
    const o = theoKhu.get(khu) ?? { scope: r.scope, pctAgg: [], la: [] };
    // Dòng TỔNG của toà/khu → lấy % đọc thẳng; dòng lá → đếm căn.
    if (r.isAgg && r.level === "toa" && r.pct != null) o.pctAgg.push(r.pct);
    if (r.level === "can") o.la.push(r.pct);
    theoKhu.set(khu, o);
  }

  const ra: MocNgay[] = [];
  for (const [khu, o] of theoKhu) {
    // % của khu: ưu tiên dòng tổng do người ta nhập; không có thì trung bình các căn CÓ số.
    const laCoSo = o.la.filter((v): v is number => v != null);
    const pct = o.pctAgg.length
      ? o.pctAgg.reduce((a, b) => a + b, 0) / o.pctAgg.length
      : laCoSo.length ? laCoSo.reduce((a, b) => a + b, 0) / laCoSo.length : null;
    ra.push({
      ngay: meta.ngay,
      maCT: meta.maCT,
      duAn: meta.duAn,
      sheet: meta.sheet ?? "",
      khu,
      scope: o.scope,
      pct: pct100(pct),
      canXong: o.la.filter((v) => v != null && v >= 0.999).length,
      canTong: o.la.length,
    });
  }
  return ra.sort((a, b) => a.khu.localeCompare(b.khu, "vi"));
}

/* ── CSV: kho lưu trên Drive ─────────────────────────────────────────────────────────────── */

const boc = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function sangCsv(rows: MocNgay[]): string {
  return [COT.join(","), ...rows.map((r) => COT.map((c) => boc(r[c])).join(","))].join("\n") + "\n";
}

/** Đọc CSV đã lưu. Dòng hỏng thì bỏ qua chứ không ném lỗi — mất một dòng còn hơn mất cả file. */
export function docCsv(text: string): MocNgay[] {
  const dong = String(text || "").split(/\r?\n/).filter((d) => d.trim());
  if (dong.length < 2) return [];
  const cot = dong[0].split(",").map((x) => x.trim());
  const viTri = (ten: string) => cot.indexOf(ten);
  const ra: MocNgay[] = [];
  for (const d of dong.slice(1)) {
    const o = tachDong(d);
    const lay = (ten: string) => (viTri(ten) >= 0 ? (o[viTri(ten)] ?? "") : "");
    const ngay = lay("ngay");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay)) continue;
    const so = (s: string) => (s === "" ? null : Number(s));
    ra.push({
      ngay, maCT: lay("maCT"), duAn: lay("duAn"), sheet: lay("sheet"),
      khu: lay("khu"), scope: lay("scope"),
      pct: so(lay("pct")),
      canXong: Number(lay("canXong")) || 0,
      canTong: Number(lay("canTong")) || 0,
    });
  }
  return ra;
}

/** Tách một dòng CSV có xét dấu ngoặc kép (tên khu hay có dấu phẩy). */
function tachDong(d: string): string[] {
  const ra: string[] = [];
  let cur = "", trongNgoac = false;
  for (let i = 0; i < d.length; i++) {
    const c = d[i];
    if (trongNgoac) {
      if (c === '"' && d[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') trongNgoac = false;
      else cur += c;
    } else if (c === '"') trongNgoac = true;
    else if (c === ",") { ra.push(cur); cur = ""; }
    else cur += c;
  }
  ra.push(cur);
  return ra.map((x) => x.trim());
}

/**
 * Gộp mốc mới vào kho cũ: CHẤM LẠI TRONG NGÀY thì ĐÈ, ngày khác thì giữ nguyên.
 * Nhờ vậy mở app mấy lần trong ngày cũng không đẻ ra mấy chục dòng trùng, mà số vẫn là bản mới nhất.
 */
export function gopMoc(cu: MocNgay[], moi: MocNgay[]): MocNgay[] {
  if (!moi.length) return cu;
  const ngayMoi = new Set(moi.map((r) => `${r.ngay}|${r.sheet}|${r.khu}`));
  const giu = cu.filter((r) => !ngayMoi.has(`${r.ngay}|${r.sheet}|${r.khu}`));
  return [...giu, ...moi].sort((a, b) => a.ngay.localeCompare(b.ngay) || a.sheet.localeCompare(b.sheet) || a.khu.localeCompare(b.khu, "vi"));
}

/** Tên file kho của một dự án. Neo theo MÃ CT vì tên dự án hay bị sửa. */
export function tenFileLichSu(maCT: string, duAn: string): string {
  const ma = (maCT || "").split(/[,;/]/)[0].replace(/\s+/g, "").toUpperCase();
  const an = (duAn || "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 50);
  return `${/^CT\d{2}-\d+$/.test(ma) ? ma : (an || "Khac")}.csv`;
}

/* ── ĐỌC RA ĐỂ VẼ ───────────────────────────────────────────────────────────────────────── */

/** Cộng dồn toàn dự án theo ngày: số căn xong / tổng căn và % trung bình các khu. */
export function luyKeTheoNgay(rows: MocNgay[]): { ngay: string; canXong: number; canTong: number; pct: number | null }[] {
  const theoNgay = new Map<string, { xong: number; tong: number; pcts: number[] }>();
  for (const r of rows) {
    const o = theoNgay.get(r.ngay) ?? { xong: 0, tong: 0, pcts: [] };
    o.xong += r.canXong; o.tong += r.canTong;
    if (r.pct != null) o.pcts.push(r.pct);
    theoNgay.set(r.ngay, o);
  }
  return [...theoNgay.entries()]
    .map(([ngay, o]) => ({ ngay, canXong: o.xong, canTong: o.tong, pct: o.pcts.length ? Math.round((o.pcts.reduce((a, b) => a + b, 0) / o.pcts.length) * 100) / 100 : null }))
    .sort((a, b) => a.ngay.localeCompare(b.ngay));
}

/** Tốc độ trung bình (căn/ngày) trong N ngày gần nhất — nền cho câu "còn bao lâu thì xong". */
export function tocDoNgay(luyKe: { ngay: string; canXong: number }[], soNgay = 7): number | null {
  if (luyKe.length < 2) return null;
  const cuoi = luyKe[luyKe.length - 1];
  const dau = luyKe[Math.max(0, luyKe.length - 1 - soNgay)];
  const ngayCach = Math.round(
    (Date.parse(cuoi.ngay + "T00:00:00Z") - Date.parse(dau.ngay + "T00:00:00Z")) / 86400000,
  );
  if (ngayCach <= 0) return null;
  return Math.round(((cuoi.canXong - dau.canXong) / ngayCach) * 100) / 100;
}
