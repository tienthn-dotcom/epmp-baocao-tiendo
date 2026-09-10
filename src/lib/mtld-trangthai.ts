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
  /** Chặng trung gian: đã RA list defect (vận hành soi ra lỗi) — chưa xoá xong. */
  raDefect: number | null;
  xoaDefect: number | null;
  giaoVanHanh: number | null;
  /** Chặng nào không tìm thấy nhãn trong file — để nói thẳng là "chưa gắn nhãn", không đoán bừa. */
  thieuNhan: string[];
};

export type KetQua = { ok: true; tt: TrangThaiPhong } | { ok: false; loi: string };

/* BỎ DẤU RỒI MỚI KHỚP. Mỗi file gõ một kiểu — "Xoá" với "Xóa", "Bàn giao vận hành" với
   "Bàn giao VH", "defect" với "defects" — viết regex ôm hết dấu thì vừa dài vừa sót.
   Bỏ dấu xong chỉ còn chữ thường ASCII, hết luôn cái bẫy \b không ăn với chữ có dấu. */
function khongDau(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase();
}

const CHANG = [
  { ma: "giaoTho", ten: "giao thô", re: /giao\s*tho/, tru: null },
  { ma: "giaoTinh", ten: "giao tinh", re: /giao\s*tinh/, tru: null },
  /* "Xoá list Defect" xét TRƯỚC "Ra list Defect" — hai nhãn chỉ khác mỗi động từ đầu.
     Nhận cả "đóng defect" (có file ghi vậy), nhưng LOẠI nhãn có "bql": đóng defect với ban quản lý
     là chặng khác với đóng defect vận hành mà PMO đang đếm. */
  { ma: "xoaDefect", ten: "xoá defect", re: /(?:xoa|dong)\s*(?:list\s*)?defects?/, tru: /bql/ },
  { ma: "raDefect", ten: "ra defect", re: /\bra\s*(?:list\s*)?defects?/, tru: null },
  { ma: "giaoVanHanh", ten: "vận hành", re: /(?:ban\s*giao|da\s*giao|giao)\s*(?:van\s*hanh|vh)/, tru: null },
] as const;

/** Chặng khớp với một nhãn (nhãn phải BỎ DẤU trước), hoặc undefined. */
function changCua(nhan: string) {
  return CHANG.find((x) => x.re.test(nhan) && !(x.tru && x.tru.test(nhan)));
}

/** Khuôn mới ghi luôn số vào nhãn: "Đã giao thô: 376". Có số ngay trong nhãn thì lấy số đó. */
function soTrongNhan(t: string): number | null {
  const m = /:\s*(-?[\d.,]+)\s*$/.exec(t);
  return m ? so(m[1]) : null;
}

/**
 * Ô ghi CẶP "đã đạt / tổng" — file thật gặp cả "160 / 431" lẫn "84 ― 86" (gạch ngang dài).
 *
 * CHỈ nhận dạng CẶP, không nhận số trần: ô nằm dưới nhãn có thể là số của dòng khác hẳn
 * (vd dòng "Tăng hôm trước"), nhận số trần là lấy nhầm ngay.
 */
function soTrenTong(v: OTrangThai): { dat: number; tong: number | null } | null {
  const t = chu(v);
  if (!t) return null;
  const m = /^(-?[\d.,]+)\s*(?:[/\u2015\u2013\u2014]|\s-\s)\s*([\d.,]+)$/.exec(t);
  if (!m) return null;
  const a = so(m[1]), b = so(m[2]);
  return a == null ? null : { dat: a, tong: b };
}

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
function timDong(rows: OTrangThai[][], re: RegExp, toiDa = 40, coToiDa = 10): number {
  for (let r = 0; r < Math.min(toiDa, rows.length); r++) {
    const row = rows[r] || [];
    for (let c = 0; c < Math.min(coToiDa, row.length); c++) {
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
  /* Dòng "Lũy kế" là nơi lấy số khi nhãn KHÔNG kèm số. Khuôn mới ghi số thẳng vào nhãn
     ("Đã giao thô: 376") nên file không có dòng này vẫn đọc được — đừng đòi nó nữa. */
  const dongLuyKe = timDong(rows, /^l[ũu]y\s*k[êế]$/i);
  const luyKe = dongLuyKe >= 0 ? (rows[dongLuyKe] || []) : [];
  const tranNhan = dongLuyKe >= 0 ? dongLuyKe : Math.min(14, rows.length);

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
  const dongSo: number[] = dongLuyKe >= 0 ? [dongLuyKe] : [];
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
  /* Nhãn được điền bằng cách nào — quyết định có được CỘNG THÊM nữa hay không:
       "chot" = số đọc thẳng (trong nhãn, hoặc cộng theo dòng Lũy kế) → đã là số cuối, chốt luôn;
       "khoi" = số của MỘT KHỐI (B1, B2…) → nhãn lặp lại ở khối sau thì phải cộng dồn. */
  const nguon: Record<string, "chot" | "khoi"> = {};
  let tongKhoi = 0;

  /* Quét cả bảng chứ không chỉ phần đầu: có file (Mini Hotel) để nhãn trong TỪNG KHỐI B1…B5 nằm
     rải phía dưới, mỗi khối một cụm "Đã giao thô | Đã giao tinh | …" với số kiểu "84 ― 86". */
  for (let r = Math.min(rows.length, 200) - 1; r >= 0; r--) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const t = chu(row[c]);
      if (!t) continue;
      const chang = changCua(khongDau(t));
      if (!chang || nguon[chang.ma] === "chot") continue;
      // Số ghi thẳng trong nhãn là số CHỐT của nhóm — tin nó, khỏi cộng lại gì nữa.
      const trongNhan = soTrongNhan(t);
      if (trongNhan != null) { dem[chang.ma] = trongNhan; nguon[chang.ma] = "chot"; continue; }
      /* Số nằm DƯỚI nhãn, dạng cặp "160 / 431" hay "84 ― 86". Có file để cách nhãn một dòng
         (dòng giữa là chữ), nên dò tới ba dòng. Ô chú thích màu không dính vào đây vì dưới nó
         lại là chữ, không phải cặp số. */
      let duoi: { dat: number; tong: number | null } | null = null;
      for (let k = 1; k <= 3 && !duoi; k++) duoi = soTrenTong((rows[r + k] ?? [])[c]);
      if (duoi) {
        dem[chang.ma] = (dem[chang.ma] ?? 0) + duoi.dat;   // nhãn lặp theo khối → cộng dồn
        nguon[chang.ma] = "khoi";
        if (duoi.tong != null && chang.ma === "giaoTho") tongKhoi += duoi.tong;
        continue;
      }
      if (nguon[chang.ma] === "khoi") continue;   // đã đếm theo khối thì đừng trộn thêm cách khác
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
      nguon[chang.ma] = "chot";
    }
  }
  // Không có dòng "Tổng" thì lấy tổng cộng từ mẫu số của các khối ("… ― 86" mỗi khối một cái).
  if (tongCan == null && tongKhoi > 0) tongCan = tongKhoi;

  const thieuNhan = CHANG.filter((x) => dem[x.ma] == null).map((x) => x.ten);
  if (thieuNhan.length === CHANG.length) {
    return { ok: false, loi: dongLuyKe < 0 ? "không thấy nhãn chặng bàn giao nào" : "không thấy nhãn chặng bàn giao nào (có dòng Lũy kế)" };
  }
  return {
    ok: true,
    tt: {
      tongCan,
      giaoTho: dem.giaoTho ?? null,
      giaoTinh: dem.giaoTinh ?? null,
      raDefect: dem.raDefect ?? null,
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
    raDefect: cong((t) => t.raDefect),
    xoaDefect: cong((t) => t.xoaDefect),
    giaoVanHanh: cong((t) => t.giaoVanHanh),
    thieuNhan: [...new Set(ds.flatMap((t) => t.thieuNhan))],
  };
}
