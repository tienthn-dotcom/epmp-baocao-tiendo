import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseMatrixWorkbook, findMatrixSheets, readMatrixSheet } from "../src/lib/matrix-reader";
import * as XLSX from "xlsx";

/** File mẫu thật (Mini Hotel) — 5 ma trận khác cột nhau. Reader phải đọc đúng bộ xương +
 *  bắt được cờ chất lượng, KHÔNG phụ thuộc số cột vật tư. */
const buf = readFileSync(fileURLToPath(new URL("./fixtures/minihotel-matrix.xlsx", import.meta.url)));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
/**
 * Mốc riêng cho phép kiểm cuối, thay vì nâng `testTimeout` toàn cục.
 *
 * Phép kiểm ấy đọc lại nguyên file 2,1 MB lần thứ hai nên nó nặng nhất cả bộ, và thời gian chạy
 * **trôi nổi theo máy** chứ không phải mới chậm đi: cùng một commit, cùng một file nguồn, đo được
 * 1.263 ms (máy box Review) · 5.943 ms (máy box Plan) · 6.140–8.352 ms (máy box Thực thi và máy
 * này). Mốc mặc định của vitest là 5.000 ms, nên trên máy chậm nó đỏ mà chẳng có lỗi nào thật.
 *
 * Vì sao không nâng `testTimeout` toàn cục: làm thế là hạ ngưỡng cho cả hơn 400 phép kiểm để đỡ
 * đúng một phép. Mốc riêng giữ ngưỡng chặt cho mọi phép còn lại, mà vẫn còn một mốc thật ở đây —
 * chạm 20 giây thì đúng là có gì đó chậm đi và phải đi tìm.
 */
const HAN_DOC_LAI_FILE = 20_000;

describe("matrix-reader · Mini Hotel thật", () => {
  const out = parseMatrixWorkbook(ab);

  it("phát hiện đúng 5 sheet ma trận", () => {
    expect(out.length).toBe(5);
    expect(out.map((o) => o.sheet)).toContain("MTLĐ ADD B1-B5 Public");
  });

  it("sheet Public: 5 toà + 11 khu vực (đọc từ cột TỔNG, không đụng cột vật tư)", () => {
    const pub = out.find((o) => /Public/.test(o.sheet))!.result;
    expect(pub.ok).toBe(true);
    if (!pub.ok) return;
    const byLevel = pub.units.reduce<Record<string, number>>((a, u) => { a[u.level] = (a[u.level] || 0) + 1; return a; }, {});
    expect(byLevel.toa).toBe(5);
    expect(byLevel.khuvuc).toBe(11);
    // % là 0..1, không có giá trị rác ngoài khoảng
    expect(pub.units.every((u) => u.pct == null || (u.pct >= 0 && u.pct <= 1))).toBe(true);
    expect(pub.qlevel).toBe("ok");
  });

  it("sheet Phòng (B2): 1 toà + 5 tầng tổng, tên tầng dạng 'Toà/Tầng'", () => {
    const b2 = out.find((o) => /\bB2\b/.test(o.sheet))!.result;
    expect(b2.ok).toBe(true);
    if (!b2.ok) return;
    const byLevel = b2.units.reduce<Record<string, number>>((a, u) => { a[u.level] = (a[u.level] || 0) + 1; return a; }, {});
    expect(byLevel.toa).toBe(1);
    expect(byLevel.tang).toBe(5);
    expect((byLevel.can ?? 0)).toBeGreaterThan(0);
    expect(b2.units.find((u) => u.level === "tang")?.name).toMatch(/^B2\//);
  });

  it("bộ kiểm rác: B4 có tầng tổng RỖNG → cờ warn (sai/thiếu phải LỘ ra)", () => {
    const b4 = out.find((o) => /\bB4\b/.test(o.sheet))!.result;
    expect(b4.ok).toBe(true);
    if (!b4.ok) return;
    expect(b4.qlevel).toBe("warn");
    expect(b4.quality.some((q) => q.id === "blank_agg" && q.count >= 1)).toBe(true);
  });

  it("findMatrixSheets bỏ qua sheet không phải ma trận; sheet rỗng → ok:false", () => {
    // Phép kiểm này đọc lại NGUYÊN file 2,1 MB lần thứ hai: `parseMatrixWorkbook` ở trên đã parse
    // một lượt, còn `findMatrixSheets` cần chính đối tượng workbook nên phải có lượt riêng. Vì thế
    // nó là phép kiểm nặng nhất cả bộ, và chi phí đó nằm TRONG vùng bấm giờ.
    const wb = XLSX.read(ab, { type: "array", cellFormula: true, cellDates: true });
    expect(findMatrixSheets(wb).length).toBe(5);
    const empty = readMatrixSheet({} as XLSX.WorkSheet);
    expect(empty.ok).toBe(false);
  }, HAN_DOC_LAI_FILE);
});
