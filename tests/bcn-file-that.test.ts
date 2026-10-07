/* ĐỌC FILE NGUỒN BÁO CÁO TUÂN THỦ MỖI NGÀY — chạy trên LƯỚI THẬT, không phải lưới bịa.
 *
 * Anh Tiến 07/10/2026: *"tôi vẫn chưa thấy báo cáo tuân thủ mỗi ngày đâu nhé, triển khai dần đi"*.
 * Bộ đọc (`bcn-file.ts`) viết từ 05/10 lúc CHƯA mở được quyền file, tức viết theo mô tả chứ chưa
 * từng chạm dữ liệu thật. Nay quyền đã mở, nên việc đầu tiên là cho nó chạy trên lưới thật rồi mới
 * tính tiếp — bộ đọc sai thì mọi thứ dựng trên nó đều sai mà nhìn vẫn như đúng.
 *
 * Mẫu `tests/fixtures/bcn-bangcham.json` là 14 dòng đầu + 30 dòng dữ liệu, lấy nguyên từ tab
 * BCN_BangCham ngày 07/10/2026. KHÔNG sửa tay mẫu này: nó có giá trị đúng vì nó là bản chụp thật.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBcnGrid } from "@/lib/bcn-file";

const grid = JSON.parse(readFileSync(resolve(__dirname, "fixtures/bcn-bangcham.json"), "utf8")) as unknown[][];
const d = parseBcnGrid(grid);

describe("nhận dạng được bảng", () => {
  it("tìm ra dòng tiêu đề và đọc được dự án", () => {
    expect(d.duAn.length).toBeGreaterThan(0);
  });
  it("mỗi dự án có đủ BA hạng mục: Quân số · Thi công lắp đặt · Sản lượng", () => {
    for (const p of d.duAn) expect(p.hangMuc.map((h) => h.ten)).toEqual(["Quân số", "Thi công lắp đặt", "Sản lượng"]);
  });
  it("đọc đúng mã CT · tên · PM của dự án đầu", () => {
    expect(d.duAn[0].stt).toBe(1);
    expect(d.duAn[0].vung).toBe("Phú Quốc");
    expect(d.duAn[0].maCT).toBe("CT26-040");
    expect(d.duAn[0].ten).toBe("Apec S2");
    expect(d.duAn[0].pm).toBe("Nguyễn Văn Có");
  });
  it("dự án KHÔNG có ô Vùng/PM riêng (ô gộp) vẫn thành dự án riêng", () => {
    // Dòng 2 trong file: "Apec S3" để trống Vùng và PM vì Sheet gộp ô với dòng trên.
    const p = d.duAn.find((x) => x.ten === "Apec S3");
    expect(p).toBeDefined();
    expect(p!.maCT).toBe("CT26-041");
  });
});

/* ĐÂY LÀ CA QUAN TRỌNG NHẤT. Ô ngày cuối trong file ghi "31" rồi XUỐNG DÒNG "T7". Bản đầu khớp
   cứng `^\d{1,2}$` nên chỉ nhận 30 cột — thiếu đúng ngày 31, mà thiếu im lặng: bảng vẫn vẽ, vẫn
   chấm, chỉ là một ngày biến mất khỏi phép tính. */
describe("cột ngày", () => {
  it("đủ 31 ngày — KHÔNG được rụng ngày cuối vì ô ghi kèm thứ", () => {
    expect(d.ngay).toHaveLength(31);
    expect(d.ngay[30].so).toBe("31");
  });
  it("số ngày liền mạch 01 → 31", () => {
    expect(d.ngay.map((n) => n.so)).toEqual(Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")));
  });
  it("đọc được thứ trong tuần, kể cả ngày cuối (thứ nằm trong chính ô ngày)", () => {
    expect(d.ngay[0].thu).toBe("T3");
    expect(d.ngay[30].thu).toBe("T7");
  });
  it("số dấu của mỗi hạng mục bằng đúng số cột ngày", () => {
    for (const p of d.duAn) for (const h of p.hangMuc) expect(h.marks).toHaveLength(d.ngay.length);
  });
});

describe("đọc dấu và tính điểm", () => {
  it("nhận ✓ là đúng hạn và O là trễ", () => {
    const qs = d.duAn[0].hangMuc[0];
    expect(qs.demP).toBeGreaterThan(0);
    expect(qs.demO).toBeGreaterThan(0);
  });
  /* Hạng mục CHƯA CÓ DẤU NÀO phải là null, KHÔNG phải 100 — cho 100 là khen người ta vì chưa làm
     gì, đúng loại sai âm thầm mà một báo cáo đánh giá người không được phép có. */
  it("hạng mục chưa có dấu nào → điểm null, không phải 100", () => {
    const trong = d.duAn.flatMap((p) => p.hangMuc).filter((h) => h.demP + h.demO + h.demX + h.demNa === 0);
    for (const h of trong) expect(h.diem).toBeNull();
  });
  it("điểm hạng mục nằm trong 0…100", () => {
    for (const p of d.duAn) for (const h of p.hangMuc) if (h.diem != null) {
      expect(h.diem).toBeGreaterThanOrEqual(0);
      expect(h.diem).toBeLessThanOrEqual(100);
    }
  });
});

describe("đầu báo cáo", () => {
  it("đọc được ngày cập nhật ghi trong file", () => {
    expect(d.ngayCapNhat).toBe("07/10/2026");
  });
});
