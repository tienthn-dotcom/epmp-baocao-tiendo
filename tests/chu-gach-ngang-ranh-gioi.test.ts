/**
 * RANH GIỚI của phép bỏ CHỮ BỊ GẠCH NGANG — xem L7 ở NEN-TANG.md phần 4.
 *
 * tests/chu-gach-ngang.test.ts đã chốt ĐƯỜNG CHÍNH: ô Vướng mắc trên dòng DỰ ÁN (dòng cha).
 * File này soi những chỗ đường chính CHƯA với tới.
 *
 * Đã đo trên nguồn THẬT (9 file Master Plan có trên máy, mốc 17/09/2026 trở về trước):
 *   · 6/9 file có ô bị gạch; mọi ô đều viết đúng một dạng thẻ `<strike/>`, không có biến thể
 *     `val="…"` nào → phép dò theo chuỗi "<strike/>" là đủ cho nguồn hiện tại.
 *   · File 2.3_Shared: 15 ô gạch ở cột Vướng mắc, 128 ô GỘP DỌC chạm cột đó, trong đó 2 ô gộp
 *     có gạch ngay tại ô neo. 13 dự án có đoạn bị gạch, 3 dự án bị đọc SAI hạn nếu không bỏ gạch
 *     (20/05→28/06 và 03/06→28/06 hai lần).
 *
 * HAI phép `it.fails` bên dưới là LỖI ĐANG CÒN, KHÔNG phải hành vi mong muốn.
 * Sửa xong thì chúng sẽ đỏ — lúc đó đổi `it.fails` thành `it` và bỏ chữ "LỖI ĐANG CÒN".
 */
import { describe, it, expect } from "vitest";
import { parseTimelineRows } from "@/lib/parser";
import { parseMpDeadlineIso } from "@/lib/mp-deadline";

const REF = "2026-09-17";

/** Dựng rich text đúng khuôn SheetJS trả ra ở `cell.r`. */
function rich(doan: { chu: string; gach?: boolean }[]): string {
  return doan
    .map(
      (d) =>
        `<r><rPr><rFont val="Arial"/><b/>${d.gach ? "<strike/>" : ""}<sz val="9.0"/></rPr><t xml:space="preserve">${d.chu}</t></r>`,
    )
    .join("");
}

/**
 * Một Timeline tối thiểu: hàng tiêu đề (index 5) · dòng DỰ ÁN (index 7) · dòng ĐẦU VIỆC (index 8).
 * `richTheoO` cho phép gắn rich text vào ĐÚNG một ô bất kỳ, để mô phỏng cả ô gộp.
 */
function dung(opts: {
  noteCha: string;
  noteViec?: string;
  richTheoO?: Record<string, string>;
}) {
  const rows: unknown[][] = [];
  for (let i = 0; i < 7; i++) rows.push([]);
  const h: unknown[] = new Array(22).fill(null);
  h[4] = "Show"; h[11] = "Mã"; h[12] = "Mô tả"; h[13] = "Người phụ trách chính";
  h[14] = "Bắt đầu"; h[15] = "Kết thúc"; h[18] = "% thực tế"; h[20] = "Vướng mắc / Cần xử lý";
  rows[5] = h;

  const duAn: unknown[] = new Array(22).fill(null);
  duAn[4] = "show"; duAn[5] = "Dự án thử"; duAn[7] = "CT-TEST"; duAn[11] = "CT-TEST"; duAn[12] = "Dự án thử";
  duAn[20] = opts.noteCha;
  rows.push(duAn);

  const hangMuc: unknown[] = new Array(22).fill(null);
  hangMuc[4] = "show"; hangMuc[11] = "TK"; hangMuc[12] = "Thiết kế";
  hangMuc[13] = "Người A"; hangMuc[15] = "25/12/2026"; hangMuc[18] = "50%";
  if (opts.noteViec != null) hangMuc[20] = opts.noteViec;
  rows.push(hangMuc);

  const map = opts.richTheoO ?? {};
  const getRich = (r: number, c: number) => map[`${r},${c}`];
  return parseTimelineRows(rows, REF, undefined, getRich);
}

const CAU = "PMO: Cần PM trình Master Plan BOD phê duyệt bitrix trước ";
const DOAN = [{ chu: CAU }, { chu: "15/09", gach: true }, { chu: " 22/09" }];
const PHANG = "PMO: Cần PM trình Master Plan BOD phê duyệt bitrix trước 15/09 22/09";

describe("ranh giới · đoạn bị gạch ở NGOÀI dòng dự án", () => {
  it.fails(
    "LỖI ĐANG CÒN — đầu việc bị gạch CẢ CÂU vẫn cắm cờ 'Cần cập nhật MP' cho dự án",
    () => {
      // Dòng cha không nhắc gì tới cập nhật MP; yêu cầu nằm ở dòng ĐẦU VIỆC và PMO đã gạch
      // bỏ cả câu, tức đã RÚT yêu cầu. Cờ không được cắm — giống hệt luật đã chốt cho dòng cha
      // ở tests/chu-gach-ngang.test.ts. Nhưng parser.ts đọc ghi chú đầu việc ở dạng THÔ
      // (parser.ts · note: noteStr(r[COL.U]) và nhánh noteMentionsMpUpdate(row.note)),
      // không hề hỏi tới rich text, nên đoạn gạch không bao giờ được bỏ.
      const viec = "Cần cập nhật tiến độ MP trước 22/09";
      const d = dung({
        noteCha: "PMO: theo dõi giao hàng.",
        noteViec: viec,
        richTheoO: { "8,20": rich([{ chu: viec, gach: true }]) },
      });
      expect(d.projects[0].needsMpUpdate).toBe(false);
    },
  );

  it.fails(
    "LỖI ĐANG CÒN — ô GỘP DỌC: dòng cha thừa hưởng văn phẳng nên vớ lại đúng ngày ĐÃ HUỶ",
    () => {
      // Cột Vướng mắc trong file nguồn hay bị gộp dọc (đo được 128 ô gộp trên file 2.3_Shared).
      // Ô gộp chỉ lưu MỘT ô thật ở hàng neo; các hàng dưới trong vùng gộp KHÔNG có ô nào.
      // parser.ts xử lý bằng expandMergedNotes(): chép GIÁ TRỊ PHẲNG của ô neo xuống các hàng
      // dưới trong `rows`. Nhưng getRich() lại đọc thẳng từ sheet theo đúng số hàng đó — hàng
      // dưới không có ô nên trả undefined. Kết quả: rows[i][U] có chữ (đã mất gạch) còn rich
      // thì không có → bản "sạch" bằng đúng bản phẳng, và phép dò vớ lại ngày 15/09 đã huỷ.
      // Mô phỏng đúng tình huống đó: dòng cha có chữ phẳng, không có rich.
      const d = dung({ noteCha: PHANG, richTheoO: {} });
      const p = d.projects[0];
      expect(parseMpDeadlineIso(p.projectNoteSach ?? "", REF)?.slice(5)).toBe("09-22");
    },
  );
});

describe("ranh giới · cách viết thẻ gạch trong file", () => {
  it("gạch bị TẮT (val=\"0\") thì không được coi là gạch, chữ phải giữ nguyên", () => {
    // Excel ghi <strike/> khi bật; khi tắt tường minh thì ghi <strike val="0"/>. Nhầm hai thứ
    // này là xoá mất chữ CÒN HIỆU LỰC — sai nặng hơn cả lỗi gốc.
    const tat =
      `<r><rPr><rFont val="Arial"/><strike val="0"/></rPr><t xml:space="preserve">${CAU}</t></r>` +
      `<r><rPr><rFont val="Arial"/><strike val="0"/></rPr><t>15/09 22/09</t></r>`;
    const p = dung({ noteCha: PHANG, richTheoO: { "7,20": tat } }).projects[0];
    expect(p.projectNoteSach).toBe(PHANG);
    expect(p.projectNoteDoan).toBeUndefined();
  });

  it("một đoạn BẬT gạch, một đoạn TẮT gạch: chỉ bỏ đoạn bật", () => {
    const tron =
      `<r><rPr><rFont val="Arial"/></rPr><t xml:space="preserve">${CAU}</t></r>` +
      `<r><rPr><rFont val="Arial"/><strike/></rPr><t>15/09</t></r>` +
      `<r><rPr><rFont val="Arial"/><strike val="0"/></rPr><t xml:space="preserve"> 22/09</t></r>`;
    const p = dung({ noteCha: PHANG, richTheoO: { "7,20": tron } }).projects[0];
    expect(p.projectNoteSach).toBe("PMO: Cần PM trình Master Plan BOD phê duyệt bitrix trước 22/09");
  });

  it("đoạn RỖNG kiểu <t/> nằm giữa không được nuốt mất phần chữ xung quanh", () => {
    const coRong =
      `<r><rPr><rFont val="Arial"/></rPr><t xml:space="preserve">${CAU}</t></r>` +
      `<r><rPr><rFont val="Arial"/></rPr><t/></r>` +
      `<r><rPr><rFont val="Arial"/><strike/></rPr><t>15/09</t></r>` +
      `<r><rPr><rFont val="Arial"/></rPr><t xml:space="preserve"> 22/09</t></r>`;
    const p = dung({ noteCha: PHANG, richTheoO: { "7,20": coRong } }).projects[0];
    expect(p.projectNoteSach).toBe("PMO: Cần PM trình Master Plan BOD phê duyệt bitrix trước 22/09");
  });
});

describe("ranh giới · vị trí đoạn gạch trong câu", () => {
  it("gạch ĐẦU câu: phần còn lại không bị dính khoảng trắng thừa ở đầu", () => {
    const doan = [{ chu: "PMO: Huỷ mốc cũ. ", gach: true }, { chu: "Cần trình BOD trước 22/09" }];
    const phang = "PMO: Huỷ mốc cũ. Cần trình BOD trước 22/09";
    const p = dung({ noteCha: phang, richTheoO: { "7,20": rich(doan) } }).projects[0];
    expect(p.projectNoteSach).toBe("Cần trình BOD trước 22/09");
  });

  it("gạch CUỐI câu: phần còn lại không bị treo khoảng trắng ở đuôi", () => {
    // Câu phải có cụm "bitrix" thì parseMpDeadlineIso mới nhận — luật đã chốt ở mp-deadline.test.ts.
    const doan = [
      { chu: "Cần PM trình BOD phê duyệt (bitrix) trước 22/09" },
      { chu: " (bỏ mốc 15/09)", gach: true },
    ];
    const phang = "Cần PM trình BOD phê duyệt (bitrix) trước 22/09 (bỏ mốc 15/09)";
    const p = dung({ noteCha: phang, richTheoO: { "7,20": rich(doan) } }).projects[0];
    expect(p.projectNoteSach).toBe("Cần PM trình BOD phê duyệt (bitrix) trước 22/09");
    expect(parseMpDeadlineIso(p.projectNoteSach!, REF)?.slice(5)).toBe("09-22");
  });

  it("gạch NHIỀU mốc liên tiếp — đúng kiểu PMO dời hạn mấy lần, chỉ còn mốc cuối", () => {
    // Nguyên văn lấy từ file thật (CT25-077): "trước 20/05 03/06 22/06 28/06", ba mốc đầu bị gạch.
    const doan = [
      { chu: "PMO: Tiến độ dự án dời đến 31/07, cần PM trình lại Master Plan BOD phê duyệt (bitrix) trước " },
      { chu: "20/05 ", gach: true },
      { chu: "03/06 ", gach: true },
      { chu: "22/06 ", gach: true },
      { chu: "28/06" },
    ];
    const phang =
      "PMO: Tiến độ dự án dời đến 31/07, cần PM trình lại Master Plan BOD phê duyệt (bitrix) trước 20/05 03/06 22/06 28/06";
    const p = dung({ noteCha: phang, richTheoO: { "7,20": rich(doan) } }).projects[0];
    expect(parseMpDeadlineIso(phang, REF)?.slice(5)).toBe("05-20"); // BẪY: đọc cả câu ra mốc ĐÃ HUỶ
    expect(parseMpDeadlineIso(p.projectNoteSach!, REF)?.slice(5)).toBe("06-28");
  });
});

describe("ranh giới · 'lý do' hiện cho người dùng", () => {
  it("BẪY: ô cha có gạch thì 'lý do' vẫn là câu THÔ, ngày đã huỷ nằm đó không còn nét gạch", () => {
    // parser.ts dựng mpReason từ noteStr(r[COL.U]) — bản THÔ — trong khi cờ lại xét trên bản sạch.
    // Chỗ nào vẽ lại được nét gạch thì dùng projectNoteDoan; chỗ nào chỉ nhận chuỗi mpReason
    // (bảng gộp theo dự án) thì người đọc thấy "trước 15/09 22/09" trơ, không biết 15/09 đã huỷ.
    // Giữ phép này để ai đổi hành vi đó thì biết là đang đổi cái gì.
    const cau = "PMO: Cần PM cập nhật tiến độ MP trước 15/09 22/09";
    const doan = [
      { chu: "PMO: Cần PM cập nhật tiến độ MP trước " },
      { chu: "15/09", gach: true },
      { chu: " 22/09" },
    ];
    const p = dung({ noteCha: cau, richTheoO: { "7,20": rich(doan) } }).projects[0];
    expect(p.needsMpUpdate).toBe(true);
    expect(p.mpReason).toBe(cau);
    expect(p.mpReason).toContain("15/09");
    // Bản sạch thì đúng — chỉ riêng lý do là thô.
    expect(p.projectNoteSach).toBe("PMO: Cần PM cập nhật tiến độ MP trước 22/09");
  });

  it("cả câu bị gạch trên DÒNG CHA thì không còn lý do nào để hiện", () => {
    const cau = "PMO: Cần PM cập nhật tiến độ MP trước 15/09";
    const p = dung({ noteCha: cau, richTheoO: { "7,20": rich([{ chu: cau, gach: true }]) } }).projects[0];
    expect(p.needsMpUpdate).toBe(false);
    expect(p.mpReason).toBe("");
    expect(p.projectNoteSach).toBe("");
  });
});

describe("ranh giới · ký tự và chuỗi lạ trong ô", () => {
  it("dấu & viết hai lớp (&amp;amp;) chỉ được bóc đúng MỘT lớp", () => {
    const doan =
      `<r><rPr><rFont val="Arial"/></rPr><t xml:space="preserve">Gói A &amp;amp; B, trình trước </t></r>` +
      `<r><rPr><rFont val="Arial"/><strike/></rPr><t>15/09</t></r>` +
      `<r><rPr><rFont val="Arial"/></rPr><t xml:space="preserve"> 22/09</t></r>`;
    const p = dung({ noteCha: "x", richTheoO: { "7,20": doan } }).projects[0];
    expect(p.projectNoteSach).toBe("Gói A &amp; B, trình trước 22/09");
  });

  it("dấu ngoặc và ngoặc kép mã hoá trong ô được trả về đúng chữ gốc", () => {
    const doan =
      `<r><rPr><rFont val="Arial"/></rPr><t xml:space="preserve">Mốc &quot;BOD&quot; &lt;bitrix&gt; trước </t></r>` +
      `<r><rPr><rFont val="Arial"/><strike/></rPr><t>15/09</t></r>` +
      `<r><rPr><rFont val="Arial"/></rPr><t xml:space="preserve"> 22/09</t></r>`;
    const p = dung({ noteCha: "x", richTheoO: { "7,20": doan } }).projects[0];
    expect(p.projectNoteSach).toBe('Mốc "BOD" <bitrix> trước 22/09');
  });

  it("chữ '<strike/>' do người gõ vào ô (đã mã hoá) không được hiểu là lệnh gạch", () => {
    // Nếu có ai gõ đúng chữ đó, Excel lưu thành &lt;strike/&gt; — không được nhầm thành định dạng.
    const phang = "Ghi chú: dùng thẻ <strike/> để gạch. Trình trước 22/09";
    const doan =
      `<r><rPr><rFont val="Arial"/></rPr><t xml:space="preserve">Ghi chú: dùng thẻ &lt;strike/&gt; để gạch. Trình trước 22/09</t></r>`;
    const p = dung({ noteCha: phang, richTheoO: { "7,20": doan } }).projects[0];
    expect(p.projectNoteSach).toBe("Ghi chú: dùng thẻ <strike/> để gạch. Trình trước 22/09");
    expect(p.projectNoteDoan).toBeUndefined();
  });

  it("ô rỗng và ô chỉ có khoảng trắng: không sinh đoạn, không ngã ra lỗi", () => {
    expect(dung({ noteCha: "" }).projects[0].projectNoteSach).toBe("");
    expect(dung({ noteCha: "   " }).projects[0].projectNoteSach).toBe("");
    const p = dung({ noteCha: "   ", richTheoO: { "7,20": rich([{ chu: "   ", gach: true }]) } }).projects[0];
    expect(p.projectNoteSach).toBe("");
  });
});
