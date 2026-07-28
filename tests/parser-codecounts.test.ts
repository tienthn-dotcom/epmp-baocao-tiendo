import { describe, it, expect } from "vitest";
import { parseTimelineRows } from "../src/lib/parser";

const REF = "2026-07-27";

/** Dựng sheet tối thiểu: header hàng 5 (showIdx=4) → Vướng mắc ở cột 20, khối breakdown
 *  ở cột 21 (nhãn) / 22 (số mã làm) / 24 (tổng mã). */
function mk(pairs: Array<[number, unknown]>): unknown[] {
  const r = new Array(25).fill(null);
  for (const [i, v] of pairs) r[i] = v;
  return r;
}
function sheet(childRows: unknown[][]): unknown[][] {
  const rows: unknown[][] = [];
  for (let i = 0; i < 5; i++) rows.push([]);
  const header = new Array(25).fill(null);
  header[4] = "Show"; header[11] = "Mã"; header[12] = "Mô tả"; header[13] = "Người phụ trách chính";
  header[14] = "Bắt đầu"; header[15] = "Kết thúc"; header[18] = "% thực tế"; header[20] = "Vướng mắc / Cần xử lý";
  rows.push(header);
  rows.push([]); // hàng đệm
  rows.push(mk([[4, "show"], [5, "Dự án A"], [7, "CT-A"], [11, "CT-A"]])); // dòng dự án
  for (const c of childRows) rows.push(c);
  return rows;
}

describe("breakdown số mã / tổng mã", () => {
  it("gắn chi tiết vào giai đoạn theo NHÃN (không theo dòng)", () => {
    const rows = sheet([
      mk([[4, "show"], [11, "MA-01"], [12, "Duyệt mẫu"], [15, "01/08/2026"], [18, 55], [21, "Mẫu:"], [22, 88], [24, 159]]),
      mk([[4, "show"], [11, "VT-01"], [12, "Đặt vật tư"], [15, "01/08/2026"], [18, 0], [21, "VT.CT:"], [22, 0], [24, 96]]),
      // Dòng TKSX nhưng ô breakdown lại là VT.NM → phải gắn vào giai đoạn Đặt vật tư (theo nhãn).
      mk([[4, "show"], [11, "TKSX-01"], [12, "Triển khai sản xuất"], [15, "01/08/2026"], [18, 0], [21, "VT.NM:"], [22, 0], [24, 84]]),
    ]);
    const data = parseTimelineRows(rows, REF);
    const ma = data.items.find(i => i.rawCode === "MA-01");
    const vt = data.items.find(i => i.rawCode === "VT-01");
    const tksx = data.items.find(i => i.rawCode === "TKSX-01");
    expect(ma?.codeCounts).toEqual([{ label: "Mẫu", done: 88, total: 159 }]);
    // Đặt vật tư gộp 2 nhãn VT.CT + VT.NM.
    expect(vt?.codeCounts).toEqual([{ label: "VT.CT", done: 0, total: 96 }, { label: "VT.NM", done: 0, total: 84 }]);
    // TKSX không có nhãn TKSX/Kho → không có chi tiết.
    expect(tksx?.codeCounts).toBeUndefined();
  });

  it("bỏ qua dòng thiếu tổng mã và khối 'Kế hoạch giao hàng' (ngày, không phải số)", () => {
    const rows = sheet([
      mk([[4, "show"], [11, "MA-01"], [12, "Duyệt mẫu"], [15, "01/08/2026"], [18, 0], [21, "Mẫu:"], [22, 5], [24, ""]]),      // total trống → bỏ
      mk([[4, "show"], [11, "TKSX-01"], [12, "Triển khai sản xuất"], [15, "01/08/2026"], [18, 0], [21, "Vanity:"], [22, "30/06"], [24, ""]]), // kế hoạch giao → bỏ
    ]);
    const data = parseTimelineRows(rows, REF);
    expect(data.items.find(i => i.rawCode === "MA-01")?.codeCounts).toBeUndefined();
    expect(data.items.find(i => i.rawCode === "TKSX-01")?.codeCounts).toBeUndefined();
  });

  it("done để trống vẫn nhận, coi total là mốc; label khác lạ bị bỏ", () => {
    const rows = sheet([
      mk([[4, "show"], [11, "SX-01"], [12, "Sản xuất nhập kho"], [15, "01/08/2026"], [18, 0], [21, "Kho:"], [22, ""], [24, 91]]),
    ]);
    const data = parseTimelineRows(rows, REF);
    expect(data.items.find(i => i.rawCode === "SX-01")?.codeCounts).toEqual([{ label: "Kho", done: null, total: 91 }]);
  });
});
