/**
 * KHO SỐ LẮP ĐẶT — một dòng cho mỗi NGÀY × DỰ ÁN × KHU.
 *
 * Vì sao có kho: bảng gốc của mỗi dự án một kiểu, và chỉ nói "hôm nay tới đâu". Muốn có dashboard so
 * dự án với dự án, hay vẽ đường tiến độ theo thời gian, thì phải RÚT số ra một chỗ có cùng một hình
 * dạng, rồi cộng dồn theo ngày. Dashboard đọc kho — KHÔNG mở lại file gốc mỗi lần vẽ.
 *
 * HÌNH DẠNG CSV = HÌNH DẠNG BẢNG SQL, cùng thứ tự cột. Nhờ vậy:
 *   · xuất ra CSV là mở được bằng Excel, không khoá dữ liệu trong app;
 *   · nạp thêm dữ liệu bằng CSV hay bằng SQL đều cùng một bộ cột, không phải nhớ hai thứ.
 *
 * PHẦN TRĂM Ở ĐÂY LÀ THANG 0..100 (file gốc ghi 0..1) — kho là chỗ để người đọc, số 87,5 dễ hiểu
 * hơn 0.875, và SQL viết `WHERE pctThuc < 80` cũng thuận.
 *
 * Module THUẦN: không import gì của server, để client, server và test dùng chung một cách tính.
 */

export type MocKho = {
  ngay: string;                 // "YYYY-MM-DD" — ngày chốt số
  maCT: string;
  duAn: string;
  khu: string;
  scope: string;                // public | rooms
  pctThuc: number | null;       // 0..100
  pctDuKien: number | null;     // 0..100 — kế hoạch; bảng ma trận không có thì để trống
  pctHomTruoc: number | null;
  chenhLech: number | null;     // thực − kế hoạch, âm = trễ
  tangNgay: number | null;      // nhích thêm trong ngày
  canhBao: string;              // nhãn trong file: ĐẠT / CHẬM NHẸ / CHẬM - BÁO ĐỘNG…
  ngayBanGiao: string;
  soNgayConLai: number | null;
  nguon: string;                // bang | matran | csv — rút từ đâu ra, để còn truy ngược
};

export const COT_KHO = [
  "ngay", "maCT", "duAn", "khu", "scope",
  "pctThuc", "pctDuKien", "pctHomTruoc", "chenhLech", "tangNgay",
  "canhBao", "ngayBanGiao", "soNgayConLai", "nguon",
] as const;

/** Câu tạo bảng — dùng chung cho D1 lúc chạy và cho lệnh nạp tay bằng wrangler. */
export const SQL_TAO_BANG = `CREATE TABLE IF NOT EXISTS lapdat_moc (
  ngay TEXT NOT NULL,
  maCT TEXT NOT NULL,
  duAn TEXT NOT NULL,
  khu TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'rooms',
  pctThuc REAL, pctDuKien REAL, pctHomTruoc REAL, chenhLech REAL, tangNgay REAL,
  canhBao TEXT NOT NULL DEFAULT '',
  ngayBanGiao TEXT NOT NULL DEFAULT '',
  soNgayConLai INTEGER,
  nguon TEXT NOT NULL DEFAULT 'bang',
  PRIMARY KEY (ngay, maCT, duAn, khu)
)`;

/* ── CSV ────────────────────────────────────────────────────────────────────────────────────── */

const boc = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function sangCsv(rows: MocKho[]): string {
  return [COT_KHO.join(","), ...rows.map((r) => COT_KHO.map((c) => boc(r[c])).join(","))].join("\n") + "\n";
}

/** Tách một dòng CSV có xét dấu ngoặc kép (tên khu hay có dấu phẩy: "Public Toilet 1,3"). */
export function tachDong(d: string): string[] {
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

const soHoacNull = (s: string): number | null => {
  const t = s.trim().replace("%", "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export type KetQuaNap = { rows: MocKho[]; bo: number; loi: string[] };

/**
 * Đọc CSV người dùng dán vào. Cột nhận diện theo TÊN ở dòng đầu, thiếu cột phụ thì để trống —
 * chỉ bốn cột `ngay, maCT, duAn, khu` là bắt buộc, vì đó là khoá của một dòng.
 * Dòng hỏng thì BỎ và kể ra, không ném lỗi: mất một dòng còn hơn hỏng cả lần nạp.
 */
export function docCsv(text: string): KetQuaNap {
  const dong = String(text || "").split(/\r?\n/).filter((d) => d.trim());
  if (dong.length < 2) return { rows: [], bo: 0, loi: ["file không có dòng dữ liệu nào"] };
  const cot = tachDong(dong[0]).map((x) => x.toLowerCase());
  const at = (ten: string) => cot.indexOf(ten.toLowerCase());
  const thieu = (["ngay", "maCT", "duAn", "khu"] as const).filter((c) => at(c) < 0);
  if (thieu.length) return { rows: [], bo: 0, loi: [`thiếu cột bắt buộc: ${thieu.join(", ")}`] };

  const rows: MocKho[] = [];
  const loi: string[] = [];
  let bo = 0;
  for (let i = 1; i < dong.length; i++) {
    const o = tachDong(dong[i]);
    const lay = (ten: string): string => { const j = at(ten); return j >= 0 ? (o[j] ?? "") : ""; };
    const ngay = chuanNgay(lay("ngay"));
    const khu = lay("khu");
    if (!ngay) { bo++; if (loi.length < 5) loi.push(`dòng ${i + 1}: ngày "${lay("ngay")}" không đúng dạng YYYY-MM-DD`); continue; }
    if (!khu) { bo++; if (loi.length < 5) loi.push(`dòng ${i + 1}: thiếu tên khu`); continue; }
    rows.push({
      ngay, maCT: lay("maCT"), duAn: lay("duAn"), khu,
      scope: (lay("scope") || "rooms").toLowerCase() === "public" ? "public" : "rooms",
      pctThuc: soHoacNull(lay("pctThuc")),
      pctDuKien: soHoacNull(lay("pctDuKien")),
      pctHomTruoc: soHoacNull(lay("pctHomTruoc")),
      chenhLech: soHoacNull(lay("chenhLech")),
      tangNgay: soHoacNull(lay("tangNgay")),
      canhBao: lay("canhBao"),
      ngayBanGiao: lay("ngayBanGiao"),
      soNgayConLai: soHoacNull(lay("soNgayConLai")),
      nguon: lay("nguon") || "csv",
    });
  }
  return { rows, bo, loi };
}

/** Nhận cả "2026-09-09" lẫn "09/09/2026" — người ta xuất từ Excel ra hay ra kiểu thứ hai. */
export function chuanNgay(s: string): string {
  const t = (s || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}

/* ── ĐỌC RA ĐỂ VẼ ───────────────────────────────────────────────────────────────────────────── */

const tb = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};

export type DiemNgay = {
  ngay: string; thuc: number | null; keHoach: number | null;
  soDuAn: number; soKhu: number;
  /** Bao nhiêu dự án trong ngày đó CÓ cột kế hoạch — đường kế hoạch chỉ nói cho từng ấy dự án. */
  soCoKeHoach: number;
};

/**
 * ĐƯỜNG THEO NGÀY — nền của biểu đồ S.
 * Trung bình theo DỰ ÁN chứ không theo khu: dự án 40 khu mà đè bẹp dự án 3 khu thì đường vẽ ra là
 * đường của mỗi dự án to nhất, không phải của công ty.
 */
export function duongNgay(rows: MocKho[]): DiemNgay[] {
  const theoNgay = new Map<string, Map<string, MocKho[]>>();
  for (const r of rows) {
    const d = theoNgay.get(r.ngay) ?? new Map<string, MocKho[]>();
    const k = `${r.maCT}|${r.duAn}`;
    d.set(k, [...(d.get(k) ?? []), r]);
    theoNgay.set(r.ngay, d);
  }
  return [...theoNgay.entries()]
    .map(([ngay, duAn]) => {
      const thucDA = [...duAn.values()].map((ks) => tb(ks.map((k) => k.pctThuc)));
      const khDA = [...duAn.values()].map((ks) => tb(ks.map((k) => k.pctDuKien)));
      return {
        ngay,
        thuc: tb(thucDA),
        keHoach: tb(khDA),
        soDuAn: duAn.size,
        soCoKeHoach: khDA.filter((v) => v != null).length,
        soKhu: [...duAn.values()].reduce((n, ks) => n + ks.length, 0),
      };
    })
    .sort((a, b) => a.ngay.localeCompare(b.ngay));
}

export type DongDuAn = {
  maCT: string; duAn: string; scope: string; ngay: string;
  thuc: number | null; keHoach: number | null; chenh: number | null;
  soKhu: number; dat: number; chamNhe: number; baoDong: number;
  soNgayConLai: number | null;
};

/** Ảnh chụp MỚI NHẤT của từng dự án: lấy ngày cuối cùng mà dự án đó có số. */
export function moiNhatTheoDuAn(rows: MocKho[]): DongDuAn[] {
  const theoDA = new Map<string, MocKho[]>();
  for (const r of rows) {
    const k = `${r.maCT}|${r.duAn}`;
    theoDA.set(k, [...(theoDA.get(k) ?? []), r]);
  }
  const ra: DongDuAn[] = [];
  for (const [, rs] of theoDA) {
    const ngay = rs.map((r) => r.ngay).sort().at(-1)!;
    const ks = rs.filter((r) => r.ngay === ngay);
    const nhan = (k: MocKho) => (k.canhBao || "").toLowerCase();
    const thuc = tb(ks.map((k) => k.pctThuc));
    const keHoach = tb(ks.map((k) => k.pctDuKien));
    ra.push({
      maCT: ks[0].maCT, duAn: ks[0].duAn, scope: ks[0].scope, ngay,
      thuc, keHoach,
      chenh: thuc != null && keHoach != null ? Math.round((thuc - keHoach) * 10) / 10 : tb(ks.map((k) => k.chenhLech)),
      soKhu: ks.length,
      dat: ks.filter((k) => /đạt|xong|hoàn thành/.test(nhan(k))).length,
      baoDong: ks.filter((k) => /báo động|nghiêm|đỏ/.test(nhan(k))).length,
      chamNhe: ks.filter((k) => /chậm/.test(nhan(k)) && !/báo động/.test(nhan(k))).length,
      soNgayConLai: ks.map((k) => k.soNgayConLai).filter((v): v is number => v != null).sort((a, b) => a - b)[0] ?? null,
    });
  }
  return ra.sort((a, b) => (a.chenh ?? 999) - (b.chenh ?? 999) || a.duAn.localeCompare(b.duAn, "vi"));
}

export type TongQuan = {
  soDuAn: number; soKhu: number; ngayMoiNhat: string;
  thuc: number | null;
  /** Kế hoạch và chênh lệch CHỈ tính trên dự án có cột kế hoạch — xem soCoKeHoach. */
  keHoach: number | null; chenh: number | null; soCoKeHoach: number;
  soTre: number; soBaoDong: number; soQuaHan: number;
};

/**
 * Mấy con số đặt lên đầu dashboard, tính từ ảnh chụp mới nhất của từng dự án.
 *
 * CHÊNH LỆCH chỉ tính trên những dự án CÓ cột kế hoạch. Trộn cả dự án không có kế hoạch vào rồi
 * đem trừ là ra con số vô nghĩa: % thực tế thì gồm mọi dự án, còn % kế hoạch chỉ có ở vài dự án.
 */
export function tongQuan(ds: DongDuAn[]): TongQuan {
  const coKH = ds.filter((d) => d.keHoach != null && d.thuc != null);
  const thucKH = tb(coKH.map((d) => d.thuc));
  const keHoach = tb(coKH.map((d) => d.keHoach));
  return {
    soDuAn: ds.length,
    soKhu: ds.reduce((n, d) => n + d.soKhu, 0),
    ngayMoiNhat: ds.map((d) => d.ngay).sort().at(-1) ?? "",
    thuc: tb(ds.map((d) => d.thuc)),
    keHoach,
    chenh: thucKH != null && keHoach != null ? Math.round((thucKH - keHoach) * 10) / 10 : null,
    soCoKeHoach: coKH.length,
    soTre: ds.filter((d) => (d.chenh ?? 0) < -1).length,
    soBaoDong: ds.reduce((n, d) => n + d.baoDong, 0),
    soQuaHan: ds.filter((d) => d.soNgayConLai != null && d.soNgayConLai < 0).length,
  };
}
