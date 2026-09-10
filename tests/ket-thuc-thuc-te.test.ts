/** Dòng chưa đạt 100% thì tuyệt đối không được hiện "ngày kết thúc thực tế" — kể cả khi kho còn
 *  lưu ngày cũ (gõ nhầm 100% rồi sửa lại, hoặc hai dòng chung khoá). */
import { describe, it, expect } from "vitest";
import { ngayKetThucThucTe } from "@/lib/ket-thuc-thuc-te";

const KHO = { "id:5.1": "2026-09-09", "rid:EPMP7": "2026-08-30" };

describe("ngayKetThucThucTe", () => {
  it("đủ 100% thì trả ngày trong kho", () => {
    expect(ngayKetThucThucTe(KHO, "id:5.1", 100)).toBe("2026-09-09");
    expect(ngayKetThucThucTe(KHO, "rid:EPMP7", 120)).toBe("2026-08-30");
  });

  it("SỬA NHẦM rồi hạ xuống — ngày phải biến mất ngay, không chờ kho dọn", () => {
    for (const pct of [99, 92, 50, 39, 0]) {
      expect(ngayKetThucThucTe(KHO, "id:5.1", pct)).toBeNull();
    }
  });

  it("chưa nhập % thì cũng không có ngày", () => {
    expect(ngayKetThucThucTe(KHO, "id:5.1", null)).toBeNull();
    expect(ngayKetThucThucTe(KHO, "id:5.1", undefined)).toBeNull();
  });

  it("đủ 100% nhưng kho chưa có ngày → không bịa ra ngày", () => {
    expect(ngayKetThucThucTe(KHO, "id:9.9", 100)).toBeNull();
  });
});
