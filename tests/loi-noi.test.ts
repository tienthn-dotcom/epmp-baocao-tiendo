/* ĐỌC LỖI THÀNH CÂU NÓI ĐƯỢC.
 *
 * Anh Tiến 06/10/2026 gặp toast "Thao tác thất bại: undefined" khi thao tác trên ô Vướng mắc.
 * `undefined` là vì app viết `(e as Error).message`, mà thứ bị ném KHÔNG phải Error — server
 * function từ chối bằng object phản hồi, hoặc Worker chết giữa chừng.
 *
 * Test này gác đúng một điều: KHÔNG BAO GIỜ trả về chuỗi rỗng hay "undefined". Một thông báo lỗi
 * không nói được gì thì tệ hơn không có, vì nó làm người dùng tưởng đã báo rồi mà thật ra chưa.
 */
import { describe, expect, it } from "vitest";
import { loiNoi } from "@/lib/loi-noi";

describe("mọi hình dạng đều ra câu nói được", () => {
  it("Error thường", () => expect(loiNoi(new Error("hết hạn mức KV"))).toBe("hết hạn mức KV"));
  it("chuỗi ném thẳng", () => expect(loiNoi("mạng rớt")).toBe("mạng rớt"));
  it("object có message", () => expect(loiNoi({ message: "sai định dạng" })).toBe("sai định dạng"));
  it("object có error", () => expect(loiNoi({ error: "ZodError" })).toBe("ZodError"));
  it("phản hồi HTTP có statusText", () => expect(loiNoi({ status: 500, statusText: "Internal Error" })).toBe("Internal Error"));
  it("phản hồi HTTP chỉ có mã", () => expect(loiNoi({ status: 522 })).toBe("máy chủ trả mã 522"));
});

describe("mấy ca xưa nay ra 'undefined'", () => {
  const xau = [undefined, null, {}, new Error(""), 0, false, [], NaN];
  for (const x of xau) {
    it(`${JSON.stringify(x) ?? String(x)} → vẫn có câu, không rỗng, không "undefined"`, () => {
      const s = loiNoi(x);
      expect(s.length).toBeGreaterThan(0);
      expect(s).not.toContain("undefined");
      expect(s.trim()).not.toBe("");
    });
  }
  it("Error rỗng message → chỉ chỗ tra, không im lặng", () => {
    expect(loiNoi(new Error(""))).toContain("Console");
  });
});

describe("không làm toast phình", () => {
  it("object to → cắt còn 200 ký tự", () => {
    const to = { data: "x".repeat(5000) };
    expect(loiNoi(to).length).toBeLessThanOrEqual(200);
  });
  it("object có vòng lặp tham chiếu → không ném", () => {
    const a: Record<string, unknown> = {}; a.self = a;
    expect(() => loiNoi(a)).not.toThrow();
    expect(loiNoi(a).length).toBeGreaterThan(0);
  });
});
