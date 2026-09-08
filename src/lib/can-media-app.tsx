/**
 * MEDIA CÔNG TRƯỜNG (đại trùng tu "Video tại công trường") — DASHBOARD theo dự án:
 *   1) Bộ lọc CHỌN DỰ ÁN ở trên → hiện MA TRẬN LẮP ĐẶT của dự án (bê nguyên heatmap thật, tô màu y hệt
 *      qua MatrixFormEditor).
 *   2) CLICK 1 Ô ma trận (1 căn) → popup: XEM ảnh + video của căn đó + UPLOAD ảnh/video (nhiều file 1 lượt).
 *   3) Mọi file tự tổ chức folder trên Drive: DATABASE › ePMP › Media › <dự án> › <tên phòng> › Hình ảnh|Video.
 * Mã căn suy từ ô bấm (nhãn hàng × tiêu đề cột) — cho SỬA TAY để không bao giờ gắn nhầm.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/lib/use-breakpoint";
import { track } from "@/lib/track";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getInstallList, getMediaProjects } from "@/lib/mtld-install.functions";
import { MatrixFormEditor } from "@/lib/matrix-form-editor";
import { loadRegion } from "@/lib/region-load";
import * as XLSXNS from "xlsx";
import type * as XLSX from "xlsx";
import { STD_RAMP } from "@/lib/summary-render";
import { whoami } from "@/lib/activity.functions";
import { fetchUserRoles, getSheetForms, saveSheetForm } from "@/lib/edits.functions";
import { roleOf } from "@/lib/roles";
import { useXemNhuUser } from "@/lib/view-as";
import { parseMediaMsgs, type MediaMsg } from "@/lib/media-msg";

const MTLD_INSTALL_LS = "mtld:install:v2";   // = app-shell.MTLD_INSTALL_LS (không import để tránh vòng phụ thuộc)
const PAGE_W = 1880;                         // ma trận bàn giao rất rộng (5 Toà × 18-21 căn) → cho trang rộng gần hết màn
import { startCanMediaUpload, listCanMedia, readCanMediaB64, listProjectMedia, editMediaMsg } from "@/lib/can-media.functions";

const C = { ink: "#0f172a", sub: "#64748b", teal: "#0d9488", tealD: "#0f766e", navy: "#0f2742" };
const mb = (n: number) => (n / 1048576).toFixed(0);

type InstallProj = { fileId: string; gid?: string; name: string; maCT: string; region?: string; groupDA?: string;
  hid?: string; sheet?: string; range?: string; tl?: string; br?: string; formKey?: string; chart?: boolean;
  /** PMO tick "chưa có ma trận" ở ô Gắn link → ảnh gom chung dự án, không dắt về từng căn. */
  noMx?: boolean };
/** KHOÁ DỰ ÁN — ưu tiên ID CỨNG (IDCUNG, vd "P0025"): đổi tên / trùng mã CT / dùng chung ma trận với dự
 *  án khác đều không lẫn kho media. Nguồn chưa có cột IDCUNG thì lùi về file+tab (như cũ). */
const projId = (p: InstallProj) => p.hid ? `H:${p.hid}` : p.fileId + (p.gid ? "|" + p.gid : "");

/**
 * CHẤM DẤU TRÊN Ô MA TRẬN NÓI LUÔN "TƯ LIỆU MỚI CỠ NÀO".
 * Nhìn cả bảng là biết hôm nay đội nào đã quay, quay lúc nào — khỏi bấm từng ô.
 *   · Tải lên HÔM NAY  → rẻ quạt đầy dần theo buổi, màu đi từ sáng sang tối trong ngày:
 *       trước 12h : 1/4 vòng · xanh lá  #5CFF5C (sáng)
 *       12–18h    : 1/2 vòng · cam      #F5A623 (chiều)
 *       sau 18h   : 3/4 vòng · xanh dương #4A86E8 (tối)
 *   · Tải lên HÔM QUA → tròn đầy · cyan #6FF0FF (mới, nhưng không phải hôm nay).
 *   · CŨ HƠN HAI NGÀY → KHÔNG chấm nữa.
 *
 * VÌ SAO CHỈ 2 NGÀY: chấm để trả lời "căn nào vừa có người cập nhật", không phải "căn nào từng có
 * tư liệu". Nhịp quay thực tế khoảng một clip mỗi tuần; giữ dấu mãi thì cả bảng kín chấm, nhìn vào
 * không còn biết chỗ nào mới. Ảnh/clip cũ vẫn nằm nguyên trong kho, bấm vào ô là xem được.
 *
 * MÀU LẤY TỪ BẢNG MÃ MÀU CHỦ NHÀ GỬI (xanh lá · cam · xanh dương · cyan) — đều là tông SÁNG RỰC nên
 * bật lên trên nền ô, khác hẳn bảng màu heatmap của chính ô (navy, xanh lá đậm, xanh nhạt).
 * Giờ lấy theo máy người xem (giờ VN), mốc là createdTime của Drive — giờ TẢI LÊN thật, không phải
 * ngày ghi trong tên file. Không đọc được giờ thì coi như cũ → xám.
 */
function freshMark(at: string): { color: string; deg: number; label: string } | null {
  if (!at) return null;
  const d = new Date(at);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  // So theo NGÀY LỊCH: 0 = hôm nay, 1 = hôm qua, ≥2 = cũ (không chấm).
  const ngay = (x: Date) => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86400000);
  const cach = ngay(now) - ngay(d);
  if (cach >= 2 || cach < 0) return null;
  if (cach === 1) return { color: "#6FF0FF", deg: 360, label: "tải lên hôm qua" };
  const h = d.getHours();
  const gio = `${String(h).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  // Trước 12h gộp chung một buổi: 0–6h gần như không ai tải, tách thêm một mốc chỉ rối.
  if (h < 12) return { color: "#5CFF5C", deg: 90, label: `tải lên hôm nay ${gio} (sáng)` };
  if (h < 18) return { color: "#F5A623", deg: 180, label: `tải lên hôm nay ${gio} (chiều)` };
  return { color: "#4A86E8", deg: 270, label: `tải lên hôm nay ${gio} (tối)` };
}
const isMini = (p: InstallProj) => /mini\s*hotel/i.test(p.name || "");

/** `wantProject` = tên dự án mà chỗ khác (nút "Video" trên dashboard ePMP) muốn mở sẵn. Khớp theo TÊN vì
 *  bên gọi chỉ có tên hiển thị; không khớp được thì cứ giữ dự án đầu danh sách. */
/** ID của dự án CHƯA CÓ ma trận trong ô chọn — ưu tiên ID cứng, không có thì mã CT + tên. */
const kmtId = (p: { hid?: string; maCT: string; name: string }) => `kmt:${p.hid || `${p.maCT}|${p.name}`}`;

export function CanMediaApp({ wantProject }: { wantProject?: string | null } = {}) {
  // NGUỒN dự-án-có-ma-trận: localStorage (dashboard ePMP ghi khi mở, cùng máy) LÀM MỒI, KV là nguồn thật.
  const [lsList, setLsList] = useState<InstallProj[]>([]);
  useEffect(() => { try { const l = JSON.parse(localStorage.getItem(MTLD_INSTALL_LS) || "[]"); if (Array.isArray(l) && l.length) setLsList(l as InstallProj[]); } catch { /* bỏ qua */ } }, []);
  const listQ = useQuery({ queryKey: ["media-install-list"], queryFn: () => getInstallList(), staleTime: 60_000 });
  const list = useMemo(() => {
    const kv = (listQ.data?.list ?? []) as InstallProj[];
    const raw = (kv.length ? kv : lsList);
    // Bỏ trùng theo nội dung popup; Mini Hotel lên đầu (làm trước).
    // Gộp theo DỰ ÁN (không theo ma trận): 2 dự án dùng chung 1 ma trận vẫn là 2 kho media riêng.
    const seen = new Set<string>(); const out: InstallProj[] = [];
    for (const p of raw) { const sig = `${projId(p)}|${p.name}`; if (seen.has(sig)) continue; seen.add(sig); out.push(p); }
    return out.sort((a, b) => (Number(isMini(b)) - Number(isMini(a))) || a.name.localeCompare(b.name, "vi"));
  }, [listQ.data, lsList]);

  /* MỌI DỰ ÁN — kể cả dự án CHƯA CÓ ma trận. Công trường vẫn chụp ảnh mỗi ngày, nên dự án nào
     cũng phải có kho ảnh riêng. Dự án có ma trận thì bấm ô để về đúng căn; chưa có thì ảnh gom
     chung cả dự án (vẫn tách kho theo ID cứng nên không lẫn dự án khác). */
  const allQ = useQuery({ queryKey: ["media-all-projects"], queryFn: () => getMediaProjects(), staleTime: 60_000 });
  const khongMaTran = useMemo(() => {
    const coRoi = new Set(list.map((p) => `${(p.maCT || "").trim()}|${p.name.trim()}`));
    return (allQ.data?.list ?? [])
      .filter((p) => !coRoi.has(`${(p.maCT || "").trim()}|${p.name.trim()}`))
      .sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }, [allQ.data, list]);

  const [selId, setSelId] = useState<string>("");
  const sel = useMemo(() => list.find((p) => projId(p) === selId) || (selId.startsWith("kmt:") ? undefined : list[0]), [list, selId]);
  // Dự án chưa có ma trận đang chọn (id dạng "kmt:<hid|maCT|tên>").
  const selKmt = useMemo(() => {
    if (!selId.startsWith("kmt:")) return null;
    return khongMaTran.find((p) => kmtId(p) === selId) ?? null;
  }, [selId, khongMaTran]);
  // Dự án có link nhưng PMO đã tick "chưa có ma trận" → cũng đi lối gom ảnh chung.
  const chiXem = !!selKmt || !!sel?.noMx;
  useEffect(() => { if (!selId && list.length) setSelId(projId(list[0])); }, [list, selId]);
  // Khớp dự án được yêu cầu (bấm 🎬 Video ở dashboard) — CHỈ khớp CHÍNH XÁC theo tên đã chuẩn hoá.
  // Khớp "lỏng" (includes) từng làm "Mini Hotel PQ (B6-B9)" rơi về "(B1-B5)" và hiện media của toà khác.
  const [missProject, setMissProject] = useState<string | null>(null);
  useEffect(() => {
    if (!wantProject || !list.length) return;
    const norm = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();
    const hit = list.find((p) => norm(p.name) === norm(wantProject));
    if (hit) { setSelId(projId(hit)); setMissProject(null); }
    else setMissProject(wantProject);       // không có ma trận → báo rõ, KHÔNG hiện nhầm dự án khác
  }, [wantProject, list]);

  const [pick, setPick] = useState<{ project?: string; toa?: string; can: string; scope: "can" | "project" } | null>(null);

  // ADMIN/PMO được "chỉnh như Excel" ma trận của màn này (ẩn dòng/cột thừa, cỡ hàng-cột, sửa chữ, tô màu).
  const devAs = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("as") : null;
  const meQ = useQuery({ queryKey: ["media-whoami", devAs], queryFn: () => whoami({ data: { devAs } }) });
  const rolesQ = useQuery({ queryKey: ["shell-roles"], queryFn: () => fetchUserRoles(), staleTime: 5 * 60 * 1000 });
  const xemNhuUser = useXemNhuUser();
  const canEdit = !xemNhuUser && !!(meQ.data?.isAdmin || (meQ.data?.email && roleOf(rolesQ.data?.roles ?? {}, meQ.data.email) === "PMO"));

  // KIỂU HIỂN THỊ TỰ CHỌN THEO FILE — không bắt người dùng bấm chuyển:
  //   · sheet có cột "Các khu" (dự án khu public, là BẢNG BÁO CÁO)  → BẢNG KHU (lưới ô, mỗi ô 1 khu);
  //   · còn lại (ma trận bàn giao có block "01","02","03"…)          → HEATMAP bản đồ căn.
  // Đọc region 1 lần ở đây để quyết, rồi mới render đúng dạng (region được cache nên không tải 2 lần).
  const regionQ = useQuery({
    queryKey: ["zone-region", sel?.fileId, sel?.sheet, sel?.range],
    queryFn: () => loadRegion(sel!.fileId, { sheetName: sel!.sheet, range: sel!.range, tl: sel!.tl, br: sel!.br }),
    enabled: !!sel, staleTime: 5 * 60 * 1000,
  });
  const isZone = !!regionQ.data && zonesOfSheet(regionQ.data.sh, regionQ.data.range).length > 0;

  const narrowTop = useIsMobile();   // dien thoai: thanh tren thu gon, bo nut phu
  return (
    <div style={{ minHeight: "100vh", background: "#eef2f7", fontFamily: "system-ui,-apple-system,Segoe UI,sans-serif" }}>
      {/* HEADER + bộ lọc dự án */}
      <div style={{ background: `linear-gradient(120deg,${C.navy},#1e3a5f)`, color: "#fff", padding: narrowTop ? "8px 10px" : "16px 16px 18px" }}>
        <div style={{ maxWidth: PAGE_W, margin: "0 auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: narrowTop ? 8 : 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: narrowTop ? 14 : 19, fontWeight: 800 }}>📸 Hình ảnh mỗi ngày</div>
          </div>
          {/* ĐIỆN THOẠI: select phải CO được (minWidth 0 + maxWidth 100%) — không thì tên dự án dài
              đẩy rộng cả trang, sinh cuộn ngang toàn màn. */}
          <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flex: "1 1 220px", minWidth: 0, maxWidth: 460 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, opacity: .85, textTransform: "uppercase", letterSpacing: ".04em", flexShrink: 0 }}>Dự án</span>
            <select value={selKmt ? selId : (sel ? projId(sel) : "")} onChange={(e) => setSelId(e.target.value)}
              style={{ height: 40, borderRadius: 10, border: "none", padding: "0 12px", fontSize: 14, fontWeight: 700, color: C.ink, background: "#fff", flex: 1, minWidth: 0, maxWidth: "100%" }}>
              {list.length === 0 && khongMaTran.length === 0 && <option value="">(chưa có dự án nào)</option>}
              {list.length > 0 && (
                <optgroup label="Có ma trận lắp đặt">
                  {list.map((p) => <option key={projId(p)} value={projId(p)}>{p.name}{p.maCT ? ` · ${p.maCT}` : ""}</option>)}
                </optgroup>
              )}
              {khongMaTran.length > 0 && (
                <optgroup label="Chưa có ma trận — ảnh gom chung dự án">
                  {khongMaTran.map((p) => <option key={kmtId(p)} value={kmtId(p)}>{p.name}{p.maCT ? ` · ${p.maCT}` : ""}</option>)}
                </optgroup>
              )}
            </select>
          </label>
          {/* Lối vào thứ hai (xem TOÀN BỘ media dự án): ĐIỆN THOẠI bỏ đi cho gọn — vào đây là để bấm ô căn;
              xem cả dự án thì bấm nút “Media” ngay dòng dự án bên ePMP. Máy tính giữ nguyên. */}
          {!narrowTop && (
          <button type="button" disabled={!sel && !selKmt} onClick={() => { const ten = selKmt?.name || sel?.name; if (!ten) return; setPick({ toa: "", can: "", scope: "project" }); track("media_project", ten); }}
            style={{ flexShrink: 0, border: "1px solid rgba(255,255,255,.35)", background: "rgba(255,255,255,.12)", color: "#fff",
              borderRadius: 9, padding: "9px 13px", fontSize: 12.5, fontWeight: 700, cursor: sel ? "pointer" : "default" }}>
            🖼 Toàn bộ media dự án
          </button>
          )}
        </div>
      </div>

      {/* MA TRẬN LẮP ĐẶT — bấm ô để mở media của căn */}
      <div style={{ maxWidth: PAGE_W, margin: "0 auto", padding: narrowTop ? "6px 0 24px" : "10px 8px 32px" }}>
        {missProject ? (
          <div style={{ background: "#fff", borderRadius: 14, padding: "26px 20px", textAlign: "center", color: C.sub, fontSize: 13.5, lineHeight: 1.7, boxShadow: "0 10px 30px rgba(15,23,42,.08)" }}>
            Dự án <b style={{ color: C.ink }}>{missProject}</b> chưa được gắn link ma trận nên chưa có bảng để bấm.
            <div style={{ marginTop: 6, fontSize: 12.5 }}>PMO vào ePMP → dòng dự án → “Gắn/Sửa link” để gắn ma trận, hoặc chọn dự án khác ở ô trên.</div>
            <button type="button" onClick={() => setMissProject(null)}
              style={{ marginTop: 14, border: "none", borderRadius: 9, padding: "8px 16px", background: C.tealD, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              Xem dự án đang chọn
            </button>
          </div>
        ) : chiXem ? (
          /* CHƯA CÓ MA TRẬN — không có bảng để bấm, nên mở thẳng kho ảnh chung của dự án.
             Ảnh vẫn tách kho theo từng dự án, chỉ là không chia theo căn. */
          <div style={{ background: "#fff", borderRadius: 14, padding: "26px 20px", textAlign: "center", boxShadow: "0 10px 30px rgba(15,23,42,.08)" }}>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: C.ink }}>{selKmt?.name || sel?.name}</div>
            <div style={{ marginTop: 6, fontSize: 13, color: C.sub, lineHeight: 1.7 }}>
              Dự án chưa có ma trận lắp đặt nên không có bảng để bấm về từng căn.
              <br />Ảnh và clip của dự án gom chung một kho — vẫn bắt buộc kèm báo cáo hiện trạng khi tải lên.
            </div>
            <button type="button" onClick={() => { const ten = selKmt?.name || sel?.name || ""; setPick({ toa: "", can: "", scope: "project" }); track("media_project", ten); }}
              style={{ marginTop: 16, border: "none", borderRadius: 10, padding: "11px 20px", background: C.tealD, color: "#fff", fontSize: 13.5, fontWeight: 800, cursor: "pointer" }}>
              🖼 Mở kho ảnh của dự án
            </button>
          </div>
        ) : listQ.isPending ? (
          <div style={{ padding: 40, textAlign: "center", color: C.sub, fontSize: 13.5 }}>Đang tải danh sách dự án…</div>
        ) : list.length === 0 ? (
          <ManualEntry onOpen={(project, toa, can) => setPick({ project, toa, can, scope: "can" })} />
        ) : sel ? (
          regionQ.isPending
            ? <div style={{ padding: 40, textAlign: "center", color: C.sub, fontSize: 13.5 }}>Đang tải bảng của dự án…</div>
            : isZone
              ? <ZoneBoard key={projId(sel) + ":z"} proj={sel} canEdit={canEdit} onPick={(toa, can) => { setPick({ toa, can, scope: "can" }); track("media_open", `${sel.name} · ${can}`); }} />
              : <MatrixBoard key={projId(sel)} proj={sel} canEdit={canEdit} onPick={(toa, can) => { setPick({ toa, can, scope: "can" }); track("media_open", `${sel.name} · ${toa ? toa + " · " : ""}${can}`); }} />
        ) : null}
      </div>

      {pick && <CanMediaDialog project={pick.project ?? selKmt?.name ?? sel?.name ?? ""}
        hid={pick.project ? undefined : (selKmt?.hid ?? sel?.hid)} maCT={selKmt?.maCT ?? sel?.maCT}
        projKey={pick.project ? `N:${pick.project}` : (selKmt ? kmtId(selKmt) : (sel ? projId(sel) : ""))}
        initialToa={pick.toa ?? ""} initialCan={pick.can} scope={pick.scope} onClose={() => setPick(null)} />}
    </div>
  );
}

/** LỐI NHẬP TAY (khi chưa có ma trận / fallback): dự án + Toà + phòng → mở popup media của phòng đó. */
function ManualEntry({ onOpen }: { onOpen: (project: string, toa: string, can: string) => void }) {
  const [project, setProject] = useState("Mini Hotel PQ (B1-B5) Phòng");
  const [toa, setToa] = useState("B1");
  const [can, setCan] = useState("");
  const ready = project.trim() && can.trim();
  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: "24px 20px", color: C.sub, fontSize: 13.5, lineHeight: 1.7, boxShadow: "0 10px 30px rgba(15,23,42,.08)", maxWidth: 560, margin: "0 auto" }}>
      <div style={{ marginBottom: 14 }}>Chưa có dự án gắn ma trận trên bản này. Trong lúc đó, nhập <b style={{ color: C.ink }}>dự án</b> + <b style={{ color: C.ink }}>Toà</b> + <b style={{ color: C.ink }}>phòng</b> để xem / tải ảnh, video (đúng folder <code>Media/dự án/Toà/phòng</code>):</div>
      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: C.sub }}>Tên dự án (tên folder trên Drive)</span>
          <input value={project} onChange={(e) => setProject(e.target.value)}
            style={{ height: 42, borderRadius: 10, border: "1.5px solid #dbe2ea", padding: "0 12px", fontSize: 14, color: C.ink, background: "#f8fafc" }} />
        </label>
        <div style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: C.sub }}>Toà</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["B1", "B2", "B3", "B4", "B5"].map((b) => (
              <button key={b} type="button" onClick={() => setToa(b)}
                style={{ height: 38, minWidth: 52, borderRadius: 9, fontSize: 14, fontWeight: 800, cursor: "pointer",
                  border: toa === b ? `2px solid ${C.tealD}` : "1.5px solid #dbe2ea", background: toa === b ? C.tealD : "#f8fafc", color: toa === b ? "#fff" : "#475569" }}>{b}</button>
            ))}
            <input value={toa} onChange={(e) => setToa(e.target.value)} placeholder="hoặc gõ Toà"
              style={{ height: 38, width: 120, borderRadius: 9, border: "1.5px solid #dbe2ea", padding: "0 10px", fontSize: 13.5, color: C.ink, background: "#f8fafc" }} />
          </div>
        </div>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: C.sub }}>Phòng / mã căn</span>
          <input value={can} onChange={(e) => setCan(e.target.value)} placeholder="vd 609"
            style={{ height: 42, borderRadius: 10, border: "1.5px solid #dbe2ea", padding: "0 12px", fontSize: 14, color: C.ink, background: "#f8fafc" }} />
        </label>
        <button type="button" disabled={!ready} onClick={() => onOpen(project.trim(), toa.trim(), can.trim())}
          style={{ height: 44, borderRadius: 11, border: "none", background: ready ? `linear-gradient(120deg,${C.tealD},${C.teal})` : "#cbd5e1", color: "#fff", fontSize: 14.5, fontWeight: 800, cursor: ready ? "pointer" : "default" }}>
          Mở media của phòng
        </button>
      </div>
    </div>
  );
}

const txt = (el?: Element | null) => (el?.textContent || "").replace(/\s+/g, " ").trim();
/** Ô tiêu đề đơn vị của lưới: SỐ CĂN (mỗi file gõ một kiểu — Mini Hotel "01".."21", Hyatt "1".."16")
 *  hoặc hành lang ("HL"). Nhận 1-3 chữ số; khi ghép mã căn thì luôn đệm về 2 chữ số cho đồng nhất. */
const isUnitHdr = (t: string) => /^\d{1,3}$/.test(t) || /^HL$/i.test(t);
const pad2 = (t: string) => (t.length < 2 ? "0" + t : t);
/** Ô đầu hàng header là MÃ TOÀ hay chỉ là chữ tiêu đề? Dự án nhiều toà ghi "B1".."B5"; dự án 1 toà lại
 *  ghi tiêu đề cột như "KHU PHÒNG" — lấy nguyên si sẽ đẻ ra thư mục Drive tên "KHU PHÒNG". Chỉ nhận
 *  dạng mã toà ngắn (B1 · A · Tháp A · Khối B); còn lại trả "" = dự án không chia toà. */
const GENERIC_LBL = /^(khu|phòng|khu phòng|căn|stt|tầng|floor|room|đơn vị|hạng mục|các khu)$/i;
function toaOf(raw: string): string {
  const v = raw.replace(/\s+/g, " ").trim();
  if (!v || GENERIC_LBL.test(v)) return "";
  if (/^[A-Za-z]{1,3}\s?\d{1,3}$/.test(v)) return v.replace(/\s+/g, "");
  if (/^[A-Za-z]{1,4}$/.test(v)) return v;
  if (/^(tháp|khối|toà|tòa|block)\s+\S{1,4}$/i.test(v)) return v;
  return "";
}
/** HÀNG HEADER của 1 block căn: dãy ≥4 ô SỐ ở CỘT LIỀN NHAU và TĂNG ĐÚNG 1 ("01,02,03,04" hoặc
 *  "1,2,3,4"). Nhận cả số không đệm 0 (Hyatt Hạ Long đánh 1..16) — bù lại siết từ 3 lên 4 ô liên tiếp
 *  để dòng tổng/dòng số liệu không bị nhận nhầm là header. Bảng không có hàng nào như vậy = không phải
 *  bản đồ căn → xử theo bảng danh sách khu. */
const UNIT_RUN = 4;
export function isHeaderRow(cells: HTMLTableCellElement[]): boolean {
  const num = cells.filter((x) => /^\d{1,3}$/.test(txt(x))).sort((a, b) => (+(a.dataset.c ?? 0)) - (+(b.dataset.c ?? 0)));
  let run = 1;
  for (let i = 1; i < num.length; i++) {
    const adj = +(num[i].dataset.c ?? 0) === +(num[i - 1].dataset.c ?? 0) + 1 && +txt(num[i]) === +txt(num[i - 1]) + 1;
    run = adj ? run + 1 : 1;
    if (run >= UNIT_RUN) return true;
  }
  return false;
}

/** Dự án KHU PUBLIC: sheet không phải heatmap mà là BẢNG DANH SÁCH, có sẵn cột "Các khu" (mỗi dòng 1 khu:
 *  Public Toilet 1,3 · Khối A · Main Lobby · Nhà Hàng Maxine…). Dùng THẲNG bảng đó làm chỗ bấm — khỏi bắt
 *  admin gõ lại danh sách khu. Trả {c, headerR} của cột khu; không có → null (xử theo kiểu heatmap). */
export function zoneCol(table: HTMLTableElement): { c: number; headerR: number } | null {
  for (const tr of Array.from(table.rows).slice(0, 20)) {
    for (const td of Array.from(tr.cells)) {
      if (!/^(các khu|khu vực|tên khu|khu|hạng mục|các hạng mục)$/i.test(txt(td))) continue;
      const c = +(td.dataset.c ?? -1), headerR = +(td.dataset.r ?? -1);
      if (c >= 0 && headerR >= 0) return { c, headerR };
    }
  }
  return null;
}

/** SUY (Toà, phòng) TỪ 1 Ô MA TRẬN — theo đúng cấu trúc bảng bàn giao:
 *    hàng header block:  [B1] [01] [02] … [18] [HL] …     ← ô đầu = TOÀ, các ô sau = số phòng
 *    hàng dữ liệu:       [L06]  2   2   3  …               ← ô đầu = TẦNG, các ô = mã trạng thái
 *  → phòng = số tầng + số phòng ("L06" × "01" → "601"); cột "HL" → "Hanh lang T6" (đúng tên folder Drive).
 *  Bấm ô ngoài lưới (dòng tổng, cột %, nhãn) → null, không mở popup. */
export function canAt(td: HTMLTableCellElement, table: HTMLTableElement): { toa: string; can: string } | null {
  const r = +(td.dataset.r ?? -1), c = +(td.dataset.c ?? -1);
  if (r < 0 || c < 0) return null;
  const rowOf = (rr: number) => Array.from(table.querySelectorAll<HTMLTableCellElement>(`tr[data-r="${rr}"] > td`));
  const label = (cells: HTMLTableCellElement[]) => txt(cells.find((x) => txt(x) !== ""));   // ô có chữ ở cột nhỏ nhất
  const zc = zoneCol(table);
  if (zc) {                                                         // BẢNG DANH SÁCH KHU (không phải heatmap)
    if (r <= zc.headerR) return null;                               // hàng tiêu đề trở lên → bỏ qua
    const name = txt(rowOf(r).find((x) => +(x.dataset.c ?? -1) === zc.c));
    return name ? { toa: "", can: name } : null;                    // bấm ô nào trong dòng cũng ra khu của dòng đó
  }
  if (isHeaderRow(rowOf(r))) return null;                           // bấm ngay hàng header → bỏ qua
  // đi NGƯỢC LÊN tìm hàng HEADER GẦN NHẤT của block, rồi mới xét ô cùng cột có phải số phòng không
  let hdr: HTMLTableCellElement[] | null = null;
  for (let rr = r - 1; rr >= 0 && r - rr <= 40; rr--) {
    const cells = rowOf(rr);
    if (cells.length && isHeaderRow(cells)) { hdr = cells; break; }
  }
  if (!hdr) return null;                                            // không nằm trong block căn nào
  const unit = txt(hdr.find((x) => +(x.dataset.c ?? -1) === c));
  if (!isUnitHdr(unit)) return null;                                // cột % / cột chú giải → bỏ qua
  // TẦNG phải nằm ĐÚNG CỘT NHÃN của block (cùng cột với ô "B1" của header). Nếu lấy "ô có chữ đầu tiên"
  // của hàng thì các dòng NGOÀI block (dòng trắng giữa 2 block, dòng legend bên phải) cũng ra số → phòng ma.
  const lblC = +(hdr.find((x) => txt(x) !== "")?.dataset.c ?? -1);
  const floor = (txt(rowOf(r).find((x) => +(x.dataset.c ?? -1) === lblC)).match(/(\d+)/) || [])[1];   // "L06" → "06"
  if (!floor) return null;
  const toa = toaOf(label(hdr));                                   // "B1"; bảng 1 toà → ""
  const can = /^HL$/i.test(unit) ? `Hanh lang T${+floor}` : `${+floor}${pad2(unit)}`;
  return { toa, can };
}

/** FORM RIÊNG CHO MÀN MEDIA. Ma trận lấy theo link PMO gắn (dùng chung với dashboard ePMP), nhưng ở đây
 *  mục tiêu là UP CLIP nên admin cần ẩn bớt phần thừa (dòng tổng, cột %, chú giải). Nếu dùng chung
 *  formKey với dashboard thì xoá ở đây sẽ xoá LUÔN trên dashboard → tách hậu tố "::media". */
const mediaFormKey = (p: InstallProj) => (p.formKey || `${p.fileId}::${p.sheet || ""}::${p.range || ""}`) + "::media";

/** Bảng ma trận (MatrixFormEditor) + BẮT CLICK Ô → suy (Toà, phòng) rồi mở popup media của phòng đó.
 *  ADMIN: bật thanh công cụ "Chỉnh như Excel" của MatrixFormEditor (ẩn/hiện hàng-cột, cỡ hàng-cột, sửa
 *  chữ, tô màu, lưu form). Khi đang chỉnh, KHÔNG mở popup media — nhường chuột cho việc quét chọn ô. */
function MatrixBoard({ proj, canEdit, onPick }: { proj: InstallProj; canEdit: boolean; onPick: (toa: string, can: string) => void }) {
  const narrow = useIsMobile();   // dien thoai: thanh tren thu gon toi da, nhuong cho cho bang
  const wrapRef = useRef<HTMLDivElement>(null);
  const [miss, setMiss] = useState(0);   // đếm lần bấm vào ô KHÔNG phải căn → nhắc nhẹ
  // Khong con ve chu giai o thanh tren (ma tran da co san bang mau) -> khong giu state legend nua.
  // Cỡ khung chiếu ma trận do người dùng KÉO — nhớ lại lần sau. Đặt sau khi mount để khỏi lệch hydration.

  // CĂN NÀO ĐÃ CÓ MEDIA → chấm dấu lên ô, nhìn ma trận là biết chỗ nào đã có tư liệu, chỗ nào còn trống.
  const mediaQ = useQuery({
    queryKey: ["projmedia", projId(proj)],
    queryFn: () => listProjectMedia({ data: { project: proj.name, hid: proj.hid, maCT: proj.maCT } }),
    staleTime: 60_000,
  });
  const marks = useMemo(() => {
    const m = new Map<string, { photos: number; videos: number; at: string }>();
    for (const c of mediaQ.data?.cans ?? []) m.set(`${c.toa} ${c.can}`, { photos: c.photos, videos: c.videos, at: c.at });
    return m;
  }, [mediaQ.data]);

  // Gắn dấu vào ô. Editor render lại bảng mỗi lần đổi form → MutationObserver để chấm lại, khỏi mất dấu.
  useEffect(() => {
    const wrap = wrapRef.current; if (!wrap || !marks.size) return;
    let timer: number | undefined;
    const apply = () => {
      const table = wrap.querySelector("table.sd-tb") as HTMLTableElement | null; if (!table) return;
      for (const td of Array.from(table.querySelectorAll<HTMLTableCellElement>("td[data-c]"))) {
        const hit = canAt(td, table);
        const m = hit && marks.get(`${hit.toa} ${hit.can}`);
        // Chỉ chấm căn có tư liệu MỚI (hôm nay / hôm qua). Căn có tư liệu cũ vẫn mở xem được như
        // thường, chỉ là không đeo dấu nữa — dấu để tìm chỗ VỪA CẬP NHẬT.
        const k = m ? freshMark(m.at) : null;
        td.classList.toggle("has-media", !!k);
        if (m && k) {
          // Chấm dấu NÓI LUÔN LÚC NÀO TẢI LÊN: màu + phần rẻ quạt được tô. Đặt bằng biến CSS trên từng
          // ô, còn phần vẽ để chung một quy tắc ::after (xem khối <style> phía dưới).
          td.style.setProperty("--mk-color", k.color);
          td.style.setProperty("--mk-deg", `${k.deg}deg`);
          td.title = `${hit!.toa ? hit!.toa + " · " : ""}${hit!.can} — ${m.photos} ảnh · ${m.videos} video · ${k.label}`;
        } else {
          td.style.removeProperty("--mk-color");
          td.style.removeProperty("--mk-deg");
        }
      }
    };
    apply();
    const ob = new MutationObserver(() => { window.clearTimeout(timer); timer = window.setTimeout(apply, 120); });
    ob.observe(wrap, { childList: true, subtree: true });
    return () => { ob.disconnect(); window.clearTimeout(timer); };
  }, [marks]);

  function onClick(e: React.MouseEvent) {
    // Editor gắn class "mfe-edit" lên khung khi bật chế độ chỉnh → lúc đó nhường chuột cho editor.
    if (wrapRef.current?.querySelector(".mfe-host.mfe-edit")) return;
    const t = (e.target as HTMLElement).closest("td[data-c]") as HTMLTableCellElement | null;
    if (!t) return;
    const table = wrapRef.current?.querySelector("table.sd-tb") as HTMLTableElement | null;
    if (!table) return;
    const hit = canAt(t, table);
    if (!hit) { setMiss((n) => n + 1); return; }
    setMiss(0);
    onPick(hit.toa, hit.can);
  }

  return (
    // overflow hidden: ma trận TỰ CUỘN NGANG trong .sd-scroll của nó — thẻ card không được rộng theo
    // bảng, không thì cả trang cuộn ngang trên điện thoại.
    // BO HOP BO GOC: vien bo goc + do bong + le trong chi de trang tri, ma an mat be ngang dung
    // luc ma tran dang can. Nay phang, tran vien - bang duoc rong them ~24px moi ben.
    <div style={{ background: "#fff", overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: narrow ? "4px 10px" : "6px 14px", margin: narrow ? "0 2px 6px" : "2px 4px 10px" }}>
        {/* Chi giu CANH BAO bam nham o. Cau huong dan "bam vao o de xem" bo han: ai cung bam thu mot
            cai la biet, giu lai chi ton mot dong ngang tren cung. */}
        {miss && (
          <span style={{ fontSize: 11.5, fontWeight: 600, color: "#b45309" }}>
            Ô này không phải căn (dòng tổng / cột %). Bấm vào ô trong lưới phòng.
          </span>
        )}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: C.sub }}>
          {mediaQ.isPending ? "đang dò căn có media…" : mediaQ.isError ? "không đọc được Drive" : `${marks.size} căn đã có ảnh / video`}
        </span>
        {/* BO dai chu giai mau: chinh ma tran DA CO SAN bang "Mau / Dien giai" o ben phai (thay ro trong
            anh chup), ve lai o thanh tren la noi dung trung nhau hai lan, ma tren dien thoai no an mat
            ba dong. Bo ca hai khoi may tinh - dien thoai lech nhau. */}
      </div>
      {/* DẤU CÓ MEDIA: chấm tròn góc dưới-phải ô. Dùng ::after nên không đụng chữ/màu nền của ô,
          và không cần sửa renderer — bảng render lại thì MutationObserver chấm lại. */}
      <style>{`.mtx-mark td.has-media{position:relative}
.mtx-mark td.has-media::after{content:"";position:absolute;right:2px;bottom:2px;width:13px;height:13px;border-radius:50%;
  background:conic-gradient(var(--mk-color,#334155) var(--mk-deg,360deg), #fff 0);
  box-shadow:0 0 0 1.6px #fff, 0 0 0 2.8px rgba(15,23,42,.92), 0 1px 3px rgba(2,6,23,.45)}`}</style>
      <div ref={wrapRef} onClick={onClick} className="mtx-mark" style={{ cursor: "pointer", minWidth: 0 }}>
        <MatrixFormEditor fid={proj.fileId} opts={{ sheetName: proj.sheet, range: proj.range, tl: proj.tl, br: proj.br }}
          formKey={mediaFormKey(proj)} canEdit={canEdit} natural blendText zoomable boxResize />
      </div>
    </div>
  );
}


/** KHOÁ lưu tuỳ chỉnh BẢNG KHU của 1 dự án (chỉ còn SỐ CỘT — tên khu đọc thẳng từ sheet). */
const zoneKey = (p: InstallProj) => `media:zones::${p.maCT || p.name}`;

/** ĐỌC DANH SÁCH KHU TỪ SHEET: dự án khu public không phải heatmap mà là BẢNG BÁO CÁO có sẵn cột
 *  "Các khu" (Public Toilet 1,3 · Khối A · Main Lobby · Nhà Hàng Maxine…). Lấy đúng cột đó, bỏ dòng
 *  trống/trùng. Nhờ vậy admin KHÔNG phải gõ lại danh sách khu. Không thấy cột → [] (dùng heatmap). */
/** Tiêu đề cột khu — CÙNG MỘT FORM báo cáo nhưng mỗi file gõ tên hơi khác: "Các khu" (NPHH) ·
 *  "Các khu PUBLIC" (Villa Tulip) · "Khu vực" · "Hạng mục". Nhận cả cụm có chữ đuôi phía sau. */
const ZONE_HDR = /^(các\s+)?(khu\s*vực|tên\s*khu|hạng\s*mục|khu)\b/i;
/** Sheet có phải MA TRẬN CĂN không: có hàng chứa dãy ≥3 ô 2 chữ số ở CỘT LIỀN NHAU, TĂNG ĐÚNG 1
 *  ("01","02","03"…). Dùng để ƯU TIÊN heatmap — nếu không kiểm cái này, một sheet ma trận lỡ có chữ
 *  "khu" ở đâu đó sẽ bị đổ nhầm sang bảng khu. */
export function hasUnitBlocks(sh: XLSX.WorkSheet, rangeStr?: string): boolean {
  const ref = sh["!ref"]; if (!ref) return false;
  const XL = XLSXNS;
  let b = XL.utils.decode_range(ref);
  const rs = (rangeStr ?? "").trim().replace(/^[^!]*!/, "");
  if (rs) { try { b = XL.utils.decode_range(rs); } catch { /* giữ nguyên */ } }
  const at = (r: number, c: number) => { const cl = sh[XL.utils.encode_cell({ r, c })]; const v = cl?.w != null ? cl.w : cl?.v; return v == null ? "" : String(v).trim(); };
  for (let r = b.s.r; r <= b.e.r; r++) {
    let run = 1;
    for (let c = b.s.c + 1; c <= b.e.c; c++) {
      const a = at(r, c - 1), x = at(r, c);
      run = (/^\d{1,3}$/.test(a) && /^\d{1,3}$/.test(x) && +x === +a + 1) ? run + 1 : 1;
      if (run >= UNIT_RUN) return true;
    }
  }
  return false;
}

export function zonesOfSheet(sh: XLSX.WorkSheet, rangeStr?: string): string[] {
  if (hasUnitBlocks(sh, rangeStr)) return [];   // là ma trận căn → không phải bảng khu
  const ref = sh["!ref"]; if (!ref) return [];
  const XL = XLSXNS;
  const full = XL.utils.decode_range(ref);
  let b = full;
  const rs = (rangeStr ?? "").trim().replace(/^[^!]*!/, "");
  if (rs) { try { b = XL.utils.decode_range(rs); } catch { b = full; } }
  const at = (r: number, c: number) => { const v = sh[XL.utils.encode_cell({ r, c })]?.v; return v == null ? "" : String(v).replace(/\s+/g, " ").trim(); };
  for (let r = b.s.r; r <= Math.min(b.e.r, b.s.r + 20); r++)
    for (let c = b.s.c; c <= b.e.c; c++) {
      if (!ZONE_HDR.test(at(r, c))) continue;
      const seen = new Set<string>(), out: string[] = [];
      for (let rr = r + 1; rr <= b.e.r; rr++) {
        const v = at(rr, c);
        if (!v || seen.has(v)) continue;
        seen.add(v); out.push(v);
      }
      return out;
    }
  return [];
}

/** BẢNG KHU — dự án khu public (sheet là BẢNG BÁO CÁO, không dựng được heatmap bản đồ ô).
 *  Tên khu lấy THẲNG từ cột "Các khu" của sheet, nhưng BỐ CỤC LẠI thành lưới ô cho dễ bấm: mỗi ô 1 khu,
 *  bấm ô → mở kho ảnh/video của khu (`ePMP/Media/<dự án>/<tên khu>/(Hình ảnh|Video)`, không có cấp Toà).
 *  Khu nào đã có ảnh/video thì chấm dấu, giống ma trận. Admin chỉ chỉnh SỐ CỘT rồi Lưu (mọi người thấy chung). */
function ZoneBoard({ proj, canEdit, onPick }: { proj: InstallProj; canEdit: boolean; onPick: (toa: string, can: string) => void }) {
  const qc = useQueryClient();
  const regionQ = useQuery({
    queryKey: ["zone-region", proj.fileId, proj.sheet, proj.range],
    queryFn: () => loadRegion(proj.fileId, { sheetName: proj.sheet, range: proj.range, tl: proj.tl, br: proj.br }),
    staleTime: 5 * 60 * 1000,
  });
  const names = useMemo(() => (regionQ.data ? zonesOfSheet(regionQ.data.sh, regionQ.data.range) : []), [regionQ.data]);
  const formsQ = useQuery({ queryKey: ["sheetforms"], queryFn: () => getSheetForms(), staleTime: 5 * 60 * 1000 });
  const savedZ = formsQ.data?.forms?.[zoneKey(proj)]?.zones;
  const [draft, setDraft] = useState<{ cols: number; h: number } | null>(null);
  const cols = draft?.cols ?? savedZ?.cols ?? 3;
  const cellH = draft?.h ?? savedZ?.h ?? 88;
  const [saving, setSaving] = useState(false);
  const setCols = (n: number) => setDraft({ cols: n, h: cellH });

  // KÉO ĐỔI CỠ Ô: nắm mép DƯỚI của ô để đổi chiều cao (bề ngang do SỐ CỘT quyết định — lưới chia đều).
  // Kéo xong mới ghi vào draft → 1 lần "Lưu bố cục" là mọi người thấy chung.
  const gridRef = useRef<HTMLDivElement>(null);
  const dragH = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const y0 = e.clientY, h0 = cellH;
    let h = h0;
    const mv = (ev: MouseEvent) => {
      h = Math.max(40, Math.min(600, Math.round(h0 + (ev.clientY - y0))));
      if (gridRef.current) gridRef.current.style.setProperty("--zone-h", h + "px");
    };
    const up = () => {
      window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up);
      setDraft({ cols, h });
    };
    window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
  };

  const mediaQ = useQuery({ queryKey: ["projmedia", projId(proj)], queryFn: () => listProjectMedia({ data: { project: proj.name, hid: proj.hid, maCT: proj.maCT } }), staleTime: 60_000 });
  const marks = useMemo(() => {
    const m = new Map<string, { photos: number; videos: number }>();
    for (const c of mediaQ.data?.cans ?? []) if (!c.toa) m.set(c.can, { photos: c.photos, videos: c.videos });
    return m;
  }, [mediaQ.data]);

  const saveCols = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await saveSheetForm({ data: { key: zoneKey(proj), spec: { zones: draft }, devAs: new URLSearchParams(window.location.search).get("as") } });
      await qc.invalidateQueries({ queryKey: ["sheetforms"] });
      setDraft(null);
    } catch (e) { window.alert((e as Error).message); } finally { setSaving(false); }
  };

  const btn: React.CSSProperties = { border: "1px solid #dbe2ea", background: "#fff", borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 700, color: "#475569", cursor: "pointer" };
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: 14, boxShadow: "0 10px 30px rgba(15,23,42,.10)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 14px", marginBottom: 12 }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: C.sub }}>Bấm vào ô của khu để xem / tải ảnh · video của khu đó.</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: C.sub }}>
          {mediaQ.isPending ? "đang dò khu có media…" : mediaQ.isError ? "không đọc được Drive" : `${marks.size} khu đã có ảnh / video`}
        </span>
        {canEdit && names.length > 0 && (
          <span style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
            <span style={{ fontSize: 11.5, color: C.sub }}>Số cột</span>
            {[2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setCols(n)}
                style={{ ...btn, padding: "4px 9px", ...(cols === n ? { background: C.tealD, color: "#fff", borderColor: C.tealD } : {}) }}>{n}</button>
            ))}
            {draft && <button type="button" style={btn} onClick={() => setDraft(null)}>Hoàn tác</button>}
            <button type="button" disabled={!draft || saving} onClick={saveCols}
              style={{ ...btn, background: draft && !saving ? C.tealD : "#cbd5e1", color: "#fff", borderColor: "transparent", cursor: draft && !saving ? "pointer" : "default" }}>
              {saving ? "Đang lưu…" : "💾 Lưu bố cục"}
            </button>
          </span>
        )}
      </div>
      {regionQ.isPending ? (
        <div style={{ padding: 30, textAlign: "center", color: C.sub, fontSize: 13 }}>Đang đọc danh sách khu từ file…</div>
      ) : names.length === 0 ? (
        <div style={{ border: "1px dashed #cbd5e1", borderRadius: 12, padding: "26px 12px", textAlign: "center", color: C.sub, fontSize: 12.5 }}>
          Không thấy cột “Các khu” trong sheet của dự án này.
        </div>
      ) : (
        <div ref={gridRef} style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, border: "2px solid #0f172a", ["--zone-h" as string]: cellH + "px" }}>
          {names.map((n) => {
            const m = marks.get(n);
            return (
              <button key={n} type="button" onClick={() => onPick("", n)}
                title={m ? `${n} — ${m.photos} ảnh · ${m.videos} video` : `${n} — chưa có ảnh/video`}
                style={{ position: "relative", height: "var(--zone-h)", padding: "14px 12px", border: "1px solid #0f172a", background: "#fff",
                  color: "#1e3a8a", fontSize: 13, fontWeight: 600, textAlign: "center", cursor: "pointer", wordBreak: "break-word" }}>
                {n}
                {m && <span style={{ position: "absolute", right: 5, bottom: 5, width: 7, height: 7, borderRadius: "50%", background: C.tealD, boxShadow: "0 0 0 1.4px rgba(15,23,42,.35)" }} />}
                {canEdit && <span onMouseDown={dragH} title="Kéo để đổi chiều cao ô"
                  style={{ position: "absolute", left: 0, right: 0, bottom: -3, height: 7, cursor: "ns-resize" }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** POPUP MEDIA CỦA 1 PHÒNG / KHU — MỘT KHO CHUNG: ảnh và video nằm CÙNG một danh sách.
 *  Bố cục: khung xem LỚN ở trên (ảnh thì hiện ảnh, video thì phát video) + dải thumbnail CUỘN NGANG ở
 *  dưới, bấm qua lại từng cái; có nút ‹ › và phím ←/→. Toà + Phòng vẫn sửa tay được để không gắn nhầm. */
export function CanMediaDialog({ project, hid, maCT, projKey, initialToa, initialCan, scope, onClose }: { project: string; hid?: string; maCT?: string; projKey: string; initialToa: string; initialCan: string; scope: "can" | "project"; onClose: () => void }) {
  const narrow = useIsMobile();   // dien thoai: popup chiem tron man, video duoc het be ngang
  // DIEN THOAI: o Toa/Phong + 2 nut tai len an sau nut "+", vi chung an mat 3 dong header (~230px
  // tren man 900px) trong khi xem clip khong dung toi. Bam "+" moi mo ra de tai anh/video.
  const [upOpen, setUpOpen] = useState(false);
  // Quyền sửa chú thích = admin / PMO, cùng chuẩn với quyền chỉnh ma trận ở màn ngoài.
  const devAsDlg = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("as") : null;
  const meDlg = useQuery({ queryKey: ["media-whoami", devAsDlg], queryFn: () => whoami({ data: { devAs: devAsDlg } }) });
  const rolesDlg = useQuery({ queryKey: ["media-roles"], queryFn: () => fetchUserRoles(), staleTime: 5 * 60 * 1000 });
  const xemNhuUserDlg = useXemNhuUser();
  const canEditCap = !xemNhuUserDlg && !!(meDlg.data?.isAdmin || (meDlg.data?.email && roleOf(rolesDlg.data?.roles ?? {}, meDlg.data.email) === "PMO"));
  const [toa, setToa] = useState(initialToa);
  const [can, setCan] = useState(initialCan);
  const [busy, setBusy] = useState<null | string>(null);   // thông báo tiến trình upload
  const qc = useQueryClient();
  // NGUỒN: TOÀN BỘ media của DỰ ÁN (1 lượt quét), gộp theo PHÒNG/KHU — mở 1 căn là xem được hết,
  // bấm qua lại giữa các phòng luôn. Dùng chung queryKey với dấu chấm ngoài ma trận nên không gọi thừa.
  const q = useQuery({ queryKey: ["projmedia", projKey], queryFn: () => listProjectMedia({ data: { project, hid, maCT } }), staleTime: 60_000 });
  type Item = { id: string; kind: "photo" | "video"; date?: string; toa: string; can: string; desc?: string };
  // Mặc định mỗi căn chỉ nạp 2 mục mới nhất (đủ để đối chiếu bản mới với bản trước). Bấm "Xem thêm"
  // mới gọi Drive lấy đủ của ĐÚNG căn đó — Drive vẫn giữ nguyên toàn bộ, chỉ là không nạp sẵn.
  const [themCan, setThemCan] = useState<Record<string, Item[]>>({});
  const [themBusy, setThemBusy] = useState<string | null>(null);
  const groups = useMemo(() => {
    const gs = (q.data?.cans ?? []).map((c) => ({
      toa: c.toa, can: c.can,
      tong: c.tong ?? c.media.length,
      items: (themCan[`${c.toa}\u0000${c.can}`] ?? [...c.media]
        .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "photo" ? -1 : 1))
        .map((x) => ({ ...x, toa: c.toa, can: c.can } as Item))),
    })).filter((g) => g.items.length);
    // PHẠM VI: bấm 1 ô ma trận → CHỈ phòng đó; bấm tên dự án → CẢ dự án nhưng vẫn gom theo phòng
    // (để người khác nhìn là biết ảnh/video thuộc phòng nào).
    const key = (t: string, c: string) => `${t}\u0000${c}`;
    const here = key(toa.trim(), can.trim());
    if (scope === "can") return gs.filter((g) => key(g.toa, g.can) === here);
    return gs.sort((a, b) => a.toa.localeCompare(b.toa, "vi") || a.can.localeCompare(b.can, "vi", { numeric: true }));
  }, [q.data, toa, can, scope, themCan]);
  const items = useMemo<Item[]>(() => groups.flatMap((g) => g.items), [groups]);
  const [sel, setSel] = useState(0);
  // CHÚ THÍCH = HỘP THOẠI như ô "Vướng mắc / Giải pháp": nhiều người viết, mỗi tin có người viết và
  // ngày viết. Nằm ngay dưới khung xem để đọc SONG SONG với hình, không đè lên hình.
  const [cap, setCap] = useState("");                       // ô nhập tin mới
  const [capEditId, setCapEditId] = useState<string | null>(null);   // đang sửa tin nào
  const [capDraft, setCapDraft] = useState("");             // nội dung đang sửa
  const [capBusy, setCapBusy] = useState(false);
  // LÔ ĐANG CHỜ BÁO CÁO: chọn tệp xong chưa tải ngay — phải ghi hiện trạng đã rồi mới cho lên.
  const [cho, setCho] = useState<{ kind: "photo" | "video"; files: File[] } | null>(null);
  const [choCap, setChoCap] = useState("");
  const choWords = choCap.trim() ? choCap.trim().split(/\s+/).length : 0;
  const [capErr, setCapErr] = useState<string | null>(null);
  const capWords = cap.trim() ? cap.trim().split(/\s+/).length : 0;
  useEffect(() => { setSel(0); }, [project]);
  useEffect(() => { setCapEditId(null); setCapErr(null); setCap(""); }, [sel]);
  const cur = items[Math.min(sel, items.length - 1)];
  const go = (d: number) => items.length && setSel((v) => (Math.min(v, items.length - 1) + d + items.length) % items.length);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
      if (e.key === "ArrowLeft") go(-1); else if (e.key === "ArrowRight") go(1); else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  // Ảnh phải tải BYTE qua Worker (file trong My Drive riêng, không nhúng thẳng được).
  const imgSrc = useImageUrls(items.filter((x) => x.kind === "photo").map((x) => x.id));
  // CLIP: tai byte QUA APP roi phat bang the <video> cua minh.
  // Truoc day nhung khung xem cua Google Drive -> tren iPhone hien HAI bo nut chong len nhau (nut cua
  // trinh phat Drive + nut cua iOS ben trong khung do), ma khung cross-origin nen khong tat bot duoc.
  // Dung the <video> thi chi con DUNG MOT trinh phat mac dinh cua may. Doi lai: clip tai xong moi
  // phat duoc (khong vua tai vua xem), nen chi tai clip DANG XEM chu khong tai san ca danh sach.
  const [vidSrc, setVidSrc] = useState<Record<string, string>>({});
  const [vidErr, setVidErr] = useState<Record<string, string>>({});
  const curVid = narrow && cur?.kind === "video" ? cur.id : "";   // chi dien thoai moi tai byte
  useEffect(() => {
    if (!curVid || vidSrc[curVid] || vidErr[curVid]) return;
    let off = false;
    void (async () => {
      try {
        const r = await readCanMediaB64({ data: { id: curVid } });
        // PHAI doi sang blob: URL. iOS Safari KHONG phat duoc video tu "data:" URI (chi anh moi duoc)
        // -> bam vao la im, khong bao gi. blob: thi Safari coi nhu mot nguon co that, phat binh thuong.
        const comma = r.dataUri.indexOf(",");
        const mime = r.dataUri.slice(5, r.dataUri.indexOf(";"));
        const bin = atob(r.dataUri.slice(comma + 1));
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([buf], { type: mime || "video/mp4" }));
        if (off) { URL.revokeObjectURL(url); return; }
        setVidSrc((m) => ({ ...m, [curVid]: url }));
      } catch (e) {
        if (!off) setVidErr((m) => ({ ...m, [curVid]: (e as Error).message || "khong tai duoc" }));
      }
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curVid]);
  // Tra bo nho lai cho trinh duyet khi dong popup (moi clip la mot blob vai chuc MB).
  useEffect(() => () => { for (const u of Object.values(vidSrc)) URL.revokeObjectURL(u); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);
  const curRoom = cur ? `${cur.toa ? cur.toa + " · " : ""}${cur.can}` : "";
  // Xem toàn dự án: ô Toà/Phòng chạy theo ảnh/video đang xem → bấm "＋ Tải ảnh" là vào ĐÚNG phòng đó.
  useEffect(() => {
    if (scope !== "project" || !cur) return;
    setToa((v) => (v === cur.toa ? v : cur.toa));
    setCan((v) => (v === cur.can ? v : cur.can));
  }, [scope, cur]);

  async function onFiles(kind: "photo" | "video", arr: File[], chuThich: string) {
    if (!arr.length || !can.trim() || !chuThich.trim()) return;
    const hong: string[] = [];              // tệp tải KHÔNG xong — phải nói ra, không được nuốt
    const xong: string[] = [];              // tệp tải XONG — ghi TÊN vào nhật ký, không chỉ đếm
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      setBusy(`Đang tải ${kind === "photo" ? "ảnh" : "video"} ${i + 1}/${arr.length} (~${mb(f.size)}MB)…`);
      try {
        const ext = (f.name.split(".").pop() || (kind === "photo" ? "jpg" : "mp4"));
        const { uploadUrl } = await startCanMediaUpload({ data: { project, hid, maCT, toa: toa.trim(), can: can.trim(), kind, ext, mime: f.type || "", origin: window.location.origin, caption: chuThich, devAs: devAsDlg } });
        // KHÔNG nuốt lỗi PUT. Trước đây bọc catch rỗng: rớt mạng / iOS khoá màn giữa chừng là Drive
        // giữ lại cái vỏ tệp 0 byte, app vẫn báo tải xong, tới lúc mở mới lòi lỗi của Google.
        // (03/09 mất trắng 60 clip đúng kiểu này.) Nay hụt tệp nào báo tên tệp đó ngay.
        let ok = true;
        try {
          const res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": f.type || "application/octet-stream" }, body: f });
          ok = res.ok;
        } catch { ok = false; }
        if (ok) xong.push(f.name); else hong.push(f.name);
      } catch { hong.push(f.name); }
    }
    setBusy(null);
    // Nhật ký giám sát: ai tải, mấy tệp, vào phòng nào — đây là thao tác ĐỔI DỮ LIỆU thật.
    // Ghi TÊN từng tệp, không chỉ số lượng: admin phải biết đã lên cái gì, và tệp nào hụt.
    // Cắt 600 ký tự phòng người dùng chọn cả trăm tệp một lượt (chi tiết dài quá thì bảng khó đọc).
    const noi = (a: string[]) => { const t = a.join(", "); return t.length > 600 ? t.slice(0, 597) + "…" : t; };
    track("media_upload",
      `${project}${toa.trim() ? " · " + toa.trim() : ""} · ${can.trim()} — ${kind === "photo" ? "ảnh" : "clip"}`
      + ` · xong ${xong.length}/${arr.length}${xong.length ? ": " + noi(xong) : ""}`
      + (hong.length ? ` · HỤT ${hong.length}: ${noi(hong)}` : "")
      + ` · chú thích: ${chuThich.trim().slice(0, 150)}`);
    if (hong.length) alert("Chưa tải lên được " + hong.length + " tệp:\n· " + hong.join("\n· ")
      + "\n\nThường do rớt mạng hoặc màn hình tắt giữa chừng. Mở lại và tải lại đúng mấy tệp này.");
    // Làm mới 1 lần là cả popup lẫn dấu chấm ngoài ma trận đều cập nhật (dùng chung query).
    await qc.invalidateQueries({ queryKey: ["projmedia", projKey] });
  }

  // Nút tải lên: chữ KHÔNG được xuống dòng và nút không được co — thêm ô chú thích vào cùng hàng
  // là chỗ này chật, "＋ Tải ảnh" gãy làm hai dòng trên máy tính.
  async function thaoTacTin(op: "add" | "edit" | "del", msgId?: string, text?: string) {
    if (!cur) return;
    setCapBusy(true); setCapErr(null);
    try {
      await editMediaMsg({ data: { id: cur.id, op, msgId, text, devAs: devAsDlg } });
      track("media_caption",
        `${project}${cur.toa ? " · " + cur.toa : ""} · ${cur.can} — `
        + (op === "add" ? "thêm chú thích: " + (text || "").slice(0, 120)
          : op === "edit" ? "sửa chú thích: " + (text || "").slice(0, 120)
          : "xoá một chú thích"));
      await qc.invalidateQueries({ queryKey: ["projmedia", projKey] });
      if (op === "add") setCap("");
      setCapEditId(null);
    } catch (e) { setCapErr((e as Error).message); }
    setCapBusy(false);
  }

  /** Nạp ĐỦ ảnh/clip của một căn (bấm "Xem thêm"). Chỉ gọi khi người ta thật sự cần xem bản cũ. */
  async function napThem(g: { toa: string; can: string }) {
    const key = `${g.toa}\u0000${g.can}`;
    if (themCan[key] || themBusy) return;
    setThemBusy(key);
    try {
      const r = await listCanMedia({ data: { project, hid, maCT, toa: g.toa, can: g.can } });
      const ds: Item[] = [
        ...r.photos.map((x) => ({ id: x.id, kind: "photo" as const, toa: g.toa, can: g.can, desc: x.desc })),
        ...r.videos.map((x) => ({ id: x.id, kind: "video" as const, date: x.date, toa: g.toa, can: g.can, desc: x.desc })),
      ];
      setThemCan((m) => ({ ...m, [key]: ds }));
    } catch { /* hỏng thì thôi, vẫn còn 2 mục mới nhất */ }
    setThemBusy(null);
  }

  const upBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 8, background: "rgba(255,255,255,.16)", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 };
  const arrow: React.CSSProperties = { position: "absolute", top: "50%", transform: "translateY(-50%)", width: 38, height: 38, borderRadius: "50%", border: "none", background: "rgba(15,23,42,.55)", color: "#fff", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(15,23,42,.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: narrow ? 0 : 16 }}>
      {/* DIEN THOAI: chiem TRON man (khong le, khong bo goc) - clip moi duoc het be ngang may.
          May tinh giu nguyen khung 980px bo goc nhu cu. */}
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: narrow ? "none" : 980, height: narrow ? "100dvh" : "90vh", display: "flex", flexDirection: "column", background: "#0f172a", borderRadius: narrow ? 0 : 16, overflow: "hidden", boxShadow: "0 24px 70px rgba(2,6,23,.5)" }}>
        {/* HEADER — Toà / Phòng sửa tay + nút tải lên */}
        {/* Popup phủ TRỌN màn trên điện thoại (100dvh) nên mép trên đụng đồng hồ / tai thỏ —
            chừa đúng phần lề an toàn của máy, và bóp chiều cao lại cho ảnh được nhiều chỗ hơn. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: narrow ? "6px 12px" : "10px 14px", paddingTop: narrow ? "calc(6px + env(safe-area-inset-top))" : 10, background: "#152a45", color: "#fff", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            {!narrow && (
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", opacity: .75, textTransform: "uppercase" }}>
                📁 {scope === "can" ? "Media phòng" : "Toàn bộ media dự án"} · {project}
              </div>
            )}
            <div style={{ display: narrow && scope === "can" && !upOpen ? "none" : "flex", alignItems: "center", gap: 7, marginTop: 3, flexWrap: "wrap" }}>
              {/* Xem cả dự án = CHỈ XEM: hiện tên phòng/khu của item đang xem, không cho sửa, không cho tải.
                  Muốn thêm ảnh/video thì vào app "Hình ảnh mỗi ngày", bấm đúng ô căn — 1 lối lên duy nhất. */}
              {scope === "project" ? (
                <span style={{ fontSize: 13.5, fontWeight: 800 }}>{curRoom || "—"}</span>
              ) : <>
                <span style={{ fontSize: 12, fontWeight: 700 }}>Toà</span>
                <input value={toa} onChange={(e) => setToa(e.target.value)} placeholder="B1"
                  style={{ height: 28, width: 62, borderRadius: 7, border: "none", padding: "0 8px", fontSize: 13.5, fontWeight: 800, color: C.ink, background: "#fff" }} />
                <span style={{ fontSize: 12, fontWeight: 700 }}>Phòng</span>
                <input value={can} onChange={(e) => setCan(e.target.value)} placeholder="609"
                  style={{ height: 28, width: 110, borderRadius: 7, border: "none", padding: "0 9px", fontSize: 13.5, fontWeight: 800, color: C.ink, background: "#fff" }} />
              </>}
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: 8, minWidth: 0 }}>
            {scope === "can" && narrow && (
              <button type="button" onClick={() => setUpOpen((v) => !v)}
                style={{ ...upBtn, width: 34, padding: 0, justifyContent: "center", fontSize: 18 }}
                title={upOpen ? "Đóng khung tải lên" : "Tải ảnh / video"}>{upOpen ? "−" : "＋"}</button>
            )}
            {scope === "can" && (!narrow || upOpen) && <>
              {/* Chọn tệp xong KHÔNG tải ngay: mở hộp "Báo cáo hiện trạng" — ghi một lần cho cả lô. */}
              <label style={upBtn}>＋ Tải ảnh
                <input type="file" accept="image/*" multiple style={{ display: "none" }}
                  onChange={(e) => { const fs = [...(e.target.files ?? [])].filter((f) => /^image\//.test(f.type)); e.currentTarget.value = ""; if (fs.length) { setChoCap(""); setCho({ kind: "photo", files: fs }); } }} /></label>
              <label style={upBtn}>＋ Tải video
                <input type="file" accept="video/*" multiple style={{ display: "none" }}
                  onChange={(e) => { const fs = [...(e.target.files ?? [])].filter((f) => /^video\//.test(f.type)); e.currentTarget.value = ""; if (fs.length) { setChoCap(""); setCho({ kind: "video", files: fs }); } }} /></label>
            </>}
            <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: "#cbd5e1", fontSize: 24, lineHeight: 1, cursor: "pointer" }}>×</button>
          </div>
        </div>

        {/* HỘP BÁO CÁO HIỆN TRẠNG — chặn giữa "chọn tệp" và "tải lên". Tải ảnh/clip về mà không nói
            hiện trạng thì người xem chỉ thấy hình, không biết đang vướng gì; nên chú thích là BẮT BUỘC,
            ghi MỘT LẦN cho cả lô vừa chọn (không phải gõ lại từng tệp). */}
        {cho && (
          <div style={{ background: "#132842", borderBottom: "1px solid rgba(255,255,255,.1)", padding: narrow ? "10px 12px" : "12px 14px", display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: "#fff" }}>
                Báo cáo hiện trạng · {cho.files.length} {cho.kind === "photo" ? "ảnh" : "clip"}
              </span>
              <span style={{ fontSize: 11.5, color: "rgba(255,255,255,.6)" }}>
                {toa.trim() ? toa.trim() + " · " : ""}{can.trim()} — bắt buộc, ghi một lần cho cả lô
              </span>
            </div>
            <textarea autoFocus value={choCap} onChange={(e) => setChoCap(e.target.value)} rows={narrow ? 3 : 2}
              placeholder="Đang làm tới đâu, vướng gì, cần ai xử lý…"
              style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 8, border: "none", padding: "9px 11px", fontSize: 13, lineHeight: 1.45, color: C.ink, background: "#fff", fontFamily: "inherit" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: choWords > 100 ? "#fca5a5" : "rgba(255,255,255,.55)" }}>
                {choWords}/100 từ{choWords > 100 ? " — sẽ cắt còn 100" : ""}
              </span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,.45)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {cho.files.map((f) => f.name).join(", ")}
              </span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button type="button" onClick={() => { setCho(null); setChoCap(""); }}
                  style={{ height: 34, padding: "0 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,.25)", background: "transparent", color: "#cbd5e1", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Huỷ</button>
                <button type="button" disabled={!choCap.trim() || !!busy}
                  onClick={() => { const b = cho; const t = choCap; setCho(null); setChoCap(""); void onFiles(b.kind, b.files, t); }}
                  style={{ height: 34, padding: "0 16px", borderRadius: 8, border: "none", background: choCap.trim() ? C.tealD : "rgba(255,255,255,.18)", color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: choCap.trim() ? "pointer" : "not-allowed" }}>
                  Tải lên {cho.files.length} tệp
                </button>
              </span>
            </div>
          </div>
        )}

        {busy && <div style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", background: C.tealD, padding: "7px 14px" }}>⏳ {busy}</div>}

        {/* KHUNG XEM LỚN */}
        <div style={{ flex: 1, minHeight: 0, position: "relative", background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {q.isPending ? (
            <div style={{ color: "#94a3b8", fontSize: 13.5 }}>Đang tải ảnh / video…</div>
          ) : scope === "can" && !can.trim() ? (
            <div style={{ color: "#94a3b8", fontSize: 13.5 }}>Nhập Phòng / Khu để xem media.</div>
          ) : items.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 13.5, textAlign: "center", padding: 20 }}>
              {scope === "can" ? "Phòng / khu này chưa có ảnh hoặc video." : "Dự án này chưa có ảnh hoặc video nào."}<br />
              <span style={{ fontSize: 12, opacity: .8 }}>
                {scope === "can" ? "Dùng nút “＋ Tải ảnh” / “＋ Tải video” ở trên để thêm."
                  : "Thêm ảnh / video ở app “Hình ảnh mỗi ngày” — bấm đúng ô căn trên ma trận."}
              </span>
            </div>
          ) : cur?.kind === "video" ? (
            // MAY TINH: giu khung xem cua Google Drive - vua tai vua xem, khong phai cho tai het, va
            // tren man rong khong bi chong nut nhu dien thoai.
            !narrow ? (
              <iframe key={cur.id} title="video" src={`https://drive.google.com/file/d/${cur.id}/preview`} allow="autoplay; fullscreen" allowFullScreen
                style={{ width: "100%", height: "100%", border: "none" }} />
            ) : vidSrc[cur.id] ? (
              // controls = thanh dieu khien MAC DINH cua may (iOS/Android/desktop), khong ve them gi.
              // playsInline: iOS khong tu bat toan man hinh, xem ngay trong popup.
              <video key={cur.id} src={vidSrc[cur.id]} controls playsInline preload="auto"
                onError={() => setVidErr((m) => ({ ...m, [cur.id]: "May khong phat duoc dinh dang clip nay." }))}
                style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }} />
            ) : vidErr[cur.id] ? (
              <div style={{ color: "#fca5a5", fontSize: 13, textAlign: "center", padding: 20 }}>
                Không xem được clip này.<br /><span style={{ fontSize: 11.5, opacity: .85 }}>{vidErr[cur.id]}</span><br />
                {/* Loi thoat: van mo duoc bang Drive de khong ai bi ket. */}
                <a href={`https://drive.google.com/file/d/${cur.id}/view`} target="_blank" rel="noreferrer"
                  style={{ display: "inline-block", marginTop: 10, color: "#7dd3fc", fontWeight: 700, fontSize: 12.5 }}>Mở bằng Google Drive ↗</a>
              </div>
            ) : (
              <div style={{ color: "#94a3b8", fontSize: 13.5, textAlign: "center", padding: 20 }}>
                Dang tai clip…<br /><span style={{ fontSize: 11.5, opacity: .8 }}>clip nang hon anh, doi vai giay</span>
              </div>
            )
          ) : cur && imgSrc[cur.id] ? (
            <img src={imgSrc[cur.id]} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          ) : (
            <div style={{ color: "#94a3b8", fontSize: 13.5 }}>Đang tải ảnh…</div>
          )}
          {/* DIEN THOAI xem VIDEO: bo het lop phu cua app (mui ten + nhan goc trai). Dien thoai da co
              san trinh phat voi thanh tua / am luong / toan man hinh, chong them nut cua minh chi che
              mat va bam nham; doi clip thi bam o dai anh nho phia duoi.
              MAY TINH giu nguyen lop phu nay - man rong, khong vuong gi. */}
          {items.length > 1 && (!narrow || cur?.kind !== "video") && <>
            <button type="button" onClick={() => go(-1)} style={{ ...arrow, left: 10 }}>‹</button>
            <button type="button" onClick={() => go(1)} style={{ ...arrow, right: 10 }}>›</button>
          </>}
          {items.length > 0 && cur && (!narrow || cur.kind !== "video") && (
            <div style={{ position: "absolute", left: 12, top: 10, background: "rgba(15,23,42,.6)", color: "#e2e8f0", borderRadius: 7, padding: "3px 9px", fontSize: 11.5, fontWeight: 600 }}>
              {cur.kind === "video" ? "🎬 Video" : "🖼 Ảnh"} {Math.min(sel, items.length - 1) + 1}/{items.length}
              {curRoom ? ` · ${curRoom}` : ""}{cur.date ? ` · ${cur.date}` : ""}
            </div>
          )}

        </div>

        {/* CHÚ THÍCH — HỘP THOẠI y như ô "Vướng mắc / Giải pháp" bên ePMP: mỗi tin một bong bóng,
            có người viết và ngày viết, ai cũng viết được. Nằm DƯỚI khung xem để đọc song song với
            hình. Sửa / xoá: người viết, admin hoặc PMO. */}
        {cur && (() => {
          const msgs = parseMediaMsgs(cur.desc);
          const suaDuoc = (m: MediaMsg) => canEditCap || (!!meDlg.data?.email && m.author === meDlg.data.email);
          const gio = (iso: string) => {
            if (!iso) return "";
            const d = new Date(iso); if (isNaN(d.getTime())) return "";
            const p2 = (n: number) => String(n).padStart(2, "0");
            return `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
          };
          return (
            <div style={{ background: "#0f1f33", borderTop: "1px solid rgba(255,255,255,.08)", padding: narrow ? "8px 12px 10px" : "10px 14px 12px", display: "grid", gap: 7, maxHeight: narrow ? "34vh" : 240, overflowY: "auto" }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "rgba(255,255,255,.5)" }}>
                Chú thích {msgs.length ? `· ${msgs.length}` : ""}
              </div>
              {msgs.map((m) => capEditId === m.id ? (
                <div key={m.id} style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, borderTopLeftRadius: 2, padding: 8, display: "grid", gap: 6 }}>
                  <textarea value={capDraft} onChange={(e) => setCapDraft(e.target.value)} rows={2}
                    style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 6, border: "1px solid #cbd5e1", padding: "6px 8px", fontSize: 12.5, lineHeight: 1.45, color: C.ink, background: "#fff", fontFamily: "inherit" }} />
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button type="button" onClick={() => setCapEditId(null)}
                      style={{ height: 28, padding: "0 10px", borderRadius: 6, border: "none", background: "transparent", color: "#64748b", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Huỷ</button>
                    <button type="button" disabled={capBusy} onClick={() => { void thaoTacTin("edit", m.id, capDraft); }}
                      style={{ height: 28, padding: "0 12px", borderRadius: 6, border: "none", background: C.tealD, color: "#fff", fontSize: 11.5, fontWeight: 800, cursor: "pointer", opacity: capBusy ? .6 : 1 }}>Lưu</button>
                  </div>
                </div>
              ) : (
                <div key={m.id} style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, borderTopLeftRadius: 2, padding: "6px 9px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2, fontSize: 10.5, color: "#334155" }}>
                    {m.at && <span style={{ background: "#e2e8f0", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>{gio(m.at)}</span>}
                    {m.author !== "(cũ)" && <span style={{ fontWeight: 800 }}>{m.author.split("@")[0]}</span>}
                    {m.author === "(cũ)" && <span style={{ fontStyle: "italic", color: "#64748b" }}>chú thích cũ</span>}
                    {suaDuoc(m) && (
                      <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                        <button type="button" onClick={() => { setCapDraft(m.text); setCapEditId(m.id); }}
                          style={{ border: "none", background: "none", color: "#0f766e", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}>Sửa</button>
                        <button type="button" onClick={() => { if (window.confirm("Xoá chú thích này?")) void thaoTacTin("del", m.id); }}
                          style={{ border: "none", background: "none", color: "#b91c1c", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}>Xoá</button>
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "#0f172a", whiteSpace: "pre-wrap" }}>{m.text}</div>
                </div>
              ))}
              {/* Ô viết tin mới — ai đăng nhập cũng viết được, giống box vướng mắc. */}
              <div style={{ display: "grid", gap: 6 }}>
                <textarea value={cap} onChange={(e) => setCap(e.target.value)} rows={2}
                  placeholder={msgs.length ? "Viết thêm chú thích…" : "Ghi ngắn gọn: đang làm tới đâu, vướng gì, cần ai xử lý…"}
                  style={{ width: "100%", boxSizing: "border-box", resize: "vertical", borderRadius: 8, border: "none", padding: "8px 10px", fontSize: 12.5, lineHeight: 1.45, color: C.ink, background: "#fff", fontFamily: "inherit" }} />
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: capWords > 100 ? "#fca5a5" : "rgba(255,255,255,.5)" }}>
                    {capWords}/100 từ{capWords > 100 ? " — sẽ cắt còn 100" : ""}
                  </span>
                  {capErr && <span style={{ fontSize: 11, color: "#fca5a5" }}>{capErr}</span>}
                  <button type="button" disabled={capBusy || !cap.trim()} onClick={() => { void thaoTacTin("add", undefined, cap); }}
                    style={{ marginLeft: "auto", height: 32, padding: "0 16px", borderRadius: 8, border: "none", background: C.tealD, color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer", opacity: capBusy || !cap.trim() ? .5 : 1 }}>
                    {capBusy ? "Đang gửi…" : "Gửi chú thích"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* DẢI THUMBNAIL CUỘN NGANG — ảnh và video chung một dải, bấm để xem.
            CHỈ CÓ 1 MỤC thì bỏ hẳn dải này: không có gì để chuyển qua, mà nó ăn mất ~200px chiều cao
            đúng chỗ đang cần cho clip. */}
        {items.length > 1 && (
          <div style={{ display: "flex", gap: 14, overflowX: "auto", padding: "9px 12px", background: "#152a45" }}>
            {groups.map((g) => {
              const at = items.findIndex((x) => x.toa === g.toa && x.can === g.can);
              const here = g.toa === toa.trim() && g.can === can.trim();
              return (
                <div key={`${g.toa}/${g.can}`} style={{ flex: "0 0 auto" }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: here ? C.teal : "#94a3b8", marginBottom: 4, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
                    <span>{g.toa ? `${g.toa} · ` : ""}{g.can} <span style={{ opacity: .7 }}>({g.items.length}{g.tong > g.items.length ? `/${g.tong}` : ""})</span></span>
                    {/* Còn bản cũ chưa nạp → cho bấm lấy thêm. Mặc định chỉ 2 bản mới nhất cho nhẹ. */}
                    {g.tong > g.items.length && (
                      <button type="button" onClick={() => void napThem(g)} disabled={!!themBusy}
                        style={{ border: "none", background: "rgba(255,255,255,.14)", color: "#cbd5e1", borderRadius: 6, padding: "1px 7px", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                        {themBusy === `${g.toa} ${g.can}` ? "…" : `+${g.tong - g.items.length} cũ`}
                      </button>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {g.items.map((it, k) => {
                      const i = at + k;
                      const on = i === Math.min(sel, items.length - 1);
                      return (
                        <button key={it.id} type="button" onClick={() => setSel(i)} title={`${g.toa ? g.toa + " · " : ""}${g.can}${it.date ? " · " + it.date : ""}`}
                          style={{ position: "relative", flex: "0 0 auto", width: 86, height: 60, borderRadius: 8, overflow: "hidden", padding: 0, cursor: "pointer",
                            border: on ? `2px solid ${C.teal}` : "2px solid transparent", background: "#334964" }}>
                          {it.kind === "photo" && imgSrc[it.id]
                            ? <img src={imgSrc[it.id]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            : <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: it.kind === "video" ? 17 : 11 }}>
                                {it.kind === "video" ? "▶" : "…"}
                              </span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Tải ảnh Drive → data URI (cache theo id) cho lưới ảnh. */
function useImageUrls(ids: string[]): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({});
  const key = ids.join(",");
  useEffect(() => {
    let off = false;
    (async () => {
      for (const id of ids) {
        if (map[id]) continue;
        try { const r = await readCanMediaB64({ data: { id } }); if (!off) setMap((m) => ({ ...m, [id]: r.dataUri })); }
        catch { /* bỏ ảnh lỗi */ }
      }
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return map;
}
