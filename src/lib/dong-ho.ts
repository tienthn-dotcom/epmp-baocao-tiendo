/**
 * ĐỒNG HỒ ĐO LÚC MỞ APP — ba mốc, một dòng nhật ký, mỗi lượt mở app.
 * ==================================================================
 *
 * VÌ SAO CÓ FILE NÀY: tới 28/09/2026 app **không có một phép đo thời gian nào**
 * (`grep performance.now src/` ra rỗng). Nên mọi con số về lag mà cả đội đang bàn — 28 lượt gọi,
 * 82.442 ms chờ, 14.592 ms cho `listMediaProjects` — đều đo trên **một máy**, máy của người viết
 * kế hoạch, với mạng của máy đó. Không ai biết máy người dùng thật ra sao, và production thì chỉ
 * cho biết tổng CPU/chờ chứ không tách ra được chỗ nào.
 *
 * Cãi nhau về chỗ nào chậm mà không có thước là đoán. File này là cái thước.
 *
 * BA MỐC, tính bằng mili giây kể từ lúc trình duyệt bắt đầu mở trang:
 *   · `trang`  — trang đã dựng xong, người dùng nhìn thấy khung
 *   · `nguon`  — máy chủ trả xong file nguồn (đã đi hết vòng mạng + Drive)
 *   · `doc`    — đọc xong file .xlsx ở máy người dùng, số đã sẵn sàng
 *
 * Hiệu hai mốc liền nhau chính là ba đoạn cần tách: dựng trang · chờ máy chủ · đọc file.
 *
 * ═══ BỐN RÀNG BUỘC, VÀ CHÚNG ĐƯỢC GIỮ Ở ĐÂU ═══════════════════════════════════════════════
 *
 * 1. **KHÔNG BAO GIỜ NÉM LỖI.** Đây là ràng buộc nặng nhất, vì file này chạy ở MỌI lượt mở app.
 *    Một cái đồng hồ làm sập app thì tệ hơn nhiều so với không có đồng hồ.
 *    Cụ thể hơn nữa ở chỗ này: `moc("nguon")` và `moc("doc")` nằm TRONG khối `try` của `queryFn`,
 *    mà khối đó bắt lỗi rồi **rơi sang đường CSV dự phòng**. Nên nếu đồng hồ ném lỗi, hậu quả
 *    không phải "mất số đo" mà là **app âm thầm đổi sang đường tải khác** — đúng loại hỏng im
 *    lặng của L3. Vì thế mọi hàm xuất ra ở đây đều bọc `try/catch` và trả về giá trị an toàn.
 * 2. **KHÔNG ghi lên KV.** File này không biết KV là gì. Nó chỉ dựng một chuỗi; chỗ gọi đẩy vào
 *    `track()` → `recordActivity` → bảng D1 `access_log` sẵn có. D1 free cho 100.000 lượt
 *    ghi/ngày, bảng này đang dùng ~0,65%; trần KV 1.000 lượt/ngày không bị đụng tới.
 * 3. **Không thêm thứ nhận dạng cá nhân nào.** Ở đây chỉ có ba con số. Email do `recordActivity`
 *    tự đọc từ cookie phiên như nó vẫn làm cho mọi dòng nhật ký khác — không thêm gì mới.
 * 4. **Không đổi hành vi người dùng thấy được.** Không dựng gì, không chặn gì, không chờ gì.
 *
 * ═══ MỘT DÒNG MỖI LƯỢT MỞ APP, KHÔNG HƠN ══════════════════════════════════════════════════
 *
 * `chotDongHo()` chỉ trả về chuỗi ĐÚNG MỘT LẦN cho mỗi lượt tải trang, và chỉ khi đủ cả ba mốc.
 * Lượt tải lại dữ liệu (V10 giữ dữ liệu 5 phút, người dùng bấm làm mới, chuyển qua lại giữa các
 * màn hình) chạy lại `queryFn` nhưng **không** sinh thêm dòng nào. Bản demo cũng không sinh dòng
 * nào: hai mốc `nguon`/`doc` chỉ đặt trên đường tải thật.
 *
 * ═══ ĐỌC SỐ RA SAU MỘT NGÀY ═══════════════════════════════════════════════════════════════
 *
 * `detail` là JSON nên SQLite bóc thẳng bằng `json_extract`:
 *
 *   npx wrangler d1 execute pmo-audit --remote --command "
 *     SELECT substr(ts,12,2) gio, COUNT(*) n,
 *            CAST(AVG(json_extract(detail,'\$.trang')) AS INT) trang_tb,
 *            CAST(AVG(json_extract(detail,'\$.nguon')) AS INT) nguon_tb,
 *            CAST(AVG(json_extract(detail,'\$.doc'))   AS INT) doc_tb
 *     FROM access_log WHERE action='do_lag' GROUP BY 1 ORDER BY 1"
 *
 *   -- theo NGƯỜI: đổi `substr(ts,12,2) gio` thành `email`, và GROUP BY email.
 *
 * Muốn xem đuôi xấu nhất chứ không phải trung bình (trung bình giấu mất người khổ nhất):
 *   ... ORDER BY json_extract(detail,'\$.doc') DESC LIMIT 20
 */

/** Tên ba mốc. Đổi tên là đổi khoá JSON trong nhật ký — số cũ và số mới thôi so được với nhau. */
export type MocTen = "trang" | "nguon" | "doc";

/** Phiên bản khuôn `detail`. Đổi khuôn thì tăng số này, đừng lặng lẽ đổi nghĩa khoá cũ. */
const PHIEN_BAN = 1;

/** Mốc đã ghi cho lượt tải trang này. Module-level: mỗi lượt tải trang là một bản mới. */
let cacMoc: Partial<Record<MocTen, number>> = {};
/** Đã chốt (đã trả chuỗi ra) chưa — chặn dòng thứ hai cho cùng một lượt mở app. */
let daChot = false;

/** Đồng hồ của trình duyệt, tính từ lúc bắt đầu mở trang. Không có thì trả null, KHÔNG ném. */
function bayGio(): number | null {
  try {
    if (typeof performance === "undefined") return null;
    const f = performance.now;
    if (typeof f !== "function") return null;
    const t = performance.now();
    return typeof t === "number" && isFinite(t) && t >= 0 ? t : null;
  } catch {
    return null;
  }
}

/**
 * Đặt một mốc. Gọi bao nhiêu lần cũng được — chỉ lần ĐẦU của mỗi mốc được tính, vì cái đáng đo là
 * lần đầu người dùng thấy thứ đó, không phải lần tải lại.
 *
 * KHÔNG BAO GIỜ NÉM. Xem ràng buộc 1 ở đầu file: hàm này nằm trong khối `try` có đường rơi sang
 * CSV, nên nó mà ném thì app đổi đường tải chứ không phải chỉ mất số đo.
 */
export function moc(ten: MocTen): void {
  try {
    if (cacMoc[ten] != null) return;
    const t = bayGio();
    if (t == null) return;
    cacMoc[ten] = Math.round(t);
  } catch {
    /* đồng hồ hỏng thì thôi — tuyệt đối không được vọng ra ngoài */
  }
}

/**
 * Chốt lượt đo: trả về chuỗi `detail` để ghi nhật ký, hoặc `null` khi chưa đủ mốc / đã chốt rồi.
 *
 * Trả `null` là trường hợp BÌNH THƯỜNG, không phải lỗi: bản demo không bao giờ đủ ba mốc, và mọi
 * lượt tải lại dữ liệu sau lượt đầu đều rơi vào "đã chốt".
 *
 * KHÔNG BAO GIỜ NÉM.
 */
export function chotDongHo(): string | null {
  try {
    if (daChot) return null;
    const { trang, nguon, doc } = cacMoc;
    if (trang == null || nguon == null || doc == null) return null;
    daChot = true;
    // Khuôn gọn: `detail` bị chặn 300 ký tự ở `recordActivity`, mà chuỗi này chỉ ~50.
    return JSON.stringify({ v: PHIEN_BAN, trang, nguon, doc });
  } catch {
    return null;
  }
}

/** CHỈ DÙNG CHO BỘ KIỂM — dựng lại trạng thái sạch. Sản phẩm không gọi hàm này. */
export function datLaiDongHo(): void {
  cacMoc = {};
  daChot = false;
}

/** CHỈ DÙNG CHO BỘ KIỂM — đọc các mốc đã ghi. */
export function xemMoc(): Partial<Record<MocTen, number>> {
  return { ...cacMoc };
}
