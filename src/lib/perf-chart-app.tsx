/**
 * HIỆU SUẤT DỰ ÁN — app trong App Shell (thanh dọc trái). Tái tạo 2 sheet chart của file
 * "Báo cáo hiệu suất": CHARTM (mini column-chart xu hướng theo tháng, mỗi dự án 1 chart) +
 * JULYCHART (1 bar lớn xếp hạng tháng mới nhất). Render SVG THUẦN (không thêm thư viện).
 *
 * NGUỒN: file .xlsx / Google Sheet. Parser DÒ THEO TIÊU ĐỀ CỘT (không cứng tên sheet/vị trí cột):
 *   • Cột TÊN dự án: "Row Labels"/"Dự án"/"Tên"/"Các khu"…
 *   • Cột STT (nếu có): "STT"/"Số thứ tự"/… hoặc cột số nguyên ngay trước cột tên. CÓ STT → chỉ dòng
 *     có số mới lấy (bỏ dòng phụ/Grand Total). KHÔNG có STT → lấy mọi dòng có tên + số.
 *   • Doanh thu tháng: header có tên tháng (Jan…Dec) / "DT T1…" / "Tháng 1…" / "T1…" (VND).
 *   • Nhân sự tháng: header có "NS…" / "Nhân sự" / "Headcount". Ghép DT↔NS theo THỨ TỰ cột.
 *   → Số THÁNG là động (2, 5, 7, 12… tuỳ file). Fallback: đọc theo vị trí Pivot(2) cũ (A/B/D-J/K-Q).
 *   Hiệu suất = DT/NS (tỷ đồng/người); NS=0 → NA (không vẽ); NS>0 & DT=0 → 0,0; số ÂM hợp lệ.
 * NẠP xong PMO LƯU vào KV → data GIỮ LẠI đến khi cập nhật file mới (mọi người mở app thấy bản mới nhất).
 * SẮP XẾP: dự án CÓ dữ liệu (bất kỳ tháng ≠ 0) xếp TRÊN dự án RỖNG (toàn 0); trong nhóm giảm dần theo
 *   tháng mới nhất, bằng nhau → theo tên tự nhiên (APEC S2<S3<S4). Lưới mini: trên→xuống rồi trái→phải.
 * THANG: mini dùng thang CHUNG cố định (−1→4 tỷ) để so cao thấp; bar lớn dùng thang ĐỘNG (fit dữ liệu).
 */
import { loiNoi } from "@/lib/loi-noi";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Upload, Maximize2, Minimize2, FileDown, Database, X, ExternalLink } from "lucide-react";
import { getSummaryFile, getProjRegions, getInstallList } from "@/lib/mtld-install.functions";
import { whoami } from "@/lib/activity.functions";
import { getPerfData, savePerfData, startPerfSourceUpload, linkFileNguonHieuSuat, fetchUserRoles } from "@/lib/edits.functions";
import { roleOf } from "@/lib/roles";
import { useIsNarrow } from "@/lib/use-breakpoint";
import { track } from "@/lib/track";
import { VUNG_ORDER, vungVN, vungRank, vungColor, lookupRegion, normProjName } from "@/lib/vung";

/** 20 DỰ ÁN ĐƯỢC HIỆN + ĐÚNG THỨ TỰ chủ nhà chốt (lưới điền TRÊN→XUỐNG rồi mới sang cột kế, nên
 *  thứ tự dưới đây đọc theo CỘT của bản in: cột 1 từ trên xuống, rồi cột 2…).
 *  File báo cáo tuần liệt kê nhiều nhóm khác (OEM, OTHERS, LOOSE EXPORT, CÔNG NỢ CŨ…) — KHÔNG hiện hết.
 *  Dự án không có trong file thì tự bỏ qua (không để ô trống).
 *  LƯU Ý thứ tự: lưới nay GOM CỤM THEO VÙNG (Phú Quốc → Bắc → Trung → Nam → Nước Ngoài), thứ tự dưới
 *  đây chỉ còn quyết định trước-sau TRONG cùng một vùng.
 *  QUY ƯỚC VẬN HÀNH: dự án đã rời ePMP thì tự mang ra khỏi lưới (xem `ordered`), nhường chỗ cho dự án
 *  mới — muốn thêm dự án mới thì viết tên nhóm vào danh sách này, đúng như cách gọi trong file tuần. */
const PERF_SHOW = [
  "TROPICAL PQ", "CHATEAU", "NAM PHƯƠNG PQ", "TÂY HỒ VIEW",
  "20 ĐÔNG DU", "MINI HOTEL PQ", "HOLIDAY INN BÀ NÀ", "HYATT PQ",
  "HYATT HỒ TRÀM", "OLALANI", "COSMO ĐÀ NẴNG", "CÁT BÀ", "TIẾN BỘ PLAZA",
  "HYATT HẠ LONG", "43 ĐTM", "APEC S2", "APEC S3",
  "APEC S4", "TRỤC ĐÔNG TÂY", "TULIP 3", "TULIP 123",
];
/** VÙNG KHAI TAY — chỉ cho dự án CÓ trong file tuần nhưng KHÔNG có trên ePMP (nên tra vùng không ra).
 *  Khai ở đây thì dự án mới không bị luật "rời ePMP thì mang ra" quét mất. ePMP luôn thắng: chỗ này chỉ
 *  bù vào chỗ trống. Dự án nào xong thì XOÁ dòng của nó khỏi đây lẫn khỏi PERF_SHOW. */
const PERF_REGION: Record<string, string> = {
  // Nhóm "COSMO ĐÀ NẴNG" của file = Khu dịch vụ du lịch ven sông Hàn (CT25-077, CT24-076,
  // CT24-087). Tên nhóm này KHÔNG trùng tên dự án bên ePMP nên tra vùng không ra — khai tay
  // để nó vào đúng cụm miền Trung thay vì rơi xuống nhóm vùng lạ.
  "cosmo da nang": "Trung",
};
/** TÊN HIỂN THỊ TRÊN THẺ — chỉ đổi CHỮ, không đụng tới việc khớp.
 *
 *  Thẻ xưa nay lấy thẳng tên nhóm trong file tuần, mà tên đó là tên nội bộ của bên kế toán
 *  ("COSMO ĐÀ NẴNG" cho Khu du lịch ven sông Hàn, "HYATT PQ" cho Hyatt Phú Quốc). Sửa thẳng
 *  PERF_SHOW thì hỏng khớp, vì PERF_SHOW chính là danh sách dò theo tên file.
 *  Khoá = tên file đã chuẩn hoá (keyName). Thiếu khoá thì giữ nguyên tên file. */
const PERF_TEN_HIEN: Record<string, string> = {
  "tropical pq": "Tropical",
  "nam phuong pq": "Nam Phương Hoàng Hậu",
  "mini hotel pq": "Mini Hotel",
  "hyatt pq": "Hyatt Phú Quốc",
  /* Nhóm "COSMO ĐÀ NẴNG" gồm B4.1 · B4.2 · Ponte Apartment · CT25-077 ven sông Hàn — chỉ
     CT25-077 có doanh thu (đo file T1-T9 ngày 02/10/2026), nên số của thẻ là của ven sông Hàn.
     Ponte Apartment mà phát sinh doanh thu thì số sẽ gộp vào đây mà tên thẻ không nói ra. */
  "cosmo da nang": "KDL ven sông Hàn",
  /* Nhóm "CÁT BÀ" gồm 3 căn mẫu AATN · HH1 · HH3 — chỉ HH3 có doanh thu. HH1 chạy thì số sẽ
     gộp vào đây. */
  "cat ba": "Cát Bà HH3",
};

/** DÒNG GOM, KHÔNG PHẢI DỰ ÁN — cấm lên lưới dù có ai lỡ khai vào PERF_SHOW hay file tuần có đánh STT.
 *  Chủ nhà chốt: KHÔNG dùng nhóm "OTHERS". Mấy dòng còn lại cùng loại (OEM, Loose Export, công nợ cũ,
 *  thiết kế, "khác") là các khoản bị TRỪ RA hoặc gom việc lẻ — đưa lên lưới "các dự án" là sai bản chất
 *  và còn che mất dự án thật. */
const PERF_EXCLUDE = /^(others?|oem|looses*export|congs*nos*cu|khac|thiets*ke|tong.*|.*claim.*|luys*ke.*)$/i;
/** So tên nhóm: bỏ dấu + gộp khoảng trắng + không phân biệt hoa thường (file gõ mỗi kỳ một kiểu). */
const keyName = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/đ/g, "d").replace(/\s+/g, " ").trim();
const SHOW_KEYS = PERF_SHOW.map(keyName);

/** CHỌN DỰ ÁN LÊN LƯỚI HIỆU SUẤT, theo cột "Thứ tự hiện" trong file nguồn (xem HIEN_RE).
 *
 *  Gõ 1, 2, 3… vào dòng nào thì dự án đó lên lưới theo đúng số đó; để trống là không hiện. Nhờ vậy
 *  PMO tự đổi danh sách bằng file, khỏi nhờ sửa code rồi deploy.
 *
 *  KHÔNG AI GÕ SỐ NÀO thì lùi về PERF_SHOW như cũ — cần đường lùi vì file đang dùng chưa có cột đó,
 *  mà lưới trắng bong còn tệ hơn danh sách cũ. Hễ có DÙ CHỈ MỘT dòng được gõ số là chuyển HẲN sang
 *  cột đó: nửa nọ nửa kia thì không ai lần ra được vì sao một dự án hiện hay không hiện. */
export function chonHien(projs: readonly Proj[]): Proj[] {
  const coGoSo = projs.some((p) => p.hien != null);
  if (coGoSo) return projs.filter((p) => p.hien != null).sort((a, b) => (a.hien as number) - (b.hien as number));
  const byKey = new Map(projs.map((p) => [keyName(p.name), p] as const));
  return SHOW_KEYS.map((k) => byKey.get(k)).filter((p): p is Proj => !!p);
}
/** Tên đưa lên thẻ / bảng xếp hạng. Khớp vẫn theo tên file, chỉ chữ hiển thị đổi.
 *  IN HOA HẾT: tên trong file tuần vốn đã viết hoa toàn bộ, nên tên khai tay cũng phải viết hoa,
 *  kẻo trên cùng một lưới có thẻ hoa thẻ thường. Dùng locale "vi" cho chắc phần dấu. */
const tenHien = (n: string) => (PERF_TEN_HIEN[keyName(n)] ?? n).toLocaleUpperCase("vi");

// Thang CHUNG cho mini (để so cao thấp giữa các dự án). ĐÁY = 0: từ khi có nguyên tắc loại trừ
// tháng âm (absorbNegBack) thì không còn cột âm nào, chừa dải −1→0 chỉ tổ phí 1/5 chiều cao.
const MINI_YMIN = 0, MINI_YMAX = 4e9;
const KPI = 1e9;                            // KPI hiệu suất/tháng = 1 tỷ đồng/người (đường mốc)
const COLS = 5;
const DEFAULT_NM = 7;
const SERIF = '"Times New Roman", Times, serif';

/** `hien` = số gõ ở cột "Thứ tự hiện" trong file nguồn (xem HIEN_RE). Có số → lên lưới Hiệu suất
 *  theo đúng số đó; không có → không hiện. Cả file không ai gõ thì lùi về PERF_SHOW (xem `ordered`). */
type Proj = { no: number; name: string; rev: number[]; ns: number[]; hien?: number };
/** Dự án đã gắn VÙNG (lấy từ ePMP) — chỉ dùng ở tab "Hiệu suất theo tháng" để gom cụm + tô viền. */
type ProjV = Proj & { vung: string };

/** Số tỷ 1 chữ số thập phân. Riêng SỐ 0 in gọn là "0" (không phải "0,0") — mini chart nhiều ô 0,
 *  viết ngắn đỡ rối mắt. Dùng cho cả nhãn mốc trục lẫn nhãn trên đầu cột. */
const tyf = (v: number | null): string => {
  if (v == null) return "";
  const s = (v / 1e9).toFixed(1);
  return s === "0.0" || s === "-0.0" ? "0" : s.replace(".", ",");
};
const perfOf = (p: Proj, m: number): number | null => (p.ns[m] > 0 ? p.rev[m] / p.ns[m] : null);
/** NGUYÊN TẮC LOẠI TRỪ THÁNG ÂM (chỉ áp cho tab "Hiệu suất theo tháng").
 *  Sản lượng âm ở tháng m là phần ĐIỀU CHỈNH/HOÀN của sản lượng đã ghi nhận TRƯỚC đó, nên gánh ngược:
 *    · trừ vào THÁNG LIỀN TRƯỚC;
 *    · tháng liền trước không đủ (hoặc cũng âm) → lùi tiếp tháng trước nữa, cho tới tháng đầu.
 *  Gánh trên SẢN LƯỢNG (VND) rồi mới chia nhân sự — mỗi tháng nhân sự một khác, cộng trừ thẳng trên
 *  tỷ-số sẽ ra số vô nghĩa. TỔNG sản lượng cả năm KHÔNG đổi.
 *  Gánh hết các tháng trước mà vẫn dư âm → DỒN NỐT VÀO THÁNG 12 (ô cuối năm). Tháng 12 nằm ngoài
 *  vùng đang hiển thị (chart chỉ vẽ tới tháng có số) nên phần dư KHÔNG hiện lên, mà tổng cả năm vẫn
 *  khớp file — chốt theo yêu cầu: "cỡ không có thì trừ qua tháng 12 luôn, chỉ là không show lên". */
const DEC = 11;   // chỉ số tháng 12
export function absorbNegBack(rev: readonly number[]): number[] {
  const r = rev.slice();
  while (r.length <= DEC) r.push(0);                    // nới đủ 12 tháng để có chỗ dồn phần dư
  for (let m = r.length - 1; m >= 1; m--) {
    if (!(r[m] < 0)) continue;
    let need = -r[m];                                   // phần âm cần gánh
    for (let k = m - 1; k >= 0 && need > 1e-9; k--) {
      const take = Math.min(need, Math.max(0, r[k]));   // chỉ lấy phần DƯƠNG còn lại của tháng trước
      r[k] -= take; need -= take;
    }
    r[m] = 0;
    // Hết chỗ gánh → dồn về tháng 12. Nếu chính tháng 12 đang âm thì phần dư NẰM LẠI đó (gán, không
    // cộng dồn) — vẫn đúng "trừ qua tháng 12", và tổng cả năm không đổi.
    if (need > 1e-9) r[DEC] = m === DEC ? -need : r[DEC] - need;
  }
  return r;
}
const nmOf = (projs: Proj[]): number => projs[0]?.rev.length || DEFAULT_NM;
/** Tháng "mới nhất" = tháng CUỐI có doanh thu (tự nhảy khi thêm tháng); fallback tháng cuối có nhân sự. */
function latestMonth(projs: Proj[], nm: number): number {
  let idx = -1;
  for (let m = 0; m < nm; m++) if (projs.some((p) => p.rev[m] !== 0)) idx = m;
  if (idx < 0) for (let m = 0; m < nm; m++) if (projs.some((p) => p.ns[m] > 0)) idx = m;
  return Math.max(0, idx);
}
/** "Có dữ liệu" = có bất kỳ tháng nào hiệu suất khác 0 (kể cả âm). Toàn 0/NA → coi là RỖNG. */
const hasData = (p: Proj, nm: number): boolean => { for (let m = 0; m < nm; m++) { const v = perfOf(p, m); if (v != null && v !== 0) return true; } return false; };
const byNameNat = (a: Proj, b: Proj) => a.name.localeCompare(b.name, "vi", { numeric: true });
/** So sánh 2 tầng: CÓ dữ liệu trước RỖNG; rồi giảm dần theo tháng `idx`; bằng nhau → tên tự nhiên. */
function cmpProj(a: Proj, b: Proj, idx: number, nm: number): number {
  const ha = hasData(a, nm), hb = hasData(b, nm);
  if (ha !== hb) return ha ? -1 : 1;
  const va = perfOf(a, idx), vb = perfOf(b, idx);
  if (va == null && vb == null) return byNameNat(a, b);
  if (va == null) return 1; if (vb == null) return -1;
  return vb - va || byNameNat(a, b);
}

function fileIdFromUrl(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || url.match(/^([a-zA-Z0-9_-]{20,})$/);
  return m ? m[1] : null;
}
function xlsxCell(r: number, c: number): string {
  let s = ""; let n = c;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s + (r + 1);
}
/** File báo cáo tuần ghi doanh thu bằng TỶ ĐỒNG ("Tổng DT (T1-7, tỷ đ)", "DT T1"… giá trị 23.24),
 *  trong khi cả app tính bằng VND (chia 1e9 khi hiện). Không quy đổi thì chart ra ~0 — đây chính là
 *  "lỗi khi import". Nhận biết bằng chữ "tỷ / ty / bn / tr.đ" ở TIÊU ĐỀ cột hoặc tiêu đề sheet. */
// KHÔNG dùng \b: trong JS \b chỉ tính ký tự ASCII, mà "ỷ" KHÔNG phải ASCII nên /\btỷ\b/ không
// khớp "tỷ đồng" → không quy đổi đơn vị → mọi mini-chart ra 0,0. Chặn hai đầu bằng khoảng
// trắng / dấu ngoặc / gạch nối thay cho \b.
const TY_RE = /(^|[\s(-])t[ỷy]([\s).,-]|$)/i;
const toNum = (v: unknown): number => typeof v === "number" ? v : (typeof v === "string" && v.trim() && !isNaN(Number(v.replace(/,/g, ""))) ? Number(v.replace(/,/g, "")) : 0);

// ───────────────────────────────────────────────── PARSER (dò theo tiêu đề) ──
const NS_RE = /(^|[^a-z])ns(\s|\d|$)|nhân sự|nhan su|headcount|(^|[^a-z])hc[\s]*\d/i;
const REV_RE = /(^|[^a-z])(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|doanh thu|revenue|(^|[^a-z])dt[\s]*t?\d|tháng[\s]*\d|thg[\s]*\d|(^|[^a-z])t\d{1,2}(\s|$)/i;
// Cột TÊN — mỗi file gọi một kiểu. File báo cáo tuần (Pivot_DoanhThu_NhanSu_theo_Nhom) đặt là "Nhóm DA",
// không có chữ "dự án" nên bộ dò cũ trượt → app báo "Không nhận dạng được dữ liệu". Nhận thêm "nhóm".
const NAME_RE = /row labels|dự án|du an|^tên|^ten|nhóm|nhom|các khu|cac khu|công trình|cong trinh|project/i;
const STT_RE = /^stt$|số thứ tự|so thu tu|^tt$|^no\.?$|^#$/i;
/* CỘT "THỨ TỰ HIỆN" — anh Tiến chốt 07/10/2026: gõ 1, 2, 3… vào dòng nào thì dự án đó lên lưới
   Hiệu suất, theo đúng thứ tự đó; để trống là không hiện.
   Thay cho PERF_SHOW — danh sách 20 tên CỨNG TRONG CODE, nên mỗi lần đổi dự án là phải sửa code
   rồi deploy, mà người nắm danh sách lại là PMO chứ không phải người sửa app.
   Dò rộng vài cách viết: file do nhiều người gõ, ép đúng một chữ thì hụt là im lặng không hiện gì.
   KHÔNG đụng STT_RE: cột STT sẵn có đánh 1..58 cho MỌI dòng theo ABC nên không dùng chọn được. */
const HIEN_RE = /thứ tự hiện|thu tu hien|thứ tự hiển thị|thu tu hien thi|thứ tự hiển|stt hiện|stt hien|^hiện$|^hien$/i;

type Detect = { hr: number; nameCol: number; sttCol: number; hienCol: number; revCols: number[]; nsCols: number[]; score: number };
function detectHeader(rows: unknown[][]): Detect | null {
  let best: Detect | null = null;
  for (let hr = 0; hr < Math.min(rows.length, 14); hr++) {
    const L = (rows[hr] || []).map((c) => (c == null ? "" : String(c).trim().toLowerCase()));
    let nameCol = -1, sttCol = -1, hienCol = -1; const revCols: number[] = [], nsCols: number[] = [];
    // "Thứ tự hiện" dò TRƯỚC: nó là cột chọn, không phải cột số liệu, nên không được rơi vào rev/ns.
    L.forEach((h, i) => { if (h && hienCol < 0 && HIEN_RE.test(h)) hienCol = i; });
    L.forEach((h, i) => { if (!h || i === hienCol) return; if (NS_RE.test(h)) nsCols.push(i); else if (REV_RE.test(h)) revCols.push(i); });
    L.forEach((h, i) => { if (nameCol < 0 && NAME_RE.test(h)) nameCol = i; if (sttCol < 0 && STT_RE.test(h)) sttCol = i; });
    if (nameCol >= 0 && revCols.length >= 1 && nsCols.length >= 1) {
      const score = revCols.length + nsCols.length;
      if (!best || score > best.score) best = { hr, nameCol, sttCol, hienCol, revCols, nsCols, score };
    }
  }
  return best;
}
/** Ưu tiên sheet: Pivot(2) → sheet báo-cáo/pivot khác → sheet thường → sheet thô/chart (Input, Chart…). */
function sheetPriority(n: string): number {
  if (/pivot\s*\(?\s*2/i.test(n)) return 0;
  if (/pivot|hiệu suất|hieu suat|báo cáo|bao cao|summary|report/i.test(n)) return 1;
  if (/chart|input|crosscheck|^sheet\d|^data$|^raw/i.test(n)) return 3;
  return 2;
}
/** Parse LINH HOẠT theo tiêu đề — duyệt sheet THEO ƯU TIÊN, lấy sheet ĐẦU TIÊN parse được (≥1 dự án).
 *  → File có "Pivot (2)" thì chọn đúng nó; file bất kỳ (tên/sheet khác) vẫn nhận nếu format hợp lý. */
export function parseFlexible(wb: import("xlsx").WorkBook, XLSX: typeof import("xlsx")): { projects: Proj[]; sheet: string } | null {
  const names = [...wb.SheetNames].sort((a, b) => sheetPriority(a) - sheetPriority(b) || wb.SheetNames.indexOf(a) - wb.SheetNames.indexOf(b));
  for (const name of names) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: null }) as unknown[][];
    const d = detectHeader(rows); if (!d) continue;
    let sttCol = d.sttCol;
    if (sttCol < 0 && d.nameCol - 1 >= 0) {
      // Cột ngay trước cột tên là STT nếu số của nó chủ yếu là NGUYÊN NHỎ (<1000) — phân biệt STT (1..N)
      // với tiền (hàng triệu). Pivot(2) chỉ ~20/57 dòng có STT, nên KHÔNG xét theo tỉ lệ dòng-có-tên.
      const c = d.nameCol - 1; let small = 0, nums = 0;
      for (let r = d.hr + 1; r < rows.length; r++) { const v = rows[r]?.[c]; if (typeof v === "number") { nums++; if (Number.isInteger(v) && Math.abs(v) < 1000) small++; } }
      if (nums >= 3 && small / nums > 0.8) sttCol = c;
    }
    const NM = Math.min(d.revCols.length, d.nsCols.length, 12);
    const rc = d.revCols.slice(0, NM), nc = d.nsCols.slice(0, NM);
    // ĐƠN VỊ doanh thu — QUYẾT THEO ĐỘ LỚN, KHÔNG tin chữ trong tiêu đề. File tuần 04/09 ghi tiêu đề
    // "DT T1 (tỷ đ)" nhưng số bên trong là ĐỒNG (23.827.384.364): tin chữ thì nhân thêm 1e9, sai đúng
    // một tỷ lần mà chart vẫn vẽ ra hình nên rất khó phát hiện.
    // Doanh thu ghi bằng ĐỒNG luôn từ hàng triệu trở lên; ghi bằng TỶ thì chỉ vài chục. Ngưỡng 1 triệu
    // nằm giữa, cách xa cả hai phía. Toàn 0 (chưa có số) thì mới ngó chữ "tỷ" ở tiêu đề.
    const hdrTxt = [...(rows[d.hr] || []), ...(rows[0] || []), ...(rows[1] || [])].map((x) => String(x ?? "")).join(" | ");
    let rawMax = 0;
    for (let r = d.hr + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      for (const c of rc) { const v = Math.abs(toNum(row[c])); if (v > rawMax) rawMax = v; }
    }
    const revScale = rawMax > 1e6 ? 1 : rawMax > 0 ? 1e9 : (TY_RE.test(hdrTxt) ? 1e9 : 1);
    const projs: Proj[] = [];
    for (let r = d.hr + 1; r < rows.length; r++) {
      const row = rows[r] || []; const nmv = row[d.nameCol];
      const nameS = nmv == null ? "" : String(nmv).trim(); if (!nameS) continue;
      if (/grand total|tổng cộng|^total$|^tổng$/i.test(nameS)) continue;

      /* Ô "Thứ tự hiện" — ĐỌC TRƯỚC bộ lọc STT bên dưới. Nếu đọc sau thì dòng nào không có STT và
         cũng không nằm trong PERF_SHOW đã bị bỏ mất rồi, tức anh Tiến gõ số vào đó mà dự án vẫn
         KHÔNG hiện, lại không có dấu hiệu gì báo vì sao. Gõ số là ý định rõ ràng, phải thắng.
         Chấp cả số lẫn chuỗi số ("3" gõ vào ô định dạng text là chuyện thường). Chỉ nhận số DƯƠNG:
         0 hay chữ coi như bỏ trống, tức không hiện. */
      let hien: number | undefined;
      if (d.hienCol >= 0) {
        const hv = row[d.hienCol];
        const n = typeof hv === "number" ? hv : (typeof hv === "string" && hv.trim() ? Number(hv.trim().replace(/,/g, "")) : NaN);
        if (Number.isFinite(n) && n > 0) hien = n;
      }

      let no: number;
      if (sttCol >= 0) {
        const sv = row[sttCol];
        if (typeof sv === "number") no = sv;                       // có STT → lấy theo STT
        // KHÔNG có STT: bình thường là dòng phụ / dòng tổng → bỏ. NGOẠI LỆ: có gõ "Thứ tự hiện",
        // hoặc tên nằm trong PERF_SHOW.
        // File tuần chỉ đánh STT cho các nhóm ĐANG hiện; muốn thêm dự án mới vào lưới mà phải chờ
        // người làm file đánh thêm số thì thêm không nổi. Dòng tổng ("TỔNG", "(−) OEM"…) không bao
        // giờ trùng tên trong PERF_SHOW nên vẫn bị loại.
        else if (hien != null || SHOW_KEYS.includes(keyName(nameS))) no = 1000 + projs.length;
        else continue;
      } else no = projs.length + 1;
      projs.push({ no, name: nameS, rev: rc.map((c) => toNum(row[c]) * revScale), ns: nc.map((c) => toNum(row[c])), ...(hien != null ? { hien } : {}) });
    }
    if (projs.length) return { projects: projs.sort((a, b) => a.no - b.no), sheet: name };   // sheet ưu tiên cao NHẤT parse được
  }
  return null;
}
/** Đọc KHỐI A của sheet "SLTB (kết quả)" — bảng tổng của báo cáo tuần:
 *      Chỉ tiêu | T1 | T2 | …
 *      Sản lượng KDA (tỷ) | 184.9 | 46.7 | …
 *      Tổng nhân sự       | 240   | 240  | …
 *  Lấy THẲNG 2 dòng này làm số TOÀN KHỐI, KHÔNG tự cộng lại từ các nhóm — vì doanh thu khối đã trừ OEM
 *  và Loose Export, cộng tay sẽ ra số khác báo cáo. Không tìm thấy sheet/dòng → null (app tự cộng như cũ). */
function parseBlockTotals(wb: import("xlsx").WorkBook, XLSX: typeof import("xlsx")): { rev: number[]; ns: number[] } | null {
  const name = wb.SheetNames.find((n) => /sltb/i.test(n)); if (!name) return null;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: null }) as unknown[][];
  const txt = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
  const findRow = (re: RegExp, from = 0) => rows.findIndex((r, i) => i >= from && re.test(txt(r?.[0])));
  const hr = findRow(/^chỉ tiêu$/i); if (hr < 0) return null;
  // PHẢI tìm SAU dòng "Chỉ tiêu": dòng 0 là TIÊU ĐỀ SHEET ("SẢN LƯỢNG ĐẦU NGƯỜI (SLTB) KHỐI DỰ ÁN 2026")
  // cũng chứa chữ "sản lượng" → tìm từ đầu sẽ vớ nhầm tiêu đề, đọc ra toàn số 0.
  const rRev = findRow(/^sản lượng/i, hr + 1), rNs = findRow(/^tổng nhân sự/i, hr + 1);
  if (rRev < 0 || rNs < 0) return null;
  // Cột tháng = các cột có tiêu đề "T1".."T12" ở dòng header (bỏ cột TB/tổng).
  const cols: number[] = [];
  const hdr = rows[hr] || [];
  for (let c = 1; c < hdr.length; c++) if (/^t\s*\d{1,2}$/i.test(txt(hdr[c]))) cols.push(c);
  if (!cols.length) return null;
  // Cùng cách nhận đơn vị như parser chính: theo ĐỘ LỚN, không tin nhãn (xem chú thích ở revScale).
  const rawRev = cols.map((c) => toNum(rows[rRev]?.[c]));
  const mx = Math.max(0, ...rawRev.map((v) => Math.abs(v)));
  const rev = rawRev.map((v) => v * (mx > 1e6 ? 1 : 1e9));
  const ns = cols.map((c) => toNum(rows[rNs]?.[c]));
  return rev.some((v) => v) || ns.some((v) => v) ? { rev, ns } : null;
}

/** Fallback: đọc theo VỊ TRÍ Pivot(2) cũ (A=STT, B=Tên, D-J=DT, K-Q=NS, 7 tháng). */
function parsePositional(wb: import("xlsx").WorkBook): Proj[] {
  const name = wb.SheetNames.find((n) => /pivot\s*\(?\s*2/i.test(n)) || wb.SheetNames.find((n) => /pivot/i.test(n)) || wb.SheetNames[0];
  const sh = wb.Sheets[name]; const cell = (r: number, c: number) => sh[xlsxCell(r, c)];
  const out: Proj[] = [];
  for (let r = 3; r <= 60; r++) {
    const a = cell(r, 0)?.v; const no = typeof a === "number" ? a : null; if (no == null) continue;
    const nm = cell(r, 1)?.v; const nameS = nm == null ? "" : String(nm).trim(); if (!nameS) continue;
    out.push({ no, name: nameS, rev: Array.from({ length: 7 }, (_, m) => toNum(cell(r, 3 + m)?.v)), ns: Array.from({ length: 7 }, (_, m) => toNum(cell(r, 10 + m)?.v)) });
  }
  return out.sort((a, b) => a.no - b.no);
}

// ────────────────────────────────────────────── MINI CHART (thang CHUNG cố định) ──
function MiniChart({ p, nm, w, h }: { p: Proj; nm: number; w: number; h: number }) {
  const mL = 28, mR = 6, mT = 40, mB = 26;
  const iw = w - mL - mR, ih = h - mT - mB;
  const yOf = (v: number) => mT + ih * ((MINI_YMAX - v) / (MINI_YMAX - MINI_YMIN));
  const y0 = yOf(0);
  const bw = iw / nm;
  const grid = [0, 1e9, 2e9, 3e9, 4e9];
  const perf = Array.from({ length: nm }, (_, m) => perfOf(p, m));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "100%", display: "block", fontFamily: SERIF }}>
      {grid.map((g, i) => (
        <g key={i}>
          <line x1={mL} y1={yOf(g)} x2={w - mR} y2={yOf(g)} stroke={g === 0 ? "#94a3b8" : "#e5e9f0"} strokeWidth={g === 0 ? 1 : 0.6} />
          <text x={mL - 4} y={yOf(g) + 4} textAnchor="end" fontSize={12} fill="#94a3b8">{tyf(g)}</text>
        </g>
      ))}
      {perf.map((v, m) => {
        if (v == null) return null;
        const x = mL + bw * m;
        const yv = yOf(Math.max(MINI_YMIN, Math.min(MINI_YMAX, v)));
        const top = Math.min(y0, yv), hgt = Math.abs(yv - y0);
        let lblY: number, lblFill: string;
        if (v < 0) { lblY = y0 - 6; lblFill = "#b91c1c"; }
        else if (v === 0) { lblY = y0 - 6; lblFill = "#334155"; }
        else if (top - mT > 22) { lblY = top - 6; lblFill = "#0f172a"; }
        else { lblY = top + 17; lblFill = "#ffffff"; }
        return (
          <g key={m}>
            <rect x={x + 1} y={top} width={bw - 2} height={Math.max(0.5, hgt)} fill="#2f5597" stroke="#ffffff" strokeWidth={1.2} />
            <text x={x + bw / 2} y={lblY} textAnchor="middle" fontSize={17} fontWeight={700} fill={lblFill}>{tyf(v)}</text>
          </g>
        );
      })}
      {Array.from({ length: nm }, (_, m) => (
        <text key={m} x={mL + bw * m + bw / 2} y={h - 7} textAnchor="middle" fontSize={13} fontWeight={700} fill="#64748b">T{m + 1}</text>
      ))}
      <text x={mL - 6} y={20} textAnchor="start" fontSize={18} fontWeight={800} fill="#111827">
        {(() => { const t = tenHien(p.name); return t.length > 26 ? t.slice(0, 25) + "…" : t; })()}
      </text>
    </svg>
  );
}

// ─────────────────────────────────────── BIG CHART (thang ĐỘNG, xếp hạng tháng) ──
// ── KDA — thẻ phân tích cấp điều hành (executive analytics card) ─────────────
// Horizontal ranked bar chart, nền sáng, 4 màu ngữ nghĩa (≥1 · 0,7–1 · <0,7 · chưa có DT), mốc KPI,
// khoảng cách vs KPI hiện sẵn, 4 thẻ tóm tắt. Đọc 3–5 giây ra tình hình.
const SANS = 'Inter, "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const KDA_TEAL = "#0f766e";   // ĐẠT/VƯỢT KPI (≥ 1 tỷ/người)
const KDA_ORANGE = "#d97706"; // 0,7 – dưới 1: hụt KPI nhưng còn trong tầm với
const KDA_GRAY = "#94a3b8";   // CHƯA CÓ doanh thu tháng này (không phải mức làm được — đừng tô đỏ)
const KDA_GRAYD = "#64748b";  // xám đậm — dùng cho chữ số thẻ tóm tắt
const KDA_RED = "#c2554d";    // DƯỚI 0,7 (kể cả âm) — đỏ trầm, không chói
const KDA_INK = "#0f172a", KDA_SOFT = "#64748b", KDA_FAINT = "#94a3b8", KDA_LINE = "#e5e7eb";

const kfmt = (x: number): string => { let s = x.toFixed(2); if (s === "-0.00") s = "0.00"; return s.replace("-", "−").replace(".", ","); };
const kdelta = (x: number): string => (x > 0.005 ? "+" : x < -0.005 ? "−" : "") + Math.abs(x).toFixed(2).replace(".", ",");
/** MÀU THANH theo mức hiệu suất (chủ nhà chốt): ≥1 xanh · 0,7–dưới 1 cam · dưới 0,7 đỏ.
 *  Dự án CHƯA CÓ doanh thu tháng này để XÁM: 0,00 của nó là "chưa phát sinh", không phải "làm kém"
 *  — nhuộm đỏ cả nhóm đó thì chart đỏ quá nửa và chìm mất mấy dự án thật sự đang hụt. */
const kcolor = (t: number, noRev = false): string =>
  (noRev ? KDA_GRAY : t >= 1 ? KDA_TEAL : t >= 0.7 ? KDA_ORANGE : KDA_RED);

function StatCard({ label, value, unit, sub, tone }: { label: string; value: string; unit?: string; sub?: string; tone?: string }) {
  return (
    <div style={{ flex: "1 1 0", minWidth: 148, background: "#fff", border: `1px solid ${KDA_LINE}`, borderRadius: 10, padding: "10px 13px" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: KDA_FAINT }}>{label}</div>
      <div style={{ marginTop: 3, lineHeight: 1.15 }}>
        <span style={{ fontSize: 21, fontWeight: 750, color: tone || KDA_INK, fontVariantNumeric: "tabular-nums" }}>{value}</span>
        {unit && <span style={{ fontSize: 10.5, fontWeight: 600, color: KDA_FAINT, marginLeft: 5 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: KDA_SOFT, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={sub}>{sub}</div>}
    </div>
  );
}

type RankRow = { name: string; v: number; rev: number; ns: number; prev: number | null };
const bilf = (v: number): string => { let s = (v / 1e9).toFixed(2); if (s === "-0.00") s = "0.00"; return s.replace("-", "−").replace(".", ","); };

function BigChart({ rows, monthIdx }: { rows: RankRow[]; monthIdx: number }) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  // Chuyển sang đơn vị TỶ; xếp hạng cao→thấp (đầu vào đã sort nhưng bảo hiểm lần nữa).
  const data = rows.map((r) => ({ name: r.name, t: r.v / 1e9, rev: r.rev, ns: r.ns, prevT: r.prev != null ? r.prev / 1e9 : null }))
    .sort((a, b) => b.t - a.t);
  const n = data.length || 1;
  const vals = data.map((d) => d.t);
  const kpi = 1;
  const maxV = Math.max(kpi, ...vals), minV = Math.min(0, ...vals);
  const pad = Math.max(0.06, (maxV - minV) * 0.05);
  const dMin = minV - (minV < 0 ? pad : 0), dMax = maxV + pad, rng = dMax - dMin || 1;
  const pos = (x: number) => ((x - dMin) / rng) * 100;      // % trong dải track
  const zeroP = pos(0), kpiP = pos(kpi);
  // Số liệu suy ra (kiểm bằng chính dataset, không đoán)
  const above = vals.filter((v) => v >= kpi).length;      // đạt KPI (≥ 1 tỷ/người)
  const attain = Math.round((above / n) * 100);
  const below = n - above;                                 // chưa đạt KPI
  const noRev = data.filter((d) => d.rev === 0).length;    // chưa có doanh thu tháng này
  const top = data[0], bot = data[n - 1];
  const rowH = 30;

  return (
    <div style={{ fontFamily: SANS, background: "#f8fafc", border: `1px solid ${KDA_LINE}`, borderRadius: 14, padding: "16px 18px 18px", color: KDA_INK }}>
      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-.01em" }}>Doanh thu đầu người theo dự án</div>
          <div style={{ fontSize: 12.5, color: KDA_SOFT, marginTop: 2 }}>Tháng {monthIdx + 1} · {n} dự án · đơn vị: tỷ đồng / người</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 7, background: "#fff", border: `1px solid ${KDA_LINE}`, borderRadius: 9, padding: "6px 12px", whiteSpace: "nowrap" }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: KDA_FAINT }}>KPI</span>
            <span style={{ fontSize: 14.5, fontWeight: 800 }}>1 tỷ đồng / người</span>
          </div>
        </div>
      </div>

      {/* 4 THẺ ĐIỀU HÀNH — số BCH quan tâm: đạt/chưa đạt KPI + dự án dẫn đầu/cần chú ý */}
      <div style={{ display: "flex", gap: 10, marginTop: 13, flexWrap: "wrap" }}>
        <StatCard label="Đạt KPI" value={`${above}/${n}`} sub={`${attain}% dự án đạt mốc`} tone={above ? KDA_TEAL : KDA_SOFT} />
        <StatCard label="Chưa đạt KPI" value={`${below}/${n}`} sub={noRev ? `${noRev} chưa có doanh thu` : "dưới mốc KPI"} tone={below ? KDA_GRAYD : KDA_TEAL} />
        <StatCard label="Cao nhất" value={kfmt(top.t)} unit="tỷ đồng / người" sub={top.name} tone={KDA_TEAL} />
        <StatCard label="Cần chú ý" value={kfmt(bot.t)} unit="tỷ đồng / người" sub={bot.name} tone={bot.t < 0 ? KDA_RED : KDA_INK} />
      </div>

      {/* BIỂU ĐỒ THANH NGANG XẾP HẠNG */}
      <div
        style={{ position: "relative", marginTop: 16, ["--lw" as string]: "clamp(148px, 20vw, 210px)", ["--rw" as string]: "156px" }}
        onMouseLeave={() => setHover(null)}
      >
        {/* Nhãn mốc KPI phía trên dải track */}
        <div style={{ position: "absolute", top: -3, left: "var(--lw)", right: "var(--rw)", height: 0 }}>
          <div style={{ position: "absolute", left: `${kpiP}%`, transform: "translateX(-50%)", fontSize: 10.5, fontWeight: 700, color: KDA_SOFT, whiteSpace: "nowrap" }}>Mốc KPI</div>
        </div>
        {/* Lớp phủ đường mốc: zero (nếu có âm) + KPI — canh đúng dải track (left/right = lw/rw) */}
        <div style={{ position: "absolute", top: 14, bottom: 6, left: "var(--lw)", right: "var(--rw)", pointerEvents: "none" }}>
          {minV < 0 && <div style={{ position: "absolute", left: `${zeroP}%`, top: 0, bottom: 0, width: 1, background: "#cbd5e1" }} />}
          <div style={{ position: "absolute", left: `${kpiP}%`, top: 0, bottom: 0, width: 0, borderLeft: "2px dashed #94a3b8" }} />
        </div>

        {/* CÁC DÒNG */}
        <div style={{ position: "relative", paddingTop: 14 }}>
          {data.map((d, i) => {
            const c = kcolor(d.t, d.rev === 0);
            const barL = d.t >= 0 ? zeroP : pos(d.t);
            const barW = Math.max(0.6, Math.abs(pos(d.t) - zeroP));
            const tr = d.prevT != null ? d.t - d.prevT : null;     // xu hướng vs tháng trước
            const trUp = tr != null && tr > 0.005, trDn = tr != null && tr < -0.005;
            return (
              <div key={d.name} onMouseMove={(e) => setHover({ i, x: e.clientX, y: e.clientY })}
                style={{ display: "grid", gridTemplateColumns: "var(--lw) minmax(0,1fr) var(--rw)", alignItems: "center", height: rowH, borderRadius: 7, background: hover?.i === i ? "#eef2f7" : "transparent", transition: "background .15s" }}>
                {/* rank + tên */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, paddingRight: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: KDA_FAINT, width: 20, textAlign: "right", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{i + 1}</span>
                  <span title={d.name} style={{ fontSize: 12.5, fontWeight: 600, color: KDA_INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.name}</span>
                </div>
                {/* track thanh */}
                <div style={{ position: "relative", height: rowH }}>
                  <div style={{ position: "absolute", top: "50%", transform: "translateY(-50%)", left: `${barL}%`, width: `${barW}%`, height: 15, background: c, borderRadius: d.t >= 0 ? "3px 4px 4px 3px" : "4px 3px 3px 4px", minWidth: 3, transition: "width .2s ease, left .2s ease" }} />
                </div>
                {/* giá trị + mũi tên + CHÊNH SO THÁNG TRƯỚC (chênh vs KPI bỏ đi: mốc KPI = 1, nhìn số
                    là tự trừ ra ngay; số so tháng trước mới là thứ không nhẩm được) */}
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 6, paddingLeft: 8 }}>
                  <span title={tr != null ? `So tháng trước: ${kdelta(tr)}` : "Chưa có tháng trước để so"}
                        style={{ fontSize: 10, fontWeight: 800, width: 10, textAlign: "center", flexShrink: 0, color: trUp ? KDA_TEAL : trDn ? KDA_RED : KDA_FAINT }}>
                    {trUp ? "▲" : trDn ? "▼" : "–"}
                  </span>
                  <span style={{ fontSize: 15.5, fontWeight: 750, color: d.t < 0 ? KDA_RED : KDA_INK, fontVariantNumeric: "tabular-nums", letterSpacing: "-.01em" }}>{kfmt(d.t)}</span>
                  {tr == null
                    ? <span style={{ fontSize: 10, fontWeight: 600, color: KDA_FAINT, width: 62, textAlign: "right", flexShrink: 0, whiteSpace: "nowrap" }}>chưa có T trước</span>
                    : <span title={`So tháng ${monthIdx}: ${kdelta(tr)}`} style={{ fontSize: 11, fontWeight: 700, color: trUp ? KDA_TEAL : trDn ? KDA_RED : KDA_FAINT, fontVariantNumeric: "tabular-nums", width: 62, textAlign: "right", flexShrink: 0, whiteSpace: "nowrap" }}>{kdelta(tr)}</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* CHÚ THÍCH */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${KDA_LINE}`, fontSize: 11, color: KDA_SOFT, flexWrap: "wrap" }}>
          <Legend c={KDA_TEAL} t="Đạt/vượt KPI (từ 1)" />
          <Legend c={KDA_ORANGE} t="0,7 – dưới 1" />
          <Legend c={KDA_RED} t="Dưới 0,7" />
          {noRev > 0 && <Legend c={KDA_GRAY} t="Chưa có doanh thu" />}
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, borderTop: "2px dashed #94a3b8" }} />Mốc KPI</span>
        </div>
      </div>

      {/* TOOLTIP */}
      {hover && data[hover.i] && (() => {
        const d = data[hover.i]; const gap = d.t - kpi; const tr = d.prevT != null ? d.t - d.prevT : null;
        return (
          <div style={{ position: "fixed", left: hover.x + 14, top: hover.y + 14, zIndex: 300, pointerEvents: "none", background: "#0f172a", color: "#fff", borderRadius: 9, padding: "9px 12px", fontSize: 12, boxShadow: "0 10px 30px rgba(2,6,23,.4)", minWidth: 172 }}>
            <div style={{ fontWeight: 700, marginBottom: 5, whiteSpace: "nowrap" }}>{d.name}</div>
            <Trow k="Năng suất" v={`${kfmt(d.t)} tỷ/người`} />
            <Trow k="Doanh thu" v={`${bilf(d.rev)} tỷ`} />
            <Trow k="Số người" v={`${d.ns}`} />
            <Trow k="vs KPI" v={kdelta(gap)} vc={gap >= 0 ? "#5eead4" : "#fca5a5"} />
            <Trow k="vs tháng trước" v={tr != null ? kdelta(tr) : "—"} vc={tr == null ? "#94a3b8" : tr >= 0 ? "#5eead4" : "#fca5a5"} />
            <Trow k="Hạng" v={`#${hover.i + 1} / ${n}`} />
          </div>
        );
      })()}
    </div>
  );
}
function Legend({ c, t }: { c: string; t: string }) {
  return <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: c }} />{t}</span>;
}
function Trow({ k, v, vc }: { k: string; v: string; vc?: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: 18, lineHeight: 1.7 }}><span style={{ color: "#94a3b8" }}>{k}</span><span style={{ fontWeight: 700, color: vc || "#fff", fontVariantNumeric: "tabular-nums" }}>{v}</span></div>;
}

// ══════════════ DOANH THU ĐẦU NGƯỜI KHỐI DỰ ÁN — form nền đen (slide 2 deck PMO) ══════════════
// CHỈ hiển thị số ĐÚC KẾT TỪ FILE import — KHÔNG bịa số ngoài file:
//   · Cột từng tháng (cyan) = Σ doanh thu ÷ Σ nhân sự mỗi tháng (gộp cấp Khối).
//   · Lũy kế = Σ doanh thu mọi tháng · Tổng nhân sự = Σ nhân sự tháng mới nhất.
// Cột 2025/2026 và panel "Cần" của slide sếp KHÔNG có trong file → không dựng (tránh bịa nội dung).
const RPC_CYAN = "#7BC5E8", RPC_GREEN = "#22A64C", RPC_RED = "#E01B1B";
const RPC_GRID = "rgba(255,255,255,.30)", RPC_WHITE = "#ffffff";
const dec1 = (v: number): string => v.toFixed(1);        // nhãn trục Y (bước 0,2)
const dec2 = (v: number): string => v.toFixed(2);        // nhãn giá trị trên cột (2 chữ số thập phân)
/** TB DOANH THU ĐẦU NGƯỜI NĂM 2025 (tỷ/người) — SỐ LỊCH SỬ, ĐÃ CHỐT, KHÔNG đổi theo file tuần nên cắm
 *  cứng ở đây (file tuần chỉ có các tháng năm nay). Vẽ thành cột XANH LÁ ngoài cùng bên trái, đúng bản
 *  sếp duyệt. Sang năm đổi mốc thì sửa đúng hằng số này. */
const PRIOR_YEAR_TY = 0.9;

/** KHUNG "VỪA THÌ HIỆN ĐỦ, KHÔNG VỪA THÌ CUỘN NGANG" — thay vì ép chart bé tí cho lọt màn điện thoại
 *  (chữ nhỏ không đọc nổi). Máy tính rộng hơn `min` → không có thanh cuộn, hiện full như cũ. */
function FitOrScroll({ min, children }: { min: number; children: React.ReactNode }) {
  return (
    <div style={{ width: "100%", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ minWidth: min }}>{children}</div>
    </div>
  );
}

/** Chart form "Sản lượng đầu người khối dự án": nền đen — cột cyan từng tháng (từ file) + cột đỏ TB năm nay.
 *  priorYearVnd (TB năm cũ, cột xanh) chỉ vẽ khi có nguồn — file perf hiện chỉ có các tháng năm nay nên = null. */
function RevPerCapChart({ perCapVnd, priorYearVnd }: { perCapVnd: (number | null)[]; priorYearVnd?: number | null }) {
  // LUÔN hiện đủ 12 tháng (01–12/26); tháng chưa có số → null (vẽ dấu "-").
  const monthsTy = Array.from({ length: 12 }, (_, m) => { const v = perCapVnd[m]; return v != null && isFinite(v) ? v / 1e9 : null; });
  const mVals = monthsTy.filter((v): v is number => v != null && isFinite(v));
  const curAvg = mVals.length ? mVals.reduce((a, b) => a + b, 0) / mVals.length : null;   // TB năm nay = TB các tháng
  const priorAvg = priorYearVnd != null && isFinite(priorYearVnd) ? priorYearVnd / 1e9 : null;
  const slots: { label: string; v: number | null; color: string }[] = [
    ...(priorAvg != null ? [{ label: "2025", v: priorAvg, color: RPC_GREEN }] : []),
    ...monthsTy.map((v, m) => ({ label: `${String(m + 1).padStart(2, "0")}/26`, v, color: RPC_CYAN })),
    ...(curAvg != null ? [{ label: "2026", v: curAvg, color: RPC_RED }] : []),
  ];
  const vals = slots.map((s) => s.v).filter((v): v is number => v != null && isFinite(v));
  const maxV = vals.length ? Math.max(...vals) : 0;
  // TRẦN 1,2 tỷ: để cột cao nhất (0,98) không chạm nóc, các cột nhìn cân nhau hơn. Vượt 1,2 thì mới
  // nới tiếp theo nấc 0,2 (chart tự lo khi có tháng đột biến), luôn chừa 1 nấc trống cho nhãn số.
  let yMax = Math.max(1.2, Math.ceil(Math.max(0.4, maxV) / 0.2 - 1e-9) * 0.2);
  if (yMax <= maxV + 1e-9) yMax += 0.2;
  const ticks: number[] = []; for (let t = 0; t <= yMax + 1e-9; t += 0.2) ticks.push(+t.toFixed(1));

  const W = 1040, H = 560, mL = 84, mR = 22, mT = 66, mB = 66;
  const iw = W - mL - mR, ih = H - mT - mB;
  const yOf = (v: number) => mT + ih * (1 - v / yMax);
  const y0 = yOf(0);
  // Cột MẢNH như bản sếp duyệt (trước 46px/0.52 nhìn to bè). Đừng nới lại.
  const n = Math.max(1, slots.length), slotW = iw / n, barW = Math.min(30, slotW * 0.34);

  return (
    <div style={{ fontFamily: SANS, background: "#fff", border: `1px solid ${KDA_LINE}`, borderRadius: 14, padding: "18px 20px 20px", color: KDA_INK }}>
      {/* Tiêu đề + 2 dòng số tính từ file */}
      <div style={{ fontSize: 25, fontWeight: 800, letterSpacing: "-.01em", color: "#111827" }}>Sản lượng đầu người khối dự án</div>

      {/* Biểu đồ nền đen */}
      <div style={{ background: "#000", borderRadius: 10, padding: 8, marginTop: 14 }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block", fontFamily: SANS }}>
          <text x={W / 2} y={37} textAnchor="middle" fontSize={30} fontWeight={800} fill={RPC_WHITE} letterSpacing="1">SẢN LƯỢNG ĐẦU NGƯỜI KHỐI DỰ ÁN</text>
          {/* ĐƯỜNG KẺ NGANG ở MỌI MỐC để dò giá trị (sếp yêu cầu) — màu TRẮNG, mảnh; cộng 2 vạch TRỤC
              đậm hơn: dọc bên trái + ngang ở mốc 0. Đừng bỏ mấy đường ngang này. */}
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={mL} y1={yOf(t)} x2={W - mR} y2={yOf(t)} stroke={RPC_WHITE} strokeWidth={t === 0 ? 1.6 : 0.9} />
              <text x={mL - 12} y={yOf(t) + 6} textAnchor="end" fontSize={22} fontWeight={600} fill={RPC_WHITE}>{t === 0 ? "-" : dec1(t)}</text>
            </g>
          ))}
          <line x1={mL} y1={mT - 6} x2={mL} y2={y0} stroke={RPC_WHITE} strokeWidth={1.6} />
          <text transform={`translate(20 ${mT + ih / 2}) rotate(-90)`} textAnchor="middle" fontSize={18} fontWeight={700} fill={RPC_WHITE}>Sản lượng (tỷ đồng)</text>
          {/* Cột từng tháng + nhãn giá trị */}
          {slots.map((s, i) => {
            const cx = mL + slotW * i + slotW / 2;
            if (s.v == null || !isFinite(s.v)) {
              return <text key={i} x={cx} y={y0 - 8} textAnchor="middle" fontSize={24} fontWeight={700} fill={RPC_WHITE}>-</text>;
            }
            const top = yOf(Math.max(0, s.v)), h = Math.max(1, y0 - top);
            return (
              <g key={i}>
                {/* VIỀN TRẮNG quanh cột — tách cột khỏi nền đen, cột nào cũng thấy rõ mép. */}
                <rect x={cx - barW / 2} y={top} width={barW} height={h} fill={s.color} stroke={RPC_WHITE} strokeWidth={1.2} shapeRendering="crispEdges" />
                <text x={cx} y={top - 10} textAnchor="middle" fontSize={25} fontWeight={800} fill={RPC_WHITE}>{dec2(s.v)}</text>
              </g>
            );
          })}
          {/* Nhãn trục X */}
          {slots.map((s, i) => (
            <text key={i} x={mL + slotW * i + slotW / 2} y={H - mB + 22} textAnchor="middle" fontSize={18} fontWeight={700} fill={RPC_WHITE}>{s.label}</text>
          ))}
          <text x={mL + iw / 2} y={H - 10} textAnchor="middle" fontSize={18} fontWeight={700} fill={RPC_WHITE}>Tháng</text>
        </svg>
      </div>

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${KDA_LINE}`, fontSize: 13, color: KDA_SOFT, display: "flex", gap: 16, flexWrap: "wrap" }}>
        {priorAvg != null && <Legend c={RPC_GREEN} t="2025 — TB năm cũ" />}
        <Legend c={RPC_CYAN} t="Từng tháng = Sản lượng KDA ÷ Tổng nhân sự (đúng bảng SLTB trong file)" />
        {curAvg != null && <Legend c={RPC_RED} t="2026 — TB năm nay (TB các tháng)" />}
      </div>
    </div>
  );
}

/* ══════════ CHI TIẾT TỪNG DỰ ÁN — sản lượng & nhân sự theo tháng ══════════
 *
 * Ba tab kia đều chiếu TỈ SỐ (doanh thu / nhân sự). Nhìn thấy "3,1 tỷ/người" nhưng không biết đó là
 * 31 tỷ chia 10 người hay 6 tỷ chia 2 người — hai chuyện khác hẳn nhau khi ngồi họp. Tab này bày
 * thẳng HAI SỐ GỐC của mỗi ô: sản lượng và số người.
 *
 * SỐ Ở ĐÂY LÀ SỐ CỦA FILE, không qua xử lý. Tab "Hiệu suất theo tháng" có luật dồn tháng âm về trước
 * (absorbNegBack) cho đường xu hướng khỏi gãy; tab này KHÔNG áp, vì đây đúng là chỗ người ta vào để
 * đối chiếu với file nguồn. Tháng âm hiện đúng là âm, tô đỏ.
 *
 * Bày ĐỦ mọi dự án trong file, kể cả dự án tra không ra vùng. Lưới xu hướng được phép giấu dự án đã
 * rời ePMP vì nó là bảng chiếu; bảng chi tiết mà giấu dòng thì người đọc cộng lại không khớp dòng
 * tổng, rồi mất lòng tin vào cả bảng.
 */
function BangChiTiet({ projs, block, nm, regionMap }: {
  projs: Proj[]; block: { rev: number[]; ns: number[] } | null; nm: number; regionMap: Record<string, string>;
}) {
  /** Tỷ đồng, 1 chữ số thập phân, dấu phẩy kiểu Việt. */
  const ty = (v: number | undefined): string =>
    v == null || v === 0 ? "" : (v / 1e9).toLocaleString("vi-VN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const rows = useMemo(() => {
    const vungCua = (p: Proj) => vungVN(lookupRegion(regionMap, p.name) || PERF_REGION[keyName(p.name)] || "");
    const co = projs.filter((p) => !PERF_EXCLUDE.test(keyName(p.name))).map((p) => ({ ...p, vung: vungCua(p) }));
    // Xếp theo VÙNG (Phú Quốc → Bắc → Trung → Nam → Nước ngoài) y như lưới xu hướng; trong vùng thì
    // theo thứ tự PERF_SHOW chủ nhà đã chốt, dự án không có trong đó rơi xuống cuối vùng.
    const uuTien = (p: Proj) => { const i = SHOW_KEYS.indexOf(keyName(p.name)); return i < 0 ? 9999 : i; };
    return co.sort((a, b) => vungRank(a.vung) - vungRank(b.vung) || uuTien(a) - uuTien(b) || a.name.localeCompare(b.name, "vi", { numeric: true }));
  }, [projs, regionMap]);

  /** Cộng dồn cả năm của một dự án — để người xem khỏi tự cộng 9 ô. */
  const tongDt = (p: Proj) => p.rev.slice(0, nm).reduce((s, v) => s + (v || 0), 0);
  /** Nhân sự KHÔNG cộng dồn được (một người có mặt nhiều tháng) → lấy tháng cuối có số. */
  const nsCuoi = (p: Proj) => { for (let m = nm - 1; m >= 0; m--) if (p.ns[m] > 0) return p.ns[m]; return 0; };

  const thMonth: React.CSSProperties = { padding: "6px 8px", textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" };
  const tdNum: React.CSSProperties = { padding: "5px 8px", textAlign: "right", whiteSpace: "nowrap", borderTop: "1px solid #f1f5f9" };
  // Cột tên DÍNH TRÁI: bảng rộng hơn màn hình là chuyện chắc chắn (9 tháng + 2 cột tổng), cuộn ngang
  // mà mất tên dự án thì không còn đọc được dòng nào.
  const stickyName: React.CSSProperties = {
    position: "sticky", left: 0, zIndex: 2, background: "#fff",
    padding: "5px 10px", textAlign: "left", whiteSpace: "nowrap",
    borderTop: "1px solid #f1f5f9", borderRight: "1px solid #e2e8f0",
  };

  let vungTruoc = "";
  return (
    <div style={{ width: "100%", overflowX: "auto", WebkitOverflowScrolling: "touch", background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 12, width: "100%", minWidth: 760 }}>
        <thead>
          <tr style={{ background: "#f8fafc", color: "#334155" }}>
            <th style={{ ...stickyName, background: "#f8fafc", zIndex: 3, fontWeight: 700, borderTop: "none" }}>
              Dự án
              <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 500, color: "#94a3b8" }}>trên: sản lượng (tỷ) · dưới: nhân sự</span>
            </th>
            {Array.from({ length: nm }, (_, m) => <th key={m} style={thMonth}>T{m + 1}</th>)}
            <th style={{ ...thMonth, borderLeft: "1px solid #e2e8f0" }}>Cả năm</th>
            <th style={thMonth}>NS nay</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const moiVung = p.vung !== vungTruoc; vungTruoc = p.vung;
            const vien = moiVung ? "2px solid #cbd5e1" : "1px solid #f1f5f9";
            return (
              <tr key={`${p.no}-${p.name}`}>
                {/* Vạch màu bên trái = vùng, trùng mã màu với viền thẻ ở tab xu hướng. */}
                <td style={{ ...stickyName, borderLeft: `4px solid ${vungColor(p.vung)}`, fontWeight: 600, color: "#0f172a", borderTop: vien }}>
                  {tenHien(p.name)}
                  {p.vung !== "—" && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 500, color: "#94a3b8" }}>{p.vung}</span>}
                </td>
                {Array.from({ length: nm }, (_, m) => {
                  const dt = p.rev[m] ?? 0, ns = p.ns[m] ?? 0;
                  return (
                    <td key={m} style={{ ...tdNum, borderTop: vien }}>
                      <div style={{ fontWeight: 700, color: dt < 0 ? "#dc2626" : dt === 0 ? "#cbd5e1" : "#0f172a" }}>{dt === 0 ? "–" : ty(dt)}</div>
                      <div style={{ fontSize: 10.5, color: ns === 0 ? "#cbd5e1" : "#64748b" }}>{ns === 0 ? "–" : ns}</div>
                    </td>
                  );
                })}
                <td style={{ ...tdNum, borderTop: vien, borderLeft: "1px solid #e2e8f0", fontWeight: 700, color: tongDt(p) < 0 ? "#dc2626" : "#0f172a" }}>{ty(tongDt(p)) || "–"}</td>
                <td style={{ ...tdNum, borderTop: vien, color: "#334155" }}>{nsCuoi(p) || "–"}</td>
              </tr>
            );
          })}
          {/* TOÀN KHỐI đọc thẳng dòng tổng của file, KHÔNG cộng lại từ các dòng trên: file còn các
              nhóm ngoài dự án (OEM, xuất lẻ…) nên cộng tay sẽ ra số khác số báo cáo tuần. */}
          {block && (
            <tr style={{ background: "#0f172a", color: "#fff" }}>
              <td style={{ ...stickyName, background: "#0f172a", color: "#fff", fontWeight: 700, borderTop: "2px solid #0f172a", borderRight: "1px solid #334155" }}>TOÀN KHỐI</td>
              {Array.from({ length: nm }, (_, m) => (
                <td key={m} style={{ ...tdNum, borderTop: "2px solid #0f172a" }}>
                  <div style={{ fontWeight: 700 }}>{ty(block.rev[m]) || "–"}</div>
                  <div style={{ fontSize: 10.5, color: "#94a3b8" }}>{block.ns[m] || "–"}</div>
                </td>
              ))}
              <td style={{ ...tdNum, borderTop: "2px solid #0f172a", borderLeft: "1px solid #334155", fontWeight: 700 }}>
                {ty(block.rev.slice(0, nm).reduce((s, v) => s + (v || 0), 0)) || "–"}
              </td>
              <td style={{ ...tdNum, borderTop: "2px solid #0f172a", color: "#cbd5e1" }}>{block.ns[nm - 1] || "–"}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────── APP ──
export function PerfChartApp() {
  const narrow = useIsNarrow();        // điện thoại/tablet → đổi bố cục (xem use-breakpoint.ts)
  const [projs, setProjs] = useState<Proj[]>([]);
  /** TOÀN KHỐI đọc thẳng từ khối A sheet "SLTB (kết quả)" — số CHUẨN của báo cáo tuần. */
  const [block, setBlock] = useState<{ rev: number[]; ns: number[] } | null>(null);
  const [view, setView] = useState<"trend" | "rank" | "percap" | "chitiet">("trend");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [full, setFull] = useState(false);
  const [srcOpen, setSrcOpen] = useState(false);
  const [rankMonth, setRankMonth] = useState<number | null>(null);   // tháng cho KDA (null = mới nhất)
  const wrapRef = useRef<HTMLDivElement>(null);

  // Quyền: chỉ ADMIN/PMO thấy nút nguồn dữ liệu (nạp/link/template). devAs = giả lập ?as= khi dev.
  const devAs = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("as") : null;
  const meQ = useQuery({ queryKey: ["perf-whoami", devAs], queryFn: () => whoami({ data: { devAs } }) });
  const rolesQ = useQuery({ queryKey: ["perf-roles"], queryFn: () => fetchUserRoles(), staleTime: 5 * 60 * 1000 });
  // VÙNG lấy từ ePMP (file PMP có cột Location; file Pivot của app này thì không) — xem saveProjRegions.
  // HAI NGUỒN, ghép lại cho chắc:
  //  · danh sách popup lắp đặt (mtld:install:list) — có sẵn từ lâu, mỗi dòng kèm region + groupDA;
  //  · map proj:regions ePMP đẩy lên — phủ rộng hơn (mọi dự án, kể cả chưa gắn ma trận) nên ĐÈ LÊN.
  // Nhờ vậy mở app lần đầu sau khi lên bản mới vẫn có vùng ngay, khỏi chờ ai đó ghé qua ePMP.
  const regionQ = useQuery({ queryKey: ["proj-regions"], queryFn: () => getProjRegions(), staleTime: 10 * 60 * 1000 });
  const installQ = useQuery({ queryKey: ["mtld-install-list"], queryFn: () => getInstallList(), staleTime: 10 * 60 * 1000 });
  const regionMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const it of installQ.data?.list ?? []) {
      const r = (it.region ?? "").trim();
      if (!r) continue;
      const n = normProjName(it.name ?? ""), g = normProjName(it.groupDA ?? "");
      if (n && !m[n]) m[n] = r;
      if (g && !m[g]) m[g] = r;
    }
    Object.assign(m, regionQ.data?.map ?? {});
    return m;
  }, [installQ.data, regionQ.data]);
  /** Vùng đã tra xong chưa — chờ rồi mới vẽ lưới, khỏi hiện thứ tự cũ rồi nhảy sang thứ tự vùng. */
  const regionReady = !regionQ.isPending && !installQ.isPending;
  const canManage = !!(meQ.data?.isAdmin || (meQ.data?.email && roleOf(rolesQ.data?.roles ?? {}, meQ.data.email) === "PMO"));

  useEffect(() => {
    let off = false;
    getPerfData().then((r) => {
      if (off || !r.data) return;
      setProjs(r.data.projects);
      setBlock(r.data.block ?? null);   // số TOÀN KHỐI của báo cáo (nếu bản lưu có)
      setStatus(`Bản lưu: ${r.data.src || "—"} · ${new Date(r.data.at).toLocaleString("vi-VN")} · bởi ${(r.data.by || "?").split("@")[0]}`);
    }).catch(() => { /* chưa có bản lưu */ });
    return () => { off = true; };
  }, []);

  const nm = nmOf(projs);
  // THÁNG MỚI NHẤT = tháng CUỐI CÙNG có DOANH THU (tự nhảy khi update file có thêm tháng); nếu chưa
  // có doanh thu ở đâu thì lấy tháng cuối có nhân sự. KHÔNG hardcode.
  const latestIdx = useMemo(() => latestMonth(projs, nm), [projs, nm]);
  // Tháng đang xem cho KDA — mặc định tháng mới nhất; người dùng chọn được ở bộ lọc góc phải.
  const rm = rankMonth != null && rankMonth < nm ? rankMonth : latestIdx;
  /* XU HƯỚNG (lưới mini): DANH SÁCH VÀ THỨ TỰ LẤY TỪ CỘT "THỨ TỰ HIỆN" TRONG FILE NGUỒN.
     Anh Tiến chốt 07/10/2026: gõ 1, 2, 3… vào dòng nào thì dự án đó lên lưới theo đúng số đó, để
     trống là không hiện — khỏi phải nhờ sửa code mỗi lần đổi dự án.

     KHÔNG AI GÕ SỐ NÀO thì lùi về PERF_SHOW như cũ. Cần đường lùi này vì file hiện tại chưa có cột
     đó: không có nó thì ngay lượt nạp đầu tiên lưới trắng bong, mà lưới trắng còn tệ hơn danh sách
     cũ. Hễ có DÙ CHỈ MỘT dòng được gõ số là chuyển hẳn sang cột đó — nửa nọ nửa kia thì không ai
     lần ra được vì sao một dự án hiện hay không hiện. */
  const ordered = useMemo<ProjV[]>(() => {
    const list = chonHien(projs).filter((p) => !PERF_EXCLUDE.test(keyName(p.name)))
      // Nguyên tắc loại trừ tháng âm — CHỈ ở tab này (xem absorbNegBack). Hai tab kia đọc thẳng
      // projs nên vẫn giữ nguyên số của file.
      .map((p) => ({ ...p, rev: absorbNegBack(p.rev), vung: vungVN(lookupRegion(regionMap, p.name) || PERF_REGION[keyName(p.name)] || "") }));
    // DỰ ÁN ĐÃ RỜI ePMP THÌ MANG RA KHỎI LƯỚI — quy ước vận hành của chủ nhà: chỗ đó để dành cho dự án
    // mới. Không tra được vùng nghĩa là ePMP không còn dòng nào của dự án đó.
    // CHỐT AN TOÀN: chỉ lọc khi bảng vùng còn LÀNH (≥60% số dự án tra ra vùng). Nếu KV vùng rỗng hay
    // hỏng mà vẫn lọc thì cả lưới trắng bong — mất hẳn màn hình còn tệ hơn thừa vài dự án cũ.
    const nOk = list.filter((p) => p.vung !== "—").length;
    const healthy = list.length > 0 && nOk >= Math.ceil(list.length * 0.6);
    const live = healthy ? list.filter((p) => p.vung !== "—") : list;
    // GOM CỤM THEO VÙNG: Phú Quốc → Bắc → Trung → Nam → Nước Ngoài (thứ tự của lib/vung.ts, giống
    // báo cáo tuân thủ). Trong cùng vùng thì GIỮ NGUYÊN thứ tự PERF_SHOW chủ nhà đã chốt.
    return live.map((p, i) => [p, i] as const)
      .sort((a, b) => vungRank(a[0].vung) - vungRank(b[0].vung) || a[1] - b[1])
      .map(([p]) => p);
  }, [projs, regionMap]);
  /** Các vùng ĐANG có trên lưới, đúng thứ tự — để vẽ dải chú giải màu viền. */
  const vungShown = useMemo(() => {
    const seen = new Set(ordered.map((p) => p.vung));
    return [...VUNG_ORDER, ...[...seen].filter((v) => !(VUNG_ORDER as readonly string[]).includes(v))]
      .filter((v) => seen.has(v));
  }, [ordered]);
  // XẾP HẠNG (1 chart): THUẦN giá trị CAO → THẤP (số âm xuống cuối cùng); bằng nhau → tên tự nhiên.
  /** Tên các dự án CÒN SỐNG trên lưới xu hướng (đã bỏ dự án rời ePMP) — tab xếp hạng dùng chung
   *  đúng danh sách này để hai tab không lệch nhau: chỗ thì 18 dự án, chỗ thì 20. */
  const liveKeys = useMemo(() => new Set(ordered.map((p) => keyName(p.name))), [ordered]);
  const rankRows = useMemo(() => projs
    .filter((p) => liveKeys.has(keyName(p.name)))           // đúng danh sách dự án đang hiện
    .map((p) => ({ name: tenHien(p.name), v: perfOf(p, rm), rev: p.rev[rm] ?? 0, ns: p.ns[rm] ?? 0, prev: rm > 0 ? perfOf(p, rm - 1) : null }))
    .filter((r) => r.v != null)
    .sort((a, b) => (b.v as number) - (a.v as number) || a.name.localeCompare(b.name, "vi", { numeric: true })) as RankRow[],
    [projs, rm, liveKeys]);
  // DOANH THU ĐẦU NGƯỜI cấp KHỐI theo tháng (VND/người).
  //  • CÓ khối A của sheet "SLTB (kết quả)" → LẤY THẲNG số của báo cáo. Bắt buộc, vì doanh thu KDA đã
  //    trừ OEM + Loose Export; tự cộng lại từ các nhóm sẽ RA SỐ KHÁC báo cáo (đúng lỗi đang thấy).
  //  • Không có → mới lùi về Σ doanh thu ÷ Σ nhân sự như cũ.
  const blockPerCap = useMemo(() => {
    if (block && block.ns.some((v) => v > 0)) {
      const n = Math.max(block.rev.length, block.ns.length);
      return Array.from({ length: n }, (_, m) => (block.ns[m] > 0 ? block.rev[m] / block.ns[m] : null));
    }
    const rev = Array(nm).fill(0), ns = Array(nm).fill(0);
    projs.forEach((p) => { for (let m = 0; m < nm; m++) { rev[m] += p.rev[m] || 0; ns[m] += p.ns[m] || 0; } });
    return Array.from({ length: nm }, (_, m) => (ns[m] > 0 ? rev[m] / ns[m] : null));
  }, [projs, nm, block]);

  const rowsN = Math.max(1, Math.ceil(ordered.length / COLS));
  const gridItems = useMemo(() => {
    const arr: (ProjV | null)[] = Array(rowsN * COLS).fill(null);
    ordered.forEach((p, k) => { const col = Math.floor(k / rowsN), row = k % rowsN; arr[row * COLS + col] = p; });
    return arr;
  }, [ordered, rowsN]);

  /** Nguồn đang dùng: link Google Sheet hay file trên Drive — cho nút mở lại file nguồn. */
  const [nguon, setNguon] = useState<{ kieu: "link" | "file" | null; url?: string; ten?: string }>({ kieu: null });
  const doNguon = useCallback(() => {
    linkFileNguonHieuSuat().then(setNguon).catch(() => setNguon({ kieu: null }));
  }, []);
  useEffect(doNguon, [doNguon]);

  async function apply(list: Proj[], src: string, blk?: { rev: number[]; ns: number[] } | null, duong?: { srcUrl?: string; srcPath?: string }) {
    setProjs(list);
    setBlock(blk ?? null);
    const lnm = nmOf(list); const lm = latestMonth(list, lnm);
    try {
      await savePerfData({ data: { projects: list, block: blk ?? undefined, src, ...duong, devAs: devAsPerf() } });
      setStatus(`Đã nạp & LƯU ${list.length} dự án · ${lnm} tháng · mới nhất tháng ${lm + 1} (giữ đến khi cập nhật file mới)`);
    } catch {
      setStatus(`Đã nạp ${list.length} dự án · ${lnm} tháng — nhưng CHƯA lưu (chỉ PMO/admin mới lưu được)`);
    }
  }
  async function loadWorkbook(buf: ArrayBuffer, src: string, duong?: { srcUrl?: string; srcPath?: string }) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
    const flex = parseFlexible(wb, XLSX);
    const list = flex && flex.projects.length ? flex.projects : parsePositional(wb);
    const blk = parseBlockTotals(wb, XLSX);   // khối A "SLTB (kết quả)" (nếu file có)
    if (!list.length) throw new Error('Không nhận dạng được dữ liệu. Cần các cột: Tên dự án · Doanh thu theo tháng · Nhân sự theo tháng. Tải template để làm mẫu.');
    await apply(list, src, blk, duong);
    doNguon();
    // Nhật ký giám sát: nạp file tuần là thay số cho CẢ KHỐI — phải biết ai nạp, file nào.
    track("perf_import", `${src} — ${list.length} nhóm dự án`);
  }
  /** LƯU TRỮ file nguồn tuần lên Drive (Hiệu suất dự án › Nguồn tuần › <năm> › <ngày>_<tên file>).
   *  App KHÔNG giữ byte — client PUT thẳng lên Google. Lỗi/không có quyền → BỎ QUA, không chặn việc nạp. */
  /** Trả ĐƯỜNG DẪN trên Drive để bên gọi lưu kèm bản dữ liệu — nhờ đó sau này mở lại được file
   *  nguồn. Không có quyền / Drive lỗi → trả rỗng, việc nạp số vẫn chạy bình thường. */
  async function archiveSource(f: File): Promise<string> {
    try {
      const { uploadUrl, path } = await startPerfSourceUpload({ data: { name: f.name, mime: f.type || "", devAs: devAsPerf() } });
      await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": f.type || "application/octet-stream" }, body: f });
      setStatus((v) => `${v} · đã lưu file nguồn: ${path}`);
      return path;
    } catch { return ""; }
  }
  async function onFile(f?: File | null) {
    if (!f) return; setBusy(true); setErr(null);
    try {
      /* TẢI LÊN DRIVE TRƯỚC, rồi mới nạp số — để lần lưu dữ liệu mang luôn đường dẫn file.
         Làm ngược lại thì phải lưu hai lần, và lần thứ hai dễ hụt (mất quyền, mạng rớt) nên
         bản lưu có số mà không có đường về file nguồn. */
      const buf = await f.arrayBuffer();
      const path = await archiveSource(f);
      await loadWorkbook(buf, f.name, path ? { srcPath: path } : undefined);
    } catch (e) { setErr(loiNoi(e)); }
    setBusy(false);
  }
  async function onLink() {
    const id = fileIdFromUrl(url.trim());
    if (!id) { setErr("Link không hợp lệ — dán URL Google Sheet (…/spreadsheets/d/…)."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await getSummaryFile({ data: { fileId: id, full: true } });
      const bin = atob(r.b64); const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await loadWorkbook(bytes.buffer, "Google Sheet", { srcUrl: url.trim() });
    } catch (e) { setErr(loiNoi(e) + " · Sheet cần chia sẻ “Anyone with the link”."); }
    setBusy(false);
  }
  /** TEMPLATE = ĐÚNG FORM file báo cáo tuần chủ nhà gửi (Pivot_DoanhThu_NhanSu_theo_Nhom):
   *    · sheet "Pivot"          — mỗi dòng 1 NHÓM DA, DT T1..T12 (TỶ) + NS T1..T12 (người)
   *    · sheet "SLTB (kết quả)" — khối A toàn khối: Sản lượng KDA (tỷ) / Tổng nhân sự / SLTB
   *  Giữ nguyên tên sheet + tên cột này thì tuần nào import cũng chạy thẳng, khỏi sửa app. */
  async function downloadTemplate() {
    const XLSX = await import("xlsx");
    const M = 12;   // ĐỦ 12 THÁNG sẵn cột — điền tháng nào có số, tháng chưa tới để trống/0.
    const T = Array.from({ length: M }, (_, i) => `T${i + 1}`);
    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Pivot (chi tiết theo NHÓM DA) ──
    const hdr = ["Nhóm DA", `Tổng DT (T1-${M}, tỷ đ)`, ...T.map((t) => `DT ${t}`), ...T.map((t) => `NS ${t}`)];
    const rowOf = (name: string, dt: number[], ns: number[]) =>
      [name, +dt.reduce((a, b) => a + b, 0).toFixed(2), ...dt, ...ns];
    const pivot: (string | number)[][] = [
      ["PIVOT DOANH THU & NHÂN SỰ THEO NHÓM DỰ ÁN"],
      ["Doanh thu: TỶ ĐỒNG (không phải VND). Nhân sự: người. Điền từ DÒNG 5. Tháng chưa tới để 0."],
      [],
      hdr,
      rowOf("NHÓM MẪU A", [0, 0, 1.45, 5.39, 15.35, 3.35, 18.03, 0, 0, 0, 0, 0], [12, 11, 11, 12, 14, 13, 12, 12, 12, 12, 12, 12]),
      rowOf("NHÓM MẪU B", [0, 0, 0, 7.70, 6.41, 4.32, 4.81, 0, 0, 0, 0, 0], [3, 3, 3, 3, 5, 5, 5, 5, 5, 5, 5, 5]),
    ];
    const wsP = XLSX.utils.aoa_to_sheet(pivot);
    wsP["!cols"] = [{ wch: 26 }, { wch: 18 }, ...Array(M * 2).fill({ wch: 9 })];
    XLSX.utils.book_append_sheet(wb, wsP, "Pivot");

    // ── Sheet 2: SLTB (kết quả) — khối A là thứ chart "Sản lượng đầu người" đọc ──
    const sltb: (string | number)[][] = [
      ["SẢN LƯỢNG ĐẦU NGƯỜI (SLTB) KHỐI DỰ ÁN"],
      ["SLTB = Doanh thu ÷ Số nhân sự. Doanh thu KDA = Tổng claim trình − OEM − Loose Export. Đơn vị: tỷ đồng/người."],
      [],
      ["A. TOÀN KHỐI DỰ ÁN (khớp báo cáo tổng)"],
      ["Chỉ tiêu", ...T],
      ["Sản lượng KDA (tỷ)", 184.9, 46.7, 246.2, 208.6, 194.7, 188.1, 186.7, 0, 0, 0, 0, 0],
      ["Tổng nhân sự", 240, 240, 250, 253, 258, 279, 297, 0, 0, 0, 0, 0],
      ["SLTB (tỷ/người)", 0.77, 0.19, 0.98, 0.82, 0.75, 0.67, 0.63, 0, 0, 0, 0, 0],
    ];
    const wsS = XLSX.utils.aoa_to_sheet(sltb);
    wsS["!cols"] = [{ wch: 24 }, ...Array(M).fill({ wch: 9 })];
    XLSX.utils.book_append_sheet(wb, wsS, "SLTB (kết quả)");

    XLSX.writeFile(wb, "Template_BaoCaoHieuSuat_Tuan.xlsx");
  }
  function toggleFull() {
    const el = wrapRef.current; if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().then(() => setFull(false));
    else void el.requestFullscreen?.().then(() => setFull(true)).catch(() => setFull(false));
  }

  return (
    <div ref={wrapRef} style={{ height: "100vh", width: "100%", display: "flex", flexDirection: "column", background: "#f1f5f9", fontFamily: "system-ui,sans-serif" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-4 py-2">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-800"><BarChart3 className="h-4 w-4 text-teal-700" /> Hiệu suất dự án</span>
        {projs.length > 0 && (
          // ĐIỆN THOẠI: 3 tab không đủ chỗ nằm ngang → cho CUỘN NGANG thay vì xuống dòng rồi bị cắt
          // chữ (h-7 cố định). `shrink-0 whitespace-nowrap` giữ mỗi nút nguyên chữ.
          <div className="flex h-7 max-w-full shrink-0 items-stretch overflow-x-auto rounded-md border border-slate-300 text-[11.5px] font-medium [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button type="button" onClick={() => setView("percap")} className={`flex shrink-0 items-center whitespace-nowrap px-3 ${view === "percap" ? "bg-teal-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Sản lượng đầu người</button>
            <button type="button" onClick={() => setView("trend")} className={`flex shrink-0 items-center whitespace-nowrap border-l border-slate-300 px-3 ${view === "trend" ? "bg-teal-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Hiệu suất theo tháng</button>
            <button type="button" onClick={() => setView("rank")} className={`flex shrink-0 items-center whitespace-nowrap border-l border-slate-300 px-3 ${view === "rank" ? "bg-teal-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Doanh thu đầu người theo dự án</button>
            <button type="button" onClick={() => setView("chitiet")} className={`flex shrink-0 items-center whitespace-nowrap border-l border-slate-300 px-3 ${view === "chitiet" ? "bg-teal-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Chi tiết dự án</button>
          </div>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {projs.length > 0 && view === "rank" && (
            <label className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 leading-none">
              <span className="text-[10px] font-semibold uppercase leading-none tracking-wide text-slate-400">Tháng</span>
              <select value={rm} onChange={(e) => setRankMonth(+e.target.value)}
                className="bg-transparent text-[11.5px] font-medium leading-none text-slate-700 focus:outline-none">
                {Array.from({ length: nm }, (_, i) => <option key={i} value={i}>Tháng {i + 1}</option>)}
              </select>
            </label>
          )}
          {projs.length > 0 && (
            <button aria-label={"Toàn màn hình (chiếu 16:9)"} type="button" onClick={toggleFull} title="Toàn màn hình (chiếu 16:9)"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-[11.5px] font-medium text-slate-600 hover:border-slate-400">
              {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}{full ? "Thu" : "Chiếu"}
            </button>
          )}
          {/* Nguồn dữ liệu — GỘP link/đọc/tải file/template vào 1 popover; CHỈ admin/PMO thấy (như DST). */}
          {canManage && (
            <span className="relative">
              <button type="button" onClick={() => setSrcOpen((o) => !o)} title="Nạp dữ liệu: link Google Sheet / file .xlsx / tải template"
                className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11.5px] font-medium ${srcOpen ? "border-teal-500 bg-teal-50 text-teal-800" : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"}`}>
                <Database className="h-3.5 w-3.5" /> Nguồn dữ liệu
              </button>
              {srcOpen && (
                <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, width: 340, zIndex: 50 }}
                  className="rounded-xl border border-slate-200 bg-white p-3.5 text-slate-800 shadow-2xl">
                  <div className="mb-2.5 flex items-center justify-between">
                    <strong className="text-[13px]">Nguồn dữ liệu hiệu suất</strong>
                    <button onClick={() => setSrcOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
                  </div>
                  <label className="mb-1 block text-[11px] font-semibold text-slate-500">Dán link Google Sheet</label>
                  <div className="mb-2.5 flex gap-1.5">
                    <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void onLink(); }}
                      placeholder="https://docs.google.com/spreadsheets/d/…"
                      className="min-w-0 flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-[12px] focus:border-teal-500 focus:outline-none" />
                    <button onClick={() => void onLink()} disabled={busy}
                      className="rounded-md bg-teal-700 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-teal-800 disabled:opacity-60">{busy ? "…" : "Đọc"}</button>
                  </div>
                  <div className="mb-2.5 grid grid-cols-2 gap-1.5">
                    <label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[12px] font-medium text-slate-700 hover:border-teal-400">
                      <Upload className="h-3.5 w-3.5" /> Tải file .xlsx
                      <input type="file" accept=".xlsx,.xls" className="hidden" disabled={busy} onChange={(e) => { void onFile(e.target.files?.[0]); e.currentTarget.value = ""; setSrcOpen(false); }} />
                    </label>
                    <button onClick={() => { void downloadTemplate(); track("perf_template"); }} title="Tải file mẫu đúng cấu trúc"
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[12px] font-medium text-slate-700 hover:border-teal-400">
                      <FileDown className="h-3.5 w-3.5" /> Tải template
                    </button>
                  </div>
                  <div className="text-[10.5px] leading-relaxed text-slate-400">Nạp xong hệ thống lưu lại — mọi người mở app thấy bản mới nhất. Cần cột: Tên dự án · Doanh thu tháng · Nhân sự tháng.</div>
                </div>
              )}
            </span>
          )}
          {/* MỞ LẠI FILE NGUỒN đang dùng. Link Google Sheet thì mở thẳng; file .xlsx thì mở bản
              đã lưu trên Drive. Không có đường về thì KHÔNG hiện nút — đừng bày nút bấm vào
              không ra gì. */}
          {nguon.kieu && nguon.url && (
            <a href={nguon.url} target="_blank" rel="noreferrer" title={nguon.ten || nguon.url}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-[11.5px] font-medium text-slate-600 hover:border-teal-400 hover:text-teal-700">
              {nguon.kieu === "link"
                ? <><ExternalLink className="h-3.5 w-3.5" /> Xem file nguồn</>
                : <><FileDown className="h-3.5 w-3.5" /> Tải file nguồn</>}
            </a>
          )}
          <span className="max-w-[240px] truncate text-[11px] text-slate-400">
            {busy ? "Đang tải…" : err ? <span className="text-red-600">{err}</span> : status}
          </span>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 12, fontFamily: SERIF }}>
        {projs.length === 0 ? (
          <div style={{ maxWidth: 660, margin: "8vh auto 0", textAlign: "center", color: "#475569", fontFamily: "system-ui,sans-serif" }}>
            <BarChart3 className="h-10 w-10" style={{ margin: "0 auto 10px", color: "#94a3b8" }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: "#334155", marginBottom: 6 }}>Chưa có dữ liệu hiệu suất</div>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              Dán <b>link Google Sheet</b> (chia sẻ “Anyone with the link”) hoặc <b>tải file .xlsx</b> — <b>tên file/sheet bất kỳ</b>.<br />
              Chưa có file đúng chuẩn? Bấm <b>Tải template</b> → điền theo mẫu → nạp lên là chạy.
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: "#64748b", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", textAlign: "left" }}>
              <b>App tự dò cột theo TIÊU ĐỀ</b> (không cần đúng vị trí): cần có <b>Tên dự án</b>, các cột <b>Doanh thu theo tháng</b> (VND) và <b>Nhân sự theo tháng</b>.
              Có cột <b>STT</b> thì chỉ dòng có số được lấy. Số tháng tuỳ file (2, 5, 7, 12…). Hiệu suất = DT/NS.
            </div>
          </div>
        ) : (
          view === "trend" ? (
            // XU HƯỚNG: ô mini có bề rộng TỐI THIỂU (đọc rõ số); nhiều dự án → tự cuộn (ngang khi hẹp,
            // dọc khi nhiều hàng) thay vì ép nhỏ tí. Chiều cao ô cố định để số luôn to.
            <div style={{ width: "100%" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#111827", marginBottom: 8, textAlign: "center" }}>HIỆU SUẤT THEO THÁNG · CÁC DỰ ÁN (tỷ đồng/người)</div>
              {/* CHÚ GIẢI VÙNG — nói rõ viền màu nào là vùng nào; vùng lấy từ ePMP nên khỏi khai tay. */}
              {vungShown.length > 1 && (
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 14, marginBottom: 10, fontSize: 11.5, color: "#475569" }}>
                  {vungShown.map((v) => (
                    <span key={v} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 16, height: 10, borderRadius: 3, border: `3px solid ${vungColor(v)}`, background: "#fff" }} />
                      {v === "—" ? "Chưa rõ vùng (dự án không còn trong file ePMP)" : v}
                    </span>
                  ))}
                </div>
              )}
              {/* ĐIỆN THOẠI: 1 CỘT — mỗi ô chiếm trọn bề ngang nên đọc thoải mái, cuộn DỌC như đọc danh
                  sách (thứ tự đúng PERF_SHOW). MÁY TÍNH: giữ nguyên lưới 5 cột xếp dọc-rồi-ngang. */}
              <div style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0,1fr)" : `repeat(${COLS}, minmax(300px, 1fr))`, gridAutoRows: "210px", gap: 10 }}>
                {!regionReady ? null : (narrow ? ordered : gridItems).map((p, i) => (
                  // VIỀN = VÙNG: liếc một cái là biết cụm nào, khỏi phải dò tên dự án. Ô trống (lưới
                  // xếp dọc-rồi-ngang có thể hụt cuối) giữ viền xám nhạt như cũ.
                  <div key={i} style={{
                    background: "#fff", borderRadius: 8, overflow: "hidden", minHeight: 0,
                    border: p ? `3px solid ${vungColor(p.vung)}` : "1px solid #e2e8f0",
                  }}>
                    {p && <MiniChart p={p} nm={nm} w={340} h={210} />}
                  </div>
                ))}
              </div>
            </div>
          ) : view === "rank" ? (
            <div style={{ width: "100%", maxWidth: 980, margin: "0 auto" }}>
              <FitOrScroll min={620}><BigChart rows={rankRows} monthIdx={rm} /></FitOrScroll>
            </div>
          ) : view === "chitiet" ? (
            <div style={{ width: "100%", maxWidth: 1400, margin: "0 auto" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#111827", marginBottom: 8, textAlign: "center" }}>SẢN LƯỢNG &amp; NHÂN SỰ TỪNG DỰ ÁN</div>
              <BangChiTiet projs={projs} block={block} nm={nm} regionMap={regionMap} />
            </div>
          ) : (
            <div style={{ width: "100%", maxWidth: 1120, margin: "0 auto" }}>
              {/* Chart nền đen vẽ 1040×560; ép vừa màn điện thoại thì số trên cột bé không đọc được →
                  giữ tỷ lệ, cho cuộn ngang. */}
              <FitOrScroll min={860}><RevPerCapChart perCapVnd={blockPerCap} priorYearVnd={PRIOR_YEAR_TY * 1e9} /></FitOrScroll>
            </div>
          )
        )}
      </div>
    </div>
  );
}

/** devAs cho app này (đọc ?as= ở URL, chỉ tác dụng DEV — giống toàn app). */
function devAsPerf(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("as");
}
