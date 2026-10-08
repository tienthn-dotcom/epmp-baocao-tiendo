/**
 * CHẤM TUÂN THỦ BÁO CÁO HẰNG NGÀY — Quân số · Thi công lắp đặt · Sản lượng
 * ========================================================================
 *
 * Mở rộng bộ chấm tuân thủ đang có. Bản cũ chấm việc cập nhật Master Plan theo TUẦN; bộ này chấm ba
 * báo cáo phải nộp MỖI NGÀY LÀM VIỆC. Dùng lại nguyên kiểu dấu `Mark` của lib/compliance.ts nên bảng
 * hiển thị, cách tính điểm và cách gộp điểm dự án không phải thiết kế lại.
 *
 *     ✓  (P)  nộp trong hạn          trừ 0
 *     O  (o)  nộp trong cửa sổ trễ   trừ 2
 *     X  (x)  quá cửa sổ, hoặc không nộp   trừ 5
 *     —  null ngày không chấm (cuối tuần, lễ, dự án chưa chạy / đã xong)
 *
 * MỘT NGÀY CHỈ MANG MỘT DẤU cho mỗi hạng mục. Nộp nhiều lần trong ngày thì tính LẦN SỚM NHẤT — người
 * đã nộp đúng hạn rồi sửa lại lúc muộn không vì thế mà thành trễ.
 *
 * NỘP BÙ HÔM SAU VẪN LÀ X. Số liệu đã không phục vụ được việc điều hành của ngày đó nữa, nên không có
 * cửa nào để gỡ. (Khung chấm điểm PMO, mục 2.3.)
 *
 * PHẠM VI BẢN NÀY — PMO chốt 16/09/2026:
 *   · Chỉ chấm ĐÚNG GIỜ. KHÔNG tính trừ chất lượng nội dung, KHÔNG có điều khoản leo thang.
 *     Hai thứ đó nằm trong khung giấy nhưng chưa đưa vào máy, để bản đầu chạy cho gọn và dễ đối chiếu.
 *   · Thứ 7, Chủ nhật không chấm. Ngày lễ do người dùng nạp vào, xem `NgayNghi`.
 */

import type { Mark } from "@/lib/compliance";

/* ── BA HẠNG MỤC ────────────────────────────────────────────────────────────────────────────────
 *
 * Giờ hạn và cửa sổ trễ do PMO chốt 16/09/2026. Cả ba cùng cửa sổ 120 phút.
 *
 * MUỐN ĐỔI GIỜ: sửa đúng bảng này, không phải sửa chỗ nào khác. */
export type MaHangMuc = "QS" | "TC" | "SL";

export type HangMuc = {
  ma: MaHangMuc;
  ten: string;
  /** Tên ngắn cho đầu dòng trong bảng (cột hẹp). */
  tenNgan: string;
  /** Giờ hạn, tính theo phút kể từ 00:00 giờ VN. */
  han: number;
  /** Hết cửa sổ trễ, cũng tính bằng phút kể từ 00:00. Quá mốc này là X. */
  hetTre: number;
};

const gio = (h: number, p = 0) => h * 60 + p;

export const HANG_MUC: readonly HangMuc[] = [
  { ma: "QS", ten: "Báo cáo quân số", tenNgan: "Quân số", han: gio(9), hetTre: gio(11) },
  /* TCLĐ = "Thi công lắp đặt" — MỘT THỨ, anh Tiến chốt 08/10/2026 ("cái TCLĐ với Thi công lắp đặt
     là 1, chốt theo đó nhé, gộp đi").
     ĐỔI 17:30/19:30 → 18:00/20:00. Số cũ là PMO chốt 16/09, nhưng ĐẦU FILE NGUỒN ghi "Thi công lắp
     đặt 18:00" và anh Tiến nhắn lại đúng 18:00 / 20:00. Hai nguồn mới khớp nhau nên lấy theo đó. */
  { ma: "TC", ten: "Báo cáo thi công lắp đặt", tenNgan: "TC lắp đặt", han: gio(18), hetTre: gio(20) },
  { ma: "SL", ten: "Báo cáo sản lượng", tenNgan: "Sản lượng", han: gio(18), hetTre: gio(20) },
];

export function hangMucTheoMa(ma: string): HangMuc | undefined {
  return HANG_MUC.find((h) => h.ma === ma);
}

/** Giờ hạn dạng người đọc: "09:00", "17:30". */
export function gioHan(h: HangMuc): string {
  return `${String(Math.floor(h.han / 60)).padStart(2, "0")}:${String(h.han % 60).padStart(2, "0")}`;
}
export function gioHetTre(h: HangMuc): string {
  return `${String(Math.floor(h.hetTre / 60)).padStart(2, "0")}:${String(h.hetTre % 60).padStart(2, "0")}`;
}

/* ── ĐIỂM TRỪ ───────────────────────────────────────────────────────────────────────────────────
 * Thang 100, trừ dần, kẹp ở 0. Một tháng khoảng 22 ngày công nên mỗi ngày đáng khoảng 4 điểm; mức
 * trừ đặt THẤP HƠN giá trị một ngày để vài lần sơ suất không đánh sập cả tháng, nhưng bỏ báo cáo
 * kéo dài thì điểm vẫn sụp thật. */
export const TRU = { tre: 2, khong: 5 } as const;

/* ── NGÀY CÓ PHẢI CHẤM KHÔNG ────────────────────────────────────────────────────────────────── */

/** Ngày nghỉ không chấm — tập các ngày ISO "YYYY-MM-DD" (lễ theo lịch công ty). */
export type NgayNghi = ReadonlySet<string>;

/** Thứ trong tuần của một ngày ISO, theo lịch dương: 0 = Chủ nhật … 6 = Thứ 7. */
function thu(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** Ngày làm việc = thứ 2 tới thứ 6 và không nằm trong danh sách nghỉ lễ. */
export function laNgayCham(iso: string, nghi?: NgayNghi): boolean {
  const t = thu(iso);
  if (t === 0 || t === 6) return false;
  return !nghi?.has(iso);
}

/** Các ngày PHẢI báo cáo của một tháng "YYYY-MM", theo thứ tự tăng dần. */
export function ngayChamCuaThang(thangKey: string, nghi?: NgayNghi): string[] {
  const nam = +thangKey.slice(0, 4), thg = +thangKey.slice(5, 7);
  const cuoi = new Date(Date.UTC(nam, thg, 0)).getUTCDate();
  const ra: string[] = [];
  for (let d = 1; d <= cuoi; d++) {
    const iso = `${thangKey}-${String(d).padStart(2, "0")}`;
    if (laNgayCham(iso, nghi)) ra.push(iso);
  }
  return ra;
}

/* ── CHẤM MỘT Ô ─────────────────────────────────────────────────────────────────────────────── */

/** Một lần nộp đọc được từ Google Form. `luc` là dấu thời gian ISO có giờ (giờ VN). */
export type LanNop = { ngay: string; ma: MaHangMuc; luc: string };

/** Phút trong ngày của một dấu thời gian ISO. Trả null nếu không đọc được. */
function phutTrongNgay(luc: string): number | null {
  const m = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/.exec(luc);
  if (!m) return null;
  const h = +m[1], p = +m[2];
  if (h > 23 || p > 59) return null;
  return h * 60 + p;
}

/** Ngày (phần "YYYY-MM-DD") của một dấu thời gian. */
export function ngayCua(luc: string): string {
  return luc.slice(0, 10);
}

/**
 * Dấu của MỘT hạng mục trong MỘT ngày.
 *
 * @param iso     ngày đang chấm
 * @param hm      hạng mục (mang theo giờ hạn)
 * @param lucNop  các dấu thời gian đã nộp CHO ĐÚNG NGÀY ĐÓ, đúng hạng mục đó. Rỗng = chưa nộp.
 * @param homNay  ngày hôm nay, để KHÔNG chấm ngày chưa tới.
 * @param nghi    danh sách ngày nghỉ.
 *
 * Trả null khi ngày đó không chấm (cuối tuần, lễ, hoặc còn ở tương lai).
 */
export function chamNgay(
  iso: string,
  hm: HangMuc,
  lucNop: readonly string[],
  homNay: string,
  nghi?: NgayNghi,
): Mark {
  if (!laNgayCham(iso, nghi)) return null;
  // Ngày mai chưa tới hạn thì chưa có gì để chấm. Ngày HÔM NAY cũng vậy nếu chưa qua cửa sổ trễ:
  // chấm sớm là bắt lỗi người còn đang trong giờ được phép nộp.
  if (iso > homNay) return null;

  // Chỉ nhận lần nộp ĐÚNG NGÀY. Nộp bù hôm sau nằm ở ngày khác nên không lọt vào đây, và ngày này
  // vẫn là X — đúng luật "nộp bù vẫn tính không báo cáo".
  const phut = lucNop
    .filter((l) => ngayCua(l) === iso)
    .map(phutTrongNgay)
    .filter((p): p is number => p != null);

  if (!phut.length) {
    // Chưa thấy nộp. Nếu là HÔM NAY và cửa sổ trễ chưa đóng thì chưa kết luận được.
    if (iso === homNay) return null;
    return "x";
  }

  // NỘP NHIỀU LẦN thì tính lần SỚM NHẤT: đã nộp đúng hạn rồi quay lại sửa không vì thế thành trễ.
  const som = Math.min(...phut);
  if (som <= hm.han) return "P";
  if (som <= hm.hetTre) return "o";
  return "x";
}

/* ── ĐIỂM ───────────────────────────────────────────────────────────────────────────────────── */

/** Điểm một hạng mục trong kỳ = 100 − 2×(số O) − 5×(số X), kẹp 0..100.
 *  Chỉ tính các ngày ĐÃ chấm; chưa có ngày nào chấm được thì trả null ("chưa đủ dữ liệu"),
 *  KHÔNG trả 100 — chưa có dữ liệu mà cho điểm tuyệt đối là báo cáo sai sự thật. */
export function diemHangMuc(marks: readonly Mark[]): number | null {
  const cham = marks.filter((m): m is "P" | "o" | "x" => m === "P" || m === "o" || m === "x");
  if (!cham.length) return null;
  const o = cham.filter((m) => m === "o").length;
  const x = cham.filter((m) => m === "x").length;
  return Math.max(0, Math.min(100, 100 - TRU.tre * o - TRU.khong * x));
}

export type XepLoai = "A" | "B" | "C" | "D";

/** Xếp loại theo khung PMO: 95+ A · 85+ B · 70+ C · dưới 70 D. */
export function xepLoai(diem: number): XepLoai {
  if (diem >= 95) return "A";
  if (diem >= 85) return "B";
  if (diem >= 70) return "C";
  return "D";
}

/** Nhãn đầy đủ của xếp loại, dùng cho chú giải bảng. */
export const NHAN_XEP_LOAI: Record<XepLoai, string> = {
  A: "Tuân thủ tốt",
  B: "Đạt",
  C: "Cần cải thiện",
  D: "Không đạt, cần can thiệp",
};

/* ── MỘT DỰ ÁN ──────────────────────────────────────────────────────────────────────────────── */

/** Kết quả chấm của MỘT dự án trong MỘT tháng: ba dòng, mỗi dòng một hạng mục. */
export type DongHangMuc = {
  hangMuc: HangMuc;
  /** Dấu theo từng ngày, cùng thứ tự với `ngay` của bảng. */
  marks: Mark[];
  /** Điểm hạng mục, null khi chưa chấm được ngày nào. */
  diem: number | null;
};

export type ChamDuAn = {
  /** Khoá dự án (dùng chung với phần còn lại của app). */
  key: string;
  maCT: string;
  ten: string;
  dong: DongHangMuc[];
  /** Trung bình ba hạng mục, null khi cả ba đều chưa chấm được. */
  diem: number | null;
};

/** Ngày dự án bắt đầu / kết thúc phải báo cáo. Ngoài khoảng này là không chấm. */
export type KhoangCham = { tu?: string | null; den?: string | null };

function trongKhoang(iso: string, k?: KhoangCham): boolean {
  if (!k) return true;
  if (k.tu && iso < k.tu) return false;
  if (k.den && iso > k.den) return false;
  return true;
}

/**
 * Chấm trọn một dự án cho một tháng.
 *
 * @param nop  mọi lần nộp của dự án này trong tháng (mọi hạng mục, mọi ngày).
 */
export function chamDuAn(
  duAn: { key: string; maCT: string; ten: string },
  thangKey: string,
  nop: readonly LanNop[],
  homNay: string,
  opts?: { nghi?: NgayNghi; khoang?: KhoangCham },
): ChamDuAn {
  const ngay = ngayChamCuaThang(thangKey, opts?.nghi);
  const dong: DongHangMuc[] = HANG_MUC.map((hm) => {
    const cua = nop.filter((n) => n.ma === hm.ma).map((n) => n.luc);
    const marks = ngay.map((d) =>
      trongKhoang(d, opts?.khoang) ? chamNgay(d, hm, cua, homNay, opts?.nghi) : null,
    );
    return { hangMuc: hm, marks, diem: diemHangMuc(marks) };
  });
  const co = dong.map((d) => d.diem).filter((v): v is number => v != null);
  return {
    ...duAn,
    dong,
    diem: co.length ? Math.round(co.reduce((a, b) => a + b, 0) / co.length) : null,
  };
}
