import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { DEFAULT_ADMINS, isAdminEmail, normEmail } from "./activity";
import { DEFAULT_ROLES, roleOf, type UserRole } from "./roles";
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
/** Người gọi có cấp PMO không — được quyền ẨN/mở ẩn comment NGƯỜI KHÁC trong box chat (chốt 31/07).
 *  Tra kho roles:v1; KV trống → dùng DEFAULT_ROLES (khớp cách client render badge & phân cấp). */
async function callerIsPmo(devAs?: string | null): Promise<boolean> {
  const email = await callerEmail(devAs);
  if (!email) return false;
  const cur = await readRoles();
  const map = Object.keys(cur).length ? cur : DEFAULT_ROLES;
  return roleOf(map, email) === "PMO";
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

/** Đoạn tô đỏ = [start, end) theo OFFSET ký tự trong chuỗi text của MỘT message. */
export type HiRange = [number, number];

/** MỘT tin trong "box chat" Vướng mắc / Giải pháp — lưu vết ai nhập, khi nào. Không xoá (chỉ ẩn);
 *  chỉ ADMIN mới xoá hẳn. `hidden` = ẩn khỏi BẢNG (coi như đã giải quyết) nhưng vẫn thấy khi mở ô. */
export type ChatMsg = {
  id: string;
  text: string;
  author: string;    // email người nhập (đã track qua phiên đăng nhập)
  at: string;        // ISO thời điểm nhập
  editedAt?: string; // ISO lần sửa gần nhất (nếu có)
  hidden?: boolean;  // ẩn khỏi bảng (mặc định hiện)
  hi?: HiRange[];    // vùng tô đỏ trong text (chỉ admin đặt)
  /** REPLY: tin GIẢI PHÁP này trả lời cho VƯỚNG MẮC nào — id của message vướng mắc. */
  replyTo?: string;
  /** Trích đoạn ngắn của vướng mắc được trả lời (lưu sẵn để hiện "↩ …" không cần tra chéo). */
  replyText?: string;
};

export type ItemEdit = {
  /** Vướng mắc — box chat (mảng message, thay cho `note` string cũ). */
  noteMsgs?: ChatMsg[];
  /** Giải pháp — box chat (thay cho `action` string cũ). */
  actionMsgs?: ChatMsg[];
  pic?: string;
  /** ISO YYYY-MM-DD */
  deadline?: string;
  updatedAt: string;
  // ── LEGACY (đời cũ, string đơn) — migrate-on-read sang *Msgs, KHÔNG để mất. ──
  note?: string;
  action?: string;
  noteHi?: HiRange[];
  actionHi?: HiRange[];
};
export type EditsMap = Record<string, ItemEdit>;

/** MIGRATE 1 entry đời cũ (note/action string) → box chat (noteMsgs/actionMsgs). KHÔNG mất data:
 *  vướng mắc/giải pháp cũ thành MESSAGE ĐẦU (author "(cũ)", giữ ngày updatedAt + vùng tô cũ). */
function migrateEntry(e: ItemEdit): ItemEdit {
  const out: ItemEdit = { ...e };
  if (out.note != null && out.note.trim() !== "" && out.noteMsgs == null) {
    out.noteMsgs = [{ id: "legacy-note", text: out.note, author: "(cũ)", at: out.updatedAt || "", ...(out.noteHi?.length ? { hi: out.noteHi } : {}) }];
  }
  if (out.action != null && out.action.trim() !== "" && out.actionMsgs == null) {
    out.actionMsgs = [{ id: "legacy-action", text: out.action, author: "(cũ)", at: out.updatedAt || "", ...(out.actionHi?.length ? { hi: out.actionHi } : {}) }];
  }
  delete out.note; delete out.action; delete out.noteHi; delete out.actionHi;
  return out;
}
function migrateMap(map: EditsMap): EditsMap {
  const out: EditsMap = {};
  for (const [k, v] of Object.entries(map)) out[k] = migrateEntry(v);
  return out;
}

type KVLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete?(key: string): Promise<void>;
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
    return { map: migrateMap(raw ? (JSON.parse(raw) as EditsMap) : {}), store: "kv" };
  }
  return { map: migrateMap(await devRead()), store: "file" };
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

/** `v` = phiên bản schema config. App CHỈ honor nguồn khi v>=2 (do tính năng "Nguồn dữ liệu" admin ghi)
 *  → config CŨ (trước khi khoá nguồn, không có v) TỰ bị bỏ qua, khỏi phải dọn KV tay khi bật lại. */
export type AppSharedConfig = { sheetUrl?: string; updatedAt?: string; v?: number };
export const APP_CONFIG_V = 2;

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
      devAs: z.string().nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    // CHỐT QUYỀN Ở SERVER: đổi NGUỒN CHUNG (mọi người thấy) là hành động nhạy cảm → CHỈ admin.
    // Chặn cả trường hợp gọi API trực tiếp không qua nút (nút đã ẩn với người thường).
    if (!(await callerIsAdmin(data.devAs))) throw new Error("Chỉ admin mới được đổi nguồn dữ liệu chung.");
    const cfg: AppSharedConfig = { sheetUrl: data.sheetUrl.trim(), updatedAt: new Date().toISOString(), v: APP_CONFIG_V };
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
  pic: z.string().max(300).nullable().optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

/** Entry rỗng (không còn box chat / pic / deadline) → xoá khỏi map (khôi phục theo sheet). */
function isEmptyEntry(e: ItemEdit): boolean {
  return !e.noteMsgs?.length && !e.actionMsgs?.length && e.pic == null && e.deadline == null;
}
function genId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Lưu PIC / Deadline (Vướng mắc & Giải pháp đã chuyển sang box chat → xem editMessages). */
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
    for (const [key, patch] of Object.entries(data.entries)) {
      const cur: ItemEdit = map[key] ?? { updatedAt: now };
      for (const f of ["pic", "deadline"] as const) {
        const v = patch[f];
        if (v === undefined) continue;
        if (v === null) delete cur[f];
        else { const t = v.trim(); if (t === "") delete cur[f]; else cur[f] = t; }
      }
      cur.updatedAt = now;
      if (isEmptyEntry(cur)) delete map[key];
      else map[key] = cur;
    }
    await writeAll(map);
    return { items: map, fetchedAt: now };
  });

/** BOX CHAT Vướng mắc / Giải pháp — thao tác theo TỪNG message (lưu vết ai · khi nào):
 *   add    : ai cũng thêm được; author = email phiên đăng nhập.
 *   hide   : ẩn khỏi bảng (= đã giải quyết) — TÁC GIẢ / ADMIN / PMO (PMO thao tác được tin người khác); unhide = mở lại.
 *   delete : ADMIN hoặc PMO — xoá hẳn (user thường KHÔNG có quyền, chỉ ẩn).
 *   edit   : sửa TEXT 1 message — tác giả (email khớp), ADMIN, hoặc PMO.
 *   sethi  : ADMIN & PMO — tô/bỏ tô màu 1 đoạn trong text của 1 message (đỏ ở Vướng mắc, navy ở Giải pháp).
 *   hiall  : ADMIN & PMO — tô CẢ Ô (mọi message KHÔNG ẩn tô full); unhiall = bỏ tô cả ô. */
export const editMessages = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      key: z.string().min(1).max(600),
      field: z.enum(["note", "action"]),
      op: z.enum(["add", "edit", "hide", "unhide", "delete", "sethi", "hiall", "unhiall"]),
      text: z.string().max(8000).optional(),
      msgId: z.string().max(80).optional(),
      hi: hiSchema.nullable().optional(),
      replyTo: z.string().max(80).optional(),
      replyText: z.string().max(300).optional(),
      devAs: z.string().nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { map } = await readAll();
    const now = new Date().toISOString();
    const cur: ItemEdit = map[data.key] ?? { updatedAt: now };
    const listKey = data.field === "note" ? "noteMsgs" : "actionMsgs";
    const list: ChatMsg[] = cur[listKey] ?? [];
    if (data.op === "add") {
      const text = (data.text ?? "").trim();
      // REPLY chỉ gắn cho cột GIẢI PHÁP (action) trả lời 1 vướng mắc; cột vướng mắc bỏ qua replyTo.
      const rep = data.field === "action" && data.replyTo
        ? { replyTo: data.replyTo, replyText: (data.replyText ?? "").slice(0, 300) }
        : {};
      if (text) list.push({ id: genId(), text, author: (await callerEmail(data.devAs)) ?? "?", at: now, hidden: false, ...rep });
    } else if (data.op === "edit") {
      // Sửa text: tác giả (email khớp), ADMIN, hoặc PMO. Text mới rỗng → bỏ qua (dùng ẩn/xoá).
      const m = list.find((x) => x.id === data.msgId);
      if (m) {
        const email = await callerEmail(data.devAs);
        const allowed = (email && email === m.author) || (await callerIsAdmin(data.devAs)) || (await callerIsPmo(data.devAs));
        const text = (data.text ?? "").trim();
        if (allowed && text) { m.text = text; m.editedAt = now; if (m.hi?.length) m.hi = [[0, text.length]]; }
      }
    } else if (data.op === "hide" || data.op === "unhide") {
      // CHỐT QUYỀN: TÁC GIẢ (email khớp), ADMIN, hoặc PMO mới ẩn/mở ẩn tin. PMO được ẩn tin NGƯỜI
      // KHÁC (chốt 31/07) — nhưng KHÔNG sửa text (edit vẫn chỉ tác giả/admin) và KHÔNG xoá (admin).
      const m = list.find((x) => x.id === data.msgId);
      if (m) {
        const email = await callerEmail(data.devAs);
        const allowed = (email && email === m.author) || (await callerIsAdmin(data.devAs)) || (await callerIsPmo(data.devAs));
        if (allowed) m.hidden = data.op === "hide";
      }
    } else if (data.op === "delete") {
      // CHỐT QUYỀN Ở SERVER: chỉ ADMIN hoặc PMO xoá hẳn (user thường bỏ qua lặng lẽ, UI cũng ẩn nút).
      if ((await callerIsAdmin(data.devAs)) || (await callerIsPmo(data.devAs))) {
        const i = list.findIndex((x) => x.id === data.msgId);
        if (i >= 0) list.splice(i, 1);
      }
    } else if (data.op === "sethi") {
      if ((await callerIsAdmin(data.devAs)) || (await callerIsPmo(data.devAs))) {   // ADMIN & PMO tô/bỏ màu (đỏ ở Vướng mắc, navy ở Giải pháp)
        const m = list.find((x) => x.id === data.msgId);
        if (m) { if (!data.hi || data.hi.length === 0) delete m.hi; else m.hi = clampRanges(data.hi, m.text.length); }
      }
    } else if (data.op === "hiall" || data.op === "unhiall") {
      // Tô/bỏ tô CẢ Ô: áp cho MỌI message KHÔNG ẩn (message ẩn không đụng).
      if ((await callerIsAdmin(data.devAs)) || (await callerIsPmo(data.devAs))) {
        for (const m of list) {
          if (m.hidden) continue;
          if (data.op === "hiall") m.hi = m.text ? [[0, m.text.length]] : undefined;
          else delete m.hi;
        }
      }
    }
    cur[listKey] = list.length ? list : undefined;
    cur.updatedAt = now;
    if (isEmptyEntry(cur)) delete map[data.key];
    else map[data.key] = cur;
    await writeAll(map);
    // MIRROR sang Drive: "Data Source" › DATABASE › ePMP › Ghi chú. SAO LƯU toàn bộ vướng mắc/giải pháp để
    // khôi phục được. CHỈ khi ĐỔI NỘI DUNG (add/edit/delete), bỏ qua thao tác tô màu/ẩn để đỡ spam.
    //  · GhiChu_latest.json          → bản MỚI NHẤT (đè liên tục) — lấy nhanh.
    //  · Lịch sử/GhiChu_YYYY-MM-DD.json → bản THEO NGÀY (giờ VN) — mỗi ngày 1 file: trong ngày ghi đè, qua
    //    ngày tạo file mới ⇒ giữ LỊCH SỬ, lỡ đè bậy vẫn lùi về ngày trước lấy lại được.
    if (data.op === "add" || data.op === "edit" || data.op === "delete") {
      try {
        const drive = await import("@/lib/drive.functions");
        if (await drive.driveIsConfigured()) {
          const payload = JSON.stringify({ at: now, edits: map }, null, 2);
          await drive.driveArchiveJson(["ePMP", "Ghi chú"], "GhiChu_latest.json", payload);
          const vnDate = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
          await drive.driveArchiveJson(["ePMP", "Ghi chú", "Lịch sử"], `GhiChu_${vnDate}.json`, payload);
        }
      } catch (e) { console.warn("[notes] mirror Drive bỏ qua:", (e as Error).message); }
    }
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

/* ── MỎ NEO NOTE (chống & phát hiện "trôi" note) ──
   Mỗi note (vướng mắc/giải pháp) NHỚ nó đang gắn ở ĐÂU: "maCT||tên dự án||giai đoạn||mô tả".
   Ghi LẦN ĐẦU (baseline) rồi giữ. Mỗi lần nạp nguồn, client so mỏ neo đã nhớ với vị trí HIỆN TẠI của
   cùng khoá — khác nhau = note đã TRÔI (nguồn đánh lại STT/đảo dòng) → cảnh báo before→after.
   THUẦN cộng thêm: không đổi khoá lưu note, không rủi ro mất dữ liệu. */
export type NoteAnchors = Record<string, string>;   // { [noteKey]: "maCT||tên||giai đoạn||mô tả" }
const NOTEANCHOR_KEY = "noteanchor:v1";
const DEV_NOTEANCHOR_FILE = ".data/pmo-noteanchor.json";
async function readNoteAnchors(): Promise<NoteAnchors> {
  const kv = await getKv();
  if (kv) { const raw = await kv.get(NOTEANCHOR_KEY); return raw ? (JSON.parse(raw) as NoteAnchors) : {}; }
  try { const fs = await import("node:fs/promises"); return JSON.parse(await fs.readFile(DEV_NOTEANCHOR_FILE, "utf8")) as NoteAnchors; }
  catch { return {}; }
}
async function writeNoteAnchors(map: NoteAnchors): Promise<void> {
  const kv = await getKv();
  if (kv) { await kv.put(NOTEANCHOR_KEY, JSON.stringify(map)); return; }
  const fs = await import("node:fs/promises");
  await fs.mkdir(".data", { recursive: true });
  await fs.writeFile(DEV_NOTEANCHOR_FILE, JSON.stringify(map, null, 2), "utf8");
}
export const fetchNoteAnchors = createServerFn({ method: "GET" }).handler(async () => {
  return { anchors: await readNoteAnchors() };
});
/** add = ghi mỏ neo LẦN ĐẦU (chỉ khi chưa có → giữ "trước đó nằm ở đâu"). set = ghi đè (khi user xác
 *  nhận đã đưa note về đúng chỗ). remove = xoá mỏ neo của note không còn tồn tại. */
export const syncNoteAnchors = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      add: z.record(z.string().min(1).max(600), z.string().max(600)).optional(),
      set: z.record(z.string().min(1).max(600), z.string().max(600)).optional(),
      remove: z.array(z.string().min(1).max(600)).optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const map = await readNoteAnchors();
    let changed = 0;
    for (const [k, v] of Object.entries(data.add ?? {})) if (!(k in map)) { map[k] = v; changed++; }
    for (const [k, v] of Object.entries(data.set ?? {})) if (map[k] !== v) { map[k] = v; changed++; }
    for (const k of data.remove ?? []) if (k in map) { delete map[k]; changed++; }
    if (changed > 0) await writeNoteAnchors(map);
    return { anchors: map, changed };
  });

/* ── CỜ "CẦN CẬP NHẬT MP / TRÌNH BOD" — app tự ghi NGÀY LẦN ĐẦU thấy cờ ──
   Dùng để chấm "không trình BOD: −10 điểm / mỗi tuần cờ còn tồn tại". Sheet KHÔNG biết vướng mắc;
   APP phát hiện dự án có vướng mắc "trình BOD phê duyệt (Bitrix)" rồi ghi ngày LẦN ĐẦU thấy vào đây.
   Note đổi / hết cờ → XOÁ để RESET (tái phát sau tính lại từ đầu). Giống hệt completed:v1
   (add-ngày-lần-đầu + remove). Khoá = pkProj (khoá dự án). */
export type MpFlagFirstSeen = Record<string, string>; // { [projectKey]: ISO "YYYY-MM-DD" ngày lần đầu thấy cờ }
const MPFLAG_KEY = "mpflag:v1";
const DEV_MPFLAG_FILE = ".data/pmo-mpflag.json";

async function readMpFlags(): Promise<MpFlagFirstSeen> {
  const kv = await getKv();
  if (kv) { const raw = await kv.get(MPFLAG_KEY); return raw ? (JSON.parse(raw) as MpFlagFirstSeen) : {}; }
  try { const fs = await import("node:fs/promises"); return JSON.parse(await fs.readFile(DEV_MPFLAG_FILE, "utf8")) as MpFlagFirstSeen; }
  catch { return {}; }
}
async function writeMpFlags(map: MpFlagFirstSeen): Promise<void> {
  const kv = await getKv();
  if (kv) { await kv.put(MPFLAG_KEY, JSON.stringify(map)); return; }
  const fs = await import("node:fs/promises");
  await fs.mkdir(".data", { recursive: true });
  await fs.writeFile(DEV_MPFLAG_FILE, JSON.stringify(map, null, 2), "utf8");
}

/** Đọc mốc "ngày lần đầu thấy cờ MP/BOD" của mọi dự án (dùng chung). */
export const fetchMpFlags = createServerFn({ method: "GET" }).handler(async () => {
  return { mpFlags: await readMpFlags() };
});

/** Đồng bộ cờ MP/BOD: THÊM ngày lần đầu (chỉ khi CHƯA có → giữ mốc gốc, không dời) + XOÁ (khi hết
 *  cờ). Client tính DELTA nên bình thường không gọi API (giảm ghi KV). */
export const syncMpFlags = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      add: z.record(z.string().min(1).max(600), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
      remove: z.array(z.string().min(1).max(600)),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const map = await readMpFlags();
    let changed = 0;
    for (const [key, date] of Object.entries(data.add)) if (!map[key]) { map[key] = date; changed++; }
    for (const key of data.remove) if (map[key]) { delete map[key]; changed++; }
    if (changed > 0) await writeMpFlags(map);
    return { mpFlags: map, changed };
  });

/* ── DI TRÚ KHOÁ: (mã+tên) đời cũ → ID (cột STT) ──
   App đổi khoá match từ tên dự án sang ID phân cấp (STT). Mọi ghi chú/ngày kết thúc/lịch sử update
   ĐÃ LƯU theo khoá tên cũ sẽ "mồ côi" nếu không dời. Hàm này CHUYỂN chúng sang khoá ID.

   AN TOÀN: chỉ dời khi khoá cũ CÓ dữ liệu và khoá mới CHƯA có (không đè). CHẠY 1 LẦN thực chất —
   client chỉ gọi khi còn phát hiện khoá cũ; dời xong lần sau không còn khoá cũ → không gọi nữa →
   không tốn ghi KV. `updates` (mảng ngày) nếu cả cũ+mới đều có thì HỢP NHẤT (không mất ngày nào). */
export const remapKeys = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      edits: z.record(z.string().min(1).max(600), z.string().min(1).max(600)),
      completed: z.record(z.string().min(1).max(600), z.string().min(1).max(600)),
      updates: z.record(z.string().min(1).max(600), z.string().min(1).max(600)),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    let moved = 0, merged = 0;
    // Nối message (note/giải pháp là DANH SÁCH) — trùng id thì đổi id để KHÔNG mất tin nào (vd 2 "legacy-note").
    const mergeMsgs = (t: ChatMsg[] = [], s: ChatMsg[] = []): ChatMsg[] => {
      const ids = new Set(t.map((m) => m.id)); const out = [...t];
      s.forEach((m, i) => { let id = m.id; while (ids.has(id)) id = `${m.id}-mg${i}-${out.length}`; ids.add(id); out.push(id === m.id ? m : { ...m, id }); });
      return out;
    };
    // 1) EDITS (vướng mắc/giải pháp/PIC/deadline — cấp dự án lẫn hạng mục dùng chung kho này)
    const { map: em } = await readAll();
    let emChanged = false;
    for (const [oldK, newK] of Object.entries(data.edits)) {
      if (oldK === newK || !em[oldK]) continue;
      if (!em[newK]) { em[newK] = em[oldK]; delete em[oldK]; emChanged = true; moved++; }
      else {
        // ĐÍCH đã có note → GỘP (không bỏ qua): 1 ô note chứa nhiều message nên nối thêm là đúng, không mất gì.
        const t = migrateEntry(em[newK]), s = migrateEntry(em[oldK]);
        const noteMsgs = mergeMsgs(t.noteMsgs, s.noteMsgs);
        const actionMsgs = mergeMsgs(t.actionMsgs, s.actionMsgs);
        em[newK] = { ...s, ...t, ...(noteMsgs.length ? { noteMsgs } : {}), ...(actionMsgs.length ? { actionMsgs } : {}), updatedAt: (s.updatedAt > t.updatedAt ? s.updatedAt : t.updatedAt) || t.updatedAt };
        delete em[oldK]; emChanged = true; moved++; merged++;
      }
    }
    if (emChanged) await writeAll(em);
    // 2) COMPLETED (ngày kết thúc thực tế — cấp hạng mục/Block)
    const cm = await readCompleted();
    let cmChanged = false;
    for (const [oldK, newK] of Object.entries(data.completed)) {
      if (oldK === newK) continue;
      if (cm[oldK] && !cm[newK]) { cm[newK] = cm[oldK]; delete cm[oldK]; cmChanged = true; moved++; }
    }
    if (cmChanged) await writeCompleted(cm);
    // 3) UPDATES (lịch sử ngày cập nhật — cấp dự án; hợp nhất mảng nếu cả hai tồn tại)
    const um = await readUpdates();
    let umChanged = false;
    for (const [oldK, newK] of Object.entries(data.updates)) {
      if (oldK === newK || !um[oldK]) continue;
      if (!um[newK]) { um[newK] = um[oldK]; delete um[oldK]; umChanged = true; moved++; }
      else { um[newK] = Array.from(new Set([...um[newK], ...um[oldK]])).sort(); delete um[oldK]; umChanged = true; moved++; }
    }
    if (umChanged) await writeUpdates(um);
    return { edits: em, completed: cm, updates: um, moved, merged };
  });

/* ── SỬA LỆCH KHOÁ DO CHÈN DỰ ÁN (STT bị dồn) ──
   Chèn 1 dự án ở giữa (vd STT 11) rồi đánh lại STT → mọi ghi chú/ngày khoá theo `id:<STT>` từ vị trí đó
   trở đi lệch sang dự án khác. Hàm này DỜI khoá `id:<N>[.sub]` → `id:<N+delta>[.sub]` cho N ≥ from, áp cho
   CẢ 4 kho (edits · completed · updates · mpflag). CHỐT theo `tag` (lưu ở sysmig:v1) → chạy ĐÚNG 1 LẦN.
   `dryRun`=true: chỉ đếm + trả mẫu, KHÔNG ghi. Khoá không phải dạng id:<số> (code\0name, h:…) giữ nguyên.
   Dựng map MỚI hoàn toàn nên phép dời là 1-1, không đè khoá (N≥from→≥from+delta, không đụng khoá <from). */
const SYSMIG_KEY = "sysmig:v1";
const DEV_SYSMIG_FILE = ".data/pmo-sysmig.json";
async function readSysmig(): Promise<Record<string, string>> {
  const kv = await getKv();
  if (kv) { const raw = await kv.get(SYSMIG_KEY); return raw ? (JSON.parse(raw) as Record<string, string>) : {}; }
  try { const fs = await import("node:fs/promises"); return JSON.parse(await fs.readFile(DEV_SYSMIG_FILE, "utf8")) as Record<string, string>; }
  catch { return {}; }
}
async function writeSysmig(map: Record<string, string>): Promise<void> {
  const kv = await getKv();
  if (kv) { await kv.put(SYSMIG_KEY, JSON.stringify(map)); return; }
  const fs = await import("node:fs/promises");
  await fs.mkdir(".data", { recursive: true });
  await fs.writeFile(DEV_SYSMIG_FILE, JSON.stringify(map, null, 2), "utf8");
}

export const remapInsertShift = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      from: z.number().int().min(1),
      delta: z.number().int().min(-500).max(500),
      tag: z.string().min(1).max(80),
      dryRun: z.boolean().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const mig = await readSysmig();
    const already = !!mig[data.tag];
    const idRe = /^id:(\d+)(.*)$/s;
    const shiftKey = (k: string): string => {
      const m = idRe.exec(k);
      if (!m) return k;
      const n = parseInt(m[1], 10);
      return n >= data.from ? `id:${n + data.delta}${m[2]}` : k;
    };
    const remap = <T>(map: Record<string, T>): { out: Record<string, T>; moved: number; samples: string[] } => {
      const out: Record<string, T> = {}; let moved = 0; const samples: string[] = [];
      for (const [k, v] of Object.entries(map)) {
        const nk = shiftKey(k);
        if (nk !== k) { moved++; if (samples.length < 10) samples.push(`${k} → ${nk}`); }
        out[nk] = v;
      }
      return { out, moved, samples };
    };
    const { map: em } = await readAll();
    const cm = await readCompleted();
    const um = await readUpdates();
    const fm = await readMpFlags();
    const rEm = remap(em), rCm = remap(cm), rUm = remap(um), rFm = remap(fm);
    const moved = rEm.moved + rCm.moved + rUm.moved + rFm.moved;
    const breakdown = { edits: rEm.moved, completed: rCm.moved, updates: rUm.moved, mpflag: rFm.moved };
    const samples = [...rEm.samples, ...rFm.samples].slice(0, 12);
    // TRẢ VỀ ĐỒNG NHẤT 1 shape (dễ dùng phía client, khỏi narrow union).
    if (data.dryRun) return { dryRun: true, done: false, skipped: false, already, moved, breakdown, samples };
    if (already) return { dryRun: false, done: false, skipped: true, already: true, moved: 0, breakdown, samples };
    await snapshotBackup(`Trước khi sửa lệch STT (${data.tag})`);   // LƯỚI AN TOÀN: chụp bản gốc trước khi dời
    if (rEm.moved) await writeAll(rEm.out);
    if (rCm.moved) await writeCompleted(rCm.out);
    if (rUm.moved) await writeUpdates(rUm.out);
    if (rFm.moved) await writeMpFlags(rFm.out);
    mig[data.tag] = new Date().toISOString();
    await writeSysmig(mig);
    return { dryRun: false, done: true, skipped: false, already: false, moved, breakdown, samples };
  });

/* ── SAO LƯU / KHÔI PHỤC (edits + completed + updates + mpflag) ──
   Trước mỗi thao tác NGUY HIỂM (dời khoá / đóng khoá bền) TỰ CHỤP 1 bản; admin có thể KHÔI PHỤC lại khi lệch.
   Giữ tối đa 8 bản gần nhất. KV `edits:baks:v1` (dev: .data/pmo-baks.json). */
type EditsBackup = { id: string; label: string; at: string; edits: EditsMap; completed: CompletedDates; updates: UpdateHistory; mpflag: MpFlagFirstSeen };
const BAKS_KEY = "edits:baks:v1";
const DEV_BAKS_FILE = ".data/pmo-baks.json";
async function readBaks(): Promise<EditsBackup[]> {
  const kv = await getKv();
  if (kv) { const raw = await kv.get(BAKS_KEY); return raw ? (JSON.parse(raw) as EditsBackup[]) : []; }
  try { const fs = await import("node:fs/promises"); return JSON.parse(await fs.readFile(DEV_BAKS_FILE, "utf8")) as EditsBackup[]; }
  catch { return []; }
}
async function writeBaks(list: EditsBackup[]): Promise<void> {
  const kv = await getKv();
  if (kv) { await kv.put(BAKS_KEY, JSON.stringify(list)); return; }
  const fs = await import("node:fs/promises");
  await fs.mkdir(".data", { recursive: true });
  await fs.writeFile(DEV_BAKS_FILE, JSON.stringify(list, null, 2), "utf8");
}
/** Chụp trạng thái hiện tại thành 1 bản sao lưu (đầu danh sách), cắt còn 8 bản. */
async function snapshotBackup(label: string): Promise<EditsBackup> {
  const em = (await readAll()).map, cm = await readCompleted(), um = await readUpdates(), fm = await readMpFlags();
  const bak: EditsBackup = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label, at: new Date().toISOString(), edits: em, completed: cm, updates: um, mpflag: fm };
  const list = await readBaks();
  list.unshift(bak);
  while (list.length > 8) list.pop();
  await writeBaks(list);
  return bak;
}
const bakCounts = (b: EditsBackup) => ({ edits: Object.keys(b.edits).length, completed: Object.keys(b.completed).length, updates: Object.keys(b.updates).length, mpflag: Object.keys(b.mpflag).length });

/** Tạo bản sao lưu NGAY (admin bấm tay). */
export const backupEdits = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ label: z.string().min(1).max(120) }).parse(input))
  .handler(async ({ data }) => { const b = await snapshotBackup(data.label); return { id: b.id, at: b.at, counts: bakCounts(b) }; });

/** Liệt kê các bản sao lưu (chỉ meta, không kèm nội dung). */
export const listBackups = createServerFn({ method: "GET" }).handler(async () => {
  const list = await readBaks();
  return { backups: list.map((b) => ({ id: b.id, label: b.label, at: b.at, counts: bakCounts(b) })) };
});

/** KHÔI PHỤC 1 bản sao lưu → ghi đè 4 kho. Tự chụp bản HIỆN TẠI trước (khôi phục nhầm vẫn quay lại được). */
export const restoreBackup = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ id: z.string().min(1).max(80) }).parse(input))
  .handler(async ({ data }) => {
    const list = await readBaks();
    const bak = list.find((b) => b.id === data.id);
    if (!bak) throw new Error("Không thấy bản sao lưu này");
    await snapshotBackup("Tự chụp trước khi khôi phục");
    await writeAll(bak.edits); await writeCompleted(bak.completed); await writeUpdates(bak.updates); await writeMpFlags(bak.mpflag);
    return { restored: bak.id, at: bak.at, counts: bakCounts(bak) };
  });

/* ── PHÂN CẤP NGƯỜI DÙNG (badge chức vụ PMO/BOD trong comment) — ADMIN tự quản, KHÔNG cần sửa code ──
   Kho KV `roles:v1` = { [email]: "PMO" | "BOD" }. Đọc CÔNG KHAI (mọi người cần để render badge);
   GHI chỉ ADMIN. KV TRỐNG → seed từ DEFAULT_ROLES ở lần ghi đầu (từ đó KV là nguồn sự thật). */
const ROLES_KEY = "roles:v1";
const DEV_ROLES_FILE = ".data/pmo-roles.json";
export type UserRoleMap = Record<string, UserRole>;

async function readRoles(): Promise<UserRoleMap> {
  const kv = await getKv();
  if (kv) { const raw = await kv.get(ROLES_KEY); return raw ? (JSON.parse(raw) as UserRoleMap) : {}; }
  try { const fs = await import("node:fs/promises"); return JSON.parse(await fs.readFile(DEV_ROLES_FILE, "utf8")) as UserRoleMap; }
  catch { return {}; }
}
async function writeRoles(map: UserRoleMap): Promise<void> {
  const kv = await getKv();
  if (kv) { await kv.put(ROLES_KEY, JSON.stringify(map)); return; }
  const fs = await import("node:fs/promises");
  await fs.mkdir(".data", { recursive: true });
  await fs.writeFile(DEV_ROLES_FILE, JSON.stringify(map, null, 2), "utf8");
}

/** Đọc bảng phân cấp (email → cấp). CÔNG KHAI — client cần để hiện badge cho mọi người. */
export const fetchUserRoles = createServerFn({ method: "GET" }).handler(async () => {
  return { roles: await readRoles() };
});

/** Đặt/gỡ cấp cho 1 email — CHỈ ADMIN. role=null → gỡ khỏi bảng (về "users"). */
export const saveUserRole = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      email: z.string().email().max(200),
      role: z.enum(["PMO", "BOD"]).nullable(),
      devAs: z.string().nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    if (!(await callerIsAdmin(data.devAs))) throw new Error("Chỉ admin mới được phân cấp người dùng.");
    const cur = await readRoles();
    // KV trống → seed DEFAULT_ROLES rồi mới áp thay đổi (giữ nguyên các badge sẵn có).
    const map: UserRoleMap = Object.keys(cur).length ? cur : { ...DEFAULT_ROLES };
    const email = normEmail(data.email);
    if (!email) throw new Error("Email không hợp lệ.");
    if (data.role) map[email] = data.role; else delete map[email];
    await writeRoles(map);
    return { roles: map };
  });

/* ── ẨN DÒNG THỦ CÔNG (admin) — kho KV `hidden:v1` = { [itemKey]: { at, by } } ──
   Admin ẩn các hạng mục "nằm trong khuôn khổ, không đáng raise" khỏi báo cáo (bảng + KPI + PDF +
   Excel cho MỌI người); bỏ ẩn được. Khoá = itemKeyOf (ID cột STT, ổn định). Đọc CÔNG KHAI (client
   cần để loại khỏi hiển thị); GHI chỉ ADMIN. Lưu ai/khi để có vết. */
const HIDDEN_KEY = "hidden:v1";
const DEV_HIDDEN_FILE = ".data/pmo-hidden.json";
export type HiddenRows = Record<string, { at: string; by: string }>;

async function readHidden(): Promise<HiddenRows> {
  const kv = await getKv();
  if (kv) { const raw = await kv.get(HIDDEN_KEY); return raw ? (JSON.parse(raw) as HiddenRows) : {}; }
  try { const fs = await import("node:fs/promises"); return JSON.parse(await fs.readFile(DEV_HIDDEN_FILE, "utf8")) as HiddenRows; }
  catch { return {}; }
}
async function writeHidden(map: HiddenRows): Promise<void> {
  const kv = await getKv();
  if (kv) { await kv.put(HIDDEN_KEY, JSON.stringify(map)); return; }
  const fs = await import("node:fs/promises");
  await fs.mkdir(".data", { recursive: true });
  await fs.writeFile(DEV_HIDDEN_FILE, JSON.stringify(map, null, 2), "utf8");
}

/** Đọc danh sách dòng đã ẩn (khoá item → ai ẩn, khi nào). CÔNG KHAI — client cần để loại khỏi bảng/KPI. */
export const fetchHiddenRows = createServerFn({ method: "GET" }).handler(async () => {
  return { hidden: await readHidden() };
});

/** Ẩn / bỏ ẩn 1 dòng — CHỈ ADMIN. hide=true để ẩn, false để bỏ ẩn. */
export const setHiddenRow = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      key: z.string().min(1).max(600),
      hide: z.boolean(),
      devAs: z.string().nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    if (!(await callerIsAdmin(data.devAs))) throw new Error("Chỉ admin mới được ẩn / bỏ ẩn dòng.");
    const map = await readHidden();
    if (data.hide) map[data.key] = { at: new Date().toISOString(), by: (await callerEmail(data.devAs)) ?? "?" };
    else delete map[data.key];
    await writeHidden(map);
    return { hidden: map };
  });

/* ── TUỲ CHỈNH VÙNG POPUP (admin) — kho KV `sheetview:v1` = { [linkKey]: { sheet?, range? } } ──
   Popup hyperlink: admin khai TÊN SHEET + VÙNG (A1) cho từng link → app chụp ĐÚNG vùng đó bằng PDF của
   Google (chart + màu y hệt). Để TRỐNG cả hai → chạy logic mặc định (tự nhận dạng / cả tab). Lưu theo
   linkKey (chính là `fileId` popup nhận, dạng "fid" hoặc "fid|gid"). Đọc CÔNG KHAI (client cần để áp cấu
   hình đã lưu cho mọi người xem); GHI chỉ ADMIN. */
const SHEETVIEW_KEY = "sheetview:v1";
const DEV_SHEETVIEW_FILE = ".data/pmo-sheetview.json";
/** pdf=true → ÉP chụp PDF (bỏ tự-nhận-dạng heatmap); sheet/range = tinh chỉnh tab + vùng (tuỳ chọn).
 *  fileId/gid: khi PMO GẮN LINK THẲNG trong app (không qua hyperlink file import) — key = khoá bền dự án
 *  (Mã CT + Tên). Có fileId → dự án đó hiện 📊 cho mọi người, popup chụp PDF từ link này. */
export type SheetViewCfg = { pdf?: boolean; fileId?: string; gid?: string; sheet?: string; range?: string; tl?: string; br?: string; snap?: boolean; chart?: boolean };
// chart=true → mặc định mở popup ở BẢN CÓ CHART (ảnh Google) cho MỌI người xem (PMO set); vẫn có nút đổi qua lưới.
// snap=true → đã có ẢNH RENDER (HTML) lưu sẵn ở KV `sheetsnap:<key>` (render 1 lần lúc PMO lưu). Viewer chỉ
// tải HTML nhỏ đó, KHÔNG tải/parse xlsx → nhẹ, chịu được hàng loạt chart.
// tl/br = 2 ký hiệu marker đặt ở 2 ô góc (trên-trái / dưới-phải) của vùng. Có → app tự dò range theo marker
// (chống lệch khi chèn/dời dòng cột), thay cho range gõ tay.
export type SheetViewMap = Record<string, SheetViewCfg>;

async function readSheetViews(): Promise<SheetViewMap> {
  const kv = await getKv();
  if (kv) { const raw = await kv.get(SHEETVIEW_KEY); return raw ? (JSON.parse(raw) as SheetViewMap) : {}; }
  try { const fs = await import("node:fs/promises"); return JSON.parse(await fs.readFile(DEV_SHEETVIEW_FILE, "utf8")) as SheetViewMap; }
  catch { return {}; }
}
async function writeSheetViews(map: SheetViewMap): Promise<void> {
  const kv = await getKv();
  if (kv) { await kv.put(SHEETVIEW_KEY, JSON.stringify(map)); return; }
  const fs = await import("node:fs/promises");
  await fs.mkdir(".data", { recursive: true });
  await fs.writeFile(DEV_SHEETVIEW_FILE, JSON.stringify(map, null, 2), "utf8");
}

/** Đọc cấu hình vùng đã lưu cho 1 link (hoặc cả bảng nếu không truyền key). CÔNG KHAI. */
export const getSheetViews = createServerFn({ method: "GET" }).handler(async () => {
  return { views: await readSheetViews() };
});

/** Lưu/gỡ cấu hình cho 1 link — CHỈ ADMIN. pdf=false → gỡ (về mặc định tự-nhận-dạng). */
export const saveSheetView = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      key: z.string().min(1).max(200),
      pdf: z.boolean().optional(),
      fileId: z.string().max(120).regex(/^[a-zA-Z0-9_-]*$/).optional(),   // link PMO gắn thẳng (Google file id)
      gid: z.string().max(30).regex(/^\d*$/).optional(),
      sheet: z.string().max(80).regex(/^[^\n\r]*$/).optional(),
      range: z.string().max(40).regex(/^[^\n\r]*$/).optional(),
      tl: z.string().max(40).regex(/^[^\n\r]*$/).optional(),   // marker góc trên-trái
      br: z.string().max(40).regex(/^[^\n\r]*$/).optional(),   // marker góc dưới-phải
      snap: z.boolean().optional(),                            // đã có snapshot HTML lưu ở sheetsnap:<key>
      chart: z.boolean().optional(),                           // mặc định mở BẢN CÓ CHART cho mọi người
      devAs: z.string().nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    if (!((await callerIsAdmin(data.devAs)) || (await callerIsPmo(data.devAs)))) throw new Error("Chỉ admin/PMO mới được gắn/tuỳ chỉnh link.");
    const map = await readSheetViews();
    const sheet = (data.sheet ?? "").trim();
    const range = (data.range ?? "").trim();
    const fileId = (data.fileId ?? "").trim();
    const gid = (data.gid ?? "").trim();
    const tl = (data.tl ?? "").trim();
    const br = (data.br ?? "").trim();
    if (!data.pdf) delete map[data.key];   // tắt ép PDF / gỡ link → về mặc định (không hiện 📊 nếu là khoá dự án)
    else map[data.key] = { pdf: true, ...(fileId ? { fileId } : {}), ...(gid ? { gid } : {}), ...(sheet ? { sheet } : {}), ...(range ? { range } : {}), ...(tl ? { tl } : {}), ...(br ? { br } : {}), ...(data.snap ? { snap: true } : {}), ...(data.chart ? { chart: true } : {}) };
    await writeSheetViews(map);
    return { views: map };
  });

/* ── FORM BÁO CÁO TUÂN THỦ (admin/PMO "chỉnh bảng": kéo rộng cột + cỡ chữ + in đậm) — KV `complianceform:v1`.
   Đọc CÔNG KHAI (mọi người thấy form đã chốt); GHI chỉ ADMIN/PMO. Áp cho cả màn hình lẫn bản in PDF. ── */
const COMPLIANCE_FORM_KEY = "complianceform:v1";
const DEV_COMPLIANCEFORM_FILE = ".data/pmo-complianceform.json";
export type ComplianceForm = { colW?: number[]; fontPx?: number; bold?: boolean; colBold?: boolean[]; colFontPx?: number[]; locked?: boolean; rowH?: number };
async function readComplianceForm(): Promise<ComplianceForm | null> {
  const kv = await getKv();
  if (kv) { const raw = await kv.get(COMPLIANCE_FORM_KEY); return raw ? (JSON.parse(raw) as ComplianceForm) : null; }
  try { const fs = await import("node:fs/promises"); return JSON.parse(await fs.readFile(DEV_COMPLIANCEFORM_FILE, "utf8")) as ComplianceForm; }
  catch { return null; }
}
export const getComplianceForm = createServerFn({ method: "GET" }).handler(async (): Promise<{ form: ComplianceForm | null }> => {
  return { form: await readComplianceForm() };
});
export const saveComplianceForm = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({
    colW: z.array(z.number().min(0).max(100)).max(40).optional(),
    fontPx: z.number().min(7).max(24).optional(),
    bold: z.boolean().optional(),
    colBold: z.array(z.boolean()).max(40).optional(),
    colFontPx: z.array(z.number().min(0).max(24)).max(40).optional(),
    locked: z.boolean().optional(),
    rowH: z.number().min(0).max(60).optional(),
    devAs: z.string().nullable().optional(),
  }).parse(input))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    if (!(await callerIsAdmin(data.devAs))) throw new Error("Chỉ admin mới được chỉnh form báo cáo tuân thủ.");
    const form: ComplianceForm = { ...(data.colW ? { colW: data.colW } : {}), ...(data.fontPx ? { fontPx: data.fontPx } : {}), ...(data.bold ? { bold: true } : {}), ...(data.colBold ? { colBold: data.colBold } : {}), ...(data.colFontPx ? { colFontPx: data.colFontPx } : {}), ...(data.locked ? { locked: true } : {}), ...(data.rowH ? { rowH: data.rowH } : {}) };
    const kv = await getKv();
    if (kv) { await kv.put(COMPLIANCE_FORM_KEY, JSON.stringify(form)); }
    else { const fs = await import("node:fs/promises"); await fs.mkdir(".data", { recursive: true }); await fs.writeFile(DEV_COMPLIANCEFORM_FILE, JSON.stringify(form, null, 2), "utf8"); }
    return { ok: true };
  });

/* ── NGUỒN DST (app "Theo dõi tiến độ chi tiết") — link PMO import DÍNH CỨNG (KV `dst:source:v1`) đến khi
   đổi link. Trước đây reload là về file mẫu. Đọc CÔNG KHAI; GHI chỉ ADMIN/PMO. ── */
const DST_SOURCE_KEY = "dst:source:v1";
const DEV_DSTSOURCE_FILE = ".data/pmo-dst-source.json";
export type DstSource = { fileId: string; gid?: string; sheet?: string; full?: boolean };
async function readDstSource(): Promise<DstSource | null> {
  const kv = await getKv();
  if (kv) { const raw = await kv.get(DST_SOURCE_KEY); return raw ? (JSON.parse(raw) as DstSource) : null; }
  try { const fs = await import("node:fs/promises"); return JSON.parse(await fs.readFile(DEV_DSTSOURCE_FILE, "utf8")) as DstSource; }
  catch { return null; }
}
export const getDstSource = createServerFn({ method: "GET" }).handler(async (): Promise<{ source: DstSource | null }> => {
  return { source: await readDstSource() };
});
export const saveDstSource = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({
    fileId: z.string().min(10).max(120).regex(/^[a-zA-Z0-9_-]+$/),
    gid: z.string().max(30).regex(/^\d*$/).optional(),
    sheet: z.string().max(120).regex(/^[^\n\r]*$/).optional(),
    full: z.boolean().optional(),
    devAs: z.string().nullable().optional(),
  }).parse(input))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    if (!((await callerIsAdmin(data.devAs)) || (await callerIsPmo(data.devAs)))) throw new Error("Chỉ admin/PMO mới được đổi nguồn DST.");
    const src: DstSource = { fileId: data.fileId, ...(data.gid ? { gid: data.gid } : {}), ...(data.sheet ? { sheet: data.sheet } : {}), ...(data.full ? { full: true } : {}) };
    const kv = await getKv();
    if (kv) { await kv.put(DST_SOURCE_KEY, JSON.stringify(src)); }
    else { const fs = await import("node:fs/promises"); await fs.mkdir(".data", { recursive: true }); await fs.writeFile(DEV_DSTSOURCE_FILE, JSON.stringify(src, null, 2), "utf8"); }
    // MIRROR sang Drive: "Data Source" › DATABASE › DST › DST_source.json — CON TRỎ tới file nguồn (fileId/gid),
    // KHÔNG phải dữ liệu (dữ liệu DST parse ở client). Best-effort.
    try {
      const drive = await import("@/lib/drive.functions");
      if (await drive.driveIsConfigured()) {
        const link = `https://docs.google.com/spreadsheets/d/${src.fileId}/edit${src.gid ? `#gid=${src.gid}` : ""}`;
        await drive.driveArchiveJson(["DST"], "DST_source.json", JSON.stringify({ ...src, link, at: new Date().toISOString(), by: (await callerEmail(data.devAs)) ?? "?" }, null, 2));
      }
    } catch (e) { console.warn("[dst-source] mirror Drive bỏ qua:", (e as Error).message); }
    return { ok: true };
  });

/* ── FORM MA TRẬN (admin "chỉnh như Excel") — kho KV `sheetform:v1` = { [formKey]: FormSpec }. FORM = bố cục
   người dùng (độ rộng cột / cao dòng), màu theo MÃ + theo Ô, chữ đè, ẩn cột/dòng — ĐÈ lên dữ liệu SỐNG. Lưu
   1 form / 1 link (formKey = "fid::sheet::range") → số liệu đổi vẫn giữ nguyên bố cục ("bê form lên data khác").
   Đọc CÔNG KHAI (viewer cần áp form); GHI chỉ ADMIN/PMO. */
const SHEETFORM_KEY = "sheetform:v1";
const DEV_SHEETFORM_FILE = ".data/pmo-sheetform.json";
export type SheetForm = {
  colW?: Record<string, number>; rowH?: Record<string, number>;
  cellColor?: Record<string, string>; cellFg?: Record<string, string>;
  codeColor?: Record<string, string>; cellText?: Record<string, string>;
  hiddenC?: number[]; hiddenR?: number[];
  rules?: { r1: number; c1: number; r2: number; c2: number; mode: "scale" | "palette" | "steps"; from?: number; to?: number; colors?: string[] }[];
  zoom?: number;   // mức phóng to đã lưu → mở lại (kể cả ô MTLĐ) hiện đúng cỡ này
  boxW?: number;   // cỡ KHUNG CHIẾU ma trận (px) admin đã kéo — lưu vào form nên MỌI NGƯỜI thấy như nhau
  boxH?: number;
  // BẢNG KHU — cho dự án KHÔNG có heatmap (khu public: chart khác dạng, không dựng được bản đồ ô).
  // Lưới đơn giản `cols` cột, mỗi ô là 1 KHU; bấm ô = mở kho ảnh/video của khu đó.
  zones?: { cols: number; h?: number };   // bố cục BẢNG KHU: số cột + chiều cao ô (tên khu đọc từ sheet)
};
export type SheetFormMap = Record<string, SheetForm>;
async function readSheetForms(): Promise<SheetFormMap> {
  const kv = await getKv();
  if (kv) { const raw = await kv.get(SHEETFORM_KEY); return raw ? (JSON.parse(raw) as SheetFormMap) : {}; }
  try { const fs = await import("node:fs/promises"); return JSON.parse(await fs.readFile(DEV_SHEETFORM_FILE, "utf8")) as SheetFormMap; }
  catch { return {}; }
}
async function writeSheetForms(map: SheetFormMap): Promise<void> {
  const kv = await getKv();
  if (kv) { await kv.put(SHEETFORM_KEY, JSON.stringify(map)); return; }
  const fs = await import("node:fs/promises");
  await fs.mkdir(".data", { recursive: true });
  await fs.writeFile(DEV_SHEETFORM_FILE, JSON.stringify(map, null, 2), "utf8");
}
/** Đọc mọi form đã lưu (CÔNG KHAI) — map nhẹ (chỉ số + màu), viewer áp lúc render. */
export const getSheetForms = createServerFn({ method: "GET" }).handler(async () => {
  return { forms: await readSheetForms() };
});
const colorZ = z.string().max(30);
const numRecZ = z.record(z.string().max(16), z.number().min(0).max(4000));
/** Lưu/gỡ form cho 1 link — CHỈ ADMIN/PMO. spec rỗng/không truyền → gỡ form (về mặc định). */
export const saveSheetForm = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      key: z.string().min(1).max(200),
      spec: z.object({
        colW: numRecZ.optional(), rowH: numRecZ.optional(),
        cellColor: z.record(z.string().max(16), colorZ).optional(),
        cellFg: z.record(z.string().max(16), colorZ).optional(),
        codeColor: z.record(z.string().max(60), colorZ).optional(),
        cellText: z.record(z.string().max(16), z.string().max(300)).optional(),
        hiddenC: z.array(z.number()).max(600).optional(),
        hiddenR: z.array(z.number()).max(3000).optional(),
        rules: z.array(z.object({ r1: z.number(), c1: z.number(), r2: z.number(), c2: z.number(), mode: z.enum(["scale", "palette", "steps"]), from: z.number().optional(), to: z.number().optional(), colors: z.array(z.string().max(30)).max(24).optional() })).max(300).optional(),
        zoom: z.number().min(0.2).max(5).optional(),
        boxW: z.number().min(200).max(6000).optional(),
        boxH: z.number().min(160).max(4000).optional(),
        zones: z.object({ cols: z.number().min(1).max(8), h: z.number().min(40).max(600).optional() }).optional(),
      }).nullable().optional(),
      devAs: z.string().nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    if (!((await callerIsAdmin(data.devAs)) || (await callerIsPmo(data.devAs)))) throw new Error("Chỉ admin/PMO mới được lưu form.");
    const map = await readSheetForms();
    const s = data.spec;
    const empty = !s || (!s.colW && !s.rowH && !s.cellColor && !s.cellFg && !s.codeColor && !s.cellText && !s.hiddenC?.length && !s.hiddenR?.length && !s.rules?.length && (!s.zoom || s.zoom === 1) && !s.boxW && !s.boxH && !s.zones);
    if (empty) delete map[data.key]; else map[data.key] = s as SheetForm;
    await writeSheetForms(map);
    return { ok: true };
  });

/* ── SNAPSHOT ẢNH RENDER (ETL) — kho KV `sheetsnap:<key>` = { html, css, range }. Tách RIÊNG khỏi map cấu
   hình để map luôn nhẹ (load mọi dự án), còn HTML lớn chỉ tải KHI viewer mở đúng 1 chart. ─────────── */
const SHEETSNAP_PREFIX = "sheetsnap:";
const DEV_SHEETSNAP_DIR = ".data/snap";
type SheetSnap = { html: string; css: string; range: string };
async function readSnap(key: string): Promise<SheetSnap | null> {
  const kv = await getKv();
  if (kv) { const raw = await kv.get(SHEETSNAP_PREFIX + key); return raw ? (JSON.parse(raw) as SheetSnap) : null; }
  try { const fs = await import("node:fs/promises"); return JSON.parse(await fs.readFile(`${DEV_SHEETSNAP_DIR}/${encodeURIComponent(key)}.json`, "utf8")) as SheetSnap; }
  catch { return null; }
}
async function writeSnap(key: string, val: SheetSnap): Promise<void> {
  const kv = await getKv();
  if (kv) { await kv.put(SHEETSNAP_PREFIX + key, JSON.stringify(val)); return; }
  const fs = await import("node:fs/promises");
  await fs.mkdir(DEV_SHEETSNAP_DIR, { recursive: true });
  await fs.writeFile(`${DEV_SHEETSNAP_DIR}/${encodeURIComponent(key)}.json`, JSON.stringify(val), "utf8");
}
/** LOAD snapshot cho viewer (CÔNG KHAI, chỉ tải đúng 1 chart) — Worker chỉ ĐỌC chuỗi, không parse gì. */
export const getSheetSnap = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ key: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data }): Promise<{ snap: SheetSnap | null }> => ({ snap: await readSnap(data.key) }));
/** LOAD (ghi) snapshot — CHỈ ADMIN/PMO. HTML đã render sẵn ở CLIENT (Worker không parse xlsx). */
export const saveSheetSnap = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ key: z.string().min(1).max(200), html: z.string().max(4_000_000), css: z.string().max(200_000), range: z.string().max(40).optional(), devAs: z.string().nullable().optional() }).parse(input))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    if (!((await callerIsAdmin(data.devAs)) || (await callerIsPmo(data.devAs)))) throw new Error("Chỉ admin/PMO mới được lưu snapshot.");
    await writeSnap(data.key, { html: data.html, css: data.css, range: (data.range ?? "").trim() });
    return { ok: true };
  });

/* ── ẢNH DỰ ÁN (PMO gắn) — mỗi DỰ ÁN có 1 BỘ ẢNH hiện trường (nhiều ảnh); click TÊN DỰ ÁN → popup xem
   gallery. Tách INDEX nhẹ `projimg:idx:v1` = { [key]: { n, at, by } } (mọi người tải để biết dự án nào có
   📷 + số ảnh + ngày/người sửa gần nhất) khỏi BLOB nặng `projimg:blob:<key>` = { imgs: [{ data, at, by }] }
   (chỉ tải khi mở popup). Key = KHOÁ DỰ ÁN chuẩn (projectKeyOf = g.key). GHI chỉ ADMIN/PMO; ĐỌC công khai. */
const PROJIMG_IDX_KEY = "projimg:idx:v1";
const DEV_PROJIMG_IDX_FILE = ".data/pmo-projimg-idx.json";
const PROJIMG_PREFIX = "projimg:blob:";
const DEV_PROJIMG_DIR = ".data/projimg";
const PROJIMG_MAX = 12;   // trần số ảnh / dự án (giữ blob KV gọn, dưới hạn 25MB kể cả ảnh nặng)
export type ProjImgMeta = { n: number; at: string; by: string };
export type ProjImgIdx = Record<string, ProjImgMeta>;
export type ProjImgItem = { data: string; at: string; by: string };
type ProjImgBlob = { imgs: ProjImgItem[] };

async function readProjImgIdx(): Promise<ProjImgIdx> {
  const kv = await getKv();
  if (kv) { const raw = await kv.get(PROJIMG_IDX_KEY); return raw ? (JSON.parse(raw) as ProjImgIdx) : {}; }
  try { const fs = await import("node:fs/promises"); return JSON.parse(await fs.readFile(DEV_PROJIMG_IDX_FILE, "utf8")) as ProjImgIdx; }
  catch { return {}; }
}
async function writeProjImgIdx(map: ProjImgIdx): Promise<void> {
  const kv = await getKv();
  if (kv) { await kv.put(PROJIMG_IDX_KEY, JSON.stringify(map)); return; }
  const fs = await import("node:fs/promises");
  await fs.mkdir(".data", { recursive: true });
  await fs.writeFile(DEV_PROJIMG_IDX_FILE, JSON.stringify(map, null, 2), "utf8");
}
async function readProjImgBlob(key: string): Promise<ProjImgBlob> {
  const kv = await getKv();
  let raw: string | null = null;
  if (kv) raw = await kv.get(PROJIMG_PREFIX + key);
  else { try { const fs = await import("node:fs/promises"); raw = await fs.readFile(`${DEV_PROJIMG_DIR}/${encodeURIComponent(key)}.json`, "utf8"); } catch { raw = null; } }
  if (!raw) return { imgs: [] };
  const parsed = JSON.parse(raw) as ProjImgBlob | { data: string; at: string; by: string };
  // Di trú bản CŨ (1 ảnh/dự án: { data, at, by }) → mảng.
  if (Array.isArray((parsed as ProjImgBlob).imgs)) return parsed as ProjImgBlob;
  const one = parsed as { data: string; at: string; by: string };
  return one.data ? { imgs: [{ data: one.data, at: one.at, by: one.by }] } : { imgs: [] };
}
async function writeProjImgBlob(key: string, val: ProjImgBlob): Promise<void> {
  const kv = await getKv();
  if (kv) { await kv.put(PROJIMG_PREFIX + key, JSON.stringify(val)); return; }
  const fs = await import("node:fs/promises");
  await fs.mkdir(DEV_PROJIMG_DIR, { recursive: true });
  await fs.writeFile(`${DEV_PROJIMG_DIR}/${encodeURIComponent(key)}.json`, JSON.stringify(val), "utf8");
}
async function deleteProjImgBlob(key: string): Promise<void> {
  const kv = await getKv();
  if (kv) { if (kv.delete) await kv.delete(PROJIMG_PREFIX + key); else await kv.put(PROJIMG_PREFIX + key, ""); return; }
  try { const fs = await import("node:fs/promises"); await fs.unlink(`${DEV_PROJIMG_DIR}/${encodeURIComponent(key)}.json`); } catch { /* chưa có file */ }
}

/** INDEX ảnh (CÔNG KHAI, nhẹ) — client biết dự án nào có 📷 + số ảnh + ngày/người sửa gần nhất. */
export const getProjImageIndex = createServerFn({ method: "GET" }).handler(async () => {
  return { idx: await readProjImgIdx() };
});
/** LOAD BỘ ảnh 1 dự án (CÔNG KHAI) — chỉ tải KHI viewer mở popup (blob nặng tách riêng khỏi index). */
export const getProjImage = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ key: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data }): Promise<{ imgs: ProjImgItem[] }> => (await readProjImgBlob(data.key)));
/** THÊM (nhiều) / XOÁ 1 / XOÁ HẾT ảnh — CHỈ ADMIN/PMO.
 *   add     : mảng dataURI ảnh đã nén ở client → NỐI vào bộ (trần PROJIMG_MAX).
 *   removeIdx: xoá ảnh thứ i; clear: xoá cả bộ. Trả index mới để client cập nhật badge. */
export const saveProjImage = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({
    key: z.string().min(1).max(200),
    projectName: z.string().max(300).optional(),   // tên dự án → đặt tên thư mục Drive cho dễ đọc
    add: z.array(z.string().max(3_500_000)).max(PROJIMG_MAX).optional(),
    toa: z.string().max(60).optional(),            // Toà (bỏ trống nếu dự án không chia Toà, vd khu public)
    can: z.string().max(80).optional(),            // CĂN / KHU → ảnh đổ vào đúng folder đó trong cây Media
    hid: z.string().max(40).optional(),            // ID CỨNG dự án → khoá thư mục dự án, khỏi lẫn dự án trùng tên
    removeIdx: z.number().int().min(0).optional(),
    clear: z.boolean().optional(),
    devAs: z.string().nullable().optional(),
  }).parse(input))
  .handler(async ({ data }): Promise<{ idx: ProjImgIdx }> => {
    // THÊM ảnh: MỌI NGƯỜI được làm. XOÁ/GỠ ảnh: chỉ admin/PMO (tránh xoá nhầm/ác ý).
    const canManage = (await callerIsAdmin(data.devAs)) || (await callerIsPmo(data.devAs));
    const map = await readProjImgIdx();
    const commit = async (imgs: ProjImgItem[]) => {
      if (!imgs.length) { delete map[data.key]; await deleteProjImgBlob(data.key); }
      else { await writeProjImgBlob(data.key, { imgs }); map[data.key] = { n: imgs.length, at: imgs[imgs.length - 1].at, by: imgs[imgs.length - 1].by }; }
      await writeProjImgIdx(map);
    };
    if (data.clear) { if (!canManage) throw new Error("Chỉ admin/PMO mới được xoá cả bộ ảnh."); await commit([]); return { idx: map }; }
    const cur = (await readProjImgBlob(data.key)).imgs;
    if (typeof data.removeIdx === "number") {
      if (!canManage) throw new Error("Chỉ admin/PMO mới được gỡ ảnh.");
      if (data.removeIdx < cur.length) cur.splice(data.removeIdx, 1);
      await commit(cur);
      return { idx: map };
    }
    const adds = (data.add ?? []).map((s) => s.trim()).filter(Boolean);
    if (adds.length) {
      for (const uri of adds) if (!/^data:image\//.test(uri)) throw new Error("Ảnh không hợp lệ (cần dataURI ảnh).");
      const now = new Date().toISOString();
      const by = (await callerEmail(data.devAs)) ?? "?";
      const next = [...cur, ...adds.map((data) => ({ data, at: now, by }))].slice(0, PROJIMG_MAX);
      await commit(next);
      // MIRROR sang Google Drive — vào ĐÚNG FOLDER CĂN (hoặc KHU) trong cây Media, cùng chỗ với ảnh/video
      // up từ app "Media công trường". Không có căn/khu → KHÔNG đẩy lên Drive (bỏ hẳn kho ảnh cấp dự án).
      // Best-effort: Drive lỗi/chưa cấu hình → bỏ qua, không chặn lưu KV (ảnh vẫn hiện bình thường).
      if ((data.can || "").trim()) {
        try {
          const drive = await import("@/lib/drive.functions");
          if (await drive.driveIsConfigured())
            await drive.driveArchiveImages("ePMP", data.projectName || data.key, adds, { toa: data.toa, can: data.can!, hid: data.hid });
        } catch (e) { console.warn("[projimg] mirror Drive bỏ qua:", (e as Error).message); }
      }
    }
    return { idx: map };
  });

/* ── DỮ LIỆU HIỆU SUẤT DỰ ÁN (app "Hiệu suất dự án") — parse từ sheet Pivot(2) ở CLIENT rồi lưu vào
   KV `perfdata:v1` để GIỮ LẠI đến khi PMO cập nhật file mới (mọi người mở app thấy ngay bản mới nhất).
   Nhẹ (20 dự án × 14 số). GHI chỉ ADMIN/PMO; ĐỌC công khai. ── */
const PERFDATA_KEY = "perfdata:v1";
const DEV_PERFDATA_FILE = ".data/pmo-perfdata.json";
export type PerfProj = { no: number; name: string; rev: number[]; ns: number[] };
export type PerfBlock = { rev: number[]; ns: number[] };
export type PerfData = { projects: PerfProj[]; block?: PerfBlock; src: string; at: string; by: string };

async function readPerfData(): Promise<PerfData | null> {
  const kv = await getKv();
  if (kv) { const raw = await kv.get(PERFDATA_KEY); return raw ? (JSON.parse(raw) as PerfData) : null; }
  try { const fs = await import("node:fs/promises"); return JSON.parse(await fs.readFile(DEV_PERFDATA_FILE, "utf8")) as PerfData; }
  catch { return null; }
}
async function writePerfData(d: PerfData): Promise<void> {
  const kv = await getKv();
  if (kv) { await kv.put(PERFDATA_KEY, JSON.stringify(d)); return; }
  const fs = await import("node:fs/promises");
  await fs.mkdir(".data", { recursive: true });
  await fs.writeFile(DEV_PERFDATA_FILE, JSON.stringify(d, null, 2), "utf8");
}

/** Đọc data hiệu suất đang lưu (CÔNG KHAI). */
export const getPerfData = createServerFn({ method: "GET" }).handler(async (): Promise<{ data: PerfData | null }> => ({ data: await readPerfData() }));

/** Lưu data hiệu suất (parse ở client) — CHỈ ADMIN/PMO. Ghi đè bản cũ (đến khi update file mới). */
export const savePerfData = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({
    projects: z.array(z.object({
      no: z.number(), name: z.string().max(120),
      rev: z.array(z.number()).max(24), ns: z.array(z.number()).max(24),
    })).max(200),
    /** TOÀN KHỐI đọc THẲNG từ sheet "SLTB (kết quả)" khối A (không tự cộng lại từ các nhóm) — để chart
     *  "Sản lượng đầu người khối dự án" khớp ĐÚNG con số trong báo cáo tuần. */
    block: z.object({ rev: z.array(z.number()).max(24), ns: z.array(z.number()).max(24) }).optional(),
    src: z.string().max(200).optional(),
    devAs: z.string().nullable().optional(),
  }).parse(input))
  .handler(async ({ data }): Promise<{ data: PerfData }> => {
    if (!((await callerIsAdmin(data.devAs)) || (await callerIsPmo(data.devAs)))) throw new Error("Chỉ admin/PMO mới được cập nhật dữ liệu hiệu suất.");
    const d: PerfData = { projects: data.projects, block: data.block, src: (data.src ?? "").slice(0, 200), at: new Date().toISOString(), by: (await callerEmail(data.devAs)) ?? "?" };
    await writePerfData(d);
    // MIRROR sang Drive: "Data Source" › DATABASE › Hiệu suất dự án › HieuSuatDuAn_latest.json (ghi đè, bản mới
    // nhất). Best-effort: Drive lỗi/chưa cấu hình → bỏ qua, không chặn KV.
    try {
      const drive = await import("@/lib/drive.functions");
      if (await drive.driveIsConfigured()) await drive.driveArchiveJson(["Hiệu suất dự án"], "HieuSuatDuAn_latest.json", JSON.stringify(d, null, 2));
    } catch (e) { console.warn("[perfdata] mirror Drive bỏ qua:", (e as Error).message); }
    return { data: d };
  });

/** LƯU FILE NGUỒN TUẦN (.xlsx báo cáo hiệu suất) LÊN DRIVE — lưu trữ có hệ thống, app KHÔNG giữ byte:
 *      "Data Source" › DATABASE › Hiệu suất dự án › Nguồn tuần › <năm> › <YYYY-MM-DD>_<tên file>
 *  Trả `uploadUrl` (phiên resumable) để CLIENT PUT byte thẳng lên Google — byte không đi qua Worker
 *  (file vài MB sẽ làm Worker OOM). Mỗi tuần một file, KHÔNG ghi đè → có lịch sử để đối chiếu về sau.
 *  CHỈ admin/PMO. */
export const startPerfSourceUpload = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({
    name: z.string().min(1).max(200),
    mime: z.string().max(120).optional(),
    devAs: z.string().nullable().optional(),
  }).parse(input))
  .handler(async ({ data }): Promise<{ uploadUrl: string; path: string }> => {
    if (!((await callerIsAdmin(data.devAs)) || (await callerIsPmo(data.devAs)))) throw new Error("Chỉ admin/PMO mới được lưu file nguồn.");
    const drive = await import("@/lib/drive.functions");
    if (!(await drive.driveIsConfigured())) throw new Error("Chưa cấu hình Google Drive.");
    const d = new Date(Date.now() + 7 * 3600_000);          // ngày VN (Worker chạy UTC)
    const p2 = (n: number) => String(n).padStart(2, "0");
    const day = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
    const path = ["Hiệu suất dự án", "Nguồn tuần", String(d.getUTCFullYear())];
    const name = `${day}_${data.name}`.slice(0, 180);
    // Nạp LẠI trong cùng ngày → THAY bản cũ, không chồng thêm file trùng tên (kho tuần phải sạch:
    // mỗi ngày nạp 1 bản mới nhất; các tuần khác vẫn giữ đủ vì tên có ngày ở đầu).
    await drive.driveTrashByName(path, name).catch(() => { /* không có bản cũ → bỏ qua */ });
    const { uploadUrl } = await drive.driveCreateResumableSession(path, name,
      data.mime || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return { uploadUrl, path: [...path, name].join(" / ") };
  });

/** LƯU PDF BÁO CÁO TUÂN THỦ lên Drive (để Apps Script trong file gốc đính kèm mail):
 *  "Data Source" › DATABASE › ePMP › Báo cáo tuân thủ › <fileName> (upsert, ghi đè mỗi kỳ). Gọi
 *  driveSaveReportImpl qua DYNAMIC import để drive.functions KHÔNG lọt vào bundle client (import-protection
 *  chặn "@tanstack/react-start/server"). CHỈ admin/PMO. */
export const saveComplianceReportPdf = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({
    fileName: z.string().min(1).max(200),
    dataUri: z.string().max(30_000_000).regex(/^data:application\/pdf;base64,/),
    devAs: z.string().nullable().optional(),
  }).parse(input))
  .handler(async ({ data }): Promise<{ id: string; link: string; updated: boolean }> => {
    if (!((await callerIsAdmin(data.devAs)) || (await callerIsPmo(data.devAs)))) throw new Error("Chỉ admin/PMO mới được lưu báo cáo lên Drive.");
    const drive = await import("@/lib/drive.functions");
    if (!(await drive.driveIsConfigured())) throw new Error("Chưa cấu hình Google Drive (thiếu GDRIVE_OAUTH_*).");
    return await drive.driveSaveReportImpl(["ePMP", "Báo cáo tuân thủ"], data.fileName, data.dataUri);
  });

/* ── KHO ETL — dữ liệu đã CHUẨN HOÁ của các app (ePMP, Chi tiết tiến độ) gom về KV `etl:v1:<source>`.
   Client Extract+Transform (parse xlsx) rồi Load bundle JSON vào đây. Nền cho dashboard + AI (RAG). ── */
const ETL_PREFIX = "etl:v1:";
const DEV_ETL_DIR = ".data/etl";
async function readEtl(source: string): Promise<string | null> {
  const kv = await getKv();
  if (kv) return (await kv.get(ETL_PREFIX + source)) ?? null;
  try { const fs = await import("node:fs/promises"); return await fs.readFile(`${DEV_ETL_DIR}/${source}.json`, "utf8"); }
  catch { return null; }
}
async function writeEtl(source: string, json: string): Promise<void> {
  const kv = await getKv();
  if (kv) { await kv.put(ETL_PREFIX + source, json); return; }
  const fs = await import("node:fs/promises");
  await fs.mkdir(DEV_ETL_DIR, { recursive: true });
  await fs.writeFile(`${DEV_ETL_DIR}/${source}.json`, json, "utf8");
}
/** LOAD (ghi) bundle ETL — CHỈ ADMIN/PMO. bundle = JSON đã stringify ở client (Worker chỉ lưu chuỗi). */
export const saveEtlRecords = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ source: z.enum(["epmp", "detail"]), bundle: z.string().max(20_000_000), devAs: z.string().nullable().optional() }).parse(input))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    if (!((await callerIsAdmin(data.devAs)) || (await callerIsPmo(data.devAs)))) throw new Error("Chỉ admin/PMO mới được ghi ETL.");
    await writeEtl(data.source, data.bundle);
    return { ok: true };
  });
/** Đọc bundle ETL (công khai) → trả chuỗi JSON hoặc null. Dùng cho dashboard/AI. */
export const getEtlRecords = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ source: z.enum(["epmp", "detail"]) }).parse(input))
  .handler(async ({ data }): Promise<{ bundle: string | null }> => ({ bundle: await readEtl(data.source) }));

/* ── DATA LIBRARY — kho DATASET đã chuẩn hoá (canonical). Index NHẸ (metadata) tách khỏi bản đầy đủ
   (records) để list nhanh; bản đầy đủ ở KV riêng `etl:ds:<id>`. Client build Dataset rồi Load lên. ── */
export type DatasetMeta = { id: string; name: string; domain: string; data_type: string; project_id?: string; created_at: string; source_file_name?: string; record_count: number; quality_score: number; schema_version: string };
const DS_PREFIX = "etl:ds:";
const DS_INDEX = "etl:ds:index";
const DEV_DS_DIR = ".data/ds";
async function readDsIndex(): Promise<DatasetMeta[]> {
  const kv = await getKv();
  if (kv) { const raw = await kv.get(DS_INDEX); return raw ? (JSON.parse(raw) as DatasetMeta[]) : []; }
  try { const fs = await import("node:fs/promises"); return JSON.parse(await fs.readFile(`${DEV_DS_DIR}/index.json`, "utf8")) as DatasetMeta[]; } catch { return []; }
}
async function writeDsIndex(list: DatasetMeta[]): Promise<void> {
  const kv = await getKv();
  if (kv) { await kv.put(DS_INDEX, JSON.stringify(list)); return; }
  const fs = await import("node:fs/promises"); await fs.mkdir(DEV_DS_DIR, { recursive: true }); await fs.writeFile(`${DEV_DS_DIR}/index.json`, JSON.stringify(list), "utf8");
}
async function readDs(id: string): Promise<string | null> {
  const kv = await getKv();
  if (kv) return (await kv.get(DS_PREFIX + id)) ?? null;
  try { const fs = await import("node:fs/promises"); return await fs.readFile(`${DEV_DS_DIR}/${encodeURIComponent(id)}.json`, "utf8"); } catch { return null; }
}
async function writeDs(id: string, json: string): Promise<void> {
  const kv = await getKv();
  if (kv) { await kv.put(DS_PREFIX + id, json); return; }
  const fs = await import("node:fs/promises"); await fs.mkdir(DEV_DS_DIR, { recursive: true }); await fs.writeFile(`${DEV_DS_DIR}/${encodeURIComponent(id)}.json`, json, "utf8");
}
/** Liệt kê datasets (metadata nhẹ) — công khai. */
export const listDatasets = createServerFn({ method: "GET" }).handler(async (): Promise<{ datasets: DatasetMeta[] }> => ({ datasets: (await readDsIndex()).sort((a, b) => b.created_at.localeCompare(a.created_at)) }));
/** Lấy 1 dataset đầy đủ (records) — công khai. */
export const getDataset = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ id: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data }): Promise<{ dataset: string | null }> => ({ dataset: await readDs(data.id) }));
/** PUBLISH dataset — CHỈ ADMIN/PMO. dataset = JSON stringify ở client (Worker chỉ lưu chuỗi). */
export const saveDataset = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({
    meta: z.object({ id: z.string().min(1).max(200), name: z.string().max(200), domain: z.string().max(60), data_type: z.string().max(60), project_id: z.string().max(80).optional(), created_at: z.string().max(40), source_file_name: z.string().max(200).optional(), record_count: z.number(), quality_score: z.number(), schema_version: z.string().max(20) }),
    dataset: z.string().max(20_000_000), devAs: z.string().nullable().optional(),
  }).parse(input))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    if (!((await callerIsAdmin(data.devAs)) || (await callerIsPmo(data.devAs)))) throw new Error("Chỉ admin/PMO mới được publish dataset.");
    await writeDs(data.meta.id, data.dataset);
    const idx = await readDsIndex();
    const i = idx.findIndex((m) => m.id === data.meta.id);
    if (i >= 0) idx[i] = data.meta; else idx.push(data.meta);
    await writeDsIndex(idx);
    return { ok: true };
  });
