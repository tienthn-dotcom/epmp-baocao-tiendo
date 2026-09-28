/* Ô VƯỚNG MẮC CẤP DỰ ÁN trộn HAI NGUỒN trong cùng một mảng message: câu của bộ phận OCC ghi trong
 * FILE NGUỒN (id = MSG_NGUON) đứng trước, rồi tới các ghi chú người dùng gõ trong app.
 *
 * Báo cáo PDF một-dự-án trước đây in `projNoteMsgs[length - 1]` — TIN CUỐI CÙNG. Nghĩa là chỉ cần
 * một người gõ thêm một câu là câu của OCC RỤNG KHỎI BÁO CÁO, im lặng, không ai biết. Test này giữ
 * cửa đó: in đủ, và nói rõ câu nào của file nguồn.
 *
 * Gọi THẲNG buildHtml (chuỗi HTML thật), không gọi exportProjectPdf — hàm kia dynamic-import
 * jsPDF/html2canvas, cần trình duyệt, và cái cần nghiệm thu là NỘI DUNG chứ không phải việc vẽ. */
import { describe, expect, it } from "vitest";
import { buildHtml } from "@/lib/pdf-project-report";
import { MSG_NGUON } from "@/lib/types";
import type { ChatMsg } from "@/lib/edits.functions";
import type { PptReportInput } from "@/lib/ppt-report";

const CHU_NGUON = "Chu cua bo phan OCC ghi trong file nguon";
const CHU_APP = "Ghi chu nguoi dung go trong app";

const tinNguon: ChatMsg = { id: MSG_NGUON, text: CHU_NGUON, author: "", at: "" };
const tinApp: ChatMsg = { id: "m1", text: CHU_APP, author: "tien.than@example.com", at: "2026-09-28T03:00:00.000Z" };

function html(msgs: ChatMsg[]): string {
  const input: PptReportInput = { name: "Du an thu", code: "CT26-999", items: [], projNoteMsgs: msgs };
  return buildHtml(input);
}

describe("PDF một dự án — ô vướng mắc cấp dự án", () => {
  it("chỉ có chữ file nguồn → in ra chữ đó", () => {
    const h = html([tinNguon]);
    expect(h).toContain(CHU_NGUON);
  });

  it("GÕ THÊM ghi chú thì chữ của file nguồn KHÔNG được rụng — đây là lỗi cũ", () => {
    const h = html([tinNguon, tinApp]);
    expect(h).toContain(CHU_NGUON);
    expect(h).toContain(CHU_APP);
  });

  it("gõ thêm HAI ghi chú thì cả ba câu đều còn", () => {
    const tin2: ChatMsg = { ...tinApp, id: "m2", text: "Cau thu hai" };
    const h = html([tinNguon, tinApp, tin2]);
    for (const c of [CHU_NGUON, CHU_APP, "Cau thu hai"]) expect(h).toContain(c);
  });

  it("nói rõ câu nào của file nguồn, và câu gõ trong app mang tên người gõ", () => {
    const h = html([tinNguon, tinApp]);
    expect(h).toContain("OCC · file nguồn");
    // Tên người gõ = phần trước @ của email, đủ để biết hỏi ai; KHÔNG in cả email vào báo cáo.
    expect(h).toContain("tien.than");
    expect(h).not.toContain("tien.than@example.com");
  });

  it("tin ẩn thì không in — ẩn nghĩa là đã xử lý xong", () => {
    const h = html([tinNguon, { ...tinApp, hidden: true }]);
    expect(h).toContain(CHU_NGUON);
    expect(h).not.toContain(CHU_APP);
  });

  it("không có vướng mắc nào thì không in khối đó", () => {
    expect(html([])).not.toContain("VƯỚNG MẮC CẤP DỰ ÁN");
  });

  it("chữ trong ghi chú được escape, không chèn được thẻ HTML vào báo cáo", () => {
    const h = html([{ ...tinApp, text: "<b>day khong duoc la the dam</b>" }]);
    expect(h).toContain("&lt;b&gt;");
    expect(h).not.toContain("<b>day khong duoc la the dam");
  });

  /* Đếm số KHỐI trong mục "Vướng mắc cấp dự án" — KHÔNG kiểm trên cả trang HTML. Lý do: trang báo
   * cáo còn mục VIỆC CẦN XỬ LÝ do analyze() dựng, mà chỗ đó CŨNG lấy ghi chú cấp dự án (theo lối
   * "chỉ tin cuối" của ppt-report.ts). Kiểm trên cả trang là đo nhầm hai mục vào làm một. */
  const soKhoi = (h: string) => (h.match(/letter-spacing:\.4px/g) ?? []).length;

  it("quá nhiều ghi chú thì cắt bớt NHƯNG NÓI RÕ còn bao nhiêu — không bỏ im lặng", () => {
    const nhieu = Array.from({ length: 8 }, (_, i) => ({ ...tinApp, id: `m${i}`, text: `Ghi chu so ${i}` }));
    const h = html([tinNguon, ...nhieu]);
    expect(h).toContain(CHU_NGUON);   // tin nguồn đứng đầu nên luôn được in
    expect(h).toContain("Ghi chu so 0");
    expect(soKhoi(h)).toBe(5);        // trần 5 khối, không in hết 9
    expect(h).toContain("còn 4 ghi chú nữa");
  });

  it("chưa chạm trần thì KHÔNG hiện câu 'còn … ghi chú nữa'", () => {
    expect(html([tinNguon, tinApp])).not.toMatch(/còn \d+ ghi chú nữa/);
  });

  /* Bảng đã CẮT nhãn "OCC:" khỏi câu của file nguồn, trong khi ghi chú gõ trong app thường chép
   * NGUYÊN câu kèm nhãn. Chỗ so trùng của analyze() phải nhận ra hai câu đó là MỘT, nếu không thì
   * một vướng mắc bị kể hai lần trong báo cáo. Đếm số lần câu đó xuất hiện: 1 ở mục Vướng mắc cấp
   * dự án + 1 ở mục Việc cần xử lý = 2. Thành 3 là đã nhân bản. */
  it("ghi chú hạng mục chép lại câu của file nguồn (còn nhãn OCC:) KHÔNG bị kể thành vướng mắc thứ hai", () => {
    const CAU = "Van de mot cau duy nhat";
    // Dựng ItemRow tối giản: analyze() chỉ đọc owner/deadline/overdueDays/tc2 trên nhánh này.
    const it = { projectCode: "CT26-999", projectName: "Du an thu", cdt: "", maCT: "CT26-999", owner: "Ai do", deadline: "2026-09-30" } as unknown as PptReportInput["items"][number];
    const h = buildHtml({
      name: "Du an thu", code: "CT26-999", items: [it],
      projNoteMsgs: [{ ...tinNguon, text: CAU }],
      itemEdits: [{ it, noteMsgs: [{ ...tinApp, text: `OCC: ${CAU}` }] }],
    });
    expect(h.split(CAU).length - 1).toBe(2);
  });

  /* TỰ GÁC: nếu một hôm ai đó quay về lối "chỉ in tin cuối", các test trên phải ĐỎ. Kiểm bằng cách
   * dựng đúng phép lấy tin cuối rồi xác nhận nó THIẾU chữ của file nguồn — tức phép đo có răng. */
  it("phép đo có răng: lối 'chỉ in tin cuối' đúng là làm mất chữ file nguồn", () => {
    const msgs = [tinNguon, tinApp];
    const chiTinCuoi = msgs[msgs.length - 1].text;
    expect(chiTinCuoi).not.toContain(CHU_NGUON);
  });
});

// Regex cắt tiền tố "PMO:" của tin file nguồn TỪNG BỊ MẤT DẤU \ — chỗ đáng là \s biến thành s trơn —
// vì một lần sửa bằng chuỗi shell. Mất dấu thì "PMO :" hay có khoảng trắng đứng trước sẽ không được
// cắt, và ô hiện CẢ badge OCC lẫn chữ "PMO:". Đọc thẳng mã nguồn vì hàm đó nằm trong component,
// không export ra được.
describe("index.tsx — regex cắt tiền tố PMO không được mất dấu \\", () => {
  it("không còn dạng mất dấu nào", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/routes/index.tsx", "utf8");
    const hong = src.match(/\/\^s\*\(\?:PMO/g) ?? [];
    expect(hong).toEqual([]);
    // Và bản đúng phải CÓ MẶT ĐỦ HAI CHỖ (đường chữ thường và đường có đoạn gạch bỏ) — để test này
    // không xanh chỉ vì cả hai dạng đều biến mất.
    const dung = src.match(/\/\^\\s\*\(\?:PMO\|OCC\)\\s\*\[:：\]\\s\*\/i/g) ?? [];
    expect(dung).toHaveLength(2);
  });
});
