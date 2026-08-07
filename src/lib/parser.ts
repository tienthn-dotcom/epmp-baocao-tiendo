import * as XLSX from "xlsx";
import Papa from "papaparse";
import type { BlockArea, BlockChild, BlockHandover, CodeCount, DataQuality, DataQualityCheck, ItemRow, ProjectRow, ReportData, StageKey } from "./types";
import { getDaysOverdue } from "./overdue";

export const GUARD_PLANNED_MIN = 0.15; // raw decimal (15%)
export const OVERDUE_DAYS = 10;

/** Bố cục cột MẶC ĐỊNH (PMP v2.5): header hàng 6 (index 5).
 *  E=Show, F=ProjectName, G=CĐT, H=MaCT, L=Mã (rawCode), M=Mô tả,
 *  N=Người PT, O=Bắt đầu, P=Kết thúc, R=%dự kiến, S=%thực tế, T=Quá hạn, U=Vướng mắc */
// bdLabel/bdDone/bdTotal = khối breakdown "số mã / tổng mã" đứng NGAY SAU cột Vướng mắc (U):
//   U+1 = nhãn ("Mẫu:", "VT.CT:"…), U+2 = số mã làm, U+3 = "/", U+4 = tổng mã, U+5 = "=", U+6 = %.
const LEGACY_COL = { E: 4, F: 5, G: 6, H: 7, L: 11, M: 12, N: 13, O: 14, P: 15, R: 17, S: 18, T: 19, U: 20, bdLabel: 21, bdDone: 22, bdTotal: 24 };

export type ColMap = typeof LEGACY_COL & { headerIdx: number; detected: boolean };

/** DÒ CỘT ĐỘNG — để app "sống" qua các version PMP (v2.6 chèn thêm cột đầu bảng
 *  làm mọi cột dịch phải). Cách dò 2 tầng:
 *   1. Tìm dòng header: dòng đầu tiên (trong 15 dòng đầu) có ô đúng chữ "Show".
 *   2. Neo theo ô Show + offset chuẩn (bố cục tương đối các version giữ nguyên),
 *      rồi GHI ĐÈ bằng vị trí thật của từng tên cột nếu tìm thấy trên header
 *      ("Mã", "Mô tả", "Kết thúc", "% thực tế", "Vướng mắc"…).
 *  Không tìm được "Show" → dùng bố cục mặc định v2.5 (file cũ vẫn chạy y nguyên). */
export function detectColumns(rows: unknown[][]): ColMap {
  let headerIdx = -1;
  let showIdx = -1;
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const r = rows[i] ?? [];
    const idx = r.findIndex((c) => String(c ?? "").trim().toLowerCase() === "show");
    if (idx < 0) continue;
    // Phải là dòng HEADER thật: ngoài "Show" còn có tên cột khác — tránh dính
    // nhầm ô dữ liệu "Show" trên dòng dự án.
    const joined = r.map((c) => str(c)).join(" | ").toLowerCase();
    if (!/kết\s*thúc|bắt\s*đầu|mô\s*tả|%\s*thực\s*tế|vướng\s*mắc|^mã$|\|\s*mã\s*\|/.test(joined)) continue;
    headerIdx = i; showIdx = idx; break;
  }
  if (headerIdx < 0) return { ...LEGACY_COL, headerIdx: 5, detected: false };

  // Offset chuẩn tính từ cột Show (đúng cho cả v2.5 lẫn v2.6).
  const col: ColMap = {
    headerIdx,
    detected: true,
    E: showIdx,        // Show
    F: showIdx + 1,    // Tên dự án (header thường bỏ trống)
    G: showIdx + 2,    // CĐT
    H: showIdx + 3,    // MaCT
    L: showIdx + 7,    // Mã (rawCode)
    M: showIdx + 8,    // Mô tả
    N: showIdx + 9,    // Người phụ trách
    O: showIdx + 10,   // Bắt đầu
    P: showIdx + 11,   // Kết thúc
    R: showIdx + 13,   // % dự kiến (không dùng — tính động)
    S: showIdx + 14,   // % thực tế
    T: showIdx + 15,   // Quá hạn (không dùng — tính động)
    U: showIdx + 16,   // Vướng mắc / Cần xử lý
    bdLabel: showIdx + 17, // khối breakdown "số mã/tổng mã" ngay sau Vướng mắc
    bdDone: showIdx + 18,
    bdTotal: showIdx + 20,
  };

  // Ghi đè theo TÊN header thật (nếu file đổi thứ tự cột cục bộ vẫn bắt đúng).
  const header = rows[headerIdx] ?? [];
  const find = (re: RegExp): number => {
    for (let c = 0; c < header.length; c++) {
      const h = str(header[c]).toLowerCase();
      if (h && re.test(h)) return c;
    }
    return -1;
  };
  const override = (key: keyof typeof LEGACY_COL, re: RegExp) => {
    const idx = find(re);
    if (idx >= 0) col[key] = idx;
  };
  override("G", /^c[đd]t$|chủ\s*đầu\s*tư/);
  override("H", /^ma\s*ct$|^mã\s*ct$/);
  override("L", /^mã$/);
  override("M", /^mô\s*tả/);
  override("N", /người\s*phụ\s*trách/);
  override("O", /^bắt\s*đầu/);
  override("P", /^kết\s*thúc/);
  override("R", /%\s*dự\s*kiến/);
  override("S", /%\s*thực\s*tế/);
  override("T", /^quá\s*hạn/);
  override("U", /vướng\s*mắc/);
  // Khối breakdown luôn nằm ngay sau Vướng mắc (U) → neo lại theo U sau khi đã dò xong.
  col.bdLabel = col.U + 1;
  col.bdDone = col.U + 2;
  col.bdTotal = col.U + 4;
  return col;
}

/** Row is "shown" only when Show column equals "show" (case-insensitive).
 *  Anything else — "hide", "HIde", "Done", blank — is filtered out. */
function isShown(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "show";
}

const STAGE_BY_PREFIX: Array<[RegExp, StageKey | "Khác"]> = [
  [/^TKSX\b/i, "Triển khai sản xuất"],
  // LƯU Ý: mã "SD" (Shop drawing) KHÔNG phải "Triển khai sản xuất" — theo quy ước
  // PMO hiện hành chỉ mã TKSX mới tính vào giai đoạn này. SD rơi xuống "Khác"
  // (vẫn nạp nhờ allowlist bên dưới, không bị bỏ như mã lạ).
  [/^TK\b/i,   "Phát hành thiết kế"],
  [/^MA\b/i,   "Trình duyệt mẫu"],
  [/^DM\b/i,   "Trình duyệt mẫu"],
  [/^BG\b/i,   "LOA/Tạm ứng"],
  [/^VT\b/i,   "Đặt vật tư"],
  [/^SX\b/i,   "Sản xuất nhập kho"],
  [/^TC\b/i,   "Thi công lắp đặt"],
  [/^MB\b/i,   "Khác"],
  // "PS" (Phát sinh) không phải một giai đoạn trong dòng chảy chuẩn — việc phát sinh
  // thêm, có mốc riêng, nên xếp "Khác" y như MB. Xem thêm luật miễn cảnh báo ở index.tsx.
  [/^PS\b/i,   "Khác"],
];

function detectStage(code: string): StageKey | "Khác" {
  const c = code.trim();
  for (const [re, s] of STAGE_BY_PREFIX) if (re.test(c)) return s;
  return "Khác";
}

/** Nhãn breakdown "số mã/tổng mã" → GIAI ĐOẠN hiển thị. Chốt với PMO:
 *   Mẫu → Trình duyệt mẫu · VT.* (CT/NM/Fit/BL…) → Đặt vật tư (gộp) · TKSX → Triển khai
 *   sản xuất · Kho → Sản xuất nhập kho. SD (shop drawing) / GCN không gắn vào giai đoạn
 *   chính → trả null (bỏ qua). */
function bdStageOf(label: string): StageKey | null {
  const l = label.trim();
  if (/^mẫu\b/i.test(l)) return "Trình duyệt mẫu";
  if (/^vt(\.|\b)/i.test(l)) return "Đặt vật tư";
  if (/^tksx\b/i.test(l)) return "Triển khai sản xuất";
  if (/^kho\b/i.test(l)) return "Sản xuất nhập kho";
  return null;
}

type RawBd = { label: string; done: number | null; total: number };

/** Sentinel strings the upstream sources emit as "empty". Treated as null/"". */
const NULLISH_TOKENS = new Set(["", "-", "—", "–", "n/a", "na", "null", "undefined", "nan", "#n/a", "#null!", "#value!", "#ref!", "#div/0!"]);

/** Normalize any raw cell to a clean trimmed string. NaN/null/undefined/" "/sentinel → "". */
function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const s = String(v).replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (NULLISH_TOKENS.has(s.toLowerCase())) return "";
  return s;
}

/** Như str() nhưng GIỮ xuống dòng — dùng cho ô "Vướng mắc / Cần xử lý" để hộp
 *  xem đầy đủ trên UI hiển thị đúng cấu trúc gạch đầu dòng như trong sheet. */
function noteStr(v: unknown): string {
  if (v == null) return "";
  const s = String(v).replace(/[ \t]+/g, " ").replace(/ ?\r?\n ?/g, "\n").trim();
  if (!s) return "";
  if (NULLISH_TOKENS.has(s.toLowerCase())) return "";
  return s;
}

/** Cast any raw cell to a finite number (Float). Strips %, thousands separators,
 *  handles comma-decimal (1,5 → 1.5), currency symbols, and sentinel nulls. */
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s || NULLISH_TOKENS.has(s.toLowerCase())) return null;
  const hasPct = /%/.test(s);
  // strip everything except digits, separators, sign, exponent
  s = s.replace(/[^\d.,\-+eE]/g, "");
  if (!s) return null;
  // Detect decimal separator: if both "." and "," present, the LAST one is decimal.
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot !== -1 && lastComma !== -1) {
    if (lastComma > lastDot) {
      // comma is decimal: strip thousand dots, swap comma → dot
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // dot is decimal: strip thousand commas
      s = s.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    // only commas — treat as decimal if exactly one and ≤ 3 digits after, else thousand sep
    const parts = s.split(",");
    if (parts.length === 2 && parts[1].length !== 3) s = parts.join(".");
    else s = s.replace(/,/g, "");
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  // If the source already wrote "80%" we keep the 80 magnitude; normPct() will
  // re-scale later. Just record that the percent token was present for callers
  // that want to know — currently normPct handles both 0..1 and 0..100 ranges.
  return hasPct ? n : n;
}

/** Cast to non-negative integer (used for "Quá hạn" / overdue days). */
function intCast(v: unknown): number | null {
  const n = num(v);
  if (n == null) return null;
  return Math.max(0, Math.round(n));
}


function toIso(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    // CRITICAL: XLSX with cellDates:true emits Dates in local time. toISOString()
    // converts to UTC, which shifts the day backward in GMT+7 (Vietnam),
    // so 25/05 renders as 24/05. Extract local Y/M/D directly.
    const y = v.getFullYear();
    const mo = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const raw = String(v).trim();
  if (!raw || NULLISH_TOKENS.has(raw.toLowerCase())) return null;
  // Excel serial as string (e.g. CSV exports of unformatted date cells: "46150")
  if (/^\d{4,6}(?:\.\d+)?$/.test(raw)) {
    const serial = parseFloat(raw);
    // Excel dates are typically 1..60000+ — disambiguate from real years like 2024.
    if (serial > 366 && serial < 80000) {
      const d = XLSX.SSF.parse_date_code(serial);
      if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    }
  }
  let m = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = "20" + y;
    const n1 = parseInt(a, 10);
    const n2 = parseInt(b, 10);
    // Disambiguate d/m/y vs m/d/y safely:
    //  - if first group > 12 → must be DAY (d/m/y)
    //  - else if second group > 12 → must be MONTH-first (m/d/y)
    //  - else ambiguous → default to d/m/y (Vietnamese locale, matches Excel source)
    let day: number, mo: number;
    if (n1 > 12) { day = n1; mo = n2; }
    else if (n2 > 12) { mo = n1; day = n2; }
    else { day = n1; mo = n2; }
    if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // Last resort: native Date — extract LOCAL Y/M/D to avoid UTC drift.
  const dt = new Date(raw);
  if (!isNaN(dt.getTime())) {
    const y = dt.getFullYear();
    const mo = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  return null;
}


/** Upper bound (in %) considered plausibly a real percentage. Anything above
 *  this — e.g. a date serial like 46150 accidentally typed into a % cell —
 *  is treated as DATA GARBAGE and excluded from progress math instead of
 *  being silently clamped to 100. Keep slack above 100 because some reports
 *  legitimately overshoot scope. */
const PCT_MAX_PLAUSIBLE = 150;
const PCT_MIN_PLAUSIBLE = -50;

/** Strict percentage parser. Per PMO spec, accepts the range [-50%, 150%];
 *  anything outside (e.g. a date serial like 46150 dropped into a % cell)
 *  is treated as DATA GARBAGE and excluded from gap math — surfaced via the
 *  "X ô % nghi ngờ dữ liệu" badge. Values 0..100 are kept; >100..150 is
 *  clamped to 100 (over-achievement plateau); negatives are kept as-is
 *  so they show in the suspect badge but never poison the gap calc.
 */
function normPctStrict(v: number | null): { value: number | null; suspect: boolean } {
  if (v == null) return { value: null, suspect: false };
  const x = Math.abs(v) <= 1.5 ? v * 100 : v;
  if (x < PCT_MIN_PLAUSIBLE || x > PCT_MAX_PLAUSIBLE) return { value: null, suspect: true };
  if (x < 0) return { value: null, suspect: true };
  return { value: x > 100 ? 100 : x, suspect: false };
}

function normPct(v: number | null): number | null {
  return normPctStrict(v).value;
}


function isParent(rowCode: string, maCT: string, projectName: string): boolean {
  if (!rowCode) return false;
  if (/^CT/i.test(rowCode)) return true;
  if (maCT && rowCode === maCT && projectName) return true;
  return false;
}


function daysBetween(a: string, b: string): number {
  // Parse as UTC midnight to avoid DST/local-tz drift.
  const ta = new Date(a.slice(0, 10) + "T00:00:00Z").getTime();
  const tb = new Date(b.slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((ta - tb) / 86400000);
}


/** Find optional financial columns by scanning the header row (index 5).
 *  Returns -1 when a column is not present in the source. */
function detectFinanceCols(headerRow: unknown[]): {
  budget: number; actualCost: number; contractValue: number; penaltyPerDay: number;
} {
  const out = { budget: -1, actualCost: -1, contractValue: -1, penaltyPerDay: -1 };
  if (!headerRow) return out;
  for (let c = 0; c < headerRow.length; c++) {
    const h = str(headerRow[c]).toLowerCase();
    if (!h) continue;
    if (out.budget === -1 && /(ngân\s*sách|dự\s*toán|budget|kế\s*hoạch\s*chi\s*phí)/i.test(h)) out.budget = c;
    if (out.actualCost === -1 && /(chi\s*phí\s*thực|chi\s*phí\s*đã|actual\s*cost|cost\s*spent|spent)/i.test(h)) out.actualCost = c;
    if (out.contractValue === -1 && /(giá\s*trị\s*hđ|giá\s*trị\s*hợp\s*đồng|contract\s*value|revenue|doanh\s*thu|giá\s*trị)/i.test(h)) out.contractValue = c;
    if (out.penaltyPerDay === -1 && /(phạt|penalty)/i.test(h)) out.penaltyPerDay = c;
  }
  return out;
}

/** Bỏ dấu tiếng Việt để so khớp văn bản không phụ thuộc dấu ("tiến độ" ≡ "tien do"). */
function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

/** Nhận diện ghi chú "cần cập nhật tiến độ Master Plan" trong cột Vướng mắc/Cần xử lý.
 *  PM hay note dạng "cần cập nhật tiến độ MP trình BOD phê duyệt", "cập nhật lại
 *  tiến độ Master Plan"… Luật: có "cập nhật" VÀ ("tiến độ" HOẶC "MP" HOẶC
 *  "master plan") — không phụ thuộc thứ tự, dấu, hoa thường. */
export function noteMentionsMpUpdate(note: string): boolean {
  if (!note) return false;
  const n = stripDiacritics(note).replace(/\s+/g, " ").trim().toLowerCase();
  // A. CỤM LIỀN "cập nhật (lại) tiến độ / MP / master plan".
  //    (Bắt 2 từ khoá rời nhau sẽ dính nhầm "đẩy nhanh TIẾN ĐỘ CẬP NHẬT BOQ".)
  if (/cap nhat (lai )?(tien do|mp\b|master plan)/.test(n)) return true;
  // B. Note có ngữ cảnh PMO/BOD + nhắc "cập nhật" — cách PMO hay viết đảo ngữ:
  //    "PMO: Trượt tiến độ…, cần PM … và cập nhật",
  //    "cần PM trình BOD phê duyệt tiến độ cập nhật",
  //    "trình Master Plan cập nhật BOD phê duyệt (bitrix)".
  if (/cap nhat/.test(n) && (/^pmo\b/.test(n) || /trinh bod|bod phe duyet|trinh master plan/.test(n))) return true;
  // C. Cờ trống "CẦN CẬP NHẬT" đứng một mình trên dòng dự án.
  if (/^can cap nhat[.!]?$/.test(n)) return true;
  return false;
}

/** Nhận diện RIÊNG cụm "trình BOD phê duyệt (Bitrix)" — DẤU HIỆU DUY NHẤT để đưa dự án vào
 *  bộ lọc "Cần cập nhật MP" (PMO chốt 31/07/2026: quét vướng mắc CẤP DỰ ÁN có cụm này).
 *
 *  CỐ TÌNH RẤT ĐẶC HIỆU (khác noteMentionsMpUpdate vốn rộng, bắt mọi "cập nhật MP"):
 *  BẮT BUỘC có cụm liền "trình BOD (phê) duyệt" VÀ từ "bitrix". Vì sao chặt vậy: nếu chỉ
 *  đòi bod+duyệt+bitrix rời rạc, hoặc dùng luật "cập nhật MP" chung, sẽ dính các dự án chỉ
 *  điền CỘT "Cần cập nhật MP" hay ghi chú khác (vd 43 ĐTM) → lọc phình ra sai. Cho phép
 *  biến thể: thiếu "phê" ("trình BOD duyệt (Bitrix)"), "(Bitrix)"/"trên Bitrix"/"qua Bitrix". */
export function noteSaysTrinhBodBitrix(note: string): boolean {
  if (!note) return false;
  const n = stripDiacritics(note).replace(/\s+/g, " ").trim().toLowerCase();
  return /trinh bod (phe )?duyet/.test(n) && /bitrix/.test(n);
}

/** Nhận diện dự án ĐÃ BÀN GIAO XONG từ ô "Vướng mắc / Cần xử lý" trên DÒNG DỰ ÁN CHA.
 *  PMO chốt 17/07/2026: dự án như vậy coi như hoàn thành — hiện nền xanh lá, gỡ sạch
 *  cảnh báo, nhưng VẪN hiển thị trong bảng.
 *
 *  CẢNH BÁO CHO NGƯỜI SỬA SAU: chữ "bàn giao" MỘT MÌNH KHÔNG có nghĩa là xong. Trong
 *  nguồn hiện có 23 note dòng cha chứa "bàn giao" mà ý nghĩa NGƯỢC HẲN:
 *    "PMO: Trễ tiến độ bàn giao…", "PMO: Tiến độ bàn giao đã trượt…",
 *    "…đảm bảo tiến độ bàn giao 30/07", "CĐT chậm bàn giao mặt bằng".
 *  Nới regex thành /bàn giao/ sẽ tô xanh gần hết danh sách cảnh báo. Luật vì thế bắt
 *  buộc phải có ĐỘNG TỪ HOÀN THÀNH "đã" đứng ngay trước:
 *    ✔ "Dự án đã bàn giao đúng tiến độ & chất lượng"      (CT26-062)
 *    ✔ "Đã bàn giao dự án, còn điều chỉnh vài hạng mục…"  (CT26-049)
 *    ✔ "PMO: đã hoàn tất thi công lắp đặt, giai đoạn defect bàn giao…" (CT26-019)
 *    ✘ "PMO: Tiến độ bàn giao đã trượt…"  ("đã" có, nhưng gắn với "trượt")
 *  Ràng buộc "đã" + (bàn giao|hoàn tất|hoàn thành) liền kề, tối đa 1 từ đệm ở giữa. */
export function noteSaysDelivered(note: string): boolean {
  if (!note) return false;
  const n = stripDiacritics(note).replace(/\s+/g, " ").trim().toLowerCase();
  // "da ban giao", "da hoan tat", "da hoan thanh" — cho phép 1 từ đệm ("đã chính thức bàn giao").
  return /\bda (?:\w+ )?(ban giao|hoan tat|hoan thanh)\b/.test(n);
}

/** Tìm cột "Cần cập nhật MP" theo TIÊU ĐỀ ở header row (index 5) — không hardcode
 *  vị trí. Chấp nhận "Cần cập nhật MP", "Cập nhật MP", "Cập nhật Master Plan"…
 *  Trả -1 khi nguồn không có cột này. */
function detectMpUpdateCol(headerRow: unknown[]): number {
  if (!headerRow) return -1;
  for (let c = 0; c < headerRow.length; c++) {
    const h = str(headerRow[c]).toLowerCase();
    if (!h) continue;
    if (/c[ậa]p\s*nh[ậa]t\s*(mp\b|master\s*plan)/i.test(h)) return c;
  }
  return -1;
}

/** Tìm cột "Vùng/khu vực" theo tiêu đề header (cột C = "Location" trong file PMP).
 *  Chấp nhận "Location", "Khu vực", "Vùng", "Region". Trả -1 khi không có. */
function detectRegionCol(headerRow: unknown[]): number {
  if (!headerRow) return -1;
  for (let c = 0; c < headerRow.length; c++) {
    const h = str(headerRow[c]).toLowerCase();
    if (!h) continue;
    if (/^location$|khu\s*v[ựu]c|^v[ùu]ng$|^region$/i.test(h)) return c;
  }
  return -1;
}

/** Tìm cột "Cụm dự án" theo tiêu đề header ("Group DA" trong file PMP). Trả -1 khi không có. */
function detectGroupCol(headerRow: unknown[]): number {
  if (!headerRow) return -1;
  for (let c = 0; c < headerRow.length; c++) {
    const h = str(headerRow[c]).toLowerCase();
    if (!h) continue;
    if (/^group\s*da$|nh[óo]m\s*d[ựu]\s*[áa]n/i.test(h)) return c;
  }
  return -1;
}

/** Tìm cột "Ngày update" (ngày cập nhật Master Plan, nằm trên dòng dự án cha).
 *  Trả -1 khi nguồn không có cột này. */
function detectUpdateDateCol(headerRow: unknown[]): number {
  if (!headerRow) return -1;
  for (let c = 0; c < headerRow.length; c++) {
    const h = str(headerRow[c]).toLowerCase();
    if (!h) continue;
    if (/ng[àa]y\s*update|ng[àa]y\s*c[ậa]p\s*nh[ậa]t/i.test(h)) return c;
  }
  return -1;
}

/** Tìm cột "Top 20" (đánh số 1..20 các dự án trọng điểm) — cột ngoài cùng trái.
 *  Chấp nhận header "Top 20", "Top20", "STT Dự án". Trả -1 khi không có. */
function detectTop20Col(headerRow: unknown[]): number {
  if (!headerRow) return -1;
  for (let c = 0; c < headerRow.length; c++) {
    const h = str(headerRow[c]).toLowerCase();
    if (!h) continue;
    if (/^top\s*20$|^stt\s*d[ựu]\s*[áa]n$/i.test(h)) return c;
  }
  return -1;
}

/** Tìm cột "STT" chứa ID PHÂN CẤP (dự án "70", hạng mục "70.1", dòng con "70.1a"). ID này
 *  đếm tăng vĩnh viễn, KHÔNG lặp — dùng làm khoá match ổn định. PHẢI phân biệt với cột
 *  "STT Dự án"/"Top 20" (detectTop20Col) — chỉ nhận header ĐÚNG "STT"/"ID"/"Mã ID" (không kèm
 *  "dự án"). Trả -1 khi nguồn không có cột này (file/cache cũ vẫn chạy theo khoá tên). */
function detectIdCol(headerRow: unknown[]): number {
  if (!headerRow) return -1;
  for (let c = 0; c < headerRow.length; c++) {
    const h = str(headerRow[c]).toLowerCase();
    if (!h) continue;
    if (/d[ựu]\s*[áa]n/.test(h)) continue;          // tránh "STT Dự án" (Top-20)
    if (/^stt$|^id$|^m[ãa]\s*id$/.test(h)) return c;
  }
  return -1;
}

/** Parse rows[][] from the Timeline sheet (header row index 5, data from index 7). */
export function parseTimelineRows(rows: unknown[][], refDateIso: string, getFormula?: (r: number, c: number) => string | undefined): ReportData {
  const projects: ProjectRow[] = [];
  const items: ItemRow[] = [];
  let current: ProjectRow | null = null;

  // DÒ CỘT ĐỘNG: neo theo header "Show" — file đổi version/chèn cột vẫn đọc đúng.
  const COL = detectColumns(rows);
  const fin = detectFinanceCols(rows[COL.headerIdx] ?? []);
  const mpCol = detectMpUpdateCol(rows[COL.headerIdx] ?? []);
  const regionCol = detectRegionCol(rows[COL.headerIdx] ?? []);
  const groupCol = detectGroupCol(rows[COL.headerIdx] ?? []);
  const top20Col = detectTop20Col(rows[COL.headerIdx] ?? []);
  const updateCol = detectUpdateDateCol(rows[COL.headerIdx] ?? []);
  const idCol = detectIdCol(rows[COL.headerIdx] ?? []);
  /** ID phân cấp (cột STT) của dòng hiện tại — "" nếu nguồn không có cột. */
  const idOf = (r: unknown[]): string | undefined => {
    if (idCol < 0) return undefined;
    const v = str(r[idCol]);
    return v || undefined;
  };
  let currentRegion = "";
  let currentGroup = "";
  let currentRank: number | undefined = undefined;
  let currentUpdate: string | null = null;
  let currentDelivered = false;

  // ── CỔNG KIỂM SOÁT DỮ LIỆU: bộ đếm cho các bất thường đầu vào ──
  const headerJoined = (rows[COL.headerIdx] ?? []).map((c) => str(c)).join(" | ").toLowerCase();
  const headerOk = COL.detected ||
    /(tên\s*dự\s*án|project|công\s*trình)/.test(headerJoined);
  let parentsTotal = 0;
  let unknownPrefixCount = 0;
  const unknownPrefixSamples: string[] = [];
  let unparsedDateCount = 0;

  let currentHidden = false; // when a parent row has Show != "show", skip all its children
  // Đếm lần xuất hiện của (dự án + mã giai đoạn) để gán dupIdx ổn định (0-based)
  // theo thứ tự dòng trong sheet — tách các dòng trùng mã trong cùng dự án.
  const dupCounter = new Map<string, number>();
  // Gom các dòng breakdown "số mã/tổng mã" theo TỪNG dự án (khối cột sau Vướng mắc).
  // Độc lập với dòng giai đoạn — gắn vào item theo NHÃN ở post-pass cuối hàm.
  const bdByProj = new Map<ProjectRow, RawBd[]>();
  // Gom DÒNG CON kiểu Block (Mã <giai đoạn>+số) theo dự án → post-pass gắn vào item giai đoạn
  // TƯƠNG ỨNG. Hiện áp cho: "Thi công lắp đặt" (TC1..TCn) và "Triển khai sản xuất" (TKSX1..TKSXn).
  // Mỗi phần tử kèm `stage` = giai đoạn cha để gắn đúng chỗ ở post-pass.
  const blocksByProj = new Map<ProjectRow, { parentId: string | null; stage: StageKey | null; blk: BlockChild }[]>();
  for (let i = COL.headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const rawCode = str(r[COL.L]);
    const projectName = str(r[COL.F]);
    const maCT = str(r[COL.H]);
    if (!rawCode && !projectName && !maCT) continue;

    const showCell = r[COL.E];

    if (isParent(rawCode, maCT, projectName)) {
      parentsTotal++;
      // ── FILTER 1 (parent): Show must equal "show"; "hide"/"Done"/blank → skip project & children
      if (!isShown(showCell)) {
        current = null;
        currentHidden = true;
        continue;
      }
      // PM = dòng đầu của ô "Người phụ trách chính" trên dòng dự án.
      // Dòng bắt đầu bằng "DPM" (case-insensitive, có thể "DPM:" hoặc "DPM ") = phó PM.
      // IMPORTANT: do NOT use str() here — it collapses newlines, which would
      // merge PM + DPM lines into one. Read the raw cell and split manually.
      const ownerRaw = r[COL.N] == null ? "" : String(r[COL.N]);
      const ownerLines = ownerRaw
        // Split on newlines, semicolons, pipes, OR a "DPM" token mid-string
        // (covers cases where the source already flattened newlines to spaces).
        .split(/\r?\n|;|\||(?=\bD\s*PM\b)/i)
        .map((l) => l.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .filter((l) => !/^pm\b[:\s\-.]*$/i.test(l)); // drop a bare "PM:" label line
      const isDpmLine = (l: string) => /^d\s*pm\b[:\s\-.]*/i.test(l);
      // Strip an optional "PM" prefix from the first non-DPM line.
      const pmLine = (ownerLines.find((l) => !isDpmLine(l)) ?? "")
        .replace(/^pm\b[:\s\-.]*/i, "")
        .trim();
      const dpmLine = ownerLines.find(isDpmLine)?.replace(/^d\s*pm\b[:\s\-.]*/i, "").trim() ?? "";
      const proj: ProjectRow = {
        id: idOf(r),
        code: rawCode || maCT,
        name: projectName || rawCode || maCT,
        cdt: str(r[COL.G]),
        maCT: maCT || rawCode,
        start: toIso(r[COL.O]),
        deadline: toIso(r[COL.P]),
        pm: pmLine || str(r[COL.G]) || "—",
        dpm: dpmLine,
        // Cờ "Cần cập nhật MP": (1) ô cột "Cần cập nhật MP" trên dòng cha khác rỗng,
        // HOẶC (2) cột Vướng mắc của dòng cha có ghi chú "cần cập nhật tiến độ MP…".
        // (3) — bổ sung bên dưới: ghi chú tương tự trên các đầu việc đang làm.
        needsMpUpdate:
          (mpCol >= 0 && str(r[mpCol]) !== "") ||
          noteMentionsMpUpdate(str(r[COL.U])),
        // Lý do (hiển thị ở chế độ gộp theo dự án): ưu tiên ghi chú dòng cha,
        // rồi tới nội dung ô cột "Cần cập nhật MP".
        mpReason: noteMentionsMpUpdate(str(r[COL.U]))
          ? noteStr(r[COL.U])
          : (mpCol >= 0 ? str(r[mpCol]) : ""),
        // Vướng mắc CẤP DỰ ÁN thô (cột U dòng cha) — để bộ lọc "Cần cập nhật MP" quét
        // trực tiếp cụm "trình BOD phê duyệt (Bitrix)" đúng như người dùng Ctrl+F trên file.
        projectNote: noteStr(r[COL.U]),
        groupDA: groupCol >= 0 ? str(r[groupCol]) : "",
        rank: top20Col >= 0 ? (intCast(r[top20Col]) ?? undefined) : undefined,
        // "Ngày update" chỉ có trên dòng dự án CHA → mọi đầu việc con kế thừa (bên dưới).
        updateDate: updateCol >= 0 ? toIso(r[updateCol]) : null,
        // Dự án đã bàn giao xong (đọc ô Vướng mắc của chính dòng cha này).
        delivered: noteSaysDelivered(str(r[COL.U])),
        items: [],
        allItems: [],
      };
      current = proj;
      bdByProj.set(proj, []);
      currentRegion = regionCol >= 0 ? str(r[regionCol]) : "";
      currentGroup = proj.groupDA ?? "";
      currentRank = proj.rank;
      currentUpdate = proj.updateDate ?? null;
      currentDelivered = proj.delivered ?? false;
      projects.push(proj);
      currentHidden = false;
      continue;
    }

    if (currentHidden) continue; // parent was hidden → drop all its rows

    // Thu breakdown "số mã/tổng mã" của dòng này (nếu có) — độc lập với dòng giai đoạn,
    // nên đọc TRƯỚC các `continue` lọc mã lạ bên dưới. Chỉ nhận nhãn breakdown đã biết
    // (Mẫu/VT/SD/TKSX/Kho/GCN) và có tổng mã > 0 — bỏ qua khối "Kế hoạch giao hàng" (ngày).
    if (current) {
      const bl = str(r[COL.bdLabel]);
      if (bl.endsWith(":") && /^(mẫu|vt|sd|tksx|kho|gcn)/i.test(bl)) {
        const total = num(r[COL.bdTotal]);
        if (total != null && total > 0) {
          bdByProj.get(current)!.push({ label: bl.replace(/:\s*$/, "").trim(), done: num(r[COL.bdDone]), total });
        }
      }
    }

    if (!rawCode) continue;

    // ── DÒNG CON kiểu Block (con của 1 GIAI ĐOẠN): nhận diện theo CẤU TRÚC STT ID — dòng con có ID
    //    = <ID giai đoạn cha> + HẬU TỐ CHỮ (xy.za, xy.zb…). Nhờ vậy thêm dòng con cho BẤT KỲ giai đoạn
    //    nào (TC, TKSX, VT, SX…) là app TỰ HIỆN, KHÔNG cần sửa code từng lần. Gắn vào item CHA ở
    //    post-pass theo ID cha. Nguồn KHÔNG có cột STT (cache/CSV cũ) → fallback mã cứng /^(TC|TKSX)\d+$/,
    //    gắn theo GIAI ĐOẠN.
    //    Ý nghĩa % tự dò từ file (không phụ thuộc giai đoạn):
    //     • Ô U+1 (khối sau Vướng mắc) là SỐ → GIAO THÔ: U+1..U+3 = đã giao thô (done/total/%),
    //       U+4..U+6 = đã giao tinh.  • Ô % có công thức AVERAGE → TRUNG BÌNH các khu.  • còn lại → chỉ %.
    const rowId = idOf(r);
    // Dòng con = ID kết thúc bằng CHỮ; ID cha = bỏ hậu tố chữ ("70.2a" → "70.2").
    const blockParentId = rowId && /[a-z]$/i.test(rowId) ? rowId.replace(/[a-z]+$/i, "") : null;
    const blockStageFallback: StageKey | null = !rowId
      ? (/^TC\d+$/i.test(rawCode) ? "Thi công lắp đặt" : /^TKSX\d+$/i.test(rawCode) ? "Triển khai sản xuất" : null)
      : null;
    if (current && (blockParentId || blockStageFallback)) {
      const u = COL.U;
      const numericCell = (v: unknown): boolean =>
        typeof v === "number" ? Number.isFinite(v) : typeof v === "string" && /^\s*-?\d+([.,]\d+)?%?\s*$/.test(v);
      const code = rawCode.toUpperCase();
      const label = str(r[COL.M]) || rawCode;
      const pctActual = normPctStrict(num(r[COL.S])).value;
      let blk: BlockChild;
      if (numericCell(r[u + 1])) {
        const hv = (d: number, t: number, p: number): BlockHandover | undefined =>
          numericCell(r[d]) ? { done: num(r[d]), total: num(r[t]), pct: normPctStrict(num(r[p])).value } : undefined;
        blk = { code, id: idOf(r), label, pctActual, kind: "tho", tho: hv(u + 1, u + 2, u + 3), tinh: hv(u + 4, u + 5, u + 6) };
      } else {
        // TRUNG BÌNH khu: đọc công thức ô % (AVERAGE(Yr,ABr,…)); mỗi tham chiếu → 1 khu:
        // giá trị = ô tham chiếu, nhãn = ô CỘT-2 cùng dòng ("Lobby B1:", "Res. B1:"…).
        const areas: BlockArea[] = [];
        const formula = getFormula?.(i, COL.S) ?? "";
        for (const ref of formula.match(/\b[A-Za-z]{1,3}\d+\b/g) ?? []) {
          const m = /^([A-Za-z]{1,3})(\d+)$/.exec(ref);
          if (!m) continue;
          const c = XLSX.utils.decode_col(m[1].toUpperCase());
          const rr = parseInt(m[2], 10) - 1; // Excel 1-based → 0-based
          if (rr < 0 || c < 2 || !rows[rr]) continue;
          const lb = str(rows[rr][c - 2]).replace(/:\s*$/, "").trim();
          const pv = normPctStrict(num(rows[rr][c])).value;
          if (lb || pv != null) areas.push({ label: lb || "—", pct: pv });
        }
        blk = areas.length ? { code, id: idOf(r), label, pctActual, kind: "avg", areas } : { code, id: idOf(r), label, pctActual, kind: "plain" };
      }
      // Ngày RIÊNG của dòng con (data tự nhập trong file). Trống → null → buildBlockItem kế thừa cha.
      blk.start = toIso(r[COL.O]);
      blk.deadline = toIso(r[COL.P]);
      const arr = blocksByProj.get(current) ?? [];
      arr.push({ parentId: blockParentId, stage: blockStageFallback, blk });
      blocksByProj.set(current, arr);
      continue;
    }

    const stage = detectStage(rawCode);
    if (stage === "Khác" && !/^(TK|MA|BG|VT|TKSX|SD|SX|TC|MB|DM|PS)/i.test(rawCode)) {
      // Mã không thuộc nhóm giai đoạn nào → bị bỏ qua. ĐẾM để cảnh báo
      // (file đổi quy ước prefix thì phải lộ ra, không được nuốt trong im lặng).
      unknownPrefixCount++;
      if (unknownPrefixSamples.length < 5) unknownPrefixSamples.push(rawCode);
      continue;
    }

    // ── FILTER 1 (child): row's own Show must be "show"
    // KHÔNG continue ở đây — vẫn lưu vào allItems để giữ ĐỦ giai đoạn gốc.
    // Chỉ những dòng "show" mới đẩy vào danh sách items của dashboard.
    const shown = isShown(showCell);

    const deadline = toIso(r[COL.P]);
    if (deadline == null && str(r[COL.P]) !== "") unparsedDateCount++;
    const actCellRaw = r[COL.S];
    const pctActualRaw = num(actCellRaw);
    const actNorm  = normPctStrict(pctActualRaw);
    const pctActual = actNorm.value;
    // BỎ HOÀN TOÀN cột "% dự kiến" trong nguồn — chứa giá trị rác (ngày serial,
    // số bất thường). "% dự kiến" thực sự được tính theo công thức
    //   (MIN(today, Finish) − Start + 1) / (Finish − Start + 1)
    // ở phía dashboard (computePlanPct). Mọi field pctPlan* dưới đây giữ null.
    const pctPlanRaw: number | null = null;
    const pctPlan: number | null = null;
    const pctPlanInvalid = false;
    const pctActualInvalid =
      (pctActualRaw == null && str(actCellRaw) !== "") || actNorm.suspect;


    // BỎ HOÀN TOÀN cột T ("Quá hạn") từ nguồn — chứa giá trị rác.
    // Số ngày trễ luôn tự tính bằng getDaysOverdue() theo công thức Excel gốc.
    const overdueDays = getDaysOverdue({ deadline, pctActual }, refDateIso);

    const tc2 = (overdueDays ?? 0) > OVERDUE_DAYS && (pctActual ?? 0) < 100;

    // Financial cells (only when the source header exposes the column).
    const budget = fin.budget >= 0 ? num(r[fin.budget]) : null;
    const actualCost = fin.actualCost >= 0 ? num(r[fin.actualCost]) : null;
    const contractValue = fin.contractValue >= 0 ? num(r[fin.contractValue]) : null;
    const penaltyPerDay = fin.penaltyPerDay >= 0 ? num(r[fin.penaltyPerDay]) : null;

    // dupIdx: thứ tự lần xuất hiện của (dự án + rawCode) — tính TRÊN allItems (mọi
    // dòng giai đoạn kể cả hide/100%) nên ổn định qua các lần sync dù % đổi / dòng xong.
    const dupKey = `${current?.code ?? ""} ${current?.name ?? ""} ${rawCode}`;
    const dupIdx = dupCounter.get(dupKey) ?? 0;
    dupCounter.set(dupKey, dupIdx + 1);

    const row: ItemRow = {
      id: idOf(r),
      projectCode: current?.code ?? "",
      projectName: current?.name ?? "(không xác định)",
      cdt: current?.cdt ?? str(r[COL.G]),
      maCT: current?.maCT ?? maCT,
      projectDeadline: current?.deadline ?? null,
      projectStart: current?.start ?? null,
      region: (regionCol >= 0 ? str(r[regionCol]) : "") || currentRegion,
      groupDA: currentGroup || undefined,
      rank: currentRank,
      updateDate: currentUpdate,
      // Dự án cha đã bàn giao → dòng con thừa hưởng, dùng để gỡ cảnh báo (index.tsx).
      projectDelivered: currentDelivered,
      stage,
      rawCode,
      dupIdx,
      desc: str(r[COL.M]),
      owner: str(r[COL.N]),
      shown,
      start: toIso(r[COL.O]),
      deadline,
      pctPlanRaw,
      pctPlan,
      pctActual,
      pctPlanInvalid,
      pctActualInvalid,
      overdueDays,
      note: noteStr(r[COL.U]),
      tc2,
      budget,
      actualCost,
      contractValue,
      penaltyPerDay,
    };

    // allItems: NẠP MỌI dòng giai đoạn (kể cả Show=hide, kể cả đã 100%).
    // Đây là nguồn dữ liệu cho XUẤT EXCEL/IN — phải đủ giai đoạn như file gốc.
    current?.allItems.push(row);

    // Dashboard chỉ nhận dòng đang "show" và chưa hoàn thành.
    if (!shown) continue;
    if (!actNorm.suspect && pctActual != null && pctActual >= 100) continue;

    items.push(row);
    current?.items.push(row);
    // (3) Ghi chú "cần cập nhật tiến độ MP" trên ĐẦU VIỆC ĐANG LÀM → cờ cho dự án.
    if (current && noteMentionsMpUpdate(row.note)) {
      current.needsMpUpdate = true;
      if (!current.mpReason) current.mpReason = row.note;
    }
  }

  // POST-PASS: gắn chi tiết "số mã/tổng mã" vào từng đầu việc theo NHÃN → GIAI ĐOẠN.
  // Một giai đoạn có thể nhận nhiều nhãn (Đặt vật tư = VT.CT + VT.NM). Các item cùng
  // giai đoạn trong 1 dự án dùng CHUNG chi tiết này (breakdown là cấp dự án×giai đoạn).
  for (const proj of projects) {
    const raw = bdByProj.get(proj);
    if (!raw?.length) continue;
    const byStage = new Map<StageKey, CodeCount[]>();
    for (const b of raw) {
      const sk = bdStageOf(b.label);
      if (!sk) continue;
      const arr = byStage.get(sk) ?? [];
      arr.push({ label: b.label, done: b.done, total: b.total });
      byStage.set(sk, arr);
    }
    if (!byStage.size) continue;
    for (const it of proj.allItems) {
      const cc = it.stage !== "Khác" ? byStage.get(it.stage) : undefined;
      if (cc) it.codeCounts = cc;
    }
  }

  // POST-PASS: gắn Block con vào item GIAI ĐOẠN CHA. Ưu tiên gắn theo ID CHA (parentId, vd "70.2")
  // — chính xác kể cả khi dự án có nhiều item trùng giai đoạn. Không có ID (fallback) → gắn theo
  // GIAI ĐOẠN. Ưu tiên item đang shown (hiện trong bảng); cùng object nên set .blocks áp cho cả items
  // lẫn allItems. Giữ THỨ TỰ dòng trong sheet.
  for (const proj of projects) {
    const entries = blocksByProj.get(proj);
    if (!entries?.length) continue;
    for (const { parentId, stage, blk } of entries) {
      const host = parentId
        ? (proj.allItems.find((it) => it.id === parentId && it.shown) ?? proj.allItems.find((it) => it.id === parentId))
        : (stage ? (proj.allItems.find((it) => it.stage === stage && it.shown) ?? proj.allItems.find((it) => it.stage === stage)) : undefined);
      if (host) (host.blocks ??= []).push(blk);
    }
  }

  // Try to extract "Ngày cập nhật" from rows 0..6
  let updatedAt: string | undefined;
  for (let i = 0; i < Math.min(7, rows.length); i++) {
    for (const cell of rows[i] ?? []) {
      const s = str(cell);
      const m = s.match(/cập\s*nhật[^0-9]*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/i);
      if (m) {
        const iso = toIso(m[1]);
        if (iso) updatedAt = iso;
      }
    }
  }

  // Drop projects that ended up with ZERO stages in source (allItems rỗng → không có
  // gì để xuất). KHÔNG dùng items vì items đã bỏ giai đoạn 100% / Show=hide.
  const activeProjects = projects.filter((p) => p.allItems.length > 0);

  // Self-check tầng IMPORT: log số giai đoạn nạp được cho mỗi dự án.
  if (typeof console !== "undefined") {
    const summary = activeProjects.map((p) => ({
      code: p.code, name: p.name,
      stagesAll: p.allItems.length,
      stagesActive: p.items.length,
    }));
    const zero = summary.filter((s) => s.stagesAll === 0);
    console.info(`[parser] ${activeProjects.length} projects · allItems tổng ${summary.reduce((a, s) => a + s.stagesAll, 0)} dòng giai đoạn`);
    if (zero.length) console.warn(`[parser] CẢNH BÁO: ${zero.length} dự án không có dòng giai đoạn nào`, zero);
  }

  // ── CỔNG KIỂM SOÁT DỮ LIỆU: chấm điểm đầu vào ──
  const suspectPct = items.reduce(
    (a, i) => a + (i.pctPlanInvalid ? 1 : 0) + (i.pctActualInvalid ? 1 : 0), 0);
  const orphanItems = items.filter((i) => !i.projectCode).length;

  // ── TOÀN VẸN STT (ID) — khoá lưu Vướng mắc/Giải pháp = "id:<STT>" (index.tsx itemKeyOf/projectKeyOf).
  //    · TRÙNG: ≥2 dòng cùng 1 STT → chung 1 ô lưu → Vướng mắc "nhảy" sang dòng khác + đè MẤT nhau.
  //    · TRỐNG (khi file CÓ cột STT): dòng rớt về khoá-theo-tên → đổi khoá giữa các lần sync → tin
  //      "mồ côi" = MẤT. Cả hai đều ÂM THẦM (không báo lỗi) → phải bắt ở cổng dữ liệu. Chỉ soi khi
  //      idCol>=0 (file/cache cũ không có cột STT thì bỏ qua, khỏi báo nhầm). */
  let sttDupCount = 0, sttBlankCount = 0;
  const sttDupSamples: string[] = [];
  if (idCol >= 0) {
    const seen = new Map<string, number>();
    const bump = (raw: string | undefined) => {
      const v = (raw ?? "").trim();
      if (!v) { sttBlankCount++; return; }
      seen.set(v, (seen.get(v) ?? 0) + 1);
    };
    for (const p of activeProjects) {
      bump(p.id);
      for (const it of p.allItems) bump(it.id);
    }
    for (const arr of blocksByProj.values()) for (const b of arr) bump(b.blk.id);
    for (const [id, n] of seen) if (n > 1) { sttDupCount += n; if (sttDupSamples.length < 8) sttDupSamples.push(`${id}×${n}`); }
  }

  const checks: DataQualityCheck[] = [];
  const add = (id: string, bad: boolean, level: "warn" | "error", label: string, detail?: string) =>
    checks.push({ id, level: bad ? level : "ok", label, detail: bad ? detail : undefined });

  add("header", !headerOk, "error",
    headerOk ? "Header Timeline ở hàng 6: nhận diện được" : "KHÔNG nhận diện được header Timeline ở hàng 6",
    "Nguồn có thể sai tab/sai file — kiểm tra lại link (phải là tab Timeline).");
  add("projects", activeProjects.length === 0, "error",
    activeProjects.length > 0
      ? `${activeProjects.length} dự án Show (trên tổng ${parentsTotal} dòng dự án trong file)`
      : "KHÔNG có dự án Show nào có dòng công việc",
    "File không có dữ liệu quản lý được — không dùng nguồn này.");
  add("unknownPrefix", unknownPrefixCount > 0, "warn",
    unknownPrefixCount === 0
      ? "Mọi mã công đoạn đều thuộc nhóm giai đoạn đã định nghĩa"
      : `${unknownPrefixCount} dòng có mã KHÔNG thuộc nhóm giai đoạn nào (đã bỏ qua)`,
    `Ví dụ: ${unknownPrefixSamples.join(", ")} — nếu là quy ước mới của PMP, cần bổ sung vào app.`);
  add("dates", unparsedDateCount > 0, "warn",
    unparsedDateCount === 0
      ? "Toàn bộ ô ngày Kết thúc đọc được"
      : `${unparsedDateCount} ô ngày Kết thúc KHÔNG đọc được (dòng đó tính trễ = 0)`,
    "Kiểm tra định dạng ngày trong file.");
  add("pct", suspectPct > 0, "warn",
    suspectPct === 0
      ? "Toàn bộ ô % hợp lệ"
      : `${suspectPct} ô % nghi ngờ dữ liệu (đã loại khỏi phép tính, không tính sai)`,
    "Ô % ngoài khoảng [-50%, 150%] hoặc không phải số.");
  add("orphans", orphanItems > 0, "warn",
    orphanItems === 0
      ? "Mọi đầu việc đều thuộc một dự án"
      : `${orphanItems} đầu việc KHÔNG gắn được với dự án nào`,
    "Có dòng công việc đứng trước dòng dự án cha — kiểm tra thứ tự dòng trong file.");
  add("sttDup", sttDupCount > 0, "warn",
    sttDupCount === 0
      ? "Mọi STT (ID) là duy nhất — khoá lưu Vướng mắc/Giải pháp an toàn"
      : `${sttDupCount} dòng TRÙNG STT (ID) — Vướng mắc có thể nhảy sang dòng khác hoặc bị đè mất`,
    `STT bị trùng: ${sttDupSamples.join(", ")}. Mỗi dòng (dự án/hạng mục/dòng con) phải có STT RIÊNG ở cột "STT".`);
  add("sttBlank", sttBlankCount > 0, "warn",
    sttBlankCount === 0
      ? "Mọi dòng đều có STT (ID)"
      : `${sttBlankCount} dòng THIẾU STT (ID) — dễ mất/nhảy Vướng mắc khi đồng bộ`,
    "Điền STT cho mọi dòng để khoá lưu ổn định (dòng trống STT sẽ khoá tạm theo tên — đổi tên là mất tin).");

  const quality: DataQuality = {
    level: checks.some((c) => c.level === "error") ? "error"
         : checks.some((c) => c.level === "warn") ? "warn" : "ok",
    checks,
    stats: {
      parentsTotal,
      shownProjects: activeProjects.length,
      activeItems: items.length,
      allStageRows: activeProjects.reduce((a, p) => a + p.allItems.length, 0),
    },
  };

  return {
    refDate: refDateIso,
    updatedAt,
    projects: activeProjects,
    items,
    source: "upload",
    quality,
  };
}

export async function parseXlsxBuffer(buf: ArrayBuffer, refDateIso: string): Promise<ReportData> {
  const wb = XLSX.read(buf, { type: "array", cellFormula: true });
  const sheetName = wb.SheetNames.find((n) => /timeline/i.test(n)) ?? wb.SheetNames[0];
  const sh = wb.Sheets[sheetName];
  if (!sh) throw new Error("Không tìm thấy sheet Timeline trong file Excel.");
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sh, { header: 1, raw: true, defval: null });
  expandMergedNotes(sh, rows, detectColumns(rows).U);
  // Đọc CÔNG THỨC ô (cho % Block kiểu "trung bình khu" — cần AVERAGE(...) để lấy đúng các khu).
  const getFormula = (r: number, c: number): string | undefined =>
    (sh[XLSX.utils.encode_cell({ r, c })] as { f?: string } | undefined)?.f;
  return parseTimelineRows(rows, refDateIso, getFormula);
}

/** Cột "Vướng mắc / Cần xử lý" (U) trong file gốc thường bị MERGE dọc — một ô
 *  gộp phủ nhiều hạng mục (hoặc cả dự án). sheet_to_json chỉ trả giá trị ở Ô
 *  ĐẦU của vùng merge → các hạng mục phía dưới mất ghi chú. Hàm này lan giá
 *  trị tới TOÀN vùng merge theo đúng thông tin `!merges` lưu trong file —
 *  hiển thị y hệt những gì mắt thấy trên Excel, không đoán mò.
 *  CHỈ áp cho cột U để không đổi hành vi đã kiểm chứng của các cột khác. */
function expandMergedNotes(sh: XLSX.WorkSheet, rows: unknown[][], noteCol: number): void {
  const merges = (sh["!merges"] ?? []) as XLSX.Range[];
  for (const m of merges) {
    if (m.s.c > noteCol || m.e.c < noteCol) continue; // vùng merge không phủ cột Vướng mắc
    const src = rows[m.s.r]?.[m.s.c];
    if (src == null || String(src).trim() === "") continue;
    for (let r = m.s.r; r <= m.e.r; r++) {
      const row = rows[r];
      if (!row) continue;
      const cur = row[noteCol];
      if (cur == null || String(cur).trim() === "") row[noteCol] = src;
    }
  }
}

export function parseCsvText(text: string, refDateIso: string): ReportData {
  // GIỮ dòng trống (skipEmptyLines:false) để header vẫn nằm đúng index 5 và dữ
  // liệu bắt đầu từ index 7 — khớp HỆT cách XLSX đọc sheet_to_json(header:1).
  // header:false (mặc định) → trả mảng hàng thô string[][], không tự suy diễn
  // kiểu; mọi ô sẽ đi qua cùng str/num/toIso/normPctStrict như nhánh Excel.
  const out = Papa.parse<string[]>(text, { skipEmptyLines: false, header: false });
  const rows = (out.data as unknown as unknown[][]) ?? [];
  validateTimelineShape(rows);
  const parsed = parseTimelineRows(rows, refDateIso);
  // Self-check: log nếu CSV ra ít đầu việc hơn kỳ vọng để truy lệch giữa hai nhánh.
  if (typeof console !== "undefined") {
    console.info(
      `[parser/csv] rows=${rows.length} projects=${parsed.projects.length} items=${parsed.items.length}`,
    );
  }
  return parsed;
}

/** Bảo vệ: nếu CSV không phải tab Timeline (header row 6 trống/không khớp),
 *  ném lỗi rõ ràng để người dùng dán đúng link tab Timeline (có #gid=...). */
function validateTimelineShape(rows: unknown[][]): void {
  if (rows.length < 8) {
    throw new Error(
      'CSV quá ngắn (chưa tới 8 dòng). Hãy chắc chắn bạn dán link tab "Timeline" của Google Sheet (URL phải có phần #gid=... của tab Timeline).',
    );
  }
  // Dò động (như nhánh Excel): header là dòng có ô "Show" trong 15 dòng đầu.
  const detected = detectColumns(rows);
  if (!detected.detected) {
    const joined = (rows[5] ?? []).map((c) => String(c ?? "")).join(" | ").toLowerCase();
    const hasName = /(tên\s*dự\s*án|project|công\s*trình)/.test(joined);
    if (!hasName) {
      throw new Error(
        'Không phát hiện header Timeline (cột "Show"). Có thể bạn đang dán link sai tab. Mở Google Sheet → bấm vào tab "Timeline" → copy URL (URL phải chứa #gid=... của tab Timeline) → dán lại.',
      );
    }
  }
}
