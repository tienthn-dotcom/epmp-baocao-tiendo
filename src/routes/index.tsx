import { createFileRoute } from "@tanstack/react-router";
import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ClipboardCheck,
  EyeOff,
  FileSpreadsheet,
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
  Upload,
  Users,
  X,
} from "lucide-react";

import type { BlockChild, CodeCount, ItemRow, ProjectRow, ReportData } from "@/lib/types";
import {
  getFilteredProjects,
  auditFilterResult,
  projectKeyOf,
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
import { AppShell } from "@/lib/app-shell";


import { toast } from "sonner";
import { parseCsvText, parseXlsxBuffer, noteSaysTrinhBodBitrix } from "@/lib/parser";
import type { XlsxTableRow, XlsxStatusColor } from "@/lib/excel-export";
import { fetchSheetCsv, fetchSheetXlsx } from "@/lib/sheets.functions";
import { getSummaryFile, recordSummaryFiles } from "@/lib/mtld-install.functions";
import { readInstallLinks } from "@/lib/mtld-links";
import { fetchEdits, saveEdits, editMessages, fetchAppConfig, saveAppConfig, fetchUpdateHistory, recordUpdateDates, fetchCompletedDates, syncCompletedDates, remapKeys, fetchUserRoles, saveUserRole, fetchHiddenRows, setHiddenRow, type EditsMap, type ItemEdit, type ChatMsg, type UpdateHistory, type CompletedDates, type HiddenRows } from "@/lib/edits.functions";
import { whoami, recordActivity, fetchActivityLog } from "@/lib/activity.functions";
import { actionLabel, type ActivityRow } from "@/lib/activity";
import { roleOf, ROLE_META, ALL_ROLES, DEFAULT_ROLES, type UserRole } from "@/lib/roles";
import { buildComplianceReport, SCORING } from "@/lib/compliance";
import { parseComplianceFile, pmAverages, type ComplianceFileData, type ComplianceFileRow, type CMark } from "@/lib/compliance-file";
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
  component: () => <AppShell epmpApp={<Dashboard />} />,
});

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
const APP_VERSION = "3.33.0";

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
const DEPT_ORDER: string[] = ["QS", "SCM", "NM", "PM", OTHER_LABEL];

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

/** Tiền tố bộ phận chuẩn hiển thị ở cột PIC, theo hạng mục.
 *  Chỉ dùng cho HIỂN THỊ — không đổi dữ liệu gốc. */
const PIC_PREFIX_BY_STAGE: Record<StageId, string> = {
  TK: "PM", MA: "SCM", BG: "QS", VT: "SCM", SD: "PM", SX: "NM", TC: "PM",
};
function normalizePicByStage(raw: string, sid: StageId | "MB" | "PS" | "SHOP" | "OTHER"): string {
  const src = (raw || "").trim();
  if (sid === "MB" || sid === "PS" || sid === "SHOP" || sid === "OTHER") return src;
  const prefix = PIC_PREFIX_BY_STAGE[sid];
  if (!src) return prefix;
  // Nếu có "-" → coi phần trước "-" đầu là tiền tố cũ, thay bằng đúng.
  const dash = src.search(/[-–—]/);
  const name = dash >= 0 ? src.slice(dash + 1).trim() : src.trim();
  // Nếu không có dấu "-" nhưng chuỗi bắt đầu bằng tiền tố quen thuộc, cắt bỏ.
  const bare = dash >= 0 ? name : name.replace(/^(pm|scm|qs|nh[àa]\s*m[áa]y|sd|tk|ma|bg|vt|sx|tc)\b[:\s.]*/i, "").trim();
  return bare ? `${prefix} - ${bare}` : prefix;
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
const ALERT_RANK: Record<AlertK, number> = { late: 0, trim: 1, focus: 2 };
/** MÀU BADGE theo MỨC NGHIÊM TRỌNG (ma trận trả về), KHÔNG theo nhãn.
 *  Từ 17/07/2026 "Cần tập trung"/"Cần cắt đầu việc" có thể ĐỎ khi dự án sắp bàn giao,
 *  nên tra bảng bằng `_alertColor`; tra bằng `kind` là sai màu. */
const BADGE_CLS_BY_COLOR: Record<"red" | "amber", string> = {
  red: "bg-red-600 text-white",
  amber: "bg-amber-400 text-amber-950",
};

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
    // NGUỒN CỐ ĐỊNH: luôn dùng link hardcode trong default-source.ts. Tiên cập nhật
    // link bằng cách sửa file đó rồi deploy — KHÔNG đọc localStorage/KV cho nguồn nữa
    // để file là NGUỒN SỰ THẬT DUY NHẤT (đã ẩn nút "Nguồn dữ liệu").
    setConfig({ mode: "google", sheetUrl: DEFAULT_SHEET_URL });
    setThresholds(loadThresholds());
    setCached(loadLastKnown());
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
        {data && <DashboardBody data={data} thresholds={thresholds} />}
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
                    await saveAppConfig({ data: { sheetUrl: c.sheetUrl } });
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

function Header({ loading, dataMode, freshAt, source, onRefresh, onOpenSettings, gapThreshold }: {
  loading: boolean;
  dataMode: "live" | "cache" | "demo"; freshAt: string | null; source?: "google" | "upload";
  onRefresh: () => void; onOpenSettings: () => void;
  /** Ngưỡng lệch % đang áp dụng — bảng "Tiêu chí cảnh báo" phải nói đúng ngưỡng THẬT. */
  gapThreshold: number;
}) {
  const [tieuChiOpen, setTieuChiOpen] = useState(false);
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
              PMO · Bộ phận Projects Planning
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
          {/* CHỖ CẮM tính năng hệ thống (đánh giá tuân thủ, nhật ký giám sát). Nội dung do
              DashboardBody bơm vào qua <HeaderSlot> (portal) — đặt ở đây vì Header không cầm
              được dữ liệu báo cáo/quyền admin; xem chú thích ở DashboardBody. */}
          <div id="pmo-system-slot" className="flex items-center print:hidden" />
          <FreshnessBadge mode={dataMode} freshAt={freshAt} source={source} />
          <div className="flex items-center gap-2 md:justify-end print:hidden">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-bold tracking-normal text-slate-900" title="Phiên bản sản phẩm">v{APP_VERSION}</span>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
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
  const [gap, setGap] = useState(value.gapThreshold);
  const [overdue, setOverdue] = useState(value.overdueThreshold);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
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
  it.id && it.id.trim()
    // ID phân cấp (cột STT) duy nhất toàn cục → khoá thẳng theo ID, KHÔNG lệ thuộc tên/mã/thứ tự.
    ? `id:${it.id.trim()}`
    // Fallback (nguồn không có cột STT — cache/CSV/demo cũ): khoá theo mã+tên+giai đoạn+dupIdx.
    : [it.projectCode, it.projectName, it.rawCode, it.dupIdx ?? 0].join(String.fromCharCode(0));

/** TEXT rút gọn của box chat = ghép các message KHÔNG ẩn (bảng chỉ hiện phần này; xuất Excel/PDF/lọc dùng đây). */
const visibleText = (msgs?: ChatMsg[]): string => (msgs ?? []).filter((m) => !m.hidden).map((m) => m.text).join("\n");
const fmtMsgTime = (iso: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** Patch chỉnh sửa 1 đầu việc gửi lên backend (null = xoá override field đó). */
type HiRange = [number, number];
type EditPatch = { pic?: string | null; deadline?: string | null };

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

function DashboardBody({ data, thresholds }: { data: ReportData; thresholds: Thresholds }) {
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
    const ids = [...new Set(Object.values(installLinks).filter(Boolean))];
    if (ids.length) void recordSummaryFiles({ data: { fileIds: ids } }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(Object.values(installLinks).sort())]);
  const [summaryFileId, setSummaryFileId] = useState<string | null>(null);
  useEffect(() => {
    void whoami({ data: { devAs: devAs() } }).then(setMe).catch(() => {});
    track("view");
  }, []);

  // Ngưỡng + hôm nay, gộp MỘT LẦN tại đây. Ma trận cần `today` để biết dự án còn mấy
  // ngày tới mốc bàn giao; chỗ nào chấm cảnh báo (bảng, lọc, đối chiếu Excel) đều phải
  // truyền bản này — truyền `thresholds` trần là chiều "sắp bàn giao" im lặng tắt.
  const th = useMemo<Thresholds>(() => ({ ...thresholds, today }), [thresholds, today]);

  const pmByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of data.projects) m.set(p.code, (p.pm && p.pm.trim()) || "—");
    return m;
  }, [data.projects]);

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
  const pkProj = useCallback((p: { code: string; name: string; id?: string }) => projectKeyOf(p.code, p.name, p.id), []);
  const pkItem = useCallback(
    (i: { projectCode: string; projectName: string }) =>
      projectKeyOf(i.projectCode, i.projectName, projIdByName.get(`${i.projectCode} ${i.projectName}`)),
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

  const saveItemEdit = async (key: string, patch: EditPatch) => {
    try {
      const r = await saveEdits({ data: { entries: { [key]: patch }, devAs: devAs() } });
      queryClient.setQueryData(["edits"], r.items);
      // NHẬT KÝ GHI RÕ SỬA GÌ: trường nào = giá trị nào (vd Vướng mắc = "vvvvv"), kèm dự án ·
      // công đoạn để admin nhìn phát biết ai sửa gì ở đâu — không chỉ ghi chung "sửa dữ liệu".
      const FIELD_VN: Record<string, string> = { pic: "Người phụ trách", deadline: "Deadline" };
      const parts: string[] = [];
      for (const f of ["pic", "deadline"] as const) {
        if (patch[f] === undefined) continue;
        const v = patch[f];
        parts.push(v == null || String(v).trim() === ""
          ? `${FIELD_VN[f]}: (xoá)`
          : `${FIELD_VN[f]} = "${String(v).replace(/\s+/g, " ").trim().slice(0, 140)}"`);
      }
      const it = data.items.find(x => itemKeyOf(x) === key);
      const proj = it ? null : data.projects.find(p => pkProj(p) === key);
      const ctx = it ? `${it.projectCode} ${it.projectName} · ${stageAbbrOf(stageIdOf(it))}`
                : proj ? `${proj.maCT || proj.code} ${proj.name} (cấp dự án)` : key.slice(0, 40);
      track("save_edit", [ctx, parts.join(" · ")].filter(Boolean).join(" — ").slice(0, 290));
      toast.success("Đã lưu vào bản dùng chung, mọi người đều thấy");
    } catch (e) {
      toast.error(`Lưu thất bại (dữ liệu chưa ghi): ${(e as Error).message}`);
    }
  };

  /** Thao tác BOX CHAT Vướng mắc / Giải pháp (add/hide/unhide/delete[admin]/sethi[admin]). */
  const msgOp = async (key: string, field: "note" | "action", op: "add" | "edit" | "hide" | "unhide" | "delete" | "sethi" | "hiall" | "unhiall", opts?: { text?: string; msgId?: string; hi?: HiRange[] | null; replyTo?: string; replyText?: string }) => {
    try {
      const r = await editMessages({ data: { key, field, op, text: opts?.text, msgId: opts?.msgId, hi: opts?.hi, replyTo: opts?.replyTo, replyText: opts?.replyText, devAs: devAs() } });
      queryClient.setQueryData(["edits"], r.items);
      const FIELD_VN = field === "note" ? "Vướng mắc" : "Giải pháp";
      const OP_VN: Record<string, string> = { add: "thêm", edit: "sửa", hide: "ẩn", unhide: "mở ẩn", delete: "XOÁ", sethi: "tô màu", hiall: "tô cả ô", unhiall: "bỏ tô cả ô" };
      const it = data.items.find(x => itemKeyOf(x) === key);
      const proj = it ? null : data.projects.find(p => pkProj(p) === key);
      const ctx = it ? `${it.projectCode} ${it.projectName} · ${stageAbbrOf(stageIdOf(it))}`
                : proj ? `${proj.maCT || proj.code} ${proj.name} (cấp dự án)` : key.slice(0, 40);
      const detail = op === "add" && opts?.text ? `: "${opts.text.replace(/\s+/g, " ").trim().slice(0, 120)}"` : "";
      track("save_edit", `${ctx} — ${FIELD_VN}: ${OP_VN[op]}${detail}`.slice(0, 290));
    } catch (e) {
      toast.error(`Thao tác thất bại: ${(e as Error).message}`);
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
      for (const it of (p.allItems ?? p.items ?? [])) {
        if (it.id && it.id.trim()) {
          const oldK = legacyItem(it.projectCode, it.projectName, it.rawCode, it.dupIdx ?? 0), newK = `id:${it.id.trim()}`;
          if (oldK !== newK) { editPairs[oldK] = newK; completedPairs[oldK] = newK; }
        }
        if (it.blocks?.length) {
          it.blocks.forEach((b, bi) => {
            if (b.id && b.id.trim()) {
              const oldK = legacyItem(it.projectCode, it.projectName, b.code, bi), newK = `id:${b.id.trim()}`;
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
  }, [editsQuery.isLoading, historyQuery.isLoading, completedQuery.isLoading, data.projects, edits, completedDates, updateHistory, queryClient]);

  useEffect(() => {
    if (!remapReady) return; // chờ di trú khoá xong mới sync (tránh XOÁ nhầm khoá tên cũ)
    if (completedQuery.isLoading || !data.projects.length) return;
    const add: Record<string, string> = {};
    const seenDone = new Set<string>();
    for (const p of data.projects) for (const it of (p.allItems ?? p.items ?? [])) {
      if (!(it.pctActual != null && it.pctActual >= 100)) continue;
      const key = itemKeyOf(it);
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
  }, [remapReady, data.projects, completedDates, completedQuery.isLoading, today, queryClient]);

  /* ── ÁP CHỈNH SỬA vào dữ liệu TRƯỚC mọi phép tính (lọc/phân loại/bảng/PDF
     đều tiêu thụ effectiveItems — sửa Deadline sẽ tự tính lại Quá hạn,
     % dự kiến và nhãn Tình trạng theo đúng luật hiện hành). ── */
  const effectiveItems: ItemRow[] = useMemo(() => {
    return data.items.map(it => {
      const ed = edits[itemKeyOf(it)];
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
  }, [data.items, edits, today]);

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
      const key = itemKeyOf(raw); // khoá tính theo dữ liệu GỐC, không đổi khi sửa
      const ed = edits[key];
      return {
        ...it,
        note: visibleText(ed?.noteMsgs),   // TEXT rút gọn = message KHÔNG ẩn (bảng/xuất Excel)
        _stageId: sid,
        _stageLabel: stageLabelOf(sid),
        _stageDisplay: stageDisplayLabel(sid),
        _dept: deptOf(sid),
        _pic: it.owner || pmByCode.get(it.projectCode) || "—",
        _projectPm: pmByCode.get(it.projectCode) || "—",
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
  }, [th, pmByCode, today, edits]);

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
      rawCode: b.code, dupIdx: bi, desc: b.label,
      start: bStart, deadline: bDeadline,
      pctActual: b.pctActual, pctActualInvalid: false,
      codeCounts: undefined, blocks: undefined, note: "",
      overdueDays: getDaysOverdue({ deadline: bDeadline, pctActual: b.pctActual }, today),
    };
    const ed = edits[itemKeyOf(raw)];
    const deadline = ed?.deadline ?? raw.deadline;
    const edited: ItemRow = {
      ...raw,
      note: ed?.note ?? "",
      owner: ed?.pic ?? raw.owner,
      deadline,
      overdueDays: getDaysOverdue({ deadline, pctActual: b.pctActual }, today),
    };
    return enrichItem(raw, edited);
  }, [edits, today, enrichItem]);

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
      const k = itemKeyOf(raw);
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
  }, [showDone, data.projects, edits, today, enrichItem, hiddenKeys, showHidden]);

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

  /* ────────────────────────────────────────────────────────────────
   * HÀM LỌC TRUNG TÂM — getFilteredProjects (src/lib/filter.ts).
   * Bảng app, Excel, PDF đều tiêu thụ TỪ ĐÂY. Không nơi nào tự lọc riêng.
   * ──────────────────────────────────────────────────────────────── */
  const matcher: StageMatcher = useMemo(() => ({
    stageId: (it) => stageIdOf(it),
    deptOf: (it) => deptOf(stageIdOf(it)),
    computePlanPct: (it) => computePlanPct(it.start, it.deadline, today),
  }), [today]);

  const criteriaTable: FilterCriteria = useMemo(() => ({
    stages: filters.stages as string[],
    depts: filters.depts,
    alerts: filters.alerts,
    deadlineMonths: filters.deadlineMonths,
    query: filters.query.trim().toLowerCase(),
    searchHaystack: (it) => `${it.projectName} ${it.maCT} ${it.owner || pmByCode.get(it.projectCode) || ""} ${pmByCode.get(it.projectCode) || ""} ${it.desc}`,
  }), [filters, pmByCode]);

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
  const enrichedKey = (it: ItemRow) =>
    `${it.projectCode}\u0000${it.projectName}\u0000${it.rawCode}\u0000${it.desc}\u0000${it.start ?? ""}\u0000${it.deadline ?? ""}`;
  const enrichedMap = useMemo(() => {
    const m = new Map<string, EnrichedItem>();
    for (const e of enriched) m.set(enrichedKey(e), e);
    return m;
  }, [enriched]);


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
          sxStart: null, sxEnd: null,
          overdue: it.overdueDays ?? 0,
          note: "",
          children: [],
          stageAbbr: stageAbbrOf(it._stageId as StageOrOther),
          actualEnd: completedDates[itemKeyOf(it)] ?? null,
          hideKey: itemKeyOf(it), hidden: !!it._hidden,
        };
      });
      flat.sort((a, b) => (a.end ?? "9999").localeCompare(b.end ?? "9999") || a.name.localeCompare(b.name, "vi"));
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
        actualEnd: completedDates[itemKeyOf(bit)] ?? null,
        hideKey: itemKeyOf(bit), hidden: !!bit._hidden,
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
        actualEnd: completedDates[itemKeyOf(it)] ?? null,
        hideKey: itemKeyOf(it), hidden: !!it._hidden,
        blocks: blockKids.length ? blockKids : undefined,
      });
    }
    // Trong mỗi dự án: sắp theo thứ tự giai đoạn (TK→…→TC), rồi theo ngày bắt đầu.
    const stageIdxOf = (ab: string) => { const i = STAGE_ORDER.indexOf(ab as StageId); return i < 0 ? 90 : i; };
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
        sxStart: sx?.start ?? null, sxEnd: sx?.deadline ?? null,
        overdue, note: edits[pk]?.note || p.mpReason || "",
        children: childrenByProject.get(pk) ?? [],
      });
    }
    rows.sort((a, b) => (a.end ?? "9999").localeCompare(b.end ?? "9999") || a.name.localeCompare(b.name, "vi"));
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
          // Sắp xếp Hạng mục theo ĐÚNG thứ tự giai đoạn (không theo abc).
          const gi = STAGE_ORDER.indexOf(it._stageId as StageId);
          return gi >= 0 ? gi : 90;
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
          const rank: Record<string, number> = { late: 2, trim: 3, focus: 4, none: 0 };
          return rank[it._alert] ?? 0;
        }
        case "note":            return (it.note || "").trim().toLowerCase();
        case "action":          return (it._action || "").trim().toLowerCase();
        default:                return null;
      }
    };
    // Chuỗi so sánh = khoá người dùng chọn + tie-break chuẩn (bỏ khoá trùng).
    const CANON: SortSpec[] = [
      { key: "projectDeadline", dir: "asc" },
      { key: "name", dir: "asc" },
      { key: "maCT", dir: "asc" },
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
        else cmp = String(va).localeCompare(String(vb), "vi", { sensitivity: "base" });
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
  const doPrint = async (orientation: "landscape" | "portrait") => {
    const isPortrait = orientation === "portrait";
    const tid = toast.loading(`Đang tạo PDF ${isPortrait ? "khổ DỌC" : "khổ ngang"} từ giao diện…`, { position: "bottom-left" });
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
      const pages = await exportDashboardPdf({
        title: document.getElementById("pdf-title"),
        blocks,
        table,
        // Bảng Danh sách: ÉP bề rộng cố định (PDF_TABLE_WIDTH) → PDF ỔN ĐỊNH trên MỌI màn hình (không
        // phụ thuộc cửa sổ rộng/hẹp → không bị "20 trang khi màn hẹp"). Vẫn giữ ĐÚNG tỉ lệ cột người
        // dùng kéo (colW là %). Gantt (isGantt) mới giữ bề rộng thật vì lưới tuần không được bóp méo.
        wide: isGantt,
        orientation,
        fileName: `${isGantt ? "TongTheTienDo" : "BaoCao_TienDo"}_${isPortrait ? "Doc" : "Ngang"}_${today.replace(/-/g, "")}.pdf`,
      });
      track("export_pdf", `${isPortrait ? "DỌC" : "Ngang"} · Bảng ${isGantt ? "Tổng thể tiến độ" : "Việc cần xử lý"} · Lọc: ${filterSummary} · ${sortedAlerts.length} đầu việc`.slice(0, 300));
      toast.success(`Đã tạo PDF ${isPortrait ? "khổ dọc" : "khổ ngang"} (${pages} trang), đúng như giao diện đang xem`);
    } catch (e) {
      toast.error(`Tạo PDF lỗi: ${(e as Error).message}`);
    } finally {
      toast.dismiss(tid);
    }
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

  return (
    <RolesCtx.Provider value={roleMap}>
    <div className="flex flex-col gap-2 print:min-h-0" style={{ minHeight: "calc(100vh - 130px)" }}>

      {showRoles && <RoleManagerDialog roleMap={roleMap} onClose={() => setShowRoles(false)}
        onSaved={(m) => queryClient.setQueryData(["userRoles"], m)} />}
      {showCompliance && <ComplianceDialog
        data={complianceFileQuery.data}
        loading={complianceFileQuery.isLoading}
        error={complianceFileQuery.error as Error | null}
        regionByName={regionByName}
        today={today}
        onRetry={() => complianceFileQuery.refetch()}
        onClose={() => setShowCompliance(false)} />}
      {showActivity && <ActivityLogDialog onClose={() => setShowActivity(false)} />}
      {summaryFileId && <SummaryDialog fileId={summaryFileId} onClose={() => setSummaryFileId(null)} />}

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
          tvMode={tvMode}
          onToggleTv={toggleTvMode}
        />
      </HeaderSlot>

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
        onOpenSummary={setSummaryFileId}
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
        onSaveEdit={saveItemEdit}
        onMsgOp={msgOp}
        onPrint={(o) => { void doPrint(o); }}
        onExportExcel={async () => {
          // XUẤT EXCEL "Y HỆT BẢNG/PDF": cùng cột + dòng gộp dự án (xổ công đoạn con) + màu trạng thái,
          // nhưng là Ô THẬT (lọc/sort/sửa trong Excel). Dựng từ CHÍNH `dueMonthGroups` (nguồn bảng gộp).
          if (dueMonthGroups.length === 0) { toast.error("Không có dữ liệu để xuất"); return; }
          const clean = (s?: string | null) => (s ?? "").replace(/\s*\n+\s*/g, ", ").trim();
          const ALERT_TXT: Record<string, string> = { late: "Trễ tiến độ", trim: "Cần cắt đầu việc", focus: "Cần tập trung" };
          const itemStatus = (it: EnrichedItem): { text: string; color: XlsxStatusColor } => {
            const done = !!completedDates[itemKeyOf(it)] || (it.pctActual != null && Math.round(it.pctActual) >= 100);
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
            { label: "Vướng mắc", width: 48, wrap: true, align: "left" as const },
            { label: "Giải pháp", width: 48, wrap: true, align: "left" as const },
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
              const doneOn = completedDates[itemKeyOf(it)];
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
      {p.suspectCount > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10.5px] text-slate-600">
          <SuspectBadge count={p.suspectCount} />
        </div>
      )}
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

function SuspectBadge({ count }: { count: number }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-900">
      <AlertTriangle className="h-3 w-3" /> {count} ô phần trăm nghi ngờ dữ liệu, đã loại khỏi phép tính lệch
    </div>
  );
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
  { k: "note",            align: "left",   label: "Vướng mắc" },
  { k: "action",          align: "left",   label: "Giải pháp" },
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
  { k: "note",            align: "left",   label: "Vướng mắc" },
  { k: "action",          align: "left",   label: "Giải pháp" },
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
function SummaryDialog({ fileId, onClose }: { fileId: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["summary-file", fileId],
    queryFn: () => getSummaryFile({ data: { fileId } }),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const [render, setRender] = useState<{ html: string; css: string } | null>(null);
  const [parseErr, setParseErr] = useState<string | null>(null);
  useEffect(() => {
    const b64 = q.data?.b64;
    if (!b64) return;
    let off = false;
    (async () => {
      try {
        const [XLSX, mod] = await Promise.all([import("xlsx"), import("@/lib/summary-render")]);
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const wb = XLSX.read(bytes.buffer, { type: "array", cellStyles: true, sheets: ["Summary"] });
        const sh = wb.Sheets["Summary"];
        if (off) return;
        if (!sh) { setParseErr('File không có sheet "Summary".'); return; }
        setRender({ html: mod.summaryToHtml(sh), css: mod.SUMMARY_CSS });
      } catch (e) { if (!off) setParseErr((e as Error).message); }
    })();
    return () => { off = true; };
  }, [q.data]);

  const loading = q.isPending || (!!q.data && !render && !parseErr);
  const err = q.isError ? (q.error as Error).message : parseErr;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 print:hidden" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-[1040px] flex-col rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-teal-700">Ma trận lắp đặt</div>
            <div className="text-sm font-semibold text-slate-900">Tiến độ bàn giao — Summary</div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Đóng"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {loading && <div className="p-10 text-center text-sm text-slate-500">Đang tải ma trận Summary…</div>}
          {err && <div className="p-10 text-center text-sm text-red-600">Lỗi: {err}</div>}
          {render && <><style dangerouslySetInnerHTML={{ __html: render.css }} /><div dangerouslySetInnerHTML={{ __html: render.html }} /></>}
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
type MsgOp = (op: "add" | "edit" | "hide" | "unhide" | "delete" | "sethi" | "hiall" | "unhiall", opts?: { text?: string; msgId?: string; hi?: HiRange[] | null; replyTo?: string; replyText?: string }) => void | Promise<void>;

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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPmo = roleOf(useContext(RolesCtx), myEmail) === "PMO";
  const vis = msgs.filter((m) => !m.hidden);
  // 1 click (hoãn 230ms nếu admin để chờ nhấp đúp) → mở box chat. cancelOpen: huỷ khi nhấp đúp.
  const openDelayed = () => { if (!onOpen) return; if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => { timer.current = null; onOpen(); }, isAdmin ? 230 : 0); };
  const cancelOpen = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
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
            className="w-full resize-y rounded border border-slate-300 px-1.5 py-1 text-[11px] leading-snug focus:border-teal-600 focus:outline-none" />
          <div className="mt-1 flex items-center justify-end gap-2">
            <button type="button" onClick={(e) => { e.stopPropagation(); setEditId(null); }} className="text-[10px] text-slate-500 hover:text-slate-800">Huỷ</button>
            <button type="button" onClick={(e) => { e.stopPropagation(); const t = draft.trim(); if (t && t !== m.text) void onOp!("edit", { msgId: m.id, text: t }); setEditId(null); }}
              className="rounded bg-teal-700 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-teal-800">Lưu</button>
          </div>
        </div>
      ) : (
        // NHẤP ĐÚP bong bóng (admin) → CHỈ bong bóng đó đổi màu (tô/bỏ full-range của tin đó).
        <div key={m.id}
          onDoubleClick={isAdmin && onOp ? () => { cancelOpen(); const has = (m.hi?.length ?? 0) > 0; void onOp("sethi", { msgId: m.id, hi: has ? null : [[0, m.text.length]] }); } : undefined}
          title={isAdmin ? "1 click: mở · nhấp đúp: tô/bỏ màu TIN NÀY" : undefined}
          className="rounded-lg rounded-tl-none border border-amber-200 bg-amber-50 px-2 py-1">
          <div className="mb-0.5 flex items-center gap-1.5 text-[10px] leading-none text-slate-900">
            <UpdateChip date={m.at} today={today ?? ""} />
            {m.author !== "(cũ)" && <><RoleBadge email={m.author} /><span className="font-semibold text-slate-900">{m.author.split("@")[0]}</span></>}
            {((field === "note" && onReply) || canHide(m)) && (
              <span className="ml-auto flex shrink-0 items-center gap-1.5 text-slate-500">
                {field === "note" && onReply && (
                  <button type="button" title="Trả lời → sang Giải pháp" onClick={(e) => { e.stopPropagation(); cancelOpen(); onReply(m); }} className="hover:text-teal-700"><Reply className="h-3.5 w-3.5" /></button>
                )}
                {canEdit(m) && <button type="button" title="Sửa" onClick={(e) => { e.stopPropagation(); cancelOpen(); setEditId(m.id); setDraft(m.text); }} className="hover:text-teal-700"><Pencil className="h-3 w-3" /></button>}
                {canHide(m) && <button type="button" title="Ẩn (coi như đã giải quyết)" onClick={(e) => { e.stopPropagation(); cancelOpen(); void onOp!("hide", { msgId: m.id }); }} className="hover:text-teal-700"><EyeOff className="h-3.5 w-3.5" /></button>}
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
function ChatBox({ msgs, isAdmin, myEmail, field, onOp, reply, onClearReply }: { msgs: ChatMsg[]; isAdmin: boolean; myEmail?: string | null; field: "note" | "action"; onOp: MsgOp; reply?: { toId: string; text: string }; onClearReply?: () => void }) {
  const [draft, setDraft] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const noun = field === "note" ? "vướng mắc" : "giải pháp";
  const isPmo = roleOf(useContext(RolesCtx), myEmail) === "PMO";
  // TÁC GIẢ / ADMIN / PMO đều SỬA + ẨN + XOÁ được comment người khác (PMO ngang admin ở 3 thao tác này).
  const canEdit = (m: ChatMsg) => isAdmin || isPmo || (!!myEmail && m.author === myEmail);
  const canHide = canEdit;
  const canDelete = isAdmin || isPmo;
  // Gửi tin: nếu đang trả lời 1 vướng mắc (reply) thì đính kèm replyTo + trích đoạn để hiện "↩ …".
  const send = () => { const t = draft.trim(); if (!t) return; void onOp("add", { text: t.slice(0, CHAT_MSG_MAX), ...(reply ? { replyTo: reply.toId, replyText: reply.text } : {}) }); setDraft(""); onClearReply?.(); };
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
                  {canDelete && <button type="button" onClick={() => { if (window.confirm("Xoá HẲN message này? Không khôi phục được.")) void onOp("delete", { msgId: m.id }); }} className="font-medium text-red-600 hover:underline">Xoá</button>}
                </span>
              </div>
              {editId === m.id ? (
                <div>
                  <textarea autoFocus value={editDraft} onChange={(e) => setEditDraft(e.target.value.slice(0, CHAT_MSG_MAX))} rows={5}
                    className="w-full resize-y rounded border border-slate-300 px-2 py-1.5 text-[13px] leading-relaxed focus:border-teal-600 focus:outline-none" style={{ minHeight: "7rem" }} />
                  <div className="mt-1 flex items-center justify-end gap-2">
                    <button type="button" onClick={() => setEditId(null)} className="text-[11px] text-slate-500 hover:text-slate-800">Huỷ</button>
                    <button type="button" onClick={() => { const t = editDraft.trim(); if (t && t !== m.text) void onOp("edit", { msgId: m.id, text: t }); setEditId(null); }}
                      className="rounded bg-teal-700 px-3 py-1 text-[11px] font-semibold text-white hover:bg-teal-800">Lưu</button>
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
          placeholder={reply ? "Soạn giải pháp trả lời…" : `Soạn ${noun} mới…`} className="w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-[13px] leading-relaxed focus:border-teal-600 focus:outline-none" />
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-[10px] leading-tight text-slate-400">Gửi rồi KHÔNG thể xoá.</span>
          <button type="button" onClick={send} disabled={!draft.trim()} className="shrink-0 rounded-md bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-40">Gửi</button>
        </div>
      </div>
    </div>
  );
}

/** Nút "Xuất PDF" dạng DROPDOWN — bấm xổ ra chọn khổ NGANG / DỌC (gộp 2 nút cho gọn toolbar). */
function PdfExportMenu({ onPrint }: { onPrint: (o: "landscape" | "portrait") => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const pick = (o: "landscape" | "portrait") => { setOpen(false); onPrint(o); };
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} title="Xuất PDF — chọn khổ ngang hoặc dọc"
        className="flex items-center gap-1.5 rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-700">
        <Printer className="h-3.5 w-3.5" /> Xuất PDF <span className="text-[8px] leading-none">▼</span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          <button onClick={() => pick("landscape")} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-slate-700 hover:bg-slate-100">
            <span className="text-slate-400">▭</span> Khổ ngang (A4)
          </button>
          <button onClick={() => pick("portrait")} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-slate-700 hover:bg-slate-100">
            <span className="text-slate-400">▯</span> Khổ dọc (A4 · điện thoại)
          </button>
        </div>
      )}
    </div>
  );
}

function FlatTablePanel({ items, mpMode, mpProjectRows, groupMode, groups, totalAlertsCount, deadlineMonthOptions, regionOptions, groupDAOptions, pmOptions, pesOptions, showGanttChildTasks, ganttRows, today, isAdmin, myEmail, installLinks, onOpenSummary, filters, setFilters, sortChain, onSort, showDone, onToggleDone, showHidden, onToggleShowHidden, hiddenCount, onHideRow, completedDates, onPrint, onExportExcel, onSaveEdit, onMsgOp }: {
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
  onOpenSummary?: (fileId: string) => void;
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
  onPrint: (orientation: "landscape" | "portrait") => void;
  onExportExcel: () => void | Promise<void>;
  /** Lưu chỉnh sửa (Vướng mắc/PIC/Deadline) lên backend dùng chung. */
  onSaveEdit: (key: string, patch: EditPatch) => void | Promise<void>;
  onMsgOp: (key: string, field: "note" | "action", op: "add" | "edit" | "hide" | "unhide" | "delete" | "sethi" | "hiall" | "unhiall", opts?: { text?: string; msgId?: string; hi?: HiRange[] | null; replyTo?: string; replyText?: string }) => void | Promise<void>;
}) {
  const activeCount =
    filters.depts.length + filters.stages.length + filters.alerts.length
    + filters.deadlineMonths.length + filters.regions.length + filters.groupDAs.length + filters.pms.length + filters.pes.length
    + (filters.query.trim() ? 1 : 0)
    + (filters.mpOnly ? 1 : 0) + (filters.dueThisMonth ? 1 : 0) + (filters.topKey ? 1 : 0);
  const [exporting, setExporting] = useState(false);
  // Cách trình bày bảng: "list" = bảng cảnh báo hiện tại; "gantt" = biểu đồ tổng thể tiến độ.
  const [viewMode, setViewMode] = useState<"list" | "gantt">("list");
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
      if (it.pctActual == null || it.pctActualInvalid) return true;
      if (!it.codeCounts?.length) return true; // không có chi tiết số mã → cần rà
      const s = buildCodeSummary(it.codeCounts);
      return actual != null && s.avgPct != null && s.pooledPct != null &&
        Math.abs(actual - s.avgPct) >= 3 && Math.abs(actual - s.pooledPct) >= 3;
    })();
    // "Thi công lắp đặt" đã hyperlink file Summary → bấm chữ mở popup ma trận lắp đặt.
    const installFid = it.stage === "Thi công lắp đặt" ? installLinks?.[it.maCT] : undefined;
    const picDisplay = it._picEdited ? it._pic : picByStageConv(it.owner, it._stageId, it._projectPm);
    // Dropdown "Thi công lắp đặt": item TC có Block con → hiện mũi ▶ để xổ.
    const hasBlocks = (it.blocks?.length ?? 0) > 0;
    const blkKey = itemKeyOf(it);
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
              {installFid ? (
                <button type="button"
                  onClick={(e) => { e.stopPropagation(); onOpenSummary?.(installFid); }}
                  className="line-clamp-3 text-left font-semibold leading-tight text-teal-700 underline decoration-dotted decoration-1 underline-offset-2 hover:text-teal-900"
                  style={{ wordBreak: "break-word" }}
                  title="Bấm xem tiến độ lắp đặt (ma trận Summary)">
                  {groupMode ? it._stageLabel : it.projectName} 📊
                </button>
              ) : (
                <div className="line-clamp-3 font-semibold text-black leading-tight" style={{ wordBreak: "break-word" }}
                     title={groupMode ? it._stageLabel : it.projectName}>{groupMode ? it._stageLabel : it.projectName}</div>
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
            const doneOn = completedDates[itemKeyOf(it)];
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
            ? <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700"><Check className="h-3 w-3" strokeWidth={3} />Đã hoàn thành</span>
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
              ? <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700"><Check className="h-3 w-3" strokeWidth={3} />Đã hoàn thành</span>
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
            className="w-full rounded-md border border-slate-300 pl-7 pr-2 py-1 text-xs focus:border-teal-600 focus:outline-none" />
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
                    </td>
                    {/* Tên dự án GÓI xuống 2 dòng như file PMP (break ở bất kỳ đâu, kể cả trong
                        chuỗi nối "_") thay vì kéo 1 dòng dài làm phình cột. Tên DÀI được phép tràn
                        sang dòng 3 để hiện ĐỦ tên, không cắt "…". */}
                    <td className="px-2 py-1"><span className="line-clamp-3 font-bold leading-tight text-white" style={{ wordBreak: "break-word" }} title={g.name}>{g.name}</span></td>
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
function GanttView({ rows, today, fullscreen = false, showChildTasks = false, flatStages = false, expanded, setExpanded, isAdmin = false, showHidden = false, onHideRow }: { rows: GanttRow[]; today: string; fullscreen?: boolean; showChildTasks?: boolean; flatStages?: boolean; expanded: Set<string>; setExpanded: (s: Set<string>) => void; isAdmin?: boolean; showHidden?: boolean; onHideRow?: (key: string, label: string, hide: boolean) => void }) {
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

  const { iso, months, monthCols, weeks, nWeeks, yearSegs, curColStart, curColEnd, todayCol, weekInWindow } = g;
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
  const navyCur = GC.headerCur;
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
      {/* Lưới CỘT TUẦN: vạch dọc ở MÉP mỗi ô tuần — gradient lặp, MỘT div/hàng. Tile rộng = 1 cột
          (100/nWeeks %) nên vạch TRÙNG KHÍT ranh giới ô ở header (không cần pha lệch nửa ngày). */}
      <div style={{ position: "absolute", top: 0, height: h, left: 0, right: 0, zIndex: 1,
        backgroundImage: `repeating-linear-gradient(to right, ${GC.weekLine} 0, ${GC.weekLine} 1px, transparent 1px, transparent ${(100 / nWeeks).toFixed(4)}%)` }} />
      {/* Viền THÁNG: kẻ ĐẬM hơn ở đầu mỗi tháng (trừ tháng đầu) — vẽ SAU lưới tuần để nổi lên trên */}
      {monthCols.slice(1).map((mc, k) => (
        <div key={k} style={{ position: "absolute", top: 0, height: h, left: pct(colX(mc.start)), width: 1, background: GC.monthLine, zIndex: 1 }} />
      ))}
      {/* NGÀY HIỆN HÀNH = CỘT TUẦN chứa hôm nay: tô ĐỎ NHẠT cả ô (băng #fca5a5, dưới thanh).
          BỎ vạch đỏ mảnh (#dc2626) theo yêu cầu — CHỈ giữ băng. */}
      {weekInWindow && (
        <div title="Tuần hiện hành" style={{ position: "absolute", top: 0, height: h, left: pct(colX(todayCol)), width: pct(colW), background: "#fca5a5", zIndex: 1 }} />
      )}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      {/* Legend dùng ĐÚNG màu GC như thanh (inline style) → chú thích luôn khớp biểu đồ. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[10.5px] text-slate-600 print:hidden">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-6 rounded-sm" style={{ background: GC.bar }} />Tiến độ (Bắt đầu→Kết thúc)</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-6 rounded-sm" style={{ background: GC.done }} />% đã hoàn thành (theo cột % Thực tế)</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-[1px]" style={{ background: GC.sx, border: "1px solid #0f172a" }} />Nhà máy sản xuất (SX)</span>
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
                <td className="relative border-b border-r border-slate-100 p-0" style={{ height: ROW_H, background: bg }}>
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
                  {!flatStages && sxSpan && Array.from({ length: sxSpan.ei - sxSpan.si + 1 }, (_, k) => {
                    const i = sxSpan.si + k;
                    return (
                      <div key={i} title="Nhà máy sản xuất (SX)" style={{ position: "absolute", left: pct(colX(i) + colW / 2), top: "50%",
                        width: 10, height: 10, transform: "translate(-50%,-50%)", background: GC.sx, border: "1px solid #0f172a", borderRadius: 1, zIndex: 3 }} />
                    );
                  })}
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
                      <td className="relative border-b border-r border-slate-100 p-0" style={{ height: 28, background: cbg }}>
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

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-teal-600 focus:outline-none">
      {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
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
function ReportsMenu({ showCompliance, complianceBadge, onOpenCompliance, isAdmin, onOpenActivity, onOpenRoles, tvMode, onToggleTv }: {
  showCompliance: boolean;
  complianceBadge: number;
  onOpenCompliance: () => void;
  isAdmin: boolean;
  onOpenActivity: () => void;
  onOpenRoles: () => void;
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

  const items: { icon: ReactNode; label: string; badge?: number; active?: boolean; onClick: () => void }[] = [];
  if (showCompliance) items.push({ icon: <ClipboardCheck className="h-4 w-4 text-slate-500" />, label: "Đánh giá tuân thủ", badge: complianceBadge, onClick: onOpenCompliance });
  if (isAdmin) items.push({ icon: <ScrollText className="h-4 w-4 text-indigo-500" />, label: "Nhật ký giám sát", onClick: onOpenActivity });
  if (isAdmin) items.push({ icon: <Users className="h-4 w-4 text-teal-600" />, label: "Phân cấp người dùng", onClick: onOpenRoles });
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
                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white"
                      title={`${it.badge} dự án chưa cập nhật đúng hạn tuần này`}>{it.badge}</span>
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

function fmtDateVN(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

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

// keep otherwise-unused imports anchored so tree-shaking warnings stay quiet
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _RN = ReactNode;

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
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>(ALL_ROLES[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (mail: string, r: UserRole | null) => {
    const e = mail.trim().toLowerCase();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 print:hidden" onClick={onClose}>
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
                onKeyDown={(e) => { if (e.key === "Enter" && email.trim()) void save(email, role); }}
                className="min-w-[210px] flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-[12px] focus:border-teal-600 focus:outline-none" />
              <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[12px]">
                {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_META[r].short} — {ROLE_META[r].label}</option>)}
              </select>
              <button type="button" disabled={busy || !email.trim()} onClick={() => void save(email, role)}
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
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [who, setWho] = useState<string>("");    // "" = tất cả mọi người (lọc ở CLIENT để dropdown phân lớp)
  const [days, setDays] = useState<number>(7);     // 0 = toàn bộ
  const [q, setQ] = useState<string>("");          // ô tìm kiếm tự do (client-side)
  const [actionF, setActionF] = useState<string>(""); // "" = mọi loại thao tác
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Mốc "kể từ" theo NỬA ĐÊM ĐỊA PHƯƠNG (không phải 24h trượt): "Hôm nay" = từ 00:00 hôm nay;
  // "7/30 ngày" = 7/30 ngày dương lịch TÍNH CẢ hôm nay. Sửa lỗi "Hôm nay" lọt sang ngày hôm trước.
  const sinceMs = useMemo(() => {
    if (days <= 0) return null;
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return d.getTime() - (days - 1) * 86_400_000;
  }, [days]);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      // Tải RỘNG theo CỬA SỔ NGÀY cho MỌI người (KHÔNG lọc theo người ở server) → client mới đủ dữ
      // liệu để dựng dropdown "Người" PHÂN LỚP (chỉ tài khoản có hoạt động trong cửa sổ đang chọn).
      // Lọc theo Người/Thao tác/Tìm đều làm ở client bên dưới.
      const since = sinceMs != null ? new Date(sinceMs).toISOString() : null;
      const r = await fetchActivityLog({ data: { email: null, since, limit: 2000, devAs: devAs() } });
      if (!r.ok) { setErr("Bạn không có quyền xem nhật ký này."); setRows([]); return; }
      setRows(r.rows);
    } catch (e) {
      setErr((e as Error).message || "Không tải được nhật ký.");
    } finally {
      setLoading(false);
    }
  }, [sinceMs]);
  useEffect(() => { void load(); }, [load]);

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

  // LỌC / TÌM KIẾM phía client trên tập đã tải (server đã lọc theo Người + khoảng thời gian).
  // Bỏ dấu tiếng Việt để gõ "tien" vẫn ra "Tiên"; quét cả tài khoản, nhãn thao tác lẫn chi tiết.
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
  // ── OPTIONS PHÂN LỚP (cascading) — "vũ trụ" = rows đã lọc CỬA SỔ NGÀY, áp nốt các lọc KHÁC (trừ
  //    chính filter đang dựng options). Vd chọn "Hôm nay" → dropdown Người chỉ liệt kê tài khoản CÓ
  //    hoạt động hôm nay. Luôn GIỮ giá trị đang chọn để select không nhảy giá trị lạ. ──
  const passSearch = useCallback((r: ActivityRow, nq: string) =>
    !nq || norm(`${r.email} ${actionLabel(r.action)} ${r.detail || ""}`).includes(nq), []);

  const whoOpts = useMemo(() => {
    const nq = norm(q.trim());
    const s = new Set<string>();
    if (who) s.add(who);                                        // giữ người đang chọn
    for (const r of rows) {
      if (actionF && r.action !== actionF) continue;            // áp lọc Thao tác (trừ Người)
      if (!passSearch(r, nq)) continue;
      if (r.email) s.add(r.email);
    }
    return [...s].sort((a, b) => a.localeCompare(b, "vi"));
  }, [rows, actionF, q, who, passSearch]);

  const actionOpts = useMemo(() => {
    const nq = norm(q.trim());
    const w = who.trim().toLowerCase();
    const s = new Set<string>();
    if (actionF) s.add(actionF);                                // giữ thao tác đang chọn
    for (const r of rows) {
      if (w && (r.email || "").toLowerCase() !== w) continue;   // áp lọc Người (trừ Thao tác)
      if (!passSearch(r, nq)) continue;
      s.add(r.action);
    }
    return [...s];
  }, [rows, who, q, actionF, passSearch]);
  const filtered = useMemo(() => {
    const nq = norm(q.trim());
    const w = who.trim().toLowerCase();
    // LỌC ĐA LỚP: mọi điều kiện phải THOẢ ĐỒNG THỜI (AND) — Ngày ∧ Người ∧ Thao tác ∧ Tìm kiếm.
    return rows.filter((r) => {
      if (sinceMs != null) { const t = new Date(r.ts).getTime(); if (isNaN(t) || t < sinceMs) return false; }
      if (w && (r.email || "").toLowerCase() !== w) return false;
      if (actionF && r.action !== actionF) return false;
      if (nq && !norm(`${r.email} ${actionLabel(r.action)} ${r.detail || ""}`).includes(nq)) return false;
      return true;
    });
  }, [rows, q, actionF, who, sinceMs]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 print:hidden" onClick={onClose}>
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
          <button onClick={() => void load()} disabled={loading}
            className="ml-auto flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-indigo-400 disabled:opacity-50">
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
                {filtered.length === rows.length
                  ? `${rows.length} lượt gần nhất (mới nhất trên cùng)`
                  : `${filtered.length}/${rows.length} lượt khớp (mới nhất trên cùng)`}
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
  if (m === "o") return <span className="text-[11px] font-bold text-amber-500" title="Cập nhật trễ">o</span>;
  if (m === "x") return <span className="text-[13px] font-bold leading-none text-red-600" title="Không cập nhật">✕</span>;
  return <span className="text-[10px] text-slate-200" title="Chưa có dữ liệu tuần này">–</span>;
}

function ComplianceDialog({ data, loading, error, regionByName, today, onRetry, onClose }: {
  data: ComplianceFileData | undefined; loading: boolean; error: Error | null;
  regionByName: Map<string, string>; today: string; onRetry: () => void; onClose: () => void;
}) {
  // VÙNG của 1 dòng = tra từ PMP theo tên (KHÔNG lấy cột Location file tuân thủ). Không khớp → "—".
  const vungOf = (r: ComplianceFileRow) => regionByName.get(normProjName(r.name)) ?? "—";
  const [sortDir, setSortDir] = useState<"desc" | "asc">("asc"); // mặc định THẤP → CAO (PM điểm thấp/cần chú ý lên đầu)
  const [vungSel, setVungSel] = useState<string[]>([]);
  const scoreLabel = (s: number | null) => (s == null ? "—" : String(s));
  // ── ĐIỂM (dự án & TB PM): IN ĐẬM cho NỔI BẬT; < 50 (chưa đạt) → ĐỎ, còn lại → ĐEN. Theo mẫu báo
  //    cáo tuân thủ (bỏ thang xanh/vàng nhiều màu — chỉ đen/đỏ cho gọn, điểm là thông tin chính). ──
  const scoreTone = (s: number | null) => (s == null ? "text-slate-400" : s < 50 ? "text-red-600" : "text-slate-900");
  // NGÀY CẬP NHẬT: KHÔNG tô nền (bớt sặc sỡ) — chữ trơn, chỉ NHUỐM ĐỎ khi QUÁ CŨ (>21 ngày) như
  // một cờ ngoại lệ. File ghi "dd/mm" → ghép năm của tháng chấm (mon > tháng chấm ⇒ năm trước).
  const tToday = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const repYear = data?.monthLabel ? +data.monthLabel.slice(3) : +today.slice(0, 4);
  const repMon = data?.monthLabel ? +data.monthLabel.slice(0, 2) : +today.slice(5, 7);
  // NGÀY CẬP NHẬT — COLOR SCALE liên tục XANH LÁ (gần hôm nay) → ĐỎ (xa hôm nay). d=0 xanh 120°,
  // d≥30 ngày đỏ 0°. Nền nhạt + chữ đậm cùng hue.
  const recencyStyle = (ddmm: string | null | undefined): CSSProperties => {
    const m = (ddmm ?? "").match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!m) return { color: "#cbd5e1" };
    const t = Date.UTC(+m[2] > repMon ? repYear - 1 : repYear, +m[2] - 1, +m[1]);
    const d = Math.max(0, Math.round((tToday - t) / 86400000));
    const hue = Math.round(120 * (1 - Math.min(30, d) / 30));
    // Cú pháp PHẨY (hsl(H, S%, L%)) — cú pháp CÁCH (hsl(H S% L%)) làm html2canvas-pro (xuất PDF)
    // parse lỗi "unexpected EOF" vì đọc thẳng giá trị inline. Phẩy thì cả trình duyệt lẫn PDF đều hiểu.
    return { background: `hsl(${hue}, 75%, 88%)`, color: `hsl(${hue}, 55%, 26%)` };
  };

  // Tuần CÓ DỮ LIỆU mới nhất = tuần đã CHỐT gần nhất → dùng đếm "không cập nhật tuần này".
  const lastDataIdx = useMemo(() => {
    if (!data) return -1;
    for (let j = data.weeks.length - 1; j >= 0; j--) if (data.rows.some(r => r.marks[j] != null)) return j;
    return -1;
  }, [data]);
  // TUẦN HIỆN HÀNH (để TÔ MÀU cột) = theo LỊCH: cột tuần đầu tiên có ngày ≥ HÔM NAY (vd hôm nay
  // 28/07 → tô 29/07, không phải 22/07); nếu hôm nay đã qua hết mốc → cột cuối.
  const curWeekIdx = useMemo(() => {
    if (!data || !data.weeks.length) return -1;
    const toTs = (w: string) => { const m = w.match(/^(\d{1,2})\/(\d{1,2})$/); return m ? Date.UTC(+m[2] > repMon ? repYear - 1 : repYear, +m[2] - 1, +m[1]) : null; };
    for (let j = 0; j < data.weeks.length; j++) { const t = toTs(data.weeks[j]); if (t != null && t >= tToday) return j; }
    return data.weeks.length - 1;
  }, [data, tToday, repYear, repMon]);
  // SỐ LẦN PHẢI CẬP NHẬT tính đến HÔM NAY = số cột tuần (tháng chấm) có ngày ≤ hôm nay → MAX cho
  // data bar "số lần không cập nhật" (bar = countX / maxRequired).
  const maxRequired = useMemo(() => {
    if (!data) return 0;
    let n = 0;
    for (const w of data.weeks) { const m = w.match(/^(\d{1,2})\/(\d{1,2})$/); if (m && Date.UTC(+m[2] > repMon ? repYear - 1 : repYear, +m[2] - 1, +m[1]) <= tToday) n++; }
    return n;
  }, [data, tToday, repYear, repMon]);
  const vungOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of data?.rows ?? []) { const v = regionByName.get(normProjName(r.name)); if (v) s.add(v); }
    return [...s].sort((a, b) => a.localeCompare(b, "vi")).map(v => ({ v, l: v }));
  }, [data, regionByName]);

  const pmAvg = useMemo(() => (data ? pmAverages(data.rows) : new Map<string, number | null>()), [data]);
  // GOM THEO PM (như cũ): mỗi nhóm PM 1 điểm TB; trong nhóm xếp theo số lần không cập nhật.
  const byPm = useMemo(() => {
    if (!data) return [] as { pm: string; pmScore: number | null; tongX: number; rs: ComplianceFileRow[] }[];
    const dir = sortDir === "desc" ? 1 : -1;
    const base = vungSel.length ? data.rows.filter(r => vungSel.includes(regionByName.get(normProjName(r.name)) ?? "—")) : data.rows;
    const m = new Map<string, ComplianceFileRow[]>();
    for (const r of base) { const k = r.pm || "—"; const a = m.get(k) ?? []; a.push(r); m.set(k, a); }
    // Trong nhóm: dự án sort theo ĐIỂM cùng CHIỀU với sort nhóm (desc=cao→thấp); null xuống cuối.
    const cmpScore = (a: ComplianceFileRow, b: ComplianceFileRow) => {
      const sa = a.score, sb = b.score;
      if (sa == null && sb == null) return a.name.localeCompare(b.name, "vi");
      if (sa == null) return 1;
      if (sb == null) return -1;
      return dir * (sb - sa) || a.name.localeCompare(b.name, "vi");
    };
    return [...m.entries()].map(([pm, rs]) => ({
      pm, pmScore: pmAvg.get(pm) ?? null,
      tongX: rs.reduce((a, r) => a + r.countX, 0),
      rs: [...rs].sort(cmpScore),
    })).sort((a, b) => {
      // Xếp theo ĐIỂM TB PM (null = chưa đủ dữ liệu → luôn xuống cuối). desc = cao→thấp.
      const sa = a.pmScore, sb = b.pmScore;
      if (sa == null && sb == null) return a.pm.localeCompare(b.pm, "vi");
      if (sa == null) return 1;
      if (sb == null) return -1;
      return dir * (sb - sa) || a.pm.localeCompare(b.pm, "vi");
    });
  }, [data, sortDir, vungSel, regionByName, pmAvg]);

  const tongDuAn = data?.rows.length ?? 0;
  // SỐ DỰ ÁN KHÔNG CẬP NHẬT TUẦN NÀY = ô "x" của tuần ĐÃ CHỐT gần nhất (tuần hiện hành theo lịch
  // có thể chưa điền → dùng tuần có dữ liệu mới nhất cho con số có nghĩa).
  const khongCNTuanNay = lastDataIdx >= 0 ? (data?.rows.filter(r => r.marks[lastDataIdx] === "x").length ?? 0) : 0;

  /** XUẤT PDF bảng tuân thủ = chụp ĐÚNG bảng đang xem (đã sort/lọc Vùng) + khối tiêu đề, dựng A4
   *  ngang qua exportDashboardPdf (dùng chung engine với bảng Danh sách). wide=true vì bảng rộng
   *  (nhiều cột tuần) → giữ bề rộng thật rồi thu tỉ lệ cho vừa giấy. */
  const tableRef = useRef<HTMLTableElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const doExportPdf = async () => {
    if (exporting || !tableRef.current) return;
    setExporting(true);
    const tid = toast.loading("Đang tạo PDF bảng tuân thủ…", { position: "bottom-left" });
    // onclone của pdf-export XOÁ mọi phần tử "print:hidden" khỏi ảnh chụp (để bỏ nút/điều khiển).
    // NHƯNG ROOT dialog này cũng mang "print:hidden" (chặn Ctrl+P in modal) ⇒ sẽ bị xoá LUÔN cả
    // dialog + bảng cần chụp → html2canvas lỗi "unexpected EOF". Tạm gỡ "print:hidden" ở các TỔ TIÊN
    // của bảng trước khi chụp rồi trả lại — nút print:hidden BÊN TRONG vẫn bị onclone loại như thường.
    const stripped: HTMLElement[] = [];
    for (let el: HTMLElement | null = tableRef.current; el; el = el.parentElement) {
      if (el.classList.contains("print:hidden")) { el.classList.remove("print:hidden"); stripped.push(el); }
    }
    try {
      const { exportDashboardPdf } = await import("@/lib/pdf-export");
      const pages = await exportDashboardPdf({
        blocks: headerRef.current ? [headerRef.current] : [],
        table: tableRef.current,
        wide: true,
        fileName: `DanhGiaTuanThu_MP_${(data?.monthLabel ?? today).replace(/[/-]/g, "")}.pdf`,
      });
      track("export_pdf", `Đánh giá tuân thủ MP${data?.monthLabel ? ` tháng ${data.monthLabel}` : ""} · ${tongDuAn} dự án`.slice(0, 300));
      toast.success(`Đã tạo PDF bảng tuân thủ (${pages} trang)`);
    } catch (e) {
      toast.error(`Tạo PDF lỗi: ${(e as Error).message}`);
    } finally {
      stripped.forEach((el) => el.classList.add("print:hidden"));
      toast.dismiss(tid);
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 print:hidden" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <div>
            {/* headerRef = KHỐI TIÊU ĐỀ vẽ vào đầu PDF (không gồm nút/điều khiển tương tác). */}
            <div ref={headerRef}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-teal-700">Bộ phận Project Planning</div>
              <div className="text-sm font-bold text-slate-900">ĐÁNH GIÁ TUÂN THỦ CẬP NHẬT MASTER PLAN{data?.monthLabel ? ` THÁNG ${data.monthLabel}` : ""}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
                <span>Tổng dự án: <b className="tabular-nums text-slate-900">{tongDuAn}</b></span>
                <span>Số dự án không cập nhật tuần này: <b className="tabular-nums text-red-600">{khongCNTuanNay}</b></span>
              </div>
              {/* Chú thích cách tính điểm + KÝ HIỆU — DÀN 1 HÀNG: điểm dự án · điểm PM · BẢNG chú thích
                  (bên phải). Đặt trong headerRef nên hiện cả khi XUẤT PDF. */}
              <div className="mt-2 flex flex-wrap items-stretch justify-between gap-x-6 gap-y-3 text-[10px] leading-relaxed text-slate-600">
                <div className="flex flex-col">
                  <div className="font-semibold text-slate-700">Cách tính điểm tuân thủ dự án:</div>
                  <div className="whitespace-nowrap">(1) Khởi điểm <b className="text-slate-800">100 điểm/tháng</b>.</div>
                  <div className="whitespace-nowrap">(2) Không cập nhật (sau 12h thứ 5 hằng tuần): <b className="text-red-600">−{SCORING.deduct.missed} điểm</b>.</div>
                  <div className="whitespace-nowrap">(3) Cập nhật trễ (từ 22h thứ 4 – 12h thứ 5 hằng tuần): <b className="text-amber-600">−{SCORING.deduct.late} điểm</b>.</div>
                </div>
                <div className="flex flex-col">
                  <div className="font-semibold text-slate-700">Cách tính điểm tuân thủ PM:</div>
                  <div className="flex flex-1 items-center gap-2">
                    <span className="whitespace-nowrap">Điểm PM =</span>
                    <span className="inline-flex flex-col text-center leading-snug">
                      <span className="whitespace-nowrap border-b border-slate-500 px-1 pb-1">Tổng điểm tuân thủ các dự án PM quản lý</span>
                      <span className="whitespace-nowrap px-1 pt-1">Tổng số lượng dự án PM quản lý</span>
                    </span>
                  </div>
                </div>
                <div className="flex flex-col">
                  <div className="mb-1 font-semibold text-slate-700">Chú thích:</div>
                  <div className="flex flex-1 items-center">
                    <div className="overflow-hidden rounded-md border border-slate-300">
                      <table className="border-collapse text-[10px] leading-tight [&_td]:border-slate-200">
                        <tbody>
                          <tr><td className="border-b border-r px-2 py-0.5 text-center font-bold text-emerald-500">✓</td><td className="whitespace-nowrap border-b px-2 py-0.5">Cập nhật đúng hạn</td></tr>
                          <tr><td className="border-b border-r px-2 py-0.5 text-center font-bold text-amber-500">o</td><td className="whitespace-nowrap border-b px-2 py-0.5">Cập nhật trễ</td></tr>
                          <tr><td className="border-r px-2 py-0.5 text-center font-bold text-red-600">✕</td><td className="whitespace-nowrap px-2 py-0.5">Không cập nhật</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] leading-relaxed text-slate-500">
              <span className="inline-flex items-center gap-1">
                <span className="text-slate-400">Xếp theo điểm TB PM:</span>
                <button onClick={() => setSortDir("desc")} className={`rounded px-1.5 py-0.5 font-semibold ${sortDir === "desc" ? "bg-teal-700 text-white" : "border border-slate-300 text-slate-600 hover:border-teal-500"}`}>Cao → thấp</button>
                <button onClick={() => setSortDir("asc")} className={`rounded px-1.5 py-0.5 font-semibold ${sortDir === "asc" ? "bg-teal-700 text-white" : "border border-slate-300 text-slate-600 hover:border-teal-500"}`}>Thấp → cao</button>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="text-slate-400">Vùng:</span>
                <MultiSelect label="Vùng" selected={vungSel} options={vungOptions} onToggle={v => setVungSel(s => toggleIn(s, v))} onClear={() => setVungSel([])} />
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 print:hidden">
            <button onClick={() => void doExportPdf()} disabled={exporting || loading || !!error || !data || !byPm.length}
              title="Xuất bảng tuân thủ ra PDF (A4 ngang, đúng như đang xem)"
              className="flex items-center gap-1.5 rounded-md bg-teal-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-teal-800 disabled:opacity-40">
              {exporting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />} Xuất PDF
            </button>
            <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
          </div>
        </div>

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
          <table ref={tableRef} className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 z-20 text-white">
              <tr>
                <th className="sticky top-0 border-r border-slate-600 bg-[#1e293b] px-2 py-1.5 text-center font-semibold whitespace-nowrap" title="Điểm PM = trung bình cộng điểm các dự án PM quản">Điểm PM</th>
                <th className="sticky top-0 border-r border-slate-600 bg-[#1e293b] px-2 py-1.5 text-left font-semibold whitespace-nowrap">Người phụ trách</th>
                <th className="sticky top-0 border-r border-slate-600 bg-[#1e293b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">Vùng</th>
                <th className="sticky top-0 border-r border-slate-600 bg-[#1e293b] px-2 py-1.5 text-left font-semibold">Tên dự án</th>
                <th className="sticky top-0 border-r border-slate-600 bg-[#1e293b] px-2 py-1.5 text-center font-semibold whitespace-nowrap" title="Điểm tuân thủ 0–100 (100 − 25·không cập nhật − 10·trễ)">Điểm<br />dự án</th>
                <th className="sticky top-0 border-r border-slate-600 bg-[#1e293b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">Số lần<br />không cập nhật</th>
                <th className="sticky top-0 border-r border-slate-600 bg-[#1e293b] px-2 py-1.5 text-center font-semibold whitespace-nowrap">Cập nhật<br />gần nhất</th>
                {data.weeks.map((w, wi) => (
                  <th key={w} className={`sticky top-0 border-r px-1 py-1.5 text-center font-semibold whitespace-nowrap text-white ${wi === curWeekIdx ? "border-emerald-800" : "border-slate-600 bg-[#1e293b]"}`}
                      style={wi === curWeekIdx ? { background: "#00B050" } : undefined}
                      title={wi === curWeekIdx ? `Tuần hiện hành — cập nhật tới đây: ${w}` : `Tuần ${w}`}>{w}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byPm.map(({ pm, pmScore, rs }) => (
                rs.map((r, i) => (
                  <tr key={`${pm}-${r.stt}-${i}`} className="border-b border-slate-100 hover:bg-teal-50/40">
                    {i === 0 && (
                      <>
                        <td rowSpan={rs.length} className="border-r border-slate-100 px-2 py-1 text-center align-top">
                          <span className={`text-[13px] font-extrabold tabular-nums ${scoreTone(pmScore)}`} title="Điểm PM = trung bình cộng điểm các dự án PM quản">{scoreLabel(pmScore)}</span>
                        </td>
                        <td rowSpan={rs.length} className="border-r border-slate-100 px-2 py-1 align-top font-medium text-slate-800">
                          <span className="line-clamp-2 leading-tight" title={pm}>{pm || "—"}</span>
                        </td>
                      </>
                    )}
                    <td className="border-r border-slate-100 px-2 py-1 text-center text-slate-600 whitespace-nowrap">{vungOf(r)}</td>
                    <td className="border-r border-slate-100 px-2 py-1 text-slate-700"><div className="line-clamp-1" title={r.name}>{r.name}</div></td>
                    <td className="border-r border-slate-100 px-2 py-1 text-center">
                      <span className={`text-[13px] font-extrabold tabular-nums ${scoreTone(r.score)}`} title={r.score == null ? "Chưa có dữ liệu tháng này" : `Điểm tuân thủ = ${r.score} (x${r.countX}·−25, o${r.countO}·−10)`}>{scoreLabel(r.score)}</span>
                    </td>
                    {/* SỐ LẦN KHÔNG CẬP NHẬT + DATA BAR (0 → maxRequired = số lần phải cập nhật tới hôm nay). */}
                    <td className="border-r border-slate-100 px-2 py-1">
                      <div className="relative mx-auto flex h-4 max-w-[64px] items-center overflow-hidden rounded" title={`${r.countX}/${maxRequired} lần phải cập nhật tính đến hôm nay`}>
                        {maxRequired > 0 && r.countX > 0 && (
                          <div className="absolute inset-y-0 left-0 rounded bg-red-300" style={{ width: `${Math.min(100, r.countX / maxRequired * 100)}%` }} />
                        )}
                        <span className="relative z-[1] mx-auto tabular-nums font-semibold text-red-700">{r.countX > 0 ? r.countX : <span className="font-normal text-slate-400">0</span>}</span>
                      </div>
                    </td>
                    {/* CẬP NHẬT GẦN NHẤT + COLOR SCALE xanh lá (gần) → đỏ (xa). */}
                    <td className="border-r border-slate-100 px-2 py-1 text-center whitespace-nowrap">
                      <span className="inline-block rounded px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums" style={recencyStyle(r.lastUpdate)}>{r.lastUpdate ?? "—"}</span>
                    </td>
                    {r.marks.map((m, j) => (
                      <td key={j} className="border-r border-slate-100 px-1 py-1 text-center"><ComplianceMark m={m} /></td>
                    ))}
                  </tr>
                ))
              ))}
            </tbody>
          </table>
          )}
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 print:hidden" onClick={onClose}>
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
