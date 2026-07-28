// Business cleansing classifier — DRY-RUN only (read-only, no enforcement).
// Input: parsed ItemRow[]. Output: classified items + report (per-rule counts,
// per-KPI before/after, sample tasks). UI surfaces this in a drawer.

import type { ItemRow } from "./types";

/** Local severity classifier — derived (no longer stored on ItemRow). */
type Sev = "ok" | "warning" | "critical";
function sevOf(i: ItemRow): Sev {
  const overdue = i.overdueDays ?? 0;
  const plan = i.pctPlan ?? 0;
  const actual = i.pctActual ?? 0;
  const tc1 = plan - actual > 25 && actual < 100;
  const tc2 = overdue > 10 && actual < 100;
  if (tc1 && tc2) return "critical";
  if (tc1 || tc2) return "warning";
  return "ok";
}

export type BusinessStatus =
  | "ACTIVE"
  | "WARNING"
  | "CRITICAL"
  | "COMPLETED"
  | "CANCELLED"
  | "ON_HOLD";

export const ACTIVE_STATUSES: BusinessStatus[] = ["ACTIVE", "WARNING", "CRITICAL"];
export const CLOSED_STATUSES: BusinessStatus[] = ["COMPLETED", "CANCELLED", "ON_HOLD"];

// ─────────────────────────────────────────────────────────────────────
// RULE DEFINITIONS (priority order — first match wins)
// ─────────────────────────────────────────────────────────────────────

export type RuleId =
  | "R_CANCELLED_KEYWORD"
  | "R_ON_HOLD_KEYWORD"
  | "R_COMPLETED_PROGRESS"
  | "R_COMPLETED_KEYWORD"
  | "R_CRITICAL_OVERDUE"
  | "R_WARNING_GAP"
  | "R_ACTIVE_DEFAULT";

export interface Rule {
  id: RuleId;
  description: string;
  status: BusinessStatus;
  sourceField: string; // which Master Plan column drives this rule
}

export const RULES: Record<RuleId, Rule> = {
  R_CANCELLED_KEYWORD: {
    id: "R_CANCELLED_KEYWORD",
    description: "note/desc khớp keyword huỷ (hủy, không thực hiện, cancelled, dừng triển khai)",
    status: "CANCELLED",
    sourceField: "Col M (desc) + Col U (note)",
  },
  R_ON_HOLD_KEYWORD: {
    id: "R_ON_HOLD_KEYWORD",
    description: "note/desc khớp keyword tạm dừng (tạm dừng, chờ duyệt, hold, pending)",
    status: "ON_HOLD",
    sourceField: "Col M (desc) + Col U (note)",
  },
  R_COMPLETED_PROGRESS: {
    id: "R_COMPLETED_PROGRESS",
    description: "% Thực tế ≥ 100",
    status: "COMPLETED",
    sourceField: "Col S (pctActual)",
  },
  R_COMPLETED_KEYWORD: {
    id: "R_COMPLETED_KEYWORD",
    description: "note/desc khớp keyword hoàn thành (đã bàn giao, đã nghiệm thu, đã giao hàng, completed, done)",
    status: "COMPLETED",
    sourceField: "Col M (desc) + Col U (note)",
  },
  R_CRITICAL_OVERDUE: {
    id: "R_CRITICAL_OVERDUE",
    description: "Trễ > 10 ngày & %TT < 50% × %LT (technical severity)",
    status: "CRITICAL",
    sourceField: "Col T (overdueDays) + Col R + Col S",
  },
  R_WARNING_GAP: {
    id: "R_WARNING_GAP",
    description: "Chênh lệch %LT − %TT > 25 điểm (technical severity)",
    status: "WARNING",
    sourceField: "Col R − Col S",
  },
  R_ACTIVE_DEFAULT: {
    id: "R_ACTIVE_DEFAULT",
    description: "Mặc định — chưa hit rule nào",
    status: "ACTIVE",
    sourceField: "—",
  },
};

// ─────────────────────────────────────────────────────────────────────
// KEYWORD REGEX
// ─────────────────────────────────────────────────────────────────────

const KW_CANCELLED = [
  /(?:đã|được)\s+hu(?:ỷ|y)\b/i,
  /\bhu(?:ỷ|y)\s+(?:bỏ|hợp\s+đồng|task|hạng\s+mục)/i,
  /không\s+thực\s+hiện/i,
  /dừng\s+triển\s+khai/i,
  /\b(cancelled|canceled)\b/i,
];

const KW_ON_HOLD = [
  /tạm\s+(dừng|ngưng|hoãn)/i,
  /chờ\s+(quyết\s+định|chủ\s+đầu\s+tư|phê\s+duyệt|duyệt|ý\s+kiến)/i,
  /\b(on[\s-]?hold|pending|paused?)\b/i,
];

const KW_COMPLETED = [
  /đã\s+hoàn\s+thành(?!\s*\d)/i, // "đã hoàn thành" but not "đã hoàn thành 50%"
  /hoàn\s+tất(?!\s*\d)/i,
  /đã\s+bàn\s+giao/i,
  /đã\s+nghiệm\s+thu/i,
  /đã\s+giao\s+hàng/i,
  /\b(completed|finished|closed|done)\b/i,
];

function matchAny(text: string, patterns: RegExp[]): RegExp | null {
  for (const p of patterns) if (p.test(text)) return p;
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// CLASSIFIER (pure function)
// ─────────────────────────────────────────────────────────────────────

export interface Classification {
  status: BusinessStatus;
  ruleId: RuleId;
  matchedKeyword?: string;
  reason: string;
}

const T_CRITICAL_DAYS = 10;
const T_GAP_PP = 25;

export function classify(item: ItemRow): Classification {
  const text = `${item.desc ?? ""} | ${item.note ?? ""}`;

  // R_CANCELLED_KEYWORD
  const mc = matchAny(text, KW_CANCELLED);
  if (mc) {
    return {
      status: "CANCELLED",
      ruleId: "R_CANCELLED_KEYWORD",
      matchedKeyword: mc.source,
      reason: `Khớp keyword huỷ: /${mc.source}/`,
    };
  }

  // R_ON_HOLD_KEYWORD
  const mh = matchAny(text, KW_ON_HOLD);
  if (mh) {
    return {
      status: "ON_HOLD",
      ruleId: "R_ON_HOLD_KEYWORD",
      matchedKeyword: mh.source,
      reason: `Khớp keyword tạm dừng: /${mh.source}/`,
    };
  }

  // R_COMPLETED_PROGRESS
  if (item.pctActual != null && item.pctActual >= 100) {
    return {
      status: "COMPLETED",
      ruleId: "R_COMPLETED_PROGRESS",
      reason: `%TT = ${Math.round(item.pctActual)} ≥ 100`,
    };
  }

  // R_COMPLETED_KEYWORD
  const md = matchAny(text, KW_COMPLETED);
  if (md) {
    return {
      status: "COMPLETED",
      ruleId: "R_COMPLETED_KEYWORD",
      matchedKeyword: md.source,
      reason: `Khớp keyword hoàn thành: /${md.source}/`,
    };
  }

  // R_CRITICAL_OVERDUE
  if (
    (item.overdueDays ?? 0) > T_CRITICAL_DAYS &&
    item.pctActual != null &&
    item.pctPlan != null &&
    item.pctActual < item.pctPlan * 0.5
  ) {
    return {
      status: "CRITICAL",
      ruleId: "R_CRITICAL_OVERDUE",
      reason: `Trễ ${item.overdueDays} ngày & %TT(${Math.round(item.pctActual)}) < ½×%LT(${Math.round(item.pctPlan)})`,
    };
  }

  // R_WARNING_GAP
  if (item.pctPlan != null && item.pctActual != null && item.pctPlan - item.pctActual > T_GAP_PP) {
    return {
      status: "WARNING",
      ruleId: "R_WARNING_GAP",
      reason: `Chênh lệch ${Math.round(item.pctPlan - item.pctActual)}pp > ${T_GAP_PP}pp`,
    };
  }

  return {
    status: "ACTIVE",
    ruleId: "R_ACTIVE_DEFAULT",
    reason: "Không hit rule nào — default",
  };
}

// ─────────────────────────────────────────────────────────────────────
// DRY-RUN REPORT
// ─────────────────────────────────────────────────────────────────────

export interface ClassifiedItem {
  item: ItemRow;
  classification: Classification;
  /** Governed Delay Days: TODAY − DEADLINE, ONLY if status ∈ {ACTIVE, WARNING, CRITICAL}. 0 otherwise. */
  delayDays: number;
}

export interface RuleStats {
  rule: Rule;
  count: number;
  samples: ClassifiedItem[]; // first 5
}

// ─────────────────────────────────────────────────────────────────────
// GOVERNED DELAY DAYS
// Rule: Delay Days = TODAY − DEADLINE, CHỈ KHI Business_Status ∈ {ACTIVE, WARNING, CRITICAL}.
// COMPLETED / CANCELLED / ON_HOLD → Delay Days = 0 (loại khỏi mọi insight).
// ─────────────────────────────────────────────────────────────────────
const DAY_MS = 86400000;
export function computeDelayDays(item: ItemRow, status: BusinessStatus, refDateIso?: string): number {
  if (!ACTIVE_STATUSES.includes(status)) return 0;
  if (!item.deadline) return 0;
  const today = refDateIso ? new Date(refDateIso).getTime() : Date.now();
  const dl = new Date(item.deadline).getTime();
  if (Number.isNaN(dl)) return 0;
  const diff = Math.floor((today - dl) / DAY_MS);
  return diff > 0 ? diff : 0;
}

export interface KpiImpact {
  label: string;
  before: number; // computed on ALL items
  after: number; // computed on ACTIVE-only pool
  delta: number;
  formula: string;
}

export interface CleansingReport {
  totalItems: number;
  classified: ClassifiedItem[];

  statusCounts: Record<BusinessStatus, number>;
  ruleStats: RuleStats[];

  insightPoolSize: number; // ACTIVE + WARNING + CRITICAL
  archiveSize: number; // COMPLETED + CANCELLED + ON_HOLD

  kpiImpact: KpiImpact[];
  dataBugs: Array<{ kind: string; item: ItemRow; detail: string }>;
}

export function generateDryRunReport(items: ItemRow[]): CleansingReport {
  const classified: ClassifiedItem[] = items.map((item) => {
    const classification = classify(item);
    return { item, classification, delayDays: computeDelayDays(item, classification.status) };
  });

  const statusCounts: Record<BusinessStatus, number> = {
    ACTIVE: 0,
    WARNING: 0,
    CRITICAL: 0,
    COMPLETED: 0,
    CANCELLED: 0,
    ON_HOLD: 0,
  };
  const byRule = new Map<RuleId, ClassifiedItem[]>();

  for (const c of classified) {
    statusCounts[c.classification.status]++;
    const arr = byRule.get(c.classification.ruleId) ?? [];
    arr.push(c);
    byRule.set(c.classification.ruleId, arr);
  }

  const ruleStats: RuleStats[] = (Object.keys(RULES) as RuleId[]).map((id) => {
    const arr = byRule.get(id) ?? [];
    return { rule: RULES[id], count: arr.length, samples: arr.slice(0, 5) };
  });

  const insightPool = classified.filter((c) => ACTIVE_STATUSES.includes(c.classification.status)).map((c) => c.item);
  const archive = classified.filter((c) => CLOSED_STATUSES.includes(c.classification.status)).map((c) => c.item);

  // KPI BEFORE = computed on ALL items (current dashboard behavior)
  // KPI AFTER  = computed on insightPool only (after cleansing)
  const all = items;
  const beforeOverdue = all.filter((i) => (i.overdueDays ?? 0) > 0 && (i.pctActual ?? 0) < 100);
  const afterOverdue = insightPool.filter((i) => (i.overdueDays ?? 0) > 0 && (i.pctActual ?? 0) < 100);
  const beforeCritical = all.filter((i) => sevOf(i) === "critical");
  const afterCritical = insightPool.filter((i) => sevOf(i) === "critical");
  const beforeAtRisk = all.filter((i) => sevOf(i) === "warning" || sevOf(i) === "critical");
  const afterAtRisk = insightPool.filter((i) => sevOf(i) === "warning" || sevOf(i) === "critical");

  const upcomingDays = 14;
  const today = new Date().getTime();
  const dayMs = 86400000;
  const isUpcoming = (i: ItemRow) => {
    if (!i.deadline) return false;
    const dl = Math.round((new Date(i.deadline).getTime() - today) / dayMs);
    return dl >= 0 && dl <= upcomingDays && (i.overdueDays ?? 0) === 0 && (i.pctActual ?? 0) < 100;
  };
  const beforeUpcoming = all.filter(isUpcoming);
  const afterUpcoming = insightPool.filter(isUpcoming);

  const beforeAction = all.filter((i) => ((i.overdueDays ?? 0) > 0 || sevOf(i) === "critical") && (i.note || "").trim().length > 0);
  const afterAction = insightPool.filter((i) => ((i.overdueDays ?? 0) > 0 || sevOf(i) === "critical") && (i.note || "").trim().length > 0);

  const kpiImpact: KpiImpact[] = [
    {
      label: "Trễ (overdue)",
      before: beforeOverdue.length,
      after: afterOverdue.length,
      delta: afterOverdue.length - beforeOverdue.length,
      formula: "items where overdueDays>0 AND %TT<100",
    },
    {
      label: "Critical",
      before: beforeCritical.length,
      after: afterCritical.length,
      delta: afterCritical.length - beforeCritical.length,
      formula: "items where severity='critical'",
    },
    {
      label: "At Risk (warning + critical)",
      before: beforeAtRisk.length,
      after: afterAtRisk.length,
      delta: afterAtRisk.length - beforeAtRisk.length,
      formula: "items where severity in [warning, critical]",
    },
    {
      label: "Sắp có vấn đề (14 ngày)",
      before: beforeUpcoming.length,
      after: afterUpcoming.length,
      delta: afterUpcoming.length - beforeUpcoming.length,
      formula: "0 ≤ deadline−today ≤ 14 AND overdue=0 AND %TT<100",
    },
    {
      label: "Action Center (vướng mắc)",
      before: beforeAction.length,
      after: afterAction.length,
      delta: afterAction.length - beforeAction.length,
      formula: "(overdue>0 OR critical) AND note≠''",
    },
  ];

  // Governed Delay Days — TODAY−DEADLINE, only when status ∈ ACTIVE/WARNING/CRITICAL
  const beforeDelaySum = all.reduce((s, i) => s + Math.max(0, i.overdueDays ?? 0), 0);
  const afterDelaySum = classified.reduce((s, c) => s + c.delayDays, 0);
  const beforeDelayCount = all.filter((i) => (i.overdueDays ?? 0) > 0).length;
  const afterDelayCount = classified.filter((c) => c.delayDays > 0).length;
  kpiImpact.push(
    {
      label: "Delay Days — tổng ngày trễ (governed)",
      before: beforeDelaySum,
      after: afterDelaySum,
      delta: afterDelaySum - beforeDelaySum,
      formula: "Σ (TODAY − DEADLINE) CHỈ KHI Business_Status ∈ {ACTIVE, WARNING, CRITICAL}",
    },
    {
      label: "Delay Days — số task có trễ (governed)",
      before: beforeDelayCount,
      after: afterDelayCount,
      delta: afterDelayCount - beforeDelayCount,
      formula: "COUNT(delayDays > 0) sau khi áp business status guard",
    },
  );


  // Data bugs: closed items that LEAK into current KPIs (the dashboard
  // currently shows them — that's the bug we're surfacing).
  const dataBugs: CleansingReport["dataBugs"] = [];
  for (const c of classified) {
    if (!CLOSED_STATUSES.includes(c.classification.status)) continue;
    const i = c.item;
    if ((i.overdueDays ?? 0) > 0 && (i.pctActual ?? 0) < 100 && c.classification.status !== "COMPLETED") {
      dataBugs.push({ kind: "CLOSED_IN_OVERDUE", item: i, detail: `${c.classification.status} nhưng đang đếm vào Trễ` });
    }
    if (sevOf(i) === "critical") {
      dataBugs.push({ kind: "CLOSED_IN_CRITICAL", item: i, detail: `${c.classification.status} nhưng severity='critical'` });
    }
    if (c.classification.status === "COMPLETED" && (i.overdueDays ?? 0) > 0 && (i.pctActual ?? 0) >= 100) {
      dataBugs.push({ kind: "DONE_LATE_COUNTED", item: i, detail: `Đã xong (%TT=100) nhưng vẫn cộng ${i.overdueDays} ngày trễ` });
    }
  }

  return {
    totalItems: items.length,
    classified,
    statusCounts,
    ruleStats,
    insightPoolSize: insightPool.length,
    archiveSize: archive.length,
    kpiImpact,
    dataBugs,
  };
}

// ─────────────────────────────────────────────────────────────────────
// CSV EXPORT
// ─────────────────────────────────────────────────────────────────────

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function reportToCsv(report: CleansingReport): string {
  const rows: string[] = [];
  rows.push(
    [
      "projectCode",
      "projectName",
      "rawCode",
      "desc",
      "owner",
      "deadline",
      "pctPlan",
      "pctActual",
      "overdueDays_raw",
      "delayDays_governed",
      "note",
      "businessStatus",
      "ruleId",
      "reason",
      "inInsightPool",
    ]
      .map(csvEscape)
      .join(","),
  );
  for (const c of report.classified) {
    const inPool = ACTIVE_STATUSES.includes(c.classification.status);
    rows.push(
      [
        c.item.projectCode,
        c.item.projectName,
        c.item.rawCode,
        c.item.desc,
        c.item.owner,
        c.item.deadline ?? "",
        c.item.pctPlan ?? "",
        c.item.pctActual ?? "",
        c.item.overdueDays,
        c.delayDays,
        c.item.note,
        c.classification.status,
        c.classification.ruleId,
        c.classification.reason,
        inPool ? "YES" : "NO",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return rows.join("\n");
}
