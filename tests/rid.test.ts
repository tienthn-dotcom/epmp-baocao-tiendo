/**
 * RID là số định danh dòng (kiểu số căn cước). Khoá phải BỀN qua mọi cách ghi tiền tố —
 * ngày 10/09 nguồn đổi "1" thành "ePMP 1" và cả kho ghi chú mất địa chỉ vì chuyện đó.
 */
import { describe, it, expect } from "vitest";
import { ridSo, ridKeys } from "@/lib/rid";

describe("ridSo — địa chỉ là PHẦN SỐ", () => {
  it("mọi cách ghi tiền tố đều ra cùng một số", () => {
    for (const v of ["682", "ePMP682", "ePMP 682", "EPMP-682", "  epmp  682 "]) {
      expect(ridSo(v)).toBe("682");
    }
  });
  it("bỏ số 0 thừa ở đầu", () => expect(ridSo("ePMP007")).toBe("7"));
});

describe("ridKeys", () => {
  it("khoá GHI là phần số", () => {
    expect(ridKeys("ePMP 682")[0]).toBe("rid:682");
    expect(ridKeys("682")[0]).toBe("rid:682");
  });

  it("đổi cách ghi tiền tố KHÔNG làm đổi địa chỉ", () => {
    expect(ridKeys("1")[0]).toBe(ridKeys("ePMP1")[0]);
    expect(ridKeys("ePMP1")[0]).toBe(ridKeys("ePMP 1")[0]);
  });

  it("vẫn đọc được note ghi hồi khoá còn kèm chữ", () => {
    expect(ridKeys("ePMP682")).toContain("rid:EPMP682");
  });

  it("hai dòng khác số thì khác địa chỉ", () => {
    expect(ridKeys("ePMP1")[0]).not.toBe(ridKeys("ePMP11")[0]);
  });

  it("chưa cắm RID thì không có địa chỉ nào — app tự lùi về IDCUNG/STT", () => {
    expect(ridKeys(undefined)).toEqual([]);
    expect(ridKeys("  ")).toEqual([]);
  });
});
