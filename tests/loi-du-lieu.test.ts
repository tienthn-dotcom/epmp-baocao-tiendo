/* DÒ LỖI SỐ LIỆU — luật phải khớp ĐÚNG luật đang chạy trong popup %, không được chặt hơn.
 *
 * Anh Tiến 15/10/2026: *"làm sao cho chức năng kiểm soát dữ liệu là show được số lỗi không khớp,
 * có thể filter"*. Bảng này đưa cho PM đi rà, nên KÊU OAN là hỏng: kêu oan một lần thì lần sau
 * không ai mở nữa, và lỗi thật nằm lẫn trong đống oan.
 */
import { describe, expect, it } from "vitest";
import {
  NGUONG_LECH, demTheo, demTheoLoai, doLoiDuLieu, gopSoMa, locLoi, xetDong, type DongXet,
} from "@/lib/loi-du-lieu";

const dong = (over: Partial<DongXet> = {}): DongXet => ({
  maCT: "CT26-105", duAn: "Villa Bason V60", hangMuc: "Sản xuất nhập kho",
  giaiDoan: "Sản xuất nhập kho", vung: "HCM", pm: "Phạm Xuân Hoành", cum: "Others",
  pctActual: 50, pctActualInvalid: false,
  soMa: [{ label: "Kho", done: 25, total: 50 }],
  ...over,
});

describe("gộp số mã", () => {
  it("một dòng: trung bình và gộp bằng nhau", () => {
    expect(gopSoMa([{ label: "Kho", done: 41, total: 50 }])).toEqual({ tongXong: 41, tongMa: 50, tb: 82, gop: 82 });
  });
  /* Đặt vật tư gồm VT.CT và VT.NM — luật gốc là TRUNG BÌNH, nhưng nhiều PM nhập theo kiểu gộp.
     Giữ cả hai cách để không kêu oan người nhập kiểu còn lại. */
  it("nhiều dòng: trung bình khác gộp", () => {
    const g = gopSoMa([{ label: "VT.CT", done: 1, total: 10 }, { label: "VT.NM", done: 90, total: 100 }]);
    expect(g.tb).toBe(50);      // (10% + 90%) / 2
    expect(g.gop).toBe(83);     // 91 / 110
  });
  it("tổng mã bằng 0 → không tính ra %", () => {
    expect(gopSoMa([{ label: "x", done: 0, total: 0 }]).gop).toBeNull();
  });
});

describe("ca anh Tiến bắt được: Villa Bason V60", () => {
  /* File ghi 41/50 mã (53% theo khối bên phải) mà ô % thực tế để 0%. */
  const l = xetDong(dong({ pctActual: 0, soMa: [{ label: "Kho", done: 41, total: 50 }] }));
  it("có kêu", () => expect(l?.loai).toBe("lech"));
  it("nói rõ đang ghi gì và số mã ra bao nhiêu", () => {
    expect(l?.dangGhi).toBe("0%");
    expect(l?.theoSoMa).toBe("41/50 mã · 82%");
  });
  it("mang theo vùng và PM để giao đúng người", () => {
    expect(l?.vung).toBe("HCM");
    expect(l?.pm).toBe("Phạm Xuân Hoành");
  });
});

describe("không kêu oan", () => {
  it("khớp thì im", () => expect(xetDong(dong({ pctActual: 50 }))).toBeNull());
  it("lệch dưới ngưỡng (làm tròn) thì im", () => {
    expect(xetDong(dong({ pctActual: 50 + NGUONG_LECH - 1 }))).toBeNull();
  });
  it("đúng ngưỡng thì kêu", () => {
    expect(xetDong(dong({ pctActual: 50 + NGUONG_LECH }))?.loai).toBe("lech");
  });
  /* Nhập theo kiểu GỘP trong khi luật là trung bình → vẫn phải im. */
  it("nhập khớp một trong hai cách tính thì im", () => {
    const soMa = [{ label: "VT.CT", done: 1, total: 10 }, { label: "VT.NM", done: 90, total: 100 }];
    expect(xetDong(dong({ giaiDoan: "Đặt vật tư", pctActual: 50, soMa }))).toBeNull();   // kiểu trung bình
    expect(xetDong(dong({ giaiDoan: "Đặt vật tư", pctActual: 83, soMa }))).toBeNull();   // kiểu gộp
    expect(xetDong(dong({ giaiDoan: "Đặt vật tư", pctActual: 20, soMa }))?.loai).toBe("lech");
  });
  /* Giai đoạn không nhập số mã thì không có gì để đối chiếu. */
  it("Thi công lắp đặt / Thiết kế / LOA → không xét", () => {
    for (const gd of ["Thi công lắp đặt", "Phát hành thiết kế", "LOA/Tạm ứng", "Khác"]) {
      expect(xetDong(dong({ giaiDoan: gd, pctActual: null, soMa: undefined }))).toBeNull();
    }
  });
});

describe("ba loại còn lại", () => {
  it("giai đoạn cần số mà ô % trống", () => {
    expect(xetDong(dong({ pctActual: null, soMa: undefined }))?.loai).toBe("trong");
  });
  it("có % nhưng file không có chi tiết số mã", () => {
    expect(xetDong(dong({ soMa: undefined }))?.loai).toBe("thieuSoMa");
  });
  /* Ô % hỏng kêu ở MỌI giai đoạn — lỗi gõ, không liên quan số mã. */
  it("ô % hỏng → kêu kể cả ở giai đoạn không có số mã, và là lỗi nặng", () => {
    const l = xetDong(dong({ giaiDoan: "Thi công lắp đặt", pctActualInvalid: true }));
    expect(l?.loai).toBe("hong");
    expect(l?.nang).toBe(true);
  });
});

describe("quét cả bảng, đếm và lọc", () => {
  const ds: DongXet[] = [
    dong({ maCT: "A", pctActual: 0, soMa: [{ label: "Kho", done: 41, total: 50 }] }),           // lech
    dong({ maCT: "B", vung: "PQ", pm: "Có", soMa: undefined }),                                  // thieuSoMa
    dong({ maCT: "C", vung: "PQ", pm: "Có", pctActual: null, soMa: undefined }),                 // trong
    dong({ maCT: "D", vung: "North", pctActualInvalid: true }),                                  // hong
    dong({ maCT: "E" }),                                                                         // sạch
  ];
  const loi = doLoiDuLieu(ds);
  it("chỉ lấy dòng có lỗi, giữ nguyên thứ tự", () => {
    expect(loi.map((l) => l.maCT)).toEqual(["A", "B", "C", "D"]);
  });
  it("đếm theo loại", () => {
    expect(demTheoLoai(loi)).toEqual({ lech: 1, thieuSoMa: 1, trong: 1, hong: 1 });
  });
  it("đếm theo vùng, nhiều nhất lên trước", () => {
    expect(demTheo(loi, "vung")).toEqual([{ ten: "PQ", so: 2 }, { ten: "HCM", so: 1 }, { ten: "North", so: 1 }]);
  });
  it("lọc theo vùng", () => expect(locLoi(loi, { vung: "PQ" }).map((l) => l.maCT)).toEqual(["B", "C"]));
  it("lọc theo loại", () => expect(locLoi(loi, { loai: "lech" }).map((l) => l.maCT)).toEqual(["A"]));
  /* Nhiều bộ lọc cùng bật thì GIAO NHAU — lọc PM rồi lọc loại phải còn đúng phần chung. */
  it("nhiều bộ lọc giao nhau", () => {
    expect(locLoi(loi, { vung: "PQ", loai: "trong" }).map((l) => l.maCT)).toEqual(["C"]);
    expect(locLoi(loi, { vung: "PQ", loai: "hong" })).toEqual([]);
  });
  it("gõ tìm theo mã hoặc tên dự án", () => {
    expect(locLoi(loi, { tim: "bason" }).length).toBe(4);
    expect(locLoi(loi, { tim: "khong-co" })).toEqual([]);
  });
});
