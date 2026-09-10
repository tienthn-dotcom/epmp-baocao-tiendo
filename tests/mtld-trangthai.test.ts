/**
 * Đếm căn theo trạng thái bàn giao (tab Summary khối phòng).
 * Hai bộ dữ liệu dưới đây dựng theo ĐÚNG hình dạng hai file thật đang gắn trên app —
 * một file đã ghi nhãn đủ, một file mới ghi nhãn được một chặng.
 */
import { describe, it, expect } from "vitest";
import { docTrangThaiPhong, congTrangThai, type OTrangThai, type Merge } from "@/lib/mtld-trangthai";

const o = (n: number): OTrangThai[] => Array(n).fill(null);
const dat = (row: OTrangThai[], i: number, v: OTrangThai) => { row[i] = v; return row; };

/** Hyatt Hạ Long: nhãn merge ngang 3 cột, có cả CỘT CHÚ THÍCH MÀU liệt kê y hệt bốn cái tên. */
function hyatt(): { rows: OTrangThai[][]; merges: Merge[] } {
  const rows: OTrangThai[][] = Array.from({ length: 11 }, () => o(20));
  // r3: nhãn nhóm ở E(4), H(7), K(10), N(13); chú thích màu ở S(18)
  dat(rows[2], 1, "Ngày"); dat(rows[2], 4, "Đã giao thô"); dat(rows[2], 7, "Đã giao tinh (Nội bộ)");
  dat(rows[2], 10, "Xoá list Defect (PMU)"); dat(rows[2], 13, "Bàn giao vận hành"); dat(rows[2], 18, "Diễn giải");
  dat(rows[3], 1, "Tổng"); dat(rows[3], 2, 255); dat(rows[3], 18, "Đang thi công");
  dat(rows[4], 1, "Tăng hôm trước"); dat(rows[4], 4, 0); dat(rows[4], 7, 5); dat(rows[4], 10, 0); dat(rows[4], 13, 0);
  dat(rows[4], 18, "Đã giao thô");                      // ← bẫy: chú thích màu, không có số bên dưới
  dat(rows[5], 18, "Đã giao tinh (Nội bộ)");
  dat(rows[6], 1, "Tăng trong ngày"); dat(rows[6], 18, "Đã xoá defects (PMU)");
  dat(rows[7], 18, "Bàn giao vận hành");
  dat(rows[8], 1, "Lũy kế"); dat(rows[8], 4, 101); dat(rows[8], 7, 85); dat(rows[8], 10, 85); dat(rows[8], 13, 0);
  dat(rows[9], 1, "Còn lại cần giao"); dat(rows[9], 4, 154);
  const merges: Merge[] = [
    { s: { r: 2, c: 4 }, e: { r: 3, c: 6 } }, { s: { r: 2, c: 7 }, e: { r: 3, c: 9 } },
    { s: { r: 2, c: 10 }, e: { r: 3, c: 12 } }, { s: { r: 2, c: 13 }, e: { r: 3, c: 15 } },
    { s: { r: 3, c: 2 }, e: { r: 3, c: 3 } },
  ];
  return { rows, merges };
}

/** Mini Hotel: nhóm rộng 6 cột, số nằm rải theo từng block; chỉ nhóm cuối có nhãn. */
function miniHotel(): { rows: OTrangThai[][]; merges: Merge[] } {
  const rows: OTrangThai[][] = Array.from({ length: 11 }, () => o(36));
  dat(rows[2], 1, "Ngày"); dat(rows[2], 4, 374); dat(rows[2], 10, 286); dat(rows[2], 16, 227);
  dat(rows[2], 22, 117); dat(rows[2], 28, "Đã giao Vận Hành");
  dat(rows[3], 1, "Tổng"); dat(rows[3], 2, 427);
  dat(rows[4], 1, "Tăng hôm trước"); dat(rows[4], 28, 5); dat(rows[4], 33, 5);
  dat(rows[6], 1, "Tăng trong ngày");
  dat(rows[8], 1, "Lũy kế");
  [84, 85, 59, 71, 75].forEach((v, i) => dat(rows[8], 4 + i, v));      // nhóm 1: E..I
  const merges: Merge[] = [
    { s: { r: 2, c: 4 }, e: { r: 2, c: 9 } }, { s: { r: 2, c: 10 }, e: { r: 2, c: 15 } },
    { s: { r: 2, c: 16 }, e: { r: 2, c: 21 } }, { s: { r: 2, c: 22 }, e: { r: 2, c: 27 } },
    { s: { r: 2, c: 28 }, e: { r: 2, c: 33 } },
  ];
  return { rows, merges };
}

describe("file đã ghi đủ nhãn", () => {
  it("đọc đúng bốn chặng và tổng số căn", () => {
    const { rows, merges } = hyatt();
    const r = docTrangThaiPhong(rows, merges);
    expect(r.ok && r.tt).toEqual({
      tongCan: 255, giaoTho: 101, giaoTinh: 85, raDefect: null, xoaDefect: 85, giaoVanHanh: 0,
      thieuNhan: ["ra defect"],   // file Hyatt không tách chặng "ra list" riêng
    });
  });

  it("KHÔNG nhặt nhầm cột chú thích màu — cột đó ghi y hệt bốn cái tên nhưng không có số", () => {
    const { rows, merges } = hyatt();
    const r = docTrangThaiPhong(rows, merges);
    expect(r.ok && r.tt.giaoTho).toBe(101);   // 101 của nhóm cột, không phải null của cột chú thích
  });
});

describe("file mới ghi nhãn một chặng", () => {
  it("cộng đúng nhóm rộng nhiều cột, và kể ra chặng còn thiếu nhãn", () => {
    const { rows, merges } = miniHotel();
    const r = docTrangThaiPhong(rows, merges);
    if (!r.ok) throw new Error("phải đọc được");
    expect(r.tt.tongCan).toBe(427);
    expect(r.tt.giaoVanHanh).toBe(0);         // có nhãn, đang theo dõi, chưa căn nào tới
    expect(r.tt.thieuNhan).toEqual(["giao thô", "giao tinh", "xoá defect", "ra defect"]);
  });

  it("gắn nhãn cho nhóm là đọc ra số ngay, không phải sửa gì thêm", () => {
    const { rows, merges } = miniHotel();
    rows[2][4] = "Đã giao thô";               // chỉ việc ghi nhãn vào ô đang để số
    const r = docTrangThaiPhong(rows, merges);
    expect(r.ok && r.tt.giaoTho).toBe(374);   // 84+85+59+71+75
  });
});

describe("không đọc được thì nói thẳng", () => {
  it("thiếu dòng Lũy kế", () => {
    const r = docTrangThaiPhong([[null, "Tổng", 10]], []);
    expect(r.ok).toBe(false);
  });

  it("không có nhãn trạng thái nào", () => {
    const rows: OTrangThai[][] = [[null, "Tổng", 10], [null, "Lũy kế", 5]];
    const r = docTrangThaiPhong(rows, []);
    expect(r.ok).toBe(false);
  });
});

describe("congTrangThai", () => {
  it("cộng dồn nhiều dự án, bỏ qua chặng chưa có số", () => {
    const a = docTrangThaiPhong(...Object.values(hyatt()) as [OTrangThai[][], Merge[]]);
    const b = docTrangThaiPhong(...Object.values(miniHotel()) as [OTrangThai[][], Merge[]]);
    if (!a.ok || !b.ok) throw new Error("phải đọc được");
    const t = congTrangThai([a.tt, b.tt]);
    expect(t.soDuAn).toBe(2);
    expect(t.tongCan).toBe(682);              // 255 + 427
    expect(t.giaoTho).toBe(101);              // chỉ Hyatt có số
    expect(t.giaoVanHanh).toBe(0);
    expect(t.thieuNhan).toContain("giao tinh");
  });
});

/** Khuôn CHUẨN HOÁ (PMO đang gom về, 10/09/2026): nhãn ghi luôn con số phía sau dấu hai chấm.
 *  Ngày | 10/09/2026 | Đã giao thô: 376 | Đã giao tinh: 288 | Ra list Defect VH: 227 |
 *                     Xoá list Defect VH: 92 | Đã giao Vận Hành */
describe("khuôn chuẩn hoá — số nằm ngay trong nhãn", () => {
  const dựng = (): { rows: OTrangThai[][]; merges: Merge[] } => {
    const rows: OTrangThai[][] = Array.from({ length: 10 }, () => o(36));
    dat(rows[2], 0, "Ngày"); dat(rows[2], 1, "10/09/2026");
    dat(rows[2], 4, "Đã giao thô: 376"); dat(rows[2], 10, "Đã giao tinh: 288");
    dat(rows[2], 16, "Ra list Defect VH: 227"); dat(rows[2], 22, "Xoá list Defect VH: 92");
    dat(rows[2], 28, "Đã giao Vận Hành");
    dat(rows[3], 0, "Tổng"); dat(rows[3], 1, 427);
    dat(rows[4], 0, "Tăng hôm trước"); dat(rows[4], 21, 2); dat(rows[4], 33, 13);
    dat(rows[5], 0, "Tăng trong ngày");
    dat(rows[8], 0, "Lũy kế");
    const merges: Merge[] = [{ s: { r: 2, c: 28 }, e: { r: 2, c: 33 } }];
    return { rows, merges };
  };

  it("lấy số ghi trong nhãn, không cần dòng Lũy kế", () => {
    const { rows, merges } = dựng();
    const r = docTrangThaiPhong(rows, merges);
    if (!r.ok) throw new Error("phải đọc được");
    expect(r.tt.tongCan).toBe(427);
    expect(r.tt.giaoTho).toBe(376);
    expect(r.tt.giaoTinh).toBe(288);
    expect(r.tt.raDefect).toBe(227);
    expect(r.tt.xoaDefect).toBe(92);
  });

  it("KHÔNG lẫn 'Ra list Defect' với 'Xoá list Defect'", () => {
    const { rows, merges } = dựng();
    const r = docTrangThaiPhong(rows, merges);
    expect(r.ok && r.tt.raDefect).toBe(227);
    expect(r.ok && r.tt.xoaDefect).toBe(92);
  });

  it("nhãn không kèm số thì vẫn cộng theo dòng đếm như cũ", () => {
    const { rows, merges } = dựng();
    const r = docTrangThaiPhong(rows, merges);
    expect(r.ok && r.tt.giaoVanHanh).toBe(0);   // có nhãn, đang theo dõi, Lũy kế còn trống
  });
});

/** Khuôn thứ tư gặp trong file thật (Bà Nà "HEAT MAP Z2"): nhãn một dòng, số ở DÒNG NGAY DƯỚI
 *  ghi kiểu "160 / 431" (đã đạt / tổng). File này cũng không có dòng "Lũy kế". */
describe("khuôn nhãn trên — số dưới", () => {
  const dựng = () => {
    const rows: OTrangThai[][] = Array.from({ length: 16 }, () => o(26));
    dat(rows[1], 1, "Ngày báo cáo:");
    dat(rows[2], 1, "Đã giao thô"); dat(rows[2], 4, "Đã giao tinh");
    dat(rows[2], 11, "Đóng defect BQL"); dat(rows[2], 18, "Bàn giao VH");
    dat(rows[3], 1, "160 / 431"); dat(rows[3], 4, "53 / 431");
    dat(rows[3], 11, "0 / 431"); dat(rows[3], 18, "0 / 431");
    // chú thích màu: nhãn giống hệt, nhưng dưới nó lại là chữ chứ không phải số
    dat(rows[10], 25, "Đã giao thô"); dat(rows[11], 25, "Đã giao tinh (Nội bộ)");
    dat(rows[12], 25, "Đã đóng defect từ Ban quản lý"); dat(rows[13], 25, "Bàn giao Vận hành");
    return rows;
  };

  it("đọc số ở dòng dưới, lấy luôn tổng căn từ '160 / 431'", () => {
    const r = docTrangThaiPhong(dựng(), []);
    if (!r.ok) throw new Error("phải đọc được");
    expect(r.tt.giaoTho).toBe(160);
    expect(r.tt.giaoTinh).toBe(53);
    expect(r.tt.giaoVanHanh).toBe(0);
    expect(r.tt.tongCan).toBe(431);
  });

  it("KHÔNG tính 'Đóng defect BQL' là chặng xoá defect vận hành", () => {
    const r = docTrangThaiPhong(dựng(), []);
    expect(r.ok && r.tt.xoaDefect).toBeNull();
    expect(r.ok && r.tt.thieuNhan).toContain("xoá defect");
  });

  it("KHÔNG nhặt nhầm cột chú thích màu", () => {
    const rows = dựng();
    rows[2] = o(26);   // bỏ hết nhãn thật, chỉ còn cột chú thích
    rows[3] = o(26);
    expect(docTrangThaiPhong(rows, []).ok).toBe(false);
  });
});

/** Viết hoa/thiếu dấu/số nhiều đều phải nhận — mỗi file gõ một kiểu. */
describe("nhãn gõ lệch vẫn nhận", () => {
  const thu = (nhan: string) => {
    const rows: OTrangThai[][] = Array.from({ length: 6 }, () => o(8));
    dat(rows[2], 1, nhan);
    dat(rows[4], 0, "Lũy kế"); dat(rows[4], 1, 7);
    return docTrangThaiPhong(rows, []);
  };
  it("Xóa (dấu sắc) cũng như Xoá", () => {
    const r = thu("Xóa list defects PMU");
    expect(r.ok && r.tt.xoaDefect).toBe(7);
  });
  it("'Bàn giao VH' = bàn giao vận hành", () => {
    const r = thu("Bàn giao VH");
    expect(r.ok && r.tt.giaoVanHanh).toBe(7);
  });
  it("'BÀN GIAO THÔ' viết hoa", () => {
    const r = thu("BÀN GIAO THÔ");
    expect(r.ok && r.tt.giaoTho).toBe(7);
  });
});

/** Khuôn thứ năm (Mini Hotel "Summary"): năm nhãn lặp lại trong TỪNG KHỐI B1…B5 nằm rải phía
 *  dưới bảng, số ghi dạng "84 ― 86" (gạch ngang dài). Phải CỘNG DỒN các khối. */
describe("nhãn lặp theo từng khối — cộng dồn", () => {
  const dựng = () => {
    const rows: OTrangThai[][] = Array.from({ length: 24 }, () => o(30));
    dat(rows[3], 1, "Tổng"); dat(rows[3], 2, 427);
    dat(rows[8], 1, "Lũy kế");
    const nhan = (r: number) => {
      dat(rows[r], 20, "Đã giao thô"); dat(rows[r], 21, "Đã giao tinh");
      dat(rows[r], 22, "Ra list Defect"); dat(rows[r], 23, "Xoá list Defect"); dat(rows[r], 24, "Đã giao VH");
    };
    // khối 1: nhãn r12, chen một dòng chữ, số ở r14
    nhan(11); dat(rows[12], 20, "X");
    ["84 ― 86", "70 ― 86", "63 ― 86", "62 ― 86", "51 ― 86"].forEach((v, i) => dat(rows[13], 20 + i, v));
    // khối 2
    nhan(18);
    ["85 ― 87", "70 ― 87", "49 ― 87", "41 ― 87", "0 ― 87"].forEach((v, i) => dat(rows[20], 20 + i, v));
    return rows;
  };

  it("cộng số của hai khối lại", () => {
    const r = docTrangThaiPhong(dựng(), []);
    if (!r.ok) throw new Error("phải đọc được");
    expect(r.tt.giaoTho).toBe(169);        // 84 + 85
    expect(r.tt.giaoTinh).toBe(140);       // 70 + 70
    expect(r.tt.raDefect).toBe(112);       // 63 + 49
    expect(r.tt.xoaDefect).toBe(103);      // 62 + 41
    expect(r.tt.giaoVanHanh).toBe(51);     // 51 + 0
    expect(r.tt.thieuNhan).toEqual([]);
  });

  it("tổng căn vẫn lấy từ dòng Tổng của bảng", () => {
    expect(docTrangThaiPhong(dựng(), []).ok && docTrangThaiPhong(dựng(), []).tt?.tongCan).toBe(427);
  });

  it("KHÔNG nhặt số trần nằm dưới nhãn (dễ trúng dòng 'Tăng hôm trước')", () => {
    const rows: OTrangThai[][] = Array.from({ length: 8 }, () => o(30));
    dat(rows[2], 28, "Đã giao Vận Hành");
    dat(rows[3], 28, "B1");        // dòng tên block
    dat(rows[4], 28, 5);           // đây là "tăng hôm trước", KHÔNG phải luỹ kế
    dat(rows[6], 1, "Lũy kế");
    const r = docTrangThaiPhong(rows, []);
    expect(r.ok && r.tt.giaoVanHanh).not.toBe(5);
  });
});
