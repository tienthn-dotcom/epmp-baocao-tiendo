/**
 * CHẤM TUÂN THỦ THEO LƯỢT XUẤT PDF.
 *
 * Anh Tiến 08/10/2026: *"tôi muốn tracking này dựa theo việc xuất PDF, tức là ngày nào trước 18 giờ
 * xuất PDF thì tick, sau 18 giờ thì là o, và sau 20 giờ thì là x"*.
 *
 * Tức dấu của một dự án trong một ngày KHÔNG còn gõ tay vào Sheet nữa mà suy ra từ nhật ký: ai bấm
 * xuất PDF lúc mấy giờ. App vốn đã ghi nhật ký giám sát vào D1 (bảng access_log), nên chỉ cần ghi
 * thêm một dòng mỗi lần xuất rồi đọc ngược lại.
 *
 * MODULE THUẦN — không đụng mạng, không đụng React. Đây là chỗ CHẤM NGƯỜI, nên nó phải test được
 * tới từng phút ranh giới, và phải đọc lên là biết luật, không phải lần theo giao diện.
 *
 * BA ĐIỀU CỐ Ý, đừng "dọn" mất:
 *
 *  1. LƯỢT SỚM NHẤT TRONG NGÀY THẮNG. Một người xuất lúc 17:00 rồi xuất lại lúc 21:00 thì vẫn là
 *     đúng hạn — lượt sau là xem lại, không phải nộp muộn. Lấy lượt cuối là phạt người cẩn thận.
 *
 *  2. KHÔNG XUẤT ≠ CHƯA TỚI LÚC. Ngày đã qua mà không có lượt nào → "x" (không báo cáo). Ngày HÔM
 *     NAY chưa qua 20:00, hay ngày mai, thì để TRỐNG — chấm "x" cho một ngày chưa kết thúc là chấm
 *     oan, và kiểu oan này rất khó cãi vì bảng trông vẫn bình thường.
 *
 *  3. GIỜ VN CỐ ĐỊNH UTC+7. Nhật ký ghi ISO theo UTC; Worker chạy UTC. Việt Nam không có giờ mùa
 *     hè nên cộng cứng 7 tiếng là đúng, không cần thư viện múi giờ.
 */

/* ── MỐC GIỜ ──────────────────────────────────────────────────────────────────
   MUỐN ĐỔI GIỜ THÌ SỬA ĐÚNG HAI SỐ NÀY, không sửa chỗ nào khác.

   LƯU Ý CÓ XUNG ĐỘT SỐ LIỆU, đã báo anh Tiến 08/10/2026 — ba nguồn ghi ba kiểu:
     · bảng HANG_MUC trong bao-cao-ngay.ts (PMO chốt 16/09): TC lắp đặt hạn 17:30, hết trễ 19:30
     · đầu file nguồn BCN_BangCham:                          "Thi công lắp đặt 18:00"
     · anh Tiến nhắn 08/10:                                  trước 18:00 ✓ · sau 18:00 o · sau 20:00 ✕
   Lấy theo câu anh Tiến nhắn vì nó mới nhất VÀ khớp với file nguồn. Bảng HANG_MUC để nguyên, chưa
   đụng — đổi nó là đổi luật chấm của cả ba hạng mục, phải hỏi trước. */
export const HAN_PHUT = 18 * 60;      // 18:00 — trước mốc này là đúng hạn
export const HET_TRE_PHUT = 20 * 60;  // 20:00 — quá mốc này là không báo cáo

/* ── NGÀY BẮT ĐẦU CHẤM ────────────────────────────────────────────────────────
   App CHỈ BẮT ĐẦU ghi nhật ký lượt xuất PDF từ 08/10/2026 (commit này). Trước đó nút xuất PDF báo
   cáo dự án không ghi lại gì cả — không phải người ta không làm, mà là app không nhìn.

   Thiếu mốc này thì luật "ngày đã qua mà không có lượt xuất → x" sẽ quét sạch MỌI ngày trước đó
   thành x cho MỌI dự án. Một bảng chấm người bỗng dưng toàn điểm liệt vì app mới cắm cảm biến —
   đó là kiểu sai tệ nhất ở đây: nó nhìn như dữ liệu thật, không ai biết để cãi.

   Ngày trước mốc này luôn trả về `null` (để trống), đừng đổi thành "x". Khi nào chạy đủ lâu và
   anh Tiến muốn chốt lại mốc thì sửa đúng hằng số này. */
export const NGAY_BAT_DAU_CHAM = "2026-10-08";

/** Dấu chấm theo lượt xuất PDF. Cùng bộ ký hiệu với file nguồn (xem BcnMark). */
export type DauPdf = "P" | "o" | "x";

const VN_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

/** Mốc ISO → thời điểm theo GIỜ VN, tách sẵn ngày và phút trong ngày. `null` nếu chuỗi không đọc được. */
export function lucVn(iso: string): { ngay: string; phut: number } | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + VN_OFFSET_MS);
  const ngay = d.toISOString().slice(0, 10);
  return { ngay, phut: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** Phút trong ngày (giờ VN) → dấu.
 *
 *  RANH GIỚI ĐẶT Ở ĐÂU: "trước 18 giờ thì tick" nên ĐÚNG 18:00:00 đã là trễ. "sau 20 giờ thì là x"
 *  nên đúng 20:00:00 vẫn còn là trễ, qua 20:00 mới thành x. Hai mốc đọc khác nhau một chút, và đó
 *  là đọc theo đúng câu chữ chứ không phải cho cân đối. */
export function dauTheoPhut(phut: number): DauPdf {
  if (phut < HAN_PHUT) return "P";
  if (phut <= HET_TRE_PHUT) return "o";
  return "x";
}

/** Một lượt xuất PDF đọc từ nhật ký. */
export type LuotXuat = {
  /** Mốc ISO (UTC) như access_log ghi. */
  ts: string;
  /** Khoá dự án — mã CT là bền nhất, xem ghi chú ở khoaDuAn. */
  duAn: string;
};

/** BẢNG DẤU: dự án → ngày → dấu. Chỉ chứa ngày THẬT SỰ CÓ lượt xuất. */
export type BangDau = Map<string, Map<string, DauPdf>>;

/** Gom nhật ký thành bảng dấu. Mỗi ngày lấy lượt SỚM NHẤT (xem ghi chú đầu file). */
export function gomLuot(luot: readonly LuotXuat[]): BangDau {
  const somNhat = new Map<string, Map<string, number>>();
  for (const l of luot) {
    const v = lucVn(l.ts);
    if (!v || !l.duAn) continue;
    let theoNgay = somNhat.get(l.duAn);
    if (!theoNgay) { theoNgay = new Map(); somNhat.set(l.duAn, theoNgay); }
    const cu = theoNgay.get(v.ngay);
    if (cu == null || v.phut < cu) theoNgay.set(v.ngay, v.phut);
  }
  const ra: BangDau = new Map();
  for (const [da, theoNgay] of somNhat) {
    const m = new Map<string, DauPdf>();
    for (const [ngay, phut] of theoNgay) m.set(ngay, dauTheoPhut(phut));
    ra.set(da, m);
  }
  return ra;
}

/** Ngày ISO đó đã QUA mốc hết trễ chưa, tính theo giờ VN tại thời điểm `bayGio`.
 *
 *  Dùng để biết một ngày không có lượt xuất nào thì đáng "x" hay còn để trống. Ngày chưa kết thúc
 *  cửa sổ nộp mà đã chấm "x" là chấm oan — xem điều 2 ở đầu file. */
export function daQuaHan(ngay: string, bayGio: number): boolean {
  const moc = Date.parse(`${ngay}T00:00:00Z`);
  if (!Number.isFinite(moc)) return false;
  // 00:00 VN của ngày đó (tính bằng UTC) + mốc hết trễ.
  return bayGio > moc - VN_OFFSET_MS + HET_TRE_PHUT * 60_000;
}

/** Dấu của một dự án trong một ngày. `null` = chưa tới lúc chấm, hoặc trước ngày app bắt đầu ghi.
 *
 *  `batDau` để test đổi mốc được; thường thì cứ để mặc định. */
export function dauCuaNgay(bang: BangDau, duAn: string, ngay: string, bayGio: number, batDau: string = NGAY_BAT_DAU_CHAM): DauPdf | null {
  const co = bang.get(duAn)?.get(ngay);
  if (co) return co;
  /* TRƯỚC NGÀY APP BẮT ĐẦU GHI thì KHÔNG CHẤM — xem ghi chú ở NGAY_BAT_DAU_CHAM. Kiểm sau khi đã
     tra bảng: nếu nhật ký lỡ có dòng cũ hơn mốc thì vẫn tôn trọng dòng thật đó. */
  if (ngay < batDau) return null;
  return daQuaHan(ngay, bayGio) ? "x" : null;
}

/** Các ngày ISO của một tháng "YYYY-MM" — để dựng cột bảng mà không cần file nguồn. */
export function ngayTrongThang(thang: string): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(thang);
  if (!m) return [];
  const nam = +m[1], thg = +m[2];
  const dau = Date.UTC(nam, thg - 1, 1);
  const ra: string[] = [];
  for (let t = dau; new Date(t).getUTCMonth() === thg - 1; t += DAY_MS) ra.push(new Date(t).toISOString().slice(0, 10));
  return ra;
}

/* ── KHOÁ DỰ ÁN ───────────────────────────────────────────────────────────────
   Nhật ký chỉ có một ô chữ tự do, nên phải tự quy ước cách ghi rồi đọc lại cho khớp.

   LẤY MÃ CT LÀM KHOÁ, không lấy tên: tên dự án trên app và tên trong file chấm gõ khác nhau (file
   ghi "Apec S2", app ghi "APEC S2 - Phòng…"), mà mã CT thì cả hai bên đều có và không ai gõ lại.
   Một dòng nhật ký vẫn ghi kèm TÊN để người đọc nhật ký hiểu được, nhưng phần máy đọc là mã. */

/** Dựng ô chữ cho một dòng nhật ký: "<mã CT> · <tên>". */
export function ghiLuot(maCT: string, ten: string): string {
  return `${(maCT || "").trim()} · ${(ten || "").trim()}`.slice(0, 300);
}

/** Đọc ngược mã CT từ ô chữ nhật ký. Rỗng nếu không có mã — dòng đó bỏ qua, KHÔNG đoán theo tên. */
export function khoaDuAn(detail: string | null | undefined): string {
  const t = String(detail ?? "").trim();
  if (!t) return "";
  const truoc = t.split("·")[0].trim();
  return /^CT\d/i.test(truoc) ? truoc.toUpperCase() : "";
}
