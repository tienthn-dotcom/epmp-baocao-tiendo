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
import { LayoutDashboard, LineChart, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { detectStage, featureOn, type Stage } from "@/lib/flags";
import { parseMatrixWorkbook } from "@/lib/matrix-reader";

const RAIL_W = 52;        // bề rộng thanh khi THU (icon)
const RAIL_W_OPEN = 214;  // bề rộng khi MỞ (overlay)

type AppDef = { id: string; name: string; sub: string; icon: ReactNode };
const APPS: AppDef[] = [
  { id: "epmp", name: "Project Master Plan", sub: "ePMP · PMO", icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: "mtld", name: "MTLĐ", sub: "Biểu đồ tiến độ", icon: <LineChart className="h-5 w-5" /> },
];

export function AppShell({ epmpApp }: { epmpApp: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [stage, setStage] = useState<Stage>("live"); // "live" ở lần render đầu → tránh lệch hydration
  const [activeApp, setActiveApp] = useState("epmp");
  const [open, setOpen] = useState(false);
  useEffect(() => { setMounted(true); setStage(detectStage()); }, []);

  const shellOn = mounted && featureOn("appShell", stage);
  // Nội dung = app đang chọn. `epmpApp` LUÔN nằm ở đây (không remount khi bật/tắt thanh).
  const content = shellOn && activeApp === "mtld" ? <MtldApp /> : epmpApp;

  return (
    // Cờ TẮT (live) → không style: 2 div bọc thành block TRONG SUỐT, app ePMP render y hệt như
    // cũ. Cờ BẬT (dev) → flex để chừa chỗ cho rail. Cấu trúc div KHÔNG đổi → app KHÔNG remount.
    <div style={shellOn ? { display: "flex", minHeight: "100vh" } : undefined}>
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
          <div style={{ position: "fixed", top: 0, left: 0, bottom: 0, width: open ? RAIL_W_OPEN : RAIL_W, zIndex: 45,
               background: "#0f172a", color: "#e2e8f0", display: "flex", flexDirection: "column",
               boxShadow: open ? "6px 0 22px rgba(0,0,0,.28)" : "none", overflow: "hidden" }}>
            {/* Nút MỞ / THU */}
            <button type="button" onClick={() => setOpen(o => !o)} title={open ? "Thu gọn" : "Mở rộng"}
              style={{ display: "flex", alignItems: "center", gap: 10, height: 46, padding: "0 15px", color: "#94a3b8", flexShrink: 0 }}>
              {open ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeftOpen className="h-5 w-5" />}
              {open && <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".05em", whiteSpace: "nowrap" }}>ỨNG DỤNG</span>}
            </button>
            <div style={{ height: 1, background: "rgba(148,163,184,.2)", margin: "0 8px 6px" }} />
            {/* Danh sách app */}
            {APPS.map(a => {
              const active = a.id === activeApp;
              return (
                <button key={a.id} type="button" onClick={() => { setActiveApp(a.id); setOpen(false); }} title={a.name}
                  style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 46, padding: "0 15px",
                    background: active ? "rgba(45,212,191,.14)" : "transparent",
                    borderLeft: active ? "3px solid #2dd4bf" : "3px solid transparent",
                    color: active ? "#ffffff" : "#cbd5e1", whiteSpace: "nowrap", textAlign: "left" }}>
                  <span style={{ flexShrink: 0, display: "flex" }}>{a.icon}</span>
                  {open && (
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
        </>,
        document.body,
      )}
      {/* SPACER giữ chỗ cho rail (fixed, đã portal ra ngoài) — flex item, width không bị co. */}
      {shellOn && <div style={{ width: RAIL_W, flexShrink: 0 }} aria-hidden />}
      {/* Ô NỘI DUNG = flex item chiếm phần còn lại. Thanh rail (fixed) phủ lên div SPACER phía
          trên → nội dung bắt đầu ngay sau rail, không bị đè. Mở rộng rail = overlay, spacer giữ
          nguyên 52px nên app ePMP KHÔNG phải reflow. */}
      <div style={shellOn ? { flex: "1 1 0%", minWidth: 0 } : undefined}>
        {content}
      </div>
    </div>
  );
}

/** App MTLĐ = "Tường Camera Tiến độ Lắp đặt". UI = prototype tự chứa (public/mtld-monitor.html)
 *  trong <iframe> để cách ly CSS/JS/theme. DỮ LIỆU THẬT: FileDrop ở thanh trên → reader ma trận
 *  (src/lib/matrix-reader.ts) đọc file → map sang shape DIRECTORY → postMessage bơm vào iframe
 *  (thay data DEMO). Vì CHƯA có ngày/vùng (metadata PMO cấp) nên gửi noPlan=true: tường hiện %
 *  THỰC TẾ thật, cột trung tính, chưa vẽ đường KH / chưa báo động. Xem BRIEF-TICH-HOP-ePMP.md. */
function MtldApp() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true); setStatus("Đang đọc…");
    try {
      const projects: unknown[] = [];
      let sheetCount = 0, warnCount = 0, errCount = 0;
      for (const file of Array.from(files)) {
        const buf = await file.arrayBuffer();
        const units: unknown[] = [];
        for (const { sheet, result } of parseMatrixWorkbook(buf)) {
          if (!result.ok) continue;
          sheetCount++;
          if (result.qlevel === "warn") warnCount++;
          if (result.qlevel === "error") errCount++;
          const isPublic = /public/i.test(result.goi) || /public/i.test(sheet);
          // Public → mỗi KHU VỰC 1 cột; Phòng → mỗi TOÀ 1 cột (tổng toà). Bỏ dòng chưa có số.
          const rows = result.units.filter((u) => u.level === (isPublic ? "khuvuc" : "toa"));
          for (const u of rows) {
            if (u.pct == null) continue;
            units.push({
              name: isPublic ? (u.toa ? `${u.toa}·${u.name}` : u.name) : u.name,
              scope: isPublic ? "public" : "rooms",
              actual: u.pct, plan: null, prev: null, start: null, deadline: null,
            });
          }
        }
        if (units.length) projects.push({ group: "", name: file.name.replace(/\.(xlsx|xls)$/i, ""), cam: file.name, real: true, units });
      }
      if (!projects.length) { setStatus("Không tìm thấy ma trận định lượng đọc được trong file."); setBusy(false); return; }
      const directory = [{ code: "loaded", name: "File đã nạp", projects }];
      const today = new Date().toISOString().slice(0, 10);
      iframeRef.current?.contentWindow?.postMessage({ type: "mtldLoad", directory, reportDate: today, noPlan: true }, "*");
      setStatus(`Đã nạp ${projects.length} dự án · ${sheetCount} ma trận` +
        (warnCount ? ` · ${warnCount} cờ ⚠` : "") + (errCount ? ` · ${errCount} cờ ❌` : ""));
    } catch (err) {
      setStatus("Lỗi đọc file: " + (err instanceof Error ? err.message : String(err)));
    }
    setBusy(false);
  }

  return (
    <div style={{ height: "100vh", width: "100%", display: "flex", flexDirection: "column", background: "#e9ebf0" }}
         onDragOver={(e) => e.preventDefault()}
         onDrop={(e) => { e.preventDefault(); void handleFiles(e.dataTransfer.files); }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", background: "#0f172a",
                    color: "#e2e8f0", fontSize: 12, flexShrink: 0, borderBottom: "1px solid rgba(148,163,184,.18)" }}>
        <strong style={{ letterSpacing: ".02em" }}>MTLĐ · Tường Camera Lắp đặt</strong>
        <label style={{ cursor: busy ? "default" : "pointer", background: busy ? "#334155" : "#2dd4bf", color: busy ? "#94a3b8" : "#06251f",
                        fontWeight: 700, padding: "5px 12px", borderRadius: 6, whiteSpace: "nowrap" }}>
          {busy ? "Đang đọc…" : "Chọn / kéo-thả file ma trận (.xlsx)"}
          <input type="file" accept=".xlsx,.xls" multiple style={{ display: "none" }} disabled={busy}
                 onChange={(e) => void handleFiles(e.target.files)} />
        </label>
        <span style={{ color: "#94a3b8", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{status}</span>
      </div>
      <iframe ref={iframeRef} src="/mtld-monitor.html" title="MTLĐ · Tường Camera Tiến độ Lắp đặt"
        style={{ flex: 1, width: "100%", border: "none", display: "block" }} />
    </div>
  );
}
