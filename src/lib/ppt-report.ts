/* ═══════════════════════════════════════════════════════════════════════════
 *  XUẤT BÁO CÁO ĐIỀU HÀNH (.pptx) THEO TỪNG DỰ ÁN
 *
 *  Triết lý (theo brief PMO/Executive): KHÔNG đổ toàn bộ dữ liệu — chuyển dữ
 *  liệu dự án thành DECISION-SUPPORT DECK để Ban lãnh đạo hiểu trong 3–5 phút:
 *  dự án khoẻ hay có vấn đề, lệch ở đâu, ai xử lý, khi nào, cần lưu ý gì.
 *    Signal > Noise · Insight > Raw · Exception > Normal · Decision > Description
 *
 *  RÀNG BUỘC KỸ THUẬT: chạy 100% CLIENT-SIDE. pptxgenjs được dynamic-import
 *  bên trong hàm nên module này KHÔNG lọt vào bundle SSR / Cloudflare Worker.
 *  Chữ = text box PPT (chỉnh sửa được); số liệu/khối = shape PPT (nét); ảnh dự
 *  án (đã là dataURL) = addImage. Không rasterize, không gọi server.
 *
 *  KỶ LUẬT DỮ LIỆU: mọi nhận định phải suy ra từ dữ liệu có sẵn theo NGƯỠNG rõ
 *  ràng (HEALTH_RULES). KHÔNG bịa nguyên nhân/tác động/PIC/deadline/tài chính.
 * ═══════════════════════════════════════════════════════════════════════════ */
import type { ItemRow } from "@/lib/types";
import type { ChatMsg } from "@/lib/edits.functions";
import { AA_LOGO_DATA_URI } from "@/lib/aa-logo";

const LOGO_RATIO = 543 / 495; // tỷ lệ w/h logo AA (để đặt không méo)

/* Type-only dynamic import — bị xoá lúc build, an toàn SSR/Worker. */
type Pptx = InstanceType<typeof import("pptxgenjs").default>;
type Slide = ReturnType<Pptx["addSlide"]>;
type TableRows = Parameters<Slide["addTable"]>[0];

/* ── Ngưỡng đánh giá Project Health (đề xuất — chỉnh 1 chỗ) ──────────────── */
export const HEALTH_RULES = {
  critical: { variance: -15, overdue: 6 }, // variance≤-15 HOẶC ≥6 việc trễ HOẶC (có tc2 & quá hạn dự án)
  atRisk: { variance: -8, overdue: 3 }, //   variance≤-8 HOẶC ≥3 trễ HOẶC có tc2 HOẶC issue thiếu PIC/action
  watch: { variance: -3, overdue: 1 }, //    variance≤-3 HOẶC ≥1 trễ HOẶC còn issue mở
} as const;

export type PptItemEdit = {
  it: ItemRow;
  noteMsgs?: ChatMsg[];
  actionMsgs?: ChatMsg[];
  pic?: string;
  deadline?: string;
};

export type PptReportInput = {
  name: string;
  code: string;
  cdt?: string;
  pm?: string;
  start?: string | null;
  deadline?: string | null;
  /** allItems của dự án (đã lọc shown !== false ở phía gọi). */
  items: ItemRow[];
  /** Vướng mắc / hướng xử lý cấp DỰ ÁN. */
  projNoteMsgs?: ChatMsg[];
  projActionMsgs?: ChatMsg[];
  /** Vướng mắc / hướng xử lý cấp CÔNG ĐOẠN (theo từng item). */
  itemEdits?: PptItemEdit[];
  /** Ảnh hiện trường: dataURL base64. */
  images?: { data: string; at?: string; by?: string }[];
  /** Điểm tuân thủ (nếu có, đã tính từ buildComplianceReport). */
  compliance?: number | null;
};

/* ── Palette điều hành (hex không có #) ─────────────────────────────────── */
const C = {
  navy: "0F2742",
  ink: "334155",
  mute: "64748B",
  faint: "94A3B8",
  line: "E2E8F0",
  light: "F8FAFC",
  panel: "F8FAFC",
  gold: "D6A32D",
  red: "DC3A2E",
  redBg: "FDECEC",
  redInk: "B42318",
  amber: "D99A00",
  amberBg: "FFF6DF",
  amberInk: "8A6300",
  green: "159A6C",
  greenBg: "E6F5EF",
  // MÀU CHỮ KÝ (đồng bộ thanh Gantt trong app + bản PDF): nền NAVY + phần XANH LÁ = % hoàn thành.
  ganttBar: "334964",
  ganttDone: "5EE9B5",
  orange: "DD6B20",
  orangeBg: "FBE7D8",
  orangeInk: "9A4A0E",
  white: "FFFFFF",
  aaRed: "8A1A0D",     // thanh dọc thương hiệu AA + header bảng ePMP (theo deck PMO sếp duyệt)
  grpOrange: "E8811C", // nền hàng gộp dự án (cam) trong bảng chi tiết
  pctRisk: "F8CBAD",   // ô % rủi ro (hồng) như file gốc
};
const FONT = "Aptos";

export type Health = "HEALTHY" | "WATCH" | "AT RISK" | "CRITICAL";
// Thang màu theo mức độ tăng dần: ổn định (xanh) → theo dõi (vàng) → rủi ro (cam) → nghiêm trọng (đỏ).
// ĐỎ chỉ dành cho mức NẶNG NHẤT.
export const HEALTH_COLOR: Record<Health, { dot: string; ink: string; bg: string }> = {
  HEALTHY: { dot: C.green, ink: C.green, bg: C.greenBg },
  WATCH: { dot: C.amber, ink: C.amberInk, bg: C.amberBg },
  "AT RISK": { dot: C.orange, ink: C.orangeInk, bg: C.orangeBg },
  CRITICAL: { dot: C.red, ink: C.redInk, bg: C.redBg },
};
// Nhãn hiển thị tiếng Việt (badge in HOA); cụm dùng trong câu (thường).
export const HEALTH_LABEL: Record<Health, string> = {
  HEALTHY: "ỔN ĐỊNH",
  WATCH: "CẦN THEO DÕI",
  "AT RISK": "CÓ RỦI RO",
  CRITICAL: "NGHIÊM TRỌNG",
};
export const HEALTH_PHRASE: Record<Health, string> = {
  HEALTHY: "đúng tiến độ",
  WATCH: "cần theo dõi",
  "AT RISK": "có rủi ro",
  CRITICAL: "ở mức nghiêm trọng",
};
/** Trạng thái hạn xử lý: khoá nội bộ + nhãn tiếng Việt. */
export function statusOf(iso?: string): { key: "over" | "soon" | "ontrack" | "none"; label: string } {
  const dd = daysFromNow(iso);
  if (dd == null) return { key: "none", label: "—" };
  if (dd < 0) return { key: "over", label: "Quá hạn" };
  if (dd <= 7) return { key: "soon", label: "Sắp đến hạn" };
  return { key: "ontrack", label: "Trong hạn" };
}

/* ── Helpers thuần ──────────────────────────────────────────────────────── */
const numOf = (v: number | null | undefined): number | null =>
  typeof v === "number" && isFinite(v) ? v : null;
const avg = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const clampPct = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function daysFromNow(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.round((t - Date.now()) / 86400000);
}
/** Text mới nhất còn hiển thị của một "box chat" (bỏ tin đã ẩn). */
function latestText(msgs?: ChatMsg[]): string {
  const v = (msgs ?? []).filter((m) => !m.hidden && (m.text ?? "").trim());
  return v.length ? v[v.length - 1].text.trim() : "";
}
function sanitize(s: string): string {
  return (s || "duan").replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "_").slice(0, 60);
}
/** PIC hợp lệ: có chữ/số. Rác kiểu "`" hay dấu câu đơn → coi như trống. */
function cleanName(s?: string): string {
  const t = (s || "").trim();
  return /[\p{L}\p{N}]/u.test(t) && t.length >= 2 ? t : "";
}
/** Chuẩn hoá text để so trùng vướng mắc (bỏ hoa/thường, gộp khoảng trắng, bỏ dấu câu đuôi). */
function normText(s: string): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").replace(/[.,;:·`'"]+$/g, "").trim();
}
/** CÔ ĐỌNG cho slide: lấy trọn các CÂU/gạch đầu đầu tiên vừa trong giới hạn (không cắt cụt giữa
 *  câu), thêm "…" nếu còn nội dung phía sau. Chi tiết đầy đủ vẫn xem trong app. */
function clip(s: string, n: number): string {
  const t = (s || "").trim().replace(/\s+/g, " ");
  if (t.length <= n) return t;
  const parts = t.match(/[^.;!?\n]+[.;!?]*/g) ?? [t]; // tách theo câu, GIỮ dấu câu
  let out = "";
  for (const p of parts) {
    const seg = p.trim();
    if (!seg) continue;
    if (!out) out = seg;
    else if ((out + " " + seg).length <= n) out += " " + seg;
    else break;
  }
  if (out.length > n) out = out.slice(0, n - 1).replace(/\s+\S*$/, ""); // câu đầu vẫn dài → cắt từ
  return out.replace(/[\s.;,]+$/, "") + "…";
}

/* ── Phân tích dữ liệu → mô hình báo cáo ────────────────────────────────── */
export type Metrics = ReturnType<typeof analyze>;
export function analyze(input: PptReportInput) {
  const shown = input.items.filter((i) => i.shown !== false);
  const acts = shown.map((i) => numOf(i.pctActual)).filter((v): v is number => v != null);
  const plans = shown.map((i) => numOf(i.pctPlan)).filter((v): v is number => v != null);
  const actualPct = clampPct(avg(acts));
  const planPct = clampPct(avg(plans));
  // Plan chỉ đáng tin khi ≥ nửa số giai đoạn có Plan > 0 — nếu không, KHÔNG dùng variance
  // (nhiều dự án để trống % kế hoạch → variance = actual − 0 sẽ hiểu SAI thành "vượt KH").
  const hasPlan = plans.filter((v) => v > 0).length >= Math.ceil(shown.length * 0.5) && planPct > 0;
  const variance: number | null = hasPlan ? actualPct - planPct : null;
  const total = shown.length;
  const done = shown.filter((i) => (numOf(i.pctActual) ?? 0) >= 100).length;
  const overdue = shown.filter((i) => (i.overdueDays ?? 0) > 0 && (numOf(i.pctActual) ?? 0) < 100).length;
  const critical = shown.filter((i) => i.tc2).length;
  const daysLeft = daysFromNow(input.deadline);

  // Breakdown theo giai đoạn (giữ thứ tự xuất hiện) — phục vụ "delay concentration".
  const byStage = new Map<string, { act: number[]; plan: number[] }>();
  for (const it of shown) {
    const s = String(it.stage || "Khác");
    const b = byStage.get(s) ?? { act: [], plan: [] };
    const a = numOf(it.pctActual);
    const p = numOf(it.pctPlan);
    if (a != null) b.act.push(a);
    if (p != null) b.plan.push(p);
    byStage.set(s, b);
  }
  const stages = [...byStage].map(([stage, b]) => {
    const a = clampPct(avg(b.act));
    const p = clampPct(avg(b.plan));
    return { stage, act: a, plan: p, variance: a - p };
  });
  // Điểm nghẽn: có Plan → giai đoạn lệch nhất (variance ≤ −5); KHÔNG có Plan → giai đoạn
  // % thực tế thấp nhất mà chưa xong (đại diện phần cần đẩy).
  const worst = hasPlan
    ? stages.filter((s) => s.variance <= -5).sort((a, b) => a.variance - b.variance)[0] ?? null
    : stages.filter((s) => s.act < 90).sort((a, b) => a.act - b.act)[0] ?? null;
  // Hạ nguồn: giai đoạn ĐỨNG SAU bottleneck (theo thứ tự dây chuyền) mà % còn thấp → phơi nhiễm.
  let downstream: (typeof stages)[number] | null = null;
  if (worst) {
    const wi = stages.findIndex((s) => s.stage === worst.stage);
    downstream = stages.slice(wi + 1).filter((s) => s.act < 90).sort((a, b) => a.act - b.act)[0] ?? null;
  }

  // Issues: gộp cấp dự án + cấp công đoạn; GỘP TRÙNG theo nội dung (lưu các giai đoạn ảnh hưởng).
  type Issue = {
    prio: 1 | 2 | 3;
    stages: string[]; // các giai đoạn cùng chung nội dung này ("" = cấp dự án)
    text: string;
    action: string;
    pic: string;
    deadline: string;
    overdue: number;
    tc2: boolean;
  };
  const raw: Issue[] = [];
  const projNote = latestText(input.projNoteMsgs);
  if (projNote) {
    const action = latestText(input.projActionMsgs);
    raw.push({
      prio: action ? 2 : 1, stages: [], text: projNote, action,
      pic: cleanName(input.pm), deadline: "", overdue: 0, tc2: false,
    });
  }
  for (const e of input.itemEdits ?? []) {
    const text = latestText(e.noteMsgs);
    if (!text) continue;
    const action = latestText(e.actionMsgs);
    const pic = cleanName(e.pic || e.it.owner);
    const dl = e.deadline || e.it.deadline || "";
    const od = e.it.overdueDays ?? 0;
    const tc2 = !!e.it.tc2;
    const dlOverdue = (daysFromNow(dl) ?? 99) < 0;
    let prio: 1 | 2 | 3 = 3;
    if (tc2 || (od > 0 && !action) || dlOverdue) prio = 1;
    else if (od > 0 || !pic || !action) prio = 2;
    raw.push({ prio, stages: [String(e.it.stage || "Công đoạn")], text, action, pic, deadline: dl, overdue: od, tc2 });
  }
  // GỘP TRÙNG: cùng nội dung → 1 dòng, GOM các giai đoạn ảnh hưởng; giữ bản NẶNG nhất.
  const byText = new Map<string, Issue>();
  const earlier = (a: string, b: string) => (daysFromNow(a) ?? 1e9) < (daysFromNow(b) ?? 1e9);
  for (const is of raw) {
    const k = normText(is.text);
    const prev = byText.get(k);
    if (!prev) { byText.set(k, { ...is, stages: [...is.stages] }); continue; }
    const better =
      is.prio < prev.prio ||
      (is.prio === prev.prio && is.overdue > prev.overdue) ||
      (is.prio === prev.prio && is.overdue === prev.overdue && !!is.deadline && earlier(is.deadline, prev.deadline));
    const keep = better ? { ...is } : { ...prev };
    keep.pic = keep.pic || prev.pic || is.pic;
    keep.action = keep.action || prev.action || is.action;
    keep.tc2 = prev.tc2 || is.tc2;
    keep.overdue = Math.max(prev.overdue, is.overdue);
    keep.stages = Array.from(new Set([...prev.stages, ...is.stages]));
    byText.set(k, keep);
  }
  const issues = [...byText.values()].sort((a, b) => a.prio - b.prio || b.overdue - a.overdue);
  const openIssues = issues.length;
  const missingPic = issues.filter((i) => !i.pic).length;
  const overdueAction = issues.filter((i) => i.action && (daysFromNow(i.deadline) ?? 99) < 0).length;
  // Số công đoạn đang "báo đỏ" (trễ hạn hoặc trễ nặng) — nhiều → dùng BẢNG, không dùng thẻ 1 dòng.
  const redStageCount = shown.filter((i) => (i.overdueDays ?? 0) > 0 || i.tc2).length;

  // ── HÀNH ĐỘNG CẦN THEO DÕI — quét TẤT CẢ công đoạn chưa xong đang cần chú ý (trễ / trễ nặng /
  //    có hướng xử lý / có vướng mắc), KHÔNG chỉ vướng mắc cấp dự án. Việc chưa có hướng xử lý ghi
  //    sẵn thì nêu việc phải hoàn thành (mô tả theo dữ liệu, không bịa nội dung mới). ──
  type Action = { text: string; pic: string; deadline: string; overdue: number; tc2: boolean; sev: number };
  const rawActs: Action[] = [];
  if (projNote) {
    const a = latestText(input.projActionMsgs);
    rawActs.push({ text: a || projNote, pic: cleanName(input.pm), deadline: "", overdue: 0, tc2: false, sev: 1 });
  }
  // Quét THẲNG toàn bộ công đoạn (shown), tra ghi chú/hướng xử lý theo từng item nếu có.
  const editByItem = new Map((input.itemEdits ?? []).map((e) => [e.it, e]));
  for (const it of shown) {
    if ((numOf(it.pctActual) ?? 0) >= 100) continue; // đã xong → không cần theo dõi
    const e = editByItem.get(it);
    const action = latestText(e?.actionMsgs);
    const note = latestText(e?.noteMsgs);
    const od = it.overdueDays ?? 0;
    const overdue = od > 0;
    const tc2 = !!it.tc2;
    if (!(overdue || tc2 || action || note)) continue; // công đoạn bình thường → bỏ qua
    const stage = String(it.stage || "Công đoạn");
    const pctNow = clampPct(numOf(it.pctActual) ?? 0);
    // Câu tự sinh (khi công đoạn chưa có ghi chú/hướng xử lý): nêu VIỆC cần làm, đọc như lời điều hành.
    const auto = tc2
      ? `Xử lý dứt điểm vướng mắc nghiêm trọng ở giai đoạn ${stage} (đang ${pctNow}%)`
      : overdue
      ? `Bù tiến độ giai đoạn ${stage} đang trễ hạn (mới đạt ${pctNow}%)`
      : `Dồn lực hoàn tất giai đoạn ${stage} (đang ${pctNow}%)`;
    const text = action || note || auto;
    rawActs.push({ text, pic: cleanName(e?.pic || it.owner), deadline: e?.deadline || it.deadline || "", overdue: od, tc2, sev: (tc2 ? 2 : 0) + (overdue ? 1 : 0) });
  }
  // Gộp trùng nội dung, giữ bản nặng nhất; xếp: nặng/trễ trước, rồi hạn sớm hơn.
  const actMap = new Map<string, Action>();
  for (const a of rawActs) {
    const k = normText(a.text);
    const prev = actMap.get(k);
    if (!prev) { actMap.set(k, { ...a }); continue; }
    const keep = a.sev > prev.sev || (a.sev === prev.sev && earlier(a.deadline, prev.deadline)) ? { ...a } : { ...prev };
    keep.pic = keep.pic || prev.pic || a.pic;
    keep.overdue = Math.max(prev.overdue, a.overdue);
    keep.tc2 = prev.tc2 || a.tc2;
    keep.sev = Math.max(prev.sev, a.sev);
    actMap.set(k, keep);
  }
  const actions = [...actMap.values()].sort(
    (a, b) => b.sev - a.sev || (daysFromNow(a.deadline) ?? 1e9) - (daysFromNow(b.deadline) ?? 1e9),
  );

  // HEALTH — đa chiều, lấy mức xấu nhất chạm tới. Chỉ dùng variance khi CÓ Plan đáng tin.
  const R = HEALTH_RULES;
  const vBad = (thr: number) => variance != null && variance <= thr;
  let health: Health = "HEALTHY";
  if (vBad(R.watch.variance) || overdue >= R.watch.overdue || openIssues > 0) health = "WATCH";
  if (
    vBad(R.atRisk.variance) || overdue >= R.atRisk.overdue || critical > 0 ||
    issues.some((i) => i.prio === 1 || !i.pic)
  )
    health = "AT RISK";
  if (
    vBad(R.critical.variance) || overdue >= R.critical.overdue ||
    (critical > 0 && daysLeft != null && daysLeft < 0) || overdueAction > 0
  )
    health = "CRITICAL";

  return {
    shown, actualPct, planPct, hasPlan, variance, total, done, overdue, critical, daysLeft,
    stages, worst, downstream, issues, openIssues, missingPic, overdueAction, redStageCount, actions, health,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  HÀM CHÍNH — dựng deck & tải file
 * ═══════════════════════════════════════════════════════════════════════════ */
export async function exportProjectDeck(input: PptReportInput): Promise<void> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const m = analyze(input);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pptx.defineSlideMaster({ title: "BASE", background: { color: C.white } });
  const W = 13.33;
  const MX = 0.55; // lề trái/phải
  const CW = W - MX * 2;
  const hc = HEALTH_COLOR[m.health];
  const reportDateStr = fmtDate(new Date().toISOString());

  const round = (rectRadius = 0.06) => ({ rectRadius });

  /* Header chuẩn: kicker + title (+ health badge phải). Trả về y-đáy header. */
  function header(slide: Slide, kicker: string, title: string, withHealth = false) {
    // Thanh dọc đỏ thương hiệu AA (đồng bộ deck PMO sếp duyệt) — nằm trong lề trái, không đè nội dung.
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.16, h: 7.5, fill: { color: C.aaRed } });
    // Logo AA góc phải header (slide không có badge tình trạng). Slide có badge (Tổng quan) thì badge
    // đã chiếm góc phải → bỏ logo ở đó cho khỏi chồng.
    const logoH = 0.6, logoW = logoH * LOGO_RATIO;
    const rightReserve = withHealth ? 2.6 : logoW + 0.3;
    slide.addText(kicker, { x: MX, y: 0.34, w: CW - rightReserve, h: 0.24, fontFace: FONT, fontSize: 10, color: C.mute, charSpacing: 2 });
    slide.addText(title, { x: MX, y: 0.56, w: CW - rightReserve, h: 0.5, fontFace: FONT, fontSize: 23, bold: true, color: C.navy });
    if (!withHealth) {
      slide.addImage({ data: AA_LOGO_DATA_URI, x: W - MX - logoW, y: 0.3, w: logoW, h: logoH, sizing: { type: "contain", w: logoW, h: logoH } });
    }
    if (withHealth) {
      const bw = 2.7, bx = W - MX - bw;
      slide.addShape(pptx.ShapeType.roundRect, { x: bx, y: 0.5, w: bw, h: 0.54, fill: { color: hc.bg }, line: { color: hc.dot, width: 1 }, ...round(0.07) });
      slide.addShape(pptx.ShapeType.ellipse, { x: bx + 0.2, y: 0.7, w: 0.13, h: 0.13, fill: { color: hc.dot } });
      slide.addText([
        { text: "TÌNH TRẠNG\n", options: { fontSize: 8, color: hc.ink, charSpacing: 1.5 } },
        { text: HEALTH_LABEL[m.health], options: { fontSize: 14, bold: true, color: hc.ink } },
      ], { x: bx + 0.5, y: 0.5, w: bw - 0.66, h: 0.54, fontFace: FONT, valign: "middle", lineSpacingMultiple: 1.1 });
    }
    slide.addShape(pptx.ShapeType.line, { x: MX, y: 1.12, w: CW, h: 0, line: { color: C.navy, width: 1.75 } });
    return 1.12;
  }
  function footer(slide: Slide, note: string, page: string) {
    if (note) slide.addText(note, { x: MX, y: 7.1, w: CW - 2, h: 0.24, fontFace: FONT, fontSize: 8, italic: true, color: C.faint });
    slide.addText(page, { x: W - MX - 2, y: 7.1, w: 2, h: 0.24, fontFace: FONT, fontSize: 8, color: C.faint, align: "right" });
  }

  /* ── SLIDE 1 — COVER ──────────────────────────────────────────────────── */
  {
    const s = pptx.addSlide();
    s.background = { color: C.navy };
    // Logo AA trên thẻ trắng góc phải (nền navy → chữ đen của logo mới đọc được).
    { const lgW = 1.7, lgH = lgW / LOGO_RATIO, pad = 0.2, cw2 = lgW + pad * 2, ch2 = lgH + pad * 2, cx = W - MX - cw2, cy = 0.42;
      s.addShape(pptx.ShapeType.roundRect, { x: cx, y: cy, w: cw2, h: ch2, fill: { color: C.white }, line: { color: "1E3A5F", width: 0.75 }, ...round(0.1) });
      s.addImage({ data: AA_LOGO_DATA_URI, x: cx + pad, y: cy + pad, w: lgW, h: lgH, sizing: { type: "contain", w: lgW, h: lgH } }); }
    s.addText("AA CORPORATION · BAN QUẢN LÝ DỰ ÁN", { x: MX, y: 0.5, w: CW - 2.3, h: 0.3, fontFace: FONT, fontSize: 11, color: "8FA6C4", charSpacing: 3 });
    s.addShape(pptx.ShapeType.rect, { x: MX, y: 2.55, w: 0.9, h: 0.06, fill: { color: C.gold } });
    s.addText("BÁO CÁO TIẾN ĐỘ DỰ ÁN", { x: MX, y: 2.72, w: CW, h: 0.34, fontFace: FONT, fontSize: 13, color: "8FA6C4", charSpacing: 3 });
    s.addText(input.name, { x: MX, y: 3.1, w: CW - 0.5, h: 1.1, fontFace: FONT, fontSize: 40, bold: true, color: C.white });
    const meta = [
      `Mã công trình: ${input.code || "—"}`,
      input.cdt ? `Chủ đầu tư: ${input.cdt}` : "",
      input.pm ? `Quản lý dự án: ${input.pm}` : "",
      `Kỳ báo cáo: ${reportDateStr}`,
    ].filter(Boolean).join("     ·     ");
    s.addText(meta, { x: MX, y: 4.35, w: CW, h: 0.4, fontFace: FONT, fontSize: 14, color: "B9C8DD" });
    // Health badge lớn dưới phải
    const bw = 3.3, bx = W - MX - bw;
    s.addShape(pptx.ShapeType.roundRect, { x: bx, y: 6.02, w: bw, h: 0.78, fill: { color: "10243A" }, line: { color: hc.dot, width: 1.25 }, ...round(0.08) });
    s.addShape(pptx.ShapeType.ellipse, { x: bx + 0.3, y: 6.33, w: 0.17, h: 0.17, fill: { color: hc.dot } });
    s.addText([
      { text: "TÌNH TRẠNG DỰ ÁN\n", options: { fontSize: 9, color: "9DB0C7", charSpacing: 1.5 } },
      { text: HEALTH_LABEL[m.health], options: { fontSize: 18, bold: true, color: hc.dot } },
    ], { x: bx + 0.65, y: 6.02, w: bw - 0.8, h: 0.78, fontFace: FONT, valign: "middle", lineSpacingMultiple: 1.12 });
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 7.36, w: W, h: 0.14, fill: { color: C.gold } });
  }

  let pageNo = 2; // Cover = trang 1 (không đánh số); các slide sau đánh số chạy.

  /* ── SLIDE 2 — EXECUTIVE SUMMARY ──────────────────────────────────────── */
  {
    const s = pptx.addSlide();
    // Tiêu đề dẫn bằng TÌNH TRẠNG + tín hiệu rủi ro chính (không để 67% ngầm hiểu là sức khoẻ).
    const title =
      m.health === "HEALTHY"
        ? `Đúng tiến độ — tổng thể ${m.actualPct}%`
        : `Dự án ${HEALTH_PHRASE[m.health]} — ${m.overdue} việc trễ hạn` +
          (m.critical > 0 ? `, ${m.critical} việc trễ nặng` : "") +
          (m.daysLeft != null && m.daysLeft >= 0 && m.daysLeft <= 30 ? ` · còn ${m.daysLeft} ngày bàn giao` : "");
    header(s, "TỔNG QUAN ĐIỀU HÀNH", title, true);

    // ── Dải chỉ số điều hành. Không có kế hoạch → bỏ Kế hoạch/Chênh lệch. Bàn giao = đếm ngày. ──
    const dl = m.daysLeft;
    const dlVal = dl == null ? "—" : dl < 0 ? `Quá ${Math.abs(dl)} ngày` : `${dl} ngày`;
    const dlTone: Tone = dl == null ? "neutral" : dl < 0 ? "red" : dl <= 14 ? "amber" : "neutral";
    type Tone = "red" | "amber" | "neutral";
    const kpis: { label: string; value: string; sub?: string; tone?: Tone }[] = [
      { label: "THỰC TẾ", value: `${m.actualPct}%`, sub: "Tiến độ đạt được" },
    ];
    if (m.hasPlan && m.variance != null) {
      kpis.push({ label: "KẾ HOẠCH", value: `${m.planPct}%`, sub: "Theo tiến độ" });
      kpis.push({ label: "CHÊNH LỆCH", value: (m.variance >= 0 ? "+" : "−") + Math.abs(m.variance), sub: "Điểm phần trăm", tone: m.variance < 0 ? "red" : "neutral" });
    }
    kpis.push({ label: "TRỄ HẠN", value: `${m.overdue}`, sub: "Việc quá hạn", tone: m.overdue > 0 ? "amber" : "neutral" });
    kpis.push({ label: "TRỄ NẶNG", value: `${m.critical}`, sub: "Trễ nghiêm trọng", tone: m.critical > 0 ? "red" : "neutral" });
    if (!(m.hasPlan && m.variance != null)) kpis.push({ label: "VƯỚNG MẮC", value: `${m.openIssues}`, sub: "Còn tồn đọng", tone: m.openIssues > 0 ? "amber" : "neutral" });
    kpis.push({ label: "BÀN GIAO", value: dlVal, sub: fmtDate(input.deadline), tone: dlTone });
    if (input.compliance != null) kpis.push({ label: "TUÂN THỦ", value: `${Math.round(input.compliance)}`, sub: "Điểm đánh giá" });

    const n = kpis.length;
    const gap = 0.16;
    const cw = (CW - gap * (n - 1)) / n;
    const cy = 1.34, ch = 1.28;
    kpis.forEach((k, i) => {
      const x = MX + i * (cw + gap);
      const bg = k.tone === "red" ? C.redBg : k.tone === "amber" ? C.amberBg : C.light;
      const vc = k.tone === "red" ? C.red : k.tone === "amber" ? C.amber : C.navy;
      const lc = k.tone === "red" ? C.redInk : k.tone === "amber" ? C.amberInk : C.mute;
      s.addShape(pptx.ShapeType.roundRect, { x, y: cy, w: cw, h: ch, fill: { color: bg }, line: { color: C.line, width: 0.75 }, ...round(0.07) });
      s.addText(k.label, { x: x + 0.06, y: cy + 0.12, w: cw - 0.12, h: 0.22, fontFace: FONT, fontSize: 9, bold: true, color: lc, align: "center", charSpacing: 1 });
      s.addText(k.value, { x: x + 0.06, y: cy + 0.34, w: cw - 0.12, h: 0.58, fontFace: FONT, fontSize: 28, bold: true, color: vc, align: "center", valign: "middle" });
      if (k.sub) s.addText(k.sub, { x: x + 0.06, y: cy + ch - 0.3, w: cw - 0.12, h: 0.22, fontFace: FONT, fontSize: 8.5, color: C.mute, align: "center" });
    });

    // ── Hàng dưới: 3 cột Hiện trạng → Rủi ro → Cần lưu ý (nêu vấn đề, hệ quả, việc cần làm). ──
    const top1 = m.issues[0] ?? null;
    const cards: { kicker: string; accent: string; head: string; headColor: string; body: string; meta: string }[] = [
      {
        kicker: "TIẾN ĐỘ", accent: C.navy, head: `Đạt ${m.actualPct}%`, headColor: C.navy,
        body: m.hasPlan && m.variance != null
          ? `So với kế hoạch ${m.planPct}% → chênh ${m.variance >= 0 ? "+" : "−"}${Math.abs(m.variance)} điểm phần trăm.`
          : "Nguồn chưa có phần trăm kế hoạch nên chưa so sánh được với tiến độ chuẩn."
          + (m.worst ? ` Chậm nhất: ${m.worst.stage} (${m.worst.act}%).` : ""),
        meta: `${m.done}/${m.total} công việc đã hoàn thành`,
      },
      {
        kicker: "RỦI RO", accent: C.red, head: `${m.overdue} trễ / ${m.critical} nặng`, headColor: C.red,
        body: m.overdue > 0 || m.critical > 0
          ? `Rủi ro tập trung ở nhóm việc quá hạn và trễ nặng` + (m.worst ? `, nghẽn tại ${m.worst.stage}.` : ".")
          : "Chưa có việc quá hạn đáng kể.",
        meta: m.daysLeft != null ? (m.daysLeft < 0 ? `Đã quá bàn giao ${Math.abs(m.daysLeft)} ngày` : `Còn ${m.daysLeft} ngày đến bàn giao`) : "Cần giám sát",
      },
      {
        kicker: "CẦN LƯU Ý", accent: C.amber, head: top1 ? (top1.prio === 1 ? "Ưu tiên 1 — cần xử lý" : `Ưu tiên ${top1.prio} — theo dõi`) : "Không có", headColor: top1 && top1.prio === 1 ? C.red : C.amber,
        body: top1 ? clip(top1.text, 105) + (top1.deadline ? ` (hạn ${fmtDate(top1.deadline)}${(daysFromNow(top1.deadline) ?? 9) < 0 ? " — đã quá hạn" : ""}).` : ".") : "Không có vướng mắc nào cần lưu ý.",
        meta: top1 ? `Người phụ trách: ${top1.pic || "chưa gán"}` : "",
      },
    ];
    const ay = cy + ch + 0.34;
    const ah = 7.02 - ay;
    const cgap = 0.18;
    const ccw = (CW - cgap * 2) / 3;
    cards.forEach((c, i) => {
      const x = MX + i * (ccw + cgap);
      s.addShape(pptx.ShapeType.roundRect, { x, y: ay, w: ccw, h: ah, fill: { color: C.light }, line: { color: C.line, width: 0.75 }, ...round(0.06) });
      s.addShape(pptx.ShapeType.rect, { x, y: ay, w: 0.07, h: ah, fill: { color: c.accent } });
      s.addText(c.kicker, { x: x + 0.24, y: ay + 0.2, w: ccw - 0.4, h: 0.24, fontFace: FONT, fontSize: 10, bold: true, color: C.mute, charSpacing: 1.2 });
      s.addText(c.head, { x: x + 0.24, y: ay + 0.52, w: ccw - 0.4, h: 0.5, fontFace: FONT, fontSize: 21, bold: true, color: c.headColor });
      s.addText(c.body, { x: x + 0.24, y: ay + 1.12, w: ccw - 0.44, h: ah - 1.6, fontFace: FONT, fontSize: 13, color: C.ink, valign: "top", lineSpacingMultiple: 1.05 });
      if (c.meta) s.addText(c.meta, { x: x + 0.24, y: ay + ah - 0.42, w: ccw - 0.44, h: 0.28, fontFace: FONT, fontSize: 10.5, italic: true, color: C.mute });
    });
    footer(s, "Số liệu tổng hợp trực tiếp từ dữ liệu dự án tại kỳ báo cáo.", String(pageNo++));
  }

  /* ── SLIDE 3 — PROGRESS BY STAGE + INSIGHT ────────────────────────────── */
  {
    const s = pptx.addSlide();
    const title = m.worst
      ? m.hasPlan
        ? `Độ trễ dồn vào giai đoạn ${m.worst.stage}`
        : `Giai đoạn cần đẩy: ${m.worst.stage}`
      : "Tiến độ theo giai đoạn";
    header(s, "TIẾN ĐỘ TỔNG THỂ", title);
    const topY = 1.4;
    // Cột trái: thanh tiến độ theo giai đoạn (có kế hoạch → vạch mốc kế hoạch; giai đoạn nghẽn → đỏ)
    const leftW = CW * 0.7;
    s.addText(m.hasPlan ? "Phần trăm hoàn thành theo giai đoạn — thực tế so với kế hoạch" : "Phần trăm thực tế theo giai đoạn (nguồn chưa có phần trăm kế hoạch)", { x: MX, y: topY, w: leftW, h: 0.28, fontFace: FONT, fontSize: 10.5, color: C.mute });
    const rows = m.stages.slice(0, 8);
    const labelW = 2.1;
    const barX = MX + labelW + 0.05;
    const pctW = 0.62;
    const barW = leftW - labelW - 0.05 - pctW - 0.1;
    const availH = 7.0 - (topY + 0.4);
    const rh = Math.min(0.62, availH / Math.max(rows.length, 1));
    rows.forEach((st, i) => {
      const y = topY + 0.4 + i * rh;
      const behind = m.hasPlan ? st.variance <= -5 : !!m.worst && st.stage === m.worst.stage;
      s.addText(st.stage, { x: MX, y, w: labelW, h: rh - 0.12, fontFace: FONT, fontSize: 10, color: behind ? C.red : C.ink, bold: behind, valign: "middle", align: "left" });
      const track = rh - 0.26;
      const ty = y + (rh - 0.12 - track) / 2;
      // CHỮ KÝ như Gantt/PDF: thanh nền NAVY (cả giai đoạn) + phần XANH LÁ = % hoàn thành.
      s.addShape(pptx.ShapeType.roundRect, { x: barX, y: ty, w: barW, h: track, fill: { color: C.ganttBar }, line: { type: "none" }, ...round(0.04) });
      // plan marker (viền mảnh) — chỉ khi có Plan đáng tin
      if (m.hasPlan && st.plan > 0) {
        const pw = Math.max(0.02, (barW * st.plan) / 100);
        s.addShape(pptx.ShapeType.line, { x: barX + pw, y: ty - 0.03, w: 0, h: track + 0.06, line: { color: "FFFFFF", width: 1, dashType: "dash" } });
      }
      // actual fill (0% vẫn giữ track đầy đủ; nhãn % luôn nằm ở cột phải cố định để đọc theo cột)
      const aw = Math.max(0.02, (barW * st.act) / 100);
      s.addShape(pptx.ShapeType.roundRect, { x: barX, y: ty, w: aw, h: track, fill: { color: C.ganttDone }, line: { type: "none" }, ...round(0.04) });
      s.addText(`${st.act}%`, { x: barX + barW + 0.05, y, w: pctW, h: rh - 0.12, fontFace: FONT, fontSize: 10, bold: true, color: st.act >= 100 ? "0E7A54" : behind ? C.red : C.navy, valign: "middle", align: "left" });
    });
    // Legend chữ ký 2 màu (luôn hiện): xanh = % hoàn thành, navy = còn lại; thêm vạch Kế hoạch khi có Plan.
    s.addText([
      { text: "▬ ", options: { color: C.ganttDone } }, { text: "% hoàn thành    ", options: { color: C.mute } },
      { text: "▬ ", options: { color: C.ganttBar } }, { text: m.hasPlan ? "còn lại    " : "còn lại", options: { color: C.mute } },
      ...(m.hasPlan ? [{ text: "┊ ", options: { color: C.mute } }, { text: "Kế hoạch", options: { color: C.mute } }] : []),
    ], { x: MX, y: 6.98, w: leftW, h: 0.22, fontFace: FONT, fontSize: 9 });

    // Cột phải: Nhận định — nhấn điểm nghẽn, rồi hạ nguồn / việc trễ / bàn giao.
    const rx = MX + leftW + 0.25;
    const rw = CW - leftW - 0.25;
    const ry = topY, rhh = 7.0 - topY;
    s.addShape(pptx.ShapeType.roundRect, { x: rx, y: ry, w: rw, h: rhh, fill: { color: C.panel }, line: { color: C.line, width: 0.75 }, ...round(0.07) });
    s.addText("NHẬN ĐỊNH NHANH", { x: rx + 0.24, y: ry + 0.2, w: rw - 0.48, h: 0.24, fontFace: FONT, fontSize: 10, bold: true, color: C.mute, charSpacing: 1.2 });
    // Điểm nghẽn nổi bật
    let iy = ry + 0.62;
    s.addText("ĐIỂM NGHẼN", { x: rx + 0.24, y: iy, w: rw - 0.48, h: 0.22, fontFace: FONT, fontSize: 9.5, bold: true, color: C.redInk, charSpacing: 1 });
    s.addText(m.worst ? m.worst.stage : "Không có", { x: rx + 0.24, y: iy + 0.24, w: rw - 0.48, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: C.navy });
    s.addText(m.worst ? `${m.worst.act}%` : "—", { x: rx + 0.24, y: iy + 0.62, w: rw - 0.48, h: 0.5, fontFace: FONT, fontSize: 30, bold: true, color: C.red });
    iy += 1.35;
    s.addShape(pptx.ShapeType.line, { x: rx + 0.24, y: iy, w: rw - 0.48, h: 0, line: { color: C.line, width: 0.75 } });
    const facts: { k: string; v: string; tone?: string }[] = [];
    if (m.downstream) facts.push({ k: "GIAI ĐOẠN HẠ NGUỒN", v: `${m.downstream.stage} · ${m.downstream.act}%`, tone: C.amber });
    facts.push({ k: "VIỆC TRỄ", v: `${m.overdue}${m.critical ? ` · ${m.critical} trễ nặng` : ""}`, tone: m.overdue ? C.red : C.ink });
    facts.push({ k: "BÀN GIAO", v: `${fmtDate(input.deadline)}${m.daysLeft != null ? m.daysLeft < 0 ? ` (quá ${Math.abs(m.daysLeft)} ngày)` : ` (còn ${m.daysLeft} ngày)` : ""}`, tone: m.daysLeft != null && m.daysLeft < 0 ? C.red : C.amber });
    const fy0 = iy + 0.22;
    const flh = (ry + rhh - fy0 - 0.15) / facts.length;
    facts.forEach((f, i) => {
      const y = fy0 + i * flh;
      s.addText(f.k, { x: rx + 0.24, y, w: rw - 0.48, h: 0.22, fontFace: FONT, fontSize: 9, bold: true, color: C.mute, charSpacing: 0.5 });
      s.addText(f.v, { x: rx + 0.24, y: y + 0.22, w: rw - 0.48, h: 0.3, fontFace: FONT, fontSize: 13.5, bold: true, color: f.tone ?? C.ink });
    });
    footer(s, "Tiến độ theo giai đoạn tổng hợp từ % của các đầu việc trong dự án.", String(pageNo++));
  }

  /* ── SLIDE — BẢNG CHI TIẾT CÔNG ĐOẠN (ePMP native, theo template PMO) ──── */
  {
    const rowsData = m.shown;
    if (rowsData.length) {
      const editMap = new Map((input.itemEdits ?? []).map((e) => [e.it, e]));
      const head = ["Mã", "Mô tả công đoạn", "Phụ trách", "Bắt đầu", "Kết thúc", "% TT", "Quá hạn", "Vướng mắc / Cần xử lý"];
      const colW = [0.55, 2.9, 1.35, 0.85, 0.85, 0.6, 0.63, 4.5]; // Σ = 12.23 = CW
      const PER = 15;                       // dòng công đoạn / trang
      const pages = Math.ceil(rowsData.length / PER);
      const projNote = latestText(input.projNoteMsgs);
      for (let pg = 0; pg < pages; pg++) {
        const s = pptx.addSlide();
        header(s, "CHI TIẾT TIẾN ĐỘ", pages > 1 ? `Bảng chi tiết công đoạn (${pg + 1}/${pages})` : "Bảng chi tiết công đoạn", false);
        const rows: TableRows = [
          head.map((h, i) => ({ text: h, options: { bold: true, color: C.white, fill: { color: C.aaRed }, fontSize: 9.5, align: (i >= 3 && i <= 6 ? "center" : "left") as "center" | "left", valign: "middle" } })),
        ];
        // Hàng GỘP dự án (nền cam) — chỉ trang đầu; cột vướng mắc = note cấp dự án.
        if (pg === 0) {
          const gopt = (align: "center" | "left" = "left") => ({ bold: true, color: C.white, fill: { color: C.grpOrange }, fontSize: 9.5, valign: "middle" as const, align });
          rows.push([
            { text: input.code || "—", options: gopt() },
            { text: cleanName(input.name) || input.name || "—", options: gopt() },
            { text: cleanName(input.pm) || "—", options: gopt() },
            { text: fmtDate(input.start), options: gopt("center") },
            { text: fmtDate(input.deadline), options: gopt("center") },
            { text: `${m.actualPct}%`, options: gopt("center") },
            { text: "", options: gopt("center") },
            { text: clip(projNote, 120), options: gopt() },
          ]);
        }
        const slice = rowsData.slice(pg * PER, pg * PER + PER);
        slice.forEach((it) => {
          const e = editMap.get(it);
          const note = latestText(e?.noteMsgs) || (it.note || "").trim();
          const pic = cleanName(e?.pic || it.owner);
          const pct = clampPct(numOf(it.pctActual) ?? 0);
          const od = it.overdueDays ?? 0;
          const plan = numOf(it.pctPlan);
          const behind = m.hasPlan && plan != null && pct < plan;
          const risk = od > 0 || it.tc2 || behind;   // ô % tô hồng như file gốc
          const base = { fontSize: 9, color: C.ink, valign: "middle" as const };
          rows.push([
            { text: it.rawCode || "", options: { ...base, bold: true, align: "left" as const } },
            { text: clip(it.desc || String(it.stage || ""), 60), options: base },
            { text: pic || "—", options: { ...base, color: pic ? C.ink : C.amber } },
            { text: fmtDate(it.start), options: { ...base, align: "center" as const } },
            { text: fmtDate(it.deadline), options: { ...base, align: "center" as const, color: od > 0 ? C.red : C.ink, bold: od > 0 } },
            { text: `${pct}%`, options: { ...base, align: "center" as const, bold: true, color: risk ? C.redInk : pct >= 100 ? C.green : C.ink, ...(risk ? { fill: { color: C.pctRisk } } : {}) } },
            { text: od > 0 ? String(od) : "", options: { ...base, align: "center" as const, bold: od > 0, color: od > 0 ? C.redInk : C.mute, ...(od > 0 ? { fill: { color: C.pctRisk } } : {}) } },
            { text: note ? clip(note, 130) : "", options: { ...base, fontSize: 8.5, valign: "top" as const } },
          ]);
        });
        const bodyRows = slice.length + (pg === 0 ? 2 : 1);
        const rowH = Math.max(0.26, Math.min(0.5, (7.0 - 1.35) / bodyRows));
        s.addTable(rows, {
          x: MX, y: 1.35, w: CW, colW, border: { type: "solid", color: C.line, pt: 0.5 },
          rowH, autoPage: false, valign: "middle", fontFace: FONT,
        });
        footer(s, "Bảng lấy trực tiếp từ dữ liệu dự án (mã · mô tả · phụ trách · ngày · % thực tế · vướng mắc) — không thêm ngoài file.", String(pageNo++));
      }
    }
  }

  /* ── SLIDE 4 — CRITICAL ISSUES ────────────────────────────────────────── */
  {
    const s = pptx.addSlide();
    const top = m.issues.slice(0, 7);
    const p1 = top.filter((i) => i.prio === 1).length;
    const heading = !top.length
      ? "Không có vướng mắc trọng yếu"
      : p1 > 0
        ? `${p1} vấn đề trọng yếu cần Ban lãnh đạo lưu ý`
        : `${top.length} vấn đề cần theo dõi`;
    header(s, "VẤN ĐỀ CẦN LƯU Ý", heading, false);
    // Thẻ quyết định CHỈ khi thật sự đơn lẻ: đúng 1 vấn đề, chỉ 1 giai đoạn, ít badge đỏ.
    const singleCard = top.length === 1 && top[0].stages.length <= 1 && m.redStageCount <= 1;
    if (!top.length) {
      s.addText("Hiện chưa ghi nhận vướng mắc mở cho dự án này.", { x: MX, y: 3.2, w: CW, h: 0.5, fontFace: FONT, fontSize: 15, color: C.mute, align: "center" });
      footer(s, "", String(pageNo++));
    } else if (singleCard) {
      // 1 vấn đề → DECISION CARD (không dùng bảng): P1 → vấn đề → ảnh hưởng/hướng xử lý → PIC/hạn/status.
      const it = top[0];
      const dd = daysFromNow(it.deadline);
      const isOver = dd != null && dd < 0;
      const pc = it.prio === 1 ? C.red : it.prio === 2 ? C.amber : C.mute;
      const cardX = MX, cardY = 1.55, cardW = CW, cardH = 4.55;
      s.addShape(pptx.ShapeType.roundRect, { x: cardX, y: cardY, w: cardW, h: cardH, fill: { color: C.white }, line: { color: C.line, width: 1 }, ...round(0.06) });
      s.addShape(pptx.ShapeType.rect, { x: cardX, y: cardY, w: 0.12, h: cardH, fill: { color: pc } });
      // Header: badge Mức + tiêu đề vấn đề
      s.addShape(pptx.ShapeType.roundRect, { x: cardX + 0.35, y: cardY + 0.32, w: 1.15, h: 1.0, fill: { color: pc }, line: { type: "none" }, ...round(0.06) });
      s.addText([
        { text: "MỨC\n", options: { fontSize: 11, bold: true, color: C.white } },
        { text: `${it.prio}`, options: { fontSize: 38, bold: true, color: C.white } },
      ], { x: cardX + 0.35, y: cardY + 0.32, w: 1.15, h: 1.0, fontFace: FONT, align: "center", valign: "middle", lineSpacingMultiple: 0.82 });
      s.addText(isOver ? "VƯỚNG MẮC ĐÃ QUÁ HẠN" : "VƯỚNG MẮC TRỌNG YẾU", { x: cardX + 1.75, y: cardY + 0.34, w: cardW - 2.1, h: 0.28, fontFace: FONT, fontSize: 11, bold: true, color: C.redInk, charSpacing: 1 });
      s.addText(clip(it.text, 95), { x: cardX + 1.75, y: cardY + 0.64, w: cardW - 2.1, h: 0.72, fontFace: FONT, fontSize: 22, bold: true, color: C.navy, valign: "top" });
      s.addShape(pptx.ShapeType.line, { x: cardX + 0.35, y: cardY + 1.55, w: cardW - 0.7, h: 0, line: { color: C.line, width: 0.75 } });
      // Meta 3 cột: người phụ trách | hạn | trạng thái
      const st = statusOf(it.deadline);
      const meta = [
        { k: "NGƯỜI PHỤ TRÁCH", v: it.pic || "— chưa gán —", tone: it.pic ? C.ink : C.amber },
        { k: "HẠN XỬ LÝ", v: it.deadline ? fmtDate(it.deadline) : "—", tone: isOver ? C.red : C.ink },
        { k: "TRẠNG THÁI", v: st.label, tone: st.key === "over" ? C.red : st.key === "soon" ? C.amber : C.ink },
      ];
      const mY = cardY + 1.72, mH = 0.9, mW = (cardW - 0.7) / 3;
      meta.forEach((mm, i) => {
        const x = cardX + 0.35 + i * mW;
        if (i > 0) s.addShape(pptx.ShapeType.line, { x, y: mY + 0.05, w: 0, h: mH - 0.1, line: { color: C.line, width: 0.75 } });
        s.addText(mm.k, { x: x + 0.2, y: mY, w: mW - 0.3, h: 0.24, fontFace: FONT, fontSize: 9.5, bold: true, color: C.mute, charSpacing: 1 });
        s.addText(mm.v, { x: x + 0.2, y: mY + 0.26, w: mW - 0.3, h: 0.5, fontFace: FONT, fontSize: 16, bold: true, color: mm.tone });
      });
      s.addShape(pptx.ShapeType.line, { x: cardX + 0.35, y: mY + mH + 0.06, w: cardW - 0.7, h: 0, line: { color: C.line, width: 0.75 } });
      // Ảnh hưởng + Hướng xử lý (nhấn khoảng trống "chưa có")
      const bY = mY + mH + 0.2, bH = cardY + cardH - bY - 0.25, bW = (cardW - 0.7 - 0.25) / 2;
      const impact = it.tc2 ? "Trễ nặng — rủi ro mốc bàn giao" : it.overdue > 0 ? `Trễ ${it.overdue} ngày — ảnh hưởng tiến độ` : "Cần theo dõi sát";
      s.addShape(pptx.ShapeType.roundRect, { x: cardX + 0.35, y: bY, w: bW, h: bH, fill: { color: C.light }, line: { color: C.line, width: 0.75 }, ...round(0.05) });
      s.addText("TÁC ĐỘNG THEO DỮ LIỆU", { x: cardX + 0.55, y: bY + 0.16, w: bW - 0.4, h: 0.24, fontFace: FONT, fontSize: 9.5, bold: true, color: C.mute, charSpacing: 1 });
      s.addText(impact, { x: cardX + 0.55, y: bY + 0.44, w: bW - 0.4, h: bH - 0.6, fontFace: FONT, fontSize: 15, bold: true, color: C.red, valign: "top" });
      const ax = cardX + 0.35 + bW + 0.25;
      const noAction = !it.action;
      s.addShape(pptx.ShapeType.roundRect, { x: ax, y: bY, w: bW, h: bH, fill: { color: noAction ? C.amberBg : C.light }, line: { color: noAction ? C.amber : C.line, width: noAction ? 1.25 : 0.75 }, ...round(0.05) });
      s.addText("HƯỚNG XỬ LÝ", { x: ax + 0.2, y: bY + 0.16, w: bW - 0.4, h: 0.24, fontFace: FONT, fontSize: 9.5, bold: true, color: noAction ? C.amberInk : C.mute, charSpacing: 1 });
      s.addText(noAction ? "— CHƯA CÓ —" : clip(it.action, 140), { x: ax + 0.2, y: bY + 0.44, w: bW - 0.4, h: bH - 0.95, fontFace: FONT, fontSize: noAction ? 20 : 15, bold: true, color: noAction ? C.amber : C.ink, valign: "top" });
      if (noAction) s.addText("Cần Ban lãnh đạo chốt người phụ trách và ngày khắc phục.", { x: ax + 0.2, y: bY + bH - 0.42, w: bW - 0.4, h: 0.3, fontFace: FONT, fontSize: 10.5, italic: true, color: C.amberInk });
      footer(s, "Tác động suy ra từ dữ liệu hiện có — không suy diễn ngoài bằng chứng.", String(pageNo++));
    } else {
      const head = ["Mức", "Vấn đề", "Ảnh hưởng", "Hướng xử lý", "Người phụ trách", "Hạn"];
      const colW = [0.85, 3.5, 2.5, 3.15, 1.5, 1.1];
      const rows: TableRows = [
        head.map((h) => ({ text: h, options: { bold: true, color: C.white, fill: { color: C.navy }, fontSize: 10.5, align: (h === "Mức" || h === "Hạn" ? "center" : "left"), valign: "middle" } })),
      ];
      const impactOf = (i: (typeof top)[number]) =>
        i.tc2 ? "Trễ nặng — rủi ro mốc bàn giao" : i.overdue > 0 ? `Trễ ${i.overdue} ngày` : !i.action ? "Chưa có hướng xử lý" : !i.pic ? "Chưa gán người phụ trách" : "Cần theo dõi";
      top.forEach((it) => {
        const pc = it.prio === 1 ? C.red : it.prio === 2 ? C.amber : C.mute;
        const dlOver = (daysFromNow(it.deadline) ?? 99) < 0;
        const multi = it.stages.length > 1;
        const problemCell = multi
          ? [
              { text: clip(it.text, 100), options: { color: C.ink, fontSize: 10 } },
              { text: `\nẢnh hưởng ${it.stages.length} giai đoạn: ${it.stages.join(", ")}`, options: { color: C.mute, fontSize: 8, italic: true, breakLine: true } },
            ]
          : clip(it.text, 100);
        rows.push([
          { text: `Mức ${it.prio}`, options: { align: "center", valign: "middle", bold: true, color: C.white, fill: { color: pc }, fontSize: 10 } },
          { text: problemCell, options: { color: C.ink, fontSize: 10, valign: "middle" } },
          { text: impactOf(it), options: { color: it.prio === 1 ? C.red : it.prio === 2 ? C.amber : C.mute, fontSize: 10, valign: "middle" } },
          { text: clip(it.action, 90) || "— chưa có —", options: { color: it.action ? C.ink : C.amber, fontSize: 10, valign: "middle" } },
          { text: it.pic || "— chưa có —", options: { color: it.pic ? C.ink : C.amber, fontSize: 10, valign: "middle" } },
          { text: it.deadline ? fmtDate(it.deadline) : "—", options: { align: "center", valign: "middle", bold: dlOver, color: dlOver ? C.red : C.ink, fontSize: 10 } },
        ]);
      });
      const rowH = Math.min(0.75, (7.0 - 1.4) / (top.length + 1));
      s.addTable(rows, {
        x: MX, y: 1.4, w: CW, colW, border: { type: "solid", color: C.line, pt: 0.5 },
        rowH, autoPage: false, valign: "middle", fontFace: FONT,
      });
      footer(s, "“Ảnh hưởng” suy ra từ dữ liệu hiện có (trễ hạn · trễ nặng · thiếu người phụ trách hoặc hướng xử lý) — không suy diễn ngoài bằng chứng.", String(pageNo++));
    }
  }

  /* ── SLIDE — NEXT STEPS (ngay sau Management Attention) ───────────────── */
  {
    const acts = m.actions.map((i) => ({ ...i, st: statusOf(i.deadline) })).slice(0, 7);
    if (acts.length) {
      const s = pptx.addSlide();
      header(s, "HÀNH ĐỘNG TIẾP THEO", "Hành động cần theo dõi", false);
      // Cột: Hành động | Người phụ trách | Hạn | Trạng thái — nội dung trái, trạng thái phải.
      const statusW = 1.7, deadlineW = 1.35, ownerW = 2.3;
      const statusX = W - MX - statusW;
      const deadlineX = statusX - deadlineW;
      const ownerX = deadlineX - ownerW;
      const actionX = MX + 0.22;
      const actionW = ownerX - actionX - 0.15;
      const labY = 1.42;
      const lab = (t: string, x: number, w: number, al: "left" | "center" = "left") =>
        s.addText(t, { x, y: labY, w, h: 0.24, fontFace: FONT, fontSize: 9.5, bold: true, color: C.mute, charSpacing: 0.8, align: al });
      lab("HÀNH ĐỘNG", actionX, actionW);
      lab("NGƯỜI PHỤ TRÁCH", ownerX, ownerW);
      lab("HẠN", deadlineX, deadlineW, "center");
      lab("TRẠNG THÁI", statusX, statusW, "center");
      s.addShape(pptx.ShapeType.line, { x: MX, y: labY + 0.28, w: CW, h: 0, line: { color: C.line, width: 0.75 } });
      const y0 = labY + 0.42;
      const rh = Math.min(1.05, (7.0 - y0) / acts.length);
      acts.forEach((a, i) => {
        const y = y0 + i * rh;
        const isOver = a.st.key === "over";
        const isSoon = a.st.key === "soon";
        const bg = isOver ? C.redBg : isSoon ? C.amberBg : C.light;
        const bd = isOver ? "F1C4BE" : isSoon ? "F1D78F" : C.line;
        const rowH = rh - 0.16;
        s.addShape(pptx.ShapeType.roundRect, { x: MX, y, w: CW, h: rowH, fill: { color: bg }, line: { color: bd, width: 0.75 }, ...round(0.06) });
        s.addText(clip(a.text, 85), { x: actionX, y, w: actionW, h: rowH, fontFace: FONT, fontSize: 13, bold: true, color: C.ink, valign: "middle" });
        s.addText(a.pic || "— chưa gán —", { x: ownerX, y, w: ownerW - 0.1, h: rowH, fontFace: FONT, fontSize: 11, color: a.pic ? C.ink : C.amber, valign: "middle" });
        s.addText(a.deadline ? fmtDate(a.deadline) : "—", { x: deadlineX, y, w: deadlineW, h: rowH, fontFace: FONT, fontSize: 11.5, color: isOver ? C.red : C.ink, bold: isOver, valign: "middle", align: "center" });
        const sc = isOver ? C.red : isSoon ? C.amber : "E2E8F0";
        const stInk = isOver ? C.white : isSoon ? "3A2A00" : C.mute;
        const bh = 0.36;
        s.addShape(pptx.ShapeType.roundRect, { x: statusX + 0.12, y: y + (rowH - bh) / 2, w: statusW - 0.24, h: bh, fill: { color: sc }, line: { type: "none" }, ...round(0.05) });
        s.addText(a.st.label, { x: statusX + 0.12, y: y + (rowH - bh) / 2, w: statusW - 0.24, h: bh, fontFace: FONT, fontSize: 9.5, bold: true, color: stInk, align: "center", valign: "middle" });
      });
      footer(s, "Hành động lấy từ dữ liệu nguồn (hướng xử lý · người phụ trách · hạn) — không tạo mới, không đổi hạn gốc.", String(pageNo++));
    }
  }

  /* ── SLIDE(S) — SITE / FIELD EVIDENCE (cuối, phần bằng chứng) ──────────── */
  {
    const imgs = (input.images ?? []).filter((im) => im.data);
    if (imgs.length) {
      const per = 6; // 3 cột × 2 hàng
      const pages = Math.ceil(imgs.length / per);
      for (let pg = 0; pg < pages; pg++) {
        const s = pptx.addSlide();
        header(s, "HÌNH ẢNH HIỆN TRƯỜNG", pages > 1 ? `Hiện trạng thi công tại hiện trường (${pg + 1}/${pages})` : "Hiện trạng thi công tại hiện trường", false);
        const slice = imgs.slice(pg * per, pg * per + per);
        const cols = 3;
        const rowsN = slice.length > 3 ? 2 : 1;
        const gap = 0.28;
        const gw = (CW - gap * (cols - 1)) / cols;
        const areaY = 1.45, areaH = 7.0 - 1.45;
        const gh = (areaH - gap * (rowsN - 1)) / rowsN - 0.28;
        slice.forEach((im, i) => {
          const r = Math.floor(i / cols), c = i % cols;
          const x = MX + c * (gw + gap);
          const y = areaY + r * (gh + 0.28 + gap);
          s.addShape(pptx.ShapeType.roundRect, { x, y, w: gw, h: gh, fill: { color: "EAEEF3" }, line: { color: C.line, width: 0.75 }, ...round(0.05) });
          try {
            s.addImage({ data: im.data, x: x + 0.04, y: y + 0.04, w: gw - 0.08, h: gh - 0.08, sizing: { type: "contain", w: gw - 0.08, h: gh - 0.08 } });
          } catch {
            /* ảnh lỗi → giữ khung trống */
          }
          if (im.at) s.addText(`Ảnh ${pg * per + i + 1} · ${fmtDate(im.at)}`, { x, y: y + gh + 0.03, w: gw, h: 0.24, fontFace: FONT, fontSize: 9.5, color: C.mute });
        });
        footer(s, "Ảnh hiện trường do PMO/đội dự án cập nhật — sắp theo thời gian.", String(pageNo++));
      }
    }
  }

  const fileName = `BaoCao_${sanitize(input.code || input.name)}_${reportDateStr.replace(/\//g, "")}.pptx`;
  await pptx.writeFile({ fileName });
}
