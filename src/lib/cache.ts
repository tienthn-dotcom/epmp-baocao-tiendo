/**
 * Anti-blank-screen layer: persists the last successfully loaded ReportData
 * to localStorage so the BOD always sees the most recent numbers, even if
 * the network fails or the user opens the dashboard before configuring a
 * source. A `fetchedAt` timestamp travels with the cached payload so the UI
 * can warn when the data is stale ( > 24h ).
 *
 * Demo dataset is a tiny but realistic synthetic snapshot used only when
 * NEITHER live data NOR a cached payload exists — clearly labeled in the UI.
 */
import type { ReportData, ItemRow, ProjectRow, StageKey } from "./types";
import { getDaysOverdue } from "./overdue";

const LS_LAST = "pmo.master.lastKnown.v1";

export type CachedReport = { data: ReportData; savedAt: string };

export function saveLastKnown(data: ReportData): void {
  try {
    const payload: CachedReport = { data, savedAt: new Date().toISOString() };
    localStorage.setItem(LS_LAST, JSON.stringify(payload));
  } catch {
    /* quota or serialization failure — silent */
  }
}

export function loadLastKnown(): CachedReport | null {
  try {
    const raw = localStorage.getItem(LS_LAST);
    if (!raw) return null;
    const p = JSON.parse(raw) as CachedReport;
    if (!p?.data || !p?.savedAt) return null;
    return p;
  } catch {
    return null;
  }
}

export function clearLastKnown(): void {
  try { localStorage.removeItem(LS_LAST); } catch { /* */ }
}

/** Hours between `iso` and now. Returns Infinity for invalid input. */
export function hoursSince(iso: string | null | undefined): number {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 3_600_000;
}

/** "vừa xong" / "3 phút trước" / "2 giờ trước" / "5 ngày trước". */
export function relativeVi(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diffMs = Date.now() - t;
  if (diffMs < 60_000) return "vừa xong";
  const m = Math.floor(diffMs / 60_000);
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  return `${d} ngày trước`;
}

/* ===================== DEMO DATASET =====================
 * Only shown on first run (no live source AND no cache). Project codes are
 * prefixed with "DEMO-" so they cannot be confused with real CT codes. The
 * UI labels them clearly with a "DỮ LIỆU DEMO" banner.
 */

function dDaysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function dDaysAheadIso(n: number): string {
  return dDaysAgoIso(-n);
}

function demoItem(
  projectCode: string,
  projectName: string,
  stage: StageKey,
  desc: string,
  owner: string,
  deadlineIso: string,
  pctPlan: number,
  pctActual: number,
  refIso: string,
): ItemRow {
  const overdueDays = getDaysOverdue({ deadline: deadlineIso, pctActual }, refIso);
  const tc2 = (overdueDays ?? 0) > 5 && pctActual < 100;
  return {
    projectCode,
    projectName,
    cdt: "Demo CĐT",
    maCT: projectCode,
    projectDeadline: dDaysAheadIso(45),
    projectStart: dDaysAgoIso(30),
    stage,
    rawCode: `${projectCode}.${stage[0]}`,
    desc,
    owner,
    start: null,
    deadline: deadlineIso,
    pctPlanRaw: pctPlan / 100,
    pctPlan,
    pctActual,
    pctPlanInvalid: false,
    pctActualInvalid: false,
    overdueDays,
    note: "",
    tc2,
    budget: 500_000_000,
    actualCost: 420_000_000,
    contractValue: 1_200_000_000,
    penaltyPerDay: null,
  };
}

export function getDemoData(): ReportData {
  const ref = dDaysAgoIso(0);

  const items: ItemRow[] = [
    demoItem("DEMO-001", "Showroom Demo Hà Nội", "Đặt vật tư",       "Đặt vật tư inox 304 quầy lễ tân", "A. Minh",  dDaysAgoIso(12), 90, 55, ref),
    demoItem("DEMO-001", "Showroom Demo Hà Nội", "Triển khai sản xuất","Shop drawing cụm trần",          "C. Hoa",   dDaysAgoIso(3),  70, 60, ref),
    demoItem("DEMO-001", "Showroom Demo Hà Nội", "Thi công lắp đặt",  "Lắp đặt vách kính mặt tiền",     "A. Nam",   dDaysAheadIso(8), 30, 25, ref),
    demoItem("DEMO-001", "Showroom Demo Hà Nội", "Sản xuất nhập kho", "Sản xuất tủ trưng bày",          "C. Hoa",   dDaysAheadIso(15), 45, 40, ref),

    demoItem("DEMO-002", "Flagship Store Demo SG", "Trình duyệt mẫu",   "Trình mẫu đá ốp mặt tiền",      "A. Phong", dDaysAgoIso(20), 100, 70, ref),
    demoItem("DEMO-002", "Flagship Store Demo SG", "Đặt vật tư",        "Đặt đèn LED dải",               "C. Linh",  dDaysAheadIso(2), 85, 80, ref),
    demoItem("DEMO-002", "Flagship Store Demo SG", "Triển khai sản xuất","Shop drawing quầy bar",         "A. Phong", dDaysAheadIso(5), 60, 58, ref),
    demoItem("DEMO-002", "Flagship Store Demo SG", "Thi công lắp đặt",  "Hoàn thiện sàn",                 "A. Nam",   dDaysAheadIso(20), 10, 10, ref),
  ];

  const byProject = new Map<string, ItemRow[]>();
  for (const it of items) {
    const arr = byProject.get(it.projectCode) ?? [];
    arr.push(it);
    byProject.set(it.projectCode, arr);
  }
  const projects: ProjectRow[] = Array.from(byProject.entries()).map(([code, its]) => ({
    code,
    name: its[0].projectName,
    cdt: its[0].cdt,
    maCT: its[0].maCT,
    start: its[0].start,
    deadline: its[0].projectDeadline,
    pm: its[0].owner || its[0].cdt || "—",
    dpm: "",
    items: its,
    allItems: its,
  }));

  return {
    refDate: ref,
    updatedAt: ref,
    projects,
    items,
    source: "upload",
    sourceLabel: "demo-dataset",
    fetchedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  };
}
