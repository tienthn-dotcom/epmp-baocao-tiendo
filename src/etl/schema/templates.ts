/**
 * ETL · templates — Import Template Library. Mỗi loại dữ liệu (TCLĐ, Manpower…) có 1 template versioned:
 * field bắt buộc/tuỳ chọn, kiểu, alias/synonym (VN/EN) để semantic matcher tự map cột.
 */
import type { CanonicalType } from "@/etl/schema/canonical";

export type FieldSpec = {
  field: string;               // canonical field
  label: string;
  type: CanonicalType;
  required?: boolean;
  aliases: string[];           // tên cột thô hay gặp (thường hoá lowercase) → matcher dùng
};

export type ImportTemplate = {
  id: string;
  name: string;
  version: string;
  domain: string;              // Construction / Schedule / …
  data_type: string;          // TCLĐ / Manpower / …
  fields: FieldSpec[];
};

/** Template TCLĐ (Thi công lắp đặt) — mẫu đầu tiên. Alias phủ VN/EN + viết tắt hay gặp. */
export const TEMPLATE_TCLD: ImportTemplate = {
  id: "tcld.v1",
  name: "TCLĐ — Thi công lắp đặt",
  version: "1.0",
  domain: "Construction",
  data_type: "TCLĐ",
  fields: [
    { field: "project_id", label: "Mã dự án / Công trình", type: "id", aliases: ["mã ct", "mã dự án", "mã công trình", "dự án", "công trình", "project", "project id", "mact"] },
    { field: "work_package_id", label: "Gói / Hạng mục lớn", type: "id", aliases: ["gói", "work package", "hạng mục lớn", "wbs", "nhóm"] },
    { field: "work_item_id", label: "Mã công việc", type: "id", aliases: ["mã công việc", "mã cv", "ma cong viec", "work item id", "id", "stt"] },
    { field: "work_item_name", label: "Tên công việc", type: "string", required: true, aliases: ["tên công việc", "tên cv", "mô tả", "hạng mục", "task", "work item", "công việc", "nội dung"] },
    { field: "discipline", label: "Hạng mục / Bộ môn", type: "string", aliases: ["hạng mục", "bộ môn", "công đoạn", "discipline", "mã", "loại"] },
    { field: "location", label: "Khu vực", type: "string", aliases: ["khu vực", "vị trí", "location", "area", "khu", "zone"] },
    { field: "planned_start", label: "Ngày bắt đầu (KH)", type: "date", aliases: ["ngày bắt đầu", "bắt đầu", "ngày ghi nhận", "planned start", "start", "start date"] },
    { field: "planned_finish", label: "Ngày kết thúc (KH)", type: "date", aliases: ["ngày kết thúc", "kết thúc", "deadline", "deadline cam kết", "planned finish", "finish", "due"] },
    { field: "actual_finish", label: "Ngày hoàn thành (TT)", type: "date", aliases: ["ngày hoàn thành", "hoàn thành thực tế", "actual finish", "ngày xong"] },
    { field: "planned_quantity", label: "Khối lượng (KH)", type: "number", aliases: ["khối lượng", "khối lượng tổng", "kl", "kl kế hoạch", "planned quantity", "khối lượng dự kiến"] },
    { field: "actual_quantity", label: "Khối lượng đã làm", type: "number", aliases: ["khối lượng đã làm", "kl thực hiện", "kl đã làm", "actual quantity", "đã làm"] },
    { field: "unit", label: "Đơn vị", type: "string", aliases: ["đơn vị", "đvt", "unit", "uom"] },
    { field: "planned_manpower", label: "Nhân lực (KH)", type: "number", aliases: ["nhân lực", "nhân công", "manpower", "số người", "crew"] },
    { field: "status", label: "Trạng thái", type: "enum", aliases: ["trạng thái", "tình trạng", "status", "% thực tế"] },
  ],
};

export const TEMPLATES: ImportTemplate[] = [TEMPLATE_TCLD];
export const getTemplate = (id: string) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATE_TCLD;
