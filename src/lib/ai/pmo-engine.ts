/**
 * ENGINE TẤT ĐỊNH — thực thi tư duy ETL 3 bước + 4 mức cảnh báo (theo pmo-skill.ts) HOÀN TOÀN bằng luật,
 * minh bạch & audit được, KHÔNG cần LLM. Trả về JSON PmoDiagnosis[] để App trigger UI/thông báo.
 *
 * (Phần diễn giải ngôn ngữ — root_cause_summary/decisions — hiện là bản TẤT ĐỊNH có template; khi chốt
 *  engine LLM sẽ nạp PMO_SYSTEM_PROMPT + record để nâng cấp giọng văn/độ sâu.)
 */
import type { ProgressRecord } from "@/lib/etl";
import {
  STAGE_PIPELINE, STAGE_LABEL, ALERT_RULES, isEarlyStage, isLateStage,
  type Stage, type AlertLevel, type PmoDiagnosis, type ProjectContext,
} from "@/lib/ai/pmo-skill";

const DAY = 86400000;
function parseVN(s: string): number | null {
  const m = /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(s || ""); if (!m) return null;
  let y = +m[3]; if (y < 100) y += 2000;
  return Date.UTC(y, +m[2] - 1, +m[1]);
}
const fmt = (ts: number) => { const d = new Date(ts); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const leafPct = (r: ProgressRecord): number | null =>
  r.qtyTotal != null && r.qtyTotal > 0 && r.qtyDone != null ? Math.max(0, Math.min(100, (r.qtyDone / r.qtyTotal) * 100)) : r.pctActual;
const daysLate = (end: number | null, today: number) => (end != null && end < today ? Math.round((today - end) / DAY) : 0);

type StageAgg = { maxEnd: number | null; pctVals: number[]; owners: string[]; delayed: number };

/** Chẩn đoán TẤT CẢ dự án trong bundle records. todayISO để test tất định; mặc định = hôm nay. */
export function diagnoseAll(records: ProgressRecord[], ctxByProject: Record<string, ProjectContext> = {}, todayISO?: string): PmoDiagnosis[] {
  const today = todayISO ? Date.parse(todayISO) : Date.now();
  const groups = new Map<string, ProgressRecord[]>();
  for (const r of records) { const k = r.projectCode || r.projectName || "?"; (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
  return [...groups.entries()].map(([code, recs]) => diagnoseProject(code, recs, ctxByProject[code] ?? {}, today));
}

function diagnoseProject(code: string, recs: ProgressRecord[], ctx: ProjectContext, today: number): PmoDiagnosis {
  const leaves = recs.filter((r) => r.isLeaf);
  const anomalies: string[] = [];

  // ── B1: gom theo công đoạn + phát hiện bất thường ──
  const S = new Map<Stage, StageAgg>();
  for (const s of STAGE_PIPELINE) S.set(s, { maxEnd: null, pctVals: [], owners: [], delayed: 0 });
  for (const r of leaves) {
    const pct = leafPct(r); const end = parseVN(r.end);
    const info = (STAGE_PIPELINE as readonly string[]).includes(r.stage) ? S.get(r.stage as Stage)! : null;
    if (info) {
      if (end != null) info.maxEnd = info.maxEnd == null ? end : Math.max(info.maxEnd, end);
      if (pct != null) info.pctVals.push(pct);
      if (r.owner && !info.owners.includes(r.owner)) info.owners.push(r.owner);
      if (end != null && end < today && (pct ?? 0) < 100) info.delayed++;
    }
    if ((pct ?? 0) >= 100 && !parseVN(r.start)) anomalies.push(`"${r.name}": báo 100% nhưng CHƯA có ngày bắt đầu thực tế`);
  }
  const sxEnd = S.get("SX")!.maxEnd, tcEnd = S.get("TC")!.maxEnd;
  if (sxEnd != null && tcEnd != null && tcEnd < sxEnd) anomalies.push(`Deadline Thi công (${fmt(tcEnd)}) TRƯỚC deadline Sản xuất (${fmt(sxEnd)}) — mâu thuẫn logic dây chuyền`);

  // ── B2: nghẽn (công đoạn SỚM NHẤT đang trễ) + delay vs BOT + tác động ──
  let bottleneck: Stage | null = null;
  for (const s of STAGE_PIPELINE) { const i = S.get(s)!; const p = avg(i.pctVals); if (i.delayed > 0 && (p == null || p < 100)) { bottleneck = s; break; } }
  const bnDelay = bottleneck ? daysLate(S.get(bottleneck)!.maxEnd, today) : 0;

  const projPct = avg(leaves.map(leafPct).filter((v): v is number => v != null));
  const projMaxEnd = leaves.reduce<number | null>((mx, l) => { const e = parseVN(l.end); return e != null ? (mx == null ? e : Math.max(mx, e)) : mx; }, null);
  const botTs = ctx.botDate ? parseVN(ctx.botDate) : projMaxEnd;   // chưa nối mốc BOT → dùng ngày kết thúc muộn nhất làm proxy
  const delayVsBot = botTs != null && (projPct == null || projPct < 100) && today > botTs ? Math.round((today - botTs) / DAY) : 0;
  const blockerCritical = (ctx.openBlockerHours ?? 0) > ALERT_RULES.blockerCriticalHours;

  // trễ nhưng cột Vướng mắc trống → thiếu dữ liệu
  if ((bnDelay > 0 || delayVsBot > 0) && ctx.hasIssueText === false) anomalies.push(`${code} đang trễ nhưng cột Vướng mắc để TRỐNG — thiếu ghi nhận nguyên nhân`);

  // ── B3: phân loại 4 mức ──
  let status: AlertLevel = "NORMAL";
  if (delayVsBot > 0 || blockerCritical) status = "CRITICAL";
  else if (bottleneck && isLateStage(bottleneck) && bnDelay >= ALERT_RULES.lateDelayHighMin) status = bnDelay > ALERT_RULES.lateDelayHighMax ? "CRITICAL" : "HIGH_RISK";
  else if (bottleneck && isEarlyStage(bottleneck) && bnDelay > 0) status = bnDelay <= ALERT_RULES.earlyDelayWarnMax ? "WARNING" : "HIGH_RISK";
  else if (bottleneck && bnDelay > 0) status = "WARNING";

  const pic = (bottleneck && S.get(bottleneck)!.owners[0]) || recs.find((r) => r.owner)?.owner || "—";
  const bnLabel = bottleneck ? (STAGE_LABEL[bottleneck] ?? bottleneck) : "";
  const rootCause = bottleneck
    ? `Nghẽn ở công đoạn ${bnLabel} của ${code}: ${S.get(bottleneck)!.delayed} đầu việc trễ ~${bnDelay} ngày${delayVsBot > 0 ? `, đã quá mốc bàn giao ${delayVsBot} ngày` : ""}. Rủi ro kéo trễ các công đoạn phía sau (${STAGE_PIPELINE.slice(STAGE_PIPELINE.indexOf(bottleneck) + 1).map((s) => STAGE_LABEL[s]).join(" → ") || "—"}).`
    : delayVsBot > 0 ? `${code} đã quá mốc bàn giao ${delayVsBot} ngày mà chưa hoàn tất (${projPct == null ? "?" : Math.round(projPct)}%).`
    : `${code} đang đúng hạn, chưa phát hiện nghẽn (${projPct == null ? "?" : Math.round(projPct)}%).`;

  const decisions = buildDecisions(bottleneck, bnDelay, delayVsBot, blockerCritical);
  const primary = status === "CRITICAL"
    ? (delayVsBot > 0 ? `Họp khẩn chủ đầu tư/BOD về mốc bàn giao ${code} (đã trễ ${delayVsBot} ngày) & chốt phương án bù.` : `Gỡ blocker của ${code} NGAY (đã treo >${ALERT_RULES.blockerCriticalHours}h).`)
    : bottleneck ? `Thúc ${pic} xử lý nghẽn ${bnLabel} của ${code} trong 24h.` : `Theo dõi bình thường ${code}.`;

  return {
    project_id: code,
    etl_health_check: { data_integrity: anomalies.length ? "INVALID_LOGIC" : "VALID", detected_anomalies: anomalies },
    pmo_diagnosis: { overall_status: status, critical_bottleneck_stage: bottleneck, delay_days_vs_bot: delayVsBot, root_cause_summary: rootCause },
    decision_making: {
      primary_action: primary,
      recommended_decisions: decisions,
      assigned_to_pic: pic,
      suggested_issue_update: (bnDelay > 0 || delayVsBot > 0) ? `Trễ ${bnLabel || "tiến độ"} ${bnDelay || delayVsBot} ngày. Nguyên nhân: [điền]. Giải pháp: ${decisions[0] ?? "[điền]"}.` : "",
    },
  };
}

function buildDecisions(bn: Stage | null, bnDelay: number, delayVsBot: number, blocker: boolean): string[] {
  const d: string[] = [];
  if (blocker) d.push("Leo thang blocker lên cấp quản lý & đặt hạn xử lý trong 24h.");
  if (bn === "VT") { d.push("Rà nhà cung cấp vật tư; nếu trễ >5 ngày → chuyển NCC thay thế."); d.push("Ưu tiên nhập trước vật tư đường găng cho công đoạn sau."); }
  else if (bn === "TKSX") d.push("Chốt nhanh triển khai SX; bổ sung kỹ thuật để không kéo trễ xưởng.");
  else if (bn === "SX") { d.push("Tăng ca/thêm chuyền tại xưởng cho hạng mục đường găng."); d.push("Cân nhắc CẮT bớt đầu việc phụ để giữ mốc TC."); }
  else if (bn === "TC") { d.push("Tăng đội thi công tại công trường; làm cuốn chiếu hạng mục xong trước."); if (delayVsBot > 0) d.push("Đề xuất gia hạn mốc TC/bàn giao với chủ đầu tư kèm kế hoạch bù."); }
  else if (bn === "MA") d.push("Đẩy nhanh duyệt mẫu; hẹn lịch chốt với chủ đầu tư trong tuần.");
  if (delayVsBot > 0 && bn !== "TC") d.push(`Lập kế hoạch bù ${delayVsBot} ngày & báo cáo BOD phương án giữ/điều chỉnh mốc bàn giao.`);
  return d.length ? d : ["Giữ nhịp theo dõi; chưa cần can thiệp."];
}
