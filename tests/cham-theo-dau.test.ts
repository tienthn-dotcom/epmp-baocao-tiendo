/* CHẤM MỘT HẠNG MỤC TỪ DÃY DẤU — một công thức dùng chung cho cả hai nguồn dấu.
 *
 * Anh Tiến 14/10/2026 mở bảng và hỏi: *"sao đánh 1 loạt dấu X mà số điểm lại là 100 nhỉ, cảm giác
 * tính năng này chưa chạy"*. Nguyên nhân: dấu dòng TCLĐ suy ra từ lượt xuất PDF, còn ĐIỂM thì vẫn
 * bê nguyên của file — hai con số, hai nguồn, bảng tự mâu thuẫn với chính nó.
 *
 * Nay chỉ còn MỘT chỗ chấm, và đây là bộ kiểm giữ nó. Đây là bảng chấm người nên từng mức trừ
 * phải có ca riêng, đừng gộp.
 */
import { describe, expect, it } from "vitest";
import { chamTheoDau } from "@/lib/bcn-file";
import type { BcnMark } from "@/lib/bcn-file";

const day = (s: string): BcnMark[] =>
  [...s].map((c) => (c === "P" ? "P" : c === "o" ? "o" : c === "x" ? "x" : c === "n" ? "na" : null));

describe("điểm theo dãy dấu", () => {
  it("toàn đúng hạn → 100", () => expect(chamTheoDau(day("PPPPP")).diem).toBe(100));
  it("mỗi lần trễ trừ 2", () => {
    expect(chamTheoDau(day("Po")).diem).toBe(98);
    expect(chamTheoDau(day("Pooo")).diem).toBe(94);
  });
  it("mỗi lần không báo cáo trừ 5", () => {
    expect(chamTheoDau(day("Px")).diem).toBe(95);
    expect(chamTheoDau(day("Pxxx")).diem).toBe(85);
  });
  /* ĐÂY LÀ CA ANH TIẾN BẮT ĐƯỢC: bảy dấu ✕ liền mà bảng vẫn hiện 100. */
  it("bảy dấu ✕ → 65, KHÔNG phải 100", () => {
    const r = chamTheoDau(day("xxxxxxx"));
    expect(r.demX).toBe(7);
    expect(r.diem).toBe(65);
  });
  it("trộn trễ với không báo cáo", () => expect(chamTheoDau(day("PPooxxx")).diem).toBe(81));

  /* Chưa tới lượt báo cáo mà cho 100 là khen người ta vì chưa làm gì. */
  it("chưa có dấu nào → để trống, không phải 100", () => {
    expect(chamTheoDau(day("     ")).diem).toBeNull();
    expect(chamTheoDau([]).diem).toBeNull();
  });
  it("ô n/a vẫn tính là đã có dấu, nhưng không trừ điểm", () => {
    const r = chamTheoDau(day("nnn"));
    expect(r.demNa).toBe(3);
    expect(r.diem).toBe(100);
  });
  /* Điểm âm không nói lên điều gì với người đọc. */
  it("trừ quá tay thì dừng ở 0", () => {
    expect(chamTheoDau(day("x".repeat(25))).diem).toBe(0);
    expect(chamTheoDau(day("x".repeat(40))).diem).toBe(0);
  });
  it("đếm đúng từng loại dấu", () => {
    const r = chamTheoDau(day("PPoxn "));
    expect([r.demP, r.demO, r.demX, r.demNa]).toEqual([2, 1, 1, 1]);
  });
});
