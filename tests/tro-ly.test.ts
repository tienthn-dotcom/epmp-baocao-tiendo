/**
 * TRỢ LÝ ePMP — bộ trả lời.
 *
 * Phép kiểm gác đúng ba luật nền: không bịa, không tự tính lại luật, nói số thì nói lấy từ đâu.
 */
import { describe, it, expect } from "vitest";
import { traLoi, timDuAn, thangTrongCau, boDau } from "@/lib/tro-ly/hoi-dap";
import type { DuAnTom, NguonHoi } from "@/lib/tro-ly/kieu";

const da = (o: Partial<DuAnTom> & { maCT: string; ten: string }): DuAnTom => ({
  khoa: o.maCT, pm: "", vung: "", cdt: "", batDau: null, banGiao: null, ngayUpdate: null,
  pct: null, soHangMuc: 0, tre: 0, canCat: 0, canTapTrung: 0, vuongMac: "", giaiPhap: "",
  canTrinhMp: false, hanMp: null, soTuanTreMp: 0, daBanGiao: false, coBaoCao: false, dangHien: true,
  ...o,
});

const nguon = (duAn: DuAnTom[], sua: Partial<NguonHoi> = {}): NguonHoi => ({
  homNay: "2026-09-29",
  duAn,
  kpi: { hienHanh: duAn.length, tre: 0, canCat: 0, canTapTrung: 0, banGiaoThangNay: 0, top20: 0 },
  phienBan: "3.121.0",
  banMoi: [{ v: "3.121.0", date: "29/09/2026", items: ["Sắp xếp bảng theo cột"] }],
  vaiTro: "OCC",
  nguCanh: { man: "danh-sach", boLoc: [], dongDangHien: duAn.length, duAnDangMo: null, pham: "dang-loc" },
  ...sua,
});

const DS = [
  da({ maCT: "CT26-036", ten: "Văn phòng công ty Cao Trần", pm: "Nguyễn Tấn Kiệt", banGiao: "2026-10-15", canTrinhMp: true, hanMp: "2026-09-30", soHangMuc: 12 }),
  da({ maCT: "CT22-018", ten: "Park Hyatt Phú Quốc Hotel", pm: "Lê Tuấn", banGiao: "2026-09-30", tre: 4, soHangMuc: 30 }),
  da({ maCT: "CT26-120", ten: "APEC S5 Westin MUR", pm: "Trần Ngọc Phúc", banGiao: "2026-10-05", tre: 2, canTrinhMp: true, hanMp: "2026-09-01", soTuanTreMp: 4, soHangMuc: 9 }),
  da({ maCT: "CT25-002", ten: "Tulip Villa Vinhomes Riverside", pm: "Lê Tuấn", banGiao: "2026-10-10", soHangMuc: 7, daBanGiao: true }),
];

describe("KHÔNG BỊA — hỏi ngoài tầm thì nhận là chưa biết", () => {
  for (const cau of ["thời tiết Hà Nội mai thế nào", "giá thép hôm nay", "kể chuyện cười đi"]) {
    it(`"${cau}"`, () => {
      const r = traLoi(cau, nguon(DS));
      expect(r.khongBiet).toBe(true);
      expect(r.goiY?.length).toBeGreaterThan(0);
    });
  }

  it("hỏi dự án không có trong app thì không nặn ra dự án khác", () => {
    const r = traLoi("CT99-999 thế nào rồi", nguon(DS));
    expect(r.khongBiet).toBe(true);
  });

  it("câu rỗng cũng không vỡ", () => expect(traLoi("   ", nguon(DS)).khongBiet).toBe(true));
});

describe("số liệu lấy từ bản tóm, không tự tính lại", () => {
  it("đếm đúng dự án đang trễ", () => {
    const r = traLoi("dự án nào đang trễ", nguon(DS));
    expect(r.tieuDe).toContain("2 dự án");
    expect(r.nguon).toBeTruthy();
  });

  it("dự án cần trình BOD: xếp dự án quá hạn lên đầu", () => {
    const r = traLoi("dự án nào cần trình BOD", nguon(DS));
    expect(r.tieuDe).toContain("2 dự án");
    const kh = r.khoi.find((k) => k.loai === "du-an");
    expect(kh && kh.loai === "du-an" && kh.ds[0].maCT).toBe("CT26-120");
  });

  it("không có gì trễ thì nói thẳng là không có", () => {
    const r = traLoi("dự án nào đang trễ", nguon([da({ maCT: "A", ten: "A" })]));
    expect(r.tieuDe).toContain("Không có");
    expect(r.khongBiet).toBeFalsy();
  });

  it("mọi câu trả lời có số đều nói lấy từ đâu", () => {
    for (const cau of ["tổng quan hôm nay", "dự án nào đang trễ", "dự án nào cần trình BOD", "bàn giao tháng 10"]) {
      expect(traLoi(cau, nguon(DS)).nguon, cau).toBeTruthy();
    }
  });
});

describe("bàn giao theo tháng", () => {
  it("tháng 10 ra đúng ba dự án", () => {
    const r = traLoi("bàn giao tháng 10 có gì", nguon(DS));
    expect(r.tieuDe).toContain("3 dự án");
  });
  it("tháng không có dự án nào", () => {
    expect(traLoi("bàn giao tháng 12 có gì", nguon(DS)).tieuDe).toContain("Không có");
  });
  it("hiểu “tháng này” và “tháng sau”", () => {
    expect(thangTrongCau("bàn giao tháng này", "2026-09-29")).toBe("2026-09");
    expect(thangTrongCau("bàn giao tháng sau", "2026-09-29")).toBe("2026-10");
    expect(thangTrongCau("tháng 12 năm ngoái", "2026-09-29")).toBe("2026-12");
    expect(thangTrongCau("không nói tháng nào", "2026-09-29")).toBeNull();
  });
});

describe("tra một dự án", () => {
  it("theo mã CT", () => {
    const r = traLoi("CT26-036 thế nào rồi", nguon(DS));
    expect(r.tieuDe).toBe("Văn phòng công ty Cao Trần");
    expect(r.hanhDong?.some((h) => h.lenh.kieu === "mo-du-an")).toBe(true);
  });

  it("theo tên, viết thiếu dấu vẫn ra", () => {
    expect(traLoi("park hyatt phu quoc hotel sao roi", nguon(DS)).tieuDe).toBe("Park Hyatt Phú Quốc Hotel");
  });

  it("dự án cần trình BOD quá hạn thì nói rõ đang bị trừ bao nhiêu điểm", () => {
    const r = traLoi("CT26-120", nguon(DS));
    const nhac = r.khoi.filter((k) => k.loai === "nhac").map((k) => (k.loai === "nhac" ? k.chu : "")).join(" ");
    expect(nhac).toContain("40 điểm");
  });
});

describe("NGỮ CẢNH — đang mở dự án nào thì hiểu là hỏi dự án đó", () => {
  const nc = nguon(DS, { nguCanh: { man: "danh-sach", boLoc: [], dongDangHien: 4, duAnDangMo: { maCT: "CT22-018", ten: "Park Hyatt Phú Quốc Hotel" }, pham: "dang-loc" } });

  it("“sao chậm vậy” hiểu là hỏi dự án đang mở", () => {
    expect(traLoi("sao chậm vậy", nc).tieuDe).toBe("Park Hyatt Phú Quốc Hotel");
  });

  it("nhưng hỏi rõ mã khác thì theo mã đó, không bám dự án đang mở", () => {
    expect(traLoi("CT26-036 thế nào", nc).tieuDe).toBe("Văn phòng công ty Cao Trần");
  });
});

describe("PHẠM VI — đang lọc thì nói rõ là đang lọc", () => {
  const dsLoc = DS.map((d, i) => ({ ...d, dangHien: i < 2 }));
  const nc = nguon(dsLoc, { nguCanh: { man: "danh-sach", boLoc: ["PM: Lê Tuấn"], dongDangHien: 2, duAnDangMo: null, pham: "dang-loc" } });

  it("tổng quan tính trên phần đang lọc và có câu nhắc", () => {
    const r = traLoi("tổng quan", nc);
    const the = r.khoi.find((k) => k.loai === "the-so");
    expect(the && the.loai === "the-so" && the.the[0].gia).toBe("2");
    expect(r.khoi.some((k) => k.loai === "nhac" && /đang lọc/.test(k.chu))).toBe(true);
  });

  it("hỏi kèm chữ “tất cả” thì tính trên toàn bộ", () => {
    const r = traLoi("tổng quan tất cả", nc);
    const the = r.khoi.find((k) => k.loai === "the-so");
    expect(the && the.loai === "the-so" && the.the[0].gia).toBe("4");
  });

  it("người dùng đổi phạm vi sang tất cả thì theo phạm vi đó", () => {
    const r = traLoi("tổng quan", { ...nc, nguCanh: { ...nc.nguCanh, pham: "tat-ca" } });
    const the = r.khoi.find((k) => k.loai === "the-so");
    expect(the && the.loai === "the-so" && the.the[0].gia).toBe("4");
  });
});

describe("kiến thức về cách dùng app", () => {
  it("cú pháp ghi cần trình BOD", () => {
    const r = traLoi("ghi thế nào để vào bộ lọc MP", nguon(DS));
    expect(r.tieuDe).toContain("Cú pháp");
    const chu = r.khoi.map((k) => (k.loai === "chu" ? k.chu : "")).join(" ");
    expect(chu).toContain("bitrix");
  });

  it("câu hỏi về cú pháp KHÔNG bị nhánh số liệu nuốt mất", () => {
    expect(traLoi("cú pháp trình BOD", nguon(DS)).tieuDe).toContain("Cú pháp");
  });

  it("hỏi trợ lý làm được gì", () => {
    expect(traLoi("bạn làm được gì", nguon(DS)).tieuDe).toContain("giúp được gì");
  });

  it("phiên bản", () => {
    expect(traLoi("app có gì mới", nguon(DS)).tieuDe).toContain("3.121.0");
  });
});

describe("mấy hàm nhỏ", () => {
  it("bỏ dấu", () => expect(boDau("Trình BOD phê duyệt ĐÚNG")).toBe("trinh bod phe duyet dung"));
  it("tìm dự án theo mã có khoảng trắng", () => expect(timDuAn("ct 26-036 sao rồi", DS)[0]?.maCT).toBe("CT26-036"));
  it("tìm không ra thì trả mảng rỗng", () => expect(timDuAn("abc xyz", DS)).toHaveLength(0));
});
