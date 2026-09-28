/**
 * GÁC BA ĐIỀU VỀ "HIỆN TẤT CẢ ĐẦU VIỆC" — mặc định BẬT, nhớ theo từng máy.
 *
 * Người dùng chốt với sếp họ: mở app là thấy đủ đầu việc, ai muốn gọn thì tắt và máy đó nhớ luôn.
 * Thứ dễ bị lật lại nhất là **mặc định**: nó chỉ là một chữ `true`, và người dọn code thấy
 * `useState(true)` cạnh một `useEffect` đọc localStorage rất dễ "gọn hoá" thành đọc thẳng trong
 * `useState` — vừa mất mặc định vừa lệch hydration.
 *
 * ĐÂY LÀ LỚP GÁC TẠM, KHÔNG THAY ĐƯỢC PHÉP KIỂM HÀNH VI. Nó đọc mã nguồn bằng `fs` rồi soi chữ,
 * nên chốt được HÌNH DÁNG chứ không chốt HÀNH VI: nó không chứng minh app thật sự mở ra ở trạng
 * thái bật. Cùng lối với `tests/excel-mau-khop-app.test.ts` — và cũng như file đó, **có phép tự
 * gác**: regex hết khớp thì đỏ to chứ không xanh im lặng trên một tập rỗng.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(fileURLToPath(new URL("../src/routes/index.tsx", import.meta.url)), "utf8");

/** Khối khai `showDone` + `useEffect` nạp bản đã lưu + hàm đổi. Cắt từ `const [showDone` tới hết
 *  `doiShowDone`, đủ rộng để soi cả ba điều mà không dính phần khác của file. */
function khoiShowDone(): string {
  const i = SRC.indexOf("const [showDone");
  const j = SRC.indexOf("const doiShowDone");
  const k = SRC.indexOf("}, []);", j);
  return i >= 0 && j > i && k > j ? SRC.slice(i, k + 7) : "";
}

describe("tự gác — regex còn khớp thì phép kiểm dưới mới có nghĩa", () => {
  it("tìm được khối khai showDone trong index.tsx", () => {
    // Không có phép này thì đổi tên biến là mọi phép kiểm dưới xanh trên một chuỗi rỗng.
    const kh = khoiShowDone();
    expect(kh.length, "không cắt được khối showDone — đổi tên biến thì sửa cả file kiểm này").toBeGreaterThan(200);
    expect(kh).toContain("useState");
    expect(kh).toContain("localStorage");
  });

  it("tìm được hằng khoá lưu", () => {
    expect(/const LS_SHOW_DONE\s*=\s*"[^"]+"/.test(SRC), "không thấy khai LS_SHOW_DONE").toBe(true);
  });
});

describe("ba điều phải giữ", () => {
  it("MẶC ĐỊNH LÀ BẬT — đây là thứ người dùng vừa yêu cầu đổi, và dễ bị lật nhất", () => {
    expect(khoiShowDone()).toMatch(/const \[showDone, setShowDone\] = useState\(true\)/);
  });

  it("khoá lưu có hậu tố phiên bản", () => {
    const khoa = /const LS_SHOW_DONE\s*=\s*"([^"]+)"/.exec(SRC)?.[1] ?? "";
    expect(khoa).toBeTruthy();
    expect(khoa, `khoá "${khoa}" thiếu hậu tố phiên bản kiểu .v1`).toMatch(/\.v\d+$/);
  });

  it("chỉ nhận đúng hai chuỗi \"0\" và \"1\", không JSON.parse", () => {
    const kh = khoiShowDone();
    expect(kh).toContain('=== "0"');
    expect(kh).toContain('=== "1"');
    // JSON.parse trên chuỗi rác sẽ NÉM, mà ném ở đây là chặn cả lượt vẽ chỉ vì một thiết lập hiển thị.
    expect(kh).not.toContain("JSON.parse");
  });

  it("KHÔNG đọc localStorage ngay trong useState — đọc ở đó là lệch hydration", () => {
    // Máy chủ dựng HTML không có localStorage, nên lượt vẽ đầu của trình duyệt phải là hằng.
    const kh = khoiShowDone();
    const dongUseState = /const \[showDone, setShowDone\] = useState\(([^)]*)\)/.exec(kh)?.[1] ?? "";
    expect(dongUseState.trim()).toBe("true");
    expect(dongUseState).not.toContain("localStorage");
  });

  it("đọc và ghi đều được bọc try/catch — trình duyệt chặn lưu trữ thì app vẫn chạy", () => {
    const kh = khoiShowDone();
    expect((kh.match(/try\s*\{/g) ?? []).length, "cần ít nhất hai try: một cho đọc, một cho ghi").toBeGreaterThanOrEqual(2);
  });

  it("KHÔNG đẩy lựa chọn này lên KV — đây là thiết lập của từng máy", () => {
    // Mỗi lượt bấm của 10–17 người ăn thẳng vào trần 1.000 lượt ghi KV mỗi ngày.
    const kh = khoiShowDone();
    for (const cam of ["saveInstallList", "kv.put", "PMO_EDITS", "saveProjRegions"])
      expect(kh, `khối showDone không được gọi ${cam}`).not.toContain(cam);
  });
});
