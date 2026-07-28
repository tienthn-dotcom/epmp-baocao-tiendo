/**
 * MTLĐ · "Tường Camera — Tiến độ Lắp đặt" — MÔ HÌNH DỮ LIỆU RIÊNG (tách hẳn Master Plan).
 * Input là MA TRẬN ĐỊNH LƯỢNG lắp đặt (mỗi dự án số cột/vật tư khác nhau), KHÔNG phải Timeline.
 * ⇒ types/lib/storage đi đường riêng, tuyệt đối không đụng ReportData/parser.ts của ePMP.
 * Xem brief: D:\AACORP\AA_DuAn\MTLĐ\BAN-GIAO-ePMP\BRIEF-TICH-HOP-ePMP.md (§4).
 */

export type Scope = "public" | "rooms" | "other";

/** 1 đơn vị hiển thị trên chart: 1 khu vực (Public) / 1 tầng-toà (Phòng) / 1 toà. */
export interface Unit {
  name: string;        // "RESTAURANT", "B2/L03", "Toà B4"
  scope: Scope;
  pctActual: number;   // % thực tế 0..1 — LẤY TỪ cột TỔNG của ma trận (tôn trọng số người nhập)
  plan?: number;       // % kế hoạch 0..1 — tính từ ngày (metadata cấp riêng)
  prev?: number;       // % hôm trước (từ snapshot ngày trước)
  start?: string;      // ISO — ngày bắt đầu (KHÔNG có trong ma trận, nạp riêng)
  deadline?: string;   // ISO — ngày bàn giao
}

/** Cờ chất lượng dữ liệu (từ reader). App CHỈ HIỆN, tuyệt đối không tự sửa/điền. */
export interface QualityFlag {
  id: string;
  level: "error" | "warn";
  count: number;
  label: string;
  samples: string[];
}

export interface Project {
  id: string;
  name: string;
  region: string;
  cam: string;
  segments: { public: Unit[]; rooms: Unit[]; other: Unit[] };
  quality: QualityFlag[];
}

export interface MonitorData {
  reportDate: string; // ISO
  regions: { code: string; name: string; projects: Project[] }[];
}

/* ─── Kiểu THÔ do reader trả về (trước khi map sang Unit/Project) ─────────────── */

export type RawLevel = "toa" | "khuvuc" | "tang" | "can";

/** 1 dòng ma trận đã phân cấp (bộ xương bất biến, không phụ thuộc cột vật tư). */
export interface RawUnit {
  toa: string;
  tang: string;
  can: string;
  level: RawLevel;
  isAgg: boolean;        // dòng tổng (tham chiếu dòng khác) hay lá
  pct: number | null;    // giá trị cột TỔNG (0..1); null = trống; "X" đã bị loại
  name: string;
  overridden: boolean;   // ô tổng gõ đè tay (không phải công thức)
  hasFormula: boolean;
}

/** Kết quả đọc 1 sheet ma trận. */
export type MatrixResult =
  | { ok: false; error: string }
  | {
      ok: true;
      header: number;       // dòng header (1-based)
      tongCol: string;      // cột TỔNG (ký tự cột Excel)
      goi: string;          // nhãn "Gói:"
      toaLabel: string;     // nhãn "Tòa:"
      units: RawUnit[];
      quality: QualityFlag[];
      qlevel: "error" | "warn" | "ok";
    };
