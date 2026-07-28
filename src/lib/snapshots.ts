import type { ItemRow, ReportData } from "./types";

export type ProjectSnap = {
  items: number;     // total open items
  late: number;      // overdueDays > 0
  severe: number;    // tc1 || tc2 (severity != ok)
  overdue10: number; // overdueDays > 10
  avgPlan: number;
  avgActual: number;
  avgGap: number;
};

export type Snapshot = {
  date: string;                            // YYYY-MM-DD
  capturedAt: number;                      // epoch ms
  source: "google" | "upload";
  total: ProjectSnap;
  projects: Record<string, ProjectSnap>;   // keyed by projectName || projectCode
};

const LS_KEY = "pmo.master.snapshots.v1";
const MAX_SNAPSHOTS = 120; // ~4 months of daily snapshots

function summarize(items: ItemRow[]): ProjectSnap {
  let late = 0, severe = 0, overdue10 = 0;
  let sumP = 0, sumA = 0, nPct = 0;
  for (const it of items) {
    if ((it.overdueDays ?? 0) > 0) late += 1;
    if ((it.overdueDays ?? 0) > 10) overdue10 += 1;
    const plan = it.pctPlan ?? 0;
    const actual = it.pctActual ?? 0;
    const overdue = it.overdueDays ?? 0;
    const isSevere = (plan - actual > 25 && actual < 100) || (overdue > 10 && actual < 100);
    if (isSevere) severe += 1;
    if (it.pctPlan != null || it.pctActual != null) {
      sumP += it.pctPlan ?? 0;
      sumA += it.pctActual ?? 0;
      nPct += 1;
    }
  }
  const avgPlan = nPct ? sumP / nPct : 0;
  const avgActual = nPct ? sumA / nPct : 0;
  return {
    items: items.length,
    late,
    severe,
    overdue10,
    avgPlan: round1(avgPlan),
    avgActual: round1(avgActual),
    avgGap: round1(Math.max(0, avgPlan - avgActual)),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function buildSnapshot(data: ReportData): Snapshot {
  const byProject = new Map<string, ItemRow[]>();
  for (const it of data.items) {
    const k = it.projectName || it.projectCode || "(không xác định)";
    (byProject.get(k) ?? byProject.set(k, []).get(k)!).push(it);
  }
  const projects: Record<string, ProjectSnap> = {};
  for (const [name, items] of byProject) projects[name] = summarize(items);
  return {
    date: data.refDate,
    capturedAt: Date.now(),
    source: data.source,
    total: summarize(data.items),
    projects,
  };
}

export function loadSnapshots(): Snapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Snapshot[];
    if (!Array.isArray(arr)) return [];
    return arr.sort((a, b) => a.date.localeCompare(b.date));
  } catch { return []; }
}

function writeSnapshots(arr: Snapshot[]) {
  try {
    const trimmed = arr.slice(-MAX_SNAPSHOTS);
    window.localStorage.setItem(LS_KEY, JSON.stringify(trimmed));
  } catch { /* quota — ignore */ }
}

/** Save (or replace) the snapshot for refDate. Returns the full sorted list. */
export function recordSnapshot(data: ReportData): Snapshot[] {
  if (typeof window === "undefined") return [];
  const snap = buildSnapshot(data);
  const arr = loadSnapshots().filter((s) => s.date !== snap.date);
  arr.push(snap);
  arr.sort((a, b) => a.date.localeCompare(b.date));
  writeSnapshots(arr);
  return arr;
}

export function clearSnapshots() {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(LS_KEY); } catch { /* */ }
}

/** Linear regression slope (least-squares) over y vs x=0..n-1.
 *  Returns the per-step slope. */
export function linearSlope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (ys[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** Classify direction from slope of `severe` count over recent snapshots.
 *  Positive slope ⇒ ngày càng tệ. */
export type TrendDirection = "worsening" | "recovering" | "stable" | "insufficient";

export function classifyTrend(severeSeries: number[]): { dir: TrendDirection; slope: number } {
  if (severeSeries.length < 3) return { dir: "insufficient", slope: 0 };
  const slope = linearSlope(severeSeries);
  if (slope >= 0.3) return { dir: "worsening", slope };
  if (slope <= -0.3) return { dir: "recovering", slope };
  return { dir: "stable", slope };
}

/** Naive on-time probability: combines current slip days, current gap and trend slope. */
export function onTimeProbability(args: {
  slipDays: number;
  avgGap: number;
  slope: number;
}): number {
  let p = 1;
  p -= Math.min(0.5, Math.max(0, args.slipDays) / 30);
  p -= Math.min(0.3, Math.max(0, args.avgGap - 10) / 100);
  if (args.slope > 0) p -= Math.min(0.3, args.slope * 0.08);
  else p += Math.min(0.1, Math.abs(args.slope) * 0.04);
  return Math.max(0, Math.min(1, p));
}

/* ===================== WEEKLY AGGREGATION =====================
 * "Đường số task lệch theo tuần" — gom snapshot hàng ngày thành 1 điểm/tuần,
 * lấy snapshot mới nhất trong tuần đó (chính là trạng thái cuối tuần).
 * Tuần ISO bắt đầu Thứ Hai.
 */

/** ISO week key "YYYY-Www" cho 1 ngày bất kỳ. */
export function isoWeekKey(dateIso: string): string {
  const d = new Date(dateIso + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // 0 = Mon
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const diff = (d.getTime() - firstThu.getTime()) / 86400000;
  const week = 1 + Math.round((diff - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export type WeeklyPoint = {
  week: string;          // YYYY-Www
  weekEnd: string;       // YYYY-MM-DD (ngày cuối — Chủ nhật)
  severe: number;
  late: number;
  overdue10: number;
  avgGap: number;
  avgActual: number;
};

/** Group snapshots into ISO-week buckets, returning the LATEST snapshot per
 *  week (the end-of-week state). `pickNode` chooses total vs a project's
 *  bucket inside each snapshot. */
export function aggregateWeekly(
  snapshots: Snapshot[],
  pickNode: (s: Snapshot) => ProjectSnap | undefined,
): WeeklyPoint[] {
  const byWeek = new Map<string, Snapshot>();
  for (const s of snapshots) {
    const k = isoWeekKey(s.date);
    const cur = byWeek.get(k);
    if (!cur || s.date > cur.date) byWeek.set(k, s);
  }
  const weeks = Array.from(byWeek.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  return weeks.map(([week, s]) => {
    const node = pickNode(s);
    // Ngày cuối tuần (Chủ Nhật) = date snapshot + (6 - dow_iso)
    const d = new Date(s.date + "T00:00:00Z");
    const dowIso = (d.getUTCDay() + 6) % 7; // 0 Mon..6 Sun
    d.setUTCDate(d.getUTCDate() + (6 - dowIso));
    const weekEnd = d.toISOString().slice(0, 10);
    return {
      week,
      weekEnd,
      severe: node?.severe ?? 0,
      late: node?.late ?? 0,
      overdue10: node?.overdue10 ?? 0,
      avgGap: node?.avgGap ?? 0,
      avgActual: node?.avgActual ?? 0,
    };
  });
}
