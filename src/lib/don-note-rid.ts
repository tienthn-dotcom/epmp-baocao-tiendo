/**
 * DỌN GHI CHÚ VỀ ĐỊA CHỈ RID — đưa từng ô ghi chú về đúng dòng của nó, dùng RID làm địa chỉ.
 *
 * VÌ SAO BÂY GIỜ MỚI LÀM ĐƯỢC: RID trong file nguồn vốn có 159 số bị nhiều dòng dùng chung, nên app
 * phải bỏ RID của 360 dòng và lùi về `id:<STT>` — một khoá KHÔNG gắn với dự án nào. Ngày 05/10/2026
 * PMO sửa sạch: 0 số trùng, 1191/1194 dòng hạng mục có RID riêng. Từ đó mỗi dòng mới thực sự có một
 * địa chỉ bền, và việc dời ghi chú về đó mới có nghĩa.
 *
 * ĐIỀU QUAN TRỌNG NHẤT: sửa RID ở file nguồn KHÔNG tự kéo ghi chú về. Chúng vẫn nằm ở địa chỉ
 * `id:<STT>` trong kho, và hàm chọn khoá vẫn bám vào đó. Đo 05/10: 34 ghi chú đang hiện ở dòng của
 * một DỰ ÁN KHÁC với dự án ghi trên dấu. Dọn là việc riêng, phải làm tay.
 *
 * BẰNG CHỨNG, theo thứ tự tin cậy:
 *   1. MỎ NEO (`noteanchor:v1`) — ghi LẦN ĐẦU rồi giữ, không bao giờ bị đè. Chắc nhất.
 *   2. DẤU dc trong chính ô — bị ghi đè theo DÒNG ĐANG HIỂN THỊ mỗi lần admin mở app, nên ghi chú
 *      đã trôi thì dấu đã bị viết lại theo dòng sai. Chỉ dùng khi không có mỏ neo.
 *      (Từ 05/10 việc đè đã bị chặn khi mâu thuẫn mỏ neo — xem soKhac trong note-lac.ts.)
 *   3. Chính cái khoá, nếu nó là khoá composite đời cũ có sẵn mã CT + tên dự án.
 *
 * BA LUẬT AN TOÀN, giống hệt note-lac.ts — thà để người quyết còn hơn đặt nhầm:
 *   · bằng chứng ứng NHIỀU dòng   → không đoán;
 *   · không ứng dòng nào          → không đoán;
 *   · không có bằng chứng         → nói thẳng là chịu.
 * Đích đang có ghi chú của CÙNG dòng thì gộp được: một ô vốn là danh sách nhiều tin.
 */
import { goi4 } from "@/lib/note-lac";

/** Một dòng trong file nguồn, rút gọn còn đúng thứ cần để dò. */
export type DongNguon = {
  /** Khoá ƯU TIÊN của dòng = đích dời về (thường `rid:<số>`). */
  dich: string;
  /** Danh tính 4 trường: `mã CT‖tên dự án‖giai đoạn‖mô tả`. Dựng Y HỆT mỏ neo và dấu dc. */
  danhTinh: string;
  /** Nhãn cho người đọc: "CT26-041 · APEC_S3_Public · Shop drawing". */
  nhan: string;
};

/** Một ô ghi chú cần dọn, kèm đích tìm được (hoặc lý do chưa được). */
export type ODon = {
  /** Khoá hiện tại của ô trong kho. */
  key: string;
  /** Trích đoạn nội dung, để người xem nhận ra ô nào. */
  text: string;
  /** Khoá sẽ dời về — null nghĩa là chưa dời tự động được. */
  dich: string | null;
  /** Nhãn dòng đích (rỗng khi chưa có đích). */
  nhanDich: string;
  /** Bằng chứng dùng để tra ra đích. */
  nguon: "mỏ neo" | "dấu trong ô" | "khoá cũ" | "";
  /** Đích VỐN đã có ghi chú từ trước lượt dọn này. */
  dichDaCo: boolean;
  /** Ô này sẽ là một phần của lượt gộp — vì đích đã có sẵn tin, HOẶC vì có ô khác trong cùng lô
   *  cũng dời về đúng dòng đó. Dùng để ghi chú trên từng dòng, KHÔNG dùng để đếm (xem demDon). */
  canGop: boolean;
  /** Vì sao chưa dời được ("" khi dời được). */
  vuong: string;
};

export type NguonDon = {
  /** Mọi dòng hạng mục + dòng dự án đang hiện trong nguồn. */
  dong: readonly DongNguon[];
  /** Kho ghi chú: khoá → { dc? }. */
  edits: Readonly<Record<string, { dc?: string }>>;
  /** Mỏ neo đã lưu: khoá → danh tính lúc ghi lần đầu. */
  neo: Readonly<Record<string, string>>;
  /** Ô này có chữ hiển thị được không (tin đã ẩn không tính). */
  coChu: (key: string) => boolean;
  /** Trích đoạn nội dung của một ô. */
  trichDoan: (key: string) => string;
};

/** Danh tính rút từ KHOÁ composite đời cũ (`mã\0tên\0giai đoạn\0dupIdx`). Khoá khác → "". */
function tuKhoa(key: string): string {
  if (!key.includes("\u0000")) return "";
  const p = key.split("\u0000");
  // Phần tử cuối của khoá composite là dupIdx (số), không phải mô tả — bỏ đi.
  return goi4([p[0] ?? "", p[1] ?? "", p[2] ?? ""].join("||"));
}

export function donNoteVeRid(n: NguonDon): ODon[] {
  // danh tính → các dòng mang danh tính đó
  const theoDanhTinh = new Map<string, DongNguon[]>();
  // mọi khoá ứng viên → dòng (để biết ô hiện tại đang thuộc dòng nào, và biết ô đã đúng chỗ chưa)
  const dichDung = new Set<string>();
  for (const d of n.dong) {
    const dt = goi4(d.danhTinh);
    const a = theoDanhTinh.get(dt) ?? [];
    a.push(d);
    theoDanhTinh.set(dt, a);
    dichDung.add(d.dich);
  }

  const ra: ODon[] = [];
  for (const key of Object.keys(n.edits)) {
    if (!n.coChu(key)) continue;
    if (dichDung.has(key)) continue;          // đã nằm đúng khoá ưu tiên của một dòng → khỏi đụng

    const neo = n.neo[key];
    const dc = n.edits[key]?.dc;
    let dt = "", nguon: ODon["nguon"] = "";
    if (neo) { dt = goi4(neo); nguon = "mỏ neo"; }
    else if (dc) { dt = goi4(dc); nguon = "dấu trong ô"; }
    else { const k = tuKhoa(key); if (k) { dt = k; nguon = "khoá cũ"; } }

    const o: ODon = { key, text: n.trichDoan(key), dich: null, nhanDich: "", nguon, dichDaCo: false, canGop: false, vuong: "" };
    if (!dt) {
      o.vuong = "Ô này không có mỏ neo lẫn dấu danh tính — không tra ngược được, phải chọn tay.";
      ra.push(o); continue;
    }
    const ds = theoDanhTinh.get(dt);
    if (!ds || !ds.length) {
      o.vuong = "Dòng cũ không còn trong nguồn (đã xoá, đổi tên, hoặc đang tắt Show).";
      ra.push(o); continue;
    }
    if (ds.length > 1) {
      o.vuong = `Danh tính này đang ứng với ${ds.length} dòng — chọn tay để khỏi đặt nhầm.`;
      ra.push(o); continue;
    }
    const d = ds[0];
    if (d.dich === key) continue;             // đã đúng chỗ rồi
    o.dich = d.dich;
    o.nhanDich = d.nhan;
    // Đích có SẴN ghi chú là một kiểu gộp. Kiểu thứ hai dễ sót: HAI ô nguồn khác nhau cùng trỏ về
    // một dòng — xảy ra khi một dòng từng mang ghi chú dưới hai dạng khoá đời khác nhau. Đo thật
    // 05/10: giao diện báo 8 ô gộp, chạy xong thực tế 20 ô. Đếm thiếu thì người bấm bị bất ngờ.
    o.dichDaCo = n.coChu(d.dich);
    o.canGop = o.dichDaCo;
    ra.push(o);
  }

  // Ô nào có BẠN cùng đích thì cũng là gộp.
  const demDich = new Map<string, number>();
  for (const x of ra) if (x.dich) demDich.set(x.dich, (demDich.get(x.dich) ?? 0) + 1);
  for (const x of ra) if (x.dich && (demDich.get(x.dich) ?? 0) > 1) x.canGop = true;

  // Dời được xếp lên trước — người dùng xử lý một lượt rồi mới tới phần phải quyết tay.
  return ra.sort((a, b) => (a.dich ? 0 : 1) - (b.dich ? 0 : 1) || a.key.localeCompare(b.key, "vi"));
}

/** Gom số liệu cho dòng tổng quan trên bảng.
 *
 *  `soOBiGop` = SỐ Ô SẼ BIẾN MẤT vì nội dung của nó nối vào ô khác, KHÔNG phải số ô "dính tới việc
 *  gộp". Hai ô cùng dời về một dòng trống thì chỉ có MỘT lần gộp, không phải hai. Đếm nhầm kiểu đó
 *  ra 29 trong khi chạy thật chỉ 20 — con số trên nút phải khớp cái xảy ra sau khi bấm. */
export function demDon(ds: readonly ODon[]) {
  const doiDuoc = ds.filter((x) => x.dich);
  const theoDich = new Map<string, ODon[]>();
  for (const x of doiDuoc) { const a = theoDich.get(x.dich!) ?? []; a.push(x); theoDich.set(x.dich!, a); }
  let soOBiGop = 0;
  for (const [, a] of theoDich) {
    // Đích ĐÃ CÓ sẵn tin  → cả `a.length` ô nguồn đều nối vào, cả `a.length` ô biến mất.
    // Đích đang TRỐNG     → ô đầu chiếm chỗ, `a.length - 1` ô còn lại nối vào.
    soOBiGop += a[0].dichDaCo ? a.length : a.length - 1;
  }
  return {
    tong: ds.length,
    doiDuoc: doiDuoc.length,
    soOBiGop,
    canGop: doiDuoc.filter((x) => x.canGop).length,
    chonTay: ds.length - doiDuoc.length,
    theoNguon: {
      moNeo: doiDuoc.filter((x) => x.nguon === "mỏ neo").length,
      dauTrongO: doiDuoc.filter((x) => x.nguon === "dấu trong ô").length,
      khoaCu: doiDuoc.filter((x) => x.nguon === "khoá cũ").length,
    },
  };
}
