/**
 * Kho số lắp đặt — CSV vào/ra và mấy phép gộp dựng dashboard.
 * CSV là cửa để người ta nạp số bằng tay, nên nó phải chịu được dữ liệu người thật gõ:
 * ngày kiểu Excel, tên khu có dấu phẩy, ô trống, dòng hỏng.
 */
import { describe, it, expect } from "vitest";
import {
  sangCsv, docCsv, chuanNgay, duongNgay, moiNhatTheoDuAn, tongQuan, COT_KHO, type MocKho,
} from "@/lib/lapdat-kho";

const moc = (o: Partial<MocKho>): MocKho => ({
  ngay: "2026-09-09", maCT: "CT25-070", duAn: "NPHH Public", khu: "Main Lobby", scope: "public",
  pctThuc: 90, pctDuKien: 100, pctHomTruoc: 88, chenhLech: -10, tangNgay: 2,
  canhBao: "CHẬM NHẸ", ngayBanGiao: "2026-08-30", soNgayConLai: -10, nguon: "bang", ...o,
});

describe("CSV", () => {
  it("xuất rồi nạp lại ra đúng dữ liệu cũ", () => {
    const rows = [moc({}), moc({ khu: "Public Toilet 1,3", canhBao: "CHẬM - BÁO ĐỘNG" })];
    const lai = docCsv(sangCsv(rows));
    expect(lai.rows).toEqual(rows);
    expect(lai.bo).toBe(0);
  });

  it("giữ nguyên tên khu có dấu phẩy", () => {
    const csv = sangCsv([moc({ khu: "Public Toilet 1,3" })]);
    expect(csv).toContain('"Public Toilet 1,3"');
    expect(docCsv(csv).rows[0].khu).toBe("Public Toilet 1,3");
  });

  it("nhận ngày kiểu Excel dd/mm/yyyy", () => {
    expect(chuanNgay("09/09/2026")).toBe("2026-09-09");
    expect(chuanNgay("9/9/2026")).toBe("2026-09-09");
    expect(chuanNgay("2026-09-09")).toBe("2026-09-09");
    expect(chuanNgay("linh tinh")).toBe("");
  });

  it("thiếu cột bắt buộc thì báo ngay, không nạp nửa vời", () => {
    const r = docCsv("ngay,maCT\n2026-09-09,CT25-070");
    expect(r.rows).toHaveLength(0);
    expect(r.loi[0]).toMatch(/thiếu cột bắt buộc/);
  });

  it("bỏ dòng hỏng và kể ra, phần còn lại vẫn nạp", () => {
    const r = docCsv(`${COT_KHO.join(",")}\n2026-09-09,CT1,A,Khu 1,rooms,80,,,,,,,,\nlinh tinh,CT1,A,Khu 2,rooms,80,,,,,,,,`);
    expect(r.rows).toHaveLength(1);
    expect(r.bo).toBe(1);
    expect(r.loi[0]).toMatch(/không đúng dạng/);
  });

  it("ô trống thành null chứ không thành 0 — chưa có số khác hẳn số bằng 0", () => {
    const r = docCsv(`${COT_KHO.join(",")}\n2026-09-09,CT1,A,Khu 1,rooms,,,,,,,,,`);
    expect(r.rows[0].pctThuc).toBeNull();
    expect(r.rows[0].pctDuKien).toBeNull();
  });
});

describe("gộp để vẽ", () => {
  const rows: MocKho[] = [
    // Ngày 1: dự án A hai khu (80, 100), dự án B một khu (40)
    moc({ ngay: "2026-09-01", duAn: "A", khu: "K1", pctThuc: 80, pctDuKien: 90 }),
    moc({ ngay: "2026-09-01", duAn: "A", khu: "K2", pctThuc: 100, pctDuKien: 90 }),
    moc({ ngay: "2026-09-01", duAn: "B", maCT: "CT2", khu: "K1", pctThuc: 40, pctDuKien: 90 }),
    // Ngày 2: A nhích lên, B đứng yên
    moc({ ngay: "2026-09-02", duAn: "A", khu: "K1", pctThuc: 90, pctDuKien: 95, canhBao: "ĐẠT" }),
    moc({ ngay: "2026-09-02", duAn: "A", khu: "K2", pctThuc: 100, pctDuKien: 95, canhBao: "ĐẠT" }),
    moc({ ngay: "2026-09-02", duAn: "B", maCT: "CT2", khu: "K1", pctThuc: 40, pctDuKien: 95, canhBao: "CHẬM - BÁO ĐỘNG" }),
  ];

  it("đường theo ngày lấy trung bình theo DỰ ÁN, không để dự án nhiều khu đè dự án ít khu", () => {
    const d = duongNgay(rows);
    expect(d.map((x) => x.ngay)).toEqual(["2026-09-01", "2026-09-02"]);
    // A = (80+100)/2 = 90, B = 40 → (90+40)/2 = 65. Nếu gộp thẳng theo khu sẽ ra 73,3.
    expect(d[0].thuc).toBe(65);
    expect(d[0].soDuAn).toBe(2);
    expect(d[1].thuc).toBe(67.5);
  });

  it("ảnh chụp mới nhất lấy ngày cuối cùng của TỪNG dự án", () => {
    const ds = moiNhatTheoDuAn(rows);
    expect(ds).toHaveLength(2);
    expect(ds.every((d) => d.ngay === "2026-09-02")).toBe(true);
    const b = ds.find((d) => d.duAn === "B")!;
    expect(b.thuc).toBe(40);
    expect(b.chenh).toBe(-55);
    expect(b.baoDong).toBe(1);
    expect(ds[0].duAn).toBe("B");   // trễ nhất lên đầu
  });

  it("số tổng đếm dự án trễ và khu báo động", () => {
    const t = tongQuan(moiNhatTheoDuAn(rows));
    expect(t.soDuAn).toBe(2);
    expect(t.soKhu).toBe(3);
    expect(t.ngayMoiNhat).toBe("2026-09-02");
    expect(t.soTre).toBe(1);        // B trễ 55, A chỉ trễ 0
    expect(t.soBaoDong).toBe(1);
    expect(t.soQuaHan).toBe(2);     // cả hai đều soNgayConLai = -10
  });

  it("dự án không có kế hoạch thì không bịa ra chênh lệch", () => {
    const ds = moiNhatTheoDuAn([moc({ duAn: "C", pctDuKien: null, chenhLech: null })]);
    expect(ds[0].keHoach).toBeNull();
    expect(ds[0].chenh).toBeNull();
  });

  it("chênh lệch tổng KHÔNG trộn dự án không có kế hoạch vào phép trừ", () => {
    const ds = moiNhatTheoDuAn([
      moc({ duAn: "A", pctThuc: 90, pctDuKien: 100 }),
      moc({ duAn: "B", maCT: "CT2", pctThuc: 50, pctDuKien: null, chenhLech: null }),
    ]);
    const t = tongQuan(ds);
    expect(t.thuc).toBe(70);          // % thực tế vẫn gồm cả hai dự án
    expect(t.keHoach).toBe(100);
    expect(t.chenh).toBe(-10);        // chỉ A được đem so; trộn B vào sẽ ra -30
    expect(t.soCoKeHoach).toBe(1);
  });
});
