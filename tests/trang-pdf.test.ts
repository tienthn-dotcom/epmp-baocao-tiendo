/* DÁN NHIỀU TRANG cho popup ma trận.
 *
 * Đọc hụt một dòng ở đây là THIẾU HẲN MỘT TRANG trong bản xuất, mà không có lỗi nào hiện ra —
 * người gắn link tưởng đã có 1A đến 2B, mở ra chỉ thấy ba trang. Nên gác từng kiểu gõ.
 */
import { describe, expect, it } from "vitest";
import { docNhieuTrang, laVungA1, nhanTrang } from "@/lib/trang-pdf";

describe("nhận ra vùng kiểu A1", () => {
  for (const x of ["A1", "B2:M45", "AA10:AC300", "a1:h30"]) {
    it(`nhận "${x}"`, () => expect(laVungA1(x)).toBe(true));
  }
  for (const x of ["", "1A", "Phòng 1A", "A", "12", "A1:B", "Sheet1!A1:B2"]) {
    it(`không nhận "${x}"`, () => expect(laVungA1(x)).toBe(false));
  }
});

describe("mỗi dòng một trang", () => {
  it("tách bằng dấu gạch dọc", () => {
    expect(docNhieuTrang("1A | B2:M45")).toEqual([{ sheet: "1A", range: "B2:M45" }]);
  });
  it("tách bằng khoảng trắng", () => {
    expect(docNhieuTrang("1A B2:M45")).toEqual([{ sheet: "1A", range: "B2:M45" }]);
  });
  it("tách bằng dấu phẩy", () => {
    expect(docNhieuTrang("1A,B2:M45")).toEqual([{ sheet: "1A", range: "B2:M45" }]);
  });
  it("chỉ có tên tab thì xem cả tab", () => {
    expect(docNhieuTrang("1A")).toEqual([{ sheet: "1A" }]);
  });
  it("chỉ có vùng thì dùng tab của trang đầu", () => {
    expect(docNhieuTrang("B2:M45")).toEqual([{ range: "B2:M45" }]);
  });

  /* TÊN TAB CÓ KHOẢNG TRẮNG — đây là chỗ dễ sai nhất. Cắt theo khoảng trắng đầu tiên thì
     "Phòng 1A B2:M45" ra tab "Phòng" và mất phần "1A". Phải dò ô nào là vùng A1 trước. */
  it("tên tab có khoảng trắng vẫn ra đúng", () => {
    expect(docNhieuTrang("Phòng 1A B2:M45")).toEqual([{ sheet: "Phòng 1A", range: "B2:M45" }]);
  });
  it("tên tab có khoảng trắng, không có vùng", () => {
    expect(docNhieuTrang("Khu Public tầng 3")).toEqual([{ sheet: "Khu Public tầng 3" }]);
  });

  it("cột thứ ba là nhãn", () => {
    expect(docNhieuTrang("1A | B2:M45 | Tầng 1 khu A")).toEqual([{ sheet: "1A", range: "B2:M45", ten: "Tầng 1 khu A" }]);
  });
});

describe("dán nhiều dòng một lượt", () => {
  const ra = docNhieuTrang(["1A | B2:M45", "", "  1B | B2:M45  ", "2A B2:M60", "2B"].join("\n"));
  it("bỏ dòng trống, giữ đủ bốn trang", () => expect(ra.length).toBe(4));
  it("đúng thứ tự người ta gõ", () => {
    expect(ra.map((t) => t.sheet)).toEqual(["1A", "1B", "2A", "2B"]);
  });
  it("cắt khoảng trắng hai đầu", () => expect(ra[1]).toEqual({ sheet: "1B", range: "B2:M45" }));
  it("chịu được xuống dòng kiểu Windows", () => {
    expect(docNhieuTrang("1A | A1\r\n1B | A1").length).toBe(2);
  });
  it("ô rỗng ra danh sách rỗng", () => {
    expect(docNhieuTrang("")).toEqual([]);
    expect(docNhieuTrang("  \n \n ")).toEqual([]);
  });
});

describe("nhãn trên đầu trang", () => {
  it("ưu tiên nhãn người dùng đặt", () => {
    expect(nhanTrang({ ten: "Tầng 1", sheet: "1A", range: "A1" }, 2)).toBe("Tầng 1");
  });
  it("không có nhãn thì lấy tên tab", () => expect(nhanTrang({ sheet: "1A", range: "A1" }, 2)).toBe("1A"));
  it("không có tab thì lấy vùng", () => expect(nhanTrang({ range: "B2:M45" }, 2)).toBe("B2:M45"));
  it("trống hết thì theo thứ tự", () => expect(nhanTrang({}, 3)).toBe("Trang 3"));
});
