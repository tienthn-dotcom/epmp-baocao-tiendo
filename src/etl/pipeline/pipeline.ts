/**
 * ETL · pipeline — orchestrator: (rows đã Extract) → Profile → Map → Normalize → Dataset canonical.
 * Thuần tất định, không LLM. UI/AI chỉ consume Dataset trả ra (single source of truth).
 */
import { profileSheet, type SheetProfile } from "@/etl/profiler/profiler";
import { suggestMapping, type MappingSuggestion } from "@/etl/matcher/matcher";
import { normalize, type NormalizeSource } from "@/etl/normalization/normalize";
import { getTemplate } from "@/etl/schema/templates";
import type { Dataset } from "@/etl/schema/canonical";

export type PipelineInput = {
  rows: (string | number | null)[][];
  templateId: string;
  source: NormalizeSource & { sheet: string };
  datasetName?: string;
  nowIso: string;                 // truyền từ ngoài (tất định, dễ test)
};
export type PipelineResult = { profile: SheetProfile; mapping: MappingSuggestion[]; dataset: Dataset };

export function runPipeline(input: PipelineInput): PipelineResult {
  const tpl = getTemplate(input.templateId);
  const profile = profileSheet(input.source.sheet, input.rows);
  const mapping = suggestMapping(profile.columns, tpl);
  const { records, quality } = normalize(input.rows, profile, mapping, tpl, input.source);
  const dataset: Dataset = {
    id: `${tpl.data_type}-${input.source.fileId.slice(0, 8)}-${input.nowIso.slice(0, 19)}`,
    name: input.datasetName ?? tpl.name,
    domain: tpl.domain,
    project_id: input.source.projectId,
    data_type: tpl.data_type,
    schema_version: tpl.version,
    created_at: input.nowIso,
    source_file_id: input.source.fileId,
    source_file_name: input.source.fileName,
    records,
    quality,
    mapping: mapping.filter((m) => m.field).map((m) => ({ raw: m.rawHeader, field: m.field as string, confidence: m.confidence })),
  };
  return { profile, mapping, dataset };
}
