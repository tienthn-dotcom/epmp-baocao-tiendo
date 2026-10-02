/* MỐC LÀM MỚI DỮ LIỆU TCLĐ — chỉ auto sync 2 lần mỗi ngày, 18:00 và 20:00 giờ VN.
 *
 * Anh Tiến chốt 02/10/2026: *"cho số trên đó chỉ load 2 lần nếu không bấm cập nhật lại, 18 giờ và
 * 20 giờ mỗi ngày… vẫn có số mới đều, mà đỡ bị hao ghi"*.
 *
 * Sai ở đây hỏng theo kiểu KHÔNG AI THẤY: lệch một chiều thì số đứng im cả ngày mà app vẫn chạy
 * bình thường; lệch chiều kia thì mỗi lần mở là một lượt ghi KV, đốt hạn mức 1.000 lượt/ngày.
 * Nên gác bằng giờ cụ thể, tính theo GIỜ VN (worker chạy UTC).
 */
import { describe, expect, it } from "vitest";
import { lastRefreshBoundary } from "@/lib/mtld-install.functions";

/** Dựng mốc thời gian từ giờ VN → UTC ms (VN = UTC+7). */
const vn = (ngay: string, gio: number, phut = 0) =>
  Date.parse(`${ngay}T00:00:00Z`) - 7 * 3600_000 + gio * 3600_000 + phut * 60_000;

/** Đọc mốc trả về thành "ngày + giờ VN" cho dễ đối chiếu. */
const doc = (ms: number) => {
  const d = new Date(ms + 7 * 3600_000);
  return `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

describe("hai mốc trong ngày", () => {
  it("07:00 sáng → mốc 20:00 HÔM QUA (bản tối qua vẫn tươi suốt buổi sáng)", () => {
    expect(doc(lastRefreshBoundary(vn("2026-10-02", 7)))).toBe("2026-10-01 20:00");
  });
  it("17:59 → vẫn là mốc 20:00 hôm qua, CHƯA làm mới", () => {
    expect(doc(lastRefreshBoundary(vn("2026-10-02", 17, 59)))).toBe("2026-10-01 20:00");
  });
  it("18:00 đúng phút → mốc 18:00 hôm nay", () => {
    expect(doc(lastRefreshBoundary(vn("2026-10-02", 18)))).toBe("2026-10-02 18:00");
  });
  it("19:30 → vẫn mốc 18:00, KHÔNG sync thêm giữa hai mốc", () => {
    expect(doc(lastRefreshBoundary(vn("2026-10-02", 19, 30)))).toBe("2026-10-02 18:00");
  });
  it("20:00 đúng phút → mốc 20:00 hôm nay", () => {
    expect(doc(lastRefreshBoundary(vn("2026-10-02", 20)))).toBe("2026-10-02 20:00");
  });
  it("23:59 → vẫn mốc 20:00 hôm nay", () => {
    expect(doc(lastRefreshBoundary(vn("2026-10-02", 23, 59)))).toBe("2026-10-02 20:00");
  });
});

describe("đếm số lần sync trong một ngày", () => {
  /* Đi từng phút suốt 24 giờ, đếm số lần MỐC ĐỔI. Mỗi lần đổi là một lần app làm mới ở nền.
     Đây là phép đo trực tiếp lời anh Tiến: "chỉ auto sync 2 lần / ngày". */
  it("đúng 2 lần, không hơn", () => {
    let doi = 0, truoc = lastRefreshBoundary(vn("2026-10-02", 0));
    for (let p = 1; p < 24 * 60; p++) {
      const b = lastRefreshBoundary(vn("2026-10-02", 0, p));
      if (b !== truoc) { doi++; truoc = b; }
    }
    expect(doi).toBe(2);
  });
});

describe("qua nửa đêm không nhảy lung tung", () => {
  it("00:01 ngày mới vẫn là mốc 20:00 ngày trước", () => {
    expect(doc(lastRefreshBoundary(vn("2026-10-03", 0, 1)))).toBe("2026-10-02 20:00");
  });
  it("mốc luôn ở quá khứ, không bao giờ vượt hiện tại", () => {
    for (const g of [0, 6, 12, 17, 18, 19, 20, 23]) {
      const now = vn("2026-10-02", g, 17);
      expect(lastRefreshBoundary(now)).toBeLessThanOrEqual(now);
    }
  });
});
