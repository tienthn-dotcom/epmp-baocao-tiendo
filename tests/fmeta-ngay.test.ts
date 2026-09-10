/**
 * Quy tắc làm tươi "ngày cập nhật của link".
 * Thứ hiển thị là một NGÀY, nên cách tính "còn dùng được" phải bám theo ngày chứ không theo phút —
 * đây là chỗ từng đốt sạch hạn mức ghi KV.
 */
import { describe, it, expect } from "vitest";

/** Chép đúng luật trong mtld-install.functions.ts (hàm ở đó không xuất ra được vì cùng file server). */
const HAN = 6 * 3600 * 1000;
const ngayVN = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t + 7 * 3600_000).toISOString().slice(0, 10);
};
type Muc = { modifiedTime: string | null; ts: number };
function conTuoi(m: Muc | undefined, gio: number): boolean {
  if (!m) return false;
  if (gio - (m.ts ?? 0) < HAN) return true;
  return !!m.modifiedTime && ngayVN(m.modifiedTime) === ngayVN(new Date(gio).toISOString());
}

const GIO = Date.parse("2026-09-10T06:00:00Z");        // 13:00 giờ VN

describe("ngayVN", () => {
  it("quy về ngày giờ Việt Nam, không phải giờ UTC", () => {
    expect(ngayVN("2026-09-09T18:00:00Z")).toBe("2026-09-10");   // 01:00 sáng 10/09 giờ VN
    expect(ngayVN("2026-09-10T06:00:00Z")).toBe("2026-09-10");
    expect(ngayVN(null)).toBe("");
  });
});

describe("khi nào phải hỏi lại Drive", () => {
  it("vừa hỏi xong thì thôi", () => {
    expect(conTuoi({ modifiedTime: "2026-08-01T00:00:00Z", ts: GIO - 60_000 }, GIO)).toBe(true);
  });

  it("file SỬA HÔM NAY thì khỏi hỏi lại tới hết ngày — ngày hiện ra vẫn thế", () => {
    expect(conTuoi({ modifiedTime: "2026-09-10T02:00:00Z", ts: GIO - 20 * 3600_000 }, GIO)).toBe(true);
  });

  it("file sửa từ hôm trước, hỏi đã lâu → phải hỏi lại", () => {
    expect(conTuoi({ modifiedTime: "2026-09-08T02:00:00Z", ts: GIO - 20 * 3600_000 }, GIO)).toBe(false);
  });

  it("chưa có gì trong kho → phải hỏi", () => {
    expect(conTuoi(undefined, GIO)).toBe(false);
  });

  it("link chết (sửa lần cuối tháng trước) vẫn được hỏi lại theo hạn, không bị kẹt số cũ mãi", () => {
    expect(conTuoi({ modifiedTime: "2026-08-01T00:00:00Z", ts: GIO - 7 * 3600_000 }, GIO)).toBe(false);
  });
});
