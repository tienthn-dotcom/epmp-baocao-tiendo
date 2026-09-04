/**
 * ETL core · bytes — NGUỒN DUY NHẤT cho: giải mã base64 ↔ bytes, và đọc workbook xlsx.
 * Thay thế ~6 bản `atob → Uint8Array → XLSX.read` rải rác (index.tsx, detail-plan-app, pmo-ai-app…).
 * XLSX được nạp ĐỘNG (dynamic import) để không phình bundle chính. Parse LUÔN ở client (Worker OOM 1102).
 */
import type { WorkBook, WorkSheet } from "xlsx";

/** base64 → Uint8Array. */
export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

/** Uint8Array → base64 (chunk để không tràn call-stack với file lớn). */
export function bytesToB64(bytes: Uint8Array): string {
  let s = ""; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

/** Đọc workbook từ ArrayBuffer/Uint8Array. opts truyền thẳng cho XLSX.read (vd cellStyles:true). */
export async function readWorkbook(input: ArrayBuffer | Uint8Array, opts?: Record<string, unknown>): Promise<WorkBook> {
  const XLSX = await import("xlsx");
  const buf = input instanceof Uint8Array ? input.buffer : input;
  return XLSX.read(buf, { type: "array", ...opts });
}

/** Đọc workbook từ base64. */
export async function readWorkbookB64(b64: string, opts?: Record<string, unknown>): Promise<WorkBook> {
  return readWorkbook(b64ToBytes(b64), opts);
}

/** Lấy CHỈ danh sách tên sheet (nhanh, không đọc ô) — cho dropdown/profiler. */
export async function listSheetNames(input: ArrayBuffer | Uint8Array | string): Promise<string[]> {
  const bytes = typeof input === "string" ? b64ToBytes(input) : input;
  const wb = await readWorkbook(bytes, { bookSheets: true });
  return wb.SheetNames;
}

/** 1 sheet → mảng 2D thô (header:1, raw:false, defval:""). */
export async function sheetRows(sh: WorkSheet): Promise<(string | number | null)[][]> {
  const XLSX = await import("xlsx");
  return XLSX.utils.sheet_to_json<(string | number | null)[]>(sh, { header: 1, raw: false, defval: "" });
}
