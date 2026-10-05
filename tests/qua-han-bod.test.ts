/* Ô "Cần PM trình Master Plan BOD phê duyệt" — tô ĐỎ khi quá 2 tuần chưa trình.
 *
 * Anh Tiến chốt 05/10/2026: "ông nào quá 2 tuần chưa trình thì ô thông tin đổi thành màu đỏ".
 *
 * CHỖ DỄ SAI: app đã có sẵn con số "số tuần quá hạn" dùng để TRỪ ĐIỂM, nhưng nó làm tròn LÊN theo
 * tuần (ceil) — "2 tuần" của nó thật ra là 8–14 ngày. Mượn con số đó để tô màu là bôi đỏ PM sớm
 * tới 6 ngày. Trừ điểm làm tròn lên là đúng; tô cảnh báo thì phải đúng nghĩa đen.
 */
import { describe, expect, it } from "vitest";
import { doViQuaHanBod, soNgayQuaHanBod, QUA_HAN_DO_NGAY } from "@/lib/mp-deadline";

const NAY = "2026-10-05";

describe("đếm ngày quá hạn", () => {
  it("đúng hôm nay là 0 ngày", () => expect(soNgayQuaHanBod("2026-10-05", NAY)).toBe(0));
  it("hạn mai → âm (còn hạn)", () => expect(soNgayQuaHanBod("2026-10-06", NAY)).toBe(-1));
  it("hạn 16/09 → 19 ngày", () => expect(soNgayQuaHanBod("2026-09-16", NAY)).toBe(19));
  it("qua mốc tháng vẫn đúng", () => expect(soNgayQuaHanBod("2026-08-31", NAY)).toBe(35));
});

describe("mốc tô đỏ = VƯỢT 14 ngày", () => {
  it("mốc chốt là 14 ngày", () => expect(QUA_HAN_DO_NGAY).toBe(14));
  it("13 ngày → CHƯA đỏ", () => expect(doViQuaHanBod("2026-09-22", NAY)).toBe(false));
  it("đúng 14 ngày → CHƯA đỏ (vừa tròn hai tuần, chưa 'quá')", () =>
    expect(doViQuaHanBod("2026-09-21", NAY)).toBe(false));
  it("15 ngày → ĐỎ", () => expect(doViQuaHanBod("2026-09-20", NAY)).toBe(true));
  it("19 ngày (trước 16/09, đúng ca trong ảnh) → ĐỎ", () =>
    expect(doViQuaHanBod("2026-09-16", NAY)).toBe(true));
  it("chưa tới hạn → KHÔNG đỏ", () => expect(doViQuaHanBod("2026-10-20", NAY)).toBe(false));
  it("không có hạn → KHÔNG đỏ, không đoán", () => {
    expect(doViQuaHanBod(null, NAY)).toBe(false);
    expect(doViQuaHanBod(undefined, NAY)).toBe(false);
    expect(doViQuaHanBod("", NAY)).toBe(false);
  });
});

describe("không lẫn với số tuần dùng để trừ điểm", () => {
  it("8 ngày: trừ điểm tính 2 tuần, nhưng tô màu thì CHƯA đỏ", () => {
    // ceil(8/7) = 2 → điểm bị trừ 20. Nhưng 8 ngày chưa "quá 2 tuần" theo nghĩa đen.
    expect(Math.ceil(8 / 7)).toBe(2);
    expect(doViQuaHanBod("2026-09-27", NAY)).toBe(false);
  });
});
