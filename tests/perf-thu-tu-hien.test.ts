/* CỘT "THỨ TỰ HIỆN" — anh Tiến chốt 07/10/2026: *"trong ô có 20 dự án đi, thì tôi muốn có gì đó
 * kiểu, nhập số 1,2,3,4,... tới 20 hoặc hơn thì sẽ hiện bên hiệu suất dự án"*.
 *
 * Trước đây danh sách 20 dự án nằm CỨNG trong code (PERF_SHOW), nên mỗi lần đổi dự án là phải sửa
 * code rồi deploy — mà người nắm danh sách là PMO chứ không phải người sửa app.
 *
 * Test này gác ba điều, đều hỏng theo kiểu KHÔNG AI THẤY:
 *   1. Cột mới không được bị bộ dò nhầm thành cột doanh thu hay nhân sự. Nhầm thì số liệu sai mà
 *      chart vẫn vẽ ra hình — đúng cái bẫy đã ghi trong chú thích revScale.
 *   2. Gõ số vào dòng KHÔNG có STT thì dự án vẫn phải hiện. Bộ lọc STT chạy trước sẽ nuốt mất dòng
 *      đó, và người gõ không có cách nào biết vì sao nó không lên.
 *   3. Cả file không ai gõ số thì phải LÙI về PERF_SHOW. Không có đường lùi thì ngay lượt nạp đầu
 *      tiên (file chưa có cột đó) lưới trắng bong — mất hẳn màn hình còn tệ hơn danh sách cũ.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { chonHien, docChonHien, parseFlexible, tenHien } from "@/lib/perf-chart-app";

/** Dựng một workbook như file thật: cột STT, tên nhóm, DT từng tháng, NS từng tháng. */
function dungFile(cotHien: boolean, dong: { stt?: number; ten: string; hien?: number | string }[]) {
  const dau = [
    ...(cotHien ? ["Thứ tự hiện"] : []),
    "STT", "Nhóm DA", "DT T1", "DT T2", "NS T1", "NS T2",
  ];
  const rows: unknown[][] = [dau];
  for (const d of dong) {
    rows.push([
      ...(cotHien ? [d.hien ?? null] : []),
      d.stt ?? null, d.ten, 12_000_000_000, 8_000_000_000, 10, 11,
    ]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Pivot (2)");
  return wb;
}

const docTen = (ps: { name: string }[]) => ps.map((p) => p.name);

describe("đọc cột Thứ tự hiện", () => {
  it("lấy đúng số đã gõ, không đụng tới doanh thu / nhân sự", () => {
    const wb = dungFile(true, [
      { stt: 1, ten: "TROPICAL", hien: 2 },
      { stt: 2, ten: "CHATEAU", hien: 1 },
      { stt: 3, ten: "CÁT BÀ" },
    ]);
    const r = parseFlexible(wb, XLSX);
    expect(r).not.toBeNull();
    const byName = new Map(r!.projects.map((p) => [p.name, p]));
    expect(byName.get("TROPICAL")!.hien).toBe(2);
    expect(byName.get("CHATEAU")!.hien).toBe(1);
    expect(byName.get("CÁT BÀ")!.hien).toBeUndefined();
    // Hai tháng doanh thu + hai tháng nhân sự vẫn đọc đủ — cột mới KHÔNG lọt vào đây.
    expect(byName.get("TROPICAL")!.rev).toHaveLength(2);
    expect(byName.get("TROPICAL")!.ns).toEqual([10, 11]);
    expect(byName.get("TROPICAL")!.rev[0]).toBe(12_000_000_000);
  });

  it("gõ dạng chữ (ô định dạng text) vẫn nhận", () => {
    const wb = dungFile(true, [{ stt: 1, ten: "TROPICAL", hien: "3" }]);
    expect(parseFlexible(wb, XLSX)!.projects[0].hien).toBe(3);
  });

  it("gõ 0 hoặc chữ linh tinh → coi như bỏ trống, KHÔNG hiện", () => {
    const wb = dungFile(true, [
      { stt: 1, ten: "TROPICAL", hien: 0 },
      { stt: 2, ten: "CHATEAU", hien: "x" },
    ]);
    for (const p of parseFlexible(wb, XLSX)!.projects) expect(p.hien).toBeUndefined();
  });

  /* Bộ lọc STT chạy sau khi đọc cột này — nếu đảo lại thì dòng không có STT bị nuốt mất, anh Tiến
     gõ số mà dự án vẫn không lên, lại chẳng có dấu hiệu gì báo vì sao. */
  it("dòng KHÔNG có STT nhưng CÓ gõ số → vẫn vào", () => {
    const wb = dungFile(true, [
      { stt: 1, ten: "TROPICAL", hien: 1 },
      { ten: "DỰ ÁN MỚI TINH", hien: 2 },          // chưa ai đánh STT, cũng không có trong PERF_SHOW
    ]);
    expect(docTen(parseFlexible(wb, XLSX)!.projects)).toContain("DỰ ÁN MỚI TINH");
  });
});

/* ── CỘT NẰM Ở SHEET KHÁC ────────────────────────────────────────────────────
   Anh Tiến 07/10/2026: *"bên sheet SLTB tôi sẽ thêm 1 cột nữa ở hàng đầu tiên, là STT xuất hiện
   trên app"*. Số liệu tháng thì ở sheet Pivot, nên app phải dò cột ở MỌI sheet rồi ghép theo TÊN.
   Ghim một sheet là anh đặt cột chỗ khác thì app im lặng không nhận — không lỗi, chỉ là lưới không
   đổi, kiểu hỏng khó lần nhất. */
describe("cột ở sheet nào cũng nhận", () => {
  /** Dựng file hai sheet: Pivot mang số liệu, SLTB mang cột chọn — đúng như file thật. */
  function haiSheet(tenCot: string, chon: [string, number | string][]) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["STT", "Nhóm DA", "DT T1", "NS T1"],
      [1, "TROPICAL", 12_000_000_000, 10],
      [2, "CHATEAU", 8_000_000_000, 7],
      [3, "CÁT BÀ", 5_000_000_000, 4],
    ]), "Pivot (2)");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Dự án", tenCot],
      ...chon.map(([t, n]) => [t, n]),
    ]), "SLTB (kết quả)");
    return wb;
  }

  it('nhận đúng tên cột anh Tiến chốt: "STT xuất hiện trên app"', () => {
    const m = docChonHien(haiSheet("STT xuất hiện trên app", [["TROPICAL", 2], ["CHATEAU", 1]]), XLSX);
    expect(m.get("tropical")).toBe(2);
    expect(m.get("chateau")).toBe(1);
    expect(m.has("cat ba")).toBe(false);
  });

  it("nhận cả mấy cách viết khác (file do nhiều người gõ)", () => {
    for (const ten of ["Thứ tự hiện", "STT hiện", "Thu tu hien", "STT xuat hien tren app"]) {
      expect(docChonHien(haiSheet(ten, [["TROPICAL", 5]]), XLSX).get("tropical")).toBe(5);
    }
  });

  it("ghép theo tên KHÔNG phân biệt dấu / hoa thường", () => {
    const m = docChonHien(haiSheet("STT xuất hiện trên app", [["cat ba", 1], ["TrOpIcAl", 2]]), XLSX);
    expect(m.get("cat ba")).toBe(1);
    expect(m.get("tropical")).toBe(2);
  });

  /* BỐ CỤC THẬT của sheet SLTB (ảnh anh Tiến gửi 07/10/2026): tiêu đề, chú thích, khối A "TOÀN KHỐI
     DỰ ÁN" 5 dòng, rồi mới tới khối B "SLTB THEO NHÓM DỰ ÁN ĐANG LÀM" — nơi đặt cột. Tiêu đề khối B
     nằm sâu trong sheet, nên bộ dò KHÔNG được chặn ở mấy dòng đầu. */
  it("cột nằm ở khối B, sâu trong sheet → vẫn dò ra", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["STT", "Nhóm DA", "DT T1", "NS T1"],
      [1, "TROPICAL PQ", 12_000_000_000, 10],
      [2, "NAM PHƯƠNG PQ", 8_000_000_000, 7],
      [3, "CÁT BÀ", 5_000_000_000, 4],
    ]), "Pivot (2)");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["SẢN LƯỢNG ĐẦU NGƯỜI (SLTB) KHỐI DỰ ÁN 2026"],
      ["SLTB = Doanh thu ÷ Số nhân sự. Đơn vị: tỷ/người."],
      ["A. TOÀN KHỐI DỰ ÁN (T1—T9)"],
      ["Chỉ tiêu", "T1", "T2"],
      ["Sản lượng KDA (tỷ)", 184.9, 46.7],
      ["Tổng nhân sự (file BCH)", 244, 244],
      ["SLTB (tỷ/người)", 0.76, 0.19],
      ["Tổng nhân sự (số đã công bố)", 240, 240],
      ["SLTB theo số đã công bố", 0.77, 0.19],
      ["B. SLTB THEO NHÓM DỰ ÁN ĐANG LÀM (tỷ/người) — 25 nhóm"],
      ["STT XUẤT HIỆN TRÊN APP", "STT", "Nhóm DA", "T3", "T4"],
      [10, 1, "CÁT BÀ", 0, 0],
      [null, 2, "CHATEAU", 0, 0.13],              // chưa đánh số → không hiện
      [1, 11, "TROPICAL PQ", 1.33, 0],
      [2, 8, "NAM PHƯƠNG PQ", 1.39, 0],
    ]), "SLTB (kết quả)");
    const m = docChonHien(wb, XLSX);
    expect(m.get("tropical pq")).toBe(1);
    expect(m.get("nam phuong pq")).toBe(2);
    expect(m.get("cat ba")).toBe(10);
    expect(m.has("chateau")).toBe(false);
    // Cột "STT" thường (1, 11, 8…) KHÔNG được nhầm thành cột chọn.
    expect(m.get("tropical pq")).not.toBe(11);
  });

  it("file KHÔNG có cột đó → bảng rỗng, không ném", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["STT", "Nhóm DA", "DT T1", "NS T1"], [1, "TROPICAL", 1, 1]]), "Pivot (2)");
    expect(docChonHien(wb, XLSX).size).toBe(0);
  });
});

/* ── TÊN TRÊN THẺ ────────────────────────────────────────────────────────────
   Anh Tiến 07/10/2026: *"cứ giữ nguyên, trừ cái KDL ven sông hàn -> Cosmo Đà Nẵng, còn lại cứ giữ,
   cái nào tôi không yêu cầu đổi tên thì 1 khi đánh số cứ mang y nguyên lên là xong"*. */
describe("tên hiển thị trên thẻ", () => {
  it("COSMO ĐÀ NẴNG giữ đúng tên file, không còn đổi thành KDL ven sông Hàn", () => {
    expect(tenHien("COSMO ĐÀ NẴNG")).toBe("COSMO ĐÀ NẴNG");
    expect(tenHien("COSMO ĐÀ NẴNG")).not.toContain("VEN SÔNG HÀN");
  });

  it("mấy tên anh Tiến đã yêu cầu đổi thì GIỮ NGUYÊN cách đổi", () => {
    expect(tenHien("TROPICAL PQ")).toBe("TROPICAL");
    expect(tenHien("NAM PHƯƠNG PQ")).toBe("NAM PHƯƠNG HOÀNG HẬU");
    expect(tenHien("MINI HOTEL PQ")).toBe("MINI HOTEL");
    expect(tenHien("HYATT PQ")).toBe("HYATT PHÚ QUỐC");
    expect(tenHien("CÁT BÀ")).toBe("CÁT BÀ HH3");
  });

  it("dự án KHÔNG nằm trong danh sách đổi tên → lên thẻ y nguyên tên file", () => {
    for (const t of ["OLALANI", "TRỤC ĐÔNG TÂY", "APEC S4", "TIẾN BỘ PLAZA", "43 ĐTM", "TULIP 3"]) {
      expect(tenHien(t)).toBe(t);
    }
  });
});

describe("chọn dự án lên lưới", () => {
  const p = (name: string, hien?: number) => ({ no: 1, name, rev: [1], ns: [1], ...(hien != null ? { hien } : {}) });

  it("có gõ số → đúng những dòng đó, THEO THỨ TỰ số", () => {
    const ds = [p("CÁT BÀ", 3), p("TROPICAL", 1), p("KHÔNG HIỆN"), p("CHATEAU", 2)];
    expect(docTen(chonHien(ds))).toEqual(["TROPICAL", "CHATEAU", "CÁT BÀ"]);
  });

  it("số nhảy cóc (1, 5, 20) vẫn đúng thứ tự — không đòi liền mạch", () => {
    const ds = [p("C", 20), p("A", 1), p("B", 5)];
    expect(docTen(chonHien(ds))).toEqual(["A", "B", "C"]);
  });

  it("hơn 20 dòng cũng nhận hết, không cắt ở 20", () => {
    const ds = Array.from({ length: 26 }, (_, i) => p("DA" + (i + 1), i + 1));
    expect(chonHien(ds)).toHaveLength(26);
  });

  /* ĐƯỜNG LÙI. File đang dùng chưa có cột này; thiếu nhánh dưới là lưới trắng bong ngay lượt nạp đầu. */
  it("KHÔNG ai gõ số → lùi về danh sách cũ trong code", () => {
    // Tên phải TRÙNG danh sách cũ: ở đó ghi "TROPICAL PQ" chứ không phải "TROPICAL".
    const ds = [p("TROPICAL PQ"), p("CHATEAU"), p("KHÔNG CÓ TRONG DANH SÁCH CŨ")];
    const ten = docTen(chonHien(ds));
    expect(ten).toContain("TROPICAL PQ");
    expect(ten).toContain("CHATEAU");
    expect(ten).not.toContain("KHÔNG CÓ TRONG DANH SÁCH CŨ");
  });

  /* Nửa nọ nửa kia thì không ai lần ra được vì sao một dự án hiện hay không hiện. */
  it("chỉ MỘT dòng được gõ số → chuyển HẲN sang cột mới, không trộn với danh sách cũ", () => {
    const ds = [p("TROPICAL"), p("CHATEAU"), p("CHỈ MÌNH TÔI CÓ SỐ", 1)];
    expect(docTen(chonHien(ds))).toEqual(["CHỈ MÌNH TÔI CÓ SỐ"]);
  });
});
