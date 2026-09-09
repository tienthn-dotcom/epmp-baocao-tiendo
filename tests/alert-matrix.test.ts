import { describe, it, expect } from "vitest";
import {
  classifyByMatrix, gapLevel, overdueLevel, classifyStageAlert, deadlineBucketOf,
  type DeadlineBucket,
} from "../src/lib/filter";
import type { ItemRow } from "../src/lib/types";

const GT = 40; // gapThreshold

describe("bậc phân loại", () => {
  // Chốt 31/07/2026: mốc 20% thuộc BẬC 3 ("bám sát kế hoạch"), bậc 2 là dải TRÊN 20 tới dưới ngưỡng trễ.
  it("bậc % lệch: 1 = ≥40 · 2 = >20..<40 · 3 = ≤20", () => {
    expect(gapLevel(40, GT)).toBe(1);
    expect(gapLevel(100, GT)).toBe(1);
    expect(gapLevel(39.9, GT)).toBe(2);
    expect(gapLevel(20.1, GT)).toBe(2);
    expect(gapLevel(20, GT)).toBe(3);
    expect(gapLevel(19.9, GT)).toBe(3);
    expect(gapLevel(0, GT)).toBe(3);
    expect(gapLevel(-30, GT)).toBe(3); // vượt kế hoạch
  });

  it("bậc quá hạn: A = ≥14 · B = 1..13 · C = 0", () => {
    expect(overdueLevel(14)).toBe("A");
    expect(overdueLevel(99)).toBe("A");
    expect(overdueLevel(13)).toBe("B");
    expect(overdueLevel(1)).toBe("B");
    expect(overdueLevel(0)).toBe("C");
  });
});

describe("bậc ĐỘ GẦN mốc bàn giao dự án", () => {
  const HOM_NAY = "2026-07-17";
  it("còn > 30 ngày → far", () => {
    expect(deadlineBucketOf("2026-08-17", HOM_NAY)).toBe("far"); // còn 31 ngày
  });
  it("còn đúng 30 ngày → d30", () => {
    expect(deadlineBucketOf("2026-08-16", HOM_NAY)).toBe("d30");
  });
  it("còn 15 ngày → d30", () => {
    expect(deadlineBucketOf("2026-08-01", HOM_NAY)).toBe("d30");
  });
  it("còn đúng 14 ngày → d14", () => {
    expect(deadlineBucketOf("2026-07-31", HOM_NAY)).toBe("d14");
  });
  it("bàn giao đúng hôm nay → d14", () => {
    expect(deadlineBucketOf("2026-07-17", HOM_NAY)).toBe("d14");
  });
  it("ĐÃ quá mốc (số ngày âm) → d14, bậc gắt nhất", () => {
    expect(deadlineBucketOf("2026-06-01", HOM_NAY)).toBe("d14");
  });
  it("thiếu mốc bàn giao hoặc thiếu hôm nay → far (không siết oan)", () => {
    expect(deadlineBucketOf(null, HOM_NAY)).toBe("far");
    expect(deadlineBucketOf("2026-07-20", undefined)).toBe("far");
  });
});

/** Bảng PMO chốt 17/07/2026 — kiểm ĐỦ 27 ô (9 tổ hợp × 3 bậc bàn giao).
 *  Chép nguyên từ ảnh PMO gửi. */
describe("ma trận 3 chiều — đủ 27 ô", () => {
  const O: Record<string, [number, number]> = {
    "1A": [50, 20], "1B": [50, 5], "1C": [50, 0],
    "2A": [30, 20], "2B": [30, 5], "2C": [30, 0],
    "3A": [10, 20], "3B": [10, 5], "3C": [10, 0],
  };
  type Mong = [string, string | null];
  const BANG: Record<DeadlineBucket, Record<string, Mong>> = {
    far: {
      "1A": ["late", "red"],   "1B": ["late", "red"],    "1C": ["focus", "amber"],
      "2A": ["late", "red"],   "2B": ["focus", "amber"], "2C": ["none", null],
      "3A": ["trim", "amber"], "3B": ["focus", "amber"], "3C": ["none", null],
    },
    d30: {
      "1A": ["late", "red"],   "1B": ["late", "red"],    "1C": ["late", "red"],
      "2A": ["late", "red"],   "2B": ["focus", "amber"], "2C": ["focus", "amber"],
      "3A": ["trim", "red"],   "3B": ["focus", "amber"], "3C": ["none", null],
    },
    d14: {
      "1A": ["late", "red"],   "1B": ["late", "red"],    "1C": ["late", "red"],
      "2A": ["late", "red"],   "2B": ["late", "red"],    "2C": ["focus", "red"],
      "3A": ["trim", "red"],   "3B": ["focus", "red"],   "3C": ["focus", "amber"],
    },
  };
  for (const bucket of ["far", "d30", "d14"] as DeadlineBucket[]) {
    for (const cell of Object.keys(O)) {
      const [gap, od] = O[cell];
      const [kind, color] = BANG[bucket][cell];
      it(`${bucket} · ${cell} → ${kind} / ${color ?? "không màu"}`, () => {
        expect(classifyByMatrix(gap, od, GT, bucket)).toEqual({ kind, color });
      });
    }
  }
});

describe("điểm MỚI: cùng tình trạng, dự án càng sát bàn giao càng bị siết", () => {
  it("1C (lệch ≥40, chưa quá hạn): far = tập trung/vàng → d30 & d14 = TRỄ/đỏ", () => {
    expect(classifyByMatrix(50, 0, GT, "far")).toEqual({ kind: "focus", color: "amber" });
    expect(classifyByMatrix(50, 0, GT, "d30")).toEqual({ kind: "late", color: "red" });
    expect(classifyByMatrix(50, 0, GT, "d14")).toEqual({ kind: "late", color: "red" });
  });

  it("3A (gần xong, quá hạn ≥14): NHÃN giữ nguyên 'cần cắt', chỉ MÀU vàng→đỏ", () => {
    expect(classifyByMatrix(10, 20, GT, "far")).toEqual({ kind: "trim", color: "amber" });
    expect(classifyByMatrix(10, 20, GT, "d30")).toEqual({ kind: "trim", color: "red" });
    expect(classifyByMatrix(10, 20, GT, "d14")).toEqual({ kind: "trim", color: "red" });
  });

  it("3C (không lệch, không quá hạn): im ở far/d30, tới d14 mới thành tập trung/vàng", () => {
    expect(classifyByMatrix(10, 0, GT, "far")).toEqual({ kind: "none", color: null });
    expect(classifyByMatrix(10, 0, GT, "d30")).toEqual({ kind: "none", color: null });
    expect(classifyByMatrix(10, 0, GT, "d14")).toEqual({ kind: "focus", color: "amber" });
  });

  it("2C: im ở far, tập trung/vàng ở d30, tập trung/ĐỎ ở d14", () => {
    expect(classifyByMatrix(30, 0, GT, "far")).toEqual({ kind: "none", color: null });
    expect(classifyByMatrix(30, 0, GT, "d30")).toEqual({ kind: "focus", color: "amber" });
    expect(classifyByMatrix(30, 0, GT, "d14")).toEqual({ kind: "focus", color: "red" });
  });
});

describe("MÀU không dính chết vào NHÃN", () => {
  it("cùng nhãn 'Cần tập trung' mà có cả vàng lẫn đỏ", () => {
    expect(classifyByMatrix(10, 5, GT, "far")).toEqual({ kind: "focus", color: "amber" });
    expect(classifyByMatrix(10, 5, GT, "d14")).toEqual({ kind: "focus", color: "red" });
  });
  it("cùng nhãn 'Cần cắt đầu việc' mà có cả vàng lẫn đỏ", () => {
    expect(classifyByMatrix(10, 20, GT, "far")).toEqual({ kind: "trim", color: "amber" });
    expect(classifyByMatrix(10, 20, GT, "d14")).toEqual({ kind: "trim", color: "red" });
  });
  it("'Trễ tiến độ' thì LUÔN đỏ ở mọi bậc", () => {
    for (const b of ["far", "d30", "d14"] as DeadlineBucket[]) {
      expect(classifyByMatrix(50, 20, GT, b).color).toBe("red");
    }
  });
});

describe("ranh giới", () => {
  it("lệch đúng 40 + không quá hạn + far → 1C = focus (KHÔNG phải late)", () => {
    expect(classifyByMatrix(40, 0, GT, "far")).toEqual({ kind: "focus", color: "amber" });
  });
  it("lệch đúng 20 + không quá hạn + far → 2C = none", () => {
    expect(classifyByMatrix(20, 0, GT, "far")).toEqual({ kind: "none", color: null });
  });
  it("quá hạn đúng 14 + lệch nhỏ + far → 3A = trim", () => {
    expect(classifyByMatrix(0, 14, GT, "far")).toEqual({ kind: "trim", color: "amber" });
  });
  it("quá hạn 13 + lệch nhỏ + far → 3B = focus", () => {
    expect(classifyByMatrix(0, 13, GT, "far")).toEqual({ kind: "focus", color: "amber" });
  });
});

describe("mặc định bucket = far (giữ nguyên hành vi khi nơi gọi chưa truyền)", () => {
  it("không truyền bucket → tra bảng far", () => {
    expect(classifyByMatrix(50, 0, GT)).toEqual(classifyByMatrix(50, 0, GT, "far"));
  });
});

describe("khi KHÔNG tính được % lệch (gap = null)", () => {
  it("quá hạn ≥14 → late/đỏ, KHÔNG được là trim (không biết có gần xong hay không)", () => {
    expect(classifyByMatrix(null, 20, GT, "far")).toEqual({ kind: "late", color: "red" });
    expect(classifyByMatrix(null, 20, GT, "d14")).toEqual({ kind: "late", color: "red" });
  });
  it("quá hạn 1–13 → focus", () => {
    expect(classifyByMatrix(null, 5, GT, "far")).toEqual({ kind: "focus", color: "amber" });
  });
  it("không quá hạn + far → none", () => {
    expect(classifyByMatrix(null, 0, GT, "far")).toEqual({ kind: "none", color: null });
  });
});

describe("classifyStageAlert dùng chung ma trận + tự tra bậc bàn giao", () => {
  const mk = (pctActual: number | null, overdueDays: number, projectDeadline: string | null): ItemRow => ({
    projectCode: "CT1", projectName: "P", cdt: "", maCT: "CT1", projectDeadline,
    stage: "Phát hành thiết kế", rawCode: "TK", desc: "", owner: "",
    start: null, deadline: null, pctPlanRaw: null, pctPlan: null, pctActual,
    pctPlanInvalid: false, pctActualInvalid: false, overdueDays, note: "", tc2: false,
    budget: null, actualCost: null, contractValue: null, penaltyPerDay: null,
  });
  const TH = { gapThreshold: 40, overdueThreshold: 10, today: "2026-07-17" };

  it("1C + dự án còn xa hạn (bàn giao 31/12) → focus/vàng", () => {
    const r = classifyStageAlert(mk(20, 0, "2026-12-31"), 90, TH);
    expect([r.kind, r.color]).toEqual(["focus", "amber"]);
  });
  it("1C + dự án bàn giao sau 10 ngày → late/đỏ (bị siết)", () => {
    const r = classifyStageAlert(mk(20, 0, "2026-07-27"), 90, TH);
    expect([r.kind, r.color]).toEqual(["late", "red"]);
  });
  it("3A + dự án bàn giao sau 20 ngày → vẫn nhãn trim nhưng ĐỎ", () => {
    const r = classifyStageAlert(mk(85, 20, "2026-08-06"), 90, TH);
    expect([r.kind, r.color]).toEqual(["trim", "red"]);
  });
  it("thiếu %thực tế + quá hạn 20 → late (không phải trim)", () => {
    expect(classifyStageAlert(mk(null, 20, "2026-12-31"), 90, TH).kind).toBe("late");
  });
  it("thiếu `today` trong ngưỡng → coi như far, KHÔNG siết", () => {
    const r = classifyStageAlert(mk(20, 0, "2026-07-27"), 90, { gapThreshold: 40, overdueThreshold: 10 });
    expect([r.kind, r.color]).toEqual(["focus", "amber"]);
  });
});
