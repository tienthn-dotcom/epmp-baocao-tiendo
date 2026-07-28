/**
 * NGUỒN LỌC DUY NHẤT — dùng chung cho bảng app, Excel và PDF.
 *
 * Khái niệm:
 *  • "Công đoạn BỊ CẢNH BÁO" (alerted): theo NGƯỠNG NGƯỜI DÙNG đang đặt.
 *      lệch = clamp(%dự kiến,0,100) − clamp(%thực tế,0,100) > gapThreshold
 *      HOẶC overdueDays > overdueThreshold.
 *      (Cảnh báo ≠ ô tô màu. Màu chỉ là thang đậm-nhạt theo lệch>0.)
 *
 *  • Dự án ĐỦ ĐIỀU KIỆN khi có ÍT NHẤT MỘT công đoạn thỏa ĐỒNG THỜI:
 *      (a) ∈ giai đoạn đang lọc (nếu có lọc),
 *      (b) đang bị cảnh báo (theo ngưỡng người dùng),
 *      (c) loại cảnh báo ∈ nhóm đang lọc (nếu có lọc),
 *      (d) dự án thỏa lọc Deadline & tìm kiếm & bộ phận.
 */

import type { ItemRow } from "./types";

export type FilterThresholds = {
  gapThreshold: number;
  overdueThreshold: number;
  /** Hôm nay (ISO yyyy-mm-dd) — cần để biết dự án còn bao nhiêu ngày tới mốc bàn giao.
   *  Thiếu (nguồn cũ) → coi như mọi dự án còn xa hạn, tức về đúng ma trận trước 17/07. */
  today?: string;
};
export type AlertKind = "late" | "trim" | "focus" | "none";
/** MÀU = mức nghiêm trọng, KHÔNG dính chết vào nhãn. Cùng một nhãn "Cần tập trung"
 *  có thể vàng (dự án còn xa hạn) hoặc đỏ (dự án sắp bàn giao). */
export type AlertColor = "red" | "amber" | null;
export type AlertVerdict = { kind: AlertKind; color: AlertColor };

/** Quá hạn ≥ N ngày → bậc A. */
export const OD_ALERT_DAYS = 14;
/** Biên dưới của dải "CẦN TẬP TRUNG": lệch từ N điểm tới dưới gapThreshold. */
export const FOCUS_GAP_MIN = 20;
/** Dự án còn ≤ N ngày tới mốc bàn giao → siết cảnh báo một nấc. */
export const NEAR_DEADLINE_DAYS = 30;
/** Dự án còn ≤ N ngày tới mốc bàn giao → siết cảnh báo nấc mạnh nhất. */
export const IMMINENT_DEADLINE_DAYS = 14;

export type StageMatcher = {
  /** ID giai đoạn của công đoạn (vd "TK","VT",…). */
  stageId: (it: ItemRow) => string;
  /** Bộ phận của công đoạn (vd "PM","SCM",…). */
  deptOf: (it: ItemRow) => string;
  /** % dự kiến đã được kẹp [0,100]. */
  computePlanPct: (it: ItemRow) => number | null;
};

export type FilterCriteria = {
  /** ID giai đoạn được chọn. Mảng rỗng = không lọc. */
  stages?: string[];
  /** Bộ phận được chọn. Rỗng = không lọc. */
  depts?: string[];
  /** Nhóm cảnh báo: 'late' và/hoặc 'trim'. Rỗng = không lọc. */
  alerts?: Array<Exclude<AlertKind, "none">>;
  /** Key tháng YYYY-MM hoặc ngày YYYY-MM-DD; "none" = không có deadline. Rỗng = không lọc. */
  deadlineMonths?: string[];
  /** Từ khoá tìm kiếm (đã trim, lowercase). */
  query?: string;
  /** Hàm sinh chuỗi tìm cho item (mặc định: name + maCT + desc + owner). */
  searchHaystack?: (it: ItemRow) => string;
};

/** Kẹp [0,100]. */
export function clampPct01(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, v));
}

/** Phân loại cảnh báo MỘT công đoạn theo NGƯỠNG NGƯỜI DÙNG.
 *  Luật (chốt 10/07/2026, xét theo THỨ TỰ ƯU TIÊN — mỗi task tối đa 1 nhãn):
 *    1. CẦN CẮT      : lệch < 20 điểm VÀ quá hạn ≥ 14 ngày           — VÀNG
 *    2. TRỄ TIẾN ĐỘ  : lệch ≥ 40 điểm HOẶC quá hạn ≥ 14 ngày          — ĐỎ
 *    3. CẦN TẬP TRUNG: 20 ≤ lệch < 40 điểm VÀ có quá hạn (>0 ngày)    — VÀNG (nút riêng)
 *  CẦN CẮT xét TRƯỚC TRỄ: task quá hạn ≥14 ngày nhưng lệch < 20 (gần
 *  xong) → "cần cắt đầu việc" thay vì "trễ tiến độ".
 */
/* ────────────────────────────────────────────────────────────────
 * MA TRẬN CẢNH BÁO — NGUỒN SỰ THẬT DUY NHẤT (PMO chốt 17/07/2026).
 * Cả bảng trên app (routes/index.tsx) lẫn Xuất Excel/đối chiếu (getFilteredProjects)
 * đều PHẢI gọi hàm này. Trước đây mỗi nơi giữ một bản sao của luật → sửa một nơi là
 * hai nơi đá nhau (bảng một đằng, Excel một nẻo).
 *
 * BA chiều:
 *  1) % LỆCH (%dự kiến − %thực tế)   2) QUÁ HẠN của đầu việc   3) ĐỘ GẦN MỐC BÀN GIAO DỰ ÁN
 *     1 = lệch ≥ 40                     A = quá hạn ≥ 14           far = còn > 30 ngày
 *     2 = 20 ≤ lệch < 40                B = quá hạn 1..13          d30 = còn ≤ 30 ngày
 *     3 = lệch < 20                     C = không quá hạn (0)      d14 = còn ≤ 14 ngày
 *
 * Chiều 3 là điểm MỚI: cùng một tình trạng đầu việc, dự án càng sát ngày bàn giao thì
 * cảnh báo càng bị siết. MÀU tách rời NHÃN — "Cần tập trung" có thể vàng hoặc đỏ.
 *
 *   far (>30 ngày)          d30 (≤30 ngày)          d14 (≤14 ngày)
 *   1A trễ      · đỏ        1A trễ      · đỏ        1A trễ      · đỏ
 *   1B trễ      · đỏ        1B trễ      · đỏ        1B trễ      · đỏ
 *   1C tập trung· vàng      1C trễ      · đỏ        1C trễ      · đỏ
 *   2A trễ      · đỏ        2A trễ      · đỏ        2A trễ      · đỏ
 *   2B tập trung· vàng      2B tập trung· vàng      2B trễ      · đỏ
 *   2C —                    2C tập trung· vàng      2C tập trung· đỏ
 *   3A cần cắt  · vàng      3A cần cắt  · đỏ        3A cần cắt  · đỏ
 *   3B tập trung· vàng      3B tập trung· vàng      3B tập trung· đỏ
 *   3C —                    3C —                    3C tập trung· vàng
 * ──────────────────────────────────────────────────────────────── */
export type DeadlineBucket = "far" | "d30" | "d14";

const N: AlertVerdict = { kind: "none", color: null };
const R = (kind: AlertKind): AlertVerdict => ({ kind, color: "red" });
const A = (kind: AlertKind): AlertVerdict => ({ kind, color: "amber" });

const ALERT_MATRIX: Record<DeadlineBucket, Record<string, AlertVerdict>> = {
  far: {
    "1A": R("late"), "1B": R("late"),  "1C": A("focus"),
    "2A": R("late"), "2B": A("focus"), "2C": N,
    "3A": A("trim"), "3B": A("focus"), "3C": N,
  },
  d30: {
    "1A": R("late"), "1B": R("late"),  "1C": R("late"),
    "2A": R("late"), "2B": A("focus"), "2C": A("focus"),
    "3A": R("trim"), "3B": A("focus"), "3C": N,
  },
  d14: {
    "1A": R("late"), "1B": R("late"),  "1C": R("late"),
    "2A": R("late"), "2B": R("late"),  "2C": R("focus"),
    "3A": R("trim"), "3B": R("focus"), "3C": A("focus"),
  },
};

/** Bậc % lệch: 1 = ≥ngưỡng trễ · 2 = dải tập trung · 3 = dưới dải. */
export function gapLevel(gap: number | null, gapThreshold: number): 1 | 2 | 3 {
  const g = gap ?? 0;
  return g >= gapThreshold ? 1 : g >= FOCUS_GAP_MIN ? 2 : 3;
}
/** Bậc quá hạn: A = ≥14 · B = 1..13 · C = 0. */
export function overdueLevel(overdue: number): "A" | "B" | "C" {
  return overdue >= OD_ALERT_DAYS ? "A" : overdue > 0 ? "B" : "C";
}

/** Số ngày từ hôm nay tới mốc bàn giao dự án (âm = ĐÃ quá mốc). */
function daysUntil(iso: string, today: string): number {
  const a = new Date(iso.slice(0, 10) + "T00:00:00Z").getTime();
  const b = new Date(today.slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((a - b) / 86400000);
}

/** Xếp dự án vào bậc theo ĐỘ GẦN mốc bàn giao.
 *  Không có mốc / không biết hôm nay → "far": không có cơ sở để siết, và siết nhầm
 *  thì cả loạt đầu việc bị đôn lên đỏ oan. Chọn phía an toàn.
 *  Dự án ĐÃ quá mốc → số ngày âm → rơi "d14" (gắt nhất), đúng tinh thần. */
export function deadlineBucketOf(projectDeadline: string | null | undefined, today: string | undefined): DeadlineBucket {
  if (!projectDeadline || !today) return "far";
  const d = daysUntil(projectDeadline, today);
  if (d <= IMMINENT_DEADLINE_DAYS) return "d14";
  if (d <= NEAR_DEADLINE_DAYS) return "d30";
  return "far";
}

/** Tra ma trận. `gap = null` (thiếu ngày hoặc chưa có %thực tế) → rơi bậc 3, nhưng
 *  bậc 3 hàm ý "gần xong" mà ta KHÔNG biết điều đó → không được gán "Cần cắt";
 *  khi đó chỉ còn tiêu chí quá hạn: ≥14 ngày ⇒ Trễ tiến độ. */
export function classifyByMatrix(
  gap: number | null,
  overdue: number,
  gapThreshold: number,
  bucket: DeadlineBucket = "far",
): AlertVerdict {
  const v = ALERT_MATRIX[bucket][`${gapLevel(gap, gapThreshold)}${overdueLevel(overdue)}`];
  if (gap == null && v.kind === "trim") return { kind: "late", color: "red" };
  return v;
}

export function classifyStageAlert(
  it: ItemRow,
  planPct: number | null,
  thresholds: FilterThresholds,
): { kind: AlertKind; color: AlertColor; gap: number | null; overdue: number; reason: string } {
  const plan = clampPct01(planPct);
  const act = clampPct01(it.pctActual);
  const gap = plan != null && act != null ? plan - act : null;
  const overdue = it.overdueDays ?? 0;
  const bucket = deadlineBucketOf(it.projectDeadline, thresholds.today);
  const { kind, color } = classifyByMatrix(gap, overdue, thresholds.gapThreshold, bucket);
  if (kind === "none") return { kind, color, gap, overdue, reason: "" };
  const parts: string[] = [];
  if (gap != null) parts.push(`lệch ${Math.round(gap)}`);
  if (overdue > 0) parts.push(`quá hạn ${overdue} ngày`);
  return { kind, color, gap, overdue, reason: parts.join(" · ") };
}

function monthKey(iso: string | null): string | null {
  return iso ? iso.slice(0, 7) : null;
}

/** Kiểm tra một item có thoả các bộ lọc NGOÀI (a)/(b)/(c) — tức (d) chung
 *  (dept, deadline dự án, tìm kiếm). */
function passesContextFilters(
  it: ItemRow,
  m: StageMatcher,
  f: FilterCriteria,
): boolean {
  if (f.depts && f.depts.length) {
    if (!f.depts.includes(m.deptOf(it))) return false;
  }
  if (f.deadlineMonths && f.deadlineMonths.length) {
    const mk = monthKey(it.projectDeadline);
    const dk = it.projectDeadline ? it.projectDeadline.slice(0, 10) : null;
    const set = f.deadlineMonths;
    const matched =
      (mk && set.includes(mk)) ||
      (dk && set.includes(dk)) ||
      (!it.projectDeadline && set.includes("none"));
    if (!matched) return false;
  }
  if (f.query && f.query.length) {
    const hay = (f.searchHaystack?.(it) ??
      `${it.projectName} ${it.maCT} ${it.desc} ${it.owner}`).toLowerCase();
    if (!hay.includes(f.query)) return false;
  }
  return true;
}

export type QualifyingItem = {
  item: ItemRow;
  kind: Exclude<AlertKind, "none">;
  reason: string;
};

/** Một item "QUALIFY" khi thỏa cả (a)+(b)+(c)+(d) — chính là tiêu chí để
 *  ĐƯA DỰ ÁN VÀO kết quả. Trả null nếu không qualify. */
export function qualifyItem(
  it: ItemRow,
  m: StageMatcher,
  f: FilterCriteria,
  thresholds: FilterThresholds,
): QualifyingItem | null {
  // (d) bộ lọc chung
  if (!passesContextFilters(it, m, f)) return null;
  // (a) giai đoạn
  if (f.stages && f.stages.length) {
    if (!f.stages.includes(m.stageId(it))) return null;
  }
  // (b) bị cảnh báo theo ngưỡng người dùng
  const cls = classifyStageAlert(it, m.computePlanPct(it), thresholds);
  if (cls.kind === "none") return null;
  // (c) nhóm cảnh báo
  if (f.alerts && f.alerts.length && !f.alerts.includes(cls.kind)) return null;
  return { item: it, kind: cls.kind, reason: cls.reason };
}

/** Khóa nhận diện dự án — mã + tên. Một mã có thể có nhiều tên (CT25-070 = Lobby
 *  và Nhà hàng Maxine). Chỉ dùng mã sẽ kéo nhầm. */
export const projectKeyOf = (code: string, name: string) =>
  `${code}\u0000${name}`;

export type EligibleProject = {
  code: string;
  name: string;
  key: string;
  /** Các công đoạn của dự án đã thoả (a)+(b)+(c)+(d). */
  qualifying: QualifyingItem[];
};

export type FilterResult = {
  /** Các item đã thoả ALL điều kiện — dùng cho bảng + PDF. */
  items: QualifyingItem[];
  /** Các dự án đủ điều kiện, kèm bằng chứng (qualifying items). */
  projects: EligibleProject[];
  /** Set khoá (code+name) cho việc đối chiếu nhanh. */
  projectKeys: Set<string>;
};

/** HÀM LỌC TRUNG TÂM — bảng/Excel/PDF đều phải gọi qua đây. */
export function getFilteredProjects(
  allItems: ItemRow[],
  matcher: StageMatcher,
  criteria: FilterCriteria,
  thresholds: FilterThresholds,
): FilterResult {
  const items: QualifyingItem[] = [];
  const byKey = new Map<string, EligibleProject>();
  for (const it of allItems) {
    const q = qualifyItem(it, matcher, criteria, thresholds);
    if (!q) continue;
    items.push(q);
    const key = projectKeyOf(it.projectCode, it.projectName);
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { code: it.projectCode, name: it.projectName, key, qualifying: [] };
      byKey.set(key, bucket);
    }
    bucket.qualifying.push(q);
  }
  return {
    items,
    projects: [...byKey.values()],
    projectKeys: new Set(byKey.keys()),
  };
}

/* ────────────────────────── TỰ KIỂM CHỨNG ────────────────────────── */

export type AuditResult = {
  ok: boolean;
  totalProjects: number;
  /** Dự án nằm trong kết quả nhưng không tìm được công đoạn lý do (LỖI). */
  unjustified: string[];
  /** Dự án KHÔNG nằm trong kết quả nhưng thực ra có công đoạn thỏa (LỖI bỏ sót). */
  missed: string[];
  message: string;
};

/** Đối chiếu kết quả của getFilteredProjects với toàn bộ allItems. */
export function auditFilterResult(
  allItems: ItemRow[],
  matcher: StageMatcher,
  criteria: FilterCriteria,
  thresholds: FilterThresholds,
  result: FilterResult,
): AuditResult {
  const unjustified: string[] = [];
  // 1) Mỗi dự án trong kết quả phải có >=1 qualifying item.
  for (const p of result.projects) {
    const hasJustification = p.qualifying.length > 0 &&
      p.qualifying.every(q =>
        qualifyItem(q.item, matcher, criteria, thresholds) !== null);
    if (!hasJustification) unjustified.push(`${p.code} · ${p.name}`);
  }
  // 2) Mọi dự án KHÔNG nằm trong kết quả phải thực sự không có item qualify.
  const allKeys = new Set<string>();
  const allByKey = new Map<string, { code: string; name: string; items: ItemRow[] }>();
  for (const it of allItems) {
    const k = projectKeyOf(it.projectCode, it.projectName);
    allKeys.add(k);
    let b = allByKey.get(k);
    if (!b) {
      b = { code: it.projectCode, name: it.projectName, items: [] };
      allByKey.set(k, b);
    }
    b.items.push(it);
  }
  const missed: string[] = [];
  for (const k of allKeys) {
    if (result.projectKeys.has(k)) continue;
    const b = allByKey.get(k)!;
    const offending = b.items.find(it => qualifyItem(it, matcher, criteria, thresholds) !== null);
    if (offending) missed.push(`${b.code} · ${b.name}`);
  }
  const ok = unjustified.length === 0 && missed.length === 0;
  const message = ok
    ? `Đã lọc: ${result.projects.length} dự án · kiểm tra điều kiện: ĐẠT`
    : `CẢNH BÁO: ${unjustified.length + missed.length} dự án không khớp điều kiện`;
  return {
    ok,
    totalProjects: result.projects.length,
    unjustified,
    missed,
    message,
  };
}
