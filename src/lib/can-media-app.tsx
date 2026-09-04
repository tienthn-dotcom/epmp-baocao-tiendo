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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getInstallList } from "@/lib/mtld-install.functions";
import { MatrixFormEditor } from "@/lib/matrix-form-editor";
import { loadRegion } from "@/lib/region-load";
import * as XLSXNS from "xlsx";
import type * as XLSX from "xlsx";
import { STD_RAMP } from "@/lib/summary-render";
import { whoami } from "@/lib/activity.functions";
import { fetchUserRoles, getSheetForms, saveSheetForm } from "@/lib/edits.functions";
import { roleOf } from "@/lib/roles";

const MTLD_INSTALL_LS = "mtld:install:v2";   // = app-shell.MTLD_INSTALL_LS (không import để tránh vòng phụ thuộc)
const PAGE_W = 1880;                         // ma trận bàn giao rất rộng (5 Toà × 18-21 căn) → cho trang rộng gần hết màn
import { startCanMediaUpload, listCanMedia, readCanMediaB64, listProjectMedia } from "@/lib/can-media.functions";

const C = { ink: "#0f172a", sub: "#64748b", teal: "#0d9488", tealD: "#0f766e", navy: "#0f2742" };
const mb = (n: number) => (n / 1048576).toFixed(0);

type InstallProj = { fileId: string; gid?: string; name: string; maCT: string; region?: string; groupDA?: string;
  sheet?: string; range?: string; tl?: string; br?: string; formKey?: string; chart?: boolean };
const projId = (p: InstallProj) => p.fileId + (p.gid ? "|" + p.gid : "");
const isMini = (p: InstallProj) => /mini\s*hotel/i.test(p.name || "");

/** `wantProject` = tên dự án mà chỗ khác (nút "Video" trên dashboard ePMP) muốn mở sẵn. Khớp theo TÊN vì
 *  bên gọi chỉ có tên hiển thị; không khớp được thì cứ giữ dự án đầu danh sách. */
export function CanMediaApp({ wantProject }: { wantProject?: string | null } = {}) {
  // NGUỒN dự-án-có-ma-trận: localStorage (dashboard ePMP ghi khi mở, cùng máy) LÀM MỒI, KV là nguồn thật.
  const [lsList, setLsList] = useState<InstallProj[]>([]);
  useEffect(() => { try { const l = JSON.parse(localStorage.getItem(MTLD_INSTALL_LS) || "[]"); if (Array.isArray(l) && l.length) setLsList(l as InstallProj[]); } catch { /* bỏ qua */ } }, []);
  const listQ = useQuery({ queryKey: ["media-install-list"], queryFn: () => getInstallList(), staleTime: 60_000 });
  const list = useMemo(() => {
    const kv = (listQ.data?.list ?? []) as InstallProj[];
    const raw = (kv.length ? kv : lsList);
    // Bỏ trùng theo nội dung popup; Mini Hotel lên đầu (làm trước).
    const seen = new Set<string>(); const out: InstallProj[] = [];
    for (const p of raw) { const sig = `${p.fileId}|${p.gid || ""}|${p.formKey || ""}`; if (seen.has(sig)) continue; seen.add(sig); out.push(p); }
    return out.sort((a, b) => (Number(isMini(b)) - Number(isMini(a))) || a.name.localeCompare(b.name, "vi"));
  }, [listQ.data, lsList]);

  const [selId, setSelId] = useState<string>("");
  const sel = useMemo(() => list.find((p) => projId(p) === selId) || list[0], [list, selId]);
  useEffect(() => { if (!selId && list.length) setSelId(projId(list[0])); }, [list, selId]);
  useEffect(() => {
    if (!wantProject || !list.length) return;
    const norm = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();
    const hit = list.find((p) => norm(p.name) === norm(wantProject))
      || list.find((p) => norm(p.name).includes(norm(wantProject)) || norm(wantProject).includes(norm(p.name)));
    if (hit) setSelId(projId(hit));
  }, [wantProject, list]);

  const [pick, setPick] = useState<{ project?: string; toa?: string; can: string } | null>(null);   // phòng đang mở popup media

  // ADMIN/PMO được "chỉnh như Excel" ma trận của màn này (ẩn dòng/cột thừa, cỡ hàng-cột, sửa chữ, tô màu).
  const devAs = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("as") : null;
  const meQ = useQuery({ queryKey: ["media-whoami", devAs], queryFn: () => whoami({ data: { devAs } }) });
  const rolesQ = useQuery({ queryKey: ["shell-roles"], queryFn: () => fetchUserRoles(), staleTime: 5 * 60 * 1000 });
  const canEdit = !!(meQ.data?.isAdmin || (meQ.data?.email && roleOf(rolesQ.data?.roles ?? {}, meQ.data.email) === "PMO"));

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

  return (
    <div style={{ minHeight: "100vh", background: "#eef2f7", fontFamily: "system-ui,-apple-system,Segoe UI,sans-serif" }}>
      {/* HEADER + bộ lọc dự án */}
      <div style={{ background: `linear-gradient(120deg,${C.navy},#1e3a5f)`, color: "#fff", padding: "16px 16px 18px" }}>
        <div style={{ maxWidth: PAGE_W, margin: "0 auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 19, fontWeight: 800 }}>🏗️ Media công trường</div>
          </div>
          {/* ĐIỆN THOẠI: select phải CO được (minWidth 0 + maxWidth 100%) — không thì tên dự án dài
              đẩy rộng cả trang, sinh cuộn ngang toàn màn. */}
          <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flex: "1 1 220px", minWidth: 0, maxWidth: 460 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, opacity: .85, textTransform: "uppercase", letterSpacing: ".04em", flexShrink: 0 }}>Dự án</span>
            <select value={sel ? projId(sel) : ""} onChange={(e) => setSelId(e.target.value)}
              style={{ height: 40, borderRadius: 10, border: "none", padding: "0 12px", fontSize: 14, fontWeight: 700, color: C.ink, background: "#fff", flex: 1, minWidth: 0, maxWidth: "100%" }}>
              {list.length === 0 && <option value="">(chưa có dự án gắn ma trận)</option>}
              {list.map((p) => <option key={projId(p)} value={projId(p)}>{p.name}{p.maCT ? ` · ${p.maCT}` : ""}</option>)}
            </select>
          </label>
        </div>
      </div>

      {/* MA TRẬN LẮP ĐẶT — bấm ô để mở media của căn */}
      <div style={{ maxWidth: PAGE_W, margin: "0 auto", padding: "16px 16px 40px" }}>
        {listQ.isPending ? (
          <div style={{ padding: 40, textAlign: "center", color: C.sub, fontSize: 13.5 }}>Đang tải danh sách dự án…</div>
        ) : list.length === 0 ? (
          <ManualEntry onOpen={(project, toa, can) => setPick({ project, toa, can })} />
        ) : sel ? (
          regionQ.isPending
            ? <div style={{ padding: 40, textAlign: "center", color: C.sub, fontSize: 13.5 }}>Đang tải bảng của dự án…</div>
            : isZone
              ? <ZoneBoard key={projId(sel) + ":z"} proj={sel} canEdit={canEdit} onPick={(toa, can) => setPick({ toa, can })} />
              : <MatrixBoard key={projId(sel)} proj={sel} canEdit={canEdit} onPick={(toa, can) => setPick({ toa, can })} />
        ) : null}
      </div>

      {pick && <CanMediaDialog project={pick.project ?? sel?.name ?? ""} initialToa={pick.toa ?? ""} initialCan={pick.can} onClose={() => setPick(null)} />}
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
/** Ô tiêu đề đơn vị của lưới: số phòng 2 chữ số ("01".."18") hoặc hành lang ("HL"). */
const isUnitHdr = (t: string) => /^\d{2}$/.test(t) || /^HL$/i.test(t);
/** HÀNG HEADER của 1 block căn: có dãy ≥3 ô 2 chữ số ở CỘT LIỀN NHAU và TĂNG ĐÚNG 1 ("01","02","03"…).
 *  Bảng KHÔNG có hàng nào như vậy = KHÔNG phải heatmap bản đồ căn (vd chart khu public) → dùng bảng khu. */
export function isHeaderRow(cells: HTMLTableCellElement[]): boolean {
  const two = cells.filter((x) => /^\d{2}$/.test(txt(x))).sort((a, b) => (+(a.dataset.c ?? 0)) - (+(b.dataset.c ?? 0)));
  let run = 1;
  for (let i = 1; i < two.length; i++) {
    const adj = +(two[i].dataset.c ?? 0) === +(two[i - 1].dataset.c ?? 0) + 1 && +txt(two[i]) === +txt(two[i - 1]) + 1;
    run = adj ? run + 1 : 1;
    if (run >= 3) return true;
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
  const toa = label(hdr);                                          // "B1"
  const can = /^HL$/i.test(unit) ? `Hanh lang T${+floor}` : `${+floor}${unit}`;
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const [miss, setMiss] = useState(0);   // đếm lần bấm vào ô KHÔNG phải căn → nhắc nhẹ
  const [legend, setLegend] = useState<{ code: string; text: string; color: string }[]>([]);
  const onLegend = useCallback((rows: { code: string; text: string; color: string }[]) => setLegend(rows), []);
  // Cỡ khung chiếu ma trận do người dùng KÉO — nhớ lại lần sau. Đặt sau khi mount để khỏi lệch hydration.

  // CĂN NÀO ĐÃ CÓ MEDIA → chấm dấu lên ô, nhìn ma trận là biết chỗ nào đã có tư liệu, chỗ nào còn trống.
  const mediaQ = useQuery({
    queryKey: ["projmedia", proj.name],
    queryFn: () => listProjectMedia({ data: { project: proj.name } }),
    staleTime: 60_000,
  });
  const marks = useMemo(() => {
    const m = new Map<string, { photos: number; videos: number }>();
    for (const c of mediaQ.data?.cans ?? []) m.set(`${c.toa} ${c.can}`, { photos: c.photos, videos: c.videos });
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
        td.classList.toggle("has-media", !!m);
        if (m) td.title = `${hit!.toa ? hit!.toa + " · " : ""}${hit!.can} — ${m.photos} ảnh · ${m.videos} video`;
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
    <div style={{ background: "#fff", borderRadius: 14, padding: 12, boxShadow: "0 10px 30px rgba(15,23,42,.10)", overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 14px", margin: "2px 4px 10px" }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: miss ? "#b45309" : C.sub }}>
          {miss ? "Ô này không phải căn (dòng tổng / cột %). Bấm vào ô trong lưới phòng." : "Bấm vào ô của căn để xem / tải ảnh · video của căn đó."}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: C.sub }}>
          <span style={{ position: "relative", display: "inline-block", width: 15, height: 15, borderRadius: 3, background: "#64748b" }}>
            <span style={{ position: "absolute", right: 1, bottom: 1, width: 6, height: 6, borderRadius: "50%", background: "#fff", boxShadow: "0 0 0 1.4px rgba(15,23,42,.75)" }} />
          </span>
          {mediaQ.isPending ? "đang dò căn có media…" : `${marks.size} căn đã có ảnh / video`}
        </span>
        {legend.length > 0 && (
          <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginLeft: "auto" }}>
            {legend.map((l) => (
              <span key={l.code + l.text} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "#475569", fontWeight: 600 }}>
                <span style={{ width: 13, height: 13, borderRadius: 3, background: l.color, border: "1px solid rgba(15,23,42,.18)", flexShrink: 0 }} />
                {l.text}
              </span>
            ))}
          </span>
        )}
      </div>
      {/* DẤU CÓ MEDIA: chấm tròn góc dưới-phải ô. Dùng ::after nên không đụng chữ/màu nền của ô,
          và không cần sửa renderer — bảng render lại thì MutationObserver chấm lại. */}
      <style>{`.mtx-mark td.has-media{position:relative}
.mtx-mark td.has-media::after{content:"";position:absolute;right:2px;bottom:2px;width:6px;height:6px;border-radius:50%;background:#fff;box-shadow:0 0 0 1.4px rgba(15,23,42,.75)}`}</style>
      <div ref={wrapRef} onClick={onClick} className="mtx-mark" style={{ cursor: "pointer", minWidth: 0 }}>
        <MatrixFormEditor fid={proj.fileId} opts={{ sheetName: proj.sheet, range: proj.range, tl: proj.tl, br: proj.br }}
          formKey={mediaFormKey(proj)} canEdit={canEdit} natural blendText zoomable boxResize onLegend={onLegend} />
      </div>
    </div>
  );
}


/** KHOÁ lưu tuỳ chỉnh BẢNG KHU của 1 dự án (chỉ còn SỐ CỘT — tên khu đọc thẳng từ sheet). */
const zoneKey = (p: InstallProj) => `media:zones::${p.maCT || p.name}`;

/** ĐỌC DANH SÁCH KHU TỪ SHEET: dự án khu public không phải heatmap mà là BẢNG BÁO CÁO có sẵn cột
 *  "Các khu" (Public Toilet 1,3 · Khối A · Main Lobby · Nhà Hàng Maxine…). Lấy đúng cột đó, bỏ dòng
 *  trống/trùng. Nhờ vậy admin KHÔNG phải gõ lại danh sách khu. Không thấy cột → [] (dùng heatmap). */
const ZONE_HDR = /^(các khu|khu vực|tên khu|khu|hạng mục|các hạng mục)$/i;
export function zonesOfSheet(sh: XLSX.WorkSheet, rangeStr?: string): string[] {
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

  const mediaQ = useQuery({ queryKey: ["projmedia", proj.name], queryFn: () => listProjectMedia({ data: { project: proj.name } }), staleTime: 60_000 });
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
          <span style={{ position: "relative", display: "inline-block", width: 15, height: 15, borderRadius: 3, background: "#64748b" }}>
            <span style={{ position: "absolute", right: 1, bottom: 1, width: 6, height: 6, borderRadius: "50%", background: "#fff", boxShadow: "0 0 0 1.4px rgba(15,23,42,.75)" }} />
          </span>
          {mediaQ.isPending ? "đang dò khu có media…" : `${marks.size} khu đã có ảnh / video`}
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

/** POPUP MEDIA CỦA 1 PHÒNG (Toà + căn) — xem ảnh + video, upload nhiều file 1 lượt. Toà & căn sửa tay. */
function CanMediaDialog({ project, initialToa, initialCan, onClose }: { project: string; initialToa: string; initialCan: string; onClose: () => void }) {
  const [toa, setToa] = useState(initialToa);
  const [can, setCan] = useState(initialCan);
  const [busy, setBusy] = useState<null | string>(null);   // thông báo tiến trình upload
  const q = useQuery({ queryKey: ["canmedia", project, toa, can], queryFn: () => listCanMedia({ data: { project, toa: toa.trim(), can: can.trim() } }), enabled: !!can.trim(), staleTime: 15_000 });
  const photos = q.data?.photos ?? [];
  const videos = q.data?.videos ?? [];
  const [playing, setPlaying] = useState<{ id: string; name: string } | null>(null);
  const [viewImg, setViewImg] = useState<string | null>(null);

  async function onFiles(kind: "photo" | "video", files?: FileList | null) {
    const arr = [...(files ?? [])].filter((f) => (kind === "photo" ? /^image\//.test(f.type) : /^video\//.test(f.type)));
    if (!arr.length || !can.trim()) return;
    let ok = 0;
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      setBusy(`Đang tải ${kind === "photo" ? "ảnh" : "video"} ${i + 1}/${arr.length} (~${mb(f.size)}MB)…`);
      try {
        const ext = (f.name.split(".").pop() || (kind === "photo" ? "jpg" : "mp4"));
        const { uploadUrl } = await startCanMediaUpload({ data: { project, toa: toa.trim(), can: can.trim(), kind, ext, mime: f.type || "" } });
        try {
          const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": f.type || "application/octet-stream" }, body: f });
          if (put.ok) ok++;
        } catch { /* iOS CORS: byte vẫn có thể đã lên — refetch xác minh bên dưới */ ok++; }
      } catch { /* bỏ file lỗi, tiếp tục */ }
    }
    setBusy(null);
    await q.refetch();
    void ok;
  }

  const imgSrc = useImageUrls(photos.map((p) => p.id));

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 760, height: "88vh", display: "flex", flexDirection: "column", background: "#eef2f7", borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 70px rgba(2,6,23,.45)" }}>
        {/* Header + mã căn sửa được */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: `linear-gradient(120deg,${C.navy},#1e3a5f)`, color: "#fff" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", opacity: .8, textTransform: "uppercase" }}>📁 Media · {project}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 3, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>Toà</span>
              <input value={toa} onChange={(e) => setToa(e.target.value)} placeholder="B1"
                style={{ height: 30, width: 60, borderRadius: 8, border: "none", padding: "0 9px", fontSize: 14, fontWeight: 800, color: C.ink, background: "#fff" }} />
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>Phòng</span>
              <input value={can} onChange={(e) => setCan(e.target.value)} placeholder="609"
                style={{ height: 30, width: 96, borderRadius: 8, border: "none", padding: "0 10px", fontSize: 14, fontWeight: 800, color: C.ink, background: "#fff" }} />
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "#cbd5e1", fontSize: 22, lineHeight: 1, cursor: "pointer" }}>×</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 18 }}>
          {busy && <div style={{ fontSize: 13, fontWeight: 600, color: "#475569", background: "#e2e8f0", borderRadius: 10, padding: "9px 12px" }}>⏳ {busy}</div>}

          {/* ẢNH */}
          <MediaSection title="Ảnh" icon="🖼" count={photos.length} accept="image/*"
            onFiles={(fl) => onFiles("photo", fl)}>
            {photos.length === 0 ? <Empty text="Chưa có ảnh cho căn này." />
              : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(110px,1fr))", gap: 8 }}>
                  {photos.map((p) => (
                    <button key={p.id} type="button" onClick={() => imgSrc[p.id] && setViewImg(imgSrc[p.id]!)}
                      style={{ aspectRatio: "1", border: "none", borderRadius: 10, overflow: "hidden", padding: 0, cursor: "pointer", background: "#dbe2ea" }}>
                      {imgSrc[p.id] ? <img src={imgSrc[p.id]!} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <span style={{ fontSize: 11, color: C.sub }}>…</span>}
                    </button>
                  ))}
                </div>}
          </MediaSection>

          {/* VIDEO */}
          <MediaSection title="Video" icon="🎬" count={videos.length} accept="video/*"
            onFiles={(fl) => onFiles("video", fl)}>
            {videos.length === 0 ? <Empty text="Chưa có video cho căn này." />
              : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: 8 }}>
                  {videos.map((v) => (
                    <button key={v.id} type="button" onClick={() => setPlaying(v)}
                      style={{ position: "relative", aspectRatio: "16/10", border: "none", borderRadius: 10, overflow: "hidden", padding: 0, cursor: "pointer",
                        background: "linear-gradient(135deg,#334964,#0f172a)", color: "#fff" }}>
                      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>▶</span>
                      </span>
                      {v.date && <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "6px 8px", background: "linear-gradient(transparent,rgba(0,0,0,.78))", fontSize: 11.5, fontWeight: 700, textAlign: "left" }}>{v.date}</span>}
                    </button>
                  ))}
                </div>}
          </MediaSection>
        </div>
      </div>

      {/* Trình phát video nhúng */}
      {playing && (
        <div onClick={() => setPlaying(null)} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(2,6,23,.86)", display: "flex", alignItems: "center", justifyContent: "center", padding: 14 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 880, background: "#000", borderRadius: 16, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 15px", background: "#0f172a", color: "#fff" }}>
              <span style={{ fontWeight: 800, fontSize: 14 }}>Căn {can}</span>
              <button type="button" onClick={() => setPlaying(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "#cbd5e1", fontSize: 22, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ position: "relative", width: "100%", aspectRatio: "16/9", background: "#000" }}>
              <iframe title="video" src={`https://drive.google.com/file/d/${playing.id}/preview`} allow="autoplay; fullscreen" allowFullScreen
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }} />
            </div>
          </div>
        </div>
      )}
      {/* Xem ảnh lớn */}
      {viewImg && (
        <div onClick={() => setViewImg(null)} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(2,6,23,.86)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <img src={viewImg} alt="" style={{ maxWidth: "96vw", maxHeight: "92vh", borderRadius: 10, objectFit: "contain" }} />
        </div>
      )}
    </div>,
    document.body,
  );
}

/** 1 khu (Ảnh / Video): tiêu đề + nút upload NHIỀU FILE + lưới nội dung. */
function MediaSection({ title, icon, count, accept, onFiles, children }: { title: string; icon: string; count: number; accept: string; onFiles: (fl: FileList | null) => void; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: 14, boxShadow: "0 6px 18px rgba(15,23,42,.06)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 14.5, fontWeight: 800, color: C.ink }}>{icon} {title}</span>
        {count > 0 && <span style={{ fontSize: 12, color: C.sub, fontWeight: 600 }}>· {count}</span>}
        <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px", borderRadius: 10, background: `linear-gradient(120deg,${C.tealD},${C.teal})`, color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
          ＋ Tải {title.toLowerCase()}
          <input type="file" accept={accept} multiple style={{ display: "none" }}
            onChange={(e) => { onFiles(e.target.files); e.currentTarget.value = ""; }} />
        </label>
      </div>
      {children}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div style={{ border: "1px dashed #cbd5e1", borderRadius: 12, padding: "20px 12px", textAlign: "center", color: C.sub, fontSize: 12.5 }}>{text}</div>;
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
