/**
 * RID là khoá bền của ghi chú. Nguồn vừa đổi cách ghi ("1" → "ePMP 1"), nên mấy ca ở đây canh đúng
 * một thứ: đổi cách ghi KHÔNG được làm mất note đã lưu ở khoá cũ.
 */
import { describe, it, expect } from "vitest";
import { ridChuan, ridKeys } from "@/lib/rid";

describe("ridChuan", () => {
  it("bỏ khoảng trắng và in hoa — gõ kiểu nào cũng ra một khoá", () => {
    expect(ridChuan("ePMP 1")).toBe("EPMP1");
    expect(ridChuan("ePMP1")).toBe("EPMP1");
    expect(ridChuan(" epmp  1 ")).toBe("EPMP1");
    expect(ridChuan("1")).toBe("1");
  });
});

describe("ridKeys", () => {
  it("RID mới giữ được note cũ: có kèm khoá số trần đời cũ", () => {
    expect(ridKeys("ePMP 1")).toEqual(["rid:EPMP1", "rid:ePMP 1", "rid:1"]);
  });

  it("khoá GHI (phần tử đầu) là dạng chuẩn, không phải chữ thô", () => {
    expect(ridKeys("ePMP 12")[0]).toBe("rid:EPMP12");
    expect(ridKeys("ePMP12")[0]).toBe("rid:EPMP12");   // hai cách gõ, cùng một chỗ ghi
  });

  it("RID vốn là số trần thì không đẻ khoá thừa", () => {
    expect(ridKeys("7")).toEqual(["rid:7"]);
  });

  it("không có RID thì không có khoá nào — app tự lùi về IDCUNG/STT", () => {
    expect(ridKeys(undefined)).toEqual([]);
    expect(ridKeys("")).toEqual([]);
    expect(ridKeys("   ")).toEqual([]);
  });

  it("hai dòng RID khác nhau không đụng khoá nhau", () => {
    expect(ridKeys("ePMP 1")[0]).not.toBe(ridKeys("ePMP 2")[0]);
    expect(ridKeys("ePMP 1")[0]).not.toBe(ridKeys("ePMP 11")[0]);
  });
});
