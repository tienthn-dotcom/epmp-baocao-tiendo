import { describe, it, expect } from "vitest";
import { isAdminEmail, actionLabel, normEmail, DEFAULT_ADMINS } from "../src/lib/activity";

describe("isAdminEmail — phân quyền giám sát", () => {
  const admins = ["liemnt1@aacorporation.com", "tienthn@aacorporation.com"];

  it("email trong danh sách → admin", () => {
    expect(isAdminEmail("tienthn@aacorporation.com", admins)).toBe(true);
    expect(isAdminEmail("liemnt1@aacorporation.com", admins)).toBe(true);
  });
  it("không phân biệt hoa/thường và khoảng trắng thừa", () => {
    expect(isAdminEmail("  TienThn@AACorporation.com ", admins)).toBe(true);
  });
  it("người khác cùng domain → KHÔNG phải admin (chỉ được dùng app, không xem log)", () => {
    expect(isAdminEmail("nhanvien@aacorporation.com", admins)).toBe(false);
  });
  it("email rỗng / null → không phải admin (fail-closed)", () => {
    expect(isAdminEmail("", admins)).toBe(false);
    expect(isAdminEmail(null, admins)).toBe(false);
    expect(isAdminEmail(undefined, admins)).toBe(false);
  });
  it("KV chưa seed (null/rỗng) → dùng DEFAULT_ADMINS", () => {
    expect(isAdminEmail("tienthn@aacorporation.com", null)).toBe(true);
    expect(isAdminEmail("tienthn@aacorporation.com", [])).toBe(true);
    expect(isAdminEmail("nguoila@gmail.com", null)).toBe(false);
  });
  it("DEFAULT_ADMINS đúng 2 tài khoản đã chốt", () => {
    expect(DEFAULT_ADMINS).toEqual(["liemnt1@aacorporation.com", "tienthn@aacorporation.com"]);
  });
  it("seed KV GHI ĐÈ mặc định — thêm/bớt người không cần deploy", () => {
    const custom = ["sep@aacorporation.com"];
    expect(isAdminEmail("sep@aacorporation.com", custom)).toBe(true);
    // tienthn không còn trong danh sách tuỳ biến ⇒ mất quyền admin
    expect(isAdminEmail("tienthn@aacorporation.com", custom)).toBe(false);
  });
});

describe("normEmail", () => {
  it("chuẩn hoá hoa/thường + trim", () => {
    expect(normEmail("  A@B.COM ")).toBe("a@b.com");
    expect(normEmail(null)).toBe("");
  });
});

describe("actionLabel — nhãn tiếng Việt", () => {
  it("map các mã đã biết", () => {
    expect(actionLabel("view")).toBe("Mở app");
    expect(actionLabel("export_pdf")).toBe("Xuất PDF");
    expect(actionLabel("open_compliance")).toBe("Xem đánh giá tuân thủ");
  });
  it("mã lạ → trả nguyên mã (không vỡ)", () => {
    expect(actionLabel("cai_gi_do")).toBe("cai_gi_do");
  });
});
