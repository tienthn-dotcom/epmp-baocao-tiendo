/* XEM LẠI THÁNG CŨ TRÊN BÁO CÁO TUÂN THỦ.
 *
 * Bản cũ của file test này kiểm đường app CHẤM LẠI tháng cũ từ lịch sử `updates:v1`. Đường đó đã
 * bị bỏ ngày 01/10/2026 vì tiền đề của nó sai — file tuân thủ KHÔNG chỉ giữ tháng đang chạy, nó
 * giữ đủ 24 cột tuần từ 06/05 tới 28/10. Chấm lại cho ra tháng 9 với 67/84 dự án, điểm âm, một
 * rừng dấu ✕, trong khi file ghi cột 30/09 là 63 ✓ / 21 ✕.
 *
 * Nay xem tháng cũ = ĐỌC ĐÚNG NHÓM CỘT TUẦN của tháng đó trong chính file. Test này gác cửa đó:
 * không đường nào trong app được tự sinh ra dấu ✓/✕.
 */
import { describe, expect, it } from "vitest";
import { nhanThang } from "@/lib/tuan-thu-thang";
import { parseComplianceFile } from "@/lib/compliance-file";

/* File thật có 24 cột tuần; ở đây dựng bản rút gọn ĐÚNG hình dạng: dòng "THÁNG 10/2026" phía
 * trên, dòng header có Location/STT/Tên dự án, rồi các cột dd/mm của NHIỀU tháng cạnh nhau. */
const CSV = [
  ",,,BÁO CÁO TUÂN THỦ THÁNG 10/2026",
  ",,,Ngày cập nhật:,,01/10/2026",
  "",
  "Location,STT,Tên dự án,Người phụ trách,Lũy kế,Điểm tuân thủ,16/09,23/09,30/09,07/10,14/10",
  "HN,1,Du an A,PM Mot,0,100,✓,x,✓,,",
  "HN,2,Du an B,PM Hai,0,100,x,x,o,,",
  "SG,3,Du an C,PM Ba,0,100,✓,✓,✓,,",
].join("\n");

describe("nhãn tháng", () => {
  it("đổi đúng kiểu file đang dùng", () => {
    expect(nhanThang("2026-09")).toBe("09/2026");
    expect(nhanThang("2026-12")).toBe("12/2026");
  });
});

describe("đọc file tuân thủ — tháng mặc định là tháng file đang chạy", () => {
  const ra = parseComplianceFile(CSV);
  it("lấy tháng file tự khai", () => expect(ra.monthLabel).toBe("10/2026"));
  it("chỉ lấy cột tuần của tháng đó", () => expect(ra.weeks).toEqual(["07/10", "14/10"]));
  it("tháng 10 chưa ai gõ gì → không có dấu nào", () => {
    expect(ra.rows.every(r => r.marks.every(m => m === null))).toBe(true);
  });
  it("kể đủ các tháng CÓ TRONG FILE để màn hình bày ra", () => {
    expect(ra.thangCo).toEqual(["2026-09", "2026-10"]);
  });
});

describe("XEM LẠI THÁNG 9 — dấu phải là dấu trong file, không phải app chấm", () => {
  const ra = parseComplianceFile(CSV, "2026-09");

  it("đổi nhãn tháng và nhóm cột tuần sang tháng đang xem", () => {
    expect(ra.monthLabel).toBe("09/2026");
    expect(ra.weeks).toEqual(["16/09", "23/09", "30/09"]);
  });

  it("bê NGUYÊN dấu ✓ / ✕ / o của từng dự án", () => {
    expect(ra.rows.map(r => r.marks)).toEqual([
      ["P", "x", "P"],
      ["x", "x", "o"],
      ["P", "P", "P"],
    ]);
  });

  it("đếm đúng số lần không cập nhật và trễ", () => {
    expect(ra.rows.map(r => [r.countX, r.countO])).toEqual([[1, 0], [2, 1], [0, 0]]);
  });

  /* Cột "Điểm tuân thủ" trong file là điểm THÁNG ĐANG CHẠY (Apps Script ghi đè mỗi tháng), nên
   * xem tháng cũ mà lấy cột đó thì mọi dự án mang điểm 100 của tháng 10. Phải tính lại từ chính
   * dấu của tháng đang xem, bằng đúng công thức file ghi: 100 − 25·x − 10·o. */
  it("KHÔNG mượn cột điểm của tháng đang chạy", () => {
    expect(ra.rows.map(r => r.score)).toEqual([75, 40, 100]);
  });

  it("bỏ nhãn 'Ngày cập nhật' của tháng đang chạy — nó không nói gì về tháng cũ", () => {
    expect(ra.updatedLabel).toBeNull();
  });

  /* GÁC: phép đo có răng. Tháng đang chạy VẪN đọc cột điểm của file (100), nên nếu một hôm ai đó
   * bắt mọi tháng tự tính thì con số dưới đây đổi và test đỏ. */
  it("tháng đang chạy thì vẫn lấy cột điểm của file", () => {
    expect(parseComplianceFile(CSV).rows.map(r => r.score)).toEqual([100, 100, 100]);
  });
});
