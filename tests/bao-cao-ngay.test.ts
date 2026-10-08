/**
 * Chấm tuân thủ báo cáo hằng ngày (Quân số · TC lắp đặt · Sản lượng).
 *
 * Điểm ăn thẳng vào đánh giá PM nên mọi RANH GIỚI GIỜ phải đúng tới từng phút, và phải đúng ở cả
 * hai phía của mốc. Bộ kiểm này đi theo từng mốc một, không kiểm "khoảng giữa" cho qua chuyện.
 */
import { describe, it, expect } from "vitest";
import {
  HANG_MUC, hangMucTheoMa, gioHan, gioHetTre, TRU,
  laNgayCham, ngayChamCuaThang, chamNgay, diemHangMuc, xepLoai, chamDuAn,
} from "@/lib/bao-cao-ngay";

const QS = hangMucTheoMa("QS")!;
const TC = hangMucTheoMa("TC")!;
const SL = hangMucTheoMa("SL")!;

/** Ngày thứ Tư bình thường, dùng làm ngày chấm mẫu. Hôm nay đặt xa về sau để mọi ngày đều đã chốt. */
const NGAY = "2026-09-16";
const SAU = "2026-09-30";
const cham = (hm: typeof QS, ...gio: string[]) => chamNgay(NGAY, hm, gio.map((g) => `${NGAY}T${g}`), SAU);

/* TC LẮP ĐẶT ĐỔI 17:30/19:30 → 18:00/20:00 ngày 08/10/2026. Anh Tiến: "cái TCLĐ với Thi công
   lắp đặt là 1, chốt theo đó nhé, gộp đi". Đầu file nguồn BCN ghi "Thi công lắp đặt 18:00" và
   anh Tiến nhắn lại đúng 18:00 / 20:00 — hai nguồn mới khớp nhau nên thay số của 16/09. */
describe("giờ hạn ba hạng mục", () => {
  it("đúng giờ đã chốt", () => {
    expect([gioHan(QS), gioHetTre(QS)]).toEqual(["09:00", "11:00"]);
    expect([gioHan(TC), gioHetTre(TC)]).toEqual(["18:00", "20:00"]);
    expect([gioHan(SL), gioHetTre(SL)]).toEqual(["18:00", "20:00"]);
  });
  it("cả ba đều có cửa sổ trễ đúng 120 phút", () => {
    for (const h of HANG_MUC) expect(h.hetTre - h.han).toBe(120);
  });
  it("mức trừ: trễ 2, không báo cáo 5", () => {
    expect(TRU).toEqual({ tre: 2, khong: 5 });
  });
});

describe("ranh giới giờ — kiểm cả hai phía từng mốc", () => {
  it("quân số: hạn 09:00", () => {
    expect(cham(QS, "08:59")).toBe("P");
    expect(cham(QS, "09:00")).toBe("P");   // ĐÚNG mốc vẫn là đúng hạn
    expect(cham(QS, "09:01")).toBe("o");
  });
  it("quân số: hết trễ 11:00", () => {
    expect(cham(QS, "10:59")).toBe("o");
    expect(cham(QS, "11:00")).toBe("o");   // ĐÚNG mốc vẫn còn trong cửa sổ trễ
    expect(cham(QS, "11:01")).toBe("x");
  });
  it("thi công lắp đặt: 18:00 và 20:00", () => {
    expect(cham(TC, "18:00")).toBe("P");
    expect(cham(TC, "18:01")).toBe("o");
    expect(cham(TC, "20:00")).toBe("o");
    expect(cham(TC, "20:01")).toBe("x");
  });
  it("sản lượng: 18:00 và 20:00", () => {
    expect(cham(SL, "18:00")).toBe("P");
    expect(cham(SL, "18:01")).toBe("o");
    expect(cham(SL, "20:00")).toBe("o");
    expect(cham(SL, "20:01")).toBe("x");
  });
  it("nộp lúc nửa đêm vẫn đọc được, và là X", () => {
    expect(cham(SL, "23:59")).toBe("x");
    expect(cham(QS, "00:00")).toBe("P");
  });
});

describe("không nộp, nộp nhiều lần, nộp bù", () => {
  it("không nộp thì X", () => {
    expect(cham(QS)).toBe("x");
  });
  it("nộp NHIỀU LẦN thì tính lần SỚM NHẤT", () => {
    // Nộp đúng hạn rồi quay lại sửa lúc muộn: KHÔNG vì thế mà thành trễ.
    expect(cham(QS, "08:30", "14:00")).toBe("P");
    expect(cham(QS, "14:00", "08:30")).toBe("P");   // thứ tự trong mảng không đổi kết quả
    expect(cham(QS, "09:30", "10:30")).toBe("o");
  });
  it("NỘP BÙ hôm sau vẫn là X — số liệu không còn phục vụ được ngày đó", () => {
    const buSang = chamNgay(NGAY, QS, ["2026-09-17T08:00"], SAU);
    expect(buSang).toBe("x");
  });
  it("dấu thời gian đọc không ra thì coi như chưa nộp", () => {
    expect(chamNgay(NGAY, QS, ["linh tinh"], SAU)).toBe("x");
    expect(chamNgay(NGAY, QS, [`${NGAY}T99:99`], SAU)).toBe("x");
  });
});

describe("ngày nào được chấm", () => {
  it("thứ 7 và chủ nhật không chấm", () => {
    expect(laNgayCham("2026-09-19")).toBe(false);   // thứ 7
    expect(laNgayCham("2026-09-20")).toBe(false);   // chủ nhật
    expect(laNgayCham("2026-09-18")).toBe(true);    // thứ 6
    expect(laNgayCham("2026-09-21")).toBe(true);    // thứ 2
  });
  it("ngày lễ nạp vào thì không chấm", () => {
    const nghi = new Set(["2026-09-02"]);
    expect(laNgayCham("2026-09-02", nghi)).toBe(false);
    expect(laNgayCham("2026-09-02")).toBe(true);
  });
  it("tháng 9/2026 có 22 ngày công", () => {
    expect(ngayChamCuaThang("2026-09")).toHaveLength(22);
  });
  it("cuối tuần và lễ trả null, KHÔNG phải X", () => {
    expect(chamNgay("2026-09-19", QS, [], SAU)).toBeNull();
    expect(chamNgay("2026-09-18", QS, [], SAU, new Set(["2026-09-18"]))).toBeNull();
  });
});

describe("ngày chưa tới thì chưa chấm", () => {
  it("ngày mai không bị tính là X", () => {
    expect(chamNgay("2026-09-18", QS, [], "2026-09-16")).toBeNull();
  });
  it("HÔM NAY chưa thấy nộp thì CHƯA kết luận — người ta còn đang trong giờ được phép", () => {
    expect(chamNgay(NGAY, QS, [], NGAY)).toBeNull();
  });
  it("nhưng hôm nay ĐÃ nộp thì chấm được ngay", () => {
    expect(chamNgay(NGAY, QS, [`${NGAY}T08:00`], NGAY)).toBe("P");
    expect(chamNgay(NGAY, QS, [`${NGAY}T09:30`], NGAY)).toBe("o");
  });
});

describe("điểm hạng mục", () => {
  it("không lỗi nào thì 100", () => {
    expect(diemHangMuc(["P", "P", "P"])).toBe(100);
  });
  it("trễ 2 lần còn 96, trễ 5 lần còn 90", () => {
    expect(diemHangMuc(["o", "o", "P"])).toBe(96);
    expect(diemHangMuc(["o", "o", "o", "o", "o"])).toBe(90);
  });
  it("quên 1 lần trễ 2 lần còn 91", () => {
    expect(diemHangMuc(["x", "o", "o", "P"])).toBe(91);
  });
  it("quên 20 lần thì chạm sàn 0, KHÔNG âm", () => {
    expect(diemHangMuc(Array(20).fill("x"))).toBe(0);
    expect(diemHangMuc(Array(50).fill("x"))).toBe(0);
  });
  it("ngày không chấm KHÔNG kéo điểm xuống", () => {
    expect(diemHangMuc(["P", null, null, "P"])).toBe(100);
  });
  it("chưa chấm được ngày nào thì null, KHÔNG phải 100", () => {
    // Chưa có dữ liệu mà cho điểm tuyệt đối là báo cáo sai sự thật.
    expect(diemHangMuc([])).toBeNull();
    expect(diemHangMuc([null, null])).toBeNull();
  });
});

describe("xếp loại", () => {
  it("đúng bốn mốc của khung PMO", () => {
    expect([100, 95].map(xepLoai)).toEqual(["A", "A"]);
    expect([94, 85].map(xepLoai)).toEqual(["B", "B"]);
    expect([84, 70].map(xepLoai)).toEqual(["C", "C"]);
    expect([69, 0].map(xepLoai)).toEqual(["D", "D"]);
  });
});

describe("chấm trọn một dự án", () => {
  const duAn = { key: "id:1", maCT: "CT26-040", ten: "APEC_S2_Public" };

  it("ba dòng, đúng thứ tự Quân số · TC lắp đặt · Sản lượng", () => {
    const r = chamDuAn(duAn, "2026-09", [], SAU);
    expect(r.dong.map((d) => d.hangMuc.ma)).toEqual(["QS", "TC", "SL"]);
    expect(r.dong[0].marks).toHaveLength(22);
  });

  it("điểm dự án là trung bình ba hạng mục", () => {
    const ngay = ngayChamCuaThang("2026-09");
    // QS nộp đúng hạn mọi ngày; TC trễ một hôm; SL quên một hôm.
    const nop = [
      ...ngay.map((d) => ({ ngay: d, ma: "QS" as const, luc: `${d}T08:00` })),
      // TC hạn 18:00 (đổi từ 17:30 ngày 08/10/2026) → nộp 18:30 mới là TRỄ, 18:00 vẫn đúng giờ.
      ...ngay.map((d, i) => ({ ngay: d, ma: "TC" as const, luc: `${d}T${i === 0 ? "18:30" : "17:00"}` })),
      ...ngay.slice(1).map((d) => ({ ngay: d, ma: "SL" as const, luc: `${d}T17:00` })),
    ];
    const r = chamDuAn(duAn, "2026-09", nop, SAU);
    expect(r.dong.map((d) => d.diem)).toEqual([100, 98, 95]);
    expect(r.diem).toBe(98);   // (100 + 98 + 95) / 3 = 97.67 → 98
  });

  it("ngoài khoảng dự án chạy thì không chấm, không phải X", () => {
    const r = chamDuAn(duAn, "2026-09", [], SAU, { khoang: { tu: "2026-09-21" } });
    const truoc = r.dong[0].marks.slice(0, 5);
    expect(truoc.every((m) => m === null)).toBe(true);
  });

  it("dự án chưa có dữ liệu nào thì điểm null, không phải 0 cũng không phải 100", () => {
    const r = chamDuAn(duAn, "2026-09", [], "2026-08-31");   // cả tháng còn ở tương lai
    expect(r.diem).toBeNull();
    expect(r.dong.every((d) => d.diem === null)).toBe(true);
  });
});
