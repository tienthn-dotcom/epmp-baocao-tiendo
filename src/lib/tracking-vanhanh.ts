/**
 * TÌNH TRẠNG VẬN HÀNH MA TRẬN — đọc từ sheet "TRACKING TIẾN ĐỘ VẬN HÀNH MA TRẬN TCLĐ".
 *
 * Anh Tiến 16/10/2026, gửi bản in của sheet đó: *"dựa vào thông tin mới bên sheet Tracking tiến
 * độ, đánh lại cho tôi trên header mỗi page tình trạng đã vận hành hoặc chưa vận hành"*.
 *
 * ── ĐỔI NGUỒN SỰ THẬT, KHÔNG PHẢI ĐỔI CÁCH TÍNH ─────────────────────────────────────────────
 * Trước đây nhãn trên dải tiêu đề do app TỰ SUY: "trong 7 ngày gần nhất có người sửa file ma
 * trận thì coi như đang vận hành" (chốt 13/10/2026, xem bao-cao-bod.ts). Đó là cách đoán khi
 * chưa có ai chấm tay. Nay PMO đã có bảng chấm thật — mỗi dự án một dòng, người chấm tự ghi —
 * nên nhãn LẤY THẲNG từ bảng đó. Bỏ hẳn phép đoán, đừng trộn hai nguồn vào một nhãn.
 *
 * ── BẢNG CÓ NĂM TRẠNG THÁI, KHÔNG PHẢI HAI ──────────────────────────────────────────────────
 * Đếm trên bản 16/10/2026 (83 dự án): Đã vận hành 41 · Chưa vận hành 16 · Chưa triển khai 5 ·
 * Chưa cần triển khai 12 · Không cần triển khai 9.
 *
 * Ba trạng thái sau KHÁC HẲN "chưa vận hành". "Chưa cần" và "Không cần" là dự án không thuộc
 * diện phải chạy ma trận — gộp chung vào "CHƯA VẬN HÀNH" là vu oan cho PM, mà bản này gửi BOD.
 * Nên giữ nguyên năm nhãn của bảng.
 *
 * ── KHỚP THEO TÊN DỰ ÁN ─────────────────────────────────────────────────────────────────────
 * Bảng tracking không có cột mã CT, chỉ có tên. Đo ngày 16/10 trên danh sách ma trận thật: tên
 * trùng gần như từng chữ, chỉ một kiểu lệch là bảng ghi gọn hơn ("Tây Hồ View - Public (Tháp
 * 4S)" so với "…(Tháp 4S) (Gym, Spa, Swimming Pool, ADD)"). Nên: khớp đúng trước, không có thì
 * nhận tên nào là phần đầu của tên kia — và CHỈ NHẬN KHI DUY NHẤT một dòng khớp. Dính hai dòng
 * thì trả "chưa rõ" chứ không chọn bừa: dán nhầm nhãn vận hành lên bản gửi BOD là kiểu sai
 * không ai soi ra.
 */

export type TrangThaiVH = "da" | "chua" | "chuaTrienKhai" | "chuaCan" | "khongCan" | "chuaRo";

/** Chữ đúng như bảng tracking đang ghi. */
export const NHAN_VH: Record<TrangThaiVH, string> = {
  da: "Đã vận hành",
  chua: "Chưa vận hành",
  chuaTrienKhai: "Chưa triển khai",
  chuaCan: "Chưa cần triển khai",
  khongCan: "Không cần triển khai",
  chuaRo: "Chưa rõ tình trạng",
};

/** Nhãn IN HOA dán lên dải tiêu đề mỗi trang, giữ tiền tố "TCLĐ:" như bản BOD tuần 40. */
export const nhanDai = (tt: TrangThaiVH): string => `TCLĐ: ${NHAN_VH[tt].toUpperCase()}`;

/** Màu ô nhãn. Xanh = chạy · đỏ = đáng lẽ phải chạy mà chưa · cam = chưa tới lượt ·
 *  xám = không thuộc diện phải chạy · xám nhạt = không tìm thấy trong bảng. */
export const MAU_VH: Record<TrangThaiVH, string> = {
  da: "#10b981",
  chua: "#dc2626",
  chuaTrienKhai: "#d97706",
  chuaCan: "#64748b",
  khongCan: "#475569",
  chuaRo: "#94a3b8",
};

/** Trạng thái được coi là ĐANG CHẠY (chỉ đúng một cái). */
export const dangVanHanh = (tt: TrangThaiVH): boolean => tt === "da";
/** Trạng thái KHÔNG thuộc diện phải chạy ma trận — không tính vào mẫu số khi đánh giá. */
export const ngoaiDien = (tt: TrangThaiVH): boolean => tt === "chuaCan" || tt === "khongCan";

/** Bỏ dấu + gom ký tự lạ thành khoảng trắng. Dùng CHUNG cho cả hai phía khi khớp tên. */
export function chuanTen(s: string): string {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Đọc một ô "Trạng thái" thành mã. Không nhận ra → null (bên gọi tự quyết). */
export function doTrangThai(raw: string): TrangThaiVH | null {
  const s = chuanTen(raw);
  if (!s) return null;
  /* "khong can" phải xét TRƯỚC "chua can", và cả hai trước "chua trien khai" — ba câu chỉ khác
     nhau một hai từ, xét sai thứ tự là gộp nhầm trạng thái. */
  if (/^khong can/.test(s)) return "khongCan";
  if (/^chua can/.test(s)) return "chuaCan";
  if (/^chua trien khai/.test(s)) return "chuaTrienKhai";
  if (/^da van hanh/.test(s)) return "da";
  if (/^chua van hanh/.test(s)) return "chua";
  return null;
}

export type DongTracking = {
  stt: string;
  pm: string;
  ten: string;
  vung: string;
  tt: TrangThaiVH;
  ghiChu: string;
};

export type BangTracking = {
  dong: DongTracking[];
  /** Tên đã chuẩn hoá → dòng. Tên trùng nhau thì giữ dòng ĐẦU và ghi vào `trung`. */
  theoTen: Map<string, DongTracking>;
  /** Dòng đọc không ra trạng thái, để nói cho người dùng biết chứ không nuốt. */
  bo: string[];
  trung: string[];
};

/** Tách một dòng TSV hoặc CSV. Dán từ Google Sheet ra là TSV; tải .csv về là CSV có dấu nháy. */
function tachO(dong: string): string[] {
  if (dong.includes("\t")) return dong.split("\t").map((o) => o.trim());
  const ra: string[] = [];
  let o = "", trongNhay = false;
  for (let i = 0; i < dong.length; i++) {
    const c = dong[i];
    if (c === '"') {
      if (trongNhay && dong[i + 1] === '"') { o += '"'; i++; } else trongNhay = !trongNhay;
    } else if (c === "," && !trongNhay) { ra.push(o.trim()); o = ""; } else o += c;
  }
  ra.push(o.trim());
  return ra;
}

/**
 * Đọc cả bảng tracking.
 *
 * Nhận đúng khuôn cột của sheet: `STT · Tên PM · Tên dự án · Khu vực · Trạng thái · Ghi chú`.
 * Bỏ qua dòng tiêu đề, dòng nhóm vùng ("I KHU VỰC PHÚ QUỐC") và dòng tổng — những dòng đó
 * không có STT là số, hoặc không đọc ra trạng thái.
 */
export function docTracking(text: string): BangTracking {
  const dong: DongTracking[] = [];
  const theoTen = new Map<string, DongTracking>();
  const bo: string[] = [], trung: string[] = [];

  for (const raw of (text || "").split(/\r?\n/)) {
    const d = raw.trim();
    if (!d) continue;
    const o = tachO(d);
    if (o.length < 5) continue;
    if (!/^\d{1,4}$/.test(o[0])) continue;              // dòng nhóm vùng / tiêu đề / tổng
    const tt = doTrangThai(o[4]);
    if (!tt) { bo.push(d); continue; }
    const ten = o[2];
    if (!ten) { bo.push(d); continue; }
    const r: DongTracking = { stt: o[0], pm: o[1], ten, vung: o[3], tt, ghiChu: o[5] ?? "" };
    dong.push(r);
    const k = chuanTen(ten);
    if (theoTen.has(k)) trung.push(ten); else theoTen.set(k, r);
  }
  return { dong, theoTen, bo, trung };
}

/**
 * Tra tình trạng cho MỘT ma trận theo tên dự án.
 * Khớp đúng → khớp phần đầu (duy nhất) → không có thì null.
 */
export function traVH(bang: BangTracking, tenDuAn: string): DongTracking | null {
  const k = chuanTen(tenDuAn);
  if (!k) return null;
  const thang = bang.theoTen.get(k);
  if (thang) return thang;

  const hit: DongTracking[] = [];
  for (const [key, r] of bang.theoTen) {
    if (key.startsWith(k + " ") || k.startsWith(key + " ")) hit.push(r);
  }
  /* Nhiều dòng cùng khớp → chọn dòng có tên DÀI NHẤT trùng phần đầu chỉ là đoán. Trả null. */
  return hit.length === 1 ? hit[0] : null;
}

/** Đếm theo trạng thái — cho dòng tổng ở bìa báo cáo. */
export function demVH(tts: readonly TrangThaiVH[]): Record<TrangThaiVH, number> {
  const d: Record<TrangThaiVH, number> = { da: 0, chua: 0, chuaTrienKhai: 0, chuaCan: 0, khongCan: 0, chuaRo: 0 };
  for (const t of tts) d[t]++;
  return d;
}

/** Dòng tổng gọn: "21 ma trận · 15 đã vận hành · 4 chưa vận hành · 2 ngoài diện". */
export function dongTongVH(tts: readonly TrangThaiVH[]): string {
  const d = demVH(tts);
  const phan = [
    `${tts.length} ma trận`,
    `${d.da} đã vận hành`,
    `${d.chua} chưa vận hành`,
  ];
  if (d.chuaTrienKhai) phan.push(`${d.chuaTrienKhai} chưa triển khai`);
  const ngoai = d.chuaCan + d.khongCan;
  if (ngoai) phan.push(`${ngoai} ngoài diện`);
  if (d.chuaRo) phan.push(`${d.chuaRo} chưa rõ`);
  return phan.join(" · ");
}
