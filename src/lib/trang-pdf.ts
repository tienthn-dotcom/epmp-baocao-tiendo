/**
 * DÁN NHIỀU TRANG MỘT LƯỢT cho popup ma trận (MTLĐ).
 *
 * Anh Tiến 01/10/2026: *"tôi muốn xem 1A, 1B,.... thì tôi nhập 1A rồi chọn vùng, xong thêm trang,
 * cái nhập 1B rồi chọn vùng, thì chiếu ra y vậy, mà cho add 1 lượt nhiều trang là oke"*.
 *
 * Gắn từng trang một thì đúng nhưng chậm: một ma trận hay có 1A, 1B, 2A, 2B… Nên có thêm ô dán
 * nhiều dòng, mỗi dòng một trang. Module THUẦN để test được — chỗ này dễ sai âm thầm: đọc hụt một
 * dòng là thiếu hẳn một trang trong bản xuất mà không ai thấy báo lỗi.
 */

/** Một trang người dùng nhập: tab (sheet) và/hoặc vùng A1. `ten` là nhãn hiện trên đầu trang.
 *
 *  `gid` là ID TAB phía Google. Bắt buộc có thì popup mới đổi được tab: đo 02/10/2026, đường xuất
 *  PDF bỏ qua cả `range=Tab!A1:L40` lẫn `sheet=Tab` và trả về CẢ FILE, chỉ `gid` mới cắt đúng tab.
 *  App tự tra gid theo tên tab (listTabGids), người nhập vẫn chọn theo tên. */
export type TrangNhap = { ten?: string; sheet?: string; gid?: string; range?: string };

/** Vùng kiểu A1: "A1", "B2:M45", "AA10:AC300". KHÔNG nhận chuỗi có tên sheet (phần đó tách riêng). */
const LA_VUNG = /^[A-Za-z]{1,3}\d{1,7}(?::[A-Za-z]{1,3}\d{1,7})?$/;

export function laVungA1(s: string): boolean {
  return LA_VUNG.test((s || "").trim());
}

/**
 * Đọc ô dán nhiều dòng → danh sách trang. Mỗi DÒNG là một trang.
 *
 * Nhận cả bốn kiểu người ta hay gõ:
 *   "1A | B2:M45"      → tab 1A, vùng B2:M45
 *   "1A B2:M45"        → tab 1A, vùng B2:M45   (tách bằng khoảng trắng)
 *   "1A,B2:M45"        → tab 1A, vùng B2:M45
 *   "1A"               → tab 1A, xem cả tab
 *   "B2:M45"           → cùng tab với trang đầu, chỉ đổi vùng
 * Dòng có dấu `|` thì cột thứ ba (nếu có) là NHÃN hiện trên đầu trang.
 *
 * Tên tab CÓ THỂ chứa khoảng trắng ("Phòng 1A B2:M45"), nên không thể cứ cắt theo khoảng trắng
 * đầu tiên: phải tìm ô NÀO là vùng A1 rồi phần còn lại mới là tên tab.
 */
export function docNhieuTrang(text: string): TrangNhap[] {
  const ra: TrangNhap[] = [];
  for (const dongTho of (text || "").split(/\r?\n/)) {
    const dong = dongTho.trim();
    if (!dong) continue;

    if (dong.includes("|")) {
      const o = dong.split("|").map((x) => x.trim());
      const t: TrangNhap = {};
      // Cột 1 có thể là tab HOẶC là vùng (dòng chỉ đổi vùng).
      if (o[0] && laVungA1(o[0]) && !o[1]) t.range = o[0];
      else {
        if (o[0]) t.sheet = o[0];
        if (o[1]) t.range = o[1];
      }
      if (o[2]) t.ten = o[2];
      if (t.sheet || t.range) ra.push(t);
      continue;
    }

    // Không có `|` → tách theo dấu phẩy / chấm phẩy / khoảng trắng, rồi dò ô nào là vùng A1.
    const o = dong.split(/[,;]+|\s+/).map((x) => x.trim()).filter(Boolean);
    const iVung = o.findIndex((x) => laVungA1(x));
    if (iVung < 0) { ra.push({ sheet: dong }); continue; }        // cả dòng là tên tab
    const range = o[iVung];
    const sheet = o.filter((_, i) => i !== iVung).join(" ").trim();
    ra.push({ ...(sheet ? { sheet } : {}), range });
  }
  return ra;
}

/** Nhãn hiện trên đầu một trang. Thứ tự: nhãn người dùng đặt → tên tab → vùng → "Trang N". */
export function nhanTrang(t: TrangNhap, thuTu: number): string {
  return (t.ten || "").trim() || (t.sheet || "").trim() || (t.range || "").trim() || `Trang ${thuTu}`;
}
