/**
 * CHỈ HAI MỤC ĐƯỢC PHÉP Ở MỨC "error".
 *
 * `assertDataQuality()` trong app NÉM LỖI khi bảng chất lượng có bất kỳ mục nào ở mức "error" —
 * ném là cả app không nạp được dữ liệu: ai còn cache trong trình duyệt thì thấy bản cũ, ai máy mới
 * hoặc vừa xoá cache thì trắng bảng. Chiều 11/09 đã dính đúng chuyện này vì mục "RID trùng" bị để
 * mức error, trong khi RID trùng chẳng làm dữ liệu hỏng.
 *
 * Vì vậy "error" chỉ dành cho thứ làm dữ liệu KHÔNG DÙNG ĐƯỢC:
 *   · header  — không nhận ra được hàng tiêu đề ⇒ đọc sai cột, mọi con số đều vô nghĩa;
 *   · projects — không có dự án Show nào ⇒ không có gì để hiện.
 * Mọi thứ khác là "warn": báo cho PMO dọn nguồn, nhưng KHÔNG chặn người dùng làm việc.
 */
import { describe, it, expect } from "vitest";
import { parseTimelineRows } from "@/lib/parser";

const DUOC_PHEP_LA_LOI = ["header", "projects"];

/** Timeline bẩn hết mức nhưng VẪN đọc được: RID trùng, STT trùng, STT trống, mã lạ, ngày hỏng, % bậy. */
function nguonBan(): unknown[][] {
  const rows: unknown[][] = [];
  for (let i = 0; i < 7; i++) rows.push([]);
  const h: unknown[] = new Array(21).fill(null);
  h[0] = "RID"; h[1] = "STT"; h[4] = "Show"; h[11] = "Mã"; h[12] = "Mô tả";
  h[13] = "Người phụ trách chính"; h[14] = "Bắt đầu"; h[15] = "Kết thúc";
  h[18] = "% thực tế"; h[20] = "Vướng mắc / Cần xử lý";
  rows[5] = h;
  const them = (rid: string | null, stt: string | null, ma: string, mo: string, laDuAn: boolean, ket?: unknown, pct?: unknown) => {
    const r: unknown[] = new Array(21).fill(null);
    r[0] = rid; r[1] = stt; r[4] = "show"; r[11] = ma; r[12] = mo;
    if (laDuAn) { r[5] = mo; r[7] = ma; }
    else { r[13] = "Người A"; r[15] = ket ?? "25/12/2026"; r[18] = pct ?? "50%"; }
    rows.push(r);
  };
  them("ePMP9", "1", "CT-A", "Dự án A", true);
  them("ePMP9", "1.1", "TK", "Thiết kế", false);              // RID trùng
  them("ePMP2", "1.1", "MA", "Duyệt mẫu", false);             // STT trùng
  them(null, null, "VT", "Đặt vật tư", false);                // STT trống
  them("ePMP4", "1.4", "ZZZ", "Mã lạ", false);                // mã không thuộc giai đoạn nào
  them("ePMP5", "1.5", "SX", "Nhập kho", false, "chưa rõ");   // ngày không đọc được
  them("ePMP6", "1.6", "TC", "Lắp đặt", false, "25/12/2026", "999%"); // % bậy
  them("ePMP7", "2", "CT-B", "Dự án B", true);                // dự án không có PM
  them("ePMP8", "2.1", "TK", "Thiết kế", false);
  return rows;
}

describe("cổng dữ liệu — mức lỗi", () => {
  const d = parseTimelineRows(nguonBan(), "2026-06-18");

  it("nguồn bẩn đủ kiểu nhưng VẪN nạp được (không mục nào ở mức error)", () => {
    const loi = d.quality.checks.filter((c) => c.level === "error");
    expect(loi.map((c) => c.id)).toEqual([]);
    expect(d.quality.level).toBe("warn");
    expect(d.projects.length).toBe(2);
  });

  it("nguồn bẩn vẫn phải BÁO ra, không được im lặng", () => {
    const canh = d.quality.checks.filter((c) => c.level === "warn").map((c) => c.id);
    for (const id of ["ridDup", "sttDup", "sttBlank", "unknownPrefix"]) expect(canh).toContain(id);
  });

  it("mọi mục KHÁC header/projects đều không bao giờ được để mức error", () => {
    // Ép mọi mục "bẩn" cùng bật một lúc — mục nào ngoài danh sách mà lên error là chặn nạp dữ liệu.
    const ngoaiLuat = d.quality.checks.filter((c) => c.level === "error" && !DUOC_PHEP_LA_LOI.includes(c.id));
    expect(ngoaiLuat.map((c) => c.id)).toEqual([]);
  });

  it("mất hàng tiêu đề thì ĐÚNG là error — thứ này đọc sai cột, chặn là phải", () => {
    const d2 = parseTimelineRows([[], [], [], [], [], [], []], "2026-06-18");
    const loi = d2.quality.checks.filter((c) => c.level === "error").map((c) => c.id);
    expect(loi).toContain("header");
    expect(loi.every((id) => DUOC_PHEP_LA_LOI.includes(id))).toBe(true);
  });
});
