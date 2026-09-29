/**
 * KHOÁ CHẮC LUẬT "CẦN PM TRÌNH BOD PHÊ DUYỆT (BITRIX)".
 *
 * Người dùng chốt 29/09/2026: *"cái cần trình BOD, khoá cho kỹ, đừng dùng mỗi chữ 'trước dd/mm'
 * dễ bị sai, khoá chắc vào"*.
 *
 * MỖI CA DƯỚI ĐÂY LÀ MỘT CÂU THẬT, lấy từ kho ghi chú (.data/pmo-edits.json) — không phải câu
 * tự nghĩ ra. Ca quan trọng nhất là CT26-032 Ponte Apartment: luật cũ đọc ra hạn 12/09 trong khi
 * 12/09 là hạn của việc TKSX ở một tin khác trong cùng ô. Hạn sai → báo cáo tuân thủ trừ 10 điểm
 * mỗi tuần kể từ một ngày không ai hẹn.
 */
import { describe, it, expect } from "vitest";
import { noteCanTrinhBodBitrix, parseMpDeadlineIso } from "@/lib/mp-deadline";
import { noteSaysTrinhBodBitrix } from "@/lib/parser";

const NAY = "2026-09-29";

describe("một luật cho cả hai câu hỏi", () => {
  it("parser gọi vào mp-deadline, không tự dò nữa", () => {
    const cau = "cần PM trình BOD phê duyệt bitrix trước 22/09";
    expect(noteSaysTrinhBodBitrix(cau)).toBe(noteCanTrinhBodBitrix(cau));
    expect(noteSaysTrinhBodBitrix("Tiến độ dời từ 05/09 đến 30/10")).toBe(false);
  });

  it("vào được bộ lọc thì hạn phải đọc TRÊN CÙNG CÂU đó", () => {
    const cau = "Dự án mới cần PM lập master plan & trình BOD phê duyệt bitrix trước 15/09";
    expect(noteCanTrinhBodBitrix(cau)).toBe(true);
    expect(parseMpDeadlineIso(cau, NAY)).toBe("2026-09-15");
  });
});

describe("KHÔNG lấy ngày của việc khác — ca thật CT26-032 Ponte Apartment", () => {
  // Ô gộp hai tin: tin trình BOD KHÔNG có hạn, tin TKSX có hạn 12/9. Luật cũ trả 12/09.
  const PONTE = [
    "Trễ hạn bàn giao T8, cần PM trình bitrix BOD duyệt ngày bàn giao mới GẤP",
    "Chưa TKSX theo cam kết, cần PM hoàn thành trước 12/9. SXNK chậm NM gấp rút SX giao hàng đến CT",
  ].join("\n");

  it("vẫn vào bộ lọc vì câu đầu đúng là yêu cầu trình BOD", () => {
    expect(noteCanTrinhBodBitrix(PONTE)).toBe(true);
  });

  it("hạn là null, KHÔNG phải 12/09 của việc TKSX", () => {
    expect(parseMpDeadlineIso(PONTE, NAY)).toBeNull();
  });

  it("thứ tự hai tin đảo lại cũng vậy", () => {
    const dao = PONTE.split("\n").reverse().join("\n");
    expect(parseMpDeadlineIso(dao, NAY)).toBeNull();
  });
});

describe("ngày phải nằm trong câu trình BOD", () => {
  it("câu trình BOD có hạn, câu sau có ngày khác — lấy hạn của câu trình BOD", () => {
    const note = "Tiến độ dời từ 30/06 đến 30/11, cần PM trình BOD phê duyệt (bitrix) trước 09/09. Cần PM tăng tốc TKSX toàn bộ mã trước 10/09";
    expect(parseMpDeadlineIso(note, NAY)).toBe("2026-09-09");
  });

  it("ngày của cụm DỜI TIẾN ĐỘ không bao giờ thành hạn", () => {
    expect(parseMpDeadlineIso("Tiến độ dời từ 31/08 đến 30/10, cần PM trình BOD phê duyệt (bitrix).", NAY)).toBeNull();
    expect(parseMpDeadlineIso("cần PM trình BOD phê duyệt bitrix, dời đến ngày 30/12", NAY)).toBeNull();
    expect(parseMpDeadlineIso("Tiến độ dời đến 30/12, cần PM trình BOD phê duyệt ( bitrix ). Cần PM-SD thống nhất tiến độ", NAY)).toBeNull();
  });

  it("ngày trơ trọi không có chữ dẫn thì BỎ, không đoán", () => {
    expect(parseMpDeadlineIso("cần PM trình BOD phê duyệt bitrix, họp 22/09 xong rồi tính", NAY)).toBeNull();
  });
});

describe("không chỉ mỗi chữ 'trước' — nhận các lối viết hạn khác", () => {
  const ca: [string, string][] = [
    ["cần PM trình BOD phê duyệt bitrix, hạn 22/09", "2026-09-22"],
    ["cần PM trình BOD phê duyệt bitrix chậm nhất 22/09", "2026-09-22"],
    ["cần PM trình BOD phê duyệt bitrix, deadline 22/09", "2026-09-22"],
    ["cần PM trình BOD phê duyệt bitrix theo mốc 22/09", "2026-09-22"],
    ["cần PM trình BOD phê duyệt bitrix trong ngày 22/09", "2026-09-22"],
    ["cần PM trình BOD duyệt bitrix 22/09", "2026-09-22"],
    ["cần PM trình BOD phê duyệt bitrix trước ngày 22.09", "2026-09-22"],
    ["cần PM trình BOD phê duyệt bitrix, hoàn thành trước 22-09", "2026-09-22"],
  ];
  for (const [note, mong] of ca) it(note, () => expect(parseMpDeadlineIso(note, NAY)).toBe(mong));

  it("thiếu dấu cũng đọc được", () => {
    expect(parseMpDeadlineIso("can PM trinh BOD phe duyet bitrix truoc 22/09", NAY)).toBe("2026-09-22");
  });
});

describe("thứ tự chữ trong câu không cố định — câu người thật viết", () => {
  it("bitrix đứng TRƯỚC bod vẫn nhận (ca thật CT26-032)", () => {
    expect(noteCanTrinhBodBitrix("cần PM trình bitrix BOD duyệt ngày bàn giao mới GẤP")).toBe(true);
  });

  it("bốn mảnh rải trong một câu dài vẫn nhận (ca thật CT26-065)", () => {
    expect(noteCanTrinhBodBitrix("PMO: Trễ tiến độ bàn giao T8, PM vẫn chưa trình bitrix BOD ngày bàn giao mới, cần PM trình duyệt bitrix GẤP")).toBe(true);
  });

  it("bốn mảnh nằm ở HAI CÂU khác nhau thì KHÔNG nhận", () => {
    expect(noteCanTrinhBodBitrix("BOD phê duyệt xong rồi. PM trình lại hồ sơ trên bitrix")).toBe(false);
    expect(noteCanTrinhBodBitrix("Ghi nhận tình trạng dự án & chờ chủ trương mới. Đề xuất PM đệ trình Action Plan trình Bitrix đến anh Thành review")).toBe(false);
  });
});

describe("việc đã xong hoặc không phải làm thì KHÔNG vào bộ lọc", () => {
  it("BOD đã phê duyệt rồi", () => {
    expect(noteCanTrinhBodBitrix("MP đã trình, BOD đã phê duyệt trên bitrix")).toBe(false);
    expect(noteCanTrinhBodBitrix("Master plan được BOD duyệt trên bitrix, PM trình tiếp hồ sơ")).toBe(false);
  });

  it("nói rõ không cần trình", () => {
    expect(noteCanTrinhBodBitrix("Dự án nhỏ, không cần trình BOD phê duyệt bitrix")).toBe(false);
  });

  it("đã duyệt NHƯNG vẫn còn đòi hỏi thì vẫn vào", () => {
    expect(noteCanTrinhBodBitrix("BOD đã duyệt bản cũ, cần PM trình lại BOD phê duyệt bitrix trước 30/09")).toBe(true);
  });
});

describe("ô gộp nhiều tin: tin mới nhất có hiệu lực", () => {
  it("câu trình BOD mới nhất có hạn thì lấy hạn đó", () => {
    const note = "trình BOD phê duyệt (bitrix) trước 01/08\ncập nhật: trình BOD phê duyệt (bitrix) trước 09/09";
    expect(parseMpDeadlineIso(note, "2026-09-09")).toBe("2026-09-09");
  });

  it("câu mới nhất CHƯA điền hạn thì lùi về hạn của câu trước, thà cũ hơn là để trống", () => {
    const note = "trình BOD phê duyệt (bitrix) trước 01/08\ncập nhật: cần PM trình BOD phê duyệt (bitrix)";
    expect(parseMpDeadlineIso(note, "2026-09-09")).toBe("2026-08-01");
  });
});
