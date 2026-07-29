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

// ── CACHE GHIM THEO NGÀY (stale-while-revalidate) ──────────────────────────────
// Mục tiêu: bấm vào Summary LUÔN nhanh. Thay vì cache 10' (cứ hết hạn là fetch Drive
// 2MB → chậm), ta GHIM data đến "mốc quét" mỗi ngày:
//   • Có cache → trả NGAY (tức thì), không chờ Drive.
//   • Nếu cache cũ hơn mốc quét gần nhất → ÂM THẦM fetch bản mới ở NỀN (waitUntil),
//     lần mở sau đã có bản mới. Data đứng yên cả ngày, tự refresh 1 lần/ngày.
//   • Nút "Làm mới" (force) vẫn lấy LIVE tức thì.
const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;      // giờ VN = UTC+7
const REFRESH_HOUR_VN = 6;               // mốc "quét" mỗi ngày: 06:00 giờ VN (đổi tại đây)
const CACHE_TTL_S = 3 * 86_400;          // giữ cache 3 ngày (đủ sống qua cuối tuần) → daily refresh lo phần tươi

/** Mốc quét gần nhất (UTC ms) = REFRESH_HOUR_VN:00 giờ VN của hôm nay; nếu chưa tới thì lùi 1 ngày. */
function lastRefreshBoundary(now: number): number {
  const vnMidnight = Math.floor((now + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS; // 00:00 VN hôm nay (UTC ms)
  let b = vnMidnight + REFRESH_HOUR_VN * 3_600_000;
  if (b > now) b -= DAY_MS;
  return b;
}

/** Lấy waitUntil (nếu có) để chạy refresh ở NỀN không chặn phản hồi. */
async function getWaitUntil(): Promise<((p: Promise<unknown>) => void) | null> {
  try {
    const mod = (await import("@tanstack/react-start/server")) as Record<string, unknown>;
    const ev = (mod.getEvent as undefined | (() => unknown))?.() as { context?: { cloudflare?: { context?: { waitUntil?: (p: Promise<unknown>) => void } } } } | undefined;
    const ctx = ev?.context?.cloudflare?.context;
    if (ctx?.waitUntil) return (p) => ctx.waitUntil!(p);
  } catch { /* runtime khác */ }
  return null;
}

/** Fetch Drive → tách sheet Summary → b64 → ghi cache {b64, ts}. Trả b64. */
async function refreshAndStore(fileId: string, kv: KVLike | null, cacheKey: string): Promise<string> {
  const raw = await fetchXlsxById(fileId);
  let bytes: Uint8Array;
  try { bytes = extractSummaryXlsx(raw); }          // ~170KB
  catch { bytes = new Uint8Array(raw); }             // tách lỗi → nguyên file
  const b64 = toB64(bytes);
  if (kv) { try { await kv.put(cacheKey, JSON.stringify({ b64, ts: Date.now() }), { expirationTtl: CACHE_TTL_S }); } catch { /* cache lỗi thì bỏ qua */ } }
  return b64;
}

/** TẢI file Summary về CLIENT — chỉ gửi riêng sheet "Summary" (~170KB) thay vì cả file 2MB.
 *  KHÔNG parse trên Worker (parse xlsx 2MB làm OOM → Error 1102). Việc parse + render ở CLIENT.
 *  Cache GHIM THEO NGÀY + tự làm mới nền (xem khối chú thích trên). `force` = lấy LIVE ngay. */
export const getSummaryFile = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ fileId: z.string().min(10).max(120).regex(/^[a-zA-Z0-9_-]+$/), force: z.boolean().optional() }).parse(input))
  .handler(async ({ data }): Promise<{ b64: string; cached: boolean }> => {
    const kv = await getKv();
    const cacheKey = `sfile:${data.fileId}`;
    if (kv && !data.force) {
      const hit = await kv.get(cacheKey);
      if (hit) {
        let b64 = hit, ts = 0;
        try { const o = JSON.parse(hit) as { b64?: string; ts?: number }; if (o && typeof o.b64 === "string") { b64 = o.b64; ts = o.ts ?? 0; } }
        catch { /* cache đời cũ (b64 thô) → coi như ts=0 để refresh nền 1 lần */ }
        if (ts < lastRefreshBoundary(Date.now())) {          // cũ hơn mốc quét hôm nay → làm mới ở NỀN
          const job = refreshAndStore(data.fileId, kv, cacheKey).catch(() => { /* nền, lỗi kệ */ });
          const wu = await getWaitUntil();
          if (wu) wu(job);
        }
        return { b64, cached: true };                        // LUÔN trả cache tức thì
      }
    }
    const b64 = await refreshAndStore(data.fileId, kv, cacheKey);
    return { b64, cached: false };
  });
