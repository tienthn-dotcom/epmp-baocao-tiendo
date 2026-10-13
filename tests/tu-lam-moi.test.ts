/* "MỞ POPUP LÀ TỰ LẤY BẢN MỚI" — luật quyết định có tải lại hay không.
 *
 * Anh Tiến 13/10/2026: *"lúc nào bấm vào thi công lắp đặt -> tự cập nhật lại chart pop up"*.
 *
 * Hai hướng sai đều tốn: tải lại khi file KHÔNG đổi là mỗi lần mở popup chờ thêm 2-4 giây và đốt
 * một lượt ghi KV (trần 1.000/ngày, app đã tràn thật 03/10/2026); KHÔNG tải lại khi file ĐÃ đổi là
 * bày số cũ mà nhìn y như số mới. Nên ranh giới phải có ca kiểm giữ.
 */
import { describe, expect, it } from "vitest";
import { DU_SAI_MS, canLamMoi, nhanTuMoi } from "@/lib/tu-lam-moi";

const luc = (iso: string) => Date.parse(iso);

describe("có cần tải lại không", () => {
  it("file sửa SAU bản đang xem → tải lại", () => {
    expect(canLamMoi(luc("2026-10-13T01:00:00Z"), "2026-10-13T03:00:00Z")).toBe(true);
  });
  it("file sửa TRƯỚC bản đang xem → giữ nguyên", () => {
    expect(canLamMoi(luc("2026-10-13T03:00:00Z"), "2026-10-13T01:00:00Z")).toBe(false);
  });
  it("bằng nhau → giữ nguyên", () => {
    const t = luc("2026-10-13T03:00:00Z");
    expect(canLamMoi(t, "2026-10-13T03:00:00Z")).toBe(false);
  });

  /* Mốc cache do Worker đóng, ngày sửa do Google đóng — hai đồng hồ lệch vài giây là thường, mà
     lệch kiểu đó thì lần mở nào cũng "thấy mới" rồi tải lại vô ích. */
  it("lệch trong khoảng dung sai → KHÔNG tải lại", () => {
    const t = luc("2026-10-13T03:00:00Z");
    expect(canLamMoi(t, new Date(t + DU_SAI_MS - 1000).toISOString())).toBe(false);
  });
  it("lệch quá dung sai → tải lại", () => {
    const t = luc("2026-10-13T03:00:00Z");
    expect(canLamMoi(t, new Date(t + DU_SAI_MS + 1000).toISOString())).toBe(true);
  });

  /* KHÔNG BIẾT thì KHÔNG đoán — đoán ở đây nghĩa là tải lại mỗi lần mở, đúng cái đang tránh. */
  it("chưa có bản nào trên màn → không tải lại", () => {
    expect(canLamMoi(0, "2026-10-13T03:00:00Z")).toBe(false);
    expect(canLamMoi(null, "2026-10-13T03:00:00Z")).toBe(false);
  });
  it("hỏi Drive hụt → không tải lại", () => {
    expect(canLamMoi(luc("2026-10-13T01:00:00Z"), null)).toBe(false);
    expect(canLamMoi(luc("2026-10-13T01:00:00Z"), undefined)).toBe(false);
  });
  it("ngày sửa không đọc được → không tải lại", () => {
    expect(canLamMoi(luc("2026-10-13T01:00:00Z"), "hôm qua")).toBe(false);
  });
});

describe("câu hiện cho người xem", () => {
  it("chỉ nói khi có gì để nói", () => {
    expect(nhanTuMoi("cho")).toBe("");
    expect(nhanTuMoi("moiNhat")).toBe("");       // đang xem bản mới nhất là chuyện thường, khỏi khoe
    expect(nhanTuMoi("hut")).toBe("");           // hỏi hụt là chuyện của máy, không bày cho người dùng
    expect(nhanTuMoi("dang")).not.toBe("");
    expect(nhanTuMoi("daLamMoi")).not.toBe("");
  });
});
