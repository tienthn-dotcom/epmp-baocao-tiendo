import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { SESSION_COOKIE, readCookie, verifySession } from "./auth";
import { ADMIN_KEY, DEFAULT_ADMINS, isAdminEmail, normEmail, type ActivityRow } from "./activity";

/**
 * BACKEND cho NHẬT KÝ GIÁM SÁT.
 *
 * Lưu trữ (giống pattern của edits.functions.ts):
 *   • Production (Workers): Cloudflare D1 binding `PMO_LOG`, bảng `access_log`.
 *     Vì sao D1 chứ không phải KV: KV free chỉ cho ~1.000 lượt GHI/ngày và ghi kiểu
 *     đọc-sửa-ghi dễ tranh chấp — không hợp để ghi log liên tục. D1 (SQLite) cho tới
 *     100k ghi/ngày, chèn dòng độc lập (không tranh chấp), và ĐỌC được bằng SQL NGAY
 *     trong Worker (không cần API token ngoài như Analytics Engine).
 *   • Dev local (vite/node): file .data/pmo-access-log.json.
 *
 * Danh tính người gọi: đọc cookie phiên (đã ký) TRONG server function bằng getRequest()
 * rồi verifySession — CHÍNH email đó được ghi, client KHÔNG mạo được.
 */

const DEV_LOG_FILE = ".data/pmo-access-log.json";
/** Ở máy DEV (vite mở toang, không có phiên Google) → coi như admin để test được UI. */
const DEV_IDENTITY = "tienthn@aacorporation.com";

/* ───────────────────────── env / phiên ───────────────────────── */

/** Lấy env THẬT của Worker — thử mọi nơi nitro/TanStack Start có thể đặt (như edits.functions.ts). */
async function getEnv(): Promise<Record<string, unknown>> {
  try {
    const mod = (await import("@tanstack/react-start/server")) as Record<string, unknown>;
    const getEvent = mod.getEvent as undefined | (() => unknown);
    if (getEvent) {
      const ev = getEvent() as { context?: { cloudflare?: { env?: Record<string, unknown> } } } | undefined;
      const env = ev?.context?.cloudflare?.env;
      if (env) return env;
    }
  } catch { /* not available in this runtime */ }
  const g = globalThis as unknown as Record<string, unknown>;
  return (g.__env__ ?? g.__cf_env__ ?? {}) as Record<string, unknown>;
}

/** Email người đang gọi (đã xác thực). Null = chưa đăng nhập. */
async function currentEmail(devAs?: string | null): Promise<string | null> {
  const env = await getEnv();
  const secret = env.SESSION_SECRET as string | undefined;
  let token: string | null = null;
  try {
    const mod = (await import("@tanstack/react-start/server")) as Record<string, unknown>;
    const getRequest = mod.getRequest as undefined | (() => Request);
    if (getRequest) token = readCookie(getRequest(), SESSION_COOKIE);
  } catch { /* ngoài ngữ cảnh request */ }
  if (secret && token) {
    const s = await verifySession(token, secret);
    if (s?.email) return normEmail(s.email);
  }
  // Chỉ máy DEV (vite thay import.meta.env.DEV = false khi build prod) mới rơi vào đây.
  //  · GIẢ LẬP DANH TÍNH: cho phép ?as=email để XEM THỬ phân quyền ngay trên preview/tunnel
  //    (menu ẩn/hiện, server chặn/cho). CHỈ có tác dụng ở DEV — bản prod bỏ qua hoàn toàn
  //    (import.meta.env.DEV = false), nên client KHÔNG thể mạo danh trên bản chính thức.
  if (import.meta.env.DEV) return devAs ? normEmail(devAs) : DEV_IDENTITY;
  return null;
}

/** Danh sách admin từ KV (null = chưa seed ⇒ nơi gọi dùng DEFAULT_ADMINS). */
async function readAdmins(): Promise<string[] | null> {
  const env = await getEnv();
  const kv = env.PMO_EDITS as { get(k: string): Promise<string | null> } | undefined;
  if (!kv) return null;
  try {
    const raw = await kv.get(ADMIN_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map((x) => String(x)) : null;
  } catch { return null; }
}

/* ───────────────────────── kho log: D1 (prod) / file (dev) ───────────────────────── */

type D1Prepared = {
  bind(...vals: unknown[]): D1Prepared;
  run(): Promise<unknown>;
  all<T = unknown>(): Promise<{ results: T[] }>;
};
type D1Like = { prepare(q: string): D1Prepared };

async function getD1(): Promise<D1Like | null> {
  const env = await getEnv();
  return (env.PMO_LOG as D1Like | undefined) ?? null;
}

/** Tạo bảng 1 lần cho mỗi isolate — tự lành, không cần bước migration thủ công lúc deploy. */
let d1Ready = false;
async function ensureD1(d1: D1Like): Promise<void> {
  if (d1Ready) return;
  await d1.prepare(
    "CREATE TABLE IF NOT EXISTS access_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, email TEXT NOT NULL, action TEXT NOT NULL, detail TEXT)",
  ).run();
  try { await d1.prepare("CREATE INDEX IF NOT EXISTS idx_log_ts ON access_log(ts)").run(); } catch { /* đã có */ }
  try { await d1.prepare("CREATE INDEX IF NOT EXISTS idx_log_email ON access_log(email)").run(); } catch { /* đã có */ }
  d1Ready = true;
}

async function devReadAll(): Promise<ActivityRow[]> {
  try {
    const fs = await import("node:fs/promises");
    return JSON.parse(await fs.readFile(DEV_LOG_FILE, "utf8")) as ActivityRow[];
  } catch { return []; }
}
async function devAppend(row: ActivityRow): Promise<void> {
  const rows = await devReadAll();
  rows.push(row);
  // Giữ file dev gọn: chỉ cần đủ để thử tính năng.
  const trimmed = rows.length > 5000 ? rows.slice(rows.length - 5000) : rows;
  const fs = await import("node:fs/promises");
  await fs.mkdir(".data", { recursive: true });
  await fs.writeFile(DEV_LOG_FILE, JSON.stringify(trimmed, null, 2), "utf8");
}

async function writeRow(row: ActivityRow): Promise<void> {
  const d1 = await getD1();
  if (d1) {
    await ensureD1(d1);
    await d1.prepare("INSERT INTO access_log (ts, email, action, detail) VALUES (?, ?, ?, ?)")
      .bind(row.ts, row.email, row.action, row.detail ?? null).run();
    return;
  }
  await devAppend(row);
}

async function readRows(opts: { email?: string; since?: string; before?: string; action?: string; limit: number }): Promise<ActivityRow[]> {
  const d1 = await getD1();
  if (d1) {
    await ensureD1(d1);
    const clauses: string[] = [];
    const binds: unknown[] = [];
    if (opts.email) { clauses.push("email = ?"); binds.push(opts.email); }
    if (opts.action) { clauses.push("action = ?"); binds.push(opts.action); }
    if (opts.since) { clauses.push("ts >= ?"); binds.push(opts.since); }
    if (opts.before) { clauses.push("ts < ?"); binds.push(opts.before); }   // KEYSET: trang sau = cũ hơn con trỏ
    let q = "SELECT ts, email, action, detail FROM access_log";
    if (clauses.length) q += " WHERE " + clauses.join(" AND ");
    q += " ORDER BY ts DESC LIMIT ?";
    binds.push(opts.limit);
    const { results } = await d1.prepare(q).bind(...binds).all<ActivityRow>();
    return results ?? [];
  }
  let rows = await devReadAll();
  if (opts.email) rows = rows.filter((r) => normEmail(r.email) === opts.email);
  if (opts.action) rows = rows.filter((r) => r.action === opts.action);
  if (opts.since) rows = rows.filter((r) => r.ts >= opts.since!);
  if (opts.before) rows = rows.filter((r) => r.ts < opts.before!);
  rows.sort((a, b) => b.ts.localeCompare(a.ts));
  return rows.slice(0, opts.limit);
}

/** Đọc TOÀN BỘ log (không giới hạn) — dùng cho sao lưu ra Drive. Sắp xếp cũ → mới. */
async function readAllRows(): Promise<ActivityRow[]> {
  const d1 = await getD1();
  if (d1) {
    await ensureD1(d1);
    const { results } = await d1.prepare("SELECT ts, email, action, detail FROM access_log ORDER BY ts ASC").all<ActivityRow>();
    return results ?? [];
  }
  const rows = await devReadAll();
  rows.sort((a, b) => a.ts.localeCompare(b.ts));
  return rows;
}

/** 1 ô CSV: bọc "" nếu chứa dấu phẩy/nháy/xuống dòng; nhân đôi nháy trong ô. */
function csvCell_(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Danh sách email đã từng xuất hiện — đổ vào ô lọc "theo người". */
async function distinctUsers(): Promise<string[]> {
  const d1 = await getD1();
  if (d1) {
    await ensureD1(d1);
    const { results } = await d1.prepare("SELECT DISTINCT email FROM access_log ORDER BY email").all<{ email: string }>();
    return (results ?? []).map((r) => r.email);
  }
  const rows = await devReadAll();
  return Array.from(new Set(rows.map((r) => r.email))).sort();
}

/** Danh sách LOẠI thao tác đã từng xuất hiện — đổ vào ô lọc "thao tác" (lọc ở SERVER, không cần ôm hết log). */
async function distinctActions(): Promise<string[]> {
  const d1 = await getD1();
  if (d1) {
    await ensureD1(d1);
    const { results } = await d1.prepare("SELECT DISTINCT action FROM access_log ORDER BY action").all<{ action: string }>();
    return (results ?? []).map((r) => r.action);
  }
  const rows = await devReadAll();
  return Array.from(new Set(rows.map((r) => r.action))).sort();
}

/** RÀ SOÁT NOTE THEO NHẬT KÝ: đọc mọi lần "thêm" Vướng mắc/Giải pháp → map NỘI DUNG (60 ký tự đầu,
 *  bỏ dấu) → VỊ TRÍ ĐÚNG lúc viết = "maCT||giai đoạn". Client dùng để dò note nào đang nằm sai chỗ. */
const _normTxt = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
async function buildAuditPosMap(): Promise<Record<string, string>> {
  const d1 = await getD1();
  let details: string[] = [];
  if (d1) {
    await ensureD1(d1);
    const { results } = await d1.prepare("SELECT detail FROM access_log WHERE action='save_edit' AND detail LIKE '%: thêm%' ORDER BY ts ASC").all<{ detail: string }>();
    details = (results ?? []).map((r) => r.detail);
  } else {
    details = (await devReadAll()).filter((r) => r.action === "save_edit").sort((a, b) => a.ts.localeCompare(b.ts)).map((r) => r.detail ?? "");
  }
  const reItem = /^(\S+)\s+.+?\s+·\s+(\S+)\s+—\s+(?:Vướng mắc|Giải pháp):\s+thêm:\s+"([\s\S]+)"$/;
  const reProj = /^(\S+)\s+.+?\s+\(cấp dự án\)\s+—\s+(?:Vướng mắc|Giải pháp):\s+thêm:\s+"([\s\S]+)"$/;
  const map: Record<string, string> = {};
  for (const d of details) {
    let m = reItem.exec(d);
    if (m) { map[_normTxt(m[3])] = `${m[1]}||${m[2]}`; continue; }   // maCT||stageAbbr
    m = reProj.exec(d);
    if (m) map[_normTxt(m[2])] = `${m[1]}||DA`;                      // cấp dự án
  }
  return map;
}
export const fetchAuditPosMap = createServerFn({ method: "GET" }).handler(async () => {
  return { map: await buildAuditPosMap() };
});

/* ───────────────────────── server functions ───────────────────────── */

/** Tôi là ai + có phải admin giám sát không. Client dùng để ẩn/hiện nút. */
export const whoami = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ devAs: z.string().max(200).nullish() }).parse(input ?? {}))
  .handler(async ({ data }) => {
    const email = await currentEmail(data?.devAs);
    const admins = await readAdmins();
    return { email, isAdmin: isAdminEmail(email, admins ?? DEFAULT_ADMINS) };
  });

/** Ghi nhận 1 thao tác. Email lấy từ PHIÊN (client không truyền được, không mạo được).
 *  `devAs` CHỈ có tác dụng ở DEV (giả lập danh tính để xem thử phân quyền). */
export const recordActivity = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      action: z.string().min(1).max(40),
      detail: z.string().max(300).nullish(),
      devAs: z.string().max(200).nullish(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const email = await currentEmail(data.devAs);
    if (!email) return { ok: false as const };
    try {
      await writeRow({ ts: new Date().toISOString(), email, action: data.action, detail: data.detail ?? null });
      return { ok: true as const };
    } catch {
      // Ghi log là phụ trợ — hỏng KHÔNG được làm hỏng thao tác chính của người dùng.
      return { ok: false as const };
    }
  });

/** Đọc nhật ký — CHỈ admin. Kiểm quyền Ở SERVER (không chỉ ẩn nút phía client).
 *  `devAs` CHỈ có tác dụng ở DEV — bản prod bỏ qua, nên không thể lách quyền trên bản thật. */
export const fetchActivityLog = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      email: z.string().max(200).nullish(),
      since: z.string().max(40).nullish(),
      before: z.string().max(40).nullish(),      // KEYSET: chỉ lấy dòng CŨ HƠN mốc này (tải trang tiếp)
      action: z.string().max(60).nullish(),      // lọc LOẠI thao tác Ở SERVER
      limit: z.number().int().min(1).max(1000).optional(),
      devAs: z.string().max(200).nullish(),
    }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const me = await currentEmail(data.devAs);
    const admins = await readAdmins();
    if (!isAdminEmail(me, admins ?? DEFAULT_ADMINS)) {
      return { ok: false as const, rows: [] as ActivityRow[], users: [] as string[], actions: [] as string[], hasMore: false };
    }
    // PHÂN TRANG: mỗi lần chỉ kéo `limit` dòng từ D1 (mặc định 200) → app KHÔNG ôm hết log.
    // Lọc Người/Ngày/Thao tác ngay ở SQL. hasMore = trang này đầy → còn dòng cũ hơn để "Tải thêm".
    const pageSize = data.limit ?? 200;
    const rows = await readRows({
      email: data.email ? normEmail(data.email) : undefined,
      since: data.since || undefined,
      before: data.before || undefined,
      action: data.action || undefined,
      limit: pageSize,
    });
    // Danh sách người/thao tác cho dropdown chỉ cần lấy Ở TRANG ĐẦU (không có `before`) — đỡ truy vấn thừa.
    const first = !data.before;
    const users = first ? await distinctUsers() : [];
    const actions = first ? await distinctActions() : [];
    return { ok: true as const, rows, users, actions, hasMore: rows.length === pageSize };
  });

/** SAO LƯU nhật ký giám sát ra Google Drive (CHỈ admin). Xuất TOÀN BỘ access_log → CSV (UTF-8 BOM,
 *  mở Excel đúng tiếng Việt) → upsert vào "Data Source" › DATABASE › ePMP › Nhật ký giám sát.
 *  Mirror 1 file "nhat-ky-giam-sat.csv" (luôn đầy đủ, ghi đè mỗi lần) — bản lưu dài hạn ngoài D1. */
export const backupAuditLogToDrive = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ devAs: z.string().max(200).nullish() }).parse(input ?? {}))
  .handler(async ({ data }): Promise<{ ok: boolean; count?: number; link?: string; updated?: boolean; msg?: string }> => {
    const me = await currentEmail(data?.devAs);
    const admins = await readAdmins();
    if (!isAdminEmail(me, admins ?? DEFAULT_ADMINS)) return { ok: false, msg: "Chỉ admin giám sát mới sao lưu được." };

    const drive = await import("./drive.functions");
    if (!(await drive.driveIsConfigured())) return { ok: false, msg: "Chưa cấu hình Google Drive (thiếu GDRIVE_OAUTH_*)." };

    const rows = await readAllRows();
    const header = ["Thời điểm (ISO)", "Người dùng", "Thao tác", "Chi tiết"];
    const body = rows.map((r) => [r.ts, r.email, r.action, r.detail ?? ""].map(csvCell_).join(","));
    const csv = "﻿" + [header.join(","), ...body].join("\r\n") + "\r\n";   // ﻿ = BOM cho Excel VN

    const res = await drive.driveArchiveText(["ePMP", "Nhật ký giám sát"], "nhat-ky-giam-sat.csv", csv, "text/csv");
    return { ok: true, count: rows.length, link: res.link, updated: res.updated };
  });

/* ── ĐỌC NHẬT KÝ TỪ DRIVE (bản lưu trữ đầy đủ) ─────────────────────────────────
 *  D1 là kho GHI (nhanh, luôn mới); Drive là kho LƯU (đầy đủ, rẻ). Worker sao lưu D1 → Drive
 *  mỗi ngày 23:30 VN. Xem mốc "Tất cả" thì đọc thẳng CSV trên Drive: app không phải kéo hàng
 *  chục nghìn dòng qua D1 mỗi lần mở, mà lịch sử vẫn giữ được lâu hơn nhiều.
 *  Trả về CSV THÔ để CLIENT tự tách dòng — Worker khỏi ôm mảng lớn trong bộ nhớ. */
export const fetchActivityFromDrive = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ devAs: z.string().max(200).nullish() }).parse(input ?? {}))
  .handler(async ({ data }): Promise<{ ok: boolean; csv?: string; msg?: string }> => {
    const me = await currentEmail(data?.devAs);
    const admins = await readAdmins();
    if (!isAdminEmail(me, admins ?? DEFAULT_ADMINS)) return { ok: false, msg: "Chỉ admin giám sát mới xem được." };

    const drive = await import("./drive.functions");
    if (!(await drive.driveIsConfigured())) return { ok: false, msg: "Chưa cấu hình Google Drive." };
    // CHỈ TÌM, không tạo: chưa có bản lưu thì báo rõ để người xem biết mà lùi về mốc ngắn hơn.
    const found = await drive.driveNewestFileIn(["ePMP", "Nhật ký giám sát"]);
    if (!found) return { ok: false, msg: "Chưa có bản lưu trên Drive (worker sao lưu lúc 23:30 mỗi ngày)." };
    const { text } = await drive.driveReadTextImpl(found.id);
    return { ok: true, csv: text };
  });
