/**
 * KHO SỐ LẮP ĐẶT trên D1 (bảng `lapdat_moc`) — nơi dashboard đọc, thay cho việc mở lại file gốc.
 *
 * VÌ SAO D1 CHỨ KHÔNG PHẢI KV: đây là dữ liệu CỘNG DỒN theo ngày và cần lọc/gộp ("tất cả mốc của
 * CT25-070 trong 90 ngày"). KV chỉ tra được theo khoá, muốn lọc là phải tải hết về rồi lọc tay.
 * D1 còn rộng hạn mức hơn KV nhiều — kho này không đụng tới hạn mức KV đang gần đầy.
 *
 * GHI MỘT LẦN MỘT NGÀY. Client rút số xong thì gọi `luuMocKho`; server kiểm tra hôm nay dự án đó đã
 * có mốc chưa, có rồi thì thôi. Không có bước này thì mỗi lượt mở app của mỗi người là một lượt ghi
 * — 50 người mở là 50 lần ghi cùng một con số.
 *
 * DEV không có D1 → rơi về file `.data/lapdat-kho.json`, cùng cách nhật ký giám sát đang làm, để
 * chạy thử ở máy không phải dựng cả Cloudflare.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { DEFAULT_ADMINS, isAdminEmail, normEmail } from "./activity";
import { DEFAULT_ROLES, laDieuHanh, roleOf } from "./roles";
import { SQL_TAO_BANG, COT_KHO, sangCsv, docCsv, chuanNgay, type MocKho } from "./lapdat-kho";

const DEV_FILE = ".data/lapdat-kho.json";
const GIU_NGAY = 400;   // giữ khoảng hơn một năm — đủ vẽ đường, không phình vô hạn

type D1Prepared = { bind(...v: unknown[]): D1Prepared; run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> };
type D1Like = { prepare(q: string): D1Prepared; batch?(xs: D1Prepared[]): Promise<unknown> };

async function getEnv(): Promise<Record<string, unknown>> {
  try {
    const mod = (await import("@tanstack/react-start/server")) as Record<string, unknown>;
    const getEvent = mod.getEvent as undefined | (() => unknown);
    if (getEvent) {
      const ev = getEvent() as { context?: { cloudflare?: { env?: Record<string, unknown> } } } | undefined;
      if (ev?.context?.cloudflare?.env) return ev.context.cloudflare.env;
    }
  } catch { /* ngoài ngữ cảnh request */ }
  const g = globalThis as unknown as Record<string, unknown>;
  return (g.__env__ ?? g.__cf_env__ ?? {}) as Record<string, unknown>;
}
async function getD1(): Promise<D1Like | null> {
  return ((await getEnv()).PMO_LOG as D1Like | undefined) ?? null;
}

/** Tạo bảng một lần cho mỗi isolate — tự lành, khỏi bước migration thủ công lúc deploy. */
let sanSang = false;
async function ensure(d1: D1Like): Promise<void> {
  if (sanSang) return;
  await d1.prepare(SQL_TAO_BANG).run();
  try { await d1.prepare("CREATE INDEX IF NOT EXISTS idx_lapdat_ngay ON lapdat_moc(ngay)").run(); } catch { /* đã có */ }
  try { await d1.prepare("CREATE INDEX IF NOT EXISTS idx_lapdat_ct ON lapdat_moc(maCT)").run(); } catch { /* đã có */ }
  sanSang = true;
}

/* ── quyền ──────────────────────────────────────────────────────────────────────────────────── */

async function callerEmail(): Promise<string | null> {
  try {
    const act = await import("./activity.functions");
    const me = await (act.whoami as unknown as (a?: unknown) => Promise<{ email: string | null }>)({ data: {} });
    return me?.email ? normEmail(me.email) : null;
  } catch { /* whoami không gọi được → coi như chưa đăng nhập */ }
  return import.meta.env.DEV ? "tienthn@aacorporation.com" : null;
}
/** Nạp/xoá kho là việc quản trị: chỉ admin và PMO. Đọc thì ai đăng nhập cũng được. */
async function duocQuanTri(): Promise<boolean> {
  const email = await callerEmail();
  if (!email) return false;
  if (isAdminEmail(email, DEFAULT_ADMINS)) return true;
  return laDieuHanh(roleOf(DEFAULT_ROLES, email));
}

/* ── dev: file thay cho D1 ──────────────────────────────────────────────────────────────────── */

async function devDoc(): Promise<MocKho[]> {
  try {
    const fs = await import("node:fs/promises");
    return JSON.parse(await fs.readFile(DEV_FILE, "utf8")) as MocKho[];
  } catch { return []; }
}
async function devGhi(rows: MocKho[]): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(".data", { recursive: true }).catch(() => { /* đã có */ });
  await fs.writeFile(DEV_FILE, JSON.stringify(rows, null, 2), "utf8");
}
const khoa = (r: MocKho) => `${r.ngay}|${r.maCT}|${r.duAn}|${r.khu}`;

/* ── đầu vào ────────────────────────────────────────────────────────────────────────────────── */

const MocSchema = z.object({
  ngay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  maCT: z.string().max(120),
  duAn: z.string().max(300),
  khu: z.string().min(1).max(250),
  scope: z.string().max(20),
  pctThuc: z.number().nullable(),
  pctDuKien: z.number().nullable(),
  pctHomTruoc: z.number().nullable(),
  chenhLech: z.number().nullable(),
  tangNgay: z.number().nullable(),
  canhBao: z.string().max(120),
  ngayBanGiao: z.string().max(60),
  soNgayConLai: z.number().nullable(),
  nguon: z.string().max(20),
});

/** Ghi đè theo khoá (ngày, mã CT, dự án, khu) — chấm lại trong ngày thì đè, không đẻ dòng trùng. */
async function upsert(rows: MocKho[]): Promise<number> {
  if (!rows.length) return 0;
  const d1 = await getD1();
  if (!d1) {
    const cu = await devDoc();
    const de = new Set(rows.map(khoa));
    await devGhi([...cu.filter((r) => !de.has(khoa(r))), ...rows]);
    return rows.length;
  }
  await ensure(d1);
  const q = `INSERT OR REPLACE INTO lapdat_moc (${COT_KHO.join(",")}) VALUES (${COT_KHO.map(() => "?").join(",")})`;
  const stmts = rows.map((r) => d1.prepare(q).bind(...COT_KHO.map((c) => r[c])));
  // batch() gửi cả loạt trong MỘT lượt gọi; D1 nào không có thì chạy tuần tự cho xong việc.
  if (d1.batch) await d1.batch(stmts);
  else for (const s of stmts) await s.run();
  return rows.length;
}

/**
 * Ghi mốc HÔM NAY của MỘT dự án. Đã có mốc của ngày đó rồi thì bỏ qua (trừ khi `de = true`).
 * Trả về `{ ghi: 0 }` khi bỏ qua, để client biết mà không báo nhầm là đã cập nhật.
 */
export const luuMocKho = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({
    rows: z.array(MocSchema).min(1).max(400),
    de: z.boolean().optional(),
  }).parse(input))
  .handler(async ({ data }): Promise<{ ghi: number; boQua: boolean }> => {
    const { ngay, maCT, duAn } = data.rows[0];
    if (!data.de) {
      const co = await demMoc(ngay, maCT, duAn);
      if (co > 0) return { ghi: 0, boQua: true };
    }
    return { ghi: await upsert(data.rows as MocKho[]), boQua: false };
  });

async function demMoc(ngay: string, maCT: string, duAn: string): Promise<number> {
  const d1 = await getD1();
  if (!d1) return (await devDoc()).filter((r) => r.ngay === ngay && r.maCT === maCT && r.duAn === duAn).length;
  await ensure(d1);
  const { results } = await d1
    .prepare("SELECT COUNT(*) AS n FROM lapdat_moc WHERE ngay = ? AND maCT = ? AND duAn = ?")
    .bind(ngay, maCT, duAn).all<{ n: number }>();
  return results[0]?.n ?? 0;
}

/** Đọc kho để vẽ. Mặc định 120 ngày gần nhất — đủ cho đường tiến độ, không kéo cả kho về. */
export const docKho = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({
    tu: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    maCT: z.string().max(120).optional(),
    soNgay: z.number().int().min(1).max(400).optional(),
  }).parse(input ?? {}))
  .handler(async ({ data }): Promise<{ rows: MocKho[] }> => {
    const tu = data.tu ?? ngayLui(data.soNgay ?? 120);
    const d1 = await getD1();
    if (!d1) {
      const all = await devDoc();
      return { rows: all.filter((r) => r.ngay >= tu && (!data.maCT || r.maCT === data.maCT)) };
    }
    await ensure(d1);
    const dk = data.maCT ? " AND maCT = ?" : "";
    const binds: unknown[] = data.maCT ? [tu, data.maCT] : [tu];
    const { results } = await d1
      .prepare(`SELECT ${COT_KHO.join(",")} FROM lapdat_moc WHERE ngay >= ?${dk} ORDER BY ngay, maCT, khu`)
      .bind(...binds).all<MocKho>();
    return { rows: results ?? [] };
  });

function ngayLui(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

/** Xuất cả kho ra CSV — mở bằng Excel, không khoá dữ liệu trong app. */
export const xuatCsvKho = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ soNgay: z.number().int().min(1).max(400).optional() }).parse(input ?? {}))
  .handler(async ({ data }): Promise<{ csv: string; soDong: number }> => {
    const { rows } = await docKho({ data: { soNgay: data.soNgay ?? 400 } });
    return { csv: sangCsv(rows), soDong: rows.length };
  });

/**
 * NẠP THÊM bằng CSV — cho những dự án mà bảng gốc không rút số tự động được, hoặc để bù số cũ.
 * Cùng bộ cột với bảng SQL nên dán từ Excel sang là chạy. Ghi đè theo khoá, chạy lại không sinh trùng.
 */
export const napCsvKho = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ csv: z.string().min(10).max(2_000_000) }).parse(input))
  .handler(async ({ data }): Promise<{ ghi: number; bo: number; loi: string[] }> => {
    if (!(await duocQuanTri())) throw new Error("Chỉ admin/OCC mới được nạp dữ liệu vào kho.");
    const kq = docCsv(data.csv);
    if (!kq.rows.length) return { ghi: 0, bo: kq.bo, loi: kq.loi };
    return { ghi: await upsert(kq.rows), bo: kq.bo, loi: kq.loi };
  });

/** Xoá một ngày (nạp nhầm thì gỡ ra). Cả kho thì không cho xoá bằng app — việc đó dùng wrangler. */
export const xoaNgayKho = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ ngay: z.string().min(8).max(10), maCT: z.string().max(120).optional() }).parse(input))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    if (!(await duocQuanTri())) throw new Error("Chỉ admin/OCC mới được xoá dữ liệu kho.");
    const ngay = chuanNgay(data.ngay);
    if (!ngay) throw new Error("Ngày không đúng dạng YYYY-MM-DD.");
    const d1 = await getD1();
    if (!d1) {
      const cu = await devDoc();
      await devGhi(cu.filter((r) => !(r.ngay === ngay && (!data.maCT || r.maCT === data.maCT))));
      return { ok: true };
    }
    await ensure(d1);
    if (data.maCT) await d1.prepare("DELETE FROM lapdat_moc WHERE ngay = ? AND maCT = ?").bind(ngay, data.maCT).run();
    else await d1.prepare("DELETE FROM lapdat_moc WHERE ngay = ?").bind(ngay).run();
    return { ok: true };
  });

/** Dọn số quá cũ. Gọi tay khi cần — kho này mỗi ngày chỉ thêm vài trăm dòng nên chưa cần cron. */
export const donKho = createServerFn({ method: "POST" })
  .handler(async (): Promise<{ ok: boolean }> => {
    if (!(await duocQuanTri())) throw new Error("Chỉ admin/OCC mới được dọn kho.");
    const d1 = await getD1();
    if (!d1) return { ok: true };
    await ensure(d1);
    await d1.prepare("DELETE FROM lapdat_moc WHERE ngay < ?").bind(ngayLui(GIU_NGAY)).run();
    return { ok: true };
  });
