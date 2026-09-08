/**
 * APP SHELL — "app trong app": thanh dọc bên TRÁI (thu/mở) để chuyển giữa NHIỀU ứng dụng
 * trong 1 đường link. Hiện có: ePMP · Project Master Plan (app gốc) + MTLĐ (đặt sẵn).
 *
 * VÌ SAO TÁCH RIÊNG & DỄ GỠ: app ePMP được TRUYỀN VÀO qua prop `epmpApp` (không import từ
 * routes/index.tsx) → file này KHÔNG phụ thuộc app cũ, không gây lỗi vòng, gỡ ra rất gọn.
 *
 * ─── CÁCH GỠ BỎ HOÀN TOÀN (nếu không dùng nữa) ─────────────────────────────────────────
 *   1) routes/index.tsx: đổi `component: () => <AppShell epmpApp={<Dashboard/>} />` TRỞ LẠI
 *      `component: Dashboard`; xoá dòng `import { AppShell } ...`.
 *   2) lib/flags.ts: xoá "appShell" khỏi FeatureName + MATRIX (và test tương ứng).
 *   3) Xoá file này.
 *   → App ePMP trở lại y hệt như cũ, KHÔNG dính lỗi.
 *
 * AN TOÀN (vì sao không đụng app đang chạy):
 *   • Bọc sau cờ `appShell` = { dev:true, live:false } → bản LIVE không hiện thanh, render
 *     thẳng app ePMP như cũ.
 *   • Thanh chỉ hiện SAU khi mount (client-only) + lần render đầu = "live" → KHÔNG lệch hydration.
 *   • App ePMP LUÔN nằm trong CÙNG một ô nội dung → bật/tắt thanh KHÔNG remount app (không mất
 *     state, không refetch dữ liệu).
 *   • Thanh khi mở rộng PHỦ ĐÈ (overlay), KHÔNG đẩy nội dung → app ePMP không phải reflow.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, LineChart, ListTree, Brain, Database, BarChart3, Video, Images, PanelLeftClose, PanelLeftOpen, RefreshCw, Maximize2, X } from "lucide-react";
import { detectStage, featureOn, type Stage } from "@/lib/flags";
import { whoami } from "@/lib/activity.functions";
import { fetchUserRoles } from "@/lib/edits.functions";
import { roleOf, type UserRole } from "@/lib/roles";
import { useIsMobile } from "@/lib/use-breakpoint";
import { useXemNhuUser, datXemNhuUser } from "@/lib/view-as";
import { track } from "@/lib/track";
import { getInstallList, getSheetPdf } from "@/lib/mtld-install.functions";
import { MatrixFormEditor } from "@/lib/matrix-form-editor";
import { DetailPlanApp } from "@/lib/detail-plan-app";
import { PmoAiApp } from "@/lib/pmo-ai-app";
import { DataStudioApp } from "@/lib/data-studio-app";
import { PerfChartApp } from "@/lib/perf-chart-app";
import { CanMediaApp } from "@/lib/can-media-app";

const RAIL_W = 52;        // bề rộng thanh khi THU (icon)
const RAIL_W_OPEN = 214;  // bề rộng khi MỞ (overlay)

type AppDef = { id: string; name: string; sub: string; icon: ReactNode; live?: boolean; adminPmoOnly?: boolean; roleOnly?: UserRole[] };
// `live: true` = hiện cả trên bản chính thức. Không có = CHỈ hiện ở dev (tính năng đang làm dở).
// `adminPmoOnly: true` = trên bản live CHỈ admin/PMO thấy (người thường không thấy trong rail).
// `roleOnly: [...]`    = chỉ người ĐƯỢC PHÂN CẤP trong danh sách đó (+ admin) thấy. Dùng cho số
//                        sản lượng / doanh thu / hiệu suất nhân sự: không phải ai cũng được xem.
const APPS: AppDef[] = [
  { id: "epmp", name: "Project Master Plan", sub: "ePMP · PMO", icon: <LayoutDashboard className="h-5 w-5" />, live: true },
  { id: "mtld", name: "MTLĐ", sub: "Biểu đồ tiến độ", icon: <LineChart className="h-5 w-5" />, live: true, adminPmoOnly: true },
  { id: "detail", name: "DST", sub: "Theo dõi tiến độ chi tiết", icon: <ListTree className="h-5 w-5" />, live: true },
  { id: "pmoai", name: "Trợ lý PMO", sub: "Cảnh báo & quyết định", icon: <Brain className="h-5 w-5" /> },
  { id: "datastudio", name: "Dữ liệu dự án", sub: "Nhập & quản lý dữ liệu", icon: <Database className="h-5 w-5" /> },
  { id: "perf", name: "Hiệu suất dự án", sub: "Doanh thu / Nhân sự", icon: <BarChart3 className="h-5 w-5" />, live: true, roleOnly: ["BOD", "PMO", "PM"] },
  // ĐANG DỰNG (dev-only) — Media công trường: chọn dự án → ma trận → click ô căn → xem/tải ảnh+video.
  // GỘP 04/09/2026: app cũ "Video tại công trường" (clipcan) đã BỎ — Media là bản duy nhất, cùng
  // một cây Drive chuẩn (xem can-media.functions.ts). Đừng dựng lại app cũ.
  { id: "media", name: "Hình ảnh mỗi ngày", sub: "Ma trận + ảnh/video theo căn", icon: <Images className="h-5 w-5" />, live: true },
];

export function AppShell({ epmpApp }: { epmpApp: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [stage, setStage] = useState<Stage>("live"); // "live" ở lần render đầu → tránh lệch hydration
  const [activeApp, setActiveApp] = useState("epmp");
  const [open, setOpen] = useState(false);
  const [wantProject, setWantProject] = useState<string | null>(null);   // dự án cần mở sẵn khi nhảy app
  // ĐIỆN THOẠI: KHÔNG chừa chỗ cố định cho rail (52px là 14% bề ngang máy 375px) — rail thành DRAWER
  // trượt đè lên nội dung, mở bằng nút tròn góc dưới-trái (tầm ngón cái, thao tác 1 tay).
  const isMobile = useIsMobile();
  useEffect(() => { setMounted(true); setStage(detectStage()); }, []);
  // Dashboard ePMP bấm nút "Video" của 1 dự án → nhảy sang app Media và chọn sẵn dự án đó.
  // (Gộp 04/09: app cũ "Video tại công trường" đã bỏ, Media là chỗ duy nhất xem/tải ảnh-video.)
  useEffect(() => {
    const go = (e: Event) => {
      const d = (e as CustomEvent<{ app?: string; project?: string }>).detail || {};
      if (!d.app) return;
      setActiveApp(d.app); setWantProject(d.project ?? null); setOpen(false);
      // Ghi TÊN app chứ không phải mã ("media" → "Media công trường"): nhật ký để người đọc, không phải máy.
      const ten = APPS.find((a) => a.id === d.app)?.name ?? d.app;
      track("open_app", `${ten}${d.project ? " · " + d.project : ""}`);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("epmp:open-app", go);
    return () => window.removeEventListener("epmp:open-app", go);
  }, []);

  const shellOn = mounted && featureOn("appShell", stage);
  // Quyền: 1 số app (adminPmoOnly) trên bản live CHỈ admin/PMO thấy. devAs = giả lập ?as= khi dev.
  const devAs = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("as") : null;
  const meQ = useQuery({ queryKey: ["shell-whoami", devAs], queryFn: () => whoami({ data: { devAs } }) });
  const rolesQ = useQuery({ queryKey: ["shell-roles"], queryFn: () => fetchUserRoles(), staleTime: 5 * 60 * 1000 });
  const xemNhuUser = useXemNhuUser();
  const myRoleThat = meQ.data?.email ? roleOf(rolesQ.data?.roles ?? {}, meQ.data.email) : null;
  const canManageThat = !!(meQ.data?.isAdmin || myRoleThat === "PMO");
  // Đang xem như người thường thì rail cũng phải giấu app riêng, kẻo vẫn thấy MTLĐ với Hiệu suất.
  const myRole = xemNhuUser ? null : myRoleThat;
  const canManage = !xemNhuUser && canManageThat;
  /* Bật chế độ này thì menu quản trị biến mất theo, nên phải chừa một lối ra. Pill nhỏ, mờ,
     nằm góc dưới trái, và print:hidden nên không lọt vào ảnh chụp hay bản PDF xuất ra. */
  const chotThoat = xemNhuUser && canManageThat ? (
    <button type="button" onClick={() => datXemNhuUser(false)}
      title="Đang xem bằng con mắt người dùng thường — bấm để trở lại quyền quản trị"
      className="fixed bottom-3 left-3 z-[70] inline-flex items-center gap-1.5 rounded-full border border-sky-300 bg-sky-50/95 px-2.5 py-1 text-[11px] font-semibold text-sky-800 shadow-sm hover:bg-sky-100 print:hidden">
      <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
      Đang xem như người dùng thường · Thoát
    </button>
  ) : null;
  // Trên bản chính thức (live) chỉ hiện app có cờ `live`, app adminPmoOnly chỉ khi là admin/PMO,
  // app roleOnly chỉ khi cấp của người dùng nằm trong danh sách (admin luôn thấy hết).
  const visibleApps = APPS.filter((a) => (stage === "live" ? a.live : true)
    && (!a.adminPmoOnly || canManage)
    && (!a.roleOnly || meQ.data?.isAdmin || (myRole && a.roleOnly.includes(myRole))));
  // App đang chọn phải nằm trong danh sách được phép; nếu không (vd người thường lỡ ở mtld) → về ePMP.
  const effectiveApp = visibleApps.some((a) => a.id === activeApp) ? activeApp : "epmp";
  // Nội dung = app đang chọn. `epmpApp` LUÔN nằm ở đây (không remount khi bật/tắt thanh).
  const content = shellOn && effectiveApp === "mtld" ? <MtldApp />
    : shellOn && effectiveApp === "detail" ? <DetailPlanApp />
    : shellOn && effectiveApp === "pmoai" ? <PmoAiApp />
    : shellOn && effectiveApp === "datastudio" ? <DataStudioApp />
    : shellOn && effectiveApp === "perf" ? <PerfChartApp />
    : shellOn && effectiveApp === "media" ? <CanMediaApp wantProject={wantProject} />
    : epmpApp;

  return (
    // Cờ TẮT (live) → không style: 2 div bọc thành block TRONG SUỐT, app ePMP render y hệt như
    // cũ. Cờ BẬT (dev) → flex để chừa chỗ cho rail. Cấu trúc div KHÔNG đổi → app KHÔNG remount.
    <div style={shellOn ? { display: "flex", minHeight: "100vh" } : undefined}>
      {chotThoat}
      {/* THANH RAIL + backdrop: PORTAL ra document.body để THOÁT khỏi flex container này —
          nằm trong flex, `width` của rail bị co về bề rộng nội dung (quirk), nên phải portal
          (giống cách app xử lý modal). SSR không có document → bỏ qua (rail vốn chỉ hiện ở client). */}
      {shellOn && typeof document !== "undefined" && createPortal(
        <>
          {open && (
            <div onClick={() => setOpen(false)}
                 style={{ position: "fixed", inset: 0, zIndex: 44, background: "rgba(15,23,42,.25)" }} />
          )}
          {/* KHÔNG dùng transition trên `width`: nó làm width kẹt ở giá trị "thu" (52px) khi
              app re-render liên tục → nhãn bị cắt. Đổi/thu tức thì cho chắc. */}
          <div style={{ position: "fixed", top: 0, left: 0, bottom: 0,
               // Điện thoại: đóng thì TRƯỢT HẲN ra ngoài màn (không chiếm chỗ); mở thì rộng như bản mở.
               width: isMobile ? RAIL_W_OPEN : (open ? RAIL_W_OPEN : RAIL_W),
               transform: isMobile && !open ? `translateX(-${RAIL_W_OPEN}px)` : "none",
               transition: isMobile ? "transform .18s ease" : "none",
               zIndex: 45, background: "#0f172a", color: "#e2e8f0", display: "flex", flexDirection: "column",
               boxShadow: open ? "6px 0 22px rgba(0,0,0,.28)" : "none", overflow: "hidden" }}>
            {/* Nút MỞ / THU */}
            <button type="button" onClick={() => setOpen(o => !o)} title={open ? "Thu gọn" : "Mở rộng"}
              style={{ display: "flex", alignItems: "center", gap: 10, height: 46, padding: "0 15px", color: "#94a3b8", flexShrink: 0 }}>
              {open ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeftOpen className="h-5 w-5" />}
              {(open || isMobile) && <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".05em", whiteSpace: "nowrap" }}>ỨNG DỤNG</span>}
            </button>
            <div style={{ height: 1, background: "rgba(148,163,184,.2)", margin: "0 8px 6px" }} />
            {/* Danh sách app (đã lọc theo bản live/dev) */}
            {visibleApps.map(a => {
              const active = a.id === activeApp;
              return (
                <button key={a.id} type="button" onClick={() => { setActiveApp(a.id); setOpen(false); track("open_app", a.name); }} title={a.name}
                  style={{ display: "flex", alignItems: "center", gap: 12, minHeight: isMobile ? 52 : 46, padding: "0 15px",
                    background: active ? "rgba(45,212,191,.14)" : "transparent",
                    borderLeft: active ? "3px solid #2dd4bf" : "3px solid transparent",
                    color: active ? "#ffffff" : "#cbd5e1", whiteSpace: "nowrap", textAlign: "left" }}>
                  <span style={{ flexShrink: 0, display: "flex" }}>{a.icon}</span>
                  {(open || isMobile) && (
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, lineHeight: 1.2 }}>{a.name}</span>
                      <span style={{ display: "block", fontSize: 10, color: "#94a3b8" }}>{a.sub}</span>
                    </span>
                  )}
                </button>
              );
            })}
            <div style={{ flex: 1 }} />
            {open && <div style={{ padding: "10px 15px", fontSize: 9.5, color: "#64748b" }}>1 link · nhiều app</div>}
          </div>
          {/* Nút mở drawer — góc DƯỚI-TRÁI cho vừa tầm ngón cái khi cầm 1 tay. Chỉ có trên điện thoại,
              và ẩn đi khi drawer đang mở (lúc đó bấm ra ngoài để đóng). */}
          {isMobile && !open && (
            <button type="button" onClick={() => setOpen(true)} aria-label="Mở danh sách ứng dụng"
              style={{ position: "fixed", left: 12, bottom: 16, zIndex: 43, width: 48, height: 48, borderRadius: 999,
                background: "#0f172a", color: "#e2e8f0", border: "1px solid rgba(148,163,184,.35)",
                boxShadow: "0 6px 18px rgba(2,6,23,.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <PanelLeftOpen className="h-5 w-5" />
            </button>
          )}
        </>,
        document.body,
      )}
      {/* SPACER giữ chỗ cho rail (fixed, đã portal ra ngoài) — flex item, width không bị co. */}
      {shellOn && <div style={{ width: isMobile ? 0 : RAIL_W, flexShrink: 0 }} aria-hidden />}
      {/* Ô NỘI DUNG = flex item chiếm phần còn lại. Thanh rail (fixed) phủ lên div SPACER phía
          trên → nội dung bắt đầu ngay sau rail, không bị đè. Mở rộng rail = overlay, spacer giữ
          nguyên 52px nên app ePMP KHÔNG phải reflow. */}
      <div style={shellOn ? { flex: "1 1 0%", minWidth: 0 } : undefined}>
        {content}
      </div>
    </div>
  );
}

/** App MTLĐ = "Tường Camera Lắp đặt": GOM tất cả popup lắp đặt của ePMP về MỘT màn để xem tổng thể
 *  (thay vì phải click từng popup). Nguồn dữ liệu = app Project Master Plan (app đầu tiên): mỗi dự án
 *  có link "Thi công lắp đặt", ghi qua cầu nối localStorage MTLD_INSTALL_LS ({fileId,name,maCT}).
 *  Mỗi ô render Y HỆT popup Summary bên ePMP (renderSummaryFromB64: heatmap ma trận / bảng+cột / dump).
 *  Parse ở CLIENT (Worker chỉ tải file). */
export const MTLD_INSTALL_LS = "mtld:install:v2";   // v2: kèm vùng + formKey (render ma trận + form)
type InstallProj = {
  fileId: string; gid?: string; name: string; maCT: string; region?: string; groupDA?: string;
  // Vùng + form để render Y HỆT popup "Thi công lắp đặt" (MatrixFormEditor).
  sheet?: string; range?: string; tl?: string; br?: string; formKey?: string; chart?: boolean;
  /** Chưa có ma trận — chỉ gắn link để xem (app Hình ảnh mỗi ngày gom ảnh chung cả dự án). */
  noMx?: boolean;
};
// ID DUY NHẤT 1 ma trận = fileId + gid (nhiều dự án chung file, khác tab) — dùng cho React key + bộ lọc.
const projId = (p: InstallProj) => p.fileId + (p.gid ? "|" + p.gid : "");
// DEDUP theo NỘI DUNG popup (file+tab+form) — nhiều dự án gắn cùng 1 ma trận chỉ hiện 1 thẻ.
function dedupInstall(arr: InstallProj[]): InstallProj[] {
  const seen = new Set<string>(); const out: InstallProj[] = [];
  for (const p of arr) { const sig = `${p.fileId}|${p.gid || ""}|${p.formKey || ""}`; if (seen.has(sig)) continue; seen.add(sig); out.push(p); }
  return out;
}
// Vùng cho bản PDF "có chart" (Google render) — khớp cách dashboard tính: có gid → cắt A1 trên tab đó;
// không gid → dùng "TênSheet!range".
const pdfArgsOf = (p: InstallProj): { gid?: string; range?: string } => {
  const r = (p.range || "").trim();
  if (p.gid) return { gid: p.gid, range: r || undefined };
  const s = (p.sheet || "").trim();
  return { range: s && r ? `${s}!${r}` : (s || r || undefined) };
};

/** 1 ô = 1 dự án. Render Y HỆT popup "Thi công lắp đặt": ma trận LIVE + FORM (kể cả ZOOM) đã lưu —
 *  hiện ĐÚNG cỡ zoom admin đã lưu (không tự thu nhỏ); ô cuộn nếu lớn hơn. */
function PopupCell({ proj, bump, h, onOpen }: { proj: InstallProj; bump: number; h: number; onOpen: () => void }) {
  // HYBRID: popup cấu hình "có chart" → hiện bản PDF Google render (đủ chart + màu); còn lại → ma trận + form.
  const pdfQ = useQuery({
    queryKey: ["mtld-pdf", proj.fileId, proj.gid ?? "", proj.sheet ?? "", proj.range ?? "", bump],
    queryFn: () => getSheetPdf({ data: { fileId: proj.fileId, ...pdfArgsOf(proj), force: bump > 0 || undefined } }),
    enabled: !!proj.chart, staleTime: 5 * 60 * 1000, retry: 1,
  });
  // FIT-BỀ-NGANG bằng transform (đo scrollWidth → chính xác). Ma trận trong ô để zoom nội bộ=1 (prop
  // `natural`) nên CHỈ transform scale — KHÔNG chồng CSS zoom + transform (thủ phạm dải trắng che bảng).
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [scaledH, setScaledH] = useState(0);
  useEffect(() => {
    if (proj.chart) return;
    const box = boxRef.current, content = contentRef.current;
    if (!box || !content) return;
    const fit = () => {
      const cw = content.scrollWidth, ch = content.scrollHeight, bw = box.clientWidth;
      if (!cw || !bw) return;
      const s = Math.min(3, bw / cw);
      setScale(s); setScaledH(Math.ceil(ch * s));   // setScale idempotent → giá trị ổn thì React bỏ qua
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(box); ro.observe(content);
    // Poll đều tới khi ma trận tải xong (loadRegion qua mạng có thể >2s) → luôn đo lại đúng cỡ.
    let n = 0; const iv = window.setInterval(() => { fit(); if (++n > 40) clearInterval(iv); }, 150);
    return () => { ro.disconnect(); clearInterval(iv); };
  }, [proj.formKey, proj.chart, h, bump]);
  return (
    <div onClick={onOpen} title="Bấm để xem chi tiết"
      style={{ height: h, background: "#fff", borderRadius: 12, overflow: "hidden", border: "1px solid #232c3d", boxShadow: "0 8px 22px rgba(0,0,0,.34)", display: "flex", flexDirection: "column", cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, background: "#131a26", color: "#e7ebf3", padding: "7px 11px", fontSize: 12, fontWeight: 700, flexShrink: 0, borderBottom: "1px solid #232c3d" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#4aa6ee", flexShrink: 0 }} />
        <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={proj.name}>{proj.name || proj.maCT || proj.fileId}</span>
        {proj.maCT && <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 10, color: "#6b7488", flexShrink: 0 }}>{proj.maCT}</span>}
        <Maximize2 className="h-3 w-3" style={{ marginLeft: "auto", color: "#6b7488", flexShrink: 0 }} />
      </div>
      {proj.chart ? (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", background: "#fff" }}>
          {pdfQ.isPending ? <div style={{ color: "#94a3b8", fontSize: 12, padding: 8 }}>Đang tải chart…</div>
            : pdfQ.isError ? <div style={{ color: "#b91c1c", fontSize: 11.5, padding: 8, lineHeight: 1.5 }}>{(pdfQ.error as Error).message}</div>
            : pdfQ.data ? <iframe title={proj.name} src={`data:application/pdf;base64,${pdfQ.data.b64}#toolbar=0&navpanes=0&view=FitH`} style={{ width: "100%", height: "100%", border: "none", pointerEvents: "none" }} /> : null}
        </div>
      ) : (
        // Ô ĐỒNG ĐỀU (cao cố định); ma trận co vừa bề ngang, chỉ cuộn dọc nếu cao hơn ô.
        <div ref={boxRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", scrollbarGutter: "stable", background: "#fff" }}>
          <div style={{ height: scaledH || undefined }}>
            <div ref={contentRef} style={{ width: "max-content", transformOrigin: "top left", transform: `scale(${scale})` }}>
              <MatrixFormEditor fid={proj.fileId} opts={{ sheetName: proj.sheet, range: proj.range, tl: proj.tl, br: proj.br }} formKey={proj.formKey || ""} canEdit={false} force={bump} hideChrome natural />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Dialog xem CHI TIẾT 1 popup ở kích thước THẬT (100%), cuộn tự do — bấm nền tối hoặc ✕/Esc để đóng. */
function PopupModal({ proj, bump, canEdit, onClose }: { proj: InstallProj; bump: number; canEdit?: boolean; onClose: () => void }) {
  const pdfQ = useQuery({
    queryKey: ["mtld-pdf", proj.fileId, proj.gid ?? "", proj.sheet ?? "", proj.range ?? "", bump],
    queryFn: () => getSheetPdf({ data: { fileId: proj.fileId, ...pdfArgsOf(proj), force: bump > 0 || undefined } }),
    enabled: !!proj.chart, staleTime: 5 * 60 * 1000, retry: 1,
  });
  const [full, setFull] = useState(false);   // XEM TOÀN MÀN HÌNH để coi chi tiết
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (full) setFull(false); else onClose(); }   // Esc: thoát full trước, lần nữa mới đóng
      else if (e.key === "f" || e.key === "F") setFull((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, full]);
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(2,6,23,.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: full ? 0 : 24, backdropFilter: "blur(2px)" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ display: "flex", flexDirection: "column", width: full ? "100vw" : "min(1500px, 98vw)", height: full ? "100vh" : undefined, maxHeight: full ? "100vh" : "96vh", background: "#fff", borderRadius: full ? 0 : 14, overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,.55)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, background: "#131a26", color: "#e7ebf3", padding: "11px 16px", flexShrink: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4aa6ee", flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 700, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={proj.name}>{proj.name || proj.maCT || proj.fileId}</span>
          {proj.maCT && <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11, color: "#8b95ab", flexShrink: 0 }}>{proj.maCT}</span>}
          <button type="button" onClick={() => setFull((v) => !v)} title={full ? "Thu nhỏ (F)" : "Xem toàn màn hình (F)"}
            style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 8, background: "#232c3d", color: "#cbd5e1", flexShrink: 0, cursor: "pointer", fontSize: 15, lineHeight: 1 }}>
            {full ? "🗗" : "⛶"}
          </button>
          <button aria-label={"Đóng (Esc)"} type="button" onClick={onClose} title="Đóng (Esc)"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 8, background: "#232c3d", color: "#cbd5e1", flexShrink: 0, cursor: "pointer" }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: proj.chart ? 0 : 16, background: "#fff" }}>
          {proj.chart ? (
            pdfQ.isPending ? <div style={{ color: "#64748b", fontSize: 13, padding: 12 }}>Đang tải chart…</div>
              : pdfQ.isError ? <div style={{ color: "#b91c1c", fontSize: 13, padding: 12, lineHeight: 1.6 }}>{(pdfQ.error as Error).message}</div>
              : pdfQ.data ? <iframe title={proj.name} src={`data:application/pdf;base64,${pdfQ.data.b64}#view=FitH`} style={{ width: "100%", height: full ? "calc(100vh - 48px)" : "82vh", border: "none" }} /> : null
          ) : (
            <MatrixFormEditor fid={proj.fileId} opts={{ sheetName: proj.sheet, range: proj.range, tl: proj.tl, br: proj.br }} formKey={proj.formKey || ""} canEdit={!!canEdit} force={bump} />
          )}
        </div>
      </div>
    </div>
  );
}

// Theme tối (bám app cũ mtld-monitor): nền, panel, sidebar, viền, chữ, nhấn.
const MTLD_T = { bg: "#0a0e15", side: "#10151e", panel: "#131a26", line: "#232c3d", ink: "#e7ebf3", soft: "#a3adc2", faint: "#6b7488", accent: "#5b8cff" };

function MtldApp() {
  const [list, setList] = useState<InstallProj[]>([]);
  const [bump, setBump] = useState(0);
  const [region, setRegion] = useState("all");
  const [fGroup, setFGroup] = useState("");
  const [fProj, setFProj] = useState("");
  const narrow = useIsMobile();   // điện thoại: sidebar vùng nằm TRÊN, ô lắp đặt chiếm trọn bề ngang
  const [tile, setTile] = useState(320);   // bề rộng ô tối thiểu (mật độ): to = thưa, nhỏ = dày
  const [openR, setOpenR] = useState<Set<string>>(new Set());   // vùng đang xổ danh sách dự án
  const [detail, setDetail] = useState<InstallProj | null>(null);   // ô đang mở dialog chi tiết
  const [viewMode, setViewMode] = useState<"region" | "wall">("region");   // xem theo vùng / gom hết như TV
  // Quyền: admin/PMO mới được chỉnh zoom + Lưu form trong popup chi tiết.
  const devAs = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("as") : null;
  const meQ = useQuery({ queryKey: ["mtld-whoami", devAs], queryFn: () => whoami({ data: { devAs } }) });
  const rolesQ = useQuery({ queryKey: ["mtld-roles"], queryFn: () => fetchUserRoles(), staleTime: 5 * 60 * 1000 });
  const canManage = !!(meQ.data?.isAdmin || (meQ.data?.email && roleOf(rolesQ.data?.roles ?? {}, meQ.data.email) === "PMO"));
  // localStorage = vẽ ngay (nếu cùng máy đã có); KV = NGUỒN THẬT (Dashboard đẩy lên) → chạy mọi lúc/tab.
  useEffect(() => {
    try { const l = JSON.parse(localStorage.getItem(MTLD_INSTALL_LS) || "[]"); if (Array.isArray(l) && l.length) setList(dedupInstall(l)); } catch { /* bỏ qua */ }
  }, []);
  const listQ = useQuery({ queryKey: ["mtld-install-list", bump], queryFn: () => getInstallList(), staleTime: 60 * 1000 });
  useEffect(() => {
    const l = listQ.data?.list;
    if (Array.isArray(l) && l.length) { const u = dedupInstall(l as InstallProj[]); setList(u); try { localStorage.setItem(MTLD_INSTALL_LS, JSON.stringify(u)); } catch { /* bỏ qua */ } }
  }, [listQ.data]);

  const regionOf = (p: InstallProj) => p.region || "Khác";
  const allByRegion = new Map<string, InstallProj[]>();
  for (const p of list) { const r = regionOf(p); (allByRegion.get(r) ?? allByRegion.set(r, []).get(r)!).push(p); }
  const regionList = [...allByRegion.entries()].map(([r, ps]) => [r, ps.length] as const).sort((a, b) => a[0].localeCompare(b[0], "vi"));
  const groups = [...new Set(list.filter((p) => region === "all" || regionOf(p) === region).map((p) => p.groupDA).filter(Boolean))].sort() as string[];

  const shown = list.filter((p) =>
    (region === "all" || regionOf(p) === region) &&
    (!fGroup || p.groupDA === fGroup) &&
    (!fProj || projId(p) === fProj));
  const byRegion = new Map<string, InstallProj[]>();
  for (const p of shown) { const r = regionOf(p); (byRegion.get(r) ?? byRegion.set(r, []).get(r)!).push(p); }
  const sections = [...byRegion.entries()].sort((a, b) => a[0].localeCompare(b[0], "vi"));
  const cellH = Math.round(tile * 0.9);

  const sel = { height: 28, borderRadius: 6, border: `1px solid ${MTLD_T.line}`, background: MTLD_T.bg, color: MTLD_T.ink, fontSize: 11.5, padding: "0 6px", colorScheme: "dark" as const, maxWidth: 220 };
  const lab = { fontSize: 10, fontWeight: 700 as const, letterSpacing: ".05em", color: MTLD_T.faint, textTransform: "uppercase" as const };

  return (
    <div style={{ height: "100vh", width: "100%", maxWidth: "100%", overflowX: "hidden", display: "flex", flexDirection: narrow ? "column" : "row", background: MTLD_T.bg, color: MTLD_T.ink, fontFamily: "system-ui,sans-serif" }}>
      {/* SIDEBAR — Vùng (bám app cũ). Máy hẹp: 228px cạnh lưới ô 220px là tràn màn → cho nằm TRÊN,
          cao tối đa 34% màn rồi tự cuộn, phần còn lại dành hết cho các ô lắp đặt. */}
      <aside style={{ width: narrow ? "100%" : 228, maxHeight: narrow ? "34vh" : undefined, flexShrink: 0, background: MTLD_T.side, borderRight: narrow ? "none" : `1px solid ${MTLD_T.line}`, borderBottom: narrow ? `1px solid ${MTLD_T.line}` : "none", display: "flex", flexDirection: "column", padding: narrow ? "10px 12px" : "16px 12px", overflow: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#35c281", boxShadow: "0 0 0 3px rgba(53,194,129,.18)" }} />
          <span style={{ fontSize: 14, fontWeight: 700 }}>Theo dõi lắp đặt</span>
        </div>
        <div style={{ ...lab, marginTop: 3, marginLeft: 17 }}>AA CORPORATION · MONITORING</div>
        <div style={{ ...lab, marginTop: 20, marginBottom: 6 }}>Vùng</div>
        <RRow name="Tất cả vùng" count={list.length} active={region === "all" && !fProj} onClick={() => { setRegion("all"); setFGroup(""); setFProj(""); }} />
        {regionList.map(([r, c]) => (
          <div key={r}>
            <RRow name={r} count={c} active={region === r && !fProj} open={openR.has(r)}
              onClick={() => {
                setRegion(r); setFGroup(""); setFProj("");
                setOpenR((prev) => { const s = new Set(prev); s.has(r) ? s.delete(r) : s.add(r); return s; });
              }} />
            {openR.has(r) && (allByRegion.get(r) ?? []).map((p) => (
              <button key={projId(p)} type="button" onClick={() => { setRegion(r); setFGroup(""); setFProj(projId(p)); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "5px 9px 5px 26px", marginBottom: 1, borderRadius: 6, cursor: "pointer", border: "none",
                  background: fProj === p.fileId ? "rgba(91,140,255,.16)" : "transparent",
                  color: fProj === p.fileId ? "#dbe6ff" : MTLD_T.soft, fontSize: 11.5, fontWeight: fProj === p.fileId ? 600 : 400, lineHeight: 1.4, whiteSpace: "normal", wordBreak: "break-word" }}>
                {p.name}
              </button>
            ))}
          </div>
        ))}
      </aside>

      {/* MAIN */}
      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, padding: "10px 16px", borderBottom: `1px solid ${MTLD_T.line}`, flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{region === "all" ? "Tất cả vùng" : region}</span>
          <span style={{ fontSize: 12, color: MTLD_T.soft }}>{shown.length}/{list.length} dự án</span>
          <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={lab}>Cụm</span>
              <select value={fGroup} onChange={(e) => setFGroup(e.target.value)} style={sel}>
                <option value="">Tất cả</option>{groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select></span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={lab}>Dự án</span>
              <select value={fProj} onChange={(e) => setFProj(e.target.value)} style={sel}>
                <option value="">Tất cả</option>{list.map((p) => <option key={projId(p)} value={projId(p)}>{p.name}</option>)}
              </select></span>
            {/* Kiểu xem: THEO VÙNG (nhóm, mặc định) hoặc GOM HẾT (một lưới liền như xem TV). */}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><span style={lab}>Kiểu xem</span>
              <span style={{ display: "inline-flex", borderRadius: 6, overflow: "hidden", border: `1px solid ${MTLD_T.line}` }}>
                {(["region", "wall"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setViewMode(m)}
                    style={{ padding: "4px 9px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", border: "none",
                      background: viewMode === m ? MTLD_T.accent : "transparent", color: viewMode === m ? "#fff" : MTLD_T.soft }}>
                    {m === "region" ? "Theo vùng" : "Gom hết"}
                  </button>
                ))}
              </span></span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><span style={lab}>Mật độ</span>
              <input type="range" min={220} max={460} step={20} value={tile} onChange={(e) => setTile(+e.target.value)} style={{ width: 100, accentColor: MTLD_T.accent }} /></span>
            <button type="button" onClick={() => setBump((n) => n + 1)}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, background: MTLD_T.panel, color: MTLD_T.ink, border: `1px solid ${MTLD_T.line}`, borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <RefreshCw className="h-3.5 w-3.5" /> Làm mới
            </button>
          </div>
        </div>

        {list.length === 0 ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
            <div style={{ color: MTLD_T.soft, fontSize: 13, lineHeight: 1.7, maxWidth: 460 }}>
              Chưa có danh sách dự án. Mở app <b style={{ color: MTLD_T.ink }}>Project Master Plan</b> một lần để nạp
              danh sách link lắp đặt, rồi quay lại đây — mỗi ô hiện đúng popup lắp đặt của từng dự án.
            </div>
          </div>
        ) : viewMode === "wall" ? (
          // GOM HẾT: mọi ô vào MỘT lưới liền (không tách vùng) — xem tổng thể như bức tường TV.
          <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "12px 16px 20px" }}>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: `repeat(auto-fill, minmax(${narrow ? Math.min(tile, 260) : tile}px, 1fr))`, alignContent: "start", alignItems: "start" }}>
              {shown.map((p) => <PopupCell key={projId(p)} proj={p} bump={bump} h={cellH} onOpen={() => { setDetail(p); track("mtld_open", p.name); }} />)}
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 16px 20px" }}>
            {sections.map(([rg, items]) => (
              <section key={rg}>
                {/* STICKY, nền ĐẶC trải hết ngang (margin âm bù padding 16px) → dính mà KHÔNG lòi/hở nội dung. */}
                <div style={{ position: "sticky", top: 0, zIndex: 5, display: "flex", alignItems: "center", gap: 10, margin: "0 -16px", padding: "12px 16px 8px", background: MTLD_T.bg }}>
                  <h2 style={{ fontSize: 13.5, fontWeight: 700, margin: 0 }}>{rg}</h2>
                  <span style={{ fontSize: 11, color: MTLD_T.faint, marginLeft: "auto" }}>{items.length} dự án</span>
                </div>
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: `repeat(auto-fill, minmax(${narrow ? Math.min(tile, 260) : tile}px, 1fr))`, alignContent: "start", alignItems: "start", paddingBottom: 6 }}>
                  {items.map((p) => <PopupCell key={projId(p)} proj={p} bump={bump} h={cellH} onOpen={() => { setDetail(p); track("mtld_open", p.name); }} />)}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
      {detail && <PopupModal proj={detail} bump={bump} canEdit={canManage} onClose={() => setDetail(null)} />}
    </div>
  );
}

/** 1 dòng vùng trong sidebar (tên · số dự án), tô sáng khi đang chọn; `open` = đang xổ danh sách dự án. */
function RRow({ name, count, active, open, onClick }: { name: string; count: number; active: boolean; open?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left", padding: "7px 9px", marginBottom: 2, borderRadius: 7, cursor: "pointer",
        border: `1px solid ${active ? "#2a3852" : "transparent"}`, background: active ? "rgba(91,140,255,.14)" : "transparent",
        color: active ? "#dbe6ff" : MTLD_T.soft, fontSize: 12.5, fontWeight: active ? 700 : 500 }}>
      {open !== undefined && <span style={{ fontSize: 9, color: MTLD_T.faint, width: 9, flexShrink: 0, transition: "transform .12s", transform: open ? "rotate(90deg)" : "none" }}>▶</span>}
      <span style={{ minWidth: 0, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
      <span style={{ fontSize: 11, color: active ? "#9db8ff" : MTLD_T.faint, fontVariantNumeric: "tabular-nums" }}>{count}</span>
    </button>
  );
}
