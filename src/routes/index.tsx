import { createFileRoute } from "@tanstack/react-router";
import { Fragment, createContext, useCallback, useContext, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ClipboardCheck,
  EyeOff,
  FileDown,
  FileSpreadsheet,
  Highlighter,
  Image as ImageIcon,
  Link2,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  Printer,
  RefreshCw,
  Reply,
  RotateCcw,
  ScrollText,
  Search,
  Settings,
  Tv,
  Users,
  X,
} from "lucide-react";

import type { BlockChild, CodeCount, DataQualityCheck, ItemRow, ReportData } from "@/lib/types";
import {
  getFilteredProjects,
  auditFilterResult,
  projectKeyOf,
  projectKeysOf,
  classifyByMatrix,
  deadlineBucketOf,
  NEAR_DEADLINE_DAYS,
  IMMINENT_DEADLINE_DAYS,
  type AlertColor,
  type FilterCriteria,
  type StageMatcher,
} from "@/lib/filter";
import { TABLE_FONT_CSS } from "@/lib/table-scale";
import { detectStage, featureOn, type Stage } from "@/lib/flags";
import { AppShell, MTLD_INSTALL_LS } from "@/lib/app-shell";
import { VersionBanner, useUnsavedGuard, chatDraftStore } from "@/lib/version-guard";


import { toast } from "sonner";
import { parseCsvText, parseXlsxBuffer, noteSaysTrinhBodBitrix } from "@/lib/parser";
import type { XlsxTableRow, XlsxStatusColor } from "@/lib/excel-export";
import { fetchSheetCsv, fetchSheetXlsx } from "@/lib/sheets.functions";
import { getSummaryFile, getSheetPdf, recordSummaryFiles, listSheetTabs, saveInstallList } from "@/lib/mtld-install.functions";
import { readInstallLinks } from "@/lib/mtld-links";
import { fetchEdits, editMessages, fetchAppConfig, saveAppConfig, fetchUpdateHistory, recordUpdateDates, fetchCompletedDates, syncCompletedDates, fetchMpFlags, syncMpFlags, remapKeys, remapInsertShift, backupEdits, listBackups, restoreBackup, fetchNoteAnchors, syncNoteAnchors, fetchUserRoles, saveUserRole, fetchHiddenRows, setHiddenRow, getSheetViews, saveSheetView, getSheetSnap, saveSheetSnap, getProjImageIndex, getProjImage, saveProjImage, saveComplianceReportPdf, getComplianceForm, saveComplianceForm, type EditsMap, type ChatMsg, type UpdateHistory, type CompletedDates, type MpFlagFirstSeen, type NoteAnchors, type HiddenRows, type SheetViewCfg, type SheetViewMap, type ProjImgIdx } from "@/lib/edits.functions";
import { loadRegion } from "@/lib/region-load";
import { MatrixFormEditor } from "@/lib/matrix-form-editor";
import { whoami, recordActivity, fetchActivityLog, fetchAuditPosMap, backupAuditLogToDrive } from "@/lib/activity.functions";
import { actionLabel, type ActivityRow } from "@/lib/activity";
import { roleOf, ROLE_META, ALL_ROLES, DEFAULT_ROLES, type UserRole } from "@/lib/roles";
import { buildComplianceReport, SCORING } from "@/lib/compliance";
import { parseComplianceFile, type ComplianceFileData, type ComplianceFileRow, type CMark } from "@/lib/compliance-file";
import { getDaysOverdue } from "@/lib/overdue";
import {
  saveLastKnown,
  loadLastKnown,
  getDemoData,
  relativeVi,
  hoursSince,
  type CachedReport,
} from "@/lib/cache";
import { DEFAULT_SHEET_URL } from "@/lib/default-source";
import { AA_LOGO_DATA_URI } from "@/lib/aa-logo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ePMP · Projects Master Plan · PMO" },
      {
        name: "description",
        content:
          "Dashboard PMO theo dõi tiến độ Master Plan, chỉ tập trung lệch tiến độ và quá hạn thời gian, không có yếu tố tài chính.",
      },
      { property: "og:title", content: "Báo cáo tiến độ Master Plan" },
    ],
  }),
  // APP SHELL (thanh dọc trái · multi-app) — bọc app ePMP. Chỉ hiện ở dev (cờ appShell),
  // live vẫn render thẳng Dashboard. GỠ BỎ: đổi lại `component: Dashboard`. Xem lib/app-shell.tsx.
  component: RootApp,
});

/** Gốc app: banner "có bản mới" + chặn mất nháp khi tải lại (chống mất dữ liệu khi deploy). */
function RootApp() {
  useUnsavedGuard();
  return <><VersionBanner current={APP_VERSION} /><AppShell epmpApp={<Dashboard />} /></>;
}

const LS_KEY = "pmo.master.v1";
const LS_TH = "pmo.master.thresholds.v1";

/** Ghi nhận 1 thao tác vào NHẬT KÝ GIÁM SÁT. Chạy NỀN, nuốt mọi lỗi — log là phụ trợ,
 *  tuyệt đối không được làm gián đoạn thao tác chính của người dùng. Xem lib/activity.ts. */
/** CHỈ DEV: giả lập danh tính qua `?as=email` trên URL để XEM THỬ phân quyền ngay trên
 *  preview/tunnel (bản dev bỏ qua đăng nhập nên mặc định coi ai cũng là admin). Bản PROD
 *  server bỏ qua giá trị này hoàn toàn ⇒ không thể mạo danh trên bản chính thức. */
function devAs(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("as");
}

function track(action: string, detail?: string) {
  void recordActivity({ data: { action, detail: detail ?? null, devAs: devAs() } }).catch(() => {});
}

/** Tải MODULE nạp động (code-split, vd Excel/PDF export) AN TOÀN QUA CÁC LẦN DEPLOY.
 *  Mỗi lần deploy đổi TÊN HASH của chunk → trang CŨ đang mở (cache) trỏ vào tên chunk cũ đã bị
 *  xoá → 404 "Failed to fetch dynamically imported module". Bắt đúng lỗi đó ⇒ báo + TẢI LẠI trang
 *  để lấy bản mới (bấm lại chức năng là chạy). Lỗi khác (mạng/logic) thì ném tiếp như thường. */
async function loadSplit<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (e) {
    const msg = String((e as { message?: string })?.message || e || "");
    if (/dynamically imported module|Failed to fetch|module script failed|error loading dynamically/i.test(msg)) {
      toast.message("Có bản cập nhật mới — đang tải lại trang, mở lại chức năng sau khi tải xong.", { position: "bottom-left", duration: 4000 });
      setTimeout(() => { try { window.location.reload(); } catch { /* bỏ qua */ } }, 1200);
      throw new Error("Đang tải lại trang để cập nhật bản mới…");
    }
    throw e;
  }
}

/** Bơm nội dung vào ô #pmo-system-slot trên Header (portal). Slot nằm trong <Header> —
 *  component ANH EM của DashboardBody — nên không truyền props xuống trực tiếp được; portal
 *  là cách gọn nhất để đặt nút ở GÓC HEADER mà vẫn giữ toàn bộ state/dialog trong DashboardBody.
 *  Header render trước nên slot đã có trong DOM khi effect chạy. */
function HeaderSlot({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => { setEl(document.getElementById("pmo-system-slot")); }, []);
  return el ? createPortal(children, el) : null;
}

/** Phiên bản sản phẩm (semver). v1.0.0 = bản đầu tiên đưa vào sử dụng (14/07/2026).
 *  Quy ước: MAJOR.MINOR.PATCH — sửa nhỏ tăng PATCH, thêm tính năng tăng MINOR,
 *  thay đổi lớn/không tương thích tăng MAJOR. Hiển thị ở header để đối chiếu khi
 *  cần quay lại bản cũ.
 *  ── LỊCH SỬ (MỖI LẦN DEPLOY nhớ bump số này + ghi 1 dòng) ──────────────────────
 *   ⚠️ APP_VERSION giờ TỰ suy từ CHANGELOG[0].v (mảng user-facing gần const APP_VERSION). Mỗi deploy
 *      THÊM 1 mục ĐẦU mảng CHANGELOG (user-facing) + 1 dòng comment kỹ thuật ở đây.
 *   v3.48.0 (07/08/2026): publicSummaryToHtml đổi THỨ TỰ cột render (head+body) theo mẫu mới: prev ·
 *     actual · today · warn · diff (trước: actual · diff · warn · prev · today). Cột vẫn dò theo TÊN
 *     (find regex) nên đảo cột nguồn không lệch data; chỉ đổi thứ tự XUẤT. Verify data 3 dòng đầu khớp.
 *   v3.47.0 (07/08/2026): Heatmap ĐỌC MÀU THẬT từ conditional-formatting. NEW cf-colors.ts readCodeColors
 *     (unzip fflate → sheet XML <cfRule operator=equal>+formula→dxfId → styles <dxfs> fill; khoá ""=ô
 *     trống). summaryToHtml(sh, cfColors?) ưu tiên cfColors (blank→cfColors[""], mã→cfColors[mã]) thay vì
 *     đoán theo thứ tự legend (mã lưới KHÔNG khớp: blank=Chưa BG, 1=thi công, 5=Xoá Defect XANH). CF rỗng
 *     → lùi legend cũ. Verify file Mini Hotel: mã5→#00FF00 (82 ô xanh), mọi màu khớp. SummaryDialog truyền
 *     readCodeColors(bytes,name). PublicSummary/tab lạ không đổi.
 *   v3.46.0 (07/08/2026): installFid BỎ fallback maCT khi có STT (`it.id ? installLinks["id:"+it.id] :
 *     installLinks[it.maCT]`) — dự án chung mã không có link riêng hết mở NHẦM ma trận. Audit main table:
 *     mọi cột đọc per-row (it.*); chỉ PM (pmOfItem) + install link (id:STT) là lookup, đã sửa cả 2.
 *   v3.45.0 (07/08/2026): Bỏ SuspectBadge ("% nghi ngờ") khỏi OverviewStrip → trang chính sạch; cảnh báo
 *     pct vẫn trong menu Hệ thống ▸ Cảnh báo dữ liệu.
 *   v3.44.0 (07/08/2026): FIX domino PM — pmByCode khoá `p.code` → `${p.code} ${p.name}` (1 maCT nhiều
 *     dự án khác PM: Mini Hotel CT25-051 Vũ vs B6-B9 Lý). Thêm helper pmOfItem(it) tra theo mã+tên; 3
 *     lookup + 2 dep array đổi sang pmOfItem. Quét toàn src: filter.ts allByKey đã code+name, cache.ts
 *     byProject chỉ demo → an toàn; chỉ installLinks[maCT] là fallback thứ cấp (primary id:STT). parser:
 *     3 check mới sharedMaPm (maCT chung ≥2 dự án khác PM) + dupName + noPm.
 *   v3.43.0 (07/08/2026): ID CỨNG (chống lệch khoá khi STT bị đánh lại). parser: detectHidCol (header
 *     "IDCUNG"/"KEY") → ProjectRow.hid + ItemRow.projHid (kế thừa currentHid). itemKeyOf ưu tiên
 *     `h:<projHid>:<rawCode>:<dupIdx>` → id:STT → composite. projectKeyOf(+hid) → `h:<hid>`; pkProj/pkItem
 *     truyền hid (phải KHỚP nhau cho lọc). Effect di trú thêm LỚP 2: id:STT→h:hid (dự án + công đoạn +
 *     block) qua remapKeys (no-overwrite). Nguồn CHƯA có cột → hid undefined → lùi STT (an toàn, không
 *     đổi hành vi). Apps Script scripts/stamp-hard-id.gs tự cấp P0001… cho dòng dự án (cột cuối, tĩnh).
 *   v3.42.0 (07/08/2026): (1) ComplianceDialog: KHỐI IN RIÊNG (printHeaderRef+printTableRef) dựng theo
 *     mẫu master (cột Ngày CN·Điểm PM·Người PT·Tên·Lũy kế·Điểm DA·tuần, có legend, BỎ Vùng); ẩn bằng
 *     position:fixed top:100vh; doExportPdf chụp khối này thay tableRef/headerRef (màn hình giữ nguyên).
 *     BUG ĐÃ SỬA: khối in nằm trong modal print:hidden → applyExportClone xoá khỏi clone → "unexpected
 *     EOF"; khôi phục vòng gỡ print:hidden ở tổ tiên trước khi chụp (đã bỏ nhầm khi refactor). (2) Dời
 *     DataQualityBanner → DataQualityDialog mở từ ReportsMenu mục "Cảnh báo dữ liệu" (gated PMO/admin qua
 *     canSeeSystem = isAdmin||roleOf==PMO; badge amber = số check≠ok); bỏ banner ở đầu báo cáo.
 *   v3.41.0 (07/08/2026): (1) ComplianceDialog doExportPdf nhận orientation; PdfExportMenu tái dùng
 *     (thêm disabled/busy/tone/portraitHint) → bảng tuân thủ xuất khổ DỌC (wide=true) ~½ số trang so
 *     ngang (verify data thật: ngang 5 trang → dọc 2 trang). (2) parser.ts thêm 2 check STT: sttDup
 *     (≥2 dòng cùng "id:<STT>" → Vướng mắc nhảy/đè mất) + sttBlank (idCol>=0 mà trống → khoá rớt về
 *     tên → mồ côi); gom id từ projects+allItems+blocks. DataQualityBanner (index.tsx) hiện MỌI check
 *     ≠ ok ở đầu báo cáo (trước đây quality.checks tính mà KHÔNG hiển thị). STT file hiện tại: SẠCH.
 *   v3.39.0 (05/08/2026): Nhánh "tab lạ" đổi từ HTML-dump sang PDF Y HỆT: getSheetPdf (mtld-install)
 *     fetch `export?format=pdf&gid=` (Google render đủ chart + CF), cache `spdf:fid:gid` ghim ngày;
 *     SummaryDialog hiện `<iframe data:application/pdf>`. PDF lỗi (xlsx không nhận gid) → fallback sheetToHtml.
 *   v3.38.0 (05/08/2026): SummaryDialog dispatch 3 nhánh theo tên tab: /public summary/→cột;
 *     /summary/→heatmap; CÒN LẠI→sheet-dump.ts sheetToHtml (đổ nguyên sheet: value .w + fill tĩnh +
 *     merge, bám vùng nội dung thật, cap 200×80). Cho tab chưa đồng bộ form xem nhanh như ảnh chụp.
 *   v3.37.0 (05/08/2026): VIẾT LẠI summaryToHtml BÁM CẤU TRÚC (chạy mọi biến thể heatmap). Ô lưới =
 *     MÃ SỐ; màu do conditional-formatting (SheetJS đọc không ra) → dựng bảng MÃ→MÀU từ LEGEND (ô "Màu"
 *     có fill tĩnh; mã theo cột "Nhập/Mã" nếu có else thứ tự). Block nhận qua hàng có "01"&"02" (nhãn
 *     A/B/C/D hay B1..Bn); cột đơn vị=số/HL, cột %=chữ (Mặt bằng/giao thô…); dòng dữ liệu lấy hết tới
 *     block kế; X=xám, trống=trắng. Verify 2 file thật (Nam Phương A/B/C/D 5 mã, Mini B1-B5 7 mã).
 *   v3.36.3 (05/08/2026): Mốc làm mới cache Summary đổi 08:00 → 17:30 VN. mtld-install.functions:
 *     REFRESH_HOUR_VN=17 + REFRESH_MIN_VN=30 (lastRefreshBoundary +REFRESH_MIN_VN*60_000). Cron warmer
 *     warmer/wrangler.toml "0 1 * * *" → "30 10 * * *" (10:30 UTC = 17:30 VN). 2 mốc PHẢI khớp nhau.
 *   v3.36.2 (05/08/2026): refreshAndStore fallback — gid-export lỗi (HTTP 400: file .xlsx-in-Drive
 *     không nhận `&gid=`) → tải NGUYÊN file (không gid) + extractSummaryXlsx("Summary"). File native
 *     (1le0, 2 tab) gid vẫn chạy. Fix popup heatmap "HTTP 400" ở dự án dạng phòng.
 *   v3.36.1 (05/08/2026): Fix ĐỤNG KHOÁ link matrix — mtld-links dò cột STT, gắn link theo TỪNG DÒNG
 *     `map["id:"+STT]` (fallback maCT); renderRow tra `installLinks["id:"+it.id] ?? [maCT]` → 1 dự án
 *     nhiều matrix (phòng/Public) không đè nhau. dvn (public-summary-render) đổi serial Excel + ISO →
 *     dd/mm/yyyy (client parse không bật cellDates nên ô ngày ra số serial).
 *   v3.36.0 (05/08/2026): Popup "Thi công lắp đặt" hỗ trợ DẠNG THỨ 2. mtld-links bắt thêm `gid` từ
 *     hyperlink → mã hoá "fileId|gid"; getSummaryFile nhận gid → tải `export?xlsx&gid=` (ĐÚNG 1 tab,
 *     ~23KB, khỏi tách extractSummaryXlsx) cache theo fileId:gid. SummaryDialog đọc TÊN sheet: "Public
 *     Summary" → publicSummaryToHtml (bảng + biểu đồ cột SVG, đường KH lấy cột "Kế hoạch/KH raw" điền
 *     nhiều số nhất); còn lại → summaryToHtml (heatmap, KHÔNG đổi). recordSummaryFiles bỏ "fileId|gid".
 *   v3.35.3 (04/08/2026): Data bar "Số lần không cập nhật" (ComplianceDialog) đổi mẫu số maxRequired
 *     từ "số tuần ≤ hôm nay" sang data.weeks.length (TỔNG tuần trong tháng) → count/tổng-tuần.
 *   v3.35.2 (04/08/2026): Data bar cột "Số lần không cập nhật" (ComplianceDialog) đổi bg-red-300→
 *     bg-blue-300, text-red-700→text-blue-700 (sếp không dùng đỏ).
 *   v3.35.1 (04/08/2026): Đổi thứ tự sort "Tình trạng" sang GOM THEO MÀU — late 7 · trim đỏ 6 ·
 *     focus đỏ 5 · trim vàng 4 · focus vàng 3 · none 1 · done 0 (tất cả ĐỎ trước tất cả VÀNG).
 *   v3.35.0 (04/08/2026): Sort cột "Tình trạng" (SortKey "alert") xếp theo rank nghiêm trọng 7 mức —
 *     late 7 · trim đỏ 6/vàng 5 · focus đỏ 4/vàng 3 · none 1 · done 0. XÉT mốc ≥100% (done) TRƯỚC khi
 *     tra _alert để bám ĐÚNG badge "Đã hoàn thành" (badge xanh ưu tiên hơn _alert ở renderRow). Đỏ/vàng
 *     lấy từ _alertColor. desc-first ⇒ nặng nhất trên đầu; bấm lần 2 = asc = đảo chiều.
 *   v3.34.1 (04/08/2026): Dòng "SD" (Shop Drawing) xếp NGAY TRƯỚC "TKSX". Thêm STAGE_ABBR_ORDER +
 *     stageRankByAbbr (theo VIẾT TẮT: TK,BG,MA,VT,SD,TKSX,SX,TC) dùng cho sort "list" (bảng) + sort
 *     dòng con Gantt (thay STAGE_ORDER.indexOf theo internal id — vốn để SHOP=90 & TKSX rớt cuối ở Gantt).
 *   v3.34.0 (04/08/2026): Bấm badge phiên bản (header) → dialog "CÓ GÌ MỚI" liệt kê CHANGELOG theo bản
 *     (ChangelogDialog + mảng CHANGELOG user-facing; APP_VERSION = CHANGELOG[0].v).
 *   v3.33.3 (31/07/2026): Gantt — băng đỏ "Tuần hiện hành" phủ luôn viền dưới mỗi hàng (bottom:-1 thay
 *     height:h) → hết vạch trắng ngang cắt qua băng đỏ khi hiện nhiều hàng (bấm "hiện việc đã xong").
 *   v3.33.2 (31/07/2026): Badge "Đã hoàn thành" (xanh) BỎ icon tick, chỉ giữ chữ. Gỡ import Check thừa.
 *   v3.33.1 (31/07/2026): Sửa chính tả tên bộ phận "Projects Planning" → "Project Planning" (header
 *     index.tsx + footer trang đăng nhập auth-pages.ts).
 *   v3.33.0 (31/07/2026): TKSX — ô công đoạn nhập TIỀN TỐ KHÁC (vd "PC - Tên", "SHD - Tên") thì KHÔNG
 *     nhét vào "SD - …" nữa; hiện "PM - {PM dự án}, SD, PC - Tên" (SD trống + giữ nguyên tiền tố khác).
 *     picByStageConv case SD: regex bắt "CODE - tên"; CODE=SD → "SD - tên"; CODE khác → "SD, CODE - tên";
 *     không tiền tố dạng đó → dùng `bare` (bỏ tiền tố quen đứng một mình, vd ô chỉ "PM" → "SD").
 *   v3.32.0 (31/07/2026): NHẬT KÝ GIÁM SÁT — bộ lọc PHÂN LỚP (cascading): dropdown "Người" chỉ liệt kê
 *     tài khoản CÓ hoạt động trong CỬA SỔ NGÀY đang chọn (vd "Hôm nay" → chỉ người active hôm nay);
 *     dropdown "Thao tác" cũng lọc theo Người/Tìm. Cách làm: load tải MỌI người trong cửa sổ ngày
 *     (email:null, lọc Người ở CLIENT); whoOpts/actionOpts dựng kiểu optionUniverse (trừ chính filter,
 *     giữ giá trị đang chọn). Bỏ state `users` (server). limit 1000→2000.
 *   v3.31.1 (31/07/2026): Tên PM (TC/TKSX) lấy TÊN ĐẦU TIÊN của người phụ trách dự án (pmFirstOf) —
 *     tên sau dấu "/" là DPM, bỏ. VD "Nguyễn Văn Cừ / Thanh Bình" → "PM - Nguyễn Văn Cừ".
 *   v3.31.0 (31/07/2026): Tên PM ở công đoạn TC + TKSX LUÔN lấy từ NGƯỜI PHỤ TRÁCH CẤP DỰ ÁN (trên
 *     xuống), KHÔNG đọc từ ô công đoạn. Fix bug: ô TKSX nhập "SD - Tuấn Khanh" trước ra "PM - Tuấn
 *     Khanh" (sai) → nay "PM - {PM dự án}, SD - Tuấn Khanh". picByStageConv thêm tham số projectPm
 *     (truyền it._projectPm/bit._projectPm ở 6 chỗ gọi); ô TKSX giờ = người SD.
 *   v3.30.2 (31/07/2026): Nhóm cảnh báo "Bám sát kế hoạch" đổi từ <20% thành ≤20% (mốc 20% nay thuộc
 *     nhóm này): filter.ts gapLevel `g > FOCUS_GAP_MIN ? 2 : 3` (bậc 2 = >20–40); dialog nhãn "≤ 20%"
 *     + nhóm giữa "> 20 – 40%"; chú thích "lệch X điểm" chỉ khi gap > 20.
 *   v3.30.1 (31/07/2026): Dời nút "Trình chiếu TV" từ toolbar VÀO dropdown "Hệ thống" (ReportsMenu),
 *     hiện cho MỌI người (không riêng admin), có nhãn ĐANG BẬT khi active. tvMode chuyển lên DashboardBody.
 *   v3.30.0 (31/07/2026): NÚT "TRÌNH CHIẾU TV" — fullscreen CẢ app (requestFullscreen như F11) + BỎ
 *     giới hạn 1600px cho <main> (class .tv-mode trên body, CSS ở styles.css) → bảng lấp đầy màn TV
 *     4K/55" ⇒ cỡ chữ (cqw) tự phóng theo tỉ lệ (~11px→~27px trên 4K) mà KHÔNG tràn ô (thiết kế co
 *     giãn tỉ lệ). NHỚ trạng thái qua localStorage `pmo-tv-mode` để mở lại trên TV vẫn to. Khác nút
 *     "Toàn màn hình" (chỉ fullscreen table). Đã đo: 2400px→16.3px, không tràn ngang/ô.
 *   v3.29.0 (31/07/2026): BỘ LỌC "PM" — lọc theo Người phụ trách chính CẤP DỰ ÁN, lấy TÊN ĐẦU TIÊN
 *     (pmFirstOf: tách "/"","xuống dòng). Áp cho CẢ bảng Danh sách LẪN Gantt (chung pipeline lọc).
 *     Filters.pms + pmOptions (bỏ "—") + 6 khối lọc + filterSummary/hasAnyFilter/activeCount. Khối
 *     đếm dự-án-hoàn-thành dùng p.pm (raw ItemRow không có _projectPm).
 *   v3.28.0 (31/07/2026): ẨN DÒNG cũng áp cho bảng "Tổng thể tiến độ" (Gantt): nút ẩn (rê chuột)/bỏ ẩn
 *     ở dòng HẠNG MỤC — dòng con (khi xổ) + chế độ lọc hạng mục. onHideRow đổi chữ ký (key,label,hide)
 *     dùng CHUNG Danh sách + Gantt; GanttRow/GanttChild mang hideKey+hidden; GanttView nhận isAdmin/
 *     showHidden/onHideRow. Dòng dự án (gộp) KHÔNG ẩn (không phải 1 hạng mục). Chung kho hidden:v1.
 *   v3.27.0 (31/07/2026): Bảng "Tổng thể tiến độ" (Gantt) thêm cột "Ngày update" TRƯỚC cột Mã (chip
 *     màu y hệt bảng Việc cần xử lý). GanttRow.updateDate (2 builder flat+dự án); LC thêm cột sticky
 *     đầu, numCol dịch +1, cột đậm i===2, dòng con để trống ô ngày.
 *   v3.26.0 (31/07/2026): ẨN DÒNG THỦ CÔNG (admin) — hạng mục "trong khuôn khổ, không đáng raise" ẩn
 *     khỏi báo cáo (bảng + KPI + PDF + Excel cho MỌI người). Rê chuột dòng item → nút mắt-gạch (admin,
 *     print:hidden) ẩn dòng; toolbar hiện "Dòng đã ẩn (N)" → bật soi lại (làm mờ + nút Bỏ ẩn). Kho KV
 *     `hidden:v1` (edits.functions: fetchHiddenRows/setHiddenRow, chốt quyền ADMIN); lọc ở tầng `enriched`
 *     (tách enrichedAll cho effect đồng bộ để không xoá nhầm); ghi vết hide_row/unhide_row vào Nhật ký.
 *     LƯU Ý: ẩn HẾT item của 1 dự án → dự án biến khỏi bảng (không còn gì để hiện) — đúng thiết kế.
 *   v3.25.0 (31/07/2026): Mở rộng quyền PMO trong box chat: PMO giờ SỬA + ẨN + XOÁ được comment NGƯỜI
 *     KHÁC (ngang admin ở 3 thao tác này; trước v3.21 chỉ ẩn). ChatCell/ChatBox: canEdit=canHide gồm PMO,
 *     nút Xoá theo canDelete=admin||PMO. Server editMessages: nhánh edit + delete + hide đều thêm callerIsPmo.
 *   v3.24.0 (31/07/2026): Thêm nhận diện hạng mục: mã "SD" → "Shop Drawing" (id nội bộ "SHOP" vì
 *     "SD" đã bị chiếm cho Triển khai sản xuất/TKSX); trước đây SD rơi vào "Khác". Mã "PS" → "Phát
 *     sinh" vốn đã có sẵn. SHOP xử như "Khác" (ngoài 7 giai đoạn, VẪN xét cảnh báo — khác PS miễn trừ).
 *   v3.23.0 (31/07/2026): XUẤT EXCEL "Y HỆT BẢNG/PDF": bỏ format matrix cũ, dùng exportTableXlsx
 *     (excel-export.ts) — CÙNG 11 cột bảng gộp (Ngày update…Giải pháp), dòng DỰ ÁN (nền navy, ngày
 *     kết thúc đỏ nếu quá hạn) + dòng CÔNG ĐOẠN con (outline ẩn sẵn, xổ +/−), ô Tình trạng tô màu
 *     đỏ/vàng/xanh + text (Trễ tiến độ/Cần cắt đầu việc/Cần tập trung/Đã hoàn thành). Khác PDF ở chỗ
 *     là Ô THẬT (lọc/sort/sửa trong Excel). Dựng từ chính dueMonthGroups (cùng nguồn bảng).
 *   v3.22.0 (31/07/2026): XUẤT PDF sửa TẬN GỐC lỗi cắt trang (ngang + dọc dùng CHUNG logic): ĐO ranh
 *     giới hàng NGAY TRONG CLONE html2canvas (đúng toạ độ ảnh) thay vì DOM sống — vì clone đổi font
 *     (Segoe UI) + gỡ control nên chiều cao hàng khác DOM sống (Inter), đo DOM sống → cắt LỆCH → header
 *     đè đỉnh hàng + hàng bị cắt ngang qua trang. Nay: header KHÔNG đè, "qua trang thì qua HẾT hàng"
 *     (không cắt đôi), header lặp cắt trên ĐÚNG mép hàng đầu → hết vệt xanh. Bỏ chụp thead riêng
 *     (slice từ cùng 1 ảnh, mốc chung → không hở/chồng). Có fallback đo DOM sống nếu clone chưa layout.
 *   v3.21.0 (31/07/2026): PHÂN QUYỀN box chat Vướng mắc/Giải pháp: cấp PMO giờ ẨN/mở ẩn được comment
 *     của NGƯỜI KHÁC (trước chỉ tác giả/admin). Tách canHide (tác giả/admin/PMO) khỏi canEdit (tác
 *     giả/admin) ở ChatCell + ChatBox; server chốt quyền `callerIsPmo` (đọc roles:v1, seed DEFAULT_ROLES)
 *     trong nhánh hide/unhide. SỬA text vẫn chỉ tác giả/admin, XOÁ vẫn chỉ admin.
 *   v3.20.1 (31/07/2026): Bộ lọc "Cần cập nhật MP": cột Tình trạng dùng CHUNG lưới badge màu giai
 *     đoạn (SX/TC/VT/TKSX/MA/BG…) y hệt bảng mặc định — BỎ badge chữ "CẬP NHẬT MP" (thừa, mọi dòng
 *     giống nhau). Giờ bảng lọc MP giống hệt bảng mặc định, chỉ khác tập dự án được lọc.
 *   v3.20.0 (31/07/2026): Bộ lọc "Cần cập nhật MP" — 2 sửa: (A) HIỂN THỊ y hệt bảng gộp mặc định
 *     (gộp theo dự án, nền navy/emerald, xổ ra công đoạn) thay vì bảng gộp 1-dòng-1-dự-án riêng;
 *     CHỈ khác cột "Tình trạng" → thay ma trận 7 giai đoạn bằng 1 badge "CẬP NHẬT MP" (đỏ nếu ≥3
 *     hạng mục đang làm, vàng nếu ít hơn). (B) QUÉT ĐÚNG: dấu hiệu DUY NHẤT = vướng mắc cấp dự án
 *     có cụm "trình BOD phê duyệt (Bitrix)" (parser noteSaysTrinhBodBitrix: đòi cụm liền "trình BOD
 *     (phê) duyệt" + "bitrix"). BỎ gộp cờ cột "Cần cập nhật MP" của file + các ghi chú "cập nhật MP"
 *     chung chung (trước lọc phình 19 thay vì 14, lọt 43 ĐTM). Quét cả file (projectNote cột U) lẫn
 *     box chat app. mpInfo là nguồn sự thật chung cho bảng phẳng lẫn bảng gộp.
 *   v3.19.0 (31/07/2026): BỘ LỌC "Cần cập nhật MP" quét thêm nguồn thứ 2 = VƯỚNG MẮC CẤP DỰ ÁN
 *     nhập trong app (box chat, message CHƯA ẩn): nếu có cụm "trình BOD phê duyệt (Bitrix)" ⇒ tự đưa
 *     dự án vào nhóm Cần cập nhật MP (luật parser noteMentionsMpUpdate rule D: bod + duyệt + bitrix,
 *     chịu biến thể chữ). Gom về 1 nguồn sự thật `mpInfo` (union cờ file p.needsMpUpdate + quét chat)
 *     dùng CHUNG cho bảng phẳng lẫn bảng gộp → danh sách không lệch.
 *   v3.18.0 (30/07/2026): XUẤT PDF làm lại: (1) nút gộp DROPDOWN "Xuất PDF ▼" → chọn khổ NGANG / DỌC
 *     (dọc cho điện thoại / in A4 dọc). (2) Ép font "Segoe UI" khi chụp (html2canvas) → hết bóp chữ /
 *     chèn dấu cách ngày / cắt cột Mã, và ra GIỐNG NHAU trên Chrome/Edge/Cốc Cốc. (3) Ép bề rộng chụp
 *     1532px (ổn định mọi màn, không "20 trang khi màn hẹp"; vẫn đúng tỉ lệ cột đã kéo vì colW là %).
 *     (4) CẮT TRANG chuẩn: KHÔNG cắt ngang hàng (gom hàng nguyên + đệm an toàn; hàng cao hơn 1 trang thì
 *     thu vừa), header lặp mỗi trang CHỤP RIÊNG (hết vệt XANH của dòng "đã bàn giao" dính vào header),
 *     cắt bằng floor/ceil (hết clip đỉnh hàng đầu). Bảng tuân thủ: điểm dự án & PM IN ĐẬM, <50 = ĐỎ.
 *   v3.17.2 (30/07/2026): Chú thích báo cáo tuân thủ dàn 1 HÀNG đều nhau: điểm dự án · điểm PM (phân
 *     số) · BẢNG ký hiệu (✓/o/✕ có viền) bên phải; whitespace-nowrap hết rớt dòng "−10 điểm", 3 khối
 *     top-align, justify-between dàn đều.
 *   v3.17.1 (30/07/2026): Báo cáo tuân thủ — chú thích ĐẦY ĐỦ cách tính điểm: điểm dự án (khởi 100đ;
 *     không cập nhật sau 12h T5 −25đ; trễ 22h T4–12h T5 −10đ) + công thức điểm PM (Σ điểm dự án ÷ Σ số
 *     dự án PM quản). Đặt trong headerRef nên hiện cả trên PDF xuất ra.
 *   v3.17.0 (30/07/2026): (1) PHÂN CẤP NGƯỜI DÙNG (Hệ thống · chỉ admin): gán email → cấp PMO/BOD để
 *     hiện badge trong comment; admin TỰ thêm/gỡ, KHÔNG cần sửa code. Kho KV roles:v1 (edits.functions),
 *     seed DEFAULT_ROLES khi trống; badge đọc động qua RolesCtx. Thêm cấp mới sau: nới ALL_ROLES +
 *     ROLE_META (lib/roles.ts). (2) Nhật ký giám sát: sửa bộ lọc — "Hôm nay" theo NỬA ĐÊM địa phương
 *     (hết lọt ngày hôm trước do trước dùng 24h trượt); lọc ĐA LỚP (Ngày∧Người∧Thao tác∧Tìm) enforce
 *     ở client.
 *   v3.16.1 (30/07/2026): Ví dụ "Cụ thể, rõ việc, rõ người, rõ deadline" áp cho CẢ Vướng mắc lẫn Giải
 *     pháp (trước chỉ Giải pháp). Badge BOD đổi sang ĐỎ chữ VÀNG (#C00000 / #FFD700).
 *   v3.16.0 (30/07/2026): Comment Vướng mắc/Giải pháp: (1) BADGE chức vụ trước tên — PMO (navy) / BOD
 *     (gold), map email trong lib/roles.ts (tạm hardcode, sau thay bằng file Excel email+chức vụ);
 *     (2) ô SỬA tin to hơn (rows 5, min 7rem, vẫn kéo resize được); (3) ví dụ cột Giải pháp gọn còn
 *     "Cụ thể, rõ việc, rõ người, rõ deadline"; (4) bỏ dòng nhãn xanh "· box chat lưu vết" trong
 *     dialog (giữ title đen).
 *   v3.15.2 (29/07/2026): Bỏ chỉ báo "+N đã ẩn" / "(N đã ẩn)" ở ô Vướng mắc/Giải pháp (tin ẩn vẫn xem
 *     được khi mở ô) — gọn bảng theo yêu cầu.
 *   v3.15.1 (29/07/2026): Dòng con hạng mục lấy NGÀY (Bắt đầu/Kết thúc) RIÊNG từ chính dòng trong
 *     file (coi cột ngày như data tự nhập) — chỉ kế thừa ngày hạng mục cha khi ô trống.
 *   v3.15.0 (29/07/2026): DÒNG CON hạng mục nhận diện TỔNG QUÁT theo CẤU TRÚC STT ID (dòng con = ID
 *     giai đoạn cha + hậu tố CHỮ: xy.za, xy.zb) → thêm dòng con cho BẤT KỲ giai đoạn nào (VT, SX, TC,
 *     TKSX…) là app TỰ HIỆN, không cần sửa code từng lần. Gắn vào cha theo ID. Nguồn không có cột STT
 *     → fallback mã cứng /^(TC|TKSX)\d+$/. (VD: SX của Mini Hotel PQ Public tự xổ SX1..SX5.)
 *   v3.14.0 (29/07/2026): Bảng "Đánh giá tuân thủ cập nhật Master Plan" thêm nút XUẤT PDF (A4 ngang,
 *     đúng như đang xem — theo sort/lọc Vùng hiện tại), dùng chung engine html2canvas với bảng Danh
 *     sách. FIX: onclone của pdf-export xoá mọi phần tử print:hidden ⇒ xoá luôn cả dialog (root có
 *     print:hidden) → tạm gỡ print:hidden ở tổ tiên bảng trước khi chụp; recencyStyle đổi hsl sang
 *     cú pháp phẩy cho tương thích. Dấu ✓/✕ (đúng hạn/không cập nhật) đổi TỪ icon SVG lucide SANG
 *     ký tự unicode — html2canvas render SVG không ổn định làm PDF mất/méo dấu (đã soi pixel đúng màu).
 *   v3.13.0 (29/07/2026): (1) MATCH DỮ LIỆU THEO ID (cột STT) thay cho tên: đọc ID phân cấp
 *     (dự án 70 / hạng mục 70.1 / block 70.1a) từ file, khoá vướng mắc/giải pháp/ngày kết thúc/lịch
 *     sử update theo ID → đổi tên dự án KHÔNG mất ghi chú. Di trú 1 lần khoá tên cũ → ID (không mất
 *     data, chỉ chạy khi còn khoá cũ). ID chỉ dùng ngầm, không hiện UI. (2) REPLY vướng mắc: nút ↩
 *     trên mỗi bong bóng vướng mắc → mở box Giải pháp cùng dòng kèm trích dẫn; tin giải pháp hiện
 *     header "↩ …" chỉ rõ đang trả lời vướng mắc nào. (3) DROPDOWN "Triển khai sản xuất" (TKSX):
 *     hạng mục TKSX có dòng con Mã TKSX1..TKSXn → xổ ra Block 1..n Y HỆT "Thi công lắp đặt" (cả bảng
 *     Danh sách lẫn Gantt); dùng chung logic Block (giao thô/tinh hoặc TB khu, tự dò).
 *   v3.12.1 (29/07/2026): Bong bóng Vướng mắc/Giải pháp gọn lại: NGÀY ra badge màu color-scale phía
 *     trước (gần hôm nay=xanh, xa=đỏ); tên bỏ đuôi @domain (chỉ "tienthn"); tin "(cũ)" chỉ hiện ngày;
 *     góc phải icon ✎ (bỏ chữ) + icon MẮT-GẠCH để ẩn; bỏ "đã sửa" + bỏ giờ; chữ ĐEN không làm mờ.
 *     RULE: chỉ TÁC GIẢ (hoặc admin) mới SỬA/ẨN tin của mình — chốt quyền cả ở server.
 *   v3.12.0 (29/07/2026): Vướng mắc/Giải pháp trên BẢNG — mỗi tin = 1 BONG BÓNG CHAT vàng nhạt
 *     (bo góc 1 bên), hiện luôn NGƯỜI NHẬP (email) + NGÀY GIỜ. Thêm SỬA: tác giả sửa tin của mình
 *     (admin sửa tất) — sửa ngay ngoài bảng (nút ✎ Sửa trong bong bóng) HOẶC trong dialog; có mốc
 *     "đã sửa". TÔ MÀU: admin nhấp đúp 1 BONG BÓNG → CHỈ tin đó đổi màu (đúp lại bỏ). Hàng cấp DỰ
 *     ÁN giữ kiểu cũ. (backend: op "edit" chốt quyền tác-giả/admin ở server).
 *   v3.11.3 (29/07/2026): Box chat Vướng mắc/Giải pháp — bấm ra NỀN NGOÀI KHÔNG còn tự đóng (tránh
 *     mất tin đang soạn khi lỡ misclick); CHỈ nút X mới tắt. (khôi phục hành vi cũ bị mất khi rework)
 *   v3.11.2 (29/07/2026): Box chat — thêm lại VÍ DỤ minh hoạ cách viết (như dialog cũ) ngay trên ô
 *     soạn, khác nhau theo cột: Vướng mắc (ai làm gì, trước khi nào) · Giải pháp (người + mốc).
 *   v3.11.1 (29/07/2026): Box chat — (a) chú thích ô soạn gọn lại "Gửi rồi KHÔNG thể xoá". (b) TÔ
 *     MÀU trở lại: admin NHẤP ĐÚP ngay trên Ô ở bảng → tô CẢ Ô (Vướng mắc đỏ · Giải pháp navy),
 *     nhấp đúp lại thì bỏ; 1 click vẫn mở ô. Hàng cấp DỰ ÁN giữ nguyên (không tô).
 *   v3.11.0 (28/07/2026): VƯỚNG MẮC & GIẢI PHÁP → BOX CHAT lưu vết. Mỗi mục là 1 message có NGÀY +
 *     EMAIL người nhập (track qua phiên); bảng chỉ hiện message KHÔNG ẩn (ẩn = đã giải quyết, vẫn
 *     xem được khi mở ô). KHÔNG cho xoá — chỉ ẨN/MỞ ẨN; CHỈ ADMIN được xoá hẳn. Admin nhấp đúp 1 từ
 *     để tô/bỏ tô đỏ (theo từng message). MIGRATE vướng mắc/giải pháp cũ → message "(cũ)", KHÔNG mất.
 *     Áp cho cả đầu việc · Block con · hàng gộp dự án. (backend: editMessages + migrate-on-read).
 *   v3.10.4 (28/07/2026): Client gửi TOÀN BỘ fileId install-link vào registry khi load → worker
 *     cron phụ (baocao-tiendo-warmer, cron 8h VN) warm SẴN ma trận lắp đặt mọi dự án mỗi sáng.
 *   v3.10.3 (28/07/2026): getSummaryFile ghi fileId vào REGISTRY (KV sfile:index) mỗi lần fetch →
 *     nền tảng cho WORKER CRON phụ (baocao-tiendo-warmer) warm Summary sẵn mỗi sáng 8h VN.
 *   v3.10.2 (28/07/2026): Popup % Block hiện ĐÚNG theo dự án: (a) Phòng — % = "đã giao thô" (kèm
 *     số căn giao thô + giao tinh; sửa lỗi HOÁN tinh↔thô). (b) Public — % = TRUNG BÌNH tiến độ các
 *     khu: đọc CÔNG THỨC AVERAGE trong file → liệt kê đúng từng khu (Lobby/Res/Gym/Spa…) + %.
 *   v3.10.1 (28/07/2026): Summary — đổi mốc quét ghim-theo-ngày 06:00 → 08:00 giờ VN (báo cáo ma
 *     trận lắp đặt tự làm mới lần mở đầu sau 8h sáng, rồi ghim nguyên ngày). Xem REFRESH_HOUR_VN.
 *   v3.10.0 (28/07/2026): DROPDOWN "Thi công lắp đặt" — hạng mục TC có dòng con Block 1..5 (Mã
 *     TC1..TCn trong file) → bấm ▶ xổ ra. Mỗi Block là ĐẦU VIỆC đầy đủ: kế thừa người phụ trách/
 *     ngày/dự án từ dòng TC, tự tính quá hạn + cảnh báo, vướng mắc/giải pháp sửa được. Bấm % Block
 *     → popover bàn giao tinh/thô. Áp cho CẢ bảng Danh sách LẪN Tổng thể tiến độ (Gantt cũng dropdown).
 *   v3.9.7 (28/07/2026): HOÀN NGUYÊN v3.9.2 — ô SX (NMSX) trên Gantt về lại NHIỀU Ô VUÔNG rời từng
 *     tuần (không dùng dải liền). Legend SX cũng về ô vuông nhỏ.
 *   v3.9.6 (28/07/2026): Summary TẢI NHANH — cache KV đổi từ 10' → GHIM THEO NGÀY + tự làm mới
 *     nền (stale-while-revalidate): bấm luôn trả cache tức thì, chỉ âm thầm fetch bản mới ở nền khi
 *     cache cũ hơn mốc 06:00 VN (đổi REFRESH_HOUR_VN). Nút "Làm mới" vẫn lấy live. Hết cảnh chờ Drive.
 *   v3.9.5 (28/07/2026): Summary bảng chỉ số — BỎ tô vàng cả hàng "Hôm nay" + cột cuối (bê từ
 *     file); thay bằng highlight ĐỘNG: chỉ tô vàng ô "Hôm nay" có giá trị ≠ 0 (ô vừa thay đổi).
 *   v3.9.4 (28/07/2026): Summary — % lắp đặt = 100% (giá trị 1.0) không còn bị bỏ trống; nhận
 *     v > 0 && v <= 1 (trước là < 1 nên 100% ra ô rỗng). Áp cho cả giao thô/tinh/xoá defect.
 *   v3.9.3 (28/07/2026): Popup Summary (ma trận lắp đặt) mỗi block THÊM cột "Đã giao thô" (data-bar
 *     CYAN #00FFFF) đứng TRƯỚC "Đã giao tinh" — đọc từ cột giao thô mới chèn trong file import.
 *     Nhận diện cột theo CHỮ header nên chèn cột không lệch; file cũ (không có giao thô) vẫn chạy.
 *   v3.9.2 (28/07/2026): Gantt "Tổng thể tiến độ": ô SX (Nhà máy sản xuất) đổi từ NHIỀU Ô VUÔNG
 *     rời từng tuần → MỘT DẢI ĐỎ LIỀN MẠCH (giữ viền đen). Hết cảnh "cắt cắt / line trắng" khi
 *     bật "Hiện tất cả đầu việc". Legend SX chỉnh cùng hình dải.
 *   v3.9.1 (28/07/2026): (a) NGÀY KẾT THÚC THỰC TẾ: hạng mục đạt 100% → gạch ngang ngày kế hoạch +
 *     thêm dòng ngày thực tế (ngày lần đầu 100%, lưu KV completed:v1); rớt <100% tự về như cũ.
 *     (b) Ô đỏ SX (NMSX) thêm VIỀN ĐEN. (c) Bảng tuân thủ đổi tab nguồn (gid 490936703).
 *     (d) Header tuần HIỆN HÀNH: nền #00B050 chữ trắng (thay trắng/đen).
 *   v3.9.0 (28/07/2026): (1) Nhãn: "Mô tả"→"Tên dự án / Hạng mục", "Deadline cam kết"→"Ngày kết
 *     thúc" (2 bảng), legend Gantt "Quá hạn". (2) NHẬT KÝ ghi file tải: ai · lọc gì · số dự
 *     án/đầu việc · mã. (3) Cột % thực tế: MỌI ô bấm được (trống→"chưa nhập"; chấm VÀNG khi thiếu/
 *     không có số mã/lệch). (4) Nút "Hiện tất cả đầu việc" (cả 2 bảng, trái "Mở tất cả") + badge
 *     "Đã hoàn thành" xanh lá cho việc 100% (nguồn allItems — chỉ hiện trên data THẬT). (5) Bảng
 *     tuân thủ: đổi thứ tự cột (PM·Vùng·Tên·Điểm·Số lần·Cập nhật·tuần); "Số lần" có DATA BAR
 *     (0→số lần phải cập nhật tới hôm nay); "Cập nhật gần nhất" COLOR SCALE xanh→đỏ theo độ mới.
 *   v3.8.9 (28/07/2026): FIX lỗi "Failed to fetch dynamically imported module" khi Xuất Excel/PDF
 *     NGAY SAU DEPLOY (bản deploy đổi tên hash chunk → trang cũ đang mở trỏ chunk cũ đã bị xoá).
 *     Bọc dynamic import bằng loadSplit: gặp lỗi chunk cũ ⇒ báo + TẢI LẠI trang lấy bản mới. (PDF
 *     vẫn xuất KPI + thẻ giai đoạn + bảng đang xem như cũ.)
 *   v3.8.8 (28/07/2026): Bảng tuân thủ mặc định XẾP THẤP → CAO theo điểm TB PM (PM điểm thấp/cần
 *     chú ý lên đầu).
 *   v3.8.7 (28/07/2026): Gantt: thanh DÒNG CON đổi nền NAVY #334964 + phần XANH LÁ (#5ee9b5) =
 *     % thực tế đè lên; ô đỏ SX (Nhà máy sản xuất) đổi #c00000 → #f87171 (coral sáng/nhạt hơn,
 *     hợp nền navy).
 *   v3.8.6 (28/07/2026): Bảng tuân thủ — THIẾT KẾ LẠI MÀU (data-viz: dồn màu vào KPI + tô ngoại
 *     lệ). Điểm dự án = chữ RAG (xanh≥80/vàng50-79/đỏ<50); điểm PM = badge RAG 3 mức (đầu đề nhóm);
 *     dấu ✔/o/x BỎ khối nền → glyph (✔ xanh nhạt lùi, x đỏ nổi, o vàng); ngày cập nhật BỎ nền, chữ
 *     trơn chỉ đỏ khi quá cũ (>21 ngày). Giảm từ ~450 khối màu xuống 31 badge PM → hết sặc sỡ.
 *   v3.8.5 (28/07/2026): Bảng tuân thủ: đổi chỗ cột "Điểm" ↔ "Số lần không cập nhật"; XẾP nhóm
 *     theo ĐIỂM TB PM (trong nhóm, dự án cũng xếp theo điểm CÙNG CHIỀU); TÔ MÀU tuần hiện hành
 *     theo LỊCH (cột đầu tiên có ngày ≥ hôm nay, vd 29/07 — không phải tuần cuối có data); vùng
 *     tra thêm qua allItems + chuẩn hoá tên đ→d → fix thiếu vùng (vd Mini Hotel_GĐ2_ĐẠI TRÀ = PQ).
 *   v3.8.4 (28/07/2026): Bảng tuân thủ: QUAY LẠI gom theo PM — điểm TB PM = badge tô màu
 *     xanh/vàng/đỏ BÊN TRÁI tên PM; cột "Cập nhật gần nhất" tô màu theo độ mới (xanh≤7 ngày→đỏ);
 *     BỎ badge TOP 20. Gantt: thanh DÒNG CON về màu xanh dương nhạt cũ #a1bddd (thanh dự án giữ #334964).
 *   v3.8.3 (28/07/2026): Gantt "Tổng thể tiến độ" — mang LOGIC LỌC HẠNG MỤC của bảng "Việc cần
 *     xử lý" sang: KHÔNG lọc = dòng DỰ ÁN + dòng con (mô tả con = tên đầu việc) như cũ; CÓ lọc
 *     hạng mục = bảng PHẲNG mỗi hạng mục 1 dòng (Mã = viết tắt hạng mục, mô tả = TÊN DỰ ÁN, bar
 *     = timeline hạng mục + đổ % thực tế; ẩn ô đỏ SX). Dùng chung panelActive + lọc theo filters.stages.
 *   v3.8.2 (28/07/2026): Bảng tuân thủ: header đổi "Số dự án KHÔNG cập nhật TUẦN NÀY"; ẩn "File
 *     cập nhật"; cột TUẦN HIỆN HÀNH (cột có data xa nhất) tô nền TRẮNG chữ đen ("tới đâu rồi");
 *     thêm FILTER theo Vùng; badge "MP" → "TOP 20". VÙNG + TOP 20 tra từ FILE PMP theo tên dự án
 *     (normProjName) — KHÔNG lấy cột Location của file tuân thủ (không tin cậy, vd APEC bị HCM).
 *   v3.8.1 (28/07/2026): Hiện DÒNG TIẾN ĐỘ CON trên bảng "Tổng thể tiến độ" LÊN LIVE
 *     (bật cờ ganttChildTasks) — mở rộng dự án là thấy các tác vụ con.
 *   v3.8.0 (28/07/2026): BÁO CÁO TUÂN THỦ (đọc từ file) LÊN LIVE (bật cờ complianceReport).
 *     Gantt: GIỮ LẠI băng đỏ cột "ngày hiện hành" (chỉ bỏ vạch đỏ mảnh #dc2626); ô ngày trên
 *     băng để chữ TRẮNG cho dễ nhìn.
 *   v3.7.9 (28/07/2026): (1) Bảng ĐÁNH GIÁ TUÂN THỦ đọc THẲNG từ FILE NGUỒN RIÊNG (Google Sheet
 *     15pcqb0…, CSV 1 tab — parse Ở CLIENT, KHÔNG OOM): bảng PHẲNG, cột tuần tháng (P–T = 01/07…
 *     29/07) với ✔/o/x lấy từ file; app CHỈ chấm điểm (100−25x−10o, chỉ tháng này); vùng/PM/lũy
 *     kế/lastUpdate/MP từ file; điểm PM = TB cộng. (2) Gantt: BỎ HẲN cột/vạch ĐỎ "ngày hiện hành".
 *   v3.7.8 (28/07/2026): (1) Điểm tuân thủ CHỈ còn 3 tiêu chí (đúng hạn giữ nguyên · trễ −10 ·
 *     không cập nhật −25), BỎ trừ chất lượng Master Plan; điểm PM = TB cộng dự án. (2) Gantt
 *     "Tổng thể tiến độ": quý hiện tại nền TRẮNG chữ ĐEN; thanh cấp dự án đổi màu #334964.
 *   v3.7.7 (28/07/2026): Bảng ĐÁNH GIÁ TUÂN THỦ — xếp mặc định theo SỐ LẦN KHÔNG CẬP NHẬT
 *     (nhiều→ít, ai bỏ nhiều lên đầu) thay vì theo điểm; BỚT MÀU: ô "Điểm" bỏ nền tô chỉ còn
 *     chữ (thấp mới nhuốm cam/đỏ), giữ cột "Số lần không cập nhật" ĐỎ + ô x/o/tick như cũ.
 *   v3.7.6 (28/07/2026): Bộ lọc "Nhóm" → đổi lại tên thành "PES", HIỂN THỊ theo TÊN (Ms./Mr. +
 *     Mai Lê, Công Hoàng, Xuân Tân, Phúc Thành) thay cho số 1..4 — đảo lại v3.5.2.
 *   v3.7.5 (27/07/2026): Popup Summary NHẸ hơn — Worker chỉ gửi RIÊNG sheet "Summary" (~170KB)
 *     thay vì cả file 2MB (tách bằng fflate, giải nén có chọn lọc — nhẹ, không OOM). ~12× nhẹ tải.
 *   v3.7.4 (27/07/2026): DỨT ĐIỂM Error 1102 — gỡ NỐT thao tác parse xlsx còn sót trên Worker
 *     (getInstallLinks đọc hyperlink). Chuyển sang CLIENT: đọc hyperlink từ CHÍNH file Timeline
 *     client đã tải cho dữ liệu chính (src/lib/mtld-links.ts). Worker giờ CHỈ tải file, KHÔNG parse.
 *   v3.7.3 (27/07/2026): SỬA LỖI Error 1102 (Worker exceeded resources) khi bấm popup Summary —
 *     parse xlsx 2MB trên Cloudflare Worker làm OOM/CPU vượt giới hạn → sập isolate. Chuyển hẳn
 *     PARSE + RENDER sang CLIENT (trình duyệt); Worker chỉ tải file (b64) + cache KV 10'. XLSX nạp
 *     động (chỉ khi mở popup). Cũng chỉ parse sheet Timeline khi đọc hyperlink cho nhẹ.
 *   v3.7.1 (27/07/2026): Popup Summary (Thi công lắp đặt) — viền ô ĐEN cho rõ; màu legend suy TỪ
 *     CHỮ diễn giải để khớp lưới (sửa "Đang thi công"/"ra Defect" hiển thị hồng/trắng sai).
 *   v3.7.0 (27/07/2026): 2 popup mới — (1) bấm số % THỰC TẾ (ô có chi tiết) → hiện "số mã/tổng mã"
 *     từng nhãn + cảnh báo lệch nếu % nhập ≠ số mã; (2) bấm chữ hạng mục "Thi công lắp đặt" đã
 *     HYPERLINK → popup ma trận Summary tô màu y hệt Excel (đọc link thẳng từ Google Sheet, đường
 *     data riêng). "Làm mới" đọc lại cả 2. (Đổi luật chấm tuân thủ + module MTLĐ vẫn sau cờ dev.)
 *   v3.6.2 (24/07/2026): Chốt lại độ rộng cột mặc định bảng nhóm (group.v5) — nới "Mã" + "Người
 *     phụ trách", thu "Mô tả" cho chữ hiện đủ, header khít.
 *   v3.6.1 (24/07/2026): Chữ bảng Danh sách to đều = size cột Vướng mắc (1.1em) + hàng dữ liệu
 *     màu ĐEN (hàng cấp dự án giữ trắng); chốt độ rộng cột mặc định mới (group.v4); header
 *     "Người phụ/trách chính" 2 dòng; tên phụ trách nhiều người xuống dòng NGUYÊN tên (ngắt ở "/").
 *   v3.6.0 (24/07/2026): Bảng NHÓM theo dự án — BỎ cột "Bàn giao" (theo PMP): hàng DỰ ÁN hiện
 *     Ngày bắt đầu + Deadline cam kết(=ngày bàn giao, badge đỏ nếu quá hạn); lưới badge Tình
 *     trạng thu còn colSpan 3; cột "Deadline cam kết" SORT theo bàn giao (giữ sort cũ). Thêm
 *     projectStart vào dữ liệu (dòng cha, dự phòng ngày sớm nhất công đoạn). Bảng lọc/MP giữ 13 cột.
 *   v3.5.4 (24/07/2026): Tiêu đề bảng Danh sách CĂN GIỮA hết (ô dữ liệu vẫn căn riêng như cũ).
 *   v3.5.3 (24/07/2026): Vướng mắc/Giải pháp ở HÀNG CẤP DỰ ÁN luôn IN ĐẬM (chữ trắng) cho rõ.
 *   v3.5.2 (24/07/2026): Bộ lọc "PES" → đổi tên thành "Nhóm", hiển thị theo SỐ NHÓM 1..4
 *     (Mai Lê=1, Công Hoàng=2, Xuân Tân=3, Phúc Thành=4) thay cho tên.
 *   v3.5.1 (24/07/2026): Fix tô ở hàng cấp dự án bị ĐEN (thẻ <mark> mặc định màu đen) → dùng
 *     color:"inherit" để giữ chữ TRẮNG, chỉ in đậm.
 *   v3.5.0 (24/07/2026): TÔ NỔI cho Vướng mắc/Giải pháp (CHỈ admin, server chốt quyền): bôi
 *     đen chữ NGAY TRONG Ô → nút nổi "Tô nổi" tô 1 phát (hoặc trong hộp sửa); bấm đoạn tô để
 *     bỏ. Vướng mắc = chữ đỏ đô + đậm, Giải pháp = navy + đậm; hàng cấp dự án = ĐẬM giữ trắng.
 *     Ai cũng THẤY, chỉ admin TÔ được. Chữ 2 cột to hơn ~10%.
 *   v3.4.0 (23/07/2026): Bảng NHÓM theo dự án đổi sang bố cục PMP (12 cột): bỏ cột "Hạng
 *     mục" (mã viết tắt dời vào cột "Mã"), "Mã CT"→"Mã", "Tên dự án"→"Mô tả"; 3.4% dôi ra
 *     chia cho Vướng mắc + Giải pháp. CHỈ bảng nhóm; bảng lọc/MP giữ 13 cột. (Không đụng
 *     khoá lưu ghi chú → data Vướng mắc/Giải pháp KHÔNG mất.)
 *   v3.3.0 (23/07/2026): Nhóm theo dự án → dòng con hiện TÊN HẠNG MỤC đầy đủ (không lặp
 *     lại tên dự án cho đỡ thừa); khi LỌC theo hạng mục thì cột này hiện lại tên dự án.
 *   v3.2.0 (23/07/2026): MỞ LẠI tính năng KÉO CHỈNH độ rộng cột bảng Danh sách (kéo mép
 *     phải tiêu đề, lưu localStorage) + nút "↔ Đặt lại cột" đưa về mặc định.
 *   v3.1.1 (23/07/2026): Bảng "Danh sách" — tiêu đề 4 cột xuống 2 dòng (Bàn/giao,
 *     Ngày/bắt đầu, %/thực tế, Quá/hạn), ô Quá hạn thành "38 / ngày" căn giữa, thu nhỏ
 *     font ngày + thu các cột ngày để nới rộng cột Giải pháp; lưới cảnh báo giai đoạn ở
 *     hàng gộp tự lấp đầy bề rộng (không tràn khi thu cột).
 *   v3.1.0 (23/07/2026): Bảng "Tổng thể tiến độ" đổi sang lưới CỘT TUẦN (ô đỏ NMSX
 *     mỗi tuần 1 ô); ô nhập Vướng mắc/Giải pháp tối đa 500 ký tự, hàng tự cao, không
 *     đóng khi lỡ bấm ra ngoài; Nhật ký giám sát thêm TÌM KIẾM + LỌC thao tác; tối ưu
 *     bề rộng cột + tên dự án gói 2–3 dòng như PMP; chỉ bấm ĐÚNG ô Vướng mắc/Giải pháp
 *     mới sửa (bỏ click nhầm ở ô Nhân sự/Deadline).
 *   v3.0.0 (≤22/07/2026): mốc trước khi bắt đầu ghi changelog. */
/** LOG THAY ĐỔI cho NGƯỜI DÙNG — bấm badge phiên bản (góc header) để xem. Mỗi lần deploy THÊM 1 mục
 *  ở ĐẦU mảng (viết ngắn gọn, dễ hiểu, KHÔNG kỹ thuật). `APP_VERSION` tự lấy phiên bản mới nhất từ
 *  đây = nguồn sự thật DUY NHẤT (khỏi sửa 2 nơi). Chi tiết kỹ thuật xem block comment phía trên. */
type ChangelogEntry = { v: string; date: string; items: string[] };
const CHANGELOG: readonly ChangelogEntry[] = [
  { v: "3.88.0", date: "04/09/2026", items: [
    "“Media công trường” thay cho “Video tại công trường” — nay là một chỗ duy nhất cho cả ẢNH và VIDEO. Chọn dự án là hiện luôn ma trận lắp đặt; bấm 1 ô căn để xem và tải ảnh/video của căn đó (tải nhiều file một lượt). Nút 🎬 Video ở dòng dự án mở thẳng vào đây.",
    "Nhìn màu là biết tiến độ: ma trận tô theo thang 7 cấp chuẩn (chưa nhận mặt bằng → đang thi công → giao thô → giao tinh → defect → bàn giao vận hành), ẩn mã số cho gọn, có chú giải màu ngay trên bảng. Ô nào ĐÃ CÓ ảnh/video thì có chấm tròn đánh dấu, rê chuột xem có mấy ảnh mấy clip.",
    "Dự án khu public (Lobby, nhà hàng, toilet…) không có ma trận căn thì tự hiện BẢNG KHU — mỗi ô một khu, tên khu lấy thẳng từ file, bấm ô để xem/tải ảnh video của khu.",
    "Ảnh gắn ở popup dự án bên ePMP nay xếp vào đúng thư mục căn/khu trên Drive, chung chỗ với ảnh video tải từ Media công trường — hết cảnh ảnh nằm rải rác không tìm ra.",
    "PMO chỉnh bảng như Excel: xoá cột/xoá dòng thừa, sửa chữ hàng loạt, xoá nội dung ô (phím Delete), đổi rộng cột/cao dòng, phóng to thu nhỏ, kéo khung xem cân đều hai bên. Bấm Lưu là mọi người đều thấy đúng bố cục đó.",
  ] },
  { v: "3.87.0", date: "03/09/2026", items: [
    "Video tại công trường — giao diện tự co giãn: điện thoại 1 cột như cũ, máy tính chia 2 cột (ô nhập bên trái, lưới clip bên phải) cho đỡ trống trải. Mỗi căn giờ có THƯ MỤC riêng trên Drive (…/Video/<Toà>/<mã căn>/) vì 1 căn nhiều clip — clip cũ (kiểu cũ) vẫn hiện đủ.",
  ] },
  { v: "3.86.0", date: "03/09/2026", items: [
    "Video công trường dễ xem hơn — dòng dự án Mini Hotel có nút “🎬 Video” bấm 1 phát mở thẳng trình xem (bỏ các lối vào trùng). Clip xếp kiểu lưới theo TẦNG: các căn cùng tầng (609·612…) nằm cùng 1 hàng, ô nhỏ san sát nhau, dễ dò. Cửa sổ xem cân đối hơn (cao vừa mắt, bớt rộng thừa).",
  ] },
  { v: "3.85.0", date: "03/09/2026", items: [
    "Nhật ký giám sát — tải theo TRANG (200 lượt/lần) thay vì ôm hết vào máy: mở nhanh, nhẹ; lọc Người/Ngày/Thao tác chạy thẳng dưới cơ sở dữ liệu; cần xem sâu hơn thì bấm “Tải thêm lượt cũ hơn”. Xem được TRỌN lịch sử (không còn bị chặn ở 2000 dòng như trước).",
    "Nút “🎬 Xem video” chỉ hiện ở dự án Mini Hotel PQ (B1-B5) — nơi đang có clip. Dự án khác không còn mở nhầm ra clip Mini Hotel; chưa có ảnh thì tên để thường như cũ.",
  ] },
  { v: "3.84.0", date: "03/09/2026", items: [
    "Nhật ký giám sát — thêm nút “⤓ Sao lưu ra Drive” (admin): xuất TOÀN BỘ lịch sử xem/thao tác ra file CSV (mở Excel đúng tiếng Việt) lưu vào Google Drive (DATABASE › ePMP › Nhật ký giám sát). Bản lưu dài hạn ngoài hệ thống, phòng khi cần đối chiếu.",
    "Sao lưu nhật ký TỰ ĐỘNG mỗi ngày ra Drive (worker phụ) — Drive giữ bản đầy đủ, app nhẹ. (Cần deploy warmer + đặt secret Drive một lần.)",
  ] },
  { v: "3.83.0", date: "03/09/2026", items: [
    "Chống mất ghi chú khi đánh lại STT — app đọc cột “RID” (số nguyên mỗi dòng do PMO điền): ghi chú/giải pháp MỚI bám theo RID nên đổi STT mặc kệ, không lạc. Ghi chú CŨ vẫn hiện nguyên (đọc dự phòng theo khoá cũ, không dời dữ liệu). Cột đầu là RID vẫn đọc đúng mọi cột khác.",
    "Xem video công trường ngay trong ePMP — riêng dự án Mini Hotel PQ (B1-B5): bấm tên dự án có nút “🎬 Xem video” → chọn Toà B1–B5 → xem clip từng căn (group theo Toà y hệt màn upload), phát nhúng như YouTube. (Dự án khác chưa có clip nên giữ như cũ.)",
  ] },
  { v: "3.82.0", date: "03/09/2026", items: [
    "Video tại công trường — bấm “Chọn video” là điện thoại tự bung đủ lựa chọn (quay video trực tiếp · thư viện ảnh · tệp · Drive). Sửa lỗi trên iPhone/Safari báo “Load failed” dù clip đã lên Drive: app tự kiểm tra clip đã lưu chưa rồi mới báo kết quả, không báo lỗi oan.",
  ] },
  { v: "3.81.0", date: "28/08/2026", items: [
    "Thêm màn “Video tại công trường” (thanh trái) cho Mini Hotel PQ (B1-B5) · Phòng: chọn Toà → nhập mã căn → quay hoặc chọn clip ngay trên điện thoại. Clip tự lưu về Drive theo từng căn; xem lại bằng trình phát nhúng ngay trong app (không phải tải về). App không giữ clip nên vẫn nhẹ. (Bước sau: xem clip ngay trong ePMP theo dự án + chạm ô căn trên ma trận để tự điền.)",
  ] },
  { v: "3.80.0", date: "28/08/2026", items: [
    "Hiệu suất dự án — thêm biểu đồ “Doanh thu đầu người Khối dự án” (nền đen, cột theo tháng cả năm) tính thẳng từ file; tab “Doanh thu đầu người theo dự án” xếp hạng từng dự án trong 1 tháng, so mốc KPI 1 tỷ/người/tháng, có bộ lọc tháng. Template nhập liệu mở đủ 12 tháng.",
    "Xuất báo cáo dự án (PDF) — đánh giá tình trạng theo dấu hiệu cảnh báo: trễ tiến độ kèm 1 dấu hiệu đỏ khác (điểm nghiêm trọng / quá mốc / lỗi số liệu) → báo “TRƯỢT TIẾN ĐỘ”. Thẻ tóm tắt gọn (việc gặp vấn đề · điểm nghiêm trọng · số ngày còn lại); mục “Rà soát dữ liệu” dẫn tên công đoạn cho dễ đọc.",
    "Xuất báo cáo dự án (Slide .pptx) — thêm slide “Bảng chi tiết công đoạn” (bảng ePMP đầy đủ: mã · mô tả · người phụ trách · ngày · % · vướng mắc) + thanh thương hiệu AA đồng bộ với deck PMO.",
    "Ma trận lắp đặt — tô màu ô theo quy ước trạng thái chuẩn, tự đọc mã màu khai trong file (cột “Tăng hôm nay”); áp cho mọi bảng xem, đỡ phải chỉnh tay.",
    "Popup xem link ma trận (PMO/Admin) — thêm nút “File gốc” mở thẳng Google Sheet nguồn, và nút “Cập nhật lại” kéo bản mới nhất từ link (kể cả khi đổi link hoặc nội dung link cũ thay đổi) rồi cập nhật cho mọi người.",
    "Báo cáo tuân thủ — deadline trình BOD đọc đúng ngày dd/mm ngay sau cụm “trình BOD… (bitrix)” (fix khi ghi chú có nhiều mốc ngày); không ghi “trước dd/mm” thì KHÔNG trừ điểm (bỏ luật tự cộng 7 ngày).",
  ] },
  { v: "3.79.1", date: "27/08/2026", items: [
    "Tài khoản ngoài công ty (đã được cấp quyền trong danh sách) nay đăng nhập được — bỏ ràng buộc domain ở màn chọn tài khoản Google. Chốt quyền vẫn giữ nguyên ở server (chỉ @aacorporation.com + email ngoại lệ trong danh sách mới vào được).",
    "Ghi chú / vướng mắc nay sao lưu Drive thêm bản THEO NGÀY (DATABASE › ePMP › Ghi chú › Lịch sử › GhiChu_YYYY-MM-DD.json) — lỡ mất còn lùi về ngày trước lấy lại.",
  ] },
  { v: "3.79.0", date: "27/08/2026", items: [
    "Mỗi dự án có nút “Xuất báo cáo” (dưới mã dự án) → chọn bản PDF hoặc Slide (.pptx), cùng một dữ liệu.",
    "Báo cáo PDF/Slide dự án: thanh tiến độ theo giai đoạn dùng đúng màu Gantt (xanh = % hoàn thành, nền navy); người phụ trách từng công đoạn ghi y hệt bảng; thêm mục “RÀ SOÁT DỮ LIỆU” tự bắt mâu thuẫn (công đoạn sau vượt công đoạn trước, số mã đã làm > tổng, % lệch xa số mã, đã 100% mà còn trễ…).",
    "Báo cáo tuân thủ — deadline trình BOD nay đọc NGÀY dd/mm ngay trong từ khoá vướng mắc (không có dd/mm thì lùi về ngày cắm cờ + 7); qua hạn dd/mm mà còn cờ → −10 điểm/tuần. Cột “trước dd/mm” để chữ ĐEN (bỏ đổ màu); thanh “Số lần không cập nhật” đổi màu xanh + số đen đậm cho dễ đọc.",
    "Bảng chính — chấm vàng “% cần rà” chỉ còn hiện ở 4 giai đoạn có nhập số mã (Trình duyệt mẫu · Đặt vật tư · Triển khai sản xuất · Sản xuất nhập kho); các giai đoạn khác không chấm nữa cho đỡ rối.",
  ] },
  { v: "3.78.0", date: "26/08/2026", items: [
    "Bản in PDF báo cáo tuân thủ — TO & RÕ hơn: lề trên/dưới hẹp lại (còn ~7mm), bảng lấp KÍN cả bề ngang lẫn chiều cao (sửa lỗi trước đây chừa trắng 2 bên), hàng in siết sát nên chữ phóng to hơn ~38% khi ép 1 trang. Chỉ ảnh hưởng bản in, KHÔNG đụng bảng trên app.",
    "Báo cáo tuân thủ — màu chữ tên dự án & người phụ trách đổi từ xám sang GẦN ĐEN (in ra đậm rõ, hết chìm). Chú thích: chữ “o” to bằng trong bảng, các dòng giãn cách dễ đọc hơn.",
  ] },
  { v: "3.77.0", date: "26/08/2026", items: [
    "Báo cáo tuân thủ — chỉnh form giờ ĂN THẲNG vào bản in PDF: cỡ chữ, IN ĐẬM, độ rộng cột và CHIỀU CAO HÀNG (đồng đều mọi hàng) anh chỉnh sao thì PDF ra vậy (trong 1 trang; to quá thì tự thu cho vừa). Thêm nút chỉnh chiều cao hàng ⭥.",
    "Báo cáo tuân thủ — tiêu đề thêm “- Tháng MM/YYYY” theo tháng hiện hành; TẮT bấm-cột-sắp-xếp (auto xếp A→Z theo tên, cố định); ô trống hiện dấu “–” cho biết không có thông tin; cột Vùng tự xuống dòng; cột “Cần PM trình BOD” chỉnh cỡ chữ được + hiển thị “trước dd/mm”.",
    "MTLĐ (Theo dõi lắp đặt) — popup xem chi tiết TO hơn + nút Xem TOÀN MÀN HÌNH (hoặc phím F) để soi rõ.",
  ] },
  { v: "3.76.4", date: "26/08/2026", items: [
    "Bảng “Việc cần xử lý” & “Tổng thể tiến độ” — sort mặc định theo NGÀY KẾT THÚC, cùng ngày thì xếp theo MÃ CT (CT25-055 trước CT25-070) rồi mới tới tên; mã CT sắp theo số tự nhiên.",
  ] },
  { v: "3.76.3", date: "26/08/2026", items: [
    "Báo cáo tuân thủ — đổi tên cột thành “Cần PM trình Master Plan BOD phê duyệt”; ô ngày hiển thị dạng “trước 27/08” cho rõ đây là hạn chót.",
  ] },
  { v: "3.76.2", date: "26/08/2026", items: [
    "Sửa lỗi nút “☁ Cập nhật bản gửi mail” báo “Tạo PDF lỗi (dataUri)”: chuẩn hoá dữ liệu PDF trước khi đẩy Drive.",
  ] },
  { v: "3.76.1", date: "26/08/2026", items: [
    "Báo cáo tuân thủ — TÁCH “Xuất PDF” khỏi lưu Drive: nút Xuất PDF nay CHỈ tải về (cá nhân), ai tải cũng không ảnh hưởng bản gửi mail. Thêm nút “☁ Cập nhật bản gửi mail” (CHỈ admin) để chủ động đẩy bản form hiện tại lên Drive cho Apps Script đính kèm.",
    "Báo cáo tuân thủ — cột “Đổi tiến độ bàn giao…” nay hiển thị NGÀY DEADLINE = ngày cắm cờ + 7. Trong 7 ngày đầu còn hạn (cam, chưa trừ); QUA deadline mà còn cờ mới bắt đầu −10 điểm, mỗi 7 ngày tiếp +1 (vd cắm Thứ 4 → hạn Thứ 4 tuần sau).",
  ] },
  { v: "3.76.0", date: "26/08/2026", items: [
    "Báo cáo tuân thủ — làm lại form theo góp ý sếp: thứ tự cụm tiêu đề Tên báo cáo → Bộ phận → Kỳ; dòng “Ngày cập nhật” lấy theo cột tuần hiện hành (ô xanh lá); bảng Điểm PM dời ra NGOÀI CÙNG TRÁI, tên xếp theo TÊN GỌI (không theo họ) và in đậm; luôn 5 cột tuần (tháng 4 tuần thì cột 5 để trống, rộng bằng các cột kia); dấu “o” (trễ) to hơn.",
    "Báo cáo tuân thủ — cột “Cần trình Master Plan điều chỉnh ngày” đổi tên thành “Đổi tiến độ bàn giao, cần PM trình Master Plan BOD phê duyệt trước ngày”, nay CẮM 1 NGÀY duy nhất (đỏ khi quá hạn); ghi rõ trừ −10 điểm/tuần; cột “Số lần không cập nhật” đổi màu thanh (nền #ECF0F8, thanh #D9E1F2) + số navy đậm cho dễ đọc.",
    "Báo cáo tuân thủ — thêm CHỈNH FORM KIỂU EXCEL (chỉ admin): kéo rộng cột, chọn nhiều cột rồi Chia đều, in đậm / cỡ chữ theo TỪNG CỘT (áp cho nội dung, tiêu đề giữ đồng đều); Lưu & chốt áp cho mọi người + bản in; có Khoá / Mở khoá.",
    "Xuất PDF báo cáo tuân thủ — giữ ĐÚNG tỉ lệ cột đã chỉnh, lấp đầy bề ngang bằng khối chú thích (phần dư dồn vào cột Tên dự án + Người phụ trách), tự vừa 1 trang; BỎ khổ ngang, chỉ còn khổ dọc.",
    "Xuất PDF báo cáo tuân thủ — bấm Xuất PDF nay VỪA tải xuống VỪA tự lưu bản PDF lên Google Drive (DATABASE › ePMP › Báo cáo tuân thủ) để Apps Script gửi mail tự đính kèm bản đúng tuần.",
    "Sửa lỗi menu “Xuất PDF” bị hàng tiêu đề bảng (sticky) đè lên khi cuộn.",
    "Sao lưu Drive — dữ liệu Hiệu suất dự án, ghi chú (vướng mắc/giải pháp) và link nguồn DST tự mirror về folder DATABASE theo từng app; ảnh dự án lưu theo DATABASE › ePMP › <Dự án> › Hình ảnh.",
  ] },
  { v: "3.75.3", date: "25/08/2026", items: [
    "App “MTLĐ” — trả lại các ô ĐỒNG ĐỀU một cỡ (camera wall); khoảng trắng chừa để cân kích thước là bình thường.",
  ] },
  { v: "3.75.1", date: "25/08/2026", items: [
    "App “MTLĐ” — sửa vài ô ma trận bị GIẬT liên tục (vòng lặp đo lại kích thước).",
    "App “MTLĐ” — hết NHÂN BẢN thẻ: nhiều dòng dự án gắn CÙNG một ma trận nay chỉ hiện MỘT thẻ (đúng số lượng thật).",
  ] },
  { v: "3.75.0", date: "25/08/2026", items: [
    "Ảnh dự án — MỌI NGƯỜI nay đều THÊM được ảnh hiện trường (không chỉ admin/PMO); xoá/gỡ ảnh vẫn chỉ admin/PMO. Ảnh tự lưu về Google Drive, đúng thư mục của từng dự án (thêm ảnh Mini Hotel → thư mục Mini Hotel).",
    "App “MTLĐ” — thêm kiểu xem “Gom hết”: dồn mọi ô vào MỘT lưới liền như bức tường TV; vẫn giữ kiểu “Theo vùng” (mặc định). Đổi qua lại bằng nút Kiểu xem trên đầu.",
  ] },
  { v: "3.74.2", date: "25/08/2026", items: [
    "DST — sửa lại cảnh báo lệch %/khối lượng cho ĐÚNG: lấy KHỐI LƯỢNG hoàn thành làm gốc. Chỉ báo khi % để CAO hơn tỉ lệ khối lượng thực làm (vd khối lượng 0/2 nhưng để 100%); dòng khớp (1/1 = 100%) không còn báo nhầm.",
  ] },
  { v: "3.74.1", date: "25/08/2026", items: [
    "DST — thêm cảnh báo “% tiến độ KHÔNG khớp khối lượng” (vd để 100% nhưng khối lượng 0/x). Gộp vào bộ lọc “Lỗi dữ liệu”.",
    "DST — rê chuột vào dấu ⚠ sẽ hiện ĐÚNG loại lỗi của dòng đó (ngày sai · kết thúc trước bắt đầu · khối lượng vô lý · % lệch khối lượng · thiếu thông tin).",
  ] },
  { v: "3.74.0", date: "25/08/2026", items: [
    "DST — link dữ liệu đã nhập nay DÍNH CỨNG: tải lại trang KHÔNG còn về file mẫu, giữ đúng link đang xem cho đến khi admin/PMO nhập link mới.",
    "DST — thêm mốc “Dữ liệu tính đến HH:MM:SS ngày · … trước” trên header để biết dữ liệu cập nhật lúc nào.",
  ] },
  { v: "3.73.9", date: "25/08/2026", items: [
    "DST — thêm nút “Ẩn việc đã xong”: tick để ẩn các đầu việc có khối lượng hoàn thành ĐỦ (vd 97/97) hoặc đạt 100%. Dòng khu / công đoạn mà mọi việc con đều xong cũng tự ẩn.",
  ] },
  { v: "3.73.8", date: "25/08/2026", items: [
    "App “MTLĐ” — mỗi ô tự co ma trận VỪA ĐÚNG BỀ NGANG (thấy trọn bảng theo chiều ngang), chỉ cần cuộn DỌC, không phải kéo ngang.",
    "App “MTLĐ” — header vùng dính (sticky) khi cuộn nhưng KHÔNG còn hở khúc / lòi nội dung phía sau.",
  ] },
  { v: "3.73.7", date: "25/08/2026", items: [
    "App “MTLĐ” — ô hiển thị ma trận SẠCH (bỏ thanh zoom % trong từng ô). Muốn đổi cỡ: BẤM vào ô → popup mở ra → chỉnh zoom → bấm “💾 Lưu cỡ” ngay trong popup; ô nhỏ tự hiện đúng cỡ đã lưu.",
    "App “MTLĐ” — header vùng KHÔNG còn dính khi cuộn (cuộn theo nội dung).",
  ] },
  { v: "3.73.6", date: "25/08/2026", items: [
    "Popup ma trận (“Chỉnh như Excel”) — nay LƯU luôn mức PHÓNG TO (zoom) vào form. Admin phóng to rồi Lưu form → mở lại ở cả popup Project Master Plan lẫn ô MTLĐ đều hiện đúng cỡ đã lưu.",
    "App “MTLĐ” — ô hiện đúng mức zoom đã lưu (không tự thu nhỏ mờ), cuộn khi lớn hơn ô; header vùng khi cuộn không còn bị lòi nội dung phía sau (nền đặc).",
  ] },
  { v: "3.73.5", date: "25/08/2026", items: [
    "App “MTLĐ” — HYBRID theo cài đặt từng link: popup nào để “có chart” sẽ hiện bản chart (Google render, đủ biểu đồ + màu); popup còn lại hiện ma trận + form đã lưu. Đúng như khi mở trong Project Master Plan.",
  ] },
  { v: "3.73.4", date: "25/08/2026", items: [
    "App “MTLĐ” — nay gom ĐÚNG các popup “Thi công lắp đặt” đã gắn link (ma trận LIVE + FORM đã lưu, y hệt khi bấm chữ trong Project Master Plan), thay vì bản tóm tắt thô. Lấy đủ mọi dự án đã gắn link — không còn kẹt ở vài popup.",
  ] },
  { v: "3.73.3", date: "25/08/2026", items: [
    "App “MTLĐ” — sửa lỗi trên bản live không hiện popup: danh sách lấy TRỰC TIẾP từ server (KV), không còn phụ thuộc thời điểm mở app; mỗi dự án tải ĐÚNG tab của nó (kể cả nhiều dự án chung một file Google Sheet, khác tab) nên không bị gộp/mất.",
  ] },
  { v: "3.73.2", date: "25/08/2026", items: [
    "App “MTLĐ” (Biểu đồ tiến độ) — màn gom popup lắp đặt của các dự án (xem tổng thể như camera, bấm ô để xem chi tiết) lên bản chính thức, hiện CHỈ admin / PMO thấy.",
  ] },
  { v: "3.73.1", date: "25/08/2026", items: [
    "DST — nút “Làm mới” nay tải DỮ LIỆU MỚI từ đúng link đang xem (trước đây lỡ tay bỏ link, quay về file mẫu).",
    "DST — sửa lỗi thanh tiến độ tràn đè lên các cột bên trái khi cuộn ngang.",
    "Biểu đồ Tổng thể tiến độ — hiện lại đường kẻ ngang chia dòng; đường kẻ tuần (dọc) hết bị thiếu / dính hai cột làm một.",
    "Báo cáo slide (.pptx) — thêm logo AA Corporation (trang bìa + góc mỗi trang).",
  ] },
  { v: "3.73.0", date: "25/08/2026", items: [
    "MỚI — Kho lưu trữ Google Drive: ảnh hiện trường PMO gắn cho dự án nay được lưu thêm vào folder “Data Source” trên Drive, mỗi dự án một thư mục riêng (kho bền, ảnh không mất).",
    "App “Hiệu suất dự án” — biểu đồ “KDA Ban Chỉ Huy” làm lại kiểu điều hành: thanh ngang xếp hạng, màu theo đạt / dưới / âm KPI, hiện sẵn khoảng cách so với KPI, thêm 4 thẻ tóm tắt (cao nhất · trung vị · đạt KPI · thấp nhất). Có chọn tháng để xem KDA.",
    "App “MTLĐ” — gom toàn bộ popup lắp đặt của các dự án về một màn để xem tổng thể; lọc theo dự án · cụm · vùng, chỉnh mật độ ô; bấm một ô để mở xem chi tiết cỡ lớn.",
    "App “DST” — bố cục đầu trang gọn lại; chọn khoảng tháng có cả năm trước / năm sau; thêm bộ lọc “Lỗi dữ liệu”; admin/PMO thấy link mở file gốc trong phần Nhập dữ liệu.",
    "DST — băng “ngày hiện hành” chạy liền mạch, hết vạch trắng cắt ngang.",
  ] },
  { v: "3.72.0", date: "24/08/2026", items: [
    "MỚI — App “Hiệu suất dự án” (thanh app bên trái): biểu đồ hiệu suất Doanh thu/Nhân sự (tỷ đồng/người) theo tháng. Có 20 biểu đồ xu hướng + 1 bảng xếp hạng tháng mới nhất (đường mốc KPI). Nạp dữ liệu bằng link Google Sheet hoặc tải file .xlsx (có nút Tải template); dữ liệu được lưu lại đến khi cập nhật file mới.",
    "MỚI — Ảnh dự án: PMO gắn được NHIỀU ảnh hiện trường cho mỗi dự án; ai cũng bấm TÊN DỰ ÁN để xem cả bộ ảnh (PMO thêm/gỡ, người xem chỉ xem).",
    "Biểu đồ Tổng thể tiến độ — hết vạch trắng cắt ngang băng “tuần hiện hành”.",
    "Ô tìm kiếm — thêm nút ✕ để xoá nhanh từ khoá.",
    "Dialog gắn link hiển thị — không còn tự tắt khi lỡ bấm ra ngoài (tránh mất nội dung đang nhập).",
    "Công cụ dữ liệu — cảnh báo dữ liệu nêu cụ thể (dòng nào · cột nào · giá trị · lý do), gộp gọn các tab.",
  ] },
  { v: "3.71.2", date: "20/08/2026", items: [
    "Popup xem link (ma trận / duyệt mẫu…) — nhãn tiêu đề nay theo ĐÚNG TÊN HẠNG MỤC đã gắn link, không còn luôn ghi cứng “Ma trận lắp đặt”.",
  ] },
  { v: "3.71.1", date: "20/08/2026", items: [
    "Báo cáo tuân thủ · BẢN IN PDF — giãn dòng cụm tiêu đề cho thoáng, dễ đọc (không còn dính).",
    "Báo cáo tuân thủ — sửa lỗi menu “Xuất PDF” bị hàng tiêu đề bảng đè lên (nâng lớp hiển thị).",
  ] },
  { v: "3.71.0", date: "20/08/2026", items: [
    "Báo cáo tuân thủ — phần chú thích trên đầu bảng gom vào MỘT KHUNG BẢNG 4 cột có vạch ngăn (thứ tự: Chú thích · Cách tính điểm dự án · Cách tính điểm PM · Điểm PM), bỏ các viền nhỏ rời bên trong; nhãn gọn lại.",
    "Báo cáo tuân thủ — cột đổi tên “Cần trình Master Plan điều chỉnh ngày”; cột Người phụ trách xếp A→Z theo TÊN GỌI kiểu Việt Nam (vd “Nguyễn Hữu Chí” nằm ở chữ C).",
    "Báo cáo tuân thủ · BẢN IN PDF — sửa lỗi cụm tiêu đề bị dính dòng / mất dấu (do nén dòng quá sát), nay giãn vừa đủ cho dấu tiếng Việt.",
  ] },
  { v: "3.70.0", date: "20/08/2026", items: [
    "Báo cáo tuân thủ — cột “Không trình Master Plan cập nhật” đổi tên thành “Cần trình Master Plan điều chỉnh”.",
    "Báo cáo tuân thủ — cột Người phụ trách: dù gom theo vùng, trong MỖI VÙNG nay xếp theo BẢNG CHỮ CÁI (A→Z).",
    "Báo cáo tuân thủ — bảng “Điểm trung bình PM” KHÔNG cắt tên nữa (hiện đủ họ tên, 3 cột gọn 1 hàng); 4 khối chú thích ngay trên bảng nay cao bằng nhau, thẳng hàng cả trên lẫn dưới, cách đều bề ngang.",
  ] },
  { v: "3.69.1", date: "20/08/2026", items: [
    "Báo cáo tuân thủ · BẢN IN PDF — nén cụm tiêu đề (Bộ phận / tên báo cáo / Kỳ báo cáo) thấp xuống ~1–2 dòng cho đỡ trống phần đầu trang; bản xem trên app giữ nguyên.",
  ] },
  { v: "3.69.0", date: "20/08/2026", items: [
    "Báo cáo tuân thủ — GOM THEO VÙNG theo thứ tự Phú Quốc → Bắc → Trung → Nam → Nước Ngoài (ô Vùng gộp như tên dự án, mạnh hơn nhóm Người phụ trách). Bảng “Điểm trung bình PM” nằm gọn góc trên phải (3 cột, có viền), cùng hàng với 3 khối “Cách tính điểm / công thức / Chú thích” ngay trên đầu bảng. Thu gọn khoảng trắng dưới tiêu đề (cả trên app lẫn bản in PDF).",
    "Ma trận · “Đưa tất cả về đúng chỗ” — khi ô đích ĐÃ CÓ ghi chú thì GỘP các note vào (trước đây báo “đã có sẵn” rồi bỏ qua) → không sót note nào.",
    "DST (Theo dõi chi tiết) — chế độ “Tự động” chọn sheet nay quét TOÀN BỘ file để lấy đúng sheet nhiều dữ liệu nhất (không kẹt ở tab “Summary”).",
  ] },
  { v: "3.68.1", date: "20/08/2026", items: [
    "HOTFIX — BỎ banner cảnh báo “ghi chú bị trôi” trên đầu màn hình chính (gây hoang mang). Việc rà & đưa note về đúng chỗ vẫn nằm trong menu “Hệ thống” → Công cụ dữ liệu như cũ.",
  ] },
  { v: "3.68.0", date: "19/08/2026", items: [
    "DST (Theo dõi tiến độ chi tiết) · Nhập dữ liệu — thêm ô CHỌN SHEET: dán link xong hiện đủ danh sách tab để chọn đúng sheet (không còn đoán). Mặc định “Tự động” = quét MỌI sheet, lấy sheet nhiều dữ liệu nhất (tải nguyên file nên không bị kẹt ở tab “Summary”). Nhãn hiện TÊN SHEET thay vì “Link Drive”; ô “Tên dự án” vẫn để đổi tên tuỳ ý.",
  ] },
  { v: "3.67.0", date: "19/08/2026", items: [
    "Ma trận — nút “🖼 Xem có chart”: xem bản Google render (có CHART + màu y hệt) ngay trong popup; bấm “▦ Bảng lưới” để về bản chỉnh-được. PMO còn TICK được “Mặc định hiện bản có chart cho mọi người” trong Gắn/Sửa link → ai mở cũng thấy chart luôn.",
    "Báo cáo tuân thủ — GỌN LẠI còn 1 bảng duy nhất “Báo cáo tuân thủ cập nhật Master Plan” (bỏ trang Tóm tắt), tiêu đề canh trái. Điểm trung bình PM dời lên góc trên phải (gọn, 2 cột, chỉ tên + điểm).",
    "Báo cáo tuân thủ — GOM THEO VÙNG (Bắc · Trung · Nam · Phú Quốc · Nước Ngoài) rồi tới Người phụ trách; 1 PM ở 2 vùng thì tách 2 dòng. Bấm tiêu đề cột để sắp xếp (thay 2 nút xếp cũ).",
    "Báo cáo tuân thủ — cột “Không trình Master Plan cập nhật” đổi từ ô màu sang NGÀY (dd/mm); mỗi tuần vẫn chưa cập nhật thì gạch ngang ngày cũ + thêm ngày mới → nhìn biết ngay đã trễ bao nhiêu lần.",
  ] },
  { v: "3.66.0", date: "19/08/2026", items: [
    "Ma trận — RENDER ĐÚNG TAB anh chọn: trước đây dù chọn tab nào popup vẫn ra sheet “Summary” (server tự cắt còn mỗi Summary). Nay tách đúng tab được chọn; tiêu đề popup ghi “Tab: <tên tab>”.",
    "Ô chọn Sheet/tab nay LIỆT KÊ ĐỦ MỌI TAB trong file (trước có file chỉ hiện mỗi Summary), có báo “⏳ Đang tải danh sách tab…”, giữ nguyên tab đang chọn, mở lại hiện ngay.",
    "“Chỉnh như Excel” — TÔ MÀU THÔNG MINH (conditional formatting) theo vùng chọn: Kiểu 1 = thang 0%→100% (đỏ→xanh lá); Kiểu 2 = 7 màu theo bậc (ô trống → mã 1..6). Áp theo giá trị nên số liệu đổi vẫn đúng màu.",
    "“Chỉnh như Excel” — chọn NHIỀU KHỐI (Ctrl/⌘), sửa lỗi “chọn vài ô rồi không chọn tiếp được” và giật/lag; thêm phóng to/thu nhỏ, kéo rộng cột / cao dòng hàng loạt, tô màu chữ hàng loạt, và “Ẩn chữ” (chữ tàng hình cùng màu nền).",
  ] },
  { v: "3.65.0", date: "19/08/2026", items: [
    "“Chỉnh như Excel” — nay QUÉT KHỐI ô như Excel/Google Sheet: click-kéo (hoặc shift-click) để chọn cả vùng, rồi Tô màu / Tô theo mã / Ẩn cột-dòng cho TẤT CẢ ô trong khối một lần. Hết cảnh chỉnh từng ô.",
    "Sửa LAG: bỏ việc theo dõi chuột chạy liên tục (chỉ lắng nghe khi đang kéo) → di chuột mượt, không giật.",
  ] },
  { v: "3.64.0", date: "19/08/2026", items: [
    "Ma trận lắp đặt — popup nay dựng lại đúng ĐỘ RỘNG CỘT & CAO DÒNG như trong file (đọc kích thước thật), nên bố cục khớp bản gốc hơn.",
    "MỚI · “Chỉnh như Excel” (PMO): mở ma trận rồi tự tinh chỉnh — kéo rộng cột / cao dòng, TÔ MÀU ô hoặc tô theo MÃ (áp cho cả số liệu mới), gõ đè chữ ô, ẩn cột/dòng. Bấm “Lưu form” → lần sau mở là y vậy; số liệu đổi (Làm mới) vẫn giữ nguyên form. Lưu riêng theo từng link.",
    "DST (Theo dõi tiến độ chi tiết) — các dòng số nguyên trong 1 file nay gộp CHUNG về MỘT dự án (mặc định “Nam Phương Hoàng Hậu: Lobby” hoặc tên bạn nhập khi Nhập dữ liệu), không còn bị đếm nhầm mỗi khu thành 1 dự án. Bộ lọc Dự án hiện đúng “1 dự án · đủ khu”.",
  ] },
  { v: "3.63.0", date: "19/08/2026", items: [
    "Popup hiển thị vùng sheet — BỎ chế độ ảnh PDF (Google cắt vùng không đáng tin, hay lấy dư/thiếu), chuyển hẳn sang RENDER: dựng lại y xì ô + màu + chữ của đúng sheet & vùng đã khai. Chỉ tải KHI bấm vào (không render hàng loạt); bấm ↻ Làm mới để lấy bản mới nhất.",
  ] },
  { v: "3.62.2", date: "19/08/2026", items: [
    "Rà soát nhật ký — SỬA: khi bấm “Đưa về đúng chỗ” mà không thấy note di chuyển. Nguyên nhân: các note lệch tạo thành CHUỖI (dự án A dồn sang B, B sang C…) nên chỗ đúng đang bị note khác chiếm, hệ thống không đè lên (để an toàn). Nay “Đưa tất cả về đúng chỗ” chạy DỜI LẶP nhiều lượt tới khi hết, và báo ĐÚNG số khoá đã dời (không báo thành công giả). Sau khi chạy, tải lại trang (Ctrl+F5) để thấy.",
  ] },
  { v: "3.62.1", date: "19/08/2026", items: [
    "Phân cấp người dùng — chặn nút “Lưu” khi ô email TRỐNG hoặc chưa đúng định dạng (và tắt tự-điền của trình duyệt), tránh lỡ tạo bản ghi phân cấp sai/rỗng.",
  ] },
  { v: "3.62.0", date: "19/08/2026", items: [
    "KHÔI PHỤC NOTE — Công cụ dữ liệu thêm tab “Rà soát nhật ký”: đối chiếu MỖI ghi chú Vướng mắc/Giải pháp với nơi nó ĐƯỢC VIẾT (theo Nhật ký giám sát) → tìm ra ghi chú đang nằm SAI dự án/giai đoạn (do STT bị dồn khi thêm dự án), hiện “đang ở [sai] → theo nhật ký [đúng]” và cho 1 chạm “Đưa về đúng chỗ”. NHỚ bấm “Tạo bản sao lưu” ở tab Sao lưu trước khi áp dụng.",
    "DST — tinh chỉnh hiển thị: cột “Khối lượng hoàn thành” chỉ DÒNG TỔNG hiện %, còn đầu việc con hiện “đã làm / tổng”; dòng thiếu thông tin để dấu vàng ⚠— cho dễ nhận; cột Kết thúc hết bị mờ; dòng cấp KHU in đậm nổi bật; các cảnh báo đổi sang màu VÀNG (thay vì đỏ) để không bị hiểu nhầm là lỗi lớn.",
  ] },
  { v: "3.61.0", date: "19/08/2026", items: [
    "DST (Theo dõi tiến độ chi tiết) — nâng cấp: (1) Cột “Khối lượng hoàn thành” ở DÒNG TỔNG nay hiện % TRUNG BÌNH các hạng mục con CÓ số liệu, bỏ qua dòng trống (kiểu iferror). (2) Bỏ cột “Người phụ trách”; kéo đổi độ rộng từng cột được; biểu đồ rộng hơn; thêm nút “Toàn màn hình” và lọc “Chỉ quá hạn”. (3) Cảnh báo ngay trong số liệu: Thi công kết thúc SỚM HƠN các công đoạn khác trong khu (vô lý vì phải xong mấy cái kia mới thi công xong), và các dòng THIẾU thông tin (vẫn không tính vào trung bình). (4) Bộ lọc dự án hiện Tên dự án + Mã CT — các dòng số nguyên là các KHU của một dự án; chọn dự án sẽ hiện đủ khu (nền tảng nối sâu với ePMP sau).",
  ] },
  { v: "3.60.0", date: "19/08/2026", items: [
    "CHỐNG NOTE “NHẢY” — Công cụ dữ liệu thêm tab “Note bị trôi”: mỗi ghi chú Vướng mắc/Giải pháp nay TỰ NHỚ nó gắn ở đâu (lúc bạn viết). Khi nguồn đánh lại STT / thêm dự án / đảo dòng làm ghi chú nhảy sang hạng mục khác, hệ thống tự phát hiện và chỉ rõ TRƯỚC ở đâu → GIỜ nhảy sang đâu, kèm nút “Đưa về đúng chỗ” (tự tìm đúng hạng mục, 1 chạm; không đè ghi chú khác). Vào app mà có note trôi thì hiện BANNER ĐỎ báo ngay. (Ghi chú đã có từ trước lấy mốc theo lần nạp đầu tiên — hãy đảm bảo dữ liệu đang đúng khi bật.)",
  ] },
  { v: "3.59.0", date: "19/08/2026", items: [
    "CÔNG CỤ DỮ LIỆU (Admin) — đọc là hiểu ngay vấn đề: (1) Bảng rộng hơn, bấm ra ngoài KHÔNG tắt (tránh mất khi đang đọc). (2) “Cảnh báo dữ liệu” nay LIỆT KÊ ĐÍCH DANH từng dòng lỗi (STT · dự án · giá trị sai) kèm “cách sửa”, thêm dòng tổng quan đầu bảng — kể cả các lỗi trước đây chỉ báo con số (ô % nghi ngờ, ngày không đọc được, đầu việc mồ côi, mã lạ). (3) “Sửa lệch STT” hiện THẲNG bảng chẩn đoán “ghi chú nào đang gắn nhầm ở dự án nào → dời về đâu” trước khi áp dụng; thêm ô chọn “chèn ở STT” + “số bậc dồn” nên dùng được cho mọi đợt chèn dự án, không chỉ một lần.",
  ] },
  { v: "3.58.1", date: "19/08/2026", items: [
    "DST — HOTFIX 2 lỗi: (1) tên app không còn bị cắt mất chữ “tiết” (giữ nguyên “DST · Theo dõi tiến độ chi tiết”). (2) Không còn các dòng “lạ” nổi lên đầu dự án: nguyên nhân là file nguồn có dòng con đặt TRƯỚC mục cha, hoặc gõ nhầm số thứ tự (ví dụ một dòng đánh số 1.3.3 nằm trong dự án số 4). Nay hệ thống tự xếp mỗi dòng vào đúng mục của nó, bỏ “khu rỗng” do dòng tổng/chân trang gây ra, và giữ đủ cả dòng trùng số thay vì làm lệch bảng.",
  ] },
  { v: "3.58.0", date: "18/08/2026", items: [
    "Đổi tên app “Chi tiết tiến độ” → “DST — Detail Schedule Tracking (Theo dõi tiến độ chi tiết)”. Thêm bộ LỌC THEO DỰ ÁN trên thanh trên: chọn một dự án để xem riêng các khu của nó (hiện đang nạp các khu dự án Nam Phương, sau sẽ nhiều dự án hơn). Khi Nhập dữ liệu, thêm ô “Tên dự án” để gộp tất cả khu trong file về một dự án cho dễ lọc.",
  ] },
  { v: "3.57.0", date: "17/08/2026", items: [
    "CHỐNG MẤT DỮ LIỆU KHI CẬP NHẬT: (1) Khi đang gõ Vướng mắc/Giải pháp mà có bản mới, hệ thống hiện banner “Đã có bản cập nhật mới — lưu xong hãy tải lại trang”, bạn chủ động tải lại thay vì bị mất. (2) Nội dung đang soạn dở nay được LƯU TẠM trong máy: lỡ tải lại hay mất mạng vẫn còn nguyên, và nếu gửi lỗi thì giữ nguyên chữ + báo để thử lại. (3) Cảnh báo trước khi đóng tab lúc còn nội dung chưa gửi.",
  ] },
  { v: "3.56.1", date: "17/08/2026", items: [
    "“Chi tiết tiến độ theo NGÀY” — chỉnh theo góp ý: (1) vào là thấy mốc HÔM NAY sát mép trái (khung mặc định bắt đầu từ 7 ngày trước, kéo dài ~3 tháng); thêm nút “Tất cả”/“Gần đây” để đổi khung. (2) Cột trái: Hạng mục · Người phụ trách · Đơn vị tính · Khối lượng hoàn thành · Bắt đầu · Kết thúc · Quá hạn — tiêu đề tự xuống dòng cho gọn, còn nội dung dòng giữ 1 hàng (tên dài cắt “…”) để thanh tiến độ thẳng hàng. Dòng cha lấy TRUNG BÌNH các dòng con có số (bỏ qua dòng “—”).",
  ] },
  { v: "3.55.0", date: "17/08/2026", items: [
    "MỚI — app “Chi tiết tiến độ theo NGÀY” trên thanh dọc bên trái: bảng Gantt phân cấp SÂU (dự án → công đoạn → đầu việc con), theo dõi theo TỪNG NGÀY (1 ô = 1 ngày). Có cột Khối lượng · ĐVT · Quá hạn; % và ô Sản xuất hiện ngay trên thanh tiến độ; nhập dữ liệu từ file .xlsx hoặc link Drive. Bấm biểu tượng cây thư mục ở thanh dọc bên trái để mở.",
  ] },
  { v: "3.54.2", date: "14/08/2026", items: [
    "PMO gắn link — SỬA lỗi “hiện cả file thay vì đúng vùng”: nay LUÔN giữ gid của link (gid trỏ đúng tab) + cắt theo vùng A1 → hiện ĐÚNG vùng, KÈM biểu đồ, gói 1 trang (đã kiểm trên sheet thật, cắt đúng A1:F20). Bỏ ô “Tên sheet” (chính nó gây lỗi) — chỉ cần dán URL đúng tab + gõ Vùng. LƯU Ý: chỉ cắt được với Google Sheet NATIVE; file .xlsx thì Google xuất cả file.",
  ] },
  { v: "3.54.1", date: "14/08/2026", items: [
    "Đánh giá tuân thủ: căn GIỮA toàn bộ tiêu đề cột của các bảng (Tóm tắt + Chi tiết) — đồng nhất app + bản in PDF.",
  ] },
  { v: "3.54.0", date: "14/08/2026", items: [
    "MỚI — PMO GẮN LINK hiển thị thẳng trong app (không cần hyperlink trong file import): rê tới dự án ở cột “Thi công lắp đặt” → bấm “Gắn link” → dán URL Google Sheet + tên sheet + vùng (vd B2:M45) → Xem thử → Lưu. Dự án đã gắn hiện 📊 cho MỌI người bấm xem (ảnh PDF y hệt sheet, gói gọn 1 trang, không cắt ngang chart). Khoá theo Mã CT + Tên nên chèn/đổi STT không lệch. (Sheet phải chia sẻ “Anyone with the link”.)",
    "Đánh giá tuân thủ — đổi nhãn cho rõ: “Project Manager” → “Người phụ trách”; mục 2 → “Danh sách các dự án không cập nhật tuần …”; cột → “Tên dự án”; cột bảng Chi tiết “Cần cập nhật Master Plan” → “Không trình Master Plan cập nhật”. (Đồng nhất app + bản in PDF.)",
  ] },
  { v: "3.53.4", date: "14/08/2026", items: [
    "Vướng mắc / Giải pháp: CẤP QUYỀN cho PMO được TÔ MÀU (highlight) tin — như admin. Màu tự theo cột: Vướng mắc = ĐỎ, Giải pháp = XANH NAVY. (Bấm biểu tượng bút tô ở góc mỗi tin để tô / bỏ tô.)",
  ] },
  { v: "3.53.3", date: "14/08/2026", items: [
    "Đánh giá tuân thủ — xuất PDF Chi tiết: BỎ đường kẻ ngang kẻ xuyên qua ô gộp 2 cột “Điểm PM/Người phụ trách” → nay ô gộp SẠCH, căn giữa đúng y như trên app (chuyển viền ngang giữa hàng từ <tr> sang <td> để html2canvas không kẻ xuyên ô rowSpan).",
  ] },
  { v: "3.53.2", date: "14/08/2026", items: [
    "Đánh giá tuân thủ — HOTFIX header bảng Chi tiết: khi ĐÃ CUỘN bảng rồi mới bấm xuất PDF, header cột không còn “đi theo” chỗ cuộn — nay LUÔN về đầu bảng, 2 cột Điểm PM/Người phụ trách merge sạch đúng như trên app.",
    "Header dán (sticky) trên app hết bị “văng” khi cuộn (chỉ dán ở ô tiêu đề, bỏ dán trùng ở thead + thêm z-index).",
  ] },
  { v: "3.53.1", date: "14/08/2026", items: [
    "Đánh giá tuân thủ — HOTFIX tiêu đề tách theo trang: Tóm tắt = “Báo cáo tuân thủ cập nhật Master Plan”, Chi tiết = “Báo cáo tuân thủ - Danh sách chi tiết” (bản GỘP: trang 1 & trang 2 mỗi trang đúng tiêu đề riêng).",
    "Bảng Chi tiết: sửa header cột bị “nhảy bậy” khi cuộn — nay ghim đúng trên cùng (thêm z-index cho ô tiêu đề dán).",
    "Tóm tắt: BỎ dòng ghi chú “* Các dự án lỗi Không cập nhật…”; KÉO CAO bảng “Danh sách không cập nhật” + phóng vừa cho ĐẦY trang in (bớt khoảng trống dư ở dưới).",
  ] },
  { v: "3.53.0", date: "14/08/2026", items: [
    "Báo cáo tuân thủ — LÀM MỚI BẢN IN cho gọn & đồng bộ giao diện: header CĂN GIỮA, nền xám–thẻ trắng như mẫu (bỏ dải trắng ở đầu), bố cục xếp TỪ TRÊN XUỐNG; tiêu đề bỏ chữ “THÁNG…” lặp (đã có dòng Kỳ báo cáo).",
    "Xuất PDF GỘP: trang Chi tiết (từ trang 2) nay CÓ ĐỦ tiêu đề + phần “Cách tính điểm” + bảng — giống HỆT bản in riêng Chi tiết (trước bị thiếu).",
    "Bảng Chi tiết: 2 cột “Điểm PM” và “Người phụ trách” căn giữa ô; ĐƯỜNG KẺ Ô rõ hơn cho dễ đọc (cả app lẫn bản in). Bỏ đường kẻ đậm chia nhóm PM trong BẢN IN (vẫn giữ nhẹ trên app).",
    "Cột “Cần cập nhật MP” → ghi đủ “Cần cập nhật Master Plan”; cứ bị trừ điểm là tô ĐỎ cho dễ phân biệt.",
    "Xuất PDF tuân thủ: BỎ khổ ngang — chỉ còn “Xuất riêng” và “Xuất gộp” (khổ dọc).",
    "CÔNG CỤ DỮ LIỆU (Admin) gộp 1 chỗ: Cảnh báo dữ liệu + Sửa lệch STT + SAO LƯU/KHÔI PHỤC (tự chụp bản gốc trước mỗi thao tác nguy hiểm, giữ 8 bản gần nhất — lệch thì bấm quay về).",
  ] },
  { v: "3.52.1", date: "14/08/2026", items: [
    "Trả MÀU Ô NHẬP vướng mắc/giải pháp về VÀNG như cũ (bản trước lỡ đổi sang trắng — chưa được duyệt).",
    "Đánh giá tuân thủ · Tóm tắt: TẠM ẨN mục “Danh sách tổng hợp dự án” (chip theo nhóm) — chờ duyệt.",
    "Sửa lệch STT (admin): khi Áp dụng nay ghi CHI TIẾT vào Nhật ký giám sát — từng ghi chú đang nhầm ở dự án nào → dời về dự án nào (biết rõ “lệch ở đâu”).",
  ] },
  { v: "3.52.0", date: "14/08/2026", items: [
    "CÔNG CỤ ADMIN — “Sửa lệch STT (chèn dự án)”: khi chèn 1 dự án vào giữa làm STT dồn, ghi chú/ngày/cờ bị lệch sang dự án khác. Menu Hệ thống → bấm để dời khoá về đúng dự án (XEM TRƯỚC số lượng rồi mới Áp dụng, chạy 1 lần, ghi nhật ký giám sát).",
    "Đánh giá tuân thủ · Tóm tắt: danh sách dự án theo nhóm xếp thành các CỘT ĐỀU NHAU (điền dọc từ trên xuống rồi mới sang phải, bé→lớn); biểu đồ điểm TB PM tách khe rõ.",
    "Đánh giá tuân thủ: cột “Cần cập nhật MP” nay HIỆN các dự án đang cần cập nhật (vàng nhạt = tuần đầu chưa trừ; đậm dần vàng→đỏ theo số TUẦN BÁO CÁO còn cờ). Đếm theo KỲ BÁO CÁO — tuần dính cờ đầu tiên được miễn, sang tuần báo cáo kế tiếp mà vẫn còn cờ mới bắt đầu −10đ/tuần.",
    "Xuất PDF tuân thủ: bảng Chi tiết & bản Gộp nay PHỦ KÍN bề ngang trang (autofit, cột giàn đều), header cân với bảng, gọn 1 trang; xuất riêng Tóm tắt header hết lỗ hổng khi ẩn chú thích.",
    "Sửa dấu tuần hiện hành: tô XANH đúng cột tuần CHỨA hôm nay (vd 13/08 tô 12/08, không nhảy sang 19/08).",
  ] },
  { v: "3.51.0", date: "12/08/2026", items: [
    "Đánh giá tuân thủ · Tóm tắt: biểu đồ điểm TB PM TÁCH KHE các cột cho rõ; phần “Chi tiết điểm theo dự án” gọn lại — mỗi PM 1 dòng (tên + điểm TB), RÊ CHUỘT vào PM hiện bảng nổi liệt kê đủ dự án + điểm. Bỏ “Số dự án không cập nhật tuần này”; đổi “Không trình BOD” → “Không trình Master Plan cập nhật”.",
    "Xuất PDF báo cáo tuân thủ thêm kiểu GỘP (Tóm tắt trang 1 + Chi tiết trang 2 trở đi, 1 file); xuất riêng Tóm tắt thì bỏ phần chú thích ✓/o/x (không cần), xuất Chi tiết vẫn có.",
  ] },
  { v: "3.50.1", date: "11/08/2026", items: [
    "Cảnh báo dữ liệu — mục mã lạ (không thuộc giai đoạn nào): đổi “Ví dụ:” thành “Mã bị bỏ:” (đây là lỗi thật, liệt kê đúng mã) và gộp trùng cho gọn.",
  ] },
  { v: "3.50.0", date: "11/08/2026", items: [
    "Điểm tuân thủ nay CHO PHÉP ÂM (bỏ sàn 0): dự án/PM bị trừ quá nhiều (nhiều tuần không cập nhật, hoặc trừ BOD) sẽ hiện điểm âm thay vì kẹp ở 0 — phản ánh đúng mức độ. Cột điểm & biểu đồ tự hiện số âm (màu đỏ).",
  ] },
  { v: "3.49.1", date: "11/08/2026", items: [
    "Đổi tên cột “Giải pháp” thành “Giải pháp / Action plan” (bảng Danh sách, bảng gộp, xuất PDF/Excel).",
  ] },
  { v: "3.49.0", date: "11/08/2026", items: [
    "Biểu đồ Tổng thể tiến độ: ô “Sản xuất nhập kho” (SX) nay chuyển XANH LÁ theo % đã sản xuất xong (tô dần từ tuần sớm sang) — nhìn cột SX là biết ngay mỗi dự án đã sản xuất tới đâu; xong 100% thì xanh hết, phần chưa xong vẫn đỏ.",
  ] },
  { v: "3.48.0", date: "07/08/2026", items: [
    "Bảng Public Summary (popup) đổi thứ tự cột khớp mẫu mới của nguồn: % xong hôm trước · % thực tế · % tăng thêm trong ngày · Cảnh báo trễ tiến độ · Chênh lệch. Số liệu y nguyên (đọc theo tên cột nên đảo cột trong file không lệch data).",
  ] },
  { v: "3.47.0", date: "07/08/2026", items: [
    "Sửa heatmap ma trận lắp đặt tô SAI màu (mất xanh lá, lệch cả bảng): giờ đọc ĐÚNG màu điều kiện (conditional-formatting) từ chính file — mã ô → màu chuẩn xác, thay vì đoán theo thứ tự chú thích (vốn lệch). Xanh lá “Xoá list Defect” đã hiện lại đúng.",
  ] },
  { v: "3.46.0", date: "07/08/2026", items: [
    "Sửa hyperlink ma trận lắp đặt “nhảy” sang dự án khác: dự án dùng chung mã CT mà KHÔNG có link riêng (vd Mini Hotel B6-B9) không còn mở nhầm ma trận của bản kia — chỉ mở khi chính dòng đó có hyperlink (khoá theo STT, bỏ rớt về mã chung).",
  ] },
  { v: "3.45.0", date: "07/08/2026", items: [
    "Dọn giao diện ngoài cho SẠCH (sếp lớn xem): bỏ dải cảnh báo “% nghi ngờ dữ liệu” khỏi trang chính — mọi cảnh báo kỹ thuật giờ gom hết trong menu Hệ thống ▸ Cảnh báo dữ liệu.",
  ] },
  { v: "3.44.0", date: "07/08/2026", items: [
    "Sửa lỗi PM hiển thị SAI khi nhiều dự án dùng chung mã CT (vd Mini Hotel PQ CT25-051: bản thường = Nguyễn Hoài Vũ, bản B6-B9 = Trần Quốc Lý) — giờ lấy PM theo TÊN đầy đủ, không gộp theo mã. Thông tin gốc luôn theo file import.",
    "Cảnh báo dữ liệu (menu Hệ thống) bắt thêm: mã CT dùng cho nhiều dự án khác PM, trùng tên dự án, dự án thiếu PM.",
  ] },
  { v: "3.43.0", date: "07/08/2026", items: [
    "Chống vướng mắc “nhảy” dự án khi đánh lại STT: app đọc thêm cột “IDCUNG” (mã dự án vĩnh viễn) làm khoá bền — STT đổi thế nào cũng không lệch. Chưa có cột thì vẫn chạy như cũ (theo STT). Có Apps Script tự đóng dấu ID cứng (scripts/stamp-hard-id.gs) + tự di trú dữ liệu cũ 1 lần.",
  ] },
  { v: "3.42.0", date: "07/08/2026", items: [
    "Xuất PDF báo cáo tuân thủ nay dựng ĐÚNG MẪU MASTER (thứ tự cột: Ngày cập nhật · Điểm PM · Người phụ trách · Tên dự án · Lũy kế · Điểm dự án · các tuần; có ô chú thích ✓/o/x; bỏ cột Vùng). Bảng trên màn hình giữ nguyên như cũ.",
    "Dời cảnh báo chất lượng dữ liệu (STT trùng/trống…) từ đầu trang VÀO menu “Hệ thống” → mục “Cảnh báo dữ liệu” (chỉ PMO/admin thấy), gọn màn hình chính.",
  ] },
  { v: "3.41.0", date: "07/08/2026", items: [
    "Xuất PDF bảng Đánh giá tuân thủ nay chọn được khổ DỌC (A4) — gói gọn còn ~một nửa số trang so với khổ ngang (đỡ lê thê khi in/gửi).",
    "Cổng kiểm soát dữ liệu: cảnh báo NGAY khi file có STT (ID) TRÙNG hoặc TRỐNG — đây là nguyên nhân Vướng mắc/Giải pháp bị “nhảy” sang dòng khác hoặc mất; hiện dải cảnh báo ở đầu báo cáo (bấm xem chi tiết dòng nào).",
  ] },
  { v: "3.40.0", date: "05/08/2026", items: [
    "Popup “Thi công lắp đặt” thêm nút “↻ Làm mới”: vừa sửa sheet nguồn là bấm để tải bản mới nhất NGAY (không chờ mốc 17:30). Bình thường vẫn nhanh nhờ cache.",
  ] },
  { v: "3.39.1", date: "05/08/2026", items: [
    "PDF y hệt: file .xlsx (không nhận gid) nay tự lùi về hiện PDF nguyên file (trang đầu = sheet đầu), thay vì lỗi.",
  ] },
  { v: "3.39.0", date: "05/08/2026", items: [
    "Popup “Thi công lắp đặt”: tab tên KHÁC (không phải Summary/Public Summary) nay hiện BẢN PDF y hệt màn hình sheet — CÓ cả biểu đồ và màu tô điều kiện (Google render). Lỗi PDF thì mới đổ bảng HTML.",
  ] },
  { v: "3.38.0", date: "05/08/2026", items: [
    "Popup “Thi công lắp đặt”: hyperlink tới tab tên KHÁC (không phải Summary/Public Summary) sẽ ĐỔ NGUYÊN sheet lên (giá trị + màu) — xem nhanh mọi báo cáo chưa đồng bộ form, khỏi cần chuẩn hoá trước.",
  ] },
  { v: "3.37.0", date: "05/08/2026", items: [
    "Heatmap ma trận bàn giao nay tô đúng cho MỌI dự án (block A/B/C/D hay B1..Bn, số tầng/căn bất kỳ, chú thích khác nhau) — tự đọc bảng màu từ legend của từng file thay vì cố định theo Mini Hotel.",
  ] },
  { v: "3.36.3", date: "05/08/2026", items: [
    "Ma trận lắp đặt: chốt giờ làm mới dữ liệu 1 lần/ngày lúc 17:30 (trước là 08:00) — cả ngày bấm vào là hiện tức thì, không phải chờ tải.",
  ] },
  { v: "3.36.2", date: "05/08/2026", items: [
    "Sửa lỗi popup ma trận “HTTP 400”: khi tải theo tab lỗi, tự lùi về tải nguyên file — heatmap dạng phòng hiện lại bình thường.",
  ] },
  { v: "3.36.1", date: "05/08/2026", items: [
    "Sửa: 1 dự án có NHIỀU matrix lắp đặt (phòng + Public…) không còn đè link nhau — mỗi ô giữ link riêng. Ngày trong biểu đồ Public đổi về dd/mm/yyyy.",
  ] },
  { v: "3.36.0", date: "05/08/2026", items: [
    "Popup “Thi công lắp đặt” nhận dạng thứ 2: hyperlink trỏ tab “Public Summary” sẽ hiện BẢNG + BIỂU ĐỒ CỘT (khu Public, đường kế hoạch), phân biệt với dạng ma trận phòng theo tên tab.",
  ] },
  { v: "3.35.4", date: "05/08/2026", items: [
    "Đổi tên cột “Vướng mắc” thành “Vướng mắc / Cần xử lý” (bảng, bảng gộp, xuất PDF/Excel).",
  ] },
  { v: "3.35.3", date: "04/08/2026", items: [
    "Bảng Đánh giá tuân thủ: data bar “Số lần không cập nhật” đo theo TỔNG số tuần trong tháng (tháng 4 tuần → 1 lần chiếm 1/4 ô), không còn lấp đầy ô.",
  ] },
  { v: "3.35.2", date: "04/08/2026", items: [
    "Bảng Đánh giá tuân thủ: data bar cột “Số lần không cập nhật” đổi từ đỏ sang xanh dương.",
  ] },
  { v: "3.35.1", date: "04/08/2026", items: [
    "Sắp xếp cột “Tình trạng” gom theo màu: Trễ tiến độ → Cắt đầu việc (đỏ) → Cần tập trung (đỏ) → Cắt đầu việc (vàng) → Cần tập trung (vàng) → Không vấn đề → Đã hoàn thành.",
  ] },
  { v: "3.35.0", date: "04/08/2026", items: [
    "Sắp xếp cột “Tình trạng” nay theo đúng mức nghiêm trọng: Trễ tiến độ → Cắt đầu việc (đỏ → vàng) → Cần tập trung (đỏ → vàng) → Không vấn đề → Đã hoàn thành; bấm lần 2 đảo chiều.",
  ] },
  { v: "3.34.1", date: "04/08/2026", items: [
    "Dòng “SD” (Shop Drawing) nay xếp NGAY TRƯỚC dòng “TKSX” (cả bảng lẫn biểu đồ Tổng thể tiến độ).",
  ] },
  { v: "3.34.0", date: "04/08/2026", items: [
    "Bấm vào số phiên bản (góc trên phải) để xem “Có gì mới” — nhật ký thay đổi theo từng bản.",
  ] },
  { v: "3.33.3", date: "04/08/2026", items: [
    "Biểu đồ Tổng thể tiến độ: hết vạch trắng cắt ngang băng đỏ “tuần hiện hành” khi bật hiện việc đã xong.",
  ] },
  { v: "3.33.2", date: "31/07/2026", items: [
    "Badge “Đã hoàn thành” bỏ dấu tick cho gọn.",
  ] },
  { v: "3.33.0", date: "31/07/2026", items: [
    "TKSX: ô phụ trách nhập tiền tố khác (PC, SHD…) nay hiển thị đúng, không nhét nhầm vào “SD -”.",
  ] },
  { v: "3.32.0", date: "31/07/2026", items: [
    "Nhật ký giám sát: bộ lọc phân lớp — chọn “Hôm nay” chỉ hiện các tài khoản có hoạt động hôm nay.",
  ] },
  { v: "3.31.0", date: "31/07/2026", items: [
    "Tên PM ở công đoạn tự lấy từ người phụ trách CẤP DỰ ÁN (tên đầu tiên); sửa lỗi hiện nhầm người SD thành PM.",
  ] },
  { v: "3.30.0", date: "31/07/2026", items: [
    "Thêm nút “Trình chiếu TV” (menu Hệ thống): phóng to lấp đầy màn hình TV lớn khi họp — nhớ trạng thái.",
    "Nhóm cảnh báo “Bám sát kế hoạch” đổi từ < 20% thành ≤ 20%.",
  ] },
  { v: "3.29.0", date: "31/07/2026", items: [
    "Thêm bộ lọc “PM” (theo người phụ trách chính cấp dự án) cho cả bảng lẫn Tổng thể tiến độ.",
  ] },
  { v: "3.28.0", date: "31/07/2026", items: [
    "Chức năng ẩn dòng thủ công áp cho cả biểu đồ Tổng thể tiến độ.",
  ] },
  { v: "3.27.0", date: "31/07/2026", items: [
    "Biểu đồ Tổng thể tiến độ thêm cột “Ngày update” (trước cột Mã).",
  ] },
  { v: "3.26.0", date: "31/07/2026", items: [
    "Admin ẩn được dòng hạng mục “không đáng nêu” khỏi báo cáo; nút “Dòng đã ẩn” để soi lại & bỏ ẩn.",
  ] },
  { v: "3.25.0", date: "31/07/2026", items: [
    "PMO được sửa / ẩn / xoá bình luận của người khác trong cột Vướng mắc & Giải pháp.",
  ] },
  { v: "3.24.0", date: "31/07/2026", items: [
    "Nhận diện mã “SD” là hạng mục “Shop Drawing”.",
  ] },
  { v: "3.23.0", date: "31/07/2026", items: [
    "Xuất Excel giống hệt bảng/PDF nhưng là ô THẬT (lọc / sắp xếp / sửa ngay trong Excel).",
  ] },
  { v: "3.22.0", date: "31/07/2026", items: [
    "Sửa tận gốc lỗi cắt ngang bảng khi xuất PDF (cả khổ ngang lẫn dọc).",
  ] },
  { v: "3.19.0", date: "31/07/2026", items: [
    "Bộ lọc “Cần cập nhật MP” tự nhận dự án có vướng mắc “trình BOD phê duyệt (Bitrix)”.",
  ] },
];
const APP_VERSION = CHANGELOG[0].v;

/** FILE NGUỒN cho bảng ĐÁNH GIÁ TUÂN THỦ — Google Sheet RIÊNG cho function này (tách khỏi PMP).
 *  App đọc CSV tab này (gid), parse Ở CLIENT (xem lib/compliance-file.ts). Đổi link ở ĐÂY. */
const COMPLIANCE_FILE_URL = "https://docs.google.com/spreadsheets/d/15pcqb0ExFQ5uF9CuKSx6O6y9GN4kfiNf6IARN98pJbA/edit?gid=490936703";

type Mode = "google" | "upload";
type Config = { mode: Mode; sheetUrl?: string };
/** `today` KHÔNG do người dùng chỉnh — nó đi kèm ngưỡng vì ma trận cần biết dự án còn
 *  mấy ngày tới mốc bàn giao. Bơm vào tại nơi dùng (xem `thWithToday`). */
type Thresholds = { gapThreshold: number; overdueThreshold: number; today?: string };
// Chốt 09/07/2026: Trễ tiến độ khi lệch ≥ 40 điểm; Cần cắt khi >80% & quá hạn >10 ngày;
// cảnh báo QUÁ HẠN riêng khi quá hạn ≥ 14 ngày (OD_ALERT_DAYS trong lib/filter).
const DEFAULT_THRESHOLDS: Thresholds = { gapThreshold: 40, overdueThreshold: 10 };

function loadConfig(): Config {
  // Chưa có cấu hình riêng → dùng nguồn mặc định (nếu đã set DEFAULT_SHEET_URL).
  const fallback: Config = DEFAULT_SHEET_URL
    ? { mode: "google", sheetUrl: DEFAULT_SHEET_URL }
    : { mode: "google" };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const c = JSON.parse(raw) as Config;
      // Cấu hình cũ ở chế độ Google nhưng thiếu link → điền link mặc định.
      if (c.mode === "google" && !c.sheetUrl && DEFAULT_SHEET_URL) c.sheetUrl = DEFAULT_SHEET_URL;
      return c;
    }
  } catch { /* */ }
  return fallback;
}
function saveConfig(c: Config) { try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch { /* */ } }
function loadThresholds(): Thresholds {
  // Ngưỡng cảnh báo do CODE quản (đã bỏ nút chỉnh trên UI) — không đọc bản lưu
  // localStorage cũ để mọi người luôn dùng đúng ngưỡng đã chốt.
  return DEFAULT_THRESHOLDS;
}
function saveThresholds(t: Thresholds) { try { localStorage.setItem(LS_TH, JSON.stringify(t)); } catch { /* */ } }

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** CỔNG DỮ LIỆU: nguồn có lỗi cấu trúc thì NÉM LỖI — không bao giờ để dữ liệu
 *  hỏng thay thế dữ liệu tốt đang hiển thị (app sẽ giữ bản lưu gần nhất). */
function assertDataQuality(p: ReportData): ReportData {
  if (p.quality?.level === "error") {
    const reasons = p.quality.checks.filter(c => c.level === "error").map(c => c.label).join(" · ");
    throw new Error(`Dữ liệu KHÔNG ĐẠT kiểm tra đầu vào: ${reasons}`);
  }
  return p;
}

/* ======================================================================
 *  STAGE & DEPARTMENT MAPPING (per PMO spec — June 2026)
 *
 *  Bộ phận theo giai đoạn:
 *    QS       ← LOA, Tạm ứng  +  Báo giá        (BG)
 *    SCM      ← Duyệt mẫu  +  Đặt vật tư        (MA + VT)
 *    Nhà Máy  ← Sản xuất nhập kho               (SX)
 *    PM       ← Phát hành thiết kế + Triển khai sản xuất + Thi công lắp đặt
 *               (TK + SD + TC)
 * ====================================================================== */

type StageId = "TK" | "MA" | "BG" | "VT" | "SD" | "SX" | "TC";
// Thứ tự HOÀN THÀNH DỰ ÁN (quy ước chung, dùng cho databar + sắp xếp Hạng mục):
// Phát hành thiết kế → LOA/Tạm ứng → Duyệt mẫu → Đặt vật tư → Triển khai SX →
// Sản xuất nhập kho → Thi công lắp đặt.
const STAGE_ORDER: StageId[] = ["TK", "BG", "MA", "VT", "SD", "SX", "TC"];

const STAGE_META: Record<StageId, { label: string; dept: string }> = {
  TK: { label: "Phát hành thiết kế",   dept: "PM" },
  MA: { label: "Duyệt mẫu",            dept: "SCM" },
  BG: { label: "LOA, Tạm ứng",         dept: "QS" },
  VT: { label: "Đặt vật tư",           dept: "SCM" },
  SD: { label: "Triển khai sản xuất",  dept: "PM" },
  SX: { label: "Sản xuất nhập kho",    dept: "NM" },
  TC: { label: "Thi công lắp đặt",     dept: "PM" },
};

const OTHER_LABEL = "Khác";

/** Chữ viết tắt hạng mục — theo bảng mã chuẩn của PMP (TK/MA/BG/VT/TKSX/SX/TC),
 *  dùng trên thẻ giai đoạn và cột "Hạng mục" của bảng (đồng bộ 2 nơi). */
const STAGE_ABBR: Record<StageId, string> = {
  TK: "TK", MA: "MA", BG: "BG", VT: "VT", SD: "TKSX", SX: "SX", TC: "TC",
};
function stageAbbrOf(sid: StageId | "MB" | "PS" | "SHOP" | "OTHER"): string {
  if (sid === "MB") return "MB";
  if (sid === "PS") return "PS";
  if (sid === "SHOP") return "SD";
  if (sid === "OTHER") return "Khác";
  return STAGE_ABBR[sid];
}

/** THỨ TỰ SẮP XẾP hàng theo VIẾT TẮT hạng mục. Khác STAGE_ORDER (internal id, dùng cho 7 thẻ giai
 *  đoạn): ở đây "SD" (Shop Drawing) đứng NGAY TRƯỚC "TKSX" (chốt 04/08/2026), và TKSX xếp đúng chỗ
 *  (STAGE_ORDER dùng id "SD"=TKSX nên sort theo abbr "TKSX" từng bị rớt xuống cuối). Mã lạ → 90 (cuối). */
const STAGE_ABBR_ORDER: string[] = ["TK", "BG", "MA", "VT", "SD", "TKSX", "SX", "TC"];
function stageRankByAbbr(abbr: string): number {
  const i = STAGE_ABBR_ORDER.indexOf(abbr);
  return i < 0 ? 90 : i;
}

/** Hiển thị "Nhân sự phụ trách" theo QUY ƯỚC từng giai đoạn.
 *  Tên các vai trò QS/SCM lấy từ ô công đoạn (bỏ tiền tố cũ). Riêng vai trò PM (TC + TKSX): tên PM
 *  LUÔN lấy từ NGƯỜI PHỤ TRÁCH CẤP DỰ ÁN (projectPm — "lấy từ trên xuống"), KHÔNG đọc từ ô công đoạn.
 *  Nhờ vậy ô TKSX nhập "SD - Tuấn Khanh" sẽ ra "PM - {PM dự án}, SD - Tuấn Khanh" (không còn hiểu
 *  nhầm Tuấn Khanh là PM). Chốt 31/07/2026. */
function picByStageConv(owner: string, sid: StageId | "MB" | "PS" | "SHOP" | "OTHER", projectPm = ""): string {
  const bare = (owner || "").replace(/^\s*(pm|scm|qs|nm|sd|tđt|tdt|nhà\s*máy)\b[\s\-–—:.&]*/i, "").trim();
  // tên PM = người phụ trách CẤP DỰ ÁN, LẤY TÊN ĐẦU TIÊN (tên sau dấu "/" là DPM, không phải PM).
  const pm = pmFirstOf(projectPm);
  switch (sid) {
    case "TK": return bare;                                  // chỉ tên (vd "Sun Group"); trống → ""
    case "BG": return bare ? `QS - ${bare}` : "QS";
    case "MA": return bare ? `SCM - ${bare}` : "SCM";
    case "VT": return "PM & NM";                             // cố định, không tên
    case "SX": return "NM";                                  // cố định, không tên
    case "TC": return pm ? `PM - ${pm}` : "PM";              // PM lấy từ dự án, KHÔNG từ ô
    case "SD": {                                             // TKSX: PM lấy từ dự án; ô = người SD (hoặc vai trò khác)
      const pmPart = pm ? `PM - ${pm}` : "PM";
      const raw = (owner || "").trim();
      // Ô có TIỀN TỐ VAI TRÒ dạng "CODE - tên" (CODE = 2–4 chữ, vd SD/PC/NM…)?
      const m = raw.match(/^([\p{L}]{2,4})\s*[-–—:]\s*(.*)$/u);
      if (m) {
        const code = m[1].toUpperCase().replace(/Đ/g, "D");
        const name = m[2].trim();
        // Tiền tố ĐÚNG là SD → gộp: "SD - tên".
        if (code === "SD") return `${pmPart}, ${name ? `SD - ${name}` : "SD"}`;
        // Tiền tố KHÁC (vd PC — không phải SD) → GIỮ SD trống, hiện nguyên "CODE - tên" sau đó:
        //   "PM - tên, SD, PC - tên" (không nhét PC vào dưới SD).
        return `${pmPart}, SD${name ? `, ${m[1].trim()} - ${name}` : ""}`;
      }
      // Không có tiền tố dạng "CODE - tên" → coi cả ô là tên SD, nhưng vẫn BỎ tiền tố quen đứng một
      // mình (vd ô chỉ ghi "PM"/"SD" không tên → bare rỗng → hiện "SD", không ra "SD - PM").
      return `${pmPart}, ${bare ? `SD - ${bare}` : "SD"}`;
    }
    default: return bare;                                    // MB / PS / Khác
  }
}


/** Các GIAI ĐOẠN được NHẬP TAY "số mã / tổng mã" (breakdown) → chỉ những giai đoạn này mới
 *  chấm vàng "% cần rà". Các giai đoạn khác (Thiết kế, LOA/Tạm ứng, Thi công lắp đặt…) tính %
 *  theo cách khác (block/nhập tay không breakdown) nên KHÔNG chấm vàng chỉ vì thiếu số mã. */
const COUNT_STAGES = new Set<string>(["Trình duyệt mẫu", "Đặt vật tư", "Triển khai sản xuất", "Sản xuất nhập kho"]);

/** Đọc DEADLINE (ISO yyyy-mm-dd) từ dd/mm trong TỪ KHOÁ vướng mắc "trình BOD phê duyệt".
 *  - Có dd/mm/yyyy → dùng luôn. Có dd/mm (không năm) → NEO năm theo ngày cắm cờ (firstSeenIso):
 *    năm = năm cắm cờ; nếu dd/mm đứng TRƯỚC ngày cắm trong năm (wrap cuối năm) → +1 năm.
 *  - Ưu tiên cụm dd/mm đứng sau chữ "trước". Không tìm được dd/mm hợp lệ → null (gọi bên ngoài lùi logic cũ). */
function parseMpDeadlineIso(note: string, firstSeenIso: string): string | null {
  if (!note) return null;
  const p2 = (n: number) => String(n).padStart(2, "0");
  const valid = (d: number, mo: number) => mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
  // DEADLINE = cụm "trước <dd/mm>" gắn với việc TRÌNH BOD — tức "trước" GẦN chữ "bitrix" NHẤT.
  //  · Một ghi chú có thể có NHIỀU "trước dd/mm" cho việc KHÁC nhau (vd "…(bitrix) trước 09/09. Cần PM
  //    đặt hàng gạch trước 29/08") → phải chọn đúng cụm của BOD (gần bitrix), KHÔNG lấy "trước" cuối.
  //  · KHÔNG có "bitrix" hoặc không có "trước dd/mm" → KHÔNG có deadline (null). KHÔNG nhặt ngày "dời từ".
  const low = note.normalize("NFC").toLowerCase();
  const anchor = low.lastIndexOf("bitrix");   // ô gộp nhiều tin → bám cụm bitrix MỚI NHẤT (tin cuối)
  if (anchor < 0) return null;
  const cands: { pos: number; d: number; mo: number; y: number | null }[] = [];
  const re = /trước\s*(?:ngày\s*)?(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(low)) !== null) {
    const d = +mm[1], mo = +mm[2]; let y: number | null = mm[3] ? +mm[3] : null; if (y != null && y < 100) y += 2000;
    if (valid(d, mo)) cands.push({ pos: mm.index, d, mo, y });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => Math.abs(a.pos - anchor) - Math.abs(b.pos - anchor));   // GẦN "bitrix" nhất
  const r = cands[0];
  let y = r.y;
  if (y == null) {
    const fy = +firstSeenIso.slice(0, 4), fm = +firstSeenIso.slice(5, 7), fd = +firstSeenIso.slice(8, 10);
    y = r.mo < fm || (r.mo === fm && r.d < fd) ? fy + 1 : fy;
  }
  return `${y}-${p2(r.mo)}-${p2(r.d)}`;
}

function stageIdOf(it: ItemRow): StageId | "MB" | "PS" | "SHOP" | "OTHER" {
  const c = it.rawCode.trim().toUpperCase();
  // "Triển khai sản xuất" CHỈ tính mã TKSX (KHÔNG lẫn với mã "SD"). Phải kiểm TKSX TRƯỚC
  // /^SD/ để "TKSX…" không bị bắt nhầm — nhưng TKSX bắt đầu bằng "TK" nên vốn khác "SD".
  if (/^TKSX/.test(c)) return "SD";
  if (/^TK/.test(c)) return "TK";
  if (/^MA|^DM/.test(c)) return "MA";
  if (/^BG/.test(c)) return "BG";
  if (/^VT/.test(c)) return "VT";
  // "SD" = Shop Drawing — hạng mục riêng (chốt 31/07/2026), KHÔNG còn gộp vào "Khác".
  if (/^SD/.test(c)) return "SHOP";
  if (/^SX/.test(c)) return "SX";
  if (/^TC/.test(c)) return "TC";
  if (/^MB/.test(c)) return "MB";
  // PS (Phát sinh) — việc phát sinh thêm, mốc riêng, KHÔNG thuộc dòng chảy giai đoạn
  // chuẩn nên đứng ngoài STAGE_ORDER (không có thẻ giai đoạn, không lọc theo giai đoạn).
  if (/^PS/.test(c)) return "PS";
  return "OTHER";
}
function stageLabelOf(sid: StageId | "MB" | "PS" | "SHOP" | "OTHER"): string {
  if (sid === "MB") return "Bàn giao mặt bằng";
  if (sid === "PS") return "Phát sinh";
  if (sid === "SHOP") return "Shop Drawing";
  if (sid === "OTHER") return "Khác";
  return STAGE_META[sid].label;
}
const STAGE_DISPLAY: Record<string, ReactNode> = {
  "Phát hành thiết kế": <>Phát hành<br />thiết kế</>,
  "Triển khai sản xuất": <>Triển khai<br />sản xuất</>,
  "Sản xuất nhập kho":   <>Sản xuất<br />nhập kho</>,
  "Thi công lắp đặt":    <>Thi công<br />lắp đặt</>,
  "LOA, Tạm ứng":        <>LOA,<br />Tạm ứng</>,
};
function stageDisplayLabel(sid: StageId | "MB" | "PS" | "SHOP" | "OTHER"): ReactNode {
  return STAGE_DISPLAY[stageLabelOf(sid)] ?? stageLabelOf(sid);
}
function deptOf(sid: StageId | "MB" | "PS" | "SHOP" | "OTHER"): string {
  if (sid === "MB" || sid === "PS" || sid === "SHOP" || sid === "OTHER") return OTHER_LABEL;
  return STAGE_META[sid].dept;
}



/* ======================================================================
 *  DYNAMIC % PLAN — công thức duy nhất, không kẹp, không thêm điều kiện biên
 *
 *    % dự kiến = (MIN(today, finish) − start + 1) / (finish − start + 1)
 *
 *  - Mốc là Start/Finish của chính đầu việc. KHÔNG dùng Deadline dự án.
 *  - Đơn vị NGÀY.
 *  - Nếu Finish ≤ Start → trả null (dữ liệu lỗi, bỏ qua, không xét cảnh báo).
 *  - Không clamp 0..100, không có nhánh today<start hay today≥finish.
 * ====================================================================== */

function daysInclusive(aIso: string, bIso: string): number {
  const ta = new Date(aIso.slice(0, 10) + "T00:00:00Z").getTime();
  const tb = new Date(bIso.slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((tb - ta) / 86400000) + 1;
}

/** Kẹp giá trị % về [0, 100]. Áp dụng cho cả % dự kiến lẫn % thực tế. */
function clampPct(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, v));
}

function computePlanPct(startIso: string | null, finishIso: string | null, todayIsoStr: string): number | null {
  if (!startIso || !finishIso) return null;
  const total = daysInclusive(startIso, finishIso);
  if (total <= 0) return null; // Finish ≤ Start → dữ liệu lỗi, bỏ qua
  const todayTs = new Date(todayIsoStr.slice(0, 10) + "T00:00:00Z").getTime();
  const startTs = new Date(startIso.slice(0, 10) + "T00:00:00Z").getTime();
  const finishTs = new Date(finishIso.slice(0, 10) + "T00:00:00Z").getTime();
  const minTs = Math.min(todayTs, finishTs);
  const elapsed = Math.round((minTs - startTs) / 86400000) + 1;
  const pct = (elapsed / total) * 100;
  // KẸP về [0, 100]: hôm nay trước Bắt đầu → 0%; sau Kết thúc → 100%.
  const clamped = Math.max(0, Math.min(100, pct));
  return Math.round(clamped * 10) / 10;
}

/* ======================================================================
 *  PHÂN LOẠI CẢNH BÁO — MA TRẬN 3 CHIỀU (PMO chốt 17/07/2026).
 *  Bảng luật đầy đủ nằm ở lib/filter.ts — đó là NGUỒN SỰ THẬT DUY NHẤT, dùng chung
 *  với Xuất Excel/đối chiếu. Không chép lại luật ở đây.
 *
 *  Chiều 1: % lệch (1/2/3) · Chiều 2: quá hạn đầu việc (A/B/C)
 *  Chiều 3 (MỚI): dự án còn bao nhiêu ngày tới mốc BÀN GIAO — far >30 · d30 ≤30 · d14 ≤14
 *                 Càng sát ngày bàn giao, cùng một tình trạng càng bị siết nặng hơn.
 *
 *  MÀU TÁCH RỜI NHÃN (cũng là điểm mới): màu nói MỨC NGHIÊM TRỌNG, không dính chết
 *  vào chữ. "Cần tập trung" vàng khi dự án còn xa hạn, nhưng ĐỎ khi dự án sắp bàn
 *  giao; "Cần cắt đầu việc" vàng ở far, đỏ từ d30. Vì vậy KHÔNG được suy màu từ
 *  `kind` — phải dùng `color` mà ma trận trả về.
 * ====================================================================== */

type AlertKind = "late" | "trim" | "focus" | "none";
type AlertK = Exclude<AlertKind, "none">;
/** Quá hạn ≥ N ngày → bậc A (đồng bộ lib/filter.OD_ALERT_DAYS). */
const OD_DAYS = 14;
/** Dải "CẦN TẬP TRUNG": lệch từ 20 tới dưới ngưỡng trễ (40). */
const FOCUS_MIN = 20;

function classifyAlert(it: ItemRow, planDyn: number | null, th: Thresholds): {
  kind: AlertKind; color: AlertColor; severityScore: number; severityLabel: string;
} {
  const actClamped = clampPct(it.pctActual);
  const bothValid = planDyn != null && actClamped != null;
  const gap = bothValid ? (planDyn! - actClamped!) : 0;
  const overdue = it.overdueDays || 0;

  // Tra MA TRẬN dùng chung ở lib/filter.ts — KHÔNG giữ bản sao luật ở đây, vì Xuất
  // Excel/đối chiếu cũng tra đúng hàm đó. Một nguồn sự thật ⇒ không bao giờ lệch.
  const bucket = deadlineBucketOf(it.projectDeadline, th.today);
  const { kind, color } = classifyByMatrix(bothValid ? gap : null, overdue, th.gapThreshold, bucket);

  // Ghi rõ khi cảnh báo bị SIẾT vì dự án sắp bàn giao — nếu không, người đọc thấy
  // "lệch 25, chưa quá hạn" mà nhãn là "Trễ tiến độ" thì tưởng app tính sai.
  const sapBanGiao = bucket === "d14" ? `dự án còn ≤ ${IMMINENT_DEADLINE_DAYS} ngày tới bàn giao`
                   : bucket === "d30" ? `dự án còn ≤ ${NEAR_DEADLINE_DAYS} ngày tới bàn giao`
                   : "";
  const themBoiCanh = (s: string) => sapBanGiao ? `${s} · ${sapBanGiao}` : s;

  if (kind === "trim") {
    return {
      kind, color,
      severityScore: overdue,
      severityLabel: themBoiCanh(`Thực tế ${Math.round(actClamped!)}% · quá hạn ${overdue} ngày (gần xong, lệch ${Math.round(gap)} điểm)`),
    };
  }
  if (kind === "late") {
    return {
      kind, color,
      severityScore: gap + overdue * 0.5,
      severityLabel: themBoiCanh(bothValid
        ? `Kế hoạch ${Math.round(planDyn!)}% → Thực tế ${Math.round(actClamped!)}% (lệch ${Math.round(gap)} điểm)${overdue > 0 ? ` · quá hạn ${overdue} ngày` : ""}`
        : `Quá ngày kết thúc ${overdue} ngày (≥ ${OD_DAYS})`),
    };
  }
  if (kind === "focus") {
    // Ma trận có nhiều ca focus → nói ĐÚNG dấu hiệu nào kích hoạt, không ghi cứng
    // cả hai (1C thì quá hạn = 0, 3B thì lệch ngoài dải, 3C thì chỉ do sắp bàn giao).
    const parts: string[] = [];
    if (bothValid && gap > FOCUS_MIN) parts.push(`lệch ${Math.round(gap)} điểm`);
    if (overdue > 0) parts.push(`quá hạn ${overdue} ngày`);
    if (!parts.length && sapBanGiao) parts.push(sapBanGiao);
    else if (sapBanGiao) parts.push(sapBanGiao);
    return {
      kind, color,
      severityScore: gap + overdue * 0.5,
      severityLabel: `Cần tập trung: ${parts.join(" · ")}`,
    };
  }
  return { kind: "none", color: null, severityScore: 0, severityLabel: "" };
}



const ALERT_FULL_NAME: Record<AlertK, string> = {
  late: "Trễ tiến độ",
  trim: "Cần cắt đầu việc",
  focus: "Cần tập trung",
};
/** Nhãn cho trường hợp KHÔNG có cảnh báo. Cố tình là một nhãn có chữ chứ không phải dấu
 *  "—": "—" đọc như ô THIẾU dữ liệu, trong khi đây là một kết luận thật ("đã xét, không
 *  có vấn đề"). Dùng chung cho badge trong bảng và bảng Tiêu chí cảnh báo. */
const ALERT_NONE_LABEL = "Không vấn đề";

type SortKey = "list" | "updateDate" | "maCT" | "name" | "projectDeadline" | "pic"
              | "start" | "finish" | "planPct" | "actualPct" | "overdue"
              | "alert" | "note" | "action";
/** Một khoá trong chuỗi sắp xếp đa cột. */
type SortSpec = { key: SortKey; dir: "asc" | "desc" };



/* ======================================================================
 *  ROOT
 * ====================================================================== */

function Dashboard() {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<Config>({ mode: "google" });
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [uploadData, setUploadData] = useState<ReportData | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [thresholdOpen, setThresholdOpen] = useState(false);
  const [cached, setCached] = useState<CachedReport | null>(null);
  const demoData = useMemo(() => getDemoData(), []);

  const resetPipeline = () => {
    queryClient.removeQueries({ queryKey: ["sheet-csv"] });
    setUploadData(null);
  };

  useEffect(() => {
    setThresholds(loadThresholds());
    setCached(loadLastKnown());
    // NGUỒN DỮ LIỆU: tải NGAY nguồn mặc định (file hardcode) để có dữ liệu liền. Song song đọc cấu hình
    // CHUNG config:v1 (admin đặt qua "Nguồn dữ liệu") — nếu đã set 1 nguồn KHÁC mặc định thì chuyển sang
    // (đổi nguồn cho CẢ TEAM, không cần deploy). config trống / = mặc định → giữ nguyên, không tải lại.
    setConfig({ mode: "google", sheetUrl: DEFAULT_SHEET_URL });
    // CHỈ honor config khi v>=2 (do tính năng "Nguồn dữ liệu" admin ghi) → config CŨ (không v) bị bỏ qua,
    // tránh app nhảy về sheet cũ đã ngừng dùng. Khác mặc định mới chuyển (tránh tải lại thừa).
    void fetchAppConfig()
      .then((cfg) => { if (cfg?.sheetUrl && (cfg.v ?? 0) >= 2 && cfg.sheetUrl !== DEFAULT_SHEET_URL) setConfig({ mode: "google", sheetUrl: cfg.sheetUrl }); })
      .catch(() => { /* KV lỗi → giữ nguồn mặc định */ });
  }, []);

  const gQuery = useQuery({
    queryKey: ["sheet-csv", config.sheetUrl],
    enabled: config.mode === "google" && !!config.sheetUrl,
    queryFn: async (): Promise<ReportData> => {
      if (!config.sheetUrl) throw new Error("Chưa có link Google Sheet.");
      // ĐƯỜNG CHUẨN: tải nguyên file .xlsx từ Google rồi parse bằng ĐÚNG
      // parseXlsxBuffer của nhánh Upload Excel → Google Sheet và Upload
      // cho kết quả GIỐNG HỆT nhau (không còn quirk CSV: cache pub ~5',
      // gviz nuốt dòng, ngày bị format lại theo locale).
      try {
        const r = await fetchSheetXlsx({ data: { url: config.sheetUrl } });
        const bin = atob(r.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const parsed = assertDataQuality(await parseXlsxBuffer(bytes.buffer, todayIso()));
        // Đọc hyperlink "Thi công lắp đặt" NGAY Ở CLIENT từ chính bytes này (Worker khỏi parse).
        const installLinks = readInstallLinks(bytes.buffer);
        return { ...parsed, source: "google", sourceLabel: r.fetchedAt, fetchedAt: r.fetchedAt, installLinks };
      } catch (xlsxErr) {
        // Fallback: đường CSV cũ (chỉ khi xlsx thất bại hoàn toàn).
        console.warn("[sheet] xlsx path failed, falling back to CSV:", (xlsxErr as Error).message);
        const r = await fetchSheetCsv({ data: { url: config.sheetUrl } });
        const parsed = assertDataQuality(parseCsvText(r.text, todayIso()));
        return { ...parsed, source: "google", sourceLabel: r.fetchedAt, fetchedAt: r.fetchedAt };
      }
    },
    staleTime: 0, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false,
  });

  const liveData: ReportData | undefined =
    config.mode === "upload" ? uploadData ?? undefined : gQuery.data;

  useEffect(() => {
    if (liveData) {
      // Cảnh báo BIẾN ĐỘNG BẤT THƯỜNG: số dự án giảm mạnh so với lần trước
      // thường là dấu hiệu sai file/sai tab/file đang sửa dở — phải lộ ra ngay.
      const prev = loadLastKnown();
      if (prev && prev.data.projects.length >= 5 &&
          liveData.projects.length < prev.data.projects.length * 0.6) {
        toast.warning(
          `Số dự án giảm bất thường: ${prev.data.projects.length} → ${liveData.projects.length}. Kiểm tra lại file/link nguồn!`,
          { position: "bottom-left", duration: 10000 },
        );
      }
      saveLastKnown(liveData);
      setCached({ data: liveData, savedAt: liveData.fetchedAt ?? new Date().toISOString() });
    }
  }, [liveData]);

  type DataMode = "live" | "cache" | "demo";
  const { data, dataMode, freshAt } = useMemo<{
    data: ReportData | undefined; dataMode: DataMode; freshAt: string | null;
  }>(() => {
    if (liveData) return { data: liveData, dataMode: "live", freshAt: liveData.fetchedAt ?? null };
    if (cached) return { data: cached.data, dataMode: "cache", freshAt: cached.data.fetchedAt ?? cached.savedAt };
    return { data: demoData, dataMode: "demo", freshAt: demoData.fetchedAt ?? null };
  }, [liveData, cached, demoData]);

  const loading = config.mode === "google" && gQuery.isFetching;
  const error = config.mode === "google" ? (gQuery.error as Error | null) : null;
  const refresh = () => {
    // Làm mới: map hyperlink tự đọc lại theo gQuery (nằm trong data). Chỉ cần bỏ cache nội dung
    // Summary đang mở để lần mở sau lấy bản mới. gQuery cache-bust (_ts) nên luôn kéo bản mới.
    queryClient.invalidateQueries({ queryKey: ["summary-file"] });
    if (config.mode === "upload" && loadConfig().sheetUrl) {
      // Từ Upload quay về Google Sheet đã lưu, rồi kéo dữ liệu mới.
      const saved = loadConfig();
      setUploadData(null);
      const next: Config = { mode: "google", sheetUrl: saved.sheetUrl };
      saveConfig(next); setConfig(next);
      return;
    }
    if (config.mode === "google" && config.sheetUrl) gQuery.refetch();
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 print:bg-white">
      <Header
        loading={loading}
        dataMode={dataMode}
        freshAt={freshAt}
        source={data?.source}
        onRefresh={refresh}
        onOpenSettings={() => setSettingsOpen(true)}
        gapThreshold={thresholds.gapThreshold}
      />

      <DataModeToast mode={dataMode} freshAt={freshAt} error={error?.message ?? null} />
      <main className="mx-auto w-full max-w-[1600px] px-3 py-3 2xl:px-6 print:p-0 print:max-w-none">
        <h1 className="sr-only">Báo cáo tổng hợp tình trạng phối hợp</h1>
        {data && <DashboardBody data={data} thresholds={thresholds} onOpenSource={() => setSettingsOpen(true)} />}
      </main>


      {settingsOpen && (
        <SettingsDialog
          config={config}
          onClose={() => setSettingsOpen(false)}
          onSave={async (c, shareDefault): Promise<{ ok: boolean; message: string }> => {
            // CỔNG DỮ LIỆU: kiểm tra link ĐẠT mới cho áp dụng. Kết quả trả về
            // hiện NGAY TRONG DIALOG (không chỉ toast) để người dùng luôn thấy.
            if (c.mode === "google" && c.sheetUrl) {
              try {
                const timeout = new Promise<never>((_, rej) =>
                  setTimeout(() => rej(new Error("Quá 30 giây không phản hồi. Kiểm tra mạng hoặc quyền share của file")), 30000));
                const r = await Promise.race([fetchSheetXlsx({ data: { url: c.sheetUrl } }), timeout]);
                const bin = atob(r.base64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                const parsed = assertDataQuality(await parseXlsxBuffer(bytes.buffer, todayIso()));
                // ĐẠT → áp dụng ngay (resetPipeline buộc tải lại kể cả cùng URL)
                resetPipeline(); saveConfig(c); setConfig(c);
                let shareMsg = "";
                if (shareDefault) {
                  try {
                    await saveAppConfig({ data: { sheetUrl: c.sheetUrl, devAs: devAs() } });
                    shareMsg = " Đã đặt làm nguồn mặc định cho MỌI NGƯỜI.";
                  } catch (e) {
                    shareMsg = ` LƯU Ý: chưa lưu được mặc định chung (${(e as Error).message}). Chỉ áp dụng trên máy này.`;
                  }
                }
                return {
                  ok: true,
                  message: `Link ĐẠT kiểm tra: ${parsed.projects.length} dự án · ${parsed.items.length} đầu việc, đã áp dụng.${shareMsg}`,
                };
              } catch (e) {
                return { ok: false, message: `KHÔNG áp dụng link: ${(e as Error).message}` };
              }
            }
            resetPipeline(); saveConfig(c); setConfig(c);
            return { ok: true, message: "Đã lưu cấu hình." };
          }}
          onUpload={(d) => { resetPipeline(); setUploadData(d); setConfig({ ...config, mode: "upload" }); saveConfig({ ...config, mode: "upload" }); setSettingsOpen(false); }}
        />
      )}
      {thresholdOpen && (
        <ThresholdDialog
          value={thresholds}
          onClose={() => setThresholdOpen(false)}
          onSave={(t) => { saveThresholds(t); setThresholds(t); setThresholdOpen(false); }}
        />
      )}
    </div>
  );
}

/* ======================================================================
 *  HEADER + FRESHNESS
 * ====================================================================== */

/** Logo ePMP — hộp bo góc, "e" đỏ + "PMP" xanh than (không chấm, e đứng cạnh). */
function EpmpLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-xl border-2 border-[#182230] bg-white px-2.5 py-1 ${className}`}>
      <span className="text-lg font-black leading-none tracking-tight sm:text-xl">
        <span className="text-[#c0392b]">e</span><span className="ml-[2px] text-[#182230]">PMP</span>
      </span>
    </span>
  );
}

/** File logo AA Corporation THẬT (data URI). Trống = chưa có file → hiện tạm tên
 *  hãng, KHÔNG dựng lại logo (logo bản quyền). Dán data URI base64 vào đây. */
const AA_LOGO_SRC = AA_LOGO_DATA_URI;

function AALogo({ className = "" }: { className?: string }) {
  if (AA_LOGO_SRC) return <img src={AA_LOGO_SRC} alt="AA Corporation" className={`${className} object-contain`} />;
  return (
    <span className="whitespace-nowrap text-base font-extrabold tracking-tight text-[#E1251B] sm:text-lg">
      AA Corporation
    </span>
  );
}

function Header({ loading, dataMode, freshAt, source, onRefresh, gapThreshold }: {
  loading: boolean;
  dataMode: "live" | "cache" | "demo"; freshAt: string | null; source?: "google" | "upload";
  onRefresh: () => void; onOpenSettings: () => void;
  /** Ngưỡng lệch % đang áp dụng — bảng "Tiêu chí cảnh báo" phải nói đúng ngưỡng THẬT. */
  gapThreshold: number;
}) {
  const [tieuChiOpen, setTieuChiOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  // 3 vùng: trái (logo ePMP + tên báo cáo) · giữa (logo AA) · phải (nguồn + nút).
  // Grid [1fr auto 1fr] giữ logo AA CHÍNH GIỮA; màn hẹp → xếp dọc (autofit).
  // KHÔNG sticky: lăn xuống header app cuộn đi, chỉ header BẢNG dính lại.
  return (
    <header className="relative z-30 border-b-2 border-slate-900 bg-white print:static print:bg-white">
      {/* Header GỌN: chiều cao vừa khít khối chữ bên trái. Phải (nguồn + version + nút)
          nằm TRÊN CÙNG 1 HÀNG ở desktop, gói gọn trong khoảng chiều cao đó. */}
      {/* 2 vùng: TRÁI (logo AA + logo ePMP + tên) · PHẢI (nguồn + nút). AA logo dời sang
          TRÁI (trước đây ở giữa) theo yêu cầu 20/07. */}
      <div className="mx-auto grid w-full max-w-[1600px] grid-cols-1 items-center gap-x-4 gap-y-1 px-4 py-1 md:grid-cols-[minmax(0,1fr)_auto] 2xl:px-6 print:max-w-none print:px-0 print:py-1">
        {/* TRÁI: logo AA · logo ePMP · tên báo cáo */}
        <div id="pdf-title" className="flex items-center gap-3 justify-self-center md:justify-self-start">
          <AALogo className="h-9 w-auto sm:h-10" />
          <span className="h-8 w-px bg-slate-200" />
          <EpmpLogo />
          <div className="min-w-0">
            <div className="truncate text-base font-extrabold leading-tight tracking-tight text-slate-900 sm:text-lg">
              Project Master Plan
            </div>
            <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-teal-700 sm:text-[10px]">
              PMO · Bộ phận Project Planning
            </div>
          </div>
        </div>
        {/* PHẢI: dữ liệu tính đến · version · nút — cùng 1 hàng ở desktop, gọn trong khoảng header */}
        <div className="flex flex-col items-center gap-1 text-[11px] text-slate-500 md:flex-row md:items-center md:justify-end md:justify-self-end">
          {/* Nút TRA CỨU, không phải hành động → cố tình dùng kiểu VIỀN (amber-50 nền,
              amber-400 viền), KHÔNG dùng vàng đặc. Vàng đặc sẽ tranh chỗ với nút "Làm mới"
              (teal đặc = hành động chính) và với chính badge cảnh báo vàng trong bảng —
              vàng trong app này đang MANG NGHĨA "cảnh báo", không được xài làm trang trí. */}
          <button onClick={() => { setTieuChiOpen(true); track("open_criteria"); }}
            title="Xem quy ước chấm cảnh báo"
            className="flex h-7 items-center gap-1.5 rounded-md border border-amber-400 bg-amber-50 px-2.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 print:hidden">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> Tiêu chí cảnh báo
          </button>
          {tieuChiOpen && <AlertCriteriaDialog gapThreshold={gapThreshold} onClose={() => setTieuChiOpen(false)} />}
          {changelogOpen && <ChangelogDialog onClose={() => setChangelogOpen(false)} />}
          {/* CHỖ CẮM tính năng hệ thống (đánh giá tuân thủ, nhật ký giám sát). Nội dung do
              DashboardBody bơm vào qua <HeaderSlot> (portal) — đặt ở đây vì Header không cầm
              được dữ liệu báo cáo/quyền admin; xem chú thích ở DashboardBody. */}
          <div id="pmo-system-slot" className="flex items-center print:hidden" />
          <FreshnessBadge mode={dataMode} freshAt={freshAt} source={source} />
          <div className="flex items-center gap-2 md:justify-end print:hidden">
            <button type="button" onClick={() => setChangelogOpen(true)}
              title="Bấm xem có gì mới trong các phiên bản"
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-bold tracking-normal text-slate-900 hover:bg-slate-200">v{APP_VERSION}</button>
            <button onClick={onRefresh} disabled={loading} className="flex h-7 items-center gap-1.5 rounded-md bg-teal-700 px-2.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Làm mới
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

function FreshnessBadge({ mode, freshAt, source }: {
  mode: "live" | "cache" | "demo"; freshAt: string | null; source?: "google" | "upload";
}) {
  // Defer time formatting to the client to avoid SSR/CSR hydration mismatch
  // (server runs in UTC, client in user's local tz).
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const h = hoursSince(freshAt);
  const stale = h >= 24;
  const aging = h >= 6 && h < 24;
  const tone =
    mode === "demo" ? "border-slate-300 bg-slate-50 text-slate-700"
    : stale         ? "border-red-300 bg-red-50 text-red-800"
    : aging         ? "border-amber-300 bg-amber-50 text-amber-800"
    :                 "border-emerald-300 bg-emerald-50 text-emerald-800";
  const dot =
    mode === "demo" ? "bg-slate-400"
    : stale         ? "bg-red-500 animate-pulse"
    : aging         ? "bg-amber-500"
    :                 "bg-emerald-500";
  const abs = mounted && freshAt ? new Date(freshAt).toLocaleString("vi-VN", { hour12: false }) : "—";
  const rel = mode === "demo" ? "dữ liệu demo" : (mounted ? relativeVi(freshAt) : "");
  const srcLabel =
    mode === "demo"  ? "Demo"
    : mode === "cache" ? "Bản lưu cục bộ"
    : source === "google" ? "Google Sheet"
    : source === "upload" ? "Tệp Excel"
    : "—";
  return (
    <div className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11.5px] font-medium ${tone}`} suppressHydrationWarning>
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span className="uppercase tracking-wider text-[10px] opacity-70">Dữ liệu tính đến</span>
      <b className="tabular-nums" suppressHydrationWarning>{abs}</b>
      {rel && <span className="opacity-70" suppressHydrationWarning>· {rel}</span>}
      {/* Nhãn nguồn CHỈ hiện khi bất thường (Demo/Bản lưu) để cảnh báo — nguồn Google Sheet
          bình thường thì ẩn cho gọn. */}
      {mode !== "live" && <span className="ml-1 rounded bg-white/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">{srcLabel}</span>}
    </div>
  );
}

function DataModeToast({ mode, freshAt, error }: {
  mode: "live" | "cache" | "demo"; freshAt: string | null; error: string | null;
}) {
  const lastSig = useRef<string>("");
  useEffect(() => {
    const stale = hoursSince(freshAt) >= 24;
    if (mode === "live" && !error && !stale) { lastSig.current = ""; return; }
    const sig = `${mode}|${error ?? ""}|${stale ? "stale" : "fresh"}`;
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    const msg =
      mode === "demo" ? "Đang xem DỮ LIỆU DEMO, chưa kết nối nguồn dữ liệu thật." :
      mode === "cache" ? "Đang xem BẢN LƯU GẦN NHẤT, không lấy được dữ liệu mới." :
      error ? `Không tải được dữ liệu mới: ${error}` :
      "Dữ liệu đã quá 24 giờ, hãy bấm Làm mới.";
    const fn = mode === "demo" ? toast.message : mode === "cache" ? toast.warning : toast.error;
    fn(msg, { position: "bottom-left", duration: 4000 });
  }, [mode, freshAt, error]);
  return null;
}


/* ======================================================================
 *  SETTINGS / THRESHOLD DIALOGS
 * ====================================================================== */

function SettingsDialog({ config, onClose, onSave, onUpload }: {
  config: Config; onClose: () => void;
  /** Kiểm tra + áp dụng link; trả kết quả để hiện NGAY trong dialog. */
  onSave: (c: Config, shareDefault: boolean) => Promise<{ ok: boolean; message: string }>;
  onUpload: (d: ReportData) => void;
}) {
  useEscapeToClose(onClose);
  const [mode, setMode] = useState<Mode>(config.mode);
  const [url, setUrl] = useState(config.sheetUrl ?? "");
  const [shareDefault, setShareDefault] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const handleSaveGoogle = async () => {
    if (!url.trim()) { setErr("Vui lòng dán link Google Sheet"); return; }
    setErr(null); setStatus(null); setBusy(true);
    try {
      const r = await onSave({ mode: "google", sheetUrl: url.trim() }, shareDefault);
      setStatus({ ok: r.ok, msg: r.message });
      if (r.ok) setTimeout(onClose, 1800); // cho kịp đọc kết quả rồi tự đóng
    } catch (e) {
      setStatus({ ok: false, msg: `Lỗi không xác định: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const data = assertDataQuality(await parseXlsxBuffer(buf, todayIso()));
      onUpload({ ...data, source: "upload", sourceLabel: file.name, fetchedAt: new Date().toISOString() });
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Cài đặt nguồn dữ liệu</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="mb-4 flex gap-2 rounded-lg bg-slate-100 p-1 text-xs">
          <button onClick={() => setMode("google")} className={`flex-1 rounded-md py-1.5 font-medium ${mode === "google" ? "bg-white text-teal-700 shadow-sm" : "text-slate-600"}`}>Google Sheet</button>
          <button onClick={() => setMode("upload")} className={`flex-1 rounded-md py-1.5 font-medium ${mode === "upload" ? "bg-white text-teal-700 shadow-sm" : "text-slate-600"}`}>Upload Excel</button>
        </div>
        {mode === "google" ? (
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-700">Link Google Sheet</label>
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..."
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none" />
            {config.sheetUrl && (
              <p className="break-all text-[10px] text-slate-400">Đang dùng: {config.sheetUrl}</p>
            )}
            <p className="text-[11px] text-slate-500">Dán link Google Sheet (link thường trên thanh địa chỉ là được). Sheet cần share "Anyone with the link · Viewer".</p>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-teal-200 bg-teal-50/60 px-3 py-2">
              <input type="checkbox" checked={shareDefault} onChange={(e) => setShareDefault(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-teal-700" />
              <span className="text-[11.5px] leading-snug text-teal-900">
                <b>Đặt làm nguồn mặc định cho MỌI NGƯỜI</b> — link dính luôn trên app,
                ai mở cũng dùng link này (bỏ tick nếu chỉ muốn đổi trên máy mình).
              </span>
            </label>
            {status && (
              <div className={`rounded-md border px-3 py-2 text-[12px] leading-snug ${
                status.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-800"}`}>
                {status.ok ? "✓ " : "✕ "}{status.msg}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs">Hủy</button>
              <button onClick={() => { void handleSaveGoogle(); }} disabled={busy}
                className="rounded-md bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60">
                {busy ? "Đang kiểm tra dữ liệu…" : "Lưu & tải dữ liệu"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-600">Chọn tệp Excel có sheet <b>"Timeline"</b>:</p>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            <button onClick={() => fileRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-md border-2 border-dashed border-slate-300 py-6 text-xs text-slate-600 hover:border-teal-500 hover:bg-slate-50">
              <FileSpreadsheet className="h-5 w-5" /> Chọn tệp .xlsx
            </button>
          </div>
        )}
        {err && <div className="mt-3 text-xs text-red-600">{err}</div>}
      </div>
    </div>
  );
}

function ThresholdDialog({ value, onClose, onSave }: {
  value: Thresholds; onClose: () => void; onSave: (t: Thresholds) => void;
}) {
  useEscapeToClose(onClose);
  const [gap, setGap] = useState(value.gapThreshold);
  const [overdue, setOverdue] = useState(value.overdueThreshold);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold">Tiêu chí xác định công việc có vấn đề</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="mb-4 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-[11.5px] text-teal-900">
          Đây <b>không phải bộ lọc hiển thị</b>. Đây là quy tắc app dùng để quyết định một công việc
          có được coi là "đang có vấn đề" hay không. Đổi ngưỡng sẽ <b>thay đổi tổng số công việc cảnh báo</b>
          trên thanh tổng quan, biểu đồ giai đoạn, bảng và bản in.
        </div>
        <p className="mb-3 text-[12px] text-slate-700">
          Phân loại (mỗi task tối đa 1 nhãn, đỏ ưu tiên hơn vàng):
          vượt ngưỡng lệch (dù có vượt ngưỡng trễ ngày hay không) → <b className="text-red-700">Trễ tiến độ</b>;
          chỉ vượt ngưỡng trễ ngày → <b className="text-amber-700">Cần cắt đầu việc</b>;
          không vượt ngưỡng nào → <b>bình thường, ẩn khỏi dashboard</b>.
          Deadline dự án chỉ là ngữ cảnh, không tạo cảnh báo riêng.
        </p>
        <Field label="Ngưỡng lệch tiến độ (% dự kiến − % thực tế)" unit="điểm %" value={gap} min={5} max={90} onChange={setGap} />
        <div className="h-3" />
        <Field label="Ngưỡng trễ thời hạn" unit="ngày" value={overdue} min={0} max={120} onChange={setOverdue} />
        <div className="mt-5 flex items-center justify-between">
          <button onClick={() => { setGap(DEFAULT_THRESHOLDS.gapThreshold); setOverdue(DEFAULT_THRESHOLDS.overdueThreshold); }}
            className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-800">
            <RotateCcw className="h-3 w-3" /> Mặc định ({DEFAULT_THRESHOLDS.gapThreshold} % · {DEFAULT_THRESHOLDS.overdueThreshold} ngày)
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs">Hủy</button>
            <button onClick={() => onSave({ gapThreshold: Math.max(1, Math.round(gap)), overdueThreshold: Math.max(0, Math.round(overdue)) })}
              className="rounded-md bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800">Áp dụng</button>
          </div>
        </div>
      </div>
    </div>
  );
}
function Field({ label, unit, value, min, max, onChange }: {
  label: string; unit: string; value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="text-[12px] font-semibold text-slate-800">{label}</label>
      <div className="mt-1 flex items-center gap-3">
        <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-teal-700" />
        <div className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1">
          <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))}
            className="w-14 text-right text-xs tabular-nums focus:outline-none" />
          <span className="text-[11px] text-slate-500">{unit}</span>
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
 *  DASHBOARD BODY  —  compact, single-screen, flat Excel-like table
 * ====================================================================== */

type EnrichedItem = ItemRow & {
  _stageId: StageId | "MB" | "PS" | "SHOP" | "OTHER";
  _stageLabel: string;
  _stageDisplay: ReactNode;
  _dept: string;
  _pic: string;            // người phụ trách chính của task
  _projectPm: string;      // PM dự án (chỉ để hiển thị nếu cần)
  _planDyn: number | null; // % dự kiến động
  _alert: AlertKind;
  /** MỨC NGHIÊM TRỌNG (đỏ/vàng) — tách rời `_alert`. Badge & data bar PHẢI dùng trường
   *  này; bộ lọc/đếm thì dùng `_alert`. Xem ma trận ở lib/filter.ts. */
  _alertColor: AlertColor;
  _sevScore: number;
  _sevLabel: string;
  /** = true khi dòng đang bị ẩn thủ công VÀ admin đang bật "Hiện dòng đã ẩn" (để làm mờ + nút bỏ ẩn).
   *  Ở chế độ thường (không bật) dòng ẩn bị LOẠI hẳn nên trường này không xuất hiện. */
  _hidden?: boolean;
  /** "Giải pháp" — TEXT rút gọn = ghép các message KHÔNG ẩn (để lọc/xuất Excel/PDF). */
  _action: string;
  /** BOX CHAT — MỌI message (kể cả ẩn) của Vướng mắc / Giải pháp. Bảng chỉ hiện message KHÔNG ẩn;
   *  mở ô mới thấy hết. author = email người nhập; hi = vùng tô đỏ theo TỪNG message (admin). */
  _noteMsgs: ChatMsg[];
  _actionMsgs: ChatMsg[];
  /** Có message nào không (để hiện badge ✎). */
  _noteEdited: boolean;
  _actionEdited: boolean;
  _picEdited: boolean;
  _deadlineEdited: boolean;
  /** Thời điểm PM sửa lần cuối trên app (ISO) — trường hệ thống từ backend. */
  _editedAt: string | null;
  _key: string;
  _sheet: { note: string; pic: string; deadline: string | null };
  /** Dòng con Block (Thi công lắp đặt) ĐÃ enrich — kế thừa dòng TC cha, chạy qua enrichItem như
   *  item thường (người phụ trách/ngày/quá hạn/cảnh báo/vướng mắc/giải pháp). Chỉ item TC có. */
  _blockItems?: EnrichedItem[];
};

/** Tổng hợp chi tiết "số mã / tổng mã" của 1 giai đoạn để hiện popover.
 *   • avgPct = TRUNG BÌNH % các dòng con (đúng luật gốc: Đặt vật tư = TB cộng VT.CT & VT.NM).
 *   • pooledPct = gộp Σdone/Σtotal (trực quan "làm được bao nhiêu / tổng").
 *  Cảnh báo lệch CHỈ khi % PM nhập lệch với CẢ HAI cách (tránh báo nhầm khi PM nhập theo
 *  kiểu gộp còn luật là trung bình, hay ngược lại). Xem [[CodeCount]]. */
function buildCodeSummary(cc: CodeCount[]) {
  const lines = cc.map((c) => {
    const done = c.done ?? 0;
    const pct = c.total > 0 ? Math.round((done / c.total) * 100) : null;
    return { label: c.label, done, total: c.total, pct };
  });
  const totalDone = lines.reduce((a, l) => a + l.done, 0);
  const totalTotal = lines.reduce((a, l) => a + l.total, 0);
  const remaining = Math.max(0, totalTotal - totalDone);
  const pcts = lines.map((l) => l.pct).filter((v): v is number => v != null);
  const avgPct = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;
  const pooledPct = totalTotal > 0 ? Math.round((totalDone / totalTotal) * 100) : null;
  return { lines, totalDone, totalTotal, remaining, avgPct, pooledPct };
}

/** Dòng dự án ở chế độ GỘP "Cần cập nhật MP" (1 dòng/dự án). */
type MpProjectRow = {
  maCT: string;
  name: string;
  start: string | null;
  deadline: string | null;
  pm: string;
  reason: string;
  active: number;
  alerts: number;
};

/** Nhóm "Bàn giao tháng này" — gộp theo dự án, sổ ra công đoạn con. */
type DueMonthGroup = {
  /** = projectKeyOf(code,name) — cũng là KHOÁ ghi chú vướng mắc CẤP DỰ ÁN (KV). */
  key: string;
  maCT: string;
  name: string;
  /** Ngày bắt đầu + Kết thúc(=Bàn giao) CẤP DỰ ÁN — để hàng gộp hiện như file PMP. */
  start: string | null;
  deadline: string | null;
  /** PM của dự án — hiện ở cột "Nhân sự phụ trách" trên hàng gộp. */
  pm: string;
  items: EnrichedItem[];
  /** Ngày update (ISO) của dự án — từ cột "Ngày update" trong Master Plan. */
  updateDate: string | null;
  /** Dự án ĐÃ BÀN GIAO XONG (note dòng cha) → hàng gộp nền XANH LÁ, không cảnh báo. */
  delivered: boolean;
  /** Vướng mắc cấp DỰ ÁN — TEXT rút gọn (message không ẩn) để hiện ở bảng. */
  note: string;
  /** Giải pháp cấp DỰ ÁN — TEXT rút gọn. */
  action: string;
  /** BOX CHAT cấp dự án (mọi message kể cả ẩn). */
  noteMsgs: ChatMsg[];
  actionMsgs: ChatMsg[];
  editedAt: string | null;
};

/** Một dòng trong biểu đồ "Tổng thể tiến độ" (Gantt lưới tuần) — 1 dự án. */
/** Một TÁC VỤ CON trong Gantt — trực quan hoá đầu việc con (như dòng con bảng Danh sách)
 *  thành thanh thời gian. Lấy đúng tập đang hiển thị ở bảng (shown, chưa 100%). */
type GanttChild = {
  key: string;
  stageAbbr: string;         // TK / MA / VT / TKSX / SX / TC…
  stageLabel: string;        // tên giai đoạn đầy đủ
  pic: string;               // người phụ trách công đoạn
  start: string | null;
  end: string | null;        // deadline công đoạn
  color: AlertColor;         // màu theo cảnh báo — GIỐNG bảng Danh sách (đỏ/vàng/none)
  overdue: number;
  actual: number | null;     // % thực tế của công đoạn (cho phần xanh lá)
  actualEnd?: string | null; // ngày kết thúc THỰC TẾ (lần đầu 100%) — gạch ngang `end`, thêm dòng mới
  /** Khoá ẩn (itemKeyOf) + cờ đang-ẩn — để ẩn/bỏ ẩn ngay trên dòng con Gantt (đồng bộ bảng Danh sách). */
  hideKey: string;
  hidden?: boolean;
  /** Block con (Thi công lắp đặt) — chỉ tác vụ TC có. Có = hiện ▶ dropdown trong Gantt, bấm mới xổ. */
  blocks?: GanttChild[];
};

type GanttRow = {
  key: string;
  updateDate: string | null; // Ngày cập nhật gần nhất (chip màu, giống bảng Việc cần xử lý)
  maCT: string;
  name: string;
  pm: string;
  start: string | null;      // ISO Bắt đầu dự án
  end: string | null;        // ISO Kết thúc/Bàn giao dự án
  pct: number | null;        // % thực tế trung bình các giai đoạn
  sxStart: string | null;    // ISO Bắt đầu giai đoạn Sản xuất nhập kho (SX)
  sxEnd: string | null;      // ISO Kết thúc SX
  sxPct: number | null;      // % thực tế giai đoạn SX — để tô XANH số ô đã sản xuất xong (theo %). null = chưa có số → đỏ hết
  overdue: number;           // số ngày quá mốc bàn giao (0 nếu chưa/đã xong)
  note: string;              // vướng mắc (ghi chú app cấp dự án, fallback mpReason)
  children: GanttChild[];    // đầu việc con (bấm dự án để xổ) — feature "trực quan hoá"
  /** CHẾ ĐỘ LỌC HẠNG MỤC (bảng phẳng): dòng NÀY là 1 HẠNG MỤC, không phải dự án. stageAbbr =
   *  mã viết tắt hạng mục; `name` = tên DỰ ÁN; `pct` = % thực tế của chính hạng mục (đổ done).
   *  undefined = dòng cấp DỰ ÁN như thường. */
  stageAbbr?: string;
  /** Ngày kết thúc THỰC TẾ (lần đầu 100%) — gạch ngang `end`, thêm dòng mới (chế độ lọc hạng mục). */
  actualEnd?: string | null;
  /** Khoá ẩn (itemKeyOf) + cờ đang-ẩn — CHỈ dòng cấp HẠNG MỤC (chế độ lọc hạng mục) mới có, để ẩn/bỏ ẩn. */
  hideKey?: string;
  hidden?: boolean;
};

/** Khoá định danh ỔN ĐỊNH cho một đầu việc (map ghi chú/chỉnh sửa nhập tay trong KV).
 *  CHỈ gồm trường KHÔNG đổi theo tiến độ: Mã dự án + Tên dự án + Mã giai đoạn + dupIdx
 *  (thứ tự dòng trùng mã trong dự án). ĐÃ BỎ desc/start/deadline — vì mô tả & ngày
 *  bắt đầu/kết thúc đổi mỗi tuần khi sync tiến độ, làm ghi chú "mồ côi". Với khoá này,
 *  sync đổi %/mô tả/ngày → ghi chú vẫn dính đúng dòng. Đổi định dạng khoá này sẽ reset
 *  các ghi chú cũ MỘT LẦN (KV cũ dùng khoá 6-trường). */
const itemKeyOf = (it: ItemRow) =>
  it.rid && it.rid.trim()
    // ƯU TIÊN TUYỆT ĐỐI: RID (số nguyên/dòng do PMO điền) — bền nhất, STT đánh lại mặc kệ.
    ? `rid:${it.rid.trim()}`
    : it.projHid && it.projHid.trim()
    // Kế: ID CỨNG dự án + mã công đoạn (+dupIdx) — bền khi có cột IDCUNG.
    ? `h:${it.projHid.trim()}:${(it.rawCode || "").toUpperCase()}:${it.dupIdx ?? 0}`
    : it.id && it.id.trim()
    // Kế: ID phân cấp (cột STT) — bền theo thứ tự nhưng ĐỔI khi đánh lại STT.
    ? `id:${it.id.trim()}`
    // Fallback (nguồn không có STT — cache/CSV/demo cũ): khoá theo mã+tên+giai đoạn+dupIdx.
    : [it.projectCode, it.projectName, it.rawCode, it.dupIdx ?? 0].join(String.fromCharCode(0));

/** MỌI khoá ứng viên của 1 đầu việc theo thứ tự ưu tiên (rid → h → id → composite). Dùng ĐỌC DỰ PHÒNG:
 *  note cũ lưu ở khoá cũ (h:/id:/composite) VẪN hiện, dù note mới nay ghi theo rid. KHÔNG di trú KV. */
const itemKeysOf = (it: ItemRow): string[] => {
  const ks: string[] = [];
  if (it.rid && it.rid.trim()) ks.push(`rid:${it.rid.trim()}`);
  if (it.projHid && it.projHid.trim()) ks.push(`h:${it.projHid.trim()}:${(it.rawCode || "").toUpperCase()}:${it.dupIdx ?? 0}`);
  if (it.id && it.id.trim()) ks.push(`id:${it.id.trim()}`);
  ks.push([it.projectCode, it.projectName, it.rawCode, it.dupIdx ?? 0].join(String.fromCharCode(0)));
  return ks;
};

/** TEXT rút gọn của box chat = ghép các message KHÔNG ẩn (bảng chỉ hiện phần này; xuất Excel/PDF/lọc dùng đây). */
const visibleText = (msgs?: ChatMsg[]): string => (msgs ?? []).filter((m) => !m.hidden).map((m) => m.text).join("\n");
const fmtMsgTime = (iso: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

type HiRange = [number, number];

type StageOrOther = StageId | "MB" | "PS" | "SHOP" | "OTHER";
type AlertK2 = Exclude<AlertKind, "none">;

type Filters = {
  depts: string[];
  stages: StageOrOther[];
  alerts: AlertK2[];
  /** Lọc theo Deadline dự án — value dạng "YYYY-MM" (theo tháng) hoặc "YYYY-MM-DD" (theo ngày).
   *  Giá trị đặc biệt "none" = các đầu việc không có deadline dự án. */
  deadlineMonths: string[];
  /** Lọc theo Vùng (cột "Location" trong nguồn) — value = tên vùng (North/PQ/…). */
  regions: string[];
  /** Lọc theo Cụm dự án (cột "Group DA" trong nguồn) — value = mã cụm (PQs/NPHH/…). */
  groupDAs: string[];
  /** Lọc theo PM — Người phụ trách chính CẤP DỰ ÁN, lấy TÊN ĐẦU TIÊN (nếu ô nhiều người ngăn bởi
   *  "/" hoặc ","). value = tên đầu tiên đã chuẩn hoá (xem pmFirstOf). Áp cho cả bảng lẫn Gantt. */
  pms: string[];
  /** Lọc theo PES — value ∈ {PES1,PES2,PES3,PES4}, ánh xạ theo dải số Top-20. */
  pes: string[];
  query: string;
  /** Bật = bảng CHỈ hiện các dự án được đánh dấu "Cần cập nhật MP" —
   *  chế độ GỘP: mỗi dự án 1 dòng, không hiện từng công đoạn. */
  mpOnly: boolean;
  /** Quick filter: chỉ hiện các dự án có Mốc bàn giao trong THÁNG HIỆN TẠI
   *  (độc lập — hiện cả đầu việc không thuộc nhóm cảnh báo). */
  dueThisMonth: boolean;
  /** Quick filter "Top dự án trọng điểm": chỉ hiện các dự án có số Top-20 (cột A).
   *  Cơ chế y hệt "Bàn giao tháng này" — gộp theo dự án, sổ ra công đoạn. */
  topKey: boolean;
};

const EMPTY_FILTERS: Filters = { depts: [], stages: [], alerts: [], deadlineMonths: [], regions: [], groupDAs: [], pms: [], pes: [], query: "", mpOnly: false, dueThisMonth: false, topKey: false };

/** TÊN ĐẦU TIÊN của Người phụ trách chính cấp dự án (ô có thể ghi nhiều người ngăn bởi "/", ",",
 *  xuống dòng) → dùng làm value bộ lọc PM. Trống → "". */
const pmFirstOf = (pm: string | null | undefined): string => (pm || "").split(/[/,\n]/)[0].trim();

/** Nhóm (PES) theo dải số Top-20 → tên người phụ trách. Bộ lọc tên = "PES", HIỂN THỊ theo TÊN
 *  (Ms./Mr. + tên — đảo lại cách hiện số 1..4 của v3.5.2): Mai Lê, Công Hoàng, Xuân Tân, Phúc Thành. */
const PES_RANGES: { id: string; lo: number; hi: number; name: string; num: number }[] = [
  { id: "PES1", lo: 1, hi: 7, name: "Ms. Mai Lê", num: 1 },
  { id: "PES2", lo: 8, hi: 11, name: "Mr. Công Hoàng", num: 2 },
  { id: "PES3", lo: 12, hi: 16, name: "Mr. Xuân Tân", num: 3 },
  { id: "PES4", lo: 17, hi: 20, name: "Mr. Phúc Thành", num: 4 },
];
/** Ánh xạ số Top-20 → PES (hoặc "" nếu ngoài dải/không có số). */
function pesOfRank(rank: number | null | undefined): string {
  if (rank == null) return "";
  const a = PES_RANGES.find(r => rank >= r.lo && rank <= r.hi);
  return a ? a.id : "";
}

/** Trả về key tháng "YYYY-MM" từ ISO deadline; null nếu không có. */
function monthKeyOf(iso: string | null): string | null {
  if (!iso) return null;
  return iso.slice(0, 7);
}
function monthLabelOf(key: string): string {
  if (key === "none") return "(không có deadline)";
  const [y, m] = key.split("-");
  return `${m}/${y}`;
}

function toggleIn<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
}

/* ── DATA QUALITY — mỗi lỗi = 1 ANOMALY CỤ THỂ trả lời 5 câu: record nào · cột nào · giá trị hiện tại ·
 *  vì sao bất thường · (đề xuất nếu có). Phân loại (invalid/inconsistent/duplicate/missing/outlier) + mức độ
 *  (critical/high/medium/low) + độ tin cậy phát hiện. App đọc nguồn Google Sheet (READ-ONLY) nên KHÔNG auto-sửa
 *  dữ liệu nguồn — chỉ chỉ ĐÍCH DANH dòng/cột/giá trị + cách sửa ở nguồn (trung thực, không "fix" ngầm). ── */
type DqCat = "invalid" | "inconsistent" | "duplicate" | "missing" | "outlier" | "block";
type DqSev = "critical" | "high" | "medium" | "low";
const DQ_META: Record<string, { cat: DqCat; sev: DqSev; field: string; conf: number }> = {
  header:        { cat: "block",        sev: "critical", field: "Cấu trúc file",         conf: 99 },
  projects:      { cat: "block",        sev: "critical", field: "Dữ liệu dự án",         conf: 99 },
  sttDup:        { cat: "duplicate",    sev: "high",     field: "STT (khoá lưu note)",   conf: 99 },
  sttBlank:      { cat: "missing",      sev: "high",     field: "STT (khoá lưu note)",   conf: 99 },
  dupName:       { cat: "duplicate",    sev: "high",     field: "Tên dự án",             conf: 90 },
  sharedMaPm:    { cat: "inconsistent", sev: "medium",   field: "Mã CT ↔ PM",            conf: 80 },
  noPm:          { cat: "missing",      sev: "medium",   field: "Người phụ trách chính", conf: 99 },
  dates:         { cat: "invalid",      sev: "high",     field: "Ngày Kết thúc",         conf: 95 },
  pct:           { cat: "invalid",      sev: "high",     field: "% thực tế",             conf: 90 },
  unknownPrefix: { cat: "invalid",      sev: "medium",   field: "Mã công đoạn",          conf: 85 },
  orphans:       { cat: "invalid",      sev: "medium",   field: "Vị trí dòng",           conf: 90 },
};
const DQ_CATS: { key: DqCat; label: string; icon: string; cls: string }[] = [
  { key: "block",        label: "Chặn nguồn",           icon: "🚫", cls: "bg-rose-100 text-rose-800" },
  { key: "invalid",      label: "Không hợp lệ",         icon: "⛔", cls: "bg-rose-100 text-rose-700" },
  { key: "duplicate",    label: "Trùng lặp",            icon: "👯", cls: "bg-violet-100 text-violet-700" },
  { key: "inconsistent", label: "Không nhất quán",      icon: "🔀", cls: "bg-amber-100 text-amber-800" },
  { key: "missing",      label: "Thiếu dữ liệu",        icon: "␀",  cls: "bg-sky-100 text-sky-700" },
  { key: "outlier",      label: "Bất thường (outlier)", icon: "📈", cls: "bg-orange-100 text-orange-700" },
];
const DQ_SEV: Record<DqSev, { label: string; dot: string; ring: string }> = {
  critical: { label: "Nghiêm trọng", dot: "🔴", ring: "border-rose-300 bg-rose-50" },
  high:     { label: "Cao",          dot: "🟠", ring: "border-orange-300 bg-orange-50" },
  medium:   { label: "Trung bình",   dot: "🟡", ring: "border-amber-300 bg-amber-50" },
  low:      { label: "Thấp",         dot: "🔵", ring: "border-sky-300 bg-sky-50" },
};
type DqAnomaly = { checkId: string; cat: DqCat; sev: DqSev; conf: number; field: string; rid: string; record: string; value: string; reason: string };
/** Tách chuỗi item của parser → {STT, record, giá trị lỗi}. Format nguồn ổn định (do chính parser dựng). */
function dqParseItem(s: string): { rid: string; record: string; value: string } {
  const idm = s.match(/^\[([^\]]+)\]\s*/);
  const rid = idm ? idm[1] : "";
  const rest = idm ? s.slice(idm[0].length) : s;
  const dash = rest.indexOf(" — ");
  const record = (dash >= 0 ? rest.slice(0, dash) : rest).trim();
  const after = dash >= 0 ? rest.slice(dash + 3).trim() : "";
  const q = s.match(/[“"]([^”"]*)[”"]/);   // nháy cong “…” hoặc thẳng "…"
  return { rid, record, value: q ? q[1] : after };
}

/** DIALOG CẢNH BÁO CHẤT LƯỢNG DỮ LIỆU — mở từ menu "Hệ thống" (cho PMO/admin), KHÔNG bày ngoài trang.
 *  GOM theo loại + mức nguy hiểm, mỗi lỗi LIỆT KÊ ĐÍCH DANH (STT + tên dự án) + cách sửa → "nhìn biết
 *  lỗi ở đâu, cụ thể ra". Trọng tâm: STT trùng/trống — khoá lưu Vướng mắc; nguyên nhân tin nhảy/mất. */
function DataQualityDialog({ checks, onClose }: { checks: DataQualityCheck[]; onClose: () => void }) {
  useEscapeToClose(onClose);
  if (typeof document === "undefined") return null;
  const hasErr = checks.some((c) => c.level === "error");
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 print:hidden">
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className={`flex items-start justify-between gap-3 border-b-2 px-5 py-3 ${hasErr ? "border-rose-400" : "border-amber-400"}`}>
          <div>
            <div className={`text-[10px] font-semibold uppercase tracking-wider ${hasErr ? "text-rose-700" : "text-amber-700"}`}>Cổng kiểm soát dữ liệu</div>
            <div className="text-sm font-bold text-slate-900">CẢNH BÁO CHẤT LƯỢNG DỮ LIỆU</div>
            <div className="mt-0.5 text-[11px] text-slate-600">Kiểm mỗi lần nạp nguồn — gom theo loại, chỉ ĐÍCH DANH dòng lỗi + cách sửa để tránh sai thông tin trên app.</div>
          </div>
          <button onClick={onClose} aria-label="Đóng" title="Đóng (Esc)" className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100">Đóng ✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          <DataQualityBody checks={checks} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Cảnh báo chất lượng dữ liệu — mỗi lỗi là 1 ANOMALY cụ thể (record · cột · giá trị · lý do), có phân loại,
 *  mức độ, độ tin cậy, dashboard + bộ lọc. Dùng lại trong dialog "Công cụ dữ liệu". */
function DataQualityBody({ checks, stats }: { checks: DataQualityCheck[]; stats?: { parentsTotal: number; shownProjects: number; activeItems: number; allStageRows: number } }) {
  const [fCat, setFCat] = useState<DqCat | "all">("all");
  const [fSev, setFSev] = useState<DqSev | "all">("all");
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const { anomalies, hidden } = useMemo(() => {
    const out: DqAnomaly[] = []; let hid = 0;
    for (const c of checks) {
      const m = DQ_META[c.id]; if (!m) continue;
      const reason = c.detail ?? c.label;
      if (m.cat === "block" || !(c.items && c.items.length)) {
        out.push({ checkId: c.id, cat: m.cat, sev: m.sev, conf: m.conf, field: m.field, rid: "", record: "Toàn nguồn dữ liệu", value: c.label, reason });
        continue;
      }
      for (const it of c.items) {
        if (it.startsWith("…")) { const n = it.match(/\d+/); hid += n ? +n[0] : 0; continue; }
        const p = dqParseItem(it);
        out.push({ checkId: c.id, cat: m.cat, sev: m.sev, conf: m.conf, field: m.field, rid: p.rid, record: p.record || "—", value: p.value || (m.cat === "missing" ? "(để trống)" : m.cat === "duplicate" ? "(bị trùng)" : "—"), reason });
      }
    }
    return { anomalies: out, hidden: hid };
  }, [checks]);

  if (!anomalies.length) return <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-8 text-center text-sm font-semibold text-emerald-700">✔ Không phát hiện bất thường — dữ liệu nguồn sạch.</div>;

  const catCount = (k: DqCat) => anomalies.filter((a) => a.cat === k).length;
  const keyOf = (a: DqAnomaly) => `${a.checkId}|${a.rid}|${a.record}`;
  const shown = anomalies.filter((a) => (fCat === "all" || a.cat === fCat) && (fSev === "all" || a.sev === fSev) && !dismissed.has(keyOf(a)));
  const totalRec = stats ? (stats.allStageRows || stats.activeItems || 0) : 0;
  const affected = anomalies.length + hidden;
  const score = totalRec > 0 ? Math.max(0, Math.round(1000 * (1 - affected / totalRec)) / 10) : null;
  const sevChip = (k: DqSev | "all", label: string) => (
    <button onClick={() => setFSev(k)} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${fSev === k ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"}`}>{label}</button>
  );

  return (
    <div className="space-y-3">
      {/* DASHBOARD */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[13px] font-bold text-slate-800">Chất lượng dữ liệu nguồn</div>
          {score != null && <div className="flex items-baseline gap-1"><span className="text-[10px] text-slate-500">Điểm chất lượng</span><span className={`text-lg font-extrabold ${score >= 95 ? "text-emerald-600" : score >= 85 ? "text-amber-600" : "text-rose-600"}`}>{score}%</span></div>}
        </div>
        <div className="mt-0.5 text-[11px] text-slate-500">{stats ? <>Quét <b className="text-slate-700">{totalRec.toLocaleString("vi")}</b> dòng · </> : null}phát hiện <b className="text-slate-700">{affected}</b> bất thường{hidden > 0 && <> (hiện {anomalies.length}, cắt bớt {hidden} cùng loại)</>}.</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button onClick={() => setFCat("all")} className={`rounded-md px-2 py-1 text-[11px] font-semibold ${fCat === "all" ? "bg-teal-700 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"}`}>Tất cả <span className="opacity-70">{anomalies.length}</span></button>
          {DQ_CATS.filter((c) => catCount(c.key) > 0).map((c) => (
            <button key={c.key} onClick={() => setFCat(c.key)} className={`rounded-md px-2 py-1 text-[11px] font-semibold ${fCat === c.key ? "bg-teal-700 text-white" : `${c.cls} hover:opacity-80`}`}>{c.icon} {c.label} <span className="opacity-70">{catCount(c.key)}</span></button>
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-slate-400">Mức độ:</span>
          {sevChip("all", "Tất cả")}
          {(["critical", "high", "medium", "low"] as DqSev[]).filter((s) => anomalies.some((a) => a.sev === s)).map((s) => <span key={s}>{sevChip(s, `${DQ_SEV[s].dot} ${DQ_SEV[s].label}`)}</span>)}
        </div>
      </div>

      <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-[11px] leading-snug text-sky-800">Nguồn là Google Sheet (chỉ đọc) → app <b>KHÔNG tự sửa</b> dữ liệu nguồn. Mỗi dòng dưới chỉ rõ <b>record · cột · giá trị · lý do</b> để sửa đúng chỗ ở nguồn; ô lỗi đã bị loại khỏi phép tính để không tính sai.</div>

      {shown.length === 0 ? <div className="py-6 text-center text-[12px] text-slate-400">Không có mục nào khớp bộ lọc.</div> :
        shown.map((a, i) => {
          const sev = DQ_SEV[a.sev]; const cat = DQ_CATS.find((c) => c.key === a.cat)!;
          return (
            <div key={i} className={`rounded-lg border p-3 ${sev.ring}`}>
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-bold text-slate-700">{sev.dot} {sev.label}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${cat.cls}`}>{cat.icon} {cat.label}</span>
                <span className="ml-auto text-[10px] text-slate-400">Độ tin cậy phát hiện <b className="text-slate-600">{a.conf}%</b></span>
              </div>
              <div className="grid grid-cols-[112px_1fr] gap-x-2 gap-y-1 text-[11.5px]">
                <span className="font-semibold text-slate-500">Record</span><span className="font-medium text-slate-800">{a.rid && <span className="mr-1 rounded bg-slate-200 px-1 text-[10px] font-bold tabular-nums text-slate-600">STT {a.rid}</span>}{a.record}</span>
                <span className="font-semibold text-slate-500">Cột (field)</span><span className="text-slate-700">{a.field}</span>
                <span className="font-semibold text-slate-500">Giá trị hiện tại</span><span className="break-words font-mono text-[11px] font-semibold text-rose-700">{a.value}</span>
                <span className="font-semibold text-slate-500">Vì sao đánh dấu</span><span className="leading-snug text-slate-600">{a.reason}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button onClick={() => { void navigator.clipboard?.writeText(`STT ${a.rid} · ${a.record} · ${a.field}: ${a.value}`); toast.success("Đã sao chép — dán vào ô Tìm (Ctrl+F) ở Google Sheet để tới đúng dòng."); }}
                  className="rounded-md bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-700">📋 Sao chép để tìm ở nguồn</button>
                <button onClick={() => setDismissed((d) => new Set(d).add(keyOf(a)))}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100">Ẩn tạm (phiên này)</button>
              </div>
            </div>
          );
        })}
      {hidden > 0 && fCat === "all" && fSev === "all" && <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-center text-[11px] text-slate-500">…còn <b>{hidden}</b> dòng khác cùng loại lỗi (đã cắt bớt cho gọn) — sửa tương tự ở nguồn.</div>}
    </div>
  );
}

function DashboardBody({ data, thresholds, onOpenSource }: { data: ReportData; thresholds: Thresholds; onOpenSource: () => void }) {
  const today = data.refDate || todayIso();

  // BẢN chạy (live/dev). Bắt đầu là "live" (SSR + lần render đầu → ẩn tính năng dở, kể cả
  // trên bản chính thức), sau khi mount mới nhận diện theo hostname. Xem lib/flags.ts.
  const [stage, setStage] = useState<Stage>("live");
  useEffect(() => { setStage(detectStage()); }, []);
  const ff = {
    compliance: featureOn("complianceReport", stage),
    ganttChildTasks: featureOn("ganttChildTasks", stage),
  };

  // AI ĐANG XEM + có phải admin giám sát không (quyết định hiện nút "Nhật ký giám sát").
  // Ghi luôn 1 lượt "Mở app" ngay khi vào — nền tảng cho nhật ký. Xem lib/activity.ts.
  const [me, setMe] = useState<{ email: string | null; isAdmin: boolean }>({ email: null, isAdmin: false });
  const [showActivity, setShowActivity] = useState(false);

  // Popup "Thi công lắp đặt": map maCT→fileId Summary — ĐỌC Ở CLIENT (trong data, xem gQuery), KHÔNG
  // parse trên Worker (tránh Error 1102). Bấm chữ hạng mục có link → mở modal ma trận lắp đặt.
  const installLinks = data.installLinks ?? {};
  // Gửi TOÀN BỘ fileId Summary vào registry (KV sfile:index) → worker cron sáng warm sẵn mọi dự án.
  useEffect(() => {
    // Chỉ warm dạng "Summary" (fileId thuần). Dạng theo gid ("fileId|gid" = Public…) bỏ qua warmer
    // (vẫn nhanh nhờ file 23KB + cache) — tránh gửi ký tự "|" làm hỏng validate fileId.
    const ids = [...new Set(Object.values(installLinks).filter((v) => v && !v.includes("|")))];
    if (ids.length) void recordSummaryFiles({ data: { fileIds: ids } }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(Object.values(installLinks).sort())]);
  // Popup xem: {fileId, sheet?, range?, hideAdmin?}. Link PMO gắn → hideAdmin (chỉ xem); hyperlink cũ → có box.
  const [summaryTarget, setSummaryTarget] = useState<{ fileId: string; sheet?: string; range?: string; tl?: string; br?: string; snap?: boolean; snapKey?: string; hideAdmin?: boolean; chart?: boolean; name?: string } | null>(null);
  const [linkSetup, setLinkSetup] = useState<{ key: string; name: string; cfg?: SheetViewCfg } | null>(null);
  // ẢNH DỰ ÁN (PMO gắn thẳng): mở popup ẢNH (imgView) / mở dialog PMO thêm-gỡ ảnh (imgSetup).
  const [imgView, setImgView] = useState<{ key: string; name: string } | null>(null);
  // XEM VIDEO công trường (chỉ Mini Hotel) — mở THẲNG từ dòng dự án, khỏi qua popup ảnh.
  const [imgSetup, setImgSetup] = useState<{ key: string; name: string; hid?: string } | null>(null);
  // Link PMO gắn thẳng cho từng dự án (khoá bền Mã CT + Tên) — đọc CÔNG KHAI để mọi người thấy 📊.
  const sheetViewsQuery = useQuery({ queryKey: ["sheetviews"], queryFn: () => getSheetViews(), staleTime: 5 * 60 * 1000 });
  const sheetViews = sheetViewsQuery.data?.views ?? {};
  // CẦU NỐI app MTLĐ: gom các popup "Thi công lắp đặt" ĐÃ GẮN LINK (Sửa link) — nguồn thật là
  // sheetViews (PMO gắn: fileId + vùng + form), KHÔNG phải hyperlink trong sheet. Mỗi dự án 1 thẻ, kèm
  // vùng + formKey để MtldApp render Y HỆT popup (ma trận live + form đã lưu). Ghi KV để MTLĐ đọc mọi lúc.
  useEffect(() => {
    try {
      const named: { fileId: string; gid?: string; name: string; maCT: string; region: string; groupDA: string; hid?: string; sheet?: string; range?: string; tl?: string; br?: string; formKey?: string; chart?: boolean }[] = [];
      const seenKey = new Set<string>();   // đã xử lý linkKey này chưa (khỏi lặp)
      const seenSig = new Set<string>();   // NỘI DUNG popup đã có chưa (nhiều dự án gắn CÙNG 1 ma trận → 1 thẻ)
      for (const it of data.items) {
        if (it.stage !== "Thi công lắp đặt") continue;
        const linkKey = stableProjKey(it.maCT, it.projectName);
        if (!linkKey || seenKey.has(linkKey)) continue;
        seenKey.add(linkKey);
        const cfg = sheetViews[linkKey];
        if (!cfg?.fileId) continue;   // chỉ dự án đã GẮN link (có popup) mới đưa vào
        const formKey = `${cfg.fileId}::${(cfg.sheet || "").trim()}::${(cfg.range || "").trim() || `${(cfg.tl || "").trim()}~${(cfg.br || "").trim()}`}`;
        // MỖI DỰ ÁN MỘT THẺ. Trước đây gộp theo nội dung ma trận (cùng file+tab+vùng+form = 1 thẻ) — nhưng
        // NHIỀU DỰ ÁN KHÁC NHAU vẫn gắn chung 1 ma trận, gộp lại thì Media không phân biệt được kho ảnh của
        // dự án nào (B6-B9 từng ăn media của B1-B5). Nay giữ đủ, khoá theo ID CỨNG của dự án.
        // MTLĐ KHÔNG đổi: app đó tự gộp lại bằng `dedupInstall()` (theo sig) lúc render.
        const sig = `${cfg.fileId}|${cfg.gid || ""}|${formKey}|${it.projHid || linkKey}`;
        if (seenSig.has(sig)) continue;
        seenSig.add(sig);
        named.push({ fileId: cfg.fileId, gid: cfg.gid, sheet: cfg.sheet, range: cfg.range, tl: cfg.tl, br: cfg.br, formKey, chart: cfg.chart,
          hid: it.projHid, name: it.projectName, maCT: it.maCT || it.projectCode || "", region: it.region || "", groupDA: it.groupDA || "" });
      }
      if (named.length) {
        localStorage.setItem(MTLD_INSTALL_LS, JSON.stringify(named));
        void saveInstallList({ data: { list: named } }).catch(() => {});
      }
    } catch { /* bỏ qua */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(sheetViews), data.items.length]);
  // INDEX ảnh dự án (nhẹ: chỉ ngày/người) — mọi người tải để biết dòng nào có 📷; ảnh nặng tải khi mở popup.
  const projImgIdxQuery = useQuery({ queryKey: ["projimg-idx"], queryFn: () => getProjImageIndex(), staleTime: 5 * 60 * 1000 });
  const projImgIdx: ProjImgIdx = projImgIdxQuery.data?.idx ?? {};
  useEffect(() => {
    void whoami({ data: { devAs: devAs() } }).then(setMe).catch(() => {});
    track("view");
  }, []);

  // Ngưỡng + hôm nay, gộp MỘT LẦN tại đây. Ma trận cần `today` để biết dự án còn mấy
  // ngày tới mốc bàn giao; chỗ nào chấm cảnh báo (bảng, lọc, đối chiếu Excel) đều phải
  // truyền bản này — truyền `thresholds` trần là chiều "sắp bàn giao" im lặng tắt.
  const th = useMemo<Thresholds>(() => ({ ...thresholds, today }), [thresholds, today]);

  // PM dự án — KHOÁ THEO MÃ+TÊN (không chỉ mã). 1 maCT có thể nhiều dự án khác PM (vd Mini Hotel PQ
  // CT25-051: bản thường = Nguyễn Hoài Vũ, bản B6-B9 = Trần Quốc Lý). Khoá theo mã thôi → PM đè nhầm.
  const pmByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of data.projects) m.set(`${p.code} ${p.name}`, (p.pm && p.pm.trim()) || "—");
    return m;
  }, [data.projects]);
  const pmOfItem = useCallback((it: { projectCode: string; projectName: string }) => pmByCode.get(`${it.projectCode} ${it.projectName}`) || "—", [pmByCode]);

  /** (mã dự án + tên) → ID dự án (cột STT). Vì 1 mã có thể nhiều tên, phải khoá theo mã+tên.
   *  Dùng để suy ra ID dự án từ 1 ItemRow (item chỉ mang mã+tên dự án, không mang ID dự án). */
  const projIdByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of data.projects) if (p.id && p.id.trim()) m.set(`${p.code} ${p.name}`, p.id.trim());
    return m;
  }, [data.projects]);
  /** Khoá dự án (KV vướng mắc/giải pháp cấp dự án + các set lọc) — ƯU TIÊN ID dự án cho ổn định.
   *  pkProj: từ ProjectRow (có sẵn id). pkItem: từ ItemRow (suy id qua projIdByName). Mọi điểm dùng
   *  khoá dự án ĐỀU đi qua 2 helper này để id-based nhất quán (build set & query set khớp nhau). */
  const pkProj = useCallback((p: { code: string; name: string; id?: string; hid?: string }) => projectKeyOf(p.code, p.name, p.id, p.hid), []);
  const pkItem = useCallback(
    (i: { projectCode: string; projectName: string; projHid?: string }) =>
      projectKeyOf(i.projectCode, i.projectName, projIdByName.get(`${i.projectCode} ${i.projectName}`), i.projHid),
    [projIdByName],
  );

  /* ── CỔNG DI TRÚ KHOÁ (tên cũ → ID/STT) ──
     App vừa đổi khoá match sang ID. Các effect đồng bộ "ngày kết thúc"/"lịch sử update" bên dưới
     có bước XOÁ/GHI theo khoá — nếu chạy TRƯỚC khi di trú, chúng sẽ hiểu nhầm khoá tên cũ là "rác"
     và xoá/ghi đè, làm mất ngày gốc. Vì thế CHẶN các effect đó tới khi di trú xong (remapReady). */
  const [remapReady, setRemapReady] = useState(false);
  const remapRanRef = useRef(false);

  /* ── CHỈNH SỬA DÙNG CHUNG (backend Cloudflare KV) ──
     UI Action → Update Local State → Call API → Save Database → Sync UI.
     Reload không mất; người khác thấy sau khi lưu. */
  const queryClient = useQueryClient();
  const editsQuery = useQuery({
    queryKey: ["edits"],
    queryFn: async (): Promise<EditsMap> => (await fetchEdits()).items ?? {},
    staleTime: 15_000,
    refetchOnWindowFocus: true, // quay lại tab → tự đồng bộ chỉnh sửa của người khác
  });
  const edits: EditsMap = useMemo(() => editsQuery.data ?? {}, [editsQuery.data]);

  /* GOM DATA đầy đủ cho báo cáo 1 dự án (dùng CHUNG cho cả Slide .pptx lẫn PDF) —
     allItems (đủ giai đoạn) + vướng mắc cấp dự án/công đoạn + ảnh hiện trường. */
  const buildProjectReportInput = useCallback(async (g: DueMonthGroup) => {
    const p = data.projects.find((pp) => pkProj(pp) === g.key);
    const items = (p?.allItems ?? g.items).filter((i) => i.shown !== false);
    const projPm = p?.pm ?? g.pm;
    const itemEdits = items.map((it) => {
      const e = edits[pkItem(it)];
      // PIC HIỂN THỊ Y HỆT BẢNG: nếu đã sửa tay → dùng đúng chữ đã sửa; nếu chưa → suy theo quy ước
      // giai đoạn (picByStageConv: "QS - …", "PM - …", "PM & NM"…) như cột "Người phụ trách chính".
      const picDisplay = e?.pic != null ? e.pic : picByStageConv(it.owner, stageIdOf(it), projPm);
      return { it, noteMsgs: e?.noteMsgs, actionMsgs: e?.actionMsgs, pic: picDisplay, deadline: e?.deadline };
    });
    let images: { data: string; at?: string; by?: string }[] = [];
    try {
      const res = await getProjImage({ data: { key: g.key } });
      images = (res?.imgs ?? []).map((im) => ({ data: im.data, at: im.at, by: im.by }));
    } catch { /* không có ảnh → báo cáo vẫn xuất, bỏ phần ảnh */ }
    return {
      name: g.name, code: g.maCT || p?.code || "", cdt: p?.cdt, pm: p?.pm ?? g.pm,
      start: p?.start ?? g.start, deadline: p?.deadline ?? g.deadline,
      items, projNoteMsgs: g.noteMsgs, projActionMsgs: g.actionMsgs, itemEdits, images,
    };
  }, [data.projects, edits, pkProj, pkItem]);

  /* XUẤT BÁO CÁO SLIDE (.pptx) cho 1 dự án — dựng deck client-side. */
  const handleExportReport = useCallback(async (g: DueMonthGroup) => {
    try {
      toast.loading("Đang dựng báo cáo slide…", { id: "ppt", position: "bottom-left" });
      const input = await buildProjectReportInput(g);
      const { exportProjectDeck } = await import("@/lib/ppt-report");
      await exportProjectDeck(input);
      toast.success("Đã tạo báo cáo slide (.pptx)", { id: "ppt", position: "bottom-left" });
    } catch (err) {
      console.error("[ppt-report]", err);
      toast.error("Không tạo được báo cáo: " + (err instanceof Error ? err.message : String(err)), { id: "ppt", position: "bottom-left" });
    }
  }, [buildProjectReportInput]);

  /* XUẤT BÁO CÁO PDF cho 1 dự án — cùng dữ liệu với bản slide, dựng HTML→PDF (chữ Việt không vỡ). */
  const handleExportPdf = useCallback(async (g: DueMonthGroup) => {
    try {
      toast.loading("Đang dựng báo cáo PDF…", { id: "ppt", position: "bottom-left" });
      const input = await buildProjectReportInput(g);
      const { exportProjectPdf } = await import("@/lib/pdf-project-report");
      await exportProjectPdf(input);
      toast.success("Đã tạo báo cáo (.pdf)", { id: "ppt", position: "bottom-left" });
    } catch (err) {
      console.error("[pdf-report]", err);
      toast.error("Không tạo được báo cáo: " + (err instanceof Error ? err.message : String(err)), { id: "ppt", position: "bottom-left" });
    }
  }, [buildProjectReportInput]);

  // ── MỎ NEO NOTE + PHÁT HIỆN "TRÔI" (before → after) ─────────────────────────
  // Mỗi note nhớ nó gắn ở đâu (maCT·tên·giai đoạn·mô tả). Mỗi lần nạp, vị trí khoá đổi ≠ mỏ neo cũ
  // = note đã trôi (nguồn đánh lại STT / đảo dòng) → cảnh báo. Thuần cộng thêm, không đổi khoá note.
  const anchorsQuery = useQuery({
    queryKey: ["noteAnchors"],
    queryFn: async (): Promise<NoteAnchors> => (await fetchNoteAnchors()).anchors ?? {},
    staleTime: 30_000,
  });
  const noteAnchors: NoteAnchors = anchorsQuery.data ?? {};
  const normDesc = (s?: string) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
  // Vị trí HIỆN TẠI của từng khoá note.
  const noteAnchorNow = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of data.projects) {
      m[pkProj(p)] = `${(p.code || "").trim()}||${(p.name || "").trim()}||__DUAN__`;
      for (const it of (p.allItems ?? p.items ?? [])) {
        m[itemKeyOf(it)] = `${(it.maCT || it.projectCode || "").trim()}||${(it.projectName || "").trim()}||${(it.stage || it.rawCode || "").trim()}||${normDesc(it.desc)}`;
      }
    }
    return m;
  }, [data.projects, pkProj]);
  const noteHasText = useCallback((k: string) => { const e = edits[k]; return !!e && !!(visibleText(e.noteMsgs) || visibleText(e.actionMsgs)); }, [edits]);
  // Danh tính HIỆN TẠI → khoá đang giữ (để tìm hạng mục khớp mỏ neo cũ = ĐÍCH đưa note về).
  const idToKeyNow = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [k, v] of Object.entries(noteAnchorNow)) if (!(v in m)) m[v] = k;
    return m;
  }, [noteAnchorNow]);
  const noteDrift = useMemo(() => {
    const out: { key: string; before: string; after: string | null; text: string; target: string | null }[] = [];
    for (const k of Object.keys(edits)) {
      if (!noteHasText(k)) continue;
      const before = noteAnchors[k]; if (!before) continue;         // chưa có baseline → chưa kết luận
      const after = noteAnchorNow[k] ?? null;
      if (after === before) continue;
      const e = edits[k];
      // ĐÍCH = khoá hạng mục hiện đang KHỚP mỏ neo cũ, và đích đó CHƯA có note (khỏi đè) → đưa về được.
      const cand = idToKeyNow[before];
      const target = cand && cand !== k && !noteHasText(cand) ? cand : null;
      out.push({ key: k, before, after, target, text: (visibleText(e.noteMsgs) || visibleText(e.actionMsgs) || "").replace(/\s+/g, " ").trim().slice(0, 110) });
    }
    return out;
  }, [edits, noteAnchors, noteAnchorNow, noteHasText, idToKeyNow]);
  // Đưa 1 note trôi VỀ đúng hạng mục (dời khoá + cập nhật mỏ neo). Đích có note sẵn → remapKeys GỘP thêm (note
  // là danh sách message) chứ không bỏ qua/không đè mất — an toàn, không mất tin nào.
  const fixDriftTo = useCallback((key: string, target: string, before: string) => {
    void remapKeys({ data: { edits: { [key]: target }, completed: { [key]: target }, updates: {} } })
      .then((r) => { queryClient.setQueryData(["edits"], r.edits); void queryClient.invalidateQueries({ queryKey: ["completedDates"] }); return syncNoteAnchors({ data: { set: { [target]: before }, remove: [key] } }); })
      .then(() => queryClient.invalidateQueries({ queryKey: ["noteAnchors"] }))
      .then(() => { toast.success("Đã đưa ghi chú về đúng hạng mục."); track("fix_drift", `Đưa note về đúng chỗ: ${key.slice(0, 40)} → ${target.slice(0, 40)}`); })
      .catch((e) => toast.error("Lỗi đưa về: " + (e as Error).message));
  }, [queryClient]);
  const fixAllDrift = useCallback(() => {
    const em: Record<string, string> = {}, cm: Record<string, string> = {}, set: Record<string, string> = {}, remove: string[] = [];
    for (const d of noteDrift) if (d.target) { em[d.key] = d.target; cm[d.key] = d.target; set[d.target] = d.before; remove.push(d.key); }
    const n = Object.keys(em).length; if (!n) return;
    void remapKeys({ data: { edits: em, completed: cm, updates: {} } })
      .then((r) => { queryClient.setQueryData(["edits"], r.edits); void queryClient.invalidateQueries({ queryKey: ["completedDates"] }); return syncNoteAnchors({ data: { set, remove } }); })
      .then(() => queryClient.invalidateQueries({ queryKey: ["noteAnchors"] }))
      .then(() => { toast.success(`Đã đưa ${n} ghi chú trôi về đúng chỗ.`); track("fix_drift", `Đưa hàng loạt ${n} note trôi về đúng chỗ`); })
      .catch((e) => toast.error("Lỗi đưa về: " + (e as Error).message));
  }, [noteDrift, queryClient]);
  // Ghi BASELINE lần đầu (giữ "trước đó ở đâu") + dọn mỏ neo của note đã xoá. Chờ di trú khoá xong.
  useEffect(() => {
    if (!remapReady || editsQuery.isLoading || anchorsQuery.isLoading || !data.projects.length) return;
    const add: Record<string, string> = {}; const remove: string[] = [];
    for (const k of Object.keys(edits)) if (noteHasText(k) && !(k in noteAnchors) && noteAnchorNow[k]) add[k] = noteAnchorNow[k];
    for (const k of Object.keys(noteAnchors)) if (!noteHasText(k)) remove.push(k);
    if (!Object.keys(add).length && !remove.length) return;
    void syncNoteAnchors({ data: { add, remove } }).then(() => queryClient.invalidateQueries({ queryKey: ["noteAnchors"] }));
  }, [remapReady, editsQuery.isLoading, anchorsQuery.isLoading, data.projects, edits, noteAnchors, noteAnchorNow, noteHasText, queryClient]);
  // Xác nhận đã xử lý 1 trôi → ghi đè mỏ neo = vị trí hiện tại (xoá khỏi danh sách).
  const ackDrift = useCallback((key: string) => {
    const now = noteAnchorNow[key]; if (!now) return;
    void syncNoteAnchors({ data: { set: { [key]: now } } }).then(() => queryClient.invalidateQueries({ queryKey: ["noteAnchors"] }));
  }, [noteAnchorNow, queryClient]);

  // ── RÀ SOÁT NOTE THEO NHẬT KÝ (khôi phục note đã trôi TRƯỚC khi có mỏ neo) ──
  // Nhật ký ghi mỗi lần viết note ở dự án/giai đoạn nào. So với vị trí HIỆN TẠI → note nào nằm sai → đưa về.
  const auditMapQuery = useQuery({ queryKey: ["auditPosMap"], queryFn: async (): Promise<Record<string, string>> => (await fetchAuditPosMap()).map ?? {}, staleTime: 5 * 60 * 1000 });
  const auditPosMap = auditMapQuery.data ?? {};
  const normA = (s?: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  const norm60 = (s?: string) => normA(s).slice(0, 60);
  const maCT1 = (s?: string) => normA(s).split(",")[0].trim();
  const stageCode = (s?: string) => { const n = normA(s); if (/thi cong|^tc$/.test(n)) return "TC"; if (/nhap kho/.test(n)) return "SX"; if (/trien khai|tksx/.test(n)) return "TKSX"; if (/san xuat|^sx$/.test(n)) return "SX"; if (/vat tu|^vt$/.test(n)) return "VT"; if (/duyet mau|trinh duyet|^ma$/.test(n)) return "MA"; if (/loa|tam ung|^bg$/.test(n)) return "BG"; if (/thiet ke|^tk$/.test(n)) return "TK"; if (/shop|^sd$/.test(n)) return "SD"; return "DA"; };
  // (maCT|giai đoạn) → khoá hiện tại (đích đưa note về); và maCT → khoá dự án.
  const auditTargets = useMemo(() => {
    const byStage = new Map<string, string>(), byProj = new Map<string, string>();
    for (const p of data.projects) {
      if (!byProj.has(maCT1(p.code))) byProj.set(maCT1(p.code), pkProj(p));
      for (const it of (p.allItems ?? p.items ?? [])) {
        const mk = `${maCT1(it.maCT || it.projectCode)}|${stageCode(it.stage || it.rawCode)}`;
        if (!byStage.has(mk)) byStage.set(mk, itemKeyOf(it));
      }
    }
    return { byStage, byProj };
  }, [data.projects, pkProj]);
  const auditDrift = useMemo(() => {
    if (!Object.keys(auditPosMap).length) return [] as { key: string; text: string; now: string; correct: string; target: string | null }[];
    const out: { key: string; text: string; now: string; correct: string; target: string | null }[] = [];
    for (const k of Object.keys(edits)) {
      if (!noteHasText(k)) continue;
      const e = edits[k]; const texts = [visibleText(e.noteMsgs), visibleText(e.actionMsgs)].filter(Boolean);
      let correct: string | undefined; for (const t of texts) { const c = auditPosMap[norm60(t)]; if (c) { correct = c; break; } }
      if (!correct) continue;
      const now = noteAnchorNow[k]; if (!now) continue;
      const [cMaCT, cStage] = correct.split("||");
      const [nMaCT, , nStage] = now.split("||");
      const pDiff = maCT1(cMaCT) !== maCT1(nMaCT);
      const sDiff = cStage !== "DA" && stageCode(nStage) !== "DA" && stageCode(cStage) !== stageCode(nStage);
      if (!pDiff && !sDiff) continue;
      const target = cStage === "DA" ? auditTargets.byProj.get(maCT1(cMaCT)) : (auditTargets.byStage.get(`${maCT1(cMaCT)}|${stageCode(cStage)}`) || auditTargets.byProj.get(maCT1(cMaCT)));
      out.push({ key: k, text: (texts[0] || "").replace(/\s+/g, " ").slice(0, 95), now: `${nMaCT} · ${nStage === "__DUAN__" ? "(dự án)" : nStage}`, correct: `${cMaCT} · ${cStage === "DA" ? "(dự án)" : cStage}`, target: target && target !== k ? target : null });
    }
    return out;
  }, [edits, auditPosMap, noteAnchorNow, noteHasText, auditTargets]);
  // Dời LẶP nhiều lượt: các note lệch tạo thành CHUỖI/hoán vị (A→B mà B→C…) nên đích thường đang bị
  // chiếm; remapKeys chỉ dời vào ô TRỐNG (không đè → an toàn). Lặp tới khi không dời thêm được.
  const applyAuditAll = useCallback(() => {
    const items = auditDrift.filter((d) => d.target);
    if (!items.length) return;
    void (async () => {
      try {
        const set: Record<string, string> = {}; const remove: string[] = [];
        for (const d of items) { set[d.target!] = noteAnchorNow[d.target!] || ""; remove.push(d.key); }
        let totalMoved = 0, totalMerged = 0, lastEdits: EditsMap | null = null;
        for (let pass = 0; pass < 8; pass++) {
          const em: Record<string, string> = {}, cm: Record<string, string> = {};
          for (const d of items) { em[d.key] = d.target!; cm[d.key] = d.target!; }
          const r = await remapKeys({ data: { edits: em, completed: cm, updates: {} } });
          lastEdits = r.edits; totalMoved += r.moved || 0; totalMerged += r.merged || 0;
          if (!r.moved) break;    // hết dời được → dừng (nay đích có sẵn note vẫn GỘP được, không kẹt)
        }
        if (lastEdits) queryClient.setQueryData(["edits"], lastEdits);
        await syncNoteAnchors({ data: { set, remove } });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["edits"] }),
          queryClient.invalidateQueries({ queryKey: ["completedDates"] }),
          queryClient.invalidateQueries({ queryKey: ["noteAnchors"] }),
        ]);
        toast.success(totalMoved ? `Đã đưa ${totalMoved} khoá về đúng chỗ${totalMerged ? ` (${totalMerged} chỗ đích đã có ghi chú → GỘP thêm vào, không mất tin nào)` : ""} (đề xuất ${items.length}). Tải lại trang (Ctrl+F5) để thấy.` : "Không có gì cần dời.");
        track("audit_recover", `Rà soát nhật ký: dời ${totalMoved} khoá (đề xuất ${items.length})`);
      } catch (e) { toast.error("Lỗi: " + (e as Error).message); }
    })();
  }, [auditDrift, noteAnchorNow, queryClient]);
  const applyAuditOne = useCallback((key: string, target: string) => {
    void remapKeys({ data: { edits: { [key]: target }, completed: { [key]: target }, updates: {} } })
      .then((r) => {
        if (!r.moved) { toast("Không dời được — kiểm tra lại."); return; }
        queryClient.setQueryData(["edits"], r.edits);
        void queryClient.invalidateQueries({ queryKey: ["completedDates"] });
        return syncNoteAnchors({ data: { set: { [target]: noteAnchorNow[target] || "" }, remove: [key] } })
          .then(() => { void queryClient.invalidateQueries({ queryKey: ["noteAnchors"] }); toast.success(r.merged ? "Đích đã có ghi chú sẵn → đã GỘP note vào đó (không mất tin nào). Tải lại (Ctrl+F5)." : "Đã đưa về đúng chỗ. Tải lại (Ctrl+F5) để thấy."); });
      })
      .catch((e) => toast.error("Lỗi: " + (e as Error).message));
  }, [queryClient, noteAnchorNow]);

  /** Thao tác BOX CHAT Vướng mắc / Giải pháp (add/hide/unhide/delete[admin]/sethi[admin]). */
  const msgOp = async (key: string, field: "note" | "action", op: "add" | "edit" | "hide" | "unhide" | "delete" | "sethi" | "hiall" | "unhiall", opts?: { text?: string; msgId?: string; hi?: HiRange[] | null; replyTo?: string; replyText?: string }): Promise<boolean> => {
    // F5 — XOÁ có HOÀN TÁC (thay window.confirm): xoá khỏi cache NGAY (mọi người thấy mất) + toast
    // "Hoàn tác" 6s; hết giờ chưa hoàn tác mới ghi server. (Đóng tab trong 6s = coi như hoàn tác.)
    if (op === "delete") {
      const prev = queryClient.getQueryData(["edits"]) as EditsMap | undefined;
      const listKey = field === "note" ? "noteMsgs" : "actionMsgs";
      if (prev?.[key]) {
        const entry = prev[key];
        const newList = (entry[listKey] ?? []).filter((m) => m.id !== opts?.msgId);
        queryClient.setQueryData(["edits"], { ...prev, [key]: { ...entry, [listKey]: newList.length ? newList : undefined } });
      }
      let done = false;
      const commit = () => {
        if (done) return; done = true;
        void editMessages({ data: { key, field, op: "delete", msgId: opts?.msgId, devAs: devAs() } })
          .then((r) => queryClient.setQueryData(["edits"], r.items))
          .catch((e) => { if (prev) queryClient.setQueryData(["edits"], prev); toast.error(`Xoá thất bại: ${(e as Error).message}`); });
      };
      const timer = setTimeout(commit, 6000);
      toast("Đã xoá message.", {
        duration: 6000,
        action: { label: "Hoàn tác", onClick: () => { done = true; clearTimeout(timer); if (prev) queryClient.setQueryData(["edits"], prev); } },
      });
      track("save_edit", `${key.slice(0, 40)} — ${field === "note" ? "Vướng mắc" : "Giải pháp"}: XOÁ (hoàn tác 6s)`.slice(0, 290));
      return true;
    }
    try {
      const r = await editMessages({ data: { key, field, op, text: opts?.text, msgId: opts?.msgId, hi: opts?.hi, replyTo: opts?.replyTo, replyText: opts?.replyText, devAs: devAs() } });
      queryClient.setQueryData(["edits"], r.items);
      const FIELD_VN = field === "note" ? "Vướng mắc" : "Giải pháp";
      const OP_VN: Record<string, string> = { add: "thêm", edit: "sửa", hide: "ẩn", unhide: "mở ẩn", delete: "XOÁ", sethi: "tô màu", hiall: "tô cả ô", unhiall: "bỏ tô cả ô" };
      const it = data.items.find(x => nk(x) === key);
      const proj = it ? null : data.projects.find(p => pkProj(p) === key);
      const ctx = it ? `${it.projectCode} ${it.projectName} · ${stageAbbrOf(stageIdOf(it))}`
                : proj ? `${proj.maCT || proj.code} ${proj.name} (cấp dự án)` : key.slice(0, 40);
      const detail = op === "add" && opts?.text ? `: "${opts.text.replace(/\s+/g, " ").trim().slice(0, 120)}"` : "";
      track("save_edit", `${ctx} — ${FIELD_VN}: ${OP_VN[op]}${detail}`.slice(0, 290));
      // MỎ NEO LÚC VIẾT: note vừa được thêm/sửa = đang ĐÚNG chỗ → ghi mỏ neo = vị trí hiện tại (mốc "trước" thật).
      if (op === "add" || op === "edit") {
        const anc = noteAnchorNow[key];
        if (anc) void syncNoteAnchors({ data: { set: { [key]: anc } } }).then(() => queryClient.invalidateQueries({ queryKey: ["noteAnchors"] }));
      }
      return true;
    } catch (e) {
      toast.error(`Thao tác thất bại: ${(e as Error).message}`);
      return false;
    }
  };

  /** ẨN / BỎ ẨN 1 DÒNG (admin) — cập nhật lạc quan cache rồi ghi server (server chốt quyền admin).
   *  Khoá = itemKeyOf. Ghi vết vào Nhật ký giám sát để biết ai ẩn/bỏ ẩn hạng mục nào. */
  const onHideRow = useCallback((key: string, label: string, hide: boolean) => {
    const prev = queryClient.getQueryData<HiddenRows>(["hiddenRows"]) ?? {};
    const next: HiddenRows = { ...prev };
    if (hide) next[key] = { at: new Date().toISOString(), by: me.email ?? "?" };
    else delete next[key];
    queryClient.setQueryData(["hiddenRows"], next);   // lạc quan: bảng phản hồi tức thì
    void (async () => {
      try {
        const r = await setHiddenRow({ data: { key, hide, devAs: devAs() } });
        queryClient.setQueryData(["hiddenRows"], r.hidden);
        track(hide ? "hide_row" : "unhide_row", label.slice(0, 290));
      } catch (e) {
        queryClient.setQueryData(["hiddenRows"], prev); // rollback nếu server từ chối
        toast.error(`${hide ? "Ẩn" : "Bỏ ẩn"} dòng thất bại: ${(e as Error).message}`);
      }
    })();
  }, [queryClient, me.email, devAs, track]);

  /* ── LỊCH SỬ NGÀY CẬP NHẬT (cho BÁO CÁO TUÂN THỦ) ──
     Sheet chỉ giữ LẦN CẬP NHẬT GẦN NHẤT của mỗi dự án → app phải tự tích luỹ, nếu
     không sẽ không bao giờ biết tuần trước PM có cập nhật hay không. */
  const historyQuery = useQuery({
    queryKey: ["updateHistory"],
    queryFn: async (): Promise<UpdateHistory> => (await fetchUpdateHistory()).history ?? {},
    staleTime: 60_000,
  });
  const updateHistory: UpdateHistory = useMemo(() => historyQuery.data ?? {}, [historyQuery.data]);

  /* Thấy ngày update CHƯA TỪNG ghi nhận → bổ sung vào lịch sử. Lọc ở client rồi mới
     gọi API, nên bình thường KHÔNG ghi gì cả (tránh mọi lượt mở app đều đọc-ghi KV
     → giảm hẳn rủi ro tranh chấp ghi đè). */
  useEffect(() => {
    if (!remapReady) return; // chờ di trú khoá xong mới ghi lịch sử theo khoá ID
    if (historyQuery.isLoading || !data.projects.length) return;
    const moi: Record<string, string> = {};
    for (const p of data.projects) {
      const d = p.updateDate;
      if (!d) continue;
      const key = pkProj(p);
      if (!(updateHistory[key] ?? []).includes(d)) moi[key] = d;
    }
    if (!Object.keys(moi).length) return;
    void (async () => {
      try {
        const r = await recordUpdateDates({ data: { entries: moi } });
        queryClient.setQueryData(["updateHistory"], r.history);
      } catch { /* ghi nhận lịch sử là phụ trợ — hỏng thì không được làm hỏng bảng */ }
    })();
  }, [remapReady, data.projects, updateHistory, historyQuery.isLoading, queryClient]);

  /* ── NGÀY KẾT THÚC THỰC TẾ (khi hạng mục đạt 100%) — kho dùng chung (KV) ──
     Quét TẤT CẢ hạng mục (allItems, gồm việc 100% mà data.items đã loại). Việc ≥100% chưa ghi →
     ghi "ngày lần đầu 100%" (= ngày update lúc đó). Việc rớt <100% (hoặc biến mất) → XOÁ để hiện
     lại ngày kế hoạch. Client tính DELTA nên bình thường không gọi API. */
  const completedQuery = useQuery({
    queryKey: ["completedDates"],
    queryFn: async (): Promise<CompletedDates> => (await fetchCompletedDates()).completed ?? {},
    staleTime: 60_000,
  });
  const completedDates: CompletedDates = useMemo(() => completedQuery.data ?? {}, [completedQuery.data]);

  /* ── CỜ "CẦN CẬP NHẬT MP / TRÌNH BOD" — app tự ghi NGÀY LẦN ĐẦU thấy cờ (nền cho chấm −10/tuần
     + tô màu cột "Cần cập nhật MP"). Kho dùng chung KV mpflag:v1. Sync ở effect bên dưới (cần
     mpProjectKeys, tính sau). */
  const mpFlagQuery = useQuery({
    queryKey: ["mpFlags"],
    queryFn: async (): Promise<MpFlagFirstSeen> => (await fetchMpFlags()).mpFlags ?? {},
    staleTime: 60_000,
  });
  const mpFlags: MpFlagFirstSeen = useMemo(() => mpFlagQuery.data ?? {}, [mpFlagQuery.data]);

  // ── DÒNG ẨN THỦ CÔNG (admin) — khoá itemKeyOf → {at,by}. Loại khỏi bảng/KPI/PDF/Excel cho MỌI người;
  //    admin bật "Hiện dòng đã ẩn" để soi + bỏ ẩn. Xem fetchHiddenRows/setHiddenRow (server chốt quyền).
  const hiddenQuery = useQuery({
    queryKey: ["hiddenRows"],
    queryFn: async (): Promise<HiddenRows> => (await fetchHiddenRows()).hidden ?? {},
    staleTime: 60_000,
  });
  const hiddenMap: HiddenRows = useMemo(() => hiddenQuery.data ?? {}, [hiddenQuery.data]);
  const hiddenKeys = useMemo(() => new Set(Object.keys(hiddenMap)), [hiddenMap]);
  const [showHidden, setShowHidden] = useState(false);

  /* ── KHOÁ NOTE THEO RID (chống mất note khi STT bị đánh lại) ──
     itemKeyOf() ƯU TIÊN rid:<RID> (cột RID PMO tự điền, bền nhất). NHƯNG note CŨ đã lưu ở khoá cũ
     (h:/id:/composite) → ĐỌC DỰ PHÒNG: nk() trả khoá ứng viên ĐẦU TIÊN đang CÓ dữ liệu (trong
     edits/completed/hidden); không có ở đâu → trả rid (đích ghi note MỚI). KHÔNG di trú KV hàng loạt
     nên 275 note cũ vẫn hiện nguyên; note mới bám rid nên STT đổi mặc kệ. Đọc [[project-stt-key-fragility]]. */
  const rowHasData = useCallback(
    (k: string) => edits[k] !== undefined || completedDates[k] !== undefined || hiddenMap[k] !== undefined,
    [edits, completedDates, hiddenMap],
  );
  const nk = useCallback((it: ItemRow) => { const cs = itemKeysOf(it); return cs.find(rowHasData) ?? cs[0]; }, [rowHasData]);

  // ── CHẾ ĐỘ TRÌNH CHIẾU TV ── fullscreen CẢ app (như F11) + lấp đầy màn hình LỚN: thêm class
  //    .tv-mode vào <body> (styles.css bỏ giới hạn 1600px của <main>) → bảng phủ hết bề rộng TV →
  //    cỡ chữ (cqw) tự phóng theo tỉ lệ, không tràn ô. NHỚ trạng thái để mở lại trên TV vẫn to.
  //    Nút bật/tắt nằm trong dropdown "Hệ thống" (ReportsMenu).
  const [tvMode, setTvMode] = useState(false);
  useEffect(() => { try { if (localStorage.getItem("pmo-tv-mode") === "1") setTvMode(true); } catch { /* */ } }, []);
  useEffect(() => {
    document.body.classList.toggle("tv-mode", tvMode);
    return () => document.body.classList.remove("tv-mode");
  }, [tvMode]);
  const toggleTvMode = useCallback(() => {
    setTvMode((prev) => {
      const next = !prev;
      try { localStorage.setItem("pmo-tv-mode", next ? "1" : "0"); } catch { /* */ }
      try {
        if (next) void document.documentElement.requestFullscreen?.();
        else if (document.fullscreenElement) void document.exitFullscreen?.();
      } catch { /* trình duyệt chặn fullscreen — tỉ lệ to vẫn áp qua class */ }
      return next;
    });
  }, []);

  /* ── DI TRÚ KHOÁ 1 LẦN: (mã+tên) đời cũ → ID (cột STT) ──
     Dữ liệu vướng mắc/giải pháp/ngày kết thúc/lịch sử update ĐÃ LƯU theo khoá tên cũ. App nay khoá
     theo ID → phải dời sang khoá ID kẻo "mồ côi". CHỈ gọi khi CÒN phát hiện khoá tên cũ trong dữ
     liệu đã tải (dời xong lần sau không còn → không gọi nữa → không tốn ghi KV). Xong mới mở cổng
     remapReady cho các effect sync chạy. Không có ID (file/CSV cũ) → bỏ qua, giữ khoá tên. */
  useEffect(() => {
    if (remapRanRef.current) return;
    if (editsQuery.isLoading || historyQuery.isLoading || completedQuery.isLoading || !data.projects.length) return;
    const legacyProj = (code: string, name: string) => `${code} ${name}`;
    const legacyItem = (code: string, name: string, rawCode: string, dupIdx: number) =>
      [code, name, rawCode, dupIdx].join(String.fromCharCode(0));
    const editPairs: Record<string, string> = {};
    const completedPairs: Record<string, string> = {};
    const updatePairs: Record<string, string> = {};
    for (const p of data.projects) {
      if (p.id && p.id.trim()) {
        const oldK = legacyProj(p.code, p.name), newK = `id:${p.id.trim()}`;
        if (oldK !== newK) { editPairs[oldK] = newK; updatePairs[oldK] = newK; }
      }
      // LỚP 2: STT → ID CỨNG (cấp dự án) — chỉ khi nguồn ĐÃ có cột IDCUNG.
      if (p.hid && p.hid.trim() && p.id && p.id.trim()) {
        const oldK = `id:${p.id.trim()}`, newK = pkProj(p);
        if (oldK !== newK) { editPairs[oldK] = newK; updatePairs[oldK] = newK; }
      }
      for (const it of (p.allItems ?? p.items ?? [])) {
        if (it.id && it.id.trim()) {
          const oldK = legacyItem(it.projectCode, it.projectName, it.rawCode, it.dupIdx ?? 0), newK = `id:${it.id.trim()}`;
          if (oldK !== newK) { editPairs[oldK] = newK; completedPairs[oldK] = newK; }
        }
        // LỚP 2: STT → ID CỨNG (cấp công đoạn). Chốt newK = khoá h: TƯỜNG MINH (KHÔNG dùng itemKeyOf —
        // itemKeyOf nay ưu tiên rid, sẽ biến di trú này thành id→rid, tức di trú KV mà ta CỐ Ý tránh).
        if (it.projHid && it.projHid.trim() && it.id && it.id.trim()) {
          const oldK = `id:${it.id.trim()}`, newK = `h:${it.projHid.trim()}:${(it.rawCode || "").toUpperCase()}:${it.dupIdx ?? 0}`;
          if (oldK !== newK) { editPairs[oldK] = newK; completedPairs[oldK] = newK; }
        }
        if (it.blocks?.length) {
          it.blocks.forEach((b, bi) => {
            if (b.id && b.id.trim()) {
              const oldK = legacyItem(it.projectCode, it.projectName, b.code, bi), newK = `id:${b.id.trim()}`;
              if (oldK !== newK) { editPairs[oldK] = newK; completedPairs[oldK] = newK; }
            }
            // LỚP 2 (block): STT → ID CỨNG.
            if (p.hid && p.hid.trim() && b.id && b.id.trim()) {
              const oldK = `id:${b.id.trim()}`, newK = `h:${p.hid.trim()}:${(b.code || "").toUpperCase()}:${bi}`;
              if (oldK !== newK) { editPairs[oldK] = newK; completedPairs[oldK] = newK; }
            }
          });
        }
      }
    }
    const hasLegacy =
      Object.keys(editPairs).some((k) => edits[k] !== undefined) ||
      Object.keys(completedPairs).some((k) => completedDates[k] !== undefined) ||
      Object.keys(updatePairs).some((k) => updateHistory[k] !== undefined);
    remapRanRef.current = true;
    if (!hasLegacy) { setRemapReady(true); return; }
    void (async () => {
      try {
        const r = await remapKeys({ data: { edits: editPairs, completed: completedPairs, updates: updatePairs } });
        queryClient.setQueryData(["edits"], r.edits);
        queryClient.setQueryData(["completedDates"], r.completed);
        queryClient.setQueryData(["updateHistory"], r.updates);
      } catch { /* di trú phụ trợ — hỏng không được làm hỏng bảng */ }
      finally { setRemapReady(true); }
    })();
  }, [editsQuery.isLoading, historyQuery.isLoading, completedQuery.isLoading, data.projects, edits, completedDates, updateHistory, queryClient, pkProj]);

  useEffect(() => {
    if (!remapReady) return; // chờ di trú khoá xong mới sync (tránh XOÁ nhầm khoá tên cũ)
    if (completedQuery.isLoading || !data.projects.length) return;
    const add: Record<string, string> = {};
    const seenDone = new Set<string>();
    for (const p of data.projects) for (const it of (p.allItems ?? p.items ?? [])) {
      if (!(it.pctActual != null && it.pctActual >= 100)) continue;
      const key = nk(it);
      seenDone.add(key);
      if (!completedDates[key]) add[key] = (it.updateDate ?? p.updateDate ?? today).slice(0, 10);
    }
    const remove = Object.keys(completedDates).filter(k => !seenDone.has(k));
    if (!Object.keys(add).length && !remove.length) return;
    void (async () => {
      try {
        const r = await syncCompletedDates({ data: { add, remove } });
        queryClient.setQueryData(["completedDates"], r.completed);
      } catch { /* phụ trợ — hỏng không được làm hỏng bảng */ }
    })();
  }, [remapReady, data.projects, completedDates, completedQuery.isLoading, today, queryClient, nk]);

  /* ── ÁP CHỈNH SỬA vào dữ liệu TRƯỚC mọi phép tính (lọc/phân loại/bảng/PDF
     đều tiêu thụ effectiveItems — sửa Deadline sẽ tự tính lại Quá hạn,
     % dự kiến và nhãn Tình trạng theo đúng luật hiện hành). ── */
  const effectiveItems: ItemRow[] = useMemo(() => {
    return data.items.map(it => {
      const ed = edits[nk(it)];
      // Vướng mắc KHÔNG lấy từ sheet nữa — chỉ hiện ghi chú nhập TRỰC TIẾP trong
      // app (kho dùng chung). Chưa nhập → để TRỐNG.
      const deadline = ed?.deadline ?? it.deadline;
      return {
        ...it,
        note: visibleText(ed?.noteMsgs),
        owner: ed?.pic ?? it.owner,
        deadline,
        overdueDays: ed?.deadline
          ? getDaysOverdue({ deadline, pctActual: it.pctActual }, today)
          : it.overdueDays,
      };
    });
  }, [data.items, edits, today, nk]);

  // TÁCH RIÊNG phép "enrich" 1 đầu việc để TÁI DÙNG cho cả việc ĐANG LÀM (enriched) lẫn việc ĐÃ
  // HOÀN THÀNH (doneEnriched, chỉ khi bật "Hiện tất cả") — KHÔNG dựng lại logic, không đụng KPI.
  const enrichItem = useCallback((raw: ItemRow, it: ItemRow): EnrichedItem => {
    {
      const sid = stageIdOf(it);
      const planDyn = computePlanPct(it.start, it.deadline, today);
      const a = classifyAlert(it, planDyn, th);
      /* ── BA LUẬT GHI ĐÈ, theo thứ tự ưu tiên (PMO chốt 17/07/2026) ──
         Thứ tự QUAN TRỌNG: hai luật miễn trừ phải đứng TRƯỚC luật ép trễ, nếu không
         dự án quá hạn sẽ ép cả PS lẫn dự án đã bàn giao thành "Trễ tiến độ".

         1. ĐÃ BÀN GIAO: note dòng cha ghi "đã bàn giao / đã hoàn tất" ⇒ dự án xong,
            gỡ SẠCH cảnh báo mọi hạng mục (hàng gộp tô xanh lá ở phần render).
         2. PHÁT SINH (mã PS): việc phát sinh thêm, có mốc RIÊNG trễ hơn dự án và
            không chịu quy luật cảnh báo nào — luôn để trống, kể cả khi tự nó quá hạn.
         3. DỰ ÁN TRỄ ⇒ MỌI HẠNG MỤC CON ĐỀU TRỄ: dự án đã qua mốc bàn giao mà chưa
            xong thì không thể có hạng mục nào "không trễ" — ép hết thành "Trễ tiến độ",
            ghi đè kết quả chấm theo từng dòng (lệch %/quá hạn). */
      const delivered = !!it.projectDelivered;
      const isPhatSinh = sid === "PS";
      // ĐÃ HOÀN THÀNH (100%) → KHÔNG cảnh báo: hạng mục đã xong thì không thể "trễ", kể cả khi dự
      // án đang trễ (bỏ luật ép-trễ cho nó). Nhờ vậy dòng CHA không hiện badge đỏ cho giai đoạn đã xong.
      const isDone = it.pctActual != null && it.pctActual >= 100;
      const projectLate = !!it.projectDeadline && it.projectDeadline.slice(0, 10) < today;
      const forcedLate = projectLate && !isPhatSinh && !delivered && !isDone;

      const alertKind: AlertKind =
        delivered ? "none"
        : isDone ? "none"
        : isPhatSinh ? "none"
        : forcedLate ? "late"
        : a.kind;

      // Màu phải đi theo nhãn SAU khi ghi đè, không giữ màu ma trận chấm lúc đầu:
      // ép thành "Trễ tiến độ" mà vẫn để vàng thì hàng đỏ/vàng không còn nghĩa.
      const alertColor: AlertColor =
        (delivered || isDone || isPhatSinh) ? null
        : forcedLate ? "red"
        : a.color;

      const sevLabel =
        delivered ? "Dự án đã bàn giao xong, không còn cảnh báo"
        : isPhatSinh ? "Hạng mục phát sinh: có mốc riêng, không xét cảnh báo tiến độ"
        : (forcedLate && a.kind !== "late")
          ? `Dự án đã quá mốc bàn giao ${fmtDateVN2(it.projectDeadline)}, toàn bộ hạng mục tính là trễ`
          : a.severityLabel;
      const key = nk(raw); // khoá note: rid nếu có (đọc dự phòng khoá cũ) — không đổi khi sửa tiến độ
      const ed = edits[key];
      return {
        ...it,
        note: visibleText(ed?.noteMsgs),   // TEXT rút gọn = message KHÔNG ẩn (bảng/xuất Excel)
        _stageId: sid,
        _stageLabel: stageLabelOf(sid),
        _stageDisplay: stageDisplayLabel(sid),
        _dept: deptOf(sid),
        _pic: it.owner || pmOfItem(it) || "—",
        _projectPm: pmOfItem(it) || "—",
        _planDyn: planDyn,
        _alert: alertKind,
        _alertColor: alertColor,
        _sevScore: a.severityScore,
        _sevLabel: sevLabel,
        _action: visibleText(ed?.actionMsgs),
        _noteMsgs: ed?.noteMsgs ?? [],
        _actionMsgs: ed?.actionMsgs ?? [],
        _noteEdited: !!ed?.noteMsgs?.length,
        _actionEdited: !!ed?.actionMsgs?.length,
        _picEdited: ed?.pic != null,
        _deadlineEdited: ed?.deadline != null,
        _editedAt: ed?.updatedAt ?? null,
        _key: key,
        _sheet: { note: raw.note, pic: raw.owner, deadline: raw.deadline },
      };
    }
  }, [th, pmOfItem, today, edits, nk]);

  // Dựng 1 Block (Thi công lắp đặt) thành ĐẦU VIỆC hoàn chỉnh: KẾ THỪA dòng TC cha (người phụ
  // trách/ngày bắt đầu-kết thúc/dự án…), lấy %/tên riêng của Block, rồi enrich NHƯ item thường —
  // áp edit Vướng mắc/Giải pháp/PIC/Deadline theo KHOÁ RIÊNG của Block (rawCode=TC1..TCn).
  const buildBlockItem = useCallback((parent: EnrichedItem, b: BlockChild, bi: number): EnrichedItem => {
    // Ngày RIÊNG của dòng con (đọc từ file) ưu tiên; ô trống → kế thừa ngày hạng mục cha.
    const bStart = b.start ?? parent.start;
    const bDeadline = b.deadline ?? parent.deadline;
    const raw: ItemRow = {
      ...(parent as ItemRow),
      // ID RIÊNG của Block (cột STT dạng "70.1a") — GHI ĐÈ id của TC cha, nếu không sẽ đụng khoá.
      // b.id undefined (nguồn cũ) → itemKeyOf tự rớt về khoá mã+TCn+dupIdx (vẫn duy nhất).
      id: b.id,
      // RID RIÊNG của dòng Block — GHI ĐÈ rid của TC cha (spread), nếu không mọi block cùng cha đụng khoá.
      rid: b.rid,
      rawCode: b.code, dupIdx: bi, desc: b.label,
      start: bStart, deadline: bDeadline,
      pctActual: b.pctActual, pctActualInvalid: false,
      codeCounts: undefined, blocks: undefined, note: "",
      overdueDays: getDaysOverdue({ deadline: bDeadline, pctActual: b.pctActual }, today),
    };
    const ed = edits[nk(raw)];
    const deadline = ed?.deadline ?? raw.deadline;
    const edited: ItemRow = {
      ...raw,
      note: ed?.note ?? "",
      owner: ed?.pic ?? raw.owner,
      deadline,
      overdueDays: getDaysOverdue({ deadline, pctActual: b.pctActual }, today),
    };
    return enrichItem(raw, edited);
  }, [edits, today, enrichItem, nk]);

  // NGUỒN ĐẦY ĐỦ (kể cả dòng đã ẩn) — các effect quản khoá (completed/updates) KHÔNG được dùng bản
  // đã lọc kẻo tưởng dòng ẩn là "mồ côi" rồi xoá nhầm dữ liệu. Chúng dùng data.projects nên đã an toàn,
  // nhưng vẫn tách rõ để về sau ai đọc cũng hiểu ranh giới.
  const enrichedAll: EnrichedItem[] = useMemo(
    () => data.items.map((raw, i) => enrichItem(raw, effectiveItems[i]))
      .map((it) => (it.blocks?.length
        ? { ...it, _blockItems: it.blocks.map((b, bi) => buildBlockItem(it, b, bi)) }
        : it)),
    [data.items, effectiveItems, enrichItem, buildBlockItem],
  );
  // NGUỒN HIỂN THỊ: mặc định LOẠI dòng đã ẩn khỏi MỌI nơi (bảng/KPI/databar/PDF/Excel). Admin bật
  // "Hiện dòng đã ẩn" → đưa lại vào kèm cờ _hidden để làm mờ + cho bỏ ẩn (KPI khi đó cũng gồm lại,
  // giữ "số liệu khớp bảng"). Không có dòng ẩn nào → trả nguyên bản (không tốn map).
  const enriched: EnrichedItem[] = useMemo(() => {
    if (hiddenKeys.size === 0) return enrichedAll;
    return showHidden
      ? enrichedAll.map((it) => (hiddenKeys.has(it._key) ? { ...it, _hidden: true } : it))
      : enrichedAll.filter((it) => !hiddenKeys.has(it._key));
  }, [enrichedAll, hiddenKeys, showHidden]);
  // Việc ĐÃ HOÀN THÀNH (pct ≥ 100, còn Show) — CHỈ dựng khi bật "Hiện tất cả đầu việc". Enrich y
  // hệt việc đang làm. KHÔNG đưa vào enriched/panelActive/KPI → không làm sai số liệu tổng.
  const [showDone, setShowDone] = useState(false);
  const doneEnriched: EnrichedItem[] = useMemo(() => {
    if (!showDone) return [];
    const out: EnrichedItem[] = [];
    for (const p of data.projects) for (const raw of (p.allItems ?? [])) {
      if (raw.shown === false) continue;
      if (!(raw.pctActual != null && raw.pctActual >= 100)) continue; // enriched đã có việc <100%
      const k = nk(raw);
      const isHidden = hiddenKeys.has(k);
      if (isHidden && !showHidden) continue; // dòng đã ẩn: loại khỏi cả nhóm việc đã hoàn thành
      const ed = edits[k];
      const deadline = ed?.deadline ?? raw.deadline;
      const eff: ItemRow = { ...raw, note: ed?.note ?? "", owner: ed?.pic ?? raw.owner, deadline,
        overdueDays: ed?.deadline ? getDaysOverdue({ deadline, pctActual: raw.pctActual }, today) : raw.overdueDays };
      const en = enrichItem(raw, eff);
      out.push(isHidden ? { ...en, _hidden: true } : en);
    }
    return out;
  }, [showDone, data.projects, edits, today, enrichItem, hiddenKeys, showHidden, nk]);

  const alerts = useMemo(() => enriched.filter(i => i._alert !== "none") as (EnrichedItem & { _alert: AlertK })[], [enriched]);
  const suspectCount = enriched.reduce((acc, i) => acc + (i.pctPlanInvalid ? 1 : 0) + (i.pctActualInvalid ? 1 : 0), 0);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const pickKpi = (k: AlertK2) => {
    setFilters(f => ({ ...f, alerts: toggleIn(f.alerts, k) }));
  };

  // ── "Cần cập nhật MP": DẤU HIỆU DUY NHẤT = vướng mắc CẤP DỰ ÁN có cụm
  //    "trình BOD phê duyệt (Bitrix)". KHÔNG dùng cờ cột "Cần cập nhật MP" của file, KHÔNG
  //    dùng các ghi chú "cập nhật MP" chung chung (trước đây gộp cả 2 làm lọc phình sai — vd
  //    43 ĐTM lọt vào dù không có câu này). Quét 2 nguồn vướng mắc dự án, khớp thì vào:
  //      · projectNote — vướng mắc cột U dòng cha trong FILE (đúng cái người dùng Ctrl+F).
  //      · box chat app (noteMsgs, chỉ message CHƯA ẩn — ẩn = đã xử lý).
  //    mpInfo: khoá dự án → LÝ DO, để BẢNG PHẲNG lẫn BẢNG GỘP dùng CHUNG một danh sách.
  const mpInfo = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of data.projects) {
      const key = pkProj(p);
      const fileNote = p.projectNote ?? "";
      const appNote = visibleText(edits[key]?.noteMsgs).trim();
      if (noteSaysTrinhBodBitrix(fileNote) || (appNote && noteSaysTrinhBodBitrix(appNote)))
        m.set(key, appNote || fileNote);
    }
    return m;
  }, [data.projects, edits, pkProj]);
  const mpProjectKeys = useMemo(() => new Set(mpInfo.keys()), [mpInfo]);

  /* ── SYNC CỜ MP/BOD: dự án ĐANG có cờ mà CHƯA ghi mốc → ghi (ngày lần đầu = hôm nay); dự án ĐÃ
     ghi mà HẾT cờ → xoá (reset). Client tính delta nên bình thường không gọi API. Chờ remap xong
     (tránh xoá nhầm khoá cũ). */
  useEffect(() => {
    if (!remapReady) return;
    if (mpFlagQuery.isLoading || editsQuery.isLoading || !data.projects.length) return;
    const add: Record<string, string> = {};
    for (const key of mpProjectKeys) if (!mpFlags[key]) add[key] = today.slice(0, 10);
    const remove = Object.keys(mpFlags).filter(k => !mpProjectKeys.has(k));
    // AN TOÀN chống RESET TUỔI CỜ: nếu detection cho ra 0 cờ (có thể do edits/mpInfo chưa áp xong)
    // mà lại đòi XOÁ SẠCH mọi mốc đang có → khả năng cao CHƯA sẵn sàng → BỎ QUA (không wipe firstSeen).
    if (mpProjectKeys.size === 0 && remove.length) return;
    if (!Object.keys(add).length && !remove.length) return;
    void (async () => {
      try {
        const r = await syncMpFlags({ data: { add, remove } });
        queryClient.setQueryData(["mpFlags"], r.mpFlags);
      } catch { /* phụ trợ — hỏng không được làm hỏng bảng */ }
    })();
  }, [remapReady, data.projects, mpProjectKeys, mpFlags, mpFlagQuery.isLoading, editsQuery.isLoading, today, queryClient]);

  /* SỐ TUẦN cờ MP/BOD tồn tại theo TÊN dự án (chuẩn hoá) — cho ComplianceDialog tô màu + trừ điểm.
     ĐẾM THEO KỲ BÁO CÁO (tuần Thứ 2–CN, khớp cột tuần của báo cáo): tuần MỚI DÍNH CỜ = 0 (miễn, chưa
     trừ) → SANG TUẦN BÁO CÁO KẾ TIẾP mà vẫn còn cờ = 1 (−10đ), mỗi tuần báo cáo tiếp theo +1. KHÔNG đếm
     theo mốc "đủ 7 ngày kể từ ngày nhập" nữa (để nhập giữa tuần vẫn được miễn trọn tuần đó).
     Cùng tên trùng (dòng con) → lấy MAX (hiện trường hợp nặng nhất). */
  const mpComputed = useMemo(() => {
    const DAY = 86400000, WEEK = 7 * DAY;
    const p2 = (n: number) => String(n).padStart(2, "0");
    const tNow = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
    const weeks = new Map<string, number>();
    const deadline = new Map<string, string>();   // tên → NGÀY DEADLINE hiển thị (ISO)
    for (const p of data.projects) {
      const first = mpFlags[pkProj(p)];
      if (!first) continue;
      const note = mpInfo.get(pkProj(p)) || "";
      const parsed = parseMpDeadlineIso(note, first);   // dd/mm sau chữ "trước" trong ghi chú, hoặc null
      let dlIso: string | null = null, w = 0;
      if (parsed) {
        // CÓ "trước dd/mm": deadline = đúng ngày đó; QUA deadline → mỗi tuần −10, KHÔNG ân hạn.
        dlIso = parsed;
        const tDl = Date.UTC(+parsed.slice(0, 4), +parsed.slice(5, 7) - 1, +parsed.slice(8, 10));
        w = tNow > tDl ? Math.max(1, Math.ceil((tNow - tDl) / WEEK)) : 0;
      }
      // KHÔNG có "trước dd/mm" → KHÔNG có deadline: dlIso = null, w = 0 (không hiện ngày, KHÔNG trừ điểm).
      // Nguyên tắc: không nói tới deadline thì mặc định là KHÔNG CÓ — tuyệt đối không tự bịa ngày (cắm+7)
      // cũng không nhặt ngày bất kỳ trong câu (vd "dời từ 30/10").
      void DAY; void p2;
      const k = normProjName(p.name);
      weeks.set(k, Math.max(weeks.get(k) ?? 0, w));           // trùng tên → nặng nhất
      if (dlIso) { const curD = deadline.get(k); if (!curD || dlIso < curD) deadline.set(k, dlIso); }  // trùng tên → deadline sớm nhất
    }
    return { weeks, deadline };
  }, [data.projects, mpFlags, mpInfo, today, pkProj]);
  const mpWeeksByName = mpComputed.weeks;
  const mpDeadlineByName = mpComputed.deadline;

  /* TÊN dự án (chuẩn hoá) ĐANG có cờ "Cần cập nhật MP" — để bảng tuân thủ ĐÁNH DẤU cột KỂ CẢ khi mới gắn
     cờ tuần đầu (weeks=0, chưa trừ điểm). Lấy từ mpProjectKeys (cờ hiện tại) nên KHÔNG phụ thuộc mốc
     firstSeen: dự án vừa dính cờ tuần này vẫn hiện ngay, thay vì để trống tới khi qua 1 tuần. */
  const mpFlaggedNames = useMemo(() => {
    const s = new Set<string>();
    for (const p of data.projects) if (mpProjectKeys.has(pkProj(p))) s.add(normProjName(p.name));
    return s;
  }, [data.projects, mpProjectKeys, pkProj]);

  /* ────────────────────────────────────────────────────────────────
   * HÀM LỌC TRUNG TÂM — getFilteredProjects (src/lib/filter.ts).
   * Bảng app, Excel, PDF đều tiêu thụ TỪ ĐÂY. Không nơi nào tự lọc riêng.
   * ──────────────────────────────────────────────────────────────── */
  const matcher: StageMatcher = useMemo(() => ({
    stageId: (it) => stageIdOf(it),
    deptOf: (it) => deptOf(stageIdOf(it)),
    computePlanPct: (it) => computePlanPct(it.start, it.deadline, today),
  }), [today]);

  // F8 — GÕ MƯỢT: dùng bản filters "trễ" (useDeferredValue) cho phép lọc BẢNG CHÍNH (nặng nhất). Ô tìm
  //  vẫn bind filters.query (gõ tức thì, responsive); bảng cập nhật ngay sau khi ngừng gõ, không giật.
  const dFilters = useDeferredValue(filters);
  const criteriaTable: FilterCriteria = useMemo(() => ({
    stages: dFilters.stages as string[],
    depts: dFilters.depts,
    alerts: dFilters.alerts,
    deadlineMonths: dFilters.deadlineMonths,
    query: dFilters.query.trim().toLowerCase(),
    searchHaystack: (it) => `${it.projectName} ${it.maCT} ${it.owner || pmOfItem(it) || ""} ${pmOfItem(it) || ""} ${it.desc}`,
  }), [dFilters, pmOfItem]);

  const filterResult = useMemo(
    () => getFilteredProjects(effectiveItems, matcher, criteriaTable, th),
    [effectiveItems, matcher, criteriaTable, th],
  );

  // Map ngược qualifying items → EnrichedItem cho UI hiện hữu.
  const enrichedByRef = useMemo(() => {
    const m = new Map<ItemRow, EnrichedItem>();
    for (const e of enriched) m.set(e as unknown as ItemRow, e);
    // enriched giữ identity field-by-field (spread của ItemRow); cần map qua khoá khác.
    // Dùng (projectCode + rawCode + desc + start + deadline) làm khoá đủ ổn cho dữ liệu thật.
    return m;
  }, [enriched]);
  void enrichedByRef;


  /** Danh sách tháng deadline dự án có cảnh báo — dùng cho dropdown. */
  // (Đã bỏ `filteredAlerts`: trước đây bảng mặc định chỉ hiện đầu việc thuộc nhóm
  //  cảnh báo và đi qua nhánh này. Nay bảng hiện TOÀN BỘ việc đang chạy qua
  //  `tableItems`, nên nhánh này thành code chết → xoá cho khỏi hiểu nhầm.)

  // ── Chế độ nguồn ĐỘC LẬP (không giới hạn ở nhóm cảnh báo):
  //    • mpOnly: đầu việc của các dự án gắn cờ "Cần cập nhật MP"
  //    • dueThisMonth: đầu việc của các dự án có Mốc bàn giao trong THÁNG NÀY
  //    Hai cờ bật cùng lúc = giao nhau. Các bộ lọc ngữ cảnh khác vẫn áp.
  const curMonthKey = todayIso().slice(0, 7);
  // ── "BÀN GIAO THÁNG NÀY" = dự án CẦN bàn giao xong trong/đến tháng này ──
  //   • Mốc bàn giao trong tháng hiện tại, HOẶC đã quá hạn (tháng trước trở về trước)
  //   • VÀ còn ≥1 công đoạn ĐANG HIỆN (shown) và <100% → dự án còn phải "đẩy" cho xong.
  //   → dự án quá hạn mà chưa xong vẫn phải đẩy tháng này (rule PMO), NHƯNG nếu
  //     đã ẩn HẾT công đoạn (không ai còn làm) thì KHÔNG tính — khớp bảng việc cần xử lý.
  //   Đếm theo mã+tên (mỗi gói riêng). Dự án đã 100% / ẩn hết = bỏ.
  const dueMonthProjectKeys = useMemo(() => {
    const s = new Set<string>();
    for (const p of data.projects) {
      const mk = monthKeyOf(p.deadline);
      if (!mk || mk > curMonthKey) continue;               // chưa tới hạn (tháng sau) → bỏ
      if (!(p.allItems ?? p.items).some(i => i.shown !== false && (i.pctActual ?? 0) < 100)) continue; // xong 100% hoặc ẩn hết → bỏ
      s.add(pkProj(p));
    }
    return s;
  }, [data.projects, curMonthKey]);

  // ── "TOP DỰ ÁN TRỌNG ĐIỂM" = dự án có số Top-20 (cột A) và còn ≥1 công đoạn hiện.
  //   Cơ chế y hệt "Bàn giao tháng này": tập projectKeys để lọc bảng + KPI đếm.
  const topProjectKeys = useMemo(() => {
    const s = new Set<string>();
    for (const p of data.projects) {
      if (p.rank == null) continue;                                    // không thuộc top → bỏ
      if (!(p.allItems ?? p.items).some(i => i.shown !== false)) continue; // ẩn hết → bỏ
      s.add(pkProj(p));
    }
    return s;
  }, [data.projects]);
  // MAP tên (chuẩn hoá) → VÙNG lấy từ file PMP (cột Location của đầu việc). Bảng tuân thủ dùng
  // map này CHỨ KHÔNG lấy cột Location của file tuân thủ (cột đó không tin cậy — vd APEC bị HCM).
  const regionByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of data.projects) {
      const key = normProjName(p.name);
      if (m.get(key)) continue;
      // Tra vùng qua CẢ items + allItems (phòng khi Location chỉ có ở dòng ẩn) — lấy giá trị đầu khác rỗng.
      const reg = [...(p.allItems ?? []), ...(p.items ?? [])].map(i => (i.region ?? "").trim()).find(Boolean);
      if (reg) m.set(key, reg);
    }
    return m;
  }, [data.projects]);

  /* ── FACET COUNT cho 2 nút chế độ (Bàn giao tháng này / Top 20) ──
     Con số trên mỗi nút = số DỰ ÁN (mã+tên) khớp tiêu chí nút đó TRONG ngữ cảnh
     các bộ lọc KHÁC đang bật (kể cả nút chế độ còn lại) → 2 nút "có quan hệ" với
     nhau và phản ánh đúng bảng. Bỏ chính nút đang đếm ra khỏi điều kiện để nó
     luôn hiện tổng khả dụng của mình trong ngữ cảnh hiện tại. */
  const facetItems = useCallback((excludeMode: "due" | "top") => {
    const q = filters.query.trim().toLowerCase();
    return enriched.filter(i => {
      const k = pkItem(i);
      if (filters.mpOnly && !mpProjectKeys.has(k)) return false;
      if (excludeMode !== "due" && filters.dueThisMonth && !dueMonthProjectKeys.has(k)) return false;
      if (excludeMode !== "top" && filters.topKey && !topProjectKeys.has(k)) return false;
      if (filters.depts.length && !filters.depts.includes(i._dept)) return false;
      if (filters.stages.length && !filters.stages.includes(i._stageId)) return false;
      if (filters.alerts.length && !filters.alerts.includes(i._alert as AlertK2)) return false;
      if (filters.regions.length && !filters.regions.includes(i.region ?? "")) return false;
      if (filters.groupDAs.length && !filters.groupDAs.includes(i.groupDA ?? "")) return false;
      if (filters.pms.length && !filters.pms.includes(pmFirstOf(i._projectPm))) return false;
      if (filters.pes.length && !filters.pes.includes(pesOfRank(i.rank))) return false;
      if (filters.deadlineMonths.length) {
        const mk = monthKeyOf(i.projectDeadline);
        const dk = i.projectDeadline ? i.projectDeadline.slice(0, 10) : null;
        const set = filters.deadlineMonths;
        if (!((mk && set.includes(mk)) || (dk && set.includes(dk)) || (!i.projectDeadline && set.includes("none")))) return false;
      }
      if (q) {
        const hay = `${i.projectName} ${i.maCT} ${i._pic} ${i._projectPm} ${i.desc}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [enriched, filters, mpProjectKeys, dueMonthProjectKeys, topProjectKeys]);

  /* ── OPTIONS BỘ LỌC PHÂN TẦNG (cascading) ──
     Mỗi dropdown chỉ liệt kê giá trị THỰC SỰ còn trong bảng theo ngữ cảnh đang lọc.
     "Vũ trụ" = enriched đã áp MỌI filter đang bật TRỪ chính filter đang dựng options
     (để vẫn chọn được nhiều giá trị của cùng 1 nhóm). Tính trên TOÀN BỘ đầu việc đang
     chạy — đúng bằng bảng đang hiện (bảng nay hiện cả việc chưa có cảnh báo). */
  const optionUniverse = useCallback((exclude: "regions" | "groupDAs" | "pms" | "pes" | "deadlineMonths") => {
    const q = filters.query.trim().toLowerCase();
    return enriched.filter(i => {
      if (filters.mpOnly && !mpProjectKeys.has(pkItem(i))) return false;
      if (filters.dueThisMonth && !dueMonthProjectKeys.has(pkItem(i))) return false;
      if (filters.topKey && !topProjectKeys.has(pkItem(i))) return false;
      if (filters.depts.length && !filters.depts.includes(i._dept)) return false;
      if (filters.stages.length && !filters.stages.includes(i._stageId)) return false;
      if (filters.alerts.length && !filters.alerts.includes(i._alert as AlertK2)) return false;
      if (exclude !== "regions" && filters.regions.length && !filters.regions.includes(i.region ?? "")) return false;
      if (exclude !== "groupDAs" && filters.groupDAs.length && !filters.groupDAs.includes(i.groupDA ?? "")) return false;
      if (exclude !== "pms" && filters.pms.length && !filters.pms.includes(pmFirstOf(i._projectPm))) return false;
      if (exclude !== "pes" && filters.pes.length && !filters.pes.includes(pesOfRank(i.rank))) return false;
      if (exclude !== "deadlineMonths" && filters.deadlineMonths.length) {
        const mk = monthKeyOf(i.projectDeadline);
        const dk = i.projectDeadline ? i.projectDeadline.slice(0, 10) : null;
        const set = filters.deadlineMonths;
        if (!((mk && set.includes(mk)) || (dk && set.includes(dk)) || (!i.projectDeadline && set.includes("none")))) return false;
      }
      if (q) {
        const hay = `${i.projectName} ${i.maCT} ${i._pic} ${i._projectPm} ${i.desc}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [enriched, filters, mpProjectKeys, dueMonthProjectKeys, topProjectKeys]);

  /** Danh sách Vùng — chỉ vùng còn trong bảng (union giá trị đang chọn để không mất chip). */
  const regionOptions = useMemo(() => {
    const s = new Set<string>(filters.regions);
    for (const i of optionUniverse("regions")) if (i.region) s.add(i.region);
    return [...s].sort((a, b) => a.localeCompare(b, "vi")).map(r => ({ v: r, l: r }));
  }, [optionUniverse, filters.regions]);

  /** Danh sách Cụm dự án — chỉ cụm còn trong bảng. */
  const groupDAOptions = useMemo(() => {
    const s = new Set<string>(filters.groupDAs);
    for (const i of optionUniverse("groupDAs")) if (i.groupDA) s.add(i.groupDA);
    return [...s].sort((a, b) => a.localeCompare(b, "vi")).map(g => ({ v: g, l: g }));
  }, [optionUniverse, filters.groupDAs]);

  /** Danh sách PM — TÊN ĐẦU TIÊN của Người phụ trách chính cấp dự án, chỉ PM còn dự án trong bảng. */
  const pmOptions = useMemo(() => {
    const s = new Set<string>(filters.pms);
    for (const i of optionUniverse("pms")) { const nm = pmFirstOf(i._projectPm); if (nm && nm !== "—") s.add(nm); }
    return [...s].sort((a, b) => a.localeCompare(b, "vi")).map(p => ({ v: p, l: p }));
  }, [optionUniverse, filters.pms]);

  /** Danh sách PES — chỉ PES (người) còn dự án trong bảng; giữ thứ tự + tên chuẩn. */
  const pesOptions = useMemo(() => {
    const present = new Set<string>(filters.pes);
    for (const i of optionUniverse("pes")) { const a = pesOfRank(i.rank); if (a) present.add(a); }
    return PES_RANGES.filter(a => present.has(a.id)).map(a => ({ v: a.id, l: a.name }));
  }, [optionUniverse, filters.pes]);

  /** Danh sách Mốc bàn giao — chỉ tháng còn trong bảng, kèm số lượng. */
  const deadlineMonthOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let noneCount = 0;
    for (const i of optionUniverse("deadlineMonths")) {
      const mk = monthKeyOf(i.projectDeadline);
      if (!mk) { noneCount++; continue; }
      counts.set(mk, (counts.get(mk) ?? 0) + 1);
    }
    const opts = Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([v, n]) => ({ v, l: `${monthLabelOf(v)} (${n})` }));
    if (noneCount > 0) opts.push({ v: "none", l: `(không có deadline) (${noneCount})` });
    return opts;
  }, [optionUniverse]);

  /* ── NGUỒN CHÍNH CỦA BẢNG ──
     Mặc định (không bật lọc nào) = TOÀN BỘ đầu việc đang chạy: `enriched` vốn đã là
     "đang Show & chưa đạt 100%" (parser lọc sẵn) → hiện ĐỦ mọi dự án còn việc dở,
     kể cả việc CHƯA có cảnh báo. Trước đây mặc định chỉ hiện việc thuộc nhóm cảnh báo
     (đi đường filteredAlerts, bảng phẳng); giờ cảnh báo chỉ còn là BỘ LỌC.
     Các cờ mpOnly / dueThisMonth / topKey chỉ THU HẸP thêm tập này. */
  const tableItems = useMemo<EnrichedItem[]>(() => {
    const q = filters.query.trim().toLowerCase();
    // Bật "Hiện tất cả" → thêm việc ĐÃ HOÀN THÀNH vào NGUỒN BẢNG (lọc y hệt). KPI/databar không đổi.
    return (showDone ? enriched.concat(doneEnriched) : enriched).filter(i => {
      if (filters.mpOnly && !mpProjectKeys.has(pkItem(i))) return false;
      if (filters.dueThisMonth && !dueMonthProjectKeys.has(pkItem(i))) return false;
      if (filters.topKey && !topProjectKeys.has(pkItem(i))) return false;
      if (filters.depts.length && !filters.depts.includes(i._dept)) return false;
      if (filters.stages.length && !filters.stages.includes(i._stageId)) return false;
      if (filters.regions.length && !filters.regions.includes(i.region ?? "")) return false;
      if (filters.groupDAs.length && !filters.groupDAs.includes(i.groupDA ?? "")) return false;
      if (filters.pms.length && !filters.pms.includes(pmFirstOf(i._projectPm))) return false;
      if (filters.pes.length && !filters.pes.includes(pesOfRank(i.rank))) return false;
      if (filters.alerts.length && !filters.alerts.includes(i._alert as AlertK2)) return false;
      if (filters.deadlineMonths.length) {
        const mk = monthKeyOf(i.projectDeadline);
        const dk = i.projectDeadline ? i.projectDeadline.slice(0, 10) : null;
        const set = filters.deadlineMonths;
        const matched =
          (mk && set.includes(mk)) || (dk && set.includes(dk)) ||
          (!i.projectDeadline && set.includes("none"));
        if (!matched) return false;
      }
      if (q) {
        const hay = `${i.projectName} ${i.maCT} ${i._pic} ${i._projectPm} ${i.desc}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [filters, enriched, doneEnriched, showDone, mpProjectKeys, curMonthKey, dueMonthProjectKeys, topProjectKeys]);

  /* ── VŨ TRỤ DỮ LIỆU CHO DATABAR (7 thẻ giai đoạn) ──
     Áp dụng MỌI bộ lọc đang bật TRỪ bộ lọc "Hạng mục" (để luôn hiện đủ 7 cột,
     bấm thẻ nào là lọc bảng theo thẻ đó). Chưa bấm lọc gì → đúng bằng số tổng.
     Bấm lọc (bộ phận / nhóm cảnh báo / mốc bàn giao / tháng này / MP / tìm kiếm)
     → mọi con số + thanh màu của từng thẻ tính lại trên đúng tập đã lọc. */
  const panelActive = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    return enriched.filter(i => {
      if (filters.mpOnly && !mpProjectKeys.has(pkItem(i))) return false;
      if (filters.dueThisMonth && !dueMonthProjectKeys.has(pkItem(i))) return false;
      if (filters.topKey && !topProjectKeys.has(pkItem(i))) return false;
      if (filters.depts.length && !filters.depts.includes(i._dept)) return false;
      if (filters.regions.length && !filters.regions.includes(i.region ?? "")) return false;
      if (filters.groupDAs.length && !filters.groupDAs.includes(i.groupDA ?? "")) return false;
      if (filters.pms.length && !filters.pms.includes(pmFirstOf(i._projectPm))) return false;
      if (filters.pes.length && !filters.pes.includes(pesOfRank(i.rank))) return false;
      if (filters.alerts.length && !filters.alerts.includes(i._alert as AlertK2)) return false;
      if (filters.deadlineMonths.length) {
        const mk = monthKeyOf(i.projectDeadline);
        const dk = i.projectDeadline ? i.projectDeadline.slice(0, 10) : null;
        const set = filters.deadlineMonths;
        const matched =
          (mk && set.includes(mk)) || (dk && set.includes(dk)) ||
          (!i.projectDeadline && set.includes("none"));
        if (!matched) return false;
      }
      if (q) {
        const hay = `${i.projectName} ${i.maCT} ${i._pic} ${i._projectPm} ${i.desc}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [enriched, filters, mpProjectKeys, curMonthKey, dueMonthProjectKeys, topProjectKeys]);

  // Việc ĐÃ HOÀN THÀNH cho databar — áp cùng bộ lọc (trừ nhóm cảnh báo: việc
  // đã xong không thuộc nhóm cảnh báo nào nên khi lọc theo nhóm thì done = 0).
  const panelDoneCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (filters.alerts.length) return m;
    const q = filters.query.trim().toLowerCase();
    for (const p of data.projects) {
      if (filters.mpOnly && !mpProjectKeys.has(pkProj(p))) continue;
      for (const i of p.allItems) {
        if (i.shown === false || (i.pctActual ?? 0) < 100) continue;
        const sid = stageIdOf(i);
        if (filters.depts.length && !filters.depts.includes(deptOf(sid))) continue;
        if (filters.regions.length && !filters.regions.includes(i.region ?? "")) continue;
        if (filters.groupDAs.length && !filters.groupDAs.includes(i.groupDA ?? "")) continue;
        if (filters.pms.length && !filters.pms.includes(pmFirstOf(p.pm))) continue;
        if (filters.pes.length && !filters.pes.includes(pesOfRank(i.rank))) continue;
        if (filters.dueThisMonth && !dueMonthProjectKeys.has(pkItem(i))) continue;
        if (filters.topKey && !topProjectKeys.has(pkItem(i))) continue;
        if (filters.deadlineMonths.length) {
          const mk = monthKeyOf(i.projectDeadline);
          const dk = i.projectDeadline ? i.projectDeadline.slice(0, 10) : null;
          const set = filters.deadlineMonths;
          const matched =
            (mk && set.includes(mk)) || (dk && set.includes(dk)) ||
            (!i.projectDeadline && set.includes("none"));
          if (!matched) continue;
        }
        if (q) {
          const hay = `${i.projectName} ${i.maCT} ${i.owner} ${i.desc}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }
        m.set(sid, (m.get(sid) ?? 0) + 1);
      }
    }
    return m;
  }, [data.projects, filters, mpProjectKeys, curMonthKey, dueMonthProjectKeys, topProjectKeys]);

  // ── Chế độ MP GỘP THEO DỰ ÁN: mỗi dự án 1 dòng (không hiện công đoạn).
  const mpProjectRows = useMemo<MpProjectRow[]>(() => {
    if (!filters.mpOnly) return [];
    const itemsByProj = new Map<string, EnrichedItem[]>();
    for (const i of tableItems) {
      const k = pkItem(i);
      const arr = itemsByProj.get(k) ?? [];
      arr.push(i);
      itemsByProj.set(k, arr);
    }
    return data.projects
      .filter(p => mpProjectKeys.has(pkProj(p)))
      .map(p => {
        const key = pkProj(p);
        const its = itemsByProj.get(key) ?? [];
        return {
          maCT: p.maCT || p.code,
          name: p.name,
          start: p.start,
          deadline: p.deadline,
          pm: p.pm,
          reason: mpInfo.get(key) || p.mpReason || "",
          active: its.length,
          alerts: its.filter(i => i._alert !== "none").length,
        };
      })
      // Không có bộ lọc ngữ cảnh → hiện ĐỦ các dự án gắn cờ.
      // Có bộ lọc (bộ phận/giai đoạn/tháng/tìm kiếm…) → chỉ hiện dự án còn khớp.
      .filter(r => {
        const hasCtx =
          filters.depts.length > 0 || filters.stages.length > 0 || filters.alerts.length > 0 ||
          filters.deadlineMonths.length > 0 || filters.query.trim() !== "" || filters.dueThisMonth;
        return hasCtx ? r.active > 0 : true;
      })
      .sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
  }, [filters, data.projects, tableItems, mpProjectKeys, mpInfo]);

  // ── DỮ LIỆU BIỂU ĐỒ "TỔNG THỂ TIẾN ĐỘ" (Gantt lưới tuần) — 1 dòng/dự án ──
  //    Ăn theo bộ lọc đang bật (qua panelActive: vùng/bộ phận/tháng/tìm kiếm/MP/
  //    tháng này — KHÔNG lọc theo nhóm cảnh báo/hạng mục vì đây là cái nhìn tổng).
  const ganttFlatStages = filters.stages.length > 0;
  // NGUỒN Gantt = panelActive (+ việc ĐÃ HOÀN THÀNH khi bật "Hiện tất cả", lọc CÙNG điều kiện
  // panelActive — trừ hạng mục, vốn panelActive không lọc). KHÔNG đụng panelActive → KPI giữ nguyên.
  const ganttSource = useMemo(() => {
    if (!showDone) return panelActive;
    const q = filters.query.trim().toLowerCase();
    const doneF = doneEnriched.filter(i => {
      if (filters.mpOnly && !mpProjectKeys.has(pkItem(i))) return false;
      if (filters.dueThisMonth && !dueMonthProjectKeys.has(pkItem(i))) return false;
      if (filters.topKey && !topProjectKeys.has(pkItem(i))) return false;
      if (filters.depts.length && !filters.depts.includes(i._dept)) return false;
      if (filters.regions.length && !filters.regions.includes(i.region ?? "")) return false;
      if (filters.groupDAs.length && !filters.groupDAs.includes(i.groupDA ?? "")) return false;
      if (filters.pms.length && !filters.pms.includes(pmFirstOf(i._projectPm))) return false;
      if (filters.pes.length && !filters.pes.includes(pesOfRank(i.rank))) return false;
      if (filters.alerts.length && !filters.alerts.includes(i._alert as AlertK2)) return false;
      if (filters.deadlineMonths.length) {
        const mk = monthKeyOf(i.projectDeadline); const dk = i.projectDeadline ? i.projectDeadline.slice(0, 10) : null;
        if (!((mk && filters.deadlineMonths.includes(mk)) || (dk && filters.deadlineMonths.includes(dk)) || (!i.projectDeadline && filters.deadlineMonths.includes("none")))) return false;
      }
      if (q) { const hay = `${i.projectName} ${i.maCT} ${i._pic} ${i._projectPm} ${i.desc}`.toLowerCase(); if (!hay.includes(q)) return false; }
      return true;
    });
    return [...panelActive, ...doneF];
  }, [showDone, panelActive, doneEnriched, filters, mpProjectKeys, dueMonthProjectKeys, topProjectKeys]);
  const ganttRows = useMemo<GanttRow[]>(() => {
    // CHẾ ĐỘ LỌC HẠNG MỤC (giống bảng "Việc cần xử lý"): bảng PHẲNG — mỗi hạng mục 1 dòng, mô tả
    // = TÊN DỰ ÁN, Mã = viết tắt hạng mục, bar = timeline hạng mục (+ đổ done theo % thực tế).
    // Không gom dự án, không dòng con. Dùng CHÍNH panelActive (đã lọc) nên luật lọc luôn khớp.
    if (ganttFlatStages) {
      // panelActive CỐ Ý bỏ qua lọc Hạng mục (để databar giai đoạn đếm đủ) → ở ĐÂY tự lọc theo
      // filters.stages cho khớp đúng hạng mục đang chọn.
      const flat: GanttRow[] = ganttSource.filter((it) => filters.stages.includes(it._stageId)).map((it) => {
        const pk = pkItem(it);
        return {
          key: `${pk} ${it.rawCode} ${it.dupIdx ?? 0}`,
          updateDate: it.updateDate ?? null,
          maCT: it.maCT || it.projectCode,
          name: it.projectName,
          pm: it._picEdited ? it._pic : picByStageConv(it.owner, it._stageId, it._projectPm),
          start: it.start, end: it.deadline,
          pct: clampPct(it.pctActual),
          sxStart: null, sxEnd: null, sxPct: null,
          overdue: it.overdueDays ?? 0,
          note: "",
          children: [],
          stageAbbr: stageAbbrOf(it._stageId as StageOrOther),
          actualEnd: completedDates[it._key] ?? null,
          hideKey: it._key, hidden: !!it._hidden,
        };
      });
      flat.sort((a, b) => (a.end ?? "9999").localeCompare(b.end ?? "9999") || (a.maCT ?? "").localeCompare(b.maCT ?? "", "vi", { numeric: true, sensitivity: "base" }));
      return flat;
    }
    // TÁC VỤ CON: gom panelActive (đúng tập đầu việc đang hiện ở bảng Danh sách — shown,
    // chưa 100%, đã qua bộ lọc) theo dự án. "Trực quan hoá" các dòng con này thành thanh
    // thời gian trong Gantt, KHÔNG dựng lại luật lọc riêng.
    const childrenByProject = new Map<string, GanttChild[]>();
    for (const it of ganttSource) {
      const pk = pkItem(it);
      let arr = childrenByProject.get(pk);
      if (!arr) { arr = []; childrenByProject.set(pk, arr); }
      const sid = it._stageId as StageOrOther;
      const blockKids: GanttChild[] = (it._blockItems ?? []).map((bit) => ({
        key: `${pk} ${bit.rawCode} ${bit.dupIdx ?? 0}`,
        stageAbbr: bit.rawCode,
        stageLabel: bit.desc,
        pic: bit._picEdited ? bit._pic : picByStageConv(bit.owner, bit._stageId, bit._projectPm),
        start: bit.start, end: bit.deadline,
        color: bit._alertColor,
        overdue: bit.overdueDays ?? 0,
        actual: clampPct(bit.pctActual),
        actualEnd: completedDates[bit._key] ?? null,
        hideKey: bit._key, hidden: !!bit._hidden,
      }));
      arr.push({
        key: `${pk} ${it.rawCode} ${it.dupIdx ?? 0}`,
        stageAbbr: stageAbbrOf(sid),
        stageLabel: it._stageLabel,
        // Người phụ trách công đoạn = ĐÚNG chuỗi bảng Danh sách hiển thị (picByStageConv),
        // KHÔNG dùng _pic thô: hai bên phải là MỘT thông tin cho cùng đầu việc, chỉ khác nhãn
        // cột. (Trước đây _pic thô → ô trống thì Gantt hiện tên PM, Danh sách hiện vai trò → lệch.)
        pic: it._picEdited ? it._pic : picByStageConv(it.owner, it._stageId, it._projectPm),
        start: it.start, end: it.deadline,
        color: it._alertColor,
        overdue: it.overdueDays ?? 0,
        actual: clampPct(it.pctActual),
        actualEnd: completedDates[it._key] ?? null,
        hideKey: it._key, hidden: !!it._hidden,
        blocks: blockKids.length ? blockKids : undefined,
      });
    }
    // Trong mỗi dự án: sắp theo thứ tự giai đoạn (TK→…→TC), rồi theo ngày bắt đầu.
    const stageIdxOf = (ab: string) => stageRankByAbbr(ab);
    for (const arr of childrenByProject.values())
      arr.sort((a, b) => stageIdxOf(a.stageAbbr) - stageIdxOf(b.stageAbbr) || (a.start ?? "9999").localeCompare(b.start ?? "9999"));

    const visKeys = new Set(ganttSource.map(i => pkItem(i)));
    const rows: GanttRow[] = [];
    for (const p of data.projects) {
      const pk = pkProj(p);
      if (!visKeys.has(pk)) continue;
      const all = p.allItems ?? p.items;
      const pcts = all.map(it => clampPct(it.pctActual)).filter((v): v is number => v != null);
      const pct = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;
      const sx = all.find(it => stageIdOf(it) === "SX");
      const overdue = p.deadline && p.deadline.slice(0, 10) < today && (pct ?? 0) < 100
        ? Math.max(0, getDaysOverdue({ deadline: p.deadline, pctActual: pct }, today) ?? 0)
        : 0;
      rows.push({
        key: pk, updateDate: p.updateDate ?? null, maCT: p.maCT || p.code, name: p.name, pm: p.pm,
        start: p.start, end: p.deadline, pct,
        sxStart: sx?.start ?? null, sxEnd: sx?.deadline ?? null, sxPct: sx ? clampPct(sx.pctActual) : null,
        overdue, note: edits[pk]?.note || p.mpReason || "",
        children: childrenByProject.get(pk) ?? [],
      });
    }
    rows.sort((a, b) => (a.end ?? "9999").localeCompare(b.end ?? "9999") || (a.maCT ?? "").localeCompare(b.maCT ?? "", "vi", { numeric: true, sensitivity: "base" }));
    return rows;
  }, [data.projects, ganttSource, edits, today, ganttFlatStages, filters.stages, completedDates]);

  // ── TỰ KIỂM CHỨNG ──
  const audit = useMemo(
    () => auditFilterResult(effectiveItems, matcher, criteriaTable, th, filterResult),
    [effectiveItems, matcher, criteriaTable, th, filterResult],
  );
  useEffect(() => {
    if (!audit.ok) {
      // eslint-disable-next-line no-console
      console.error(
        `[filter-audit] ${audit.message}`,
        { unjustified: audit.unjustified, missed: audit.missed, thresholds, filters },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audit]);

  /* ── SẮP XẾP ĐA CỘT ──
     Click cột: cột đó thành khoá CHÍNH (desc → click lại: asc → click lần 3: bỏ);
     các cột đã chọn trước đó tự thành khoá phụ (giữ tối đa 3 khoá).
     Sau chuỗi người dùng chọn, LUÔN áp thêm tie-break chuẩn (Bàn giao → Tên dự án
     → Mã CT → Hạng mục → Ngày bắt đầu) để các dòng cùng giá trị đứng cạnh nhau
     theo thứ tự hợp lý — VD cùng bàn giao 15/07 thì A A A B B B C C C. */
  const [sortChain, setSortChain] = useState<SortSpec[]>([{ key: "projectDeadline", dir: "asc" }]);
  // F7 — NHỚ bộ lọc + sắp xếp qua reload/mở lại (localStorage). Đọc SAU khi mount để KHÔNG lệch
  // hydration SSR (server render mặc định; client khôi phục sau). Ghi mỗi khi đổi. Không đụng visual.
  const [viewRestored, setViewRestored] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("pmo.master.view.v1");
      if (raw) {
        const v = JSON.parse(raw) as { filters?: Partial<Filters>; sortChain?: SortSpec[] };
        if (v.filters) setFilters((f) => ({ ...EMPTY_FILTERS, ...f, ...v.filters }));
        if (Array.isArray(v.sortChain) && v.sortChain.length) setSortChain(v.sortChain);
      }
    } catch { /* localStorage chặn / JSON hỏng → dùng mặc định */ }
    setViewRestored(true);
  }, []);
  useEffect(() => {
    if (!viewRestored) return; // chưa khôi phục xong thì đừng ghi đè bằng mặc định
    try { localStorage.setItem("pmo.master.view.v1", JSON.stringify({ filters, sortChain })); } catch { /* */ }
  }, [filters, sortChain, viewRestored]);
  const toggleSort = (k: SortKey) => {
    setSortChain(prev => {
      const idx = prev.findIndex(s => s.key === k);
      if (idx === 0) {
        // Đang là khoá chính: desc → asc → bỏ khỏi chuỗi
        if (prev[0].dir === "desc") return [{ key: k, dir: "asc" as const }, ...prev.slice(1)];
        return prev.slice(1);
      }
      const rest = prev.filter(s => s.key !== k);
      return [{ key: k, dir: "desc" as const }, ...rest].slice(0, 3);
    });
  };

  // Nguồn bảng = TOÀN BỘ đầu việc đang chạy đã qua bộ lọc (xem tableItems).
  // Không còn nhánh "chỉ hiện việc cảnh báo" — cảnh báo giờ chỉ là 1 bộ lọc.
  const baseTableItems: EnrichedItem[] = tableItems;

  const sortedAlerts = useMemo(() => {
    if (sortChain.length === 0) return baseTableItems; // thứ tự mặc định theo mức nghiêm trọng
    const dKey = (iso: string | null | undefined) =>
      iso ? new Date(iso.slice(0, 10) + "T00:00:00Z").getTime() : null;
    const getVal = (it: EnrichedItem, key: SortKey): number | string | null => {
      switch (key) {
        case "list": {
          // Sắp xếp Hạng mục theo ĐÚNG thứ tự giai đoạn (không theo abc). Dùng thứ tự theo VIẾT TẮT
          // để "SD" (Shop Drawing) đứng TRƯỚC "TKSX".
          return stageRankByAbbr(stageAbbrOf(it._stageId));
        }
        case "updateDate":      return dKey(it.updateDate);
        case "maCT":            return it.maCT || "";
        case "name":            return it.projectName || "";
        case "projectDeadline": return dKey(it.projectDeadline);
        case "pic":             return it._pic || "";
        case "start":           return dKey(it.start);
        case "finish":          return dKey(it.deadline);
        case "planPct":         return it._planDyn ?? null;
        case "actualPct":       return it.pctActual ?? null;
        case "overdue":         return it.overdueDays ?? 0;
        case "alert": {
          // Xếp theo MỨC NGHIÊM TRỌNG giảm dần, GOM THEO MÀU (đỏ trước vàng). Bấm cột lần đầu =
          // desc (giá trị cao trước) ⇒ Trễ tiến độ → Cắt đầu việc (đỏ) → Cần tập trung (đỏ) →
          //   Cắt đầu việc (vàng) → Cần tập trung (vàng) → Không vấn đề → Đã hoàn thành;
          //   bấm lần 2 = asc = chiều ngược. "Trễ tiến độ" luôn đỏ nên là 1 mức trên cùng.
          // "Đã hoàn thành" (≥100%) xuống CUỐI — bám theo ĐÚNG badge hiển thị (badge xanh ưu tiên
          // hơn _alert ở renderRow), nên xét mốc 100% TRƯỚC khi tra _alert.
          const done = it.pctActual != null && Math.round(it.pctActual) >= 100;
          if (done) return 0;
          const red = it._alertColor === "red";
          if (it._alert === "late") return 7;
          if (it._alert === "trim") return red ? 6 : 4;
          if (it._alert === "focus") return red ? 5 : 3;
          return 1; // không vấn đề (chưa hoàn thành)
        }
        case "note":            return (it.note || "").trim().toLowerCase();
        case "action":          return (it._action || "").trim().toLowerCase();
        default:                return null;
      }
    };
    // Chuỗi so sánh = khoá người dùng chọn + tie-break chuẩn (bỏ khoá trùng).
    // TIE-BREAK CHUẨN: cùng NGÀY KẾT THÚC → theo MÃ CT (CT25-055 trước CT25-070) rồi mới tới tên.
    const CANON: SortSpec[] = [
      { key: "projectDeadline", dir: "asc" },
      { key: "maCT", dir: "asc" },
      { key: "name", dir: "asc" },
      { key: "list", dir: "asc" },
      { key: "start", dir: "asc" },
    ];
    const chain: SortSpec[] = [
      ...sortChain,
      ...CANON.filter(c => !sortChain.some(s => s.key === c.key)),
    ];
    const arr = [...baseTableItems];
    arr.sort((a, b) => {
      for (const spec of chain) {
        const va = getVal(a, spec.key);
        const vb = getVal(b, spec.key);
        if (va == null && vb == null) continue;
        if (va == null) return 1;  // null luôn xuống cuối
        if (vb == null) return -1;
        let cmp = 0;
        if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
        else cmp = String(va).localeCompare(String(vb), "vi", { sensitivity: "base", numeric: true });
        if (cmp !== 0) return spec.dir === "desc" ? -cmp : cmp;
      }
      // Hết mọi khoá vẫn bằng nhau → trễ nặng trước
      return (b.overdueDays ?? 0) - (a.overdueDays ?? 0);
    });
    return arr;
  }, [baseTableItems, sortChain]);

  /* ── GỘP THEO DỰ ÁN, sổ ra công đoạn (như PMP) — cách hiển thị MẶC ĐỊNH của bảng.
        Chỉ trừ chế độ MP (bảng MP có bố cục gộp riêng).

     THỨ TỰ LẤY TRỰC TIẾP TỪ `sortedAlerts` — KHÔNG tự sort lần nữa ở đây:
       · Thứ tự dự án  = thứ tự dự án XUẤT HIỆN LẦN ĐẦU trong mảng đã sort.
       · Thứ tự việc con = đúng thứ tự tương đối của chúng trong mảng đã sort.
     Vì sao phải vậy: trước đây khối này sort cứng theo (Bàn giao → Tên) và deps KHÔNG
     có sortChain, trong khi chế độ gộp render từ `groups` chứ không phải `items` ⇒ bấm
     tiêu đề cột không đổi được gì. Sort chỉ chạy ở bảng phẳng (khi lọc Giai đoạn).
     Viết luật sort thứ hai ở đây sẽ lại lệch với bảng phẳng — nên dùng chung một bộ
     so sánh duy nhất ở `sortedAlerts`.

     Mặc định (sortChain = Bàn giao ↑) cho ra ĐÚNG thứ tự cũ: bộ so sánh có tie-break
     chuẩn Bàn giao → Tên → Mã CT → Hạng mục → Ngày bắt đầu, tức dự án vẫn theo
     (Bàn giao, Tên) và việc con vẫn theo (giai đoạn, ngày bắt đầu). Màn hình không đổi,
     chỉ khác là giờ bấm cột mới có tác dụng. */
  const dueMonthGroups = useMemo<DueMonthGroup[]>(() => {
    const byKey = new Map<string, DueMonthGroup>();
    for (const it of sortedAlerts) {
      const key = pkItem(it);
      let g = byKey.get(key);
      if (!g) { const ped = edits[key]; g = { key, maCT: it.maCT || it.projectCode, name: it.projectName, start: it.projectStart ?? null, deadline: it.projectDeadline, pm: it._projectPm || "—", updateDate: it.updateDate ?? null, delivered: !!it.projectDelivered, items: [], note: visibleText(ped?.noteMsgs), action: visibleText(ped?.actionMsgs), noteMsgs: ped?.noteMsgs ?? [], actionMsgs: ped?.actionMsgs ?? [], editedAt: ped?.updatedAt ?? null }; byKey.set(key, g); }
      // Dự phòng: nếu dòng cha KHÔNG có ngày Bắt đầu → lấy ngày bắt đầu SỚM NHẤT của công đoạn con.
      if (!it.projectStart && it.start && (!g.start || it.start < g.start)) g.start = it.start;
      g.items.push(it);
    }
    return [...byKey.values()];
  }, [filters.mpOnly, sortedAlerts, edits]);

  // Audit → toast (góc dưới trái, tự ẩn)
  const auditSig = useRef<string>("");
  useEffect(() => {
    const sig = `${audit.ok}|${audit.message}`;
    if (sig === auditSig.current) return;
    auditSig.current = sig;
    if (audit.ok) {
      toast.success(audit.message, { position: "bottom-left", duration: 4000 });
    } else {
      const extra = [...audit.unjustified, ...audit.missed].slice(0, 5).join(" · ");
      toast.error(audit.message + (extra ? `: ${extra}` : ""), { position: "bottom-left", duration: 4000 });
    }
  }, [audit]);


  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (filters.depts.length) parts.push(`Bộ phận: ${filters.depts.join(", ")}`);
    if (filters.stages.length) parts.push(`Giai đoạn: ${filters.stages.map(stageLabelOf).join(", ")}`);
    if (filters.alerts.length) parts.push(`Nhóm: ${filters.alerts.map(a => ALERT_FULL_NAME[a]).join(", ")}`);
    if (filters.deadlineMonths.length) parts.push(`Mốc bàn giao: ${filters.deadlineMonths.map(monthLabelOf).join(", ")}`);
    if (filters.regions.length) parts.push(`Vùng: ${filters.regions.join(", ")}`);
    if (filters.groupDAs.length) parts.push(`Cụm dự án: ${filters.groupDAs.join(", ")}`);
    if (filters.pms.length) parts.push(`PM: ${filters.pms.join(", ")}`);
    if (filters.pes.length) parts.push(`PES: ${filters.pes.map(id => PES_RANGES.find(a => a.id === id)?.name ?? id).join(", ")}`);
    if (filters.mpOnly) parts.push("Cần cập nhật MP");
    if (filters.dueThisMonth) parts.push("Bàn giao tháng này");
    if (filters.topKey) parts.push("Top 20");
    if (filters.query.trim()) parts.push(`Tìm: "${filters.query.trim()}"`);
    return parts.length ? parts.join("  ·  ") : "Toàn bộ (không lọc)";
  }, [filters]);

  // NGUỒN DUY NHẤT cho PDF = mảng đang render bảng (sortedAlerts).
  const printLateCount = sortedAlerts.filter(i => i._alert === "late").length;
  const printTrimCount = sortedAlerts.filter(i => i._alert === "trim").length;

  const printFocusCount = sortedAlerts.filter(i => i._alert === "focus").length;

  // Thẻ "Bàn giao tháng này": số DỰ ÁN có mốc bàn giao trong tháng hiện tại — con
  // số toàn cục, bấm để bật/tắt lọc. Đếm theo data.projects: mỗi GÓI (mã + tên) là
  // 1 dòng riêng nên gói CÙNG MÃ KHÁC TÊN được tính TÁCH (không gộp theo mã). Chỉ
  // cần dự án còn "hiện hành" (≥1 công đoạn Show) — KHÔNG loại dự án đã gần xong
  // (mọi công đoạn đã 100%/ẩn) vì nó vẫn bàn giao trong tháng.
  const dueMonthProjectCount = useMemo(() => {
    const ks = new Set<string>();
    for (const i of facetItems("due")) { const k = pkItem(i); if (dueMonthProjectKeys.has(k)) ks.add(k); }
    return ks.size;
  }, [facetItems, dueMonthProjectKeys]);
  const topProjectCount = useMemo(() => {
    const ks = new Set<string>();
    for (const i of facetItems("top")) { const k = pkItem(i); if (topProjectKeys.has(k)) ks.add(k); }
    return ks.size;
  }, [facetItems, topProjectKeys]);

  /* ── BÁO CÁO TUÂN THỦ CẬP NHẬT — theo THÁNG hiện tại. Không ăn theo bộ lọc: đây là
        báo cáo đánh giá PM trên TOÀN BỘ dự án đang chạy. ── */
  const [showCompliance, setShowCompliance] = useState(false);
  /* File nguồn tuân thủ RIÊNG (✔/o/x đã điền sẵn) — tải LAZY khi mở dialog. App chỉ chấm điểm,
     mọi data ✔/o/x + vùng + PM + lũy kế lấy thẳng từ file này. Xem lib/compliance-file.ts. */
  const complianceFileQuery = useQuery({
    queryKey: ["complianceFile"],
    queryFn: async (): Promise<ComplianceFileData> => {
      const r = await fetchSheetCsv({ data: { url: COMPLIANCE_FILE_URL } });
      return parseComplianceFile(r.text);
    },
    enabled: showCompliance,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const complianceReport = useMemo(() => {
    const inputs = data.projects
      .filter(p => (p.allItems ?? p.items).some(i => i.shown !== false))
      .map(p => {
        // Chất lượng Master Plan chấm trên ĐẦU VIỆC ĐANG QUẢN = đang Show và CHƯA xong 100%.
        // (Đầu việc đã 100% thì thiếu định lượng/ngày không còn ý nghĩa để nhắc.)
        const active = (p.allItems ?? p.items ?? [])
          .filter(i => i.shown !== false && !(i.pctActual != null && i.pctActual >= 100));
        const missingQuant = active.filter(i => i.pctPlan == null || i.pctPlanInvalid || i.pctActual == null || i.pctActualInvalid).length;
        const missingDates = active.filter(i => !i.start || !i.deadline).length;
        const missingPic = active.filter(i => { const o = (i.owner ?? "").trim(); return o === "" || o === "—"; }).length;
        return {
          key: pkProj(p),
          maCT: p.maCT || p.code,
          name: p.name,
          pm: p.pm || "—",
          dpm: p.dpm ?? "",
          updateDate: p.updateDate ?? null,
          quality: { active: active.length, missingQuant, missingDates, missingPic },
        };
      });
    return buildComplianceReport(inputs, updateHistory, today.slice(0, 7), today);
  }, [data.projects, updateHistory, today]);

  // Thẻ KPI chạy theo BỘ LỌC: số dự án = đếm Mã CT không trùng trong bảng
  // hiện tại; trễ/cắt/quá hạn = đếm trực tiếp từ các dòng đang hiển thị.
  // KHÔNG lọc gì → hiện TOÀN BỘ dự án đang Show (parser đã loại dự án
  // không có dòng con nào — activeProjects lọc allItems.length > 0).
  const hasAnyFilter =
    filters.depts.length > 0 || filters.stages.length > 0 || filters.alerts.length > 0 ||
    filters.deadlineMonths.length > 0 || filters.regions.length > 0 || filters.groupDAs.length > 0 ||
    filters.pms.length > 0 || filters.pes.length > 0 || filters.query.trim() !== "" || filters.mpOnly ||
    filters.dueThisMonth || filters.topKey;
  // Dự án HIỆN HÀNH = có ≥1 dòng con ĐANG SHOW. Dự án mà mọi dòng con đều Hide
  // (để tạm chờ ẩn / đã dừng / đã xong) KHÔNG tính vào tổng.
  const activeProjectCount = useMemo(
    () => data.projects.filter(p => (p.allItems ?? p.items).some(i => i.shown !== false)).length,
    [data.projects],
  );
  const tableProjectCount = useMemo(() => {
    if (filters.mpOnly) return mpProjectRows.length; // chế độ gộp: đếm dòng dự án
    // ĐẾM THEO MÃ+TÊN: dự án cùng mã CT nhưng khác tên = dự án khác nhau (không gộp theo mã).
    return hasAnyFilter
      ? new Set(sortedAlerts.map(i => pkItem(i))).size
      : activeProjectCount;
  }, [filters.mpOnly, mpProjectRows.length, hasAnyFilter, sortedAlerts, activeProjectCount]);

  // Stage counts — từ panelActive (cùng vũ trụ dữ liệu với databar).
  const stageBreakdown = useMemo(() => {
    return STAGE_ORDER.map(sid => {
      const arr = panelActive.filter(i => i._stageId === sid);
      return {
        sid,
        name: STAGE_META[sid].label,
        late: arr.filter(i => i._alert === "late").length,
        trim: arr.filter(i => i._alert === "trim").length,
        focus: arr.filter(i => i._alert === "focus").length,
      };
    });
  }, [panelActive]);
  void stageBreakdown;

  /** XUẤT PDF = chụp đúng giao diện đang hiển thị (KPI + thẻ giai đoạn + bảng)
   *  và tự dựng file A4 ngang — không qua hộp thoại in, không phụ thuộc máy. */
  const doPrint = async (orientation: "landscape" | "portrait", mode: "download" | "preview" = "download") => {
    const isPortrait = orientation === "portrait";
    const isPreview = mode === "preview";
    const tid = toast.loading(isPreview ? "Đang dựng PDF để xem trước…" : `Đang tạo PDF ${isPortrait ? "khổ DỌC" : "khổ ngang"} từ giao diện…`, { position: "bottom-left" });
    try {
      const { exportDashboardPdf } = await loadSplit(() => import("@/lib/pdf-export"));
      const blocks = [
        document.getElementById("pdf-kpi"),
        document.getElementById("pdf-stages"),
      ].filter((el): el is HTMLElement => !!el);
      // Xuất ĐÚNG bảng đang xem: "Việc cần xử lý" (#pdf-table) hoặc "Tổng thể tiến độ"
      // (#pdf-gantt) — chỉ 1 trong 2 tồn tại trong DOM tuỳ chế độ đang chọn. Cả hai đều
      // đã đi qua bộ lọc nên PDF luôn khớp những gì đang hiển thị.
      const listTbl = document.getElementById("pdf-table") as HTMLTableElement | null;
      const ganttTbl = document.getElementById("pdf-gantt") as HTMLTableElement | null;
      const table = listTbl ?? ganttTbl;
      if (!table) throw new Error("Không tìm thấy bảng để xuất.");
      const isGantt = !listTbl && !!ganttTbl;
      const fileName = `${isGantt ? "TongTheTienDo" : "BaoCao_TienDo"}_${isPortrait ? "Doc" : "Ngang"}_${today.replace(/-/g, "")}.pdf`;
      const { pages, blobUrl } = await exportDashboardPdf({
        title: document.getElementById("pdf-title"),
        blocks,
        table,
        // Bảng Danh sách: ÉP bề rộng cố định (PDF_TABLE_WIDTH) → PDF ỔN ĐỊNH trên MỌI màn hình (không
        // phụ thuộc cửa sổ rộng/hẹp → không bị "20 trang khi màn hẹp"). Vẫn giữ ĐÚNG tỉ lệ cột người
        // dùng kéo (colW là %). Gantt (isGantt) mới giữ bề rộng thật vì lưới tuần không được bóp méo.
        wide: isGantt,
        orientation,
        preview: isPreview,
        fileName,
      });
      track("export_pdf", `${isPreview ? "XEM TRƯỚC · " : ""}${isPortrait ? "DỌC" : "Ngang"} · Bảng ${isGantt ? "Tổng thể tiến độ" : "Việc cần xử lý"} · Lọc: ${filterSummary} · ${sortedAlerts.length} đầu việc`.slice(0, 300));
      if (isPreview && blobUrl) { setPdfPreview({ url: blobUrl, name: fileName }); toast.success(`Đã dựng PDF (${pages} trang) — soát rồi Tải xuống / In`); }
      else toast.success(`Đã tạo PDF ${isPortrait ? "khổ dọc" : "khổ ngang"} (${pages} trang), đúng như giao diện đang xem`);
    } catch (e) {
      toast.error(`Tạo PDF lỗi: ${(e as Error).message}`);
    } finally {
      toast.dismiss(tid);
    }
  };
  // XEM TRƯỚC PDF (dashboard) — blob hiện trong iframe, chưa tải.
  const [pdfPreview, setPdfPreview] = useState<{ url: string; name: string } | null>(null);

  /* SỬA LỆCH STT do CHÈN DỰ ÁN (ADMIN, chạy 1 lần) — chèn 1 dự án ở STT 11 làm khoá id:STT≥11 dồn lệch.
     Bấm → DRY-RUN (đếm + xem trước) → toast "Áp dụng" → dời `id:N→id:N+1` (N≥11) cho cả 4 kho, ghi audit log. */
  // ── "SỬA LỆCH STT" — khi CHÈN 1 dự án vào giữa, STT các dự án phía sau dồn (+delta) làm khoá
  // id:STT lệch. Admin tự chọn "chèn ở STT nào" + "dịch mấy bậc" (mặc định 11/+1) → dùng được cho
  // MỌI đợt chèn sau này. HIỆN THẲNG bảng chẩn đoán "sửa cái gì" (đọc là biết), không toast chớp.
  // Tag chống-dời-2-lần: giữ NGUYÊN tag lịch sử cho đợt 11/+1; đợt khác sinh tag riêng theo tham số.
  const shiftTagFor = (from: number, delta: number) => (from === 11 && delta === 1) ? "insert-11-terramare" : `insert-${from}-d${delta}`;
  const [shiftDiag, setShiftDiag] = useState<ShiftDiag>({ status: "idle" });
  // Dựng danh sách "lệch ở đâu" từ kho ghi chú client: id:N[.sub], N≥from → nhầm ở [STT N] → về [STT N+delta].
  const buildShiftMoves = (from: number, delta: number): ShiftMove[] => {
    const nameByStt = new Map<string, string>();
    for (const p of data.projects) if (p.id) nameByStt.set(p.id.trim(), p.name);
    const projName = (stt: number) => nameByStt.get(String(stt)) || `STT ${stt}`;
    const moves: ShiftMove[] = [];
    for (const [k, v] of Object.entries(edits)) {
      const m = /^id:(\d+)(.*)$/s.exec(k);
      if (!m) continue;
      const n = parseInt(m[1], 10);
      if (n < from) continue;
      const text = (visibleText(v.noteMsgs) || visibleText(v.actionMsgs) || "(ghi chú)").replace(/\s+/g, " ").trim().slice(0, 100);
      moves.push({ from: projName(n), to: projName(n + delta), text });
    }
    return moves;
  };
  const loadShiftDiag = (from: number, delta: number) => {
    setShiftDiag({ status: "loading" });
    void (async () => {
      try {
        const dry = await remapInsertShift({ data: { from, delta, tag: shiftTagFor(from, delta), dryRun: true } });
        setShiftDiag({ status: "ready", from, delta, already: !!dry.already, moved: dry.moved ?? 0, breakdown: dry.breakdown, moves: buildShiftMoves(from, delta) });
      } catch (e) { setShiftDiag({ status: "error", error: (e as Error).message }); }
    })();
  };
  const applyShiftDiag = (from: number, delta: number) => {
    const moves = buildShiftMoves(from, delta);
    void (async () => {
      try {
        const r = await remapInsertShift({ data: { from, delta, tag: shiftTagFor(from, delta), dryRun: false } });
        if (r.skipped) { toast("Đã chạy trước đó — bỏ qua."); setShiftDiag({ status: "ready", from, delta, already: true, moved: 0, breakdown: r.breakdown, moves: [] }); return; }
        const rb = r.breakdown;
        track("remap_shift", `SỬA LỆCH STT (chèn dự án ở ${from}): dời ${r.moved} khoá +${delta} cho STT≥${from} — vướng mắc/giải pháp ${rb.edits}, ngày ${rb.completed}, update ${rb.updates}, cờ MP ${rb.mpflag}`);
        for (const mv of moves.slice(0, 120)) track("remap_shift_detail", `Ghi chú “${mv.text}” đang nhầm ở [${mv.from}] → dời về [${mv.to}]`);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["edits"] }),
          queryClient.invalidateQueries({ queryKey: ["completedDates"] }),
          queryClient.invalidateQueries({ queryKey: ["updateHistory"] }),
          queryClient.invalidateQueries({ queryKey: ["mpFlags"] }),
        ]);
        setShiftDiag({ status: "applied", moved: r.moved, moves });
        toast.success(`Đã dời ${r.moved} khoá về đúng dự án. Chi tiết đã ghi vào Nhật ký giám sát.`);
      } catch (e) { toast.error(`Áp dụng lỗi: ${(e as Error).message}`); }
    })();
  };

  // ── PHÂN CẤP: bảng email→cấp (KV) cấp qua RolesCtx cho RoleBadge. Rỗng → DEFAULT_ROLES. ──
  const rolesQuery = useQuery({
    queryKey: ["userRoles"],
    queryFn: async (): Promise<Record<string, UserRole>> => (await fetchUserRoles()).roles ?? {},
    staleTime: 60_000,
  });
  const roleMap = useMemo(() => {
    const kv = rolesQuery.data ?? {};
    return Object.keys(kv).length ? kv : DEFAULT_ROLES;
  }, [rolesQuery.data]);
  const [showRoles, setShowRoles] = useState(false);
  const [showDataQ, setShowDataQ] = useState(false);
  // Cảnh báo chất lượng dữ liệu (STT trùng/trống…) — KHÔNG bày ngoài trang; rút vào menu "Hệ thống"
  // cho PMO xem (chỉ hiện khi có cảnh báo + là admin/PMO). Đếm số mục ≠ ok để gắn badge.
  const dataQualityBad = useMemo(() => (data.quality?.checks ?? []).filter((c) => c.level !== "ok"), [data.quality]);
  const canSeeSystem = me.isAdmin || roleOf(roleMap, me.email ?? "") === "PMO";

  return (
    <RolesCtx.Provider value={roleMap}>
    <div className="flex flex-col gap-2 print:min-h-0" style={{ minHeight: "calc(100vh - 130px)" }}>

      {/* (Đã BỎ banner "note bị trôi" khỏi màn hình chính — gây hoang mang. Việc rà/sửa note trôi vẫn nằm
          trong menu "Hệ thống" → Công cụ dữ liệu (có badge số lượng), KHÔNG đẩy cảnh báo ra ngoài nữa.) */}

      {showRoles && <RoleManagerDialog roleMap={roleMap} onClose={() => setShowRoles(false)}
        onSaved={(m) => queryClient.setQueryData(["userRoles"], m)} />}
      {showCompliance && <ComplianceDialog
        data={complianceFileQuery.data}
        loading={complianceFileQuery.isLoading}
        error={complianceFileQuery.error as Error | null}
        regionByName={regionByName}
        mpWeeksByName={mpWeeksByName}
        mpFlaggedNames={mpFlaggedNames}
        mpDeadlineByName={mpDeadlineByName}
        today={today}
        canManage={canSeeSystem}
        canEdit={me.isAdmin}
        onRetry={() => complianceFileQuery.refetch()}
        onClose={() => setShowCompliance(false)} />}
      {showActivity && <ActivityLogDialog onClose={() => setShowActivity(false)} />}
      {summaryTarget && <SummaryDialog fileId={summaryTarget.fileId} initSheet={summaryTarget.sheet} initRange={summaryTarget.range} initTl={summaryTarget.tl} initBr={summaryTarget.br} initSnap={summaryTarget.snap} initSnapKey={summaryTarget.snapKey} initChart={summaryTarget.chart} initName={summaryTarget.name} canEdit={canSeeSystem} onClose={() => setSummaryTarget(null)} />}
      {linkSetup && <LinkSetupDialog projKey={linkSetup.key} projName={linkSetup.name} initCfg={linkSetup.cfg} onClose={() => setLinkSetup(null)} onSaved={() => void sheetViewsQuery.refetch()} />}
      {imgView && <ProjImageDialog imgKey={imgView.key} name={imgView.name} onClose={() => setImgView(null)} />}
      {imgSetup && <ProjImageSetupDialog projKey={imgSetup.key} projName={imgSetup.name} projHid={imgSetup.hid} count={projImgIdx[imgSetup.key]?.n ?? 0} canManage={canSeeSystem} onClose={() => setImgSetup(null)} onSaved={() => void projImgIdxQuery.refetch()} />}

      {/* Tính năng HỆ THỐNG (đánh giá tuân thủ + nhật ký giám sát) render lên GÓC HEADER
          qua portal, không nằm cạnh bảng. State/dialog vẫn ở đây; menu chỉ đổi chỗ hiển thị. */}
      <HeaderSlot>
        <ReportsMenu
          showCompliance={ff.compliance}
          complianceBadge={complianceReport.duAnTong - complianceReport.duAnDungHan}
          onOpenCompliance={() => { setShowCompliance(true); track("open_compliance"); }}
          isAdmin={me.isAdmin}
          onOpenActivity={() => { setShowActivity(true); track("open_activity"); }}
          onOpenRoles={() => { setShowRoles(true); track("open_roles"); }}
          qualityIssues={dataQualityBad.length + noteDrift.length}
          onOpenDataTools={me.isAdmin ? () => { setShowDataQ(true); track("open_datatools"); } : undefined}
          onOpenSource={me.isAdmin ? () => { onOpenSource(); track("open_source"); } : undefined}
          tvMode={tvMode}
          onToggleTv={toggleTvMode}
        />
      </HeaderSlot>

      {showDataQ && <AdminDataToolsDialog checks={dataQualityBad} qualityStats={data?.quality?.stats} drift={noteDrift} onAckDrift={ackDrift} onFixDrift={fixDriftTo} onFixAllDrift={fixAllDrift} audit={auditDrift} auditLoading={auditMapQuery.isLoading} onFixAudit={applyAuditOne} onFixAuditAll={applyAuditAll} shiftDiag={shiftDiag} onLoadShift={loadShiftDiag} onApplyShift={applyShiftDiag} onClose={() => { setShowDataQ(false); setShiftDiag({ status: "idle" }); }} />}
      {pdfPreview && <PdfPreviewDialog url={pdfPreview.url} fileName={pdfPreview.name} onClose={() => setPdfPreview(null)} />}

      <OverviewStrip
        projectCount={tableProjectCount}
        lateCount={printLateCount}
        trimCount={printTrimCount}
        focusCount={printFocusCount}
        dueMonthCount={dueMonthProjectCount}
        dueMonthActive={filters.dueThisMonth}
        onPickDueMonth={() => setFilters(f => ({ ...f, dueThisMonth: !f.dueThisMonth }))}
        topCount={topProjectCount}
        topActive={filters.topKey}
        onPickTop={() => setFilters(f => ({ ...f, topKey: !f.topKey }))}
        suspectCount={suspectCount}
        activeAlerts={filters.alerts}
        onPickKpi={pickKpi}
      />
      <StageBarsPanel
        active={panelActive}
        doneCounts={panelDoneCounts}
        activeStages={filters.stages}
        onPick={(sid) => setFilters(f => ({ ...f, stages: toggleIn(f.stages, sid as StageOrOther) }))}
      />
      <FlatTablePanel
        items={sortedAlerts}
        mpMode={filters.mpOnly}
        mpProjectRows={mpProjectRows}
        groupMode={filters.stages.length === 0}
        groups={dueMonthGroups}
        totalAlertsCount={alerts.length}
        deadlineMonthOptions={deadlineMonthOptions}
        regionOptions={regionOptions}
        groupDAOptions={groupDAOptions}
        pmOptions={pmOptions}
        pesOptions={pesOptions}
        showGanttChildTasks={ff.ganttChildTasks}
        ganttRows={ganttRows}
        today={today}
        isAdmin={me.isAdmin}
        myEmail={me.email}
        installLinks={installLinks}
        onOpenSummary={setSummaryTarget}
        sheetViews={sheetViews}
        canSetupLink={canSeeSystem}
        onSetupLink={(key, name, cfg) => setLinkSetup({ key, name, cfg })}
        projImgIdx={projImgIdx}
        onOpenImage={(key, name) => setImgView({ key, name })}
        onOpenVideo={(name) => window.dispatchEvent(new CustomEvent("epmp:open-app", { detail: { app: "media", project: name } }))}
        onSetupImage={(key, name, hid) => setImgSetup({ key, name, hid })}
        onExportReport={handleExportReport}
        onExportPdf={handleExportPdf}
        filters={filters}
        setFilters={setFilters}
        sortChain={sortChain}
        onSort={toggleSort}
        showDone={showDone}
        onToggleDone={() => setShowDone(v => !v)}
        showHidden={showHidden}
        onToggleShowHidden={() => setShowHidden(v => !v)}
        hiddenCount={hiddenKeys.size}
        onHideRow={onHideRow}
        completedDates={completedDates}
        onMsgOp={msgOp}
        onPrint={(o, mode) => { void doPrint(o, mode); }}
        onExportExcel={async () => {
          // XUẤT EXCEL "Y HỆT BẢNG/PDF": cùng cột + dòng gộp dự án (xổ công đoạn con) + màu trạng thái,
          // nhưng là Ô THẬT (lọc/sort/sửa trong Excel). Dựng từ CHÍNH `dueMonthGroups` (nguồn bảng gộp).
          if (dueMonthGroups.length === 0) { toast.error("Không có dữ liệu để xuất"); return; }
          const clean = (s?: string | null) => (s ?? "").replace(/\s*\n+\s*/g, ", ").trim();
          const ALERT_TXT: Record<string, string> = { late: "Trễ tiến độ", trim: "Cần cắt đầu việc", focus: "Cần tập trung" };
          const itemStatus = (it: EnrichedItem): { text: string; color: XlsxStatusColor } => {
            const done = !!completedDates[it._key] || (it.pctActual != null && Math.round(it.pctActual) >= 100);
            if (done) return { text: "Đã hoàn thành", color: "GREEN" };
            if (it._alert && it._alert !== "none") return { text: ALERT_TXT[it._alert] ?? "", color: it._alertColor === "red" ? "RED" : "AMBER" };
            return { text: "", color: null };
          };
          const cols = [
            { label: "Ngày update", width: 12, align: "center" as const },
            { label: "Mã", width: 15, align: "left" as const },
            { label: "Tên dự án / Hạng mục", width: 42, wrap: true, align: "left" as const },
            { label: "Người phụ trách chính", width: 22, wrap: true, align: "left" as const },
            { label: "Ngày bắt đầu", width: 12, align: "center" as const },
            { label: "Ngày kết thúc", width: 12, align: "center" as const },
            { label: "% thực tế", width: 9, align: "center" as const },
            { label: "Quá hạn", width: 9, align: "center" as const },
            { label: "Tình trạng", width: 15, align: "center" as const },
            { label: "Vướng mắc / Cần xử lý", width: 48, wrap: true, align: "left" as const },
            { label: "Giải pháp / Action plan", width: 48, wrap: true, align: "left" as const },
          ];
          const rows: XlsxTableRow[] = [];
          for (const g of dueMonthGroups) {
            const groupLate = !g.delivered && !!g.deadline && g.deadline.slice(0, 10) < today;
            rows.push({
              kind: "group", delivered: !!g.delivered, late: groupLate,
              statusColor: g.delivered ? "GREEN" : null,
              cells: [
                fmtDateVN2(g.updateDate), g.maCT || "", g.name || "", clean(g.pm),
                fmtDateVN2(g.start), fmtDateVN2(g.deadline), "", "",
                g.delivered ? "Đã bàn giao" : "", visibleText(g.noteMsgs), visibleText(g.actionMsgs),
              ],
            });
            for (const it of g.items) {
              const st = itemStatus(it);
              const doneOn = completedDates[it._key];
              rows.push({
                kind: "item", statusColor: st.color,
                cells: [
                  "", stageAbbrOf(it._stageId), it._stageLabel || "",
                  clean(it._picEdited ? it._pic : picByStageConv(it.owner, it._stageId, it._projectPm)),
                  fmtDateVN2(it.start), doneOn ? fmtDateVN2(doneOn) : fmtDateVN2(it.deadline),
                  it.pctActual != null ? `${Math.round(it.pctActual)}%` : "",
                  it.overdueDays ? `${it.overdueDays} ngày` : "",
                  st.text, visibleText(it._noteMsgs), visibleText(it._actionMsgs),
                ],
              });
            }
          }
          const { exportTableXlsx } = await loadSplit(() => import("@/lib/excel-export"));
          await exportTableXlsx({ columns: cols, statusColIndex: 8, finishColIndex: 5, rows, todayIso: today, filterSummary, updatedAt: data.updatedAt });
          const projCount = dueMonthGroups.length;
          const itemCount = rows.length - projCount;
          track("export_excel", `Lọc: ${filterSummary} · ${projCount} dự án, ${itemCount} đầu việc`.slice(0, 300));
          toast.success(`Đã xuất ${projCount} dự án (${itemCount} đầu việc)`);
        }}
      />




      {/* Xuất PDF = chụp đúng giao diện (pdf-export.ts) — không dùng hộp thoại in. */}
    </div>
    </RolesCtx.Provider>
  );
}

/* ----- Section 1: Overview strip (4 KPI cards, last 2 clickable) ----- */

function OverviewStrip(p: {
  projectCount: number;
  lateCount: number; trimCount: number; focusCount: number;
  dueMonthCount: number; dueMonthActive: boolean; onPickDueMonth: () => void;
  topCount: number; topActive: boolean; onPickTop: () => void;
  suspectCount: number;
  activeAlerts: AlertK2[];
  onPickKpi: (k: AlertK2) => void;
}) {
  // Các thẻ — con số phản ánh ĐÚNG những gì bảng bên dưới đang hiển thị (theo bộ lọc).
  // AUTO-FIT: section = container (container-type inline-size), grid lấy cỡ chữ theo `cqw`
  // = 1% bề rộng section. Mọi kích thước con (padding/gap/chữ/số) theo `em` nên cả cụm
  // THU/PHÓNG ĐỀU cùng bề rộng — màn hẹp không rớt chữ, màn nào cũng cùng bản xem chỉ khác
  // cỡ. Hệ số 0.78cqw ⇒ ~12px ở bề rộng cụm ~1536 (màn 1920). Xem quy tắc ở lib/table-scale.
  return (
    <section id="pdf-kpi" className="rounded-lg border border-slate-200 bg-white p-2" style={{ containerType: "inline-size" }}>
      <div className="grid grid-cols-2 gap-[0.66em] sm:grid-cols-6" style={{ fontSize: "0.78cqw" }}>
        <KPI label="Dự án hiện hành" value={p.projectCount} tone="slate" />
        <KPI label="Trễ tiến độ" value={p.lateCount} tone="red"
             active={p.activeAlerts.includes("late")} onClick={() => p.onPickKpi("late")} />
        <KPI label="Cần cắt đầu việc" value={p.trimCount} tone="amber"
             active={p.activeAlerts.includes("trim")} onClick={() => p.onPickKpi("trim")} />
        <KPI label="Cần tập trung" value={p.focusCount} tone="amber"
             active={p.activeAlerts.includes("focus")} onClick={() => p.onPickKpi("focus")} />
        <KPI label="Bàn giao tháng này" value={p.dueMonthCount} tone="blue"
             active={p.dueMonthActive} onClick={p.onPickDueMonth} />
        <KPI label="Top 20" value={p.topCount} tone="orange"
             active={p.topActive} onClick={p.onPickTop} />
      </div>
      {/* Cảnh báo "% nghi ngờ dữ liệu" ĐÃ DỜI vào menu Hệ thống ▸ Cảnh báo dữ liệu (check "pct").
          Trang chính giữ SẠCH (nhiều sếp lớn xem) — không bày cảnh báo kỹ thuật ra ngoài. */}
    </section>
  );
}

function KPI({ label, value, tone, onClick, active }: {
  label: string; value: number | string;
  tone: "slate" | "red" | "orange" | "amber" | "blue";
  onClick?: () => void;
  active?: boolean;
}) {
  const toneCls = {
    slate: "border-slate-200 bg-slate-50 text-slate-800",
    red: "border-red-400 bg-red-50 text-red-900",
    orange: "border-orange-400 bg-orange-50 text-orange-900",
    amber: "border-amber-300 bg-amber-50 text-amber-900",
    blue: "border-blue-400 bg-blue-50 text-blue-900",
  }[tone];
  const activeCls = active ? "ring-2 ring-teal-600 ring-offset-1" : "";
  // Bố cục NGANG: tên bên trái (tối đa 2 dòng), con số bên PHẢI — thấp gọn, đều hàng.
  // MỌI cỡ theo `em` (kế thừa cỡ chữ cqw của grid) nên cả thẻ co giãn cùng cụm KPI.
  const inner = (
    <div className="flex h-full items-center justify-between gap-[0.66em]">
      <span className="line-clamp-2 text-[0.83em] font-semibold uppercase leading-tight tracking-wide opacity-70">{label}</span>
      <span className="shrink-0 text-[1.5em] font-bold leading-none tabular-nums">{value}</span>
    </div>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick}
        className={`rounded-md border px-[0.83em] py-[0.33em] text-left transition hover:shadow-sm ${toneCls} ${activeCls}`}>
        {inner}
      </button>
    );
  }
  return <div className={`rounded-md border px-[0.83em] py-[0.33em] ${toneCls} ${activeCls}`}>{inner}</div>;
}


/* ----- Section 2: Stage bars (7 stages, fixed order, prominent legend) ----- */

function StageBarsPanel({ active, doneCounts, activeStages, onPick }: {
  /** Đầu việc ĐANG LÀM đã qua bộ lọc ngữ cảnh (trừ lọc Hạng mục) — panelActive. */
  active: EnrichedItem[];
  /** Số việc ĐÃ XONG mỗi giai đoạn, cùng bộ lọc — panelDoneCounts. */
  doneCounts: Map<string, number>;
  activeStages: StageOrOther[];
  onPick: (sid: StageId) => void;
}) {
  // MỌI CON SỐ trên thẻ đều tính từ tập ĐÃ LỌC: chưa bấm lọc = số tổng;
  // bấm lọc (tháng này / bộ phận / nhóm cảnh báo / MP / tìm kiếm) → nhảy theo.
  // Thanh chia theo MÀU (mức nghiêm trọng), KHÔNG theo nhãn: từ 17/07/2026 một việc
  // "Cần tập trung" có thể đỏ, nên gom theo `_alert` sẽ vẽ sai màu thanh.
  const rows = STAGE_ORDER.map(sid => {
    const stageActive = active.filter(i => i._stageId === sid);
    const red = stageActive.filter(i => i._alertColor === "red").length;
    const amber = stageActive.filter(i => i._alertColor === "amber").length;
    const done = doneCounts.get(sid) ?? 0;
    // TỔNG ĐẦU VIỆC = đang làm (đã lọc) + đã hoàn thành (đã lọc).
    return { sid, total: stageActive.length + done, red, amber, done, alertTotal: red + amber };
  });
  return (
    <section id="pdf-stages" className="rounded-lg border border-slate-200 bg-white px-2 py-1.5" style={{ containerType: "inline-size" }}>
      {/* AUTO-FIT: cỡ chữ theo cqw (đặt trên CẢ hàng legend lẫn grid, cùng một hệ số nên
          hai phần đồng bộ), mọi kích thước con theo em. 0.68cqw ⇒ ~10.5px ở cụm ~1536. */}
      <div className="mb-1 flex flex-wrap items-center justify-end gap-[0.76em]" style={{ fontSize: "0.68cqw" }}>
        <div className="flex flex-wrap items-center gap-[0.76em] font-semibold">
          {/* Legend nói theo MÀU chứ không theo tên nhãn: một màu giờ gom nhiều nhãn
              (đỏ = trễ + cần cắt + cần tập trung khi sát bàn giao), ghi tên nhãn là sai. */}
          <LegendChip color="bg-emerald-300" label="Hoàn thành" />
          <LegendChip color="bg-red-600"     label="Cảnh báo đỏ" />
          <LegendChip color="bg-amber-400"   label="Cảnh báo vàng" />
          <LegendChip color="bg-slate-300"   label="Đang triển khai" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-[0.38em] md:grid-cols-7" style={{ fontSize: "0.68cqw" }}>
        {rows.map(r => {
          const active = activeStages.includes(r.sid as StageOrOther);
          // Thanh: XANH (mờ, đã xong) dồn TRÁI → ĐỎ (cảnh báo đỏ) → VÀNG (cảnh báo
          // vàng) → XÁM (đang triển khai).
          const base = r.total || 1;
          const doneW = (r.done / base) * 100;
          const lateW = (r.red / base) * 100;
          const trimW = (r.amber / base) * 100;
          const normal = r.total - r.done - r.alertTotal; // đang triển khai bình thường
          return (
            <button key={r.sid} onClick={() => onPick(r.sid)}
              className={`group flex flex-col gap-[0.19em] rounded-md border px-[0.57em] py-[0.38em] text-left transition hover:bg-slate-50 ${active ? "border-teal-600 bg-teal-50/40 ring-1 ring-teal-600" : "border-slate-200"}`}>
              {/* Tên hạng mục + viết tắt hiển thị cạnh nhau */}
              <div className="text-[1em] font-semibold leading-tight text-slate-800 line-clamp-2">
                {STAGE_META[r.sid].label}
                <span className="ml-1 font-bold text-[#1e3a8a]">· {STAGE_ABBR[r.sid]}</span>
              </div>
              <div className="relative h-[0.76em] overflow-hidden rounded bg-slate-300">
                {/* Xanh "đã hoàn thành" cố tình MỜ (chỉ làm nền) để đỏ/vàng nổi bật. */}
                <div className="absolute inset-y-0 left-0 bg-emerald-200/50" style={{ width: `${doneW}%` }} />
                <div className="absolute inset-y-0 bg-red-600"   style={{ left: `${doneW}%`, width: `${lateW}%` }} />
                <div className="absolute inset-y-0 bg-amber-400" style={{ left: `${doneW + lateW}%`, width: `${trimW}%` }} />
              </div>
              {/* Cảnh báo nằm DƯỚI data bar, cùng hàng chip đếm */}
              <div className="flex flex-wrap items-center gap-[0.38em] text-[0.9em] tabular-nums">
                {/* Số "đã hoàn thành" (xanh) đã bỏ — nhìn phần xanh trên data bar để định lượng. */}
                {r.red > 0 && <span className="rounded bg-red-600 px-[0.38em] py-[0.19em] font-bold text-white" title="Cảnh báo đỏ">{r.red}</span>}
                {r.amber > 0 && <span className="rounded bg-amber-400 px-[0.38em] py-[0.19em] font-bold text-amber-900" title="Cảnh báo vàng">{r.amber}</span>}
                {normal > 0 && <span className="rounded bg-slate-200 px-[0.38em] py-[0.19em] font-bold text-slate-700" title="Đang triển khai bình thường">{normal}</span>}
                <span className="ml-auto whitespace-nowrap font-semibold text-slate-500">
                  Cảnh báo: <span className="text-[1.05em] font-bold text-slate-900">{r.alertTotal}</span>
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  // Kích thước theo em (kế thừa cỡ chữ cqw của hàng legend) → co giãn cùng thanh giai đoạn.
  return (
    <span className="inline-flex items-center gap-[0.57em] rounded-md border border-slate-200 bg-slate-50 px-[0.57em] py-[0.19em] text-slate-800">
      <span className={`h-[0.95em] w-[0.95em] shrink-0 rounded-sm ${color}`} />
      {label}
    </span>
  );
}

/* ----- Section 4: Flat Excel-like table with sticky header ----- */

/** Độ rộng mặc định 11 cột (%) — chốt theo bố cục PMO đã duyệt 07/07/2026.
 *  Người dùng vẫn kéo chỉnh được (lưu localStorage riêng từng trình duyệt);
 *  "Đặt lại cột" trả về đúng bộ số này. */
//         Ngày update  Mã CT  Tên dự án  Bàn giao  Hạng mục  Nhân sự  Bắt đầu  Deadline  %TT  Quá hạn  Tình trạng  Vướng mắc  Hành động
// Ngày update là thông tin PHỤ (chip nhỏ dd/mm) → 4.2% là đủ; 1.3% dôi ra dồn cho
// Tên dự án (cột chật nhất, tên dài phải xuống 3 dòng).
// Bàn giao 4.5% → 5.2%: dự án quá hạn bọc ngày trong badge đỏ, cần 79px ở cỡ chữ gốc
// (ngày 8 ký tự đậm + padding badge + padding ô) nhưng 4.5% chỉ cho 69px ⇒ badge lấn
// sang cột bên. Lấy 0.7% từ "Hành động" (15.7 → 15.0) để tổng vẫn đúng 100%.
// v6: thu 4 cột dư chỗ (Ngày update 4.2→3.9 kèm chip padding px-0.5 để không cắt @1024, Bàn giao
//     5.2→4.9 — vẫn đủ cho badge đỏ quá hạn, Hạng mục 3.8→3.4, Quá hạn 4.7→4.0) → dồn +1.7% cho
//     Giải pháp (15.0→16.7). Tổng vẫn 100%.
// v7: Tên dự án 15.1→11.0 (tên GÓI theo kiểu PMP xuống 2 dòng, không kéo dài 1 dòng làm phình cột;
//     tên DÀI được tràn tối đa 3 dòng để hiện đủ, không cắt "…") → dồn +4.1% cho Giải pháp
//     (16.7→20.8). Tổng vẫn 100%.
// v8: header 3 cột xuống 2 dòng ("Ngày/bắt đầu", "%/thực tế", "Quá/hạn") → thu cột: Ngày bắt đầu
//     5.2→4.8, % thực tế 4.0→3.8, Quá hạn 4.0→3.5 → dồn +1.1% cho Giải pháp (20.8→21.9).
// v9: header "Bàn/giao" 2 dòng + font NGÀY nhỏ lại (0.85em) → thu 3 cột ngày: Bàn giao 4.9→4.2,
//     Ngày bắt đầu 4.8→4.0, Deadline 4.8→4.0 → dồn +2.3% cho Giải pháp (21.9→24.2). Tổng 100%.
const DEFAULT_COL_W = [3.9, 5.2, 11.0, 4.2, 3.4, 12, 4.0, 4.0, 3.8, 3.5, 5, 15.8, 24.2];
// v3: nới cột Nhân sự lên 15% — bỏ bản lưu cũ để mọi người nhận mốc mới.
// v4: Mã CT 4.5% → 6.5% (mã kiểu "CT26-060" bị cắt mất chữ ở màn hẹp: 4.5% ≈ 56px
//     @1280, trừ padding còn 48px < bề rộng chữ). Bù đúng 2% lấy từ Nhân sự phụ trách.
// v5: Mã CT 6.5% → 5.2% — 6.5% để dư ~34px trống mỗi ô (mã 8 ký tự "CT25-088" chỉ cần
//     ~43px, ô rộng 77px @1246). 5.2% cho ~62px ô → chữ vừa khít, còn ~11px margin (không
//     cắt kể cả @1024, đã đo). 1.3% dôi ra dồn cho Tên dự án (13.8 → 15.1, cột clamp 3 dòng
//     hay chật nhất). Tổng vẫn 100%.
const LS_COLW = "pmo.master.colw.v4";

/** Bố cục cột RIÊNG cho bảng NHÓM theo dự án (theo cấu trúc file PMP import): BỎ "Hạng mục"
 *  (dồn mã viết tắt vào "Mã"), "Mã CT"→"Mã", "Tên dự án"→"Mô tả", VÀ (24/07) BỎ luôn cột "Bàn giao"
 *  — thay vào đó HÀNG DỰ ÁN hiện Ngày bắt đầu + Deadline(=bàn giao) như PMP. → 11 cột. CHỈ áp cho
 *  bảng nhóm; bảng lọc-hạng-mục & Cần-cập-nhật-MP giữ nguyên 13 cột. Bỏ 4.2% "Bàn giao" → Mô tả
 *  (11→14.4), Ngày bắt đầu (4.0→4.4), Deadline (4.0→4.4). Tổng vẫn 100%. */
// v5 (24/07): PMO kéo lại lần 2 — nới cột "Mã" + "Người phụ trách", thu "Mô tả" cho chữ hiện đủ,
// header khít. Chốt bộ này làm MẶC ĐỊNH; bump khoá lưu (group.v5) để mọi người nhận mốc mới.
const GROUP_COL_W = [4.8, 4.7, 10.9, 9.1, 5.1, 4.9, 4.6, 3.9, 6.2, 15.9, 29.9];
const LS_COLW_GROUP = "pmo.master.colw.group.v5";

/** Định nghĩa 13 cột tiêu đề bảng Danh sách (thứ tự = thứ tự cột). Gom thành DATA để render
 *  bằng .map — nhờ đó mỗi cột nhận đúng tay kéo chỉnh rộng (onResizeStart theo index). */
const HEADER_COLS: { k: SortKey; align: "left" | "center" | "right"; label: ReactNode }[] = [
  { k: "updateDate",      align: "center", label: "Ngày update" },
  { k: "maCT",            align: "left",   label: "Mã CT" },
  { k: "name",            align: "left",   label: "Tên dự án / Hạng mục" },
  { k: "projectDeadline", align: "center", label: <>Bàn<br />giao</> },
  { k: "list",            align: "left",   label: "Hạng mục" },
  { k: "pic",             align: "left",   label: "Nhân sự phụ trách" },
  { k: "start",           align: "center", label: <>Ngày<br />bắt đầu</> },
  { k: "finish",          align: "center", label: <>Ngày<br />kết thúc</> },
  { k: "actualPct",       align: "center", label: <>%<br />thực tế</> },
  { k: "overdue",         align: "center", label: <>Quá<br />hạn</> },
  { k: "alert",           align: "center", label: "Tình trạng" },
  { k: "note",            align: "left",   label: "Vướng mắc / Cần xử lý" },
  { k: "action",          align: "left",   label: "Giải pháp / Action plan" },
];

/** Tiêu đề bảng NHÓM theo dự án (12 cột — xem GROUP_COL_W): "Mã" (dự án=mã dự án, hạng mục=mã
 *  viết tắt), "Mô tả" (dự án=tên dự án, hạng mục=tên hạng mục đầy đủ), KHÔNG có cột "Hạng mục". */
const HEADER_COLS_GROUP: { k: SortKey; align: "left" | "center" | "right"; label: ReactNode }[] = [
  { k: "updateDate",      align: "center", label: "Ngày update" },
  { k: "maCT",            align: "left",   label: "Mã" },
  { k: "name",            align: "left",   label: "Tên dự án / Hạng mục" },
  { k: "pic",             align: "left",   label: <>Người phụ<br />trách chính</> },
  { k: "start",           align: "center", label: <>Ngày<br />bắt đầu</> },
  // KHÔNG còn cột "Bàn giao" riêng: cột "Deadline cam kết" ở HÀNG DỰ ÁN hiện chính ngày Bàn
  // giao (Kết thúc dự án), nên cho SORT theo `projectDeadline` (bàn giao) → giữ được sort cũ.
  { k: "projectDeadline", align: "center", label: <>Ngày<br />kết thúc</> },
  { k: "actualPct",       align: "center", label: <>%<br />thực tế</> },
  { k: "overdue",         align: "center", label: <>Quá<br />hạn</> },
  { k: "alert",           align: "center", label: "Tình trạng" },
  { k: "note",            align: "left",   label: "Vướng mắc / Cần xử lý" },
  { k: "action",          align: "left",   label: "Giải pháp / Action plan" },
];

/** Highlight = IN ĐẬM + đổi màu chữ (KHÔNG nền → đỡ chói). Màu THEO CỘT: Vướng mắc = ĐỎ ĐÔ
 *  (#C00000), Giải pháp = XANH NAVY (#1E3A8A). Theo offset ký tự → admin tô 1 lần thấy khắp app.
 *  `boldOnly` = CHỈ in đậm, GIỮ NGUYÊN màu chữ (dùng cho HÀNG CẤP DỰ ÁN nền tối → đậm chữ trắng).
 *  `onRemove` = bấm vào đoạn tô để BỎ tô. */
function HiText({ text, ranges, onRemove, field = "note", boldOnly }: { text: string; ranges?: HiRange[]; onRemove?: (r: HiRange) => void; field?: "note" | "action"; boldOnly?: boolean }) {
  if (!text) return null;
  const rs = (ranges ?? []).filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  if (rs.length === 0) return <>{text}</>;
  // boldOnly (hàng cấp dự án nền tối) → color:"inherit" để lấy màu TRẮNG của cha; KHÔNG để undefined
  // vì thẻ <mark> có màu chữ mặc định (đen) của trình duyệt sẽ đè lên → bị đen.
  const color = boldOnly ? "inherit" : (field === "action" ? "#1E3A8A" : "#C00000");
  const out: ReactNode[] = [];
  let pos = 0;
  rs.forEach(([s, e], i) => {
    const a = Math.max(pos, Math.min(s, text.length));
    const b = Math.max(a, Math.min(e, text.length));
    if (a > pos) out.push(<span key={`t${i}`}>{text.slice(pos, a)}</span>);
    if (b > a) out.push(
      <mark key={`h${i}`} onClick={onRemove ? (ev) => { ev.stopPropagation(); onRemove([s, e]); } : undefined}
        title={onRemove ? "Bấm để bỏ tô đoạn này" : undefined}
        style={{ background: "transparent", color, fontWeight: 700, cursor: onRemove ? "pointer" : undefined }}>
        {text.slice(a, b)}
      </mark>,
    );
    pos = b;
  });
  if (pos < text.length) out.push(<span key="tail">{text.slice(pos)}</span>);
  return <>{out}</>;
}

/** Người phụ trách: NHIỀU tên ngăn bởi "/" → mỗi tên là 1 khối KHÔNG NGẮT, xuống dòng ở dấu "/"
 *  (không cắt giữa 1 tên). Vd "Trần Quốc Liêm / Lê Viết Tài" → nếu chật, "Trần Quốc Liêm /" ở dòng
 *  trên, "Lê Viết Tài" nguyên xuống dòng dưới. */
function PicNames({ text }: { text: string }) {
  const parts = (text || "").split("/").map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return <>{text}</>;
  return <>{parts.map((p, i) => (
    <Fragment key={i}>
      {i > 0 && " "}
      <span className="whitespace-nowrap">{p}{i < parts.length - 1 ? " /" : ""}</span>
    </Fragment>
  ))}</>;
}

/** POPUP "Thi công lắp đặt": Worker CHỈ tải file (b64, nhẹ) → CLIENT parse + render (trình duyệt
 *  thừa tài nguyên, tránh Error 1102 do parse xlsx 2MB trên Worker). XLSX + renderer nạp ĐỘNG
 *  (chỉ khi mở popup) để không phình bundle chính. */
/** KHOÁ BỀN của 1 dự án = Mã CT + Tên (chuẩn hoá) — KHÔNG theo STT nên chèn/xoá dòng không lệch link. */
function stableProjKey(maCT: string, name: string): string {
  const norm = (s: string) => (s ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
  return `pl:${norm(maCT)} ${norm(name)}`;
}
/** Tách fileId + gid từ URL Google Sheet dán vào. Nhận cả link /edit#gid= lẫn ?gid=. */
function parseSheetUrl(url: string): { fileId: string; gid?: string } | null {
  const id = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? url.match(/^[a-zA-Z0-9_-]{20,}$/)?.[0];
  if (!id) return null;
  const gid = url.match(/[#?&]gid=(\d+)/)?.[1];
  return { fileId: id, ...(gid ? { gid } : {}) };
}

/** Ghép "Tên sheet" + "Vùng A1" thành tham số range của Google export — GIỮ ĐÚNG vùng người dùng khai,
 *  KHÔNG nới rộng (nới sẽ kéo cả vùng trống + text lạc → "dư" + không gói 1 trang). Chỉ tên sheet (không
 *  vùng) → cả tab; chỉ vùng → áp trên tab hiện tại; trống cả hai → undefined (cả tab). */
function composeSheetRange(sheet: string, range: string): string | undefined {
  const s = sheet.trim(), r = range.trim();
  if (s && r) return `${s}!${r}`;
  if (s) return s;
  if (r) return r;
  return undefined;
}

/** Tham số {gid, range} cho getSheetPdf. QUAN TRỌNG: LUÔN GIỮ gid của link (gid đã trỏ đúng tab) rồi CHỈ
 *  cắt theo vùng A1 → Google cắt ĐÚNG vùng. Nếu bỏ gid + dùng "Sheet!range", Google hay xuất CẢ FILE. Chỉ
 *  khi link KHÔNG có gid mới dùng tên sheet trong range. */
function pdfRangeArgs(gid: string | undefined, sheet: string, range: string): { gid?: string; range?: string } {
  const r = range.trim();
  if (gid) return { gid, range: r || undefined };            // có gid → cắt theo vùng A1 trên đúng tab
  return { range: composeSheetRange(sheet, range) };         // không gid → mới dùng tên sheet
}

/** Liệt kê tên MỌI tab — cho dropdown chọn tab. Dùng listSheetTabs (server chỉ đọc workbook.xml → ĐỦ tab,
 *  KHÔNG bị tách còn mỗi "Summary" như getSummaryFile). Cache theo fileId để mở lại hộp thoại hiện NGAY. */
const _sheetNamesCache = new Map<string, string[]>();
async function listSheetNames(fid: string, force?: boolean): Promise<string[]> {
  if (!force && _sheetNamesCache.has(fid)) return _sheetNamesCache.get(fid)!;
  const res = await listSheetTabs({ data: { fileId: fid, force: force || undefined } });
  const tabs = res?.tabs ?? [];
  if (tabs.length) _sheetNamesCache.set(fid, tabs);
  return tabs;
}
/** RENDER ma trận ô màu ĐÚNG vùng (marker hoặc range) từ dữ liệu + màu — chạy CẢ native lẫn xlsx, không PDF,
 *  không thừa. spec = FORM người dùng (bố cục + màu) đè lên dữ liệu sống, tuỳ chọn. */
async function renderSheetRegion(fid: string, opts: { sheetName?: string; range?: string; tl?: string; br?: string }, force?: boolean, spec?: import("@/lib/sheet-dump").FormSpec): Promise<{ html: string; css: string; range: string }> {
  const { sh, range, codeColors } = await loadRegion(fid, opts, force);
  const dump = await import("@/lib/sheet-dump");
  return { html: dump.rangeToHtml(sh, range, codeColors, spec), css: dump.SHEET_DUMP_CSS, range };
}
/** ETL 1 phát: Extract (tải file) → Transform (dò marker → render ma trận) → Load (ghi snapshot KV).
 *  Chạy 1 LẦN lúc PMO lưu/làm mới. Sau đó viewer chỉ đọc snapshot (nhẹ, không parse). */
async function etlSheetRegion(key: string, fid: string, opts: { sheetName?: string; range?: string; tl?: string; br?: string }): Promise<{ html: string; css: string; range: string }> {
  const out = await renderSheetRegion(fid, opts, true);   // E + T (force = bản mới nhất từ Drive)
  await saveSheetSnap({ data: { key, html: out.html, css: out.css, range: out.range, devAs: devAs() } });   // L
  return out;
}

function SummaryDialog({ fileId, initSheet, initRange, initTl, initBr, initSnap, initSnapKey, initChart, initName, canEdit, onClose }: { fileId: string; initSheet?: string; initRange?: string; initTl?: string; initBr?: string; initSnap?: boolean; initSnapKey?: string; initChart?: boolean; initName?: string; canEdit?: boolean; onClose: () => void }) {
  useEscapeToClose(onClose);
  const [fid, gid] = fileId.split("|");   // "fileId" (dạng phòng) hoặc "fileId|gid" (đúng 1 tab, vd Public Summary)
  const [refreshN, setRefreshN] = useState(0);   // bấm "Làm mới" → tăng → lấy bản LIVE (bỏ cache)
  const force = refreshN > 0;

  // Mở từ LINK PMO GẮN → hiện ma trận ĐÚNG vùng qua MatrixFormEditor (render LIVE + áp FORM đã lưu + admin
  // chỉnh như Excel). Không có init → nhánh tự-nhận-dạng (Public Summary / Summary / dump) như cũ.
  const ov = (initSheet || initRange || initTl || initBr || initSnap) ? { sheet: initSheet ?? "", range: initRange ?? "", tl: initTl ?? "", br: initBr ?? "", snap: !!initSnap, snapKey: initSnapKey ?? "" } : null;
  const hasOverride = !!ov;
  // FORM key theo LINK (bền theo file+sheet+vùng) → số liệu đổi vẫn giữ đúng form đã lưu.
  const formKey = ov ? `${fid}::${(ov.sheet || "").trim()}::${(ov.range || "").trim() || `${(ov.tl || "").trim()}~${(ov.br || "").trim()}`}` : "";
  const editorOpts = useMemo(() => ({ sheetName: ov?.sheet || undefined, range: ov?.range || undefined, tl: ov?.tl || undefined, br: ov?.br || undefined }), [ov?.sheet, ov?.range, ov?.tl, ov?.br]);

  // Nhánh MẶC ĐỊNH cần xlsx (tự nhận dạng). Có override → editor tự tải, KHÔNG cần query này.
  const q = useQuery({
    queryKey: ["summary-file", fid, gid ?? "", refreshN],
    queryFn: () => getSummaryFile({ data: { fileId: fid, gid: gid || undefined, force: force || undefined } }),
    staleTime: force ? 0 : 5 * 60 * 1000,
    retry: 1,
    enabled: !hasOverride,
  });
  const [render, setRender] = useState<{ html: string; css: string } | null>(null);
  const [pdfB64, setPdf] = useState<string | null>(null);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [cfOn, setCfOn] = useState(true);         // tô màu 0→100 (đỏ→xanh) theo % — chỉ cho nhánh mặc định
  const [full, setFull] = useState(false);        // phóng to hết cỡ
  const [chartMode, setChartMode] = useState(!!initChart);   // "Xem có chart": Google render tab ra PDF (đủ chart + màu); PMO có thể set mặc định bật
  const [chartLoading, setChartLoading] = useState(false);
  const [chartErr, setChartErr] = useState<string | null>(null);
  const renderRef = useRef<HTMLDivElement>(null);

  // "Xem có chart" — Google export tab ra PDF (có chart/CF y hệt). Chỉ tải KHI bật. gid (nếu có) chụp đúng tab.
  useEffect(() => {
    if (!hasOverride || !chartMode || !ov) return;
    let off = false; setChartLoading(true); setChartErr(null); setPdf(null);
    const args = pdfRangeArgs(gid, ov.sheet, ov.range);
    getSheetPdf({ data: { fileId: fid, gid: args.gid, range: args.range, force: force || undefined } })
      .then((r) => { if (!off) setPdf(r.b64); })
      .catch((e) => { if (!off) setChartErr((e as Error).message); })
      .finally(() => { if (!off) setChartLoading(false); });
    return () => { off = true; };
  }, [hasOverride, chartMode, fid, gid, ov?.sheet, ov?.range, refreshN]);
  // Tô/gỡ màu thang 0%(đỏ)→100%(xanh) cho các ô là PHẦN TRĂM (nhánh mặc định). Lưu màu gốc để bỏ tick trả lại.
  useEffect(() => {
    const root = renderRef.current; if (!root) return;
    root.querySelectorAll("td").forEach((td) => {
      const m = /^(\d{1,3}(?:[.,]\d+)?)\s*%$/.exec((td.textContent || "").trim());
      if (!m) return;
      td.style.width = "54px"; td.style.minWidth = "54px"; td.style.maxWidth = "54px";   // ô % ĐỀU NHAU
      if (cfOn) {
        if (td.dataset.obg === undefined) { td.dataset.obg = td.style.background || ""; td.dataset.ofg = td.style.color || ""; }
        const p = Math.max(0, Math.min(100, parseFloat(m[1].replace(",", "."))));
        td.style.background = `hsl(${Math.round(p * 1.2)}, 72%, 72%)`;   // 0=đỏ · 60=vàng · 120=xanh
        td.style.color = "#111";
      } else if (td.dataset.obg !== undefined) {
        td.style.background = td.dataset.obg; td.style.color = td.dataset.ofg || "";
        delete td.dataset.obg; delete td.dataset.ofg;
      }
    });
  }, [render, cfOn]);

  // NHÁNH MẶC ĐỊNH — tự nhận dạng từ xlsx (Public Summary → cột; Summary → heatmap; khác → dump). Giữ NGUYÊN.
  useEffect(() => {
    if (hasOverride) return;
    const b64 = q.data?.b64;
    if (!b64) return;
    let off = false;
    (async () => {
      try {
        const XLSX = await import("xlsx");
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const wb = XLSX.read(bytes.buffer, { type: "array", cellStyles: true });
        const name = wb.SheetNames.find((n) => /public\s*summary/i.test(n))
          ?? wb.SheetNames.find((n) => /summary/i.test(n)) ?? wb.SheetNames[0];
        const sh = name ? wb.Sheets[name] : undefined;
        if (off) return;
        if (!sh) { setParseErr("File không có sheet dữ liệu."); return; }
        if (/public\s*summary/i.test(name)) {
          const pub = await import("@/lib/public-summary-render");
          setRender({ html: pub.publicSummaryToHtml(sh), css: pub.PUBLIC_SUMMARY_CSS });
        } else if (/summary/i.test(name)) {
          const mod = await import("@/lib/summary-render");
          const cf = await import("@/lib/cf-colors");
          setRender({ html: mod.summaryToHtml(sh, cf.readCodeColors(bytes, name)), css: mod.SUMMARY_CSS });
        } else {
          // BỎ PDF (Google cắt vùng không đáng tin) — RENDER HTML thẳng từ sheet (y xì ô + màu, không thừa).
          const dump = await import("@/lib/sheet-dump");
          if (off) return;
          setRender({ html: dump.sheetToHtml(sh), css: dump.SHEET_DUMP_CSS });
        }
      } catch (e) { if (!off) setParseErr((e as Error).message); }
    })();
    return () => { off = true; };
  }, [q.data, hasOverride, fid, gid, force]);

  const doRefresh = () => { setRender(null); setPdf(null); setParseErr(null); setRefreshN((n) => n + 1); };
  // CẬP NHẬT LẠI (PMO): kéo bản MỚI NHẤT từ Drive → render lại → GHI ĐÈ snapshot (để mọi người thấy bản mới,
  // kể cả khi đổi link hoặc nội dung link cũ thay đổi) → reload view. Không có snapKey (nhánh tự nhận dạng) → chỉ reload.
  const [updating, setUpdating] = useState(false);
  const hardUpdate = async () => {
    if (canEdit && hasOverride && initSnapKey) {
      setUpdating(true);
      try { await etlSheetRegion(initSnapKey, fid, editorOpts); }   // force fetch + re-render + lưu lại snapshot
      catch { /* lỗi ETL vẫn cho reload view bên dưới */ }
      setUpdating(false);
    }
    doRefresh();
  };

  const loading = !hasOverride && (q.isPending || (!!q.data && !render && !parseErr && !pdfB64));
  const err = (!hasOverride && q.isError) ? (q.error as Error).message : (hasOverride ? null : parseErr);
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 print:hidden">
      <div className={`flex flex-col rounded-xl border border-slate-200 bg-white shadow-xl ${full ? "h-[97vh] w-[98vw]" : "max-h-[95vh] w-full max-w-[97vw]"}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-teal-700" title={initName || "Ma trận lắp đặt"}>{initName || "Ma trận lắp đặt"}</div>
            <div className="truncate text-sm font-semibold text-slate-900">{ov?.sheet ? `Tab: ${ov.sheet}` : "Tiến độ bàn giao"}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!hasOverride && (
              <label className="flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50" title="Tô màu ô % theo thang 0%(đỏ) → 100%(xanh)">
                <input type="checkbox" checked={cfOn} onChange={(e) => setCfOn(e.target.checked)} /> Tô màu 0→100
              </label>
            )}
            {hasOverride && (
              <button onClick={() => setChartMode((m) => !m)} className={`rounded-md px-2 py-1 text-[11px] font-semibold ${chartMode ? "bg-teal-700 text-white" : "border border-teal-600 text-teal-700 hover:bg-teal-50"}`}
                title={chartMode ? "Về bảng lưới (chỉnh được)" : "Xem bản Google có CHART + màu y hệt (chỉ xem, không chỉnh)"}>
                {chartMode ? "▦ Bảng lưới" : "🖼 Xem có chart"}
              </button>
            )}
            <button onClick={() => setFull((f) => !f)} className="rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100" title="Phóng to / thu nhỏ cửa sổ">{full ? "⤡ Thu nhỏ" : "⤢ Phóng to"}</button>
            {/* PMO/Admin: mở FILE GỐC (Google Sheet đang gắn link) trong tab mới. Người thường không thấy. */}
            {canEdit && fid && (
              <a href={`https://docs.google.com/spreadsheets/d/${fid}/edit${gid ? `#gid=${gid}` : ""}`} target="_blank" rel="noopener noreferrer"
                className="rounded-md px-2 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-50" title="Mở file Google Sheet gốc đang gắn link (PMO/Admin)">↗ File gốc</a>
            )}
            <button onClick={() => void hardUpdate()} disabled={updating}
              className="rounded-md px-2 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-60"
              title={canEdit && hasOverride && initSnapKey ? "Kéo bản MỚI NHẤT từ link (kể cả khi đổi link / nội dung đổi) → cập nhật lại cho mọi người" : "Bỏ cache, tải bản mới nhất từ sheet ngay"}>
              {updating ? "⏳ Đang cập nhật…" : "↻ Cập nhật lại"}
            </button>
            <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Đóng"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {hasOverride ? (
            <>
              {/* Giữ editor MOUNTED (ẩn khi xem chart) → bật/tắt tức thì, không tải lại, không mất chỉnh chưa lưu. */}
              <div className={`h-full ${chartMode ? "hidden" : ""}`}>
                <MatrixFormEditor fid={fid} opts={editorOpts} formKey={formKey} canEdit={!!canEdit} force={refreshN} />
              </div>
              {chartMode && (
                chartLoading ? <div className="p-10 text-center text-sm text-slate-500">Đang tải bản Google (có chart)…</div>
                : chartErr ? <div className="p-10 text-center text-sm text-red-600">Lỗi tải chart: {chartErr}<div className="mt-2 text-[11px] text-slate-500">Bản có chart cần <b>Google Sheet gốc</b> chia sẻ công khai (file .xlsx-trong-Drive không cắt được vùng/tab).</div></div>
                : pdfB64 ? <iframe title="Bản Google có chart" src={`data:application/pdf;base64,${pdfB64}`} className="h-full min-h-[70vh] w-full rounded border border-slate-200" />
                : null
              )}
            </>
          ) : <>
            {loading && <div className="p-10 text-center text-sm text-slate-500">Đang tải…</div>}
            {err && <div className="p-10 text-center text-sm text-red-600">Lỗi: {err}</div>}
            {render && <>
              <style dangerouslySetInnerHTML={{ __html: render.css }} />
              {/* Chuẩn hoá: header dài TỰ WRAP để bớt scroll ngang; mỗi ô cao đều; cột NHÃN đầu KHÔNG xuống dòng. */}
              <style dangerouslySetInnerHTML={{ __html: ".dlg-sheet td,.dlg-sheet th{white-space:normal;word-break:break-word;max-width:110px;vertical-align:middle} .dlg-sheet tbody td{height:23px} .dlg-sheet tr>td:first-child,.dlg-sheet tr>th:first-child{white-space:nowrap;max-width:none;text-align:left;padding-right:10px}" }} />
              <div ref={renderRef} className="dlg-sheet" dangerouslySetInnerHTML={{ __html: render.html }} />
            </>}
          </>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** PMO GẮN / SỬA LINK cho 1 dự án (khoá bền Mã CT + Tên). Dán URL Google Sheet + tên sheet + vùng → xem
 *  thử (PDF) → Lưu. Lưu xong: dự án đó hiện 📊 cho mọi người. Xoá link = gỡ 📊. */
function LinkSetupDialog({ projKey, projName, initCfg, onClose, onSaved }: {
  projKey: string; projName: string; initCfg?: SheetViewCfg; onClose: () => void; onSaved: () => void;
}) {
  useEscapeToClose(onClose);
  const [url, setUrl] = useState(initCfg?.fileId ? `https://docs.google.com/spreadsheets/d/${initCfg.fileId}/edit${initCfg.gid ? `#gid=${initCfg.gid}` : ""}` : "");
  const [sheet, setSheet] = useState(initCfg?.sheet ?? "");   // tên sheet (gõ tay, có gợi ý) — cho cả native & xlsx
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheetsBusy, setSheetsBusy] = useState(false);   // đang tải danh sách tab (tải cả file → hơi lâu lần đầu)
  const [range, setRange] = useState(initCfg?.range ?? "");   // vùng gõ tay (vd B2:M45) — ưu tiên marker nếu có
  const [tl, setTl] = useState(initCfg?.tl ?? "");     // marker góc trên-trái (tuỳ chọn)
  const [br, setBr] = useState(initCfg?.br ?? "");     // marker góc dưới-phải (tuỳ chọn)
  const [chart, setChart] = useState(!!initCfg?.chart);   // mặc định hiện BẢN CÓ CHART cho mọi người
  const [render, setRender] = useState<{ html: string; css: string; range: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  // Dán link hợp lệ → tải danh sách sheet cho dropdown (native & xlsx).
  useEffect(() => {
    const p = parseSheetUrl(url); if (!p) { setSheets([]); setSheetsBusy(false); return; }
    let off = false; setSheetsBusy(true);
    listSheetNames(p.fileId)
      .then((ns) => { if (!off) setSheets(ns); })   // GIỮ NGUYÊN tab đang chọn — KHÔNG ép về tab đầu
      .catch(() => { if (!off) setSheets([]); })
      .finally(() => { if (!off) setSheetsBusy(false); });
    return () => { off = true; };
  }, [url]);

  const preview = async () => {
    const parsed = parseSheetUrl(url);
    if (!parsed) { setErr("Link không hợp lệ — hãy dán URL Google Sheet (…/spreadsheets/d/…)."); return; }
    setBusy(true); setErr(null); setRender(null);
    try {
      const out = await renderSheetRegion(parsed.fileId, { sheetName: sheet, range, tl, br }, true);   // render ma trận đúng vùng
      setRender(out);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const save = async () => {
    const parsed = parseSheetUrl(url);
    if (!parsed) { setErr("Link không hợp lệ."); return; }
    setSaving(true); setErr(null);
    try {
      await etlSheetRegion(projKey, parsed.fileId, { sheetName: sheet, range, tl, br });   // E→T→L: render + lưu snapshot HTML
      await saveSheetView({ data: { key: projKey, pdf: true, fileId: parsed.fileId, gid: parsed.gid, sheet, range, tl: tl.trim(), br: br.trim(), snap: true, chart, devAs: devAs() } });
      onSaved(); onClose();
    } catch (e) { setErr((e as Error).message); setSaving(false); }
  };
  const remove = async () => {
    setSaving(true); setErr(null);
    try { await saveSheetView({ data: { key: projKey, pdf: false, devAs: devAs() } }); onSaved(); onClose(); }
    catch (e) { setErr((e as Error).message); setSaving(false); }
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 print:hidden">
      <div className="flex max-h-[92vh] w-full max-w-[900px] flex-col rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-teal-700">PMO · Gắn link hiển thị</div>
            <div className="text-sm font-semibold text-slate-900 line-clamp-1" title={projName}>{projName || "Dự án"}</div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Đóng"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid gap-2 border-b border-slate-100 px-5 py-3 text-[12px]">
          <label className="grid gap-1"><span className="font-semibold text-slate-700">Link Google Sheet / Excel</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Dán URL: https://docs.google.com/spreadsheets/d/…" className="w-full rounded border border-slate-300 px-2 py-1 text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none" /></label>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1"><span className="font-semibold text-slate-700">Sheet <span className="font-normal text-slate-400">{sheetsBusy ? "(đang tải tab…)" : "(chọn tab)"}</span></span>
              <select value={sheet} onChange={(e) => setSheet(e.target.value)} disabled={sheetsBusy || !sheets.length}
                className="w-56 rounded border border-slate-300 bg-white px-2 py-1 text-slate-900 focus:border-teal-600 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400">
                {sheetsBusy
                  ? <option value={sheet}>⏳ Đang tải danh sách tab…</option>
                  : !sheets.length
                    ? <option value="">— dán link hợp lệ để tải danh sách tab —</option>
                    : <>
                        <option value="">— chọn tab —</option>
                        {sheets.map((s) => <option key={s} value={s}>{s}</option>)}
                      </>}
              </select></label>
            <label className="grid gap-1"><span className="font-semibold text-slate-700">Vùng <span className="font-normal text-slate-400">(vd B2:M45)</span></span>
              <input value={range} onChange={(e) => setRange(e.target.value.slice(0, 40))} onKeyDown={(e) => { if (e.key === "Enter") void preview(); }} placeholder="vd B2:M45" className="w-36 rounded border border-slate-300 px-2 py-1 text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none" /></label>
          </div>
          <div className="flex flex-wrap items-end gap-2 rounded-md bg-teal-50/60 px-2 py-1.5">
            <span className="pb-1 text-[10.5px] font-medium text-teal-700">Tuỳ chọn — dùng marker thay Vùng (chống lệch khi dời ô):</span>
            <label className="grid gap-1"><span className="font-semibold text-teal-800">Marker TRÊN-TRÁI</span>
              <input value={tl} onChange={(e) => setTl(e.target.value.slice(0, 40))} placeholder="vd @TL@" className="w-28 rounded border border-teal-300 px-2 py-1 text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none" /></label>
            <label className="grid gap-1"><span className="font-semibold text-teal-800">DƯỚI-PHẢI</span>
              <input value={br} onChange={(e) => setBr(e.target.value.slice(0, 40))} placeholder="vd @BR@" className="w-28 rounded border border-teal-300 px-2 py-1 text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none" /></label>
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-md bg-amber-50/70 px-2 py-1.5 text-[12px] text-slate-700">
            <input type="checkbox" checked={chart} onChange={(e) => setChart(e.target.checked)} />
            <span>Mặc định hiện <b>bản CÓ CHART</b> (ảnh Google) cho <b>mọi người xem</b> — có chart + màu y hệt (mọi người vẫn đổi được qua bảng lưới). <span className="text-slate-400">Cần dán URL đúng tab (có <code>#gid=</code>) để chụp đúng vùng.</span></span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void preview()} disabled={busy} className="rounded bg-slate-700 px-3 py-1 font-semibold text-white hover:bg-slate-800 disabled:opacity-50">{busy ? "Đang tải…" : "Xem thử"}</button>
            <button onClick={() => void save()} disabled={saving} className="rounded bg-teal-700 px-3 py-1 font-semibold text-white hover:bg-teal-800 disabled:opacity-50">{saving ? "Đang lưu…" : "Lưu link"}</button>
            {initCfg?.fileId && <button onClick={() => void remove()} disabled={saving} className="rounded px-2 py-1 font-medium text-slate-500 hover:text-red-600" title="Gỡ link khỏi dự án">Xoá link</button>}
            {render && <span className="text-[11px] font-medium text-teal-700">✓ Vùng: {render.range || "cả sheet"}</span>}
          </div>
          <div className="text-[10.5px] leading-tight text-slate-500">Chọn <b>Sheet</b> rồi đặt <b>2 marker</b>: gõ 2 ký hiệu lạ (vd <code>@TL@</code>, <code>@BR@</code>) vào <b>ô góc trên-trái</b> và <b>ô góc dưới-phải</b> của vùng trong sheet → app tự dò ra vùng (người ta chèn/dời dòng cột vẫn đúng, không dính dòng ghi chú thừa). Bỏ trống marker = hiện cả sheet. App <b>render lại ô màu</b> nên chạy cho cả <b>Google Sheet</b> lẫn <b>.xlsx</b>. Sheet phải chia sẻ “Anyone with the link”.</div>
          {err && <div className="text-[11px] font-medium text-red-600">Lỗi: {err}</div>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-white p-3">
          {render ? <><style dangerouslySetInnerHTML={{ __html: render.css }} /><div dangerouslySetInnerHTML={{ __html: render.html }} /></>
            : <div className="py-16 text-center text-sm text-slate-400">Dán link → chọn sheet → đặt 2 marker → bấm <b>Xem thử</b>.</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Nén ảnh Ở CLIENT (canvas → JPEG) trước khi lưu KV: co cạnh dài về ≤maxDim, hạ chất lượng dần nếu
 *  còn quá nặng (KV/mạng nhẹ). Nền trắng để PNG trong suốt không ra nền đen. Trả dataURI. */
async function compressImageFile(file: File, maxDim = 1600): Promise<string> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => rej(new Error("Không đọc được file ảnh.")); r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const im = new window.Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("File không phải ảnh hợp lệ.")); im.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Trình duyệt không hỗ trợ canvas.");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
  let q = 0.82, out = canvas.toDataURL("image/jpeg", q);
  while (out.length > 3_200_000 && q > 0.4) { q -= 0.12; out = canvas.toDataURL("image/jpeg", q); }
  return out;
}
const fmtImgWhen = (iso?: string): string => {
  if (!iso) return ""; const d = new Date(iso); if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const PROJIMG_MAX_CLIENT = 12;   // khớp trần server (PROJIMG_MAX)

/** POPUP GALLERY (mọi người xem) — click TÊN DỰ ÁN có 📷 → tải bộ ảnh (chỉ khi mở) → xem lần lượt.
 *  Ảnh lớn + dải thumbnail + ◀▶; bấm ảnh lớn để phóng to/thu nhỏ. Chú thích ngày/người theo TỪNG ảnh. */
function ProjImageDialog({ imgKey, name, onClose }: { imgKey: string; name: string; onClose: () => void }) {
  useEscapeToClose(onClose);
  const [i, setI] = useState(0);
  const [zoom, setZoom] = useState(false);
  const q = useQuery({ queryKey: ["projimg", imgKey], queryFn: () => getProjImage({ data: { key: imgKey } }), staleTime: 5 * 60 * 1000 });
  const imgs = q.data?.imgs ?? [];
  const n = imgs.length;
  const cur = n ? imgs[Math.min(i, n - 1)] : null;
  const go = (d: number) => setI((p) => (n ? (p + d + n) % n : 0));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "ArrowLeft") go(-1); else if (e.key === "ArrowRight") go(1); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [n]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4 print:hidden" onClick={onClose}>
      <div className={`flex flex-col rounded-xl border border-slate-200 bg-white shadow-xl ${zoom ? "h-[97vh] w-[98vw]" : "max-h-[92vh] w-full max-w-[900px]"}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-teal-700" title={name}>📷 {name || "Ảnh dự án"}</div>
            <div className="truncate text-[11px] text-slate-500">{n ? `Ảnh ${Math.min(i, n - 1) + 1}/${n}${cur ? ` · ${fmtImgWhen(cur.at)} · bởi ${(cur.by || "?").split("@")[0]}` : ""}` : ""}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={() => setZoom((z) => !z)} className="rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100" title="Phóng to / thu nhỏ">{zoom ? "⤡ Thu nhỏ" : "⤢ Phóng to"}</button>
            <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Đóng"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1 overflow-auto bg-slate-50 p-3">
          {q.isPending ? <div className="p-10 text-center text-sm text-slate-500">Đang tải ảnh…</div>
            : q.isError ? <div className="p-10 text-center text-sm text-red-600">Lỗi tải ảnh: {(q.error as Error).message}</div>
            : cur ? <img src={cur.data} alt={name} onClick={() => setZoom((z) => !z)} className="mx-auto max-w-full cursor-zoom-in rounded shadow-sm" style={zoom ? undefined : { maxHeight: "72vh" }} />
            : <div className="p-10 text-center text-sm text-slate-500">Chưa có ảnh (có thể đã bị gỡ).</div>}
          {n > 1 && (
            <>
              <button onClick={() => go(-1)} title="Ảnh trước (←)" className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-lg font-bold text-slate-700 shadow hover:bg-white">‹</button>
              <button onClick={() => go(1)} title="Ảnh sau (→)" className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-lg font-bold text-slate-700 shadow hover:bg-white">›</button>
            </>
          )}
        </div>
        {n > 1 && (
          <div className="flex shrink-0 gap-1.5 overflow-x-auto border-t border-slate-100 px-3 py-2">
            {imgs.map((im, k) => (
              <button key={k} onClick={() => setI(k)} title={`Ảnh ${k + 1}`}
                className={`h-12 w-16 shrink-0 overflow-hidden rounded border-2 ${k === Math.min(i, n - 1) ? "border-teal-600" : "border-transparent hover:border-slate-300"}`}>
                <img src={im.data} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** PMO THÊM (nhiều) / XOÁ ảnh cho 1 DỰ ÁN. Chọn nhiều file → nén ở client → xem trước → Lưu (nối vào bộ).
 *  Xoá từng ảnh hoặc xoá hết — LUÔN có. Click ra ngoài KHÔNG tắt (tránh mất ảnh đang chọn). Chỉ ADMIN/PMO. */
function ProjImageSetupDialog({ projKey, projName, projHid, count, canManage, onClose, onSaved }: {
  projKey: string; projName: string; projHid?: string; count: number; canManage?: boolean; onClose: () => void; onSaved: () => void;
}) {
  useEscapeToClose(onClose);
  const qc = useQueryClient();
  const [pending, setPending] = useState<string[]>([]);   // ảnh mới đã nén, chưa lưu
  // ẢNH PHẢI GẮN VÀO 1 CĂN (hoặc KHU với dự án khu public) → lên Drive đúng folder
  // Media/<Dự án>/[<Toà>]/<Căn|Khu>/Hình ảnh, cùng chỗ với ảnh-video up từ app "Media công trường".
  const [toa, setToa] = useState("");
  const [can, setCan] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cur = useQuery({ queryKey: ["projimg", projKey], queryFn: () => getProjImage({ data: { key: projKey } }), enabled: count > 0, staleTime: 5 * 60 * 1000 });
  const existing = cur.data?.imgs ?? [];
  const total = existing.length + pending.length;
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ["projimg", projKey] }); onSaved(); };
  const pick = async (files?: FileList | null) => {
    if (!files || !files.length) return;
    setBusy(true); setErr(null);
    try {
      const room = PROJIMG_MAX_CLIENT - total;
      if (room <= 0) { setErr(`Tối đa ${PROJIMG_MAX_CLIENT} ảnh / dự án.`); setBusy(false); return; }
      const chosen = [...files].filter((f) => /^image\//.test(f.type)).slice(0, room);
      if (!chosen.length) { setErr("Không có file ẢNH hợp lệ (jpg, png…)."); setBusy(false); return; }
      const outs: string[] = [];
      for (const f of chosen) outs.push(await compressImageFile(f));
      setPending((p) => [...p, ...outs]);
      if ([...files].filter((f) => /^image\//.test(f.type)).length > room) setErr(`Chỉ nhận thêm ${room} ảnh (đã đạt trần ${PROJIMG_MAX_CLIENT}).`);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const saveAdds = async () => {
    if (!pending.length) return;
    setSaving(true); setErr(null);
    try { await saveProjImage({ data: { key: projKey, projectName: projName, add: pending, toa: toa.trim(), can: can.trim(), hid: projHid, devAs: devAs() } }); setPending([]); await refresh(); }
    catch (e) { setErr((e as Error).message); }
    setSaving(false);
  };
  const removeExisting = async (idx: number) => {
    setSaving(true); setErr(null);
    try { await saveProjImage({ data: { key: projKey, removeIdx: idx, devAs: devAs() } }); await refresh(); }
    catch (e) { setErr((e as Error).message); }
    setSaving(false);
  };
  const clearAll = async () => {
    setSaving(true); setErr(null);
    try { await saveProjImage({ data: { key: projKey, clear: true, devAs: devAs() } }); setPending([]); await refresh(); }
    catch (e) { setErr((e as Error).message); }
    setSaving(false);
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 print:hidden">
      <div className="flex max-h-[92vh] w-full max-w-[720px] flex-col rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-teal-700">PMO · Ảnh dự án · {total}/{PROJIMG_MAX_CLIENT}</div>
            <div className="line-clamp-1 text-sm font-semibold text-slate-900" title={projName}>{projName || "Dự án"}</div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Đóng"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid gap-2 border-b border-slate-100 px-5 py-3 text-[12px]">
          {/* Ảnh gắn vào CĂN/KHU → Drive xếp đúng folder, khỏi thành kho ảnh chung không ai tìm ra. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-600">Toà</span>
            <input value={toa} onChange={(e) => setToa(e.target.value)} placeholder="B1 (bỏ trống nếu khu public)"
              className="h-7 w-[190px] rounded border border-slate-300 px-2 text-[12px] text-slate-800" />
            <span className="font-semibold text-slate-600">Căn / Khu</span>
            <input value={can} onChange={(e) => setCan(e.target.value)} placeholder="609 hoặc tên khu"
              className="h-7 w-[190px] rounded border border-slate-300 px-2 text-[12px] text-slate-800" />
          </div>
          <div className="text-[11px] text-slate-500">
            {can.trim()
              ? <>Ảnh sẽ vào <b className="text-slate-700">Media / {projName || "Dự án"} / {toa.trim() ? toa.trim() + " / " : ""}{can.trim()} / Hình ảnh</b> trên Drive.</>
              : "Nhập Căn / Khu thì ảnh mới được đẩy lên Drive đúng folder; để trống thì ảnh chỉ lưu trong app."}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className={`cursor-pointer rounded bg-slate-700 px-3 py-1 font-semibold text-white hover:bg-slate-800 ${busy || total >= PROJIMG_MAX_CLIENT ? "pointer-events-none opacity-50" : ""}`}>
              {busy ? "Đang xử lý…" : "Chọn ảnh… (nhiều)"}
              <input type="file" accept="image/*" multiple className="hidden" disabled={busy || total >= PROJIMG_MAX_CLIENT} onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
            </label>
            {pending.length > 0 && (
              <button onClick={() => void saveAdds()} disabled={saving} className="rounded bg-teal-700 px-3 py-1 font-semibold text-white hover:bg-teal-800 disabled:opacity-50">{saving ? "Đang lưu…" : `Lưu ${pending.length} ảnh mới`}</button>
            )}
            {canManage && existing.length > 0 && <button onClick={() => void clearAll()} disabled={saving} className="ml-auto rounded px-2 py-1 font-medium text-slate-500 hover:text-red-600">Xoá tất cả</button>}
          </div>
          <div className="text-[10.5px] leading-tight text-slate-500">Chọn <b>nhiều ảnh</b> một lúc; ảnh được <b>nén tự động</b> (cạnh ~1600px) rồi lưu chung. Mọi người bấm <b>tên dự án</b> để xem cả bộ. Ảnh hiện <b>thay cho</b> ma trận link (nếu có cả hai, tên mở ảnh, 📊 mở ma trận).</div>
          {err && <div className="text-[11px] font-medium text-red-600">{err}</div>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-3">
          {total === 0 ? (
            cur.isFetching ? <div className="py-16 text-center text-sm text-slate-400">Đang tải ảnh hiện có…</div>
              : <div className="py-16 text-center text-sm text-slate-400">Chưa có ảnh. Bấm <b>Chọn ảnh…</b> để thêm (chọn được nhiều).</div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
              {existing.map((im, k) => (
                <div key={`e${k}`} className="group relative overflow-hidden rounded border border-slate-200 bg-white">
                  <img src={im.data} alt="" className="h-24 w-full object-cover" />
                  <div className="truncate px-1 py-0.5 text-[9px] text-slate-500">{fmtImgWhen(im.at)}</div>
                  {canManage && <button onClick={() => void removeExisting(k)} disabled={saving} title="Xoá ảnh này"
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100"><X className="h-3 w-3" /></button>}
                </div>
              ))}
              {pending.map((d, k) => (
                <div key={`p${k}`} className="group relative overflow-hidden rounded border-2 border-teal-400 bg-white">
                  <img src={d} alt="" className="h-24 w-full object-cover" />
                  <div className="truncate bg-teal-50 px-1 py-0.5 text-[9px] font-medium text-teal-700">mới · chưa lưu</div>
                  <button onClick={() => setPending((p) => p.filter((_, j) => j !== k))} title="Bỏ ảnh này"
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity hover:bg-red-600 group-hover:opacity-100"><X className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const CHAT_MSG_MAX = 1000;

/** Bảng phân cấp email→cấp (KV, seed DEFAULT_ROLES) cấp qua context → RoleBadge (nằm sâu trong
 *  ChatCell/ChatBox) đọc ĐỘNG, không phải truyền prop qua nhiều lớp; admin đổi là badge tự cập nhật. */
const RolesCtx = createContext<Record<string, UserRole>>(DEFAULT_ROLES);

/** BADGE cấp bậc đứng TRƯỚC tên người trong box chat — nhìn ra ai PMO, ai BOD (đọc bảng phân cấp
 *  động từ RolesCtx). Email chưa được phân cấp → không hiện badge. */
function RoleBadge({ email }: { email: string }) {
  const role = roleOf(useContext(RolesCtx), email);
  if (!role) return null;
  const meta = ROLE_META[role];
  return (
    <span className={`inline-block shrink-0 rounded px-1 text-[8px] font-bold uppercase leading-[1.5] tracking-wide ${meta.badge}`}
      title={meta.label}>{meta.short}</span>
  );
}

// Callback của 1 ô chat (ChatCell/ChatBox): field ("note"/"action") do component CHA gắn sẵn qua
// closure khi tạo onOp, nên đây chỉ nhận (op, opts). (onMsgOp cấp trên mới cầm đủ key+field+op+opts.)
type MsgOp = (op: "add" | "edit" | "hide" | "unhide" | "delete" | "sethi" | "hiall" | "unhiall", opts?: { text?: string; msgId?: string; hi?: HiRange[] | null; replyTo?: string; replyText?: string }) => Promise<boolean>;

/** Ô BẢNG (Vướng mắc / Giải pháp): mỗi message KHÔNG ẩn = 1 BONG BÓNG CHAT vàng nhạt (hiện người
 *  nhập + ngày giờ). `dark` = hàng gộp dự án (nền navy) → giữ kiểu chữ trắng đơn giản (không bong
 *  bóng). `onOp` + `myEmail`/`isAdmin`: tác giả (hoặc admin) SỬA được ngay trên bảng (nút ✎). */
function ChatCell({ msgs, dark, field, myEmail, isAdmin, onOp, onOpen, onReply, today }: {
  msgs: ChatMsg[]; dark?: boolean; field?: "note" | "action";
  myEmail?: string | null; isAdmin?: boolean; onOp?: MsgOp; onOpen?: () => void;
  /** Chỉ ô VƯỚNG MẮC: bấm ↩ để trả lời (mở box Giải pháp cùng dòng, đính trích dẫn). Ai cũng dùng được. */
  onReply?: (m: ChatMsg) => void; today?: string;
}) {
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const isPmo = roleOf(useContext(RolesCtx), myEmail) === "PMO";
  const vis = msgs.filter((m) => !m.hidden);
  // F16 — mở box NGAY khi click (bỏ delay 230ms cho admin). Tô/bỏ màu đỏ giờ là 1 NÚT (không nhấp đúp).
  const openDelayed = () => onOpen?.();
  // DARK (hàng dự án): giữ nguyên kiểu cũ — chữ trắng đậm, không bong bóng (mở/sửa qua dialog do <td> lo).
  if (dark) {
    if (!vis.length) return <span className="text-[10px] text-white/80 print:hidden">＋ nhập…</span>;
    return (
      <div className="space-y-1 font-bold leading-snug text-white">
        {vis.map((m) => <div key={m.id} className="whitespace-pre-line"><HiText text={m.text} ranges={m.hi ?? []} field={field} boldOnly /></div>)}
      </div>
    );
  }
  if (!vis.length) return <span onClick={onOpen} className="cursor-pointer text-slate-400 print:hidden">＋ nhập…</span>;
  // TÁC GIẢ, ADMIN, hoặc PMO đều SỬA/ẨN/XOÁ được comment người khác (chốt 31/07). PMO ngang admin ở 3 thao tác này.
  const canEdit = (m: ChatMsg) => !!onOp && (!!isAdmin || isPmo || (!!myEmail && m.author === myEmail));
  const canHide = canEdit;
  return (
    <div className="space-y-1.5" onClick={openDelayed}>
      {vis.map((m) => editId === m.id ? (
        <div key={m.id} onClick={(e) => e.stopPropagation()} className="rounded-lg rounded-tl-none border border-amber-300 bg-amber-50 p-1.5">
          <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value.slice(0, CHAT_MSG_MAX))} rows={2}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.stopPropagation(); setEditId(null); return; }
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void (async () => { const t = draft.trim(); if (t && t !== m.text) { const ok = await onOp!("edit", { msgId: m.id, text: t }); if (ok) setEditId(null); } else setEditId(null); })(); }
            }}
            className="w-full resize-y rounded border border-slate-300 px-1.5 py-1 text-[11px] leading-snug focus:border-teal-600 focus:outline-none" />
          <div className="mt-1 flex items-center justify-end gap-2">
            <button type="button" onClick={(e) => { e.stopPropagation(); setEditId(null); }} className="text-[10px] text-slate-500 hover:text-slate-800">Huỷ</button>
            <button type="button" onClick={async (e) => { e.stopPropagation(); const t = draft.trim(); if (t && t !== m.text) { const ok = await onOp!("edit", { msgId: m.id, text: t }); if (ok) setEditId(null); } else setEditId(null); }}
              className="rounded bg-teal-700 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-teal-800">Lưu</button>
          </div>
        </div>
      ) : (
        <div key={m.id}
          className="rounded-lg rounded-tl-none border border-amber-200 bg-amber-50 px-2 py-1">
          <div className="mb-0.5 flex items-center gap-1.5 text-[10px] leading-none text-slate-900">
            <UpdateChip date={m.at} today={today ?? ""} />
            {m.author !== "(cũ)" && <><RoleBadge email={m.author} /><span className="font-semibold text-slate-900">{m.author.split("@")[0]}</span></>}
            {((field === "note" && onReply) || canHide(m) || ((isAdmin || isPmo) && !!onOp)) && (
              <span className="ml-auto flex shrink-0 items-center gap-1.5 text-slate-500">
                {field === "note" && onReply && (
                  <button type="button" title="Trả lời → sang Giải pháp" onClick={(e) => { e.stopPropagation(); onReply(m); }} className="hover:text-teal-700"><Reply className="h-3.5 w-3.5" /></button>
                )}
                {/* TÔ / BỎ màu tin này — ADMIN & PMO. Màu theo cột: Vướng mắc = ĐỎ, Giải pháp = XANH NAVY (do HiText quyết định). */}
                {(isAdmin || isPmo) && onOp && (() => { const on = (m.hi?.length ?? 0) > 0; const navy = field === "action"; return (
                  <button type="button" title={`Tô / bỏ màu ${navy ? "xanh navy" : "đỏ"} tin này`} onClick={(e) => { e.stopPropagation(); void onOp("sethi", { msgId: m.id, hi: on ? null : [[0, m.text.length]] }); }}
                    className={on ? (navy ? "text-blue-900" : "text-red-600") : (navy ? "hover:text-blue-900" : "hover:text-red-600")}><Highlighter className="h-3 w-3" /></button>
                ); })()}
                {canEdit(m) && <button type="button" title="Sửa" onClick={(e) => { e.stopPropagation(); setEditId(m.id); setDraft(m.text); }} className="hover:text-teal-700"><Pencil className="h-3 w-3" /></button>}
                {canHide(m) && <button type="button" title="Ẩn (coi như đã giải quyết)" onClick={(e) => { e.stopPropagation(); void onOp!("hide", { msgId: m.id }); }} className="hover:text-teal-700"><EyeOff className="h-3.5 w-3.5" /></button>}
              </span>
            )}
          </div>
          {/* GIẢI PHÁP là câu trả lời cho 1 vướng mắc → hiện trích dẫn "↩ …" để biết trả lời cái nào. */}
          {m.replyText && (
            <div className="mb-0.5 flex items-start gap-1 rounded border-l-2 border-teal-400 bg-teal-50/70 px-1.5 py-0.5 text-[9px] leading-tight text-slate-500">
              <Reply className="mt-px h-2.5 w-2.5 shrink-0 -scale-x-100" /><span className="line-clamp-1">{m.replyText}</span>
            </div>
          )}
          <div className="whitespace-pre-line text-[11px] leading-snug text-slate-900"><HiText text={m.text} ranges={m.hi ?? []} field={field} /></div>
        </div>
      ))}
    </div>
  );
}

/** BOX CHAT trong dialog: danh sách message (ai · lúc nào) + soạn tin mới. Ẩn/mở ẩn ai cũng được;
 *  XOÁ chỉ admin; nhấp đúp 1 từ để tô/bỏ tô đỏ (admin). */
/** F2 — GIỮ NHÁP chat theo key (mở/đóng popup không mất đoạn đang soạn). Module-level (sống qua unmount). */
function ChatBox({ msgs, isAdmin, myEmail, field, onOp, reply, onClearReply, onClose, draftKey }: { msgs: ChatMsg[]; isAdmin: boolean; myEmail?: string | null; field: "note" | "action"; onOp: MsgOp; reply?: { toId: string; text: string }; onClearReply?: () => void; onClose: () => void; draftKey: string }) {
  useEscapeToClose(onClose);   // F9/F2 — Esc đóng popup (an toàn vì nháp đã được giữ theo key)
  const [draft, setDraftRaw] = useState(() => chatDraftStore.get(draftKey));
  const setDraft = (v: string) => { setDraftRaw(v); chatDraftStore.set(draftKey, v); };
  const [sending, setSending] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const noun = field === "note" ? "vướng mắc" : "giải pháp";
  const isPmo = roleOf(useContext(RolesCtx), myEmail) === "PMO";
  // TÁC GIẢ / ADMIN / PMO đều SỬA + ẨN + XOÁ được comment người khác (PMO ngang admin ở 3 thao tác này).
  const canEdit = (m: ChatMsg) => isAdmin || isPmo || (!!myEmail && m.author === myEmail);
  const canHide = canEdit;
  const canDelete = isAdmin || isPmo;
  // Gửi tin (F1/F3): await server; CHỈ xoá nháp khi gửi THÀNH CÔNG (lỗi → giữ nguyên đoạn đã gõ + báo).
  const send = async () => {
    const t = draft.trim();
    if (!t || sending) return;
    setSending(true);
    const ok = await onOp("add", { text: t.slice(0, CHAT_MSG_MAX), ...(reply ? { replyTo: reply.toId, replyText: reply.text } : {}) });
    setSending(false);
    if (ok) { setDraft(""); onClearReply?.(); }
  };
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="max-h-[46vh] space-y-2 overflow-auto pr-1">
        {msgs.length === 0
          ? <div className="py-6 text-center text-[12px] text-slate-400">Chưa có {noun} nào. Soạn ở ô dưới rồi bấm Gửi.</div>
          : msgs.map((m) => (
            <div key={m.id} className={`rounded-lg border px-3 py-2 ${m.hidden ? "border-dashed border-slate-300 bg-slate-50" : "border-amber-200 bg-amber-50"}`}>
              <div className="mb-1 flex items-center gap-2 text-[10px] text-slate-500">
                {m.author !== "(cũ)" && <RoleBadge email={m.author} />}
                <span className="font-semibold text-slate-800">{m.author === "(cũ)" ? "(cũ)" : (m.author || "?").split("@")[0]}</span>
                <span className="tabular-nums">{fmtMsgTime(m.at)}</span>
                {m.hidden && <span className="rounded bg-slate-200 px-1 text-[9px] font-bold text-slate-600">ĐÃ ẨN</span>}
                <span className="ml-auto flex items-center gap-2">
                  {canEdit(m) && editId !== m.id && <button type="button" onClick={() => { setEditId(m.id); setEditDraft(m.text); }} className="font-medium text-teal-700 hover:underline">Sửa</button>}
                  {canHide(m) && <button type="button" onClick={() => void onOp(m.hidden ? "unhide" : "hide", { msgId: m.id })} className="font-medium text-teal-700 hover:underline">{m.hidden ? "Mở ẩn" : "Ẩn"}</button>}
                  {canDelete && <button type="button" onClick={() => void onOp("delete", { msgId: m.id })} className="font-medium text-red-600 hover:underline">Xoá</button>}
                </span>
              </div>
              {editId === m.id ? (
                <div>
                  <textarea autoFocus value={editDraft} onChange={(e) => setEditDraft(e.target.value.slice(0, CHAT_MSG_MAX))} rows={5}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") { setEditId(null); return; }
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void (async () => { const t = editDraft.trim(); if (t && t !== m.text) { setSavingEdit(true); const ok = await onOp("edit", { msgId: m.id, text: t }); setSavingEdit(false); if (ok) setEditId(null); } else setEditId(null); })(); }
                    }}
                    className="w-full resize-y rounded border border-slate-300 px-2 py-1.5 text-[13px] leading-relaxed focus:border-teal-600 focus:outline-none" style={{ minHeight: "7rem" }} />
                  <div className="mt-1 flex items-center justify-end gap-2">
                    <button type="button" onClick={() => setEditId(null)} className="text-[11px] text-slate-500 hover:text-slate-800">Huỷ</button>
                    <button type="button" disabled={savingEdit} onClick={async () => { const t = editDraft.trim(); if (t && t !== m.text) { setSavingEdit(true); const ok = await onOp("edit", { msgId: m.id, text: t }); setSavingEdit(false); if (ok) setEditId(null); } else setEditId(null); }}
                      className="rounded bg-teal-700 px-3 py-1 text-[11px] font-semibold text-white hover:bg-teal-800 disabled:opacity-50">{savingEdit ? "Đang lưu…" : "Lưu"}</button>
                  </div>
                </div>
              ) : (
                <>
                  {m.replyText && (
                    <div className="mb-1 flex items-start gap-1 rounded border-l-2 border-teal-400 bg-teal-50/70 px-2 py-1 text-[11px] text-slate-500">
                      <Reply className="mt-0.5 h-3 w-3 shrink-0 -scale-x-100 text-teal-600" /><span className="line-clamp-2"><b className="text-teal-700">Trả lời:</b> {m.replyText}</span>
                    </div>
                  )}
                  <div className={`whitespace-pre-line text-[13px] leading-relaxed ${m.hidden ? "text-slate-400" : "text-slate-800"}`}>
                    <HiText text={m.text} ranges={m.hi ?? []} field={field} />
                  </div>
                </>
              )}
            </div>
          ))}
      </div>
      <div className="border-t border-slate-100 pt-2">
        {/* VÍ DỤ MINH HOẠ cách viết (giữ lại như dialog cũ) — theo cột: Vướng mắc / Giải pháp. */}
        <div className="mb-2 rounded-md bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
          Cụ thể, <b>rõ việc, rõ người, rõ deadline</b>.
        </div>
        {/* Đang trả lời 1 vướng mắc → hiện trích dẫn phía trên ô soạn, có × để bỏ. */}
        {reply && (
          <div className="mb-2 flex items-start gap-1.5 rounded-md border-l-2 border-teal-400 bg-teal-50 px-2 py-1.5 text-[11px] text-slate-600">
            <Reply className="mt-0.5 h-3 w-3 shrink-0 -scale-x-100 text-teal-600" />
            <span className="flex-1"><b className="text-teal-700">Trả lời vướng mắc:</b> <span className="line-clamp-2">{reply.text}</span></span>
            {onClearReply && <button type="button" title="Bỏ trả lời" onClick={onClearReply} className="shrink-0 text-slate-400 hover:text-slate-700"><X className="h-3 w-3" /></button>}
          </div>
        )}
        <textarea value={draft} onChange={(e) => setDraft(e.target.value.slice(0, CHAT_MSG_MAX))} rows={2}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void send(); } }}
          placeholder={reply ? "Soạn giải pháp trả lời…" : `Soạn ${noun} mới…`} className="w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-[13px] leading-relaxed focus:border-teal-600 focus:outline-none" />
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-[10px] leading-tight text-slate-400">Ctrl/⌘ + Enter để gửi nhanh.</span>
          <button type="button" onClick={() => void send()} disabled={!draft.trim() || sending} className="shrink-0 rounded-md bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-40">{sending ? "Đang gửi…" : "Gửi"}</button>
        </div>
      </div>
    </div>
  );
}

/** ĐÓNG dialog bằng phím ESC (F9). Dùng STACK để chỉ dialog TRÊN CÙNG đóng khi có nhiều lớp lồng nhau
 *  (vd xem trước PDF nằm trong ComplianceDialog → Esc đóng preview trước, Esc lần nữa mới đóng dialog). */
const __escStack: Array<() => void> = [];
let __escBound = false;
function useEscapeToClose(onClose: () => void) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!__escBound) {
      __escBound = true;
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && __escStack.length) __escStack[__escStack.length - 1]();
      });
    }
    const fn = () => ref.current();
    __escStack.push(fn);
    return () => { const i = __escStack.lastIndexOf(fn); if (i >= 0) __escStack.splice(i, 1); };
  }, []);
}

/** XEM TRƯỚC PDF trong app — iframe blob + Tải xuống / In / Đóng. Soát trước khi in cho đẹp, không tải ngay. */
function PdfPreviewDialog({ url, fileName, onClose }: { url: string; fileName: string; onClose: () => void }) {
  useEscapeToClose(onClose);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => () => { try { URL.revokeObjectURL(url); } catch { /* */ } }, [url]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 p-4 print:hidden">
      <div className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-teal-700">Xem trước PDF</div>
            <div className="truncate text-sm font-bold text-slate-900" title={fileName}>{fileName}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={() => { try { iframeRef.current?.contentWindow?.print(); } catch { /* */ } }}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100">In</button>
            <a href={url} download={fileName}
              className="rounded-md bg-teal-700 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-800">Tải xuống</a>
            <button onClick={onClose} aria-label="Đóng" title="Đóng" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <iframe ref={iframeRef} src={url} title="Xem trước PDF" className="min-h-0 flex-1 bg-slate-100" />
      </div>
    </div>,
    document.body,
  );
}

/** Nút "Xuất PDF" dạng DROPDOWN — bấm xổ ra chọn khổ NGANG / DỌC (gộp 2 nút cho gọn toolbar).
 *  `busy` = đang xuất (hiện spinner), `disabled` = chưa có dữ liệu để xuất. `tone` = màu nút.
 *  `portraitHint` = phụ đề dòng "Khổ dọc" (vd bảng rộng: dọc gói gọn nhiều dòng/trang → ÍT TRANG hơn). */
function PdfExportMenu({ onPrint, onCombined, disabled = false, busy = false, tone = "bg-slate-900 hover:bg-slate-700", portraitHint = "điện thoại", portraitOnly = false }:
  { onPrint: (o: "landscape" | "portrait", mode: "download" | "preview") => void; onCombined?: (o: "landscape" | "portrait", mode: "download" | "preview") => void; disabled?: boolean; busy?: boolean; tone?: string; portraitHint?: string; portraitOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const pick = (o: "landscape" | "portrait", mode: "download" | "preview") => { setOpen(false); onPrint(o, mode); };
  const pickC = (o: "landscape" | "portrait", mode: "download" | "preview") => { setOpen(false); onCombined?.(o, mode); };
  const itemCls = "flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-100";
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} disabled={disabled || busy} title="Xuất PDF — xem trước hoặc tải xuống, khổ ngang/dọc"
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40 ${tone}`}>
        {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />} Xuất PDF <span className="text-[8px] leading-none">▼</span>
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-md border border-slate-200 bg-white py-1 text-[11px] shadow-lg">
          <div className="px-3 pb-1 pt-1 text-[9px] font-medium text-slate-400">{onCombined ? "Báo cáo tuân thủ (khổ dọc A4)" : portraitOnly ? "Khổ dọc A4 → xem trước → Tải xuống / In" : "Chọn khổ → xem trước → Tải xuống / In"}</div>
          <button onClick={() => pick("portrait", "preview")} className={itemCls}><span className="text-slate-400">▯</span> {onCombined ? "Xuất riêng (khổ dọc)" : `Khổ dọc (A4 · ${portraitHint})`}</button>
          {!onCombined && !portraitOnly && <button onClick={() => pick("landscape", "preview")} className={itemCls}><span className="text-slate-400">▭</span> Khổ ngang (A4)</button>}
          {onCombined && (
            <>
              <div className="my-1 border-t border-slate-100" />
              <div className="px-3 pb-1 pt-1 text-[9px] font-medium text-slate-400">Gộp: Tóm tắt (trang 1) + Chi tiết (trang 2+)</div>
              <button onClick={() => pickC("portrait", "preview")} className={itemCls}><span className="text-slate-400">▯</span> Xuất gộp (khổ dọc)</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Menu nhỏ "Xuất báo cáo" (dưới mã dự án) → chọn PDF hoặc Slide (.pptx). Menu mở qua portal
 *  (position:fixed) để không bị bảng cắt; bấm ngoài/cuộn thì đóng. stopPropagation để không xổ nhóm. */
function ExportReportMenu({ onSlide, onPdf }: { onSlide: () => void; onPdf: () => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ x: Math.min(r.left, window.innerWidth - 170), y: r.bottom + 4 });
    setOpen((v) => !v);
  };
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("mousedown", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("mousedown", close);
    };
  }, [open]);
  const pick = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); setOpen(false); fn(); };
  return (
    <>
      <button ref={btnRef} type="button" onClick={toggle}
        className="inline-flex items-center gap-0.5 whitespace-nowrap rounded border border-white/25 bg-white/10 px-1 py-0.5 text-white/85 hover:border-amber-200 hover:bg-white/20 hover:text-amber-100"
        title="Xuất báo cáo dự án — chọn PDF hoặc Slide (.pptx)">
        <FileDown className="h-3 w-3 shrink-0" /><span className="text-[0.7em] leading-none">▾</span>
      </button>
      {open && pos && createPortal(
        <div style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 90 }}
          onMouseDown={(e) => e.stopPropagation()}
          className="min-w-[158px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-slate-700 shadow-xl">
          <button type="button" onClick={pick(onPdf)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] font-medium hover:bg-teal-50">
            <FileDown className="h-3.5 w-3.5 text-rose-600" />Bản PDF
          </button>
          <button type="button" onClick={pick(onSlide)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] font-medium hover:bg-teal-50">
            <FileDown className="h-3.5 w-3.5 text-orange-500" />Bản Slide (.pptx)
          </button>
        </div>, document.body)}
    </>
  );
}

function FlatTablePanel({ items, mpMode, mpProjectRows, groupMode, groups, deadlineMonthOptions, regionOptions, groupDAOptions, pmOptions, pesOptions, showGanttChildTasks, ganttRows, today, isAdmin, myEmail, installLinks, onOpenSummary, sheetViews, canSetupLink, onSetupLink, projImgIdx, onOpenImage, onOpenVideo, onSetupImage, onExportReport, onExportPdf, filters, setFilters, sortChain, onSort, showDone, onToggleDone, showHidden, onToggleShowHidden, hiddenCount, onHideRow, completedDates, onPrint, onExportExcel, onMsgOp }: {
  items: EnrichedItem[];
  /** Chế độ "Cần cập nhật MP": bảng gộp — mỗi dự án 1 dòng. */
  mpMode: boolean;
  mpProjectRows: MpProjectRow[];
  /** Chế độ "Bàn giao tháng này": gộp theo dự án, sổ ra công đoạn. */
  groupMode: boolean;
  groups: DueMonthGroup[];
  totalAlertsCount: number;
  deadlineMonthOptions: { v: string; l: string }[];
  regionOptions: { v: string; l: string }[];
  groupDAOptions: { v: string; l: string }[];
  pmOptions: { v: string; l: string }[];
  pesOptions: { v: string; l: string }[];
  /** Cờ tính năng — ẩn/hiện tác vụ con Gantt theo bản LIVE/DEV (xem lib/flags.ts). */
  showGanttChildTasks: boolean;
  ganttRows: GanttRow[];
  today: string;
  /** AI ĐANG XEM có phải admin không — chỉ admin được TÔ ĐỎ + xoá; email để biết tin nào của mình (được sửa). */
  isAdmin: boolean;
  myEmail: string | null;
  /** Map maCT → fileId Summary (ô "Thi công lắp đặt" đã hyperlink). Bấm → mở popup. */
  installLinks?: Record<string, string>;
  onOpenSummary?: (t: { fileId: string; sheet?: string; range?: string; tl?: string; br?: string; snap?: boolean; snapKey?: string; hideAdmin?: boolean; name?: string }) => void;
  sheetViews?: SheetViewMap;
  canSetupLink?: boolean;
  onSetupLink?: (key: string, name: string, cfg?: SheetViewCfg) => void;
  /** ẢNH DỰ ÁN (PMO gắn): index nhẹ (dòng nào có ảnh); mở popup ảnh; PMO mở dialog thêm-gỡ ảnh. */
  projImgIdx?: ProjImgIdx;
  onOpenImage?: (key: string, name: string) => void;
  onOpenVideo?: (name: string) => void;
  onSetupImage?: (key: string, name: string, hid?: string) => void;
  /** Xuất báo cáo cho 1 dự án — nhận nguyên group để phía cha tra data đầy đủ. Slide = .pptx, Pdf = .pdf. */
  onExportReport?: (g: DueMonthGroup) => void;
  onExportPdf?: (g: DueMonthGroup) => void;
  filters: Filters;
  setFilters: (f: Filters | ((p: Filters) => Filters)) => void;
  sortChain: SortSpec[];
  onSort: (k: SortKey) => void;
  /** Bật/tắt "Hiện tất cả đầu việc" (kể cả đã hoàn thành). */
  showDone: boolean;
  onToggleDone: () => void;
  /** DÒNG ẨN THỦ CÔNG (admin): showHidden = đang soi các dòng đã ẩn; hiddenCount = số dòng đang ẩn;
   *  onHideRow = ẩn/bỏ ẩn 1 dòng. Chỉ admin thấy nút; server vẫn chốt quyền. */
  showHidden: boolean;
  onToggleShowHidden: () => void;
  hiddenCount: number;
  onHideRow: (key: string, label: string, hide: boolean) => void;
  /** Ngày kết thúc THỰC TẾ (ngày lần đầu đạt 100%) theo itemKey — hiện dưới ô "Ngày kết thúc". */
  completedDates: CompletedDates;
  onPrint: (orientation: "landscape" | "portrait", mode: "download" | "preview") => void;
  onExportExcel: () => void | Promise<void>;
  /** Lưu chỉnh sửa (Vướng mắc/PIC/Deadline) lên backend dùng chung. */
  onMsgOp: (key: string, field: "note" | "action", op: "add" | "edit" | "hide" | "unhide" | "delete" | "sethi" | "hiall" | "unhiall", opts?: { text?: string; msgId?: string; hi?: HiRange[] | null; replyTo?: string; replyText?: string }) => Promise<boolean>;
}) {
  const activeCount =
    filters.depts.length + filters.stages.length + filters.alerts.length
    + filters.deadlineMonths.length + filters.regions.length + filters.groupDAs.length + filters.pms.length + filters.pes.length
    + (filters.query.trim() ? 1 : 0)
    + (filters.mpOnly ? 1 : 0) + (filters.dueThisMonth ? 1 : 0) + (filters.topKey ? 1 : 0);
  const [exporting, setExporting] = useState(false);
  // Cách trình bày bảng: "list" = bảng cảnh báo hiện tại; "gantt" = biểu đồ tổng thể tiến độ.
  const [viewMode, setViewMode] = useState<"list" | "gantt">("list");
  // F7 — nhớ chế độ xem (Danh sách / Tổng thể tiến độ) qua reload. Đọc sau mount, ghi khi đổi.
  const [vmRestored, setVmRestored] = useState(false);
  useEffect(() => {
    try { const v = localStorage.getItem("pmo.viewMode"); if (v === "gantt" || v === "list") setViewMode(v); } catch { /* */ }
    setVmRestored(true);
  }, []);
  useEffect(() => {
    if (!vmRestored) return;
    try { localStorage.setItem("pmo.viewMode", viewMode); } catch { /* */ }
  }, [viewMode, vmRestored]);
  // Xổ tác vụ con của Gantt — giữ ở đây (không trong GanttView) để NÚT trên toolbar dùng chung.
  const [ganttExpanded, setGanttExpanded] = useState<Set<string>>(new Set());
  const ganttAllKeys = ganttRows.map(r => r.key);
  const ganttAllOpen = ganttAllKeys.length > 0 && ganttAllKeys.every(k => ganttExpanded.has(k));
  const ganttHasChildren = showGanttChildTasks && ganttRows.some(r => r.children.length > 0);
  // Toàn màn hình RIÊNG phần table (như F11 nhưng chỉ khối này) — dùng Fullscreen API.
  const panelRef = useRef<HTMLElement>(null);
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const onFs = () => setIsFs(document.fullscreenElement === panelRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const toggleFullscreen = () => {
    const el = panelRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };
  // ── ĐỘ RỘNG CỘT KÉO CHỈNH ĐƯỢC + ĐẶT LẠI ──────────────────────────────────────
  // Kéo mép PHẢI mỗi tiêu đề để chỉnh rộng; phần chênh bù từ cột KẾ BÊN (giữ tổng 100%).
  // Lưu localStorage riêng từng trình duyệt; nút "Đặt lại cột" xoá lưu → về mặc định.
  // Lần render đầu = DEFAULT (khớp SSR) rồi nạp bản đã lưu SAU mount → tránh lệch hydration.
  // HAI bố cục riêng: bảng NHÓM theo dự án (12 cột) và bảng thường/lọc/MP (13 cột) — mỗi bố
  // cục có bộ rộng + khoá lưu riêng, chọn theo `groupMode`.
  const [flatColW, setFlatColW] = useState<number[]>(DEFAULT_COL_W);
  const [groupColW, setGroupColW] = useState<number[]>(GROUP_COL_W);
  useEffect(() => {
    const load = (key: string, def: number[], set: (a: number[]) => void) => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length === def.length && arr.every((n) => typeof n === "number" && n > 0)) set(arr);
      } catch { /* */ }
    };
    load(LS_COLW, DEFAULT_COL_W, setFlatColW);
    load(LS_COLW_GROUP, GROUP_COL_W, setGroupColW);
  }, []);
  // Bố cục ĐANG hiển thị (nhóm theo dự án dùng bộ cột riêng; mp & lọc-hạng-mục có groupMode=false).
  const colW = groupMode ? groupColW : flatColW;
  const setColWActive = groupMode ? setGroupColW : setFlatColW;
  const lsKeyActive = groupMode ? LS_COLW_GROUP : LS_COLW;
  const defaultWActive = groupMode ? GROUP_COL_W : DEFAULT_COL_W;
  const headerCols = groupMode ? HEADER_COLS_GROUP : HEADER_COLS;
  const isColWCustom = colW.some((w, i) => Math.abs(w - defaultWActive[i]) > 0.001);
  const resetColW = () => {
    setColWActive(defaultWActive);
    try { localStorage.removeItem(lsKeyActive); } catch { /* */ }
  };
  const MIN_COLW = 2; // % tối thiểu mỗi cột (không cho kéo mất hẳn)
  const startColResize = (i: number, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const j = i + 1; // cột kế bên bù trừ (cột CUỐI không gắn tay kéo nên i luôn có i+1)
    const table = (e.target as HTMLElement).closest("table");
    const totalPx = table?.getBoundingClientRect().width ?? 1000;
    const startX = e.clientX;
    const base = colW.slice();
    const move = (ev: MouseEvent) => {
      const d = ((ev.clientX - startX) / totalPx) * 100;
      let a = base[i] + d, b = base[j] - d;
      if (a < MIN_COLW) { b -= MIN_COLW - a; a = MIN_COLW; }
      if (b < MIN_COLW) { a -= MIN_COLW - b; b = MIN_COLW; }
      const next = base.slice(); next[i] = a; next[j] = b;
      setColWActive(next);
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      setColWActive((cur) => { try { localStorage.setItem(lsKeyActive, JSON.stringify(cur)); } catch { /* */ } return cur; });
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  // Chế độ nhóm: các dự án đang mở (sổ ra công đoạn). Mặc định thu gọn hết.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) => setExpandedGroups(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const allExpanded = groupMode && groups.length > 0 && groups.every(g => expandedGroups.has(g.key));

  // Mọi hàng cao BẰNG NHAU, canh giữa dọc. Đo sau khi layout ổn định (rAF) và
  // BỎ giá trị lạ (một hàng phồng gấp >2 lần trung vị = đo hụt lúc chuyển layout)
  // để không kéo cả bảng cao vống → tránh PDF thừa hàng chục trang.
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  useEffect(() => {
    const tb = tbodyRef.current;
    if (!tb) return;
    // Chế độ nhóm (accordion) — KHÔNG ép hàng bằng nhau (header + con cao khác nhau).
    if (groupMode) { Array.from(tb.rows).forEach(r => { r.style.height = ""; }); return; }
    let raf = 0;
    const equalize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // CHIỀU CAO TỰ NHIÊN: hàng có Vướng mắc nhiều dòng phải cao đủ để hiện hết.
        // (Trước đây ép mọi hàng bằng trung vị → note 3 dòng bị cắt/đè. Bỏ ép.)
        Array.from(tb.rows).forEach(r => { r.style.height = ""; });
      });
    };
    equalize();
    window.addEventListener("resize", equalize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", equalize); };
  }, [items, colW, mpMode, mpProjectRows, groupMode, expandedGroups]); // đổi cột/chế độ → đo lại


  // Hộp CHỈNH SỬA đầu việc (Vướng mắc / PIC / Deadline) — lưu backend dùng chung.
  /** `field` = đang sửa cột nào: "note" (Vướng mắc) hay "action" (Hành động / Cần xử lý).
   *  Hai cột dùng CHUNG dialog này, chỉ khác trường lưu xuống KV. */
  const [editView, setEditView] = useState<{ title: string; key: string; field: "note" | "action"; reply?: { toId: string; text: string } } | null>(null);
  // Chỉ mục message theo KHOÁ (đầu việc + Block con + cấp dự án) — box chat đọc LIVE ở đây nên tự
  // cập nhật sau mỗi thao tác (thêm/ẩn/xoá) mà không cần đóng-mở lại dialog.
  const msgIndex = useMemo(() => {
    const m = new Map<string, { note: ChatMsg[]; action: ChatMsg[] }>();
    for (const it of items) {
      m.set(it._key, { note: it._noteMsgs, action: it._actionMsgs });
      for (const b of (it._blockItems ?? [])) m.set(b._key, { note: b._noteMsgs, action: b._actionMsgs });
    }
    for (const g of groups) m.set(g.key, { note: g.noteMsgs ?? [], action: g.actionMsgs ?? [] });
    return m;
  }, [items, groups]);
  // Popover "số mã / tổng mã" khi bấm vào con số % thực tế (chỉ ô có chi tiết breakdown).
  const [codePop, setCodePop] = useState<{ x: number; y: number; item: EnrichedItem } | null>(null);
  useEffect(() => {
    if (!codePop) return;
    const close = () => setCodePop(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [codePop]);
  // Dropdown "Thi công lắp đặt": item nào đang xổ các Block con (khoá = itemKeyOf).
  const [expandedTC, setExpandedTC] = useState<Set<string>>(new Set());
  const toggleTC = (k: string) => setExpandedTC((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  // Popover chi tiết khi bấm % của 1 Block (bàn giao tinh/thô).
  const [blockPop, setBlockPop] = useState<{ x: number; y: number; block: BlockChild } | null>(null);
  useEffect(() => {
    if (!blockPop) return;
    const close = () => setBlockPop(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [blockPop]);
  const FIELD_LABEL = { note: "Vướng mắc", action: "Giải pháp" } as const;
  const openEdit = (it: EnrichedItem, field: "note" | "action" = "note") => {
    setEditView({ title: `${it.maCT || it.projectCode} · ${it.projectName} · ${it._stageLabel} · ${FIELD_LABEL[field]}`, key: it._key, field });
  };
  /** Vướng mắc / Giải pháp CẤP DỰ ÁN (chế độ gộp) — khoá = projectKey. */
  const openGroupEdit = (g: DueMonthGroup, field: "note" | "action" = "note") => {
    setEditView({ title: `${g.maCT} · ${g.name} · ${FIELD_LABEL[field]} (cấp dự án)`, key: g.key, field });
  };
  /** TRẢ LỜI 1 vướng mắc → mở box GIẢI PHÁP cùng dòng, đính sẵn trích dẫn vướng mắc (replyTo). */
  const openReply = (key: string, title: string, m: ChatMsg) => {
    setEditView({ title: `${title} · Giải pháp`, key, field: "action", reply: { toId: m.id, text: m.text.replace(/\s+/g, " ").trim().slice(0, 120) } });
  };

  const handleExportClick = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await onExportExcel();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Xuất Excel] lỗi:", err);
      toast.error(`Xuất Excel lỗi: ${msg}`);
    } finally {
      setExporting(false);
    }
  };

  // Sort state đã được LIFT lên Dashboard — bảng và PDF dùng chung mảng `items`
  // đã sort sẵn. KHÔNG sort lại ở đây để PDF khớp tuyệt đối với bảng.
  const toggleSort = onSort;
  const sortedItems = items;

  // Render 1 hàng công đoạn — dùng chung cho bảng phẳng và chế độ nhóm.
  const renderRow = (it: EnrichedItem, idx: number) => {
    const kind = it._alert;
    const actual = it.pctActual != null ? Math.round(it.pctActual) : null;
    const overdue = it.overdueDays || 0;
    // Cờ SỐ LIỆU % CẦN RÀ → chấm vàng nhỏ trước số. CHỈ ô "sạch" (có chi tiết SỐ MÃ và KHỚP)
    // mới không chấm; còn lại đều chấm: (a) chưa nhập; (b) nhập không hợp lệ; (c) KHÔNG có chi
    // tiết số mã (nhập tay, chưa đối chiếu được); (d) có số mã nhưng LỆCH. Tín hiệu NHẸ.
    const pctSuspect = (() => {
      if (it.pctActualInvalid) return true;                 // % lỗi định dạng → luôn cờ (mọi giai đoạn)
      if (!COUNT_STAGES.has(it.stage as string)) return false; // giai đoạn không nhập số mã → KHÔNG chấm
      if (it.pctActual == null) return true;                // giai đoạn cần số mà trống %
      if (!it.codeCounts?.length) return true;              // thiếu chi tiết số mã → cần rà
      const s = buildCodeSummary(it.codeCounts);
      return actual != null && s.avgPct != null && s.pooledPct != null &&
        Math.abs(actual - s.avgPct) >= 3 && Math.abs(actual - s.pooledPct) >= 3;
    })();
    // "Thi công lắp đặt" đã hyperlink file Summary → bấm chữ mở popup ma trận lắp đặt.
    // Link matrix gắn theo TỪNG DÒNG (khoá "id:"+STT). CHỈ dùng khoá maCT khi dòng KHÔNG có STT
    // (file cũ). CÓ STT mà KHÔNG có link riêng → KHÔNG mở (đừng rớt về maCT chung — 2 dự án cùng mã
    // như Mini Hotel thường vs B6-B9 sẽ mở NHẦM ma trận của nhau).
    const installFid = it.stage === "Thi công lắp đặt"
      ? (it.id ? installLinks?.["id:" + it.id] : installLinks?.[it.maCT])
      : undefined;
    // LINK PMO GẮN THẲNG — nay cho MỌI hạng mục (không chỉ Thi công lắp đặt). Khoá BỀN:
    //  • Thi công lắp đặt → khoá cấp dự án (Mã CT + Tên) — giữ nguyên link đã gắn trước đây.
    //  • Hạng mục khác → khoá cấp hạng mục (Mã CT + Tên + mô tả) → chèn/đổi STT không lệch.
    const linkKey = it.stage === "Thi công lắp đặt"
      ? stableProjKey(it.maCT, it.projectName)
      : `${stableProjKey(it.maCT, it.projectName)}::${(it.desc || it._stageLabel || "").trim().toLowerCase().replace(/\s+/g, " ")}`;
    const linkCfg = linkKey ? sheetViews?.[linkKey] : undefined;
    const viewLink = linkCfg?.fileId
      ? { fileId: linkCfg.gid ? `${linkCfg.fileId}|${linkCfg.gid}` : linkCfg.fileId, sheet: linkCfg.sheet, range: linkCfg.range, tl: linkCfg.tl, br: linkCfg.br, snap: linkCfg.snap, snapKey: linkKey, hideAdmin: true, chart: linkCfg.chart }
      : (installFid ? { fileId: installFid } : null);
    // ẢNH DỰ ÁN: gắn/xem ở HÀNG DỰ ÁN (header nhóm) theo khoá dự án — KHÔNG rải theo từng hạng mục ở đây.
    const nameLabel = groupMode ? it._stageLabel : it.projectName;
    const picDisplay = it._picEdited ? it._pic : picByStageConv(it.owner, it._stageId, it._projectPm);
    // Dropdown "Thi công lắp đặt": item TC có Block con → hiện mũi ▶ để xổ.
    const hasBlocks = (it.blocks?.length ?? 0) > 0;
    const blkKey = it._key;
    const isBlkOpen = hasBlocks && expandedTC.has(blkKey);
    return (
      <Fragment key={`${it.projectCode}-${it.rawCode}-${idx}`}>
      <tr className={`group border-b border-slate-100 align-middle ${it._hidden ? "bg-amber-50/60 opacity-60 hover:opacity-100" : (idx % 2 ? "bg-slate-50/40" : "bg-white")} hover:bg-teal-50/40`}
          title={it._hidden ? "Dòng đã ẩn thủ công — bấm 'Bỏ ẩn' để đưa lại vào báo cáo" : undefined}>
        {/* Ngày update — chip nhỏ, thang màu xanh→đỏ theo độ cũ (bảng phẳng). Ô này cũng là chỗ đặt
            nút ẨN (hiện khi rê chuột, chỉ admin) / BỎ ẨN (khi đang soi dòng ẩn) — print:hidden nên
            KHÔNG lọt vào PDF/Excel. */}
        <td className="border-r border-slate-100 px-1 py-1 text-center">
          {!groupMode && !it._hidden && <UpdateChip date={it.updateDate} today={today} />}
          {isAdmin && (it._hidden ? (
            <button type="button" title="Bỏ ẩn — đưa dòng này trở lại báo cáo"
              onClick={(e) => { e.stopPropagation(); onHideRow(it._key, `${it.projectCode} ${it.projectName} · ${stageAbbrOf(it._stageId)} — ${it._stageLabel}`, false); }}
              className="mx-auto flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-semibold text-amber-700 hover:bg-amber-100 print:hidden">
              <RotateCcw className="h-3 w-3" /> Bỏ ẩn
            </button>
          ) : (
            <button type="button" title="Ẩn dòng này khỏi báo cáo (hạng mục trong khuôn khổ, không cần raise)"
              onClick={(e) => { e.stopPropagation(); onHideRow(it._key, `${it.projectCode} ${it.projectName} · ${stageAbbrOf(it._stageId)} — ${it._stageLabel}`, true); }}
              className="mx-auto flex h-4 w-4 items-center justify-center rounded text-slate-400 opacity-0 transition-opacity hover:bg-slate-200 hover:text-slate-700 group-hover:opacity-100 print:hidden">
              <EyeOff className="h-3 w-3" />
            </button>
          ))}
        </td>
        {/* Cột "Mã": bảng NHÓM → dòng con hiện MÃ VIẾT TẮT hạng mục (dữ liệu cột Hạng mục cũ);
            bảng thường/lọc → hiện Mã CT. Mã gộp "CT25-040, 038…" kẹp 2 dòng cho hàng đều. */}
        {groupMode ? (
          <td className="border-r border-slate-100 px-1 py-1 font-semibold text-slate-700 leading-tight whitespace-nowrap" title={it._stageLabel}>
            {stageAbbrOf(it._stageId)}
          </td>
        ) : (
          <td className="border-r border-slate-100 px-1 py-1 text-slate-700 leading-tight" title={it.maCT}>
            <div className="line-clamp-2">
              {it.maCT
                ? it.maCT.split(",").map((s, i) => (
                    <div key={i} className="whitespace-nowrap">{s.trim()}</div>
                  ))
                : "—"}
            </div>
          </td>
        )}
        <td className="border-r border-slate-100 px-2 py-1">
          {/* Nhóm theo dự án: tên dự án đã ở HÀNG GỘP → dòng con hiện TÊN HẠNG MỤC (đầy đủ,
              không viết tắt) cho đỡ thừa. Khi lọc theo hạng mục (groupMode=false, mọi dòng cùng
              hạng mục) thì hiện lại TÊN DỰ ÁN vì đó mới là thứ để phân biệt. */}
          <div className="flex items-start gap-1">
            {/* ▶ xổ các Block con (chỉ item "Thi công lắp đặt" có dữ liệu Block). */}
            {hasBlocks && (
              <button type="button" onClick={(e) => { e.stopPropagation(); toggleTC(blkKey); }}
                title={isBlkOpen ? "Thu các Block" : "Xổ các Block (thi công lắp đặt)"}
                className="mt-0.5 shrink-0 text-[9px] leading-none text-slate-500 hover:text-teal-700">
                <span className="inline-block transition-transform" style={{ transform: isBlkOpen ? "rotate(90deg)" : "none" }}>▶</span>
              </button>
            )}
            <div className="min-w-0 flex-1">
              {viewLink ? (
                <button type="button"
                  onClick={(e) => { e.stopPropagation(); onOpenSummary?.({ ...viewLink, name: nameLabel }); }}
                  className="line-clamp-3 text-left font-semibold leading-tight text-teal-700 underline decoration-dotted decoration-1 underline-offset-2 hover:text-teal-900"
                  style={{ wordBreak: "break-word" }}
                  title="Bấm xem (ảnh PDF vùng đã gắn)">
                  {nameLabel} 📊
                </button>
              ) : (
                <div className="line-clamp-3 font-semibold text-black leading-tight" style={{ wordBreak: "break-word" }}
                     title={nameLabel}>{nameLabel}</div>
              )}
              {/* PMO: GẮN / SỬA link hiển thị — cho MỌI hạng mục (khoá bền). Ảnh dự án gắn ở HÀNG DỰ ÁN. */}
              {canSetupLink && linkKey && (
                <button type="button" onClick={(e) => { e.stopPropagation(); onSetupLink?.(linkKey, it.stage === "Thi công lắp đặt" ? it.projectName : `${it.projectName} · ${it.desc || it._stageLabel || ""}`, linkCfg); }}
                  className="mt-0.5 inline-flex items-center gap-0.5 text-[0.72em] font-medium text-slate-400 hover:text-teal-700 print:hidden"
                  title={linkCfg?.fileId ? "Sửa link hiển thị (PMO)" : "Gắn link hiển thị cho hạng mục (PMO)"}>
                  <Link2 className="h-3 w-3" />{linkCfg?.fileId ? "Sửa link" : "Gắn link"}
                </button>
              )}
            </div>
          </div>
        </td>
        {/* Bàn giao — bảng NHÓM theo dự án ĐÃ BỎ cột này (ngày bàn giao hiện ở cột Deadline cam
            kết trên HÀNG DỰ ÁN như PMP); bảng thường/lọc vẫn giữ. */}
        {!groupMode && (
          <td className="border-r border-slate-100 px-[0.5em] py-[0.364em] text-center text-[0.85em] tabular-nums text-slate-700 whitespace-nowrap">{fmtDateVN2(it.projectDeadline)}</td>
        )}
        {/* Cột "Hạng mục" (mã viết tắt) — bảng NHÓM theo dự án ĐÃ dời mã này sang cột "Mã" nên
            BỎ cột này ở bảng nhóm; bảng thường/lọc vẫn giữ. */}
        {!groupMode && (
          <td className="border-r border-slate-100 px-2 py-1 font-semibold text-slate-700 leading-tight whitespace-nowrap" title={it._stageLabel}>
            {stageAbbrOf(it._stageId)}
          </td>
        )}
        {/* Nhân sự phụ trách — CHỈ HIỂN THỊ (không bấm để sửa): trước đây onClick mở nhầm ô
            Vướng mắc. Chỉ ô Vướng mắc / Giải pháp mới sửa được. */}
        <td className="border-r border-slate-100 px-2 py-1 text-slate-700 leading-tight"
            style={{ wordBreak: "break-word" }}>
          <div className="line-clamp-2">
            {it._picEdited && <span className="mr-1 rounded bg-teal-100 px-1 text-[9px] font-bold text-teal-800" title={`PM cập nhật trên app lúc ${fmtDateTimeVN(it._editedAt)}`}>✎</span>}
            <PicNames text={picDisplay} />
          </div>
        </td>
        <td className="border-r border-slate-100 px-1 py-1 text-center text-[0.85em] tabular-nums text-slate-700 whitespace-nowrap">{fmtDateVN2(it.start)}</td>
        {/* NGÀY KẾT THÚC — hiện ngày kế hoạch; nếu đã đạt 100% → gạch ngang ngày kế hoạch + thêm
            DÒNG NGÀY KẾT THÚC THỰC TẾ (ngày lần đầu 100%, xanh lá). Rớt <100% thì tự về như cũ. */}
        <td className="border-r border-slate-100 px-1 py-1 text-center text-[0.85em] tabular-nums text-slate-700 whitespace-nowrap">
          {it._deadlineEdited && <span className="mr-0.5 rounded bg-teal-100 px-1 text-[9px] font-bold text-teal-800" title={`PM cập nhật trên app lúc ${fmtDateTimeVN(it._editedAt)}`}>✎</span>}
          {(() => {
            const doneOn = completedDates[it._key];
            return doneOn
              ? <span className="leading-tight"><span className="text-slate-400 line-through">{fmtDateVN2(it.deadline)}</span><br /><span className="font-semibold text-emerald-700" title="Ngày kết thúc thực tế (lần đầu đạt 100%)">{fmtDateVN2(doneOn)}</span></span>
              : fmtDateVN2(it.deadline);
          })()}
        </td>
        <td className="border-r border-slate-100 px-2 py-1 text-center tabular-nums whitespace-nowrap">
          {/* MỌI ô đều BẤM ĐƯỢC → popover chi tiết (số mã / % nhập tay / chưa nhập). Chấm vàng nhỏ
              trước số = số liệu cần rà (thiếu / lệch). Gạch chân chấm = báo bấm được. */}
          <button type="button" title="Bấm xem chi tiết % thực tế"
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setCodePop({ x: r.left + r.width / 2, y: r.bottom, item: it }); }}
            className="inline-flex items-center gap-1 cursor-pointer underline decoration-dotted decoration-teal-500 decoration-1 underline-offset-2 hover:text-teal-700">
            {pctSuspect && <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="Số liệu % cần rà (thiếu / lệch)" />}
            {actual != null
              ? <span className="font-semibold text-black">{actual}%</span>
              : <span className="font-normal text-slate-400">—</span>}
          </button>
        </td>
        {/* Quá hạn — số căn GIỮA, "ngày" xuống dòng dưới (cột hẹp). */}
        <td className="border-r border-slate-100 px-1 py-1 text-center tabular-nums leading-tight">
          {overdue > 0
            ? <span className="font-bold text-black">{overdue}<br /><span className="text-[0.82em] font-normal text-slate-600">ngày</span></span>
            : <span className="text-slate-400">0</span>}
        </td>
        <td className="border-r border-slate-100 px-1 py-1 text-center">
          {actual != null && actual >= 100
            ? <span className="inline-flex items-center rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">Đã hoàn thành</span>
            : <AlertBadge kind={kind} color={it._alertColor} />}
        </td>
        {/* VƯỚNG MẮC — bong bóng chat. 1 click mở box; admin NHẤP ĐÚP 1 bong bóng = tô/bỏ màu TIN ĐÓ. */}
        <td className="px-2 py-1 align-top text-slate-700">
          <ChatCell msgs={it._noteMsgs} field="note" myEmail={myEmail} isAdmin={isAdmin} today={today} onOp={(op, opts) => onMsgOp(it._key, "note", op, opts)} onOpen={() => openEdit(it, "note")} onReply={(m) => openReply(it._key, `${it.maCT || it.projectCode} · ${it._stageLabel}`, m)} />
        </td>
        {/* GIẢI PHÁP — bong bóng chat. */}
        <td className="px-2 py-1 align-top text-slate-700">
          <ChatCell msgs={it._actionMsgs} field="action" myEmail={myEmail} isAdmin={isAdmin} today={today} onOp={(op, opts) => onMsgOp(it._key, "action", op, opts)} onOpen={() => openEdit(it, "action")} />
        </td>
      </tr>
      {/* DÒNG CON: Block 1..5 của "Thi công lắp đặt" = ĐẦU VIỆC hoàn chỉnh (kế thừa dòng TC cha).
          Mọi cột theo LOGIC THƯỜNG: người phụ trách, ngày, quá hạn, cảnh báo, vướng mắc, giải pháp
          (sửa được). Riêng Mã/Tên hiện mã Block + "↳ Block N"; % bấm ra chi tiết bàn giao tinh/thô. */}
      {isBlkOpen && (it._blockItems ?? []).map((bit, bi) => {
        const b = it.blocks![bi];
        const bActual = bit.pctActual != null ? Math.round(bit.pctActual) : null;
        const bOverdue = bit.overdueDays || 0;
        const bPic = bit._picEdited ? bit._pic : picByStageConv(bit.owner, bit._stageId, bit._projectPm);
        return (
        <tr key={`blk-${blkKey}-${bi}`} className="border-b border-slate-100 bg-teal-50/30 align-middle hover:bg-teal-50/60">
          <td className="border-r border-slate-100 px-1 py-0.5 text-center">
            {!groupMode && <UpdateChip date={bit.updateDate} today={today} />}
          </td>
          <td className={`border-r border-slate-100 px-1 py-0.5 text-[0.85em] font-semibold text-teal-700 whitespace-nowrap${groupMode ? " text-center" : ""}`}>{b.code}</td>
          <td className="border-r border-slate-100 px-2 py-0.5">
            <div className="pl-4 text-[0.92em] font-medium leading-tight text-slate-700">↳ {b.label}</div>
          </td>
          {!groupMode && <td className="border-r border-slate-100 px-[0.5em] py-0.5 text-center text-[0.8em] tabular-nums text-slate-600 whitespace-nowrap">{fmtDateVN2(bit.projectDeadline)}</td>}
          {!groupMode && <td className="border-r border-slate-100 px-2 py-0.5 text-center text-[0.78em] font-semibold text-slate-500">{stageAbbrOf(bit._stageId)}</td>}
          <td className="border-r border-slate-100 px-2 py-0.5 text-[0.9em] text-slate-700 leading-tight" style={{ wordBreak: "break-word" }}>
            <div className="line-clamp-2">
              {bit._picEdited && <span className="mr-1 rounded bg-teal-100 px-1 text-[9px] font-bold text-teal-800" title={`PM cập nhật lúc ${fmtDateTimeVN(bit._editedAt)}`}>✎</span>}
              <PicNames text={bPic} />
            </div>
          </td>
          <td className="border-r border-slate-100 px-1 py-0.5 text-center text-[0.8em] tabular-nums text-slate-600 whitespace-nowrap">{fmtDateVN2(bit.start)}</td>
          <td className="border-r border-slate-100 px-1 py-0.5 text-center text-[0.8em] tabular-nums text-slate-600 whitespace-nowrap">
            {bit._deadlineEdited && <span className="mr-0.5 rounded bg-teal-100 px-1 text-[9px] font-bold text-teal-800" title={`PM cập nhật lúc ${fmtDateTimeVN(bit._editedAt)}`}>✎</span>}
            {fmtDateVN2(bit.deadline)}
          </td>
          <td className="border-r border-slate-100 px-2 py-0.5 text-center tabular-nums whitespace-nowrap">
            <button type="button" title="Bấm xem chi tiết bàn giao Block"
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setBlockPop({ x: r.left + r.width / 2, y: r.bottom, block: b }); }}
              className="cursor-pointer underline decoration-dotted decoration-teal-500 decoration-1 underline-offset-2 hover:text-teal-700">
              {bActual != null ? <span className="font-semibold text-black">{bActual}%</span> : <span className="text-slate-400">—</span>}
            </button>
          </td>
          <td className="border-r border-slate-100 px-1 py-0.5 text-center tabular-nums leading-tight">
            {bOverdue > 0
              ? <span className="font-bold text-black">{bOverdue}<br /><span className="text-[0.82em] font-normal text-slate-600">ngày</span></span>
              : <span className="text-slate-400">0</span>}
          </td>
          <td className="border-r border-slate-100 px-1 py-0.5 text-center">
            {bActual != null && bActual >= 100
              ? <span className="inline-flex items-center rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">Đã hoàn thành</span>
              : <AlertBadge kind={bit._alert} color={bit._alertColor} />}
          </td>
          <td className="px-2 py-0.5 align-top text-[0.9em] text-slate-700">
            <ChatCell msgs={bit._noteMsgs} field="note" myEmail={myEmail} isAdmin={isAdmin} today={today} onOp={(op, opts) => onMsgOp(bit._key, "note", op, opts)} onOpen={() => openEdit(bit, "note")} onReply={(m) => openReply(bit._key, `${bit.maCT || bit.projectCode} · ${bit._stageLabel}`, m)} />
          </td>
          <td className="px-2 py-0.5 align-top text-[0.9em] text-slate-700">
            <ChatCell msgs={bit._actionMsgs} field="action" myEmail={myEmail} isAdmin={isAdmin} today={today} onOp={(op, opts) => onMsgOp(bit._key, "action", op, opts)} onOpen={() => openEdit(bit, "action")} />
          </td>
        </tr>
        );
      })}
      </Fragment>
    );
  };


  // Toàn màn hình: chế độ Danh sách cho section cuộn (bảng dài, thead sticky);
  // chế độ Tổng thể tiến độ thì KHÔNG cuộn ở section — Gantt tự cuộn bên trong
  // và kéo giãn hết chiều cao màn (không chừa khoảng trống dưới).
  return (
    <section ref={panelRef} className={`flex min-h-0 flex-1 flex-col rounded-lg border border-slate-200 bg-white p-2 ${isFs && viewMode === "list" ? "overflow-auto" : ""}`}>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-[12px] font-bold uppercase tracking-wider text-slate-700">
            {viewMode === "gantt" ? "Tổng thể tiến độ" : "Việc cần xử lý"}
          </h2>
          {/* Chuyển cách trình bày: bảng cảnh báo ⇄ biểu đồ Gantt tổng thể tiến độ */}
          <div className="inline-flex overflow-hidden rounded-md border border-slate-300 text-[11px] font-medium print:hidden">
            <button type="button" onClick={() => setViewMode("list")}
              className={`px-2 py-0.5 ${viewMode === "list" ? "bg-teal-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
              Danh sách
            </button>
            <button type="button" onClick={() => setViewMode("gantt")}
              className={`border-l border-slate-300 px-2 py-0.5 ${viewMode === "gantt" ? "bg-teal-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
              Tổng thể tiến độ
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          {/* NÚT "HIỆN TẤT CẢ ĐẦU VIỆC" (kể cả ĐÃ HOÀN THÀNH) — bên TRÁI "Mở tất cả", cho cả 2 bảng.
              Bật → thêm việc 100% (badge "Đã hoàn thành" xanh lá ở cột Tình trạng). KPI không đổi. */}
          <button type="button" onClick={onToggleDone}
            title="Hiện / ẩn các đầu việc ĐÃ HOÀN THÀNH (100%) của dự án đang Show"
            className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${showDone ? "border-emerald-400 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-600 hover:border-emerald-400"}`}>
            {showDone ? "✓ Đang hiện việc đã xong" : "Hiện tất cả đầu việc"}
          </button>
          {/* DÒNG ĐÃ ẨN (admin) — chỉ hiện khi CÓ dòng ẩn. Bật → soi lại các dòng đã ẩn (làm mờ) để bỏ ẩn. */}
          {isAdmin && hiddenCount > 0 && (
            <button type="button" onClick={onToggleShowHidden}
              title="Xem lại các hạng mục đã ẩn thủ công (để bỏ ẩn)"
              className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${showHidden ? "border-amber-400 bg-amber-50 text-amber-800" : "border-slate-300 bg-white text-slate-600 hover:border-amber-400"}`}>
              {showHidden ? `✓ Đang soi ${hiddenCount} dòng ẩn` : `Dòng đã ẩn (${hiddenCount})`}
            </button>
          )}
          {/* NÚT "MỞ TẤT CẢ" — cùng vị trí, cùng size cho cả 2 chế độ:
              · Danh sách → xổ nhóm dự án.
              · Gantt     → xổ tác vụ con (đưa từ hàng legend Gantt lên đây, đổi tên gọn). */}
          {viewMode === "list" && groupMode && groups.length > 0 && (
            <button
              onClick={() => setExpandedGroups(allExpanded ? new Set() : new Set(groups.map(g => g.key)))}
              className="rounded-md border border-teal-300 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-800 hover:border-teal-500">
              {allExpanded ? "Thu gọn tất cả" : "Mở tất cả"}
            </button>
          )}
          {viewMode === "gantt" && ganttHasChildren && (
            <button
              onClick={() => setGanttExpanded(ganttAllOpen ? new Set() : new Set(ganttAllKeys))}
              className="rounded-md border border-teal-300 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-800 hover:border-teal-500">
              {ganttAllOpen ? "Thu gọn tất cả" : "Mở tất cả"}
            </button>
          )}
          {activeCount > 0 && (
            <button onClick={() => setFilters(EMPTY_FILTERS)}
              className="rounded-md border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:border-teal-500 hover:text-teal-700">
              Xoá {activeCount} bộ lọc
            </button>
          )}
          {/* Đặt lại độ rộng cột về mặc định — chỉ hiện khi người dùng đã kéo chỉnh. */}
          {viewMode === "list" && isColWCustom && (
            <button onClick={resetColW} title="Đưa mọi cột về độ rộng mặc định"
              className="rounded-md border border-slate-300 px-2 py-0.5 text-[11px] text-slate-700 hover:border-teal-500 hover:text-teal-700">
              ↔ Đặt lại cột
            </button>
          )}
          {/* "Đánh giá tuân thủ" + "Nhật ký giám sát" KHÔNG còn phơi thẳng trên toolbar —
              gom vào menu "⋯ Thêm" ở cuối (xem <ReportsMenu>), để toolbar gọn và còn chỗ
              mở rộng khi thêm tính năng. Menu render ở cuối, sau các nút xuất file. */}
          <button onClick={() => { void handleExportClick(); }}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-md border border-emerald-600 bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
            <FileSpreadsheet className="h-3.5 w-3.5" /> {exporting ? "Đang xuất…" : "Xuất Excel"}
          </button>
          <PdfExportMenu onPrint={onPrint} />
          <button onClick={toggleFullscreen}
            title={isFs ? "Thoát toàn màn hình (Esc)" : "Xem table toàn màn hình"}
            className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-teal-500 hover:text-teal-700">
            {isFs ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />} {isFs ? "Thu nhỏ" : "Toàn màn hình"}
          </button>
          {/* "Đánh giá tuân thủ" + "Nhật ký giám sát" là TÍNH NĂNG HỆ THỐNG → không nằm cạnh
              bảng nữa, đã chuyển lên góc header (menu "⋯ Hệ thống"). Xem <ReportsMenu> render
              qua <HeaderSlot> trong DashboardBody. */}
        </div>
      </div>

      <div className="mb-1.5 grid grid-cols-1 gap-1.5 print:hidden md:grid-cols-[1fr_auto_auto_auto_auto_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={filters.query} onChange={e => setFilters(f => ({ ...f, query: e.target.value }))}
            placeholder="Tìm công trình, mã CT, PIC hoặc PM…"
            className={`w-full rounded-md border border-slate-300 pl-7 py-1 text-xs text-slate-900 focus:border-teal-600 focus:outline-none ${filters.query ? "pr-7" : "pr-2"}`} />
          {filters.query && (
            <button type="button" onClick={() => setFilters(f => ({ ...f, query: "" }))}
              title="Xoá tìm kiếm" aria-label="Xoá tìm kiếm"
              className="absolute right-1.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        {/* Bộ lọc "Bộ phận", "Hạng mục", "Nhóm cảnh báo" đã bỏ khỏi thanh lọc:
            lọc theo hạng mục = bấm thẻ giai đoạn ở trên; lọc theo cảnh báo = bấm thẻ KPI ở trên. */}
        <MultiSelect
          label="PM"
          selected={filters.pms}
          options={pmOptions}
          onToggle={v => setFilters(f => ({ ...f, pms: toggleIn(f.pms, v) }))}
          onClear={() => setFilters(f => ({ ...f, pms: [] }))}
        />
        <MultiSelect
          label="PES"
          selected={filters.pes}
          options={pesOptions}
          onToggle={v => setFilters(f => ({ ...f, pes: toggleIn(f.pes, v) }))}
          onClear={() => setFilters(f => ({ ...f, pes: [] }))}
        />
        <MultiSelect
          label="Cụm dự án"
          selected={filters.groupDAs}
          options={groupDAOptions}
          onToggle={v => setFilters(f => ({ ...f, groupDAs: toggleIn(f.groupDAs, v) }))}
          onClear={() => setFilters(f => ({ ...f, groupDAs: [] }))}
        />
        <MultiSelect
          label="Mốc bàn giao"
          selected={filters.deadlineMonths}
          options={deadlineMonthOptions}
          onToggle={v => setFilters(f => ({ ...f, deadlineMonths: toggleIn(f.deadlineMonths, v) }))}
          onClear={() => setFilters(f => ({ ...f, deadlineMonths: [] }))}
        />
        <MultiSelect
          label="Vùng"
          selected={filters.regions}
          options={regionOptions}
          onToggle={v => setFilters(f => ({ ...f, regions: toggleIn(f.regions, v) }))}
          onClear={() => setFilters(f => ({ ...f, regions: [] }))}
        />
        <button type="button"
          onClick={() => setFilters(f => ({ ...f, mpOnly: !f.mpOnly }))}
          className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${filters.mpOnly ? "border-blue-600 bg-blue-50 font-semibold text-blue-800" : "border-slate-300 bg-white text-slate-700"} hover:border-blue-500`}
          title="Chỉ hiện các dự án được đánh dấu Cần cập nhật MP (kể cả không thuộc nhóm cảnh báo)">
          <span className={`h-2 w-2 rounded-full ${filters.mpOnly ? "bg-blue-600" : "bg-slate-300"}`} />
          Cần cập nhật MP
        </button>
      </div>

      {viewMode === "gantt" ? (
        <GanttView rows={ganttRows} today={today} fullscreen={isFs} showChildTasks={showGanttChildTasks} flatStages={filters.stages.length > 0} expanded={ganttExpanded} setExpanded={setGanttExpanded} isAdmin={isAdmin} showHidden={showHidden} onHideRow={onHideRow} />
      ) : (
      <div className="relative min-h-0 flex-1 rounded-md border border-slate-200"
           style={{ containerType: "inline-size" }}>
        {/* `container-type: inline-size` ở div bọc = MỐC ĐO cho đơn vị `cqw` của bảng. Chỉ
            chứa theo trục NGANG nên chiều cao vẫn nở theo nội dung (flex-1 min-h-0 giữ
            nguyên) và thead sticky vẫn bám viewport.

            KHÔNG bọc overflow → thead sticky bám theo VIEWPORT khi lăn trang (header
            luôn thấy). Bảng table-fixed w-full nên LUÔN vừa khít bề rộng (không tràn ngang).

            AUTO-FIT: cỡ chữ TỈ LỆ THUẬN với bề rộng CỦA BẢNG (cqw), không phải của màn.
            Độ rộng cột là %, nên khi mọi thứ bên trong tính bằng `em` thì tỉ lệ chữ/cột
            KHÔNG ĐỔI ở mọi bề rộng ⇒ không bao giờ đè chữ; màn nào cũng y hệt, chỉ khác cỡ.

            PHẢI là `cqw`, KHÔNG được dùng `vw`: layout có max-w-[1600px], nên từ màn 1600px
            trở lên bảng ngừng nở (đứng ở ~1532px) trong khi `vw` vẫn nở theo màn → chữ to
            hơn cột và đè nhau. Đây đúng là lỗi đo được ở màn 1920.
            KHÔNG ĐẶT SÀN (min): sàn làm chữ ngừng co trong khi cột vẫn hẹp lại — thủ phạm
            khiến màn 1280 đè chữ trước đây (sàn cũ 8px). Cũng không cần TRẦN: tỉ lệ cố định
            nên toàn màn hình (bảng rộng hơn) chỉ làm chữ to lên cho dễ đọc, không hỏng gì.
            Hệ số nằm ở lib/table-scale.ts — DÙNG CHUNG với Xuất PDF để hai bên không lệch. */}
        <table id="pdf-table" className="w-full table-fixed border-collapse"
               style={{ fontSize: TABLE_FONT_CSS }}>
          {/* Độ rộng cột người dùng kéo chỉnh được (mép phải mỗi tiêu đề);
              phần bù trừ lấy từ cột "Vướng mắc / cần xử lý". */}
          <colgroup>
            {colW.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
          </colgroup>
          {/* PHÂN CẤP MÀU (1 ramp slate, giảm dần): header slate-800 → dòng gộp dự án
              slate-700 → dòng công đoạn trắng/slate-50. Trước đây header slate-100 (nhạt)
              nằm trên dòng gộp đậm = phân cấp NGƯỢC, nhìn kỳ. */}
          <thead className="sticky top-0 z-10 bg-[#1e293b] leading-tight text-white shadow-[0_1px_0_0_rgb(51,65,85)]">
            <tr>
              {/* Kéo mép PHẢI mỗi tiêu đề để chỉnh rộng (trừ cột cuối). Tiêu đề tự wrap; vài cột
                  ép 2 dòng qua label trong HEADER_COLS. */}
              {headerCols.map((c, i) => (
                <SortableTh key={c.k} align={c.align} k={c.k} label={c.label} chain={sortChain} onSort={toggleSort}
                  onResizeStart={i < headerCols.length - 1 ? (e) => startColResize(i, e) : undefined} />
              ))}
            </tr>
          </thead>
          {/* rows-equal = ép mọi hàng cao bằng nhau (styles.css). */}
          <tbody ref={tbodyRef} className="rows-equal">
            {groupMode ? (
              groups.length === 0 ? (
                <tr><td colSpan={headerCols.length} className="px-3 py-8 text-center text-slate-500">Không có dự án nào khớp bộ lọc hiện tại.</td></tr>
              ) : groups.flatMap((g, gi) => {
                const expanded = expandedGroups.has(g.key);
                // ẢNH DỰ ÁN (khoá = g.key = projectKeyOf): số ảnh từ index nhẹ. Có ảnh → tên dự án bấm được → gallery.
                const imgN = projImgIdx?.[g.key]?.n ?? 0;
                // Dự án đã QUÁ mốc bàn giao → tô đỏ ô "Bàn giao". Cùng điều kiện với luật
                // "dự án trễ ⇒ mọi hạng mục con đều trễ" (xem `enriched`) nên luôn khớp nhau.
                // Dự án ĐÃ BÀN GIAO thì loại trừ: đã xong rồi, quá mốc cũng không còn là trễ —
                // để nguyên sẽ ra hàng xanh lá kèm badge đỏ, tự mâu thuẫn.
                const groupLate = !g.delivered && !!g.deadline && g.deadline.slice(0, 10) < today;
                // Ô cảnh báo theo giai đoạn (chỉ giai đoạn CÓ cảnh báo), sắp theo thứ tự giai đoạn.
                // Chip lấy MÀU NẶNG NHẤT của giai đoạn đó (đỏ > vàng) — gom theo `_alertColor`,
                // KHÔNG theo `_alert`. Gom theo nhãn thì chỉ "Trễ tiến độ" mới ra đỏ, nên một
                // "Cần cắt đầu việc" ĐỎ ở dòng con lại hiện chip VÀNG trên hàng gộp: dưới đỏ
                // trên vàng, hàng gộp nói nhẹ hơn sự thật.
                const stageAlert = new Map<StageId, "red" | "amber">();
                for (const it of g.items) {
                  if (it._alert === "none" || !it._alertColor) continue;
                  const sid = it._stageId as StageId;
                  if (STAGE_ORDER.indexOf(sid) < 0) continue;
                  const isRed = it._alertColor === "red";
                  const cur = stageAlert.get(sid);
                  if (!cur || (isRed && cur !== "red")) stageAlert.set(sid, isRed ? "red" : "amber");
                }
                const gr: ReactNode[] = [
                  /* Hàng GỘP DỰ ÁN (bấm để xổ công đoạn con).
                     NỀN = slate-700 (#334155) — CÓ SẴN trong ramp slate của hệ thống, không đẻ
                     token mới. Chọn theo số đo: L*=27 (nhạt hơn hẳn navy cũ L*=12 → hết cảm giác
                     "thanh đen" nặng), bão hoà 25% = thấp nhất nhóm (không xanh rực), chữ trắng
                     đạt 10.35:1 (vượt AAA nhưng tránh vùng 16–18:1 gây mỏi mắt khi nhìn 8–10h).
                     Màu này CHỈ để tạo phân cấp — cố tình lùi lại để badge đỏ/vàng giữ vai chính.
                     Hover = slate-600, cùng ramp, sáng hơn đúng 1 bậc.

                     DỰ ÁN ĐÃ BÀN GIAO → emerald-600, hover emerald-700 — ĐÚNG cặp màu nút
                     "Xuất Excel" (PMO chọn trực tiếp 17/07/2026).
                     DÙNG CLASS `bg-emerald-600`, KHÔNG viết hex tay: Tailwind v4 định nghĩa
                     palette bằng OKLCH nên emerald-600 render ra #009966, KHÔNG phải #059669
                     (giá trị của Tailwind v3). Hardcode hex là lệch màu so với cái nút mà nó
                     phải khớp — đã dính đúng lỗi này một lần rồi.
                     Đánh đổi đã biết và chấp nhận:
                       · Sáng hơn navy nhiều (L*≈55 so với 27) ⇒ hàng "đã xong" nổi hơn hàng
                         đang chạy. Được, vì dự án bàn giao xong là ngoại lệ hiếm.
                       · Chữ trắng trên nền này chỉ ~3.65:1 — DƯỚI mức AA 4.5:1 cho chữ thường.
                         Nút Excel thì ổn vì chỉ 2 chữ; ở đây là cả hàng dữ liệu. Muốn đạt AA
                         mà vẫn đúng họ màu: đổi nền sang emerald-700, hover emerald-600. */
                  <tr key={`grp-${g.key}`} data-group-header="1"
                      className={`cursor-pointer border-y text-white ${
                        g.delivered
                          ? "border-emerald-600 bg-emerald-600 hover:bg-emerald-700"
                          : "border-[#16294a] bg-[#334155] hover:bg-[#475569]"}`}
                      title={g.delivered ? "Dự án đã bàn giao xong, đã gỡ toàn bộ cảnh báo" : undefined}
                      onClick={() => toggleGroup(g.key)}>
                    {/* Ngày update của dự án (từ Master Plan) — chip thang màu như dòng con */}
                    <td className="px-1 py-1 text-center"><UpdateChip date={g.updateDate} today={today} /></td>
                    <td className="px-1 py-1" title={g.maCT}>
                      <div className="flex items-start gap-1 text-white">
                        <span className={`mt-[2px] inline-block text-[9px] text-white transition-transform ${expanded ? "rotate-90" : ""}`}>▶</span>
                        <div className="line-clamp-2 leading-tight">
                          {g.maCT
                            ? g.maCT.split(",").map((s, i) => <div key={i} className="whitespace-nowrap">{s.trim()}</div>)
                            : "—"}
                        </div>
                      </div>
                      {/* XUẤT BÁO CÁO (PDF / Slide) cho dự án — đặt dưới mã dự án (nút gọn icon để vừa cột hẹp). */}
                      <div className="mt-1 print:hidden">
                        <ExportReportMenu onSlide={() => onExportReport?.(g)} onPdf={() => onExportPdf?.(g)} />
                      </div>
                    </td>
                    {/* Tên dự án GÓI xuống 2 dòng như file PMP (break ở bất kỳ đâu, kể cả trong
                        chuỗi nối "_") thay vì kéo 1 dòng dài làm phình cột. Tên DÀI được phép tràn
                        sang dòng 3 để hiện ĐỦ tên, không cắt "…". */}
                    <td className="px-2 py-1">
                      {/* Bấm tên = xem ẢNH (chỉ khi có ảnh). Video có nút 🎬 riêng bên dưới. */}
                      {imgN > 0 ? (
                        <button type="button" onClick={(e) => { e.stopPropagation(); onOpenImage?.(g.key, g.name); }}
                          className="line-clamp-3 text-left font-bold leading-tight text-white underline decoration-dotted decoration-1 underline-offset-2 hover:text-amber-200"
                          style={{ wordBreak: "break-word" }} title={`Xem ${imgN} ảnh hiện trường`}>
                          {g.name} <span className="whitespace-nowrap">📷{imgN > 1 ? ` ${imgN}` : ""}</span>
                        </button>
                      ) : (
                        <span className="line-clamp-3 font-bold leading-tight text-white" style={{ wordBreak: "break-word" }} title={g.name}>{g.name}</span>
                      )}
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 print:hidden">
                        {/* THÊM ẢNH: mở cho MỌI NGƯỜI (ai cũng thêm được; xoá/gỡ vẫn chỉ admin/PMO trong dialog). */}
                        <button type="button" onClick={(e) => { e.stopPropagation(); onSetupImage?.(g.key, g.name, g.items[0]?.projHid); }}
                          className="inline-flex items-center gap-0.5 text-[0.72em] font-medium text-white/70 hover:text-amber-200"
                          title={imgN > 0 ? "Xem / thêm ảnh hiện trường của dự án" : "Thêm ảnh hiện trường cho dự án"}>
                          <ImageIcon className="h-3 w-3" />{imgN > 0 ? `Ảnh (${imgN})` : "Thêm ảnh"}
                        </button>
                        {/* XEM VIDEO — chỉ Mini Hotel (đang có clip). Mở THẲNG trình xem, 1 chạm. */}
                        {/mini\s*hotel/i.test(g.name) && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); onOpenVideo?.(g.name); }}
                            className="inline-flex items-center gap-0.5 text-[0.72em] font-semibold text-teal-200 hover:text-white"
                            title="Mở Media công trường: ảnh + video theo từng phòng">
                            🎬 Video
                          </button>
                        )}
                      </div>
                    </td>
                    {/* Nhân sự phụ trách: PM của dự án */}
                    <td className="px-2 py-1 text-white leading-tight">
                      <div className="line-clamp-2" title={g.pm}><PicNames text={g.pm} /></div>
                    </td>
                    {/* HÀNG DỰ ÁN hiện NGÀY BẮT ĐẦU + DEADLINE(=Bàn giao) như file PMP (đã bỏ cột
                        "Bàn giao" riêng). Ngày bắt đầu = ngày cha; Deadline = ngày Kết thúc/Bàn giao. */}
                    <td className="px-1 py-1 text-center text-[0.85em] tabular-nums font-semibold text-white whitespace-nowrap">{fmtDateVN2(g.start)}</td>
                    {/* Deadline cam kết = ngày BÀN GIAO dự án; quá mốc → badge ĐỎ (như hạng mục trễ). */}
                    <td className="px-[0.5em] py-[0.364em] text-center text-[0.85em] tabular-nums font-semibold text-white whitespace-nowrap">
                      {groupLate
                        ? <span className="inline-flex items-center justify-center rounded bg-red-500 px-[0.545em] py-[0.18em] font-bold text-white"
                                title={`Dự án đã quá mốc bàn giao ${fmtDateVN2(g.deadline)}`}>
                            {fmtDateVN2(g.deadline)}
                          </span>
                        : fmtDateVN2(g.deadline)}
                    </td>
                    {/* Ma trận 7 ô tình trạng theo giai đoạn (TK→BG→MA→VT→TKSX→SX→TC).
                        NẰM TRONG khoảng từ cột "% thực tế" → hết cột "Tình trạng" (colSpan 3 — đã
                        nhường 2 cột Ngày bắt đầu/Deadline cho ngày dự án). Lưới 7 ô ĐỀU NHAU nên THẲNG
                        HÀNG giữa các dự án → nhìn VỊ TRÍ là biết giai đoạn nào có vấn đề.
                        Màu = MỨC NGHIÊM TRỌNG nặng nhất của giai đoạn (đỏ > vàng), khớp đúng
                        badge dòng con — KHÔNG suy từ nhãn.

                        MỌI kích thước ở đây tính bằng `em` (4em = 44px ở cỡ chữ gốc 11px).
                        TRƯỚC ĐÂY ghi cứng 44px: cỡ chữ co theo bề rộng màn nhưng lưới thì
                        không, nên ở 1280px lưới tràn khỏi ô 51px và đè lên cột bên cạnh.
                        Đổi sang em ⇒ lưới co giãn cùng bảng, tỉ lệ không đổi ở mọi bề rộng. */}
                    <td colSpan={3} className="px-2 py-1">
                      {/* Lưới 7 giai đoạn LẤP ĐẦY ô (7 track bằng nhau) → luôn vừa khít bề rộng
                          span dù thu cột ngày (không tràn), vẫn thẳng hàng giữa các dự án.
                          Bộ lọc "Cần cập nhật MP" DÙNG CHUNG lưới này (badge màu giai đoạn), y hệt
                          bảng mặc định — KHÔNG hiện badge chữ "CẬP NHẬT MP" nữa. */}
                      <div className="grid w-full" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "0.36em" }}>
                        {STAGE_ORDER.map(sid => {
                          const a = stageAlert.get(sid);
                          // Ô lưới giữ kích thước (4em × 1.82em theo cỡ chữ CỦA BẢNG); chip bên
                          // trong lấp đầy 100% ô. Cố tình KHÔNG đặt width/height bằng em trên
                          // chính chip: chip có font-size riêng (0.77em) nên `em` sẽ quy theo cỡ
                          // chữ của NÓ → 4em ra 34px chứ không phải 44px.
                          return (
                            <div key={sid} className="flex items-center justify-center" style={{ height: "1.82em" }}>
                              {a && (
                                <span title={`${STAGE_META[sid].label}: ${a === "red" ? "Cảnh báo đỏ" : "Cảnh báo vàng"}`}
                                      className={`inline-flex h-full w-full items-center justify-center rounded font-bold uppercase leading-none ${a === "red" ? "bg-red-500 text-white" : "bg-amber-400 text-slate-900"}`}
                                      style={{ fontSize: "0.77em" }}>
                                  {stageAbbrOf(sid)}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    {/* Vướng mắc CẤP DỰ ÁN — nhập được ngay trong chế độ gộp (khoá = projectKey,
                        tách riêng khỏi ghi chú từng công đoạn). stopPropagation để không sổ nhóm. */}
                    <td className="cursor-pointer px-2 py-1 align-middle text-white hover:bg-white/5"
                        title="Bấm để xem / thêm vướng mắc dự án"
                        onClick={(e) => { e.stopPropagation(); openGroupEdit(g, "note"); }}>
                      <ChatCell msgs={g.noteMsgs} dark />
                    </td>
                    {/* Giải pháp CẤP DỰ ÁN — box chat, khoá = projectKey. */}
                    <td className="cursor-pointer px-2 py-1 align-middle text-white hover:bg-white/5"
                        title="Bấm để xem / thêm giải pháp dự án"
                        onClick={(e) => { e.stopPropagation(); openGroupEdit(g, "action"); }}>
                      <ChatCell msgs={g.actionMsgs} dark />
                    </td>
                  </tr>,
                ];
                if (expanded) g.items.forEach((it, i) => gr.push(renderRow(it, gi * 1000 + i)));
                return gr;
              })
            ) : sortedItems.length === 0 ? (
              <tr><td colSpan={headerCols.length} className="px-3 py-8 text-center text-slate-500">Không có cảnh báo nào khớp bộ lọc hiện tại.</td></tr>
            ) : sortedItems.map(renderRow)}
          </tbody>
        </table>
      </div>
      )}

      {/* POPOVER "số mã / tổng mã" — bấm con số % thực tế ra chi tiết breakdown từ file gốc.
          Nền trong suốt phủ toàn màn để bấm ra ngoài là đóng. */}
      {codePop && typeof document !== "undefined" && createPortal(
        (() => {
          const it = codePop.item;
          const act = it.pctActual != null ? Math.round(it.pctActual) : null;
          const sum = it.codeCounts?.length ? buildCodeSummary(it.codeCounts) : null;
          // Lệch khi % nhập cách CẢ avgPct LẪN pooledPct ≥ 3 điểm (bỏ qua sai số làm tròn).
          const mism = !!sum && act != null && sum.avgPct != null && sum.pooledPct != null &&
            Math.abs(act - sum.avgPct) >= 3 && Math.abs(act - sum.pooledPct) >= 3;
          return (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 70 }} onClick={() => setCodePop(null)} />
              <div onClick={(e) => e.stopPropagation()}
                   style={{ position: "fixed", left: codePop.x, top: codePop.y + 6, transform: "translateX(-50%)", zIndex: 71 }}
                   className="w-max max-w-[280px] rounded-lg border border-slate-200 bg-white p-2.5 text-[11px] shadow-xl">
                <div className="mb-1.5 font-semibold text-slate-700">{it._stageLabel} · % thực tế</div>
                {sum ? (
                  // (1) CÓ chi tiết số mã → bảng breakdown "X mã / Y mã".
                  <>
                    <table className="w-full border-collapse">
                      <tbody>
                        {sum.lines.map((l, i) => (
                          <tr key={i} className="border-b border-slate-100 last:border-0">
                            <td className="py-0.5 pr-3 text-slate-600 whitespace-nowrap">{l.label}</td>
                            <td className="py-0.5 pr-1 text-right font-semibold tabular-nums text-slate-900 whitespace-nowrap">{l.done}<span className="font-normal text-slate-400">/{l.total}</span></td>
                            <td className="py-0.5 pl-2 text-right tabular-nums text-slate-500">{l.pct != null ? `${l.pct}%` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {sum.lines.length > 1 && (
                      <div className="mt-1 flex items-center justify-between gap-3 border-t border-slate-200 pt-1 font-semibold text-slate-700">
                        <span>Tổng</span>
                        <span className="tabular-nums">{sum.totalDone}/{sum.totalTotal} mã{sum.pooledPct != null ? ` · ${sum.pooledPct}%` : ""}</span>
                      </div>
                    )}
                    <div className="mt-1 text-slate-500">Còn <b className="text-slate-800">{sum.remaining} mã</b> chưa xong</div>
                    {mism && (
                      <div className="mt-1.5 rounded bg-amber-50 px-1.5 py-1 text-[10.5px] leading-snug text-amber-800 ring-1 ring-amber-200">
                        ⚠ % thực tế đang ghi <b>{act}%</b>, nhưng làm được <b>{sum.totalDone}/{sum.totalTotal} mã</b> ({sum.pooledPct}%) — nên kiểm tra lại cách nhập.
                      </div>
                    )}
                  </>
                ) : act != null ? (
                  // (2) CÓ số % nhưng KHÔNG có breakdown → % nhập tay.
                  <div className="text-slate-600">Đang ghi <b className="text-slate-900 text-[12px]">{act}%</b> — nhập tay, không có chi tiết số mã.
                    {it.pctActualInvalid && <span className="mt-1.5 block rounded bg-amber-50 px-1.5 py-1 text-[10.5px] text-amber-800 ring-1 ring-amber-200">⚠ Giá trị nhập không hợp lệ — cần rà lại.</span>}
                  </div>
                ) : (
                  // (3) TRỐNG → chưa nhập.
                  <div className="rounded bg-amber-50 px-1.5 py-1 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">Chưa nhập % thực tế cho hạng mục này.</div>
                )}
              </div>
            </>
          );
        })(),
        document.body,
      )}

      {/* POPOVER chi tiết 1 Block. Ý nghĩa % theo LOẠI (đọc từ file):
          • kind=tho  → % = ĐÃ GIAO THÔ; hiện số căn giao thô + giao tinh.
          • kind=avg  → % = TRUNG BÌNH tiến độ các khu; liệt kê từng khu + %.
          • kind=plain→ chỉ có %. */}
      {blockPop && typeof document !== "undefined" && createPortal(
        (() => {
          const b = blockPop.block;
          const pctTxt = (v: number | null) => v != null ? `${Math.round(v)}%` : "—";
          const hrow = (label: string, h?: { done: number | null; total: number | null; pct: number | null }) => (
            <tr className="border-b border-slate-100 last:border-0">
              <td className="py-0.5 pr-3 text-slate-600 whitespace-nowrap">{label}</td>
              <td className="py-0.5 pr-1 text-right font-semibold tabular-nums text-slate-900 whitespace-nowrap">{h?.done ?? "—"}<span className="font-normal text-slate-400">/{h?.total ?? "—"} căn</span></td>
              <td className="py-0.5 pl-2 text-right tabular-nums text-slate-500">{pctTxt(h?.pct ?? null)}</td>
            </tr>
          );
          return (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 70 }} onClick={() => setBlockPop(null)} />
              <div onClick={(e) => e.stopPropagation()}
                   style={{ position: "fixed", left: blockPop.x, top: blockPop.y + 6, transform: "translateX(-50%)", zIndex: 71 }}
                   className="w-max max-w-[300px] rounded-lg border border-slate-200 bg-white p-2.5 text-[11px] shadow-xl">
                <div className="mb-1 font-semibold text-slate-700">{b.label} · <span className="text-teal-700">{b.code}</span></div>
                {b.kind === "tho" ? (
                  <>
                    <div className="mb-2 text-slate-600">% đã giao thô: <b className="text-[12px] text-slate-900">{pctTxt(b.pctActual)}</b></div>
                    <table className="w-full border-collapse">
                      <tbody>
                        {hrow("Đã giao thô", b.tho)}
                        {hrow("Đã giao tinh", b.tinh)}
                      </tbody>
                    </table>
                  </>
                ) : b.kind === "avg" ? (
                  <>
                    <div className="mb-1.5 text-slate-600">Trung bình tiến độ các khu: <b className="text-[12px] text-slate-900">{pctTxt(b.pctActual)}</b></div>
                    <table className="w-full border-collapse">
                      <tbody>
                        {(b.areas ?? []).map((a, i) => (
                          <tr key={i} className="border-b border-slate-100 last:border-0">
                            <td className="py-0.5 pr-3 text-slate-600 whitespace-nowrap">{a.label}</td>
                            <td className="py-0.5 pl-2 text-right font-semibold tabular-nums text-slate-900">{pctTxt(a.pct)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="mt-1 text-[10px] text-slate-400">TB = trung bình cộng % các khu trên.</div>
                  </>
                ) : (
                  <div className="text-slate-600">% thực tế: <b className="text-[12px] text-slate-900">{pctTxt(b.pctActual)}</b></div>
                )}
              </div>
            </>
          );
        })(),
        document.body,
      )}

      {/* Hộp CHỈNH SỬA đầu việc — Vướng mắc / PIC / Deadline. Lưu backend dùng chung:
          reload không mất, người khác thấy sau khi lưu. */}
      {/* KHÔNG đóng khi bấm ra nền tối (tránh mất box đang soạn khi lỡ misclick) — CHỈ nút X. */}
      {editView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 print:hidden">
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">{editView.title}</div>
              </div>
              <button onClick={() => setEditView(null)} className="mt-0.5 shrink-0 text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex min-h-0 flex-col gap-3 overflow-hidden px-5 py-4">
              <ChatBox
                msgs={(editView.field === "note" ? msgIndex.get(editView.key)?.note : msgIndex.get(editView.key)?.action) ?? []}
                isAdmin={isAdmin}
                myEmail={myEmail}
                field={editView.field}
                onOp={(op, opts) => onMsgOp(editView.key, editView.field, op, opts)}
                reply={editView.reply}
                onClearReply={() => setEditView((v) => (v ? { ...v, reply: undefined } : v))}
                onClose={() => setEditView(null)}
                draftKey={`${editView.key}:${editView.field}`}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function SortableTh<K extends string>({ w, align, k, label, chain, onSort, onResizeStart }: {
  w?: string;
  align: "left" | "center" | "right";
  k: K;
  label: ReactNode;
  /** Chuỗi sắp xếp đa cột hiện hành — vị trí trong chuỗi hiện số 1/2/3. */
  chain: Array<{ key: string; dir: "asc" | "desc" }>;
  onSort: (k: K) => void;
  /** Có mặt = cột kéo chỉnh được: hiện tay kéo ở mép phải tiêu đề. */
  onResizeStart?: (e: React.MouseEvent) => void;
}) {
  const idx = chain.findIndex(s => s.key === k);
  const active = idx >= 0;
  const arrow = active ? (chain[idx].dir === "desc" ? "▼" : "▲") : "↕";
  // TIÊU ĐỀ luôn CĂN GIỮA (chốt 24/07) — không theo `align` của dữ liệu cột nữa; ô dữ liệu vẫn
  // giữ căn riêng ở renderRow. `align` giữ lại trong props để không phải sửa mọi nơi gọi.
  void align;
  const alignCls = "justify-center text-center";
  // Header nền slate-800 → viền dùng slate-600 (cùng ramp, chỉ đủ tách cột);
  // màu sort dùng teal-300 thay teal-700 vì teal-700 chìm hẳn trên nền tối.
  return (
    <th className={`${w ?? ""} relative border-r border-slate-600 px-2 py-1 text-center font-semibold`}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex w-full items-center gap-1 ${alignCls} hover:text-teal-300 ${active ? "text-teal-300" : ""}`}
        title="Bấm để sắp xếp"
      >
        <span className="min-w-0 whitespace-normal leading-tight">{label}</span>
        <span className={`text-[0.85em] print:hidden ${active ? "opacity-100" : "opacity-40"}`}>{arrow}</span>
        {active && chain.length > 1 && (
          <span className="rounded bg-teal-600 px-0.5 text-[0.8em] font-bold leading-tight text-white print:hidden" title={`Khoá sắp xếp thứ ${idx + 1}`}>
            {idx + 1}
          </span>
        )}
      </button>
      {onResizeStart && (
        <span
          onMouseDown={onResizeStart}
          onClick={(e) => e.stopPropagation()}
          className="absolute -right-[3px] top-0 z-10 h-full w-[7px] cursor-col-resize select-none hover:bg-teal-500/50 print:hidden"
          title="Kéo để chỉnh độ rộng cột"
        />
      )}
    </th>
  );
}


/** MÀU lấy từ `color` (mức nghiêm trọng do ma trận chấm), KHÔNG suy từ `kind`.
 *  Từ 17/07/2026 "Cần cắt đầu việc"/"Cần tập trung" cũng có thể ĐỎ khi dự án sắp tới
 *  mốc bàn giao — suy màu từ chữ là mất hết thông tin mức độ.
 *  `kind = "none"` (không vấn đề) TRONG BẢNG chỉ hiện dấu "–" cho gọn — nhường mắt cho
 *  cảnh báo thật. Nhãn chữ "Không vấn đề" chỉ dùng ở dialog Tiêu chí (để người xem hiểu
 *  quy ước), KHÔNG lặp vào bảng. */
function AlertBadge({ kind, color }: { kind: AlertKind; color: AlertColor }) {
  if (kind === "none") {
    return <span className="text-slate-300" title={ALERT_NONE_LABEL}>–</span>;
  }
  const bg = color === "red" ? "bg-red-500 text-white" : "bg-amber-400 text-slate-900";
  const label =
    kind === "late" ? <>TRỄ<br />TIẾN ĐỘ</>
    : kind === "trim" ? <>CẦN CẮT<br />ĐẦU VIỆC</>
    : <>CẦN TẬP<br />TRUNG</>;
  // 7.6em → 7.4em: ở 7.6em badge rộng ĐÚNG BẰNG chỗ trống của ô (68.6/68.6px ở màn 1920),
  // không dư pixel nào — chỉ cần làm tròn lệch 0.5px là tràn. 7.4em để lại ~2px dư.
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-bold uppercase leading-[1.05] text-center ${bg}`}
      style={{ fontSize: "0.82em", width: "7.4em", height: "3.8em", padding: "0.15em 0.4em" }}
    >
      {label}
    </span>
  );
}


/* ======================================================================
 *  GanttView — "TỔNG THỂ TIẾN ĐỘ": lưới Ô TUẦN như form PMP (file import).
 *    • Đủ cột trái (Stt/Mã/Mô tả/PT/Bắt đầu/Kết thúc/%TT/Quá hạn/Vướng mắc).
 *    • Ô tuần tô màu: xanh nhạt=Tiến độ, xanh đậm=%hoàn thành, ô vuông đỏ=SX.
 *    • Viền trái đỏ = tuần chứa hôm nay. Nền hổ phách = quá hạn.
 * ====================================================================== */
const GANTT_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function GanttView({ rows, today, fullscreen = false, showChildTasks = false, flatStages = false, expanded, setExpanded, isAdmin = false, onHideRow }: { rows: GanttRow[]; today: string; fullscreen?: boolean; showChildTasks?: boolean; flatStages?: boolean; expanded: Set<string>; setExpanded: (s: Set<string>) => void; isAdmin?: boolean; showHidden?: boolean; onHideRow?: (key: string, label: string, hide: boolean) => void }) {
  const DAY = 86400000;
  // Dropdown Block (Thi công lắp đặt) trong Gantt: tác vụ TC nào đang xổ các Block con.
  const [openBlocks, setOpenBlocks] = useState<Set<string>>(new Set());
  const toggleBlocks = (k: string) => setOpenBlocks((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const WEEK_PX = 22; // px / CỘT TUẦN ở khổ tối thiểu → ô tuần gọn hơn, dữ liệu bớt "tách" (Excel/PMP)
  const g = useMemo(() => {
    const iso = (s: string | null) =>
      s ? Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) : null;
    const t = iso(today)!;
    const td = new Date(t);
    const y = td.getUTCFullYear(), mo = td.getUTCMonth();
    // CỬA SỔ = ĐÚNG 4 QUÝ (12 tháng): quý TRƯỚC → HIỆN TẠI → 2 quý TIẾP THEO.
    const qStartMonth = (Math.floor(mo / 3) - 1) * 3;
    const qCurStart = Date.UTC(y, Math.floor(mo / 3) * 3, 1);
    const qCurEnd = Date.UTC(y, Math.floor(mo / 3) * 3 + 3, 0);
    const inCurQtr = (ts: number) => ts >= qCurStart && ts <= qCurEnd;
    // MỖI THÁNG = một cột, bề rộng THEO SỐ NGÀY THẬT → mọi NGÀY rộng bằng nhau trên toàn
    // dải (1 ngày tháng 2 = 1 ngày tháng 7). Đây là điểm khác cốt lõi với lưới TUẦN cũ:
    // vị trí thanh/vạch tính theo ngày thật, không "tượng trưng" theo tuần ISO.
    const months: { start: number; days: number; year: number; name: string; mondays: number[]; cur: boolean }[] = [];
    for (let k = 0; k < 12; k++) {
      const start = Date.UTC(y, qStartMonth + k, 1);
      const days = (Date.UTC(y, qStartMonth + k + 1, 0) - start) / DAY + 1;
      const d0 = new Date(start);
      // Nhãn NGÀY theo tuần = các THỨ 2 NẰM TRONG chính tháng này. Render trong ô của tháng
      // → nhãn KHÔNG THỂ tràn sang tháng kế (tránh lỗi "29 rớt qua tháng sau").
      const mondays: number[] = [];
      for (let dd = 1; dd <= days; dd++) {
        if (new Date(start + (dd - 1) * DAY).getUTCDay() === 1) mondays.push(dd);
      }
      months.push({ start, days, year: d0.getUTCFullYear(), name: GANTT_MONTH_NAMES[d0.getUTCMonth()], mondays, cur: inCurQtr(start) });
    }
    // CỘT TUẦN: mỗi Thứ 2 trong cửa sổ = 1 cột ĐỀU NHAU. Các Thứ 2 liên tiếp cách nhau 7 ngày
    // và mỗi Thứ 2 thuộc đúng 1 tháng → danh sách cột nối các tháng là LIÊN TỤC (Tháng 7/2026 =
    // 4 cột 06,13,20,27), gom nhóm THÁNG/NĂM gọn, KHÔNG có tuần "vắt" hai tháng ở tiêu đề.
    const weeks: { mon: number; day: number; monthIdx: number }[] = [];
    const monthCols = months.map((m, mi) => {
      const startCol = weeks.length;
      for (const dd of m.mondays) weeks.push({ mon: m.start + (dd - 1) * DAY, day: dd, monthIdx: mi });
      return { start: startCol, count: m.mondays.length };
    });
    const nWeeks = weeks.length;
    // Gộp tháng theo NĂM (đếm theo SỐ CỘT TUẦN) → hàng "năm" trên cùng (cửa sổ có thể vắt 2 năm).
    const yearSegs: { year: number; weeks: number }[] = [];
    for (let mi = 0; mi < months.length; mi++) {
      const wc = monthCols[mi].count, last = yearSegs[yearSegs.length - 1];
      if (last && last.year === months[mi].year) last.weeks += wc; else yearSegs.push({ year: months[mi].year, weeks: wc });
    }
    // Dải CỘT của QUÝ HIỆN TẠI (để tô nền) — các tháng `cur` liền nhau.
    let curColStart = 0, curColEnd = 0, seenCur = false;
    for (let mi = 0; mi < months.length; mi++) {
      if (months[mi].cur) { if (!seenCur) { curColStart = monthCols[mi].start; seenCur = true; } curColEnd = monthCols[mi].start + monthCols[mi].count; }
    }
    // TUẦN chứa hôm nay (Thứ 2) → CỘT "hôm nay" (tô CẢ Ô TUẦN). App track theo TUẦN, không sát ngày.
    const dowT = new Date(t).getUTCDay();                       // 0=CN..6=T7
    const todayMon = t - ((dowT + 6) % 7) * DAY;                // Thứ 2 của tuần chứa hôm nay
    const todayCol = nWeeks ? Math.min(nWeeks - 1, Math.max(0, Math.round((todayMon - weeks[0].mon) / (7 * DAY)))) : 0;
    const weekInWindow = nWeeks > 0 && todayMon >= weeks[0].mon && todayMon <= weeks[nWeeks - 1].mon;
    return { iso, months, monthCols, weeks, nWeeks, yearSegs, curColStart, curColEnd, todayCol, weekInWindow };
  }, [today]);

  const { iso, months, monthCols, weeks, nWeeks, yearSegs, todayCol, weekInWindow } = g;
  // Lõi toạ độ MỚI = CỘT TUẦN đều nhau (KHÔNG theo ngày thật nữa): mọi thanh/vạch bám MÉP CỘT.
  const colX = (i: number) => (nWeeks ? i / nWeeks : 0);        // mép TRÁI của cột tuần i (tỉ lệ 0..1)
  const colW = nWeeks ? 1 / nWeeks : 1;                          // bề rộng 1 cột tuần (tỉ lệ 0..1)
  const weekOf = (ts: number) => ts - ((new Date(ts).getUTCDay() + 6) % 7) * DAY; // Thứ 2 chứa ts
  const weekIndex = (ts: number) =>                             // cột tuần chứa ts (kẹp trong cửa sổ)
    nWeeks ? Math.min(nWeeks - 1, Math.max(0, Math.round((weekOf(ts) - weeks[0].mon) / (7 * DAY)))) : 0;
  const pct = (x: number) => `${(x * 100).toFixed(4)}%`;
  // Cột trái (đóng băng 2 cột đầu Mã/Mô tả để giữ định danh khi cuộn ngang).
  const LC = [
    { w: 56, label: "Ngày update", al: "center" as const, sticky: true },
    { w: 88, label: "Mã", al: "left" as const, sticky: true },
    { w: 264, label: "Tên dự án / Hạng mục", al: "left" as const, sticky: true },
    { w: 108, label: "Người phụ trách", al: "left" as const, sticky: false },
    { w: 68, label: "Bắt đầu", al: "center" as const, sticky: false },
    { w: 68, label: "Ngày kết thúc", al: "center" as const, sticky: false },
    { w: 62, label: "% Thực tế", al: "right" as const, sticky: false },
    { w: 50, label: "Quá hạn", al: "right" as const, sticky: false },
  ];
  let acc = 0; const off = LC.map(c => { const o = acc; acc += c.w; return o; });
  // Bề rộng TỐI THIỂU của bảng = cột trái + số-cột-tuần × WEEK_PX. width:100% +
  // table-layout:fixed → khung rộng hơn thì cột timeline giãn đều (hết mảng trắng phải);
  // hẹp hơn thì giữ khổ tối thiểu và cuộn ngang.
  const leftTotal = LC.reduce((a, c) => a + c.w, 0);
  const tableMinW = leftTotal + nWeeks * WEEK_PX;
  /* ── PALETTE GANTT (CHỈ dùng trong bảng Tổng thể tiến độ, KHÔNG đụng phần còn lại của
     app). CÂN BẰNG cho MÀN LỚN / TV: bản trước hạ sắc độ hơi tay → nhìn từ xa bị NHỢT.
     Nay nâng độ bão hoà + đậm VỪA ĐỦ để đọc rõ từ xa, nhưng vẫn KHÔNG chói/neon (tránh
     xanh #0000ff, đỏ #c00000 gắt). Gom một chỗ để thanh + legend luôn khớp màu. ── */
  const GC = {
    headerBg: "#334155",   // slate-700 — header dịu hơn hẳn near-black cũ
    headerCur: "#475569",  // slate-600 — header QUÝ HIỆN TẠI
    accent: "#2dd4bf",     // gạch teal mảnh (quý hiện tại) — chi tiết nhỏ nên giữ tươi
    bar: "#334964",        // thanh tiến độ (cấp dự án) — navy đậm (chốt: #334964); ô đỏ SX + done xanh overlay lên trên
    childBar: "#334964",   // thanh tiến độ DÒNG CON (đầu việc) — nền NAVY #334964; phần done XANH LÁ (GC.done) = % thực tế đè lên
    done: "#5ee9b5",       // % hoàn thành — LẤY ĐÚNG màu chấm "Hoàn thành" trên legend (emerald-300)
    sx: "#f87171",         // SX — ĐỎ CORAL sáng (red-400): nhạt + tươi hơn đỏ đô cũ, nổi & hợp trên nền navy #334964
    sxDone: "#22c55e",     // SX ĐÃ XONG — XANH LÁ (green-500): số ô = phần % sản xuất đã hoàn thành, tô từ trái (tuần sớm) sang; xong 100% → xanh hết
    today: "#7d5fbe",      // TUẦN hiện tại — vạch TÍM DỊU ở đầu tuần (Thứ 2), rõ nhưng không chói
    todayBand: "rgba(125,95,190,0.15)", // băng tuần hiện tại — tím rất nhạt, tô cả cột tuần
    curTint: "#eaf2fb",    // nền quý hiện tại — xanh nhạt (rõ hơn chút cho TV)
    monthLine: "#cbd5e1",  // viền THÁNG — đậm (slate-300) để lưới tháng rõ
    weekLine: "#e8ecf2",   // viền TUẦN — nhạt hơn, chia nhỏ cột tháng cho dễ dóng ngày
    overdueBg: "#fcefdd",  // nền hàng quá hạn — amber ấm (rõ hơn chút)
    overdueEdge: "#e0a458",// mép trái hàng quá hạn
    childBg: "#f8fafc",    // nền hàng tác vụ con
  };
  const navy = GC.headerBg;
  const ROW_H = 34; // chiều cao cố định cho MỌI hàng → đồng bộ tuyệt đối
  const hCls = "border-b border-r border-slate-500/40 px-1.5 py-1 font-semibold text-slate-100";
  const alCls = (a: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");
  const numCol = new Set([4, 5, 6, 7]); // Bắt đầu / Kết thúc / % TT / Quá hạn (đã dịch +1 vì thêm cột Ngày update)

  // Xổ/thu tác vụ con — state do FlatTablePanel giữ (để NÚT trên toolbar điều khiển được),
  // truyền xuống qua props. Bấm dự án để xổ.
  const toggle = (k: string) => { const n = new Set(expanded); n.has(k) ? n.delete(k) : n.add(k); setExpanded(n); };

  // Nút ẨN (rê chuột) / BỎ ẨN cho 1 dòng HẠNG MỤC — chỉ admin, print:hidden (không lọt PDF).
  // Đồng bộ với bảng Danh sách: cùng onHideRow(key,label,hide) → cùng kho `hidden:v1`.
  const hideBtn = (hideKey: string | undefined, hidden: boolean, label: string): ReactNode => {
    if (!isAdmin || !onHideRow || !hideKey) return null;
    return hidden ? (
      <button type="button" title="Bỏ ẩn — đưa dòng này trở lại báo cáo"
        onClick={(e) => { e.stopPropagation(); onHideRow(hideKey, label, false); }}
        className="flex items-center gap-0.5 rounded px-0.5 text-[8px] font-semibold text-amber-700 hover:bg-amber-100 print:hidden">
        <RotateCcw className="h-2.5 w-2.5" />ẩn
      </button>
    ) : (
      <button type="button" title="Ẩn dòng này khỏi báo cáo (hạng mục trong khuôn khổ, không cần raise)"
        onClick={(e) => { e.stopPropagation(); onHideRow(hideKey, label, true); }}
        className="flex h-3.5 w-3.5 items-center justify-center rounded text-slate-400 opacity-0 transition-opacity hover:bg-slate-200 hover:text-slate-700 group-hover:opacity-100 print:hidden">
        <EyeOff className="h-2.5 w-2.5" />
      </button>
    );
  };

  // QUY VỀ TUẦN (như PMP): MỌI thanh NHẢY THEO Ô TUẦN. Start = cột tuần bắt đầu; end LẤP FULL
  // đến HẾT cột tuần kết thúc. Vd task kết thúc giữa tuần → thanh vẫn kéo hết ô tuần đó.
  const spanOf = (sIso: string | null, eIso: string | null) => {
    const s0 = iso(sIso), e0 = iso(eIso);
    if (s0 == null || e0 == null || e0 < s0 || !nWeeks) return null;
    const si = weekIndex(s0), ei = weekIndex(e0);           // cột tuần đầu → cột tuần cuối
    const L = colX(si), R = colX(ei + 1);                    // lấp trọn các ô tuần [si..ei]
    if (R <= 0 || L >= 1) return null;
    return { L, W: R - L, si, ei };
  };
  // Thanh tác vụ con CHỈ 2 màu như file gốc: xanh dương (tiến độ) + xanh lá (% hoàn thành).
  // Dùng GC.bar / GC.done. KHÔNG tô đỏ/cam theo cảnh báo — mức độ trễ đọc qua vạch hôm nay.

  // Các LỚP PHỦ chung của một hàng timeline (dùng cho cả dự án lẫn tác vụ con): viền tháng, cột
  // TUẦN HIỆN HÀNH (ĐỎ). KHÔNG còn tô nền quý (chuyển sang tô TRẮNG ở header 3 tháng quý này).
  const gridOverlays = (h: number, _tint: boolean) => (
    <>
      {/* LƯỚI NỀN (zIndex 1 = dưới băng đỏ vẽ-sau & dưới thanh z2):
          • Vạch TUẦN (dọc): tile theo PIXEL = WEEK_PX (cột tuần rộng cố định WEEK_PX) → trùng khít
            header, KHÔNG rớt vạch như khi tính bằng % (làm tròn khiến 2 cột dính làm 1).
          • Vạch NGANG đáy hàng: borderBottom → chia dòng (mang lại line ngang đã mất). */}
      <div style={{ position: "absolute", top: 0, height: h, left: 0, right: 0, zIndex: 1, borderBottom: `1px solid ${GC.weekLine}`,
        backgroundImage: `repeating-linear-gradient(to right, ${GC.weekLine} 0, ${GC.weekLine} 1px, transparent 1px, transparent ${WEEK_PX}px)` }} />
      {/* Viền THÁNG: kẻ ĐẬM hơn ở đầu mỗi tháng (trừ tháng đầu) — vẽ SAU lưới tuần để nổi lên trên */}
      {monthCols.slice(1).map((mc, k) => (
        <div key={k} style={{ position: "absolute", top: 0, height: h, left: pct(colX(mc.start)), width: 1, background: GC.monthLine, zIndex: 1 }} />
      ))}
      {/* NGÀY HIỆN HÀNH = CỘT TUẦN chứa hôm nay: tô ĐỎ NHẠT cả ô (băng #fca5a5, dưới thanh).
          BỎ vạch đỏ mảnh (#dc2626) theo yêu cầu — CHỈ giữ băng. */}
      {weekInWindow && (
        <div title="Tuần hiện hành" style={{ position: "absolute", top: 0, bottom: -1, left: pct(colX(todayCol)), width: pct(colW), background: "#fca5a5", zIndex: 1 }} />
      )}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      {/* Legend dùng ĐÚNG màu GC như thanh (inline style) → chú thích luôn khớp biểu đồ. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[10.5px] text-slate-600 print:hidden">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-6 rounded-sm" style={{ background: GC.bar }} />Tiến độ (Bắt đầu→Kết thúc)</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-6 rounded-sm" style={{ background: GC.done }} />% đã hoàn thành (theo cột % Thực tế)</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-[1px]" style={{ background: GC.sx, border: "1px solid #0f172a" }} />SX chưa xong</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-[1px]" style={{ background: GC.sxDone, border: "1px solid #0f172a" }} />SX đã xong (theo %)</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-4 rounded-sm" style={{ background: "#fca5a5" }} />Ngày hiện hành</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-5 rounded-sm border" style={{ background: GC.overdueBg, borderColor: GC.overdueEdge }} />Quá hạn</span>
      </div>
      {/* Toàn màn hình: bỏ cap 74vh để bảng kéo hết chiều cao màn (flex-1 tự lo). */}
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-slate-200" style={{ maxHeight: fullscreen ? undefined : "74vh" }}>
      <table id="pdf-gantt" className="border-separate"
             style={{ borderSpacing: 0, width: "100%", minWidth: tableMinW, tableLayout: "fixed", fontSize: 11 }}>
        <colgroup>
          {LC.map((c, i) => <col key={i} style={{ width: c.w }} />)}
          {/* MỘT cột timeline duy nhất, rộng = số-cột-tuần × WEEK_PX → mọi thanh nhảy theo Ô TUẦN
              bên trong. width:100% giãn cả cột này (các ô tuần vẫn đều) khi khung rộng hơn. */}
          <col style={{ width: nWeeks * WEEK_PX }} />
        </colgroup>
        <thead>
          <tr>
            {LC.map((c, i) => (
              <th key={i} className={`${hCls} ${alCls(c.al)}`}
                  style={{ position: "sticky", top: 0, left: c.sticky ? off[i] : undefined, height: 56, zIndex: c.sticky ? 32 : 22, background: navy }}>
                {c.label}
              </th>
            ))}
            {/* Header timeline 3 TẦNG như PMP: NĂM · TÊN THÁNG · SỐ NGÀY (Thứ 2 trong tháng).
                Mỗi ô rộng ĐÚNG theo số ngày (flex ∝ days). Nhãn ngày nằm TRONG ô tháng nên
                không tràn sang tháng kế. Quý hiện tại: nền sáng hơn. */}
            <th className="p-0" style={{ position: "sticky", top: 0, height: 56, zIndex: 20, background: navy }}>
              <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%" }}>
                {/* Tầng 1: NĂM */}
                <div style={{ display: "flex", height: 15 }}>
                  {yearSegs.map((s, k) => (
                    <div key={k} style={{ flex: `${s.weeks} 0 0`, display: "flex", alignItems: "center", justifyContent: "center",
                         color: "#ffffff", fontSize: 10, fontWeight: 700, letterSpacing: ".05em",
                         borderRight: "1px solid rgba(148,163,184,.4)", borderBottom: "1px solid rgba(148,163,184,.4)" }}>
                      {s.year}
                    </div>
                  ))}
                </div>
                {/* Tầng 2: TÊN THÁNG */}
                <div style={{ display: "flex", height: 16 }}>
                  {months.map((m, k) => (
                    <div key={k} style={{ flex: `${monthCols[k].count} 0 0`, display: "flex", alignItems: "center", justifyContent: "center",
                         background: m.cur ? "#ffffff" : navy, color: m.cur ? "#111827" : "#cbd5e1", fontSize: 10, fontWeight: 700,
                         overflow: "hidden", whiteSpace: "nowrap",
                         borderRight: "1px solid rgba(148,163,184,.4)", borderBottom: "1px solid rgba(148,163,184,.4)" }}>
                      {m.name}
                    </div>
                  ))}
                </div>
                {/* Tầng 3: NGÀY ĐẦU TUẦN (Thứ 2) — mỗi tuần là 1 Ô ĐỀU NHAU, số canh GIỮA ô (như
                    Excel). Nhãn nằm trong chính ô của nó nên KHÔNG THỂ bị cắt/che (dứt điểm lỗi
                    "chữ bị hụt"). Viền phải ĐẬM ở cuối tháng, nhạt giữa các tuần trong tháng. */}
                <div style={{ display: "flex", flex: "1 0 auto" }}>
                  {months.map((m, k) => (
                    <div key={k} style={{ flex: `${monthCols[k].count} 0 0`, display: "flex",
                         background: m.cur ? "#ffffff" : navy }}>
                      {m.mondays.map((dd, j) => {
                        const isToday = monthCols[k].start + j === todayCol && weekInWindow;
                        return (
                        <div key={dd} style={{ flex: "1 0 0", display: "flex", alignItems: "center", justifyContent: "center",
                             fontSize: 11, fontWeight: 600, fontVariantNumeric: "tabular-nums",
                             // Ô ngày ở CỘT ĐỎ (tuần hiện hành): chữ TRẮNG nổi trên băng đỏ (ô trong suốt + nâng trên băng).
                             color: isToday ? "#ffffff" : m.cur ? "#374151" : "#e2e8f0",
                             ...(isToday ? { background: "transparent", position: "relative", zIndex: 4 } : null),
                             borderRight: j === m.mondays.length - 1 ? "1px solid rgba(148,163,184,.4)" : "1px solid rgba(148,163,184,.16)" }}>
                          {String(dd).padStart(2, "0")}
                        </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
                {/* CỘT ĐỎ NGÀY HIỆN HÀNH (băng #fca5a5) từ DÒNG NGÀY (top 31) xuống, nối liền body.
                    KHÔNG còn vạch đỏ mảnh (bỏ theo yêu cầu) — chỉ giữ băng. */}
                {weekInWindow && (
                  <div style={{ position: "absolute", top: 31, bottom: 0, left: pct(colX(todayCol)), width: pct(colW), background: "#fca5a5", zIndex: 3 }} />
                )}
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={LC.length + 1} className="px-3 py-10 text-center text-slate-500">Không có dự án nào khớp bộ lọc hiện tại.</td></tr>
          ) : rows.map((r) => {
            const od = r.overdue > 0;
            const bg = od ? GC.overdueBg : "#ffffff";
            const projSpan = spanOf(r.start, r.end);      // thanh dự án (theo ngày thật)
            const sxSpan = spanOf(r.sxStart, r.sxEnd);    // khoảng Nhà máy sản xuất (SX)
            /* % THỰC TẾ CẤP DỰ ÁN tạm để 0 (chưa có trọng số công đoạn) → thanh dự án xanh
               dương hết, không có phần xanh lá. Cột "% Thực tế" cùng nguồn nên không lệch. */
            // Chế độ LỌC HẠNG MỤC: dòng là 1 hạng mục → cột "% Thực tế" + phần done lấy % của
            // CHÍNH hạng mục. Chế độ dự án: để 0 (chưa có trọng số công đoạn cấp dự án).
            const pctRow = flatStages ? Math.round(r.pct ?? 0) : 0;
            const hasKids = !flatStages && showChildTasks && r.children.length > 0;
            const isOpen = expanded.has(r.key);
            const vals: ReactNode[] = [
              <div className="flex items-center justify-center gap-0.5">
                <UpdateChip date={r.updateDate} today={today} />
                {r.hideKey && hideBtn(r.hideKey, !!r.hidden, `${r.maCT} ${r.name} · ${r.stageAbbr ?? ""}`)}
              </div>,
              flatStages
                ? <div className="line-clamp-2 pl-1 text-[10px] font-bold leading-tight" title={r.stageAbbr}>{r.stageAbbr}</div>
                : <div className="flex items-start gap-1">
                    {hasKids
                      ? <span className="mt-[2px] inline-block text-[8px] leading-none text-slate-400" style={{ transform: isOpen ? "rotate(90deg)" : "none" }}>▶</span>
                      : <span className="inline-block w-2" />}
                    <div className="line-clamp-2 leading-tight">{r.maCT.split(",").map((x, k) => <div key={k} className="whitespace-nowrap">{x.trim()}</div>)}</div>
                  </div>,
              <div className="line-clamp-2 leading-tight" title={r.name}>{r.name}</div>,
              <div className="truncate" title={r.pm}>{r.pm}</div>,
              fmtDateVN2(r.start),
              r.actualEnd
                ? <span className="leading-tight"><span className="text-slate-400 line-through">{fmtDateVN2(r.end)}</span><br /><span className="font-semibold text-emerald-700" title="Ngày kết thúc thực tế (lần đầu 100%)">{fmtDateVN2(r.actualEnd)}</span></span>
                : fmtDateVN2(r.end),
              <span className="text-slate-900">{pctRow}%</span>,
              r.overdue > 0 ? <b className="text-red-600">{r.overdue}</b> : "0",
            ];
            return (
              <Fragment key={r.key}>
              <tr className={`group hover:bg-teal-50/40 ${r.hidden ? "opacity-60 hover:opacity-100" : ""} ${hasKids ? "cursor-pointer" : ""}`} onClick={hasKids ? () => toggle(r.key) : undefined}>
                {LC.map((c, i) => (
                  <td key={i}
                      className={`border-b border-r border-slate-100 px-1.5 py-0.5 leading-tight align-middle ${alCls(c.al)} ${numCol.has(i) ? "tabular-nums whitespace-nowrap" : ""} ${i === 2 ? "font-semibold text-slate-900" : "text-slate-900"}`}
                      style={{ position: c.sticky ? "sticky" : undefined, left: c.sticky ? off[i] : undefined, zIndex: c.sticky ? 12 : undefined, background: bg, height: ROW_H, maxWidth: c.w,
                               borderLeft: (od && i === 0) ? `3px solid ${GC.overdueEdge}` : undefined }}>
                    {vals[i]}
                  </td>
                ))}
                {/* Cột timeline KHÔNG kẻ viền-dưới: viền near-white 0.8px cắt ngang băng "tuần hiện hành"
                    (#fca5a5) thành vạch trắng. Bar + lưới cột trái đã đủ phân dòng. */}
                <td className="relative border-r border-slate-100 p-0" style={{ height: ROW_H, background: bg }}>
                  {gridOverlays(ROW_H, !od)}
                  {projSpan && (
                    <div style={{ position: "absolute", top: 6, bottom: 6, left: pct(projSpan.L), width: pct(projSpan.W), background: GC.bar, borderRadius: 2, zIndex: 2 }} />
                  )}
                  {/* LỌC HẠNG MỤC: đổ phần % THỰC TẾ (xanh lá) đè lên thanh hạng mục — như dòng con. */}
                  {flatStages && projSpan && pctRow > 0 && (
                    <div style={{ position: "absolute", top: 6, bottom: 6, left: pct(projSpan.L), width: pct(projSpan.W * pctRow / 100), background: GC.done, borderRadius: 2, zIndex: 3 }} />
                  )}
                  {/* SX (Nhà máy sản xuất) = MỖI CỘT TUẦN trong khoảng SX có ĐÚNG 1 Ô VUÔNG ĐỎ, nằm
                      GIỮA ô (y hệt file import PMP). CHỈ ở chế độ dự án (không phải lọc hạng mục). */}
                  {!flatStages && sxSpan && (() => {
                    // Số ô SX = số tuần trong khoảng SX. Tô XANH LÁ số ô ĐÃ SẢN XUẤT XONG (theo % thực tế
                    // giai đoạn SX), từ TRÁI (tuần sớm) sang phải; còn lại ĐỎ. floor → chỉ xanh hết khi thật
                    // sự đạt 100% (không "xanh giả" ở 90%). sxPct null (chưa có số) → đỏ hết như cũ.
                    const nSx = sxSpan.ei - sxSpan.si + 1;
                    const nDone = r.sxPct != null ? Math.floor((nSx * r.sxPct) / 100) : 0;
                    return Array.from({ length: nSx }, (_, k) => {
                      const i = sxSpan.si + k;
                      const done = k < nDone;
                      return (
                        <div key={i} title={done ? "Sản xuất xong (SX)" : "Nhà máy sản xuất (SX) — chưa xong"} style={{ position: "absolute", left: pct(colX(i) + colW / 2), top: "50%",
                          width: 10, height: 10, transform: "translate(-50%,-50%)", background: done ? GC.sxDone : GC.sx, border: "1px solid #0f172a", borderRadius: 1, zIndex: 3 }} />
                      );
                    });
                  })()}
                </td>
              </tr>

              {/* TÁC VỤ CON: mỗi đầu việc con = 1 thanh thời gian (start→deadline). CHỈ 2 màu:
                  xanh dương (tiến độ) + xanh lá (% thực tế). Nền xám nhạt + chữ nhỏ để phân cấp. */}
              {hasKids && isOpen && r.children.map(ch => {
                // Render 1 tác vụ con (dùng chung cho dòng công đoạn LẪN dòng Block). Dòng có Block
                // → hiện ▶ dropdown; bấm mới xổ các Block (kế thừa timeline). isBlock = dòng Block.
                const renderCh = (c: GanttChild, isBlock: boolean) => {
                  const cSpan = spanOf(c.start, c.end);
                  const cActual = Math.min(100, Math.max(0, c.actual ?? 0));
                  const cbg = isBlock ? "#eef4f3" : GC.childBg;
                  const hasBlk = !!c.blocks?.length;
                  const blkOpen = openBlocks.has(c.key);
                  const cVals: ReactNode[] = [
                    // ô "Ngày update" của dòng con: ngày thuộc dự án nên để trống, tận dụng chỗ này đặt nút ẩn/bỏ ẩn.
                    hideBtn(c.hideKey, !!c.hidden, `${r.maCT} ${r.name} · ${c.stageAbbr} — ${c.stageLabel}`),
                    <div className="flex items-center gap-1 text-[10px] font-bold text-slate-900" style={{ paddingLeft: isBlock ? 16 : 4 }}>
                      {hasBlk && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); toggleBlocks(c.key); }}
                          title={blkOpen ? "Thu Block" : "Xổ các Block"} className="shrink-0 text-[8px] leading-none text-slate-500 hover:text-teal-700">
                          <span className="inline-block" style={{ transform: blkOpen ? "rotate(90deg)" : "none" }}>▶</span>
                        </button>
                      )}
                      <span>{c.stageAbbr}</span>
                    </div>,
                    <div className="line-clamp-1 leading-tight text-slate-900" title={c.stageLabel}>{isBlock ? `↳ ${c.stageLabel}` : c.stageLabel}</div>,
                    <div className="truncate text-slate-900" title={c.pic}>{c.pic}</div>,
                    fmtDateVN2(c.start),
                    c.actualEnd
                      ? <span className="leading-tight"><span className="text-slate-400 line-through">{fmtDateVN2(c.end)}</span><br /><span className="font-semibold text-emerald-700" title="Ngày kết thúc thực tế (lần đầu 100%)">{fmtDateVN2(c.actualEnd)}</span></span>
                      : fmtDateVN2(c.end),
                    <span className="text-slate-900">{Math.round(c.actual ?? 0)}%</span>,
                    c.overdue > 0 ? <b className="text-red-600">{c.overdue}</b> : "0",
                  ];
                  return (
                    <tr key={c.key} className={`group hover:bg-teal-50/40 ${c.hidden ? "opacity-60 hover:opacity-100" : ""}`}>
                      {LC.map((col, i) => (
                        <td key={i}
                            className={`border-b border-r border-slate-100 px-1.5 py-0.5 text-[10px] leading-tight align-middle text-slate-900 ${alCls(col.al)} ${numCol.has(i) ? "tabular-nums whitespace-nowrap" : ""}`}
                            style={{ position: col.sticky ? "sticky" : undefined, left: col.sticky ? off[i] : undefined, zIndex: col.sticky ? 12 : undefined, background: cbg, height: 28, maxWidth: col.w }}>
                          {cVals[i]}
                        </td>
                      ))}
                      <td className="relative border-r border-slate-100 p-0" style={{ height: 28, background: cbg }}>
                        {gridOverlays(28, true)}
                        {cSpan && (
                          <>
                            <div style={{ position: "absolute", top: 8, bottom: 8, left: pct(cSpan.L), width: pct(cSpan.W), background: GC.childBar, borderRadius: 2, zIndex: 2 }} />
                            {cActual > 0 && (
                              <div style={{ position: "absolute", top: 8, bottom: 8, left: pct(cSpan.L), width: pct(cSpan.W * cActual / 100), background: GC.done, borderRadius: 2, zIndex: 3 }} />
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                };
                return (
                  <Fragment key={ch.key}>
                    {renderCh(ch, false)}
                    {ch.blocks && openBlocks.has(ch.key) && ch.blocks.map((bk) => renderCh(bk, true))}
                  </Fragment>
                );
              })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function MultiSelect<T extends string>({ label, selected, options, onToggle, onClear }: {
  label: string;
  selected: T[];
  options: { v: T; l: string }[];
  onToggle: (v: T) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const count = selected.length;
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 rounded-md border bg-white px-2 py-1 text-xs ${count > 0 ? "border-teal-600 text-teal-800" : "border-slate-300 text-slate-700"} hover:border-teal-500`}>
        <span>{label}</span>
        {count > 0 ? (
          <span className="rounded bg-teal-600 px-1.5 py-0 text-[10px] font-bold text-white tabular-nums">{count}</span>
        ) : (
          <span className="text-[10px] text-slate-400">Tất cả</span>
        )}
        <span className="text-[10px] text-slate-400">▾</span>
      </button>
      {open && (
        /* z-40 chứ KHÔNG phải z-20: bảng "Tổng thể tiến độ" có thead sticky đặt zIndex
           20/22 và 32 cho cột dính — z-20 thua, nên header Gantt (TH7/26, dãy số ngày…)
           vẽ ĐÈ XUYÊN QUA danh sách lọc, nhìn như panel bị thủng.
           Thang lớp của app: header 30 · thead Gantt tối đa 32 · dropdown 40 · modal 50.
           Ai sửa z của thead Gantt thì phải kiểm lại con số này. */
        <div className="absolute right-0 z-40 mt-1 min-w-[200px] rounded-md border border-slate-200 bg-white p-1 shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-1.5 pb-1 text-[10.5px] text-slate-500">
            <span>{count > 0 ? `${count} đang chọn` : "Chưa chọn"}</span>
            {count > 0 && (
              <button onClick={onClear} className="text-teal-700 hover:underline">Bỏ chọn</button>
            )}
          </div>
          <div className="max-h-72 overflow-auto">
            {options.map(o => {
              const on = selected.includes(o.v);
              return (
                <label key={o.v} className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-50 ${on ? "bg-teal-50/50" : ""}`}>
                  <input type="checkbox" checked={on} onChange={() => onToggle(o.v)} className="h-3.5 w-3.5 accent-teal-700" />
                  <span className="text-slate-800">{o.l}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Menu "⋯ Thêm" — GOM các mục ít dùng / mang tính báo cáo–giám sát để toolbar khỏi rối:
 *  Đánh giá tuân thủ (theo tháng) + Nhật ký giám sát (chỉ admin). Thêm tính năng sau chỉ
 *  cần push thêm 1 item vào mảng. Không có mục nào khả dụng → không hiện nút (menu rỗng vô nghĩa).
 *  Vẫn giữ TÍN HIỆU: có dự án chưa cập nhật đúng hạn → chấm đỏ trên nút dù đang thu gọn. */
/** CÔNG CỤ DỮ LIỆU (ADMIN) — gom 3 tab: Cảnh báo dữ liệu · Sửa lệch STT · Sao lưu/Khôi phục. */
type ShiftMove = { from: string; to: string; text: string };
type ShiftDiag =
  | { status: "idle" } | { status: "loading" } | { status: "error"; error: string }
  | { status: "ready"; from: number; delta: number; already: boolean; moved: number; breakdown: { edits: number; completed: number; updates: number; mpflag: number }; moves: ShiftMove[] }
  | { status: "applied"; moved: number; moves: ShiftMove[] };

type NoteDriftItem = { key: string; before: string; after: string | null; text: string; target: string | null };
/** Tách "maCT||tên||giai đoạn||mô tả" → nhãn đọc được. */
function fpLabel(fp: string | null): string {
  if (!fp) return "(không còn ở đâu — item đã bị xoá/đổi)";
  const [maCT = "", name = "", stage = "", desc = ""] = fp.split("||");
  if (stage === "__DUAN__") return `${maCT || "?"} · ${name} · (cấp dự án)`;
  return `${maCT || "?"} · ${stage || "—"}${desc ? " · " + desc : ""}`;
}

type AuditDriftItem = { key: string; text: string; now: string; correct: string; target: string | null };
function AdminDataToolsDialog({ checks, qualityStats, drift, onAckDrift, onFixDrift, onFixAllDrift, audit, auditLoading, onFixAudit, onFixAuditAll, shiftDiag, onLoadShift, onApplyShift, onClose }: { checks: DataQualityCheck[]; qualityStats?: { parentsTotal: number; shownProjects: number; activeItems: number; allStageRows: number }; drift: NoteDriftItem[]; onAckDrift: (key: string) => void; onFixDrift: (key: string, target: string, before: string) => void; onFixAllDrift: () => void; audit: AuditDriftItem[]; auditLoading: boolean; onFixAudit: (key: string, target: string) => void; onFixAuditAll: () => void; shiftDiag: ShiftDiag; onLoadShift: (from: number, delta: number) => void; onApplyShift: (from: number, delta: number) => void; onClose: () => void }) {
  useEscapeToClose(onClose);
  type Bak = { id: string; label: string; at: string; counts: { edits: number; completed: number; updates: number; mpflag: number } };
  const [tab, setTab] = useState<"quality" | "shift" | "backup">((audit.length || drift.length) ? "shift" : checks.length ? "quality" : "shift");
  // GỘP audit + drift thành 1 danh sách "ghi chú đặt sai chỗ" (dedupe theo note): audit (theo nhật ký) là chuẩn,
  // drift (lệch so lần trước) bổ sung. Mỗi note: Đang ở (wrong) → Phải ở (right) + nguồn phát hiện.
  const misplaced = useMemo(() => {
    const byKey = new Map<string, { key: string; text: string; wrong: string; right: string; target: string | null; srcAudit?: boolean; srcDrift?: boolean; before?: string }>();
    for (const a of audit) byKey.set(a.key, { key: a.key, text: a.text, wrong: a.now, right: a.correct, target: a.target, srcAudit: true });
    for (const d of drift) {
      const e = byKey.get(d.key);
      if (e) { e.srcDrift = true; e.before = d.before; if (!e.target && d.target) e.target = d.target; }
      else byKey.set(d.key, { key: d.key, text: d.text, wrong: fpLabel(d.after), right: fpLabel(d.before), target: d.target, srcDrift: true, before: d.before });
    }
    return [...byKey.values()];
  }, [audit, drift]);
  const [shFrom, setShFrom] = useState(11);       // STT vị trí chèn (mọi STT ≥ đây bị dồn)
  const [shDelta, setShDelta] = useState(1);      // số bậc dồn (chèn 1 dự án = +1)
  // Vào tab "Sửa lệch STT" lần đầu → tự chạy chẩn đoán (hiện bảng "sửa cái gì" ngay, không phải bấm mò).
  useEffect(() => { if (tab === "shift" && shiftDiag.status === "idle") onLoadShift(shFrom, shDelta); }, [tab, shiftDiag.status, onLoadShift, shFrom, shDelta]);
  const [baks, setBaks] = useState<Bak[] | null>(null);
  const [busy, setBusy] = useState(false);
  const loadBaks = () => { void listBackups().then((r) => setBaks(r.backups)).catch(() => setBaks([])); };
  useEffect(() => { if (tab === "backup" && baks == null) loadBaks(); }, [tab, baks]);
  const fmt = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const doBackup = () => { setBusy(true); void backupEdits({ data: { label: "Sao lưu thủ công" } }).then(() => { toast.success("Đã tạo bản sao lưu."); loadBaks(); }).catch((e) => toast.error(`Lỗi: ${(e as Error).message}`)).finally(() => setBusy(false)); };
  const doRestore = (b: Bak) => {
    toast(`Khôi phục về bản ${fmt(b.at)} (${b.counts.edits} ghi chú)? Ghi đè dữ liệu HIỆN TẠI (bản hiện tại tự chụp lại trước).`, {
      duration: 15000,
      action: { label: "Khôi phục", onClick: () => { setBusy(true); void restoreBackup({ data: { id: b.id } }).then(() => { toast.success("Đã khôi phục — tải lại trang (Ctrl+F5) để thấy."); loadBaks(); }).catch((e) => toast.error(`Khôi phục lỗi: ${(e as Error).message}`)).finally(() => setBusy(false)); } },
    });
  };
  if (typeof document === "undefined") return null;
  const tabBtn = (id: "quality" | "shift" | "backup", label: string, badge?: number) => (
    <button onClick={() => setTab(id)} className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${tab === id ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
      {label}{badge != null && badge > 0 && <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white">{badge}</span>}
    </button>
  );
  return createPortal(
    // KHÔNG đóng khi bấm nền ngoài (tránh mất bảng lúc đang đọc) — chỉ đóng bằng nút ✕ hoặc Esc.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 print:hidden">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600">Công cụ dữ liệu · Admin</div>
            <div className="text-sm font-bold text-slate-900">Kiểm soát &amp; sửa dữ liệu</div>
          </div>
          <button onClick={onClose} aria-label="Đóng" title="Đóng (Esc)" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex items-center gap-1 border-b border-slate-100 px-4 py-1.5">
          {tabBtn("shift", "Ghi chú lệch STT", misplaced.length)}
          {tabBtn("quality", "Cảnh báo dữ liệu", checks.length)}
          {tabBtn("backup", "Sao lưu & Khôi phục")}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {tab === "shift" && (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[12.5px] leading-relaxed text-slate-700">
                <div className="mb-0.5 text-[13px] font-bold text-slate-800">① Ghi chú đang lệch (tự phát hiện)</div>
                Đối chiếu <b>Nhật ký giám sát</b> (nơi note được VIẾT — chuẩn nhất) + <b>lệch so lần trước</b> để chỉ ra note đang gắn nhầm dự án. Xem để BIẾT lệch ở đâu, thử “Đưa về đúng chỗ”; nếu chưa được thì dùng <b>② Dịch STT đồng loạt</b> bên dưới (cái chạy chắc). <b>Nên “Tạo bản sao lưu” (tab Sao lưu) trước khi sửa.</b>
              </div>
              {auditLoading && <div className="py-4 text-center text-sm text-slate-400">Đang đọc nhật ký…</div>}
              {!auditLoading && misplaced.length === 0 && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-6 text-center text-[13px] text-emerald-700">✔ Không có ghi chú nào đặt sai chỗ.</div>}
              {misplaced.length > 0 && (
                <>
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
                    <span className="text-[12.5px] font-semibold text-amber-900">Phát hiện <b>{misplaced.length}</b> ghi chú đặt sai — {misplaced.filter((d) => d.target).length} cái đưa về tự động được.</span>
                    <button onClick={() => { onFixAuditAll(); onFixAllDrift(); }} className="rounded-md bg-teal-700 px-3 py-1 text-[12px] font-bold text-white hover:bg-teal-800">Đưa tất cả về đúng chỗ</button>
                  </div>
                  {misplaced.map((d) => {
                    const src = d.srcAudit && d.srcDrift ? "📒 Sổ + lệch" : d.srcAudit ? "📒 Theo nhật ký" : "🔄 Lệch lần trước";
                    return (
                      <div key={d.key} className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                        <div className="mb-1.5 flex items-start justify-between gap-2">
                          <div className="text-[12.5px] font-medium text-slate-800">“{d.text}”</div>
                          <span title="Nguồn phát hiện" className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[9.5px] font-semibold text-slate-500">{src}</span>
                        </div>
                        <div className="grid grid-cols-[74px_1fr] gap-x-2 gap-y-1 text-[11.5px]">
                          <span className="font-semibold text-rose-600">Đang ở:</span><span className="font-semibold text-rose-700">{d.wrong}</span>
                          <span className="font-semibold text-emerald-700">Phải ở:</span><span className="font-semibold text-emerald-800">{d.right || "(chưa xác định được)"}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {d.target
                            ? <button onClick={() => d.srcAudit ? onFixAudit(d.key, d.target!) : onFixDrift(d.key, d.target!, d.before ?? "")} className="rounded-md bg-teal-700 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-teal-800">↩ Đưa về đúng chỗ</button>
                            : <span className="text-[10.5px] text-slate-400">Chưa tự đưa về được (đích chưa có trong nguồn đang tải / đang có note khác) — sửa STT/mô tả ở nguồn.</span>}
                          {d.srcDrift && <button onClick={() => onAckDrift(d.key)} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100">Vị trí hiện tại đúng — bỏ cảnh báo</button>}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
          {tab === "quality" && <DataQualityBody checks={checks} stats={qualityStats} />}
          {tab === "shift" && (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-[12.5px] leading-relaxed text-slate-700">
                <div className="mb-1 text-[13px] font-bold text-slate-800">② Dịch STT đồng loạt (thủ công — chạy chắc)</div>
                Vướng mắc/Giải pháp, ngày hoàn thành và cờ “Cần cập nhật MP” được lưu theo <b>STT dự án</b> (khoá <code className="rounded bg-slate-200 px-1">id:STT</code>). Khi ai đó <b>chèn thêm một dự án vào giữa</b> nguồn, STT của mọi dự án phía sau bị dồn xuống → các ghi chú cũ vẫn trỏ STT cũ nên <b className="text-rose-700">hiện nhầm sang dự án bên cạnh</b>. Công cụ này dời từng khoá về đúng dự án — có <b>xem trước từng dòng</b> rồi mới áp dụng.
              </div>

              {/* Điều khiển: chọn vị trí chèn + số bậc dồn → dùng cho MỌI đợt chèn, không cứng 1 sự kiện. */}
              <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
                <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
                  Chèn dự án ở STT
                  <input type="number" min={1} value={shFrom} onChange={(e) => setShFrom(Math.max(1, parseInt(e.target.value || "1", 10)))}
                    className="w-24 rounded-md border border-slate-300 px-2 py-1 text-[13px] text-slate-800" />
                </label>
                <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
                  Số bậc dồn
                  <input type="number" min={1} value={shDelta} onChange={(e) => setShDelta(Math.max(1, parseInt(e.target.value || "1", 10)))}
                    className="w-20 rounded-md border border-slate-300 px-2 py-1 text-[13px] text-slate-800" />
                </label>
                <button onClick={() => onLoadShift(shFrom, shDelta)} className="rounded-md bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-900">Kiểm tra</button>
                <span className="text-[11px] leading-snug text-slate-500">Mọi STT ≥ {shFrom} sẽ được dời về STT +{shDelta}.<br/>Chèn thêm 1 dự án = +1 (mặc định).</span>
              </div>

              {shiftDiag.status === "loading" && <div className="py-6 text-center text-sm text-slate-400">Đang kiểm tra dữ liệu…</div>}
              {shiftDiag.status === "error" && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">Lỗi kiểm tra: {shiftDiag.error} <button onClick={() => onLoadShift(shFrom, shDelta)} className="ml-1 underline">Thử lại</button></div>}
              {shiftDiag.status === "applied" && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">✔ Đã dời {shiftDiag.moved} khoá về đúng dự án. Chi tiết “lệch ở đâu” đã ghi vào Nhật ký giám sát. Tải lại trang (Ctrl+F5) để thấy ghi chú về đúng chỗ.</div>
              )}

              {shiftDiag.status === "ready" && shiftDiag.already && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">✔ Đợt chèn ở STT {shiftDiag.from} (+{shiftDiag.delta}) <b>đã được sửa trước đó</b> — không dời lại (chống dời 2 lần).</div>
              )}
              {shiftDiag.status === "ready" && !shiftDiag.already && shiftDiag.moved === 0 && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">✔ Không có khoá nào ở STT ≥ {shiftDiag.from} — <b>không cần sửa gì</b> với đợt chèn này.</div>
              )}
              {shiftDiag.status === "ready" && !shiftDiag.already && shiftDiag.moved > 0 && (
                <>
                  <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-900">
                    Phát hiện <b>{shiftDiag.moved} khoá</b> ở STT ≥ {shiftDiag.from} cần dời +{shiftDiag.delta} về đúng dự án — vướng mắc/giải pháp {shiftDiag.breakdown.edits} · ngày {shiftDiag.breakdown.completed} · lịch cập nhật {shiftDiag.breakdown.updates} · cờ MP {shiftDiag.breakdown.mpflag}.
                  </div>
                  {shiftDiag.moves.length > 0 && (
                    <div className="overflow-hidden rounded-lg border border-slate-200">
                      <div className="grid grid-cols-[1.4fr_auto_1fr] gap-3 border-b border-slate-200 bg-slate-100 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        <span>Ghi chú · đang gắn nhầm ở dự án</span><span className="text-center">dời về</span><span>đúng dự án</span>
                      </div>
                      <ul className="max-h-[42vh] divide-y divide-slate-100 overflow-auto">
                        {shiftDiag.moves.map((mv, i) => (
                          <li key={i} className="grid grid-cols-[1.4fr_auto_1fr] items-center gap-3 px-3 py-1.5 text-[11.5px]">
                            <span className="min-w-0"><span className="line-clamp-2 text-slate-700" title={mv.text}>“{mv.text}”</span><span className="mt-0.5 block truncate font-semibold text-rose-600" title={mv.from}>{mv.from}</span></span>
                            <span className="text-slate-400">→</span>
                            <span className="min-w-0 self-center truncate font-semibold text-emerald-700" title={mv.to}>{mv.to}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => onApplyShift(shiftDiag.from, shiftDiag.delta)} className="rounded-md bg-orange-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-orange-700">Áp dụng: dời {shiftDiag.moved} khoá về đúng dự án</button>
                    <span className="text-[11px] text-slate-500">Chạy 1 lần cho đợt này · tự sao lưu trước khi dời · ghi Nhật ký giám sát.</span>
                  </div>
                </>
              )}
            </div>
          )}
          {tab === "backup" && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <button onClick={doBackup} disabled={busy} className="rounded-md bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50">+ Tạo bản sao lưu ngay</button>
                <span className="text-[11px] text-slate-500">Tự sao lưu trước mỗi lần “Sửa lệch STT”. Giữ 8 bản gần nhất.</span>
              </div>
              {baks == null ? <div className="py-6 text-center text-sm text-slate-400">Đang tải…</div>
                : baks.length === 0 ? <div className="py-6 text-center text-sm text-slate-400">Chưa có bản sao lưu nào.</div>
                : <div className="flex flex-col gap-1.5 pb-2">{baks.map((b) => (
                    <div key={b.id} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-semibold text-slate-800">{b.label}</div>
                        <div className="text-[10px] text-slate-500">{fmt(b.at)} · {b.counts.edits} ghi chú · {b.counts.mpflag} cờ MP</div>
                      </div>
                      <button onClick={() => doRestore(b)} disabled={busy} className="shrink-0 rounded-md border border-amber-400 px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50">Khôi phục</button>
                    </div>
                  ))}</div>}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ReportsMenu({ showCompliance, complianceBadge, onOpenCompliance, isAdmin, onOpenActivity, onOpenRoles, qualityIssues = 0, onOpenDataTools, onOpenSource, tvMode, onToggleTv }: {
  showCompliance: boolean;
  complianceBadge: number;
  onOpenCompliance: () => void;
  isAdmin: boolean;
  onOpenActivity: () => void;
  onOpenRoles: () => void;
  /** Số mục cảnh báo chất lượng dữ liệu — hiện làm badge trên mục "Công cụ dữ liệu (Admin)". */
  qualityIssues?: number;
  /** CÔNG CỤ DỮ LIỆU (CHỈ admin) — gom Cảnh báo dữ liệu + Sửa lệch STT + Sao lưu/Khôi phục. */
  onOpenDataTools?: () => void;
  /** Đổi nguồn dữ liệu (CHỈ admin) — mở dialog Nguồn dữ liệu. */
  onOpenSource?: () => void;
  /** Chế độ Trình chiếu TV (fullscreen cả app + lấp đầy màn hình lớn) — bật/tắt ngay trong menu. */
  tvMode: boolean;
  onToggleTv: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const items: { icon: ReactNode; label: string; badge?: number; badgeAmber?: boolean; active?: boolean; onClick: () => void }[] = [];
  if (showCompliance) items.push({ icon: <ClipboardCheck className="h-4 w-4 text-slate-500" />, label: "Đánh giá tuân thủ", badge: complianceBadge, onClick: onOpenCompliance });
  if (isAdmin && onOpenDataTools) items.push({ icon: <AlertTriangle className="h-4 w-4 text-indigo-500" />, label: "Công cụ dữ liệu (Admin)", badge: qualityIssues, badgeAmber: true, onClick: onOpenDataTools });
  if (isAdmin) items.push({ icon: <ScrollText className="h-4 w-4 text-indigo-500" />, label: "Nhật ký giám sát", onClick: onOpenActivity });
  if (isAdmin) items.push({ icon: <Users className="h-4 w-4 text-teal-600" />, label: "Phân cấp người dùng", onClick: onOpenRoles });
  if (isAdmin && onOpenSource) items.push({ icon: <Settings className="h-4 w-4 text-slate-500" />, label: "Nguồn dữ liệu", onClick: onOpenSource });
  // Trình chiếu TV — CHO MỌI NGƯỜI (không riêng admin): fullscreen cả app + phóng lấp đầy màn TV.
  items.push({ icon: <Tv className="h-4 w-4 text-violet-600" />, label: tvMode ? "Tắt trình chiếu TV" : "Trình chiếu TV", active: tvMode, onClick: onToggleTv });
  if (items.length === 0) return null;

  const flag = showCompliance && complianceBadge > 0; // tín hiệu cần chú ý

  return (
    <div ref={ref} className="relative print:hidden">
      <button type="button" onClick={() => setOpen(o => !o)}
        title="Tính năng hệ thống: đánh giá tuân thủ, nhật ký giám sát, trình chiếu TV"
        className={`relative flex h-7 items-center gap-1.5 rounded-md border bg-white px-2.5 text-xs font-semibold hover:border-teal-500 ${open ? "border-teal-500 text-teal-700" : "border-slate-300 text-slate-700"}`}>
        <MoreHorizontal className="h-3.5 w-3.5" /> Hệ thống
        {flag && !open && (
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white"
                title={`${complianceBadge} dự án chưa cập nhật đúng hạn tuần này`} />
        )}
      </button>
      {open && (
        /* z-40 theo thang lớp của app (header 30 · thead Gantt ≤32 · dropdown 40 · modal 50). */
        <div className="absolute right-0 z-40 mt-1 min-w-[220px] rounded-md border border-slate-200 bg-white p-1 shadow-lg">
          <div className="border-b border-slate-100 px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Báo cáo &amp; giám sát
          </div>
          {items.map((it, i) => (
            <button key={i} onClick={() => { setOpen(false); it.onClick(); }}
              className={`flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-[12px] font-medium hover:bg-slate-50 ${it.active ? "text-violet-800" : "text-slate-700"}`}>
              {it.icon}
              <span className="flex-1">{it.label}</span>
              {it.active && (
                <span className="inline-flex items-center rounded-full bg-violet-100 px-1.5 text-[9px] font-bold text-violet-700">ĐANG BẬT</span>
              )}
              {it.badge != null && it.badge > 0 && (
                <span className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white ${it.badgeAmber ? "bg-amber-500" : "bg-red-500"}`}
                      title={it.badgeAmber ? `${it.badge} cảnh báo chất lượng dữ liệu` : `${it.badge} dự án chưa cập nhật đúng hạn tuần này`}>{it.badge}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ======================================================================


/* ======================================================================
 *  UTIL
 * ====================================================================== */

function fmtDateVN2(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : "—";
}

/** "HH:mm dd/mm/yy" từ ISO timestamp (giờ máy người xem). */
function fmtDateTimeVN(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
}

/** "dd/mm" gọn cho chip ✎ trong bảng. */
/** Chip NGÀY UPDATE — thông tin phụ, hiện nhỏ như badge ✎ bên cột Vướng mắc.
 *  Thang màu xanh lá → đỏ theo ĐỘ CŨ, chia theo CHU KỲ TUẦN (7 ngày) cho khớp luật
 *  tuân thủ ("quá 7 ngày = không cập nhật"): càng nhiều chu kỳ bỏ lỡ càng đỏ. */
function UpdateChip({ date, today }: { date: string | null | undefined; today: string }) {
  if (!date) return <span className="text-[9px] text-slate-300">—</span>;
  const d = Math.round(
    (Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)) -
     Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))) / 86400000,
  );
  const tone =
    d <= 7  ? "bg-emerald-100 text-emerald-800"   // còn trong chu kỳ → đạt
    : d <= 14 ? "bg-amber-100 text-amber-800"     // lỡ 1 chu kỳ
    : d <= 21 ? "bg-orange-200 text-orange-900"   // lỡ 2 chu kỳ
    :           "bg-red-500 text-white";          // bỏ bê ≥3 chu kỳ
  return (
    <span className={`inline-block whitespace-nowrap rounded px-0.5 text-[9px] font-bold tabular-nums ${tone}`}
          title={`Cập nhật gần nhất: ${fmtDateVN2(date)} (${d} ngày trước)`}>
      {fmtDayMonth(date)}
    </span>
  );
}

function fmtDayMonth(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}

/* ====================================================================
 * NHẬT KÝ GIÁM SÁT — bảng ai XEM / THAO TÁC gì, lúc nào.
 * Chỉ admin (liemnt1 / tienthn) mở được nút này; quyền đọc còn được kiểm LẠI ở
 * server (activity.functions.ts) nên không thể gọi tắt API để lấy dữ liệu.
 * ==================================================================== */
/* ====================================================================
 * PHÂN CẤP NGƯỜI DÙNG (admin) — gán email → cấp (PMO/BOD) để hiện badge trong comment.
 * Kho KV `roles:v1` (edits.functions.ts); ghi chỉ admin (kiểm lại ở server). Admin tự thêm/gỡ,
 * KHÔNG cần sửa code. Sau thêm cấp mới chỉ cần nới ALL_ROLES + ROLE_META trong lib/roles.ts.
 * ==================================================================== */
function RoleManagerDialog({ roleMap, onClose, onSaved }: {
  roleMap: Record<string, UserRole>; onClose: () => void; onSaved: (m: Record<string, UserRole>) => void;
}) {
  useEscapeToClose(onClose);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>(ALL_ROLES[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isValidEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
  const save = async (mail: string, r: UserRole | null) => {
    const e = mail.trim().toLowerCase();
    if (r && !isValidEmail(e)) { setErr("Email chưa hợp lệ — nhập đúng dạng ten@aacorporation.com."); return; }  // GỠ cấp (r=null) thì email đến từ danh sách nên bỏ qua
    if (!e) return;
    setBusy(true); setErr(null);
    try {
      const res = await saveUserRole({ data: { email: e, role: r, devAs: devAs() } });
      onSaved(res.roles);
      if (r) setEmail("");
    } catch (ex) { setErr((ex as Error).message || "Lưu thất bại."); }
    finally { setBusy(false); }
  };

  // Gom email theo cấp để liệt kê.
  const byRole = ALL_ROLES.map((r) => ({
    role: r,
    emails: Object.entries(roleMap).filter(([, v]) => v === r).map(([e]) => e).sort(),
  }));

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 print:hidden">
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-teal-700">Hệ thống · chỉ admin</div>
            <div className="text-sm font-bold text-slate-900">PHÂN CẤP NGƯỜI DÙNG</div>
            <div className="mt-0.5 text-[11px] text-slate-600">Gán email vào cấp để hiện badge trong comment. Email không có trong danh sách = “users” (không badge).</div>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100">Đóng ✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="mb-1.5 text-[11px] font-semibold text-slate-600">Thêm / đổi cấp</div>
            <div className="flex flex-wrap items-center gap-2">
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@aacorporation.com"
                type="email" autoComplete="off" name="role-email-nofill" data-lpignore="true"
                onKeyDown={(e) => { if (e.key === "Enter" && isValidEmail(email)) void save(email, role); }}
                className="min-w-[210px] flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none" />
              <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[12px] text-slate-900">
                {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_META[r].short} — {ROLE_META[r].label}</option>)}
              </select>
              <button type="button" disabled={busy || !isValidEmail(email)} onClick={() => void save(email, role)}
                className="rounded-md bg-teal-700 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-teal-800 disabled:opacity-40">Lưu</button>
            </div>
            {err && <div className="mt-1.5 text-[11px] font-medium text-red-600">{err}</div>}
          </div>
          {byRole.map(({ role: r, emails }) => (
            <div key={r} className="mb-3">
              <div className="mb-1 flex items-center gap-2">
                <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${ROLE_META[r].badge}`}>{ROLE_META[r].short}</span>
                <span className="text-[11px] text-slate-500">{ROLE_META[r].label} · {emails.length}</span>
              </div>
              {emails.length === 0 ? <div className="pl-1 text-[11px] text-slate-400">— chưa có ai —</div> : (
                <ul className="space-y-1">
                  {emails.map((e) => (
                    <li key={e} className="flex items-center justify-between rounded-md border border-slate-100 bg-white px-2 py-1 text-[12px]">
                      <span className="text-slate-700">{e}</span>
                      <button type="button" disabled={busy} title="Gỡ cấp (về users)" onClick={() => void save(e, null)}
                        className="shrink-0 text-slate-400 hover:text-red-600 disabled:opacity-40"><X className="h-3.5 w-3.5" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ActivityLogDialog({ onClose }: { onClose: () => void }) {
  useEscapeToClose(onClose);
  // PHÂN TRANG: `rows` = các trang ĐÃ tải cộng dồn (app KHÔNG ôm hết log). Lọc Người/Ngày/Thao tác
  // ở SERVER; "Tải thêm cũ hơn" kéo trang kế theo con trỏ `cursor` (ts của dòng cuối). q = tìm ở client
  // trên phần đã tải (thu hẹp dần; muốn tìm sâu hơn thì bấm Tải thêm).
  const PAGE = 200;
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [who, setWho] = useState<string>("");    // "" = tất cả mọi người (lọc Ở SERVER)
  const [days, setDays] = useState<number>(7);     // 0 = toàn bộ
  const [q, setQ] = useState<string>("");          // ô tìm kiếm tự do (client-side, trên phần đã tải)
  const [actionF, setActionF] = useState<string>(""); // "" = mọi loại thao tác (lọc Ở SERVER)
  const [users, setUsers] = useState<string[]>([]);    // danh sách người (server, cho dropdown)
  const [actions, setActions] = useState<string[]>([]); // danh sách loại thao tác (server)
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [backing, setBacking] = useState(false);

  // SAO LƯU toàn bộ nhật ký ra Google Drive (DATABASE › ePMP › Nhật ký giám sát › nhat-ky-giam-sat.csv).
  const doBackup = useCallback(async () => {
    setBacking(true);
    try {
      const r = await backupAuditLogToDrive({ data: { devAs: devAs() } });
      if (!r.ok) { toast.error(r.msg || "Sao lưu thất bại."); return; }
      toast.success(`Đã ${r.updated ? "cập nhật" : "tạo"} bản sao lưu ${r.count} dòng lên Drive.`, {
        duration: 8000,
        action: r.link ? { label: "Mở Drive", onClick: () => window.open(r.link!, "_blank") } : undefined,
      });
    } catch (e) {
      toast.error("Sao lưu lỗi: " + (e as Error).message);
    } finally {
      setBacking(false);
    }
  }, []);

  // Mốc "kể từ" theo NỬA ĐÊM ĐỊA PHƯƠNG (không phải 24h trượt): "Hôm nay" = từ 00:00 hôm nay;
  // "7/30 ngày" = 7/30 ngày dương lịch TÍNH CẢ hôm nay. Sửa lỗi "Hôm nay" lọt sang ngày hôm trước.
  const sinceMs = useMemo(() => {
    if (days <= 0) return null;
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return d.getTime() - (days - 1) * 86_400_000;
  }, [days]);

  const since = useMemo(() => (sinceMs != null ? new Date(sinceMs).toISOString() : null), [sinceMs]);

  // TRANG ĐẦU — đổi Người/Ngày/Thao tác thì tải lại từ đầu. Server đã lọc sẵn nên client chỉ giữ 1 trang.
  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetchActivityLog({ data: { email: who || null, since, action: actionF || null, before: null, limit: PAGE, devAs: devAs() } });
      if (!r.ok) { setErr("Bạn không có quyền xem nhật ký này."); setRows([]); setHasMore(false); return; }
      setRows(r.rows);
      setHasMore(r.hasMore);
      if (r.users?.length) setUsers(r.users);        // dropdown chỉ nạp ở trang đầu
      if (r.actions?.length) setActions(r.actions);
    } catch (e) {
      setErr((e as Error).message || "Không tải được nhật ký.");
    } finally {
      setLoading(false);
    }
  }, [who, since, actionF]);
  useEffect(() => { void load(); }, [load]);

  // TẢI THÊM (cũ hơn) — kéo trang kế theo con trỏ = ts của dòng CŨ NHẤT đang có; cộng dồn vào rows.
  const loadMore = useCallback(async () => {
    if (loadingMore || !rows.length) return;
    setLoadingMore(true);
    try {
      const before = rows[rows.length - 1].ts;
      const r = await fetchActivityLog({ data: { email: who || null, since, action: actionF || null, before, limit: PAGE, devAs: devAs() } });
      if (r.ok) { setRows((prev) => [...prev, ...r.rows]); setHasMore(r.hasMore); }
    } catch { /* giữ nguyên phần đã tải */ }
    finally { setLoadingMore(false); }
  }, [loadingMore, rows, who, since, actionF]);

  const fmtTs = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  // Màu nhẹ theo nhóm thao tác — quét mắt nhanh, KHÔNG lạm dụng đỏ (đỏ để dành cảnh báo thật).
  const tone = (a: string) =>
    a === "view" ? "bg-slate-100 text-slate-600"
    : a.startsWith("export") ? "bg-emerald-50 text-emerald-700"
    : a === "save_edit" || a === "change_source" ? "bg-amber-50 text-amber-800"
    : "bg-indigo-50 text-indigo-700";

  const DAY_OPTS = [
    { v: 1, l: "Hôm nay" }, { v: 7, l: "7 ngày" }, { v: 30, l: "30 ngày" }, { v: 0, l: "Tất cả" },
  ];

  // Người/Ngày/Thao tác lọc Ở SERVER. Ô TÌM (q) tìm ở CLIENT trên các trang đã tải — bỏ dấu tiếng Việt
  // để gõ "tien" vẫn ra "Tiên"; quét cả tài khoản, nhãn thao tác lẫn chi tiết.
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
  const whoOpts = users;       // danh sách người từ server (không còn cascading — lọc thẳng ở D1)
  const actionOpts = actions;  // danh sách loại thao tác từ server
  const filtered = useMemo(() => {
    const nq = norm(q.trim());
    if (!nq) return rows;
    return rows.filter((r) => norm(`${r.email} ${actionLabel(r.action)} ${r.detail || ""}`).includes(nq));
  }, [rows, q]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 print:hidden">
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b-2 border-indigo-400 px-5 py-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-700">Giám sát truy cập</div>
            <div className="text-sm font-bold text-slate-900">NHẬT KÝ XEM &amp; THAO TÁC</div>
            <div className="mt-0.5 text-[11px] text-slate-600">
              Ghi nhận theo tài khoản đăng nhập: ai mở app, xem báo cáo, xuất file, sửa dữ liệu — kèm thời điểm.
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100">Đóng ✕</button>
        </div>

        {/* Thanh lọc */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-500">Người:</span>
            <select value={who} onChange={(e) => setWho(e.target.value)}
              className="max-w-[220px] rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700">
              <option value="">Tất cả ({whoOpts.length})</option>
              {whoOpts.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1">
            {DAY_OPTS.map((d) => (
              <button key={d.v} onClick={() => setDays(d.v)}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium ${days === d.v ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-slate-300 text-slate-600 hover:border-indigo-400"}`}>
                {d.l}
              </button>
            ))}
          </div>
          {/* Lọc theo LOẠI thao tác — chỉ hiện các loại đang có trong tập đã tải. */}
          <select value={actionF} onChange={(e) => setActionF(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700">
            <option value="">Mọi thao tác</option>
            {actionOpts.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
          </select>
          {/* Ô TÌM KIẾM tự do (tài khoản / thao tác / chi tiết) */}
          <div className="relative">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tài khoản, chi tiết…"
              className="w-[180px] rounded-md border border-slate-300 bg-white px-2 py-1 pr-6 text-[11px] text-slate-700 focus:border-indigo-400 focus:outline-none" />
            {q && (
              <button onClick={() => setQ("")} title="Xoá tìm kiếm"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <button onClick={() => void doBackup()} disabled={backing}
            className="ml-auto flex items-center gap-1 rounded-md border border-teal-300 bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-700 hover:border-teal-500 disabled:opacity-50"
            title="Xuất toàn bộ nhật ký ra Google Drive (DATABASE › ePMP › Nhật ký giám sát)">
            {backing ? "⏳ Đang lưu…" : "⤓ Sao lưu ra Drive"}
          </button>
          <button onClick={() => void load()} disabled={loading}
            className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-indigo-400 disabled:opacity-50">
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Làm mới
          </button>
        </div>

        {/* KHÔNG để padding-top ở khung cuộn: `sticky top-0` bám mép TRONG của padding,
            nên nếu có pt thì dòng cuộn lên sẽ LÓ ra ở dải trống phía trên header. Đưa
            khoảng đệm trên vào nội dung (pt-3) để nó CUỘN theo, header dính sát mép. */}
        <div className="min-h-0 flex-1 overflow-auto px-5 pb-3">
          {err ? (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700">{err}</div>
          ) : loading && rows.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-slate-400">Đang tải nhật ký…</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-slate-400">Chưa có hoạt động nào trong khoảng đã chọn.</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-slate-400">Không có dòng nào khớp tìm kiếm / bộ lọc.</div>
          ) : (
            <>
              <div className="mb-2 pt-3 text-[11px] text-slate-500">
                {q.trim()
                  ? `${filtered.length}/${rows.length} lượt đã tải khớp tìm kiếm`
                  : `Đã tải ${rows.length} lượt (mới nhất trên cùng)`}
                {hasMore && <span className="text-slate-400"> · còn dòng cũ hơn</span>}
              </div>
              <table className="w-full border-collapse text-[11.5px]">
                {/* Sticky đặt Ở TỪNG <th> chứ KHÔNG ở <thead>: nhiều trình duyệt bỏ qua
                    position:sticky trên thead/tr, khiến header trôi vào giữa và các dòng đè
                    lên (lỗi đã gặp). Nền trắng + z-10 để dòng cuộn XUỐNG DƯỚI header; viền
                    dưới dùng box-shadow inset để nó DÍNH theo ô sticky (border thường của
                    border-collapse không cuộn theo). */}
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                    <th className="sticky top-0 z-10 w-[92px] bg-white py-1.5 pr-2 font-semibold shadow-[inset_0_-1px_0_0_#e2e8f0]">Thời điểm</th>
                    <th className="sticky top-0 z-10 bg-white py-1.5 pr-2 font-semibold shadow-[inset_0_-1px_0_0_#e2e8f0]">Tài khoản</th>
                    <th className="sticky top-0 z-10 w-[200px] bg-white py-1.5 pr-2 font-semibold shadow-[inset_0_-1px_0_0_#e2e8f0]">Thao tác</th>
                    <th className="sticky top-0 z-10 bg-white py-1.5 font-semibold shadow-[inset_0_-1px_0_0_#e2e8f0]">Chi tiết</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums text-slate-500">{fmtTs(r.ts)}</td>
                      <td className="py-1.5 pr-2 text-slate-700">{r.email}</td>
                      <td className="py-1.5 pr-2">
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[10.5px] font-medium ${tone(r.action)}`}>{actionLabel(r.action)}</span>
                      </td>
                      <td className="py-1.5 text-slate-700">{r.detail || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hasMore && (
                <div className="flex justify-center py-3">
                  <button onClick={() => void loadMore()} disabled={loadingMore}
                    className="rounded-md border border-indigo-300 bg-indigo-50 px-4 py-1.5 text-[11.5px] font-semibold text-indigo-700 hover:border-indigo-500 disabled:opacity-50">
                    {loadingMore ? "Đang tải…" : `Tải thêm ${PAGE} lượt cũ hơn`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ====================================================================
 * BÁO CÁO TUÂN THỦ CẬP NHẬT MASTER PLAN (theo THÁNG) — ĐỌC TỪ FILE NGUỒN RIÊNG.
 * App CHỈ CHẤM ĐIỂM; mọi data ✔/o/x + vùng + PM + lũy kế lấy THẲNG từ file (lib/compliance-file.ts).
 * BẢNG PHẲNG: mỗi dòng 1 dự án, mỗi cột tuần của THÁNG (vd P–T = 01/07…29/07) 1 dấu. Xếp mặc
 * định theo SỐ LẦN KHÔNG CẬP NHẬT (nhiều→ít). Điểm = 100 − 25·x − 10·o (chỉ tính tháng này).
 * ==================================================================== */
/** Chuẩn hoá tên dự án để ĐỐI CHIẾU (file tuân thủ ↔ PMP): bỏ dấu, thường hoá, gom khoảng trắng,
 *  bỏ ký tự không phải chữ/số. Khớp bất chấp lệch dấu/hoa-thường/dấu câu; lệch nhiều thì KHÔNG khớp
 *  (thà thiếu badge còn hơn gắn nhầm). */
function normProjName(s: string): string {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();
}

function ComplianceMark({ m }: { m: CMark }) {
  // GLYPH ký tự (KHÔNG dùng icon SVG lucide): html2canvas render SVG không ổn định → khi XUẤT PDF
  // dấu ✓/✕ bị méo/mất. Ký tự unicode render chắc chắn trên cả màn hình lẫn PDF, nhìn gần như y hệt.
  // ✓ = đúng hạn (xanh nhạt, lùi lại); o (trễ) = vàng; ✕ = KHÔNG cập nhật (đỏ đậm, ngoại lệ nổi bật).
  if (m === "P") return <span className="text-[13px] font-bold leading-none text-emerald-500" title="Đúng hạn">✓</span>;
  if (m === "o") return <span className="text-[17px] font-black leading-none text-amber-500" title="Cập nhật trễ">o</span>;
  if (m === "x") return <span className="text-[13px] font-bold leading-none text-red-600" title="Không cập nhật">✕</span>;
  return <span className="text-[11px] text-slate-300" title="Không có thông tin (chưa có dữ liệu tuần này)">–</span>;
}

/** Dòng PM ở Tóm tắt tuân thủ: tên + điểm TB; RÊ CHUỘT → popover ĐẸP liệt kê dự án + điểm (tên đầy
 *  đủ). Popover dùng position:fixed (thoát vùng cuộn, không bị cắt) + tự lật lên/xuống theo vị trí. */
function PmSummaryRow({ pm, avgLabel, avgColor, projects }: {
  pm: string; avgLabel: string; avgColor: string;
  projects: { name: string; label: string; color: string }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pop, setPop] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const show = () => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const up = r.bottom > window.innerHeight * 0.55;
    setPop({ x: Math.min(r.left, window.innerWidth - 284), y: up ? r.top - 6 : r.bottom + 6, up });
  };
  return (
    <div ref={ref} onMouseEnter={show} onMouseLeave={() => setPop(null)}
         className="flex cursor-help items-baseline justify-between gap-2 border-b border-slate-100 py-[3px] hover:bg-teal-50/60">
      <span className="truncate text-[10px] text-slate-700">{pm}</span>
      <span className="shrink-0 text-[11px] font-extrabold tabular-nums" style={{ color: avgColor }}>{avgLabel}</span>
      {pop && (
        <div style={{ position: "fixed", left: pop.x, top: pop.y, transform: pop.up ? "translateY(-100%)" : undefined, zIndex: 90 }}
             className="w-[272px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
          <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 bg-slate-50 px-2.5 py-1.5">
            <span className="truncate text-[11px] font-semibold text-slate-800">{pm}</span>
            <span className="shrink-0 whitespace-nowrap text-[9px] text-slate-500">Điểm TB <b className="text-[12px] tabular-nums" style={{ color: avgColor }}>{avgLabel}</b></span>
          </div>
          <div className="max-h-[56vh] overflow-auto py-1">
            {projects.map((p, i) => (
              <div key={i} className={`flex items-baseline justify-between gap-2 px-2.5 py-[2px] text-[10px] ${i % 2 ? "bg-slate-50/60" : ""}`}>
                <span className="min-w-0 flex-1 leading-snug text-slate-600">{p.name}</span>
                <span className="shrink-0 font-bold tabular-nums" style={{ color: p.color }}>{p.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Lớp CSS khối "Cách tính điểm" (rulesRef) — dùng CHUNG cho JSX (view Chi tiết) và khi tạm hiện để chụp bản GỘP.
const COMPLIANCE_RULES_CLS = "mt-2 flex flex-wrap items-stretch justify-between gap-x-6 gap-y-3 text-[10px] leading-relaxed text-slate-600";

// VÙNG → nhãn Tiếng Việt + thứ tự trình bày (báo cáo tuân thủ gom theo Vùng). Nhận cả tiếng Anh (Middle/South…)
// lẫn mã/tiếng Việt sẵn có. Lạ → giữ nguyên (xuống cuối).
const VUNG_ORDER = ["Phú Quốc", "Bắc", "Trung", "Nam", "Nước Ngoài"];
function vungVN(raw: string): string {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return "—";
  if (/ph[uú]\s*qu[oố]c|^pq$/.test(s)) return "Phú Quốc";
  if (/oversea|overseas|foreign|n[uư][oớ]c\s*ngo[aà]i|^nn$/.test(s)) return "Nước Ngoài";
  if (/north|b[aắ]c|^mb$|h[aà]\s*n[oộ]i|hanoi/.test(s)) return "Bắc";
  if (/middle|central|trung|^mt$|đ[aà]\s*n[aẵ]ng|danang/.test(s)) return "Trung";
  if (/south|nam|^mn$|h[oồ]\s*ch[ií]|hcm|s[aà]i\s*g[oò]n/.test(s)) return "Nam";
  return raw.trim();
}
const vungRank = (v: string) => { const i = VUNG_ORDER.indexOf(v); return i < 0 ? 99 : i; };

/** So sánh TÊN người Việt theo TÊN GỌI (từ cuối) rồi tới phần còn lại — "Nguyễn Hữu Chí" xếp ở "Chí" (C),
 *  không phải "Nguyễn" (N). Dùng cho cột Người phụ trách xếp A→Z. */
function cmpVietGivenName(a: string, b: string): number {
  const given = (s: string) => { const p = s.trim().split(/\s+/); return p.length ? p[p.length - 1] : s; };
  return given(a).localeCompare(given(b), "vi") || a.localeCompare(b, "vi");
}

function ComplianceDialog({ data, loading, error, regionByName, mpWeeksByName, mpFlaggedNames, mpDeadlineByName, today, canManage, canEdit, onRetry, onClose }: {
  data: ComplianceFileData | undefined; loading: boolean; error: Error | null;
  regionByName: Map<string, string>; mpWeeksByName: Map<string, number>; mpFlaggedNames: Set<string>; mpDeadlineByName: Map<string, string>; today: string; canManage?: boolean; canEdit?: boolean; onRetry: () => void; onClose: () => void;
}) {
  void canManage;
  useEscapeToClose(onClose);
  // SỐ TUẦN cờ "Cần cập nhật MP / trình BOD" tồn tại (0 = tuần đầu/không cờ). Nền cho trừ điểm + tô màu.
  const mpWeeksOf = (r: ComplianceFileRow) => mpWeeksByName.get(normProjName(r.name)) ?? 0;
  // Dự án ĐANG có cờ "Cần cập nhật MP" (khớp theo tên) — kể cả tuần đầu (chưa trừ điểm).
  const mpFlaggedOf = (r: ComplianceFileRow) => mpFlaggedNames.has(normProjName(r.name));
  // TÔ MÀU cột "Cần cập nhật MP": VÀNG NHẠT = đang cần cập nhật (tuần đầu, chưa trừ) → VÀNG (1 tuần trừ) →
  //   ĐỎ (≥6 tuần). KHÔNG cờ = trống. Nhờ vậy dự án vừa dính cờ tuần này VẪN hiện ngay (không để trống).
  const mpFillStyle = (weeks: number, flagged: boolean): CSSProperties => {
    if (weeks <= 0) return flagged ? { background: "hsl(52, 95%, 74%)" } : {}; // tuần đầu = VÀNG nhạt (CHƯA trừ điểm)
    // ĐÃ TRỪ điểm (≥1 tuần) → ĐỎ luôn cho dễ phân biệt (đậm dần theo số tuần).
    const t = Math.min(1, (weeks - 1) / 5);          // 0 ở 1 tuần → 1 ở ≥6 tuần
    return { background: `hsl(0, ${Math.round(72 + 16 * t)}%, ${Math.round(60 - 14 * t)}%)` };
  };
  // ĐIỂM DỰ ÁN CUỐI = điểm nền (cột J: 100−25x−10o) − 10×(số tuần cờ BOD sau tuần đầu). CHO PHÉP ÂM (bỏ sàn 0).
  const finalScoreOf = (r: ComplianceFileRow): number | null =>
    r.score == null ? null : r.score - 10 * mpWeeksOf(r);
  // Màu chữ theo 3 mốc (khớp chart): ≥70 xanh · 50–<70 vàng · <50 đỏ. HEX inline (PDF không vỡ oklch).
  const tone3 = (s: number | null) => (s == null ? "#94a3b8" : s < 50 ? "#dc2626" : s < 70 ? "#ca8a04" : "#16a34a");
  // KHÔNG cho bấm header sắp xếp nữa (form đã chốt). AUTO sort theo TÊN A→Z (cố định, không hiện mũi tên).
  // Vẫn gom theo Vùng → Người phụ trách; trong mỗi nhóm xếp tên A→Z.
  const [sort] = useState<{ key: "vung" | "pm" | "mp" | "name" | "score" | "count"; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
  const [vungSel, setVungSel] = useState<string[]>([]);
  // CHỈ CÒN 1 báo cáo (bỏ "Tóm tắt") — bảng chi tiết "Báo cáo tuân thủ cập nhật Master Plan".
  const view = "detail" as const;
  const scoreLabel = (s: number | null) => (s == null ? "—" : String(s));
  // ── ĐIỂM (dự án & TB PM): IN ĐẬM cho NỔI BẬT; < 50 (chưa đạt) → ĐỎ, còn lại → ĐEN. Theo mẫu báo
  //    cáo tuân thủ (bỏ thang xanh/vàng nhiều màu — chỉ đen/đỏ cho gọn, điểm là thông tin chính). ──
  const scoreTone = (s: number | null) => (s == null ? "text-slate-400" : s < 50 ? "text-red-600" : "text-slate-900");
  // NGÀY CẬP NHẬT: KHÔNG tô nền (bớt sặc sỡ) — chữ trơn, chỉ NHUỐM ĐỎ khi QUÁ CŨ (>21 ngày) như
  // một cờ ngoại lệ. File ghi "dd/mm" → ghép năm của tháng chấm (mon > tháng chấm ⇒ năm trước).
  const tToday = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const repYear = data?.monthLabel ? +data.monthLabel.slice(3) : +today.slice(0, 4);
  const repMon = data?.monthLabel ? +data.monthLabel.slice(0, 2) : +today.slice(5, 7);

  // Tuần CÓ DỮ LIỆU mới nhất = tuần đã CHỐT gần nhất → dùng đếm "không cập nhật tuần này".
  const lastDataIdx = useMemo(() => {
    if (!data) return -1;
    for (let j = data.weeks.length - 1; j >= 0; j--) if (data.rows.some(r => r.marks[j] != null)) return j;
    return -1;
  }, [data]);
  // TUẦN HIỆN HÀNH (để TÔ MÀU cột) = cột tuần (ngày Thứ 4) RƠI TRONG TUẦN Thứ2–CN CHỨA HÔM NAY.
  // Vd hôm nay 13/08 (đã qua Thứ 4 12/08) vẫn tô 12/08 — KHÔNG nhảy sang 19/08. Không có cột nào rơi
  // đúng tuần này (đầu/cuối tháng) → lấy cột gần nhất ≤ CN tuần này; không có nữa → cột đầu.
  const curWeekIdx = useMemo(() => {
    if (!data || !data.weeks.length) return -1;
    const toTs = (w: string) => { const m = w.match(/^(\d{1,2})\/(\d{1,2})$/); return m ? Date.UTC(+m[2] > repMon ? repYear - 1 : repYear, +m[2] - 1, +m[1]) : null; };
    const dow = new Date(tToday).getUTCDay();                 // 0=CN..6=T7
    const mon = tToday - ((dow + 6) % 7) * 86400000;          // Thứ 2 tuần này
    const sun = mon + 6 * 86400000;                           // CN tuần này
    for (let j = 0; j < data.weeks.length; j++) { const t = toTs(data.weeks[j]); if (t != null && t >= mon && t <= sun) return j; }
    let best = -1;
    for (let j = 0; j < data.weeks.length; j++) { const t = toTs(data.weeks[j]); if (t != null && t <= sun) best = j; }
    return best >= 0 ? best : 0;
  }, [data, tToday, repYear, repMon]);
  // MAX cho data bar "số lần không cập nhật" = TỔNG số tuần trong THÁNG (không phải số tuần đã
  // trôi qua) → tháng có 4 tuần thì count 1 chỉ chiếm 1/4 ô (theo yêu cầu hiển thị của PMO).
  const maxRequired = useMemo(() => (data ? data.weeks.length : 0), [data]);
  // NGÀY CẬP NHẬT = ngày cột tuần HIỆN HÀNH (ô header xanh lá, curWeekIdx) — vd "26/08" → "26/08/2026".
  const updateDateLabel = useMemo(() => {
    const w = data && curWeekIdx >= 0 ? data.weeks[curWeekIdx] : undefined;
    const m = w?.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!m) return today;
    const yr = +m[2] > repMon ? repYear - 1 : repYear;
    return `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${yr}`;
  }, [data, curWeekIdx, repMon, repYear, today]);
  const vungOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of data?.rows ?? []) { const v = vungVN(regionByName.get(normProjName(r.name)) ?? ""); if (v && v !== "—") s.add(v); }
    return [...s].sort((a, b) => vungRank(a) - vungRank(b) || a.localeCompare(b, "vi")).map(v => ({ v, l: v }));
  }, [data, regionByName]);

  // GOM THEO PM — CHỐT: gộp theo TÊN PM CHÍNH (pmFirstOf), BỎ DPM. "Nguyễn Văn Cừ / DPM1" và
  // "Nguyễn Văn Cừ / DPM2" đều vào nhóm "Nguyễn Văn Cừ". Điểm PM = TB điểm các dự án trong nhóm.
  const avgScore = (rs: ComplianceFileRow[]): number | null => {
    const s = rs.map(r => finalScoreOf(r)).filter((v): v is number => v != null);
    return s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : null;
  };
  const baseRows = useMemo(
    () => (vungSel.length ? (data?.rows ?? []).filter(r => vungSel.includes(vungVN(regionByName.get(normProjName(r.name)) ?? ""))) : (data?.rows ?? [])),
    [data, vungSel, regionByName],
  );
  // DANH SÁCH ĐIỂM TB PM (góc trên phải, gọn) — xếp CAO→THẤP.
  const byPm = useMemo(() => {
    const m = new Map<string, ComplianceFileRow[]>();
    for (const r of baseRows) { const k = pmFirstOf(r.pm) || "—"; (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
    // XẾP A→Z THEO TÊN GỌI (từ cuối — chốt với sếp: theo TÊN chứ không theo HỌ): cố định vị trí mỗi PM.
    return [...m.entries()].map(([pm, rs]) => ({ pm, pmScore: avgScore(rs) }))
      .sort((a, b) => cmpVietGivenName(a.pm, b.pm));
  }, [baseRows, mpWeeksByName]);

  // GOM 2 CẤP: VÙNG (mạnh hơn) → NGƯỜI PHỤ TRÁCH → dự án. 1 PM ở 2 vùng thì TÁCH ra 2 dòng vùng.
  const byVung = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const cmpRow = (a: ComplianceFileRow, b: ComplianceFileRow) => {
      if (sort.key === "name") return dir * a.name.localeCompare(b.name, "vi");
      if (sort.key === "score") { const sa = finalScoreOf(a), sb = finalScoreOf(b); if (sa == null && sb == null) return a.name.localeCompare(b.name, "vi"); if (sa == null) return 1; if (sb == null) return -1; return dir * (sa - sb) || a.name.localeCompare(b.name, "vi"); }
      const va = sort.key === "count" ? a.countX : mpWeeksOf(a);
      const vb = sort.key === "count" ? b.countX : mpWeeksOf(b);
      return dir * (va - vb) || a.name.localeCompare(b.name, "vi");
    };
    const rmap = new Map<string, ComplianceFileRow[]>();
    for (const r of baseRows) { const v = vungVN(regionByName.get(normProjName(r.name)) ?? ""); (rmap.get(v) ?? rmap.set(v, []).get(v)!).push(r); }
    const regions = [...rmap.entries()].map(([vung, rows]) => {
      const pmap = new Map<string, ComplianceFileRow[]>();
      for (const r of rows) { const k = pmFirstOf(r.pm) || "—"; (pmap.get(k) ?? pmap.set(k, []).get(k)!).push(r); }
      const pmGroups = [...pmap.entries()].map(([pm, rs]) => ({ pm, score: avgScore(rs), rows: [...rs].sort(cmpRow) }));
      // Cột NGƯỜI PHỤ TRÁCH: dù đã GOM theo vùng, trong MỖI VÙNG vẫn xếp theo BẢNG CHỮ CÁI A→Z (mặc định),
      // theo TÊN GỌI (từ cuối) kiểu Việt Nam — "Nguyễn Hữu Chí" xếp ở chữ "C" (Chí), không phải "N" (Nguyễn).
      // Bấm tiêu đề “Người phụ trách” để đảo chiều; các cột khác (Điểm/Số lần…) chỉ sắp các DÒNG trong 1 PM.
      pmGroups.sort((a, b) => sort.key === "pm" ? dir * cmpVietGivenName(a.pm, b.pm) : cmpVietGivenName(a.pm, b.pm));
      return { vung, count: rows.length, pmGroups };
    });
    regions.sort((a, b) => { const r = vungRank(a.vung) - vungRank(b.vung) || a.vung.localeCompare(b.vung, "vi"); return sort.key === "vung" ? dir * r : r; });
    return regions;
  }, [baseRows, regionByName, sort, mpWeeksByName]);

  const tongDuAn = data?.rows.length ?? 0;
  // SỐ DỰ ÁN KHÔNG CẬP NHẬT TUẦN NÀY = ô "x" của tuần ĐÃ CHỐT gần nhất (tuần hiện hành theo lịch
  // có thể chưa điền → dùng tuần có dữ liệu mới nhất cho con số có nghĩa).
  const khongCNTuanNay = lastDataIdx >= 0 ? (data?.rows.filter(r => r.marks[lastDataIdx] === "x").length ?? 0) : 0;

  /** XUẤT PDF bảng tuân thủ = chụp ĐÚNG bảng đang xem (đã sort/lọc Vùng) + khối tiêu đề, dựng A4
   *  ngang qua exportDashboardPdf (dùng chung engine với bảng Danh sách). wide=true vì bảng rộng
   *  (nhiều cột tuần) → giữ bề rộng thật rồi thu tỉ lệ cho vừa giấy. */
  const tableRef = useRef<HTMLTableElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);          // header DUY NHẤT (tiêu đề "Báo cáo tuân thủ cập nhật Master Plan")
  const legendRef = useRef<HTMLDivElement>(null);   // khối "Chú thích ✓/o/x"
  const rulesRef = useRef<HTMLDivElement>(null);    // khối "Cách tính điểm" + chú thích — đính vào bản in
  const [exporting, setExporting] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<{ url: string; name: string } | null>(null);
  const doExportPdf = async (orientation: "landscape" | "portrait" = "portrait", mode: "download" | "preview" | "drive" = "download") => {
    if (exporting) return;
    const isPreview = mode === "preview";
    const isDrive = mode === "drive";
    if (!headerRef.current) return;
    setExporting(true);
    const tid = toast.loading(isDrive ? "Đang cập nhật bản gửi mail lên Drive…" : isPreview ? "Đang dựng PDF để xem trước…" : "Đang tạo PDF để tải…", { position: "bottom-left" });
    // header/table NẰM TRONG modal "print:hidden"; onclone của pdf-export XOÁ phần tử print:hidden khỏi clone
    // → tạm gỡ "print:hidden" ở các TỔ TIÊN trước khi chụp.
    const stripped: HTMLElement[] = [];
    for (let el: HTMLElement | null = headerRef.current; el; el = el.parentElement) {
      if (el.classList.contains("print:hidden")) { el.classList.remove("print:hidden"); stripped.push(el); }
    }
    // GIÃN DÒNG CỤM TIÊU ĐỀ *CHỈ TRONG PDF* (app giữ nguyên): line-height thoáng + khe nhỏ giữa 3 dòng cho
    // dễ đọc, KHÔNG bị dính. (Giãn rộng an toàn tuyệt đối — chỉ nén QUÁ sát mới làm mất dấu tiếng Việt.)
    const hKids = headerRef.current ? Array.from(headerRef.current.children) as HTMLElement[] : [];
    const hSaved = hKids.map((k) => k.style.cssText);
    hKids.forEach((k, i) => { k.style.lineHeight = "1.5"; k.style.marginTop = i === 0 ? "0" : "3px"; });
    try {
      const { exportDashboardPdf } = await import("@/lib/pdf-export");
      // Tên theo NGÀY BÁO CÁO (tuần) → mỗi tuần 1 file lưu trữ; mail đính kèm đúng bản mới nhất của tuần đó.
      const fileName = `BaoCaoTuanThu_MP_${today}.pdf`;
      // CHỈ 1 báo cáo: header + khối "Cách tính điểm" + bảng, ép gọn.
      const blocks: HTMLElement[] = [headerRef.current];
      if (rulesRef.current) blocks.push(rulesRef.current);
      const { pages, blobUrl, dataUri } = await exportDashboardPdf({
        // ÉP GỌN 1 TRANG + giữ tỉ lệ cột đã kéo, LẤP đầy bề ngang bằng cách nở ĐỀU (bỏ growCols → hết "dư"
        // cột Tên dự án). LƯU Ý: 1 trang nên cỡ chữ bị tự canh cho vừa — tăng cỡ chữ gần như không đổi bản in.
        blocks, table: tableRef.current, wide: true, orientation, tableFitOnePage: true, keepColWidths: true,
        // preview = xem trước; drive = LẤY dataUri để đẩy Drive (KHÔNG tải); còn lại = TẢI XUỐNG (cá nhân, không đụng Drive).
        preview: isPreview, toDataUri: isDrive, fileName,
      });
      track("export_pdf", `${isDrive ? "→DRIVE · " : isPreview ? "XEM TRƯỚC · " : ""}Báo cáo tuân thủ MP${data?.monthLabel ? ` tháng ${data.monthLabel}` : ""}`.slice(0, 300));
      if (isPreview && blobUrl) { setPdfPreview({ url: blobUrl, name: fileName }); toast.success(`Đã dựng PDF (${pages} trang) — soát rồi Tải xuống / In`); return; }
      if (isDrive) {
        // CHỈ ADMIN chủ động: cập nhật bản PDF gửi mail lên Drive (ghi đè bản tuần này). KHÔNG dính vào nút Tải.
        if (!dataUri) throw new Error("Không dựng được dữ liệu PDF.");
        const r = await saveComplianceReportPdf({ data: { fileName, dataUri, devAs: devAs() } });
        toast.success(`Đã ${r.updated ? "cập nhật (ghi đè)" : "lưu"} bản PDF gửi mail lên Drive — mail tự động sẽ đính kèm bản này.`);
        return;
      }
      toast.success(`Đã tải PDF báo cáo tuân thủ (${pages} trang).`);
    } catch (e) {
      toast.error(`Tạo PDF lỗi: ${(e as Error).message}`);
    } finally {
      hKids.forEach((k, i) => { k.style.cssText = hSaved[i]; });                 // trả lại cụm tiêu đề như cũ (app không đổi)
      stripped.forEach((el) => el.classList.add("print:hidden"));
      toast.dismiss(tid);
      setExporting(false);
    }
  };

  // ── FORM BÁO CÁO (chốt với sếp): admin/PMO tự KÉO RỘNG CỘT + chỉnh CỠ CHỮ + IN ĐẬM rồi LƯU (áp mọi người + bản in). ──
  const nWeekCols = Math.max(5, data?.weeks.length ?? 5);
  const nCols = 6 + nWeekCols;                                  // 6 cột cố định + cột tuần
  const defaultColW = (nw: number) => { const fx = [7, 11, 13, 22, 6, 9]; const each = (100 - fx.reduce((a, b) => a + b, 0)) / Math.max(1, nw); return [...fx, ...Array(nw).fill(each)]; };
  const [fontPx, setFontPx] = useState(11);              // cỡ chữ NỀN (cột không đặt riêng)
  const [bold, setBold] = useState(false);               // in đậm TOÀN bảng (khi không chọn cột nào)
  const [colW, setColW] = useState<number[]>(() => defaultColW(Math.max(5, data?.weeks.length ?? 5)));
  const [colBold, setColBold] = useState<boolean[]>(() => Array(6 + Math.max(5, data?.weeks.length ?? 5)).fill(false));
  const [colFontPx, setColFontPx] = useState<number[]>(() => Array(6 + Math.max(5, data?.weeks.length ?? 5)).fill(0));
  const [rowH, setRowH] = useState(0);                    // CHIỀU CAO HÀNG px (0 = auto). Áp ĐỀU cho MỌI hàng.
  const [sel, setSel] = useState<Set<number>>(new Set());        // cột đang chọn (Excel-style)
  const [dirty, setDirty] = useState(false);
  const [editLayout, setEditLayout] = useState(false);           // bật = bấm tiêu đề để CHỌN cột + kéo viền (không sắp xếp)
  const [savingForm, setSavingForm] = useState(false);
  const [locked, setLocked] = useState(false);                   // KHOÁ điều chỉnh (chốt form) — ẩn thanh chỉnh
  const formQ = useQuery({ queryKey: ["complianceForm"], queryFn: () => getComplianceForm(), staleTime: 60_000 });
  useEffect(() => {
    const f = formQ.data?.form; if (!f) return;
    if (typeof f.fontPx === "number") setFontPx(f.fontPx);
    if (typeof f.bold === "boolean") setBold(f.bold);
    if (typeof f.locked === "boolean") setLocked(f.locked);
    if (typeof f.rowH === "number") setRowH(f.rowH);
    setColW(Array.isArray(f.colW) && f.colW.length === nCols ? f.colW : defaultColW(nWeekCols));
    setColBold(Array.isArray(f.colBold) && f.colBold.length === nCols ? f.colBold : Array(nCols).fill(false));
    setColFontPx(Array.isArray(f.colFontPx) && f.colFontPx.length === nCols ? f.colFontPx : Array(nCols).fill(0));
  }, [formQ.data, nCols, nWeekCols]);
  useEffect(() => {
    setColW((c) => (c.length === nCols ? c : defaultColW(nWeekCols)));
    setColBold((c) => (c.length === nCols ? c : Array(nCols).fill(false)));
    setColFontPx((c) => (c.length === nCols ? c : Array(nCols).fill(0)));
  }, [nCols, nWeekCols]);
  // Style theo Ô = ưu tiên đặt-riêng-theo-cột, không có thì dùng nền (fontPx/bold toàn bảng áp ở cấp <table>).
  const cellStyle = (col: number): CSSProperties => ({
    ...(colBold[col] ? { fontWeight: 700 } : {}),
    ...(colFontPx[col] ? { fontSize: `${colFontPx[col]}px` } : {}),
  });
  const selCls = (col: number) => (editLayout && sel.has(col) ? " outline outline-2 -outline-offset-2 outline-amber-400" : "");
  const bumpFont = (d: number) => {
    if (sel.size) { setColFontPx((a) => { const n = a.slice(); sel.forEach((i) => { const cur = n[i] || fontPx; n[i] = Math.min(20, Math.max(7, Math.round((cur + d) * 2) / 2)); }); return n; }); }
    else setFontPx((f) => Math.min(20, Math.max(7, Math.round((f + d) * 2) / 2)));
    setDirty(true);
  };
  const toggleBold = () => {
    if (sel.size) { setColBold((a) => { const n = a.slice(); const anyOff = [...sel].some((i) => !n[i]); sel.forEach((i) => { n[i] = anyOff; }); return n; }); }
    else setBold((b) => !b);
    setDirty(true);
  };
  // CHIỀU CAO HÀNG (đồng đều mọi hàng). 0 = auto; xuống dưới 14 → về auto.
  const bumpRowH = (d: number) => {
    setRowH((h) => { if (h === 0) return d > 0 ? 20 : 0; const n = h + d; return n < 14 ? 0 : Math.min(44, n); });
    setDirty(true);
  };
  const chiaDeu = () => {
    if (sel.size < 2) { toast("Chọn ≥2 cột (bấm tiêu đề, giữ Ctrl chọn thêm) rồi bấm Chia đều."); return; }
    const idxs = [...sel]; const each = idxs.reduce((s, i) => s + colW[i], 0) / idxs.length;
    setColW((c) => { const n = c.slice(); idxs.forEach((i) => { n[i] = each; }); return n; }); setDirty(true);
  };
  const selectCol = (i: number, e: React.MouseEvent) => {
    setSel((prev) => {
      const n = new Set(prev);
      if (e.shiftKey && prev.size) { const arr = [...prev]; const last = arr[arr.length - 1]; const [lo, hi] = last < i ? [last, i] : [i, last]; for (let k = lo; k <= hi; k++) n.add(k); }
      else if (e.ctrlKey || e.metaKey) { if (n.has(i)) n.delete(i); else n.add(i); }
      else { n.clear(); n.add(i); }
      return n;
    });
  };
  const startColResize = (i: number) => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX; const base = colW.slice();
    const tableW = tableRef.current?.offsetWidth || 1000;
    // Nếu KÉO 1 cột NẰM TRONG nhóm đang chọn (≥2 cột) → giữ các cột chọn ĐỀU NHAU khi kéo.
    const grp = sel.has(i) && sel.has(i + 1) ? [...sel].filter((x) => sel.has(x)) : null;
    const onMove = (ev: MouseEvent) => {
      const dPct = ((ev.clientX - startX) / tableW) * 100;
      const a = base[i] + dPct, b = base[i + 1] - dPct;
      if (a >= 3 && b >= 3) { const next = base.slice(); next[i] = a; next[i + 1] = b; if (grp) { const each = grp.reduce((s, x) => s + next[x], 0) / grp.length; grp.forEach((x) => { next[x] = each; }); } setColW(next); setDirty(true); }
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };
  const saveForm = async (nextLocked?: boolean) => {
    if (savingForm) return; setSavingForm(true);
    const lk = nextLocked ?? locked;
    try {
      await saveComplianceForm({ data: { colW, fontPx, bold, colBold, colFontPx, locked: lk, rowH, devAs: devAs() } });
      setLocked(lk); setDirty(false); if (nextLocked === true) setEditLayout(false);
      toast.success(nextLocked === true ? "Đã CHỐT & KHOÁ form (áp cho mọi người + bản in)." : nextLocked === false ? "Đã mở khoá — chỉnh tiếp được." : "Đã lưu & chốt form (áp cho mọi người + bản in).");
    }
    catch (e) { toast.error(`Lưu form lỗi: ${(e as Error).message}`); }
    finally { setSavingForm(false); }
  };
  const resetForm = () => { setColW(defaultColW(nWeekCols)); setFontPx(11); setBold(false); setColBold(Array(nCols).fill(false)); setColFontPx(Array(nCols).fill(0)); setRowH(0); setSel(new Set()); setDirty(true); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 print:hidden">
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-[1360px] flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="relative z-40 flex items-start justify-between gap-3 px-5 pb-1 pt-2">
          <div className="min-w-0 flex-1">
            {/* headerRef = KHỐI TIÊU ĐỀ vẽ vào đầu PDF (không gồm nút/điều khiển tương tác). */}
            {/* HEADER GỌN (học file mẫu): tiêu đề navy CĂN GIỮA + dòng "Kỳ báo cáo · Tổng số". Phần "Cách
                tính điểm" ĐÃ TÁCH xuống khối rulesRef (chỉ đính bản in CHI TIẾT). */}
            {/* HEADER = chỉ TIÊU ĐỀ (căn trái). Bảng Điểm TB PM + cách tính điểm nằm ở HÀNG NGANG trên bảng. */}
            {/* THỨ TỰ (chốt với sếp): 1) Tên báo cáo — 2) Bộ phận — 3) Kỳ/ngày ("quan trọng để lên trước"). */}
            <div ref={headerRef} className="text-left">
              <div className="text-base font-extrabold tracking-tight text-[#1e3a5f]">Báo cáo tuân thủ cập nhật Master Plan - Tháng {today.slice(5, 7)}/{today.slice(0, 4)}</div>
              <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-teal-700">Bộ phận Project Planning</div>
              <div className="mt-0.5 text-[11px] text-slate-500">Ngày cập nhật: <b className="tabular-nums text-slate-700">{updateDateLabel}</b> · Tổng số: <b className="tabular-nums text-slate-700">{tongDuAn}</b> dự án</div>
            </div>
          </div>
          <div className="absolute right-4 top-3 z-10 flex shrink-0 items-center gap-2 print:hidden">
            {canEdit && (
              <button onClick={() => void doExportPdf("portrait", "drive")} disabled={loading || !!error || !data || !byPm.length || exporting}
                title="CHỈ ADMIN — dựng đúng bản form này rồi cập nhật lên Drive để mail tự đính kèm (ghi đè bản tuần này). Nút Xuất PDF thường KHÔNG đụng Drive."
                className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-700 disabled:opacity-40">☁ Cập nhật bản gửi mail</button>
            )}
            <PdfExportMenu
              onPrint={(o, mode) => void doExportPdf(o, mode)}
              disabled={loading || !!error || !data || !byPm.length}
              busy={exporting}
              tone="bg-teal-700 hover:bg-teal-800"
              portraitHint="gọn trang" portraitOnly />
            <button onClick={onClose} aria-label="Đóng" title="Đóng (Esc)" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
          </div>
        </div>
        {pdfPreview && <PdfPreviewDialog url={pdfPreview.url} fileName={pdfPreview.name} onClose={() => setPdfPreview(null)} />}

        <div className="min-h-0 flex-1 overflow-auto px-5 pb-3">
          {loading ? (
            <div className="py-16 text-center text-sm text-slate-500">Đang tải file tuân thủ…</div>
          ) : error ? (
            <div className="py-14 text-center">
              <div className="text-sm font-semibold text-red-600">Không tải được file tuân thủ</div>
              <div className="mx-auto mt-1 max-w-lg whitespace-pre-wrap text-[11px] text-slate-500">{error.message}</div>
              <button onClick={onRetry} className="mt-3 rounded-md bg-teal-700 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-800">Thử lại</button>
            </div>
          ) : !data || !byPm.length ? (
            <div className="py-16 text-center text-sm text-slate-500">File không có dòng dữ liệu nào.</div>
          ) : (
          <>
          {/* KHUNG CHÚ THÍCH = 1 BẢNG có VIỀN NGOÀI + vạch ngăn 4 CỘT (thứ tự: Chú thích · Cách tính dự án · Cách tính PM · Điểm PM).
              Bỏ mọi viền nhỏ riêng bên trong (Chú thích ✓/o/x + bảng Điểm PM); các cột cao bằng nhau (items-stretch). */}
          <div ref={rulesRef} className="mb-1 flex items-stretch overflow-hidden rounded-md border border-slate-300 text-[10px] leading-snug text-slate-600">
            {/* Cột 1 (NGOÀI CÙNG TRÁI — chốt với sếp) — ĐIỂM PM: tên xếp A→Z theo TÊN GỌI (từ cuối), IN ĐẬM. */}
            {byPm.length > 0 && (() => {
              const nCols = byPm.length > 10 ? 3 : 2;
              const nRows = Math.ceil(byPm.length / nCols);
              return (
                <div className="flex flex-[2.4] flex-col border-r border-slate-300 px-3 py-2">
                  <div className="mb-2 font-semibold text-slate-700">Điểm PM:</div>
                  <div className="grid gap-x-4 leading-[1.3]"
                       style={{ fontSize: nCols === 3 ? 11 : 12, gridAutoFlow: "column", gridTemplateRows: `repeat(${nRows}, auto)` }}>
                    {byPm.map(({ pm, pmScore }) => (
                      <div key={pm} className="flex items-baseline justify-between gap-2 leading-tight">
                        <span className="whitespace-nowrap font-bold text-slate-800" title={pm}>{pm || "—"}</span>
                        <b className="shrink-0 tabular-nums" style={{ color: pmScore == null ? "#94a3b8" : pmScore < 50 ? "#dc2626" : pmScore < 70 ? "#ca8a04" : "#16a34a" }}>{pmScore == null ? "—" : pmScore}</b>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            {/* Cột 2 — Chú thích */}
            <div ref={legendRef} className="flex flex-[0.5] flex-col border-r border-slate-300 px-3 py-2">
              <div className="mb-2 font-semibold text-slate-700">Chú thích:</div>
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2"><span className="w-3 shrink-0 text-center font-bold text-emerald-500">✓</span><span className="whitespace-nowrap">Cập nhật đúng hạn</span></div>
                <div className="flex items-center gap-2"><span className="w-3 shrink-0 text-center text-[17px] font-black leading-none text-amber-500">o</span><span className="whitespace-nowrap">Cập nhật trễ</span></div>
                <div className="flex items-center gap-2"><span className="w-3 shrink-0 text-center font-bold text-red-600">✕</span><span className="whitespace-nowrap">Không cập nhật</span></div>
              </div>
            </div>
            {/* Cột 3 — Cách tính điểm dự án */}
            <div className="flex flex-1 flex-col border-r border-slate-300 px-3 py-2">
              <div className="mb-2 font-semibold text-slate-700">Cách tính điểm dự án:</div>
              <div className="flex flex-col gap-1.5">
                <div className="whitespace-nowrap">(1) Khởi điểm <b className="text-slate-800">100 điểm/tháng</b>.</div>
                <div className="whitespace-nowrap">(2) Không cập nhật (sau 12h thứ 5 hằng tuần): <b className="text-red-600">−{SCORING.deduct.missed} điểm</b>.</div>
                <div className="whitespace-nowrap">(3) Cập nhật trễ (từ 22h thứ 4 – 12h thứ 5 hằng tuần): <b className="text-amber-600">−{SCORING.deduct.late} điểm</b>.</div>
                <div className="whitespace-nowrap">(4) Không trình Master Plan cập nhật: <b className="text-amber-600">−10 điểm/tuần</b>.</div>
              </div>
            </div>
            {/* Cột 4 (CUỐI — KHÔNG viền phải) — Cách tính điểm PM */}
            <div className="flex flex-1 flex-col px-3 py-2">
              <div className="mb-2 font-semibold text-slate-700">Cách tính điểm PM:</div>
              <div className="flex flex-1 items-center gap-2">
                <span className="whitespace-nowrap">Điểm PM =</span>
                <span className="inline-flex flex-col text-center leading-relaxed">
                  <span className="whitespace-nowrap border-b border-slate-500 px-1 pb-1">Tổng điểm tuân thủ các dự án PM quản lý</span>
                  <span className="whitespace-nowrap px-1 pt-1">Tổng số lượng dự án PM quản lý</span>
                </span>
              </div>
            </div>
          </div>
          {canEdit && (locked ? (
            <div className="mb-1 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] print:hidden">
              <span className="font-semibold text-slate-600">🔒 Form đã chốt &amp; khoá</span>
              <span className="text-slate-400">— mọi người xem bản đã căn chỉnh; muốn sửa thì mở khoá.</span>
              <button onClick={() => void saveForm(false)} disabled={savingForm} className="ml-auto rounded border border-amber-300 bg-white px-2 py-0.5 font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-40">🔓 Mở khoá để chỉnh</button>
            </div>
          ) : (
            <div className="mb-1 flex flex-wrap items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] print:hidden">
              <button onClick={() => setEditLayout((v) => !v)} title="Bật để CHỌN cột (bấm tiêu đề) + kéo viền chỉnh rộng. Tắt để sắp xếp lại như thường." className={`rounded border px-2 py-0.5 font-semibold hover:bg-slate-100 ${editLayout ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{editLayout ? "✎ Đang chỉnh" : "✎ Chỉnh bảng"}</button>
              {editLayout && <span className="px-1 text-slate-500">{sel.size ? `Đã chọn ${sel.size} cột` : "Bấm tiêu đề để chọn cột (Ctrl/Shift chọn nhiều)"}</span>}
              <span className="mx-1 h-4 w-px bg-slate-300" />
              <button onClick={() => bumpFont(-0.5)} title={sel.size ? "Nhỏ chữ cột đã chọn" : "Nhỏ chữ cả bảng"} className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-bold hover:bg-slate-100">A−</button>
              <span className="w-16 text-center tabular-nums text-slate-500">{sel.size ? "cột chọn" : `${fontPx}px`}</span>
              <button onClick={() => bumpFont(0.5)} title={sel.size ? "To chữ cột đã chọn" : "To chữ cả bảng"} className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-bold hover:bg-slate-100">A+</button>
              <button onClick={toggleBold} title={sel.size ? "In đậm cột đã chọn" : "In đậm cả bảng"} className={`rounded border px-2 py-0.5 font-black hover:bg-slate-100 ${(sel.size ? [...sel].some((i) => colBold[i]) : bold) ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 bg-white"}`}>B</button>
              <span className="mx-1 h-4 w-px bg-slate-300" />
              <button onClick={() => bumpRowH(-2)} title="Hàng thấp lại (áp đều mọi hàng)" className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-bold hover:bg-slate-100">⭥−</button>
              <span className="w-12 text-center tabular-nums text-slate-500">{rowH ? `${rowH}px` : "cao auto"}</span>
              <button onClick={() => bumpRowH(2)} title="Hàng cao lên (áp đều mọi hàng)" className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-bold hover:bg-slate-100">⭥+</button>
              <button onClick={chiaDeu} disabled={sel.size < 2} title="Đặt các cột đã chọn RỘNG BẰNG NHAU" className="rounded border border-slate-300 bg-white px-2 py-0.5 hover:bg-slate-100 disabled:opacity-40">⇄ Chia đều</button>
              <button onClick={resetForm} title="Về mặc định" className="rounded border border-slate-300 bg-white px-2 py-0.5 text-slate-500 hover:bg-slate-100">Reset</button>
              <button onClick={() => void saveForm()} disabled={savingForm || !dirty} className="ml-auto rounded bg-emerald-600 px-2.5 py-0.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-40" title="Lưu & chốt form (áp cho mọi người + bản in PDF)">💾 Lưu{dirty ? " *" : ""}</button>
              <button onClick={() => void saveForm(true)} disabled={savingForm} className="rounded bg-slate-800 px-2.5 py-0.5 font-semibold text-white hover:bg-slate-900 disabled:opacity-40" title="Chốt bản này & KHOÁ điều chỉnh (ẩn thanh chỉnh cho gọn)">🔒 Chốt &amp; khoá</button>
            </div>
          ))}
          <div className="relative">
          {/* TAY KÉO viền cột (chỉ khi bật "Kéo cột") — đặt tại ranh giới % lũy kế của colW. */}
          {canEdit && editLayout && (() => {
            const bounds: number[] = []; let acc = 0;
            for (let i = 0; i < colW.length - 1; i++) { acc += colW[i]; bounds.push(acc); }
            return (
              <div className="pointer-events-none absolute inset-0 z-40 print:hidden">
                {bounds.map((x, i) => (
                  <div key={i} onMouseDown={startColResize(i)} title="Kéo để chỉnh rộng cột"
                    className="pointer-events-auto absolute bottom-0 top-0 w-[8px] -translate-x-1/2 cursor-col-resize bg-teal-400/30 hover:bg-teal-500/70"
                    style={{ left: `${x}%` }} />
                ))}
              </div>
            );
          })()}
          <table ref={tableRef} className="w-full table-fixed border-collapse [&_tbody_td]:border-b [&_tbody_td]:border-slate-300" style={{ fontSize: `${fontPx}px`, fontWeight: bold ? 600 : undefined }}>
            <colgroup>{colW.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
            <thead className="text-white">
              <tr>
                {(() => {
                  // KHÔNG sắp xếp khi bấm nữa (auto A→Z theo tên). editLayout ON → bấm tiêu đề để CHỌN cột; OFF → không làm gì.
                  const thc = `sticky top-0 z-30 border-r border-slate-600 bg-[#1e293b] px-2 py-1.5 text-center font-semibold whitespace-normal select-none ${editLayout ? "cursor-pointer hover:bg-[#28374d]" : ""}`;
                  const thClick = (col: number) => (e: React.MouseEvent) => { if (editLayout) selectCol(col, e); };
                  // HEADER giữ CỠ CHỮ ĐỒNG NHẤT (thc) — KHÔNG áp per-column font/bold; per-column chỉ áp cho NỘI DUNG (ô thân).
                  return <>
                  <th className={thc + selCls(0)} onClick={thClick(0)} title="Vùng dự án">Vùng</th>
                  <th className={thc + selCls(1)} onClick={thClick(1)} title="Người phụ trách">Người phụ trách</th>
                  <th className={thc + selCls(2)} onClick={thClick(2)} title="Hạn PM trình Master Plan cho BOD phê duyệt = ngày cắm cờ + 7 (đỏ = quá hạn, mỗi tuần −10).">Cần PM trình Master Plan<br />BOD phê duyệt</th>
                  <th className={thc + selCls(3)} onClick={thClick(3)} title="Tên dự án">Tên dự án</th>
                  <th className={thc + selCls(4)} onClick={thClick(4)} title="Điểm tuân thủ 0–100.">Điểm<br />dự án</th>
                  <th className={thc + selCls(5)} onClick={thClick(5)} title="Số lần không cập nhật">Số lần<br />không cập nhật</th>
                  </>;
                })()}
                {/* LUÔN 5 CỘT TUẦN (chốt với sếp): tháng chỉ 4 tuần thì cột 5 để TRỐNG → cấu trúc file cố định. */}
                {Array.from({ length: Math.max(5, data.weeks.length) }).map((_, wi) => {
                  const w = data.weeks[wi];                                    // undefined = cột dự phòng để trống
                  const isCur = wi === curWeekIdx && !!w;
                  return (
                    <th key={wi} onClick={(e) => { if (editLayout) selectCol(6 + wi, e); }}
                        className={`sticky top-0 z-30 border-r px-1 py-1.5 text-center font-semibold whitespace-nowrap text-white ${isCur ? "border-emerald-800" : "border-slate-600 bg-[#1e293b]"} ${editLayout ? "cursor-pointer select-none" : ""}${selCls(6 + wi)}`}
                        style={{ ...(isCur ? { background: "#00B050" } : {}), ...cellStyle(6 + wi) }}
                        title={w ? (isCur ? `Tuần hiện hành — cập nhật tới đây: ${w}` : `Tuần ${w}`) : "Cột tuần dự phòng (tháng này không có tuần thứ 5)"}>{w ?? <span className="invisible" aria-hidden="true">00/00</span>}</th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {byVung.map((region, ri) => (
                region.pmGroups.map((g, gi) => (
                  g.rows.map((r, i) => {
                    const regionTop = gi === 0 && i === 0;   // dòng ĐẦU của VÙNG → ô Vùng rowSpan
                    const pmTop = i === 0;                   // dòng ĐẦU của nhóm PM → ô Người phụ trách rowSpan
                    const rowStyle = regionTop && ri > 0 ? { borderTop: "2px solid #64748b" } : (pmTop && gi > 0 ? { borderTop: "1px solid #94a3b8" } : undefined);
                    return (
                      <tr key={`${region.vung}-${g.pm}-${r.stt}-${i}`} className={`hover:bg-teal-50/40${pmTop ? " pm-group-line" : ""}`} style={{ ...(rowStyle ?? {}), ...(rowH ? { height: `${rowH}px` } : {}) }}>
                        {/* VÙNG — GOM nhóm mạnh nhất (rowSpan cả vùng). */}
                        {regionTop && (
                          <td rowSpan={region.count} style={cellStyle(0)} className="border-r border-slate-200 bg-slate-50 px-2 py-1 text-center align-middle font-bold text-[#1e3a5f] whitespace-normal break-words">{region.vung}</td>
                        )}
                        {/* NGƯỜI PHỤ TRÁCH — gom trong vùng (rowSpan theo nhóm PM). */}
                        {pmTop && (
                          <td rowSpan={g.rows.length} style={cellStyle(1)} className="border-r border-slate-100 px-2 py-1 text-center align-middle font-medium text-slate-900">
                            <span className="line-clamp-2 leading-tight" title={g.pm}>{g.pm || "—"}</span>
                          </td>
                        )}
                        {(() => {
                          const w = mpWeeksOf(r);
                          // DEADLINE = ngày trình BOD, đọc dd/mm SAU chữ "trước" trong ghi chú. KHÔNG ghi "trước dd/mm"
                          // → KHÔNG có deadline → để dấu "–" (không hiện "mới", không trừ điểm).
                          const iso = mpDeadlineByName.get(normProjName(r.name));
                          const dlDate = iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "";
                          return (
                            <td style={cellStyle(2)} className="border-r border-slate-100 px-2 py-1 text-center align-middle" title={dlDate ? (w > 0 ? `Hạn trình BOD ${dlDate} — đã quá ${w} tuần → −${w * 10} điểm` : `Hạn trình BOD ${dlDate} (chưa quá hạn, chưa trừ điểm)`) : "Chưa ghi deadline (không có “trước dd/mm”) → không trừ điểm"}>
                              {dlDate ? (
                                <span className="font-semibold leading-tight text-slate-900">trước <span className="tabular-nums">{dlDate}</span></span>
                              ) : <span className="text-slate-300">–</span>}
                            </td>
                          );
                        })()}
                        <td style={cellStyle(3)} className="border-r border-slate-100 px-2 py-1 text-slate-900"><div className="line-clamp-1" title={r.name}>{r.name}</div></td>
                        <td style={cellStyle(4)} className="border-r border-slate-100 px-2 py-1 text-center">
                          {(() => { const fs = finalScoreOf(r); const w = mpWeeksOf(r); return (
                            <span className={`text-[13px] font-extrabold tabular-nums ${scoreTone(fs)}`} title={fs == null ? "Chưa có dữ liệu tháng này" : `Điểm = ${fs} (nền ${r.score}: x${r.countX}·−25, o${r.countO}·−10${w > 0 ? `; BOD ${w} tuần·−${w * 10}` : ""})`}>{scoreLabel(fs)}</span>
                          ); })()}
                        </td>
                        <td style={cellStyle(5)} className="border-r border-slate-100 px-2 py-1">
                          <div className="relative flex h-4 w-full items-center overflow-hidden rounded" style={{ background: "#E3EAF6" }} title={`${r.countX}/${maxRequired} lần phải cập nhật tính đến hôm nay`}>
                            {maxRequired > 0 && r.countX > 0 && (
                              <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${Math.min(100, r.countX / maxRequired * 100)}%`, background: "#69AEED" }} />
                            )}
                            {/* Số ĐEN ĐẬM giữa thanh; halo trắng mảnh để không "dính"/chìm khi rơi trúng mép xanh. */}
                            <span className="relative z-[1] mx-auto tabular-nums font-extrabold text-slate-900" style={{ textShadow: "0 0 2px #fff, 0 0 2px #fff" }}>{r.countX > 0 ? r.countX : <span className="font-normal text-slate-400">0</span>}</span>
                          </div>
                        </td>
                        {/* LUÔN 5 Ô (khớp 5 cột header): tuần không có → ô trống. */}
                        {Array.from({ length: Math.max(5, data.weeks.length) }).map((_, j) => (
                          <td key={j} style={cellStyle(6 + j)} className="border-r border-slate-100 px-1 py-1 text-center">{j < r.marks.length ? <ComplianceMark m={r.marks[j]} /> : <span className="text-slate-300" title="Không có thông tin">–</span>}</td>
                        ))}
                      </tr>
                    );
                  })
                ))
              ))}
            </tbody>
          </table>
          </div>
          </>
          )}
        </div>

      </div>
    </div>
  );
}

/** DIALOG "CÓ GÌ MỚI" — bấm badge phiên bản để mở; liệt kê CHANGELOG theo từng bản (mới nhất trên). */
function ChangelogDialog({ onClose }: { onClose: () => void }) {
  useEscapeToClose(onClose);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 print:hidden">
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b-2 border-teal-400 px-5 py-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-teal-700">Nhật ký cập nhật</div>
            <div className="text-sm font-bold text-slate-900">CÓ GÌ MỚI</div>
            <div className="mt-0.5 text-[11px] text-slate-600">Các thay đổi theo từng phiên bản (mới nhất ở trên).</div>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100">Đóng ✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          <ol className="space-y-3">
            {CHANGELOG.map((e, i) => (
              <li key={e.v} className="border-l-2 border-slate-200 pl-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${i === 0 ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-700"}`}>v{e.v}</span>
                  {i === 0 && <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[9px] font-bold text-teal-700">MỚI NHẤT</span>}
                  <span className="text-[10.5px] text-slate-400">{e.date}</span>
                </div>
                <ul className="list-disc space-y-0.5 pl-4 text-[12px] leading-snug text-slate-700">
                  {e.items.map((it, k) => <li key={k}>{it}</li>)}
                </ul>
              </li>
            ))}
          </ol>
          <div className="mt-3 border-t border-slate-100 pt-2 text-[10.5px] text-slate-400">Các phiên bản cũ hơn không liệt kê ở đây.</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ======================================================================
 *  BẢNG TIÊU CHÍ CẢNH BÁO — giải thích quy ước chấm cho người dùng.
 *
 *  NGUYÊN TẮC SỐNG CÒN: mọi ô trong bảng này được SINH RA bằng cách gọi chính
 *  `classifyByMatrix()` — hàm mà app dùng để chấm cảnh báo thật. TUYỆT ĐỐI KHÔNG
 *  chép tay kết quả vào đây. Chú thích chép tay sẽ lệch khỏi luật ngay lần sửa luật
 *  đầu tiên, và một bảng chú thích NÓI SAI còn nguy hơn không có bảng nào: người đọc
 *  tin nó rồi hiểu sai toàn bộ tình trạng công việc.
 *  Đổi luật ở lib/filter.ts ⇒ bảng này TỰ đúng theo, không cần đụng vào.
 * ====================================================================== */
function AlertCriteriaDialog({ gapThreshold, onClose }: { gapThreshold: number; onClose: () => void }) {
  useEscapeToClose(onClose);
  // Giá trị ĐẠI DIỆN của từng bậc — chỉ dùng để tra ma trận, không hiển thị ra.
  const HANG = [
    { nhan: `≥ ${gapThreshold}%`, mo: "Chậm nghiêm trọng", gap: gapThreshold + 10 },
    { nhan: `> ${FOCUS_MIN} – ${gapThreshold}%`, mo: "Chậm đáng kể", gap: (FOCUS_MIN + gapThreshold) / 2 },
    { nhan: `≤ ${FOCUS_MIN}%`, mo: "Bám sát kế hoạch", gap: FOCUS_MIN / 2 },
  ];
  const COT = [
    { nhan: `≥ ${OD_DAYS} ngày`, od: OD_DAYS + 6 },
    { nhan: `1 – ${OD_DAYS - 1} ngày`, od: 5 },
    { nhan: "Đúng hạn", od: 0 },
  ];
  const BANG = [
    { key: "far" as const, nhan: `Mốc bàn giao còn > ${NEAR_DEADLINE_DAYS} ngày`, phu: "Mức chuẩn" },
    { key: "d30" as const, nhan: `Mốc bàn giao còn ≤ ${NEAR_DEADLINE_DAYS} ngày`, phu: "Tăng 1 cấp" },
    { key: "d14" as const, nhan: `Mốc bàn giao còn ≤ ${IMMINENT_DEADLINE_DAYS} ngày`, phu: "Tăng 2 cấp" },
  ];

  /* Badge CỐ ĐỊNH chiều cao (26px) chứ không để tự co theo số dòng chữ: "TRỄ TIẾN ĐỘ"
     vừa 1 dòng (16px) còn "CẦN TẬP TRUNG" phải xuống 2 dòng (27px). Để tự co thì trong
     cùng một hàng có viên cao viên thấp, nhìn lô nhô. Cố định cỡ ⇒ lưới đều tăm tắp và
     mắt so sánh được MÀU giữa các ô thay vì bị nhiễu bởi kích thước. */
  const O = (kind: AlertKind, color: AlertColor) => {
    // "Không vấn đề" cũng là một KẾT LUẬN, không phải ô thiếu dữ liệu — nên nó là badge
    // như 3 nhãn kia, chỉ khác là màu xám để lùi hẳn về sau, nhường mắt cho đỏ/vàng.
    const cls = kind === "none" ? "bg-slate-100 text-slate-600"
              : color === "red" ? "bg-red-500 text-white"
              : "bg-amber-400 text-slate-900";
    return (
      <span className={`inline-flex h-[26px] w-full items-center justify-center rounded px-1 text-center text-[9px] font-bold uppercase leading-[1.15] ${cls}`}>
        {kind === "none" ? ALERT_NONE_LABEL : ALERT_FULL_NAME[kind as AlertK]}
      </span>
    );
  };

  // PORTAL ra document.body: dialog này được gọi TỪ <header> (có z-30 → tạo stacking
  // context riêng), nếu render tại chỗ thì backdrop z-50 bị nhốt trong z-30, và header
  // sticky của Gantt (z-32, ở <main> bên cạnh) sẽ CHỌC LÊN TRÊN dialog (hộp đen). Portal
  // đưa dialog về gốc body → z-50 phủ đúng mọi thứ. SSR không có document → render null.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 print:hidden">
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        {/* Vạch vàng MẢNH làm dấu nhận diện, KHÔNG tô cả mảng vàng: vàng trong app này
            đang mang nghĩa "cảnh báo mức vừa" — tô nền lớn sẽ làm loãng nghĩa đó. */}
        <div className="flex items-start justify-between gap-3 border-b-2 border-amber-400 px-5 py-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">Quy ước chấm cảnh báo</div>
            <div className="text-sm font-bold text-slate-900">TIÊU CHÍ CẢNH BÁO</div>
            <div className="mt-0.5 text-[11px] text-slate-600">
              Mỗi hạng mục được đánh giá theo <b>3 tiêu chí</b>: (1)&nbsp;% chậm tiến độ so với kế hoạch;
              (2)&nbsp;số ngày quá hạn; (3)&nbsp;thời gian còn lại đến mốc bàn giao của dự án.
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100">Đóng ✕</button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 pb-4">
          {/* Ý chính đặt TRƯỚC bảng — đây là điều người đọc hay hiểu sai nhất. */}
          <ul className="mt-3 space-y-1 rounded-md border-l-[3px] border-amber-400 bg-amber-50/60 px-4 py-2.5 text-[11.5px] leading-relaxed text-slate-800">
            <li className="flex gap-2">
              <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              <span>Mức cảnh báo tăng theo thời gian còn lại đến mốc bàn giao.</span>
            </li>
            <li className="flex gap-2">
              <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              <span>Cùng một nhãn, màu cảnh báo tăng từ <b className="text-amber-700">vàng</b> → <b className="text-red-600">đỏ</b> khi dự án tiến gần mốc bàn giao.</span>
            </li>
            <li className="flex gap-2">
              <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              <span><b>Màu</b> = mức độ ưu tiên xử lý; <b>Nhãn</b> = hướng xử lý.</span>
            </li>
          </ul>

          {/* 3 bảng đặt CẠNH NHAU để thấy được sự "siết" khi đọc ngang. */}
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
            {BANG.map(b => (
              <div key={b.key} className="overflow-hidden rounded-lg border border-slate-200">
                <div className="flex items-baseline justify-between gap-2 bg-slate-700 px-2.5 py-1.5 text-white">
                  <span className="text-[11px] font-bold">{b.nhan}</span>
                  <span className="text-[9.5px] text-slate-300">{b.phu}</span>
                </div>
                <table className="w-full table-fixed border-collapse">
                  <thead>
                    <tr>
                      {/* Ô góc gạch chéo: "Quá hạn" ứng với các CỘT (nằm trên đường chéo),
                          "Chậm" ứng với các HÀNG (nằm dưới). Vẽ bằng SVG với
                          preserveAspectRatio="none" để đường chéo LUÔN nối đúng 2 góc dù ô
                          không vuông — linear-gradient thì không làm được điều đó (dải màu
                          vuông góc với trục gradient, lệch khỏi góc khi tỉ lệ ô thay đổi). */}
                      {/* Mọi thứ bên trong ô góc đều position:absolute ⇒ KHÔNG đóng góp chiều
                          cao, nên ô này cao đúng h-9 như các ô khác và 4 hàng bằng nhau tuyệt
                          đối. Trước đó bọc bằng <div> thường: div chiếm chỗ thật, cộng thêm
                          phần lẻ của dòng chữ làm hàng tiêu đề cao hơn 0.4px so với hàng dữ liệu. */}
                      <th className="relative h-9 w-[27%] border-b border-r border-slate-200 p-0 align-middle">
                        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                          <line x1="0" y1="0" x2="100" y2="100" stroke="#cbd5e1" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                        </svg>
                        <span className="absolute right-1 top-[4px] text-[8.5px] font-semibold leading-none text-slate-500">Quá hạn</span>
                        <span className="absolute bottom-[4px] left-1 text-[8.5px] font-semibold leading-none text-slate-500">Chậm</span>
                      </th>
                      {COT.map(c => (
                        <th key={c.nhan} className="h-9 border-b border-r border-slate-200 px-1 py-1 text-[9px] font-semibold text-slate-600 last:border-r-0">
                          {c.nhan}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {HANG.map(h => (
                      <tr key={h.nhan}>
                        <th className="h-9 border-b border-r border-slate-200 px-1 py-1 text-left align-middle">
                          <div className="text-[9.5px] font-bold leading-tight text-slate-700">{h.nhan}</div>
                          <div className="text-[8px] leading-tight text-slate-400">{h.mo}</div>
                        </th>
                        {COT.map(c => {
                          const v = classifyByMatrix(h.gap, c.od, gapThreshold, b.key);
                          // h-9 = 36px cho MỌI ô (kể cả hàng tiêu đề) ⇒ 4 hàng đều tăm tắp.
                          // Lưu ý: `height` trên ô bảng chỉ là mức TỐI THIỂU — nội dung cao hơn
                          // thì hàng vẫn nở. Đều được là nhờ badge đã bị khoá 26px ở trên; bỏ
                          // khoá đó thì 4 hàng sẽ lệch lại.
                          return (
                            <td key={c.nhan} className="h-9 border-b border-r border-slate-200 px-[3px] py-[3px] text-center align-middle last:border-r-0">
                              {O(v.kind, v.color)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          {/* Ý nghĩa nhãn — nói người đọc PHẢI LÀM GÌ, không nhắc lại định nghĩa. */}
          <div className="mt-4">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Ý nghĩa các nhãn</div>
            {/* Mỗi thẻ: nền nhạt + viền theo MỨC nghiêm trọng (đổ màu), phần "hướng xử lý"
                (sau mũi tên) IN ĐẬM và tô cùng tông màu để mắt bắt ngay việc cần làm. */}
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {([
                { k: "late",  c: "red",   box: "border-red-200 bg-red-50/60",     act: "text-red-700",
                  ctx: "Hạng mục đã trễ tiến độ cam kết hoặc có dấu hiệu ảnh hưởng mốc bàn giao dự án", do: "Cần can thiệp ngay." },
                { k: "trim",  c: "amber", box: "border-amber-200 bg-amber-50/60", act: "text-amber-700",
                  ctx: "Hạng mục trễ tiến độ kéo dài, khối lượng công việc còn ít", do: "Ưu tiên hoàn tất và đóng hạng mục." },
                { k: "focus", c: "amber", box: "border-amber-200 bg-amber-50/60", act: "text-amber-700",
                  ctx: "Hạng mục có dấu hiệu chậm tiến độ", do: "Cần theo dõi sát." },
                { k: "none",  c: null,    box: "border-slate-200 bg-slate-50",     act: "text-slate-700",
                  ctx: "", do: "Hạng mục trong tầm kiểm soát." },
              ] as Array<{ k: AlertKind; c: AlertColor; box: string; act: string; ctx: string; do: string }>).map(x => (
                <div key={x.k} className={`rounded-md border px-2.5 py-2 ${x.box}`}>
                  <div className="mb-1 flex">{O(x.k, x.c)}</div>
                  <div className="text-[10.5px] leading-snug text-slate-600">
                    {x.ctx && <>{x.ctx} <span className="text-slate-400">→</span> </>}
                    <b className={x.act}>{x.do}</b>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Ngoại lệ — chỗ người dùng hay tưởng app tính sai, phải nói rõ. */}
          <div className="mt-4">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Các trường hợp ngoại lệ</div>
            <ul className="space-y-1.5 text-[11px] leading-relaxed text-slate-700">
              <li className="flex gap-2">
                <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                <span><b className="text-red-700">Dự án trễ hạn bàn giao:</b> Toàn bộ hạng mục chưa hoàn thành được ghi nhận
                là <b>Trễ tiến độ</b>, không áp dụng quy tắc đánh giá thông thường.</span>
              </li>
              <li className="flex gap-2">
                <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />
                <span><b className="text-emerald-700">Dự án đã bàn giao:</b> Dòng dự án chuyển nền <b>xanh</b> và toàn bộ
                cảnh báo được gỡ bỏ.</span>
              </li>
              <li className="flex gap-2">
                <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                <span><b className="text-slate-700">Hạng mục phát sinh (mã PS):</b> Không áp dụng cảnh báo, do có mốc hoàn
                thành riêng và thường muộn hơn mốc bàn giao của dự án.</span>
              </li>
            </ul>
          </div>

          {/* Tên hai trục ở bảng là "Chậm" và "Quá hạn" — phần định nghĩa này PHẢI dùng
              đúng hai từ đó. Gọi khác đi (vd "độ lệch") thì người chưa quen sẽ tưởng là
              một đại lượng thứ ba. */}
          <div className="mt-3 space-y-1 border-t border-slate-100 pt-2 text-[10px] leading-relaxed text-slate-400">
            <div>
              (1) <b className="text-slate-500">Chậm</b> là % tiến độ thực tế thấp hơn so với % tiến độ kế hoạch tại thời
              điểm đánh giá. Tính bằng: % Kế hoạch - % Thực tế của hạng mục.
            </div>
            <div>
              (2) <b className="text-slate-500">Quá hạn</b> là số ngày trễ tiến độ cam kết của hạng mục (không tính theo
              mốc bàn giao dự án).
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
