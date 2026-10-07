/**
 * TẢI + CHUẨN HOÁ 1 VÙNG sheet ở CLIENT (Worker không parse xlsx). Nguồn DUY NHẤT cho cả "render ma trận"
 * (renderSheetRegion trong index) lẫn "chỉnh như Excel" (matrix-form-editor). Trả worksheet đã parse +
 * range đã dò marker + bảng màu-theo-mã (đọc từ conditional-formatting) để render lại NHIỀU LẦN với FORM
 * khác nhau mà KHÔNG tải/parse lại file.
 */
import type { WorkSheet } from "xlsx";
import { getSummaryFile } from "@/lib/mtld-install.functions";

const b64ToBytes = (b64: string) => { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };

/** Chỉ số cột 0-based → chữ cột A1 (0→A, 25→Z, 26→AA…). */
export function colA1(c: number): string { let s = ""; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }

/** Dò 2 MARKER (tl = góc trên-trái, br = góc dưới-phải) trong 1 sheet (mảng 2D) → range A1 BAO 2 ô góc. */
export function findMarkerRange(rows: (string | number | null)[][], tl: string, br: string): string {
  const t = tl.trim(), b = br.trim();
  let tp: { r: number; c: number } | null = null, bp: { r: number; c: number } | null = null;
  for (let r = 0; r < rows.length; r++) { const row = rows[r] || []; for (let c = 0; c < row.length; c++) { const v = String(row[c] ?? "").trim(); if (t && v === t) tp = { r, c }; if (b && v === b) bp = { r, c }; } }
  if (!tp) throw new Error(`Không thấy marker góc trên-trái "${t}" trong sheet.`);
  if (!bp) throw new Error(`Không thấy marker góc dưới-phải "${b}" trong sheet.`);
  const r1 = Math.min(tp.r, bp.r), c1 = Math.min(tp.c, bp.c), r2 = Math.max(tp.r, bp.r), c2 = Math.max(tp.c, bp.c);
  return `${colA1(c1)}${r1 + 1}:${colA1(c2)}${r2 + 1}`;
}

/** `ts` = MỐC DỮ LIỆU (lúc bản này được đối chiếu với nguồn), để giao diện nói được số tính tới lúc nào. */
export type LoadedRegion = { sh: WorkSheet; range: string; codeColors: Record<string, string>; name: string; ts: number };

/** Tải file → parse (cellStyles) → chọn sheet theo tên → dò range (marker hoặc range gõ) → đọc màu-theo-mã.
 *  force=true bỏ cache (bản mới nhất từ Drive). Dùng lại `sh` để render nhiều FORM mà không tải lại. */
export async function loadRegion(fid: string, opts: { sheetName?: string; range?: string; tl?: string; br?: string }, force?: boolean): Promise<LoadedRegion> {
  // Truyền TÊN TAB đã chọn → server tách ĐÚNG tab đó (không mặc định "Summary") → render đúng tab người chọn.
  const res = await getSummaryFile({ data: { fileId: fid, sheet: opts.sheetName || undefined, force: force || undefined } });
  if (!res?.b64) throw new Error("Không tải được file — kiểm tra chia sẻ 'Anyone with the link'.");
  const XLSX = await import("xlsx");
  const bytes = b64ToBytes(res.b64);
  const wb = XLSX.read(bytes.buffer, { type: "array", cellStyles: true });
  const name = opts.sheetName && wb.SheetNames.includes(opts.sheetName) ? opts.sheetName : wb.SheetNames[0];
  const sh = wb.Sheets[name]; if (!sh) throw new Error("Không tìm thấy sheet.");
  let range = (opts.range ?? "").trim();
  if (opts.tl && opts.br) { const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sh, { header: 1, raw: false, defval: "" }); range = findMarkerRange(rows, opts.tl, opts.br); }
  const cf = await import("@/lib/cf-colors");
  return { sh, range, codeColors: cf.readCodeColors(bytes, name), name, ts: res.ts || Date.now() };
}
