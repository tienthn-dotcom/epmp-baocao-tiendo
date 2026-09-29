/**
 * XẾP BÌNH LUẬN THEO NHÓM ĐỐI TƯỢNG — BOD / OCC / PM / KHÁC.
 *
 * Sếp đặt hàng 28/09/2026: *"mở ra 1 nút lọc comment, theo nhóm đối tượng - BOD - OCC - PM - Khác"*.
 *
 * NHÓM LẤY TỪ ĐÂU: bảng phân cấp `roles:v1` (cùng bảng vẽ badge trong box chat), tra theo email
 * người gõ. Không đoán theo tên, không đoán theo nội dung câu.
 *
 * HAI CHỖ PHẢI ĐỌC KỸ:
 *
 * 1. GIÁ TRỊ LƯU LÀ "PMO", NHÃN HIỆN RA LÀ "OCC". Kho KV đang giữ chuỗi `"PMO"` cho 10 người; đổi
 *    khoá đó là 10 người mất quyền ngay (xem chú thích dài trong lib/roles.ts). Nên ở đây nhóm
 *    mang tên OCC nhưng tra từ vai `PMO`.
 *
 * 2. CÂU CỦA FILE NGUỒN TÍNH LÀ OCC. Tin mang id MSG_NGUON không có email người gõ — nó là câu bộ
 *    phận OCC viết trong file nguồn, và badge trên bảng cũng đang ghi OCC. Xếp nó vào KHÁC thì lọc
 *    "OCC" lại giấu mất đúng thứ OCC viết.
 *
 * ĐO TRÊN DỮ LIỆU THẬT (28/09/2026, 1.042 bình luận, 13 người gõ):
 *     OCC 909 · Khác 131 (129 là tin cũ mang tên "(cũ)") · BOD 2 · PM 0
 * PM bằng 0 vì kho `roles:v1` CHƯA ai được gán vai PM, chứ không phải PM không gõ gì. Gán vai cho
 * họ trong app là nút PM có số ngay, không cần sửa code.
 */
import type { UserRole } from "./roles";
import { roleOf } from "./roles";
import { MSG_NGUON } from "./types";

export type NhomCmt = "BOD" | "OCC" | "PM" | "KHAC";

/** Thứ tự bày nút. BOD đứng đầu vì đó là thứ người ta soi trước. */
export const NHOM_CMT: readonly NhomCmt[] = ["BOD", "OCC", "PM", "KHAC"] as const;

export const NHAN_NHOM: Record<NhomCmt, string> = { BOD: "BOD", OCC: "OCC", PM: "PM", KHAC: "Khác" };

/** Chấm màu đứng trước tên nhóm trong ô lọc — đúng màu badge của cấp đó trong box chat,
 *  để nhìn cái chấm là biết ngay nhóm nào, không phải đọc chữ. */
export const MAU_CHAM: Record<NhomCmt, string> = {
  BOD: "#C00000",
  OCC: "#1e3a5f",
  PM: "#0f766e",
  KHAC: "#64748b",
};

type TinToiThieu = { id: string; author?: string | null };

/** Nhóm của MỘT bình luận. */
export function nhomCuaTin(m: TinToiThieu, roles: Record<string, UserRole>): NhomCmt {
  if (m.id === MSG_NGUON) return "OCC";
  const vai = roleOf(roles, m.author ?? "");
  if (vai === "BOD") return "BOD";
  if (vai === "PMO") return "OCC";
  if (vai === "PM") return "PM";
  return "KHAC";
}

/** Đếm bình luận theo nhóm. Dùng cho con số trên nút lọc. */
export function demTheoNhom(msgs: TinToiThieu[], roles: Record<string, UserRole>): Record<NhomCmt, number> {
  const d: Record<NhomCmt, number> = { BOD: 0, OCC: 0, PM: 0, KHAC: 0 };
  for (const m of msgs) d[nhomCuaTin(m, roles)]++;
  return d;
}

/** Tin này có lọt bộ lọc đang bật không. `chon` rỗng hoặc null = không lọc, cho qua hết. */
export function lotLoc(m: TinToiThieu, roles: Record<string, UserRole>, chon: ReadonlySet<NhomCmt> | null): boolean {
  if (!chon || chon.size === 0) return true;
  return chon.has(nhomCuaTin(m, roles));
}
