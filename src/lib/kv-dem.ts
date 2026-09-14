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

/** Ghi một dòng đếm cho lượt ghi khoá `key`. Không bao giờ ném lỗi. */
export async function demGhiKv(key: string): Promise<void> {
  try {
    const env = await envWorkers();
    const d1 = env?.PMO_LOG as D1Nhe | undefined;
    if (!d1) return;
    if (!banSan) {
      await d1.prepare(
        "CREATE TABLE IF NOT EXISTS kv_write (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, kho TEXT NOT NULL)",
      ).run();
      try { await d1.prepare("CREATE INDEX IF NOT EXISTS idx_kvw_ts ON kv_write(ts)").run(); } catch { /* đã có */ }
      banSan = true;
    }
    const kho = key.split(":")[0] || "?";
    await d1.prepare("INSERT INTO kv_write (ts, kho) VALUES (?, ?)").bind(new Date().toISOString(), kho).run();
  } catch { /* đếm hỏng thì thôi — không được ảnh hưởng lượt ghi thật */ }
}
