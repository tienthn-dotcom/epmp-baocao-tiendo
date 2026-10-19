/* TRẠM XUẤT BÁO CÁO — kiểm phần đầu não.
 *
 * Bản in đi thẳng tới BOD nên chỗ nguy hiểm nhất KHÔNG phải là xấu, mà là MỘT CON SỐ SAI mà nhìn
 * vẫn thấy hợp lý: ô trống hoá thành 0%, cộng dồn số mã thiếu một dòng, lọc vùng rơi mất dự án.
 * Mấy thứ đó kiểm ở đây, không kiểm bằng mắt trên PDF.
 */
import { describe, expect, it } from "vitest";
import {
  congSoMa, demTomTat, dsDuAn, dsLoc, dungBaoCao, gomTheoVung, locDong, ngayVN, pctVN, soMaGon,
  tenTep, type DongNguon,
} from "@/lib/tram-bao-cao";

const d = (over: Partial<DongNguon> = {}): DongNguon => ({
  maCT: "CT26-105", duAn: "Villa Bason V60", vung: "Nam", cum: "Others", pm: "Phạm Xuân Hoành",
  hangMuc: "Sản xuất nhập kho", abbr: "SX",
  pctPlan: 60, pctActual: 50, start: "2026-09-01", deadline: "2026-10-30", overdueDays: null,
  soMa: [{ label: "Kho", done: 25, total: 50 }],
  ...over,
});

const rank = (v: string) => ["Phú Quốc", "Bắc", "Trung", "Nam"].indexOf(v) + 1 || 99;

describe("in số ra giấy", () => {
  it("ngày đổi sang kiểu Việt, ô trống để gạch", () => {
    expect(ngayVN("2026-10-16")).toBe("16/10/2026");
    expect(ngayVN(null)).toBe("—");
    expect(ngayVN("")).toBe("—");
  });
  /* CHỖ DỄ SAI NHẤT: file để trống KHÔNG được hoá thành 0% trên bản gửi sếp. */
  it("% trống in gạch ngang, KHÔNG thành 0%", () => {
    expect(pctVN(null)).toBe("—");
    expect(pctVN(0)).toBe("0%");
    expect(pctVN(49.6)).toBe("50%");
  });
  it("số mã cộng dồn hết các dòng con", () => {
    expect(congSoMa([{ label: "VT.CT", done: 1, total: 10 }, { label: "VT.NM", done: 90, total: 100 }]))
      .toEqual({ xong: 91, tong: 110 });
    expect(soMaGon([{ label: "VT.CT", done: null, total: 10 }])).toBe("0/10");
    expect(soMaGon(undefined)).toBe("—");
    expect(congSoMa([{ label: "x", done: 0, total: 0 }])).toBeNull();
  });
});

describe("lọc", () => {
  const ds = [
    d({ maCT: "A", vung: "Phú Quốc", hangMuc: "Đặt vật tư", abbr: "VT" }),
    d({ maCT: "B", vung: "Bắc", pm: "Lê Văn C" }),
    d({ maCT: "C", vung: "Bắc", duAn: "Tây Hồ View", cum: "THV" }),
  ];
  it("theo vùng", () => expect(locDong(ds, { vung: "Bắc" }).map((x) => x.maCT)).toEqual(["B", "C"]));
  it("theo hạng mục", () => expect(locDong(ds, { hangMuc: "Đặt vật tư" }).map((x) => x.maCT)).toEqual(["A"]));
  it("nhiều bộ lọc thì giao nhau", () => {
    expect(locDong(ds, { vung: "Bắc", pm: "Lê Văn C" }).map((x) => x.maCT)).toEqual(["B"]);
    expect(locDong(ds, { vung: "Phú Quốc", pm: "Lê Văn C" })).toEqual([]);
  });
  it("chọn đích danh dự án; rỗng = lấy hết", () => {
    expect(locDong(ds, { duAn: ["A", "C"] }).map((x) => x.maCT)).toEqual(["A", "C"]);
    expect(locDong(ds, { duAn: [] }).length).toBe(3);
  });
  /* Gõ tìm phải BỎ DẤU — không ai gõ đủ dấu khi đang vội. */
  it("gõ tìm không dấu vẫn ra", () => {
    expect(locDong(ds, { tim: "tay ho" }).map((x) => x.maCT)).toEqual(["C"]);
    expect(locDong(ds, { tim: "BASON" }).length).toBe(2);
  });
  it("danh sách lựa chọn kèm số dòng, nhiều nhất lên trước", () => {
    expect(dsLoc(ds, "vung")).toEqual([{ ten: "Bắc", so: 2 }, { ten: "Phú Quốc", so: 1 }]);
  });
  /* Ô chọn dự án xếp theo TÊN (người ta nhớ tên, không nhớ mã), mỗi mã đúng một lần. */
  it("danh sách dự án không lặp, xếp theo tên", () => {
    expect(dsDuAn(ds).map((x) => `${x.maCT}:${x.duAn}`))
      .toEqual(["C:Tây Hồ View", "A:Villa Bason V60", "B:Villa Bason V60"]);
  });
});

describe("đếm số đầu bảng", () => {
  const ds = [
    d({ maCT: "A", pctActual: 100 }),
    d({ maCT: "A", pctActual: null, soMa: undefined }),          // cùng dự án, chưa nhập %
    d({ maCT: "B", pctActual: 40, overdueDays: 12 }),
  ];
  const t = demTomTat(ds);
  it("đếm dự án theo mã, không đếm trùng", () => expect(t.soDuAn).toBe(2));
  it("đầu việc đếm đủ cả dòng chưa nhập", () => expect(t.soViec).toBe(3));
  /* Dòng chưa nhập % KHÔNG được kéo trung bình xuống — nó phải đứng ngoài phép tính. */
  it("trung bình chỉ tính dòng CÓ %", () => expect(t.pctTB).toBe(70));
  it("đếm xong và trễ", () => { expect(t.soXong).toBe(1); expect(t.soTre).toBe(1); });
  it("cộng số mã bỏ qua dòng không có", () => { expect(t.maXong).toBe(50); expect(t.maTong).toBe(100); });
  it("không dòng nào có % thì trung bình là null, không phải 0", () => {
    expect(demTomTat([d({ pctActual: null })]).pctTB).toBeNull();
  });
});

describe("gom theo vùng", () => {
  const ds = [d({ vung: "Nam" }), d({ vung: "Phú Quốc" }), d({ vung: "Bắc" })];
  it("xếp theo thứ tự vùng của app", () => {
    expect(gomTheoVung(ds, rank).map((n) => n.vung)).toEqual(["Phú Quốc", "Bắc", "Nam"]);
  });
  it("không mất dòng nào", () => {
    expect(gomTheoVung(ds, rank).reduce((a, n) => a + n.dong.length, 0)).toBe(3);
  });
});

describe("dựng bản báo cáo", () => {
  const ds = [
    d({ maCT: "A", duAn: "Apec S4", vung: "Phú Quốc", hangMuc: "Đặt vật tư", abbr: "VT", pctActual: 80, soMa: [{ label: "VT.CT", done: 8, total: 10 }] }),
    d({ maCT: "B", duAn: "Bason", vung: "Nam", hangMuc: "Đặt vật tư", abbr: "VT", pctActual: 20, overdueDays: 5, soMa: [{ label: "VT.CT", done: 2, total: 10 }] }),
    d({ maCT: "B", duAn: "Bason", vung: "Nam", hangMuc: "Thi công lắp đặt", abbr: "TC", pctActual: null, soMa: undefined }),
  ];

  it("lọc hạng mục xong thì tiêu đề nói đúng hạng mục đó", () => {
    const b = dungBaoCao(ds, { loai: "hangMuc", kieu: "pct", loc: { hangMuc: "Đặt vật tư" }, rank });
    expect(b.tieuDe).toBe("BÁO CÁO HẠNG MỤC: ĐẶT VẬT TƯ");
    expect(b.soDong).toBe(2);
    expect(b.phuDe).toContain("Hạng mục: Đặt vật tư");
  });

  /* Đổi nút %/số mã chỉ được đổi CỘT BÊN PHẢI, các cột khác giữ nguyên. */
  it("nút %/số mã đổi đúng một cột cuối", () => {
    const p = dungBaoCao(ds, { loai: "hangMuc", kieu: "pct", loc: {}, rank });
    const m = dungBaoCao(ds, { loai: "hangMuc", kieu: "ma", loc: {}, rank });
    const i = p.cot.length - 2;
    expect(p.cot[i].ten).toBe("Thực tế");
    expect(m.cot[i].ten).toBe("Số mã");
    expect(p.cot.map((c) => c.ten).filter((_, k) => k !== i)).toEqual(m.cot.map((c) => c.ten).filter((_, k) => k !== i));
    const pq = (b: typeof p) => b.nhom.find((n) => n.ten.startsWith("Phú Quốc"))!.dong[0];
    expect(pq(p)[i].t).toBe("80%");
    expect(pq(m)[i].t).toBe("8/10");
  });

  /* Lọc đúng một hạng mục thì bỏ cột "Hạng mục" (tiêu đề đã nói rồi) — mọi dòng phải cùng số ô
     với hàng tiêu đề, lệch một ô là cả bảng lệch cột mà vẫn in ra bình thường. */
  it("một hạng mục thì bỏ cột Hạng mục, số ô vẫn khớp hàng tiêu đề", () => {
    for (const hm of ["Đặt vật tư", ""]) {
      const b = dungBaoCao(ds, { loai: "hangMuc", kieu: "pct", loc: { hangMuc: hm }, rank });
      expect(b.cot.map((c) => c.ten).includes("Hạng mục")).toBe(!hm);
      for (const n of b.nhom) {
        for (const d of n.dong) expect(d.length).toBe(b.cot.length);
        expect(n.tong!.length).toBe(b.cot.length);
      }
    }
  });

  it("mỗi nhóm có dòng cộng, số khớp với dòng con", () => {
    const b = dungBaoCao(ds, { loai: "hangMuc", kieu: "ma", loc: { hangMuc: "Đặt vật tư" }, rank });
    const nam = b.nhom.find((n) => n.ten.startsWith("Nam"))!;
    expect(nam.tong![b.cot.length - 2].t).toBe("2/10");
    expect(nam.tong![b.cot.length - 1].t).toBe("1");
  });

  it("bản tổng hợp: mỗi dự án một dòng, hạng mục thành cột theo thứ tự app", () => {
    const b = dungBaoCao(ds, { loai: "tongHop", kieu: "pct", loc: {}, rank, thuTuAbbr: ["VT", "SX", "TC"] });
    expect(b.cot.map((c) => c.ten)).toEqual(["Mã CT", "Dự án", "PM", "VT", "TC", "Trễ"]);
    const bason = b.nhom.find((n) => n.ten.startsWith("Nam"))!.dong[0];
    expect(bason[1].t).toBe("Bason");
    expect(bason[3].t).toBe("20%");
    expect(bason[4].t).toBe("—");   // TC chưa nhập % → gạch, KHÔNG phải 0%
  });

  it("bản trễ hạn chỉ giữ dòng quá mốc, trễ nhiều lên trước", () => {
    const them = [...ds, d({ maCT: "C", duAn: "Cát Bà", vung: "Nam", overdueDays: 30 })];
    const b = dungBaoCao(them, { loai: "treHan", kieu: "pct", loc: {}, rank });
    expect(b.soDong).toBe(2);
    expect(b.nhom[0].dong.map((r) => r[1].t)).toEqual(["Cát Bà", "Bason"]);
  });

  it("cả ba loại: mọi dòng đúng bằng số cột", () => {
    for (const loai of ["hangMuc", "tongHop", "treHan"] as const) {
      for (const kieu of ["pct", "ma"] as const) {
        const b = dungBaoCao([...ds, d({ maCT: "C", duAn: "Cát Bà", vung: "Bắc", overdueDays: 9 })],
          { loai, kieu, loc: {}, rank, thuTuAbbr: ["VT", "SX", "TC"] });
        for (const n of b.nhom) {
          for (const r of n.dong) expect(r.length).toBe(b.cot.length);
          if (n.tong) expect(n.tong.length).toBe(b.cot.length);
        }
      }
    }
  });

  it("lọc hụt thì soDong = 0 chứ không nổ", () => {
    const b = dungBaoCao(ds, { loai: "hangMuc", kieu: "pct", loc: { vung: "Trung" }, rank });
    expect(b.soDong).toBe(0);
    expect(b.nhom).toEqual([]);
    expect(b.nhanXet).toEqual([]);
  });

  it("nhận xét nêu đích danh chỗ trễ nhất và số dòng chưa nhập", () => {
    const b = dungBaoCao(ds, { loai: "hangMuc", kieu: "pct", loc: {}, rank });
    expect(b.nhanXet.some((s) => s.includes("Bason") && s.includes("5 ngày"))).toBe(true);
    expect(b.nhanXet.some((s) => s.includes("chưa nhập %"))).toBe(true);
  });

  it("tên tệp bỏ dấu, gắn ngày", () => {
    const b = dungBaoCao(ds, { loai: "tongHop", kieu: "pct", loc: {}, rank });
    expect(tenTep(b, new Date(2026, 9, 16))).toBe("bao_cao_tong_hop_tien_do_16102026.pdf");
  });
});
