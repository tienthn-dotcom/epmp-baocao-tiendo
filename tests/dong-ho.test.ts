/**
 * ĐỒNG HỒ ĐO LÚC MỞ APP — ràng buộc nặng nhất là NÓ KHÔNG ĐƯỢC LÀM HỎNG ĐƯỜNG MỞ APP.
 *
 * Vì sao chốt bằng HÀNH VI chứ không bằng dấu vết: ở vòng V2b, một phép kiểm chốt bằng dấu thời
 * gian đã ra XANH GIẢ — nó xanh vì lý do khác chứ không vì thứ nó tưởng đang kiểm. Nên ở đây
 * không phép nào hỏi "có gọi hàm X không". Mỗi phép dựng một `đườngMởApp()` mang đúng hình dạng
 * của `queryFn` thật trong `index.tsx`:
 *
 *     try { …; moc("nguon"); …; moc("doc"); chotDongHo(); return BẢN_THẬT; }
 *     catch { return BẢN_DỰ_PHÒNG; }
 *
 * rồi phá đồng hồ bằng mọi cách nghĩ ra được, và hỏi đúng một câu: **hàm đó trả về gì?**
 * Trả `BẢN_THẬT` nghĩa là đường mở app chạy trọn. Trả `BẢN_DỰ_PHÒNG` nghĩa là đồng hồ vừa đẩy app
 * sang đường tải khác trong im lặng — đúng con hỏng mà ràng buộc 1 sinh ra để chặn, và nó sẽ
 * KHÔNG hiện ra ở bất kỳ phép kiểm nào chỉ đếm lời gọi.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { moc, chotDongHo, datLaiDongHo, xemMoc } from "@/lib/dong-ho";

const THAT = "BẢN_THẬT";
const DU_PHONG = "BẢN_DỰ_PHÒNG";

/** Dựng lại ĐÚNG hình dạng khối try/catch của `queryFn` trong index.tsx, kèm đường rơi CSV. */
function duongMoApp(): { ket: string; goi: string | null } {
  let goi: string | null = null;
  try {
    moc("nguon");
    // chỗ này thật ra là atob + parseXlsxBuffer — không liên quan đồng hồ
    moc("doc");
    goi = chotDongHo();
    return { ket: THAT, goi };
  } catch {
    return { ket: DU_PHONG, goi };
  }
}

const g = globalThis as unknown as Record<string, unknown>;
let perfGoc: unknown;
let stringifyGoc: typeof JSON.stringify;

beforeEach(() => {
  perfGoc = g.performance;
  stringifyGoc = JSON.stringify;
  datLaiDongHo();
});
afterEach(() => {
  g.performance = perfGoc;
  JSON.stringify = stringifyGoc;
  datLaiDongHo();
});

describe("đồng hồ hỏng kiểu gì thì đường mở app vẫn chạy trọn", () => {
  it("không có `performance` (môi trường lạ) → vẫn ra BẢN THẬT, chỉ là không có số", () => {
    delete g.performance;
    const r = duongMoApp();
    expect(r.ket).toBe(THAT);
    expect(r.goi).toBeNull();      // không đo được thì không ghi gì, KHÔNG ghi số rác
  });

  it("`performance.now` NÉM LỖI mỗi lần gọi → vẫn ra BẢN THẬT", () => {
    g.performance = { now: () => { throw new Error("đồng hồ hỏng"); } };
    const r = duongMoApp();
    expect(r.ket).toBe(THAT);
    expect(r.goi).toBeNull();
  });

  it("`performance` có nhưng `now` không phải hàm → vẫn ra BẢN THẬT", () => {
    g.performance = { now: 123 };
    expect(duongMoApp().ket).toBe(THAT);
  });

  it("`performance.now` trả NaN / Infinity / số âm → không ghi mốc rác, vẫn ra BẢN THẬT", () => {
    for (const xau of [NaN, Infinity, -1]) {
      datLaiDongHo();
      // PHẢI đặt `trang` bằng một đồng hồ TỐT trước. Nếu để thiếu mốc này thì `chotDongHo()` trả
      // null vì THIẾU MỐC chứ không phải vì lọc được số rác — phép kiểm sẽ xanh mà chẳng chứng
      // minh gì, kể cả khi lớp lọc `isFinite` bị gỡ.
      g.performance = { now: () => 10 };
      moc("trang");
      g.performance = { now: () => xau };
      const r = duongMoApp();
      expect(r.ket, String(xau)).toBe(THAT);
      // Số rác bị chặn ở `moc` → thiếu `nguon`/`doc` → không ghi dòng nào.
      expect(r.goi, String(xau)).toBeNull();
      expect(xemMoc().nguon, String(xau)).toBeUndefined();
    }
  });

  it("`JSON.stringify` NÉM LỖI lúc chốt → vẫn ra BẢN THẬT", () => {
    // Chỗ duy nhất trong đồng hồ có thể ném mà không phải `performance`.
    let t = 0;
    g.performance = { now: () => (t += 10) };
    moc("trang");
    JSON.stringify = (() => { throw new Error("stringify hỏng"); }) as typeof JSON.stringify;
    const r = duongMoApp();
    expect(r.ket).toBe(THAT);
    expect(r.goi).toBeNull();
  });

  it("đồng hồ đọc được bình thường → đường mở app vẫn ra BẢN THẬT (phép ĐỐI CHỨNG)", () => {
    // Không có phép này thì năm phép trên xanh mà chẳng chứng minh gì: phải thấy `duongMoApp`
    // CÓ THỂ trả gói đo, mới biết những lần trả `null` kia là do đồng hồ bị phá.
    let t = 0;
    g.performance = { now: () => (t += 10) };
    moc("trang");
    const r = duongMoApp();
    expect(r.ket).toBe(THAT);
    expect(r.goi).not.toBeNull();
  });
});

describe("một dòng mỗi lượt mở app, không hơn", () => {
  beforeEach(() => {
    let t = 0;
    g.performance = { now: () => (t += 10) };
  });

  it("đủ ba mốc → chốt ra chuỗi; gọi lại lần hai → null", () => {
    moc("trang"); moc("nguon"); moc("doc");
    expect(chotDongHo()).not.toBeNull();
    expect(chotDongHo()).toBeNull();
    expect(chotDongHo()).toBeNull();
  });

  it("TẢI LẠI DỮ LIỆU không sinh dòng thứ hai — đây là chỗ dễ đội số nhất", () => {
    // V10 giữ dữ liệu 5 phút, người dùng bấm làm mới hoặc chuyển qua lại màn hình → `queryFn`
    // chạy lại. Nếu mỗi lượt đó ghi một dòng thì số dòng D1 KHÔNG còn bằng số lượt mở app.
    moc("trang");
    const lan1 = duongMoApp();
    const lan2 = duongMoApp();
    const lan3 = duongMoApp();
    expect(lan1.goi).not.toBeNull();
    expect(lan2.goi).toBeNull();
    expect(lan3.goi).toBeNull();
    expect([lan1.ket, lan2.ket, lan3.ket]).toEqual([THAT, THAT, THAT]);
  });

  it("BẢN DEMO không bao giờ ghi dòng nào — chỉ có mốc `trang`, thiếu hai mốc kia", () => {
    moc("trang");
    expect(chotDongHo()).toBeNull();
  });

  it("thiếu ĐÚNG MỘT mốc bất kỳ cũng không ghi", () => {
    for (const bo of ["trang", "nguon", "doc"] as const) {
      datLaiDongHo();
      for (const m of ["trang", "nguon", "doc"] as const) if (m !== bo) moc(m);
      expect(chotDongHo(), "thiếu " + bo).toBeNull();
    }
  });
});

describe("số đo ghi ra đúng thứ cần đọc", () => {
  it("mỗi mốc lấy lần ĐẦU, lần sau không ghi đè", () => {
    let t = 0;
    g.performance = { now: () => (t += 100) };
    moc("trang");                       // 100
    moc("trang"); moc("trang");         // phải bị bỏ qua
    expect(xemMoc().trang).toBe(100);
  });

  it("chuỗi chốt là JSON có đủ ba mốc và số phiên bản", () => {
    let t = 0;
    g.performance = { now: () => (t += 100) };
    moc("trang"); moc("nguon"); moc("doc");
    const s = chotDongHo()!;
    expect(JSON.parse(s)).toEqual({ v: 1, trang: 100, nguon: 200, doc: 300 });
  });

  it("chuỗi ngắn hơn hẳn mốc 300 ký tự mà `recordActivity` chặn", () => {
    let t = 0;
    g.performance = { now: () => (t += 1_234_567) };   // số to bất thường
    moc("trang"); moc("nguon"); moc("doc");
    expect(chotDongHo()!.length).toBeLessThan(100);
  });

  it("mốc làm tròn về số nguyên mili giây — nhật ký không cần phần thập phân", () => {
    g.performance = { now: () => 123.456 };
    moc("trang");
    expect(xemMoc().trang).toBe(123);
  });
});
