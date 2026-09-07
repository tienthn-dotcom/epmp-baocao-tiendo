/**
 * APP #4 (AppShell rail) — "Trợ lý PMO": AI Decision & ETL Engine.
 * Chạy pipeline ETL (Extract file nguồn → Transform sang ProgressRecord → Load vào kho KV `etl:v1:*`),
 * rồi ENGINE TẤT ĐỊNH (pmo-engine) chẩn đoán tiến độ theo skill PMO → cảnh báo 4 mức + hành động đề xuất.
 * Tách RIÊNG khỏi các app hiển thị — đây là "bộ não" ra quyết định. Dev-first.
 */
import { useState, type CSSProperties } from "react";
import { Brain, RefreshCw, AlertTriangle } from "lucide-react";
import { getSummaryFile } from "@/lib/mtld-install.functions";
import { parseDetailPlan } from "@/lib/detail-plan";
import { detailToRecords, toBundle } from "@/lib/etl";
import { saveEtlRecords } from "@/lib/edits.functions";
import { diagnoseAll } from "@/lib/ai/pmo-engine";
import { STAGE_LABEL, type PmoDiagnosis, type AlertLevel } from "@/lib/ai/pmo-skill";
import { track } from "@/lib/track";

const SAMPLE_FILE = "1a0i1n9rjtrNUGHtGmuhj4MDQUnR4dJX9";   // dev: nguồn "Chi tiết tiến độ" (sau cho cấu hình nhiều nguồn)
const SAMPLE_GID = "452283237";

const LV: Record<AlertLevel, { label: string; fg: string; bg: string; bd: string; dot: string }> = {
  CRITICAL:  { label: "Nghiêm trọng", fg: "#b91c1c", bg: "#fef2f2", bd: "#fecaca", dot: "#ef4444" },
  HIGH_RISK: { label: "Rủi ro cao",   fg: "#c2410c", bg: "#fff7ed", bd: "#fed7aa", dot: "#f97316" },
  WARNING:   { label: "Cần tập trung", fg: "#b45309", bg: "#fffbeb", bd: "#fde68a", dot: "#f59e0b" },
  NORMAL:    { label: "Bình thường",  fg: "#15803d", bg: "#f0fdf4", bd: "#bbf7d0", dot: "#22c55e" },
};
const ORDER: AlertLevel[] = ["CRITICAL", "HIGH_RISK", "WARNING", "NORMAL"];

export function PmoAiApp() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [diags, setDiags] = useState<PmoDiagnosis[] | null>(null);
  const [recCount, setRecCount] = useState(0);
  const [ranAt, setRanAt] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setErr(null);
    try {
      // ── EXTRACT ──
      const res = await getSummaryFile({ data: { fileId: SAMPLE_FILE, gid: SAMPLE_GID, force: true } });
      if (!res?.b64) throw new Error("Không tải được file nguồn — kiểm tra chia sẻ.");
      const XLSX = await import("xlsx");
      const bin = atob(res.b64); const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const wb = XLSX.read(bytes.buffer, { type: "array" });
      const sh = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sh, { header: 1, raw: false, defval: "" });
      // ── TRANSFORM ──
      const records = detailToRecords(parseDetailPlan(rows).projects);
      // ── LOAD (kho ETL) ──
      const at = new Date().toISOString();
      await saveEtlRecords({ data: { source: "detail", bundle: JSON.stringify(toBundle("detail", records, at)) } });
      track("pmoai_import", `${records.length} dòng từ bảng tiến độ chi tiết`);
      // ── DIAGNOSE (engine) ──
      setRecCount(records.length); setDiags(diagnoseAll(records)); setRanAt(at);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const counts: Record<AlertLevel, number> = { CRITICAL: 0, HIGH_RISK: 0, WARNING: 0, NORMAL: 0 };
  (diags ?? []).forEach((d) => { counts[d.pmo_diagnosis.overall_status]++; });
  const sorted = (diags ?? []).slice().sort((a, b) => ORDER.indexOf(a.pmo_diagnosis.overall_status) - ORDER.indexOf(b.pmo_diagnosis.overall_status));

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#eef1f4" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: "#0f172a", color: "#e2e8f0", flexShrink: 0 }}>
        <Brain className="h-4 w-4" style={{ color: "#5ee9b5" }} />
        <strong style={{ letterSpacing: ".02em" }}>Trợ lý PMO · Cảnh báo & Quyết định</strong>
        <span style={{ fontSize: 11.5, color: "#94a3b8" }}>ETL → Engine chẩn đoán · {diags ? `${diags.length} dự án · ${recCount} đầu việc` : "chưa chạy"}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#0f172a", background: "#fbbf24", borderRadius: 5, padding: "2px 7px" }}>DEV</span>
        <button onClick={run} disabled={busy} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, background: "#0f766e", color: "#fff", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 700, opacity: busy ? 0.6 : 1 }}>
          <RefreshCw className="h-3.5 w-3.5" /> {busy ? "Đang chạy ETL + chẩn đoán…" : "Chạy ETL + Chẩn đoán"}
        </button>
        {ranAt && <span style={{ fontSize: 10.5, color: "#94a3b8" }}>lúc {new Date(ranAt).toLocaleString("vi-VN")}</span>}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16 }}>
        {err && <div style={{ marginBottom: 12, fontSize: 12, color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px" }}>Lỗi: {err}</div>}
        {!diags && !busy && <div style={{ padding: 60, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Bấm <b>“Chạy ETL + Chẩn đoán”</b> để gom dữ liệu và cho engine đánh giá 4 mức cảnh báo.</div>}

        {diags && (
          <>
            {/* Dải tóm tắt 4 mức */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
              {ORDER.map((lv) => (
                <div key={lv} style={{ display: "flex", alignItems: "center", gap: 8, background: LV[lv].bg, border: `1px solid ${LV[lv].bd}`, borderRadius: 10, padding: "8px 14px" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: LV[lv].dot }} />
                  <strong style={{ fontSize: 20, color: LV[lv].fg, fontVariantNumeric: "tabular-nums" }}>{counts[lv]}</strong>
                  <span style={{ fontSize: 11.5, color: LV[lv].fg, fontWeight: 600 }}>{LV[lv].label}</span>
                </div>
              ))}
            </div>

            {/* Danh sách dự án theo mức nghiêm trọng */}
            <div style={{ display: "grid", gap: 10 }}>
              {sorted.map((d) => <DiagCard key={d.project_id} d={d} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DiagCard({ d }: { d: PmoDiagnosis }) {
  const lv = LV[d.pmo_diagnosis.overall_status];
  const bn = d.pmo_diagnosis.critical_bottleneck_stage;
  const chip: CSSProperties = { fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: "2px 9px" };
  return (
    <div style={{ background: "#fff", border: `1px solid #e2e8f0`, borderLeft: `4px solid ${lv.dot}`, borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ ...chip, color: "#fff", background: lv.dot }}>{lv.label.toUpperCase()}</span>
        <strong style={{ fontSize: 14, color: "#0f172a" }}>{d.project_id}</strong>
        {bn && <span style={{ ...chip, color: "#334155", background: "#e2e8f0" }}>Nghẽn: {STAGE_LABEL[bn] ?? bn}</span>}
        {d.pmo_diagnosis.delay_days_vs_bot > 0 && <span style={{ ...chip, color: "#b91c1c", background: "#fef2f2" }}>Trễ bàn giao {d.pmo_diagnosis.delay_days_vs_bot} ngày</span>}
        {d.etl_health_check.data_integrity === "INVALID_LOGIC" && <span style={{ ...chip, color: "#c2410c", background: "#fff7ed", display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle className="h-3 w-3" />Dữ liệu mâu thuẫn</span>}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#64748b" }}>PIC: <b style={{ color: "#0f172a" }}>{d.decision_making.assigned_to_pic}</b></span>
      </div>

      <div style={{ marginTop: 8, fontSize: 12.5, color: "#334155", lineHeight: 1.5 }}>{d.pmo_diagnosis.root_cause_summary}</div>

      <div style={{ marginTop: 8, background: "#f8fafc", borderRadius: 8, padding: "8px 10px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#0f766e", marginBottom: 3 }}>▶ Hành động ngay</div>
        <div style={{ fontSize: 12.5, color: "#0f172a", fontWeight: 600 }}>{d.decision_making.primary_action}</div>
        {d.decision_making.recommended_decisions.length > 0 && (
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: "#475569", lineHeight: 1.55 }}>
            {d.decision_making.recommended_decisions.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        )}
      </div>

      {d.etl_health_check.detected_anomalies.length > 0 && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 11.5, color: "#c2410c", lineHeight: 1.5 }}>
          {d.etl_health_check.detected_anomalies.map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      )}
      {d.decision_making.suggested_issue_update && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: "#64748b" }}>💬 Gợi ý điền Vướng mắc: <span style={{ fontStyle: "italic" }}>{d.decision_making.suggested_issue_update}</span></div>
      )}
    </div>
  );
}
