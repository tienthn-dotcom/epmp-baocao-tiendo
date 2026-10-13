/* PMO VÀ OCC TÁCH LÀM HAI VAI, QUYỀN NGANG NHAU.
 *
 * Anh Tiến 13/10/2026: *"PMO và OCC tách ra, chức năng tương đương nhau, badge PMO cũng là xanh
 * navy đi"*.
 *
 * Đây là phân quyền trên app đang chạy thật, nên hai điều phải có ca kiểm giữ:
 *   · tách vai KHÔNG được làm ai mất quyền — người OCC phải còn nguyên quyền của người PMO;
 *   · badge hai vai cùng màu navy, chỉ khác chữ.
 */
import { describe, expect, it } from "vitest";
import { ALL_ROLES, DEFAULT_ROLES, ROLE_META, laDieuHanh, roleOf, type UserRole } from "@/lib/roles";
import { nhomCuaTin } from "@/lib/nhom-cmt";

describe("hai vai điều hành", () => {
  it("PMO và OCC đều là vai điều hành", () => {
    expect(laDieuHanh("PMO")).toBe(true);
    expect(laDieuHanh("OCC")).toBe(true);
  });
  it("BOD và PM thì không", () => {
    expect(laDieuHanh("BOD")).toBe(false);
    expect(laDieuHanh("PM")).toBe(false);
  });
  it("chưa phân cấp thì không", () => {
    expect(laDieuHanh(null)).toBe(false);
    expect(laDieuHanh(undefined)).toBe(false);
  });
  it("cả hai vai đều nằm trong danh sách chọn của màn phân cấp", () => {
    expect(ALL_ROLES).toContain("PMO");
    expect(ALL_ROLES).toContain("OCC");
    expect(ALL_ROLES).toHaveLength(4);
  });
});

describe("badge", () => {
  it("PMO và OCC CÙNG màu navy", () => {
    expect(ROLE_META.PMO.badge).toBe(ROLE_META.OCC.badge);
    expect(ROLE_META.PMO.badge).toContain("#1e3a5f");
  });
  it("chữ trên badge khác nhau — đó là chỗ phân biệt duy nhất", () => {
    expect(ROLE_META.PMO.short).toBe("PMO");
    expect(ROLE_META.OCC.short).toBe("OCC");
  });
  it("BOD và PM giữ nguyên màu cũ", () => {
    expect(ROLE_META.BOD.badge).toContain("#C00000");
    expect(ROLE_META.PM.badge).toContain("#0f766e");
  });
  it("vai nào cũng có đủ nhãn, không để trống chỗ nào", () => {
    for (const v of ALL_ROLES) {
      expect(ROLE_META[v].short).toBeTruthy();
      expect(ROLE_META[v].label).toBeTruthy();
      expect(ROLE_META[v].badge).toBeTruthy();
    }
  });
});

/* Người bộ phận OCC (giá trị cũ "PMO" đã chuyển sang "OCC" trong KV ngày 13/10) phải còn nguyên
   quyền. Đây đúng là chỗ dễ gãy nhất khi tách vai. */
describe("tách vai không làm ai mất quyền", () => {
  const map: Record<string, UserRole> = { "a@x.com": "OCC", "b@x.com": "PMO", "c@x.com": "PM" };
  it("người OCC vẫn được coi là điều hành", () => expect(laDieuHanh(roleOf(map, "a@x.com"))).toBe(true));
  it("người PMO cũng vậy", () => expect(laDieuHanh(roleOf(map, "b@x.com"))).toBe(true));
  it("người PM thì không", () => expect(laDieuHanh(roleOf(map, "c@x.com"))).toBe(false));
  it("hạt giống mặc định để bộ phận Project Planning ở OCC", () => {
    expect(DEFAULT_ROLES["tienthn@aacorporation.com"]).toBe("OCC");
    expect(Object.values(DEFAULT_ROLES).filter((v) => v === "OCC").length).toBeGreaterThan(0);
  });
});

/* Bộ lọc bình luận chỉ có ba tầng BOD / điều hành / PM — hai vai điều hành chung một nhóm. */
describe("nhóm bình luận", () => {
  const tin = (email: string) => ({ id: "m1", author: email });
  it("bình luận của PMO và của OCC đều vào nhóm OCC", () => {
    const map: Record<string, UserRole> = { "a@x.com": "OCC", "b@x.com": "PMO" };
    expect(nhomCuaTin(tin("a@x.com"), map)).toBe("OCC");
    expect(nhomCuaTin(tin("b@x.com"), map)).toBe("OCC");
  });
  it("BOD và PM vẫn về đúng nhóm của họ", () => {
    const map: Record<string, UserRole> = { "c@x.com": "BOD", "d@x.com": "PM" };
    expect(nhomCuaTin(tin("c@x.com"), map)).toBe("BOD");
    expect(nhomCuaTin(tin("d@x.com"), map)).toBe("PM");
  });
  it("chưa phân cấp → Khác", () => expect(nhomCuaTin(tin("z@x.com"), {})).toBe("KHAC"));
});
