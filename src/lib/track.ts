/**
 * GHI NHẬT KÝ GIÁM SÁT — DÙNG CHUNG CHO MỌI APP CON trong App Shell.
 *
 * Trước đây chỉ ePMP có hàm `track` riêng trong routes/index.tsx, nên nhật ký chỉ thấy hoạt động của
 * một app; người dùng vào Media công trường tải cả trăm clip, vào Hiệu suất nạp file tuần, sửa form ma
 * trận… nhật ký đều không hay biết. Tách ra đây để app nào cũng gọi được đúng một đường.
 *
 * Ghi là việc PHỤ: hỏng thì nuốt lỗi, không bao giờ được chặn thao tác chính của người dùng.
 * `devAs` = ?as=<email> trên URL, chỉ có tác dụng khi chạy dev (server tự bỏ qua trên bản thật).
 */
import { recordActivity } from "@/lib/activity.functions";

function devAs(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("as");
}

export function track(action: string, detail?: string): void {
  void recordActivity({ data: { action, detail: detail ?? null, devAs: devAs() } }).catch(() => {});
}
