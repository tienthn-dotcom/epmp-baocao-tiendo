/* DỌN GHI CHÚ VỀ RID — hàm này quyết định ô ghi chú nào dời về dòng nào.
 *
 * Đặt nhầm một ô là ghi chú của dự án này nhảy sang dự án khác, và nhảy rồi thì không có đường lần
 * về: mỏ neo chỉ ghi lần đầu, dời xong là nó chỉ chỗ cũ đã trống. Nên test ở đây gác ĐÚNG ba luật
 * an toàn: ứng nhiều dòng thì không đoán, không ứng dòng nào thì không đoán, không có bằng chứng
 * thì nói thẳng là chịu.
 */
import { describe, expect, it } from "vitest";
import { donNoteVeRid, demDon, type DongNguon, type NguonDon } from "@/lib/don-note-rid";

const dong = (dich: string, ungVien: string[], maCT: string, ten: string, gd: string, mota: string): DongNguon => ({
  dich, ungVien, danhTinh: [maCT, ten, gd, mota].join("||"), nhan: `${maCT} · ${ten} · ${gd}`,
});

/** Nguồn mẫu: ba dòng của hai dự án khác nhau, mỗi dòng một RID riêng. */
const NGUON: DongNguon[] = [
  dong("rid:530", ["rid:530", "id:5.6"], "CT26-011", "Trục Đông Tây 2C", "Triển khai sản xuất", "triển khai sản xuất"),
  dong("rid:531", ["rid:531", "id:5.7"], "CT26-011", "Trục Đông Tây 2C", "Sản xuất nhập kho", "sản xuất nhập kho"),
  dong("rid:900", ["rid:900", "id:5.6"], "CT26-044", "Văn Lang Empire", "Sản xuất nhập kho", "sản xuất nhập kho"),
];

function dungNguon(edits: Record<string, { dc?: string }>, neo: Record<string, string>, coChu: string[] = Object.keys(edits)): NguonDon {
  return { dong: NGUON, edits, neo, coChu: (k) => coChu.includes(k), trichDoan: (k) => `nội dung của ${k}` };
}

describe("dò đích bằng mỏ neo", () => {
  it("ô ở id: cũ → dời về rid: của ĐÚNG dòng mỏ neo chỉ", () => {
    const r = donNoteVeRid(dungNguon(
      { "id:5.6": {} },
      { "id:5.6": "CT26-011||Trục Đông Tây 2C||Triển khai sản xuất||triển khai sản xuất" },
    ));
    expect(r).toHaveLength(1);
    expect(r[0].dich).toBe("rid:530");
    expect(r[0].nguon).toBe("mỏ neo");
    expect(r[0].vuong).toBe("");
  });

  it("MỎ NEO THẮNG DẤU dc — dấu bị ghi đè theo dòng đang hiển thị nên không tin được", () => {
    // Ô nằm ở id:5.6. Dấu dc nói nó của CT26-044 (dòng app đang chiếu nó lên — tức đã trôi),
    // còn mỏ neo nói nó sinh ra ở CT26-011. Phải nghe mỏ neo.
    const r = donNoteVeRid(dungNguon(
      { "id:5.6": { dc: "CT26-044||Văn Lang Empire||Sản xuất nhập kho||sản xuất nhập kho||ePMP900" } },
      { "id:5.6": "CT26-011||Trục Đông Tây 2C||Triển khai sản xuất||triển khai sản xuất" },
    ));
    expect(r[0].dich).toBe("rid:530");
    expect(r[0].nguon).toBe("mỏ neo");
  });

  it("không có mỏ neo thì mới dùng dấu dc", () => {
    const r = donNoteVeRid(dungNguon(
      { "id:5.7": { dc: "CT26-011||Trục Đông Tây 2C||Sản xuất nhập kho||sản xuất nhập kho||ePMP531" } },
      {},
    ));
    expect(r[0].dich).toBe("rid:531");
    expect(r[0].nguon).toBe("dấu trong ô");
  });
});

describe("ba luật an toàn", () => {
  it("danh tính ứng NHIỀU dòng → KHÔNG đoán", () => {
    const hai = [...NGUON, dong("rid:777", ["rid:777"], "CT26-011", "Trục Đông Tây 2C", "Triển khai sản xuất", "triển khai sản xuất")];
    const r = donNoteVeRid({
      dong: hai, edits: { "id:5.6": {} },
      neo: { "id:5.6": "CT26-011||Trục Đông Tây 2C||Triển khai sản xuất||triển khai sản xuất" },
      coChu: () => true, trichDoan: (k) => k,
    });
    expect(r[0].dich).toBeNull();
    expect(r[0].vuong).toContain("2 dòng");
  });

  it("dòng cũ không còn trong nguồn → KHÔNG đoán", () => {
    const r = donNoteVeRid(dungNguon({ "id:99": {} }, { "id:99": "CT99-999||Dự án đã xoá||Thi công lắp đặt||thi công" }));
    expect(r[0].dich).toBeNull();
    expect(r[0].vuong).toContain("không còn trong nguồn");
  });

  it("không mỏ neo, không dấu, khoá không đọc được → nói thẳng là chịu", () => {
    const r = donNoteVeRid(dungNguon({ "id:5.6": {} }, {}));
    expect(r[0].dich).toBeNull();
    expect(r[0].nguon).toBe("");
    expect(r[0].vuong).toContain("chọn tay");
  });
});

describe("không đụng vào ô đã đúng chỗ", () => {
  it("ô đã nằm ở khoá ưu tiên của một dòng → bỏ qua, không liệt kê", () => {
    const r = donNoteVeRid(dungNguon(
      { "rid:530": { dc: "CT26-011||Trục Đông Tây 2C||Triển khai sản xuất||triển khai sản xuất||ePMP530" } },
      { "rid:530": "CT26-011||Trục Đông Tây 2C||Triển khai sản xuất||triển khai sản xuất" },
    ));
    expect(r).toHaveLength(0);
  });
  it("ô rỗng (không có chữ) → bỏ qua", () => {
    const r = donNoteVeRid(dungNguon({ "id:5.6": {} }, { "id:5.6": "CT26-011||Trục Đông Tây 2C||Triển khai sản xuất||triển khai sản xuất" }, []));
    expect(r).toHaveLength(0);
  });
});

describe("đích đã có ghi chú → GỘP, không đè", () => {
  it("đánh dấu canGop để giao diện nói trước cho người bấm", () => {
    const r = donNoteVeRid(dungNguon(
      { "id:5.6": {}, "rid:530": {} },
      { "id:5.6": "CT26-011||Trục Đông Tây 2C||Triển khai sản xuất||triển khai sản xuất" },
    ));
    const o = r.find((x) => x.key === "id:5.6");
    expect(o?.dich).toBe("rid:530");
    expect(o?.canGop).toBe(true);
  });
});

describe("khoá composite đời cũ", () => {
  it("đọc được mã CT + tên + giai đoạn từ chính khoá, bỏ dupIdx ở cuối", () => {
    const key = ["CT26-011", "Trục Đông Tây 2C", "Triển khai sản xuất", "0"].join("\u0000");
    // Danh tính nguồn có 4 trường, khoá chỉ cho 3 → so KHÔNG khớp, phải báo vướng chứ đừng đoán bừa.
    const r = donNoteVeRid(dungNguon({ [key]: {} }, {}));
    expect(r[0].nguon).toBe("khoá cũ");
    expect(r[0].dich).toBeNull();
  });
});

describe("đếm cho dòng tổng quan", () => {
  it("tách đúng số dời được, số cần gộp và số phải chọn tay", () => {
    const r = donNoteVeRid(dungNguon(
      { "id:5.6": {}, "rid:530": {}, "id:99": {} },
      { "id:5.6": "CT26-011||Trục Đông Tây 2C||Triển khai sản xuất||triển khai sản xuất",
        "id:99": "CT99-999||Đã xoá||Thi công lắp đặt||thi công" },
    ));
    const d = demDon(r);
    expect(d.tong).toBe(2);          // rid:530 đã đúng chỗ nên không vào danh sách
    expect(d.doiDuoc).toBe(1);
    expect(d.canGop).toBe(1);
    expect(d.chonTay).toBe(1);
    expect(d.theoNguon.moNeo).toBe(1);
  });
});

describe("đếm gộp cho đúng — hai ô cùng dời về một dòng", () => {
  it("hai ô nguồn khác nhau cùng trỏ một đích → CẢ HAI đánh dấu canGop", () => {
    // Một dòng từng mang ghi chú dưới hai dạng khoá đời khác nhau. Đích đang TRỐNG, nhưng dời xong
    // vẫn ra kết quả gộp. Đo thật 05/10: giao diện báo 8 ô gộp, chạy xong thực tế 20 — thiếu đúng
    // nhóm này, và người bấm nút bị bất ngờ.
    const key2 = ["CT26-011", "Trục Đông Tây 2C", "Triển khai sản xuất", "0"].join("\u0000");
    const r = donNoteVeRid({
      dong: NGUON,
      edits: { "id:5.6": {}, [key2]: {} },
      neo: {
        "id:5.6": "CT26-011||Trục Đông Tây 2C||Triển khai sản xuất||triển khai sản xuất",
        [key2]: "CT26-011||Trục Đông Tây 2C||Triển khai sản xuất||triển khai sản xuất",
      },
      coChu: () => true,
      trichDoan: (k) => k,
    });
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.dich === "rid:530")).toBe(true);
    expect(r.every((x) => x.canGop)).toBe(true);
    expect(demDon(r).canGop).toBe(2);
  });
});

describe("soOBiGop — con số trên nút phải khớp cái xảy ra sau khi bấm", () => {
  const key2 = ["CT26-011", "Trục Đông Tây 2C", "Triển khai sản xuất", "0"].join("\u0000");
  const neoTKSX = "CT26-011||Trục Đông Tây 2C||Triển khai sản xuất||triển khai sản xuất";

  it("hai ô về một đích ĐANG TRỐNG → chỉ MỘT ô biến mất", () => {
    const r = donNoteVeRid({
      dong: NGUON, edits: { "id:5.6": {}, [key2]: {} }, neo: { "id:5.6": neoTKSX, [key2]: neoTKSX },
      coChu: (k) => k !== "rid:530", trichDoan: (k) => k,
    });
    expect(demDon(r).doiDuoc).toBe(2);
    expect(demDon(r).soOBiGop).toBe(1);
  });

  it("hai ô về một đích ĐÃ CÓ tin → CẢ HAI ô biến mất", () => {
    const r = donNoteVeRid({
      dong: NGUON, edits: { "id:5.6": {}, [key2]: {}, "rid:530": {} }, neo: { "id:5.6": neoTKSX, [key2]: neoTKSX },
      coChu: () => true, trichDoan: (k) => k,
    });
    expect(demDon(r).soOBiGop).toBe(2);
  });

  it("một ô về đích đang trống → KHÔNG ô nào biến mất", () => {
    const r = donNoteVeRid({
      dong: NGUON, edits: { "id:5.6": {} }, neo: { "id:5.6": neoTKSX },
      coChu: (k) => k === "id:5.6", trichDoan: (k) => k,
    });
    expect(demDon(r).soOBiGop).toBe(0);
  });
});
