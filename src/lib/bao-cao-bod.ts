/**
 * BÁO CÁO TCLĐ & TTBG GỬI BOD — PHẦN LUẬT (module thuần).
 *
 * Anh Tiến 13/10/2026 gửi bản "BAO_CAO_TCLD_TTBG_TUAN40_BOD" và nói: *"nếu ta đã có thông tin để
 * quyết định là ma trận có đang chạy hay là không, thì tôi cần 1 nút export hàng loạt PDF, hoặc ra
 * 1 báo cáo kiểu này"*.
 *
 * ── BẢN BOD ĐANG CÓ HÌNH GÌ (đọc 43 trang của bản tuần 40) ──────────────────────────────────
 *   · trang 1: bìa + mục lục (A. Báo cáo tổng thể · I. Tổng quan TCLĐ · II. Tổng quan TTBG);
 *   · 42 trang sau: MỖI TRANG MỘT MA TRẬN, xếp theo cụm — I. Cụm Phú Quốc, II. Cụm Miền Nam,
 *     III. Cụm Miền Trung, IV. Cụm Miền Bắc;
 *   · mỗi trang dán một dải tiêu đề: "<cụm> · <số thứ tự>. <tên dự án>" kèm nhãn
 *     "TCLĐ: ĐÃ VẬN HÀNH" hoặc "TCLĐ: CHƯA VẬN HÀNH";
 *   · ruột trang chính là bản Google xuất của tab ma trận — đúng thứ app vẫn tải và cache sẵn.
 *
 * ── NHÃN VẬN HÀNH KHÔNG CÓ TRONG FILE NGUỒN ─────────────────────────────────────────────────
 * Đã mở 8 file ma trận đầu danh sách ngày 13/10/2026: KHÔNG file nào có chữ "ĐÃ/CHƯA VẬN HÀNH" ở
 * phần đầu bảng. Đó là chữ người làm báo cáo gõ tay lúc ghép trang. Nên app phải tự quyết, và
 * luật là do anh Tiến chốt chứ không phải mình nghĩ ra:
 *
 *     "ĐANG CHẠY = trong 7 ngày gần nhất có người sửa file ma trận."   (chốt 13/10/2026)
 *
 * Luật này đo bằng `modifiedTime` của Drive — thứ không ai gõ tay được. ĐIỂM YẾU PHẢI BIẾT: dự án
 * vẫn thi công nhưng bỏ bê không cập nhật file thì bị dán "CHƯA VẬN HÀNH". Đó là chủ ý: báo cáo
 * này đọc theo file, và file không ai đụng thì chính nó là vấn đề cần lộ ra.
 */

/** Bao nhiêu ngày không ai sửa thì coi là chưa vận hành. Anh Tiến chốt 7 ngày (13/10/2026). */
export const NGUONG_VAN_HANH_NGAY = 7;

const NGAY_MS = 86_400_000;

/** File còn được cập nhật trong `nguong` ngày gần nhất không. Không biết ngày sửa → false. */
export function dangChay(modifiedTime: string | null | undefined, bayGio: number, nguong = NGUONG_VAN_HANH_NGAY): boolean {
  if (!modifiedTime) return false;
  const t = Date.parse(modifiedTime);
  if (!Number.isFinite(t)) return false;
  return bayGio - t <= nguong * NGAY_MS;
}

/** Nhãn dán lên dải tiêu đề, đúng chữ bản BOD đang dùng. */
export const nhanVanHanh = (chay: boolean): string => `TCLĐ: ${chay ? "ĐÃ VẬN HÀNH" : "CHƯA VẬN HÀNH"}`;

/* ── CỤM ─────────────────────────────────────────────────────────────────────
   Thứ tự và tên cụm lấy ĐÚNG bản BOD tuần 40. Cột `region` của danh sách MTLĐ ghi mã vùng
   (PQ · HCM · South · Middle · North · Oversea), gộp lại thành bốn cụm của bản BOD.

   CỤM THỨ NĂM cho hàng nước ngoài: bản BOD tuần 40 không có mục này vì tuần đó không có dự án
   nước ngoài nào được đưa vào. Danh sách MTLĐ thì CÓ (KM New Wing, vùng Oversea). Thà thêm một
   mục ở cuối còn hơn lặng lẽ đánh rơi một dự án khỏi báo cáo gửi BOD. */
export const CUM: readonly { ma: string; ten: string; vung: readonly string[] }[] = [
  { ma: "I", ten: "CỤM PHÚ QUỐC", vung: ["pq"] },
  { ma: "II", ten: "CỤM MIỀN NAM", vung: ["hcm", "south", "nam"] },
  { ma: "III", ten: "CỤM MIỀN TRUNG", vung: ["middle", "trung"] },
  { ma: "IV", ten: "CỤM MIỀN BẮC", vung: ["north", "bac"] },
  { ma: "V", ten: "CỤM NƯỚC NGOÀI", vung: ["oversea", "overseas"] },
];

/** Vùng nào thuộc cụm nào. Vùng lạ → cụm cuối ("khác"), KHÔNG bỏ dự án đi. */
export function cumCuaVung(vung: string | undefined): number {
  const v = (vung ?? "").trim().toLowerCase();
  const i = CUM.findIndex((c) => c.vung.includes(v));
  return i >= 0 ? i : CUM.length - 1;
}

/* ── CHỈ LẤY TAB 1B / 2B / 3B ────────────────────────────────────────────────
   Anh Tiến 13/10/2026: *"chỉ lấy mấy sheet 1B, 2B, 3B thôi"*.

   Đó là bộ tab báo cáo chuẩn của ma trận — 1B/3B là Báo cáo TCLĐ, 2B là Báo cáo TTBG. Các tab
   khác ("Summary", "MT TTBG", "CHATEAU- MA TRAN LAP DAT"…) là bảng làm việc nội bộ, xuất ra vừa
   dài vừa không đúng khuôn bản gửi BOD. Đo danh sách thật 13/10: 41/46 ma trận có tab 1B/2B/3B.

   LẤY DANH SÁCH BỊ BỎ RA CHO NGƯỜI DÙNG THẤY, không lọc im: dự án biến mất khỏi báo cáo gửi BOD
   mà không ai biết là kiểu sai tệ nhất ở đây. */
export const RE_TAB_BOD = /^\s*[123]\s*B\b/i;

export const laTabBod = (sheet: string | undefined): boolean => RE_TAB_BOD.test(sheet ?? "");

/** Tách danh sách thành phần ĐƯA VÀO báo cáo và phần bị bỏ (kèm lý do để nói ra). */
export function locTabBod<T extends { sheet?: string }>(ds: readonly T[]): { lay: T[]; bo: T[] } {
  const lay: T[] = [], bo: T[] = [];
  for (const m of ds) (laTabBod(m.sheet) ? lay : bo).push(m);
  return { lay, bo };
}

/* ── MỘT TRANG CỦA BÁO CÁO ───────────────────────────────────────────────── */

export type MucMaTran = {
  fileId: string;
  gid?: string;
  sheet?: string;
  range?: string;
  name: string;
  maCT: string;
  region?: string;
  groupDA?: string;
};

export type TrangBod = {
  /** "I. CỤM PHÚ QUỐC" */
  cum: string;
  /** Số thứ tự TRONG CẢ BÁO CÁO, đúng kiểu bản BOD ("3. APEC S4 - KHU PHÒNG"). */
  stt: number;
  ten: string;
  maCT: string;
  nhan: string;
  chay: boolean;
  muc: MucMaTran;
};

/**
 * Xếp danh sách ma trận thành các trang báo cáo: gom theo cụm, giữ nguyên thứ tự trong từng cụm.
 *
 * GIỮ NGUYÊN THỨ TỰ GỐC trong mỗi cụm — danh sách MTLĐ do PMO tự sắp, sắp lại theo bảng chữ cái là
 * phá mất ý của người sắp (y như bài học bên perf-chart: "cái nào tôi không yêu cầu đổi thì bê
 * nguyên lên").
 *
 * @param ngaySua  fileId → ngày sửa cuối (ISO). Thiếu một file thì file đó thành "chưa vận hành".
 */
export function xepTrangBod(
  ds: readonly MucMaTran[],
  ngaySua: ReadonlyMap<string, string | null>,
  bayGio: number,
  nguong = NGUONG_VAN_HANH_NGAY,
): TrangBod[] {
  const theoCum: MucMaTran[][] = CUM.map(() => []);
  for (const m of ds) theoCum[cumCuaVung(m.region)].push(m);

  const ra: TrangBod[] = [];
  let stt = 0;
  CUM.forEach((c, i) => {
    for (const m of theoCum[i]) {
      const chay = dangChay(ngaySua.get(m.fileId) ?? null, bayGio, nguong);
      ra.push({
        cum: `${c.ma}. ${c.ten}`,
        stt: ++stt,
        ten: m.name,
        maCT: m.maCT,
        nhan: nhanVanHanh(chay),
        chay,
        muc: m,
      });
    }
  });
  return ra;
}

/** Tên tệp tải về: "BAO_CAO_TCLD_TTBG_13-10-2026.pdf". */
export function tenTep(bayGio: number): string {
  const d = new Date(bayGio + 7 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `BAO_CAO_TCLD_TTBG_${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}.pdf`;
}

/** Dòng tổng ở bìa: "46 ma trận · 31 đang vận hành · 15 chưa". */
export function dongTong(trang: readonly TrangBod[]): string {
  const chay = trang.filter((t) => t.chay).length;
  return `${trang.length} ma trận · ${chay} đã vận hành · ${trang.length - chay} chưa vận hành`;
}
