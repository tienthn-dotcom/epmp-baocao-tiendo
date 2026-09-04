/** ETL · normalization — áp mapping + kiểu template → WorkItem canonical (kèm lineage) + Data Quality. */
import { toNumber } from "@/etl/core/num";
import { toIsoDate } from "@/etl/core/dates";
import type { SheetProfile } from "@/etl/profiler/profiler";
import type { MappingSuggestion } from "@/etl/matcher/matcher";
import type { ImportTemplate } from "@/etl/schema/templates";
import { normalizeStatus, type WorkItem, type Lineage, type DataQuality } from "@/etl/schema/canonical";

export type NormalizeSource = { fileId: string; fileName?: string; projectId?: string };
export type NormalizeResult = { records: WorkItem[]; quality: DataQuality; issues: string[] };
const round1 = (n: number) => Math.round(n * 10) / 10;

export function normalize(
  rows: (string | number | null)[][], profile: SheetProfile, mapping: MappingSuggestion[],
  tpl: ImportTemplate, source: NormalizeSource,
): NormalizeResult {
  const fieldByRaw = new Map(mapping.filter((m) => m.field).map((m) => [m.rawIndex, m.field as string]));
  const typeByField = new Map(tpl.fields.map((f) => [f.field, f.type]));
  const records: WorkItem[] = [];
  let missing = 0, invalid = 0;

  for (let r = profile.dataStartRow; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (!row.some((v) => String(v ?? "").trim() !== "")) continue;    // bỏ hàng trống
    const lineage: Lineage = { source_file_id: source.fileId, source_file_name: source.fileName, source_sheet: profile.name, source_row: r + 1 };
    const item = { project_id: source.projectId ?? "", work_item_id: "", work_item_name: "", lineage } as WorkItem & Record<string, unknown>;
    for (const [rawIdx, field] of fieldByRaw) {
      const raw = String(row[rawIdx] ?? "").trim();
      if (raw === "") continue;
      const t = typeByField.get(field);
      if (t === "number" || t === "currency") { const n = toNumber(raw); if (n == null) invalid++; else item[field] = n; }
      else if (t === "percent") { const n = toNumber(raw); if (n != null) item[field] = n; }
      else if (t === "date") { const d = toIsoDate(raw); if (d.iso) item[field] = d.iso; else invalid++; }
      else if (field === "status") item.status = normalizeStatus(raw);
      else item[field] = raw;
    }
    if (!item.work_item_id) item.work_item_id = `${profile.name}#${r + 1}`;    // sinh id nếu nguồn thiếu
    if (!item.work_item_name) { missing++; item.work_item_name = "(chưa có tên)"; }
    records.push(item);
  }

  const total = records.length || 1;
  const requiredFields = tpl.fields.filter((f) => f.required).map((f) => f.field);
  const mappedFields = new Set(mapping.filter((m) => m.field).map((m) => m.field));
  const missingRequired = requiredFields.filter((f) => !mappedFields.has(f)).length;
  const unmappedCols = mapping.filter((m) => !m.field).length;
  const completeness = round1(100 * (1 - missing / total));
  const validity = round1(100 * (1 - invalid / total));
  const seen = new Set<string>(); let dup = 0;
  for (const it of records) { if (seen.has(it.work_item_id)) dup++; else seen.add(it.work_item_id); }
  const uniqueness = round1(100 * (1 - dup / total));
  const score = Math.max(0, Math.min(100, round1(completeness * 0.4 + validity * 0.35 + uniqueness * 0.25 - missingRequired * 10 - unmappedCols * 1.5)));
  const quality: DataQuality = { score, completeness, validity, uniqueness, missing, invalid, duplicates: dup, unmappedCols };

  const issues: string[] = [];
  if (missingRequired) issues.push(`${missingRequired} field bắt buộc chưa map`);
  if (unmappedCols) issues.push(`${unmappedCols} cột chưa nhận diện`);
  if (invalid) issues.push(`${invalid} giá trị sai kiểu`);
  return { records, quality, issues };
}
