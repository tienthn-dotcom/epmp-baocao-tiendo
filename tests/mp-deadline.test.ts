/**
 * Deadline "trình BOD phê duyệt (bitrix) trước dd/mm".
 * Mấy ca ở đây là những kiểu ghi chú THẬT trong file — đọc sai một ngày là báo cáo tuân thủ
 * trừ điểm oan PM.
 */
import { describe, it, expect } from "vitest";
import { parseMpDeadlineIso } from "@/lib/mp-deadline";

const NAY = "2026-09-09";

describe("câu chuẩn", () => {
  it("đọc đúng ngày trong câu người ta viết", () => {
    expect(parseMpDeadlineIso("cần PM trình BOD phê duyệt (bitrix) trước 09/09", NAY)).toBe("2026-09-09");
  });

  it("viết hoa/thường, thiếu ngoặc, thừa khoảng trắng đều đọc được", () => {
    expect(parseMpDeadlineIso("Cần PM trình BOD duyệt Bitrix trước ngày 15/10", NAY)).toBe("2026-10-15");
    expect(parseMpDeadlineIso("trình BOD phê duyệt  ( BITRIX )  trước  1 / 12", NAY)).toBe("2026-12-01");
  });

  it("có ghi năm thì dùng đúng năm đó", () => {
    expect(parseMpDeadlineIso("trình BOD phê duyệt (bitrix) trước 09/01/2027", NAY)).toBe("2027-01-09");
    expect(parseMpDeadlineIso("trình BOD phê duyệt (bitrix) trước 09/01/27", NAY)).toBe("2027-01-09");
  });
});

describe("không để ngày nhảy lung tung", () => {
  it("KHÔNG nhặt ngày của việc khác trong cùng ô ghi chú", () => {
    const note = "Cần PM đặt hàng gạch trước 29/08. Cần PM trình BOD phê duyệt (bitrix) trước 09/09.";
    expect(parseMpDeadlineIso(note, NAY)).toBe("2026-09-09");
  });

  it("việc khác đứng SAU cũng không kéo ngày đi", () => {
    const note = "Cần PM trình BOD phê duyệt (bitrix) trước 09/09. Sau đó gửi mẫu trước 30/11.";
    expect(parseMpDeadlineIso(note, NAY)).toBe("2026-09-09");
  });

  it("ô gộp nhiều tin: lấy cụm BOD MỚI NHẤT", () => {
    const note = "trình BOD phê duyệt (bitrix) trước 01/08\ncập nhật: trình BOD phê duyệt (bitrix) trước 09/09";
    expect(parseMpDeadlineIso(note, NAY)).toBe("2026-09-09");
  });

  it("chỉ có dd/mm thì chọn năm GẦN HÔM NAY nhất, không phụ thuộc ngày cắm cờ", () => {
    // Cùng một câu, đọc ở hai thời điểm khác nhau trong năm vẫn ra ngày hợp lý.
    expect(parseMpDeadlineIso("trình BOD phê duyệt (bitrix) trước 05/01", "2026-12-28")).toBe("2027-01-05");
    expect(parseMpDeadlineIso("trình BOD phê duyệt (bitrix) trước 28/12", "2027-01-05")).toBe("2026-12-28");
  });
});

describe("không có deadline thì trả null — tuyệt đối không bịa", () => {
  it("không nhắc bitrix", () => {
    expect(parseMpDeadlineIso("Cần PM trình BOD phê duyệt trước 09/09", NAY)).toBeNull();
  });

  it("có bitrix nhưng không nói hạn nào", () => {
    expect(parseMpDeadlineIso("Cần PM trình BOD phê duyệt (bitrix)", NAY)).toBeNull();
  });

  it("KHÔNG nhặt ngày kiểu 'dời từ 30/10'", () => {
    expect(parseMpDeadlineIso("trình BOD phê duyệt (bitrix), dời từ 30/10", NAY)).toBeNull();
  });

  it("ghi chú rỗng / ngày vô lý", () => {
    expect(parseMpDeadlineIso("", NAY)).toBeNull();
    expect(parseMpDeadlineIso("trình BOD phê duyệt (bitrix) trước 45/13", NAY)).toBeNull();
  });
});
