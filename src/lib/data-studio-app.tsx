/**
 * APP (AppShell rail) — "Dữ liệu dự án" (Data Hub). Trải nghiệm cho PMO/PM KHÔNG rành kỹ thuật:
 *   Onboarding lần đầu (modal + coach marks) → nhập theo BƯỚC (loại dữ liệu → dự án → tải file →
 *   kiểm tra/validation → xác nhận) bằng ngôn ngữ nghiệp vụ, có Sidebar "Hướng dẫn nhanh".
 * Thuật ngữ kỹ thuật (profiler/mapping canonical/lineage/schema…) ẩn sau "Chi tiết kỹ thuật".
 * Phía dưới VẪN là pipeline ETL cũ (profileSheet → suggestMapping → normalize → publish) — chỉ đổi lớp UI.
 * THUẦN CLIENT, không đụng app khác, không server change.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Database, RefreshCw, Upload, Library, Brain, CheckCircle2, AlertTriangle, XCircle,
  ChevronRight, ChevronDown, FileSpreadsheet, Wrench, ArrowRight, FileDown, Bell, X, Rocket, PlayCircle, Info,
} from "lucide-react";
import { getSummaryFile } from "@/lib/mtld-install.functions";
import {
  readWorkbookB64, readWorkbook, sheetRows, profileSheet, suggestMapping, normalize,
  TEMPLATE_TCLD, CONF_AUTO, CONF_ASK,
  type SheetProfile, type MappingSuggestion, type Dataset, type WorkItem,
} from "@/etl";
import { parseTcldTemplate, type TcldParse, type TcldProject } from "@/etl/mtld/tcld-template";
import { extractInstall } from "@/etl/mtld/install";
import { saveDataset, listDatasets, getDataset, type DatasetMeta } from "@/lib/edits.functions";
import type { ProgressRecord } from "@/lib/etl";
import { diagnoseAll } from "@/lib/ai/pmo-engine";
import type { PmoDiagnosis, AlertLevel } from "@/lib/ai/pmo-skill";
import { track } from "@/lib/track";

const SAMPLE_FILE = "1a0i1n9rjtrNUGHtGmuhj4MDQUnR4dJX9";
const SAMPLE_GID = "452283237";
const TPL = TEMPLATE_TCLD;
const FIELD_LABEL: Record<string, string> = Object.fromEntries(TPL.fields.map((f) => [f.field, f.label]));
const LS_ONBOARD = "datastudio_onboarded";
const LS_NOTIFY = "datastudio_notify";

const DATA_TYPES = [
  { id: "tcld", label: "Tiến độ thi công", desc: "Đầu việc, ngày kế hoạch/thực tế, khối lượng", ready: true, soon: "" },
  { id: "manpower", label: "Nhân lực", desc: "Số nhân công theo ngày / tổ đội", ready: false, soon: "Theo dõi biến động nhân lực công trường theo ngày, phát hiện thiếu hụt tổ đội ảnh hưởng tiến độ." },
  { id: "cost", label: "Chi phí", desc: "Ngân sách & giải ngân", ready: false, soon: "Đối chiếu ngân sách kế hoạch vs thực chi, cảnh báo vượt chi theo hạng mục." },
  { id: "risk", label: "Rủi ro & Vướng mắc", desc: "Issue, blocker, mức độ ảnh hưởng", ready: false, soon: "Gom vướng mắc/blocker toàn dự án, xếp mức độ ảnh hưởng để xử lý ưu tiên." },
];
const REQUIRED_COLS = [
  { label: "Tên đầu việc", req: true },
  { label: "Ngày bắt đầu (kế hoạch)", req: false },
  { label: "Ngày kết thúc (kế hoạch)", req: false },
  { label: "Ngày thực tế / % hoàn thành", req: false },
  { label: "Khối lượng (tổng & đã làm)", req: false },
  { label: "Đơn vị tính (ĐVT)", req: false },
];

// ── Adapter: canonical WorkItem[] → ProgressRecord[] để chạy pmo-engine (Chẩn đoán) ──
const isoToVN = (iso?: string) => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return y && m && d ? `${d}/${m}/${y.slice(2)}` : ""; };
const disciplineToStage = (d?: string): string => { const s = (d || "").toLowerCase(); if (/thi\s*công|lắp|install|^tc$/.test(s)) return "TC"; if (/sản\s*xuất|^sx$/.test(s)) return "SX"; if (/vật\s*tư|^vt$/.test(s)) return "VT"; if (/tksx|triển khai/.test(s)) return "TKSX"; if (/mẫu|^ma$/.test(s)) return "MA"; return ""; };
function workItemsToRecords(items: WorkItem[], fallbackProj?: string): ProgressRecord[] {
  const fb = fallbackProj?.trim() || "Dữ liệu chưa gán dự án";
  return items.map((it) => ({
    source: "detail", projectCode: it.project_id || fb, projectName: it.project_id || fb, path: [], level: 2,
    stt: it.work_item_id, name: it.work_item_name, stage: disciplineToStage(it.discipline), owner: "",
    start: isoToVN(it.planned_start), end: isoToVN(it.planned_finish),
    qtyTotal: it.planned_quantity ?? null, qtyDone: it.actual_quantity ?? null,
    unit: it.unit || "", pctPlan: null, pctActual: it.status === "DONE" ? 100 : null, isLeaf: true,
  }));
}
const LV: Record<AlertLevel, { label: string; fg: string; bg: string; dot: string }> = {
  CRITICAL: { label: "Nghiêm trọng", fg: "#b91c1c", bg: "#fef2f2", dot: "#ef4444" },
  HIGH_RISK: { label: "Rủi ro cao", fg: "#c2410c", bg: "#fff7ed", dot: "#f97316" },
  WARNING: { label: "Cần tập trung", fg: "#b45309", bg: "#fffbeb", dot: "#f59e0b" },
  NORMAL: { label: "Bình thường", fg: "#15803d", bg: "#f0fdf4", dot: "#22c55e" },
};
const LV_ORDER: AlertLevel[] = ["CRITICAL", "HIGH_RISK", "WARNING", "NORMAL"];

const Sx = (v: unknown) => (v == null ? "" : String(v).trim());
const isDateish = (v: unknown) => { if (typeof v === "number") return v > 1000; return /\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?/.test(Sx(v)); };

// Tạo file Excel mẫu (10 dòng ngành nội thất/thi công) — client-side, không cần backend.
async function downloadSample() {
  const XLSX = await import("xlsx");
  const aoa: (string | number)[][] = [
    ["Stt", "Mã", "Mô tả", "Người phụ trách", "Bắt đầu", "Kết thúc", "ĐVT", "Khối lượng tổng", "Khối lượng đã làm", "% thực tế"],
    [1, "", "CĂN HỘ MẪU A2-05", "Nguyễn Văn Cừ", "01/08/26", "30/08/26", "", "", "", ""],
    ["1.1", "VT", "Vật tư", "PMH", "01/08/26", "08/08/26", "", "", "", ""],
    ["1.1.1", "", "Gạch bông CT21", "", "01/08/26", "05/08/26", "m2", 46, 46, "100%"],
    ["1.2", "SX", "Sản xuất", "SD", "05/08/26", "22/08/26", "", "", "", ""],
    ["1.2.1", "", "Vách CNC Inox thông tầng", "", "05/08/26", "20/08/26", "m2", 27.46, 8, ""],
    ["1.2.2", "", "Quầy Bar DT1.14", "", "05/08/26", "18/08/26", "bộ", 1, 0, ""],
    ["1.3", "TC", "Thi công", "PM", "10/08/26", "30/08/26", "", "", "", ""],
    ["1.3.1", "", "Lát sàn gạch bông", "", "10/08/26", "20/08/26", "m2", 46, 20, ""],
    ["1.3.2", "", "Sơn hiệu ứng tường", "", "12/08/26", "25/08/26", "m2", 120, 30, ""],
    ["1.3.3", "", "Lắp đèn trang trí", "", "20/08/26", "30/08/26", "bộ", 8, 0, ""],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 7 }, { wch: 6 }, { wch: 30 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 9 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Tiến độ");
  XLSX.writeFile(wb, "mau-tien-do-thi-cong.xlsx");
}

export function DataStudioApp() {
  const [rows, setRows] = useState<(string | number | null)[][] | null>(null);
  const [profile, setProfile] = useState<SheetProfile | null>(null);
  const [mapping, setMapping] = useState<MappingSuggestion[]>([]);
  const [srcName, setSrcName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"import" | "library" | "decision">("import");
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [publishMsg, setPublishMsg] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const [decisionSrc, setDecisionSrc] = useState("import");
  const [libDiags, setLibDiags] = useState<PmoDiagnosis[] | null>(null);
  const [dsBusy, setDsBusy] = useState(false);
  const [dataType, setDataType] = useState("");           // "" = chưa chọn (để progress-step có nghĩa)
  const [projectName, setProjectName] = useState("");
  const [install, setInstall] = useState<TcldParse | null>(null);   // TCLĐ (Thi công lắp đặt) — mẫu dựng sẵn
  const [installName, setInstallName] = useState("");
  const [showTech, setShowTech] = useState(false);
  // Onboarding / UX
  const [showOnboard, setShowOnboard] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const [coachStep, setCoachStep] = useState(-1);         // -1 = off; 0..2
  const [coachRect, setCoachRect] = useState<DOMRect | null>(null);
  const [notify, setNotify] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const dataTypeRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLDivElement>(null);
  const coachRefs = [dataTypeRef, projectRef, uploadRef];

  useEffect(() => {
    try { if (!localStorage.getItem(LS_ONBOARD)) setShowOnboard(true); setNotify(JSON.parse(localStorage.getItem(LS_NOTIFY) || "{}")); } catch { /* ignore */ }
  }, []);
  const loadLib = () => { listDatasets().then((r) => setDatasets(r.datasets)).catch(() => {}); };
  useEffect(() => { loadLib(); }, []);
  useEffect(() => {
    if (decisionSrc === "import") return;
    let off = false; setDsBusy(true); setLibDiags(null);
    getDataset({ data: { id: decisionSrc } }).then((r) => {
      if (off) return;
      if (r.dataset) { const ds = JSON.parse(r.dataset) as Dataset; setLibDiags(diagnoseAll(workItemsToRecords(ds.records, ds.project_id))); }
      setDsBusy(false);
    }).catch(() => { if (!off) setDsBusy(false); });
    return () => { off = true; };
  }, [decisionSrc]);
  // toast tự tắt
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);
  // coach mark: đo vị trí target theo bước
  useLayoutEffect(() => {
    if (coachStep < 0) { setCoachRect(null); return; }
    const el = coachRefs[coachStep]?.current;
    if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); setTimeout(() => setCoachRect(el.getBoundingClientRect()), 60); }
  }, [coachStep]);

  const closeOnboard = (startCoach: boolean) => {
    setShowOnboard(false);
    if (dontShow) { try { localStorage.setItem(LS_ONBOARD, "1"); } catch { /* ignore */ } }
    if (startCoach) setTimeout(() => setCoachStep(0), 250);
  };
  const toggleNotify = (id: string) => setNotify((n) => { const nx = { ...n, [id]: !n[id] }; try { localStorage.setItem(LS_NOTIFY, JSON.stringify(nx)); } catch { /* ignore */ } return nx; });

  const ingest = async (rw: (string | number | null)[][], sheet: string, fileName: string) => {
    const prof = profileSheet(sheet, rw);
    setRows(rw); setProfile(prof); setMapping(suggestMapping(prof.columns, TPL)); setSrcName(fileName);
    setPublished(false); setPublishMsg(null);
  };
  const runSample = async () => {
    if (!dataType) setDataType("tcld");
    setBusy(true); setErr(null);
    try {
      const res = await getSummaryFile({ data: { fileId: SAMPLE_FILE, gid: SAMPLE_GID } });
      if (!res?.b64) throw new Error("Không tải được file mẫu.");
      const wb = await readWorkbookB64(res.b64);
      const name = wb.SheetNames[0];
      await ingest(await sheetRows(wb.Sheets[name]), name, "File mẫu · " + name);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const onFile = async (f?: File) => {
    if (!f) return; setBusy(true); setErr(null); setInstall(null);
    try {
      const wb = await readWorkbook(await f.arrayBuffer());
      // NHẬN DIỆN MẪU TCLĐ (Thi công lắp đặt): sheet có cột maCT + Loại → luồng lắp đặt (bar/heatmap).
      // Dò MỌI sheet, lấy sheet ra nhiều dự án nhất.
      let best: TcldParse | null = null;
      for (const nm of wb.SheetNames) {
        const p = parseTcldTemplate(await sheetRows(wb.Sheets[nm]));
        if (p.projects.length > (best?.projects.length ?? 0)) best = p;
      }
      if (best && best.projects.length) { setInstall(best); setInstallName(f.name); setBusy(false); return; }
      // Không phải mẫu → thử ĐỌC THẲNG FILE MTLĐ GỐC bằng adapter tự nhận dạng (A: nhãn|%, C: bảng HT/ĐT).
      const projName2 = f.name.replace(/\.(xlsx|xls|csv)$/i, "").trim();
      for (const nm of wb.SheetNames) {
        const ex = extractInstall(await sheetRows(wb.Sheets[nm]));
        if (ex.archetype !== "unknown" && ex.zones.length) {
          const proj: TcldProject = {
            maCT: "", name: projName2 || nm, mode: "public",
            zones: ex.zones.map((z) => ({ zone: z.zone, percent: z.avg })),
            rooms: [], cols: [], cells: [], overall: ex.overall, count: ex.rows.length, asOf: ex.asOf,
          };
          setInstall({ projects: [proj], issues: [`Đọc từ file MTLĐ GỐC (adapter tự nhận dạng “${ex.archetype === "A_percent_pairs" ? "nhãn | %" : "bảng HT/ĐT"}”). Cần gán dự án (maCT + tên) ở bước lưu để khớp lên ePMP.`] });
          setInstallName(f.name); setBusy(false); return;
        }
      }
      const name = wb.SheetNames[0];
      await ingest(await sheetRows(wb.Sheets[name]), name, f.name);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const reset = () => { setRows(null); setProfile(null); setMapping([]); setSrcName(""); setErr(null); setPublished(false); setPublishMsg(null); setShowTech(false); setInstall(null); setInstallName(""); };
  const setField = (rawIndex: number, field: string) => setMapping((m) => m.map((s) =>
    s.rawIndex === rawIndex ? { ...s, field: field || null, confidence: field ? 1 : 0, reason: field ? ["chọn tay"] : [] } : s));

  const result = useMemo(() => (rows && profile ? normalize(rows, profile, mapping, TPL, { fileId: SAMPLE_FILE, fileName: srcName }) : null), [rows, profile, mapping, srcName]);
  const diags = useMemo(() => (result ? diagnoseAll(workItemsToRecords(result.records, projectName)) : []), [result, projectName]);

  // Validation theo DÒNG (lớp UI, không đụng data layer): lỗi = thiếu tên; cảnh báo = thiếu/khó đọc ngày.
  const check = useMemo(() => {
    if (!rows || !profile) return null;
    const idx = (f: string) => mapping.find((m) => m.field === f)?.rawIndex ?? -1;
    const nameI = idx("work_item_name"), startI = idx("planned_start"), finishI = idx("planned_finish");
    const dataRows = rows.slice(profile.dataStartRow);
    let valid = 0, warnDate = 0, error = 0;
    const rowStatus: ("ok" | "warn" | "err")[] = [];
    for (const r of dataRows) {
      const name = Sx(r[nameI]);
      if (nameI < 0 || !name) { error++; rowStatus.push("err"); continue; }
      const okStart = startI < 0 || isDateish(r[startI]);
      const okFinish = finishI < 0 || isDateish(r[finishI]);
      if (!okStart || !okFinish) { warnDate++; rowStatus.push("warn"); } else { valid++; rowStatus.push("ok"); }
    }
    const preview = dataRows.slice(0, 5).map((r, i) => ({
      name: Sx(r[nameI]) || "—", start: startI >= 0 ? Sx(r[startI]) : "—", finish: finishI >= 0 ? Sx(r[finishI]) : "—", status: rowStatus[i],
    }));
    const lowConf = mapping.filter((m) => m.field && m.confidence < CONF_ASK);
    return { total: dataRows.length, valid, warnDate, error, preview, lowConf, canConfirm: error === 0 };
  }, [rows, profile, mapping]);

  const publish = async () => {
    if (!result || (check && !check.canConfirm)) return;
    setPublishMsg("Đang lưu…");
    try {
      const nowIso = new Date().toISOString();
      const proj = projectName.trim() || undefined;
      const records = proj ? result.records.map((r) => ({ ...r, project_id: r.project_id || proj })) : result.records;
      const dataset: Dataset = {
        id: `TCLD-${SAMPLE_FILE.slice(0, 8)}-${nowIso.slice(0, 19)}`,
        name: proj ? `${proj} · ${DATA_TYPES.find((d) => d.id === (dataType || "tcld"))?.label ?? TPL.data_type}` : (srcName || TPL.name),
        domain: TPL.domain, project_id: proj, data_type: TPL.data_type,
        schema_version: TPL.version, created_at: nowIso, source_file_id: SAMPLE_FILE, source_file_name: srcName,
        records, quality: result.quality,
        mapping: mapping.filter((m) => m.field).map((m) => ({ raw: m.rawHeader, field: m.field as string, confidence: m.confidence })),
      };
      await saveDataset({ data: { meta: { id: dataset.id, name: dataset.name, domain: dataset.domain, data_type: dataset.data_type, created_at: dataset.created_at, source_file_name: dataset.source_file_name, record_count: dataset.records.length, quality_score: dataset.quality.score, schema_version: dataset.schema_version }, dataset: JSON.stringify(dataset) } });
      // Nhập kho = thêm dữ liệu dùng chung cho cả app → ghi rõ bộ nào, bao nhiêu dòng, nguồn từ đâu.
      track("ds_publish", `${dataset.name} · ${dataset.records.length} dòng · nguồn ${srcName}`);
      setPublished(true); setPublishMsg(null); loadLib();
      setHighlightId(dataset.id); setToast(`Đã nhập ${dataset.records.length} dòng vào Kho dữ liệu.`); setView("library");
    } catch (e) { setPublishMsg("Lỗi: " + (e as Error).message); }
  };

  const step1Done = !!dataType;
  const step3Done = !!profile;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#eef1f4" }}>
      {/* Thanh định danh */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 18px", background: "#0f172a", color: "#e2e8f0", flexShrink: 0 }}>
        <Database className="h-4 w-4" style={{ color: "#5ee9b5" }} />
        <strong style={{ letterSpacing: ".02em", fontSize: 14 }}>Dữ liệu dự án</strong>
        <span style={{ fontSize: 11.5, color: "#94a3b8" }}>Nhập, kiểm tra &amp; quản lý dữ liệu cho phân tích</span>
        <button onClick={() => setShowOnboard(true)} title="Xem lại hướng dẫn" style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, background: "#1e293b", color: "#cbd5e1", border: "1px solid #334155", borderRadius: 6, padding: "3px 9px", fontSize: 11.5, fontWeight: 600 }}><Info className="h-3.5 w-3.5" /> Hướng dẫn</button>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#0f172a", background: "#fbbf24", borderRadius: 5, padding: "2px 7px" }}>ĐANG THỬ NGHIỆM</span>
      </div>
      {/* Thanh tab */}
      <div style={{ display: "flex", gap: 2, padding: "0 14px", background: "#fff", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
        <button onClick={() => setView("import")} style={tab(view === "import")}><Upload className="h-4 w-4" /> Nhập dữ liệu</button>
        <button onClick={() => { setView("library"); loadLib(); }} style={tab(view === "library")}><Library className="h-4 w-4" /> Kho dữ liệu{datasets.length ? ` (${datasets.length})` : ""}</button>
        <button onClick={() => setView("decision")} style={tab(view === "decision")}><Brain className="h-4 w-4" /> Xem nhanh cảnh báo</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {view === "library" && <LibraryList datasets={datasets} onGoImport={() => { reset(); setView("import"); }} highlightId={highlightId} onDiagnose={(id) => { setDecisionSrc(id); setView("decision"); }} />}

        {view === "decision" && (() => {
          const eff = decisionSrc === "import" ? diags : (libDiags ?? []);
          const has = decisionSrc === "import" ? !!result : !!libDiags;
          return <div style={{ padding: 16 }}><DecisionPanel diags={eff} hasData={has} dsBusy={dsBusy} selector={
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "#64748b" }}>Xem cảnh báo từ:</span>
              <select value={decisionSrc} onChange={(e) => setDecisionSrc(e.target.value)} style={selectStyle}>
                <option value="import">Dữ liệu vừa nhập{result ? "" : " (chưa có)"}</option>
                {datasets.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.record_count} dòng</option>)}
              </select>
            </div>
          } /></div>;
        })()}

        {view === "import" && install && (
          <InstallImportPanel parse={install} name={installName} onReset={reset} />
        )}

        {view === "import" && !install && (
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap", maxWidth: 1100, margin: "0 auto", padding: 16 }}>
            {/* CỘT CHÍNH */}
            <div style={{ flex: "1 1 560px", minWidth: 0, display: "grid", gap: 14 }}>
              {err && <div style={box("#b91c1c", "#fef2f2", "#fecaca")}>Không đọc được file: {err}</div>}

              {!profile ? (
                <>
                  <div ref={dataTypeRef}>
                    <StepCard n={1} title="Bạn muốn nhập loại dữ liệu nào?" state={step1Done ? "done" : "current"}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 10 }}>
                        {DATA_TYPES.map((d) => {
                          const on = dataType === d.id;
                          return (
                            <div key={d.id} style={{ position: "relative" }}>
                              <button disabled={!d.ready} onClick={() => d.ready && setDataType(d.id)} title={d.ready ? "" : d.soon}
                                style={{ width: "100%", textAlign: "left", padding: "12px 13px", borderRadius: 10, cursor: d.ready ? "pointer" : "help",
                                  border: on ? "2px solid #0f766e" : "1px solid #e2e8f0", background: on ? "#f0fdfa" : d.ready ? "#fff" : "#f8fafc", opacity: d.ready ? 1 : 0.72 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, color: on ? "#0f766e" : "#475569" }}>
                                  <FileSpreadsheet className="h-5 w-5" /><span style={{ fontWeight: 700, fontSize: 13 }}>{d.label}</span>
                                  {!d.ready && <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 700, color: "#94a3b8", background: "#e2e8f0", borderRadius: 999, padding: "1px 7px" }}>SẮP CÓ</span>}
                                </div>
                                <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 4 }}>{d.desc}</div>
                              </button>
                              {!d.ready && (
                                <button onClick={() => toggleNotify(d.id)}
                                  style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "3px 8px", cursor: "pointer",
                                    border: notify[d.id] ? "1px solid #0f766e" : "1px solid #cbd5e1", background: notify[d.id] ? "#f0fdfa" : "#fff", color: notify[d.id] ? "#0f766e" : "#64748b" }}>
                                  <Bell className="h-3 w-3" /> {notify[d.id] ? "Đã đăng ký nhận báo" : "Đăng ký nhận thông báo"}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </StepCard>
                  </div>

                  <div ref={projectRef}>
                    <StepCard n={2} title="Dữ liệu này của dự án nào?" state={projectName.trim() ? "done" : step1Done ? "current" : "todo"}
                      hint="Không bắt buộc — nếu file đã có cột dự án, để trống cũng được.">
                      <input value={projectName} onChange={(e) => setProjectName(e.target.value)}
                        placeholder="VD: Small Lobby, Villa An Phú… (hoặc để trống)"
                        style={{ width: "100%", maxWidth: 420, fontSize: 13, padding: "9px 12px", borderRadius: 9, border: "1px solid #cbd5e1", color: "#0f172a" }} />
                    </StepCard>
                  </div>

                  <div ref={uploadRef}>
                    <StepCard n={3} title="Tải dữ liệu lên" state={step1Done ? "current" : "todo"} disabled={!step1Done}
                      hint={step1Done ? "" : "Hãy chọn loại dữ liệu ở bước 1 trước."}>
                      <label
                        onDragOver={(e) => { if (step1Done) e.preventDefault(); }}
                        onDrop={(e) => { if (!step1Done) return; e.preventDefault(); void onFile(e.dataTransfer.files?.[0]); }}
                        style={{ display: "block", border: "2px dashed #cbd5e1", borderRadius: 12, padding: "26px 16px", textAlign: "center", cursor: step1Done ? "pointer" : "not-allowed", background: "#fafcff", pointerEvents: step1Done ? "auto" : "none" }}>
                        <Upload className="h-6 w-6" style={{ color: "#94a3b8", margin: "0 auto", display: "block" }} />
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: "#334155", marginTop: 6 }}>Kéo &amp; thả file Excel vào đây</div>
                        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>hoặc bấm để chọn file (.xlsx, .xls)</div>
                        <input type="file" accept=".xlsx,.xls" style={{ display: "none" }} disabled={!step1Done} onChange={(e) => void onFile(e.target.files?.[0])} />
                      </label>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 0" }}>
                        <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} /><span style={{ fontSize: 11, color: "#94a3b8" }}>hoặc</span><div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <button onClick={runSample} disabled={busy} style={secondaryBtn}><RefreshCw className="h-4 w-4" /> {busy ? "Đang đọc…" : "Dùng thử với file mẫu"}</button>
                      </div>
                    </StepCard>
                  </div>
                </>
              ) : check && result ? (
                <>
                  <StepCard n={4} title="Kiểm tra dữ liệu" state={published ? "done" : "current"}>
                    <div style={{ fontSize: 13, color: "#334155", marginBottom: 10 }}>Đã đọc <b>{srcName}</b> — nhận <b>{check.total}</b> dòng.</div>
                    {/* Summary card ✅ ⚠️ ❌ */}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <SumChip tone="ok" icon={<CheckCircle2 className="h-4 w-4" />} n={check.valid} label="dòng hợp lệ" />
                      <SumChip tone="warn" icon={<AlertTriangle className="h-4 w-4" />} n={check.warnDate} label="dòng thiếu/khó đọc ngày" />
                      <SumChip tone="err" icon={<XCircle className="h-4 w-4" />} n={check.error} label="dòng lỗi (thiếu tên)" />
                    </div>

                    {/* Mapping gọn — sửa nếu tên cột lệch (hiện NHÃN nghiệp vụ) */}
                    {check.lowConf.length > 0 && (
                      <div style={{ marginTop: 12, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 12px" }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b45309", marginBottom: 8 }}>⚠ {check.lowConf.length} cột chưa chắc — nhờ bạn xác nhận:</div>
                        <div style={{ display: "grid", gap: 8 }}>
                          {check.lowConf.map((m) => (
                            <div key={m.rawIndex} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 12.5, color: "#0f172a" }}>Cột <b>“{m.rawHeader || `#${m.rawIndex + 1}`}”</b> là</span>
                              <ArrowRight className="h-3.5 w-3.5" style={{ color: "#94a3b8" }} />
                              <select value={m.field ?? ""} onChange={(e) => setField(m.rawIndex, e.target.value)} style={selectStyle}>
                                <option value="">(bỏ qua cột này)</option>
                                {TPL.fields.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Preview 5 dòng đầu — tô đỏ/vàng dòng có vấn đề */}
                    <div style={{ marginTop: 12, overflowX: "auto" }}>
                      <div style={{ fontSize: 11.5, color: "#94a3b8", marginBottom: 6 }}>Xem trước 5 dòng đầu:</div>
                      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5, minWidth: 480 }}>
                        <thead><tr>{["Tên đầu việc", "Bắt đầu", "Kết thúc", "Trạng thái"].map((t) => <th key={t} style={th}>{t}</th>)}</tr></thead>
                        <tbody>
                          {check.preview.map((p, i) => {
                            const bg = p.status === "err" ? "#fef2f2" : p.status === "warn" ? "#fffbeb" : "#fff";
                            return (
                              <tr key={i} style={{ background: bg }}>
                                <td style={td}>{p.name}</td><td style={td}>{p.start}</td><td style={td}>{p.finish}</td>
                                <td style={td}>{p.status === "err" ? <span style={{ color: "#b91c1c", fontWeight: 700 }}>Lỗi</span> : p.status === "warn" ? <span style={{ color: "#b45309", fontWeight: 700 }}>Cảnh báo</span> : <span style={{ color: "#15803d" }}>OK</span>}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </StepCard>

                  <StepCard n={5} title="Xác nhận &amp; lưu vào Kho dữ liệu" state={published ? "done" : "current"}>
                    <div style={{ fontSize: 12.5, color: "#64748b", marginBottom: 10 }}>
                      {check.canConfirm ? <>Dữ liệu sẽ dùng cho: <b style={{ color: "#475569" }}>Tiến độ · Chẩn đoán AI · Báo cáo PMO</b>. Các dòng cảnh báo (⚠️) vẫn nhập kèm ghi chú.</>
                        : <span style={{ color: "#b91c1c" }}>Còn <b>{check.error}</b> dòng lỗi (thiếu tên đầu việc) — sửa trong file rồi tải lại để bật nút xác nhận.</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <button onClick={publish} disabled={published || !check.canConfirm} style={{ ...primaryBtn, opacity: published || !check.canConfirm ? 0.5 : 1, cursor: published || !check.canConfirm ? "not-allowed" : "pointer" }}>
                        <CheckCircle2 className="h-4 w-4" /> {published ? "Đã nhập" : "Xác nhận nhập"}
                      </button>
                      <button onClick={reset} style={secondaryBtn}><Upload className="h-4 w-4" /> Nhập file khác</button>
                      {publishMsg && <span style={{ fontSize: 12.5, fontWeight: 600, color: publishMsg.startsWith("Lỗi") ? "#b91c1c" : "#0f766e" }}>{publishMsg}</span>}
                    </div>
                  </StepCard>

                  {/* CHI TIẾT KỸ THUẬT — progressive disclosure */}
                  <div style={card}>
                    <button onClick={() => setShowTech((s) => !s)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", cursor: "pointer", color: "#475569", fontSize: 12.5, fontWeight: 700, padding: 0 }}>
                      {showTech ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <Wrench className="h-3.5 w-3.5" /> Chi tiết kỹ thuật <span style={{ fontWeight: 400, color: "#94a3b8" }}>(cấu trúc, ánh xạ cột, dữ liệu chuẩn hoá)</span>
                    </button>
                    {showTech && <TechDetail profile={profile} result={result} mapping={mapping} setField={setField} />}
                  </div>
                </>
              ) : null}
            </div>

            {/* SIDEBAR "HƯỚNG DẪN NHANH" */}
            <QuickGuide />
          </div>
        )}
      </div>

      {/* TOAST */}
      {toast && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 60, background: "#0f766e", color: "#fff", borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 600, boxShadow: "0 10px 30px rgba(2,6,23,.3)", display: "flex", alignItems: "center", gap: 8 }}>
          <CheckCircle2 className="h-4 w-4" /> {toast}
        </div>
      )}

      {/* ONBOARDING MODAL */}
      {showOnboard && <OnboardModal dontShow={dontShow} setDontShow={setDontShow} onStart={() => closeOnboard(true)} onSample={() => { closeOnboard(false); void runSample(); }} onClose={() => closeOnboard(false)} />}

      {/* COACH MARKS */}
      {coachStep >= 0 && coachRect && (
        <CoachMark step={coachStep} rect={coachRect} onNext={() => setCoachStep((s) => (s >= 2 ? -1 : s + 1))} onSkip={() => setCoachStep(-1)} />
      )}
    </div>
  );
}

// ── TCLĐ (Thi công lắp đặt): xem trước SAU KHI đọc mẫu dựng sẵn ───────────────
/** Màu theo %: đỏ (0) → hổ phách (50) → xanh (100). Ô chưa có số = xám. */
function pctColor(p: number | null): string {
  if (p == null) return "#e2e8f0";
  const t = Math.max(0, Math.min(100, p)) / 100;
  const h = 0 + t * 140;            // 0=đỏ → 140=xanh lá
  return `hsl(${h} 68% ${88 - t * 26}%)`;
}
function InstallImportPanel({ parse, name, onReset }: { parse: TcldParse; name: string; onReset: () => void }) {
  const { projects, issues } = parse;
  const overallAll = (() => { const v = projects.map((p) => p.overall).filter((x): x is number => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; })();
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16, display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#0f766e", color: "#fff", borderRadius: 12, padding: "12px 16px" }}>
        <FileSpreadsheet className="h-5 w-5" />
        <div>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Thi công lắp đặt · đã đọc {projects.length} dự án</div>
          <div style={{ fontSize: 11.5, color: "#c7f0ea" }}>Nguồn: {name}{overallAll != null ? ` · trung bình ${overallAll}%` : ""}</div>
        </div>
        <button onClick={onReset} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,.15)", color: "#fff", border: "1px solid rgba(255,255,255,.3)", borderRadius: 7, padding: "5px 11px", fontSize: 12, fontWeight: 600 }}><Upload className="h-3.5 w-3.5" /> Nhập file khác</button>
      </div>

      {issues.length > 0 && (
        <div style={box("#b45309", "#fffbeb", "#fde68a")}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠ {issues.length} điểm cần lưu ý ở file:</div>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 2 }}>{issues.slice(0, 12).map((s, i) => <li key={i} style={{ fontSize: 12 }}>{s}</li>)}</ul>
        </div>
      )}

      {projects.map((p, i) => <InstallProjectCard key={i} p={p} />)}

      <div style={{ fontSize: 12, color: "#64748b", background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: 10, padding: "10px 12px" }}>
        Đây là <b>xem trước</b> — kiểm tra Data Studio đã đọc đúng file chưa. Bước tiếp: <b>lưu vào kho</b> (khớp theo maCT + tên) &amp; hiện chart này lên <b>popup TCLĐ bên ePMP</b>.
      </div>
    </div>
  );
}
function InstallProjectCard({ p }: { p: TcldProject }) {
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "#0f766e", background: "#f0fdfa", border: "1px solid #99f6e4", borderRadius: 5, padding: "1px 6px" }}>{p.maCT || "—"}</span>
        <strong style={{ fontSize: 13.5, color: "#0f172a" }}>{p.name || "(chưa có tên)"}</strong>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: p.mode === "phong" ? "#7c3aed" : "#0369a1", background: p.mode === "phong" ? "#f5f3ff" : "#f0f9ff", borderRadius: 999, padding: "1px 8px" }}>{p.mode === "phong" ? "Phòng · heatmap" : "Public · biểu đồ cột"}</span>
        {p.overall != null && <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800, color: "#0f766e" }}>Tổng {p.overall}%</span>}
      </div>
      {p.mode === "public" ? (
        <div style={{ display: "grid", gap: 5 }}>
          {p.zones.map((z, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "150px 1fr 44px", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={z.zone}>{z.zone}</span>
              <div style={{ height: 14, background: "#eef2f7", borderRadius: 4, overflow: "hidden" }}><div style={{ height: "100%", width: `${z.percent ?? 0}%`, background: pctColor(z.percent), transition: "width .2s" }} /></div>
              <span style={{ fontSize: 11.5, fontWeight: 700, textAlign: "right", color: z.percent == null ? "#cbd5e1" : "#334155", fontVariantNumeric: "tabular-nums" }}>{z.percent == null ? "—" : `${z.percent}%`}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead><tr><th style={{ ...hmCell, background: "#fff", position: "sticky", left: 0 }} /> {p.cols.map((c) => <th key={c} style={{ ...hmCell, fontWeight: 700, color: "#475569" }}>{c}</th>)}</tr></thead>
            <tbody>
              {p.rooms.map((rm) => (
                <tr key={rm}>
                  <td style={{ ...hmCell, fontWeight: 700, color: "#334155", textAlign: "left", background: "#fff", position: "sticky", left: 0, whiteSpace: "nowrap" }}>{rm}</td>
                  {p.cols.map((c) => { const cell = p.cells.find((x) => x.row === rm && x.col === c); const v = cell?.percent ?? null; return <td key={c} title={`${rm} · ${c}: ${v == null ? "—" : v + "%"}`} style={{ ...hmCell, background: pctColor(v), color: v != null && v >= 55 ? "#052e16" : "#334155", fontWeight: 600 }}>{v == null ? "" : v}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
const hmCell: CSSProperties = { border: "1px solid #e2e8f0", padding: "3px 8px", textAlign: "center", minWidth: 40, fontVariantNumeric: "tabular-nums" };

// ── Onboarding modal ────────────────────────────────────────────────────────
function OnboardModal({ dontShow, setDontShow, onStart, onSample, onClose }: { dontShow: boolean; setDontShow: (v: boolean) => void; onStart: () => void; onSample: () => void; onClose: () => void }) {
  const steps = [
    { icon: <FileSpreadsheet className="h-6 w-6" />, t: "Chọn loại dữ liệu", d: "Tiến độ, nhân lực, chi phí, rủi ro" },
    { icon: <Upload className="h-6 w-6" />, t: "Tải file Excel lên", d: "Hệ thống tự kiểm tra & chuẩn hoá" },
    { icon: <AlertTriangle className="h-6 w-6" />, t: "Xem cảnh báo", d: "Engine chẩn đoán đánh giá 4 mức rủi ro" },
  ];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, maxWidth: 640, width: "100%", padding: "26px 26px 20px", boxShadow: "0 24px 60px rgba(2,6,23,.4)", position: "relative" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, color: "#94a3b8" }}><X className="h-5 w-5" /></button>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#0f172a" }}>Chào mừng đến Data Studio 👋</h2>
        <p style={{ margin: "6px 0 20px", fontSize: 13, color: "#64748b" }}>Đưa dữ liệu dự án vào hệ thống chỉ với 3 bước — không cần biết kỹ thuật.</p>
        <div style={{ display: "flex", alignItems: "stretch", gap: 8, marginBottom: 22 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
              <div style={{ flex: 1, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 12px", textAlign: "center" }}>
                <div style={{ color: "#0f766e", display: "flex", justifyContent: "center", marginBottom: 6 }}>{s.icon}</div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>{i + 1}. {s.t}</div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 3, lineHeight: 1.4 }}>{s.d}</div>
              </div>
              {i < 2 && <ChevronRight className="h-5 w-5" style={{ color: "#cbd5e1", flexShrink: 0 }} />}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button onClick={onStart} style={{ ...primaryBtn, padding: "10px 20px" }}><Rocket className="h-4 w-4" /> Bắt đầu ngay</button>
          <button onClick={onSample} style={secondaryBtn}><PlayCircle className="h-4 w-4" /> Dùng thử với file mẫu</button>
          <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748b", cursor: "pointer" }}>
            <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} /> Không hiển thị lại
          </label>
        </div>
      </div>
    </div>
  );
}

// ── Coach mark ──────────────────────────────────────────────────────────────
function CoachMark({ step, rect, onNext, onSkip }: { step: number; rect: DOMRect; onNext: () => void; onSkip: () => void }) {
  const texts = [
    { t: "Chọn loại dữ liệu", d: "Bắt đầu bằng cách chọn loại dữ liệu muốn nhập. Hiện đã hỗ trợ Tiến độ thi công." },
    { t: "Gán dự án (không bắt buộc)", d: "Nhập tên dự án để nhóm dữ liệu; hoặc để trống nếu file đã có cột dự án." },
    { t: "Tải file lên", d: "Kéo-thả file Excel hoặc dùng file mẫu — hệ thống sẽ tự kiểm tra và chuẩn hoá." },
  ];
  const c = texts[step];
  const top = Math.min(rect.bottom + 10, window.innerHeight - 150);
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - 320));
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 65 }}>
      <div onClick={onSkip} style={{ position: "absolute", inset: 0, background: "rgba(15,23,42,.45)" }} />
      {/* Ô sáng quanh target */}
      <div style={{ position: "fixed", top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12, border: "2px solid #2dd4bf", borderRadius: 12, boxShadow: "0 0 0 9999px rgba(15,23,42,.45)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", top, left, width: 300, background: "#fff", borderRadius: 12, padding: "13px 15px", boxShadow: "0 16px 40px rgba(2,6,23,.4)" }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: "#0f172a" }}>{c.t}</div>
        <div style={{ fontSize: 12, color: "#64748b", margin: "5px 0 11px", lineHeight: 1.5 }}>{c.d}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>{step + 1}/3</span>
          <button onClick={onSkip} style={{ marginLeft: "auto", fontSize: 12, color: "#64748b", fontWeight: 600 }}>Bỏ qua</button>
          <button onClick={onNext} style={{ ...primaryBtn, padding: "6px 14px", fontSize: 12.5 }}>{step >= 2 ? "Xong" : "Tiếp"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Sidebar hướng dẫn nhanh ─────────────────────────────────────────────────
function QuickGuide() {
  const [open, setOpen] = useState(true);
  return (
    <aside style={{ flex: "0 0 300px", minWidth: 260, position: "sticky", top: 0 }}>
      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <button onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "12px 14px", background: "#0f172a", color: "#e2e8f0", border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
          <Info className="h-4 w-4" style={{ color: "#5ee9b5" }} /> Hướng dẫn nhanh <span style={{ marginLeft: "auto" }}>{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
        </button>
        {open && (
          <div style={{ padding: "14px 15px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>File cần có các cột:</div>
            <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
              {REQUIRED_COLS.map((c) => (
                <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#334155" }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: c.req ? "#0f766e" : "#cbd5e1", flexShrink: 0 }} />
                  <span>{c.label}</span>
                  {c.req ? <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 700, color: "#0f766e", background: "#e7f4ec", borderRadius: 999, padding: "1px 7px" }}>BẮT BUỘC</span>
                    : <span style={{ marginLeft: "auto", fontSize: 9.5, color: "#94a3b8" }}>tuỳ chọn</span>}
                </div>
              ))}
            </div>
            <button onClick={() => void downloadSample()} style={{ ...secondaryBtn, width: "100%", justifyContent: "center", marginBottom: 8 }}><FileDown className="h-4 w-4" /> Tải file Excel mẫu</button>
            <a href="#" onClick={(e) => e.preventDefault()} style={{ display: "block", textAlign: "center", fontSize: 11.5, color: "#94a3b8", textDecoration: "underline" }}>Xem video/GIF hướng dẫn</a>
            <div style={{ marginTop: 12, fontSize: 11, color: "#94a3b8", lineHeight: 1.5, borderTop: "1px solid #f1f5f9", paddingTop: 10 }}>
              Mẹo đánh STT: số nguyên = dự án (1, 2…); có dấu chấm = cấp con (1.1, 1.2.3); chữ a/b/c = con của dòng số ngay trên.
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

// ── Chi tiết kỹ thuật ───────────────────────────────────────────────────────
function TechDetail({ profile, result, mapping, setField }: { profile: SheetProfile; result: NonNullable<ReturnType<typeof normalize>>; mapping: MappingSuggestion[]; setField: (i: number, f: string) => void }) {
  return (
    <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={subCard}>
          <h4 style={h4}>Structure Profiler</h4>
          <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.7 }}>Sheet <b>{profile.name}</b> · {profile.rows} hàng × {profile.cols} cột<br />Header dò ở hàng <b>{profile.headerRow + 1}</b> · dữ liệu từ hàng {profile.dataStartRow + 1}</div>
        </div>
        <div style={subCard}>
          <h4 style={h4}>Data Quality</h4>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: qColor(result.quality.score) }}>{result.quality.score}%</span>
            <span style={{ fontSize: 11.5, color: "#64748b" }}>Completeness {result.quality.completeness}% · Validity {result.quality.validity}% · Uniqueness {result.quality.uniqueness}%</span>
          </div>
        </div>
      </div>
      <div style={subCard}>
        <h4 style={h4}>Semantic Mapping <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: 11.5 }}>· cột thô → canonical field</span></h4>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12, minWidth: 560 }}>
            <thead><tr>{["Cột thô", "→ Canonical field", "Confidence", "Lý do"].map((t) => <th key={t} style={th}>{t}</th>)}</tr></thead>
            <tbody>
              {mapping.map((m) => (
                <tr key={m.rawIndex}>
                  <td style={td}><b style={{ color: "#0f172a" }}>{m.rawHeader || <i style={{ color: "#94a3b8" }}>(cột {m.rawIndex + 1})</i>}</b></td>
                  <td style={td}>
                    <select value={m.field ?? ""} onChange={(e) => setField(m.rawIndex, e.target.value)} style={{ fontSize: 11.5, padding: "3px 6px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", color: m.field ? "#0f172a" : "#94a3b8", fontFamily: "ui-monospace, monospace" }}>
                      <option value="">(bỏ qua)</option>
                      {TPL.fields.map((f) => <option key={f.field} value={f.field}>{f.field}</option>)}
                    </select>
                  </td>
                  <td style={td}>{m.field ? <span style={confChip(m.confidence)}>{Math.round(m.confidence * 100)}%</span> : <span style={{ color: "#94a3b8", fontSize: 11 }}>—</span>}</td>
                  <td style={{ ...td, color: "#64748b" }}>{m.reason[0] ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div style={subCard}>
        <h4 style={h4}>Canonical Preview <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: 11.5 }}>· {result.records.length} WorkItem (5 dòng · kèm lineage)</span></h4>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11.5, minWidth: 720 }}>
            <thead><tr>{["work_item_id", "work_item_name", "discipline", "planned_start→finish", "KL (KH/TT)", "unit", "status", "src_row"].map((t) => <th key={t} style={{ ...th, fontFamily: "ui-monospace, monospace" }}>{t}</th>)}</tr></thead>
            <tbody>
              {result.records.slice(0, 5).map((it, i) => (
                <tr key={i}>
                  <td style={{ ...td, fontFamily: "ui-monospace, monospace" }}>{it.work_item_id}</td>
                  <td style={td}>{it.work_item_name}</td><td style={td}>{it.discipline ?? "—"}</td>
                  <td style={td}>{(it.planned_start ?? "?") + " → " + (it.planned_finish ?? "?")}</td>
                  <td style={td}>{(it.planned_quantity ?? "—") + " / " + (it.actual_quantity ?? "—")}</td>
                  <td style={td}>{it.unit ?? "—"}</td><td style={td}>{it.status ?? "—"}</td>
                  <td style={{ ...td, color: "#94a3b8" }}>{it.lineage.source_row}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Presentational bits ─────────────────────────────────────────────────────
function StepCard({ n, title, children, state, hint, disabled }: { n: number; title: string; children: ReactNode; state: "todo" | "current" | "done"; hint?: string; disabled?: boolean }) {
  const badge = state === "done" ? { bg: "#0f766e", fg: "#fff", txt: "✓" } : state === "current" ? { bg: "#0f766e", fg: "#fff", txt: String(n) } : { bg: "#e2e8f0", fg: "#94a3b8", txt: String(n) };
  return (
    <div style={{ ...card, opacity: disabled ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ width: 24, height: 24, borderRadius: 999, background: badge.bg, color: badge.fg, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 800, flexShrink: 0 }}>{badge.txt}</span>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: state === "todo" ? "#94a3b8" : "#0f172a" }}>{title}</h3>
        {hint && <span style={{ fontSize: 11.5, color: "#94a3b8" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}
function SumChip({ tone, icon, n, label }: { tone: "ok" | "warn" | "err"; icon: ReactNode; n: number; label: string }) {
  const c = tone === "ok" ? { fg: "#15803d", bg: "#f0fdf4", bd: "#bbf7d0" } : tone === "warn" ? { fg: "#b45309", bg: "#fffbeb", bd: "#fde68a" } : { fg: "#b91c1c", bg: "#fef2f2", bd: "#fecaca" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 9, padding: "7px 12px" }}>
      <span style={{ color: c.fg }}>{icon}</span><strong style={{ fontSize: 17, color: c.fg }}>{n}</strong><span style={{ fontSize: 11.5, color: c.fg, fontWeight: 600 }}>{label}</span>
    </div>
  );
}

const box = (fg: string, bg: string, bd: string): CSSProperties => ({ fontSize: 12.5, color: fg, background: bg, border: `1px solid ${bd}`, borderRadius: 8, padding: "8px 12px" });
const card: CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "16px 18px", boxShadow: "0 1px 2px rgba(2,6,23,.04)" };
const subCard: CSSProperties = { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px" };
const h4: CSSProperties = { margin: "0 0 8px", fontSize: 12.5, fontWeight: 700, color: "#0f172a" };
const th: CSSProperties = { textAlign: "left", padding: "7px 10px", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: "#64748b", borderBottom: "1px solid #e2e8f0", background: "#f1f5f9" };
const td: CSSProperties = { padding: "7px 10px", borderBottom: "1px solid #f1f5f9", color: "#334155", whiteSpace: "nowrap" };
const qColor = (s: number) => (s >= 90 ? "#15803d" : s >= 70 ? "#b45309" : "#b91c1c");
function confChip(c: number): CSSProperties {
  const on = c >= CONF_AUTO, ask = c < CONF_ASK;
  return { fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, color: on ? "#15803d" : ask ? "#b91c1c" : "#b45309", background: on ? "#e7f4ec" : ask ? "#fbe9e9" : "#fbf1e3" };
}
const tab = (on: boolean): CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 6, padding: "11px 16px", fontSize: 13, fontWeight: 600, color: on ? "#0f766e" : "#64748b", background: "transparent", border: "none", borderBottom: on ? "2px solid #0f766e" : "2px solid transparent", cursor: "pointer" });
const primaryBtn: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, background: "#0f766e", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const secondaryBtn: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", color: "#334155", border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const selectStyle: CSSProperties = { fontSize: 12.5, padding: "5px 8px", borderRadius: 7, border: "1px solid #cbd5e1", background: "#fff", color: "#0f172a", maxWidth: 360 };

function LibraryList({ datasets, onGoImport, highlightId, onDiagnose }: { datasets: DatasetMeta[]; onGoImport: () => void; highlightId: string | null; onDiagnose: (id: string) => void }) {
  if (!datasets.length) return (
    <div style={{ maxWidth: 560, margin: "40px auto 0", textAlign: "center", padding: 16 }}>
      <Library className="h-9 w-9" style={{ color: "#cbd5e1", margin: "0 auto 12px", display: "block" }} />
      <div style={{ fontSize: 15, fontWeight: 700, color: "#334155" }}>Kho dữ liệu đang trống</div>
      <div style={{ fontSize: 13, color: "#64748b", margin: "6px 0 16px", lineHeight: 1.6 }}>Nơi lưu mọi bộ dữ liệu đã kiểm tra &amp; chuẩn hoá — để tiến độ, chẩn đoán AI và báo cáo cùng dùng chung một nguồn.</div>
      <button onClick={onGoImport} style={primaryBtn}><Upload className="h-4 w-4" /> Nhập dữ liệu đầu tiên</button>
    </div>
  );
  const byProj = new Map<string, DatasetMeta[]>();
  for (const d of datasets) { const k = d.name.split(" · ")[0] || "Khác"; (byProj.get(k) ?? byProj.set(k, []).get(k)!).push(d); }
  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 1000, margin: "0 auto", padding: 16 }}>
      {highlightId && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#f0fdfa", border: "1px solid #99f6e4", borderRadius: 10, padding: "10px 14px", flexWrap: "wrap" }}>
          <CheckCircle2 className="h-4 w-4" style={{ color: "#0f766e" }} />
          <span style={{ fontSize: 12.5, color: "#0f766e", fontWeight: 600 }}>Dữ liệu đã sẵn sàng → Chạy chẩn đoán ngay</span>
          <button onClick={() => onDiagnose(highlightId)} style={{ ...primaryBtn, marginLeft: "auto", padding: "6px 14px", fontSize: 12.5 }}><Brain className="h-4 w-4" /> Xem cảnh báo</button>
        </div>
      )}
      {[...byProj.entries()].map(([proj, list]) => (
        <div key={proj}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "#334155", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>{proj}</div>
          <div style={{ display: "grid", gap: 10 }}>
            {list.map((d) => (
              <div key={d.id} style={{ ...card, display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center", padding: "13px 16px", border: d.id === highlightId ? "2px solid #0f766e" : "1px solid #e2e8f0" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: "#0f172a" }}>{d.name}</div>
                  <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 3 }}>{d.data_type} · {d.record_count} dòng · cập nhật {new Date(d.created_at).toLocaleString("vi-VN")}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 20, fontWeight: 800, color: qColor(d.quality_score) }}>{d.quality_score}%</span>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>độ hoàn chỉnh</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DecisionPanel({ diags, hasData, selector, dsBusy }: { diags: PmoDiagnosis[]; hasData: boolean; selector?: ReactNode; dsBusy?: boolean }) {
  const counts: Record<AlertLevel, number> = { CRITICAL: 0, HIGH_RISK: 0, WARNING: 0, NORMAL: 0 };
  diags.forEach((d) => counts[d.pmo_diagnosis.overall_status]++);
  const sorted = diags.slice().sort((a, b) => LV_ORDER.indexOf(a.pmo_diagnosis.overall_status) - LV_ORDER.indexOf(b.pmo_diagnosis.overall_status));
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 1000, margin: "0 auto" }}>
      {selector}
      {dsBusy ? <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Đang tải dữ liệu…</div>
        : !hasData ? (
          <div style={{ maxWidth: 520, margin: "24px auto 0", textAlign: "center" }}>
            <Brain className="h-9 w-9" style={{ color: "#cbd5e1", margin: "0 auto 12px", display: "block" }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: "#334155" }}>Chưa có dữ liệu để cảnh báo</div>
            <div style={{ fontSize: 13, color: "#64748b", marginTop: 6, lineHeight: 1.6 }}>Chọn một bộ dữ liệu ở trên, hoặc sang tab <b>Nhập dữ liệu</b>. Cảnh báo chuyên sâu &amp; hành động nằm ở app <b>Trợ lý PMO</b>.</div>
          </div>
        )
        : <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {LV_ORDER.map((lv) => (
              <div key={lv} style={{ display: "flex", alignItems: "center", gap: 8, background: LV[lv].bg, border: `1px solid ${LV[lv].dot}44`, borderRadius: 10, padding: "8px 14px" }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: LV[lv].dot }} />
                <strong style={{ fontSize: 20, color: LV[lv].fg }}>{counts[lv]}</strong>
                <span style={{ fontSize: 11.5, color: LV[lv].fg, fontWeight: 600 }}>{LV[lv].label}</span>
              </div>
            ))}
          </div>
          {sorted.map((d) => {
            const lv = LV[d.pmo_diagnosis.overall_status];
            return (
              <div key={d.project_id} style={{ ...card, borderLeft: `4px solid ${lv.dot}` }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: "2px 9px", color: "#fff", background: lv.dot }}>{lv.label.toUpperCase()}</span>
                  <strong style={{ fontSize: 14, color: "#0f172a" }}>{d.project_id}</strong>
                  {d.pmo_diagnosis.critical_bottleneck_stage && <span style={{ fontSize: 10.5, color: "#334155", background: "#e2e8f0", borderRadius: 999, padding: "2px 9px" }}>Nghẽn: {d.pmo_diagnosis.critical_bottleneck_stage}</span>}
                  {d.pmo_diagnosis.delay_days_vs_bot > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, color: "#b91c1c", background: "#fef2f2", borderRadius: 999, padding: "2px 9px" }}>Trễ {d.pmo_diagnosis.delay_days_vs_bot} ngày</span>}
                </div>
                <div style={{ marginTop: 8, fontSize: 12.5, color: "#334155", lineHeight: 1.5 }}>{d.pmo_diagnosis.root_cause_summary}</div>
                <div style={{ marginTop: 8, background: "#f8fafc", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, color: "#0f172a", fontWeight: 600 }}>▶ {d.decision_making.primary_action}</div>
              </div>
            );
          })}
        </>}
    </div>
  );
}
