/**
 * GHI CHÚ MẤT ĐỊA CHỈ — tìm lại dòng đúng cho những ghi chú không còn hiện ở đâu.
 *
 * PHÂN BIỆT HAI CHUYỆN KHÁC NHAU:
 *   · TRÔI  — khoá vẫn khớp một dòng, nhưng là dòng SAI. Ghi chú vẫn hiện, chỉ đứng nhầm chỗ.
 *   · MẤT   — khoá không khớp dòng nào. Ghi chú KHÔNG hiện ở đâu cả, người nhập tưởng bị xoá.
 *
 * Công cụ dữ liệu đời trước chỉ soi loại TRÔI, nên đúng thứ mọi người kêu mất thì không có trong
 * danh sách nào — sửa mò hoặc chịu. Hàm này lo loại MẤT.
 *
 * Xảy ra khi: nguồn đánh lại STT, ô RID bị xoá trắng, hoặc app phải bỏ một RID vì số đó bị nhiều
 * dòng dùng chung (xem parser.ts · ridOf).
 *
 * CÁCH TÌM LẠI: mỗi ghi chú mang sẵn DANH TÍNH của dòng lúc viết (ItemEdit.dc — mã CT ‖ tên dự án ‖
 * giai đoạn ‖ mô tả ‖ RID); chưa có dấu thì lùi về mỏ neo. So danh tính đó với danh tính HIỆN TẠI
 * của mọi dòng để ra đích.
 *
 * BA LUẬT AN TOÀN — thà để người quyết còn hơn đặt nhầm:
 *   1. Danh tính ứng với NHIỀU dòng → không đoán.
 *   2. Đích đang giữ ghi chú của DÒNG KHÁC (danh tính khác) → không trộn, vì trộn xong là hai dự án
 *      lẫn vào nhau và không gỡ ra được nữa.
 *   3. Không có danh tính lẫn mỏ neo → chịu, nói thẳng là chịu.
 * Đích đang giữ ghi chú CÙNG DÒNG thì gộp được: một ô ghi chú vốn là danh sách nhiều tin.
 */

/** Một ghi chú đang không nằm ở dòng nào, kèm đích tìm lại được (hoặc lý do chưa được). */
export type NoteLac = {
  /** Khoá hiện tại của ghi chú trong kho. */
  key: string;
  /** Trích đoạn nội dung, để người xem nhận ra đó là ghi chú nào. */
  text: string;
  /** Danh tính dòng mà ghi chú này thuộc về (chuỗi 4 phần). */
  danhTinh: string;
  /** Khoá dòng sẽ đưa về — null nghĩa là chưa đưa về tự động được. */
  dich: string | null;
  /** Đích đang có sẵn ghi chú (cùng dòng) → sẽ NỐI THÊM chứ không đè. */
  canGop: boolean;
  /** Vì sao chưa đưa về được ("" khi đưa về được). */
  vuong: string;
};

export type NguonLac = {
  /** Kho ghi chú: khoá → { dc?, có chữ hay không }. */
  edits: Record<string, { dc?: string }>;
  /** Ghi chú ở khoá này có chữ hiển thị được không (tin đã ẩn không tính). */
  coChu: (key: string) => boolean;
  /** Trích đoạn nội dung của một khoá. */
  trichDoan: (key: string) => string;
  /** Mỏ neo đã lưu: khoá → danh tính lúc ghi baseline. */
  neo: Record<string, string>;
  /** Danh tính HIỆN TẠI của mọi dòng trong nguồn: khoá → danh tính. */
  nay: Record<string, string>;
};

/** Lấy 4 phần đầu của chuỗi danh tính (bỏ phần RID) — hai kho ghi khác độ dài vẫn so được với nhau. */
export function dinh4(s?: string): string {
  return s ? s.split("||").slice(0, 4).join("||") : "";
}

/** Danh tính rút về 4 trường đầu, BỎ các trường RỖNG Ở ĐUÔI.
 *
 *  Hai kho ghi danh tính khác độ dài ở CẤP DỰ ÁN: mỏ neo ghi "mã‖tên‖__DUAN__" (3 trường), còn dấu
 *  dc ghi "mã‖tên‖__DUAN__‖‖RID" — cắt 4 trường ra thì còn một trường rỗng ở đuôi. So thẳng hai
 *  chuỗi đó là LỆCH GIẢ. Mà lệch giả ở chỗ này không vô hại: nó chặn nhầm mọi lượt đóng dấu cấp
 *  dự án, và chặn im lặng. */
export function goi4(s?: string): string {
  const p = String(s ?? "").split("||").slice(0, 4);
  while (p.length && p[p.length - 1] === "") p.pop();
  return p.join("||");
}

/** Mỏ neo có NÓI KHÁC dấu mới không?
 *
 *  Dùng để quyết định có cho phép ghi đè `ItemEdit.dc` hay không. Mỏ neo ghi MỘT LẦN rồi giữ, nên
 *  nó là lời khai gốc "note này sinh ra ở dòng nào"; còn dc thì bị viết lại theo DÒNG ĐANG HIỂN
 *  THỊ. Ghi chú đang đứng nhầm dòng mà cứ đè thì mỗi lần admin mở app là bằng chứng cuối cùng bị
 *  xoá, sau đó không còn đường nào tra về đúng chỗ.
 *
 *  KHÔNG có mỏ neo thì KHÔNG cản — ô thiếu dấu vẫn phải được điền, đó là việc chính của việc đóng dấu. */
export function soKhac(neo: string | undefined, dc: string): boolean {
  const a = goi4(neo);
  if (!a) return false;
  return a !== goi4(dc);
}

export function timNoteLac(n: NguonLac): NoteLac[] {
  // danh tính → mọi khoá dòng đang mang danh tính đó
  const theoDanhTinh = new Map<string, string[]>();
  for (const [k, v] of Object.entries(n.nay)) {
    const a = theoDanhTinh.get(v) ?? [];
    a.push(k);
    theoDanhTinh.set(v, a);
  }

  const out: NoteLac[] = [];
  for (const k of Object.keys(n.edits)) {
    if (!n.coChu(k)) continue;
    if (n.nay[k]) continue;                     // khoá còn khớp một dòng → thuộc diện TRÔI, không phải MẤT
    const dt = dinh4(n.edits[k].dc) || n.neo[k] || "";
    const ds = dt ? theoDanhTinh.get(dt) : undefined;
    let dich: string | null = null;
    let vuong = "";
    if (!dt) {
      vuong = "Ghi chú này chưa có dấu danh tính (viết từ trước khi app đóng dấu) — không tra ngược được.";
    } else if (!ds) {
      vuong = "Dòng cũ không còn trong nguồn (đã xoá hoặc đang tắt Show).";
    } else if (ds.length > 1) {
      vuong = `Danh tính này đang ứng với ${ds.length} dòng — chọn tay để khỏi đặt nhầm.`;
    } else {
      const d = ds[0];
      const dtDich = dinh4(n.edits[d]?.dc) || n.neo[d] || "";
      if (n.coChu(d) && dtDich && dtDich !== dt) vuong = "Ô đích đang giữ ghi chú của dòng khác — phải xử lý ô đó trước.";
      else dich = d;
    }
    out.push({ key: k, text: n.trichDoan(k), danhTinh: dt, dich, canGop: !!dich && n.coChu(dich), vuong });
  }
  // Đưa về được xếp lên trước — người dùng xử lý một lượt rồi mới tới phần phải quyết tay.
  return out.sort((a, b) => (a.dich ? 0 : 1) - (b.dich ? 0 : 1));
}
