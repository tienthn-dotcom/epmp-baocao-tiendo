/**
 * MA TRẬN "CHỈNH NHƯ EXCEL" — render 1 vùng sheet (live data) rồi cho admin/PMO tinh chỉnh BỐ CỤC như Excel:
 *  • QUÉT KHỐI ô (click-kéo · shift-click nới · ctrl/⌘-kéo chọn THÊM khối rời) → thao tác HÀNG LOẠT.
 *  • Tô nền / màu chữ / ẩn cột-dòng cả khối; TÔ THÔNG MINH: thang % (đỏ→xanh) hoặc tự chia màu theo mã (bền
 *    khi số liệu đổi — lưu thành LUẬT áp theo giá trị).
 *  • Kéo mép ô đổi cỡ; nếu cột/dòng nằm trong khối đang chọn → đổi cỡ CẢ KHỐI cùng lúc. Có nút đặt px chính xác.
 *  • Phóng to/thu nhỏ cả form (zoom). Lưu 1 FORM / 1 link (KV sheetform:v1); Làm mới → số liệu mới, form giữ.
 *
 * HIỆU NĂNG: KHÔNG nghe mousemove toàn cửa sổ (gây lag) — chỉ gắn khi ĐANG kéo. Quét khối = DOM thuần.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { loadRegion, type LoadedRegion } from "@/lib/region-load";
import { rangeToHtml, SHEET_DUMP_CSS, type FormSpec } from "@/lib/sheet-dump";
import { legendEntries, setStatusColorMap } from "@/lib/summary-render";
import { getHeatmapColors } from "@/lib/heatmap-colors.functions";
import { getSheetForms, saveSheetForm, type SheetForm } from "@/lib/edits.functions";
import { useIsMobile } from "@/lib/use-breakpoint";

function devAs(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("as");
}

type Box = { r1: number; c1: number; r2: number; c2: number };
const EDGE = 6;   // vùng bắt để kéo cỡ ở mép ô (px)
const boxOf = (a: { r: number; c: number }, b: { r: number; c: number }): Box =>
  ({ r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) });
const inAny = (r: number, c: number, bs: Box[]) => bs.some((b) => r >= b.r1 && r <= b.r2 && c >= b.c1 && c <= b.c2);
const overlaps = (a: Box, b: Box) => a.r1 <= b.r2 && a.r2 >= b.r1 && a.c1 <= b.c2 && a.c2 >= b.c1;
const unionCols = (bs: Box[]) => { const s = new Set<number>(); for (const b of bs) for (let c = b.c1; c <= b.c2; c++) s.add(c); return [...s].sort((x, y) => x - y); };
const unionRows = (bs: Box[]) => { const s = new Set<number>(); for (const b of bs) for (let r = b.r1; r <= b.r2; r++) s.add(r); return [...s].sort((x, y) => x - y); };

const MFE_CSS = `
.mfe-host table.sd-tb{user-select:none}
.mfe-host td.mfe-sel{box-shadow:inset 0 0 0 2px #0ea5e9}
.mfe-host.mfe-edit td{cursor:cell}
/* KHUNG CHIẾU (boxResize): chỉ VÙNG BẢNG cuộn → thanh công cụ đứng yên; bỏ trần 88vh của .sd-scroll
   để khung ngoài quyết định chiều cao. Tay kéo nằm sát 3 mép, rộng 8px cho dễ tóm. */
.mfe-box{position:relative;margin:0 auto;display:flex;flex-direction:column;overflow:hidden;border:1px solid #e2e8f0;border-radius:10px;max-width:100%}
.mfe-box .mfe-host{flex:1 1 auto;min-height:0;overflow:auto}
.mfe-box .sd-scroll{max-height:none;overflow:visible}
.mfe-grip{position:absolute;z-index:3}
.mfe-grip:hover{background:rgba(13,148,136,.22)}
.mfe-grip-l,.mfe-grip-r{top:0;bottom:0;width:8px;cursor:ew-resize}
.mfe-grip-l{left:0}.mfe-grip-r{right:0}
.mfe-grip-b{left:0;right:0;bottom:0;height:8px;cursor:ns-resize}
`;

// KIỂU 2 — 7 màu theo LEGEND (ô trống→[0], mã 1→[1] … mã 6→[6]); đọc từ ảnh user gửi (chỉnh lại nếu lệch).
const STEP7 = ["#A6432E", "#FBF2D5", "#77E7F2", "#5B93D6", "#F4A24A", "#98D34F", "#8B3FD5"];

export function MatrixFormEditor({ fid, opts, formKey, canEdit, force, hideChrome, natural, blendText, zoomable, boxResize, onLegend }: {
  fid: string;
  opts: { sheetName?: string; range?: string; tl?: string; br?: string };
  formKey: string;
  canEdit: boolean;
  force?: number;                        // tăng → tải lại bản mới nhất (Làm mới)
  hideChrome?: boolean;                  // ẩn HẲN thanh công cụ (kể cả zoom) — cho ô MTLĐ hiện ma trận sạch
  natural?: boolean;                     // render đúng cỡ THẬT (không h-full/scroll) → để ngoài co fit bề ngang
  blendText?: boolean;                   // ẨN CHỮ heatmap TỰ ĐỘNG: ô có màu → chữ đồng màu nền (chỉ thấy màu)
  zoomable?: boolean;                    // cho zoom CHẠY dù đang `natural` — chỉ dùng khi bên ngoài TỰ lo
                                         // khung cuộn (màn Media), vì ô MTLĐ đã co bằng transform rồi
  onLegend?: (rows: { code: string; text: string; color: string }[]) => void;   // chú giải màu đọc TỪ FILE
                                         // (không đọc DOM: admin hay xoá cột legend khỏi bảng cho gọn)
  boxResize?: boolean;                   // KHUNG CHIẾU kéo được: admin kéo mép TRÁI/PHẢI (nới đều 2 bên,
                                         // bảng luôn cân giữa) và mép DƯỚI. Cỡ lưu vào FORM (spec.boxW/boxH)
                                         // → ai mở cũng thấy đúng khung admin đã lưu
}) {
  const qc = useQueryClient();
  const formsQuery = useQuery({ queryKey: ["sheetforms"], queryFn: () => getSheetForms(), staleTime: 5 * 60 * 1000 });
  const savedSpec = (formsQuery.data?.forms ?? {})[formKey] as SheetForm | undefined;

  const [region, setRegion] = useState<LoadedRegion | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [spec, setSpec] = useState<FormSpec>({});
  const [edit, setEdit] = useState(false);
  const [selBoxes, setSelBoxes] = useState<Box[]>([]);
  const [paint, setPaint] = useState("#ff4d4d");
  // DIEN THOAI mac dinh 50%: co da luu la co chinh cho MAN MAY TINH, bung nguyen len man 375px thi
  // chi thay 3-4 cot, phai vuot mai. 50% cho nhin het mot toa roi zoom vao cho can xem.
  const mobileZoom = useIsMobile();
  const [zoom, setZoom] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(0);

  const viewRef = useRef<HTMLDivElement>(null);
  const selRef = useRef<Box[]>(selBoxes); selRef.current = selBoxes;
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const hidCRef = useRef<Set<number>>(new Set());   // cột ĐÃ XOÁ — để quy đổi cột tuyệt đối ↔ <col> còn lại
  const anchorRef = useRef<{ r: number; c: number } | null>(null);
  const renderedRef = useRef<{ r: number; c: number; val: string }[]>([]);   // ô THẬT (bỏ ô bị gộp phủ)

  useEffect(() => {
    let off = false; setRegion(null); setErr(null);
    (async () => {
      try { const r = await loadRegion(fid, opts, force ? true : undefined); if (!off) setRegion(r); }
      catch (e) { if (!off) setErr((e as Error).message); }
    })();
    return () => { off = true; };
  }, [fid, opts.sheetName, opts.range, opts.tl, opts.br, force]);

  useEffect(() => { if (!dirty) { setSpec(savedSpec ? structuredClone(savedSpec) : {}); setZoom(mobileZoom ? 0.5 : (savedSpec?.zoom ?? 1)); } }, [savedSpec, dirty, mobileZoom]);
  // Đổi zoom: người CÓ QUYỀN → đánh dấu dirty để bật "Lưu form" và lưu kèm zoom (ô MTLĐ + popup ePMP đều
  // hiện đúng cỡ đã lưu). Người xem → chỉ zoom tạm, không lưu.
  const changeZoom = useCallback((z: number) => { setZoom(z); if (canEdit) setDirty(true); }, [canEdit]);

  // BẢNG MÃ MÀU của chủ nhà (thư mục Drive "Mã màu") — nạp 1 lần, cache lâu; áp vào renderer TRƯỚC khi
  // dựng HTML. Chủ nhà quăng file mới lên Drive là đổi màu, không cần sửa code.
  const colorQ = useQuery({ queryKey: ["heatmap-colors"], queryFn: () => getHeatmapColors(), staleTime: 10 * 60 * 1000 });
  const colorsReady = colorQ.data?.colors;
  if (colorsReady) setStatusColorMap(colorsReady);

  const html = useMemo(
    () => (region ? rangeToHtml(region.sh, region.range, region.codeColors, spec, blendText) : ""),
    [region, spec, blendText, colorsReady],
  );

  hidCRef.current = useMemo(() => new Set(spec.hiddenC ?? []), [spec.hiddenC]);

  // PHẢI phụ thuộc `colorsReady`: bảng mã màu tải XONG SAU khi region có → không tính lại thì chú giải
  // vẫn hiện màu cũ trong khi ô ma trận đã đổi màu mới (lệch nhau, nhìn là sai ngay).
  useEffect(() => { if (region && onLegend) onLegend(legendEntries(region.sh)); }, [region, onLegend, colorsReady]);

  const commit = useCallback((fn: (s: FormSpec) => FormSpec) => { setSpec((s) => fn(structuredClone(s))); setDirty(true); }, []);

  // ── VỆT CHỌN + renderedRef — đồng bộ mỗi khi render lại (html) hoặc đổi khối chọn. Bảng bị React thay
  //    node vẫn đúng vì query LẠI mỗi lần. ──
  useEffect(() => {
    const wrap = viewRef.current; if (!wrap) return;
    const table = wrap.querySelector("table.sd-tb"); if (!table) return;
    const cellEls = Array.from(table.querySelectorAll<HTMLTableCellElement>("td[data-c]"));
    renderedRef.current = cellEls.map((td) => ({ r: +(td.dataset.r || 0), c: +(td.dataset.c || 0), val: (td.textContent || "").trim() }));
    for (const td of cellEls) td.classList.toggle("mfe-sel", inAny(+(td.dataset.r || 0), +(td.dataset.c || 0), selBoxes));
  }, [html, selBoxes]);

  // ── TƯƠNG TÁC — gắn vào CONTAINER ỔN ĐỊNH (viewRef), KHÔNG vào <table> (React hay thay node → mất
  //    listener → "không chọn được nữa"). Mỗi sự kiện query LẠI bảng/ô. KÉO mới nghe mouse (không lag). ──
  useEffect(() => {
    const wrap = viewRef.current; if (!wrap || !edit) return;
    const paintHi = (cellEls: HTMLTableCellElement[], bs: Box[]) => { for (const td of cellEls) td.classList.toggle("mfe-sel", inAny(+(td.dataset.r || 0), +(td.dataset.c || 0), bs)); };

    const onDown = (e: MouseEvent) => {
      const table = wrap.querySelector("table.sd-tb") as HTMLTableElement | null; if (!table) return;
      const td = (e.target as HTMLElement)?.closest?.("td") as HTMLTableCellElement | null; if (!td || td.dataset.c == null) return;
      const cellEls = Array.from(table.querySelectorAll<HTMLTableCellElement>("td[data-c]"));
      const cols = Array.from(table.querySelectorAll<HTMLElement>("colgroup > col"));
      const startC = cellEls.length ? +(cellEls[0].dataset.c || 0) : 0;
      const r = +(td.dataset.r || 0), c = +(td.dataset.c || 0), z = zoomRef.current || 1;
      const rc = td.getBoundingClientRect();
      const edge = rc.right - e.clientX <= EDGE ? "right" : (rc.bottom - e.clientY <= EDGE ? "bottom" : null);

      if (edge) {
        const kind: "col" | "row" = edge === "right" ? "col" : "row";
        const idx = kind === "col" ? c + (td.colSpan || 1) - 1 : r + (td.rowSpan || 1) - 1;
        // <col> chỉ còn cho cột CHƯA XOÁ → không tra được bằng (idx - startC), phải ĐẾM số cột còn lại.
        let ci = 0; for (let x = startC; x < idx; x++) if (!hidCRef.current.has(x)) ci++;
        const el = kind === "col" ? cols[ci] : (table.querySelector<HTMLElement>(`tr[data-r="${idx}"]`));
        if (!el) return;
        const size0 = (kind === "col" ? el.getBoundingClientRect().width : el.getBoundingClientRect().height) / z;
        const start = kind === "col" ? e.clientX : e.clientY;
        e.preventDefault();
        const mv = (ev: MouseEvent) => { const d = ((kind === "col" ? ev.clientX : ev.clientY) - start) / z; el.style[kind === "col" ? "width" : "height"] = Math.max(10, size0 + d) + "px"; };
        const up = () => {
          window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up);
          const size = Math.round(parseFloat(el.style[kind === "col" ? "width" : "height"]));
          const idxs = kind === "col" ? unionCols(selRef.current) : unionRows(selRef.current);
          const many = idxs.includes(idx) && idxs.length > 1 ? idxs : [idx];   // trong khối → đổi cỡ CẢ KHỐI
          commit((sp) => { const m = (kind === "col" ? (sp.colW = { ...(sp.colW || {}) }) : (sp.rowH = { ...(sp.rowH || {}) })); for (const i of many) m[i] = size; return sp; });
        };
        window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up); return;
      }

      // QUÉT KHỐI: ctrl/⌘ = chọn THÊM khối rời · shift = nới từ neo · thường = khối mới.
      e.preventDefault();
      const add = e.ctrlKey || e.metaKey;
      const anchor = (e.shiftKey && anchorRef.current) ? anchorRef.current : { r, c };
      anchorRef.current = anchor;
      const base = add ? selRef.current : [];
      let live = [...base, boxOf(anchor, { r, c })]; paintHi(cellEls, live);
      const over = (ev: MouseEvent) => {
        const t = (ev.target as HTMLElement)?.closest?.("td") as HTMLTableCellElement | null; if (!t || t.dataset.c == null) return;
        live = [...base, boxOf(anchor, { r: +(t.dataset.r || 0), c: +(t.dataset.c || 0) })]; paintHi(cellEls, live);
      };
      const up = () => { table.removeEventListener("mouseover", over); window.removeEventListener("mouseup", up); setSelBoxes(live); };
      table.addEventListener("mouseover", over); window.addEventListener("mouseup", up);
    };
    const onDbl = (e: MouseEvent) => {
      const td = (e.target as HTMLElement)?.closest?.("td") as HTMLTableCellElement | null; if (!td || td.dataset.c == null) return;
      const r = +(td.dataset.r || 0), c = +(td.dataset.c || 0);
      td.contentEditable = "true"; td.focus();
      const rg = document.createRange(); rg.selectNodeContents(td);
      const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(rg);
      td.addEventListener("blur", () => { td.contentEditable = "false"; const t = td.textContent || ""; commit((sp) => { sp.cellText = { ...(sp.cellText || {}), [`${r}:${c}`]: t }; return sp; }); }, { once: true });
    };
    wrap.addEventListener("mousedown", onDown);
    wrap.addEventListener("dblclick", onDbl);
    return () => { wrap.removeEventListener("mousedown", onDown); wrap.removeEventListener("dblclick", onDbl); };
  }, [edit, commit]);

  // ── Hành động HÀNG LOẠT trên các KHỐI đang chọn ─────────────────────────────────────────────
  const has = selBoxes.length > 0;
  const selCells = () => renderedRef.current.filter((x) => inAny(x.r, x.c, selBoxes));
  const nSel = selCells().length;
  const paintCells = () => has && commit((s) => { s.cellColor = { ...(s.cellColor || {}) }; for (const x of selCells()) s.cellColor![`${x.r}:${x.c}`] = paint; return s; });
  const paintByCode = () => has && commit((s) => { s.codeColor = { ...(s.codeColor || {}) }; for (const v of new Set(selCells().map((x) => x.val).filter(Boolean))) s.codeColor![v] = paint; return s; });
  const paintFg = () => has && commit((s) => { s.cellFg = { ...(s.cellFg || {}) }; for (const x of selCells()) s.cellFg![`${x.r}:${x.c}`] = paint; return s; });
  const hideText = () => has && commit((s) => { s.cellFg = { ...(s.cellFg || {}) }; for (const x of selCells()) s.cellFg![`${x.r}:${x.c}`] = "transparent"; return s; });   // chữ tàng hình (cùng màu nền)
  const clearFill = () => has && commit((s) => { for (const x of selCells()) { const k = `${x.r}:${x.c}`; if (s.cellColor) delete s.cellColor[k]; if (s.cellFg) delete s.cellFg[k]; if (x.val && s.codeColor) delete s.codeColor[x.val]; } return s; });
  const addRule = (mode: "scale" | "palette") => has && commit((s) => { s.rules = [...(s.rules || []), ...selBoxes.map((b) => ({ ...b, mode }))]; return s; });
  const addSteps = () => has && commit((s) => { s.rules = [...(s.rules || []), ...selBoxes.map((b) => ({ ...b, mode: "steps" as const, colors: STEP7 }))]; return s; });
  const clearRules = () => has && commit((s) => { if (s.rules) s.rules = s.rules.filter((rl) => !selBoxes.some((b) => overlaps(rl, b))); return s; });
  // XOÁ CỘT / XOÁ DÒNG như Excel: rangeToHtml KHÔNG vẽ các cột/dòng này nữa, phần còn lại dồn sát.
  // Chỉ là form hiển thị → "Khôi phục" lấy lại được, file gốc không đụng tới.
  const delCols = () => has && commit((s) => { s.hiddenC = [...new Set([...(s.hiddenC || []), ...unionCols(selBoxes)])]; return s; });
  const delRows = () => has && commit((s) => { s.hiddenR = [...new Set([...(s.hiddenR || []), ...unionRows(selBoxes)])]; return s; });
  const restoreAll = () => commit((s) => { delete s.hiddenC; delete s.hiddenR; return s; });
  const setColWidth = () => { if (!has) return; const cs = unionCols(selBoxes); const v = window.prompt(`Rộng cột (px) cho ${cs.length} cột đang chọn:`, ""); const n = parseInt(v || "", 10); if (!n || n < 10) return; commit((s) => { s.colW = { ...(s.colW || {}) }; for (const c of cs) s.colW![c] = n; return s; }); };
  const setRowHeight = () => { if (!has) return; const rs = unionRows(selBoxes); const v = window.prompt(`Cao dòng (px) cho ${rs.length} dòng đang chọn:`, ""); const n = parseInt(v || "", 10); if (!n || n < 10) return; commit((s) => { s.rowH = { ...(s.rowH || {}) }; for (const r of rs) s.rowH![r] = n; return s; }); };
  /** SỬA CHỮ HÀNG LOẠT: gõ 1 lần, áp cho MỌI ô đang chọn (như Ctrl+Enter của Excel). Chọn 1 ô thì y như cũ. */
  const editText = () => {
    if (!has) return; const b = selBoxes[selBoxes.length - 1];
    const first = renderedRef.current.find((x) => x.r === b.r1 && x.c === b.c1);
    const cells = selCells();
    const t = window.prompt(`Chữ hiển thị cho ${cells.length} ô đang chọn (để trống = xoá chữ):`, first?.val ?? "");
    if (t === null) return;
    commit((s) => { s.cellText = { ...(s.cellText || {}) }; for (const x of cells) s.cellText![`${x.r}:${x.c}`] = t; return s; });
  };
  /** XOÁ NỘI DUNG ô (như phím Delete của Excel): đè chữ rỗng lên mọi ô đang chọn. Số liệu gốc trong file
   *  KHÔNG bị đụng — đây là form hiển thị, muốn lấy lại chữ thì bấm "Bỏ đè chữ". */
  const clearText = () => has && commit((s) => { s.cellText = { ...(s.cellText || {}) }; for (const x of selCells()) s.cellText![`${x.r}:${x.c}`] = ""; return s; });
  /** XOÁ SẠCH ô (Clear All của Excel): ô thành TRẮNG TRƠN — mất chữ, mất màu. Phải ÉP `cellText:""` +
   *  `cellColor:"transparent"`, không được chỉ gỡ form: ô chưa từng tô thì gỡ form KHÔNG đổi gì trên
   *  màn hình (chữ và màu vốn đến từ file/legend) → người dùng tưởng nút hỏng. */
  const clearAll = () => has && commit((s) => {
    s.cellText = { ...(s.cellText || {}) }; s.cellColor = { ...(s.cellColor || {}) };
    for (const x of selCells()) {
      const k = `${x.r}:${x.c}`;
      s.cellText![k] = "";
      s.cellColor![k] = "transparent";
      if (s.cellFg) delete s.cellFg[k];
      if (x.val && s.codeColor) delete s.codeColor[x.val];
    }
    if (s.rules) s.rules = s.rules.filter((rl) => !selBoxes.some((b) => overlaps(rl, b)));
    return s;
  });
  /** BỎ ĐÈ CHỮ: gỡ phần chữ đã gõ đè, ô hiện lại giá trị THẬT của file. */
  const resetText = () => has && commit((s) => { for (const x of selCells()) if (s.cellText) delete s.cellText[`${x.r}:${x.c}`]; return s; });

  // KÉO KHUNG CHIẾU: mép TRÁI/PHẢI nới ĐỀU 2 BÊN (±2·dx) để bảng luôn cân giữa — kéo 1 bên thì khung
  // lệch hẳn sang trái, nhìn xấu. Mép DƯỚI đổi chiều cao. Nhả chuột mới ghi vào form (1 lần undo gọn).
  const boxRef = useRef<HTMLDivElement>(null);
  const dragBox = (edge: "l" | "r" | "b") => (e: React.MouseEvent) => {
    const el = boxRef.current; if (!el) return;
    e.preventDefault(); e.stopPropagation();
    const w0 = el.offsetWidth, h0 = el.offsetHeight, x0 = e.clientX, y0 = e.clientY;
    const maxW = el.parentElement?.clientWidth ?? w0;
    let w = w0, h = h0;
    const mv = (ev: MouseEvent) => {
      if (edge === "b") { h = Math.max(160, h0 + (ev.clientY - y0)); el.style.height = h + "px"; return; }
      const d = (ev.clientX - x0) * (edge === "r" ? 2 : -2);
      w = Math.min(maxW, Math.max(280, w0 + d)); el.style.width = w + "px";
    };
    const up = () => {
      window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up);
      commit((sp) => { if (edge === "b") sp.boxH = Math.round(h); else sp.boxW = Math.round(w); return sp; });
    };
    window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
  };

  // PHÍM TẮT như Excel khi đang chỉnh: Delete/Backspace = xoá nội dung ô đang chọn; Esc = bỏ chọn.
  // Bỏ qua khi con trỏ đang nằm trong ô nhập liệu / ô gõ trực tiếp (dblclick) để không cướp phím.
  useEffect(() => {
    if (!edit) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === "Escape") { setSelBoxes([]); return; }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (!selRef.current.length) return;
      e.preventDefault();
      const cells = renderedRef.current.filter((x) => inAny(x.r, x.c, selRef.current));
      commit((s) => { s.cellText = { ...(s.cellText || {}) }; for (const x of cells) s.cellText![`${x.r}:${x.c}`] = ""; return s; });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [edit, commit]);

  const nHidden = (spec.hiddenC?.length || 0) + (spec.hiddenR?.length || 0);
  const hasSpec = !!(spec.colW || spec.rowH || spec.cellColor || spec.cellFg || spec.codeColor || spec.cellText || spec.hiddenC?.length || spec.hiddenR?.length || spec.rules?.length);

  const doSave = async () => {
    setSaving(true);
    try { await saveSheetForm({ data: { key: formKey, spec: { ...spec, zoom } as SheetForm, devAs: devAs() } }); await qc.invalidateQueries({ queryKey: ["sheetforms"] }); setDirty(false); setSavedTick((n) => n + 1); }
    catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };
  const doClearForm = async () => {
    if (!window.confirm("Xoá FORM đã lưu cho ma trận này? Bảng sẽ về đúng như file gốc.")) return;
    setSaving(true);
    try { await saveSheetForm({ data: { key: formKey, spec: null, devAs: devAs() } }); await qc.invalidateQueries({ queryKey: ["sheetforms"] }); setSpec({}); setDirty(false); setSelBoxes([]); }
    catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };
  const resetLocal = () => { setSpec(savedSpec ? structuredClone(savedSpec) : {}); setDirty(false); setSelBoxes([]); };

  if (err) return <div className="p-10 text-center text-sm text-red-600">Lỗi: {err}</div>;
  if (!region) return <div className="p-10 text-center text-sm text-slate-500">Đang tải ma trận…</div>;

  const btn = "rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40";
  const sep = <span className="mx-0.5 h-4 w-px bg-slate-200" />;
  return (
    <div className={`flex min-h-0 flex-col ${natural ? "" : "h-full"}`}>
      <style dangerouslySetInnerHTML={{ __html: MFE_CSS }} />
      {!hideChrome && (
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-100 px-1 pb-2">
        {/* Zoom — luôn có (cả người xem) */}
        <span className="inline-flex items-center gap-0.5 rounded border border-slate-200 px-1 py-0.5">
          <button className="px-1 text-[13px] font-bold text-slate-600 hover:text-teal-700" title="Thu nhỏ" onClick={() => changeZoom(Math.max(0.4, +(zoom - 0.1).toFixed(2)))}>−</button>
          <button className="w-10 text-center text-[11px] font-semibold text-slate-600 hover:text-teal-700" title="Về 100%" onClick={() => changeZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button className="px-1 text-[13px] font-bold text-slate-600 hover:text-teal-700" title="Phóng to" onClick={() => changeZoom(Math.min(2, +(zoom + 0.1).toFixed(2)))}>+</button>
        </span>
        {/* Lưu NHANH (admin) khi có thay đổi mà chưa vào chế độ chỉnh — vd chỉ đổi zoom. */}
        {canEdit && dirty && !edit && <button onClick={doSave} disabled={saving} className="rounded bg-teal-700 px-3 py-1 text-[11px] font-semibold text-white hover:bg-teal-800 disabled:opacity-40">{saving ? "Đang lưu…" : "💾 Lưu cỡ"}</button>}
        {canEdit && <>
          {sep}
          <button onClick={() => { setEdit((v) => !v); setSelBoxes([]); }}
            className={`rounded px-2.5 py-1 text-[11px] font-semibold ${edit ? "bg-teal-700 text-white" : "border border-teal-600 text-teal-700 hover:bg-teal-50"}`}>
            {edit ? "✓ Đang chỉnh (như Excel)" : "✏️ Chỉnh như Excel"}
          </button>
          {edit && <>
            {sep}
            <span className="text-[11px] text-slate-500">{has ? `Đang chọn ${nSel} ô${selBoxes.length > 1 ? ` · ${selBoxes.length} khối` : ""} · Delete = xoá chữ` : "Click-kéo quét khối · shift nới · ctrl/⌘ chọn thêm · kéo mép ô đổi cỡ · double-click gõ chữ · Delete xoá"}</span>
            {sep}
            <input type="color" value={paint} onChange={(e) => setPaint(e.target.value)} title="Chọn màu" className="h-6 w-7 cursor-pointer rounded border border-slate-300 p-0" />
            <button className={btn} disabled={!has} onClick={paintCells} title="Tô nền cả khối">Tô ô</button>
            <button className={btn} disabled={!has} onClick={paintByCode} title="Tô mọi ô CÙNG MÃ (áp cả số liệu mới)">Tô theo mã</button>
            <button className={btn} disabled={!has} onClick={paintFg} title="Đổi màu chữ cả khối">Màu chữ</button>
            <button className={btn} disabled={!has} onClick={hideText} title="Ẩn chữ: chữ tàng hình (cùng màu nền)">Ẩn chữ</button>
            <button className={btn} disabled={!has} onClick={clearFill} title="Bỏ màu nền/chữ của khối">Bỏ màu</button>
            {sep}
            <button className={btn} disabled={!has} onClick={() => addRule("scale")} title="KIỂU 1 — Thang %: 0%=đỏ → 100%=xanh lá (áp theo giá trị, số liệu đổi vẫn đúng)">Kiểu 1: 0→100%</button>
            <button className={btn} disabled={!has} onClick={addSteps} title="KIỂU 2 — 7 màu theo bậc: ô trống → mã 1..6 (đỏ→kem→cyan→lam→cam→lục→tím)">Kiểu 2: 7 màu</button>
            <button className={btn} disabled={!has} onClick={() => addRule("palette")} title="Tự chia màu: mỗi mã một màu ngẫu nhiên ổn định">Tự chia</button>
            <button className={btn} disabled={!has} onClick={clearRules} title="Bỏ tô thông minh trong khối">Bỏ tô TM</button>
            {sep}
            <button className={btn} disabled={!has} onClick={setColWidth} title="Đặt độ rộng (px) cho mọi cột trong khối">Rộng cột…</button>
            <button className={btn} disabled={!has} onClick={setRowHeight} title="Đặt chiều cao (px) cho mọi dòng trong khối">Cao dòng…</button>
            {sep}
            <button className={btn} disabled={!has} onClick={editText} title="Gõ 1 lần, áp chữ cho MỌI ô đang chọn (double-click vào ô để gõ riêng từng ô)">Sửa chữ</button>
            <button className={btn} disabled={!has} onClick={clearText} title="Xoá nội dung mọi ô đang chọn (phím tắt: Delete)">Xoá chữ</button>
            <button className={btn} disabled={!has} onClick={resetText} title="Bỏ chữ đã gõ đè, hiện lại giá trị thật của file">Bỏ đè chữ</button>
            <button className={btn} disabled={!has} onClick={clearAll} title="Ô thành trắng trơn: mất cả chữ lẫn màu">Xoá sạch ô</button>
            {sep}
            <button className={btn} disabled={!has} onClick={delCols} title="Xoá hẳn các cột trong khối khỏi bảng (các cột còn lại dồn sát, như xoá cột trong Excel)">Xoá cột</button>
            <button className={btn} disabled={!has} onClick={delRows} title="Xoá hẳn các dòng trong khối khỏi bảng (như xoá hàng trong Excel)">Xoá dòng</button>
            <button className={btn} disabled={!nHidden} onClick={restoreAll} title="Lấy lại mọi cột/dòng đã xoá (file gốc không hề bị đụng)">Khôi phục ({nHidden})</button>
            <span className="ml-auto" />
            {boxResize && <button className={btn} disabled={!spec.boxW && !spec.boxH} onClick={() => commit((sp) => { delete sp.boxW; delete sp.boxH; return sp; })} title="Trả khung chiếu về cỡ mặc định (rộng hết chỗ, cao 720px)">Cỡ khung mặc định</button>}
            <button className={btn} disabled={!dirty} onClick={resetLocal} title="Bỏ các chỉnh chưa lưu">Hoàn tác</button>
            <button onClick={doSave} disabled={saving || !dirty} className="rounded bg-teal-700 px-3 py-1 text-[11px] font-semibold text-white hover:bg-teal-800 disabled:opacity-40">{saving ? "Đang lưu…" : "💾 Lưu form"}</button>
            <button className={btn} disabled={saving || !hasSpec} onClick={doClearForm} title="Xoá form đã lưu, về file gốc">Xoá form</button>
          </>}
          {!edit && (savedSpec || hasSpec) && <span className="text-[11px] font-medium text-teal-700">✓ Đang áp form đã lưu</span>}
          {savedTick > 0 && !dirty && <span className="text-[11px] font-medium text-emerald-600">Đã lưu form ✓</span>}
        </>}
      </div>
      )}
      {/* natural (ô MTLĐ) → zoom=1: ô đã tự co bằng transform. Chồng CSS zoom + transform gây LỖI PAINT
          (dải trắng che giữa bảng trên Chrome), nên ở ô chỉ dùng transform. */}
      {boxResize ? (
        <div ref={boxRef} className="mfe-box" style={{ width: spec.boxW ?? "100%", height: spec.boxH ?? 720 }}>
          <div className={`mfe-host min-h-0 ${edit ? "mfe-edit" : ""}`}>
            <style dangerouslySetInnerHTML={{ __html: SHEET_DUMP_CSS }} />
            <div style={{ zoom: natural && !zoomable ? 1 : zoom }}><div ref={viewRef} dangerouslySetInnerHTML={{ __html: html }} /></div>
          </div>
          {canEdit && <>
            <div className="mfe-grip mfe-grip-l" title="Kéo nới/thu ĐỀU hai bên" onMouseDown={dragBox("l")} />
            <div className="mfe-grip mfe-grip-r" title="Kéo nới/thu ĐỀU hai bên" onMouseDown={dragBox("r")} />
            <div className="mfe-grip mfe-grip-b" title="Kéo đổi chiều cao khung" onMouseDown={dragBox("b")} />
          </>}
        </div>
      ) : (
        <div className={`mfe-host min-h-0 ${natural ? "" : "flex-1 overflow-auto"} ${edit ? "mfe-edit" : ""}`}>
          <style dangerouslySetInnerHTML={{ __html: SHEET_DUMP_CSS }} />
          <div style={{ zoom: natural && !zoomable ? 1 : zoom }}><div ref={viewRef} dangerouslySetInnerHTML={{ __html: html }} /></div>
        </div>
      )}
    </div>
  );
}
