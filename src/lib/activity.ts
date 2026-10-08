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
  // ── ePMP (Project Master Plan) ──
  view: "Mở app",
  open_app: "Chuyển app",
  open_compliance: "Xem đánh giá tuân thủ",
  open_criteria: "Xem tiêu chí cảnh báo",
  open_activity: "Xem nhật ký giám sát",
  open_source: "Mở cài đặt nguồn dữ liệu",
  open_roles: "Mở phân cấp người dùng",
  open_datatools: "Mở công cụ dữ liệu",
  export_pdf: "Xuất PDF",
  /* Xuat PDF bao cao cua MOT du an — dong nay la CAN CU CHAM tuan thu moi ngay
     (xem src/lib/cham-theo-pdf.ts), khong phai chi de xem nhat ky. */
  export_pdf_duan: "Xuất PDF báo cáo dự án",
  export_excel: "Xuất Excel",
  save_edit: "Sửa dữ liệu (vướng mắc/PIC/deadline)",
  change_source: "Đổi nguồn dữ liệu",
  switch_view: "Chuyển cách xem bảng",
  hide_row: "Ẩn đầu việc",
  unhide_row: "Bỏ ẩn đầu việc",
  fix_drift: "Đưa ghi chú trôi về đúng chỗ",
  remap_shift: "Dời khoá theo STT",
  remap_shift_detail: "Dời khoá theo STT (chi tiết)",
  audit_recover: "Khôi phục từ nhật ký",
  role_change: "Đổi phân cấp người dùng",
  backup_create: "Tạo bản sao lưu",
  backup_restore: "Khôi phục bản sao lưu",
  link_matrix: "Gắn ma trận lắp đặt cho dự án",
  link_matrix_off: "Gỡ ma trận lắp đặt",
  link_pdf: "Gắn tài liệu PDF cho hạng mục",
  view_item_pdf: "Xem tài liệu PDF của hạng mục",
  compliance_form_save: "Lưu form báo cáo tuân thủ",
  compliance_pdf: "Lưu PDF tuân thủ lên Drive",
  matrix_reset_form: "Xoá form ma trận",
  // ── Hình ảnh mỗi ngày (media công trường) ──
  media_open: "Mở kho ảnh/clip của căn",
  media_project: "Xem toàn bộ media dự án",
  media_upload: "Tải ảnh/clip lên",
  // ── DST · Dữ liệu dự án · Trợ lý PMO ──
  dst_source: "Ghim nguồn dữ liệu DST",
  dst_import: "Nạp bảng tiến độ chi tiết mới",
  ds_publish: "Nhập bộ dữ liệu vào kho",
  pmoai_import: "Nạp dữ liệu cho Trợ lý PMO",
  // ── Hiệu suất dự án ──
  perf_import: "Nạp file báo cáo tuần",
  perf_template: "Tải template hiệu suất",
  // ── Ma trận lắp đặt ──
  matrix_save_form: "Lưu form ma trận",
  mtld_open: "Mở ma trận lắp đặt của dự án",
};

export function actionLabel(a: string): string {
  return ACTION_LABEL[a] ?? a;
}
