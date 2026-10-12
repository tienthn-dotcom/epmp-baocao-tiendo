// ── WORKER PHỤ "WARMER" — quét mỗi ngày 17:30 giờ VN (cron "30 10 * * *" = 10:30 UTC).
// Đọc registry fileId (KV sfile:index do app chính ghi mỗi lần mở Summary), fetch từng file
// Google Sheet → TÁCH riêng sheet "Summary" (fflate, nhẹ) → ghi cache KV sfile:<id> = {b64, ts}.
// Nhờ vậy báo cáo ma trận lắp đặt SẴN SÀNG mỗi sáng dù KHÔNG ai mở app; app chính đọc thẳng cache
// → tức thì. DÙNG CHUNG KV namespace PMO_EDITS với app chính (không parse xlsx → không OOM).
//
// DEPLOY (chạy 1 lần, cd vào thư mục warmer):  npx wrangler deploy
// Cron của Cloudflare tự chạy sau đó. Test tay: mở URL worker này (GET) → warm ngay.
import { unzipSync, zipSync, strFromU8 } from "fflate";
import puppeteer from "@cloudflare/puppeteer";

const CACHE_TTL_S = 3 * 86_400;

async function fetchXlsxById(id, gid) {
  const g = gid ? `&gid=${encodeURIComponent(gid)}` : "";
  const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx${g}&_ts=${Date.now()}`;
  // KHÔNG dùng `cache: "no-store"`: Cloudflare Workers CHƯA cài field này, đặt vào là fetch ném lỗi
  // ngay ("The 'cache' field on 'RequestInitializerDict' is not implemented") — cả 24 lượt warm hỏng
  // sạch mà log thì nuốt lỗi nên không ai hay. Chống cache đã có `_ts` trên URL + header Cache-Control,
  // và cf.cacheTtl = 0 để chính Cloudflare không giữ bản cũ.
  const r = await fetch(url, {
    redirect: "follow", cf: { cacheTtl: 0, cacheEverything: false },
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

/* ── MỐC LÀM MỚI TRONG NGÀY ───────────────────────────────────────────────────
   PHẢI KHỚP MOC_LAM_MOI_VN trong src/lib/mtld-install.functions.ts. App coi bản cache ghi TRƯỚC
   mốc gần nhất là cũ; warm phải đo bằng ĐÚNG cái thước đó.

   Trước nay hai bên đo bằng hai thước khác nhau và đó là lý do thật khiến anh Tiến vẫn phải bấm
   "Làm mới": bản deploy đang chạy (01/10) warm lúc 09:00 · 14:30 · 17:30, còn app coi mốc là 18:00
   và 20:00. Nên MỌI lượt warm đều xong TRƯỚC mốc, rồi tới 18:00 là app coi chính bản vừa warm đó
   là cũ — người mở đầu tiên thấy số hôm qua, app tải lại ở nền, và lượt warm kia thành công cốc. */
const MOC_LAM_MOI_VN = [[18, 0], [20, 0]];
const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;
function mocGanNhat(now) {
  const nuaDem = Math.floor((now + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS;  // 00:00 VN hôm nay
  const moc = (ngay, i) => ngay + MOC_LAM_MOI_VN[i][0] * 3_600_000 + MOC_LAM_MOI_VN[i][1] * 60_000;
  for (let i = MOC_LAM_MOI_VN.length - 1; i >= 0; i--) { const t = moc(nuaDem, i); if (t <= now) return t; }
  return moc(nuaDem - DAY_MS, MOC_LAM_MOI_VN.length - 1);   // chưa qua mốc nào → mốc cuối hôm qua
}

/* ── SỔ MỐC — ĐỂ NỘI DUNG KHÔNG ĐỔI KHÔNG TỐN LƯỢT GHI ───────────────────────
   Gói KV free cho 1.000 lượt GHI mỗi ngày, và app đã tràn thật: 1.228 lượt ngày 03/10/2026. Warm
   cả danh sách ma trận mỗi ngày là thêm một lượt ghi cho MỖI ô, kể cả ô mà số trong đó y nguyên.
   Đo trên bảng kv_write 14 ngày gần nhất: kho `spdf2` ghi 253 lượt mà chỉ 142 nội dung khác nhau,
   tức 111 lượt (44%) ghi lại đúng byte cũ.

   Cách chặn: TÁCH mốc dữ liệu ra khỏi giá trị lớn. Mốc nằm ở MỘT khoá nhỏ dùng chung; warm tải về,
   băm, so với băm cũ:
     · băm TRÙNG → KHÔNG ghi giá trị, chỉ ghi mốc vào sổ;
     · băm KHÁC  → ghi giá trị rồi ghi mốc.
   Cả lượt warm tốn ĐÚNG 1 lượt ghi cho sổ, cộng số ô thật sự đổi. Ngày không ai sửa gì: 1 lượt.

   App đọc sổ để biết mốc thật (xem docSoMoc trong mtld-install.functions.ts). Sổ hỏng hay thiếu
   khoá → app lùi về đọc `ts` nằm trong giá trị, tức về đúng hành vi cũ. */
const SO_MOC_KEY = "warm:moc:v1";

/* TTL DÀI HƠN cho bản do warm ghi. Vì không ghi lại khi nội dung y nguyên thì TTL cũng không được
   gia hạn — để 3 ngày như app thì ô nào đứng yên 3 ngày là cache BIẾN MẤT, người mở phải chờ tải
   nguội. 10 ngày + hàng rào gia hạn dưới đây cho ô đứng yên chỉ bị ghi lại khoảng 8 ngày một lần.
   Warmer chết hẳn thì cache vẫn còn 10 ngày (cũ nhưng CÓ), app tự làm mới ở nền khi ai mở. */
const WARM_TTL_S = 10 * 86_400;
const NGUONG_GIA_HAN_S = 2 * 86_400;   // còn sống dưới 2 ngày → ghi lại để gia hạn, kể cả y nguyên

/* BĂM TRÊN BYTE THÔ, KHÔNG TRÊN CHUỖI BASE64 — và băm TRƯỚC khi base64.

   Bản đầu làm ngược: base64 cả 21 ma trận rồi mới băm chuỗi đó để so. Gọi thử trên live
   07/10/2026 ra ĐÚNG lỗi đã lường: `error code: 1102` (worker vượt tài nguyên). Base64 là chỗ
   đắt nhất trong cả lượt — nó dựng chuỗi dài gấp 4/3 lần file rồi `btoa` — mà làm nó cho MỌI ô,
   kể cả ô lát nữa phát hiện là y nguyên và vứt đi.

   Nay đảo thứ tự: băm byte thô → trùng thì DỪNG, không base64, không ghi. Ngày thường hầu hết ô
   không đổi nên cả lượt gần như chỉ còn phần tải. Băm byte cũng rẻ hơn băm chuỗi vì khỏi
   TextEncoder dựng lại 256KB.

   CHỈ 256KB ĐẦU + độ dài thật: băm trọn bản 2MB là đốt CPU ở đúng chỗ đã từng chết. Hai bản trùng
   cả 256KB đầu LẪN độ dài mà vẫn khác nhau thì bị coi là một — chấp nhận, vì hụt một lượt warm
   thì app vẫn tự làm mới khi ai mở. */
const CAT_BAM = 262_144;
async function bamByte(bytes) {
  try {
    const than = bytes.length > CAT_BAM ? bytes.subarray(0, CAT_BAM) : bytes;
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", than));
    let h = String(bytes.length) + "-";
    for (let i = 0; i < 6; i++) h += d[i].toString(16).padStart(2, "0");
    return h;
  } catch { return ""; }
}

async function docSoMoc(kv) {
  try { const raw = await kv.get(SO_MOC_KEY); const o = raw ? JSON.parse(raw) : null; return o && typeof o === "object" ? o : {}; }
  catch { return {}; }
}

/** GHI GIÁ TRỊ CHỈ KHI KHÁC bản cũ (hoặc sắp hết hạn); mốc thì LUÔN vào sổ. Trả về true nếu đã ghi.
 *  Nhận BYTE THÔ — base64 chỉ chạy ở nhánh thật sự ghi (xem ghi chú ở bamByte). */
async function ghiNeuKhac(kv, so, key, bytes, hanHet) {
  const bam = await bamByte(bytes);
  const cu = so[key];
  const bayGio = Math.floor(Date.now() / 1000);
  const sapHetHan = !hanHet || hanHet - bayGio < NGUONG_GIA_HAN_S;
  so[key] = { ...(cu || {}), ts: Date.now(), bam };
  if (cu && bam && cu.bam === bam && !sapHetHan) return false;
  await kv.put(key, JSON.stringify({ b64: toB64(bytes), ts: Date.now() }), { expirationTtl: WARM_TTL_S });
  return true;
}

/** Hạn hết của mọi khoá mang tiền tố — lấy qua list (metadata), KHÔNG đọc giá trị (mỗi bản tới 2MB). */
async function hanHetCua(kv, tienTo) {
  const han = new Map();
  try {
    let cursor;
    do {
      const p = await kv.list({ prefix: tienTo, ...(cursor ? { cursor } : {}) });
      for (const k of p.keys) if (k.expiration) han.set(k.name, k.expiration);
      cursor = p.list_complete ? null : p.cursor;
    } while (cursor);
  } catch { /* không lấy được hạn → coi như mọi khoá đều cần làm */ }
  return han;
}

/* ── TRA GID CỦA MỘT TAB ──────────────────────────────────────────────────────
   Lấy ĐÚNG khuôn regex của listTabGids trong src/lib/mtld-install.functions.ts: trang /htmlview
   CÔNG KHAI có khối script liệt kê {name: "…", …, gid: "…"} từng tab. Không cần API key, cùng mức
   quyền "Anyone with the link" như mọi thứ khác app đang đọc.

   Gid gần như không bao giờ đổi, nên NHỚ LUÔN VÀO SỔ MỐC (so[key].gid) thay vì cache riêng — sổ dù
   sao cũng ghi một lượt mỗi lần warm, nên nhớ thêm cái gid vào đó là MIỄN PHÍ. Cache riêng theo
   khoá `tabs:v1:` có TTL 6 giờ, hết hạn là lại một lượt ghi cho MỖI file — tức tự đốt đúng cái
   hạn mức đang muốn giữ. */
async function gidCuaTab(id, ten) {
  try {
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/htmlview`, {
      redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; ePMP-warmer/1.0)" },
    });
    if (!r.ok) return null;
    const h = await r.text();
    for (const m of h.matchAll(/\{name:\s*"((?:[^"\\]|\\.)*)"[\s\S]{0,300}?gid:\s*"(\d+)"/g)) {
      if (m[1].replace(/\\(.)/g, "$1").trim() === ten) return m[2];
    }
  } catch { /* .xlsx không có htmlview, hoặc mạng lỗi → lùi về đường cũ */ }
  return null;
}

/* WARM MỘT FILE SUMMARY.

   ĐƯỜNG NHẸ: `export?format=xlsx&gid=<Summary>` trả về ĐÚNG MỘT TAB → chỉ cần base64, KHÔNG giải
   nén, KHÔNG dựng lại file zip. Đo thật 07/10/2026 trên file 1le0CS6… (20 tab):
       cả file 1.391.068 byte / parse 1.427ms  ·  một tab 301.313 byte / parse 177ms
       so từng ô: 96.071 ô, 0 ô thiếu, 0 ô lệch; merge 194=194, cols 96=96, rows 1002=1002,
       ô có màu 15.464=15.464  → y nguyên cả dữ liệu lẫn định dạng.
   Phần giải nén + nén lại chính là chỗ warmer chết CPU mỗi ngày từ 07/09 tới 13/09/2026 (đụng trần
   2.010.000µs, 6 file một lượt là gãy). Bỏ được nó thì một lượt warm phủ được cả danh sách.

   LÙI VỀ ĐƯỜNG CŨ khi không tra ra gid (file .xlsx không có /htmlview) hoặc tải theo gid hỏng. Thà
   chậm như trước còn hơn để trống cache. */
async function warmOne(kv, id, so, han) {
  const key = `sfile:${id}`;
  let bytes = null;
  const gid = so[key]?.gid ?? await gidCuaTab(id, "Summary");
  if (gid) {
    try { bytes = new Uint8Array(await fetchXlsxById(id, gid)); } catch { bytes = null; }
  }
  if (!bytes) {
    const raw = await fetchXlsxById(id);
    try { bytes = extractSummaryXlsx(raw); }
    catch { bytes = new Uint8Array(raw); }
  }
  const daGhi = await ghiNeuKhac(kv, so, key, bytes, han.get(key));
  if (gid && so[key]) so[key].gid = gid;      // nhớ gid cho lượt sau, khỏi hỏi /htmlview lại
  return daGhi;
}

/* ── WARM MA TRẬN (PDF do Google render) ─────────────────────────────────────
   ĐÂY LÀ THỨ ANH TIẾN XEM: màn MTLĐ bày 21 thẻ ma trận, thẻ nào có cờ `chart` thì hiện bản PDF
   Google render (y hệt màn hình: chart + màu điều kiện + format). Cron CHƯA TỪNG warm kho này —
   nó chỉ warm file Summary .xlsx — nên tới mốc 18:00 thẻ nào cũng bị coi là cũ và người mở đầu
   tiên luôn phải bấm "Làm mới". Đó là việc anh Tiến nói "rất mất thời gian".

   RẺ HƠN warm Summary RẤT NHIỀU: Google render sẵn, worker chỉ tải byte rồi base64 — KHÔNG giải
   nén, KHÔNG nén lại file 2MB. Nhờ thế làm được CẢ danh sách trong một lượt, khác hẳn warm Summary
   (đo thật trên Cloudflare: 6 file một lượt là chết CPU, xem ghi chú ở warmAll).

   THAM SỐ URL PHẢI TRÙNG TUYỆT ĐỐI với fetchPdfOnce trong src/lib/mtld-install.functions.ts. Khác
   một tham số là ra PDF khác, mà khoá cache thì vẫn một — app sẽ bày bản warm chứ không phải bản
   nó tự tải, nên lệch là lệch âm thầm. */
const INSTALL_LIST_KEY = "mtld:install:list:v2";
const MATRAN_NGAN_SACH_MS = 60_000;
/* Ô THẬT SỰ GHI tối đa mỗi lượt. Chặn ở đây chứ không ở số ô đã xem, vì ô y nguyên gần như không
   tốn gì còn ô đổi mới phải base64.

   SỐ 12 LÀ ĐO ĐƯỢC, không phải đoán. Chạy thật trên live 07/10/2026 (44 ma trận, sổ trống):
       ghi=12 → lam 12 · ghi 12 · 29,4 giây · không lỗi
       ghi=12 → lam 12 · ghi 12 · 27,7 giây · không lỗi
       ghi=16 → lam 12 · ghi 10 · 21,0 giây · 2 ô HTTP 401 (sheet chưa mở chia sẻ)
   Tức 12 lượt ghi gói trong khoảng 30 giây và không chạm trần tài nguyên. Muốn đổi thì ĐO LẠI
   bằng cửa tay `…/?matran=1&ghi=<số>&ms=<số>` — chạy thử không cần deploy — rồi mới sửa số này.
   Cờ `dayGhi` trong log cho biết lượt nào bị chặn ở đây. */
const MATRAN_GHI_MOI_LUOT = 12;
/* Số bản tải CÙNG LÚC. Đo 07/10/2026: mỗi bản PDF Google trả về mất khoảng 4 giây, mà chờ mạng
   không ăn CPU — xếp hàng từng cái thì 44 ô cần hơn 2 phút. Lô nhỏ vì mỗi bản nằm trong bộ nhớ
   tới lúc băm xong. */
const MATRAN_SONG_SONG = 6;

/** KHỚP pdfArgsOf trong src/lib/app-shell.tsx — có gid thì cắt vùng trên tab đó, không thì "Tab!vùng". */
function pdfArgs(p) {
  const r = (p.range || "").trim();
  if (p.gid) return { gid: p.gid, range: r || undefined };
  const s = (p.sheet || "").trim();
  return { range: s && r ? `${s}!${r}` : (s || r || undefined) };
}

async function taiPdf(id, gid, range) {
  const g = gid ? `&gid=${encodeURIComponent(gid)}` : "";
  const rg = range && range.trim() ? `&range=${encodeURIComponent(range.trim())}` : "";
  const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=pdf${g}${rg}&portrait=false&scale=4&fzr=false&top_margin=0&bottom_margin=0&left_margin=0&right_margin=0&horizontal_alignment=LEFT&vertical_alignment=TOP&gridlines=true&sheetnames=false&printtitle=false&pagenumbers=false&printnotes=false&_ts=${Date.now()}`;
  const r = await fetch(url, {
    redirect: "follow", cf: { cacheTtl: 0, cacheEverything: false },
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ePMP-warmer/1.0)", Accept: "application/pdf,*/*", "Cache-Control": "no-cache, no-store" },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50) throw new Error("không phải PDF");
  return bytes;        // BYTE THÔ — base64 để dành cho nhánh thật sự ghi, xem ghi chú ở bamByte
}

/** `dieu` = hai con số điều được từ cửa tay `?matran=1&ghi=…&ms=…`, để ĐO rồi mới chốt hằng số. */
async function warmMaTran(env, dieu) {
  const ghiToiDa = (dieu && dieu.ghiToiDa) || MATRAN_GHI_MOI_LUOT;
  const nganSachMs = (dieu && dieu.nganSachMs) || MATRAN_NGAN_SACH_MS;
  const kv = env.PMO_EDITS;
  if (!kv) return { note: "thiếu KV PMO_EDITS" };
  let list = [];
  try { const raw = await kv.get(INSTALL_LIST_KEY); list = raw ? JSON.parse(raw) : []; } catch { /* chưa có danh sách */ }
  const o = list.filter((p) => p && p.chart && p.fileId);
  if (!o.length) return { tong: 0 };

  const so = await docSoMoc(kv);
  const han = await hanHetCua(kv, "spdf2:");
  const moc = mocGanNhat(Date.now());

  // Chỉ làm ô có mốc CŨ HƠN mốc làm mới gần nhất — ô vừa warm ở lượt 18:00 thì lượt 20:00 bỏ qua.
  const canLam = o.filter((p) => {
    const a = pdfArgs(p);
    const key = `spdf2:${p.fileId}:${a.gid ?? ""}:${(a.range ?? "").trim()}`;
    return (so[key]?.ts ?? 0) < moc;
  });

  let ghi = 0, nguyen = 0, hong = 0, lam = 0, hetGio = false, dayGhi = false;
  const lyDo = [];
  const batDau = Date.now();

  /* TẢI SONG SONG THEO LÔ — vì chỗ tốn là CHỜ MẠNG, không phải CPU.
     Đo trên live 07/10/2026: tải tuần tự thì 20 giây chỉ xong 5 ô trong 44 (log `lam:5, hetGio`),
     tức mỗi bản PDF Google trả về mất khoảng 4 giây. Chờ mạng KHÔNG ăn CPU, nên xếp hàng từng cái
     là phí trắng: 44 ô cần hơn 2 phút, mà một lượt chỉ có chừng ấy ngân sách.
     Lô nhỏ thôi: mỗi bản PDF nằm trong bộ nhớ tới lúc băm xong, worker có trần bộ nhớ riêng. */
  const LO = MATRAN_SONG_SONG;
  for (let i = 0; i < canLam.length; i += LO) {
    if (i > 0 && Date.now() - batDau > nganSachMs) { hetGio = true; break; }
    /* CHẶN THEO SỐ Ô THẬT SỰ GHI, không theo số ô đã xem.
       Ô y nguyên gần như không tốn gì (tải + băm byte), còn ô ĐỔI thì phải base64 — đó mới là phần
       đắt, và là thứ làm lượt gọi đầu tiên ngày 07/10/2026 chết với `error code: 1102`. Lượt đầu
       sau khi deploy thì sổ trống nên ô nào cũng tính là đổi; chặn ở đây để lượt đó không gãy, mấy
       ô còn lại để lượt sau làm — sổ đã nhớ nên không làm lại từ đầu. */
    if (ghi >= ghiToiDa) { dayGhi = true; break; }

    const lo = canLam.slice(i, i + LO);
    const tai = await Promise.all(lo.map(async (p) => {
      const a = pdfArgs(p);
      const key = `spdf2:${p.fileId}:${a.gid ?? ""}:${(a.range ?? "").trim()}`;
      try { return { key, bytes: await taiPdf(p.fileId, a.gid, a.range) }; }
      catch (e) { return { key, loi: `${p.maCT || p.fileId}: ${String(e && e.message || e).slice(0, 90)}` }; }
    }));

    // GHI thì LẦN LƯỢT: base64 là phần nặng, chạy song song chỉ dồn bộ nhớ cùng lúc chứ không nhanh hơn.
    for (const t of tai) {
      lam++;
      if (t.loi) { hong++; if (lyDo.length < 3) lyDo.push(t.loi); continue; }
      if (ghi >= ghiToiDa) { dayGhi = true; continue; }
      try {
        if (await ghiNeuKhac(kv, so, t.key, t.bytes, han.get(t.key))) ghi++; else nguyen++;
      } catch (e) { hong++; if (lyDo.length < 3) lyDo.push(`${t.key}: ${String(e && e.message || e).slice(0, 90)}`); }
    }
  }
  // MỘT lượt ghi cho cả sổ, dù vừa warm bao nhiêu ô.
  try { await kv.put(SO_MOC_KEY, JSON.stringify(so)); } catch { /* sổ hỏng → app lùi về ts trong giá trị */ }
  return { tong: o.length, canLam: canLam.length, lam, ghi, nguyen, hong, giay: Math.round((Date.now() - batDau) / 100) / 10, ...(hetGio ? { hetGio: true } : {}), ...(dayGhi ? { dayGhi: true } : {}), ...(lyDo.length ? { lyDo } : {}) };
}

/* WARM SUMMARY — CHỈ LÀM FILE SẮP HẾT HẠN, KHÔNG XOAY VÒNG MÙ.

   Mỗi file phải tải ~2MB, giải nén, tách sheet Summary, nén lại rồi base64 — rất nặng CPU. Đo thật
   trên Cloudflare: mốc 17:30 VN CHẾT vì CPU mỗi ngày từ 07/09 tới 13/09, đụng đúng trần 2.010.000µs.
   Gọi tay thì 1 file lọt, 2 file ra Error 1102. Tức ngân sách chỉ đủ VÀI file mỗi lượt.

   Lỗi nặng hơn của bản cũ: nó XOAY VÒNG theo con trỏ và nạp lại BẤT KỂ cache còn mới hay không.
   File vừa cache mười phút trước vẫn bị tải lại — đốt CPU và đốt cả một lượt GHI KV (gói free chỉ
   1.000 lượt ghi/ngày) để đổi lấy đúng con số y hệt.

   Nay: một lượt `list` lấy HẠN HẾT của mọi khoá sfile: (hạn nằm sẵn trong metadata, KHÔNG phải đọc
   giá trị 2MB), rồi chỉ làm những file đang THIẾU cache hoặc sắp hết hạn trong vòng NGUONG_LAM_MOI.
   File nào còn tươi thì bỏ qua sạch: không tải, không ghi. Nhờ vậy ngân sách nhỏ vẫn phủ được cả
   danh sách, vì mỗi ngày chỉ có vài file thật sự tới hạn. */
/* ĐƯỜNG NHẸ (xem warmOne) bỏ hẳn phần giải nén + nén lại — đúng chỗ đốt CPU. Nhờ vậy nâng từ 3 lên
   12 file mỗi lượt, tức hai mốc 18:00 + 20:00 phủ tới 24 file/ngày thay vì 6. Hàng rào thời gian
   WARM_NGAN_SACH_MS bên dưới vẫn giữ nguyên để một file nặng bất thường không kéo sập cả lượt, và
   log trả về cờ `hetGio` để biết lượt nào bị cắt giữa đường — cứ đọc log mà điều con số này, ĐỪNG
   đoán. */
const WARM_MOI_LUOT = 12;

/* CHỌN THEO MỐC LÀM MỚI, KHÔNG THEO HẠN TTL (xem khối chọn file trong warmAll). */

/* Trần CPU không đo được từ trong Worker → thêm hàng rào theo GIỜ ĐỒNG HỒ. Việc này CPU-bound nên
   hai thứ đi cùng nhau; hàng rào để một file nặng bất thường không kéo sập cả lượt. */
const WARM_NGAN_SACH_MS = 20_000;

async function warmAll(env, soLuong = WARM_MOI_LUOT) {
  const kv = env.PMO_EDITS;
  if (!kv) return { ok: 0, fail: 0, note: "thiếu KV PMO_EDITS" };
  let ids = [];
  try { const raw = await kv.get("sfile:index"); ids = raw ? JSON.parse(raw) : []; } catch { /* registry rỗng */ }
  if (!ids.length) return { ok: 0, fail: 0, total: 0 };

  const han = await hanHetCua(kv, "sfile:");
  const so = await docSoMoc(kv);

  /* CHỌN FILE THEO MỐC LÀM MỚI, KHÔNG THEO HẠN TTL.
     Bản cũ lọc "sắp hết hạn trong 1 ngày" với TTL 3 ngày, nghĩa là file vừa warm hôm nay thì HAI
     NGÀY SAU mới được warm lại. Nó giữ cho cache khỏi biến mất, nhưng KHÔNG mang về số mới — mà số
     mới mới là việc anh Tiến cần. Nay đo đúng thước của app: mốc ghi cũ hơn mốc làm mới gần nhất
     thì làm.

     Mốc ghi lấy từ sổ; sổ chưa có khoá đó thì suy từ hạn hết (hạn = lúc ghi + TTL) — nhờ vậy lượt
     chạy đầu sau khi deploy không coi cả danh sách là cũ rồi đòi warm lại sạch. */
  const moc = mocGanNhat(Date.now());
  const tsGhiCua = (key) => {
    const s = so[key]?.ts;
    if (s) return s;
    const hh = han.get(key);
    return hh ? (hh - WARM_TTL_S) * 1000 : 0;    // chưa có cache → 0 → luôn cần làm
  };
  const canLam = ids
    .map((id) => ({ id, ts: tsGhiCua(`sfile:${id}`) }))
    .filter((x) => x.ts < moc)
    .sort((a, b) => a.ts - b.ts);                 // cũ nhất làm trước
  if (!canLam.length) return { ok: 0, fail: 0, lam: 0, total: ids.length, conTuoi: ids.length };
  const lo = canLam.slice(0, Math.min(soLuong, canLam.length)).map((x) => x.id);

  let ok = 0, fail = 0, nguyen = 0, lam = 0, hetGio = false;
  const lyDo = [];   // giữ vài lỗi đầu để còn biết vì sao hỏng — nuốt sạch lỗi thì chẩn đoán bằng gì
  const batDau = Date.now();
  for (const id of lo) {
    // Hết ngân sách thì DỪNG: thà xong 1 file rồi lượt sau làm tiếp, hơn là đụng trần CPU giữa file
    // thứ hai và mất cả lượt (file đang làm dở không được ghi, coi như công cốc).
    if (lam > 0 && Date.now() - batDau > WARM_NGAN_SACH_MS) { hetGio = true; break; }
    lam++;
    try { if (await warmOne(kv, id, so, han)) ok++; else nguyen++; }
    catch (e) { fail++; if (lyDo.length < 3) lyDo.push(`${id}: ${String(e).slice(0, 120)}`); }
  }
  // MỘT lượt ghi cho cả sổ, dù vừa warm bao nhiêu file.
  try { await kv.put(SO_MOC_KEY, JSON.stringify(so)); } catch { /* sổ hỏng → app lùi về ts trong giá trị */ }
  // KHÔNG còn con trỏ: thứ tự do ĐỘ GẤP quyết định, nên chẳng có gì phải nhớ giữa hai lượt —
  // bớt luôn một lượt ghi KV mỗi lần chạy.
  return { ok, fail, nguyen, lam, total: ids.length, canLam: canLam.length, ...(hetGio ? { hetGio: true } : {}), ...(lyDo.length ? { lyDo } : {}) };
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  SAO LƯU NHẬT KÝ GIÁM SÁT (D1 access_log) → GOOGLE DRIVE (tự động mỗi ngày).
 *  Drive giữ bản đầy đủ → giảm tải cho app. Ghi ĐÈ 1 file mirror "nhat-ky-giam-sat.csv"
 *  trong "Data Source" › DATABASE › ePMP › Nhật ký giám sát (CÙNG file với nút bấm tay trong app).
 *  Cần: D1 binding PMO_LOG + 3 secret GDRIVE_OAUTH_CLIENT_ID/_CLIENT_SECRET/_REFRESH trên warmer.
 * ═══════════════════════════════════════════════════════════════════════════ */
const DRIVE_ROOT_DEFAULT = "1O9VktCpBENaZB1xgABr8MfIbl3YW8hFO"; // folder "Data Source" (đè bằng env.GDRIVE_ROOT)
const DRIVE_SHARED = "supportsAllDrives=true&includeItemsFromAllDrives=true";
const AUDIT_PATH = ["DATABASE", "ePMP", "Nhật ký giám sát"];   // KHỚP ensureDbPath của app (DATABASE + segments)
const AUDIT_FILE = "nhat-ky-giam-sat.csv";

/* ── BÁO CÁO TUÂN THỦ → PDF (tự động, không cần ai bật máy) ────────────────────
 *  Bảng tuân thủ nằm trong Google Sheet nên Google tự xuất PDF được — worker chỉ
 *  cần gọi đường /export rồi ghi thẳng vào Drive. KHÔNG cần trình duyệt, khác với
 *  nút "Xuất PDF" trên app (nút đó chụp lại giao diện nên phải có trình duyệt thật).
 *  Đặt tên TRÙNG KHUÔN bản app xuất tay để chỗ gửi mail "lấy PDF mới nhất" khỏi sửa. */
const CPL_PATH = ["DATABASE", "ePMP", "Báo cáo tuân thủ"];
const CPL_SHEET_ID = "15pcqb0ExFQ5uF9CuKSx6O6y9GN4kfiNf6IARN98pJbA";
const CPL_GID = "490936703";
/* TÊN FILE — khuôn PMO chốt 05/10/2026, TRÙNG KHUÔN bản app xuất tay:
       yymmdd_Báo cáo tuân thủ cập nhật Master Plan_MM.YYYY.pdf
   `yymmdd` = ngày dựng file, `MM.YYYY` = kỳ báo cáo. Máy dựng tự động thì hai mốc này cùng tháng,
   nhưng vẫn ghi đủ để một dãy file đọc lên là biết kỳ nào, khỏi suy từ ngày. */
const CPL_TEN = "Báo cáo tuân thủ cập nhật Master Plan";

async function driveToken(env) {
  const body = new URLSearchParams({
    client_id: env.GDRIVE_OAUTH_CLIENT_ID, client_secret: env.GDRIVE_OAUTH_CLIENT_SECRET,
    refresh_token: env.GDRIVE_OAUTH_REFRESH, grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("Drive token: " + (j.error_description || j.error || "?"));
  return j.access_token;
}
async function driveEnsureFolder(token, name, parent) {
  const AUTH = { Authorization: `Bearer ${token}` };
  const q = `name='${name.replace(/'/g, "\\'")}' and '${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&${DRIVE_SHARED}`, { headers: AUTH });
  const j = await r.json();
  if (j.files && j.files.length) return j.files[0].id;
  const cr = await fetch(`https://www.googleapis.com/drive/v3/files?${DRIVE_SHARED}&fields=id`, {
    method: "POST", headers: { ...AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }),
  });
  const cj = await cr.json();
  if (!cj.id) throw new Error("Tạo folder Drive lỗi: " + (cj.error?.message || "?"));
  return cj.id;
}
function csvCell(v) { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

async function backupAuditLog(env) {
  const d1 = env.PMO_LOG;
  if (!d1) return { skip: "thiếu D1 PMO_LOG" };
  if (!env.GDRIVE_OAUTH_CLIENT_ID || !env.GDRIVE_OAUTH_REFRESH) return { skip: "thiếu secret GDRIVE_OAUTH_*" };
  // Đọc TOÀN BỘ log (cũ → mới). Bảng có thể chưa tồn tại nếu app chưa ghi lần nào.
  let rows = [];
  try {
    const res = await d1.prepare("SELECT ts, email, action, detail FROM access_log ORDER BY ts ASC").all();
    rows = res.results || [];
  } catch (e) { return { skip: "chưa có bảng access_log (" + e + ")" }; }

  const header = ["Thời điểm (ISO)", "Người dùng", "Thao tác", "Chi tiết"];
  const lines = rows.map((r) => [r.ts, r.email, r.action, r.detail ?? ""].map(csvCell).join(","));
  const csv = "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n";   // BOM cho Excel VN
  const b64 = toB64(new TextEncoder().encode(csv));

  const token = await driveToken(env);
  const root = env.GDRIVE_ROOT || DRIVE_ROOT_DEFAULT;
  let folder = root;
  for (const seg of AUDIT_PATH) folder = await driveEnsureFolder(token, seg, folder);

  const AUTH = { Authorization: `Bearer ${token}` };
  const q = `name='${AUDIT_FILE}' and '${folder}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`;
  const fr = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&${DRIVE_SHARED}`, { headers: AUTH });
  const fj = await fr.json();
  const existing = fj.files && fj.files[0] && fj.files[0].id;
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  if (existing) {
    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=media&fields=id&${DRIVE_SHARED}`, {
      method: "PATCH", headers: { ...AUTH, "Content-Type": "text/csv" }, body: bytes,
    });
  } else {
    const boundary = "warmerAudit" + Date.now();
    const enc = new TextEncoder();
    const meta = JSON.stringify({ name: AUDIT_FILE, parents: [folder] });
    const pre = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: text/csv\r\n\r\n`);
    const post = enc.encode(`\r\n--${boundary}--`);
    const bodyBuf = new Uint8Array(pre.length + bytes.length + post.length);
    bodyBuf.set(pre, 0); bodyBuf.set(bytes, pre.length); bodyBuf.set(post, pre.length + bytes.length);
    await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&${DRIVE_SHARED}`, {
      method: "POST", headers: { ...AUTH, "Content-Type": `multipart/related; boundary=${boundary}` }, body: bodyBuf,
    });
  }
  return { rows: rows.length, updated: !!existing };
}


/**
 * SAO LƯU TOÀN BỘ DỮ LIỆU APP (KV) RA DRIVE — mỗi ngày một lần.
 *
 * Mọi thứ người dùng gõ vào app đều nằm trong KV: ghi chú vướng mắc, ngày hoàn thành, phân cấp
 * người dùng, dòng đã ẩn, link ma trận, form bảng, nguồn DST, ảnh dự án… KV chỉ có MỘT bản. Hỏng
 * hoặc lỡ tay xoá là mất trắng, không có chỗ nào đọc lại.
 *
 * Nay mỗi ngày gom hết thành một file JSON đặt ở:
 *   Data Source › DATABASE › ePMP › Sao lưu dữ liệu ›
 *     · epmp-du-lieu-YYYY-MM-DD.json  (một bản mỗi ngày — lần ngược lại được)
 *     · epmp-du-lieu-latest.json      (bản mới nhất, ghi đè — chỗ để lấy khi cần phục hồi)
 *
 * BỎ QUA hai loại khoá: `sfile:` (bản xlsx cache, tải lại được từ Google) và `sheetsnap:` (ảnh HTML
 * dựng lại được từ file gốc) — chúng nặng vài MB mà không phải dữ liệu người dùng nhập.
 */
// PHẢI có "DATABASE" ở đầu như AUDIT_PATH/CPL_PATH — thiếu là file rơi ra ngoài, đẻ thêm một
// folder "ePMP" lạc ngay dưới "Data Source" trong khi cả app dùng "Data Source › DATABASE › ePMP".
const KV_BACKUP_PATH = ["DATABASE", "ePMP", "Sao lưu dữ liệu"];
const KV_SKIP = /^(sfile:|sheetsnap:)/;

async function backupKvData(env) {
  const kv = env.PMO_EDITS;
  if (!kv) return { skip: "thiếu KV PMO_EDITS" };
  if (!env.GDRIVE_OAUTH_CLIENT_ID || !env.GDRIVE_OAUTH_REFRESH) return { skip: "thiếu secret GDRIVE_OAUTH_*" };

  // Duyệt hết khoá (KV trả theo trang 1000 khoá).
  const keys = [];
  let cursor;
  do {
    const page = await kv.list(cursor ? { cursor } : {});
    for (const k of page.keys) if (!KV_SKIP.test(k.name)) keys.push(k.name);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  const data = {};
  let bo = 0;
  for (const k of keys) {
    const raw = await kv.get(k);
    if (raw == null) { bo++; continue; }
    // Giữ nguyên dạng: JSON thì lồng thẳng vào (đọc bằng mắt được), còn lại để chuỗi.
    try { data[k] = JSON.parse(raw); } catch { data[k] = raw; }
  }

  const now = new Date(Date.now() + 7 * 3600_000);
  const p2 = (n) => String(n).padStart(2, "0");
  const ngay = `${now.getUTCFullYear()}-${p2(now.getUTCMonth() + 1)}-${p2(now.getUTCDate())}`;
  const json = JSON.stringify({
    app: "ePMP", luc: now.toISOString().replace("Z", "+07:00 (giờ VN)"), soKhoa: keys.length, boQua: bo, data,
  }, null, 1);
  const bytes = new TextEncoder().encode(json);

  const token = await driveToken(env);
  const root = env.GDRIVE_ROOT || DRIVE_ROOT_DEFAULT;
  let folder = root;
  for (const seg of KV_BACKUP_PATH) folder = await driveEnsureFolder(token, seg, folder);

  for (const name of [`epmp-du-lieu-${ngay}.json`, "epmp-du-lieu-latest.json"]) {
    await driveUpsertFile(token, folder, name, "application/json", bytes);
  }
  return { keys: keys.length, bytes: bytes.length, ngay };
}

/** Ghi 1 file vào folder Drive: có sẵn thì đè nội dung, chưa có thì tạo mới. */
async function driveUpsertFile(token, folder, name, mime, bytes) {
  const AUTH = { Authorization: `Bearer ${token}` };
  const q = `name='${name.replace(/'/g, "\\'")}' and '${folder}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`;
  const fr = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&${DRIVE_SHARED}`, { headers: AUTH });
  const fj = await fr.json();
  const existing = fj.files && fj.files[0] && fj.files[0].id;
  if (existing) {
    const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=media&fields=id&${DRIVE_SHARED}`, {
      method: "PATCH", headers: { ...AUTH, "Content-Type": mime }, body: bytes,
    });
    if (!r.ok) throw new Error(`Ghi đè ${name} lỗi ${r.status}`);
    return existing;
  }
  const boundary = "warmerUp" + Date.now();
  const enc = new TextEncoder();
  const meta = JSON.stringify({ name, parents: [folder] });
  const pre = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
  const post = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(pre.length + bytes.length + post.length);
  body.set(pre, 0); body.set(bytes, pre.length); body.set(post, pre.length + bytes.length);
  const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&${DRIVE_SHARED}`, {
    method: "POST", headers: { ...AUTH, "Content-Type": `multipart/related; boundary=${boundary}` }, body,
  });
  const j = await r.json();
  if (!j.id) throw new Error(`Tạo ${name} lỗi: ` + (j.error?.message || "?"));
  return j.id;
}


/* ═══════════════════════════════════════════════════════════════════════════
 *  DẤU VÂN TAY FILE NGUỒN — trả lời câu "hôm nay có ai đụng vào file không?"
 *
 *  Cột "Ngày update" trong báo cáo là do PM tự gõ, nên gõ cho có cũng thành "vừa cập nhật".
 *  Ở đây hỏi thẳng Drive mã kiểm tra (md5) và giờ sửa của CHÍNH file nguồn: đổi md5 nghĩa là
 *  nội dung thật sự khác đi, không đổi nghĩa là cả ngày không ai sửa gì — bất kể ô ngày ghi gì.
 *
 *  KHÔNG tải và KHÔNG mở file: chỉ hỏi metadata, tốn một lượt gọi nhẹ. Đây cũng là lý do việc
 *  này nằm ở worker chứ không ở app — chạy mỗi đêm, không cần ai mở app.
 *  (Muốn biết DÒNG NÀO đổi thì phải mở file — việc đó để app làm lúc nó vốn đã mở file sẵn,
 *  vì mở file .xlsx 2MB trên worker là cách chắc chắn dẫn tới Error 1102.)
 * ═══════════════════════════════════════════════════════════════════════════ */
const SRC_FP_KEY = "srcfp:v1";   // { fileId, md5, modifiedTime, doiLuc: [ngày…] }

async function chamVanTayNguon(env) {
  const kv = env.PMO_EDITS;
  if (!kv) return { skip: "thiếu KV PMO_EDITS" };
  if (!env.GDRIVE_OAUTH_CLIENT_ID || !env.GDRIVE_OAUTH_REFRESH) return { skip: "thiếu secret GDRIVE_OAUTH_*" };

  let cfg = {};
  try { cfg = JSON.parse((await kv.get("config:v1")) || "{}"); } catch { /* config hỏng */ }
  const url = cfg.sheetUrl || "";
  const fileId = (url.match(/\/d\/([A-Za-z0-9_-]+)/) || [])[1];
  if (!fileId) return { skip: "chưa cấu hình link nguồn" };

  const token = await driveToken(env);
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=md5Checksum,modifiedTime,size,name,lastModifyingUser(displayName,emailAddress)&${DRIVE_SHARED}`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return { loi: `Drive trả mã ${r.status}` };
  const j = await r.json();

  let cu = {};
  try { cu = JSON.parse((await kv.get(SRC_FP_KEY)) || "{}"); } catch { /* lần đầu */ }
  const now = new Date(Date.now() + 7 * 3600_000);
  const p2 = (n) => String(n).padStart(2, "0");
  const ngay = `${now.getUTCFullYear()}-${p2(now.getUTCMonth() + 1)}-${p2(now.getUTCDate())}`;

  // md5 chỉ có với file tải lên (xlsx). Google Sheet gốc không có md5 → lùi về modifiedTime.
  const dau = j.md5Checksum || j.modifiedTime || "";
  const doi = !!cu.dau && dau !== cu.dau;
  const lichSu = Array.isArray(cu.doiLuc) ? cu.doiLuc : [];
  if (doi && !lichSu.includes(ngay)) lichSu.push(ngay);

  const moi = {
    fileId, dau,
    ten: j.name || "",
    modifiedTime: j.modifiedTime || "",
    nguoiSua: j.lastModifyingUser?.displayName || j.lastModifyingUser?.emailAddress || "",
    // Ngày GẦN NHẤT thấy nội dung đổi thật. Lần đầu chấm thì lấy luôn hôm nay làm mốc.
    doiGanNhat: doi || !cu.dau ? ngay : cu.doiGanNhat || ngay,
    doiLuc: lichSu.slice(-180),   // giữ nửa năm gần nhất, đủ để đếm nhịp cập nhật
    chamLuc: now.toISOString(),
  };
  await kv.put(SRC_FP_KEY, JSON.stringify(moi));
  return { doi, doiGanNhat: moi.doiGanNhat, modifiedTime: moi.modifiedTime, nguoiSua: moi.nguoiSua, soLanDoi: lichSu.length };
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  CAMERA CÔNG TRƯỜNG — MỖI NGÀY MỘT TẤM, TỰ VỀ DRIVE
 *
 *  Vì sao làm ở worker chứ không ở app: ảnh phải chụp ĐÚNG MỘT KHUNG GIỜ mỗi ngày cho cả
 *  ~100 camera, không phụ thuộc ai mở máy. Worker có cron sẵn nên gắn thẳng vào đây.
 *
 *  Đường đi: EZVIZ Open API cấp accessToken từ (appKey, appSecret) → gọi /device/capture cho
 *  từng camera → API trả về một URL ảnh sống ngắn hạn → tải ảnh đó về rồi đẩy lên Drive, VÀO
 *  ĐÚNG thư mục ảnh của căn: "Data Source › DATABASE › ePMP › Media › <MÃ CT> › [Toà] › <Căn> ›
 *  Hình ảnh". Nhờ vậy ảnh camera nằm chung chỗ với ảnh người chụp tay, app không phải sửa gì.
 *
 *  Cần hai secret (đặt bằng `npx wrangler secret put` trong thư mục warmer):
 *     EZVIZ_APP_KEY · EZVIZ_APP_SECRET     ← lấy ở tài khoản open.ezvizlife.com
 *  Chưa có secret thì mọi hàm dưới đây trả về { skip } và KHÔNG làm gì — cron vẫn chạy phần khác.
 *
 *  Danh sách camera nằm ở KV `cam:list:v1`, dạng:
 *     [{ serial, kenh, maCT, duAn, toa, can, tat }]
 *  serial = số máy in trên thân camera; kenh mặc định 1; toa để trống nếu dự án không chia toà;
 *  tat = true thì bỏ qua camera đó. Sửa danh sách bằng app (màn cấu hình) hoặc bằng tay trong KV.
 * ═══════════════════════════════════════════════════════════════════════════ */
const CAM_LIST_KEY = "cam:list:v1";
const CAM_TOKEN_KEY = "cam:token:v1";        // { token, hetHan } — token EZVIZ sống 7 ngày
const CAM_LOG_KEY = "cam:log:v1";            // nhật ký 30 lần chụp gần nhất, để soi khi ảnh không về
const EZVIZ_BASE_DEFAULT = "https://isgpopen.ezvizlife.com";   // vùng Đông Nam Á; đè bằng env.EZVIZ_BASE

/** Bỏ ký tự Drive không nhận — khớp mediaSafe() của app để trùng đúng thư mục app đang dùng. */
function camSafe(s) {
  return String(s || "").trim().replace(/[\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").slice(0, 60);
}
/** Mã CT chuẩn hoá: "ct25-040, 038…" → "CT25-040". Khớp maCTChuan() của app. */
function camMaCT(ma) {
  const dau = String(ma || "").split(/[,;/]/)[0].replace(/\s+/g, "").toUpperCase();
  return /^CT\d{2}-\d+$/.test(dau) ? dau : "";
}

/** accessToken của EZVIZ — sống 7 ngày, nhớ trong KV để khỏi xin lại mỗi lần chụp. */
async function camToken(env) {
  const kv = env.PMO_EDITS;
  const key = env.EZVIZ_APP_KEY, secret = env.EZVIZ_APP_SECRET;
  if (!key || !secret) return null;
  if (kv) {
    try {
      const cu = JSON.parse((await kv.get(CAM_TOKEN_KEY)) || "{}");
      if (cu.token && cu.hetHan && Date.now() < cu.hetHan - 60_000) return cu.token;
    } catch { /* cache hỏng → xin lại */ }
  }
  const base = env.EZVIZ_BASE || EZVIZ_BASE_DEFAULT;
  const r = await fetch(`${base}/api/lapp/token/get`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ appKey: key, appSecret: secret }),
  });
  const j = await r.json().catch(() => ({}));
  const tok = j?.data?.accessToken;
  if (!tok) throw new Error(`EZVIZ không cấp token (code ${j?.code ?? r.status}: ${j?.msg || "không rõ"})`);
  if (kv) {
    // expireTime là mốc mili-giây; thiếu thì coi như 6 ngày cho chắc.
    const hetHan = Number(j.data.expireTime) || (Date.now() + 6 * 864e5);
    try { await kv.put(CAM_TOKEN_KEY, JSON.stringify({ token: tok, hetHan })); } catch { /* bỏ qua */ }
  }
  return tok;
}

/** Bảo camera chụp một tấm NGAY → trả về URL ảnh (sống ngắn hạn). */
async function camChup(env, token, serial, kenh) {
  const base = env.EZVIZ_BASE || EZVIZ_BASE_DEFAULT;
  const r = await fetch(`${base}/api/lapp/device/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ accessToken: token, deviceSerial: serial, channelNo: String(kenh || 1) }),
  });
  const j = await r.json().catch(() => ({}));
  const url = j?.data?.picUrl;
  if (!url) throw new Error(`chụp hụt (code ${j?.code ?? r.status}: ${j?.msg || "không rõ"})`);
  return url;
}

/* DANH SÁCH CAMERA ĐỌC TỪ MỘT FILE CSV TRÊN DRIVE — "DATABASE › ePMP › Camera › camera-list.csv".
   Vì sao CSV chứ không phải màn hình nhập trong app: gần 100 camera, mỗi cái phải gắn với đúng
   dự án / toà / căn — việc đó làm trong Excel nhanh hơn hẳn gõ web, và ai cũng sửa được.
   Cột: serial,kenh,maCT,duAn,toa,can,tat   (kenh trống = 1; tat = "x" thì bỏ qua camera đó)
   Chưa có file thì worker TỰ TẠO file mẫu chỉ có dòng tiêu đề, để người dùng mở ra điền luôn. */
const CAM_PATH = ["DATABASE", "ePMP", "Camera"];
const CAM_FILE = "camera-list.csv";
const CAM_MAU = "serial,kenh,maCT,duAn,toa,can,tat\n";

function tachCsv(text) {
  const dong = String(text || "").split(/\r?\n/).filter((d) => d.trim());
  if (dong.length < 2) return [];
  const cot = dong[0].split(",").map((x) => x.trim().toLowerCase());
  const idx = (ten) => cot.indexOf(ten);
  const ra = [];
  for (const d of dong.slice(1)) {
    const o = d.split(",").map((x) => x.trim());
    const lay = (ten) => (idx(ten) >= 0 ? (o[idx(ten)] || "") : "");
    const serial = lay("serial");
    if (!serial) continue;
    ra.push({
      serial, kenh: Number(lay("kenh")) || 1, maCT: lay("mact"),
      duAn: lay("duan"), toa: lay("toa"), can: lay("can"),
      tat: /^(x|1|true|tat)$/i.test(lay("tat")),
    });
  }
  return ra;
}

/** Đọc danh sách camera: ưu tiên CSV trên Drive; không có thì lùi về KV `cam:list:v1`. */
async function docDanhSachCamera(env, driveTok, root) {
  const AUTH = { Authorization: `Bearer ${driveTok}` };
  let folder = root;
  for (const seg of CAM_PATH) folder = await driveEnsureFolder(driveTok, seg, folder);
  const q = `name='${CAM_FILE}' and '${folder}' in parents and trashed=false`;
  const fr = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&${DRIVE_SHARED}`, { headers: AUTH });
  const fj = await fr.json().catch(() => ({}));
  const id = fj.files && fj.files[0] && fj.files[0].id;
  if (!id) {
    // Chưa có file → tạo file mẫu để người dùng mở ra điền, khỏi phải tự đoán cột.
    try { await driveUpsertFile(driveTok, folder, CAM_FILE, "text/csv", new TextEncoder().encode(CAM_MAU)); } catch { /* tạo hụt cũng không chặn */ }
    return { ds: [], nguon: `vừa tạo file mẫu trên Drive: ${CAM_PATH.join(" › ")} › ${CAM_FILE}` };
  }
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&${DRIVE_SHARED}`, { headers: AUTH });
  if (r.ok) {
    const ds = tachCsv(await r.text());
    if (ds.length) return { ds, nguon: "CSV trên Drive" };
  }
  const kv = env.PMO_EDITS;
  if (kv) {
    try {
      const j = JSON.parse((await kv.get(CAM_LIST_KEY)) || "[]");
      if (Array.isArray(j) && j.length) return { ds: j, nguon: "KV cam:list:v1" };
    } catch { /* KV hỏng */ }
  }
  return { ds: [], nguon: "chưa có camera nào trong CSV" };
}

/** Chụp toàn bộ camera trong danh sách rồi đẩy ảnh vào đúng thư mục căn trên Drive. */
async function chupCameraHangNgay(env) {
  const kv = env.PMO_EDITS;
  if (!kv) return { skip: "thiếu KV PMO_EDITS" };
  if (!env.EZVIZ_APP_KEY || !env.EZVIZ_APP_SECRET) return { skip: "chưa đặt secret EZVIZ_APP_KEY / EZVIZ_APP_SECRET" };
  if (!env.GDRIVE_OAUTH_CLIENT_ID || !env.GDRIVE_OAUTH_REFRESH) return { skip: "thiếu secret GDRIVE_OAUTH_*" };

  const driveTok = await driveToken(env);
  const root = env.GDRIVE_ROOT || DRIVE_ROOT_DEFAULT;
  const { ds: dsThô, nguon } = await docDanhSachCamera(env, driveTok, root);
  const ds = dsThô.filter((c) => c && c.serial && !c.tat);
  if (!ds.length) return { skip: `chưa có camera nào để chụp — ${nguon}` };

  const token = await camToken(env);
  const now = new Date(Date.now() + 7 * 3600_000);
  const p2 = (n) => String(n).padStart(2, "0");
  const stamp = `${p2(now.getUTCDate())}-${p2(now.getUTCMonth() + 1)}-${String(now.getUTCFullYear()).slice(2)}`;
  const gio = `${p2(now.getUTCHours())}:${p2(now.getUTCMinutes())}`;

  const xong = [], hong = [];
  for (const c of ds) {
    try {
      const picUrl = await camChup(env, token, c.serial, c.kenh);
      const anh = await fetch(picUrl);
      if (!anh.ok) throw new Error(`tải ảnh về lỗi ${anh.status}`);
      const bytes = new Uint8Array(await anh.arrayBuffer());
      if (bytes.length < 1024) throw new Error("ảnh rỗng (dưới 1KB)");

      // Đúng cây thư mục của app: DATABASE › ePMP › Media › <MÃ CT> › [Toà] › <Căn> › Hình ảnh
      const thuMucDuAn = camMaCT(c.maCT) || camSafe(c.duAn) || "Khac";
      const duong = ["DATABASE", "ePMP", "Media", thuMucDuAn];
      if (camSafe(c.toa)) duong.push(camSafe(c.toa));
      if (camSafe(c.can)) duong.push(camSafe(c.can));
      duong.push("Hình ảnh");
      let folder = root;
      for (const seg of duong) folder = await driveEnsureFolder(driveTok, seg, folder);

      // Tên tệp giữ đúng khuôn app đang đọc: "<căn>_<dd-mm-yy>_<hậu tố>.jpg" — thêm chữ "cam" để
      // phân biệt ảnh máy tự chụp với ảnh người chụp tay.
      const dau = camSafe(c.can) || thuMucDuAn;
      const ten = `${dau}_${stamp}_cam${p2(now.getUTCHours())}${p2(now.getUTCMinutes())}.jpg`;
      await driveUpsertFile(driveTok, folder, ten, "image/jpeg", bytes);
      xong.push(`${c.serial} → ${duong.slice(3).join("/")}/${ten}`);
    } catch (e) {
      hong.push(`${c.serial}: ${e.message}`);
    }
  }

  const ket = { ngay: `${now.getUTCFullYear()}-${p2(now.getUTCMonth() + 1)}-${p2(now.getUTCDate())}`, gio, xong: xong.length, hong: hong.length, loi: hong.slice(0, 10) };
  try {
    const cu = JSON.parse((await kv.get(CAM_LOG_KEY)) || "[]");
    await kv.put(CAM_LOG_KEY, JSON.stringify([ket, ...(Array.isArray(cu) ? cu : [])].slice(0, 30)));
  } catch { /* ghi nhật ký hụt cũng không chặn việc chụp */ }
  return ket;
}

/** Xuất PDF báo cáo tuân thủ từ Google Sheet → ghi đè vào Drive (1 file / 1 ngày). */
async function backupCompliancePdf(env) {
  if (!env.GDRIVE_OAUTH_CLIENT_ID || !env.GDRIVE_OAUTH_REFRESH) return { skip: "thiếu secret GDRIVE_OAUTH_*" };
  const token = await driveToken(env);
  const AUTH = { Authorization: `Bearer ${token}` };

  // Khổ ngang A3, vừa bề ngang, bỏ lưới + mấy thứ Google chèn thêm.
  const url = `https://docs.google.com/spreadsheets/d/${CPL_SHEET_ID}/export?format=pdf&gid=${CPL_GID}`
    // printnotes=false: khỏi dính thêm một trang chỉ chứa ghi chú ô (xem mtld-install.functions.ts).
    + "&portrait=false&size=A3&scale=4&fitw=true&gridlines=false&printtitle=false&sheetnames=false&pagenumbers=false&printnotes=false"
    + "&top_margin=0.30&bottom_margin=0.30&left_margin=0.30&right_margin=0.30";
  const pr = await fetch(url, { headers: AUTH });
  if (!pr.ok) return { error: `export ${pr.status}` };
  const bytes = new Uint8Array(await pr.arrayBuffer());
  // Google trả trang lỗi HTML với status 200 khi thiếu quyền → kiểm chữ ký %PDF- cho chắc.
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    return { error: "nội dung trả về không phải PDF (nhiều khả năng thiếu quyền đọc file)" };
  }

  // Ngày theo GIỜ VN (worker chạy UTC) — tên file phải là ngày của người dùng.
  const vn = new Date(Date.now() + 7 * 3600_000);
  const p2 = (n) => String(n).padStart(2, "0");
  const yy = String(vn.getUTCFullYear()).slice(2), mm = p2(vn.getUTCMonth() + 1), dd = p2(vn.getUTCDate());
  const name = `${yy}${mm}${dd}_${CPL_TEN}_${mm}.${vn.getUTCFullYear()}.pdf`;

  const root = env.GDRIVE_ROOT || DRIVE_ROOT_DEFAULT;
  let folder = root;
  for (const seg of CPL_PATH) folder = await driveEnsureFolder(token, seg, folder);

  const q = `name='${name}' and '${folder}' in parents and trashed=false`;
  const fr = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&${DRIVE_SHARED}`, { headers: AUTH });
  const fj = await fr.json();
  const existing = fj.files && fj.files[0] && fj.files[0].id;

  if (existing) {
    // GHI ĐÈ đúng file cũ (PATCH) thay vì xoá rồi tạo: không có khoảnh khắc nào thư mục thiếu file,
    // phòng đúng lúc đó bên gửi mail đang quét.
    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=media&fields=id&${DRIVE_SHARED}`, {
      method: "PATCH", headers: { ...AUTH, "Content-Type": "application/pdf" }, body: bytes,
    });
  } else {
    const boundary = "warmerCpl" + Date.now();
    const enc = new TextEncoder();
    const meta = JSON.stringify({ name, parents: [folder] });
    const pre = enc.encode(`--${boundary}
Content-Type: application/json; charset=UTF-8

${meta}
--${boundary}
Content-Type: application/pdf

`);
    const post = enc.encode(`
--${boundary}--`);
    const body = new Uint8Array(pre.length + bytes.length + post.length);
    body.set(pre, 0); body.set(bytes, pre.length); body.set(post, pre.length + bytes.length);
    await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&${DRIVE_SHARED}`, {
      method: "POST", headers: { ...AUTH, "Content-Type": `multipart/related; boundary=${boundary}` }, body,
    });
  }
  return { name, kb: Math.round(bytes.length / 1024), updated: !!existing };
}

/* ── TỰ BẤM NÚT "CẬP NHẬT BẢN GỬI MAIL" TRÊN APP ───────────────────────────────
 *
 * Anh Tiến 01/10/2026: "cái file tôi muốn nằm trong đó, là file export từ app, chứ không phải
 * là file chụp từ file nguồn" / "nút cập nhật bản gửi mail, tôi muốn nó tự hoạt động vào mỗi
 * 20 giờ ngày thứ 4, đơn giản vậy thôi".
 *
 * Nút đó dựng PDF bằng cách CHỤP GIAO DIỆN (html2canvas → jsPDF) nên bắt buộc có trình duyệt
 * thật. Đó đúng là lý do backupCompliancePdf bên trên phải đi đường Google export Sheet→PDF, và
 * ra file ~135KB khác hẳn bản app ~1.5MB — tức KHÔNG phải thứ anh Tiến cần đính mail.
 *
 * NÊN: mở app bằng trình duyệt trên mây, đưa cờ ?tudong=1, rồi để CHÍNH APP chạy đúng hàm của
 * nút. Không dựng lại form ở đây — một form, một renderer, không có chỗ để lệch nhau.
 * App ghi kết quả vào #tudong-ketqua ("xong <tên file>" / "hut <lý do>") vì ở đây không thấy toast.
 */
const APP_URL = "https://baocao-tiendo-pmo.tienthn.workers.dev";

/* ═══════════════════════════════════════════════════════════════════════════
 *  TỰ CHẤM TUÂN THỦ MỖI NGÀY — worker chỉ BẤM GIỜ, app mới làm
 *
 *  Anh Tiến 12/10/2026: *"app của chúng ta sẽ auto data đẩy dữ liệu về đây […] mục tiêu của
 *  việc này là để giảm tải việc tôi phải ngồi rà soát mỗi ngày"*.
 *
 *  VIỆC THẬT NẰM BÊN APP (src/lib/cham-bcn.functions.ts): hỏi Drive xem file ma trận nào hôm
 *  nay có người sửa, hỏi nhật ký xem ai xuất PDF, rồi ghi dấu vào file nguồn bằng Sheets API.
 *
 *  VÌ SAO KHÔNG LÀM LUÔN Ở ĐÂY: gói free cho TỐI ĐA 50 lượt gọi mạng mỗi lần worker chạy. Hai
 *  mốc 18:00/20:00 đã nuôi warmAll + warmMaTran, cộng thêm ~30 lượt hỏi Drive/Sheets nữa là
 *  chạm trần — mà chạm trần thì lượt gọi sau cùng ĐỨT GIỮA CHỪNG, không báo gì. Gọi sang app
 *  thì app có ngân sách riêng của nó, và luật chấm nằm chung chỗ với bộ kiểm.
 *
 *  Chìa là RENDER_TOKEN, dùng chung với cửa dựng PDF — warmer vốn đã có secret đó. */
/* GOI APP QUA SERVICE BINDING. Worker goi worker khac bang URL cong khai thi Cloudflare chan
   thang: error code 1042 (do dung thu 12/10/2026). Binding "APP" di trong mang noi bo.
   Van giu duong fetch thuong lam duong lui, phong khi binding chua kip khai. */
async function gapApp(env, u) {
  const req = new Request(u, { headers: { "x-epmp-render": env.RENDER_TOKEN } });
  return env.APP ? env.APP.fetch(req) : fetch(req);
}

async function goiChamBcn(env, chot) {
  if (!env.RENDER_TOKEN) return { skip: "thiếu secret RENDER_TOKEN" };
  const u = `${APP_URL}/may/cham-bcn?chot=${chot ? 1 : 0}`;
  const r = await gapApp(env, u);
  const chu = await r.text();
  if (!r.ok) return { loi: `app trả mã ${r.status}`, than: chu.slice(0, 300) };
  try {
    const j = JSON.parse(chu);
    /* Gọn lại cho dòng log: lượt chấm trả cả danh sách bằng chứng, in hết thì log ngập. */
    return { ok: j.ok, ngay: j.ngay, chot: j.chot, soGhi: (j.ghi || []).length, thang: j.thangBang, sangThang: j.sangThang, dung: j.dung };
  } catch { return { loi: "app trả về không phải JSON", than: chu.slice(0, 300) }; }
}

async function tuBamNutGuiMail(env) {
  if (!env.RENDER_TOKEN) return { ok: false, skip: "thiếu secret RENDER_TOKEN" };
  if (!env.MYBROWSER) return { ok: false, skip: "chưa gắn binding MYBROWSER (Browser Rendering)" };
  const browser = await puppeteer.launch(env.MYBROWSER);
  try {
    const page = await browser.newPage();
    // Chuỗi bí mật đi bằng HEADER, không bằng URL — URL thì nằm lại trong nhật ký truy cập.
    await page.setExtraHTTPHeaders({ "x-epmp-render": env.RENDER_TOKEN });
    // KHÔNG chờ "networkidle": app có mấy truy vấn chạy nền nên mạng gần như không bao giờ lặng.
    await page.goto(`${APP_URL}/?tudong=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(
      () => {
        const el = document.getElementById("tudong-ketqua");
        return !!el && !!el.textContent && el.textContent.trim().length > 0;
      },
      { timeout: 170_000, polling: 1000 },
    );
    const ket = await page.$eval("#tudong-ketqua", (el) => el.textContent.trim());
    return ket.startsWith("xong") ? { ok: true, ket } : { ok: false, ket };
  } catch (e) {
    return { ok: false, loi: String((e && e.message) || e) };
  } finally {
    try { await browser.close(); } catch { /* đóng hụt cũng không che được kết quả trên */ }
  }
}

/* ── NGÀY SỬA CUỐI CỦA TỪNG LINK — làm sẵn MỖI NGÀY MỘT LƯỢT ────────────────────────────────
 *
 * Cột "ngày update" của bảng chính hiện ngày sửa cuối của file trong link. Trước đây app tự đi hỏi
 * Google Drive lúc người dùng mở bảng: mấy chục link là mấy chục lượt gọi, rồi ghi lại vào KV —
 * đủ đốt sạch hạn mức ghi của gói free trước giờ nghỉ trưa.
 *
 * Nay cron làm sẵn: hỏi Drive một lượt cho tất cả link, ghi vào MỘT khoá `fmeta:v2`. App chỉ ĐỌC.
 * Mỗi lượt mở bảng còn đúng 1 lượt đọc KV, 0 lượt ghi, 0 lần gọi Drive.
 *
 * Thứ hiển thị là một NGÀY nên mỗi ngày làm mới một lần là đủ — sửa file lúc 9h thì 9h hôm sau
 * mới đổi ngày trên bảng, mà ngày trên bảng vốn cũng chỉ đổi mỗi ngày một lần.
 */
const FMETA_KEY = "fmeta:v2";
const FMETA_TTL_S = 30 * 86_400;

async function lamMoiNgaySuaLink(env) {
  const kv = env.PMO_EDITS;
  if (!kv) return { skip: "thiếu KV PMO_EDITS" };
  if (!env.GDRIVE_OAUTH_CLIENT_ID || !env.GDRIVE_OAUTH_REFRESH) return { skip: "thiếu secret GDRIVE_OAUTH_*" };

  // Danh sách link lấy từ chính bảng đang chạy (app ghi mỗi khi danh sách đổi).
  let ids = [];
  try {
    const raw = await kv.get("mtld:install:list:v2");
    const ds = raw ? JSON.parse(raw) : [];
    ids = [...new Set(ds.map((x) => x && x.fileId).filter(Boolean))];
  } catch { /* danh sách hỏng → thôi */ }
  if (!ids.length) return { skip: "chưa có danh sách link" };

  const token = await driveToken(env);
  const AUTH = { Authorization: `Bearer ${token}` };
  let kho = {};
  try { kho = JSON.parse((await kv.get(FMETA_KEY)) || "{}"); } catch { kho = {}; }

  const gio = Date.now();
  let ok = 0, hut = 0;
  for (const id of ids) {
    try {
      // Hỏi TUẦN TỰ: bắn song song mấy chục lượt là Google chặn vì quá nhanh.
      const r = await fetch(
        `https://www.googleapis.com/drive/v3/files/${id}?fields=modifiedTime,lastModifyingUser(displayName,emailAddress)&${DRIVE_SHARED}`,
        { headers: AUTH });
      if (!r.ok) { hut++; continue; }
      const j = await r.json();
      if (!j.modifiedTime) { hut++; continue; }
      kho[id] = {
        modifiedTime: j.modifiedTime,
        nguoiSua: (j.lastModifyingUser && (j.lastModifyingUser.displayName || j.lastModifyingUser.emailAddress)) || "",
        ts: gio,
      };
      ok++;
    } catch { hut++; }
  }
  // MỘT lượt ghi cho cả đợt.
  if (ok) await kv.put(FMETA_KEY, JSON.stringify(kho), { expirationTtl: FMETA_TTL_S });
  return { soLink: ids.length, ok, hut };
}

export default {
  // HAI lịch (xem wrangler.toml):
  //  · "30 10 * * *" (17:30 VN) — warm Summary + sao lưu nhật ký giám sát.
  //  · "0 11 * * *" (18:00 VN) và "0 13 * * *" (20:00 VN) — warm Summary, khớp MOC_LAM_MOI_VN
  //    của app (chỉ auto sync 2 lần/ngày). Mốc 20:00 còn TỰ BẤM nút "Cập nhật bản gửi mail",
  //    CHỈ VÀO THỨ TƯ (kiểm thứ trong hàm, không neo vào cron).
  async scheduled(event, env, ctx) {
    const cron = (event && event.cron) || "";
    /* 20:30 VN — PDF BÁO CÁO TUÂN THỦ, chỉ làm vào THỨ TƯ (trước mốc gửi mail 21h).
     *
     * THỨ KIỂM Ở ĐÂY, KHÔNG NEO VÀO BIỂU THỨC CRON. Lịch cũ ghi "30 13 * * 3" với ý thứ Tư, mà
     * Cloudflare đếm thứ theo 1=CHỦ NHẬT nên 3 = THỨ BA. Đo thư mục Drive 01/10/2026: 4/4 file
     * máy dựng (08 · 15 · 22 · 29/09, đều ~135KB) rơi THỨ BA 20:30, trong khi bốn file thứ Tư
     * (09 · 16 · 23 · 30/09, ~1.5MB) là anh Tiến tự xuất tay từ app. Trigger gửi mail cần bản
     * THỨ TƯ nên nó chưa từng có bản do máy dựng.
     *
     * Kiểm bằng Date theo giờ VN thì đúng sai không phụ thuộc quy ước đếm thứ của Cloudflare,
     * và đọc code là thấy ngay ý định. Khớp theo tiền tố "30 13 " để lịch có bị chuẩn hoá lại
     * cũng không rơi xuống nhánh warm ở dưới. */
    if (/^(0|30) 13 /.test(cron)) {
      /* 20:00 VN — MỐC LÀM MỚI THỨ HAI của app (xem MOC_LAM_MOI_VN trong
         src/lib/mtld-install.functions.ts). Warm MỖI NGÀY để tới mốc là đã có bản tươi sẵn. */
      ctx.waitUntil(warmAll(env).then((r) => console.log("warm 20h:", JSON.stringify(r)))
        .catch((e) => console.error("warmAll 20h lỗi:", e)));
      ctx.waitUntil(warmMaTran(env).then((r) => console.log("maTran 20h:", JSON.stringify(r)))
        .catch((e) => console.error("warmMaTran 20h lỗi:", e)));
      /* LƯỢT CHỐT NGÀY: qua 20:00 rồi nên ô nào còn trống là "không báo cáo". ĐẶT TRƯỚC nhánh
         kiểm thứ Tư bên dưới — để sau là ngày thường không chấm, mà chấm thì phải chấm mỗi ngày. */
      ctx.waitUntil(goiChamBcn(env, true).then((r) => console.log("chamBcn 20h:", JSON.stringify(r)))
        .catch((e) => console.error("chamBcn 20h lỗi:", e)));
      const vn = new Date(Date.now() + 7 * 3600_000);   // worker chạy UTC
      if (vn.getUTCDay() !== 3) return;                 // 0=CN … 3=THỨ TƯ — PDF chỉ dựng thứ Tư
      /* TỰ BẤM NÚT TRÊN APP — ra ĐÚNG bản app xuất (~1.5MB), đúng thứ cần đính mail.
         Hụt thì LÙI về bản Google export Sheet→PDF: thà có bản khác khuôn còn hơn thư mục
         trống trơn lúc 21h trigger gửi mail quét. */
      ctx.waitUntil(tuBamNutGuiMail(env).then(async (r) => {
        console.log("tuBamNut:", JSON.stringify(r));
        if (r && r.ok) return;
        const lui = await backupCompliancePdf(env);
        console.log("lui ve Google export:", JSON.stringify(lui));
      }).catch((e) => console.error("tuBamNutGuiMail lỗi:", e)));
      return;
    }
    if (cron === "30 16 * * *") {             // 23:30 VN — chốt ngày: nhật ký giám sát + TOÀN BỘ dữ liệu KV
      ctx.waitUntil(backupAuditLog(env).then((r) => console.log("auditLog:", JSON.stringify(r)))
        .catch((e) => console.error("backupAuditLog lỗi:", e)));
      ctx.waitUntil(backupKvData(env).then((r) => console.log("kvData:", JSON.stringify(r)))
        .catch((e) => console.error("backupKvData lỗi:", e)));
      ctx.waitUntil(chamVanTayNguon(env).then((r) => console.log("vanTayNguon:", JSON.stringify(r)))
        .catch((e) => console.error("chamVanTayNguon lỗi:", e)));
      return;
    }
    if (cron === "0 2 * * *") {                // 09:00 VN — đầu giờ làm việc
      // Làm sẵn ngày sửa cuối của mọi link để app KHỎI phải hỏi Drive lúc người dùng mở bảng.
      ctx.waitUntil(lamMoiNgaySuaLink(env).then((r) => console.log("ngaySuaLink:", JSON.stringify(r)))
        .catch((e) => console.error("lamMoiNgaySuaLink lỗi:", e)));
      ctx.waitUntil(chupCameraHangNgay(env).then((r) => console.log("camera:", JSON.stringify(r)))
        .catch((e) => console.error("chupCameraHangNgay lỗi:", e)));
      /* KHÔNG WARM Ở ĐÂY NỮA. App chỉ auto sync vào 18:00 và 20:00 (anh Tiến chốt 02/10/2026),
         nên warm buổi sáng chỉ tốn lượt ghi KV mà tới chiều vẫn phải warm lại. */
      return;
    }
    /* MỐC 18:00 VN ("0 11 * * *") — mốc làm mới THỨ NHẤT của app. Warm CẢ HAI kho, vì màn MTLĐ
       bày hai dạng thẻ: thẻ có cờ `chart` đọc PDF (kho spdf2), thẻ còn lại đọc file Summary
       (kho sfile). Thiếu một kho là dạng thẻ đó vẫn phải bấm "Làm mới". */
    ctx.waitUntil(warmAll(env).then((r) => console.log("warm:", JSON.stringify(r)))
      .catch((e) => console.error("warmAll lỗi:", e)));
    ctx.waitUntil(warmMaTran(env).then((r) => console.log("maTran:", JSON.stringify(r)))
      .catch((e) => console.error("warmMaTran lỗi:", e)));
    /* Lượt 18:00 CHỈ ghi ✓ và O, chưa kết tội ai: cửa sổ trễ còn mở tới 20:00. */
    ctx.waitUntil(goiChamBcn(env, false).then((r) => console.log("chamBcn 18h:", JSON.stringify(r)))
      .catch((e) => console.error("chamBcn 18h lỗi:", e)));
  },
  // Gọi tay để test: mở URL worker (GET) → warm + sao lưu ngay + trả kết quả.
  async fetch(req, env) {
    const tham = new URL(req.url).searchParams;
    /* THỬ CHẤM TUÂN THỦ: "…/?cham=1" chạy thật, "…/?cham=1&thu=1" chỉ xem trước (KHÔNG ghi vào
       file nguồn), thêm "&chot=1" để thử lượt chốt sau 20:00. */
    if (tham.get("cham")) {
      if (!env.RENDER_TOKEN) return new Response(JSON.stringify({ loi: "thiếu secret RENDER_TOKEN" }), { status: 500, headers: { "content-type": "application/json" } });
      const u = `${APP_URL}/may/cham-bcn?chot=${tham.get("chot") === "1" ? 1 : 0}&thu=${tham.get("thu") === "1" ? 1 : 0}`;
      const r = await gapApp(env, u);
      return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json; charset=utf-8" } });
    }
    /* THỬ CAMERA: mở "…/?cam=1" để chụp NGAY toàn bộ danh sách; "…/?cam=<số máy>" để thử đúng một
       camera mà không đụng tới ảnh của cả công trường. Trả về JSON nói rõ chụp được mấy cái, hụt
       cái nào và vì sao — cần thế để dò lúc mới cắm camera. */
    if (tham.get("cam")) {
      const chi = tham.get("cam");
      try {
        if (chi !== "1") {
          const token = await camToken(env);
          if (!token) throw new Error("chưa đặt secret EZVIZ_APP_KEY / EZVIZ_APP_SECRET");
          const url = await camChup(env, token, chi, tham.get("kenh") || 1);
          return new Response(JSON.stringify({ thu: chi, picUrl: url }, null, 2), { headers: { "content-type": "application/json" } });
        }
        const r = await chupCameraHangNgay(env);
        return new Response(JSON.stringify(r, null, 2), { headers: { "content-type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ loi: String(e && e.message || e) }, null, 2), { status: 500, headers: { "content-type": "application/json" } });
      }
    }
    /* WARM MA TRẬN NGAY: mở "…/?matran=1". Để kiểm ngay sau khi deploy, khỏi đợi tới 18:00 —
       trả về JSON nói rõ làm mấy ô, ghi mấy ô, mấy ô y nguyên (không tốn lượt ghi) và hỏng ô nào. */
    if (tham.get("matran")) {
      /* `ghi` và `ms` để ĐO thử một con số mà không phải deploy lại — xem MATRAN_GHI_MOI_LUOT. */
      const dieu = { ghiToiDa: Number(tham.get("ghi")) || 0, nganSachMs: Number(tham.get("ms")) || 0 };
      try { return new Response(JSON.stringify(await warmMaTran(env, dieu), null, 2), { headers: { "content-type": "application/json" } }); }
      catch (e) { return new Response(JSON.stringify({ loi: String(e && e.message || e) }, null, 2), { status: 500, headers: { "content-type": "application/json" } }); }
    }
    /* LÀM SẴN NGÀY SỬA LINK ngay bây giờ: mở "…/?ngaylink=1". Dùng khi vừa đổi danh sách link,
       không muốn đợi tới lượt cron 09:00 sáng mai. */
    if (tham.get("ngaylink")) {
      try {
        const r = await lamMoiNgaySuaLink(env);
        return new Response(JSON.stringify(r, null, 2), { headers: { "content-type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ loi: String(e && e.message || e) }, null, 2), { status: 500, headers: { "content-type": "application/json" } });
      }
    }
    /* DỰNG LẠI PDF BÁO CÁO TUÂN THỦ NGAY: mở "…/?pdf=1". Lịch tự động chỉ chạy thứ Tư 20:30,
       nên cần một đường bấm tay cho lần hụt hoặc bản gấp ngoài lịch. CHỈ làm đúng việc này —
       URL trần làm liền bốn việc và đó chính là thứ đã gây Error 1102. Tên file mang NGÀY HÔM
       NAY theo giờ VN, trùng khuôn bản tự động. */
    /* TỰ BẤM NÚT NGAY: mở "…/?tubam=1". Dùng để nghiệm thu, hoặc khi thứ Tư hụt mà cần bản
       đúng khuôn app. Ra cùng một file như người bấm nút trên app. */
    if (tham.get("tubam")) {
      const r = await tuBamNutGuiMail(env);
      return new Response(JSON.stringify(r, null, 2), { status: r && r.ok ? 200 : 500, headers: { "content-type": "application/json" } });
    }
    /* SAO LƯU TOÀN BỘ KV RA DRIVE NGAY: mở "…/?saoluu=1". Lịch tự động chạy 23:30 mỗi ngày,
       nhưng trước mỗi thao tác NGUY HIỂM trên kho ghi chú (dời khoá hàng loạt) phải có bản TƯƠI
       của đúng phút đó. Trước đây muốn chạy việc này phải gọi URL trần, mà URL trần làm liền bốn
       việc — chính thứ đã gây Error 1102. Nên tách ra một cửa riêng, y như ?pdf=1. */
    if (tham.get("saoluu")) {
      try {
        const r = await backupKvData(env);
        return new Response(JSON.stringify(r, null, 2), { headers: { "content-type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ loi: String(e && e.message || e) }, null, 2), { status: 500, headers: { "content-type": "application/json" } });
      }
    }
    if (tham.get("pdf")) {
      try {
        const r = await backupCompliancePdf(env);
        return new Response(JSON.stringify(r, null, 2), { headers: { "content-type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ loi: String(e && e.message || e) }, null, 2), { status: 500, headers: { "content-type": "application/json" } });
      }
    }
    // Bấm tay: mặc định warm ÍT (2 file) cho nhẹ; muốn nhiều thì thêm ?n=… vào URL.
    const n = Math.max(0, Math.min(12, Number(tham.get("n")) || 2));
    const warm = await warmAll(env, n);
    /* ?chiwarm=1 → CHỈ warm rồi trả kết quả. Gộp cả bốn việc (warm + nhật ký + PDF + sao lưu KV)
       vào một request là chính thứ làm lượt bấm tay chết Error 1102, nên không đo được warm nặng
       bao nhiêu. Muốn đo riêng warm thì dùng cờ này. */
    if (tham.get("chiwarm")) return new Response(JSON.stringify({ warm }, null, 2), { headers: { "content-type": "application/json" } });
    let audit, pdf, kvbak;
    try { audit = await backupAuditLog(env); } catch (e) { audit = { error: String(e) }; }
    try { pdf = await backupCompliancePdf(env); } catch (e) { pdf = { error: String(e) }; }
    try { kvbak = await backupKvData(env); } catch (e) { kvbak = { error: String(e) }; }
    let nguon;
    try { nguon = await chamVanTayNguon(env); } catch (e) { nguon = { error: String(e) }; }
    return new Response(JSON.stringify({ warm, audit, pdf, kvbak, nguon }, null, 2), { headers: { "content-type": "application/json" } });
  },
};
