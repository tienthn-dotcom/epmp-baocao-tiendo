export type StageKey =
  | "Phát hành thiết kế"
  | "Trình duyệt mẫu"
  | "LOA/Tạm ứng"
  | "Đặt vật tư"
  | "Triển khai sản xuất"
  | "Sản xuất nhập kho"
  | "Thi công lắp đặt";

/** Chi tiết "số mã / tổng mã" đứng sau một GIAI ĐOẠN, đọc từ khối breakdown ở cột
 *  sau Vướng mắc trong file gốc (vd Mẫu 88/159, VT.CT 0/96). Một giai đoạn có thể có
 *  nhiều dòng (Đặt vật tư = VT.CT + VT.NM). done null = ô để trống (coi như 0). */
export type CodeCount = {
  /** Nhãn gốc trong sheet: "Mẫu", "VT.CT", "VT.NM", "TKSX", "Kho"… */
  label: string;
  /** Số mã đã làm (col done). null nếu ô để trống. */
  done: number | null;
  /** Tổng số mã (col total). Luôn > 0 (dòng total trống/0 đã bị bỏ khi parse). */
  total: number;
};

/** Số bàn giao (tinh/thô) của 1 Block — done/total/pct. Đọc từ khối cột sau Vướng mắc.
 *  Chỉ có khi file điền số (dự án để nhãn "Lobby…" ở đó ⇒ undefined). */
export type BlockHandover = { done: number | null; total: number | null; pct: number | null };

/** Một khu thành phần khi % Block = TRUNG BÌNH tiến độ các khu (dự án kiểu Public). */
export type BlockArea = { label: string; pct: number | null };

/** Dòng con "Thi công lắp đặt" (Block 1..5) — Mã dạng TC1..TCn trong file. Đính vào item
 *  giai đoạn "Thi công lắp đặt" (không phải giai đoạn riêng). pctActual = % thực tế Block.
 *  Ý NGHĨA của % KHÁC NHAU theo dự án (đọc từ file):
 *   • kind="tho": % thực tế = % ĐÃ GIAO THÔ; kèm số bàn giao thô + tinh (căn).
 *   • kind="avg": % thực tế = TRUNG BÌNH tiến độ các khu (components); đọc từ công thức AVERAGE.
 *   • kind="plain": chỉ có % (không rõ chi tiết). */
export type BlockChild = {
  code: string;              // TC1
  label: string;             // Block 1 (86 căn) / Block 1 (Lobby + Res…)
  pctActual: number | null;  // % thực tế Block (thang 0..100)
  kind: "tho" | "avg" | "plain";
  tho?: BlockHandover;       // ĐÃ GIAO THÔ (kind=tho) — done/total = số căn
  tinh?: BlockHandover;      // ĐÃ GIAO TINH (kind=tho)
  areas?: BlockArea[];       // các khu (kind=avg) — nhãn + % từng khu
};

export type ItemRow = {
  projectCode: string; // CT26-013
  projectName: string;
  cdt: string;
  maCT: string;
  /** Vùng/khu vực — cột "Location" (cột C) trong file nguồn. Dùng cho bộ lọc Vùng.
   *  Optional để tương thích cache/demo/snapshot cũ. */
  region?: string;
  /** Cụm dự án — cột "Group DA" trong nguồn. Dùng cho bộ lọc "Cụm dự án". Optional. */
  groupDA?: string;
  /** Ngày update (ISO) — cột "Ngày update" trên dòng DỰ ÁN CHA trong Master Plan.
   *  Gắn theo dự án nên mọi đầu việc con dùng chung ngày này. Optional. */
  updateDate?: string | null;
  /** Dự án cha đã bàn giao xong (note dòng cha có "đã bàn giao/hoàn tất") → gỡ sạch
   *  cảnh báo của dòng con. Xem noteSaysDelivered() trong parser. Optional. */
  projectDelivered?: boolean;
  /** Số Top-20 (cột "Top 20" ngoài cùng trái, index 0) của dự án cha — 1..20.
   *  Nền tảng cho bộ lọc "Top dự án trọng điểm" + nhóm AM. null/undefined = không thuộc top. */
  rank?: number;
  projectDeadline: string | null; // ISO — ngày Kết thúc/Bàn giao CẤP DỰ ÁN (dòng cha)
  /** Ngày Bắt đầu CẤP DỰ ÁN (dòng cha) — để hàng gộp hiện y như file PMP. */
  projectStart: string | null; // ISO
  stage: StageKey | "Khác";
  rawCode: string; // L
  /** Số thứ tự lần xuất hiện (0-based) của cùng (projectCode+projectName+rawCode)
   *  trong 1 dự án — để tách các dòng TRÙNG mã giai đoạn (vd dự án 2 khu có 2 dòng "TK").
   *  Gán ở parser theo thứ tự dòng trong sheet (ổn định qua các lần sync). Dùng làm
   *  thành phần khoá ghi chú (itemKeyOf) thay cho desc/ngày (những thứ đổi theo tiến độ).
   *  Optional để tương thích cache/demo/snapshot cũ (coi như 0). */
  dupIdx?: number;
  desc: string;
  owner: string;
  start: string | null;    // ISO ngày Bắt đầu (col O)
  deadline: string | null; // ISO ngày Kết thúc (col P)
  pctPlanRaw: number | null;
  pctPlan: number | null;
  pctActual: number | null;
  pctPlanInvalid: boolean;
  pctActualInvalid: boolean;
  /** Dòng có cột Show = "show" không. allItems chứa CẢ dòng hide (để xuất Excel
   *  đủ giai đoạn) — UI đếm "task đang quản lý" phải lọc shown !== false.
   *  Optional để tương thích cache/demo cũ chưa có trường này (coi như shown). */
  shown?: boolean;
  /** Số ngày trễ deadline. null nếu không có Finish. Tính qua getDaysOverdue(). */
  overdueDays: number | null;
  note: string;
  tc2: boolean;
  budget: number | null;
  actualCost: number | null;
  contractValue: number | null;
  penaltyPerDay: number | null;
  /** Chi tiết số mã của giai đoạn (từ khối breakdown file gốc). undefined = không có
   *  chi tiết (PM nhập % chay, hoặc dự án chưa dùng breakdown). Xem [[CodeCount]]. */
  codeCounts?: CodeCount[];
  /** Dòng con Block 1..5 của giai đoạn "Thi công lắp đặt" (Mã TC1..TCn trong file). undefined
   *  = không có. Chỉ item stage "Thi công lắp đặt" mới mang. Xem [[BlockChild]]. */
  blocks?: BlockChild[];
};

export type ProjectRow = {
  code: string;
  name: string;
  cdt: string;
  maCT: string;
  start: string | null;
  deadline: string | null;
  /** PM dự án = dòng đầu của ô "Người phụ trách chính" trên dòng cấp dự án.
   *  Không tính các dòng bắt đầu bằng "DPM" (phó PM). */
  pm: string;
  /** Phó PM (nếu ô có dòng bắt đầu bằng "DPM"). */
  dpm: string;
  /** Cờ "Cần cập nhật MP" — ô cột "Cần cập nhật MP" trên dòng dự án cha khác rỗng.
   *  Optional để tương thích demo-data/snapshot cũ chưa có trường này. */
  needsMpUpdate?: boolean;
  /** Nội dung ghi chú/ô đã kích hoạt cờ needsMpUpdate — hiển thị làm "lý do". */
  mpReason?: string;
  /** Cụm dự án — cột "Group DA" trên dòng dự án cha. Dùng cho bộ lọc "Cụm dự án". */
  groupDA?: string;
  /** Ngày update (ISO) — cột "Ngày update" trên dòng dự án cha trong Master Plan. */
  updateDate?: string | null;
  /** Dự án ĐÃ BÀN GIAO XONG — ô Vướng mắc dòng cha có "đã bàn giao / đã hoàn tất".
   *  Hàng gộp hiện nền XANH LÁ, mọi cảnh báo của hạng mục con bị gỡ. */
  delivered?: boolean;
  /** Số Top-20 (cột "Top 20" ngoài cùng trái) của dự án — nền tảng lọc trọng điểm/AM. */
  rank?: number;
  items: ItemRow[];
  /** TẤT CẢ dòng giai đoạn trong file gốc (kể cả đã 100% hoàn thành).
   *  Dùng cho XUẤT EXCEL/IN — phải hiện đủ giai đoạn như gốc, không lọc. */
  allItems: ItemRow[];
};

/** Một hạng mục kiểm tra chất lượng dữ liệu đầu vào. */
export type DataQualityCheck = {
  id: string;
  level: "ok" | "warn" | "error";
  label: string;
  detail?: string;
};

/** Kết quả CỔNG KIỂM SOÁT DỮ LIỆU — chạy mỗi lần parse nguồn. */
export type DataQuality = {
  level: "ok" | "warn" | "error";
  checks: DataQualityCheck[];
  stats: {
    parentsTotal: number;   // tổng dòng dự án cha gặp trong file
    shownProjects: number;  // dự án Show có ≥1 dòng con
    activeItems: number;    // đầu việc đang làm (Show, <100%)
    allStageRows: number;   // tổng dòng giai đoạn đã nạp
  };
};

export type ReportData = {
  refDate: string;
  updatedAt?: string;
  projects: ProjectRow[];
  items: ItemRow[];
  source: "google" | "upload";
  sourceLabel?: string;
  /** ISO timestamp when this payload was fetched/parsed (data-freshness clock). */
  fetchedAt?: string;
  /** Kết quả cổng kiểm soát chất lượng dữ liệu đầu vào. */
  quality?: DataQuality;
  /** Map { maCT → fileId Summary } của ô "Thi công lắp đặt" đã hyperlink — đọc Ở CLIENT từ chính
   *  file xlsx đã tải (không parse trên Worker). Rỗng nếu nguồn CSV/cache/demo. */
  installLinks?: Record<string, string>;
};
