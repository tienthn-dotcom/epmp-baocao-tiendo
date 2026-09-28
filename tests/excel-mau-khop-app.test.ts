/**
 * BẢNG MÀU CỦA FILE EXCEL PHẢI KHỚP BẢNG MÀU CỦA APP.
 *
 * `excel-export.ts` CHÉP giá trị màu từ hằng `GC` trong `src/routes/index.tsx`, vì `GC` khai bên
 * trong component Gantt đang chạy và không export — kéo nó ra là sửa vào đường render của Gantt
 * để phục vụ một việc thuần trình bày của Excel, đúng loại thay đổi L11.
 *
 * Cái giá của việc chép là hai bảng trôi xa nhau mà không ai biết: ai chỉnh màu Gantt sẽ không
 * nghĩ tới file Excel, và ngược lại. Phép kiểm này đọc THẲNG cả hai file rồi so, nên lệch là đỏ
 * ngay chứ không đợi tới lúc có người mở file ra và thấy hai màu navy khác nhau.
 *
 * Đọc bằng regex chứ không import: `index.tsx` là module React nặng, và `GC` nằm trong thân
 * component nên không import ra được.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const doc = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

/** Rút `ten: "#rrggbb"` trong khối `const GC = { ... }` của index.tsx. */
function mauGC(): Record<string, string> {
  const src = doc("../src/routes/index.tsx");
  const kh = /const GC = \{([\s\S]*?)\n  \};/.exec(src);
  expect(kh, "không tìm thấy khối `const GC = {` trong index.tsx — đổi tên hằng thì sửa cả đây").toBeTruthy();
  const ra: Record<string, string> = {};
  for (const m of kh![1].matchAll(/(\w+):\s*"(#[0-9a-fA-F]{6})"/g)) ra[m[1]] = m[2].toUpperCase();
  return ra;
}

/** Rút `ten: "FFrrggbb"` trong khối `const MAU = { ... }` của excel-export.ts. */
function mauExcel(): Record<string, string> {
  const src = doc("../src/lib/excel-export.ts");
  const kh = /const MAU = \{([\s\S]*?)\n\} as const;/.exec(src);
  expect(kh, "không tìm thấy khối `const MAU = {` trong excel-export.ts").toBeTruthy();
  const ra: Record<string, string> = {};
  for (const m of kh![1].matchAll(/(\w+):\s*"(FF[0-9a-fA-F]{6})"/g)) ra[m[1]] = "#" + m[2].slice(2).toUpperCase();
  return ra;
}

/** Màu Excel nào lấy từ khoá nào của GC. Thêm màu mới thì thêm cả dòng ở đây. */
const NGUON: Record<string, string> = {
  header:    "headerBg",
  duAn:      "bar",
  nenCon:    "childBg",
  quaHanNen: "overdueBg",
  quaHanMep: "overdueEdge",
  hoanThanh: "done",
};

describe("màu file Excel khớp màu app", () => {
  it("đọc được cả hai bảng màu", () => {
    expect(Object.keys(mauGC()).length).toBeGreaterThan(5);
    expect(Object.keys(mauExcel()).length).toBeGreaterThan(5);
  });

  it.each(Object.entries(NGUON))("MAU.%s phải bằng GC.%s", (khoaExcel, khoaGC) => {
    const gc = mauGC(), ex = mauExcel();
    expect(gc[khoaGC], `GC.${khoaGC} không còn trong index.tsx`).toBeTruthy();
    expect(ex[khoaExcel], `MAU.${khoaExcel} không còn trong excel-export.ts`).toBeTruthy();
    expect(ex[khoaExcel]).toBe(gc[khoaGC]);
  });

  it("mọi màu trong MAU đều có nguồn khai báo — thêm màu mà quên khai là bỏ lọt khỏi phép so", () => {
    // `duAnXong` cố ý không lấy từ GC: đó là màu "đã bàn giao" vốn có sẵn của file Excel, không
    // phải màu của Gantt. Ngoài nó ra, mọi màu đều phải truy được về GC.
    const chuaKhai = Object.keys(mauExcel()).filter((k) => !(k in NGUON) && k !== "duAnXong");
    expect(chuaKhai).toEqual([]);
  });
});

describe("ngưỡng quá hạn lấy từ lib/filter, không gõ lại số", () => {
  it("index.tsx truyền OD_ALERT_DAYS chứ không truyền một số cứng", () => {
    const src = doc("../src/routes/index.tsx");
    expect(src).toContain("overdueAlertDays: OD_ALERT_DAYS");
    expect(/overdueAlertDays:\s*\d/.test(src), "đang gõ số cứng thay vì dùng hằng").toBe(false);
  });

  it("lib/filter vẫn xuất OD_ALERT_DAYS và chỉ có MỘT ngưỡng", () => {
    const src = doc("../src/lib/filter.ts");
    const khai = [...src.matchAll(/export const OD_ALERT_DAYS\s*=\s*(\d+)/g)];
    expect(khai.length, "có nhiều hơn một ngưỡng quá hạn — phải báo Plan, đừng tự chọn").toBe(1);
    expect(Number(khai[0][1])).toBeGreaterThan(0);
  });
});
