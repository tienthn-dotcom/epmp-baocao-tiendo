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
 * ── NHÃN VẬN HÀNH LẤY TỪ BẢNG TRACKING CỦA PMO (đổi 16/10/2026) ─────────────────────────────
 * Nhãn "ĐÃ/CHƯA VẬN HÀNH" KHÔNG có trong file ma trận — đã mở 8 file đầu danh sách ngày
 * 13/10/2026 để kiểm. Đó là chữ người làm báo cáo gõ tay lúc ghép trang.
 *
 * Lần đầu (13/10/2026) app tự suy: "đang chạy = trong 7 ngày gần nhất có người sửa file ma
 * trận". Đó là cách đoán khi chưa ai chấm tay.
 *
 * Nay PMO đã có bảng chấm thật. Anh Tiến 16/10/2026: *"dựa vào thông tin mới bên sheet Tracking
 * tiến độ, đánh lại cho tôi trên header mỗi page tình trạng đã vận hành hoặc chưa vận hành"*.
 * Nên nhãn LẤY THẲNG từ bảng đó (xem lib/tracking-vanhanh.ts) và phép đoán theo ngày sửa bị bỏ
 * hẳn — trộn hai nguồn vào một nhãn thì về sau không ai biết nhãn đang nói theo cái nào.
 *
 * `modifiedTime` của Drive vẫn được hiện, nhưng chỉ như một DÒNG THÔNG TIN ("cập nhật dd/mm"),
 * không còn quyền quyết định nhãn.
 */

import {
  dangVanHanh, nhanDai, traVH, dongTongVH, type BangTracking, type TrangThaiVH,
} from "@/lib/tracking-vanhanh";

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
  /** Trạng thái lấy từ bảng tracking của PMO. "chuaRo" = không tra được tên trong bảng. */
  tt: TrangThaiVH;
  /** Chữ dán lên ô nhãn, vd "TCLĐ: ĐÃ VẬN HÀNH". */
  nhan: string;
  /** Rút gọn cho chỗ nào chỉ cần hỏi "có đang chạy không". */
  chay: boolean;
  /** Ghi chú PMO viết trong bảng tracking (vd "PENDING DO CĐT"). Rỗng nếu không có. */
  ghiChu: string;
  /** Ngày sửa cuối của file ma trận (ISO) — CHỈ để hiện, không quyết định nhãn. */
  ngaySua: string | null;
  muc: MucMaTran;
};

/**
 * Xếp danh sách ma trận thành các trang báo cáo: gom theo cụm, giữ nguyên thứ tự trong từng cụm.
 *
 * GIỮ NGUYÊN THỨ TỰ GỐC trong mỗi cụm — danh sách MTLĐ do PMO tự sắp, sắp lại theo bảng chữ cái là
 * phá mất ý của người sắp (y như bài học bên perf-chart: "cái nào tôi không yêu cầu đổi thì bê
 * nguyên lên").
 *
 * @param bang     bảng tracking đã đọc (xem lib/tracking-vanhanh.ts) — NGUỒN của nhãn vận hành.
 * @param ngaySua  fileId → ngày sửa cuối (ISO). CHỈ để hiện dưới mã CT, không quyết định nhãn.
 */
export function xepTrangBod(
  ds: readonly MucMaTran[],
  bang: BangTracking,
  ngaySua?: ReadonlyMap<string, string | null>,
): TrangBod[] {
  const theoCum: MucMaTran[][] = CUM.map(() => []);
  for (const m of ds) theoCum[cumCuaVung(m.region)].push(m);

  const ra: TrangBod[] = [];
  let stt = 0;
  CUM.forEach((c, i) => {
    for (const m of theoCum[i]) {
      /* Không tra được tên trong bảng thì để "chuaRo" chứ KHÔNG lùi về phép đoán cũ: một nhãn
         xanh dựa trên luật khác hẳn, đứng cạnh các nhãn chấm tay, là chỗ sai không ai soi ra. */
      const d = traVH(bang, m.name);
      const tt: TrangThaiVH = d?.tt ?? "chuaRo";
      ra.push({
        cum: `${c.ma}. ${c.ten}`,
        stt: ++stt,
        ten: m.name,
        maCT: m.maCT,
        tt,
        nhan: nhanDai(tt),
        chay: dangVanHanh(tt),
        ghiChu: d?.ghiChu ?? "",
        ngaySua: ngaySua?.get(m.fileId) ?? null,
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

/** Dòng tổng ở bìa: "21 ma trận · 15 đã vận hành · 4 chưa vận hành · 2 ngoài diện". */
export function dongTong(trang: readonly TrangBod[]): string {
  return dongTongVH(trang.map((t) => t.tt));
}

/** Những ma trận KHÔNG tra được trong bảng tracking — phải nói ra để PMO bổ sung vào bảng,
 *  chứ không để chúng mang nhãn xám rồi trôi vào bản gửi BOD. */
export function thieuTrongTracking(trang: readonly TrangBod[]): string[] {
  return trang.filter((t) => t.tt === "chuaRo").map((t) => `${t.maCT} · ${t.ten}`);
}
