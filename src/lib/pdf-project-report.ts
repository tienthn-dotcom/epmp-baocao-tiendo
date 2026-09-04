/* ═══════════════════════════════════════════════════════════════════════════
 *  XUẤT BÁO CÁO ĐIỀU HÀNH (.pdf) THEO TỪNG DỰ ÁN
 *
 *  Cùng DỮ LIỆU với bản slide (.pptx) — tái dùng analyze() của ppt-report để hai
 *  định dạng luôn khớp nhau (sức khoẻ, % giai đoạn, hành động, vướng mắc). Khác ở
 *  chỗ DỰNG BẰNG HTML rồi html2canvas → jsPDF: chữ Việt render qua font trình duyệt
 *  nên KHÔNG vỡ dấu (jsPDF vẽ text vector không hỗ trợ đủ dấu tiếng Việt).
 *
 *  100% CLIENT-SIDE: jsPDF + html2canvas-pro dynamic-import trong hàm → không lọt
 *  bundle SSR/Worker. Không gọi server.
 * ═══════════════════════════════════════════════════════════════════════════ */
import type { PptReportInput } from "@/lib/ppt-report";
import { analyze, statusOf, fmtDate } from "@/lib/ppt-report";
import { AA_LOGO_DATA_URI } from "@/lib/aa-logo";

/* ── Palette (đồng bộ tông điều hành với bản slide) ─────────────────────────── */
const C = {
  navy: "#0f2742", ink: "#334155", mute: "#64748b", faint: "#94a3b8",
  line: "#e2e8f0", light: "#f8fafc", white: "#ffffff",
  red: "#dc3a2e",
  // MÀU CHỮ KÝ (đồng bộ với thanh Gantt trong app): thanh nền NAVY + phần XANH LÁ = % hoàn thành.
  ganttBar: "#334964", ganttDone: "#5ee9b5",
};
const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Cô đọng text (giữ trọn câu đầu, thêm “…” nếu còn). */
function clip(s: string, n: number): string {
  const t = (s || "").trim().replace(/\s+/g, " ");
  if (t.length <= n) return t;
  return t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
}

function sanitize(s: string): string {
  return (s || "duan").replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "_").slice(0, 60);
}

/** Ô "mốc bàn giao": bật SỐ ngày to, chữ "ngày nữa/quá hạn" nhỏ. */
function daysValueHtml(d: number | null): string {
  if (d == null) return "—";
  if (d < 0) return `${-d}<span style="font-size:12px;font-weight:600;color:${C.red}"> ngày quá hạn</span>`;
  if (d === 0) return `Hôm nay`;
  return `${d}<span style="font-size:12px;font-weight:600;color:${C.mute}"> ngày nữa</span>`;
}

type SchedHealth = { label: string; phrase: string; bg: string; ink: string; dot: string };
/** ĐÁNH GIÁ TÌNH TRẠNG theo badge cảnh báo (điều hành đọc là ra):
 *  • TRỄ TIẾN ĐỘ + ≥1 badge đỏ khác (điểm nghiêm trọng / quá mốc / lỗi số liệu) → TRƯỢT TIẾN ĐỘ.
 *  • Có công đoạn trễ, hoặc ≥3 công đoạn gặp vấn đề → TRỄ TIẾN ĐỘ.
 *  • Còn lại: có rủi ro (vướng mắc nhẹ) / ổn định. */
function scheduleHealth(m: ReturnType<typeof analyze>, redChecks: number): SchedHealth {
  const overdue = m.overdue, critical = m.critical, problem = m.redStageCount;
  const pastDeadline = m.daysLeft != null && m.daysLeft < 0;
  const otherReds = (critical > 0 ? 1 : 0) + (redChecks > 0 ? 1 : 0) + (pastDeadline ? 1 : 0);
  if (overdue > 0 && (otherReds >= 1 || overdue >= 4))
    return { label: "TRƯỢT TIẾN ĐỘ", phrase: "đang trượt tiến độ", bg: "#fdecec", ink: "#b42318", dot: "#b42318" };
  if (overdue > 0 || problem >= 3)
    return { label: "TRỄ TIẾN ĐỘ", phrase: "đang trễ tiến độ", bg: "#fdecec", ink: "#dc3a2e", dot: "#dc3a2e" };
  if (critical > 0 || m.openIssues > 0 || problem >= 1 || redChecks > 0)
    return { label: "CÓ RỦI RO", phrase: "có rủi ro", bg: "#fbe7d8", ink: "#9a4a0e", dot: "#dd6b20" };
  return { label: "ỔN ĐỊNH", phrase: "ổn định, bám tiến độ", bg: "#e6f5ef", ink: "#0e7a54", dot: "#159a6c" };
}

/* ── Khối HTML nhỏ ──────────────────────────────────────────────────────────── */
function kpiCard(label: string, value: string, tone?: string): string {
  const col = tone || C.navy;
  return `<div style="flex:1;min-width:0;border:1px solid ${C.line};border-radius:10px;padding:10px 12px;background:${C.white}">
    <div style="font-size:22px;font-weight:800;line-height:1.1;color:${col};font-variant-numeric:tabular-nums">${value}</div>
    <div style="font-size:11px;color:${C.mute};margin-top:2px">${esc(label)}</div>
  </div>`;
}

function stageRow(s: { stage: string; act: number; plan: number; variance: number }): string {
  // CHỮ KÝ như Gantt: thanh nền NAVY (cả giai đoạn) + phần XANH LÁ = % thực tế hoàn thành.
  const pct = Math.max(0, Math.min(100, s.act));
  const done = pct >= 100;
  return `<div style="display:flex;align-items:center;gap:10px;margin:5px 0">
    <div style="width:150px;flex:none;font-size:12px;color:${C.ink};line-height:1.2">${esc(s.stage)}</div>
    <div style="position:relative;flex:1;height:14px;background:${C.ganttBar};border-radius:5px;overflow:hidden">
      <div style="position:absolute;left:0;top:0;bottom:0;width:${pct}%;background:${C.ganttDone};border-radius:5px 0 0 5px"></div>
    </div>
    <div style="width:52px;flex:none;text-align:right;font-size:11.5px;font-weight:800;color:${done ? "#0e7a54" : C.ink};font-variant-numeric:tabular-nums">${s.act}%</div>
  </div>`;
}

function actionRow(a: { text: string; pic: string; deadline: string; overdue: number; tc2: boolean; sev: number }): string {
  const st = statusOf(a.deadline);
  const dot = a.tc2 ? C.red : a.overdue > 0 ? "#dd6b20" : a.sev > 0 ? "#d99a00" : C.faint;
  const stColor = st.key === "over" ? C.red : st.key === "soon" ? "#9a4a0e" : st.key === "ontrack" ? "#159a6c" : C.faint;
  return `<tr style="border-top:1px solid ${C.line}">
    <td style="padding:6px 8px;vertical-align:top;width:14px"><span style="display:flex;align-items:center;height:1.3em;font-size:12px"><span style="width:8px;height:8px;border-radius:50%;background:${dot}"></span></span></td>
    <td style="padding:6px 8px;vertical-align:top;font-size:12px;color:${C.ink};line-height:1.3">${esc(clip(a.text, 160))}</td>
    <td style="padding:6px 8px;vertical-align:top;font-size:11.5px;color:${a.pic ? C.ink : C.faint};white-space:nowrap">${esc(a.pic || "—")}</td>
    <td style="padding:6px 8px;vertical-align:top;font-size:11.5px;white-space:nowrap;color:${C.mute}">${esc(fmtDate(a.deadline))}</td>
    <td style="padding:6px 8px;vertical-align:top;font-size:11px;white-space:nowrap;font-weight:700;color:${stColor}">${esc(st.label)}</td>
  </tr>`;
}

/** Thứ tự CHUỖI công đoạn (dây chuyền) theo nhãn giai đoạn → dùng để bắt lỗi "sau vượt trước".
 *  Trả -1 nếu không nhận ra (bỏ qua trong kiểm tra chuỗi). */
function stageChainRank(label: string): number {
  const s = (label || "").toLowerCase();
  if (/thi\s*công|lắp\s*đặt/.test(s)) return 6;      // TC
  if (/nhập\s*kho/.test(s)) return 5;                // SX (sản xuất nhập kho)
  if (/triển\s*khai\s*sản\s*xuất/.test(s)) return 4; // TKSX
  if (/vật\s*tư/.test(s)) return 3;                  // VT
  if (/duyệt\s*mẫu/.test(s)) return 2;               // MA
  if (/loa|tạm\s*ứng/.test(s)) return 1;             // BG
  if (/thiết\s*kế|phát\s*hành/.test(s)) return 0;    // TK
  return -1;
}

type ConsCheck = { sev: number; stage?: string; text: string };
/** Rà LOGIC dữ liệu: mâu thuẫn thứ tự dây chuyền + các bất thường cấp công đoạn. */
function consistencyIssues(input: PptReportInput, m: ReturnType<typeof analyze>): ConsCheck[] {
  const out: ConsCheck[] = [];

  // 1) CHUỖI CÔNG ĐOẠN: công đoạn SAU không thể cao hơn công đoạn TRƯỚC (chưa đặt vật tư sao thi công được).
  const ranked = m.stages.map((s) => ({ ...s, rank: stageChainRank(s.stage) }))
    .filter((s) => s.rank >= 0).sort((a, b) => a.rank - b.rank);
  let minUp: number | null = null, minStage = "";
  for (const s of ranked) {
    if (minUp != null && s.act > minUp + 3) {
      out.push({ sev: 2, stage: s.stage, text: `đạt ${s.act}% trong khi công đoạn trước “${minStage}” mới ${minUp}% — công đoạn sau không thể vượt công đoạn trước, cần rà lại số liệu.` });
    }
    if (minUp == null || s.act < minUp) { minUp = s.act; minStage = s.stage; }
  }

  // 2) CẤP CÔNG ĐOẠN: % ngoài khoảng · đã xong mà vẫn trễ · trễ mà thiếu PIC · hạn công đoạn muộn hơn bàn giao.
  const items = input.items.filter((i) => i.shown !== false);
  const projDl = input.deadline ? new Date(input.deadline).getTime() : NaN;
  // PIC HIỂN THỊ (đã gồm quy ước NM/PM… như bảng) → dùng để soát "thiếu PIC" cho khớp với cột PIC.
  const picByItem = new Map((input.itemEdits ?? []).map((e) => [e.it, (e.pic || "").trim()]));
  const oor: string[] = [], doneOverdue: string[] = [], noPic: string[] = [], dlAfter: string[] = [];
  for (const it of items) {
    const a = typeof it.pctActual === "number" && isFinite(it.pctActual) ? it.pctActual : null;
    const od = it.overdueDays ?? 0;
    const pic = picByItem.get(it) ?? (it.owner || "").trim();
    const stg = String(it.stage || "Công đoạn");
    if (a != null && (a > 100.5 || a < 0)) oor.push(`${stg} (${Math.round(a)}%)`);
    if (a != null && a >= 100 && od > 0) doneOverdue.push(stg);
    if (od > 0 && !/[\p{L}\p{N}]/u.test(pic)) noPic.push(stg);
    if (it.deadline && !isNaN(projDl) && new Date(it.deadline).getTime() > projDl) dlAfter.push(stg);
  }
  // 3) SỐ NHẬP TAY (số mã / tổng mã) ở các giai đoạn có breakdown (Duyệt mẫu, Đặt vật tư,
  //    Triển khai sản xuất, Sản xuất nhập kho): done > total (vô lý) + % thực tế lệch xa tỉ lệ số mã.
  const overCount: string[] = [], pctVsCount: string[] = [];
  for (const it of items) {
    const ccs = it.codeCounts;
    if (!ccs || !ccs.length) continue;
    const stg = String(it.stage || "Công đoạn");
    let sumDone = 0, sumTotal = 0;
    for (const cc of ccs) {
      const done = typeof cc.done === "number" ? cc.done : 0;
      const total = cc.total;
      if (typeof cc.done === "number" && done > total) overCount.push(`${stg} · ${cc.label} ${done}/${total}`);
      sumDone += Math.max(0, done); sumTotal += total;
    }
    const a = typeof it.pctActual === "number" && isFinite(it.pctActual) ? it.pctActual : null;
    if (sumTotal > 0 && a != null) {
      const implied = Math.round((sumDone / sumTotal) * 100);
      if (Math.abs(a - implied) > 12) pctVsCount.push(`${stg}: % thực tế ${Math.round(a)}% nhưng số mã ${sumDone}/${sumTotal} (~${implied}%)`);
    }
  }

  const uniq = (a: string[]) => [...new Set(a)];
  if (overCount.length) out.push({ sev: 2, text: `Số đã làm VƯỢT tổng số mã (nhập tay sai): ${uniq(overCount).join("; ")}.` });
  if (pctVsCount.length) out.push({ sev: 1, text: `% thực tế lệch xa số mã đã nhập, cần kiểm lại: ${uniq(pctVsCount).join("; ")}.` });
  if (oor.length) out.push({ sev: 2, text: `% thực tế nằm ngoài khoảng 0–100 ở: ${uniq(oor).join(", ")}.` });
  if (doneOverdue.length) out.push({ sev: 1, text: `Đã đạt 100% nhưng vẫn gắn cờ trễ hạn: ${uniq(doneOverdue).join(", ")} — dữ liệu mâu thuẫn.` });
  if (noPic.length) { const u = uniq(noPic); out.push(u.length === 1 ? { sev: 1, stage: u[0], text: "đang trễ nhưng chưa ghi người phụ trách." } : { sev: 1, text: `Chưa ghi người phụ trách ở công đoạn đang trễ: ${u.join(", ")}.` }); }
  if (dlAfter.length) out.push({ sev: 1, text: `Hạn công đoạn muộn hơn mốc bàn giao dự án: ${uniq(dlAfter).join(", ")}.` });

  return out.sort((a, b) => b.sev - a.sev);
}

/** Dựng HTML báo cáo 1 trang A4 (794px ~ A4@96dpi). */
function buildHtml(input: PptReportInput): string {
  const m = analyze(input);
  const checks = consistencyIssues(input, m);
  const redChecks = checks.filter((c) => c.sev >= 2).length;
  const sh = scheduleHealth(m, redChecks);
  const overdd = m.daysLeft != null && m.daysLeft < 0;
  const daysTxt = m.daysLeft == null ? "—" : m.daysLeft < 0 ? `Quá hạn ${-m.daysLeft} ngày` : `Còn ${m.daysLeft} ngày`;

  const meta = [
    ["Người phụ trách", input.pm || "—"],
    ["Bắt đầu", fmtDate(input.start)],
    ["Bàn giao", fmtDate(input.deadline)],
    ["Thời hạn", daysTxt],
  ].map(([l, v]) =>
    `<div style="flex:1;min-width:0"><div style="font-size:10px;color:${C.faint};text-transform:uppercase;letter-spacing:.5px">${esc(l)}</div>
     <div style="font-size:12.5px;font-weight:700;color:${C.ink};margin-top:1px">${esc(v)}</div></div>`).join("");

  const kpis = [
    kpiCard("Hoàn thành", `${m.done}/${m.total}`, "#0e7a54"),
    kpiCard("Việc gặp vấn đề", String(m.redStageCount), m.redStageCount > 0 ? C.red : C.navy),
    kpiCard("Điểm nghiêm trọng", String(m.critical), m.critical > 0 ? C.red : C.navy),
    kpiCard("Mốc bàn giao", daysValueHtml(m.daysLeft), overdd ? C.red : C.navy),
  ].join("");

  const stages = m.stages.length
    ? m.stages.map((s) => stageRow(s)).join("")
    : `<div style="font-size:12px;color:${C.faint}">Chưa có dữ liệu giai đoạn.</div>`;

  const ACT_MAX = 9;
  const acts = m.actions.slice(0, ACT_MAX);
  const moreActs = m.actions.length - acts.length;
  const actionsHtml = acts.length
    ? `<table style="width:100%;border-collapse:collapse;margin-top:4px">
        <thead><tr style="text-align:left">
          <th style="width:14px"></th>
          <th style="padding:4px 8px;font-size:10px;color:${C.faint};text-transform:uppercase;letter-spacing:.5px;font-weight:700">Việc cần làm</th>
          <th style="padding:4px 8px;font-size:10px;color:${C.faint};text-transform:uppercase;letter-spacing:.5px;font-weight:700">Phụ trách</th>
          <th style="padding:4px 8px;font-size:10px;color:${C.faint};text-transform:uppercase;letter-spacing:.5px;font-weight:700">Hạn</th>
          <th style="padding:4px 8px;font-size:10px;color:${C.faint};text-transform:uppercase;letter-spacing:.5px;font-weight:700">Trạng thái</th>
        </tr></thead>
        <tbody>${acts.map(actionRow).join("")}</tbody>
      </table>` +
      (moreActs > 0 ? `<div style="font-size:11px;color:${C.mute};margin-top:6px">… và ${moreActs} việc khác (xem chi tiết trong app).</div>` : "")
    : `<div style="font-size:12px;color:${C.faint}">Không có hành động nào cần theo dõi — dự án đang bám tiến độ.</div>`;

  // RÀ SOÁT DỮ LIỆU — mỗi dòng dẫn TÊN HẠNG MỤC in đậm (nếu có), rồi lý do.
  const checkLine = (c: ConsCheck) => {
    const col = c.sev >= 2 ? C.red : "#c26a12";
    const lead = c.stage ? `<b style="color:${col}">${esc(c.stage)}:</b> ` : "";
    // Chấm bọc trong flex cao đúng 1 dòng (align-items:center) → luôn khớp giữa dòng chữ đầu, không lệch.
    return `<div style="display:flex;gap:9px;margin:5px 0;font-size:12px;color:${C.ink};line-height:1.45">
      <span style="flex:none;display:flex;align-items:center;height:1.45em"><span style="width:7px;height:7px;border-radius:50%;background:${col}"></span></span>
      <span style="flex:1">${lead}${esc(c.text)}</span>
    </div>`;
  };
  const checksHtml = checks.length
    ? `<div style="margin-top:16px">
        <div style="font-size:12px;font-weight:800;color:${C.navy};letter-spacing:.3px;margin-bottom:5px">RÀ SOÁT DỮ LIỆU — CẦN KIỂM CHỨNG</div>
        <div style="border:1px solid #f1c9a6;background:#fff7ef;border-radius:10px;padding:8px 14px">
          ${checks.map(checkLine).join("")}
        </div>
      </div>`
    : `<div style="margin-top:16px;display:flex;align-items:center;gap:8px;font-size:12px;color:#0e7a54">
        <span style="width:8px;height:8px;border-radius:50%;background:#5ee9b5"></span>Rà soát dữ liệu: không phát hiện mâu thuẫn logic.</div>`;

  const projNoteMsgs = (input.projNoteMsgs ?? []).filter((x) => !x.hidden && (x.text ?? "").trim());
  const projNote = projNoteMsgs.length ? projNoteMsgs[projNoteMsgs.length - 1].text.trim() : "";
  const noteHtml = projNote
    ? `<div style="margin-top:14px">
        <div style="font-size:12px;font-weight:800;color:${C.navy};letter-spacing:.3px;margin-bottom:4px">VƯỚNG MẮC CẤP DỰ ÁN</div>
        <div style="border-left:3px solid #d99a00;background:#fff8e6;padding:8px 12px;border-radius:0 8px 8px 0;font-size:12px;color:${C.ink};line-height:1.4">${esc(clip(projNote, 400))}</div>
      </div>` : "";

  const imgs = (input.images ?? []).slice(0, 4);
  const imgHtml = imgs.length
    ? `<div style="margin-top:14px">
        <div style="font-size:12px;font-weight:800;color:${C.navy};letter-spacing:.3px;margin-bottom:6px">ẢNH HIỆN TRƯỜNG</div>
        <div style="display:flex;gap:8px">${imgs.map((im) =>
          `<div style="flex:1;min-width:0;height:110px;border:1px solid ${C.line};border-radius:8px;overflow:hidden;background:${C.light}">
             <img src="${im.data}" style="width:100%;height:100%;object-fit:cover;display:block"/></div>`).join("")}</div>
      </div>` : "";

  const now = new Date();
  const stamp = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  return `<div style="width:794px;box-sizing:border-box;background:${C.white};font-family:'Segoe UI',Inter,system-ui,Arial,sans-serif;color:${C.navy};padding:30px 32px 26px">
    <!-- HEADER -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px">
      <div style="min-width:0;flex:1">
        <div style="font-size:10px;color:${C.mute};letter-spacing:2px;text-transform:uppercase;font-weight:700">Báo cáo điều hành dự án</div>
        <div style="font-size:22px;font-weight:800;color:${C.navy};line-height:1.2;margin-top:4px">${esc(input.name)}</div>
        <div style="font-size:12.5px;color:${C.mute};margin-top:2px;font-weight:600">${esc(input.code || "")}</div>
      </div>
      <div style="flex:none;text-align:right">
        <img src="${AA_LOGO_DATA_URI}" style="height:34px;width:auto;object-fit:contain;display:inline-block"/>
        <div style="margin-top:8px;display:inline-flex;align-items:center;gap:6px;background:${sh.bg};color:${sh.ink};border:1px solid ${sh.dot};border-radius:999px;padding:4px 12px;font-size:12px;font-weight:800">
          <span style="width:9px;height:9px;border-radius:50%;background:${sh.dot}"></span>${sh.label}
        </div>
      </div>
    </div>
    <div style="height:2px;background:${C.navy};margin:12px 0 12px"></div>

    <!-- META -->
    <div style="display:flex;gap:14px;margin-bottom:14px">${meta}</div>

    <!-- KPI -->
    <div style="display:flex;gap:10px;margin-bottom:16px">${kpis}</div>

    <!-- STAGES -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <div style="font-size:12px;font-weight:800;color:${C.navy};letter-spacing:.3px">TIẾN ĐỘ THEO GIAI ĐOẠN</div>
      <div style="display:flex;align-items:center;gap:12px;font-size:10px;color:${C.mute}">
        <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:12px;height:8px;border-radius:2px;background:${C.ganttDone}"></span>% hoàn thành</span>
        <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:12px;height:8px;border-radius:2px;background:${C.ganttBar}"></span>còn lại</span>
      </div>
    </div>
    ${stages}

    <!-- ACTIONS -->
    <div style="font-size:12px;font-weight:800;color:${C.navy};letter-spacing:.3px;margin:16px 0 2px">HÀNH ĐỘNG CẦN THEO DÕI</div>
    ${actionsHtml}

    ${checksHtml}
    ${noteHtml}
    ${imgHtml}

    <!-- FOOTER -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:18px;padding-top:8px;border-top:1px solid ${C.line};font-size:10px;color:${C.faint}">
      <span>Nguồn: ePMP · Projects Master Plan · PMO</span>
      <span>Xuất lúc ${stamp}</span>
    </div>
  </div>`;
}

/** Xuất báo cáo dự án ra PDF (A4 dọc, ép vừa 1 trang). Trả về khi đã tải xong. */
export async function exportProjectPdf(input: PptReportInput): Promise<void> {
  const [{ jsPDF }, html2canvasMod] = await Promise.all([
    import("jspdf"),
    import("html2canvas-pro"),
  ]);
  const html2canvas = html2canvasMod.default;

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-99999px;top:0;z-index:-1;background:#ffffff";
  host.innerHTML = buildHtml(input);
  document.body.appendChild(host);
  const sheet = host.firstElementChild as HTMLElement;

  try {
    try { await (document as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready; } catch { /* */ }
    const canvas = await html2canvas(sheet, { scale: 2, backgroundColor: "#ffffff", logging: false });

    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = 210, pageH = 297, MARGIN = 8;
    const innerW = pageW - MARGIN * 2;
    const imgH = (canvas.height / canvas.width) * innerW;   // chiều cao ảnh nếu vẽ full bề ngang
    const availH = pageH - MARGIN * 2;
    // Ép vừa 1 trang: nếu cao hơn trang thì thu tỉ lệ (căn giữa ngang); ngắn hơn thì vẽ tự nhiên.
    const scale = Math.min(1, availH / imgH);
    const wMm = innerW * scale, hMm = imgH * scale;
    const x = MARGIN + (innerW - wMm) / 2;
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", x, MARGIN, wMm, hMm);

    const fname = `BaoCao_${sanitize(input.code || "")}_${sanitize(input.name)}.pdf`.replace(/_+/g, "_");
    pdf.save(fname);
  } finally {
    host.remove();
  }
}
