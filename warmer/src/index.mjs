// ── WORKER PHỤ "WARMER" — quét mỗi ngày 17:30 giờ VN (cron "30 10 * * *" = 10:30 UTC).
// Đọc registry fileId (KV sfile:index do app chính ghi mỗi lần mở Summary), fetch từng file
// Google Sheet → TÁCH riêng sheet "Summary" (fflate, nhẹ) → ghi cache KV sfile:<id> = {b64, ts}.
// Nhờ vậy báo cáo ma trận lắp đặt SẴN SÀNG mỗi sáng dù KHÔNG ai mở app; app chính đọc thẳng cache
// → tức thì. DÙNG CHUNG KV namespace PMO_EDITS với app chính (không parse xlsx → không OOM).
//
// DEPLOY (chạy 1 lần, cd vào thư mục warmer):  npx wrangler deploy
// Cron của Cloudflare tự chạy sau đó. Test tay: mở URL worker này (GET) → warm ngay.
import { unzipSync, zipSync, strFromU8 } from "fflate";

const CACHE_TTL_S = 3 * 86_400;

async function fetchXlsxById(id) {
  const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx&_ts=${Date.now()}`;
  const r = await fetch(url, {
    redirect: "follow", cache: "no-store",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ePMP-warmer/1.0)", Accept: "*/*", "Cache-Control": "no-cache, no-store" },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} khi tải ${id}`);
  return r.arrayBuffer();
}

function toB64(bytes) {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin);
}

// TÁCH sheet "Summary" thành 1 file .xlsx tối giản (~170KB) — GIỐNG HỆT app chính
// (src/lib/mtld-install.functions.ts) để app đọc cache ra đúng định dạng.
function extractSummaryXlsx(buf) {
  const data = new Uint8Array(buf);
  const meta = unzipSync(data, { filter: (f) => f.name === "xl/workbook.xml" || f.name === "xl/_rels/workbook.xml.rels" });
  const rid = strFromU8(meta["xl/workbook.xml"]).match(/<sheet[^>]*name="Summary"[^>]*r:id="([^"]+)"/)?.[1];
  if (!rid) throw new Error("Không thấy sheet Summary");
  const target = strFromU8(meta["xl/_rels/workbook.xml.rels"]).match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`))?.[1];
  if (!target) throw new Error("Không map được sheet Summary");
  const sheetPath = "xl/" + target.replace(/^\//, "");
  const parts = unzipSync(data, { filter: (f) => f.name === sheetPath || f.name === "xl/styles.xml" || f.name === "xl/sharedStrings.xml" });
  if (!parts[sheetPath]) throw new Error("Thiếu phần Summary");
  const enc = (s) => new TextEncoder().encode(s);
  const hasSS = !!parts["xl/sharedStrings.xml"];
  const ovSS = hasSS ? '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' : "";
  const relSS = hasSS ? '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' : "";
  const out = {
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

async function warmOne(kv, id) {
  const raw = await fetchXlsxById(id);
  let bytes;
  try { bytes = extractSummaryXlsx(raw); }
  catch { bytes = new Uint8Array(raw); }
  const b64 = toB64(bytes);
  await kv.put(`sfile:${id}`, JSON.stringify({ b64, ts: Date.now() }), { expirationTtl: CACHE_TTL_S });
}

async function warmAll(env) {
  const kv = env.PMO_EDITS;
  if (!kv) return { ok: 0, fail: 0, note: "thiếu KV PMO_EDITS" };
  let ids = [];
  try { const raw = await kv.get("sfile:index"); ids = raw ? JSON.parse(raw) : []; } catch { /* registry rỗng */ }
  let ok = 0, fail = 0;
  for (const id of ids) {
    try { await warmOne(kv, id); ok++; } catch { fail++; }
  }
  return { ok, fail, total: ids.length };
}

export default {
  // Cron 17:30 VN — warm sẵn mọi file trong registry.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(warmAll(env));
  },
  // Gọi tay để test: mở URL worker (GET) → warm ngay + trả kết quả.
  async fetch(_req, env) {
    const res = await warmAll(env);
    return new Response(JSON.stringify(res), { headers: { "content-type": "application/json" } });
  },
};
