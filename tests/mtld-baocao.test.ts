/**
 * Bộ đọc bảng lắp đặt — dựng theo ĐÚNG hình dạng 3 file thật đang gắn trên app
 * (Nam Phương "Public Summary 2", Mini Hotel "Public Summary", Tây Hồ View "PUBLIC 4S").
 * Mấy ca ở đây đều là lỗi đã thật sự xảy ra khi chạy trên file thật, không phải ca tưởng tượng.
 */
import { describe, it, expect } from "vitest";
import { docBaoCao, docBangPct, tomTat, tomTatBangPct, doanNhom, type O } from "@/lib/mtld-baocao";

/** Hình dạng NPHH: tiêu đề ở dòng 1, header dòng 2, CÓ cột "Mã dự án" (tab dùng chung nhiều dự án). */
const NPHH: O[][] = [
  ["NPHH - BÁO CÁO % HOÀN THÀNH LẮP ĐẶT SO VỚI KẾ HOẠCH", null, null, null, null, null, null, null, null, null, null, null, null],
  ["STT", "Mã dự án", "Các khu", "Ngày bắt đầu", "Ngày bàn giao", "Số ngày tổng", "Số ngày còn lại",
   "% Hoàn thành dự kiến", "% tăng thêm trong ngày", "% Hoàn thành thực tế", "% xong hôm trước",
   "CẢNH BÁO TRỄ\nTIẾN ĐỘ", "Chênh lệch\nso với\nkế hoạch"],
  [1, "CT25-070", "Main Lobby", "x", "y", 137, -10, 1, 0, 0.9, 0.9, "CHẬM NHẸ", -0.1],
  [2, "CT25-070", "Lounge Cafe", "x", "y", 121, -4, 1, 0.02, 0.8, 0.78, "CHẬM - BÁO ĐỘNG", -0.2],
  [3, "CT26-055", "Khối A", "x", "y", 128, 102, 0.2, 0, 0, 0, "CHẬM - BÁO ĐỘNG", -0.2],
];

/** Hình dạng Mini Hotel: header xuống dòng 3, cột khu tên "Các khu PUBLIC", KHÔNG có cột mã dự án. */
const MINI: O[][] = [
  [null, null, null, null, null, null, null, null, null],
  ["MINIHOTEL - BÁO CÁO % HOÀN THÀNH LẮP ĐẶT (THÔ) SO VỚI KẾ HOẠCH", null, null, null, null, null, null, null, null],
  ["Số thứ tự", "Các khu\nPUBLIC", "Ngày bắt đầu", "Ngày bàn giao", "Số ngày tổng", "Số ngày còn lại",
   "% Hoàn thành dự kiến", "% xong hôm trước", "% Hoàn thành thực tế"],
  [1, "Lobby B1", "x", "y", 96, -25, 1, 0.98, 1],
  [2, "Lobby B2", "x", "y", 95, 12, 1, 0.9, 0.9],
];

describe("docBaoCao — bảng BÁO CÁO % HOÀN THÀNH", () => {
  it("đọc được dù tiêu đề nằm ở dòng khác nhau và cột đảo thứ tự", () => {
    const a = docBaoCao(NPHH, "CT25-070");
    const b = docBaoCao(MINI);
    expect(a.ok && a.khu.length).toBe(2);
    expect(b.ok && b.khu.length).toBe(2);
    expect(a.ok && a.tieuDe).toMatch(/^NPHH/);
  });

  it("LỌC theo mã dự án — tab dùng chung thì không kéo khu của dự án khác vào", () => {
    const r = docBaoCao(NPHH, "CT25-070");
    expect(r.ok && r.khu.map((k) => k.khu)).toEqual(["Main Lobby", "Lounge Cafe"]);
    const khac = docBaoCao(NPHH, "CT26-055");
    expect(khac.ok && khac.khu.map((k) => k.khu)).toEqual(["Khối A"]);
  });

  it("không có dòng tiêu đề thì báo lỗi chứ không trả số bừa", () => {
    expect(docBaoCao([["MA TRẬN BÀN GIAO"], [1, 2, 3]]).ok).toBe(false);
  });

  it("tomTat: chênh lệch = thực tế − kế hoạch, đếm đúng đạt/chậm/báo động", () => {
    const r = docBaoCao(NPHH, "CT25-070");
    if (!r.ok) throw new Error("phải đọc được");
    const t = tomTat(r.khu);
    expect(t.pctThuc).toBe(85);       // (0.9 + 0.8) / 2
    expect(t.pctDuKien).toBe(100);
    expect(t.chenhLech).toBe(-15);
    expect(t.baoDong).toBe(1);
    expect(t.chamNhe).toBe(1);
    expect(t.soNgayConLai).toBe(-10); // khu gấp nhất
  });
});

/** Hình dạng Tây Hồ View: dòng 1 là TỰA ĐỀ có sẵn chữ "% THỰC HIỆN", header thật ở dòng 2. */
const THV: O[][] = [
  ["MA TRẬN BÀN GIAO VÀ % THỰC HIỆN KHU CÔNG CỘNG 4S", null, null, null, null],
  ["CĂN", "STT", "TẦNG", "% THỰC HIỆN", "GHI CHÚ"],
  [null, null, null, 0.54, null],                    // dòng tổng: ô CĂN trống → phải bỏ qua
  ["KHU CHANGING ROOM & SPA", 1, "TẦNG 3", 0.4, "ghi chú"],
  ["KHU GYM & YOGA", 2, "TẦNG 4", 0.6, null],
];

describe("docBangPct — ma trận chỉ có cột phần trăm", () => {
  it("không bắt nhầm DÒNG TỰA ĐỀ có chữ '% THỰC HIỆN'", () => {
    const r = docBangPct(THV);
    expect(r.ok && r.ten).toBe("% THỰC HIỆN");
    expect(r.ok && r.dong.map((d) => d.ten)).toEqual(["KHU CHANGING ROOM & SPA", "KHU GYM & YOGA"]);
    expect(tomTatBangPct(r.ok ? r.dong : []).pctThuc).toBe(50);
  });

  it("KHÔNG nhận cột 'Tổng' đếm số lượng — thà không có số còn hơn hiện 127%", () => {
    const demCan: O[][] = [
      ["Tổng", 427, "B1", "B2"],
      ["L06", 0.03, 1, 2],
      ["L05", 0.48, 1, 2],
    ];
    expect(docBangPct(demCan).ok).toBe(false);
  });

  it("bỏ qua giá trị ngoài thang 0..1 thay vì tự chia 100", () => {
    const r = docBangPct([["KHU", "% HOÀN THÀNH"], ["A", 0.5], ["B", 96]]);
    expect(r.ok && r.dong.map((d) => d.ten)).toEqual(["A"]);
  });
});

describe("doanNhom", () => {
  it("tách Public và Khối phòng theo tiêu đề / tên tab / tên dự án", () => {
    expect(doanNhom("BÁO CÁO % HOÀN THÀNH", "Public Summary 2", "NPHH Nhà hàng")).toBe("public");
    expect(doanNhom("", "Summary", "Mini Hotel PQ (B1-B5) Phòng")).toBe("rooms");
    expect(doanNhom("MA TRẬN … KHU CÔNG CỘNG 4S", "PUBLIC 4S", "Tây Hồ View")).toBe("public");
  });
});
