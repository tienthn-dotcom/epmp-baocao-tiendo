/**
 * NHẬT KÝ GIÁM SÁT — ai XEM / THAO TÁC gì, lúc nào.
 *
 * Đây là phần LOGIC THUẦN (không đụng mạng/lưu trữ) để test được độc lập:
 *   • ai là "admin giám sát" (isAdminEmail)
 *   • nhãn tiếng Việt cho từng loại thao tác (actionLabel)
 *
 * Bối cảnh: app đã bắt đăng nhập Google (mỗi request đều biết email). Nhật ký này là
 * MỘT CẤP GIÁM SÁT: người thường dùng app bình thường; CHỈ tài khoản trong danh sách
 * admin mới thấy nút và đọc được log. Chặn 2 lớp — ẩn nút Ở CLIENT và kiểm quyền Ở
 * SERVER (xem activity.functions.ts) — để người rành kỹ thuật không gọi thẳng API lấy dữ liệu.
 */

/** Khoá KV chứa danh sách email admin. Sửa danh sách KHÔNG cần deploy lại (giống auth:allow:v1). */
export const ADMIN_KEY = "auth:admin:v1";

/** Mặc định khi KV chưa seed — để tính năng chạy được NGAY sau deploy, chưa cần đụng KV.
 *  Seed KV `auth:admin:v1` sẽ GHI ĐÈ danh sách này (thêm/bớt người mà không deploy). */
export const DEFAULT_ADMINS = ["liemnt1@aacorporation.com", "tienthn@aacorporation.com"];

export function normEmail(e: string | null | undefined): string {
  return (e ?? "").trim().toLowerCase();
}

/** Có phải admin giám sát không. `admins` = danh sách đọc từ KV (null/rỗng ⇒ dùng mặc định). */
export function isAdminEmail(email: string | null | undefined, admins: string[] | null | undefined): boolean {
  const e = normEmail(email);
  if (!e) return false;
  const list = (admins && admins.length ? admins : DEFAULT_ADMINS).map(normEmail).filter(Boolean);
  return list.includes(e);
}

/** Một dòng nhật ký. `detail` = ngữ cảnh phụ (route/tên dự án/số lượng…). */
export type ActivityRow = {
  ts: string;              // ISO timestamp
  email: string;
  action: string;
  detail?: string | null;
};

/** Nhãn tiếng Việt cho từng loại thao tác — hiện trong bảng giám sát. */
export const ACTION_LABEL: Record<string, string> = {
  view: "Mở app",
  open_compliance: "Xem đánh giá tuân thủ",
  open_criteria: "Xem tiêu chí cảnh báo",
  open_activity: "Xem nhật ký giám sát",
  export_pdf: "Xuất PDF",
  export_excel: "Xuất Excel",
  save_edit: "Sửa dữ liệu (vướng mắc/PIC/deadline)",
  change_source: "Đổi nguồn dữ liệu",
  switch_view: "Chuyển cách xem bảng",
};

export function actionLabel(a: string): string {
  return ACTION_LABEL[a] ?? a;
}
