/**
 * Quy tắc làm tươi "ngày cập nhật của link" — MỖI NGÀY MỘT LƯỢT.
 * Thứ hiển thị là một NGÀY, nên cách tính "còn dùng được" bám theo ngày chứ không theo phút.
 * Đây là chỗ từng đốt sạch hạn mức ghi KV (mỗi link một khoá, hạn 10 phút).
 */
import { describe, it, expect } from "vitest";

/** Chép đúng luật trong mtld-install.functions.ts (hàm ở đó nằm trong file server, không xuất ra). */
const ngayVN = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t + 7 * 3600_000).toISOString().slice(0, 10);
};
type Muc = { modifiedTime: string | null; ts: number };
function conTuoi(m: Muc | undefined, gio: number): boolean {
  if (!m) return false;
  const homNay = ngayVN(new Date(gio).toISOString());
  if (ngayVN(new Date(m.ts ?? 0).toISOString()) === homNay) return true;
  return !!m.modifiedTime && ngayVN(m.modifiedTime) === homNay;
}

const GIO = Date.parse("2026-09-10T06:00:00Z");        // 13:00 giờ VN ngày 10/09
const gio = (s: string) => Date.parse(s);

describe("ngayVN", () => {
  it("quy về ngày giờ Việt Nam, không phải giờ UTC", () => {
    expect(ngayVN("2026-09-09T18:00:00Z")).toBe("2026-09-10");   // 01:00 sáng 10/09 giờ VN
    expect(ngayVN("2026-09-10T06:00:00Z")).toBe("2026-09-10");
    expect(ngayVN(null)).toBe("");
  });
});

describe("mỗi ngày hỏi lại đúng một lượt", () => {
  it("hôm nay đã hỏi rồi → thôi, dù hỏi từ sáng sớm", () => {
    expect(conTuoi({ modifiedTime: "2026-08-01T00:00:00Z", ts: gio("2026-09-09T22:00:00Z") }, GIO)).toBe(true);
  });

  it("lần hỏi gần nhất là HÔM QUA → hỏi lại", () => {
    expect(conTuoi({ modifiedTime: "2026-08-01T00:00:00Z", ts: gio("2026-09-08T23:00:00Z") }, GIO)).toBe(false);
  });

  it("qua nửa đêm là hết hạn, không phải chờ đủ 24 tiếng", () => {
    // hỏi lúc 23:00 giờ VN ngày 09/09, xem lúc 08:00 giờ VN ngày 10/09 — mới 9 tiếng nhưng đã sang ngày
    const hoi = gio("2026-09-09T16:00:00Z");
    const xem = gio("2026-09-10T01:00:00Z");
    expect(conTuoi({ modifiedTime: "2026-08-01T00:00:00Z", ts: hoi }, xem)).toBe(false);
  });

  it("file SỬA HÔM NAY thì khỏi hỏi lại — ngày hiện ra vẫn thế", () => {
    expect(conTuoi({ modifiedTime: "2026-09-10T02:00:00Z", ts: gio("2026-09-08T02:00:00Z") }, GIO)).toBe(true);
  });

  it("chưa có gì trong kho → phải hỏi", () => {
    expect(conTuoi(undefined, GIO)).toBe(false);
  });

  it("link chết vẫn được hỏi lại mỗi ngày, không kẹt số cũ mãi", () => {
    expect(conTuoi({ modifiedTime: "2026-07-01T00:00:00Z", ts: gio("2026-09-09T02:00:00Z") }, GIO)).toBe(false);
  });
});
