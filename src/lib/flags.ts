/**
 * CỜ TÍNH NĂNG — tách "hai bản" của app từ MỘT codebase.
 *
 *   • LIVE  = bản CHÍNH THỨC đang go-live (mọi người dùng thật). Chỉ bật tính năng đã chốt.
 *   • DEV   = bản PHÁT TRIỂN (localhost). Bật hết, kể cả tính năng đang làm dở.
 *
 * Nhờ vậy có thể vừa deploy sửa lỗi/nâng cấp phần đã ổn, vừa giữ tính năng đang làm ẩn
 * khỏi bản chính thức cho tới khi xong — không phải maintain hai nhánh code.
 *
 * Nhận diện bản: theo HOSTNAME. localhost = DEV; mọi nơi khác (workers.dev…) = LIVE.
 * Cách này đủ cho quy trình hiện tại (dev ở localhost, go-live ở workers.dev). Sau này
 * nếu cần MỘT URL admin chia sẻ được (không phải localhost), thêm subdomain "admin"/
 * "staging" vào danh sách DEV bên dưới hoặc chuyển sang đọc biến môi trường.
 */

export type Stage = "live" | "dev";

/** SSR (không có window) → mặc định LIVE: an toàn hơn, tính năng dở KHÔNG lỡ hiện ra
 *  trong lần render đầu ở bản chính thức. */
export function detectStage(): Stage {
  if (typeof window === "undefined") return "live";
  const h = window.location.hostname;
  if (h === "localhost" || h === "127.0.0.1") return "dev";
  // Chừa sẵn đường cho một URL admin deploy riêng sau này:
  if (/(^|\.)admin\.|(^|\.)staging\.|-admin\./.test(h)) return "dev";
  return "live";
}

export type FeatureName = "complianceReport" | "ganttChildTasks" | "appShell";

/** Tính năng nào BẬT ở mỗi bản.
 *  Đưa một tính năng lên LIVE: đổi `live: false` → `live: true` ở đúng dòng của nó. */
const MATRIX: Record<FeatureName, Record<Stage, boolean>> = {
  // Đánh giá tuân thủ — 28/07 BẬT LÊN LIVE: bảng đọc thẳng từ file nguồn riêng (✔/o/x có sẵn),
  // app chỉ chấm điểm 3 tiêu chí. Đã duyệt số + bố cục phẳng.
  complianceReport: { dev: true, live: true },
  // Tác vụ con trong Gantt — 28/07 BẬT LÊN LIVE: hiện dòng tiến độ CON (mở rộng dự án) trên
  // bảng "Tổng thể tiến độ".
  ganttChildTasks:  { dev: true, live: true },
  // APP SHELL (thanh dọc trái · multi-app) — đang phát triển, CHỈ hiện ở dev, ẨN trên live
  // để không đụng app đang chạy. Xem lib/app-shell.tsx. Bật lại: đổi live → true.
  appShell:         { dev: true, live: false },
};

export function featureOn(name: FeatureName, stage: Stage): boolean {
  return MATRIX[name][stage];
}
