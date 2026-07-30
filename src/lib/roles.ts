import { normEmail } from "./activity";

/** Chức vụ hiển thị dưới dạng BADGE màu trước tên người trong box chat Vướng mắc/Giải pháp,
 *  để nhìn ra ai là PMO, ai là BOD. */
export type UserRole = "PMO" | "BOD";

/** Email → chức vụ. TẠM hardcode; sau này thay bằng dữ liệu từ file Excel (email + chức vụ) user gửi.
 *  Key phải là email đã normEmail (thường hoá + trim). */
const ROLE_BY_EMAIL: Record<string, UserRole> = {
  // ── BOD (Ban lãnh đạo) ──
  "lectm@aacorporation.com": "BOD",
  "thanhnp@aacorporation.com": "BOD",
  // ── PMO (Bộ phận Project Planning) ──
  "tienthn@aacorporation.com": "PMO",
  "liemnt1@aacorporation.com": "PMO",
  "lanlln@aacorporation.com": "PMO",
  "trangnvt@aacorporation.com": "PMO",
  "thanhpv2@aacorporation.com": "PMO",
};

/** Trả về chức vụ của email (PMO/BOD) hoặc null nếu không thuộc danh sách. */
export function roleOfEmail(email: string | null | undefined): UserRole | null {
  const e = normEmail(email);
  return e ? (ROLE_BY_EMAIL[e] ?? null) : null;
}
