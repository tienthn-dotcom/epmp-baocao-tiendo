/**
 * APP #3 (AppShell rail) — "DST · Theo dõi tiến độ chi tiết": bảng phân cấp ĐA TẦNG (đệ quy).
 *   • Track theo NGÀY. Dòng TỔNG (cha) = TRUNG BÌNH % các dòng con CÓ SỐ LIỆU (iferror — bỏ dòng trống).
 *   • Cột: Hạng mục · ĐVT · Khối lượng hoàn thành · Bắt đầu · Kết thúc · Quá hạn (cột co giãn được).
 *   • Cảnh báo: Thi công kết thúc SỚM HƠN các công đoạn khác; dòng THIẾU thông tin.
 *   • Các dòng SỐ NGUYÊN = các KHU của 1 DỰ ÁN (không phải dự án). Bộ lọc theo DỰ ÁN → hiện đủ khu.
 * Dev-first. Có DỮ LIỆU MẪU khi chưa đọc được file thật.
 */
import { loiNoi } from "@/lib/loi-noi";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, RefreshCw, Upload, X, AlertTriangle, ExternalLink, SlidersHorizontal, Trash2 } from "lucide-react";
import { getSummaryFile, listSheetTabs } from "@/lib/mtld-install.functions";
import { whoami } from "@/lib/activity.functions";
import { fetchUserRoles, listDstSources, addDstSource, deleteDstSource, type DstSourceItem } from "@/lib/edits.functions";
import { roleOf } from "@/lib/roles";
import { parseDetailPlan, type DetailNode, type DetailProject } from "@/lib/detail-plan";
import { track } from "@/lib/track";
import { useIsMobile } from "@/lib/use-breakpoint";
import { useXemNhuUser } from "@/lib/view-as";

const SAMPLE_FILE = "1a0i1n9rjtrNUGHtGmuhj4MDQUnR4dJX9";   // dev: file mẫu (sau cho PMO cấu hình link)
const SAMPLE_GID = "452283237";
const DAY_PX = 22;                                          // bề rộng 1 cột NGÀY (to hơn chút cho biểu đồ dễ nhìn)
const DAY = 86400000;
const FROZEN_EDGE = "6px 0 6px -4px rgba(15,23,42,.20)";         // bóng ranh giới đóng băng (đổ lên phần cuộn)
// 6 cột trái ĐÓNG BĂNG — bỏ "Người phụ trách". Độ rộng MẶC ĐỊNH (co giãn được lúc chạy).
const COL_LABELS = ["Hạng mục · số thứ tự", "Đơn vị tính", "Khối lượng hoàn thành", "Bắt đầu", "Kết thúc", "Quá hạn"];
const COL_W0 = [300, 68, 120, 80, 80, 74];
const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

/** dd/mm/yy(yy) → ms UTC (00:00). Năm 2 số → 20xx. */
function parseVN(s: string): number | null {
  const m = /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(s || ""); if (!m) return null;
  let y = +m[3]; if (y < 100) y += 2000;
  return Date.UTC(y, +m[2] - 1, +m[1]);
}
const pctNum = (s: string) => { const m = /(-?\d+(?:[.,]\d+)?)/.exec(s || ""); return m ? parseFloat(m[1].replace(",", ".")) : null; };
// số thuần từ ô khối lượng ("61.5", "1,234", "25") → number | null
const numOf = (s: string) => { const t = (s || "").replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."); const v = parseFloat(t); return isFinite(v) ? v : null; };
// khối lượng đã làm / tổng → "25/50" (chỉ khi có tổng > 0)
const qtyLabel = (n: DetailNode) => { const tot = numOf(n.qtyTotal); const done = numOf(n.qtyDone); return tot != null && tot > 0 ? `${done ?? 0}/${tot}` : ""; };
// khối lượng: {đã làm, tổng} (chỉ khi có tổng > 0) + định dạng số gọn (bỏ đuôi .0, thêm dấu nghìn)
const qtyParts = (n: DetailNode): { done: number; tot: number } | null => { const tot = numOf(n.qtyTotal); if (tot == null || tot <= 0) return null; return { done: numOf(n.qtyDone) ?? 0, tot }; };
const fmtQty = (v: number) => (Number.isInteger(v) ? v.toLocaleString("vi-VN") : v.toLocaleString("vi-VN", { maximumFractionDigits: 2 }));
// helper cửa sổ tháng cho control "Khoảng: từ→đến" (giá trị input type=month = "YYYY-MM")
const ymOf = (ts: number) => { const d = new Date(ts); return `${d.getUTCFullYear()}-${MONTHS[d.getUTCMonth()]}`; };
const monthStartOf = (s: string) => { const [y, m] = s.split("-").map(Number); return Date.UTC(y, m - 1, 1); };
const monthEndOf = (s: string) => { const [y, m] = s.split("-").map(Number); return Date.UTC(y, m, 0); };
// MÀU Y CHANG "Tổng thể tiến độ":
const NAVY = "#334964";       // Tiến độ (Bắt đầu→Kết thúc)
const DONE = "#5ee9b5";       // % đã hoàn thành (emerald-300)
const TODAY_BAND = "#fca5a5"; // băng ngày hiện hành (đỏ nhạt)
const SX_DONE = "#22c55e";    // ô SX đã xong — xanh lá
const SX_TODO = "#f87171";    // ô SX chưa xong — đỏ coral

// Nhãn công đoạn SẠCH theo mã. Không có mã → dùng tên gốc.
const STAGE_LABEL: Record<string, string> = { VT: "Vật tư", SX: "Sản xuất", TC: "Thi công", TKSX: "Triển khai SX", MA: "Duyệt mẫu", BG: "LOA / Tạm ứng", TK: "Thiết kế", SD: "Shop Drawing", QS: "Khối lượng" };
const cleanName = (n: DetailNode) => (n.ma && STAGE_LABEL[n.ma.toUpperCase()]) || n.name || "—";

/** % của 1 đầu việc LÁ: ưu tiên KHỐI LƯỢNG (đã làm ÷ tổng); không có thì lấy cột "% thực tế". */
function leafPct(n: DetailNode): number | null {
  const tot = numOf(n.qtyTotal), done = numOf(n.qtyDone);
  if (tot != null && tot > 0 && done != null) return Math.max(0, Math.min(100, (done / tot) * 100));
  return pctNum(n.pctActual);
}
function isThiCong(n: DetailNode) { return (n.ma || "").toUpperCase() === "TC" || /thi\s*công/i.test(n.name); }
function isSanXuat(n: DetailNode) { return (n.ma || "").toUpperCase() === "SX" || /sản\s*xuất/i.test(n.name); }
const fmtTs = (ts: number) => { const d = new Date(ts); return `${String(d.getUTCDate()).padStart(2, "0")}/${MONTHS[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`; };
/** % dòng TỔNG = TRUNG BÌNH % các con CÓ SỐ (iferror — bỏ con trống). Cấp 1 (khu) = đúng % nhánh Thi công. */
function computedPct(n: DetailNode): number | null {
  if (!n.children.length) return leafPct(n);
  if (n.level === 1) {
    const tc = n.children.find(isThiCong);
    if (tc) return computedPct(tc);
  }
  const vals = n.children.map(computedPct).filter((v): v is number => v != null);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}
/** Dòng LÁ thiếu THÔNG TIN: không có ngày, không khối lượng, không %. (Dòng cha có con thì KHÔNG tính là trống.) */
function isEmptyLeaf(n: DetailNode): boolean {
  if (n.children.length) return false;
  return parseVN(n.start) == null && parseVN(n.end) == null && numOf(n.qtyTotal) == null && numOf(n.qtyDone) == null && pctNum(n.pctActual) == null;
}

/** Khoảng thời gian để vẽ THANH: ngày riêng của nút; nếu trống thì suy từ các con (min bắt đầu → max kết thúc). */
function spanOf(n: DetailNode): { a: number; b: number } | null {
  const a0 = parseVN(n.start), b0 = parseVN(n.end);
  if (a0 != null && b0 != null) return { a: a0, b: b0 };
  let mn = Infinity, mx = -Infinity;
  const walk = (x: DetailNode) => { const a = parseVN(x.start), b = parseVN(x.end); if (a != null) mn = Math.min(mn, a); if (b != null) mx = Math.max(mx, b); x.children.forEach(walk); };
  walk(n);
  return isFinite(mn) && isFinite(mx) ? { a: mn, b: mx } : null;
}

// ── DỮ LIỆU MẪU ─────────────────────────
const mk = (level: number, name: string, pctActual: string, o: Partial<DetailNode> = {}): DetailNode => ({
  level, stt: o.stt ?? "", ma: o.ma ?? "", name, owner: o.owner ?? "", start: o.start ?? "", end: o.end ?? "",
  unit: o.unit ?? "", qtyTotal: o.qtyTotal ?? "", qtyDone: o.qtyDone ?? "", pctPlan: o.pctPlan ?? "", pctActual, week: [], children: o.children ?? [],
});
const MOCK: DetailProject[] = [
  { ...mk(1, "LOBBY LOUNGE COFFEE", "", { stt: "1", start: "14/08/26", end: "30/08/26", children: [
    mk(2, "Vật tư", "", { stt: "1.1", ma: "VT", start: "14/08/26", end: "18/08/26", children: [
      mk(3, "CT21: Gạch bông", "", { stt: "1.1.1", start: "14/08/26", end: "17/08/26", unit: "m2", qtyTotal: "97", qtyDone: "97" }),
    ] }),
    mk(2, "Sản xuất", "", { stt: "1.2", ma: "SX", start: "14/08/26", end: "30/08/26", children: [
      mk(3, "Vách CNC Inox cao thông tầng", "", { stt: "1.2.1", start: "14/08/26", end: "25/08/26", unit: "m2", qtyTotal: "100", qtyDone: "50" }),
      mk(3, "Quầy Bar (trước sau)", "", { stt: "1.2.2", start: "14/08/26", end: "18/08/26", unit: "set", qtyTotal: "1", qtyDone: "1" }),
      mk(3, "Kệ sách vách cong (thiếu thông tin)", "", { stt: "1.2.3" }),
    ] }),
    mk(2, "Thi công", "", { stt: "1.3", ma: "TC", start: "14/08/26", end: "20/08/26", children: [
      mk(3, "Sàn", "", { stt: "1.3.1", start: "14/08/26", end: "20/08/26", children: [
        mk(4, "Lát 46m2 gạch bông CT21", "14%", { stt: "1.3.1.a", start: "14/08/26", end: "20/08/26" }),
        mk(4, "Đánh sàn đá vị trí cửa xoay", "17%", { stt: "1.3.1.b", start: "14/08/26", end: "19/08/26" }),
      ] }),
      mk(3, "Trần", "", { stt: "1.3.3", start: "14/08/26", end: "20/08/26", children: [
        mk(4, "Defect", "8%", { stt: "1.3.3.a", start: "14/08/26", end: "20/08/26" }),
      ] }),
    ] }),
  ] }), maCT: "CT25-070", groupDA: "Nam Phương Hoàng Hậu: Lobby", location: "PQ" },
];

// Tên dự án mặc định cho pilot (khi file/khu không có cột Nhóm DA + người dùng chưa nhập tên dự án). Các khu
// gộp CHUNG về đây → filter hiện "1 dự án" thay vì đếm mỗi khu thành 1 dự án.
const PILOT_PROJ = "Nam Phương Hoàng Hậu: Lobby";

// Làm phẳng cây theo thứ tự hiển thị (chỉ nhánh đang MỞ) để render từng dòng.
type FlatRow = { node: DetailNode; key: string; hasKids: boolean; open: boolean };
function flatten(projects: DetailProject[], exp: Set<string>): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (n: DetailNode, pi: number, path: string) => {
    const key = `${pi}:${path}`; const hasKids = n.children.length > 0; const open = exp.has(key);
    out.push({ node: n, key, hasKids, open });
    if (open) n.children.forEach((c, ci) => walk(c, pi, `${path}.${ci}`));
  };
  projects.forEach((p, pi) => walk(p, pi, "0"));
  return out;
}
function countAll(n: DetailNode): number { return 1 + n.children.reduce((s, c) => s + countAll(c), 0); }
/** Nút hoặc con-cháu của nó có QUÁ HẠN (để lọc "chỉ quá hạn" mà vẫn giữ cây). */
function anyOverdue(n: DetailNode, todayTs: number): boolean {
  const sp = spanOf(n);
  const own = sp != null && sp.b < todayTs && (computedPct(n) ?? 0) < 100;
  return own || n.children.some((c) => anyOverdue(c, todayTs));
}
/** ĐÃ XONG: lá có khối lượng ĐỦ (vd 97/97) hoặc % = 100; dòng cha xong khi MỌI con đều xong.
 *  Lá RỖNG (chưa nhập gì) KHÔNG tính là xong → không bị ẩn nhầm. */
function isFullyDone(n: DetailNode): boolean {
  if (n.children.length) return n.children.every(isFullyDone);
  const qp = qtyParts(n);
  if (qp) return qp.done >= qp.tot;
  const pc = computedPct(n);
  return pc != null && pc >= 100;
}
/** Lá có VẤN ĐỀ DỮ LIỆU → trả THÔNG ĐIỆP lỗi cụ thể (để tooltip), null nếu sạch.
 *  Bắt: ô rỗng · ngày sai · kết thúc trước bắt đầu · khối lượng/% vô lý · % KHÔNG KHỚP khối lượng. */
function nodeIssueMsg(n: DetailNode): string | null {
  if (n.children.length) return null;
  if (isEmptyLeaf(n)) return "Dòng thiếu thông tin — chưa có ngày / khối lượng / %.";
  const s = (n.start || "").trim(), e = (n.end || "").trim();
  const sp = s ? parseVN(s) : null, ep = e ? parseVN(e) : null;
  if (s && sp == null) return "Ngày bắt đầu nhập sai định dạng.";
  if (e && ep == null) return "Ngày kết thúc nhập sai định dạng.";
  if (sp != null && ep != null && ep < sp) return "Ngày kết thúc TRƯỚC ngày bắt đầu.";
  const qt = numOf(n.qtyTotal), qd = numOf(n.qtyDone);
  if (qt != null && qd != null && qt > 0 && qd > qt) return `Khối lượng đã làm (${qd}) VƯỢT tổng (${qt}).`;
  if (qd != null && qd > 0 && (qt == null || qt <= 0)) return "Có khối lượng đã làm nhưng THIẾU tổng khối lượng.";
  // KHỐI LƯỢNG hoàn thành là GỐC đánh giá. Có cả cột % + cột khối lượng → lệch là lỗi dữ liệu.
  // Cảnh báo khi % hoàn thành (thanh tiến độ HOẶC cột % thực tế) CAO hơn tỉ lệ khối lượng thực làm ≥5đ%
  // (vd khối lượng 0/2 = 0% nhưng để 100%). Ô "đã làm" trống coi như 0.
  if (qt != null && qt > 0) {
    const doneRatio = ((qd ?? 0) / qt) * 100;
    const claimed = Math.max(leafPct(n) ?? 0, pctNum(n.pctActual) ?? 0);
    if (claimed - doneRatio >= 5) return `Khối lượng thực làm ${qd ?? 0}/${qt} (${Math.round(doneRatio)}%) nhưng % hoàn thành đang để ${Math.round(claimed)}% — lệch, kiểm tra lại.`;
  }
  return null;
}
function nodeDataIssue(n: DetailNode): boolean { return nodeIssueMsg(n) != null; }
function anyDataIssue(n: DetailNode): boolean {
  return nodeDataIssue(n) || n.children.some(anyDataIssue);
}
/** Danh sách tháng "YYYY-MM" → nhãn gọn "M/YYYY", trải từ đầu năm của `a` đến cuối năm của `b`. */
function monthOpts(a: string, b: string): { v: string; label: string }[] {
  const ya = +(a || "").slice(0, 4) || new Date().getUTCFullYear();
  const yb = +(b || "").slice(0, 4) || ya;
  // Mở rộng thêm 1 năm mỗi phía để luôn chọn được năm trước/năm sau, không kẹt trong khoảng dữ liệu.
  const y1 = Math.min(ya, yb) - 1, y2 = Math.max(ya, yb) + 1;
  const out: { v: string; label: string }[] = [];
  for (let y = y1; y <= y2; y++) for (let m = 1; m <= 12; m++) out.push({ v: `${y}-${String(m).padStart(2, "0")}`, label: `${m}/${y}` });
  return out;
}

/** Parse ArrayBuffer .xlsx → danh sách khu + tên sheet đã lấy. Có `prefer` → parse ĐÚNG sheet đó; không thì
 *  thử MỌI sheet, lấy sheet ra được NHIỀU dòng nhất (tự hiểu). */
async function xlsxToProjects(buf: ArrayBuffer, prefer?: string): Promise<{ projects: DetailProject[]; sheetName: string }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });
  const names = prefer && wb.SheetNames.includes(prefer) ? [prefer] : wb.SheetNames;
  let best: DetailProject[] = [], bestName = "";
  for (const name of names) {
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets[name], { header: 1, raw: false, defval: "" });
    const p = parseDetailPlan(rows).projects;
    if (p.length > best.length) { best = p; bestName = name; }
  }
  return { projects: best, sheetName: bestName };
}
const b64ToBuf = (b64: string) => { const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return bytes.buffer; };
/** Mốc "dữ liệu tính đến": giờ tuyệt đối + khoảng cách tương đối (vừa xong / x phút trước…). */
function stampInfo(ts: number): { abs: string; rel: string } {
  const d = new Date(ts), p2 = (n: number) => String(n).padStart(2, "0");
  const abs = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  const diff = Date.now() - ts;
  const rel = diff < 60000 ? "vừa xong" : diff < 3600000 ? `${Math.floor(diff / 60000)} phút trước`
    : diff < 86400000 ? `${Math.floor(diff / 3600000)} giờ trước` : `${Math.floor(diff / 86400000)} ngày trước`;
  return { abs, rel };
}

export function DetailPlanApp() {
  const qc = useQueryClient();
  const [refreshN, setRefreshN] = useState(0);
  /* NGUỒN (KV `dst:sources:v1`) — DANH SÁCH, mỗi lần nhập link là thêm một nguồn và dữ liệu các nguồn
     CỘNG DỒN vào cùng bảng. Trước đây chỉ ghim một nguồn nên ai nhập sau đè lên người nhập trước, file
     test lỡ ghim là không có đường gỡ. Chưa có nguồn nào → về file mẫu. */
  const srcQuery = useQuery({ queryKey: ["dst-sources"], queryFn: () => listDstSources(), staleTime: 5 * 60 * 1000 });
  const sources: DstSourceItem[] = useMemo(() => srcQuery.data?.sources ?? [], [srcQuery.data]);
  /* Chưa ghim nguồn nào: bản DEV lùi về file mẫu cho dễ thử; bản THẬT thì để TRỐNG.
     Trước đây bản thật cũng lùi về file mẫu, nên xoá sạch nguồn xong vẫn thấy đầy số của file
     mẫu — nhìn y như dữ liệu demo không chịu biến mất, không ai biết đường nào mà lần. */
  // Bản DEV thêm ?nguon=trong để dựng đúng cảnh "chưa ghim nguồn nào" mà thử màn hình trống,
  // vì bình thường dev luôn lùi về file mẫu nên không bao giờ thấy được cảnh đó.
  const thuTrong = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("nguon") === "trong";
  const activeList: DstSourceItem[] = useMemo(
    () => (sources.length && !thuTrong
      ? sources
      : (import.meta.env.DEV && !thuTrong ? [{ id: "mau", fileId: SAMPLE_FILE, gid: SAMPLE_GID, addedAt: "" }] : [])),
    [sources, thuTrong],
  );
  const chuaCoNguon = !activeList.length;
  const srcKey = activeList.map((x) => `${x.fileId}|${x.gid ?? ""}|${x.sheet ?? ""}|${x.full ? 1 : 0}`).join(";");
  const q = useQuery({
    queryKey: ["detail-plan", srcKey, refreshN],
    // Tải LẦN LƯỢT (không song song): mỗi nguồn là một file .xlsx vài MB, bắn cùng lúc là nghẽn.
    queryFn: async () => {
      const out: { src: DstSourceItem; b64: string; ts: number }[] = [];
      for (const x of activeList) {
        try {
          const r = await getSummaryFile({ data: { fileId: x.fileId, gid: x.gid, sheet: x.sheet, full: x.full || undefined, force: refreshN > 0 || undefined } });
          if (r?.b64) out.push({ src: x, b64: r.b64, ts: r.ts ?? Date.now() });
        } catch { /* một nguồn hỏng KHÔNG được làm mất các nguồn còn lại */ }
      }
      return out;
    },
    enabled: !srcQuery.isPending,
    staleTime: 5 * 60 * 1000, retry: 1,
  });
  const [real, setReal] = useState<DetailProject[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [winFrom, setWinFrom] = useState<string>("");
  const [winTo, setWinTo] = useState<string>("");
  const [showAll, setShowAll] = useState(false);
  const [showOverdue, setShowOverdue] = useState(false);   // lọc CHỈ hạng mục quá hạn
  const [showIssues, setShowIssues] = useState(false);     // lọc CHỈ đầu việc lỗi dữ liệu
  const [hideDone, setHideDone] = useState(false);         // tick → ẨN việc đã xong (khối lượng đủ / 100%)
  // Quyền: chỉ ADMIN/PMO thấy nút "Nhập dữ liệu" + link file gốc. devAs = giả lập ?as= khi dev.
  const devAs = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("as") : null;
  const meQ = useQuery({ queryKey: ["dst-whoami", devAs], queryFn: () => whoami({ data: { devAs } }) });
  const rolesQ = useQuery({ queryKey: ["dst-roles"], queryFn: () => fetchUserRoles(), staleTime: 5 * 60 * 1000 });
  const xemNhuUser = useXemNhuUser();   // admin/PMO đang soi bằng con mắt người thường
  const canManage = !xemNhuUser && !!(meQ.data?.isAdmin || (meQ.data?.email && roleOf(rolesQ.data?.roles ?? {}, meQ.data.email) === "PMO"));
  /** Link tới ĐÚNG file của MỘT nguồn. Không còn một link dùng chung cho cả bảng — bảng gộp nhiều
   *  nguồn thì một link chung chắc chắn lệch với phần lớn số đang hiện. */
  const linkOf = (x: { fileId: string; gid?: string }) => `https://docs.google.com/spreadsheets/d/${x.fileId}/edit${x.gid ? `#gid=${x.gid}` : ""}`;
  const [xoaBusy, setXoaBusy] = useState<string | null>(null);
  // Nguồn để "Tự động" thì app tự dò sheet nhiều dữ liệu nhất — nhớ lại tên tab đó để bảng nguồn
  // nói rõ số đang lấy từ tab nào (link Google chỉ mở được tab mặc định của file).
  const [tabDo, setTabDo] = useState<Record<string, string>>({});
  const xoaNguon = async (x: DstSourceItem) => {
    const nhan = x.tag || x.sheet || x.fileId.slice(0, 12) + "…";
    if (!window.confirm(`Xoá nguồn "${nhan}" khỏi DST?

Dữ liệu của nguồn này sẽ biến khỏi bảng của MỌI người. File gốc trên Google Drive không bị đụng tới.`)) return;
    setXoaBusy(x.id);
    try {
      await deleteDstSource({ data: { id: x.id, devAs } });
      await qc.invalidateQueries({ queryKey: ["dst-sources"] });
      setImportName(null); setReal(null);   // buộc dựng lại bảng từ danh sách nguồn mới
      track("dst_source_xoa", `${nhan} · ${x.fileId}${x.sheet ? " · tab " + x.sheet : ""}`);
    } catch (e) { setImportErr("Không xoá được nguồn: " + loiNoi(e)); }
    finally { setXoaBusy(null); }
  };
  const [colW, setColW] = useState<number[]>(COL_W0);      // độ rộng cột (co giãn được)
  const [importName, setImportName] = useState<string | null>(null);
  const [importProj, setImportProj] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [linkVal, setLinkVal] = useState("");
  const [linkTabs, setLinkTabs] = useState<string[]>([]);   // danh sách sheet của link đang dán
  const [linkSheet, setLinkSheet] = useState("");           // sheet đã chọn ("" = tự động: sheet nhiều dữ liệu nhất)
  const [tabsBusy, setTabsBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  // offset trái luỹ tiến của các cột đóng băng (từ colW).
  const colL = useMemo(() => { const l: number[] = [0]; for (let i = 0; i < colW.length - 1; i++) l.push(l[i] + colW[i]); return l; }, [colW]);
  const startResize = (i: number, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startW = colW[i];
    const move = (ev: MouseEvent) => setColW((w) => { const nw = [...w]; nw[i] = Math.max(46, startW + (ev.clientX - startX)); return nw; });
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); document.body.style.cursor = ""; };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };

  useEffect(() => {
    if (importName) return;
    const files = q.data; if (!files?.length) return; let off = false;
    (async () => {
      const gom: DetailProject[] = [];
      const loi: string[] = [];
      const tabs: Record<string, string> = {};
      for (const f of files) {
        try {
          const { projects: p, sheetName } = await xlsxToProjects(b64ToBuf(f.b64), f.src.sheet);
          if (sheetName) tabs[f.src.id] = sheetName;
          // Nhãn nguồn đi theo từng dự án → bảng "Nguồn dữ liệu" xoá đúng phần của nguồn đó, và
          // người xem biết dòng này đến từ file nào (trước đây mọi dòng chung một link, nhìn là lệch).
          for (const x of p) gom.push({ ...x, srcId: f.src.id, groupDA: f.src.tag || x.groupDA });
        } catch (e) { loi.push(loiNoi(e)); }
      }
      if (off) return;
      setTabDo(tabs);
      setReal(gom);
      setErr(gom.length ? null : (loi[0] ?? null));
    })();
    return () => { off = true; };
  }, [q.data, importName]);

  const importBuf = async (buf: ArrayBuffer, label: string, prefer?: string) => {
    setBusy(true); setImportErr(null);
    try {
      const { projects: p, sheetName } = await xlsxToProjects(buf, prefer);
      if (!p.length) { setImportErr("Không thấy dòng dữ liệu — file cần có cột Stt + Mô tả."); return; }
      const tag = importProj.trim();
      setReal(tag ? p.map((x) => ({ ...x, groupDA: tag })) : p);
      setImportName(label || sheetName || "Đã nhập"); setExpanded(null); setProjFilter(""); setImportOpen(false); setErr(null);
      // Nạp bảng mới = số của MỌI NGƯỜI xem DST đổi theo → nhật ký phải ghi rõ nạp cái gì, bao nhiêu.
      const nHang = p.reduce((n, x) => n + countAll(x), 0);
      track("dst_import", `${label || sheetName || "không tên"}${sheetName && label ? " · tab " + sheetName : ""}`
        + ` · ${p.length} dự án · ${nHang} dòng${tag ? " · gộp về “" + tag + "”" : ""}`);
    } catch (e) { setImportErr(loiNoi(e)); } finally { setBusy(false); }
  };
  const onFile = (f?: File) => { if (f) f.arrayBuffer().then((b) => importBuf(b, f.name.replace(/\.(xlsx|xls)$/i, ""))); };
  // Dán link hợp lệ → tải DANH SÁCH SHEET cho dropdown (để chọn đúng sheet, không đoán).
  useEffect(() => {
    const m = /\/d\/([A-Za-z0-9_-]+)/.exec(linkVal); if (!m) { setLinkTabs([]); setTabsBusy(false); return; }
    let off = false; setTabsBusy(true);
    listSheetTabs({ data: { fileId: m[1] } })
      .then((r) => { if (!off) setLinkTabs(r?.tabs ?? []); })
      .catch(() => { if (!off) setLinkTabs([]); })
      .finally(() => { if (!off) setTabsBusy(false); });
    return () => { off = true; };
  }, [linkVal]);
  const onLink = async () => {
    const m = /\/d\/([A-Za-z0-9_-]+)/.exec(linkVal); const gm = /[?#&]gid=(\d+)/.exec(linkVal);
    if (!m) { setImportErr("Link không hợp lệ — cần dạng …/d/<id>."); return; }
    setBusy(true); setImportErr(null);
    try {
      // Ưu tiên SHEET đã chọn (dropdown) → tách đúng sheet đó; else theo gid trong URL; else TỰ ĐỘNG =
      // tải NGUYÊN file (full) để quét MỌI sheet, lấy sheet nhiều dữ liệu nhất (không kẹt ở "Summary").
      const auto = !linkSheet && !gm;
      const gid = (!linkSheet && gm) ? gm[1] : undefined;
      const res = await getSummaryFile({ data: { fileId: m[1], sheet: linkSheet || undefined, gid, full: auto || undefined, force: true } });
      if (!res?.b64) { setImportErr("Không tải được file — kiểm tra chia sẻ 'Anyone with the link'."); setBusy(false); return; }
      await importBuf(b64ToBuf(res.b64), linkSheet, linkSheet || undefined);
      // THÊM vào danh sách nguồn (KV) → mọi người mở DST đều thấy, reload không về file mẫu.
      try { await addDstSource({ data: { fileId: m[1], gid, sheet: linkSheet || undefined, full: auto || undefined, tag: importProj.trim() || undefined, devAs } }); await qc.invalidateQueries({ queryKey: ["dst-sources"] });
        // Ghim nguồn = MỌI NGƯỜI mở DST sẽ thấy số của file này → phải có vết.
        track("dst_source", `${m[1]}${gid ? " · gid " + gid : ""}${linkSheet ? " · tab " + linkSheet : ""}`);
        // Ghim xong thì BỎ bản xem tạm, để bảng dựng lại từ DANH SÁCH NGUỒN. Nhờ vậy cái đang hiện và
        // các link "Mở file gốc" luôn là một — trước đây bảng hiện file vừa dán mà link trỏ nguồn cũ.
        setImportName(null); setReal(null); setLinkVal(""); setLinkSheet(""); }
      catch (e) { setImportErr("Đã nạp nhưng CHƯA ghim được nguồn (cần quyền admin/OCC): " + loiNoi(e)); }
    } catch (e) { setImportErr(loiNoi(e)); setBusy(false); }
  };
  // LÀM MỚI = tải lại DỮ LIỆU MỚI từ NGUỒN ĐANG XEM với force (nguồn = link đã ghim ở KV, hoặc file mẫu).
  //  Xoá importName + real để parse effect chạy lại trên bản mới của danh sách nguồn.
  const doRefresh = () => { setImportErr(null); setImportName(null); setReal(null); setRefreshN((n) => n + 1); };

  // Mốc "dữ liệu tính đến" của bảng gộp = nguồn CŨ NHẤT: bảng chỉ tươi bằng nguồn ì nhất.
  const dataTs = useMemo(() => (q.data?.length ? Math.min(...q.data.map((f) => f.ts)) : 0), [q.data]);
  const usingMock = !real || real.length === 0;
  const projects = usingMock ? MOCK : real!;

  // Lọc theo DỰ ÁN: các dòng SỐ NGUYÊN là KHU của 1 dự án. Khoá dự án = Group DA (tên dự án) → Mã CT → tên.
  // Chọn 1 dự án → hiện ĐỦ các khu của nó. (Sau nối ePMP để lấy tên+mã dự án chuẩn.)
  const [projFilter, setProjFilter] = useState("");
  // ĐIỆN THOẠI: 8 nút điều khiển xếp hết ra thanh trên chiếm gần nửa màn (đo trên iPhone: 4 hàng,
  // ~330px) — bảng còn lại có mấy dòng. Gom vào một nút "Lọc", mặc định đóng, mở ra mới hiện.
  const narrow = useIsMobile();
  const [barOpen, setBarOpen] = useState(false);
  // MỘT FILE = MỘT DỰ ÁN: các dòng số nguyên là KHU (không phải dự án riêng). Khu thường KHÔNG có cột Nhóm
  // DA / Mã CT riêng → GỘP CHUNG về 1 dự án: tên nhập tay (importProj) → tên file → mặc định pilot. Nhờ vậy
  // 6 khu "Nam Phương Hoàng Hậu: Lobby" không bị đếm nhầm thành "6 dự án". (KHÔNG fallback theo tên khu nữa.)
  const fileProj = (importProj.trim() || (importName ? importName.replace(/\.(xlsx|xls)$/i, "").trim() : "") || PILOT_PROJ);
  const projKeyOf = (p: DetailProject) => (p.groupDA || p.maCT || fileProj).trim();
  const projGroups = useMemo(() => {
    const m = new Map<string, string>();   // key dự án → Mã CT (đầu tiên thấy)
    projects.forEach((p) => { const k = projKeyOf(p); if (!m.has(k)) m.set(k, (p.maCT || "").trim()); });
    return [...m.entries()].map(([key, maCT]) => ({ key, label: maCT ? `${key} · ${maCT}` : key }));
  }, [projects, fileProj]);
  const vis = useMemo(() => (projFilter && projGroups.some((g) => g.key === projFilter) ? projects.filter((p) => projKeyOf(p) === projFilter) : projects), [projects, projFilter, projGroups, fileProj]);

  // CẢNH BÁO: Thi công kết thúc SỚM HƠN công đoạn khác trong cùng khu (Thi công chỉ xong khi các mục kia xong).
  const tcWarn = useMemo(() => {
    const m = new Map<DetailNode, string>();
    for (const khu of vis) {
      const tc = khu.children.find(isThiCong); if (!tc) continue;
      const tcEnd = spanOf(tc)?.b; if (tcEnd == null) continue;
      let maxOther = -Infinity, who = "";
      for (const s of khu.children) { if (s === tc) continue; const b = spanOf(s)?.b; if (b != null && b > maxOther) { maxOther = b; who = cleanName(s); } }
      if (isFinite(maxOther) && tcEnd < maxOther) m.set(tc, `Kết thúc Thi công (${fmtTs(tcEnd)}) SỚM HƠN “${who}” (${fmtTs(maxOther)}). Thi công chỉ xong sau khi các công đoạn kia xong — kiểm tra lại ngày.`);
    }
    return m;
  }, [vis]);

  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const defaultExp = useMemo(() => {
    const s = new Set<string>();
    const add = (n: DetailNode, pi: number, path: string) => { if (n.level <= 3) { s.add(`${pi}:${path}`); n.children.forEach((c, ci) => add(c, pi, `${path}.${ci}`)); } };
    vis.forEach((p, pi) => add(p, pi, "0")); return s;
  }, [vis]);
  const exp = expanded ?? defaultExp;
  const toggle = (k: string) => { const s = new Set(exp); s.has(k) ? s.delete(k) : s.add(k); setExpanded(s); };
  const allKeys = useMemo(() => { const s = new Set<string>(); const add = (n: DetailNode, pi: number, path: string) => { s.add(`${pi}:${path}`); n.children.forEach((c, ci) => add(c, pi, `${path}.${ci}`)); }; vis.forEach((p, pi) => add(p, pi, "0")); return s; }, [vis]);

  const grid = useMemo(() => {
    let mn = Infinity, mx = -Infinity;
    const scan = (n: DetailNode) => { const a = parseVN(n.start), b = parseVN(n.end); if (a != null) mn = Math.min(mn, a); if (b != null) mx = Math.max(mx, b); n.children.forEach(scan); };
    vis.forEach(scan);
    const now = new Date();
    const nowM0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    if (!isFinite(mn)) { mn = nowM0; mx = nowM0; }
    const lod = new Date(Math.min(mn, nowM0));
    const autoStart = Date.UTC(lod.getUTCFullYear(), lod.getUTCMonth(), 1);
    const hid = new Date(Math.max(mx, nowM0));
    let autoHi = Date.UTC(hid.getUTCFullYear(), hid.getUTCMonth() + 1, 0);
    const min3 = Date.UTC(lod.getUTCFullYear(), lod.getUTCMonth() + 3, 0);
    if (autoHi < min3) autoHi = min3;
    const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const defStart = todayUTC - 7 * DAY;
    const defHi = todayUTC + 83 * DAY;
    let start: number, hi: number;
    if (showAll) { start = autoStart; hi = autoHi; }
    else if (winFrom || winTo) { start = winFrom ? monthStartOf(winFrom) : autoStart; hi = winTo ? monthEndOf(winTo) : autoHi; }
    else { start = defStart; hi = defHi; }
    if (hi < start) { const d = new Date(start); hi = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0); }
    const nDays = Math.round((hi - start) / DAY) + 1;
    const months: { name: string; days: number; isCur: boolean; left: number }[] = [];
    const days: number[] = [];
    for (let i = 0; i < nDays; i++) {
      const dd = new Date(start + i * DAY); days.push(dd.getUTCDate());
      const nm = `Tháng ${dd.getUTCMonth() + 1} Năm ${dd.getUTCFullYear()}`;
      const last = months[months.length - 1];
      if (last && last.name === nm) last.days++;
      else months.push({ name: nm, days: 1, left: i * DAY_PX, isCur: dd.getUTCFullYear() === now.getUTCFullYear() && dd.getUTCMonth() === now.getUTCMonth() });
    }
    const cur = months.find((m) => m.isCur);
    const curMonth = cur ? { left: cur.left, width: cur.days * DAY_PX } : null;
    return { lo: start, hi, nDays, months, days, curMonth, gridW: nDays * DAY_PX, autoFrom: ymOf(start), autoTo: ymOf(hi) };
  }, [vis, winFrom, winTo, showAll]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sc = scrollRef.current; if (!sc) return;
    if (winFrom || winTo) return;
    if (showAll) { if (grid?.curMonth) sc.scrollLeft = Math.max(0, grid.curMonth.left - 220); }
    else sc.scrollLeft = 0;
  }, [grid, winFrom, winTo, showAll]);

  const todayISO = new Date().toISOString().slice(0, 10);
  const todayTs = Date.UTC(+todayISO.slice(0, 4), +todayISO.slice(5, 7) - 1, +todayISO.slice(8, 10));
  // Lọc "chỉ quá hạn": mở hết tầng rồi chỉ giữ dòng có (con-cháu) quá hạn.
  const rows = useMemo(() => {
    const filtering = showOverdue || showIssues;
    const base = flatten(vis, filtering ? allKeys : exp);
    // Lỗi dữ liệu = lá lỗi/rỗng (anyDataIssue) HOẶC có cảnh báo Thi công lệch ngày (tcWarn — dấu ⚠ vàng).
    const hasTc = (x: DetailNode): boolean => tcWarn.has(x) || x.children.some(hasTc);
    let res = filtering
      ? base.filter((r) => (showOverdue && anyOverdue(r.node, todayTs)) || (showIssues && (anyDataIssue(r.node) || hasTc(r.node))))
      : base;
    if (hideDone) res = res.filter((r) => !isFullyDone(r.node));   // ẩn cả nhánh đã xong (lá + cha toàn con xong)
    return res;
  }, [vis, exp, allKeys, showOverdue, showIssues, hideDone, todayTs, tcWarn]);
  const total = vis.reduce((s, p) => s + countAll(p), 0);
  const nCols = COL_LABELS.length;
  const gridTemplate = `${colW.map((w) => w + "px").join(" ")} ${grid ? grid.gridW + "px" : "0px"}`;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#eef1f4" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-4 py-2" style={{ flexShrink: 0 }}>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-md border-2 border-teal-700 px-1.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-teal-700" title="Detail Schedule Tracking">DST</span>
          <span className="text-[13px] font-semibold text-slate-800">Theo dõi tiến độ chi tiết</span>
          {importName
            ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800" title="Đang xem dữ liệu nhập tay">Đã nhập: {importName}</span>
            : usingMock ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Dữ liệu mẫu</span>
            : null}
        </div>
        {/* Mốc dữ liệu — pill gọn kiểu ePMP (chấm xanh + giờ + "x phút trước"). */}
        {!usingMock && dataTs ? (() => { const s = stampInfo(dataTs); return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10.5px]" title={`Dữ liệu lấy lúc ${s.abs}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {!narrow && <span className="font-semibold uppercase tracking-wide text-emerald-700">Dữ liệu tính đến</span>}
            <span className="font-bold tabular-nums text-slate-800">{s.abs}</span>
            <span className="text-emerald-600">· {s.rel}</span>
          </span>
        ); })() : null}
        {/* Nút gom bộ điều khiển — chỉ có trên máy hẹp. Số bên cạnh = mấy bộ lọc đang bật, để
            đóng lại rồi vẫn biết bảng đang bị lọc chứ không tưởng là đang xem đủ. */}
        {narrow && (() => {
          const nOn = [showOverdue, showIssues, hideDone, !!projFilter].filter(Boolean).length;
          return (
            <button type="button" onClick={() => setBarOpen((v) => !v)}
              className={`ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] font-semibold ${barOpen || nOn ? "border-teal-500 bg-teal-50 text-teal-800" : "border-slate-300 bg-white text-slate-600"}`}>
              <SlidersHorizontal className="h-3.5 w-3.5" /> Lọc{nOn ? ` · ${nOn}` : ""} {barOpen ? "▴" : "▾"}
            </button>
          );
        })()}
        {/* Điều khiển hiển thị — CHO XUỐNG DÒNG: máy hẹp mà bắt nằm một hàng thì cả trang bị đẩy
            lệch, cuộn ngang mới thấy hết nút. */}
        <div className={`flex min-w-0 flex-wrap items-center gap-1.5 ${narrow ? "basis-full" : ""} ${narrow && !barOpen ? "hidden" : ""}`}>
          <div className="inline-flex h-7 items-stretch overflow-hidden rounded-md border border-slate-300 text-[11.5px] font-medium">
            <button type="button" title="Mở hết mọi tầng" onClick={() => setExpanded(new Set(allKeys))} className="flex items-center bg-white px-2.5 text-slate-600 hover:bg-slate-50">Mở tất cả</button>
            <button type="button" title="Chỉ hiện dòng khu" onClick={() => setExpanded(new Set())} className="flex items-center border-l border-slate-300 bg-white px-2.5 text-slate-600 hover:bg-slate-50">Thu gọn</button>
          </div>
          <button type="button" title="Chỉ hiện các hạng mục ĐANG QUÁ HẠN" onClick={() => setShowOverdue((v) => !v)}
            className={`inline-flex h-7 items-center rounded-md border px-2.5 text-[11.5px] font-medium ${showOverdue ? "border-red-400 bg-red-50 text-red-700" : "border-slate-300 bg-white text-slate-600 hover:border-red-400"}`}>Chỉ quá hạn</button>
          <button type="button" title="Chỉ hiện đầu việc có LỖI DỮ LIỆU (ngày sai · kết thúc trước bắt đầu · khối lượng/% vô lý · lá rỗng · Thi công lệch ngày)" onClick={() => setShowIssues((v) => !v)}
            className={`inline-flex h-7 items-center rounded-md border px-2.5 text-[11.5px] font-medium ${showIssues ? "border-amber-400 bg-amber-50 text-amber-700" : "border-slate-300 bg-white text-slate-600 hover:border-amber-400"}`}>Lỗi dữ liệu</button>
          <button type="button" title="Ẩn các đầu việc ĐÃ XONG (khối lượng đủ, vd 97/97, hoặc 100%). Dòng khu/công đoạn xong hết cũng ẩn." onClick={() => setHideDone((v) => !v)}
            className={`inline-flex h-7 items-center rounded-md border px-2.5 text-[11.5px] font-medium ${hideDone ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-white text-slate-600 hover:border-emerald-400"}`}>Ẩn việc đã xong</button>
          {/* Lọc theo DỰ ÁN — dòng số nguyên là các KHU của 1 dự án; chọn dự án → hiện đủ khu. */}
          <label className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white pl-2 pr-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Dự án</span>
            <select value={projFilter} onChange={(e) => { setProjFilter(e.target.value); setExpanded(null); }}
              style={{ maxWidth: narrow ? "52vw" : 240 }}
              className="min-w-0 bg-transparent text-[11.5px] text-slate-700 focus:outline-none">
              <option value="">Tất cả ({projGroups.length} dự án)</option>
              {projGroups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          </label>
        </div>
        {/* Cụm phải: khoảng thời gian + nhập dữ liệu + làm mới — gap đều để xếp cân. */}
        <div className={`flex flex-wrap items-center gap-1.5 ${narrow ? "basis-full" : ""} ${narrow && !barOpen ? "hidden" : ""}`}>
        {/* Khoảng thời gian — nhãn gọn M/YYYY (8/2026) thay vì "August 2026" của ô month gốc. */}
        <div className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 leading-none">
          <span className="text-[10px] font-semibold uppercase leading-none tracking-wide text-slate-400">Khoảng</span>
          <select value={winFrom || grid.autoFrom} onChange={(e) => { setShowAll(false); setWinFrom(e.target.value); }}
            className="h-full bg-transparent text-[11.5px] font-medium leading-none text-slate-700 focus:outline-none">
            {monthOpts(grid.autoFrom, grid.autoTo).map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <span className="text-[11.5px] leading-none text-slate-400">→</span>
          <select value={winTo || grid.autoTo} onChange={(e) => { setShowAll(false); setWinTo(e.target.value); }}
            className="h-full bg-transparent text-[11.5px] font-medium leading-none text-slate-700 focus:outline-none">
            {monthOpts(grid.autoFrom, grid.autoTo).map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </div>
        {canManage && <span className="relative">
          <button onClick={() => { setImportErr(null); setImportOpen((o) => !o); }} title="Nhập file .xlsx hoặc link Google Sheet (chỉ hiển thị trong app này)"
            className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] font-medium ${importOpen ? "border-teal-500 bg-teal-50 text-teal-800" : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"}`}>
            <Upload className="h-3.5 w-3.5" /> Nhập dữ liệu
          </button>
          {importOpen && (
            /* ĐIỆN THOẠI: panel 330px neo phải nút — nút nằm giữa thanh nên mép trái panel lọt ra
               ngoài màn (đo trên 375px: left = −151px, mất hẳn cột trái). Trên máy nhỏ cho panel bám
               hai mép màn hình; trên máy tính giữ nguyên popover neo dưới nút như cũ. */
            <div style={narrow
              ? { position: "fixed", top: 64, left: 12, right: 12, maxHeight: "calc(100vh - 88px)", overflowY: "auto", background: "#fff", color: "#0f172a", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 14px 36px rgba(2,6,23,.32)", padding: 14, zIndex: 50 }
              : { position: "absolute", top: "calc(100% + 6px)", right: 0, width: 330, background: "#fff", color: "#0f172a", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 14px 36px rgba(2,6,23,.32)", padding: 14, zIndex: 50 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <strong style={{ fontSize: 13 }}>Nhập dữ liệu chi tiết</strong>
                <button onClick={() => setImportOpen(false)} style={{ color: "#94a3b8", display: "inline-flex" }}><X className="h-4 w-4" /></button>
              </div>
              {/* NGUỒN ĐANG DÙNG — mỗi dòng một file: mở đúng file đó, hoặc gỡ hẳn khỏi DST.
                  Chỉ admin/PMO thấy panel này nên link an toàn hiển thị ở đây. */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, marginBottom: 5 }}>
                  Nguồn dữ liệu {sources.length ? `(${sources.length})` : "— chưa có, đang xem file mẫu"}
                </div>
                <div style={{ display: "grid", gap: 5, maxHeight: 148, overflowY: "auto" }}>
                  {activeList.map((x) => {
                    const laMau = !sources.length;
                    return (
                      <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid #99f6e4", background: "#f0fdfa", borderRadius: 6, padding: "5px 7px" }}>
                        <a href={linkOf(x)} target="_blank" rel="noreferrer" title={`Mở đúng file của nguồn này
${x.fileId}`}
                          style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, flex: 1, color: "#0f766e", fontSize: 11.5, fontWeight: 600, textDecoration: "none" }}>
                          <ExternalLink className="h-3.5 w-3.5" style={{ flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {x.tag || (laMau ? "File mẫu" : x.fileId.slice(0, 14) + "…")}
                            {x.sheet ? ` · tab ${x.sheet}` : tabDo[x.id] ? ` · tab ${tabDo[x.id]} (tự dò)` : ""}
                          </span>
                        </a>
                        {!laMau && (
                          <button onClick={() => void xoaNguon(x)} disabled={xoaBusy === x.id} title="Gỡ nguồn này khỏi DST (không đụng file gốc)"
                            style={{ display: "inline-flex", color: "#b91c1c", opacity: xoaBusy === x.id ? 0.4 : 1, flexShrink: 0 }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {importName && <div style={{ marginTop: 5, fontSize: 10.5, color: "#b45309", lineHeight: 1.4 }}>Bảng đang hiện file vừa mở tại máy anh (<b>{importName}</b>), chưa phải các nguồn trên. Bấm “Làm mới” để về nguồn chung.</div>}
              </div>
              <label style={{ display: "block", fontSize: 11, color: "#64748b", fontWeight: 600, marginBottom: 4 }}>Tên dự án (các khu gộp về 1 dự án)</label>
              <input value={importProj} onChange={(e) => setImportProj(e.target.value)} placeholder="VD: Nam Phương Hoàng Hậu: Lobby"
                style={{ width: "100%", boxSizing: "border-box", marginBottom: 10, border: "1px solid #cbd5e1", borderRadius: 6, padding: "6px 8px", fontSize: 12, color: "#0f172a" }} />
              <label onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }} onDragOver={(e) => e.preventDefault()}
                style={{ display: "block", border: "1.5px dashed #94a3b8", borderRadius: 8, padding: "16px 10px", textAlign: "center", cursor: "pointer", fontSize: 12, color: "#475569", background: "#f8fafc" }}>
                <input type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0])} />
                <Upload className="h-4 w-4" style={{ display: "inline", verticalAlign: "-3px", marginRight: 4 }} />Chọn hoặc kéo-thả file <b>.xlsx</b>
              </label>
              <div style={{ textAlign: "center", fontSize: 11, color: "#94a3b8", margin: "9px 0" }}>— hoặc dán link Google Sheet —</div>
              <input value={linkVal} onChange={(e) => setLinkVal(e.target.value)} placeholder="https://docs.google.com/…"
                style={{ width: "100%", boxSizing: "border-box", border: "1px solid #cbd5e1", borderRadius: 6, padding: "6px 8px", fontSize: 12, color: "#0f172a" }} />
              {/* CHỌN SHEET (dropdown) — tránh đoán sai khi file nhiều sheet. */}
              <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                <label style={{ fontSize: 11, color: "#64748b", fontWeight: 600, whiteSpace: "nowrap" }}>Sheet:</label>
                <select value={linkSheet} onChange={(e) => setLinkSheet(e.target.value)} disabled={tabsBusy || !linkTabs.length}
                  style={{ flex: 1, minWidth: 0, border: "1px solid #cbd5e1", borderRadius: 6, padding: "6px 8px", fontSize: 12, color: "#0f172a", background: "#fff" }}>
                  {tabsBusy ? <option value={linkSheet}>⏳ Đang tải danh sách sheet…</option>
                    : !linkTabs.length ? <option value="">— dán link để tải danh sách sheet —</option>
                    : <>
                        <option value="">Tự động (sheet nhiều dữ liệu nhất)</option>
                        {linkTabs.map((t) => <option key={t} value={t}>{t}</option>)}
                      </>}
                </select>
                <button onClick={onLink} disabled={busy}
                  style={{ background: "#0f766e", color: "#fff", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, opacity: busy ? 0.6 : 1, whiteSpace: "nowrap" }}>{busy ? "…" : "Tải"}</button>
              </div>
              {importErr && <div style={{ marginTop: 9, fontSize: 11, color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "6px 8px" }}>{importErr}</div>}
              <div style={{ marginTop: 10, fontSize: 10.5, color: "#94a3b8", lineHeight: 1.4 }}>Chỉ hiển thị trong app này (bản phát triển). Cần cột <b>Stt</b>, <b>Mô tả</b>, <b>Bắt đầu/Kết thúc</b>, 2 cột <b>Khối lượng</b>.</div>
            </div>
          )}
        </span>}
        <button onClick={doRefresh} disabled={busy} title="Tải lại dữ liệu MỚI từ nguồn đang xem (không lấy bản cache)"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-[11.5px] font-medium text-slate-600 hover:border-slate-400 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Làm mới
        </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: 12 }}>
        {chuaCoNguon ? (
          /* Chưa ghim nguồn nào thì nói thẳng là chưa có, thay vì bày một bảng số không rõ của ai. */
          <div style={{ maxWidth: 460, margin: "56px auto 0", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#334155" }}>Chưa có nguồn dữ liệu</div>
            <div style={{ fontSize: 12.5, color: "#64748b", margin: "8px 0 0", lineHeight: 1.6 }}>
              {canManage
                ? "Bấm “Nhập dữ liệu” ở thanh trên, dán link Google Sheet và chọn tab để ghim nguồn cho cả công ty cùng xem."
                : "OCC chưa ghim link tiến độ chi tiết. Nhờ OCC nhập nguồn rồi mở lại trang này."}
            </div>
          </div>
        ) : <>
        {usingMock && err && <div style={{ marginBottom: 8, fontSize: 11, color: "#b45309" }}>Chưa đọc được file thật ({err}) — đang hiện DỮ LIỆU MẪU.</div>}
        <div ref={scrollRef} style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", overflow: "auto", height: "100%" }}>
          <div style={{ display: "grid", gridTemplateColumns: gridTemplate, fontSize: 12.5, minWidth: "max-content" }}>
            {/* TIÊU ĐỀ — cột trái đóng băng (sticky left) + tay kéo co giãn */}
            {COL_LABELS.map((lb, i) => (
              <HeadCell key={i} left={colL[i]} edge={i === nCols - 1} onResize={(e) => startResize(i, e)}>{lb}</HeadCell>
            ))}
            <div style={{ ...HEAD, padding: 0, position: "sticky", top: 0, height: 44 }}>
              {grid && (<>
                {grid.months.map((m, i) => <span key={i} style={{ position: "absolute", left: m.left, width: m.days * DAY_PX, top: 0, height: 22, borderLeft: "1px solid #475569", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, background: m.isCur ? "#fff" : "transparent", color: m.isCur ? "#0f172a" : "#fff" }}>{m.name}</span>)}
                {grid.days.map((d, i) => { const inCur = !!grid.curMonth && i * DAY_PX >= grid.curMonth.left && i * DAY_PX < grid.curMonth.left + grid.curMonth.width; return <span key={i} style={{ position: "absolute", left: i * DAY_PX, width: DAY_PX, top: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, background: inCur ? "#fff" : "transparent", color: inCur ? "#0f172a" : "#cbd5e1", fontWeight: inCur ? 700 : 400, fontVariantNumeric: "tabular-nums" }}>{d}</span>; })}
              </>)}
            </div>

            {/* DÒNG */}
            {rows.map((r) => {
              const n = r.node; const pc = computedPct(n); const isProj = n.level === 1;
              const sp = spanOf(n); const a = sp?.a ?? null, b = sp?.b ?? null;
              const sxNode = isProj ? n.children.find(isSanXuat) : undefined;
              const sxSp = sxNode ? spanOf(sxNode) : null;
              const sxPct = sxNode ? computedPct(sxNode) : null;
              const overdueDays = b != null && b < todayTs && (pc ?? 0) < 100 ? Math.round((todayTs - b) / DAY) : 0;
              const emptyRow = isEmptyLeaf(n);
              const tcMsg = tcWarn.get(n);
              const issueMsg = nodeIssueMsg(n);                 // lỗi cụ thể của lá (rỗng / ngày / % vs khối lượng…)
              const warnMsg = issueMsg || tcMsg || null;        // rê chuột vào ⚠ hiện đúng lỗi
              const bg = emptyRow ? "#fff7ed" : issueMsg ? "#fffbeb" : isProj ? "#cbd9ea" : n.level === 2 ? "#eef2f7" : "#fff";
              return (
                <div key={r.key} style={{ display: "contents" }}>
                  <div style={{ ...cellL(bg), position: "sticky", left: colL[0], zIndex: 2, overflow: "hidden" }}>
                    <span style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0, paddingLeft: (n.level - 1) * 15 }}>
                      {r.hasKids ? (
                        <button onClick={() => toggle(r.key)} style={{ width: 16, height: 16, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#64748b", flexShrink: 0 }}>
                          <ChevronRight className="h-3.5 w-3.5" style={{ transform: r.open ? "rotate(90deg)" : "none" }} />
                        </button>
                      ) : <span style={{ width: 16, flexShrink: 0 }} />}
                      {n.stt && <span style={{ marginRight: 6, fontVariantNumeric: "tabular-nums", fontWeight: isProj ? 900 : 700, color: isProj ? "#0f172a" : "#0f766e", minWidth: 24, flexShrink: 0 }}>{n.stt}</span>}
                      {warnMsg && <span title={warnMsg} style={{ display: "inline-flex", marginRight: 4, flexShrink: 0, cursor: "help" }}><AlertTriangle className="h-3 w-3" style={{ color: "#d97706" }} /></span>}
                      <span title={warnMsg || cleanName(n)}
                        style={{ fontWeight: isProj ? 900 : n.level === 2 ? 700 : 400, fontSize: isProj ? 13.5 : undefined, color: emptyRow || issueMsg ? "#b45309" : "#0f172a", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cleanName(n)}</span>
                    </span>
                  </div>
                  {/* ĐVT */}
                  <div style={{ ...cell(bg), position: "sticky", left: colL[1], zIndex: 2, color: "#64748b", fontSize: 11.5, fontWeight: isProj ? 700 : undefined }}>{n.unit || ""}</div>
                  {/* Khối lượng hoàn thành: DÒNG CHA hiện % trung bình con; DÒNG LÁ hiện đã làm/tổng. */}
                  <div style={{ ...cell(bg), position: "sticky", left: colL[2], zIndex: 2, fontVariantNumeric: "tabular-nums" }}>
                    {(() => {
                      // DÒNG TỔNG (có con) → % trung bình; ĐẦU VIỆC CON → số đã làm / tổng (khối lượng), không có thì "—".
                      if (r.hasKids) return <span style={{ fontWeight: 800, color: pc == null ? "#cbd5e1" : "#0f766e" }}>{pc == null ? "—" : `${Math.round(pc)}%`}</span>;
                      const qp = qtyParts(n);
                      if (qp) return (
                        <span style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", alignItems: "baseline", columnGap: 3, width: "100%" }}>
                          <span style={{ textAlign: "right", fontWeight: 700, color: "#0f766e" }}>{fmtQty(qp.done)}</span>
                          <span style={{ color: "#cbd5e1" }}>/</span>
                          <span style={{ textAlign: "left", color: "#64748b" }}>{fmtQty(qp.tot)}</span>
                        </span>
                      );
                      // Dòng thiếu thông tin → dấu — MÀU VÀNG (chấm cảnh báo nhẹ) để nhận ra.
                      return <span style={{ color: emptyRow ? "#d97706" : "#cbd5e1", fontWeight: emptyRow ? 800 : 400 }} title={emptyRow ? "Thiếu thông tin — chưa có ngày/khối lượng/%" : undefined}>{emptyRow ? "⚠ —" : "—"}</span>;
                    })()}
                  </div>
                  {/* Bắt đầu · Kết thúc */}
                  <div style={{ ...cell(bg), position: "sticky", left: colL[3], zIndex: 2, fontWeight: isProj ? 700 : undefined }}>{n.start}</div>
                  <div style={{ ...cell(bg), position: "sticky", left: colL[4], zIndex: 2, fontWeight: isProj ? 700 : undefined, ...(tcMsg ? { color: "#b45309", fontWeight: 700 } : {}) }} title={tcMsg || undefined}>{n.end}{tcMsg ? " ⚠" : ""}</div>
                  {/* Quá hạn */}
                  <div style={{ ...cell(bg), position: "sticky", left: colL[5], zIndex: 2, boxShadow: FROZEN_EDGE, fontWeight: overdueDays > 0 || isProj ? 700 : 400, color: overdueDays > 0 ? "#dc2626" : "#94a3b8" }}>{overdueDays}</div>
                  {/* Cột timeline xếp LAYER rõ ràng để line ngang chỉ nằm trên NỀN: viền-dưới bỏ khỏi
                      ô (kẻ bằng div riêng zIndex 0) → line(0) < băng ngày(1) < thanh(2) < nhãn(3).
                      Băng đỏ liền mạch, không bị line trắng cắt ngang. */}
                  <div style={{ ...cell(bg), borderTop: "none", display: "block", padding: 0, position: "relative", minHeight: isProj ? 36 : undefined }}>
                    {/* line ngang phân dòng — LỚP NỀN (dưới cùng) */}
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "rgba(100,116,139,.14)", zIndex: 0 }} />
                    {grid && todayTs >= grid.lo && todayTs <= grid.hi && (
                      <div style={{ position: "absolute", top: -1, bottom: -1, width: DAY_PX, left: Math.round((todayTs - grid.lo) / DAY) * DAY_PX, background: TODAY_BAND, zIndex: 0 }} />
                    )}
                    {grid && a != null && b != null && b >= grid.lo && a <= grid.hi && (() => {
                      const aC = Math.max(a, grid.lo), bC = Math.min(b, grid.hi);
                      const left = Math.round((aC - grid.lo) / DAY) * DAY_PX;
                      const w = Math.max(DAY_PX, (Math.round((bC - aC) / DAY) + 1) * DAY_PX);
                      const fill = Math.max(0, Math.min(100, pc ?? 0));
                      return (
                        <>
                          <div style={{ position: "absolute", left, width: w, background: NAVY, borderRadius: 3, overflow: "hidden", zIndex: 1, ...(isProj ? { top: 5, bottom: 5 } : { top: "50%", height: 12, transform: "translateY(-50%)" }) }} title={`${fmtTs(aC)} → ${fmtTs(bC)} · ${pc == null ? "—" : Math.round(pc) + "%"}${qtyLabel(n) ? " · KL " + qtyLabel(n) : ""}`}>
                            {!isProj && <div style={{ height: "100%", width: `${fill}%`, background: DONE }} />}
                          </div>
                          {pc != null && <span style={{ position: "absolute", top: "50%", left: left + w + 4, transform: "translateY(-50%)", fontSize: 9.5, fontWeight: 700, color: overdueDays > 0 ? "#dc2626" : "#334964", whiteSpace: "nowrap", zIndex: 1 }}>{Math.round(pc)}%</span>}
                        </>
                      );
                    })()}
                    {isProj && grid && sxSp && sxSp.b >= grid.lo && sxSp.a <= grid.hi && (() => {
                      const nDays = Math.round((sxSp.b - sxSp.a) / DAY) + 1;
                      const nDone = sxPct != null ? Math.floor((nDays * sxPct) / 100) : 0;
                      return Array.from({ length: nDays }, (_, k) => {
                        const ts = sxSp.a + k * DAY;
                        if (ts < grid.lo || ts > grid.hi) return null;
                        const done = k < nDone;
                        const colLeft = ((ts - grid.lo) / DAY) * DAY_PX;
                        return <div key={k} title={`Nhà máy SX ${fmtTs(ts)} — ${done ? "đã xong" : "chưa xong"}`} style={{ position: "absolute", left: colLeft + DAY_PX / 2, top: "50%", width: 13, height: 13, transform: "translate(-50%,-50%)", background: done ? SX_DONE : SX_TODO, border: "1px solid #0f172a", borderRadius: 2, zIndex: 1 }} />;
                      });
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        </>}
      </div>
    </div>
  );
}

const HEAD: CSSProperties = { background: "#1e293b", color: "#fff", fontWeight: 700, padding: "8px 8px", position: "sticky", top: 0, zIndex: 2, whiteSpace: "normal", lineHeight: 1.2, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" };
function HeadCell({ children, left, edge, onResize }: { children: ReactNode; left: number; edge?: boolean; onResize: (e: React.MouseEvent) => void }) {
  return (
    <div style={{ ...HEAD, left, zIndex: 4, ...(edge ? { boxShadow: FROZEN_EDGE } : {}) }}>
      {children}
      {/* tay kéo co giãn cột (mép phải) */}
      <div onMouseDown={onResize} title="Kéo để đổi độ rộng cột"
        style={{ position: "absolute", top: 0, right: 0, width: 6, height: "100%", cursor: "col-resize", zIndex: 5 }} />
    </div>
  );
}
const cell = (bg: string): CSSProperties => ({ background: bg, borderTop: "1px solid rgba(100,116,139,.14)", padding: "5px 10px", whiteSpace: "nowrap", color: "#475569", display: "flex", alignItems: "center", justifyContent: "center" });
const cellL = (bg: string): CSSProperties => ({ ...cell(bg), justifyContent: "flex-start" });
