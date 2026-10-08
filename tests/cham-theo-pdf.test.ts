/* CHẤM TUÂN THỦ THEO LƯỢT XUẤT PDF.
 *
 * Anh Tiến 08/10/2026: *"ngày nào trước 18 giờ xuất PDF thì tick, sau 18 giờ thì là o, và sau 20
 * giờ thì là x"*.
 *
 * Đây là chỗ CHẤM NGƯỜI, nên test đi tới từng phút ranh giới. Sai một phút ở đây là một người bị
 * ghi trễ oan, mà bảng vẫn trông bình thường nên chẳng ai cãi được.
 */
import { describe, expect, it } from "vitest";
import {
  dauTheoPhut, lucVn, gomLuot, daQuaHan, dauCuaNgay, ngayTrongThang, ghiLuot, khoaDuAn,
  HAN_PHUT, HET_TRE_PHUT, NGAY_BAT_DAU_CHAM,
} from "@/lib/cham-theo-pdf";

/** Giờ VN → mốc ISO (UTC). VN = UTC+7, không có giờ mùa hè. */
const vn = (ngay: string, gio: number, phut = 0, giay = 0) =>
  new Date(Date.parse(`${ngay}T00:00:00Z`) - 7 * 3600_000 + gio * 3600_000 + phut * 60_000 + giay * 1000).toISOString();

describe("đổi mốc ISO sang giờ VN", () => {
  it("cộng đúng 7 tiếng", () => {
    expect(lucVn("2026-10-08T11:00:00Z")).toEqual({ ngay: "2026-10-08", phut: 18 * 60 });
  });
  it("qua nửa đêm thì SANG NGÀY MỚI theo giờ VN, không theo UTC", () => {
    // 18:00 UTC ngày 07 = 01:00 VN ngày 08.
    expect(lucVn("2026-10-07T18:00:00Z")).toEqual({ ngay: "2026-10-08", phut: 60 });
  });
  it("chuỗi hỏng → null, không ném", () => {
    expect(lucVn("khong-phai-ngay")).toBeNull();
    expect(lucVn("")).toBeNull();
  });
});

describe("ranh giới dấu — đọc đúng câu chữ", () => {
  it("17:59 → tick", () => expect(dauTheoPhut(17 * 60 + 59)).toBe("P"));
  /* ĐÚNG PHÚT HẠN VẪN LÀ ĐÚNG GIỜ — giữ y luật của chamNgay (17:30 là ✓, 17:31 mới là o). Anh Tiến
     chốt 08/10/2026 gộp TCLĐ với Thi công lắp đặt làm một, nên hai chỗ phải cùng MỘT thước. */
  it("18:00 đúng phút → vẫn là tick, cùng luật với bảng chấm cũ", () => expect(dauTheoPhut(HAN_PHUT)).toBe("P"));
  it("18:01 → đã trễ", () => expect(dauTheoPhut(HAN_PHUT + 1)).toBe("o"));
  it("19:59 → trễ", () => expect(dauTheoPhut(19 * 60 + 59)).toBe("o"));
  /* "SAU 20 giờ thì là x" → đúng 20:00 chưa phải "sau", nên vẫn còn là trễ. */
  it("20:00 đúng phút → vẫn trễ, CHƯA thành x", () => expect(dauTheoPhut(HET_TRE_PHUT)).toBe("o"));
  it("20:01 → x", () => expect(dauTheoPhut(HET_TRE_PHUT + 1)).toBe("x"));
  it("sáng sớm cũng là tick", () => expect(dauTheoPhut(0)).toBe("P"));
});

describe("gom nhật ký thành bảng dấu", () => {
  it("lấy lượt SỚM NHẤT trong ngày — xuất lại buổi tối không làm mất tick", () => {
    const b = gomLuot([
      { ts: vn("2026-10-08", 21, 30), duAn: "CT26-040" },   // xem lại lúc 21:30
      { ts: vn("2026-10-08", 17, 0), duAn: "CT26-040" },    // nộp thật lúc 17:00
    ]);
    expect(b.get("CT26-040")!.get("2026-10-08")).toBe("P");
  });

  it("tách đúng theo dự án và theo ngày", () => {
    const b = gomLuot([
      { ts: vn("2026-10-08", 9, 0), duAn: "CT26-040" },
      { ts: vn("2026-10-08", 19, 0), duAn: "CT26-041" },
      { ts: vn("2026-10-09", 21, 0), duAn: "CT26-040" },
    ]);
    expect(b.get("CT26-040")!.get("2026-10-08")).toBe("P");
    expect(b.get("CT26-040")!.get("2026-10-09")).toBe("x");
    expect(b.get("CT26-041")!.get("2026-10-08")).toBe("o");
  });

  it("dòng hỏng (thiếu dự án / mốc sai) bị bỏ, không ném", () => {
    const b = gomLuot([
      { ts: "rac", duAn: "CT26-040" },
      { ts: vn("2026-10-08", 9, 0), duAn: "" },
      { ts: vn("2026-10-08", 9, 0), duAn: "CT26-041" },
    ]);
    expect(b.size).toBe(1);
    expect(b.get("CT26-041")!.get("2026-10-08")).toBe("P");
  });

  it("nhật ký rỗng → bảng rỗng", () => expect(gomLuot([]).size).toBe(0));
});

/* ĐIỀU DỄ SAI NHẤT: ngày chưa kết thúc mà đã chấm "x" là chấm oan, mà bảng vẫn trông bình thường
   nên không ai phát hiện. */
describe("ngày chưa qua thì ĐỂ TRỐNG, không phải x", () => {
  const bang = gomLuot([]);
  const bayGio = (ngay: string, gio: number, phut = 0) => Date.parse(vn(ngay, gio, phut));

  it("hôm nay 15:00, chưa ai xuất → để TRỐNG", () => {
    expect(dauCuaNgay(bang, "CT26-040", "2026-10-08", bayGio("2026-10-08", 15))).toBeNull();
  });
  it("hôm nay 19:00 (quá hạn nhưng còn trong cửa sổ trễ) → vẫn TRỐNG", () => {
    expect(dauCuaNgay(bang, "CT26-040", "2026-10-08", bayGio("2026-10-08", 19))).toBeNull();
  });
  it("đúng 20:00 → vẫn TRỐNG, cửa sổ chưa đóng", () => {
    expect(daQuaHan("2026-10-08", bayGio("2026-10-08", 20))).toBe(false);
  });
  it("20:01 → chốt, không xuất thì là x", () => {
    expect(dauCuaNgay(bang, "CT26-040", "2026-10-08", bayGio("2026-10-08", 20, 1))).toBe("x");
  });
  it("ngày mai → TRỐNG", () => {
    expect(dauCuaNgay(bang, "CT26-040", "2026-10-09", bayGio("2026-10-08", 23))).toBeNull();
  });
  /* Ngày phải NẰM SAU mốc app bắt đầu ghi, nếu không lại rơi vào hàng rào ở nhóm dưới. */
  it("ngày hôm qua không xuất → x", () => {
    expect(dauCuaNgay(bang, "CT26-040", "2026-10-09", bayGio("2026-10-10", 9))).toBe("x");
  });
  it("có xuất rồi thì lấy dấu đã gom, không đụng tới luật quá hạn", () => {
    const b = gomLuot([{ ts: vn("2026-10-08", 9, 0), duAn: "CT26-040" }]);
    expect(dauCuaNgay(b, "CT26-040", "2026-10-08", bayGio("2026-10-08", 10))).toBe("P");
  });
});

/* HÀNG RÀO CHỐNG CHẤM OAN HÀNG LOẠT. App chỉ bắt đầu ghi nhật ký lượt xuất PDF từ 08/10/2026;
   trước đó nút xuất không ghi lại gì — không phải người ta không làm, mà là app không nhìn.
   Thiếu hàng rào này thì luật "ngày đã qua mà không xuất → x" quét sạch mọi ngày trước đó thành x
   cho mọi dự án: một bảng chấm người bỗng toàn điểm liệt, mà nhìn như dữ liệu thật. */
describe("không chấm ngược về trước ngày app bắt đầu ghi", () => {
  const bang = gomLuot([]);
  const bayGio = Date.parse(vn("2026-10-20", 9));

  it("ngày trước mốc → để TRỐNG dù đã qua từ lâu", () => {
    for (const n of ["2026-09-01", "2026-09-30", "2026-10-07"]) {
      expect(dauCuaNgay(bang, "CT26-040", n, bayGio)).toBeNull();
    }
  });
  it("đúng ngày mốc trở đi thì chấm bình thường", () => {
    expect(dauCuaNgay(bang, "CT26-040", NGAY_BAT_DAU_CHAM, bayGio)).toBe("x");
  });
  /* Nhật ký lỡ có dòng cũ hơn mốc thì vẫn tôn trọng dòng THẬT đó — mốc chỉ chặn phần SUY RA. */
  it("có lượt xuất thật trước mốc thì vẫn tính", () => {
    const b = gomLuot([{ ts: vn("2026-10-01", 9, 0), duAn: "CT26-040" }]);
    expect(dauCuaNgay(b, "CT26-040", "2026-10-01", bayGio)).toBe("P");
  });
});

describe("dựng cột ngày của tháng", () => {
  it("tháng 10 có 31 ngày", () => {
    const ds = ngayTrongThang("2026-10");
    expect(ds).toHaveLength(31);
    expect(ds[0]).toBe("2026-10-01");
    expect(ds[30]).toBe("2026-10-31");
  });
  it("tháng 2 năm thường có 28 ngày", () => expect(ngayTrongThang("2026-02")).toHaveLength(28));
  it("tháng 2 năm nhuận có 29 ngày", () => expect(ngayTrongThang("2028-02")).toHaveLength(29));
  it("chuỗi sai → mảng rỗng, không ném", () => expect(ngayTrongThang("linh tinh")).toEqual([]));
});

/* Ghi và đọc phải KHỚP NHAU. Lệch là nhật ký vẫn đầy mà bảng trống trơn, không có lỗi nào hiện ra. */
describe("ghi rồi đọc lại khoá dự án", () => {
  it("đi một vòng ra đúng mã CT", () => {
    expect(khoaDuAn(ghiLuot("CT26-040", "Apec S2"))).toBe("CT26-040");
  });
  it("mã nhiều phần vẫn giữ nguyên", () => {
    expect(khoaDuAn(ghiLuot("CT25-040, 038", "Mini Hotel"))).toBe("CT25-040, 038");
  });
  it("thường hoá về chữ HOA để khớp dù file gõ kiểu nào", () => {
    expect(khoaDuAn("ct26-040 · Apec S2")).toBe("CT26-040");
  });
  /* KHÔNG ĐOÁN THEO TÊN: đoán sai là gán điểm của dự án này cho dự án khác. */
  it("dòng không có mã CT → trả rỗng, bỏ qua dòng đó", () => {
    expect(khoaDuAn("Báo cáo tuân thủ MP tháng 09/2026")).toBe("");
    expect(khoaDuAn("Ngang · Bảng Việc cần xử lý")).toBe("");
    expect(khoaDuAn(null)).toBe("");
    expect(khoaDuAn("")).toBe("");
  });
});
