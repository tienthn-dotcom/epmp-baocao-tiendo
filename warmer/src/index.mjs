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

async function fetchXlsxById(id) {
  const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx&_ts=${Date.now()}`;
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

async function warmOne(kv, id) {
  const raw = await fetchXlsxById(id);
  let bytes;
  try { bytes = extractSummaryXlsx(raw); }
  catch { bytes = new Uint8Array(raw); }
  const b64 = toB64(bytes);
  await kv.put(`sfile:${id}`, JSON.stringify({ b64, ts: Date.now() }), { expirationTtl: CACHE_TTL_S });
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
const WARM_MOI_LUOT = 3;

/* Làm mới khi cache còn sống dưới 1 ngày — sớm hơn hạn để không bao giờ có khoảng trống. */
const NGUONG_LAM_MOI_S = 86_400;

/* Trần CPU không đo được từ trong Worker → thêm hàng rào theo GIỜ ĐỒNG HỒ. Việc này CPU-bound nên
   hai thứ đi cùng nhau; hàng rào để một file nặng bất thường không kéo sập cả lượt. */
const WARM_NGAN_SACH_MS = 20_000;

async function warmAll(env, soLuong = WARM_MOI_LUOT) {
  const kv = env.PMO_EDITS;
  if (!kv) return { ok: 0, fail: 0, note: "thiếu KV PMO_EDITS" };
  let ids = [];
  try { const raw = await kv.get("sfile:index"); ids = raw ? JSON.parse(raw) : []; } catch { /* registry rỗng */ }
  if (!ids.length) return { ok: 0, fail: 0, total: 0 };

  // HẠN HẾT của từng khoá cache — lấy qua list (metadata), KHÔNG đọc giá trị (mỗi giá trị ~2MB).
  const han = new Map();
  try {
    let cursor;
    do {
      const p = await kv.list({ prefix: "sfile:", ...(cursor ? { cursor } : {}) });
      for (const k of p.keys) if (k.expiration) han.set(k.name, k.expiration);
      cursor = p.list_complete ? null : p.cursor;
    } while (cursor);
  } catch { /* không lấy được hạn → coi như mọi file đều cần làm, về đúng hành vi cũ */ }

  // Xếp theo ĐỘ GẤP: thiếu cache trước, rồi tới cái hết hạn sớm nhất.
  const bayGio = Math.floor(Date.now() / 1000);
  const canLam = ids
    .map((id) => ({ id, hh: han.get(`sfile:${id}`) ?? 0 }))
    .filter((x) => x.hh - bayGio < NGUONG_LAM_MOI_S)
    .sort((a, b) => a.hh - b.hh);
  if (!canLam.length) return { ok: 0, fail: 0, lam: 0, total: ids.length, conTuoi: ids.length };
  const lo = canLam.slice(0, Math.min(soLuong, canLam.length)).map((x) => x.id);

  let ok = 0, fail = 0, lam = 0, hetGio = false;
  const lyDo = [];   // giữ vài lỗi đầu để còn biết vì sao hỏng — nuốt sạch lỗi thì chẩn đoán bằng gì
  const batDau = Date.now();
  for (const id of lo) {
    // Hết ngân sách thì DỪNG: thà xong 1 file rồi lượt sau làm tiếp, hơn là đụng trần CPU giữa file
    // thứ hai và mất cả lượt (file đang làm dở không được ghi, coi như công cốc).
    if (lam > 0 && Date.now() - batDau > WARM_NGAN_SACH_MS) { hetGio = true; break; }
    lam++;
    try { await warmOne(kv, id); ok++; }
    catch (e) { fail++; if (lyDo.length < 3) lyDo.push(`${id}: ${String(e).slice(0, 120)}`); }
  }
  // KHÔNG còn con trỏ: thứ tự do ĐỘ GẤP quyết định, nên chẳng có gì phải nhớ giữa hai lượt —
  // bớt luôn một lượt ghi KV mỗi lần chạy.
  return { ok, fail, lam, total: ids.length, canLam: canLam.length, ...(hetGio ? { hetGio: true } : {}), ...(lyDo.length ? { lyDo } : {}) };
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
    // Các mốc WARM (10:30 · 14:30 · 17:30 VN) — CHỈ warm Summary.
    // Trước đây mốc 17:30 sao lưu nhật ký giám sát thêm một lần nữa, trong khi mốc 23:30 đã làm đúng
    // việc đó — làm hai lần vừa thừa vừa lấy mất phần CPU mà warm đang thiếu.
    ctx.waitUntil(warmAll(env).then((r) => console.log("warm:", JSON.stringify(r)))
      .catch((e) => console.error("warmAll lỗi:", e)));
  },
  // Gọi tay để test: mở URL worker (GET) → warm + sao lưu ngay + trả kết quả.
  async fetch(req, env) {
    const tham = new URL(req.url).searchParams;
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
