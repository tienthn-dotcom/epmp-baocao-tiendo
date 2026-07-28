import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { DEFAULT_ADMINS, isAdminEmail, normEmail } from "./activity";
import { SESSION_COOKIE, readCookie, verifySession } from "./auth";
// LƯU Ý QUAN TRỌNG: file này bị CLIENT import (saveEdits, EditsMap). Mọi hàm đụng server-only
// ("@tanstack/react-start/server") PHẢI là hàm nội bộ, CHỈ gọi trong thân serverFn handler (thân
// này bị strip khỏi bundle client) và KHÔNG được export — nếu không import-protection sẽ chặn.
// Vì thế KHÔNG import currentEmail/readAdmins từ activity.functions (export sẽ giữ lại server import
// ở bundle client); thay vào đó tự đọc phiên tại chỗ bằng các hàm nội bộ dưới đây.

/** Env THẬT của Worker (dynamic import server-only — nội bộ, chỉ chạy phía server). */
async function serverEnv(): Promise<Record<string, unknown>> {
  try {
    const mod = (await import("@tanstack/react-start/server")) as Record<string, unknown>;
    const getEvent = mod.getEvent as undefined | (() => unknown);
    if (getEvent) {
      const ev = getEvent() as { context?: { cloudflare?: { env?: Record<string, unknown> } } } | undefined;
      const env = ev?.context?.cloudflare?.env;
      if (env) return env;
    }
  } catch { /* ngoài ngữ cảnh server */ }
  const g = globalThis as unknown as Record<string, unknown>;
  return (g.__env__ ?? g.__cf_env__ ?? {}) as Record<string, unknown>;
}
/** Email người gọi (đã xác thực qua cookie phiên đã ký). DEV → devAs / mặc định admin để test. */
async function callerEmail(devAs?: string | null): Promise<string | null> {
  const env = await serverEnv();
  const secret = env.SESSION_SECRET as string | undefined;
  let token: string | null = null;
  try {
    const mod = (await import("@tanstack/react-start/server")) as Record<string, unknown>;
    const getRequest = mod.getRequest as undefined | (() => Request);
    if (getRequest) token = readCookie(getRequest(), SESSION_COOKIE);
  } catch { /* ngoài ngữ cảnh request */ }
  if (secret && token) { const s = await verifySession(token, secret); if (s?.email) return normEmail(s.email); }
  if (import.meta.env.DEV) return devAs ? normEmail(devAs) : "tienthn@aacorporation.com";
  return null;
}
/** Người gọi có phải ADMIN không (chốt quyền TÔ ĐỎ ở server). Dùng DEFAULT_ADMINS (2 tài khoản). */
async function callerIsAdmin(devAs?: string | null): Promise<boolean> {
  return isAdminEmail(await callerEmail(devAs), DEFAULT_ADMINS);
}

/**
 * BACKEND lưu các trường người dùng chỉnh trên app (Vướng mắc / PIC / Deadline).
 *
 * Nguyên tắc (chốt với PMO):
 *  - UI Action → Update Local State → Call API → Save Database → Sync UI.
 *  - Reload KHÔNG mất; NGƯỜI KHÁC thấy sau khi lưu (dữ liệu dùng chung).
 *
 * Lưu trữ:
 *  - Production (Cloudflare Workers): KV namespace binding `PMO_EDITS`
 *    (gắn qua scripts/patch-wrangler.cjs khi deploy).
 *  - Dev local (vite, node): file .data/pmo-edits.json trong repo.
 *
 * Mô hình: 1 key "edits:v1" chứa map { [itemKey]: { note?, pic?, deadline?, updatedAt } }.
 * Ghi = đọc → merge → ghi (last-write-wins theo từng đầu việc, đủ cho quy mô team).
 */

const KV_KEY = "edits:v1";

/** Đoạn tô đỏ = [start, end) theo OFFSET ký tự trong chuỗi note/action tương ứng. */
export type HiRange = [number, number];
export type ItemEdit = {
  note?: string;
  /** "Hành động / Cần xử lý" — cột NHẬP TAY trên app (sheet nguồn không có cột này).
   *  Cùng cơ chế lưu/khoá như `note`. Thêm 06/2026 khi tách cột Vướng mắc làm đôi. */
  action?: string;
  pic?: string;
  /** ISO YYYY-MM-DD */
  deadline?: string;
  /** Đoạn tô đỏ (#C00000) trong Vướng mắc / Giải pháp — CHỈ admin đặt được. Text đổi thì xoá. */
  noteHi?: HiRange[];
  actionHi?: HiRange[];
  updatedAt: string;
};
export type EditsMap = Record<string, ItemEdit>;

type KVLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
};

/** Lấy KV binding trên Workers — thử mọi vị trí nitro/TanStack Start có thể đặt env. */
async function getKv(): Promise<KVLike | null> {
  try {
    const mod = (await import("@tanstack/react-start/server")) as Record<string, unknown>;
    const getEvent = mod.getEvent as undefined | (() => unknown);
    if (getEvent) {
      const ev = getEvent() as { context?: { cloudflare?: { env?: Record<string, unknown> } } } | undefined;
      const kv = ev?.context?.cloudflare?.env?.PMO_EDITS;
      if (kv) return kv as KVLike;
    }
  } catch { /* not available in this runtime */ }
  const g = globalThis as unknown as Record<string, unknown>;
  const env = (g.__env__ ?? g.__cf_env__ ?? null) as Record<string, unknown> | null;
  if (env?.PMO_EDITS) return env.PMO_EDITS as KVLike;
  if (g.PMO_EDITS) return g.PMO_EDITS as KVLike;
  return null;
}

/* ── Dev fallback: file JSON cục bộ (node) ── */
const DEV_FILE = ".data/pmo-edits.json";
async function devRead(): Promise<EditsMap> {
  try {
    const fs = await import("node:fs/promises");
    return JSON.parse(await fs.readFile(DEV_FILE, "utf8")) as EditsMap;
  } catch { return {}; }
}
async function devWrite(map: EditsMap): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(".data", { recursive: true });
  await fs.writeFile(DEV_FILE, JSON.stringify(map, null, 2), "utf8");
}

async function readAll(): Promise<{ map: EditsMap; store: "kv" | "file" }> {
  const kv = await getKv();
  if (kv) {
    const raw = await kv.get(KV_KEY);
    return { map: raw ? (JSON.parse(raw) as EditsMap) : {}, store: "kv" };
  }
  return { map: await devRead(), store: "file" };
}
async function writeAll(map: EditsMap): Promise<void> {
  const kv = await getKv();
  if (kv) { await kv.put(KV_KEY, JSON.stringify(map)); return; }
  await devWrite(map);
}

/** Đọc toàn bộ chỉnh sửa dùng chung. */
export const fetchEdits = createServerFn({ method: "GET" }).handler(async () => {
  const { map, store } = await readAll();
  return { items: map, store, fetchedAt: new Date().toISOString() };
});

/* ────────────────────────────────────────────────────────────────
 * CẤU HÌNH DÙNG CHUNG CỦA APP — hiện tại: link Google Sheet mặc định.
 * Đặt từ dialog "Nguồn dữ liệu" (tick "đặt làm mặc định cho mọi người")
 * → dính luôn trên app, không cần sửa code/deploy.
 * ──────────────────────────────────────────────────────────────── */
const CONFIG_KEY = "config:v1";
const DEV_CONFIG_FILE = ".data/pmo-config.json";

export type AppSharedConfig = { sheetUrl?: string; updatedAt?: string };

async function readConfig(): Promise<AppSharedConfig> {
  const kv = await getKv();
  if (kv) {
    const raw = await kv.get(CONFIG_KEY);
    return raw ? (JSON.parse(raw) as AppSharedConfig) : {};
  }
  try {
    const fs = await import("node:fs/promises");
    return JSON.parse(await fs.readFile(DEV_CONFIG_FILE, "utf8")) as AppSharedConfig;
  } catch { return {}; }
}

export const fetchAppConfig = createServerFn({ method: "GET" }).handler(async () => {
  return await readConfig();
});

export const saveAppConfig = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      sheetUrl: z.string().url().max(2000)
        .regex(/docs\.google\.com\/spreadsheets/, "Link phải là Google Sheets"),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const cfg: AppSharedConfig = { sheetUrl: data.sheetUrl.trim(), updatedAt: new Date().toISOString() };
    const kv = await getKv();
    if (kv) await kv.put(CONFIG_KEY, JSON.stringify(cfg));
    else {
      const fs = await import("node:fs/promises");
      await fs.mkdir(".data", { recursive: true });
      await fs.writeFile(DEV_CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
    }
    return cfg;
  });

const hiSchema = z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])).max(200);
const patchSchema = z.object({
  note: z.string().max(8000).nullable().optional(),
  action: z.string().max(8000).nullable().optional(),
  pic: z.string().max(300).nullable().optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  noteHi: hiSchema.nullable().optional(),
  actionHi: hiSchema.nullable().optional(),
});

/** Lưu chỉnh sửa cho 1..n đầu việc. Field = null → xoá override field đó;
 *  entry không còn field nào → xoá entry (khôi phục hoàn toàn theo sheet). */
export const saveEdits = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      entries: z.record(z.string().min(1).max(600), patchSchema),
      devAs: z.string().nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { map } = await readAll();
    const now = new Date().toISOString();
    // Chỉ ADMIN mới được đặt vùng tô đỏ. Kiểm 1 lần (chỉ khi có patch đụng tới highlight).
    const wantsHi = Object.values(data.entries).some((p) => p.noteHi !== undefined || p.actionHi !== undefined);
    const isAdmin = wantsHi ? await callerIsAdmin(data.devAs) : false;
    for (const [key, patch] of Object.entries(data.entries)) {
      const cur: ItemEdit = map[key] ?? { updatedAt: now };
      // Text: note/action/pic/deadline — ai cũng sửa được. Đổi TEXT thì XOÁ vùng tô cũ (offset
      // hết đúng) — TRỪ khi cùng patch có gửi vùng tô mới (admin sửa text + tô một lượt).
      for (const f of ["note", "action", "pic", "deadline"] as const) {
        const v = patch[f];
        if (v === undefined) continue;
        const before = cur[f];
        if (v === null) delete cur[f];
        else { const t = v.trim(); if (t === "") delete cur[f]; else cur[f] = t; }
        if (f === "note" && cur.note !== before && patch.noteHi === undefined) delete cur.noteHi;
        if (f === "action" && cur.action !== before && patch.actionHi === undefined) delete cur.actionHi;
      }
      // Highlight: CHỈ admin. Non-admin gửi vào cũng bị bỏ qua (server chốt quyền).
      if (isAdmin) {
        for (const [hiF, txtF] of [["noteHi", "note"], ["actionHi", "action"]] as const) {
          const hv = patch[hiF];
          if (hv === undefined) continue;
          if (hv === null || hv.length === 0 || cur[txtF] == null) delete cur[hiF];
          else cur[hiF] = clampRanges(hv, (cur[txtF] as string).length);
        }
      }
      cur.updatedAt = now;
      if (cur.note == null && cur.action == null && cur.pic == null && cur.deadline == null) delete map[key];
      else map[key] = cur;
    }
    await writeAll(map);
    return { items: map, fetchedAt: now };
  });

/** Gom vùng tô: kẹp trong [0,len], bỏ đoạn rỗng, sắp xếp + hợp nhất đoạn chồng/kề nhau. */
function clampRanges(ranges: HiRange[], len: number): HiRange[] {
  const norm = ranges
    .map(([s, e]) => [Math.max(0, Math.min(s, len)), Math.max(0, Math.min(e, len))] as HiRange)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const out: HiRange[] = [];
  for (const r of norm) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────
 * LỊCH SỬ NGÀY CẬP NHẬT MASTER PLAN — nền tảng cho BÁO CÁO TUÂN THỦ.
 *
 * VÌ SAO CẦN: sheet chỉ có MỘT ô "Ngày update" cho mỗi dự án = lần cập nhật GẦN
 * NHẤT. PM cập nhật lần mới là giá trị cũ bị ghi đè mất → không thể dựng lại được
 * tuần trước PM có cập nhật hay không. Nên app phải TỰ tích luỹ lịch sử.
 *
 * CÁCH LƯU: 1 key "updates:v1" = { [projectKey]: string[] } — danh sách các ngày
 * update ĐÃ TỪNG THẤY của dự án đó (ISO, duy nhất, tăng dần).
 *
 * VÌ SAO KHÔNG CHỤP THEO TUẦN: nếu chụp theo tuần thì tuần nào không ai mở app là
 * mất trắng tuần đó. Lưu theo "mọi ngày từng thấy" thì chỉ cần có người mở app ở
 * đâu đó GIỮA hai lần cập nhật là bắt được — bền hơn nhiều.
 *
 * GIỚI HẠN ĐÃ BIẾT: nếu PM cập nhật 2 lần trong cùng một tuần mà không ai mở app
 * xen giữa, chỉ ghi nhận được lần sau. Chấp nhận được vì báo cáo tính theo TUẦN.
 * ──────────────────────────────────────────────────────────────── */
const UPDATES_KEY = "updates:v1";
const DEV_UPDATES_FILE = ".data/pmo-updates.json";

/** { [projectKey]: các ngày update đã từng ghi nhận (ISO YYYY-MM-DD, duy nhất, tăng dần) } */
export type UpdateHistory = Record<string, string[]>;

async function readUpdates(): Promise<UpdateHistory> {
  const kv = await getKv();
  if (kv) {
    const raw = await kv.get(UPDATES_KEY);
    return raw ? (JSON.parse(raw) as UpdateHistory) : {};
  }
  try {
    const fs = await import("node:fs/promises");
    return JSON.parse(await fs.readFile(DEV_UPDATES_FILE, "utf8")) as UpdateHistory;
  } catch { return {}; }
}

async function writeUpdates(map: UpdateHistory): Promise<void> {
  const kv = await getKv();
  if (kv) { await kv.put(UPDATES_KEY, JSON.stringify(map)); return; }
  const fs = await import("node:fs/promises");
  await fs.mkdir(".data", { recursive: true });
  await fs.writeFile(DEV_UPDATES_FILE, JSON.stringify(map, null, 2), "utf8");
}

/** Đọc toàn bộ lịch sử ngày cập nhật (dùng chung cho mọi người). */
export const fetchUpdateHistory = createServerFn({ method: "GET" }).handler(async () => {
  return { history: await readUpdates(), fetchedAt: new Date().toISOString() };
});

/** Ghi nhận ngày update hiện tại của các dự án. CHỈ thêm ngày CHƯA có (idempotent) —
 *  client đã lọc trước nên hàm này hiếm khi phải ghi, giảm tranh chấp đọc-ghi. */
export const recordUpdateDates = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      entries: z.record(
        z.string().min(1).max(600),
        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      ),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const map = await readUpdates();
    let added = 0;
    for (const [key, date] of Object.entries(data.entries)) {
      const arr = map[key] ?? [];
      if (!arr.includes(date)) { arr.push(date); arr.sort(); map[key] = arr; added++; }
    }
    if (added > 0) await writeUpdates(map);
    return { history: map, added };
  });

/* ── NGÀY KẾT THÚC THỰC TẾ (khi hạng mục đạt 100%) ──
   Sheet KHÔNG lưu ngày đạt 100%; app tự ghi "ngày LẦN ĐẦU thấy 100%" cho mỗi hạng mục (dùng
   chung, kho KV). % rớt <100 → XOÁ để hiện lại ngày kế hoạch (tránh sai sót dữ liệu). */
export type CompletedDates = Record<string, string>; // { [itemKey]: ISO "YYYY-MM-DD" }
const COMPLETED_KEY = "completed:v1";
const DEV_COMPLETED_FILE = ".data/pmo-completed.json";

async function readCompleted(): Promise<CompletedDates> {
  const kv = await getKv();
  if (kv) { const raw = await kv.get(COMPLETED_KEY); return raw ? (JSON.parse(raw) as CompletedDates) : {}; }
  try { const fs = await import("node:fs/promises"); return JSON.parse(await fs.readFile(DEV_COMPLETED_FILE, "utf8")) as CompletedDates; }
  catch { return {}; }
}
async function writeCompleted(map: CompletedDates): Promise<void> {
  const kv = await getKv();
  if (kv) { await kv.put(COMPLETED_KEY, JSON.stringify(map)); return; }
  const fs = await import("node:fs/promises");
  await fs.mkdir(".data", { recursive: true });
  await fs.writeFile(DEV_COMPLETED_FILE, JSON.stringify(map, null, 2), "utf8");
}

export const fetchCompletedDates = createServerFn({ method: "GET" }).handler(async () => {
  return { completed: await readCompleted() };
});

/** Đồng bộ ngày kết thúc thực tế: THÊM (chỉ khi chưa có → giữ ngày lần đầu) + XOÁ (khi rớt <100%).
 *  Client tính sẵn delta nên hàm hiếm khi ghi. */
export const syncCompletedDates = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      add: z.record(z.string().min(1).max(600), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
      remove: z.array(z.string().min(1).max(600)),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const map = await readCompleted();
    let changed = 0;
    for (const [key, date] of Object.entries(data.add)) if (!map[key]) { map[key] = date; changed++; }
    for (const key of data.remove) if (map[key]) { delete map[key]; changed++; }
    if (changed > 0) await writeCompleted(map);
    return { completed: map, changed };
  });
