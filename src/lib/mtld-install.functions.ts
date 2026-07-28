/**
 * SERVER-FN cho popup "Thi công lắp đặt" (RIÊNG phần ma trận lắp đặt).
 *  • getSummaryFile({fileId}): fetch file → TÁCH riêng sheet "Summary" (~170KB) → b64 → cache KV.
 *    Worker KHÔNG parse/render (tránh Error 1102); CLIENT parse + render (xem SummaryDialog).
 * Đọc hyperlink đã chuyển sang CLIENT (src/lib/mtld-links.ts). Nguồn phải "Anyone with the link".
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { unzipSync, zipSync, strFromU8 } from "fflate";

const idFromUrl = (u: string): string | null => {
  const m = String(u).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
};

async function fetchXlsxById(id: string): Promise<ArrayBuffer> {
  const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx&_ts=${Date.now()}`;
  const r = await fetch(url, {
    redirect: "follow", cache: "no-store",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ePMP/1.0)", Accept: "*/*", "Cache-Control": "no-cache, no-store" },
  });
  if (!r.ok) throw new Error(`Không tải được file Google Sheet (HTTP ${r.status}). Kiểm tra quyền chia sẻ "Anyone with the link".`);
  return r.arrayBuffer();
}

/** KV binding trên Workers (tái dùng PMO_EDITS) để CACHE HTML Summary → bấm lần sau tức thì,
 *  Worker khỏi parse lại file 2MB. Dynamic import để không phá import-protection ở client. */
type KVLike = { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> };
async function getKv(): Promise<KVLike | null> {
  try {
    const mod = (await import("@tanstack/react-start/server")) as Record<string, unknown>;
    const getEvent = mod.getEvent as undefined | (() => unknown);
    const ev = getEvent?.() as { context?: { cloudflare?: { env?: Record<string, unknown> } } } | undefined;
    const kv = ev?.context?.cloudflare?.env?.PMO_EDITS;
    if (kv) return kv as KVLike;
  } catch { /* runtime khác */ }
  const g = globalThis as unknown as Record<string, unknown>;
  const env = (g.__env__ ?? null) as Record<string, unknown> | null;
  return (env?.PMO_EDITS ?? g.PMO_EDITS ?? null) as KVLike | null;
}

// (Đã BỎ getInstallLinks server-fn: việc đọc hyperlink chuyển hẳn sang CLIENT — xem
//  src/lib/mtld-links.ts + gQuery — để Worker KHÔNG parse xlsx nữa, tránh Error 1102.)

/** Uint8Array → base64 (chunk để không tràn đối số String.fromCharCode). */
function toB64(bytes: Uint8Array): string {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin);
}

/** TÁCH riêng sheet "Summary" (+ styles + sharedStrings) thành 1 file .xlsx TỐI GIẢN → gửi client
 *  chỉ ~170KB thay vì cả 2MB. AN TOÀN: dùng fflate GIẢI NÉN CÓ CHỌN LỌC (chỉ ~1.7MB, không dựng
 *  object cả 24MB như SheetJS → không OOM). Rewrite workbook/rels/content-types về 1 sheet. Lỗi
 *  bất kỳ → ném để caller fallback gửi nguyên file. */
function extractSummaryXlsx(buf: ArrayBuffer): Uint8Array {
  const data = new Uint8Array(buf);
  const meta = unzipSync(data, { filter: (f) => f.name === "xl/workbook.xml" || f.name === "xl/_rels/workbook.xml.rels" });
  const rid = strFromU8(meta["xl/workbook.xml"]).match(/<sheet[^>]*name="Summary"[^>]*r:id="([^"]+)"/)?.[1];
  if (!rid) throw new Error("Không thấy sheet Summary");
  const target = strFromU8(meta["xl/_rels/workbook.xml.rels"]).match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`))?.[1];
  if (!target) throw new Error("Không map được sheet Summary");
  const sheetPath = "xl/" + target.replace(/^\//, "");
  const parts = unzipSync(data, { filter: (f) => f.name === sheetPath || f.name === "xl/styles.xml" || f.name === "xl/sharedStrings.xml" });
  if (!parts[sheetPath]) throw new Error("Thiếu phần Summary");
  const enc = (s: string) => new TextEncoder().encode(s);
  const hasSS = !!parts["xl/sharedStrings.xml"];
  const ovSS = hasSS ? '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' : "";
  const relSS = hasSS ? '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' : "";
  const out: Record<string, Uint8Array> = {
    "[Content_Types].xml": enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${ovSS}</Types>`),
    "_rels/.rels": enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${relSS}</Relationships>`),
    "xl/worksheets/sheet1.xml": parts[sheetPath],
    "xl/styles.xml": parts["xl/styles.xml"] ?? enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>'),
  };
  if (hasSS) out["xl/sharedStrings.xml"] = parts["xl/sharedStrings.xml"];
  return zipSync(out, { level: 6 });
}

/** TẢI file Summary về CLIENT — chỉ gửi riêng sheet "Summary" (~170KB) thay vì cả file 2MB.
 *  KHÔNG parse trên Worker (parse xlsx 2MB làm OOM → Error 1102). Việc parse + render ở CLIENT.
 *  Worker chỉ: fetch → TÁCH sheet Summary (fflate, nhẹ) → b64 → cache KV 10'. Tách lỗi → gửi
 *  nguyên file (vẫn chạy). `force` (Làm mới) bỏ cache. */
export const getSummaryFile = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ fileId: z.string().min(10).max(120).regex(/^[a-zA-Z0-9_-]+$/), force: z.boolean().optional() }).parse(input))
  .handler(async ({ data }): Promise<{ b64: string; cached: boolean }> => {
    const kv = await getKv();
    const cacheKey = `sfile:${data.fileId}`;
    if (kv && !data.force) {
      const hit = await kv.get(cacheKey);
      if (hit) return { b64: hit, cached: true };
    }
    const raw = await fetchXlsxById(data.fileId);
    let bytes: Uint8Array;
    try { bytes = extractSummaryXlsx(raw); }          // ~170KB
    catch { bytes = new Uint8Array(raw); }             // tách lỗi → nguyên file
    const b64 = toB64(bytes);
    if (kv) { try { await kv.put(cacheKey, b64, { expirationTtl: 600 }); } catch { /* cache lỗi thì bỏ qua */ } }
    return { b64, cached: false };
  });
