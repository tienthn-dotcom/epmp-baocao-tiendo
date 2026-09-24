/**
 * ĐẾM LƯỢT GHI KV THEO TỪNG KHO
 * =============================
 * Gói KV free cho 1.000 lượt GHI/ngày, và app đã tràn thật ba ngày liền 09–11/09/2026
 * (1.068 · 1.143 · 1.122 lượt). Tràn là mọi thao tác lưu đều hỏng giữa buổi làm việc.
 *
 * Cloudflare cho biết TỔNG lượt ghi mỗi ngày, nhưng KHÔNG cho biết lượt nào vào kho nào. Vì thế
 * lần truy nguyên 14/09 phải đi đoán từng đường code, mất cả tiếng mà vẫn không chỉ được đích danh.
 * Có bảng này thì lần sau chỉ cần một câu SQL.
 *
 * GHI GÌ: giờ + TÊN KHO (phần trước dấu hai chấm của khoá). KHÔNG ghi khoá đầy đủ — khoá chứa mã
 * dự án / STT, mà đây là bảng ĐẾM chứ không phải nhật ký nội dung.
 *
 * VÌ SAO DÁM GHI D1 MỖI LƯỢT: D1 free cho 100.000 lượt ghi/ngày, ở đây nhiều nhất khoảng 1.000 —
 * tức dùng 1% hạn mức để đổi lấy việc nhìn ra ngay kho nào đang ăn hạn mức.
 *
 * TUYỆT ĐỐI KHÔNG LÀM HỎNG LƯỢT GHI THẬT: đếm hỏng thì im lặng bỏ qua, và đếm luôn chạy SAU khi
 * ghi xong nên nó không thể làm mất dữ liệu của ai.
 *
 * Xem bảng:
 *   npx wrangler d1 execute pmo-audit --remote --command \
 *     "SELECT substr(ts,1,10) ngay, kho, COUNT(*) n FROM kv_write GROUP BY 1,2 ORDER BY 1,3 DESC"
 */

type D1Nhe = {
  prepare(q: string): { bind(...a: unknown[]): { run(): Promise<unknown> }; run(): Promise<unknown> };
};

/** Env của Workers — thử mọi vị trí nitro/TanStack Start có thể đặt nó. */
async function envWorkers(): Promise<Record<string, unknown> | null> {
  try {
    const mod = (await import("@tanstack/react-start/server")) as Record<string, unknown>;
    const getEvent = mod.getEvent as undefined | (() => unknown);
    if (getEvent) {
      const ev = getEvent() as { context?: { cloudflare?: { env?: Record<string, unknown> } } } | undefined;
      const env = ev?.context?.cloudflare?.env;
      if (env) return env;
    }
  } catch { /* không có trong runtime này */ }
  const g = globalThis as unknown as Record<string, unknown>;
  const env = (g.__env__ ?? g.__cf_env__ ?? null) as Record<string, unknown> | null;
  if (env) return env;
  return g.PMO_LOG ? g : null;
}

let banSan = false;

/**
 * BĂM NGẮN NỘI DUNG ĐÃ GHI — để phân biệt "63 payload khác nhau" với "một payload ghi 63 lần".
 *
 * Vì sao cần: kho `mtld` ăn 63 lượt ghi ngày 23/09/2026, tất cả vào ĐÚNG MỘT khoá
 * `mtld:install:list:v2`, dù code đã có lớp chặn `putNeuKhac` (đọc rồi so trước khi ghi). Bảng đếm
 * hiện chỉ ghi TÊN KHO nên không phân biệt được ba khả năng, mà ba khả năng đó dẫn tới ba cách sửa
 * hoàn toàn khác nhau. Plan đã đoán sai HAI lần liên tiếp về đúng con số này; đoán lần thứ ba mà
 * không có số là đúng cách làm ra L10. Có cột băm thì một câu SQL trả lời xong.
 *
 * KHÔNG ghi nguyên payload: trong đó có tên dự án và dữ liệu nội bộ. Đây là bảng ĐẾM, không phải
 * nhật ký nội dung — cùng lý do mà chỗ ghi `kho` phía dưới chỉ lấy phần trước dấu hai chấm.
 *
 * CHỈ BĂM 128 KB ĐẦU, và nhét độ dài thật vào phần băm. Vì hàm này chạy ở MỌI đường ghi KV, kể cả
 * `sfile:` mang cả file .xlsx đã base64 (có bản trên 2MB). Băm trọn mấy bản đó là đốt CPU ở đúng
 * chỗ đã từng chết: trần CPU mỗi lượt Worker khoảng 2.010.000 µs, xem L9. Hai payload trùng cả
 * 128 KB đầu LẪN độ dài mà vẫn khác nhau thì sẽ bị coi là một — chấp nhận, vì thứ đang cần soi là
 * kho `mtld` (danh sách ~85 dự án, độ chục KB), không phải mấy kho file lớn.
 *
 * Băm hỏng → trả chuỗi rỗng. TUYỆT ĐỐI không ném: xem ghi chú đầu file, đếm không bao giờ được
 * phép làm hỏng lượt ghi thật.
 */
const CAT_BAM = 131_072;          // 128 KB
export async function bamNgan(giaTri: string | undefined): Promise<string> {
  if (!giaTri) return "";         // đường `delete` không có nội dung → không có gì để băm
  try {
    const mau = giaTri.length + ":" + (giaTri.length > CAT_BAM ? giaTri.slice(0, CAT_BAM) : giaTri);
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(mau)));
    let s = "";
    for (let i = 0; i < 6; i++) s += d[i].toString(16).padStart(2, "0");
    return s;                     // 12 ký tự hex = 48 bit, thừa sức phân biệt vài chục payload/ngày
  } catch { return ""; }
}

/** Ghi một dòng đếm cho lượt ghi khoá `key`, kèm băm ngắn của `giaTri`. Không bao giờ ném lỗi. */
export async function demGhiKv(key: string, giaTri?: string): Promise<void> {
  try {
    const env = await envWorkers();
    const d1 = env?.PMO_LOG as D1Nhe | undefined;
    if (!d1) return;
    if (!banSan) {
      await d1.prepare(
        "CREATE TABLE IF NOT EXISTS kv_write (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, kho TEXT NOT NULL, bam TEXT)",
      ).run();
      // Bảng đã có sẵn trên production từ trước, CREATE TABLE IF NOT EXISTS sẽ KHÔNG thêm cột cho
      // nó. Phải ALTER riêng, và lần chạy thứ hai trở đi thì câu này báo "duplicate column name" —
      // đúng như mong đợi, nuốt đi.
      try { await d1.prepare("ALTER TABLE kv_write ADD COLUMN bam TEXT").run(); } catch { /* đã có cột */ }
      try { await d1.prepare("CREATE INDEX IF NOT EXISTS idx_kvw_ts ON kv_write(ts)").run(); } catch { /* đã có */ }
      banSan = true;
    }
    const kho = key.split(":")[0] || "?";
    const ts = new Date().toISOString();
    const bam = await bamNgan(giaTri);
    try {
      await d1.prepare("INSERT INTO kv_write (ts, kho, bam) VALUES (?, ?, ?)").bind(ts, kho, bam).run();
    } catch {
      // Cột `bam` chưa có (ALTER hỏng vì lý do nào đó) → LÙI VỀ ghi đúng ba cột như cũ. Thà mất cái
      // băm còn hơn mất cả dòng đếm: bảng này là thứ DUY NHẤT đang soi được hạn mức ghi KV, mất nó
      // là mù hẳn — xem L9, cron chết cả tuần vì không ai đọc log.
      await d1.prepare("INSERT INTO kv_write (ts, kho) VALUES (?, ?)").bind(ts, kho).run();
    }
  } catch { /* đếm hỏng thì thôi — không được ảnh hưởng lượt ghi thật */ }
}
