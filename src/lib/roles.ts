import { normEmail } from "./activity";

/** Cấp bậc (badge màu trước tên trong box chat Vướng mắc/Giải pháp). Sau có thể thêm cấp mới. */
export type UserRole = "PMO" | "BOD" | "PM";
export const ALL_ROLES: UserRole[] = ["PMO", "BOD", "PM"];

/** SEED ban đầu (dùng khi kho KV `roles:v1` còn TRỐNG). Admin phân cấp trong app sẽ ghi đè hẳn vào
 *  KV — từ đó KV là nguồn sự thật, không cần sửa code để thêm người. Key = email đã normEmail. */
export const DEFAULT_ROLES: Record<string, UserRole> = {
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

/**
 * Nhãn + class badge cho từng cấp (một nguồn dùng chung cho badge lẫn dialog phân cấp).
 *
 * ⚠️ KHOÁ LÀ GIÁ TRỊ ĐANG LƯU, NHÃN LÀ THỨ HIỆN RA — HAI THỨ KHÁC NHAU, ĐỪNG "DỌN CHO NHẤT QUÁN".
 *
 * Bộ phận đổi tên từ PMO sang OCC (28/09/2026), nên `short`/`label` hiện **OCC**. Nhưng khoá của
 * object vẫn là `PMO`, vì đó là **chuỗi đang nằm trong kho KV `roles:v1`** — đọc kho thật ngày
 * 28/09: 10 người mang giá trị `"PMO"`, 4 người mang `"BOD"`.
 *
 * Đổi khoá `PMO` thành `OCC` ở đây (hoặc trong `UserRole` / `ALL_ROLES` / `DEFAULT_ROLES` / cái
 * `z.enum(["PMO","BOD","PM"])` ở `saveUserRole`) sẽ làm `roleOf` so `"PMO"` trong kho với `"OCC"`
 * trong code → không khớp → trả `null` → **10 người mất sạch quyền sửa / ẩn / quản lý ngay lập
 * tức**, trên app đang chạy thật. Muốn đổi giá trị lưu thì phải có bước chuyển dữ liệu trong KV
 * trước, không phải sửa mỗi code.
 */
export const ROLE_META: Record<UserRole, { short: string; label: string; badge: string }> = {
  PMO: { short: "OCC", label: "Bộ phận OCC", badge: "bg-[#1e3a5f] text-white" },
  BOD: { short: "BOD", label: "Ban lãnh đạo (BOD)", badge: "bg-[#C00000] text-[#FFD700]" },
  // PM = Project Manager phụ trách dự án. Xanh mòng két: đứng cạnh navy của PMO và đỏ của BOD vẫn
  // phân biệt được ngay, kể cả trên badge nhỏ trong box chat.
  PM: { short: "PM", label: "Quản lý dự án (PM)", badge: "bg-[#0f766e] text-white" },
};

/** Tra cấp của 1 email theo BẢNG map cho trước (KV nếu có, else DEFAULT_ROLES). */
export function roleOf(map: Record<string, UserRole>, email: string | null | undefined): UserRole | null {
  const e = normEmail(email);
  return e ? (map[e] ?? null) : null;
}
