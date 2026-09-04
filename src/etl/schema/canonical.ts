/**
 * ETL · schema — CANONICAL DATA MODEL dùng chung toàn app. Mọi module đọc model này, không đọc ô raw.
 * Mỗi record CANON giữ LINEAGE (source_file/sheet/row) để truy ngược về nguồn — nền cho AI có evidence.
 */

export type CanonicalType = "string" | "number" | "date" | "percent" | "currency" | "enum" | "id";

/** Định nghĩa 1 field trong canonical schema (dùng cho Data Dictionary + validation + mapping). */
export type FieldDef = {
  field: string;               // tên canonical, vd "work_item_id"
  label: string;               // nhãn người đọc
  type: CanonicalType;
  required?: boolean;
  enumValues?: string[];       // với type=enum
  description?: string;
};

/** Lineage: mỗi giá trị/record truy về đâu. */
export type Lineage = {
  source_file_id: string;      // id file nguồn (Drive/upload)
  source_file_name?: string;
  source_sheet: string;
  source_row: number;          // số hàng (1-based) trong sheet
};

// ── ENTITY LÕI (liên kết bằng ID) ────────────────────────────────────────────
export type Project = { project_id: string; project_name: string; };
export type WorkPackage = { work_package_id: string; project_id: string; name: string; discipline?: string; };

/** WorkItem = đơn vị công việc chuẩn hoá (theo ví dụ TCLĐ trong blueprint). */
export type WorkItem = {
  work_item_id: string;
  work_item_name: string;
  project_id: string;
  work_package_id?: string;
  discipline?: string;         // INSTALLATION / PRODUCTION / …
  location?: string;
  planned_start?: string;      // ISO
  planned_finish?: string;
  actual_start?: string;
  actual_finish?: string;
  planned_quantity?: number;
  actual_quantity?: number;
  unit?: string;
  planned_manpower?: number;
  actual_manpower?: number;
  status?: WorkStatus;
  lineage: Lineage;
};

export type WorkStatus = "NOT_STARTED" | "IN_PROGRESS" | "DONE" | "BLOCKED" | "UNKNOWN";

/** Chuẩn hoá trạng thái đa ngôn ngữ/biến thể → enum. */
export const STATUS_SYNONYMS: Record<WorkStatus, string[]> = {
  NOT_STARTED: ["chưa bắt đầu", "chưa làm", "chưa thi công", "not started", "todo", "pending", "0%"],
  IN_PROGRESS: ["đang thi công", "đang làm", "đang sx", "đang sản xuất", "in progress", "doing", "wip"],
  DONE: ["hoàn thành", "đã xong", "xong", "done", "completed", "finished", "100%", "bàn giao"],
  BLOCKED: ["vướng", "vướng mắc", "blocked", "on hold", "tạm dừng", "dừng"],
  UNKNOWN: [],
};

export function normalizeStatus(raw: string): WorkStatus {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return "UNKNOWN";
  for (const [k, syns] of Object.entries(STATUS_SYNONYMS)) if (syns.some((x) => s.includes(x))) return k as WorkStatus;
  return "UNKNOWN";
}

// ── DATASET ENVELOPE (đơn vị trong Data Library) ─────────────────────────────
export type DataQuality = {
  score: number;               // 0..100 tổng hợp
  completeness: number; validity: number; uniqueness: number;
  missing: number; invalid: number; duplicates: number; unmappedCols: number;
};
export type Dataset = {
  id: string;
  name: string;
  domain: string;              // Construction / Schedule / …
  project_id?: string;
  data_type: string;          // TCLĐ / Manpower / …
  schema_version: string;
  created_at: string;
  source_file_id: string;
  source_file_name?: string;
  records: WorkItem[];
  quality: DataQuality;
  mapping: { raw: string; field: string; confidence: number }[];
};
