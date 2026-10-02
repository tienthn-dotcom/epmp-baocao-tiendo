/* NHÃN "SỐ MÃ" TRONG FILE NGUỒN — đọc được hay không.
 *
 * Luật cũ bắt nhãn phải kết thúc bằng dấu hai chấm. Người nhập gõ tay nên gõ lệch, và dòng gõ lệch
 * BIẾN MẤT khỏi app mà không có cảnh báo nào: popup chỉ ghi "nhập tay, không có chi tiết số mã",
 * người xem tưởng file nguồn thiếu số.
 *
 * Đo file Project Master Plan_2.3_Shared ngày 02/10/2026: 329 dòng số mã hợp lệ, 326 dòng gõ ":",
 * ba dòng còn lại gõ khác — và cả ba đều là dự án đang chạy:
 *     CT26-040 APEC_S2_Public             "TKSX;"    5/334
 *     CT26-041 APEC_S3_Public             "TKSX"    40/421
 *     CT26-055 Nam Phương Hoàng Hậu Phòng "VT.CT"   10/10
 * Ba ca đó nằm nguyên trong test này.
 */
import { describe, expect, it } from "vitest";
import { laNhanSoMa } from "@/lib/parser";

describe("nhãn gõ đúng kiểu cũ vẫn đọc được", () => {
  for (const x of ["Mẫu:", "VT.CT:", "VT.NM:", "SD:", "TKSX:", "Kho:", "GCN:"]) {
    it(`"${x}"`, () => expect(laNhanSoMa(x)).toBe(true));
  }
});

describe("BA CA THẬT đang bị bỏ qua trong file 02/10/2026", () => {
  it('"TKSX;" — CT26-040 APEC_S2_Public, 5/334 mã', () => expect(laNhanSoMa("TKSX;")).toBe(true));
  it('"TKSX" — CT26-041 APEC_S3_Public, 40/421 mã', () => expect(laNhanSoMa("TKSX")).toBe(true));
  it('"VT.CT" — CT26-055 Nam Phương Hoàng Hậu Phòng, 10/10 mã', () => expect(laNhanSoMa("VT.CT")).toBe(true));
});

describe("gõ lệch kiểu khác cũng nhận", () => {
  for (const x of ["mẫu", "  Kho  ", "SD ;", "VT.Fit:", "VT.BL", "vt"]) {
    it(JSON.stringify(x), () => expect(laNhanSoMa(x)).toBe(true));
  }
});

/* GÁC CHIỀU NGƯỢC LẠI. Luật cũ nhận mọi chuỗi BẮT ĐẦU bằng "vt", nên một ô ghi chú như
 * "VT về công trường 30/07" cũng lọt vào nếu cột tổng tình cờ là số. Luật mới khớp ĐÚNG TÊN nên
 * chặt hơn — phần này giữ cho nó đừng lỏng trở lại. */
describe("KHÔNG nhận chữ khác", () => {
  for (const x of [
    "",
    "   ",
    "VT về công trường 30/07",
    "Kế hoạch giao hàng:",
    "Mẫu vải còn thiếu",
    "TKSX về nhà máy",
    "Khối lượng:",
    "SD/P",
    "Tổng:",
  ]) {
    it(JSON.stringify(x), () => expect(laNhanSoMa(x)).toBe(false));
  }
});
