/**
 * CHỮ BỊ GẠCH NGANG trong ô Vướng mắc.
 *
 * PMO gạch ngang phần đã hết hiệu lực ngay trong ô, hay gặp nhất là ngày cũ bị dời:
 *     "...trình BOD phê duyệt bitrix trước ~~15/09~~ 22/09"
 *
 * Đọc ô bằng giá trị thường thì gạch ngang mất sạch, còn lại "trước 15/09 22/09", và phép dò
 * "trước dd/mm" vớ đúng NGÀY ĐÃ HUỶ vì nó mới là ngày đứng ngay sau chữ "trước".
 *
 * Đo trên nguồn ngày 17/09/2026: cả 7 dự án có đoạn gạch đều dính bẫy này, app hiện sai deadline
 * trình BOD của cả 7. Bộ kiểm này chốt để không tái diễn.
 */
import { describe, it, expect } from "vitest";
import { parseTimelineRows } from "@/lib/parser";
import { parseMpDeadlineIso } from "@/lib/mp-deadline";

const REF = "2026-09-17";

/** Dựng rich text đúng khuôn SheetJS trả ra ở `cell.r`. */
function rich(doan: { chu: string; gach?: boolean }[]): string {
  return doan
    .map((d) => `<r><rPr><rFont val="Arial"/><b/>${d.gach ? "<strike/>" : ""}<sz val="9.0"/></rPr><t xml:space="preserve">${d.chu}</t></r>`)
    .join("");
}

/** Một Timeline tối thiểu: hàng tiêu đề + một dòng dự án mang ô Vướng mắc. */
function dung(note: string, doanRich?: string) {
  const rows: unknown[][] = [];
  for (let i = 0; i < 7; i++) rows.push([]);
  const h: unknown[] = new Array(22).fill(null);
  h[4] = "Show"; h[11] = "Mã"; h[12] = "Mô tả"; h[13] = "Người phụ trách chính";
  h[14] = "Bắt đầu"; h[15] = "Kết thúc"; h[18] = "% thực tế"; h[20] = "Vướng mắc / Cần xử lý";
  rows[5] = h;

  const duAn: unknown[] = new Array(22).fill(null);
  duAn[4] = "show"; duAn[5] = "Dự án thử"; duAn[7] = "CT-TEST"; duAn[11] = "CT-TEST"; duAn[12] = "Dự án thử";
  duAn[20] = note;
  rows.push(duAn);

  const hangMuc: unknown[] = new Array(22).fill(null);
  hangMuc[4] = "show"; hangMuc[11] = "TK"; hangMuc[12] = "Thiết kế";
  hangMuc[13] = "Người A"; hangMuc[15] = "25/12/2026"; hangMuc[18] = "50%";
  rows.push(hangMuc);

  const getRich = (r: number, c: number) => (r === 7 && c === 20 ? doanRich : undefined);
  return parseTimelineRows(rows, REF, undefined, getRich);
}

const CAU = "PMO: Cần PM trình Master Plan BOD phê duyệt bitrix trước ";
const DOAN = [{ chu: CAU }, { chu: "15/09", gach: true }, { chu: " 22/09" }];
const PHANG = "PMO: Cần PM trình Master Plan BOD phê duyệt bitrix trước 15/09 22/09";

describe("bỏ đoạn bị gạch trước khi dò ngày", () => {
  it("BẪY: đọc cả câu thì vớ đúng ngày ĐÃ BỊ GẠCH", () => {
    // Đây là hành vi SAI mà bản cũ mắc phải — giữ lại để thấy rõ vì sao cần sửa.
    const iso = parseMpDeadlineIso(PHANG, REF);
    expect(iso?.slice(5)).toBe("09-15");
  });

  it("bỏ đoạn gạch rồi dò thì ra ngày MỚI", () => {
    const d = dung(PHANG, rich(DOAN));
    const p = d.projects[0];
    expect(p.projectNoteSach).toBe("PMO: Cần PM trình Master Plan BOD phê duyệt bitrix trước 22/09");
    expect(parseMpDeadlineIso(p.projectNoteSach!, REF)?.slice(5)).toBe("09-22");
  });

  it("GIỮ NGUYÊN câu gốc để hiển thị, không xoá mất phần bị gạch", () => {
    // Người đọc cần thấy ngày cũ là gì và đã đổi thành ngày nào.
    const p = dung(PHANG, rich(DOAN)).projects[0];
    expect(p.projectNote).toBe(PHANG);
    expect(p.projectNoteDoan).toEqual(DOAN);
  });

  it("ô KHÔNG có đoạn gạch: bản sạch bằng đúng bản gốc, không sinh đoạn thừa", () => {
    const sach = "PMO: Cần PM trình BOD phê duyệt bitrix trước 22/09";
    const p = dung(sach, rich([{ chu: sach }])).projects[0];
    expect(p.projectNoteSach).toBe(sach);
    expect(p.projectNoteDoan).toBeUndefined();
  });

  it("ô chữ thường (không có rich text) vẫn chạy như cũ", () => {
    const p = dung(PHANG).projects[0];
    expect(p.projectNoteSach).toBe(PHANG);
    expect(p.projectNoteDoan).toBeUndefined();
  });

  it("gạch NGUYÊN Ô thì phần còn lại rỗng, không ngã ra lỗi", () => {
    const p = dung(PHANG, rich([{ chu: PHANG, gach: true }])).projects[0];
    expect(p.projectNoteSach).toBe("");
    expect(p.projectNoteDoan).toHaveLength(1);
  });

  it("cờ 'Cần cập nhật MP' cũng xét trên bản đã bỏ gạch", () => {
    // Câu này khớp luật cắm cờ vì có cụm "cập nhật tiến độ".
    const co = "PMO: Cần PM cập nhật tiến độ MP trước 22/09";
    expect(dung(co, rich([{ chu: co }])).projects[0].needsMpUpdate).toBe(true);
    // Cả câu bị gạch = PMO đã rút yêu cầu → không được cắm cờ nữa.
    expect(dung(co, rich([{ chu: co, gach: true }])).projects[0].needsMpUpdate).toBe(false);
  });

  it("ký tự đặc biệt trong ô được giải mã đúng", () => {
    const doan = [{ chu: "Dự án mới cần PM lập master plan &amp; trình BOD trước " }, { chu: "15/09", gach: true }, { chu: " 22/09" }];
    const p = dung("x", rich(doan)).projects[0];
    expect(p.projectNoteSach).toContain("master plan & trình BOD");
    expect(p.projectNoteSach).not.toContain("&amp;");
  });
});
