/**
 * NGUYÊN TẮC LOẠI TRỪ THÁNG ÂM — tab "Hiệu suất theo tháng" (app Hiệu suất dự án).
 * Sản lượng âm = điều chỉnh/hoàn của sản lượng đã ghi trước đó → gánh ngược về tháng liền trước,
 * không đủ thì lùi tiếp tháng trước nữa; hết sạch chỗ thì dồn vào THÁNG 12 (nằm ngoài vùng hiển thị
 * nên không hiện lên). Tổng cả năm phải GIỮ NGUYÊN.
 */
import { describe, it, expect } from "vitest";
import { absorbNegBack } from "@/lib/perf-chart-app";

const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);
/** So sánh 12 tháng (hàm luôn trả đủ 12 ô); `want` ngắn hơn thì phần thiếu coi như 0. */
const near = (got: number[], want: number[]) => {
  expect(got).toHaveLength(12);
  got.forEach((v, i) => expect(v).toBeCloseTo(want[i] ?? 0, 6));
};

describe("absorbNegBack", () => {
  it("không có tháng âm → giữ nguyên số từng tháng", () => {
    near(absorbNegBack([1, 2, 3]), [1, 2, 3]);
  });

  it("gánh về ĐÚNG tháng liền trước khi tháng đó đủ", () => {
    near(absorbNegBack([10, 3, -2]), [10, 1, 0]);
  });

  it("tháng liền trước không đủ → lùi tiếp tháng trước nữa", () => {
    // −5 ở T3: T2 chỉ có 1 → lấy hết 1, còn 4 lùi về T1.
    near(absorbNegBack([10, 1, -5]), [6, 0, 0]);
  });

  it("tháng liền trước CŨNG âm → cả cụm dồn về tháng dương xa hơn", () => {
    near(absorbNegBack([10, -2, -1]), [7, 0, 0]);
  });

  it("gánh hết các tháng trước vẫn dư → phần dư dồn vào THÁNG 12", () => {
    // T2 −5, trước nó chỉ có 2 → hấp thụ 2, còn 3 sang T12 (không hiện trên chart).
    const out = absorbNegBack([2, -5]);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(0, 6);
    expect(out[11]).toBeCloseTo(-3, 6);
  });

  it("KHÔNG để lại số âm nào trong các tháng ĐANG HIỂN THỊ", () => {
    const nm = 8;
    const out = absorbNegBack([0, -3.37, 26.5, 34.47, 29.64, -7.54, -5.55, 18.09]);
    for (let m = 0; m < nm; m++) expect(out[m]).toBeGreaterThanOrEqual(0);
  });

  it("TỔNG cả năm không đổi", () => {
    const src = [0, -3.37, 26.5, 34.47, 29.64, -7.54, -5.55, 18.09];   // HYATT HẠ LONG, file T1-T8
    expect(sum(absorbNegBack(src))).toBeCloseTo(sum(src), 6);
  });

  it("số liệu thật: HYATT HẠ LONG", () => {
    // T6 −7,54 và T7 −5,55 ăn vào T5 (29,64 → 16,55); T2 −3,37 không có gì phía trước → sang T12.
    near(absorbNegBack([0, -3.37, 26.5, 34.47, 29.64, -7.54, -5.55, 18.09]),
      [0, 0, 26.5, 34.47, 16.55, 0, 0, 18.09, 0, 0, 0, -3.37]);
  });

  it("số liệu thật: HYATT HỒ TRÀM", () => {
    near(absorbNegBack([0, 10.85, 14.87, -11.92, 6.81, 5.1, 0.95, 4.06]),
      [0, 10.85, 2.95, 0, 6.81, 5.1, 0.95, 4.06]);
  });

  it("số liệu thật: TIẾN BỘ PLAZA", () => {
    near(absorbNegBack([0, 0, 3.47, -0.23, 7.23, 10.93, -0.38, 0]),
      [0, 0, 3.24, 0, 7.23, 10.55, 0, 0]);
  });

  it("KHÔNG sửa mảng gốc", () => {
    const src = [10, 1, -5];
    absorbNegBack(src);
    expect(src).toEqual([10, 1, -5]);
  });
});
