import { useMemo, useState } from "react";
import { Download, X, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import type { ItemRow } from "@/lib/types";
import {
  generateDryRunReport,
  reportToCsv,
  type BusinessStatus,
  type RuleId,
} from "@/lib/cleansing";

const STATUS_COLOR: Record<BusinessStatus, string> = {
  ACTIVE: "bg-slate-100 text-slate-700 border-slate-300",
  WARNING: "bg-amber-50 text-amber-800 border-amber-300",
  CRITICAL: "bg-red-50 text-red-800 border-red-300",
  COMPLETED: "bg-emerald-50 text-emerald-800 border-emerald-300",
  CANCELLED: "bg-slate-200 text-slate-600 border-slate-400 line-through",
  ON_HOLD: "bg-indigo-50 text-indigo-800 border-indigo-300",
};

export function CleansingDryRunDrawer({
  items,
  open,
  onClose,
}: {
  items: ItemRow[];
  open: boolean;
  onClose: () => void;
}) {
  const report = useMemo(() => generateDryRunReport(items), [items]);
  const [expandedRule, setExpandedRule] = useState<RuleId | null>(null);

  if (!open) return null;

  const downloadCsv = () => {
    const csv = reportToCsv(report);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cleansing-dry-run-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const insightPct = report.totalItems > 0 ? Math.round((report.insightPoolSize / report.totalItems) * 100) : 0;
  const archivePct = report.totalItems > 0 ? Math.round((report.archiveSize / report.totalItems) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-slate-900/40" />
      <aside className="flex h-full w-full max-w-[920px] flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700">
              Dry-run · Read-only
            </div>
            <h2 className="text-lg font-extrabold tracking-tight text-slate-900">
              Cleansing &amp; Business Validation Report
            </h2>
            <p className="mt-1 text-[12px] text-slate-500">
              Mô phỏng tác động nếu áp dụng cleansing — dashboard hiện tại CHƯA bị thay đổi.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={downloadCsv}
              className="flex h-8 items-center gap-1.5 rounded-md bg-teal-700 px-3 text-xs font-semibold text-white hover:bg-teal-800"
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
            <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* 1. Summary */}
          <section className="mb-6">
            <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              1 · Tổng quan
            </h3>
            <div className="grid grid-cols-4 gap-3">
              <Stat label="Tổng task" value={report.totalItems} tone="slate" />
              <Stat
                label="Insight pool"
                value={report.insightPoolSize}
                sub={`${insightPct}% · ACTIVE+WARNING+CRITICAL`}
                tone="teal"
              />
              <Stat
                label="Archive (loại)"
                value={report.archiveSize}
                sub={`${archivePct}% · COMPLETED+CANCELLED+ON_HOLD`}
                tone="amber"
              />
              <Stat label="Data bugs" value={report.dataBugs.length} tone="red" />
            </div>
          </section>

          {/* 2. Status distribution */}
          <section className="mb-6">
            <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              2 · Phân bố BusinessStatus
            </h3>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-right">Số task</th>
                    <th className="px-3 py-2 text-right">%</th>
                    <th className="px-3 py-2 text-left">Dùng cho insight?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(Object.keys(report.statusCounts) as BusinessStatus[]).map((s) => {
                    const n = report.statusCounts[s];
                    const pct = report.totalItems > 0 ? Math.round((n / report.totalItems) * 100) : 0;
                    const isActive = ["ACTIVE", "WARNING", "CRITICAL"].includes(s);
                    return (
                      <tr key={s}>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLOR[s]}`}>
                            {s}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{n}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">{pct}%</td>
                        <td className="px-3 py-2 text-[12px]">
                          {isActive ? (
                            <span className="text-teal-700">✓ insight</span>
                          ) : (
                            <span className="text-amber-700">✗ loại khỏi insight</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* 3. Rule firings */}
          <section className="mb-6">
            <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              3 · Số task hit theo từng rule (theo thứ tự ưu tiên)
            </h3>
            <div className="space-y-2">
              {report.ruleStats.map((rs) => {
                const isExpanded = expandedRule === rs.rule.id;
                return (
                  <div key={rs.rule.id} className="overflow-hidden rounded-lg border border-slate-200">
                    <button
                      onClick={() => setExpandedRule(isExpanded ? null : rs.rule.id)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <code className="text-[11px] font-bold text-slate-900">{rs.rule.id}</code>
                          <span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_COLOR[rs.rule.status]}`}>
                            → {rs.rule.status}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-slate-600">{rs.rule.description}</div>
                        <div className="mt-0.5 text-[10px] text-slate-400">Source: {rs.rule.sourceField}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-extrabold tabular-nums text-slate-900">{rs.count}</div>
                        <div className="text-[10px] text-slate-500">task</div>
                      </div>
                    </button>
                    {isExpanded && rs.samples.length > 0 && (
                      <div className="border-t border-slate-100 bg-slate-50 px-3 py-2">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          5 mẫu đầu
                        </div>
                        <table className="w-full text-[11.5px]">
                          <thead className="text-[10px] uppercase text-slate-400">
                            <tr>
                              <th className="px-1 py-1 text-left">Project</th>
                              <th className="px-1 py-1 text-left">Code</th>
                              <th className="px-1 py-1 text-left">Mô tả / Note</th>
                              <th className="px-1 py-1 text-left">Lý do</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rs.samples.map((s, idx) => (
                              <tr key={idx} className="border-t border-slate-200">
                                <td className="px-1 py-1 text-slate-600">{s.item.projectCode || "—"}</td>
                                <td className="px-1 py-1 font-mono text-slate-700">{s.item.rawCode}</td>
                                <td className="px-1 py-1 text-slate-600 truncate max-w-[260px]">
                                  {s.item.desc || s.item.note || "—"}
                                </td>
                                <td className="px-1 py-1 text-[10.5px] text-slate-500">{s.classification.reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* 4. KPI impact */}
          <section className="mb-6">
            <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              4 · Tác động lên KPI (Before → After cleansing)
            </h3>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">KPI</th>
                    <th className="px-3 py-2 text-right">Hiện tại</th>
                    <th className="px-3 py-2 text-right">Sau cleansing</th>
                    <th className="px-3 py-2 text-right">Δ</th>
                    <th className="px-3 py-2 text-left">Công thức</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.kpiImpact.map((k) => (
                    <tr key={k.label}>
                      <td className="px-3 py-2 font-semibold text-slate-800">{k.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{k.before}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold text-teal-700">{k.after}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${k.delta < 0 ? "text-red-700" : k.delta > 0 ? "text-emerald-700" : "text-slate-400"}`}>
                        {k.delta > 0 ? "+" : ""}{k.delta}
                      </td>
                      <td className="px-3 py-2 text-[10.5px] font-mono text-slate-500">{k.formula}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Δ âm = dashboard hiện tại đang đếm thừa (gồm task đã đóng/huỷ/tạm dừng).
            </p>
          </section>

          {/* 5. Data bugs */}
          {report.dataBugs.length > 0 && (
            <section className="mb-6">
              <h3 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-red-700">
                <AlertTriangle className="h-3.5 w-3.5" /> 5 · Critical Data Bugs ({report.dataBugs.length})
              </h3>
              <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50/50">
                <table className="w-full text-sm">
                  <thead className="bg-red-50 text-[11px] uppercase tracking-wider text-red-700">
                    <tr>
                      <th className="px-3 py-2 text-left">Bug type</th>
                      <th className="px-3 py-2 text-left">Project</th>
                      <th className="px-3 py-2 text-left">Task</th>
                      <th className="px-3 py-2 text-left">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-red-100">
                    {report.dataBugs.slice(0, 30).map((b, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-1.5">
                          <code className="text-[10.5px] font-bold text-red-700">{b.kind}</code>
                        </td>
                        <td className="px-3 py-1.5 text-[11.5px] text-slate-600">{b.item.projectCode || "—"}</td>
                        <td className="px-3 py-1.5 font-mono text-[11.5px] text-slate-700">{b.item.rawCode}</td>
                        <td className="px-3 py-1.5 text-[11.5px] text-red-800">{b.detail}</td>
                      </tr>
                    ))}
                    {report.dataBugs.length > 30 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-2 text-center text-[11px] text-slate-500">
                          … và {report.dataBugs.length - 30} bug khác (xem CSV)
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 6. Footer recommendation */}
          <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-[12px] text-amber-900">
            <div className="mb-1 font-bold">Khuyến nghị</div>
            <ul className="list-disc pl-4 space-y-1">
              <li>Duyệt từng rule firing — đặc biệt R_COMPLETED_KEYWORD và R_ON_HOLD_KEYWORD (rủi ro false positive cao).</li>
              <li>Export CSV và share PMO để xác nhận từng task bị loại.</li>
              <li>Nếu Δ KPI quá lớn (vd. Trễ giảm 50%) → confirm trước khi enforce.</li>
              <li>Sau khi duyệt: bật "Enforce cleansing" để áp dụng vào dashboard chính thức.</li>
            </ul>
          </section>
        </div>
      </aside>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone: "slate" | "teal" | "amber" | "red" }) {
  const toneCls = {
    slate: "border-slate-300 bg-slate-50",
    teal: "border-teal-300 bg-teal-50",
    amber: "border-amber-300 bg-amber-50",
    red: "border-red-300 bg-red-50",
  }[tone];
  const valCls = {
    slate: "text-slate-900",
    teal: "text-teal-800",
    amber: "text-amber-800",
    red: "text-red-700",
  }[tone];
  return (
    <div className={`rounded-lg border px-3 py-2 ${toneCls}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-0.5 text-2xl font-extrabold tabular-nums ${valCls}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}
