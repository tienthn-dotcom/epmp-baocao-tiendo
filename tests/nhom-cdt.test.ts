/**
 * NHÓM CHỦ ĐẦU TƯ — chỉ hai nhóm: Sun Group và Ngoài Sun Group.
 *
 * Bộ lọc này quyết định dự án nào lọt vào báo cáo, nên luật gom phải đúng tới từng trường hợp biên.
 * Đặc biệt là Ô TRỐNG: xếp bừa vào "Ngoài Sun Group" là bịa ra dữ liệu mình không có.
 */
import { describe, it, expect } from "vitest";

/** Bản sao đúng luật đang chạy trong routes/index.tsx · nhomCdt(). */
const NHOM_SUN = "Sun Group";
const NHOM_NGOAI_SUN = "Ngoài Sun Group";
const nhomCdt = (cdt: string | null | undefined): string => {
  const v = (cdt || "").trim();
  if (!v) return "";
  return /^sg$/i.test(v) ? NHOM_SUN : NHOM_NGOAI_SUN;
};

describe("gom nhóm chủ đầu tư", () => {
  it("SG là Sun Group, không phân biệt hoa thường hay khoảng trắng thừa", () => {
    for (const v of ["SG", "sg", "Sg", " SG ", "  sg"]) expect(nhomCdt(v)).toBe(NHOM_SUN);
  });

  it("mọi mã khác đều là Ngoài Sun Group", () => {
    // OT và BG là hai mã còn lại đang có thật trong nguồn (đo 17/09: SG 61 · OT 14 · BG 7).
    for (const v of ["OT", "BG", "ot", "bg", "VIN", "mã lạ chưa gặp"]) {
      expect(nhomCdt(v)).toBe(NHOM_NGOAI_SUN);
    }
  });

  it("mã LẠ vẫn vào được nhóm Ngoài Sun Group, không rơi ra ngoài", () => {
    // Nguồn thêm chủ đầu tư mới thì bộ lọc phải tự nhận, không phải sửa code.
    expect(nhomCdt("CĐT mới toanh")).toBe(NHOM_NGOAI_SUN);
  });

  it("Ô TRỐNG không thuộc nhóm nào — không được đoán thành Ngoài Sun Group", () => {
    // Chưa ghi CĐT thì ta KHÔNG biết nó ngoài Sun Group hay chỉ bỏ sót. Xếp bừa là bịa dữ liệu.
    for (const v of ["", "   ", null, undefined]) expect(nhomCdt(v)).toBe("");
  });

  it("KHÔNG nhận nhầm mã chỉ vì có chứa chữ sg", () => {
    // "SGC", "BSG" là mã khác hẳn — chỉ đúng hai chữ SG mới là Sun Group.
    for (const v of ["SGC", "BSG", "SG2", "S G"]) expect(nhomCdt(v)).toBe(NHOM_NGOAI_SUN);
  });

  it("chia đúng 82 dự án thật thành 61 + 21", () => {
    const nguon = [
      ...Array(61).fill("SG"),
      ...Array(14).fill("OT"),
      ...Array(7).fill("BG"),
    ];
    const sun = nguon.filter((c) => nhomCdt(c) === NHOM_SUN).length;
    const ngoai = nguon.filter((c) => nhomCdt(c) === NHOM_NGOAI_SUN).length;
    expect([sun, ngoai]).toEqual([61, 21]);
    expect(sun + ngoai).toBe(82);
  });
});
