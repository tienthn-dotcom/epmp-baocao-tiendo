import { describe, expect, it } from "vitest";
import { docTongHop, dungBangTongHop, gomVungPm, thangCua, trungBinh, xepTheoTenGoi, mauDiemPm, vungTuLocation, pmChinh } from "@/lib/bang-diem-tong-hop";

const H_BCN = ["Tháng", "Khoá", "STT", "Vùng", "Mã CT", "Dự án", "PM", "Quân số", "Thi công LĐ", "Sản lượng", "Nguồn sheet", "Cập nhật lúc"];
const luoi = () => ({
  bcn: [H_BCN,
    ["2026-10", "CT26-040", 1, "Phú Quốc", "CT26-040", "Apec S2", "Nguyễn Văn Có", 45, 85, 35, "T10", new Date(2026, 9, 19, 15, 53)],
    ["2026-10", "CT24-044|CT24-066", 2, "Bắc", "CT24-044, CT24-066,…", "Tây Hồ View", "Nguyễn Văn Cừ", 100, "n/a", 35, "T10", ""],
    ["2026-09", "CT26-040", 1, "Phú Quốc", "CT26-040", "Apec S2", "Nguyễn Văn Có", 94, 80, 100, "BCN 09-2026", ""],
    ["2026-09", "CT26-072", 3, "Nước Ngoài", "CT26-072", "Chulassa", "Vũ Ngọc Pháp", 100, "n/a", 100, "BCN 09-2026", ""],
  ],
  pmp: [["Tháng", "Tên dự án PMP", "Location", "PM", "Điểm PMP"],
    ["2026-10", "APEC_S2_Public", "PQ", "Nguyễn Văn Có/ Trần Quốc Nhân", 100],
    ["2026-10", "THV_Villa A2", "PQ", "Nguyễn Văn Cừ/ Thành Tâm", 100],
    ["2026-10", "Tây Hồ View - Tháp 4A", "PQ", "Nguyễn Văn Cừ/ Duy Linh", 75],
    ["2026-10", "Nhà mẫu Borey Chulassa (Campuchia)", "North", "Vũ Ngọc Pháp", 100],
    ["2026-10", "Đại học Văn Lang", "North", "Nguyễn Tấn Kiệt", 90],
    ["2026-10", "Villa Bason V60", "HCM", "Phạm Xuân Hoành", 90],
    ["2026-07", "APEC_S2_Public", "PQ", "Nguyễn Văn Có", -10],
  ],
  map: [["Tên dự án PMP", "Mã CT", "Dự án BCN (máy gán)", "Dự án BCN (GÁN TAY)", "Cách gán", "Vùng (GÁN TAY)", "Vùng đang hiện"],
    ["APEC_S2_Public", "CT26-040", "Apec S2", "", "Mã CT", "", ""],
    ["THV_Villa A2", "CT26-031", "Tây Hồ View", "(Bỏ qua)", "Gán tay: bỏ qua", "", ""],
    ["Tây Hồ View - Tháp 4A", "CT24-066", "Tây Hồ View", "", "Mã CT", "", ""],
    ["Nhà mẫu Borey Chulassa (Campuchia)", "CT26-072", "Chulassa", "", "Mã CT", "", ""],
    ["Đại học Văn Lang", "CT26-009", "", "", "Chưa gán", "Nam", ""],
    ["Villa Bason V60", "CT26-105", "", "Tên không có", "Chưa gán", "", ""],
  ],
  nhap: [["Tháng (MM/yyyy)", "Dự án", "Điểm", "Ghi chú"],
    ["10/2026", "APEC_S2_Public", 80, ""],
    ["10/2026", "Tây Hồ View", 60, "tên nhóm BCN → áp cả nhóm"],
    ["10/2026", "Tên sai", 50, ""],
  ],
});

describe("bảng điểm tổng hợp — mỗi dòng 1 dự án PMP, khớp phép của Apps Script", () => {
  it("hàm phụ", () => {
    expect(thangCua("10/2026")).toBe("2026-10");
    expect(thangCua(new Date(2026, 9, 1))).toBe("2026-10");
    expect(thangCua("abc")).toBe("");
    expect(trungBinh([55, 100, "", "n/a"])).toBe(77.5);
    expect(trungBinh(["", "n/a"])).toBe("");
    expect(pmChinh("Lê Tuấn / Nguyễn Hữu Thiện")).toBe("Lê Tuấn");
    expect(["PQ", "North", "Middle", "HCM", "South", "Oversea", "?"].map(vungTuLocation)).toEqual(["Phú Quốc", "Bắc", "Trung", "Nam", "Nam", "Nước Ngoài", ""]);
  });

  it("đủ danh sách PMP của tháng; điểm ngày lấy theo nhóm BCN đã gán; Điểm trung bình phẳng", () => {
    const d = docTongHop(luoi());
    expect(d.cacThang).toEqual(["2026-10", "2026-09", "2026-07"]);
    expect(d.capNhatLuc).toBe("19/10/2026");
    const b = dungBangTongHop("2026-10", d);
    expect(b.duAn).toHaveLength(6);
    const by = Object.fromEntries(b.duAn.map((x) => [x.ten, x]));
    expect(by["APEC_S2_Public"]).toMatchObject({ vung: "Phú Quốc", pm: "Nguyễn Văn Có", qs: 45, sl: 35, tc: 85, tuan: 100, thangBC: 80, tong: 69, bcnTen: "Apec S2" });
    // nhóm Tây Hồ View: nhận điểm ngày nhóm + điểm tháng nhập theo tên nhóm; TCLĐ n/a không tính
    expect(by["Tây Hồ View - Tháp 4A"]).toMatchObject({ vung: "Bắc", qs: 100, tc: "n/a", tuan: 75, thangBC: 60, tong: 68 }); // 67,5 → làm tròn 68
    // (Bỏ qua) → không có điểm ngày, vùng lùi về Location
    expect(by["THV_Villa A2"]).toMatchObject({ bcnKey: "", qs: "", vung: "Phú Quốc", tong: 100 });
    // nhóm có trong MAP nhưng tháng này BCN không có → vùng của nhóm, điểm ngày trống
    expect(by["Nhà mẫu Borey Chulassa (Campuchia)"]).toMatchObject({ vung: "Nước Ngoài", qs: "", tong: 100 });
    // vùng gán tay thắng Location
    expect(by["Đại học Văn Lang"].vung).toBe("Nam");
    // gán tay sai tên → lùi về máy gán (trống) → không có nhóm
    expect(by["Villa Bason V60"]).toMatchObject({ bcnKey: "", vung: "Nam" });
  });

  it("thứ tự như form: Vùng → PM theo tên gọi → dự án A→Z; gom Vùng/PM để gộp ô", () => {
    const b = dungBangTongHop("2026-10", docTongHop(luoi()));
    expect(b.duAn.map((x) => x.vung)).toEqual(["Phú Quốc", "Phú Quốc", "Bắc", "Nam", "Nam", "Nước Ngoài"]);
    expect(b.duAn.slice(0, 2).map((x) => x.ten)).toEqual(["APEC_S2_Public", "THV_Villa A2"]); // Có trước Cừ
    const g = gomVungPm(b.duAn);
    expect(g.map((v) => [v.vung, v.soDong])).toEqual([["Phú Quốc", 2], ["Bắc", 1], ["Nam", 2], ["Nước Ngoài", 1]]);
  });

  it("tháng cũ: chỉ dự án PMP có điểm tháng đó, điểm âm giữ nguyên", () => {
    const b = dungBangTongHop("2026-07", docTongHop(luoi()));
    expect(b.duAn).toHaveLength(1);
    expect(b.duAn[0]).toMatchObject({ ten: "APEC_S2_Public", qs: "", tuan: -10, tong: -10 });
  });

  it("PM = tổng mọi ô có số ÷ số ô (không lấy TB điểm dự án); xếp tên gọi; màu như báo cáo Master Plan", () => {
    const b = dungBangTongHop("2026-10", docTongHop(luoi()));
    // Cừ: THV_Villa A2 [MP 100] + Tháp 4A [QS 100, SL 35, TC n/a, MP 75, tháng 60] → 5 ô số: 370 / 5
    expect(b.pm.find((p) => p.pm === "Nguyễn Văn Cừ")).toMatchObject({ soDuAn: 2, tong: 74, soO: 5 });
    expect(["Trần Quốc Liêm", "Nguyễn Văn Có", "Đặng Ngọc Sáu"].sort(xepTheoTenGoi)).toEqual(["Nguyễn Văn Có", "Trần Quốc Liêm", "Đặng Ngọc Sáu"]);
    expect([mauDiemPm(45), mauDiemPm(65), mauDiemPm(90), mauDiemPm("")]).toEqual(["#dc2626", "#ca8a04", "#16a34a", "#94a3b8"]);
  });
});

import { banTongHop } from "@/lib/bao-cao-tong-hop-in";
describe("bản in mẫu công ty cho báo cáo tuân thủ tổng hợp", () => {
  it("nhóm theo vùng + nhóm cuối Điểm theo PM; KPI và nhận xét rút từ số", () => {
    const b = dungBangTongHop("2026-10", docTongHop(luoi()));
    const ban = banTongHop(b, "2026-10", "19/10/2026 15:53");
    expect(ban.tieuDe).toBe("Báo cáo tuân thủ tổng hợp - Tháng 10/2026");
    expect(ban.nhom.map((n) => n.ten)).toEqual(["Vùng Phú Quốc", "Vùng Bắc", "Vùng Nam", "Vùng Nước Ngoài", "Điểm theo PM"]);
    expect(ban.soDong).toBe(6);
    expect(ban.kpi.map((k) => k.nhan)).toEqual(["Dự án", "Điểm trung bình", "Dự án dưới 50", "PM", "Chưa có báo cáo ngày"]);
    // mỗi dòng đủ số cột của mẫu; tên PM chỉ ghi ở dòng đầu nhóm PM
    expect(ban.nhom[0].dong.every((r) => r.length === ban.cot.length)).toBe(true);
    expect(ban.nhom[0].dong.map((r) => r[0].t)).toEqual(["Nguyễn Văn Có", "Nguyễn Văn Cừ"]);
    expect(ban.nhom[0].dong[0][2]).toMatchObject({ t: "69", dam: true });
    expect(ban.nhom[0].tong?.[0].t).toBe("TB vùng · 2 dự án");
    expect(ban.nhanXet[0]).toContain("6 dự án");
  });
});
