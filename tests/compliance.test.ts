import { describe, it, expect } from "vitest";
import {
  cyclesOfMonth, markCycle, buildComplianceReport,
  updateScoreOf, qualityPenaltyOf, meanScore, pmGroupKey,
} from "../src/lib/compliance";

/** Tháng 7/2026: các thứ 4 là 01, 08, 15, 22, 29. */
describe("cyclesOfMonth", () => {
  it("neo đúng các THỨ 4, kèm khung T3→T6 của tuần", () => {
    const c = cyclesOfMonth("2026-07");
    expect(c.map(x => x.wed)).toEqual(["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29"]);
    // Tuần của T4 15/07: T3=14, T5=16, T6=17 (chốt = T6)
    expect(c[2].tue).toBe("2026-07-14");
    expect(c[2].thu).toBe("2026-07-16");
    expect(c[2].fri).toBe("2026-07-17");
    expect(c[2].checkpoint).toBe("2026-07-17");
  });

  it("mọi mốc `wed` đều đúng là thứ 4", () => {
    for (const mk of ["2026-01", "2026-02", "2026-07", "2026-12", "2027-03"]) {
      for (const c of cyclesOfMonth(mk)) {
        const d = new Date(c.wed + "T00:00:00Z");
        expect(d.getUTCDay()).toBe(3); // 3 = thứ 4
      }
    }
  });
});

// Tuần của THỨ 4 15/07: T3=14, T4=15, T5=16, T6=17.
const CYCLE = { tue: "2026-07-14", wed: "2026-07-15", thu: "2026-07-16", fri: "2026-07-17", checkpoint: "2026-07-17" };
const SEEN = "2026-05-01"; // app đã theo dõi dự án từ lâu
const AFTER = "2026-07-20"; // hôm nay: đã qua T6 (khung đóng)

describe("markCycle", () => {
  it("P — cập nhật THỨ 3 hoặc THỨ 4", () => {
    expect(markCycle(["2026-07-14"], CYCLE, AFTER, SEEN)).toBe("P"); // T3
    expect(markCycle(["2026-07-15"], CYCLE, AFTER, SEEN)).toBe("P"); // T4
  });

  it("o — cập nhật THỨ 5 hoặc THỨ 6", () => {
    expect(markCycle(["2026-07-16"], CYCLE, AFTER, SEEN)).toBe("o"); // T5
    expect(markCycle(["2026-07-17"], CYCLE, AFTER, SEEN)).toBe("o"); // T6
  });

  it("x — hết T6 mà tuần này không có cập nhật rơi vào T3–T6", () => {
    expect(markCycle([], CYCLE, AFTER, SEEN)).toBe("x");                    // không cập nhật gì
    expect(markCycle(["2026-07-13"], CYCLE, AFTER, SEEN)).toBe("x");        // THỨ 2 → không tính
    expect(markCycle(["2026-07-18"], CYCLE, AFTER, SEEN)).toBe("x");        // THỨ 7 → không tính
    // VD của PMO: hạn T4 15/07 nhưng đến T2 20/07 mới cập nhật → tuần 15/07 = x.
    expect(markCycle(["2026-07-20"], CYCLE, "2026-07-27", SEEN)).toBe("x");
  });

  it("null — khung T3→T6 CHƯA đóng (hôm nay ≤ T6) và chưa có cập nhật hợp lệ", () => {
    expect(markCycle([], CYCLE, "2026-07-15", SEEN)).toBeNull(); // đang giữa khung
    expect(markCycle([], CYCLE, "2026-07-17", SEEN)).toBeNull(); // đúng T6, vẫn còn hạn
  });

  it("null — dự án mới, tuần nằm TRƯỚC khi app biết nó (tránh đổ oan)", () => {
    expect(markCycle([], CYCLE, AFTER, "2026-07-19")).toBeNull();
    expect(markCycle([], CYCLE, AFTER, null)).toBeNull();
  });
});

describe("buildComplianceReport", () => {
  // Tuần T4 15/07: T3=14, T4=15, T5=16, T6=17. Hôm nay 20/07 → khung tuần đó đã đóng.
  const projects = [
    { key: "a", maCT: "CT01", name: "A", pm: "PM1", updateDate: "2026-07-15" }, // T4 → P
    { key: "b", maCT: "CT02", name: "B", pm: "PM1", updateDate: "2026-07-16" }, // T5 → o
    { key: "c", maCT: "CT03", name: "C", pm: "PM2", updateDate: "2026-07-14" }, // T3 → P
  ];
  const history = { a: ["2026-07-15"], b: ["2026-07-16"], c: ["2026-07-14"] };

  it("chấm đúng chu kỳ hiện tại và thống kê dự án", () => {
    const r = buildComplianceReport(projects, history, "2026-07", "2026-07-20");
    expect(r.cycles[r.cycleHienTai].wed).toBe("2026-07-15");
    expect(r.duAnDungHan).toBe(2); // a, c đều P
    expect(r.duAnTong).toBe(3);    // a P, b o, c P (không dự án nào null)
  });

  it("PM chỉ tính ĐÚNG HẠN khi MỌI dự án của họ đều P", () => {
    const r = buildComplianceReport(projects, history, "2026-07", "2026-07-20");
    // PM1: a=P nhưng b=o → không đạt; PM2: c=P → đạt
    expect(r.pmDungHan).toBe(1);
    expect(r.pmTong).toBe(2);
  });

  it("lastUpdate lấy ngày MỚI NHẤT trong lịch sử", () => {
    const r = buildComplianceReport(
      [{ key: "a", maCT: "CT01", name: "A", pm: "PM1", updateDate: "2026-07-08" }],
      { a: ["2026-06-01", "2026-07-08"] }, "2026-07", "2026-07-20",
    );
    expect(r.projects[0].lastUpdate).toBe("2026-07-08");
  });

  it("gộp ngày trên sheet vào lịch sử phòng khi chưa kịp ghi nhận", () => {
    const r = buildComplianceReport(
      [{ key: "a", maCT: "CT01", name: "A", pm: "PM1", updateDate: "2026-07-15" }],
      { a: ["2026-06-01"] }, "2026-07", "2026-07-20",
    );
    expect(r.projects[0].marks[2]).toBe("P"); // vẫn thấy ngày 15/07 (T4) từ sheet
  });

  it("đếm số lần không cập nhật trong tháng — update lệch khung không cứu tuần khác", () => {
    const r = buildComplianceReport(
      [{ key: "b", maCT: "CT02", name: "B", pm: "PM1", updateDate: "2026-06-30" }],
      { b: ["2026-06-30"] }, "2026-07", "2026-07-20",
    );
    // 30/06 = THỨ 3 của tuần 01/07 → chỉ tuần 01/07 = P; các tuần 08, 15 không có cập nhật → x.
    expect(r.projects[0].marks[0]).toBe("P");
    expect(r.projects[0].marks[1]).toBe("x");
    expect(r.projects[0].marks[2]).toBe("x");
    expect(r.projects[0].soLanKhongCapNhat).toBe(2);
  });

  it("#2 FIX: dự án MỚI vào theo dõi KHÔNG bị 'x' oan cho tuần trước khi app biết nó", () => {
    const projects = [
      { key: "old", maCT: "C1", name: "Old", pm: "PM1", updateDate: "2026-07-29" },
      { key: "new", maCT: "C2", name: "New", pm: "PM2", updateDate: "2026-07-29" },
    ];
    // 'new' lần đầu có dữ liệu 29/07; 'old' cập nhật đều từ đầu tháng.
    // Mốc CHUNG toàn bảng (logic cũ) = 01/07 → 'new' bị "x" oan cho 01–15/07. Mốc RIÊNG
    // từng dự án (đã sửa) → 'new' để trống các tuần đó.
    const history = {
      old: ["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29"],
      new: ["2026-07-29"],
    };
    const r = buildComplianceReport(projects, history, "2026-07", "2026-07-31");
    const oldP = r.projects.find(p => p.key === "old")!;
    const newP = r.projects.find(p => p.key === "new")!;
    // 'new': 3 tuần đầu nằm TRƯỚC khi app biết dự án → null (KHÔNG "x" oan).
    expect(newP.marks[0]).toBeNull();
    expect(newP.marks[1]).toBeNull();
    expect(newP.marks[2]).toBeNull();
    expect(newP.marks[4]).toBe("P");   // 29/07 chấm đúng
    expect(newP.soLanKhongCapNhat).toBe(0);
    // 'old' theo dõi đủ → chấm bình thường (mọi tuần P).
    expect(oldP.marks[0]).toBe("P");
    expect(oldP.soLanKhongCapNhat).toBe(0);
  });
});

describe("chấm điểm tuân thủ", () => {
  it("updateScoreOf: 100 − 25×X − 10×trễ, kẹp 0..100, bỏ null", () => {
    expect(updateScoreOf(["P", "P", "P"])).toBe(100);    // không trừ gì
    expect(updateScoreOf(["P", "x"])).toBe(75);          // −25 (1 lần X)
    expect(updateScoreOf(["x", "x"])).toBe(50);          // −50 (2 lần X)
    expect(updateScoreOf(["P", "o", null])).toBe(90);    // −10 (1 trễ), null bị bỏ
    expect(updateScoreOf(["P", "o", "x"])).toBe(65);     // −10 −25
    expect(updateScoreOf(["x", "x", "x", "x", "x"])).toBe(0); // 100−125 → kẹp 0
    expect(updateScoreOf([null, null])).toBeNull();      // chưa đủ dữ liệu
  });

  it("qualityPenaltyOf: theo TỈ LỆ đầu việc lỗi, có TRẦN", () => {
    expect(qualityPenaltyOf({ active: 0, missingQuant: 0, missingDates: 0, missingPic: 0 })).toBe(0);
    // 100% dính cả 3 loại: 8+4+3 = 15 (đúng trần)
    expect(qualityPenaltyOf({ active: 4, missingQuant: 4, missingDates: 4, missingPic: 4 })).toBe(15);
    // nửa số đầu việc thiếu định lượng → 8 × 0.5 = 4
    expect(qualityPenaltyOf({ active: 4, missingQuant: 2, missingDates: 0, missingPic: 0 })).toBe(4);
  });

  it("meanScore (điểm PM): trung bình bỏ null; null nếu rỗng", () => {
    expect(meanScore([100, 0])).toBe(50);
    expect(meanScore([80, null, 100])).toBe(90);
    expect(meanScore([null, null])).toBeNull();
  });

  it("buildComplianceReport: điểm dự án = điểm cập nhật − trừ chất lượng, kẹp 0..100", () => {
    const r = buildComplianceReport(
      [{
        key: "a", maCT: "C1", name: "A", pm: "PM1", updateDate: "2026-07-15",
        quality: { active: 4, missingQuant: 2, missingDates: 0, missingPic: 0 },
      }],
      { a: ["2026-07-01", "2026-07-08", "2026-07-15"] }, "2026-07", "2026-07-20",
    );
    const p = r.projects[0];
    expect(p.updateScore).toBe(100);   // 3 tuần đã tới hạn đều P
    // Chốt 28/07: BỎ chấm chất lượng Master Plan, điểm chỉ theo 3 tiêu chí tuân thủ.
    expect(p.qualityPenalty).toBe(0);
    expect(p.score).toBe(100);
  });
});

describe("nhóm PM+DPM", () => {
  it("pmGroupKey: cùng PM khác DPM ⇒ khoá KHÁC nhau; không DPM ⇒ chính là PM", () => {
    expect(pmGroupKey("Liêm", "")).toBe("Liêm");
    expect(pmGroupKey("Liêm", "An")).not.toBe(pmGroupKey("Liêm", "Bình"));
    expect(pmGroupKey("Liêm", "An")).not.toBe(pmGroupKey("Liêm", ""));
  });

  it("đếm PM đúng hạn TÁCH theo nhóm PM+DPM: Liêm 2 DPM = 2 nhóm", () => {
    // Liêm+An (dự án x1: đúng hạn), Liêm+Bình (dự án x2: TRỄ) → 2 nhóm, 1 đạt 1 không.
    const projects = [
      { key: "x1", maCT: "C1", name: "X1", pm: "Liêm", dpm: "An", updateDate: "2026-07-15" },   // T4 → P
      { key: "x2", maCT: "C2", name: "X2", pm: "Liêm", dpm: "Bình", updateDate: "2026-06-30" }, // lệch khung → x
    ];
    const history = { x1: ["2026-07-15"], x2: ["2026-06-30"] };
    const r = buildComplianceReport(projects, history, "2026-07", "2026-07-20");
    expect(r.pmTong).toBe(2);      // 2 nhóm (Liêm+An, Liêm+Bình) chứ không phải 1
    expect(r.pmDungHan).toBe(1);   // chỉ nhóm Liêm+An đạt
    expect(r.projects.find(p => p.key === "x1")!.dpm).toBe("An");
  });
});
