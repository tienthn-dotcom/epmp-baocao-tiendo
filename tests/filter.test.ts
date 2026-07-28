import { test, expect } from "vitest";
import {
  getFilteredProjects,
  auditFilterResult,
  classifyStageAlert,
  type StageMatcher,
} from "../src/lib/filter";
import type { ItemRow as RealItemRow } from "../src/lib/types";


function mkItem(p: Partial<RealItemRow> & { projectCode: string; projectName: string; rawCode: string }): RealItemRow {
  return {
    projectCode: p.projectCode,
    projectName: p.projectName,
    cdt: "",
    maCT: p.maCT ?? p.projectCode,
    projectDeadline: p.projectDeadline ?? null,
    stage: (p.stage as any) ?? "Đặt vật tư",
    rawCode: p.rawCode,
    desc: p.desc ?? "",
    owner: p.owner ?? "",
    start: p.start ?? null,
    deadline: p.deadline ?? null,
    pctPlanRaw: p.pctPlanRaw ?? null,
    pctPlan: p.pctPlan ?? null,
    pctActual: p.pctActual ?? null,
    pctPlanInvalid: false,
    pctActualInvalid: false,
    overdueDays: p.overdueDays ?? null,
    note: "",
    tc2: false,
    budget: null,
    actualCost: null,
    contractValue: null,
    penaltyPerDay: null,
  };
}

// Matcher dùng cho test — stageId/dept tối giản.
const matcher: StageMatcher = {
  stageId: (it) => (it.rawCode.startsWith("VT") ? "VT" : it.rawCode.startsWith("TK") ? "TK" : "OTHER"),
  deptOf: (it) => (it.rawCode.startsWith("VT") ? "SCM" : "PM"),
  // % dự kiến giả lập = pctPlanRaw để test cô lập (clamp xử lý trong filter).
  computePlanPct: (it) => it.pctPlanRaw,
};

const TH = { gapThreshold: 50, overdueThreshold: 10 };

test("classifyStageAlert: 100/100 KHÔNG cảnh báo", () => {
  const it = mkItem({ projectCode: "CT25-070", projectName: "Lobby", rawCode: "VT-1", pctPlanRaw: 100, pctActual: 100, overdueDays: 0 });
  const r = classifyStageAlert(it, matcher.computePlanPct(it), TH);
  expect(r.kind).toBe("none");
});

test("Luật mới: 50% thực tế, lệch 50, trễ 26 → TRỄ TIẾN ĐỘ (late ưu tiên)", () => {
  const it = mkItem({ projectCode: "P", projectName: "X", rawCode: "VT-1", pctPlanRaw: 100, pctActual: 50, overdueDays: 26 });
  const r = classifyStageAlert(it, matcher.computePlanPct(it), TH);
  expect(r.kind).toBe("late");
});

test("Luật 10/07: 90% thực tế + trễ 15 → CẦN CẮT (B ưu tiên hơn A dù quá hạn ≥14)", () => {
  const it = mkItem({ projectCode: "P", projectName: "X", rawCode: "VT-1", pctPlanRaw: 100, pctActual: 90, overdueDays: 15 });
  const r = classifyStageAlert(it, matcher.computePlanPct(it), TH);
  expect(r.kind).toBe("trim");
});

// Ma trận 07/2026: ô 3B (lệch <20 + quá hạn 1–13) → CẦN TẬP TRUNG.
// (Trước 07/2026 hai ca này là "không cảnh báo" — luật đã đổi theo chốt của PMO.)
test("Ma trận 3B: 90% thực tế (lệch 10) + trễ 12 → CẦN TẬP TRUNG", () => {
  const it = mkItem({ projectCode: "P", projectName: "X", rawCode: "VT-1", pctPlanRaw: 100, pctActual: 90, overdueDays: 12 });
  const r = classifyStageAlert(it, matcher.computePlanPct(it), TH);
  expect(r.kind).toBe("focus");
});

test("Ma trận 3B: 90% thực tế (lệch 10) + trễ 5 → CẦN TẬP TRUNG", () => {
  const it = mkItem({ projectCode: "P", projectName: "X", rawCode: "VT-1", pctPlanRaw: 100, pctActual: 90, overdueDays: 5 });
  const r = classifyStageAlert(it, matcher.computePlanPct(it), TH);
  expect(r.kind).toBe("focus");
});

test("Luật 09/07: trễ 25 ngày (≥14) → TRỄ TIẾN ĐỘ dù gap nhỏ", () => {
  const it = mkItem({ projectCode: "P", projectName: "X", rawCode: "VT-1", pctPlanRaw: 80, pctActual: 60, overdueDays: 25 });
  const r = classifyStageAlert(it, matcher.computePlanPct(it), TH);
  expect(r.kind).toBe("late");
});

test("Luật 09/07: gap 20 (dải 20–39) + trễ 13 (<14) → CẦN TẬP TRUNG", () => {
  const it = mkItem({ projectCode: "P", projectName: "X", rawCode: "VT-1", pctPlanRaw: 80, pctActual: 60, overdueDays: 13 });
  const r = classifyStageAlert(it, matcher.computePlanPct(it), { gapThreshold: 40, overdueThreshold: 10 });
  expect(r.kind).toBe("focus");
});

test("Luật 09/07: gap 15 (<20) + không quá hạn → KHÔNG cảnh báo", () => {
  const it = mkItem({ projectCode: "P", projectName: "X", rawCode: "VT-1", pctPlanRaw: 80, pctActual: 65, overdueDays: 0 });
  const r = classifyStageAlert(it, matcher.computePlanPct(it), { gapThreshold: 40, overdueThreshold: 10 });
  expect(r.kind).toBe("none");
});

// Ma trận 07/2026: ô 1C (lệch ≥40 nhưng CHƯA quá hạn) → CẦN TẬP TRUNG, không phải TRỄ.
// Trước đây luật là "lệch ≥40 HOẶC quá hạn ≥14 ⇒ trễ" nên ca này bị gán trễ.
test("Ma trận 1C: gap 45 (≥40) + KHÔNG quá hạn → CẦN TẬP TRUNG", () => {
  const it = mkItem({ projectCode: "P", projectName: "X", rawCode: "VT-1", pctPlanRaw: 100, pctActual: 55, overdueDays: 0 });
  const r = classifyStageAlert(it, matcher.computePlanPct(it), { gapThreshold: 40, overdueThreshold: 10 });
  expect(r.kind).toBe("focus");
});

// Ô 1B: lệch ≥40 + quá hạn 1–13 → vẫn TRỄ TIẾN ĐỘ.
test("Ma trận 1B: gap 45 (≥40) + trễ 5 → TRỄ TIẾN ĐỘ", () => {
  const it = mkItem({ projectCode: "P", projectName: "X", rawCode: "VT-1", pctPlanRaw: 100, pctActual: 55, overdueDays: 5 });
  const r = classifyStageAlert(it, matcher.computePlanPct(it), { gapThreshold: 40, overdueThreshold: 10 });
  expect(r.kind).toBe("late");
});

test("Lọc Giai đoạn=VT: Lobby BỊ LOẠI, Maxine (act=90, trễ 25) XUẤT HIỆN", () => {
  const items = [
    mkItem({ projectCode: "CT25-070", projectName: "Lobby", rawCode: "VT-1", pctPlanRaw: 100, pctActual: 100, overdueDays: 0 }),
    mkItem({ projectCode: "CT25-070", projectName: "Lobby", rawCode: "TK-1", pctPlanRaw: 100, pctActual: 100, overdueDays: 0 }),
    mkItem({ projectCode: "CT25-070", projectName: "Maxine", rawCode: "VT-1", pctPlanRaw: 100, pctActual: 90, overdueDays: 25 }),
    mkItem({ projectCode: "CT25-070", projectName: "Maxine", rawCode: "TK-1", pctPlanRaw: 100, pctActual: 100, overdueDays: 0 }),
    mkItem({ projectCode: "CT26-001", projectName: "PrjX", rawCode: "VT-1", pctPlanRaw: 100, pctActual: 100, overdueDays: 0 }),
    mkItem({ projectCode: "CT26-001", projectName: "PrjX", rawCode: "TK-1", pctPlanRaw: 100, pctActual: 0,   overdueDays: 0 }),
  ];
  const r = getFilteredProjects(items, matcher, { stages: ["VT"] }, TH);
  const names = r.projects.map(p => p.name).sort();
  expect(names).toEqual(["Maxine"]);
  const audit = auditFilterResult(items, matcher, { stages: ["VT"] }, TH, r);
  expect(audit.ok).toBe(true);
});

test("Giảm ngưỡng lệch (50 → 25): số dự án TĂNG hoặc bằng", () => {
  const items = [
    mkItem({ projectCode: "P1", projectName: "A", rawCode: "VT-1", pctPlanRaw: 100, pctActual: 85, overdueDays: 0 }), // gap 15 — dưới dải tập trung
    mkItem({ projectCode: "P2", projectName: "B", rawCode: "VT-1", pctPlanRaw: 100, pctActual: 30, overdueDays: 0 }), // gap 70
  ];
  const r50 = getFilteredProjects(items, matcher, {}, { gapThreshold: 50, overdueThreshold: 10 });
  const r25 = getFilteredProjects(items, matcher, {}, { gapThreshold: 25, overdueThreshold: 10 });
  expect(r25.projects.length).toBeGreaterThanOrEqual(r50.projects.length);
  expect(r50.projects.length).toBe(1);
  expect(r25.projects.length).toBe(1);
});

test("Audit phát hiện kết quả nhất quán", () => {
  const items = [
    mkItem({ projectCode: "P1", projectName: "A", rawCode: "VT-1", pctPlanRaw: 100, pctActual: 0, overdueDays: 0 }),
    mkItem({ projectCode: "P2", projectName: "B", rawCode: "VT-1", pctPlanRaw: 50, pctActual: 50, overdueDays: 0 }),
  ];
  const r = getFilteredProjects(items, matcher, {}, TH);
  const audit = auditFilterResult(items, matcher, {}, TH, r);
  expect(audit.ok).toBe(true);
  expect(audit.totalProjects).toBe(1);
});



