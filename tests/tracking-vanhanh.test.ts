/* TÌNH TRẠNG VẬN HÀNH MA TRẬN — kiểm phần đọc bảng và khớp tên.
 *
 * Nhãn này in lên dải tiêu đề của bản gửi BOD. Dán nhầm "ĐÃ VẬN HÀNH" lên một dự án chưa chạy
 * (hay ngược lại) thì không ai soi ra, vì nhìn vẫn như đúng. Nên khoá chặt ba chỗ: đọc đúng
 * năm trạng thái, khớp tên không nhận bừa, và bản chụp 16/10 phải ra đúng số PMO đã chấm.
 */
import { describe, expect, it } from "vitest";
import {
  dangVanHanh, demVH, docTracking, doTrangThai, dongTongVH, ngoaiDien, nhanDai, traVH,
  type TrangThaiVH,
} from "@/lib/tracking-vanhanh";
import { TRACKING_TSV } from "@/lib/tracking-vanhanh-data";

describe("đọc ô trạng thái", () => {
  /* Năm câu chỉ khác nhau một hai từ — xét sai thứ tự là gộp nhầm trạng thái. */
  it("nhận đủ năm trạng thái", () => {
    expect(doTrangThai("Đã vận hành")).toBe("da");
    expect(doTrangThai("Chưa vận hành")).toBe("chua");
    expect(doTrangThai("Chưa triển khai")).toBe("chuaTrienKhai");
    expect(doTrangThai("Chưa cần triển khai")).toBe("chuaCan");
    expect(doTrangThai("Không cần triển khai")).toBe("khongCan");
  });
  it("không phân biệt hoa thường, dấu, khoảng trắng thừa", () => {
    expect(doTrangThai("  ĐÃ VẬN HÀNH  ")).toBe("da");
    expect(doTrangThai("khong can trien khai")).toBe("khongCan");
  });
  it("ô lạ hoặc trống → null, KHÔNG đoán", () => {
    expect(doTrangThai("")).toBeNull();
    expect(doTrangThai("đang chạy")).toBeNull();
  });
  it("chỉ 'Đã vận hành' mới tính là đang chạy", () => {
    const het: TrangThaiVH[] = ["da", "chua", "chuaTrienKhai", "chuaCan", "khongCan", "chuaRo"];
    expect(het.filter(dangVanHanh)).toEqual(["da"]);
    expect(het.filter(ngoaiDien)).toEqual(["chuaCan", "khongCan"]);
  });
  it("nhãn dán lên dải giữ tiền tố TCLĐ", () => {
    expect(nhanDai("da")).toBe("TCLĐ: ĐÃ VẬN HÀNH");
    expect(nhanDai("khongCan")).toBe("TCLĐ: KHÔNG CẦN TRIỂN KHAI");
  });
});

describe("đọc bảng", () => {
  const tsv = [
    "STT\tTên PM\tTên dự án\tKhu vực\tTrạng thái\tGhi chú",
    "I\tKHU VỰC PHÚ QUỐC\t\tPhú Quốc\tĐã vận hành: 16/31\t",
    "1\tNguyễn Văn Có\tApec S2 Public\tPhú Quốc\tĐã vận hành\t",
    "2\tTrần Quốc Lý\tMini Hotel B6-B9 Public\tPhú Quốc\tChưa vận hành\tghi chú gì đó",
    "3\tLê Tuấn\tPark Hyatt Phú Quốc Hotel\tPhú Quốc\tKhông cần triển khai\t",
    "TỔNG CỘNG\tTất cả\t\t\tĐã vận hành: 41/62\t",
  ].join("\n");
  const b = docTracking(tsv);

  /* Dòng nhóm vùng và dòng tổng CŨNG có chữ "Đã vận hành" trong ô trạng thái — lọc bằng STT
     phải là số, không lọc bằng nội dung. */
  it("bỏ dòng tiêu đề, dòng nhóm vùng và dòng tổng", () => {
    expect(b.dong.map((d) => d.stt)).toEqual(["1", "2", "3"]);
  });
  it("lấy đủ cột, kể cả ghi chú", () => {
    expect(b.dong[1]).toEqual({
      stt: "2", pm: "Trần Quốc Lý", ten: "Mini Hotel B6-B9 Public",
      vung: "Phú Quốc", tt: "chua", ghiChu: "ghi chú gì đó",
    });
  });
  it("đọc được cả CSV có dấu nháy", () => {
    const c = docTracking('1,Lê Tuấn,"Apec S4, khối phòng",Phú Quốc,Đã vận hành,');
    expect(c.dong[0].ten).toBe("Apec S4, khối phòng");
    expect(c.dong[0].tt).toBe("da");
  });
  it("dòng đọc không ra trạng thái thì gom vào `bo`, không nuốt im", () => {
    const c = docTracking("9\tA\tDự án X\tPQ\tđang chạy\t");
    expect(c.dong).toEqual([]);
    expect(c.bo.length).toBe(1);
  });
});

describe("khớp tên dự án", () => {
  const b = docTracking([
    "1\tA\tTây Hồ View - Public (Tháp 4S)\tMiền Bắc\tĐã vận hành\t",
    "2\tA\tTHV_Căn hộ 2B-L06\tMiền Bắc\tĐã vận hành\t",
    "3\tA\tTHV_Căn hộ 2B-L09\tMiền Bắc\tChưa vận hành\t",
    "4\tA\tMini Hotel\tPhú Quốc\tChưa vận hành\t",
    "5\tA\tMini Hotel PQ\tPhú Quốc\tĐã vận hành\t",
  ].join("\n"));

  it("khớp đúng từng chữ", () => expect(traVH(b, "THV_Căn hộ 2B-L09")?.tt).toBe("chua"));
  it("bỏ dấu và dấu gạch vẫn khớp", () => expect(traVH(b, "thv can ho 2b l06")?.tt).toBe("da"));
  /* Ca thật 16/10: bảng ghi gọn hơn danh sách ma trận. */
  it("tên bảng là phần đầu của tên ma trận thì vẫn nhận", () => {
    expect(traVH(b, "Tây Hồ View - Public (Tháp 4S) (Gym, Spa, Swimming Pool, ADD)")?.stt).toBe("1");
  });
  /* "Mini Hotel" và "Mini Hotel PQ" đều là phần đầu của tên dưới → KHÔNG được chọn bừa. */
  it("dính hai dòng thì trả null chứ không đoán", () => {
    expect(traVH(b, "Mini Hotel PQ (B1-B5) Phòng")).toBeNull();
  });
  it("không có trong bảng → null", () => expect(traVH(b, "Dự án lạ")).toBeNull());
});

describe("bản chụp 16/10/2026", () => {
  const b = docTracking(TRACKING_TSV);

  it("đọc trọn 83 dòng, không bỏ dòng nào", () => {
    expect(b.dong.length).toBe(83);
    expect(b.bo).toEqual([]);
    expect(b.trung).toEqual([]);
  });

  /* Số PMO đã chấm, in ngay trên đầu bản tracking. Dán lệch cột hay thiếu dòng là đỏ ở đây. */
  it("ra đúng số của bản gốc: 41 · 16 · 5 · 12 · 9", () => {
    expect(demVH(b.dong.map((d) => d.tt))).toEqual({
      da: 41, chua: 16, chuaTrienKhai: 5, chuaCan: 12, khongCan: 9, chuaRo: 0,
    });
  });

  it("STT chạy liền 1..83", () => {
    expect(b.dong.map((d) => +d.stt)).toEqual(Array.from({ length: 83 }, (_, i) => i + 1));
  });

  it("giữ nguyên ghi chú của PMO", () => {
    expect(traVH(b, "Hyatt Regency Hồ Tràm 61 Villas")?.ghiChu).toBe("PENDING DO CĐT");
    expect(traVH(b, "43 ĐTM_St.Regis_Public")?.ghiChu).toBe("KHÔNG CÓ HÀNG THI CÔNG");
  });

  /* 21 ma trận đang có trong danh sách MTLĐ (đo trên máy 16/10/2026) — mọi cái PHẢI tra ra. */
  it("tra được hết 21 ma trận đang có trong danh sách MTLĐ", () => {
    const ten = [
      "Nam Phương Hoàng Hậu Public: Nhà hàng Maxine", "Nam Phương Hoàng Hậu Phòng (302 căn)",
      "Mini Hotel PQ (B1-B5) Phòng", "43 ĐTM_St.Regis_Phòng", "43 ĐTM_St.Regis_Public",
      "Cát Bà tòa HH3", "Tây Hồ View - Public (Tháp 4S) (Gym, Spa, Swimming Pool, ADD)",
      "Tây Hồ View - Tháp 4A", "Tây Hồ View - Tháp 4B", "THV_Căn hộ 2B-L06", "THV_Căn hộ 2B-L09",
      "THV_Penthouse T3D - Nhà chị Hương", "THV_Villa A2", "Hyatt Regency Hạ Long",
      "Khu du lịch ven sông Hàn (B4.2)", "Khối tháp 2 Holiday Inn Bà Nà Phòng (846 PHÒNG)",
      "Khối tháp 2 Holiday Inn Bà Nà Khu Public", "Villa Tulip 3", "Chateau De Saigon",
      "Hyatt Regency Hồ Tràm Khu Public", "Hyatt Regency Hồ Tràm 61 Villas",
    ];
    expect(ten.filter((t) => !traVH(b, t))).toEqual([]);
  });

  it("dòng tổng nói đủ các nhóm", () => {
    expect(dongTongVH(b.dong.map((d) => d.tt)))
      .toBe("83 ma trận · 41 đã vận hành · 16 chưa vận hành · 5 chưa triển khai · 21 ngoài diện");
  });
});
