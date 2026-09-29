/** Xếp bình luận theo nhóm đối tượng — BOD / OCC / PM / Khác. */
import { describe, it, expect } from "vitest";
import { nhomCuaTin, demTheoNhom, lotLoc } from "@/lib/nhom-cmt";
import { MSG_NGUON } from "@/lib/types";
import type { UserRole } from "@/lib/roles";

const ROLES: Record<string, UserRole> = {
  "lectm@aacorporation.com": "BOD",
  "tienthn@aacorporation.com": "PMO",
  "pm1@aacorporation.com": "PM",
};
const tin = (author: string, id = author) => ({ id, author });

describe("nhóm của một bình luận", () => {
  it("vai BOD → nhóm BOD", () => expect(nhomCuaTin(tin("lectm@aacorporation.com"), ROLES)).toBe("BOD"));

  it("vai lưu là PMO nhưng nhóm hiện ra là OCC", () =>
    expect(nhomCuaTin(tin("tienthn@aacorporation.com"), ROLES)).toBe("OCC"));

  it("vai PM → nhóm PM", () => expect(nhomCuaTin(tin("pm1@aacorporation.com"), ROLES)).toBe("PM"));

  it("chưa được phân cấp → Khác", () => {
    expect(nhomCuaTin(tin("ai@aacorporation.com"), ROLES)).toBe("KHAC");
    expect(nhomCuaTin(tin("(cũ)"), ROLES)).toBe("KHAC");
  });

  it("câu của FILE NGUỒN tính là OCC dù không có email", () => {
    expect(nhomCuaTin({ id: MSG_NGUON, author: "" }, ROLES)).toBe("OCC");
  });

  it("hoa thường trong email không làm lệch nhóm", () => {
    expect(nhomCuaTin(tin("LeCTM@AACorporation.com"), ROLES)).toBe("BOD");
  });
});

describe("đếm theo nhóm", () => {
  it("đếm đủ bốn nhóm", () => {
    const d = demTheoNhom(
      [
        tin("lectm@aacorporation.com", "1"),
        tin("tienthn@aacorporation.com", "2"),
        tin("tienthn@aacorporation.com", "3"),
        tin("la@ai.com", "4"),
        { id: MSG_NGUON, author: "" },
      ],
      ROLES,
    );
    expect(d).toEqual({ BOD: 1, OCC: 3, PM: 0, KHAC: 1 });
  });

  it("chưa ai được gán vai PM thì PM ra 0 — đúng thực tế kho roles", () => {
    expect(demTheoNhom([tin("x@y.com")], ROLES).PM).toBe(0);
  });
});

describe("cổng lọc", () => {
  const m = tin("lectm@aacorporation.com");
  it("không chọn nhóm nào → cho qua hết", () => {
    expect(lotLoc(m, ROLES, null)).toBe(true);
    expect(lotLoc(m, ROLES, new Set())).toBe(true);
  });
  it("chọn đúng nhóm thì lọt, chọn nhóm khác thì không", () => {
    expect(lotLoc(m, ROLES, new Set(["BOD" as const]))).toBe(true);
    expect(lotLoc(m, ROLES, new Set(["PM" as const]))).toBe(false);
  });
  it("chọn nhiều nhóm cùng lúc", () => {
    expect(lotLoc(m, ROLES, new Set(["PM" as const, "BOD" as const]))).toBe(true);
  });
});
