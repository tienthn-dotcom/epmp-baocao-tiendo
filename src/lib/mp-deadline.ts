/**
 * "CẦN PM TRÌNH BOD PHÊ DUYỆT (BITRIX)" — NHẬN DIỆN CÂU và ĐỌC HẠN. MỘT LUẬT, HAI CÂU TRẢ LỜI.
 *
 * Module này trả lời cả hai câu hỏi bằng CÙNG một phép dò, để chúng không bao giờ chỏi nhau:
 *   1. Dự án có cần trình BOD không?            → noteCanTrinhBodBitrix()
 *   2. Nếu cần thì hạn là ngày nào?             → parseMpDeadlineIso()
 * Trước đây câu 1 nằm ở parser.ts, câu 2 ở đây, hai luật khác nhau — nên có dự án vào được bộ
 * lọc mà cột hạn hiện "–", và ngược lại. Giờ parser.ts gọi vào đây.
 *
 * HAI MẪU CÂU CHUẨN PMO ĐANG DÙNG (chốt 10/09/2026):
 *   PMO: Dự án mới cần PM lập master plan & trình BOD phê duyệt bitrix trước ......
 *   PMO: Tiến độ dời từ ... đến ....., cần PM trình BOD phê duyệt bitrix trước .......
 *
 * NHƯNG NGƯỜI THẬT KHÔNG VIẾT ĐÚNG MẪU. Đây là câu thật lấy từ kho ghi chú:
 *   "cần PM trình bitrix BOD duyệt ngày bàn giao mới GẤP"          ← bitrix ĐỨNG TRƯỚC bod
 *   "cần PM trình BOD phê duyệt ( bitrix )"                        ← thừa khoảng trắng, KHÔNG có hạn
 *   "Tiến độ dời từ 30/06 đến 30/11, cần PM trình BOD phê duyệt (bitrix) trước 09/09.
 *    Cần PM tăng tốc TKSX toàn bộ mã trước 10/09"                  ← BA ngày, chỉ 1 ngày đúng
 * Vì thế luật KHÔNG đòi bốn chữ đứng liền nhau theo đúng thứ tự, mà đòi chúng nằm TRONG CÙNG
 * MỘT CÂU. Đổi lại, phải chặn được câu nói việc ĐÃ XONG ("BOD đã phê duyệt bitrix").
 *
 * KHOÁ CỨNG VỀ NGÀY (người dùng chốt 29/09/2026: *"đừng dùng mỗi chữ trước dd/mm, dễ bị sai"*):
 *   · Ngày phải NẰM TRONG CÂU trình BOD. Ngày của câu khác trong cùng ô KHÔNG được lấy.
 *   · Ngày phải CÓ CHỮ DẪN đứng trước: trước / hạn / chậm nhất / deadline / mốc / ngày /
 *     ngay sau chữ "bitrix". Ngày trơ trọi không chữ dẫn thì BỎ, không đoán.
 *   · Ngày của cụm DỜI TIẾN ĐỘ ("dời từ 30/06 đến 30/11") bị loại thẳng, dù nằm cùng câu.
 *     Đây là chỗ dễ sai nhất: nó cho ra hạn sớm hơn thật rất nhiều → trừ điểm oan PM.
 *   · Không có ngày thì trả null. TUYỆT ĐỐI KHÔNG BỊA.
 *
 * NĂM neo theo HÔM NAY, không neo theo ngày cắm cờ: ngày cắm cờ bị xoá-ghi lại mỗi khi khoá dự
 * án đổi, neo vào đó thì năm cũng đổi theo. "09/09" chọn năm nào gần hôm nay nhất.
 *
 * Module THUẦN để test được — logic này ra sai một ngày là báo cáo tuân thủ trừ điểm oan.
 */

/** Bỏ dấu tiếng Việt để một luật ăn cả hai lối viết (ghi chú gõ vội hay thiếu dấu). */
function boDau(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

/** Ngày dd/mm hoặc dd/mm/yyyy — chấp cả dấu chấm và gạch ngang. */
const NGAY = /(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?/g;

/** CHỮ DẪN HẠN: ngày đứng sau một trong các chữ này mới được coi là hạn trình BOD.
 *  "bitrix" nằm trong đây để nhận lối viết tắt "trình BOD duyệt bitrix 22/09". */
const TU_HAN = /(?:truoc|han|han chot|han cuoi|cham nhat(?: la)?|deadline|moc|trong ngay|xong truoc|trinh truoc|hoan thanh truoc|bitrix|ngay)$/;

/** CHỮ DẪN KHOẢNG: ngày của cụm dời tiến độ. Loại thẳng, không bàn. */
const TU_KHOANG = /(?:tu|den|toi|sang|thanh|qua|luc|trong thang|thang)$/;

/** BA mảnh bắt buộc trong CÙNG MỘT CÂU: trình + duyệt + bitrix.
 *
 *  CHỮ "BOD" KHÔNG BẮT BUỘC. Trước đây có, và nó bỏ sót ca thật trên bản chính thức:
 *    CT26-036 Văn phòng công ty Cao Trần — "Cần PM trình duyệt bitrix ngày bàn giao mới
 *    trước ngày 30/9". Đủ nghĩa là trình BOD duyệt trên bitrix, chỉ thiếu đúng ba chữ cái,
 *    nên dự án rớt khỏi bộ lọc và mất luôn hạn 30/9.
 *  Trên bitrix, trình duyệt tức là trình BOD — chữ BOD chỉ là cách viết cho rõ.
 *  Đo trước khi nới: file nguồn 19 → 20 (đúng một ca trên, không kéo theo ai);
 *  kho ghi chú gõ trong app: không đổi.
 */
const CO_TRINH = /\btrinh\b/;
const CO_BOD = /\bbod\b/;
const CO_DUYET = /\bduyet\b/;
const CO_BITRIX = /bitrix/;
/** DUYỆT MẪU KHÔNG PHẢI TRÌNH BOD. Bỏ chữ BOD ra khỏi điều kiện thì câu kiểu
 *  "trình duyệt mẫu trên bitrix" lọt vào — đó là việc của khâu Duyệt mẫu, không phải
 *  master plan. Câu chỉ nói duyệt mẫu mà không nhắc BOD thì loại. */
const DUYET_MAU = /\bduyet mau\b|\btrinh mau\b/;

/** Câu nói việc ĐÃ XONG — có mấy chữ này thì không phải yêu cầu đang treo. */
const DA_XONG = /\bbod da\b|\bda (?:\w+ ){0,2}duyet\b|\bduoc bod\b|\bduyet xong\b|\bdaduyet\b/;
/** ...TRỪ KHI trong câu vẫn có chữ đòi hỏi. "BOD đã duyệt, cần PM trình lại bitrix" vẫn là việc phải làm. */
const CON_DOI = /\bcan\b|\byeu cau\b|\bchua\b|\bgap\b|\bde nghi\b|\bphai\b|\btruoc\b|\bhan\b|\bcham nhat\b|\bdeadline\b/;
/** Câu nói KHÔNG cần trình — chặn hẳn, chữ đòi hỏi cũng không cứu. */
const MIEN = /\bkhong can trinh\b|\bkhong phai trinh\b|\bkhong can lap\b/;

/** Cắt ô ghi chú thành từng CÂU. Cắt ở dòng mới, dấu ; và dấu chấm KHÔNG nằm giữa hai chữ số
 *  (nếu cắt cả "30.12" thì vỡ ngày). KHÔNG cắt ở dấu phẩy: mẫu câu chuẩn của PMO có dấu phẩy
 *  ngay trước "cần PM trình BOD...", cắt ở đó là mất luôn phần hạn nằm cùng câu. */
function catCau(s: string): string[] {
  return s.split(/[\n;·]+|(?<!\d)\.(?!\d)|(?<!\d)!(?!\d)/).filter((c) => c.trim().length > 0);
}

/** Câu này có phải YÊU CẦU trình BOD phê duyệt trên Bitrix (đang treo) không? */
function cauNoiTrinhBod(cau: string): boolean {
  if (!CO_TRINH.test(cau) || !CO_DUYET.test(cau) || !CO_BITRIX.test(cau)) return false;
  if (DUYET_MAU.test(cau) && !CO_BOD.test(cau)) return false;
  if (MIEN.test(cau)) return false;
  if (DA_XONG.test(cau) && !CON_DOI.test(cau)) return false;
  return true;
}

/** Tất cả các câu trình BOD trong ô, THEO THỨ TỰ XUẤT HIỆN. Ô gộp nhiều tin thì câu cuối là tin mới nhất. */
function cacCauTrinhBod(note: string): string[] {
  if (!note) return [];
  const n = boDau(note.normalize("NFC")).replace(/[ \t]+/g, " ").toLowerCase();
  return catCau(n).filter(cauNoiTrinhBod);
}

/** DẤU HIỆU DUY NHẤT để đưa dự án vào bộ lọc "Cần cập nhật MP" (PMO chốt 31/07/2026: quét
 *  vướng mắc CẤP DỰ ÁN). parser.noteSaysTrinhBodBitrix gọi thẳng vào đây. */
export function noteCanTrinhBodBitrix(note: string): boolean {
  return cacCauTrinhBod(note).length > 0;
}

/** Xếp loại một ngày theo CHỮ DẪN đứng ngay trước nó. */
function loaiNgay(truocDo: string): "han" | "khoang" | "khong" {
  const g = truocDo.replace(/[\s([\-–—:,"']+$/, "");
  // "đến NGÀY 30/12": bỏ chữ đệm "ngày" rồi xét lại, nếu không thì "ngày" che mất chữ "đến".
  const goc = g.replace(/\bngay$/, "").replace(/[\s]+$/, "");
  if (TU_KHOANG.test(goc)) return "khoang";
  if (TU_HAN.test(g)) return "han";
  return "khong";
}

const hopLe = (d: number, mo: number) => mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
const p2 = (n: number) => String(n).padStart(2, "0");

/** Đọc hạn TRONG MỘT CÂU đã biết là câu trình BOD. Chỉ nhận ngày nằm SAU chỗ bắt đầu nói
 *  chuyện trình BOD, có chữ dẫn hạn, và không phải ngày của cụm dời tiến độ. */
function hanTrongCau(cau: string): [number, number, number | null] | null {
  const moc = Math.min(
    ...[cau.search(CO_TRINH), cau.search(CO_BOD), cau.search(CO_BITRIX)].filter((i) => i >= 0),
  );
  NGAY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NGAY.exec(cau)) !== null) {
    if (m.index < moc) continue;
    if (loaiNgay(cau.slice(Math.max(0, m.index - 40), m.index)) !== "han") continue;
    const d = +m[1], mo = +m[2];
    if (!hopLe(d, mo)) continue;
    return [d, mo, m[3] ? +m[3] : null];
  }
  return null;
}

/**
 * Đọc deadline (ISO yyyy-mm-dd) từ ghi chú.
 * @param note   ghi chú vướng mắc cấp dự án (có thể gộp nhiều tin).
 * @param homNay ISO "yyyy-mm-dd" để chọn năm khi câu chỉ ghi dd/mm.
 * @returns null khi câu không nói tới deadline. KHÔNG tự bịa ngày.
 */
export function parseMpDeadlineIso(note: string, homNay: string): string | null {
  const cau = cacCauTrinhBod(note);
  if (cau.length === 0) return null;

  // Đi từ CÂU CUỐI về trước: ô gộp nhiều tin thì tin mới nhất có hiệu lực. Câu mới nhất chưa
  // điền hạn ("trước ......") thì lùi về câu trước đó, thà lấy hạn cũ hơn là để trống.
  for (let i = cau.length - 1; i >= 0; i--) {
    const h = hanTrongCau(cau[i]);
    if (!h) continue;
    const [d, mo, yRaw] = h;
    let y = yRaw;
    if (y != null && y < 100) y += 2000;
    if (y == null) y = namGanNhat(d, mo, homNay);
    return `${y}-${p2(mo)}-${p2(d)}`;
  }
  return null;
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

/**
 * ĐÃ QUÁ HẠN TRÌNH BOD BAO NHIÊU NGÀY — số nguyên, âm nghĩa là còn hạn.
 *
 * Tính THẲNG theo ngày, KHÔNG mượn con số "số tuần quá hạn" đang dùng để trừ điểm. Con số kia
 * làm tròn LÊN theo tuần (`ceil`), nên "2 tuần" của nó thật ra là 8–14 ngày — lệch hẳn với cách
 * người ta đọc chữ "quá 2 tuần". Trừ điểm thì làm tròn lên là đúng (trễ 1 ngày cũng mất 10 điểm),
 * còn tô màu cảnh báo thì phải đúng nghĩa đen, nếu không PM bị bôi đỏ oan 6 ngày.
 */
export function soNgayQuaHanBod(dlIso: string, homNay: string): number {
  const t = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((t(homNay) - t(dlIso)) / 86400000);
}

/**
 * QUÁ 2 TUẦN CHƯA TRÌNH → ô hạn tô ĐỎ (anh Tiến chốt 05/10/2026).
 *
 * "Quá 2 tuần" đọc đúng nghĩa đen: VƯỢT 14 ngày, tức ngày thứ 15 mới đỏ. Đúng 14 ngày là vừa tròn
 * hai tuần, chưa "quá".
 */
export const QUA_HAN_DO_NGAY = 14;
export function doViQuaHanBod(dlIso: string | null | undefined, homNay: string): boolean {
  if (!dlIso) return false;
  return soNgayQuaHanBod(dlIso, homNay) > QUA_HAN_DO_NGAY;
}
