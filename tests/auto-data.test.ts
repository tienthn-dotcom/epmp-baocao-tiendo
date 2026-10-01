/**
 * Đọc ngày update từ tab AutoData của file tuân thủ.
 *
 * Ca thật 01/10/2026: lịch sử app dừng ở 24/09, AutoData ghi 50 dự án 30/09 và 14 dự án 29/09.
 * Đọc sai chỗ này là cả một cột tuần trống trơn trong báo cáo gửi Ban điều hành.
 */
import { describe, it, expect } from "vitest";
import { docAutoData, ngayIso, chuanTen, urlTab } from "@/lib/auto-data";

const CSV = [
  '"STT","Tên dự án","PM","Location","Ngày update","KEY","Đồng bộ lúc"',
  '"1","Chairman Villa Phú Quốc","Trần Viết Nghị","PQ","30/09/2026","N:chairman","2026-10-01 08:44"',
  '"2","Sunset Town High Rise_B4.7 [SPMD]","Trịnh Nguyễn Xuân Hiển","PQ","29/09/2026","N:sunset",""',
  '"3","Trục Đông Tây 2C_Phòng (F12 & F18)","Đặng Ngọc Sáu/ Hồ Thành Thy Thơ","PQ","24/09/2026","N:truc",""',
].join("\n");

describe("đọc đúng ngày từ file nguồn", () => {
  const m = docAutoData(CSV);

  it("lấy đủ dự án có ngày", () => expect(m.size).toBe(3));

  it("đổi dd/mm/yyyy sang ISO", () => {
    expect(m.get(chuanTen("Chairman Villa Phú Quốc"))).toBe("2026-09-30");
    expect(m.get(chuanTen("Sunset Town High Rise_B4.7 [SPMD]"))).toBe("2026-09-29");
  });

  it("tra được dù gõ khác dấu / khác hoa thường", () => {
    expect(m.get(chuanTen("CHAIRMAN VILLA PHU QUOC"))).toBe("2026-09-30");
  });

  it("ô có dấu phẩy bên trong không làm lệch cột", () => {
    expect(m.get(chuanTen("Trục Đông Tây 2C_Phòng (F12 & F18)"))).toBe("2026-09-24");
  });
});

describe("dò cột theo TIÊU ĐỀ chứ không theo vị trí", () => {
  it("file nguồn chèn thêm cột ở đầu vẫn đọc đúng", () => {
    const csv = [
      '"Ghi chú","STT","Tên dự án","Ngày update"',
      '"x","1","Villa Tulip 3","30/09/2026"',
    ].join("\n");
    expect(docAutoData(csv).get(chuanTen("Villa Tulip 3"))).toBe("2026-09-30");
  });

  it("thiếu cột cần thì trả rỗng, KHÔNG đoán theo vị trí", () => {
    expect(docAutoData('"A","B"\n"1","2"').size).toBe(0);
  });

  it("CSV rỗng không làm vỡ", () => {
    expect(docAutoData("").size).toBe(0);
    expect(docAutoData("   ").size).toBe(0);
  });
});

describe("một dự án nhiều dòng thì giữ ngày MỚI NHẤT", () => {
  it("không phụ thuộc thứ tự dòng", () => {
    const csv = [
      '"Tên dự án","Ngày update"',
      '"A","30/09/2026"',
      '"A","15/09/2026"',
      '"B","15/09/2026"',
      '"B","30/09/2026"',
    ].join("\n");
    const m = docAutoData(csv);
    expect(m.get("a")).toBe("2026-09-30");
    expect(m.get("b")).toBe("2026-09-30");
  });
});

describe("ngày rác thì bỏ, không bịa", () => {
  for (const x of ["", "  ", "30-09-2026", "2026/09/30", "hôm qua", "45/13/2026", "30/09/26"]) {
    it(JSON.stringify(x), () => expect(ngayIso(x)).toBeNull());
  }
  it("ngày hợp lệ thì nhận", () => expect(ngayIso("01/10/2026")).toBe("2026-10-01"));
  it("dòng có ngày rác bị bỏ qua, dòng còn lại vẫn đọc", () => {
    const csv = '"Tên dự án","Ngày update"\n"A","hôm qua"\n"B","30/09/2026"';
    const m = docAutoData(csv);
    expect(m.has("a")).toBe(false);
    expect(m.get("b")).toBe("2026-09-30");
  });
});

describe("url tab", () => {
  it("bọc tên tab có khoảng trắng", () => {
    expect(urlTab("ID1", "Auto Data")).toContain("sheet=Auto%20Data");
  });
});
