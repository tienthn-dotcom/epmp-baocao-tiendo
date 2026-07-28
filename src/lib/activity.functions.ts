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

async function readRows(opts: { email?: string; since?: string; limit: number }): Promise<ActivityRow[]> {
  const d1 = await getD1();
  if (d1) {
    await ensureD1(d1);
    const clauses: string[] = [];
    const binds: unknown[] = [];
    if (opts.email) { clauses.push("email = ?"); binds.push(opts.email); }
    if (opts.since) { clauses.push("ts >= ?"); binds.push(opts.since); }
    let q = "SELECT ts, email, action, detail FROM access_log";
    if (clauses.length) q += " WHERE " + clauses.join(" AND ");
    q += " ORDER BY ts DESC LIMIT ?";
    binds.push(opts.limit);
    const { results } = await d1.prepare(q).bind(...binds).all<ActivityRow>();
    return results ?? [];
  }
  let rows = await devReadAll();
  if (opts.email) rows = rows.filter((r) => normEmail(r.email) === opts.email);
  if (opts.since) rows = rows.filter((r) => r.ts >= opts.since!);
  rows.sort((a, b) => b.ts.localeCompare(a.ts));
  return rows.slice(0, opts.limit);
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
      limit: z.number().int().min(1).max(2000).optional(),
      devAs: z.string().max(200).nullish(),
    }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const me = await currentEmail(data.devAs);
    const admins = await readAdmins();
    if (!isAdminEmail(me, admins ?? DEFAULT_ADMINS)) {
      return { ok: false as const, rows: [] as ActivityRow[], users: [] as string[] };
    }
    const rows = await readRows({
      email: data.email ? normEmail(data.email) : undefined,
      since: data.since || undefined,
      limit: data.limit ?? 500,
    });
    const users = await distinctUsers();
    return { ok: true as const, rows, users };
  });
