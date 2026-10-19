/**
 * BẢNG ĐIỂM TUÂN THỦ TỔNG HỢP — LÕI (thuần, không gọi mạng, có test).
 *
 * Anh Tiến 19/10/2026: gộp điểm báo cáo NGÀY (cột AS của BCN_BangCham) + báo cáo TUẦN (cột J của
 * "Báo cáo tuân thủ PMP") + báo cáo THÁNG (nhập tay) thành một bảng, chọn tháng để xem, giữ lịch sử.
 *
 * MỖI DÒNG = 1 DỰ ÁN trong danh sách "Báo cáo tuân thủ cập nhật PMP" (chốt 19/10: không gộp theo
 * nhóm dự án BCN). Báo cáo ngày chỉ có theo NHÓM BCN, nên dự án nhận điểm ngày của nhóm nó được gán.
 *
 * AI TÍNH: Apps Script `BangDiemTongHop.gs` dán trong file BCN (1NLUB…) là trạm tính — đọc hai file
 * nguồn mỗi giờ rồi ghi 4 tab: AutoData_BCN · AutoData_PMP · MAP_PMP_BCN · Nhập báo cáo tháng. App
 * CHỈ đọc 4 tab đó và dựng bảng bằng ĐÚNG phép của script (`bdth_dungBang_`), nên số trên app trùng
 * số trên sheet — sửa phép ở đây thì phải sửa cả bên script, và ngược lại.
 */

export type DiemO = number | "n/a" | "";

export type DongBcn = { thang: string; key: string; stt: unknown; vung: string; maCT: string; duAn: string; pm: string; qs: DiemO; tc: DiemO; sl: DiemO };
export type DongPmp = { thang: string; ten: string; loc: string; pm: string; diem: unknown };
export type DongGan = { ten: string; key: string; maCT: string; vungTay: string };
export type DongThang = { thang: string; ten: string; diem: unknown };

export type DuAnTongHop = {
  /** tên PMP đã chuẩn hoá — khoá dòng */
  key: string;
  ten: string;
  /** nhóm BCN đã gán (nguồn điểm báo cáo ngày); "" = chưa gán */
  bcnKey: string; bcnTen: string;
  vung: string; pm: string; maCT: string;
  qs: DiemO; sl: DiemO; tc: DiemO;
  /** điểm cột J của chính dự án */
  tuan: number | "";
  thangBC: number | "";
  /** ĐIỂM TRUNG BÌNH = tổng các ô điểm có số ÷ số ô có số (Quân số, Sản lượng, TCLĐ, Master Plan, Điểm tháng). */
  tong: number | "";
};
export type PmTongHop = { pm: string; soDuAn: number; qs: number | ""; sl: number | ""; tc: number | ""; tuan: number | ""; thangBC: number | ""; tong: number | "" };

/** Chuẩn hoá tên để so khớp — y hệt `bdth_norm_` của script. */
export function chuanTen(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const so = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Trung bình các ô là số, làm tròn 1 chữ số lẻ; không có số nào → "". Y hệt `bdth_mean_`. */
export function trungBinh(arr: readonly unknown[]): number | "" {
  const n = arr.filter(so);
  if (!n.length) return "";
  return Math.round((n.reduce((a, b) => a + b, 0) / n.length) * 10) / 10;
}

/** "10/2026" | "2026-10" | Date → "2026-10"; khác → "". */
export function thangCua(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}`;
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{1,2})\s*\/\s*(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{1,2})$/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}` : "";
}
export const nhanThang = (t: string): string => `${t.slice(5, 7)}/${t.slice(0, 4)}`;

const diemO = (v: unknown): DiemO => (so(v) ? v : chuanTen(v) === "n a" ? "n/a" : "");

/** Màu điểm PM — đúng bộ của báo cáo tuân thủ Master Plan: <50 đỏ · <70 vàng · còn lại xanh. */
export const mauDiemPm = (v: unknown): string => (!so(v) ? "#94a3b8" : v < 50 ? "#dc2626" : v < 70 ? "#ca8a04" : "#16a34a");

/** PM xếp A→Z theo TÊN GỌI (chữ cuối), như khung Điểm PM của báo cáo tuân thủ Master Plan. */
export function xepTheoTenGoi(a: string, b: string): number {
  const g = (s: string) => { const p = s.trim().split(/\s+/); return p[p.length - 1] ?? ""; };
  return g(a).localeCompare(g(b), "vi") || a.localeCompare(b, "vi");
}

/** Vùng theo thứ tự form báo cáo tuân thủ Master Plan. */
export const THU_TU_VUNG = ["Phú Quốc", "Bắc", "Trung", "Nam", "Nước Ngoài"] as const;
const hangVung = (v: string): number => { const i = THU_TU_VUNG.map(chuanTen).indexOf(chuanTen(v)); return i < 0 ? 99 : i; };

/** Cột Location của file PMP → Vùng (chỉ dùng khi chưa gán tay và chưa gán nhóm BCN). Y hệt `bdth_vungTuLoc_`. */
export function vungTuLocation(loc: unknown): string {
  const t = chuanTen(loc);
  if (t === "pq" || t.includes("phu quoc")) return "Phú Quốc";
  if (t === "north" || t === "bac" || t === "mien bac") return "Bắc";
  if (t === "middle" || t === "trung" || t === "mien trung") return "Trung";
  if (t === "south" || t === "hcm" || t === "nam" || t === "mien nam") return "Nam";
  if (t === "oversea" || t === "overseas" || t.includes("nuoc ngoai")) return "Nước Ngoài";
  return "";
}
/** "Nguyễn Văn Cừ/ Thành Tâm" → "Nguyễn Văn Cừ" (form chỉ ghi PM chính). */
export const pmChinh = (s: unknown): string => String(s ?? "").split("/")[0].trim();

/** Lưới ô của 4 tab (mảng 2 chiều, dòng 1 là tiêu đề) — dạng `sheet_to_json({ header: 1 })`. */
export type LuoiTongHop = { bcn: unknown[][]; pmp: unknown[][]; map: unknown[][]; nhap: unknown[][] };

export type DuLieuTongHop = {
  bcn: DongBcn[]; pmp: DongPmp[]; gan: DongGan[]; thang: DongThang[];
  /** Dòng BCN mới nhất của từng khoá nhóm — để lấy vùng/tên nhóm khi tháng đang xem chưa có báo cáo ngày. */
  moiNhat: Record<string, DongBcn>;
  cacThang: string[];
  /** "Cập nhật lúc" của lần script chạy gần nhất (ô L2 AutoData_BCN). */
  capNhatLuc: string;
};

const fmtLuc = (v: unknown): string => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = (x: number) => String(x).padStart(2, "0");
    return `${p(v.getDate())}/${p(v.getMonth() + 1)}/${v.getFullYear()} ${p(v.getHours())}:${p(v.getMinutes())}`;
  }
  return String(v ?? "").trim();
};

/** Đọc 4 tab → dữ liệu đã chuẩn hoá. Phép gán khoá nhóm BCN cho dự án PMP chép từ `veBangDiemTongHop`. */
export function docTongHop(L: LuoiTongHop): DuLieuTongHop {
  const than = (g: unknown[][]) => g.slice(1).filter((r) => r && r.some((v) => v !== null && v !== undefined && v !== ""));
  const bcn: DongBcn[] = than(L.bcn).map((r) => ({
    thang: thangCua(r[0]), key: String(r[1] ?? ""), stt: r[2], vung: String(r[3] ?? "").trim(), maCT: String(r[4] ?? "").trim(),
    duAn: String(r[5] ?? "").trim(), pm: String(r[6] ?? "").trim(), qs: diemO(r[7]), tc: diemO(r[8]), sl: diemO(r[9]),
  })).filter((r) => r.thang && r.key);
  const capNhatLuc = fmtLuc(than(L.bcn)[0]?.[11]);
  const pmp: DongPmp[] = than(L.pmp).map((r) => ({ thang: thangCua(r[0]), ten: String(r[1] ?? ""), loc: String(r[2] ?? ""), pm: String(r[3] ?? ""), diem: r[4] }))
    .filter((r) => r.thang && r.ten);

  const moiNhat: Record<string, DongBcn> = {};
  [...bcn].sort((a, b) => (a.thang < b.thang ? 1 : a.thang > b.thang ? -1 : 0)).forEach((r) => { if (!moiNhat[r.key]) moiNhat[r.key] = r; });
  const theoTen: Record<string, string> = {};
  Object.values(moiNhat).forEach((r) => { theoTen[chuanTen(r.duAn)] = r.key; });

  // MAP: A tên PMP · B mã CT · C máy gán · D gán tay · F vùng gán tay. Gán tay thắng; "(Bỏ qua)" = không gán;
  // gán tay sai tên → lùi về máy gán.
  const gan: DongGan[] = than(L.map).map((r) => {
    const tu = String(r[2] ?? ""), tay = String(r[3] ?? "");
    const t = tay || tu;
    const key = chuanTen(t) === "bo qua" ? "" : (theoTen[chuanTen(t)] || (tay ? theoTen[chuanTen(tu)] || "" : ""));
    return { ten: String(r[0] ?? ""), key, maCT: String(r[1] ?? ""), vungTay: String(r[5] ?? "").trim() };
  });

  const thang: DongThang[] = than(L.nhap).map((r) => ({ thang: thangCua(r[0]), ten: String(r[1] ?? ""), diem: r[2] }))
    .filter((t) => t.thang && t.ten && so(t.diem));

  const cacThang = [...new Set([...bcn.map((r) => r.thang), ...pmp.map((r) => r.thang), ...thang.map((r) => r.thang)])]
    .filter((t) => /^\d{4}-\d{2}$/.test(t)).sort().reverse();
  return { bcn, pmp, gan, thang, moiNhat, cacThang, capNhatLuc };
}

/** Dựng bảng cho 1 tháng — y hệt `bdth_dungBang_` của script. */
export function dungBangTongHop(thang: string, d: DuLieuTongHop): { duAn: DuAnTongHop[]; pm: PmTongHop[] } {
  const ganCua: Record<string, DongGan> = {};
  d.gan.forEach((g) => { ganCua[chuanTen(g.ten)] = g; });
  const bcnThang: Record<string, DongBcn> = {};
  d.bcn.forEach((r) => { if (r.thang === thang) bcnThang[r.key] = r; });
  const keyTheoTenBcn: Record<string, string> = {};
  Object.keys(d.moiNhat).forEach((k) => { keyTheoTenBcn[chuanTen(d.moiNhat[k].duAn)] = k; });

  const daCo = new Set<string>();
  const dong: (Omit<DuAnTongHop, "thangBC" | "tong"> & { thangArr: number[] })[] = [];
  d.pmp.forEach((p) => {
    if (p.thang !== thang) return;
    const n = chuanTen(p.ten);
    if (!n || daCo.has(n)) return;
    daCo.add(n);
    const g = ganCua[n];
    const k = g?.key || "";
    const b = k ? bcnThang[k] : undefined;     // báo cáo ngày của nhóm trong tháng này
    const m = k ? d.moiNhat[k] : undefined;    // nhóm (vùng/tên khi tháng này chưa có báo cáo ngày)
    const vt = g?.vungTay && hangVung(g.vungTay) < 99 ? g.vungTay : "";
    dong.push({
      key: n, ten: p.ten, bcnKey: k, bcnTen: m?.duAn ?? "",
      vung: vt || m?.vung || vungTuLocation(p.loc) || "—",
      pm: pmChinh(p.pm) || m?.pm || "",
      maCT: g?.maCT || m?.maCT || "",
      qs: b ? b.qs : "", sl: b ? b.sl : "", tc: b ? b.tc : "",
      tuan: so(p.diem) ? p.diem : "",
      thangArr: [],
    });
  });
  // Điểm tháng nhập tay: khớp tên dự án PMP trước, không thì tên nhóm BCN (áp cho cả nhóm)
  const theoKey: Record<string, (typeof dong)[number]> = {};
  dong.forEach((x) => { theoKey[x.key] = x; });
  d.thang.forEach((t) => {
    if (t.thang !== thang || !so(t.diem)) return;
    const n = chuanTen(t.ten);
    if (theoKey[n]) { theoKey[n].thangArr.push(t.diem); return; }
    const k = keyTheoTenBcn[n];
    if (k) dong.forEach((x) => { if (x.bcnKey === k) x.thangArr.push(t.diem as number); });
  });
  const duAn: DuAnTongHop[] = dong.map(({ thangArr, ...x }) => {
    const thangBC = thangArr.length ? trungBinh(thangArr) : "";
    return { ...x, thangBC, tong: trungBinh([x.qs, x.sl, x.tc, x.tuan, thangBC]) };
  });
  // Thứ tự như form: Vùng → PM theo tên gọi → dự án A→Z
  duAn.sort((a, b) => hangVung(a.vung) - hangVung(b.vung) || a.vung.localeCompare(b.vung, "vi")
    || xepTheoTenGoi(a.pm || "~", b.pm || "~") || a.ten.localeCompare(b.ten, "vi"));

  const nhom: Record<string, DuAnTongHop[]> = {};
  const thuTuPm: string[] = [];
  duAn.forEach((r) => { const k = r.pm || "(Chưa có PM)"; if (!nhom[k]) { nhom[k] = []; thuTuPm.push(k); } nhom[k].push(r); });
  const pm: PmTongHop[] = thuTuPm.map((k) => {
    const ds = nhom[k];
    const cot = (f: keyof DuAnTongHop) => trungBinh(ds.map((x) => x[f]));
    return { pm: k, soDuAn: ds.length, qs: cot("qs"), sl: cot("sl"), tc: cot("tc"), tuan: cot("tuan"), thangBC: cot("thangBC"), tong: cot("tong") };
  });
  return { duAn, pm };
}

/** Gom dòng (đã xếp) theo Vùng → PM — để gộp ô Vùng / Người phụ trách như form. */
export function gomVungPm(duAn: readonly DuAnTongHop[]): { vung: string; soDong: number; pms: { pm: string; dong: DuAnTongHop[] }[] }[] {
  const vungs: { vung: string; soDong: number; pms: { pm: string; dong: DuAnTongHop[] }[] }[] = [];
  const theoVung: Record<string, DuAnTongHop[]> = {};
  const thuTu: string[] = [];
  duAn.forEach((r) => { const v = r.vung || "—"; if (!theoVung[v]) { theoVung[v] = []; thuTu.push(v); } theoVung[v].push(r); });
  thuTu.forEach((v) => {
    const pms: { pm: string; dong: DuAnTongHop[] }[] = [];
    const idx: Record<string, number> = {};
    theoVung[v].forEach((r) => { const p = r.pm || "—"; if (idx[p] === undefined) { idx[p] = pms.length; pms.push({ pm: p, dong: [] }); } pms[idx[p]].dong.push(r); });
    vungs.push({ vung: v, soDong: theoVung[v].length, pms });
  });
  return vungs;
}
