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
const CPL_PREFIX = "BaoCaoTuanThu_MP_";

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
const KV_BACKUP_PATH = ["ePMP", "Sao lưu dữ liệu"];
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

/** Xuất PDF báo cáo tuân thủ từ Google Sheet → ghi đè vào Drive (1 file / 1 ngày). */
async function backupCompliancePdf(env) {
  if (!env.GDRIVE_OAUTH_CLIENT_ID || !env.GDRIVE_OAUTH_REFRESH) return { skip: "thiếu secret GDRIVE_OAUTH_*" };
  const token = await driveToken(env);
  const AUTH = { Authorization: `Bearer ${token}` };

  // Khổ ngang A3, vừa bề ngang, bỏ lưới + mấy thứ Google chèn thêm.
  const url = `https://docs.google.com/spreadsheets/d/${CPL_SHEET_ID}/export?format=pdf&gid=${CPL_GID}`
    + "&portrait=false&size=A3&scale=4&fitw=true&gridlines=false&printtitle=false&sheetnames=false&pagenumbers=false"
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
  const name = `${CPL_PREFIX}${vn.getUTCFullYear()}-${p2(vn.getUTCMonth() + 1)}-${p2(vn.getUTCDate())}.pdf`;

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

export default {
  // HAI lịch (xem wrangler.toml):
  //  · "30 10 * * *" (17:30 VN) — warm Summary + sao lưu nhật ký giám sát.
  //  · "0 * * * *"   (mỗi giờ)  — dựng lại PDF báo cáo tuân thủ, để thư mục Drive lúc nào cũng có
  //    bản không quá một giờ tuổi; trigger gửi mail chạy giờ nào cũng vớ được bản mới.
  async scheduled(event, env, ctx) {
    const cron = (event && event.cron) || "";
    if (cron === "30 13 * * 3") {             // 20:30 VN thứ Tư — dựng PDF tuân thủ, trước mốc gửi mail 21h
      ctx.waitUntil(backupCompliancePdf(env).then((r) => console.log("compliancePdf:", JSON.stringify(r)))
        .catch((e) => console.error("backupCompliancePdf lỗi:", e)));
      return;
    }
    if (cron === "30 16 * * *") {             // 23:30 VN — chốt ngày: nhật ký giám sát + TOÀN BỘ dữ liệu KV
      ctx.waitUntil(backupAuditLog(env).then((r) => console.log("auditLog:", JSON.stringify(r)))
        .catch((e) => console.error("backupAuditLog lỗi:", e)));
      ctx.waitUntil(backupKvData(env).then((r) => console.log("kvData:", JSON.stringify(r)))
        .catch((e) => console.error("backupKvData lỗi:", e)));
      return;
    }
    ctx.waitUntil(warmAll(env));              // 17:30 VN — warm Summary
    ctx.waitUntil(backupAuditLog(env).catch((e) => console.error("backupAuditLog lỗi:", e)));
  },
  // Gọi tay để test: mở URL worker (GET) → warm + sao lưu ngay + trả kết quả.
  async fetch(_req, env) {
    const warm = await warmAll(env);
    let audit, pdf, kvbak;
    try { audit = await backupAuditLog(env); } catch (e) { audit = { error: String(e) }; }
    try { pdf = await backupCompliancePdf(env); } catch (e) { pdf = { error: String(e) }; }
    try { kvbak = await backupKvData(env); } catch (e) { kvbak = { error: String(e) }; }
    return new Response(JSON.stringify({ warm, audit, pdf, kvbak }, null, 2), { headers: { "content-type": "application/json" } });
  },
};
