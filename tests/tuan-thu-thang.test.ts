/**
 * Xem và xuất lại báo cáo tuân thủ của THÁNG CŨ.
 *
 * Ca có thật: sáng 01/10/2026 file tuân thủ nhảy sang tháng 10 (mọi ô trống, mọi dự án 100 điểm),
 * số liệu tháng 9 biến mất khỏi file. App phải chấm lại được tháng 9 từ lịch sử ngày cập nhật.
 */
import { describe, it, expect } from "vitest";
import { nhanThang, thangTuNhan, thangCoTheCham, doiSangDangFile } from "@/lib/tuan-thu-thang";
import { buildComplianceReport, cyclesOfMonth } from "@/lib/compliance";

const vung = () => "PQ";

describe("nhãn tháng", () => {
  it("đổi qua lại đúng kiểu file đang dùng", () => {
    expect(nhanThang("2026-09")).toBe("09/2026");
    expect(thangTuNhan("09/2026")).toBe("2026-09");
    expect(thangTuNhan("")).toBeNull();
    expect(thangTuNhan("tháng chín")).toBeNull();
  });
});

describe("tháng nào chấm lại được", () => {
  const ls = { "id:1": ["2026-07-15", "2026-08-05"], "id:2": ["2026-09-23"] };

  it("gom đủ các tháng có trong lịch sử, mới nhất đứng đầu", () => {
    expect(thangCoTheCham(ls, "2026-10-01")).toEqual(["2026-10", "2026-09", "2026-08", "2026-07"]);
  });

  it("luôn có tháng hiện tại dù lịch sử rỗng", () => {
    expect(thangCoTheCham({}, "2026-10-01")).toEqual(["2026-10"]);
  });

  it("KHÔNG bày tháng ở tương lai — chấm tháng chưa tới thì ra bảng trống", () => {
    expect(thangCoTheCham({ "id:1": ["2027-01-05"] }, "2026-10-01")).toEqual(["2026-10"]);
  });

  it("ngày rác trong lịch sử không làm vỡ", () => {
    expect(thangCoTheCham({ "id:1": ["", "khong-phai-ngay"] }, "2026-10-01")).toEqual(["2026-10"]);
  });
});

describe("chấm lại tháng 9 từ lịch sử — ca thật", () => {
  const duAn = [
    { key: "id:1", maCT: "CT26-036", name: "Văn phòng Cao Trần", pm: "Nguyễn Tấn Kiệt", updateDate: null },
    { key: "id:2", maCT: "CT22-018", name: "Park Hyatt PQ", pm: "Lê Tuấn", updateDate: null },
  ];
  // Tháng 9/2026: các THỨ TƯ là 02 · 09 · 16 · 23 · 30.
  const lichSu = {
    "id:1": ["2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23"],   // đúng hạn 4 tuần
    "id:2": ["2026-09-03", "2026-09-10"],                                // thứ 5 → trễ 2 tuần
  };
  const rep = buildComplianceReport(duAn, lichSu, "2026-09", "2026-10-01");

  it("chấm được tháng đã qua, không còn ô null vì khung tuần đã đóng", () => {
    expect(rep.monthKey).toBe("2026-09");
    const d1 = rep.projects.find((p) => p.key === "id:1")!;
    expect(d1.marks.slice(0, 4)).toEqual(["P", "P", "P", "P"]);
  });

  it("cập nhật vào thứ 5 bị chấm trễ", () => {
    const d2 = rep.projects.find((p) => p.key === "id:2")!;
    expect(d2.marks[0]).toBe("o");
    expect(d2.marks[1]).toBe("o");
  });

  it("điểm KHÁC 100 — đúng cái file tháng mới không nói được", () => {
    const d2 = rep.projects.find((p) => p.key === "id:2")!;
    expect(d2.updateScore).not.toBe(100);
    expect(d2.updateScore).toBeLessThan(100);
  });
});

describe("đổi sang dạng dòng của file để bảng và nút xuất PDF dùng lại nguyên", () => {
  const duAn = [{ key: "id:1", maCT: "CT26-036", name: "Văn phòng Cao Trần", pm: "Nguyễn Tấn Kiệt", updateDate: null }];
  const rep = buildComplianceReport(duAn, { "id:1": ["2026-09-02", "2026-09-10"] }, "2026-09", "2026-10-01");
  const ra = doiSangDangFile(rep, vung);

  it("nhãn tháng và nhãn cột tuần khớp kiểu file (dd/mm của thứ Tư)", () => {
    expect(ra.monthLabel).toBe("09/2026");
    expect(ra.weeks).toEqual(cyclesOfMonth("2026-09").map((c) => `${c.wed.slice(8, 10)}/${c.wed.slice(5, 7)}`));
    expect(ra.weeks[0]).toBe("02/09");
  });

  it("giữ nguyên số dòng, có STT, có Vùng", () => {
    expect(ra.rows).toHaveLength(1);
    expect(ra.rows[0].stt).toBe(1);
    expect(ra.rows[0].vung).toBe("PQ");
    expect(ra.rows[0].name).toBe("Văn phòng Cao Trần");
  });

  it("ngày cập nhật ghi dd/mm như file", () => expect(ra.rows[0].lastUpdate).toBe("10/09"));

  it("đếm đúng số lần trễ / không cập nhật", () => {
    expect(ra.rows[0].countO).toBe(1);   // 10/09 là thứ 5 của chu kỳ 09/09
    expect(ra.rows[0].countX + ra.rows[0].countO).toBe(ra.rows[0].marks.filter((m) => m === "x" || m === "o").length);
  });

  it("cột điểm là ĐIỂM NỀN, chưa trừ tuần cờ BOD — tránh trừ hai lần", () => {
    expect(ra.rows[0].score).toBe(rep.projects[0].updateScore);
  });

  it("không có dự án nào thì ra bảng rỗng chứ không vỡ", () => {
    const r0 = doiSangDangFile(buildComplianceReport([], {}, "2026-09", "2026-10-01"), vung);
    expect(r0.rows).toEqual([]);
    expect(r0.weeks.length).toBeGreaterThan(0);
  });
});
