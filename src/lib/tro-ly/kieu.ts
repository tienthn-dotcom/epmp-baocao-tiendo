/**
 * TRỢ LÝ ePMP — KIỂU DỮ LIỆU.
 *
 * KHÔNG phải một ô chat dán thêm vào app. Đây là một LỚP HIỂU nằm trên toàn app: nó biết người
 * dùng đang ở màn nào, đang lọc gì, đang mở dự án nào, rồi trả lời dựa trên ĐÚNG dữ liệu app
 * đang bày — và trả lời xong thì đưa người ta tới đúng chỗ.
 *
 * BA LUẬT NỀN:
 *  1. Trợ lý KHÔNG tự đọc file nguồn hay kho KV. Màn hình chính gói sẵn một BẢN TÓM rồi đưa
 *     xuống. Sửa luật lọc / luật cảnh báo ở một nơi, trợ lý đi theo, không lệch.
 *  2. Trả lời KHÔNG phải một đoạn văn. Nó là CÁC KHỐI dựng được thành giao diện: thẻ số, bảng,
 *     danh sách dự án bấm được, nút đưa tới đúng bộ lọc.
 *  3. Nói số thì nói LẤY TỪ ĐÂU, và bấm vào được để soi lại. Không đủ dữ liệu thì nói thẳng.
 */

/* ── NGỮ CẢNH: trợ lý đang đứng ở đâu trong app ─────────────────────────────── */

export type ManHinh = "danh-sach" | "tong-the" | "mtld" | "khac";

export type NguCanh = {
  man: ManHinh;
  /** Mô tả bộ lọc đang bật, đã viết thành chữ đọc được ("PM: Lê Tuấn · Vùng: PQ"). */
  boLoc: string[];
  /** Số dòng bảng đang bày sau khi lọc. */
  dongDangHien: number;
  /** Dự án đang mở hộp thoại, nếu có. */
  duAnDangMo?: { maCT: string; ten: string } | null;
  /** Người dùng chọn hỏi trên phần đang lọc hay trên toàn bộ dự án. */
  pham: "dang-loc" | "tat-ca";
};

/* ── DỮ LIỆU ────────────────────────────────────────────────────────────────── */

/** Một dự án, rút gọn đủ để trả lời. Mọi ngày là ISO "yyyy-mm-dd". */
export type DuAnTom = {
  /** Khoá dòng trong app — để nút "mở dự án" tìm lại đúng dòng. */
  khoa: string;
  maCT: string;
  ten: string;
  pm: string;
  vung: string;
  cdt: string;
  batDau: string | null;
  banGiao: string | null;
  ngayUpdate: string | null;
  /** % thực tế cấp dự án, 0-100. */
  pct: number | null;
  soHangMuc: number;
  tre: number;
  canCat: number;
  canTapTrung: number;
  vuongMac: string;
  giaiPhap: string;
  canTrinhMp: boolean;
  hanMp: string | null;
  soTuanTreMp: number;
  daBanGiao: boolean;
  coBaoCao: boolean;
  /** Dự án có nằm trong phần đang lọc không — để trả lời theo phạm vi người dùng chọn. */
  dangHien: boolean;
};

export type KpiTom = {
  hienHanh: number; tre: number; canCat: number; canTapTrung: number;
  banGiaoThangNay: number; top20: number;
};

export type NguonHoi = {
  /** ISO "yyyy-mm-dd". */
  homNay: string;
  duAn: DuAnTom[];
  kpi: KpiTom;
  phienBan: string;
  banMoi: { v: string; date: string; items: string[] }[];
  vaiTro: "admin" | "OCC" | "BOD" | null;
  nguCanh: NguCanh;
};

/* ── CÂU TRẢ LỜI: các khối dựng được thành giao diện ─────────────────────────── */

export type Mau = "do" | "vang" | "xanh" | "trung";

/** Việc một nút sẽ làm. Màn hình chính là nơi thi hành. */
export type Lenh =
  | { kieu: "loc-tre" }
  | { kieu: "loc-mp" }
  | { kieu: "loc-thang"; thang: string }        // "2026-10"
  | { kieu: "loc-pm"; pm: string }
  | { kieu: "bo-loc" }
  | { kieu: "mo-du-an"; khoa: string }
  | { kieu: "mo-man"; man: "tong-the" | "danh-sach" | "mtld" | "phien-ban" | "tuan-thu" }
  | { kieu: "hoi"; cau: string };

export type HanhDong = {
  nhan: string;
  lenh: Lenh;
  /** "xem" = chỉ đưa đi xem (an toàn). "doi" = có đổi dữ liệu → phải hỏi lại trước khi chạy. */
  loai?: "xem" | "doi";
};

export type Khoi =
  | { loai: "chu"; chu: string }
  | { loai: "the-so"; the: { nhan: string; gia: string; phu?: string; mau?: Mau }[] }
  | { loai: "bang"; cot: string[]; dong: string[][]; ghiChu?: string }
  /** Danh sách dự án bấm được — bấm là mở đúng dòng đó trên bảng. */
  | { loai: "du-an"; ds: { khoa: string; maCT: string; ten: string; phu?: string; mau?: Mau }[]; con?: number }
  | { loai: "nhac"; mau: Mau; chu: string };

export type CauTraLoi = {
  tieuDe: string;
  khoi: Khoi[];
  /** Nút đưa người dùng tới đúng chỗ. */
  hanhDong?: HanhDong[];
  /** Câu hỏi tiếp — bấm là hỏi luôn. */
  goiY?: string[];
  /** Số này lấy từ đâu. Luôn có khi câu trả lời có số. */
  nguon?: string;
  /** Không trả lời được thì nhận, đừng đoán. */
  khongBiet?: boolean;
};
