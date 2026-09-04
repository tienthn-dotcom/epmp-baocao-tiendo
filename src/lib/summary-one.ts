/**
 * RENDER 1 POPUP LẮP ĐẶT (y hệt popup Summary bên ePMP) từ b64 file Google Sheet.
 * Tách từ nhánh mặc định của SummaryDialog (routes/index.tsx) để Tường Camera MTLĐ dùng lại:
 *   Public Summary → bảng + biểu đồ cột; Summary → heatmap ma trận (màu điều kiện); khác → dump ô thật.
 * Chạy CLIENT-SIDE (parse xlsx ở client — Worker KHÔNG parse).
 */
export type SummaryRender = { html: string; css: string };

export async function renderSummaryFromB64(b64: string): Promise<SummaryRender | null> {
  const XLSX = await import("xlsx");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const wb = XLSX.read(bytes.buffer, { type: "array", cellStyles: true });
  const name =
    wb.SheetNames.find((n) => /public\s*summary/i.test(n)) ??
    wb.SheetNames.find((n) => /summary/i.test(n)) ??
    wb.SheetNames[0];
  const sh = name ? wb.Sheets[name] : undefined;
  if (!sh) return null;
  if (/public\s*summary/i.test(name)) {
    const pub = await import("@/lib/public-summary-render");
    return { html: pub.publicSummaryToHtml(sh), css: pub.PUBLIC_SUMMARY_CSS };
  }
  if (/summary/i.test(name)) {
    const mod = await import("@/lib/summary-render");
    const cf = await import("@/lib/cf-colors");
    return { html: mod.summaryToHtml(sh, cf.readCodeColors(bytes, name)), css: mod.SUMMARY_CSS };
  }
  const dump = await import("@/lib/sheet-dump");
  return { html: dump.sheetToHtml(sh), css: dump.SHEET_DUMP_CSS };
}
