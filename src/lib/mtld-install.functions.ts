/**
 * SERVER-FN cho popup "Thi công lắp đặt" (RIÊNG phần ma trận lắp đặt).
 *  • getSummaryFile({fileId}): fetch file → TÁCH riêng sheet "Summary" (~170KB) → b64 → cache KV.
 *    Worker KHÔNG parse/render (tránh Error 1102); CLIENT parse + render (xem SummaryDialog).
 * Đọc hyperlink đã chuyển sang CLIENT (src/lib/mtld-links.ts). Nguồn phải "Anyone with the link".
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { unzipSync, zipSync, strFromU8 } from "fflate";


async function fetchXlsxById(id: string, gid?: string): Promise<ArrayBuffer> {
  const g = gid ? `&gid=${encodeURIComponent(gid)}` : "";
  const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx${g}&_ts=${Date.now()}`;
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
/**
 * BỌC KV để HẾT HẠN MỨC KHÔNG LÀM SẬP CẢ APP — xem ghi chú dài ở edits.functions.ts.
 * ĐỌC hỏng → coi như chưa có. GHI vẫn để lỗi ném ra.
 * KHÔNG dùng Proxy: `put` sẽ lấy `this` là Proxy chứ không phải KV thật → Workers báo
 * "Illegal invocation: function called with incorrect `this` reference".
 */
function bocKv(kv: KVLike): KVLike {
  return {
    get: async (k) => { try { return await kv.get(k); } catch { return null; } },
    put: (k, v, o) => kv.put(k, v, o),
  };
}

async function getKv(): Promise<KVLike | null> {
  try {
    const mod = (await import("@tanstack/react-start/server")) as Record<string, unknown>;
    const getEvent = mod.getEvent as undefined | (() => unknown);
    const ev = getEvent?.() as { context?: { cloudflare?: { env?: Record<string, unknown> } } } | undefined;
    const kv = ev?.context?.cloudflare?.env?.PMO_EDITS;
    if (kv) return bocKv(kv as KVLike);
  } catch { /* runtime khác */ }
  const g = globalThis as unknown as Record<string, unknown>;
  const env = (g.__env__ ?? null) as Record<string, unknown> | null;
  const kv2 = (env?.PMO_EDITS ?? g.PMO_EDITS ?? null) as KVLike | null;
  return kv2 ? bocKv(kv2) : null;
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
const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function extractSheetXlsx(buf: ArrayBuffer, sheetName: string): Uint8Array {
  const data = new Uint8Array(buf);
  const meta = unzipSync(data, { filter: (f) => f.name === "xl/workbook.xml" || f.name === "xl/_rels/workbook.xml.rels" });
  // Dò r:id của ĐÚNG tab theo TÊN (name & r:id có thể ở thứ tự bất kỳ; tên bị escape XML → giải mã rồi so).
  const wbxml = strFromU8(meta["xl/workbook.xml"]);
  let rid: string | undefined;
  const re = /<sheet\b([^>]*?)\/?>/g; let sm: RegExpExecArray | null;
  while ((sm = re.exec(wbxml))) {
    const a = sm[1];
    const nm = a.match(/\bname="([^"]*)"/)?.[1];
    const id = a.match(/\br:id="([^"]+)"/)?.[1];
    if (nm != null && id && decodeXml(nm) === sheetName) { rid = id; break; }
  }
  if (!rid) throw new Error(`Không thấy sheet "${sheetName}"`);
  const target = strFromU8(meta["xl/_rels/workbook.xml.rels"]).match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`))?.[1];
  if (!target) throw new Error("Không map được sheet");
  const sheetPath = "xl/" + target.replace(/^\//, "");
  const parts = unzipSync(data, { filter: (f) => f.name === sheetPath || f.name === "xl/styles.xml" || f.name === "xl/sharedStrings.xml" });
  if (!parts[sheetPath]) throw new Error("Thiếu phần sheet");
  const enc = (s: string) => new TextEncoder().encode(s);
  const hasSS = !!parts["xl/sharedStrings.xml"];
  const ovSS = hasSS ? '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' : "";
  const relSS = hasSS ? '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' : "";
  const out: Record<string, Uint8Array> = {
    "[Content_Types].xml": enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${ovSS}</Types>`),
    "_rels/.rels": enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
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
const REFRESH_HOUR_VN = 17;              // mốc "quét" mỗi ngày = 17:30 giờ VN (đổi tại đây).
const REFRESH_MIN_VN = 30;               // PHẢI KHỚP cron warmer (warmer/wrangler.toml: "30 10 * * *").
const CACHE_TTL_S = 3 * 86_400;          // giữ cache 3 ngày (đủ sống qua cuối tuần) → daily refresh lo phần tươi
const SFILE_INDEX_KEY = "sfile:index";   // registry fileId đã từng mở → worker cron warm sẵn buổi sáng

/** Mốc quét gần nhất (UTC ms) = REFRESH_HOUR_VN:00 giờ VN của hôm nay; nếu chưa tới thì lùi 1 ngày. */
function lastRefreshBoundary(now: number): number {
  const vnMidnight = Math.floor((now + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS; // 00:00 VN hôm nay (UTC ms)
  let b = vnMidnight + REFRESH_HOUR_VN * 3_600_000 + REFRESH_MIN_VN * 60_000;
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

/** Fetch Drive → (gid: đúng 1 tab · không gid: TÁCH đúng tab `sheet` (mặc định "Summary")) → b64 → cache. */
async function refreshAndStore(fileId: string, gid: string | undefined, kv: KVLike | null, cacheKey: string, sheet?: string, full?: boolean): Promise<string> {
  let raw: ArrayBuffer, effGid = gid;
  try {
    raw = await fetchXlsxById(fileId, gid);
  } catch (e) {
    if (!gid) throw e;
    // gid-export lỗi (vd HTTP 400: gid không khớp/không tồn tại trong file) → LÙI về tải NGUYÊN file
    // (không gid) rồi tách sheet — đúng hành vi cũ cho dạng phòng, không để popup chết.
    raw = await fetchXlsxById(fileId);
    effGid = undefined;
  }
  let bytes: Uint8Array;
  if (effGid) {
    // export?gid=… đã trả ĐÚNG 1 tab (~23KB) → gửi nguyên, KHÔNG cần tách (nhẹ nhất).
    bytes = new Uint8Array(raw);
  } else if (full) {
    bytes = new Uint8Array(raw);                                  // NGUYÊN file (mọi sheet) — cho "Tự động" quét hết
  } else {
    try { bytes = extractSheetXlsx(raw, sheet ?? "Summary"); }   // chỉ đúng TAB đã chọn (~170KB)
    catch { bytes = new Uint8Array(raw); }                        // tách lỗi → nguyên file (client tự chọn tab)
  }
  const b64 = toB64(bytes);
  if (kv) {
    try { await kv.put(cacheKey, JSON.stringify({ b64, ts: Date.now() }), { expirationTtl: CACHE_TTL_S }); } catch { /* cache lỗi thì bỏ qua */ }
    // Ghi fileId vào REGISTRY (sfile:index) để worker cron warm SẴN — CHỈ cho dạng "Summary" (không gid);
    // dạng theo gid (Public…) chưa warm qua cron (vẫn nhanh nhờ file 23KB + cache), tránh phá warmer.
    if (!gid) {
      try {
        const idxRaw = await kv.get(SFILE_INDEX_KEY);
        const arr: string[] = idxRaw ? (JSON.parse(idxRaw) as string[]) : [];
        if (!arr.includes(fileId)) { arr.push(fileId); await kv.put(SFILE_INDEX_KEY, JSON.stringify(arr)); }
      } catch { /* registry hỏng không ảnh hưởng tải Summary */ }
    }
  }
  return b64;
}

/** LIỆT KÊ TÊN MỌI TAB của 1 file (KHÔNG tách Summary → nên KHÔNG mất tab). Chỉ giải nén `xl/workbook.xml`
 *  (vài KB) rồi regex tên sheet → NHẸ, không OOM, KHÔNG gửi cả file 2MB về client. Cache theo fileId. */
const decodeXml = (s: string) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&amp;/g, "&");
export const listSheetTabs = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ fileId: z.string().min(10).max(120).regex(/^[a-zA-Z0-9_-]+$/), force: z.boolean().optional() }).parse(input))
  .handler(async ({ data }): Promise<{ tabs: string[] }> => {
    const kv = await getKv();
    const cacheKey = `stabs:${data.fileId}`;
    if (kv && !data.force) { const hit = await kv.get(cacheKey); if (hit) { try { const t = JSON.parse(hit) as string[]; if (Array.isArray(t)) return { tabs: t }; } catch { /* cache hỏng → tải lại */ } } }
    const raw = await fetchXlsxById(data.fileId);                                  // tải nguyên workbook (mọi tab)
    const wb = unzipSync(new Uint8Array(raw), { filter: (f) => f.name === "xl/workbook.xml" })["xl/workbook.xml"];
    const xml = wb ? strFromU8(wb) : "";
    const tabs: string[] = [];
    const re = /<sheet\b[^>]*\bname="([^"]*)"/g; let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) tabs.push(decodeXml(m[1]));
    if (kv && tabs.length) { try { await kv.put(cacheKey, JSON.stringify(tabs), { expirationTtl: CACHE_TTL_S }); } catch { /* bỏ qua */ } }
    return { tabs };
  });

/** CLIENT gửi TOÀN BỘ fileId install-link (đọc từ hyperlink) → gộp vào REGISTRY sfile:index để
 *  worker cron sáng warm SẴN mọi dự án (không chờ từng người mở). Idempotent, gọi mỗi lần load. */
export const recordSummaryFiles = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ fileIds: z.array(z.string().min(10).max(120).regex(/^[a-zA-Z0-9_-]+$/)).max(1000) }).parse(input))
  .handler(async ({ data }): Promise<{ count: number }> => {
    const kv = await getKv();
    if (!kv || !data.fileIds.length) return { count: 0 };
    try {
      const raw = await kv.get(SFILE_INDEX_KEY);
      const arr: string[] = raw ? (JSON.parse(raw) as string[]) : [];
      let added = 0;
      for (const id of data.fileIds) if (!arr.includes(id)) { arr.push(id); added++; }
      if (added) await kv.put(SFILE_INDEX_KEY, JSON.stringify(arr));
      return { count: arr.length };
    } catch { return { count: 0 }; }
  });

// ── DANH SÁCH POPUP LẮP ĐẶT cho app MTLĐ ─────────────────────────────────────
// Dashboard (sau khi parse installLinks) ĐẨY danh sách này vào KV; app MTLĐ ĐỌC thẳng từ KV →
// không còn phụ thuộc cầu nối localStorage (ghi/đọc lệch thời điểm, khác tab → trống).
const INSTALL_LIST_KEY = "mtld:install:list:v2";

/**
 * GHI KV chỉ khi nội dung KHÁC bản đang có.
 *
 * Hạn mức KV: 100.000 lượt ĐỌC mỗi ngày nhưng chỉ 1.000 lượt GHI. Mấy kho dưới đây được client
 * gửi lên MỖI LẦN MỞ APP dù dữ liệu y hệt hôm qua — mười người mở vài lượt một ngày là chạm trần
 * ghi, app đứng giữa buổi. Đọc để so trước khi ghi là đổi thứ đang khan lấy thứ đang thừa.
 */
async function putNeuKhac(kv: KVLike, key: string, giaTri: string): Promise<boolean> {
  try { if ((await kv.get(key)) === giaTri) return false; } catch { /* đọc hỏng → cứ ghi */ }
  await kv.put(key, giaTri);
  return true;
}
type InstallListItem = {
  fileId: string; gid?: string; name: string; maCT: string; region?: string; groupDA?: string;
  /** ID CỨNG của DỰ ÁN (cột "IDCUNG", vd "P0025") — KHOÁ BỀN của dự án: đổi tên / STT trôi / trùng mã CT
   *  đều không đụng tới nó. Media neo theo cái này để 2 dự án khác nhau KHÔNG bao giờ dùng chung kho. */
  hid?: string;
  // Vùng + form để render Y HỆT popup "Thi công lắp đặt" (MatrixFormEditor: ma trận live + form đã lưu).
  sheet?: string; range?: string; tl?: string; br?: string; formKey?: string; chart?: boolean;
  /** Dự án CHƯA CÓ MA TRẬN — link chỉ để mở ra xem; app Hình ảnh mỗi ngày gom ảnh chung cả dự án,
   *  không dắt về từng căn. Xem cờ noMx trong SheetViewCfg. */
  noMx?: boolean;
};
export const saveInstallList = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ list: z.array(z.object({
    fileId: z.string().max(120), gid: z.string().max(30).optional(), name: z.string().max(300),
    maCT: z.string().max(120), region: z.string().max(120).optional(), groupDA: z.string().max(300).optional(),
    hid: z.string().max(40).optional(),
    sheet: z.string().max(200).optional(), range: z.string().max(60).optional(), tl: z.string().max(30).optional(),
    br: z.string().max(30).optional(), formKey: z.string().max(400).optional(), chart: z.boolean().optional(),
    noMx: z.boolean().optional(),
  })).max(1000) }).parse(input))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const kv = await getKv();
    if (kv) { try { await putNeuKhac(kv, INSTALL_LIST_KEY, JSON.stringify(data.list)); } catch { /* KV lỗi → bỏ qua */ } }
    return { ok: true };
  });
export const getInstallList = createServerFn({ method: "POST" })
  .handler(async (): Promise<{ list: InstallListItem[] }> => {
    const kv = await getKv();
    if (!kv) return { list: [] };
    try { const raw = await kv.get(INSTALL_LIST_KEY); return { list: raw ? (JSON.parse(raw) as InstallListItem[]) : [] }; }
    catch { return { list: [] }; }
  });

/** TẢI file Summary về CLIENT — chỉ gửi riêng sheet "Summary" (~170KB) thay vì cả file 2MB.
 *  KHÔNG parse trên Worker (parse xlsx 2MB làm OOM → Error 1102). Việc parse + render ở CLIENT.
 *  Cache GHIM THEO NGÀY + tự làm mới nền (xem khối chú thích trên). `force` = lấy LIVE ngay. */
export const getSummaryFile = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ fileId: z.string().min(10).max(120).regex(/^[a-zA-Z0-9_-]+$/), gid: z.string().regex(/^\d+$/).max(30).optional(), sheet: z.string().max(120).regex(/^[^\n\r]*$/).optional(), full: z.boolean().optional(), force: z.boolean().optional() }).parse(input))
  .handler(async ({ data }): Promise<{ b64: string; cached: boolean; ts: number }> => {
    const kv = await getKv();
    // sheet != "Summary" → cache RIÊNG theo tab. full=true → nguyên file (cache riêng) cho "Tự động" quét mọi sheet.
    const sh = (data.sheet ?? "").trim();
    const cacheKey = data.gid ? `sfile:${data.fileId}:${data.gid}`
      : data.full ? `sfile:${data.fileId}:full`
      : (sh && sh !== "Summary") ? `sfile:${data.fileId}:sh:${sh}`
      : `sfile:${data.fileId}`;
    if (kv && !data.force) {
      const hit = await kv.get(cacheKey);
      if (hit) {
        let b64 = hit, ts = 0;
        try { const o = JSON.parse(hit) as { b64?: string; ts?: number }; if (o && typeof o.b64 === "string") { b64 = o.b64; ts = o.ts ?? 0; } }
        catch { /* cache đời cũ (b64 thô) → coi như ts=0 để refresh nền 1 lần */ }
        if (ts < lastRefreshBoundary(Date.now())) {          // cũ hơn mốc quét hôm nay → làm mới ở NỀN
          const job = refreshAndStore(data.fileId, data.gid, kv, cacheKey, sh || undefined, data.full).catch(() => { /* nền, lỗi kệ */ });
          const wu = await getWaitUntil();
          if (wu) wu(job);
        }
        return { b64, cached: true, ts: ts || Date.now() };  // LUÔN trả cache tức thì (kèm mốc dữ liệu)
      }
    }
    const b64 = await refreshAndStore(data.fileId, data.gid, kv, cacheKey, sh || undefined, data.full);
    return { b64, cached: false, ts: Date.now() };
  });

/** TẢI 1 sheet dưới dạng PDF do GOOGLE render (Y HỆT màn hình: có CHART + màu điều kiện + format).
 *  Dùng cho tab "lạ" (không phải Summary/Public Summary) — client hiện thẳng PDF. Cache ghim theo ngày. */
async function fetchPdfOnce(id: string, gid?: string, range?: string): Promise<string> {
  const g = gid ? `&gid=${encodeURIComponent(gid)}` : "";
  const rg = range && range.trim() ? `&range=${encodeURIComponent(range.trim())}` : "";   // giới hạn ĐÚNG vùng admin khai (A1, vd A1:H30) — bỏ trống = cả tab
  // scale=4 = "Fit to page" → gói trọn vùng vào 1 TRANG. MARGIN=0 + căn TRÊN-TRÁI → bỏ lề trắng thừa của khổ giấy
  // (vùng vẫn cắt đúng theo range; phần "thừa" trước đây là lề A4). fzr=false: không lặp hàng/cột tiêu đề.
  const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=pdf${g}${rg}&portrait=false&scale=4&fzr=false&top_margin=0&bottom_margin=0&left_margin=0&right_margin=0&horizontal_alignment=LEFT&vertical_alignment=TOP&gridlines=true&sheetnames=false&printtitle=false&pagenumbers=false&_ts=${Date.now()}`;
  const r = await fetch(url, { redirect: "follow", cache: "no-store", headers: { "User-Agent": "Mozilla/5.0 (compatible; ePMP/1.0)", Accept: "application/pdf,*/*", "Cache-Control": "no-cache, no-store" } });
  if (!r.ok) throw new Error(`Không tải được PDF (HTTP ${r.status}). Kiểm tra quyền chia sẻ "Anyone with the link".`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50) throw new Error("Google trả về không phải PDF — sheet chưa cho truy cập công khai.");
  return toB64(bytes);
}
/** Native + gid → PDF ĐÚNG tab. File .xlsx không nhận gid → LÙI về PDF NGUYÊN file (trang đầu = sheet đầu). */
async function fetchSheetPdf(id: string, gid?: string, range?: string): Promise<string> {
  try { return await fetchPdfOnce(id, gid, range); }
  catch (e) { if (gid) return await fetchPdfOnce(id, undefined, range); throw e; }
}

export const getSheetPdf = createServerFn({ method: "POST" })
  // range = "TênSheet!A1:H30"; đã encodeURIComponent khi ghép URL nên chỉ chặn xuống dòng.
  .inputValidator((input) => z.object({ fileId: z.string().min(10).max(120).regex(/^[a-zA-Z0-9_-]+$/), gid: z.string().regex(/^\d+$/).max(30).optional(), range: z.string().max(80).regex(/^[^\n\r]*$/).optional(), force: z.boolean().optional() }).parse(input))
  .handler(async ({ data }): Promise<{ b64: string; cached: boolean }> => {
    const kv = await getKv();
    const cacheKey = `spdf2:${data.fileId}:${data.gid ?? ""}:${(data.range ?? "").trim()}`;   // v2 = scale=4 (1 trang); vùng khác → cache riêng
    if (kv && !data.force) {
      const hit = await kv.get(cacheKey);
      if (hit) {
        let b64 = hit, ts = 0;
        try { const o = JSON.parse(hit) as { b64?: string; ts?: number }; if (o && typeof o.b64 === "string") { b64 = o.b64; ts = o.ts ?? 0; } } catch { /* cache cũ */ }
        if (ts < lastRefreshBoundary(Date.now())) {
          const job = fetchSheetPdf(data.fileId, data.gid, data.range).then((b) => kv.put(cacheKey, JSON.stringify({ b64: b, ts: Date.now() }), { expirationTtl: CACHE_TTL_S })).catch(() => { /* nền */ });
          const wu = await getWaitUntil(); if (wu) wu(job);
        }
        return { b64, cached: true };
      }
    }
    const b64 = await fetchSheetPdf(data.fileId, data.gid, data.range);
    if (kv) { try { await kv.put(cacheKey, JSON.stringify({ b64, ts: Date.now() }), { expirationTtl: CACHE_TTL_S }); } catch { /* cache lỗi kệ */ } }
    return { b64, cached: false };
  });

// ── VÙNG CỦA TỪNG DỰ ÁN — cầu nối ePMP → các app khác ────────────────────────
// Vùng chỉ có trong file PMP mà ePMP đọc (cột Location của đầu việc). App "Hiệu suất dự án" chạy
// bằng file Pivot riêng, KHÔNG có cột vùng → ePMP đẩy map này vào KV, app kia đọc thẳng. Nhờ vậy
// hai bên chia vùng bằng ĐÚNG một nguồn, khỏi ngồi khai lại tay rồi lệch nhau.
// Khoá = tên dự án đã chuẩn hoá (normProjName trong lib/vung.ts). Giá trị = chữ vùng THÔ của file
// (vd "North", "PQ") — bên đọc tự chuẩn hoá bằng vungVN, giữ được nguyên văn để còn đối chiếu.
const PROJ_REGION_KEY = "proj:regions:v1";
const DEV_PROJ_REGION_FILE = ".data/pmo-proj-regions.json";   // chạy dev không có KV → ghi ra file
export const saveProjRegions = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({
    map: z.record(z.string().max(200), z.string().max(120)),
  }).parse(input))
  .handler(async ({ data }): Promise<{ ok: boolean; n: number }> => {
    const n = Object.keys(data.map).length;
    if (!n) return { ok: false, n: 0 };            // map rỗng (ePMP chưa parse xong) → đừng ghi đè bản đang có
    const kv = await getKv();
    if (kv) { try { await putNeuKhac(kv, PROJ_REGION_KEY, JSON.stringify(data.map)); } catch { /* KV lỗi → bỏ qua */ } return { ok: true, n }; }
    try {
      const fsp = await import("node:fs/promises");
      await fsp.mkdir(".data", { recursive: true });
      await fsp.writeFile(DEV_PROJ_REGION_FILE, JSON.stringify(data.map, null, 2), "utf8");
    } catch { /* dev ghi hụt cũng không sao */ }
    return { ok: true, n };
  });
export const getProjRegions = createServerFn({ method: "GET" })
  .handler(async (): Promise<{ map: Record<string, string> }> => {
    const kv = await getKv();
    if (kv) {
      try { const raw = await kv.get(PROJ_REGION_KEY); return { map: raw ? (JSON.parse(raw) as Record<string, string>) : {} }; }
      catch { return { map: {} }; }
    }
    try {
      const fsp = await import("node:fs/promises");
      return { map: JSON.parse(await fsp.readFile(DEV_PROJ_REGION_FILE, "utf8")) as Record<string, string> };
    } catch { return { map: {} }; }
  });

/* ── NGÀY CẬP NHẬT THẬT CỦA FILE SAU LINK ────────────────────────────────────────────────
   Popup ma trận hiện một dòng "Ngày cập nhật: dd/mm/yyyy". Ngày này KHÔNG lấy từ bảng (cột đó
   do người ta gõ tay) mà hỏi thẳng Google: mỗi lần file đổi, Drive tự ghi lại giờ sửa, không ai
   sửa được con số đó. Chỉ hỏi metadata nên nhẹ, và cache 10 phút cho khỏi gọi lại mỗi lần mở.
   Chưa cấu hình Drive hoặc tài khoản không thấy file thì trả null, popup lặng lẽ giấu dòng đó. */
/* ── NGÀY SỬA CỦA FILE TRONG LINK ────────────────────────────────────────────────────────────
 *
 * MỘT KHOÁ CHO TẤT CẢ, KHÔNG PHẢI MỖI FILE MỘT KHOÁ.
 *
 * Bản trước để mỗi file một khoá `fmeta:<id>` với hạn 10 phút. Bảng chính có mấy chục dòng gắn
 * link, nên mỗi lượt mở là mấy chục lượt ĐỌC, và cứ qua 10 phút là mấy chục lượt GHI. Hạn mức KV
 * free chỉ 1.000 lượt ghi mỗi ngày — một mình chỗ này đủ đốt sạch trước giờ nghỉ trưa.
 *
 * Nay gom cả bản đồ vào MỘT khoá: một lượt đọc cho cả bảng, và một lượt ghi cho cả đợt làm mới.
 * Mỗi mục vẫn có mốc thời gian riêng nên chỉ hỏi lại Drive đúng file đã cũ.
 */
const FMETA_KEY = "fmeta:v2";
/* MỖI NGÀY HỎI LẠI MỘT LƯỢT. Thứ hiển thị là một NGÀY — ngày thì mỗi ngày mới đổi một lần, nên
   hỏi dày hơn thế là làm việc thừa. Neo theo NGÀY (giờ VN) chứ không theo cửa sổ 24 tiếng trôi:
   dễ hình dung, và cả kho cùng làm mới đúng một lần sau nửa đêm. */
/* APP KHÔNG ĐI HỎI DRIVE HÀNG LOẠT NỮA.
 *
 * Cron của warmer làm sẵn cả bảng ngày mỗi sáng 09:00 (xem lamMoiNgaySuaLink trong warmer), nên
 * lúc người dùng mở bảng chỉ cần ĐỌC kho. Mỗi lượt mở: 1 lượt đọc KV, 0 lượt ghi, 0 lần gọi Drive.
 *
 * Vẫn chừa một khe nhỏ: link VỪA GẮN chưa kịp vào kho thì hỏi Drive ngay cho vài cái, không thì
 * người gắn link xong phải đợi tới sáng mai mới thấy ngày. Chỉ hỏi link CHƯA CÓ trong kho, không
 * hỏi lại link đã có — link đã có thì cứ để cron lo. */
const MOI_LUOT_HOI = 3;
const FMETA_TTL_S = 30 * 86_400;           // khoá tự dọn sau 30 ngày nếu app ngừng dùng
type FMetaMuc = { modifiedTime: string | null; nguoiSua: string; ts: number };
type FMetaMap = Record<string, FMetaMuc>;

/** Ngày (giờ VN) của một mốc ISO — "2026-09-10". */
function ngayVN(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t + 7 * 3600_000).toISOString().slice(0, 10);
}

async function docFMeta(kv: KVLike | null): Promise<FMetaMap> {
  if (!kv) return {};
  try { const raw = await kv.get(FMETA_KEY); return raw ? (JSON.parse(raw) as FMetaMap) : {}; }
  catch { return {}; }
}
async function ghiFMeta(kv: KVLike | null, map: FMetaMap): Promise<void> {
  if (!kv) return;
  try { await kv.put(FMETA_KEY, JSON.stringify(map), { expirationTtl: FMETA_TTL_S }); } catch { /* bỏ qua */ }
}
/**
 * Mục còn dùng được không.
 *
 * Hai lối:
 *  · hỏi chưa lâu (trong FMETA_HAN) → dùng luôn;
 *  · file đã sửa TRONG HÔM NAY → khỏi hỏi lại tới hết ngày. Người ta có sửa thêm mấy lần nữa thì
 *    NGÀY hiện trên bảng vẫn là hôm nay, hỏi lại cũng ra đúng con số đang hiện.
 * Lối thứ hai gỡ hẳn gánh nặng cho những file đang được cập nhật đều — đúng nhóm hay bị hỏi nhất.
 */
function conTuoi(m: FMetaMuc | undefined, gio: number): boolean {
  if (!m) return false;
  const homNay = ngayVN(new Date(gio).toISOString());
  if (ngayVN(new Date(m.ts ?? 0).toISOString()) === homNay) return true;   // hôm nay hỏi rồi
  // File sửa trong hôm nay thì cũng khỏi hỏi: có sửa thêm mấy lần nữa, NGÀY hiện ra vẫn là hôm nay.
  return !!m.modifiedTime && ngayVN(m.modifiedTime) === homNay;
}

export const getLinkUpdatedAt = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({
    fileId: z.string().min(10).max(120).regex(/^[a-zA-Z0-9_-]+$/),
    force: z.boolean().optional(),
  }).parse(input))
  .handler(async ({ data }): Promise<{ modifiedTime: string | null; nguoiSua: string }> => {
    const kv = await getKv();
    const gio = Date.now();
    const map = await docFMeta(kv);
    const cu = map[data.fileId];
    if (!data.force && conTuoi(cu, gio)) return { modifiedTime: cu.modifiedTime, nguoiSua: cu.nguoiSua };
    let ra: { modifiedTime: string | null; nguoiSua: string } = { modifiedTime: null, nguoiSua: "" };
    try {
      const drive = await import("@/lib/drive.functions");
      const m = await drive.driveFileMetaImpl(data.fileId);
      if (m) ra = { modifiedTime: m.modifiedTime, nguoiSua: m.nguoiSua };
    } catch { /* Drive lỗi → coi như chưa biết, KHÔNG làm hỏng popup */ }
    if (ra.modifiedTime) { map[data.fileId] = { ...ra, ts: gio }; await ghiFMeta(kv, map); }
    // Drive hỏi hụt mà cache còn số cũ thì trả số cũ, hơn là để popup trống.
    else if (cu) return { modifiedTime: cu.modifiedTime, nguoiSua: cu.nguoiSua };
    return ra;
  });

/** NHIỀU FILE MỘT LƯỢT — bảng chính có mấy chục dòng gắn link. Một lượt đọc KV cho cả bảng,
 *  hỏi Drive đúng mấy file đã cũ, rồi GHI MỘT LẦN cho cả đợt. */
export const getLinksUpdatedAt = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({
    fileIds: z.array(z.string().min(10).max(120).regex(/^[a-zA-Z0-9_-]+$/)).max(80),
  }).parse(input))
  .handler(async ({ data }): Promise<{ map: Record<string, { modifiedTime: string; nguoiSua: string }> }> => {
    const kv = await getKv();
    const gio = Date.now();
    const kho = await docFMeta(kv);
    const map: Record<string, { modifiedTime: string; nguoiSua: string }> = {};
    const conThieu: string[] = [];
    for (const id of [...new Set(data.fileIds)]) {
      const m = kho[id];
      if (m?.modifiedTime) { map[id] = { modifiedTime: m.modifiedTime, nguoiSua: m.nguoiSua }; continue; }
      conThieu.push(id);   // CHƯA CÓ trong kho — link vừa gắn, hỏi ngay vài cái cho khỏi chờ tới mai
    }
    let doi = false;
    if (conThieu.length) {
      const nam = conThieu.slice(0, MOI_LUOT_HOI);
      try {
        const drive = await import("@/lib/drive.functions");
        // Hỏi tuần tự: mỗi lượt là một lời gọi nhẹ (chỉ metadata), bắn song song vài chục lượt
        // là Google chặn vì quá nhanh. Chỗ nào hỏi hụt thì bỏ qua, bảng chỉ khuyết dòng đó.
        for (const id of nam) {
          const m = await drive.driveFileMetaImpl(id);
          if (!m) continue;
          map[id] = { modifiedTime: m.modifiedTime, nguoiSua: m.nguoiSua };
          kho[id] = { modifiedTime: m.modifiedTime, nguoiSua: m.nguoiSua, ts: gio };
          doi = true;
        }
      } catch { /* Drive lỗi → trả về phần đã có */ }
    }
    if (doi) await ghiFMeta(kv, kho);      // MỘT lượt ghi cho cả đợt, thay vì mỗi file một lượt
    return { map };
  });

/* ── DANH SÁCH MỌI DỰ ÁN CHO APP HÌNH ẢNH MỖI NGÀY ──────────────────────────────────────────
   Danh sách ở trên chỉ gồm dự án ĐÃ GẮN LINK ma trận, nên dự án chưa có ma trận không vào được
   app ảnh — mà công trường vẫn chụp ảnh mỗi ngày như thường. Kho này gom MỌI dự án đang chạy
   (ePMP đẩy lên khi có người mở dashboard), để app ảnh liệt kê đủ: có ma trận thì bấm về từng
   căn, chưa có thì gom ảnh chung cả dự án. */
const MEDIA_PROJ_KEY = "media:projects:v1";
const DEV_MEDIA_PROJ_FILE = ".data/pmo-media-projects.json";
export type MediaProjItem = { hid?: string; maCT: string; name: string; region?: string; groupDA?: string; coMaTran?: boolean };

export const saveMediaProjects = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({
    list: z.array(z.object({
      hid: z.string().max(40).optional(),
      maCT: z.string().max(120),
      name: z.string().max(300),
      region: z.string().max(120).optional(),
      groupDA: z.string().max(300).optional(),
      coMaTran: z.boolean().optional(),
    })).max(2000),
  }).parse(input))
  .handler(async ({ data }): Promise<{ ok: boolean; n: number }> => {
    const kv = await getKv();
    if (kv) { try { await putNeuKhac(kv, MEDIA_PROJ_KEY, JSON.stringify(data.list)); } catch { /* KV lỗi → bỏ qua */ } }
    else {
      // DEV không có KV — ghi ra tệp để thử được ngay trên máy, y như các kho khác của app.
      try {
        const fsp = await import("node:fs/promises");
        await fsp.mkdir(".data", { recursive: true });
        await fsp.writeFile(DEV_MEDIA_PROJ_FILE, JSON.stringify(data.list, null, 2), "utf8");
      } catch { /* ghi hụt ở dev cũng không sao */ }
    }
    return { ok: true, n: data.list.length };
  });

export const getMediaProjects = createServerFn({ method: "POST" })
  .handler(async (): Promise<{ list: MediaProjItem[] }> => {
    const kv = await getKv();
    if (kv) {
      try { const raw = await kv.get(MEDIA_PROJ_KEY); return { list: raw ? (JSON.parse(raw) as MediaProjItem[]) : [] }; }
      catch { return { list: [] }; }
    }
    try {
      const fsp = await import("node:fs/promises");
      return { list: JSON.parse(await fsp.readFile(DEV_MEDIA_PROJ_FILE, "utf8")) as MediaProjItem[] };
    } catch { return { list: [] }; }
  });
