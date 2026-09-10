/**
 * ĐẾM CĂN THEO TRẠNG THÁI BÀN GIAO — dành cho tab "Summary" của các dự án KHỐI PHÒNG.
 *
 * Tab này không phải bảng phần trăm mà là BẢNG ĐẾM CĂN theo bốn chặng bàn giao nối tiếp nhau:
 *
 *     giao thô  →  giao tinh  →  xoá list Defect  →  bàn giao vận hành
 *
 * Hình dạng thật (đã soi 2 file đang gắn):
 *   · dòng 3: nhãn nhóm, MERGE ngang vài cột — "Đã giao thô" · "Đã giao tinh (Nội bộ)" ·
 *     "Xoá list Defect (PMU)" · "Bàn giao vận hành". Có file để nhãn, có file mới chỉ để con số.
 *   · dòng "Tổng"      : tổng số căn của dự án.
 *   · dòng "Lũy kế"    : số căn đã đạt từng chặng — ĐÂY là số cần lấy.
 *   · dòng "Tăng hôm trước" / "Tăng trong ngày" / "Còn lại cần giao": phụ, chưa dùng.
 *
 * BÁM THEO NHÃN, KHÔNG BÁM VỊ TRÍ: file này nhóm rộng 3 cột, file kia rộng 6 cột, thứ tự cũng khác.
 * Đếm bằng cách CỘNG dòng "Lũy kế" trong đúng khoảng cột mà nhãn trải qua (merge), nên rộng hẹp
 * bao nhiêu cũng đúng.
 *
 * CẨN THẬN VỚI CHÚ THÍCH MÀU: các file có cột chú thích liệt kê y hệt bốn cái tên này. Nhãn chỉ được
 * tính khi khoảng cột của nó CÓ SỐ ở dòng "Lũy kế" — cột chú thích không có số nên tự loại.
 *
 * Module THUẦN để test được.
 */

export type OTrangThai = string | number | boolean | Date | null | undefined;
/** Vùng merge, đúng hình dạng `sheet["!merges"]` của thư viện xlsx. */
export type Merge = { s: { r: number; c: number }; e: { r: number; c: number } };

export type TrangThaiPhong = {
  tongCan: number | null;
  giaoTho: number | null;
  giaoTinh: number | null;
  xoaDefect: number | null;
  giaoVanHanh: number | null;
  /** Chặng nào không tìm thấy nhãn trong file — để nói thẳng là "chưa gắn nhãn", không đoán bừa. */
  thieuNhan: string[];
};

export type KetQua = { ok: true; tt: TrangThaiPhong } | { ok: false; loi: string };

/* KHÔNG dùng \b sau chữ có dấu: \b của JS tính theo bảng chữ ASCII, "ô" không phải ký tự từ
   nên "giao thô" KHÔNG khớp /giao\s*th[ôo]\b/ — đúng cái bẫy đã dính ở chữ "trước". */
const CHANG = [
  { ma: "giaoTho", ten: "giao thô", re: /(?:đã\s*)?giao\s*th[ôo]/i },
  { ma: "giaoTinh", ten: "giao tinh", re: /(?:đã\s*)?giao\s*tinh/i },
  { ma: "xoaDefect", ten: "xoá list Defect", re: /xo[áa]\s*(?:list\s*)?defect/i },
  { ma: "giaoVanHanh", ten: "bàn giao vận hành", re: /(?:b[àa]n\s*giao|đã\s*giao|giao)\s*v[ậa]n\s*h[àa]nh/i },
] as const;

const chu = (v: OTrangThai): string =>
  (v == null ? "" : v instanceof Date ? "" : String(v)).replace(/\s+/g, " ").trim();
const so = (v: OTrangThai): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = chu(v).replace(/[,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Dòng có nhãn ở cột trái khớp `re` — trả chỉ số dòng, -1 nếu không có. */
function timDong(rows: OTrangThai[][], re: RegExp, toiDa = 40): number {
  for (let r = 0; r < Math.min(toiDa, rows.length); r++) {
    const row = rows[r] || [];
    for (let c = 0; c < Math.min(4, row.length); c++) {
      if (re.test(chu(row[c]))) return r;
    }
  }
  return -1;
}

/** Khoảng cột mà một ô trải qua (ô merge). Không merge thì chỉ chính nó. */
function khoangCot(merges: Merge[], r: number, c: number): { c1: number; c2: number } {
  for (const m of merges) {
    if (r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c) return { c1: m.s.c, c2: m.e.c };
  }
  return { c1: c, c2: c };
}

/**
 * Đọc bảng đếm căn theo trạng thái.
 * @param rows   bảng 2 chiều (sheet_to_json header:1)
 * @param merges danh sách vùng merge của sheet
 */
export function docTrangThaiPhong(rows: OTrangThai[][], merges: Merge[] = []): KetQua {
  if (!rows?.length) return { ok: false, loi: "bảng rỗng" };
  const dongLuyKe = timDong(rows, /^l[ũu]y\s*k[êế]$/i);
  if (dongLuyKe < 0) return { ok: false, loi: "không thấy dòng “Lũy kế”" };
  const luyKe = rows[dongLuyKe] || [];

  // Tổng số căn: dòng "Tổng" — lấy con số đầu tiên bên phải nhãn.
  let tongCan: number | null = null;
  const dongTong = timDong(rows, /^t[ổo]ng$/i);
  if (dongTong >= 0) {
    const row = rows[dongTong] || [];
    for (let c = 0; c < row.length; c++) {
      if (/^t[ổo]ng$/i.test(chu(row[c]))) continue;
      const v = so(row[c]);
      if (v != null) { tongCan = v; break; }
    }
  }

  /* Các dòng SỐ của bảng đếm — dùng để biết một nhãn có thật sự đứng trên bảng đếm hay không. */
  const dongSo = [dongLuyKe];
  for (const re of [/^tăng\s*hôm\s*trước$/i, /^tăng\s*trong\s*ngày$/i, /^còn\s*lại/i]) {
    const r = timDong(rows, re);
    if (r >= 0) dongSo.push(r);
  }

  /* Nhãn nhóm nằm ở các dòng TRÊN dòng "Lũy kế". Duyệt từ dưới lên để nhãn gần nhất thắng.
     Nhãn chỉ được nhận khi khoảng cột của nó CÓ SỐ ở một trong các dòng đếm — nhờ vậy cột chú
     thích màu (liệt kê y hệt bốn cái tên này, nhưng không có số bên dưới) tự bị loại.
     Nhãn đứng trên bảng đếm mà dòng "Lũy kế" bỏ trống thì tính 0: chặng đó đang theo dõi, chỉ là
     chưa căn nào tới — khác hẳn với "không có nhãn". */
  const dem: Record<string, number> = {};
  for (let r = dongLuyKe - 1; r >= 0; r--) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const t = chu(row[c]);
      if (!t) continue;
      const chang = CHANG.find((x) => x.re.test(t));
      if (!chang || dem[chang.ma] != null) continue;
      const { c1, c2 } = khoangCot(merges, r, c);
      const tenBangDem = dongSo.some((dr) => {
        const rr = rows[dr] || [];
        for (let k = c1; k <= c2; k++) if (so(rr[k]) != null) return true;
        return false;
      });
      if (!tenBangDem) continue;
      let tong = 0;
      for (let k = c1; k <= c2; k++) {
        const v = so(luyKe[k]);
        if (v != null) tong += v;
      }
      dem[chang.ma] = tong;
    }
  }

  const thieuNhan = CHANG.filter((x) => dem[x.ma] == null).map((x) => x.ten);
  if (thieuNhan.length === CHANG.length) return { ok: false, loi: "không thấy nhãn trạng thái bàn giao nào" };
  return {
    ok: true,
    tt: {
      tongCan,
      giaoTho: dem.giaoTho ?? null,
      giaoTinh: dem.giaoTinh ?? null,
      xoaDefect: dem.xoaDefect ?? null,
      giaoVanHanh: dem.giaoVanHanh ?? null,
      thieuNhan,
    },
  };
}

/** Cộng dồn nhiều dự án lại thành số cho 4 thẻ KPI tổng. */
export function congTrangThai(ds: TrangThaiPhong[]): TrangThaiPhong & { soDuAn: number } {
  const cong = (lay: (t: TrangThaiPhong) => number | null): number | null => {
    const v = ds.map(lay).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) : null;
  };
  return {
    soDuAn: ds.length,
    tongCan: cong((t) => t.tongCan),
    giaoTho: cong((t) => t.giaoTho),
    giaoTinh: cong((t) => t.giaoTinh),
    xoaDefect: cong((t) => t.xoaDefect),
    giaoVanHanh: cong((t) => t.giaoVanHanh),
    thieuNhan: [...new Set(ds.flatMap((t) => t.thieuNhan))],
  };
}
