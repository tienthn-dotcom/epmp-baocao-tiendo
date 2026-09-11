/**
 * RID TRÙNG = KHÔNG PHẢI ĐỊA CHỈ.
 *
 * Chuyện thật ngày 11/09: nguồn có 24 số RID bị dùng lại cho nhiều dòng (do COPY nguyên khối dự án —
 * stamp-rid.gs chỉ điền ô TRỐNG nên bản sao giữ y số cũ). Từ khi RID thành địa chỉ ưu tiên của ghi
 * chú, mỗi số trùng làm mấy dòng dùng CHUNG một ô lưu: ghi ở dòng này hiện luôn ở dòng kia, kể cả
 * khác dự án. Đúng hiện tượng "ghi chú nhảy lung tung" người dùng phản ánh.
 */
import { describe, it, expect } from "vitest";
import { parseTimelineRows } from "@/lib/parser";

/** Timeline tối thiểu: cột RID ở A, STT ở B, header hàng 6 (index 5). */
function dung(ridCuaDong: Array<string | null>): unknown[][] {
  const rows: unknown[][] = [];
  for (let i = 0; i < 7; i++) rows.push([]);
  const h: unknown[] = new Array(21).fill(null);
  h[0] = "RID"; h[1] = "STT"; h[4] = "Show"; h[11] = "Mã"; h[12] = "Mô tả";
  h[13] = "Người phụ trách chính"; h[14] = "Bắt đầu"; h[15] = "Kết thúc";
  h[18] = "% thực tế"; h[20] = "Vướng mắc / Cần xử lý";
  rows[5] = h;
  const them = (rid: string | null, stt: string, ma: string, mo: string, laDuAn: boolean, ten?: string) => {
    const r: unknown[] = new Array(21).fill(null);
    r[0] = rid; r[1] = stt; r[4] = "show"; r[11] = ma; r[12] = mo;
    if (laDuAn) { r[5] = ten; r[7] = ma; }
    else { r[13] = "Người A"; r[15] = "25/12/2026"; r[18] = "50%"; }
    rows.push(r);
  };
  // Hai dự án, mỗi dự án một hạng mục TK.
  them(ridCuaDong[0], "1", "CT-A", "Dự án A", true, "Dự án A");
  them(ridCuaDong[1], "1.1", "TK", "Thiết kế", false);
  them(ridCuaDong[2], "2", "CT-B", "Dự án B", true, "Dự án B");
  them(ridCuaDong[3], "2.1", "TK", "Thiết kế", false);
  return rows;
}
const REF = "2026-06-18";
const tk = (d: ReturnType<typeof parseTimelineRows>, ten: string) =>
  d.projects.find((p) => p.name === ten)!.allItems.find((i) => i.rawCode === "TK");

describe("RID trùng", () => {
  it("mỗi dòng một số → RID được dùng làm địa chỉ", () => {
    const d = parseTimelineRows(dung(["ePMP1", "ePMP2", "ePMP3", "ePMP4"]), REF);
    expect(d.projects[0].rid).toBe("ePMP1");
    expect(tk(d, "Dự án A")?.rid).toBe("ePMP2");
    expect(tk(d, "Dự án B")?.rid).toBe("ePMP4");
  });

  it("HAI HẠNG MỤC KHÁC DỰ ÁN cùng một số → CẢ HAI bỏ RID (không còn dùng chung ô lưu)", () => {
    const d = parseTimelineRows(dung(["ePMP1", "ePMP9", "ePMP3", "ePMP9"]), REF);
    expect(tk(d, "Dự án A")?.rid).toBeUndefined();
    expect(tk(d, "Dự án B")?.rid).toBeUndefined();
    // dòng không dính trùng vẫn giữ RID
    expect(d.projects[0].rid).toBe("ePMP1");
    expect(d.projects[1].rid).toBe("ePMP3");
  });

  it("DÒNG DỰ ÁN và DÒNG CON cùng số → cả hai bỏ RID (đây là kiểu 'dòng con nhảy lên dòng dự án')", () => {
    const d = parseTimelineRows(dung(["ePMP5", "ePMP1", "ePMP3", "ePMP5"]), REF);
    expect(d.projects[0].rid).toBeUndefined();
    expect(tk(d, "Dự án B")?.rid).toBeUndefined();
    expect(tk(d, "Dự án A")?.rid).toBe("ePMP1");
  });

  it("khác cách ghi tiền tố nhưng CÙNG SỐ vẫn tính là trùng", () => {
    const d = parseTimelineRows(dung(["ePMP1", "7", "ePMP3", "ePMP 007"]), REF);
    expect(tk(d, "Dự án A")?.rid).toBeUndefined();
    expect(tk(d, "Dự án B")?.rid).toBeUndefined();
  });

  it("ô RID trống không bị tính là trùng nhau", () => {
    const d = parseTimelineRows(dung([null, null, "ePMP3", "ePMP4"]), REF);
    expect(d.projects[1].rid).toBe("ePMP3");
    expect(tk(d, "Dự án B")?.rid).toBe("ePMP4");
  });

  it("cổng dữ liệu báo LỖI và chỉ đích danh số bị trùng", () => {
    const d = parseTimelineRows(dung(["ePMP1", "ePMP9", "ePMP3", "ePMP9"]), REF);
    const c = d.quality.checks.find((x) => x.id === "ridDup")!;
    expect(c.level).toBe("error");
    expect(c.items?.join(" ")).toContain("RID 9");
    expect(c.items?.join(" ")).toContain("2 dòng");
  });

  it("nguồn sạch → mục kiểm ở trạng thái ok", () => {
    const d = parseTimelineRows(dung(["ePMP1", "ePMP2", "ePMP3", "ePMP4"]), REF);
    expect(d.quality.checks.find((x) => x.id === "ridDup")!.level).toBe("ok");
  });
});
