/**
 * ĐỒNG HỒ ĐO: băm ngắn nội dung đã ghi, gắn vào bảng đếm D1 `kv_write`.
 *
 * Việc của bộ kiểm này KHÔNG phải là canh cái băm cho đẹp. Nó canh đúng một điều: **đồng hồ đo
 * không bao giờ được làm hỏng thứ nó đang đo**. `demGhiKv` chạy ngay sau mỗi lượt ghi KV thật, ở
 * mọi đường ghi của app. Nó ném lỗi là server-fn của người dùng ném lỗi theo, dù lượt ghi đã xong.
 *
 * Gọi thẳng hàm thật trong src/lib/kv-dem.ts, không chép luật sang đây.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { bamNgan, demGhiKv } from "@/lib/kv-dem";

/** D1 giả — đếm số câu lệnh đã CHẠY và giữ lại tham số đã bind. */
function d1Gia(opt?: { chanCot?: boolean; hongHet?: boolean }) {
  const cau: { sql: string; tham: unknown[] }[] = [];
  const d1 = {
    prepare(sql: string) {
      const chay = async () => {
        if (opt?.hongHet) throw new Error("D1 chet");
        // Giả lập bảng production ĐỜI CŨ: chưa có cột `bam` nên câu chèn ba cột bị từ chối.
        if (opt?.chanCot && sql.includes("INSERT") && sql.includes("bam")) throw new Error("no column named bam");
        return {};
      };
      return {
        bind: (...tham: unknown[]) => ({ run: async () => { const r = await chay(); cau.push({ sql, tham }); return r; } }),
        run: async () => { const r = await chay(); cau.push({ sql, tham: [] }); return r; },
      };
    },
  };
  return {
    d1,
    chen: () => cau.filter((c) => c.sql.startsWith("INSERT")),
    cauCo: (x: string) => cau.some((c) => c.sql.includes(x)),
  };
}

type CoEnv = { __env__?: unknown };
const g = globalThis as CoEnv;
let cu: unknown;
beforeEach(() => { cu = g.__env__; });
afterEach(() => { g.__env__ = cu; });

describe("bamNgan", () => {
  it("cùng nội dung ra cùng mã băm, khác nội dung ra khác", async () => {
    expect(await bamNgan("xin chao")).toBe(await bamNgan("xin chao"));
    expect(await bamNgan("xin chao")).not.toBe(await bamNgan("xin chao "));
  });

  it("dài đúng 12 ký tự hex — đủ phân biệt, mà không lộ nội dung", async () => {
    expect(await bamNgan("bat ky")).toMatch(/^[0-9a-f]{12}$/);
  });

  it("không có nội dung (đường delete) → chuỗi rỗng, không ném", async () => {
    expect(await bamNgan(undefined)).toBe("");
    expect(await bamNgan("")).toBe("");
  });

  it("payload khổng lồ vẫn băm được và vẫn bị cắt — không đốt CPU theo cỡ file", async () => {
    // Cỡ này xấp xỉ một bản .xlsx đã base64 nằm trong kho sfile:.
    const to = "a".repeat(300_000);
    expect(await bamNgan(to)).toMatch(/^[0-9a-f]{12}$/);
    // Hai bản chỉ khác nhau SAU mốc cắt nhưng CÙNG độ dài → cùng mã băm. Đây là đánh đổi đã biết
    // và đã ghi rõ trong code, không phải lỗi: thứ cần soi là kho mtld, cỡ vài chục KB.
    expect(await bamNgan(to + "X")).not.toBe(await bamNgan(to + "YZ"));   // khác độ dài → khác băm
  });
});

describe("demGhiKv — đồng hồ đo không được làm hỏng thứ nó đo", () => {
  it("ghi đúng MỘT dòng đếm, mang theo tên kho và mã băm", async () => {
    const f = d1Gia();
    g.__env__ = { PMO_LOG: f.d1 };
    await demGhiKv("mtld:install:list:v2", '{"a":1}');
    const chen = f.chen();
    expect(chen.length).toBe(1);
    expect(chen[0].tham[1]).toBe("mtld");                       // chỉ tên kho, KHÔNG phải khoá đầy đủ
    expect(chen[0].tham[2]).toBe(await bamNgan('{"a":1}'));
  });

  it("hai payload KHÁC nhau trên cùng một khoá → hai mã băm khác nhau", async () => {
    // Đây chính là câu hỏi cả việc này sinh ra để trả lời: 63 lượt ghi kia là 63 nội dung khác nhau
    // hay một nội dung ghi 63 lần.
    const f = d1Gia();
    g.__env__ = { PMO_LOG: f.d1 };
    await demGhiKv("mtld:x", "noi dung mot");
    await demGhiKv("mtld:x", "noi dung hai");
    const [a, b] = f.chen();
    expect(a.tham[2]).not.toBe(b.tham[2]);
  });

  it("bảng đời cũ chưa có cột bam → LÙI về ghi ba cột, dòng đếm KHÔNG mất", async () => {
    const f = d1Gia({ chanCot: true });
    g.__env__ = { PMO_LOG: f.d1 };
    await demGhiKv("media:abc", "gi do");
    const chen = f.chen();
    expect(chen.length).toBe(1);                                 // vẫn đúng một dòng, không mất
    expect(chen[0].sql).not.toContain("bam");
    expect(chen[0].tham[1]).toBe("media");
  });

  it("D1 chết hẳn → demGhiKv vẫn KHÔNG ném", async () => {
    const f = d1Gia({ hongHet: true });
    g.__env__ = { PMO_LOG: f.d1 };
    await expect(demGhiKv("mtld:x", "gi do")).resolves.toBeUndefined();
  });

  it("không có D1 → im lặng bỏ qua, không ném", async () => {
    g.__env__ = {};
    await expect(demGhiKv("mtld:x", "gi do")).resolves.toBeUndefined();
  });

  it("gọi kiểu cũ, không truyền nội dung (đường delete) → vẫn ghi được, băm rỗng", async () => {
    const f = d1Gia();
    g.__env__ = { PMO_LOG: f.d1 };
    await demGhiKv("edits:xoa");
    const chen = f.chen();
    expect(chen.length).toBe(1);
    expect(chen[0].tham[2]).toBe("");
  });
});

describe("LƯỢT GHI KV THẬT không bị đồng hồ đo làm hỏng", () => {
  /** Dựng đúng hình dạng `bocKv` đang dùng ở mtld-install.functions.ts và edits.functions.ts:
   *  ghi KV trước, đếm sau. Chốt bằng SỐ LƯỢT PUT — xem L14, chốt bằng dấu vết gián tiếp thì
   *  bản sai vẫn lọt. */
  it("D1 hỏng toàn tập thì lượt put vẫn đi qua và caller không thấy lỗi", async () => {
    const f = d1Gia({ hongHet: true });
    g.__env__ = { PMO_LOG: f.d1 };
    let soPut = 0;
    const kv = { put: async (_k: string, _v: string) => { soPut++; } };
    const boc = async (k: string, v: string) => { await kv.put(k, v); await demGhiKv(k, v); };
    await expect(boc("mtld:install:list:v2", "noi dung")).resolves.toBeUndefined();
    expect(soPut).toBe(1);
  });
});
