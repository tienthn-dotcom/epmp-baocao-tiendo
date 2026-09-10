/** Hai mẫu câu PMO chốt 10/09/2026 — vừa là quy ước gom vào bộ lọc "Cần cập nhật MP",
 *  vừa là chỗ app quét ra ngày trong cột "Cần PM trình Master Plan BOD phê duyệt". */
import { describe, it, expect } from "vitest";
import { parseMpDeadlineIso } from "@/lib/mp-deadline";
import { noteSaysTrinhBodBitrix } from "@/lib/parser";

const NAY = "2026-09-10";
const MAU1 = "PMO: Dự án mới cần PM lập master plan & trình BOD phê duyệt bitrix trước 15/09";
const MAU2 = "PMO: Tiến độ dời từ 05/09 đến 30/10, cần PM trình BOD phê duyệt bitrix trước 20/09";
const XUONG = String.fromCharCode(10);

describe("gom vào bộ lọc Cần cập nhật MP", () => {
  it("mẫu 1 — dự án mới", () => expect(noteSaysTrinhBodBitrix(MAU1)).toBe(true));
  it("mẫu 2 — dời tiến độ", () => expect(noteSaysTrinhBodBitrix(MAU2)).toBe(true));
  it("note không nhắc bitrix thì không gom", () =>
    expect(noteSaysTrinhBodBitrix("PMO: Tiến độ dời từ 05/09 đến 30/10")).toBe(false));
});

describe("quét ngày", () => {
  it("mẫu 1", () => expect(parseMpDeadlineIso(MAU1, NAY)).toBe("2026-09-15"));
  it("mẫu 2 — KHÔNG lấy ngày của cụm 'dời từ … đến …'", () =>
    expect(parseMpDeadlineIso(MAU2, NAY)).toBe("2026-09-20"));
  it("chưa điền ngày (còn để dấu chấm) thì không có deadline", () =>
    expect(parseMpDeadlineIso("PMO: Dự án mới cần PM lập master plan & trình BOD phê duyệt bitrix trước ......", NAY)).toBeNull());
});

describe("biến thể gõ tay quanh hai mẫu", () => {
  const D = "PMO: Dự án mới cần PM lập master plan & trình BOD phê duyệt bitrix trước ";
  const ca: Array<[string, string, string | null]> = [
    ["có chữ ngày", `${D}ngày 15/09`, "2026-09-15"],
    ["tháng một chữ số", `${D}15/9`, "2026-09-15"],
    ["ngăn bằng dấu chấm", `${D}15.09`, "2026-09-15"],
    ["ngăn bằng gạch ngang", `${D}15-09`, "2026-09-15"],
    ["ghi cả năm", `${D}15/09/2026`, "2026-09-15"],
    ["thiếu chữ phê", "PMO: Dự án mới cần PM lập master plan & trình BOD duyệt bitrix trước 15/09", "2026-09-15"],
    ["bitrix trong ngoặc", "PMO: Dự án mới cần PM lập master plan & trình BOD phê duyệt (Bitrix) trước 15/09", "2026-09-15"],
    ["cụm dời tiến độ đứng SAU", "PMO: cần PM trình BOD phê duyệt bitrix trước 20/09. Tiến độ dời từ 05/09 đến 30/10", "2026-09-20"],
    ["hai tin trong một ô — tin sau có hiệu lực", MAU1 + XUONG + MAU2, "2026-09-20"],
    ["không nhắc bitrix", "PMO: Dự án mới cần PM lập master plan & trình BOD phê duyệt trước 15/09", null],
  ];
  for (const [ten, note, mong] of ca) {
    it(`${ten} → ${mong ?? "không có deadline"}`, () => expect(parseMpDeadlineIso(note, NAY)).toBe(mong));
  }
});
