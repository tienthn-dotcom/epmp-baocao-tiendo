/**
 * DEADLINE "CẦN PM TRÌNH BOD PHÊ DUYỆT (BITRIX)" — đọc ngày từ đúng câu người ta viết.
 *
 * HAI MẪU CÂU CHUẨN (PMO chốt 10/09/2026) — cũng chính là quy ước để gom dự án vào bộ lọc
 * "Cần cập nhật MP" (xem noteSaysTrinhBodBitrix trong parser.ts):
 *
 *   PMO: Dự án mới cần PM lập master plan & trình BOD phê duyệt bitrix trước ......
 *   PMO: Tiến độ dời từ ... đến ....., cần PM trình BOD phê duyệt bitrix trước .......
 *
 * Mẫu thứ hai là chỗ dễ đọc sai nhất: nó có SẴN HAI NGÀY ("dời từ … đến …") đứng TRƯỚC ngày cần
 * lấy. Ngày của cụm dời tiến độ tuyệt đối không được lẫn vào deadline trình BOD.
 *
 * Chưa điền ngày (còn để "......") thì KHÔNG có deadline — để trống, không bịa.
 *
 * KHOÁ CỨNG VÀO CÂU ĐÓ. Bản trước dò kiểu "tìm chữ bitrix, rồi lấy cụm 'trước dd/mm' GẦN NHẤT" —
 * gần nhất tính cả hai phía, nên một ô ghi chú gộp nhiều tin thì nó nhặt trúng ngày của việc khác
 * ("… đặt hàng gạch trước 29/08") và ngày hiển thị nhảy lung tung mỗi lần thêm tin mới.
 * Ở đây "trước dd/mm" phải DÍNH LIỀN sau cụm trình BOD thì mới tính — không thì coi như không có.
 *
 * NĂM neo theo HÔM NAY, không neo theo ngày cắm cờ: ngày cắm cờ bị xoá-ghi lại mỗi khi khoá dự án
 * đổi, neo vào đó thì năm cũng đổi theo. "09/09" chọn năm nào gần hôm nay nhất.
 *
 * Module THUẦN để test được — logic này ra sai một ngày là báo cáo tuân thủ trừ điểm oan.
 */

/* Viết cả hai lối CÓ DẤU và KHÔNG DẤU: ghi chú gõ vội hay thiếu dấu là chuyện thường. */
const NGAY = String.raw`(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?`;
const TRUOC_NGAY = String.raw`(?:trước|truoc)\s*(?:(?:ngày|ngay)\s*)?` + NGAY;
/** Cụm trình BOD + "trước dd/mm" DÍNH LIỀN: "trình BOD phê duyệt (bitrix) trước 09/09". */
const CAU_BOD = new RegExp(
  String.raw`(?:trình|trinh)\s*bod\s*(?:(?:phê|phe)\s*)?(?:duyệt|duyet)[^0-9]{0,40}?bitrix[^0-9]{0,20}?` + TRUOC_NGAY,
  "g",
);
/** Dự phòng: "trước dd/mm" xuất hiện SAU chữ "bitrix" cuối cùng (câu viết tách ra làm hai vế). */
const TRUOC = new RegExp(TRUOC_NGAY, "g");

/** Lấy lần khớp CUỐI CÙNG — ô ghi chú gộp nhiều tin thì tin mới nhất mới là tin đang có hiệu lực. */
function khopCuoi(re: RegExp, s: string): RegExpExecArray | null {
  re.lastIndex = 0;
  let cuoi: RegExpExecArray | null = null, m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) cuoi = m;
  return cuoi;
}

const hopLe = (d: number, mo: number) => mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
const p2 = (n: number) => String(n).padStart(2, "0");

/**
 * Đọc deadline (ISO yyyy-mm-dd) từ ghi chú.
 * @param note   ghi chú vướng mắc cấp dự án (có thể gộp nhiều tin).
 * @param homNay ISO "yyyy-mm-dd" — dùng để chọn năm khi câu chỉ ghi dd/mm.
 * @returns null khi câu không nói tới deadline. KHÔNG tự bịa ngày.
 */
export function parseMpDeadlineIso(note: string, homNay: string): string | null {
  if (!note) return null;
  const low = note.normalize("NFC").toLowerCase();
  if (!low.includes("bitrix")) return null;

  // 1) Câu chuẩn, dính liền — đường đi đúng của gần hết ghi chú.
  let m = khopCuoi(CAU_BOD, low);
  // 2) Không dính liền thì chỉ nhận "trước dd/mm" nằm SAU cụm bitrix MỚI NHẤT. Trước đó là việc khác.
  if (!m) m = khopCuoi(TRUOC, low.slice(low.lastIndexOf("bitrix") + "bitrix".length));
  if (!m) return null;

  const d = +m[1], mo = +m[2];
  if (!hopLe(d, mo)) return null;
  let y = m[3] ? +m[3] : null;
  if (y != null && y < 100) y += 2000;
  if (y == null) y = namGanNhat(d, mo, homNay);
  return `${y}-${p2(mo)}-${p2(d)}`;
}

/** Chỉ có dd/mm thì chọn năm cho ngày đó GẦN HÔM NAY nhất (xét năm trước / nay / sau). */
function namGanNhat(d: number, mo: number, homNay: string): number {
  const ny = +homNay.slice(0, 4) || new Date().getUTCFullYear();
  const tNay = Date.UTC(ny, +homNay.slice(5, 7) - 1, +homNay.slice(8, 10));
  let tot = ny, cach = Infinity;
  for (const y of [ny - 1, ny, ny + 1]) {
    const k = Math.abs(Date.UTC(y, mo - 1, d) - tNay);
    if (k < cach) { cach = k; tot = y; }
  }
  return tot;
}
