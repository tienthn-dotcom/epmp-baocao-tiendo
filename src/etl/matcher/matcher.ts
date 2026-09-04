/**
 * ETL · matcher — Semantic mapping (tầng TẤT ĐỊNH): exact → normalized → alias → fuzzy + datatype,
 * kèm CONFIDENCE + lý do. Đây là tầng 1–2 (rẻ, không LLM) đủ xử ~80% cột. Cột confidence thấp → hỏi user.
 */
import type { ColumnProfile } from "@/etl/profiler/profiler";
import type { ImportTemplate } from "@/etl/schema/templates";
import type { CanonicalType } from "@/etl/schema/canonical";

export type MappingSuggestion = {
  rawIndex: number; rawHeader: string;
  field: string | null; confidence: number; reason: string[];
  alternatives: { field: string; confidence: number }[];
};
export const CONF_AUTO = 0.85;   // ≥ → auto-accept
export const CONF_ASK = 0.6;     // < → uncertain, hỏi user

const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();
const round = (n: number) => Math.round(n * 100) / 100;

function lev(a: string, b: string): number {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
const ratio = (a: string, b: string) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);

const COMPAT: Record<string, CanonicalType[]> = {
  number: ["number", "currency"], percent: ["percent", "number"], currency: ["currency", "number"],
  date: ["date"], id: ["id", "string"], text: ["string", "enum"], empty: [],
};
const typeOk = (colType: string, fieldType: CanonicalType) => (COMPAT[colType] ?? []).includes(fieldType);

/** Gợi ý mapping cho MỌI cột đã profile theo 1 template (đã xử lý xung đột 2 cột → cùng field). */
export function suggestMapping(columns: ColumnProfile[], tpl: ImportTemplate): MappingSuggestion[] {
  const out: MappingSuggestion[] = columns.map((col) => {
    const h = norm(col.header);
    const scored = tpl.fields.map((f) => {
      const targets = [norm(f.field), norm(f.label), ...f.aliases.map(norm)].filter(Boolean);
      let score = 0, why = "";
      if (h && targets.includes(h)) { score = 1; why = "khớp chính xác"; }
      else if (h && targets.some((t) => (h.includes(t) || t.includes(h)) && Math.min(h.length, t.length) >= 3)) { score = 0.9; why = "khớp alias"; }
      else if (h) { const r = Math.max(0, ...targets.map((t) => ratio(h, t))); if (r > 0.62) { score = r * 0.88; why = `gần đúng ${Math.round(r * 100)}%`; } }
      if (score > 0 && typeOk(col.type, f.type)) { score = Math.min(1, score + 0.03); why += " · hợp kiểu"; }
      return { field: f.field, confidence: score, why };
    }).sort((a, b) => b.confidence - a.confidence);

    const top = scored[0];
    return {
      rawIndex: col.index, rawHeader: col.header,
      field: top && top.confidence >= CONF_ASK ? top.field : null,
      confidence: round(top?.confidence ?? 0),
      reason: top && top.confidence >= CONF_ASK ? [top.why] : [],
      alternatives: scored.filter((s) => s.confidence > 0.25).slice(0, 3).map((s) => ({ field: s.field, confidence: round(s.confidence) })),
    };
  });

  // Xung đột: 2 cột cùng map 1 field → giữ cột confidence cao hơn, cột kia hạ về null.
  const claimed = new Map<string, MappingSuggestion>();
  for (const s of out) {
    if (!s.field) continue;
    const prev = claimed.get(s.field);
    if (!prev) { claimed.set(s.field, s); continue; }
    const loser = s.confidence >= prev.confidence ? prev : s;
    const winner = loser === prev ? s : prev;
    claimed.set(s.field, winner);
    loser.field = null; loser.reason = ["trùng field — nhường cột khớp cao hơn"];
  }
  return out;
}
