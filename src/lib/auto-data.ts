/**
 * ĐỌC TAB "AutoData" CỦA FILE TUÂN THỦ — NGÀY UPDATE CỦA TỪNG DỰ ÁN.
 *
 * Anh Tiến chốt 01/10/2026: *"số bên sheet nguồn có sẵn rồi, cứ bê từ bên đó qua là xong, đừng có
 * tự chế rule"* và *"ta set up từ đầu là lấy data từ file nguồn mà"*.
 *
 * VÌ SAO CẦN: app tự ghi lịch sử ngày cập nhật (`updates:v1`) từ file PMP nó đọc, mà file đó đi
 * sau. Đo sáng 01/10/2026:
 *     lịch sử của app   : ngày mới nhất là 24/09
 *     AutoData file nguồn: 50 dự án ghi 30/09, 14 dự án ghi 29/09
 * Cả 29/09 (thứ 3) lẫn 30/09 (thứ 4) đều là ĐÚNG HẠN, nên chấm theo lịch sử của app thì cột tuần
 * 30/09 trống trơn trong khi thực tế 64 dự án đã cập nhật đúng hạn.
 *
 * Nên: ngày update lấy từ ĐÂY, không lấy từ kho của app. Một nguồn, hết lệch.
 *
 * Module THUẦN để test được.
 */

/** Khoá tra = tên dự án đã chuẩn hoá (bỏ dấu, gộp khoảng trắng, chữ thường). */
export type AutoDataMap = Map<string, string>;   // tên chuẩn hoá → ngày ISO "yyyy-mm-dd"

/* DÙNG ĐÚNG BỘ CHUẨN HOÁ TÊN APP ĐÃ CÓ, không tự chế cái thứ hai — tên dự án hai file viết lệch
   nhau là chuyện thường ("Tulip Villa. Vinhomes" / "Tulip Villa Vinhomes", "2C_Phòng" / "2C Phòng").

   ĐO THẬT 01/10/2026, và kết quả KHÁC điều tôi tưởng lúc đầu: đổi sang bộ chuẩn hoá của app
   KHÔNG làm tăng số khớp — vẫn 43/68. Lý do không phải tên lệch mà là AutoData CHƯA PHỦ HẾT:
   nó có 60 dự án, và 25 dự án của app (Park Hyatt Phú Quốc, Holiday Inn Bà Nà, Tulip Villa
   Vinhomes…) KHÔNG có dòng nào trong đó. Tra "hyatt" trong AutoData chỉ ra "hyatt regency ha long".
   Vẫn dùng bộ của app vì một bộ chuẩn hoá cho cả app là đúng, nhưng ĐỪNG tưởng nó chữa được
   chỗ thiếu — dự án không có trong AutoData thì rơi về ngày app tự đọc, y như trước. */
export { normProjName as chuanTen } from "./vung";
import { normProjName as chuanTen } from "./vung";

/** "30/09/2026" → "2026-09-30". Dạng khác → null, KHÔNG đoán. */
export function ngayIso(s: string): string | null {
  const m = (s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = +m[1], mo = +m[2];
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** CSV một dòng → các ô, chịu được ô có dấu ngoặc kép và dấu phẩy bên trong. */
function tachO(dong: string): string[] {
  const ra: string[] = [];
  let o = "", trongNhay = false;
  for (let i = 0; i < dong.length; i++) {
    const c = dong[i];
    if (trongNhay) {
      if (c === '"') { if (dong[i + 1] === '"') { o += '"'; i++; } else trongNhay = false; }
      else o += c;
    } else if (c === '"') trongNhay = true;
    else if (c === ",") { ra.push(o); o = ""; }
    else o += c;
  }
  ra.push(o);
  return ra;
}

/**
 * Đọc CSV của tab AutoData.
 *
 * Dò cột theo TIÊU ĐỀ, không theo vị trí — file nguồn chèn thêm cột là chuyện thường, mà neo
 * theo vị trí thì hôm đó mọi ngày update đọc ra rỗng và không ai biết.
 * Một dự án có nhiều dòng thì giữ NGÀY MỚI NHẤT.
 */
export function docAutoData(csv: string): AutoDataMap {
  const ra: AutoDataMap = new Map();
  const dong = (csv || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((d) => d.trim());
  if (!dong.length) return ra;

  const dau = tachO(dong[0]).map((x) => chuanTen(x));
  const cTen = dau.findIndex((h) => /^ten du an$/.test(h) || /ten du an/.test(h));
  const cNgay = dau.findIndex((h) => /ngay update/.test(h));
  if (cTen < 0 || cNgay < 0) return ra;

  for (let i = 1; i < dong.length; i++) {
    const o = tachO(dong[i]);
    const ten = chuanTen(o[cTen] ?? "");
    const iso = ngayIso(o[cNgay] ?? "");
    if (!ten || !iso) continue;
    const cu = ra.get(ten);
    if (!cu || iso > cu) ra.set(ten, iso);
  }
  return ra;
}

/** URL đọc một tab bất kỳ của file tuân thủ dưới dạng CSV, tra theo TÊN TAB. */
export function urlTab(fileId: string, tenTab: string): string {
  return `https://docs.google.com/spreadsheets/d/${fileId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tenTab)}`;
}
