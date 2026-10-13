import { normEmail } from "./activity";

/** Cấp bậc (badge màu trước tên trong box chat Vướng mắc/Giải pháp). Sau có thể thêm cấp mới. */
export type UserRole = "PMO" | "OCC" | "BOD" | "PM";
export const ALL_ROLES: UserRole[] = ["PMO", "OCC", "BOD", "PM"];

/* ── HAI VAI ĐIỀU HÀNH, QUYỀN NGANG NHAU ─────────────────────────────────────
   Anh Tiến 13/10/2026: *"PMO và OCC tách ra, chức năng tương đương nhau"*.

   Tách ra để badge gọi đúng tên bộ phận, KHÔNG phải để phân quyền khác nhau. Nên mọi chỗ xét
   quyền phải hỏi qua `laDieuHanh`, đừng so thẳng === "PMO": so thẳng thì thêm một vai mới là
   người bên kia lặng lẽ mất quyền ở đúng màn hình hôm đó không ai mở. */
export const laDieuHanh = (vai: UserRole | null | undefined): boolean => vai === "PMO" || vai === "OCC";

/** SEED ban đầu (dùng khi kho KV `roles:v1` còn TRỐNG). Admin phân cấp trong app sẽ ghi đè hẳn vào
 *  KV — từ đó KV là nguồn sự thật, không cần sửa code để thêm người. Key = email đã normEmail. */
export const DEFAULT_ROLES: Record<string, UserRole> = {
  // ── BOD (Ban lãnh đạo) ──
  "lectm@aacorporation.com": "BOD",
  "thanhnp@aacorporation.com": "BOD",
  /* ── OCC (bộ phận Project Planning; tên cũ là PMO) ──
     Hạt giống này chỉ dùng khi kho KV còn trống. Để "OCC" vì đo kho thật ngày 13/10/2026: cả 11
     người đang mang giá trị "PMO" đều là người bộ phận OCC. */
  "tienthn@aacorporation.com": "OCC",
  "liemnt1@aacorporation.com": "OCC",
  "lanlln@aacorporation.com": "OCC",
  "trangnvt@aacorporation.com": "OCC",
  "thanhpv2@aacorporation.com": "OCC",
};

/**
 * Nhãn + class badge cho từng cấp (một nguồn dùng chung cho badge lẫn dialog phân cấp).
 *
 * ⚠️ KHOÁ LÀ GIÁ TRỊ ĐANG LƯU TRONG KV `roles:v1`, NHÃN LÀ THỨ HIỆN RA. Đổi khoá là đụng dữ
 * liệu thật của app đang chạy, không phải chuyện dọn cho gọn.
 *
 * LỊCH SỬ, ĐỌC TRƯỚC KHI SỬA:
 *  · 28/09/2026 bộ phận đổi tên PMO → OCC. Lúc đó KHÔNG đổi giá trị lưu, chỉ đổi nhãn: khoá
 *    `PMO` hiện chữ "OCC". Một vai, hai tên.
 *  · 13/10/2026 anh Tiến tách hẳn thành HAI vai, quyền ngang nhau. Nên giờ `PMO` và `OCC` là hai
 *    giá trị khác nhau, mỗi cái hiện đúng tên nó.
 *
 * CHUYỂN DỮ LIỆU ĐÃ CHẠY (13/10/2026): 11 người đang mang `"PMO"` trong KV được đổi sang `"OCC"`,
 * vì tới hôm đó họ đều là người bộ phận OCC — giá trị `"PMO"` cũ mang nghĩa OCC chứ không phải
 * PMO. Ai thật sự thuộc PMO thì anh Tiến gán lại bằng màn "Phân cấp người dùng" trong app.
 * Chuyển được mà không sợ gãy quyền là vì hai vai có quyền NGANG NHAU (xem `laDieuHanh`): người
 * bị đổi sai nhóm cũng không mất quyền nào, chỉ sai chữ trên badge.
 */
export const ROLE_META: Record<UserRole, { short: string; label: string; badge: string }> = {
  // PMO VÀ OCC CÙNG MÀU NAVY — anh Tiến chốt 13/10/2026. Phân biệt bằng chữ trên badge chứ không
  // bằng màu: hai bộ phận này cùng một tầng việc, tô hai màu là bày ra một thứ bậc không có thật.
  PMO: { short: "PMO", label: "Bộ phận PMO", badge: "bg-[#1e3a5f] text-white" },
  OCC: { short: "OCC", label: "Bộ phận OCC", badge: "bg-[#1e3a5f] text-white" },
  BOD: { short: "BOD", label: "Ban lãnh đạo (BOD)", badge: "bg-[#C00000] text-[#FFD700]" },
  // PM = Project Manager phụ trách dự án. Xanh mòng két: đứng cạnh navy của PMO/OCC và đỏ của BOD
  // vẫn phân biệt được ngay, kể cả trên badge nhỏ trong box chat.
  PM: { short: "PM", label: "Quản lý dự án (PM)", badge: "bg-[#0f766e] text-white" },
};

/** Tra cấp của 1 email theo BẢNG map cho trước (KV nếu có, else DEFAULT_ROLES). */
export function roleOf(map: Record<string, UserRole>, email: string | null | undefined): UserRole | null {
  const e = normEmail(email);
  return e ? (map[e] ?? null) : null;
}
