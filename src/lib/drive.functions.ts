/**
 * LƯU TRỮ GOOGLE DRIVE (server-fn chạy trên Cloudflare Worker / vite dev).
 * Đẩy ảnh/note của app vào 1 folder Drive làm kho bền, tự tổ chức thư mục con theo TỪNG DỰ ÁN.
 *
 * XÁC THỰC: OAuth "refresh token" (KHÔNG dùng service account — vì folder là My Drive CÁ NHÂN,
 *   service account upload sẽ báo thiếu quota). App upload dưới danh nghĩa CHÍNH tài khoản Google
 *   của người dùng → file thuộc về họ, không dính quota.
 * CẦN 3 biến môi trường (local: .env · production: wrangler secret):
 *   GDRIVE_OAUTH_CLIENT_ID, GDRIVE_OAUTH_CLIENT_SECRET  ← từ OAuth web client
 *   GDRIVE_OAUTH_REFRESH                                ← lấy 1 lần bằng scripts/mint-drive-token.mjs
 * Tuỳ chọn: GDRIVE_ROOT = id folder gốc (mặc định folder người dùng đã cấp).
 */
import { createServerFn } from "@tanstack/react-start";

type Env = Record<string, unknown>;
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const DEFAULT_ROOT = "1O9VktCpBENaZB1xgABr8MfIbl3YW8hFO"; // folder "Data Source" (đè bằng env.GDRIVE_ROOT)
// Thư mục con của "Data Source" chứa DỮ LIỆU DỰ ÁN (ảnh…). Tên PHẢI khớp CHÍNH XÁC folder đã có trên
// Drive ("DATABASE") — sai hoa/thường thì ensureFolder tạo ra folder trùng. Sửa ở đây nếu đổi tên trên Drive.
const DB_SUBFOLDER = "DATABASE";

/** Lấy env chứa secret. Ưu tiên: (1) Cloudflare env trên Worker; (2) process.env khi `vite dev` local
 *  (đọc .env); (3) globalThis. LƯU Ý: secret nạp bằng `wrangler secret put` CHỈ có ở bản deploy —
 *  muốn test localhost phải đặt biến trong .env. */
async function getEnv(): Promise<Env | null> {
  try {
    const mod = (await import("@tanstack/react-start/server")) as Record<string, unknown>;
    const getEvent = mod.getEvent as undefined | (() => unknown);
    const ev = getEvent?.() as { context?: { cloudflare?: { env?: Env } } } | undefined;
    const cf = ev?.context?.cloudflare?.env;
    if (cf && (cf as Env).GDRIVE_OAUTH_CLIENT_ID) return cf;
  } catch { /* runtime khác */ }
  const proc = (globalThis as unknown as { process?: { env?: Env } }).process;
  if (proc?.env && proc.env.GDRIVE_OAUTH_CLIENT_ID) return proc.env;
  const g = globalThis as unknown as Record<string, unknown>;
  return ((g.__env__ as Env) ?? g) ?? null;
}
const rootOf = (env: Env): string => (typeof env.GDRIVE_ROOT === "string" && env.GDRIVE_ROOT) || DEFAULT_ROOT;

// ── OAuth: refresh_token → access_token (cache trong bộ nhớ isolate ~50 phút) ──
let tokCache: { t: string; exp: number } = { t: "", exp: 0 };
async function accessToken(env: Env): Promise<string> {
  if (tokCache.t && tokCache.exp - 60_000 > Date.now()) return tokCache.t;
  const cid = env.GDRIVE_OAUTH_CLIENT_ID as string | undefined;
  const csec = env.GDRIVE_OAUTH_CLIENT_SECRET as string | undefined;
  const rtok = env.GDRIVE_OAUTH_REFRESH as string | undefined;
  if (!cid || !csec) throw new Error("Chưa cấu hình GDRIVE_OAUTH_CLIENT_ID / GDRIVE_OAUTH_CLIENT_SECRET.");
  if (!rtok) throw new Error("Chưa có GDRIVE_OAUTH_REFRESH — chạy scripts/mint-drive-token.mjs để lấy refresh token.");
  const body = new URLSearchParams({ client_id: cid, client_secret: csec, refresh_token: rtok, grant_type: "refresh_token" });
  const r = await fetch(TOKEN_URI, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json() as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!j.access_token) throw new Error("Đổi refresh token thất bại: " + (j.error_description || j.error || "không rõ") + " (token có thể đã bị thu hồi — mint lại).");
  tokCache = { t: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

// ── Drive REST helpers ───────────────────────────────────────────────────────
const AUTHH = (t: string): Record<string, string> => ({ Authorization: `Bearer ${t}` });
const SHARED = "supportsAllDrives=true&includeItemsFromAllDrives=true"; // chạy được cả Shared Drive
export { mediaSafe, mediaProjectFolder, mediaFolderPath } from "@/lib/media-path";
import { mediaFolderPath as _mediaFolderPath } from "@/lib/media-path";
const safeName = (s: string): string => (s || "").slice(0, 120).replace(/[\\/:*?"<>|]/g, "-").trim();

/** Tìm-hoặc-tạo thư mục con `name` trong `parent`, trả id. */
async function ensureFolder(token: string, name: string, parent: string): Promise<string> {
  const q = `name='${name.replace(/'/g, "\\'")}' and '${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&${SHARED}`, { headers: AUTHH(token) });
  const j = await r.json() as { files?: { id: string }[] };
  if (j.files?.length) return j.files[0].id;
  const cr = await fetch(`https://www.googleapis.com/drive/v3/files?${SHARED}&fields=id`, {
    method: "POST", headers: { ...AUTHH(token), "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }),
  });
  const cj = await cr.json() as { id?: string; error?: { message?: string } };
  if (!cj.id) throw new Error("Tạo thư mục Drive thất bại: " + (cj.error?.message || "không rõ"));
  return cj.id;
}
function dataUriParts(uri: string): { mime: string; bytes: Uint8Array } {
  const m = uri.match(/^data:([^;]+);base64,(.*)$/s);
  if (!m) throw new Error("dataURI không hợp lệ (cần data:<mime>;base64,…).");
  const bin = atob(m[2]); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1], bytes };
}
/** Upload 1 file (multipart/related: metadata JSON + nội dung nhị phân) vào folder. */
async function uploadFile(token: string, folder: string, name: string, uri: string): Promise<{ id: string; link: string }> {
  const { mime, bytes } = dataUriParts(uri);
  const boundary = "pmoDrive" + Date.now();
  const enc = new TextEncoder();
  const meta = JSON.stringify({ name, parents: [folder] });
  const pre = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
  const post = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(pre.length + bytes.length + post.length);
  body.set(pre, 0); body.set(bytes, pre.length); body.set(post, pre.length + bytes.length);
  const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&${SHARED}`, {
    method: "POST", headers: { ...AUTHH(token), "Content-Type": `multipart/related; boundary=${boundary}` }, body,
  });
  const j = await r.json() as { id?: string; webViewLink?: string; error?: { message?: string } };
  if (!j.id) throw new Error("Upload Drive thất bại: " + (j.error?.message || "không rõ"));
  return { id: j.id, link: j.webViewLink || `https://drive.google.com/file/d/${j.id}/view` };
}
/** Tìm 1 file (không phải thư mục) theo TÊN CHÍNH XÁC trong folder → id, hoặc "" nếu chưa có. */
async function findFileByName(token: string, folder: string, name: string): Promise<string> {
  const q = `name='${name.replace(/'/g, "\\'")}' and '${folder}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&${SHARED}`, { headers: AUTHH(token) });
  const j = await r.json() as { files?: { id: string }[] };
  return j.files?.[0]?.id || "";
}
/** GHI ĐÈ nội dung 1 file đã có (giữ nguyên id + link), thay media bằng dataURI mới. */
async function updateFileMedia(token: string, fileId: string, uri: string): Promise<{ id: string; link: string }> {
  const { mime, bytes } = dataUriParts(uri);
  const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,webViewLink&${SHARED}`, {
    method: "PATCH", headers: { ...AUTHH(token), "Content-Type": mime }, body: bytes as unknown as BodyInit,
  });
  const j = await r.json() as { id?: string; webViewLink?: string; error?: { message?: string } };
  if (!j.id) throw new Error("Ghi đè file Drive thất bại: " + (j.error?.message || "không rõ"));
  return { id: j.id, link: j.webViewLink || `https://drive.google.com/file/d/${j.id}/view` };
}

// ── HELPER THUẦN (luồng server khác gọi trực tiếp, không qua createServerFn) ──
/** true nếu đã đủ cấu hình OAuth để dùng Drive. */
export async function driveIsConfigured(): Promise<boolean> {
  const env = await getEnv();
  return !!(env && (env as Env).GDRIVE_OAUTH_CLIENT_ID && (env as Env).GDRIVE_OAUTH_REFRESH);
}
/** Tìm-hoặc-tạo CHUỖI thư mục con dưới DATABASE, trả id folder cuối. Cấu trúc chuẩn của app:
 *    "Data Source" › DATABASE › <App> › <Dự án> › <Loại> …  (segments = ["ePMP","Mini Hotel","Hình ảnh"]).
 *  DATABASE = 1 folder/app-tổng; mỗi app tự phân cấp bên dưới. */
/** TÌM chuỗi thư mục — KHÔNG TẠO. Trả null nếu thiếu bất kỳ cấp nào.
 *  BẮT BUỘC dùng cho mọi thao tác ĐỌC: `ensureDbPath` vừa-tìm-vừa-tạo, mà 2 lời gọi CHẠY SONG SONG cùng
 *  một đường dẫn (listCanMedia đọc "Hình ảnh" và "Video" bằng Promise.all) sẽ cùng thấy thiếu và cùng
 *  tạo → SINH RA 2 FOLDER CĂN TRÙNG TÊN, app chỉ đọc được 1 nên ảnh/video lạc mỗi nơi một ít.
 *  (Đã dính thật ở B4/607, B4/Hanh lang T2·T3·T4·T6, B3/205 — phải chạy scripts/media-dedupe.mjs gộp lại.) */
async function findDbPath(token: string, env: Env, segments: string[]): Promise<string | null> {
  let parent: string | null = await findFolder(token, DB_SUBFOLDER, rootOf(env));
  for (const seg of segments) {
    if (!parent) return null;
    parent = await findFolder(token, safeName(seg) || "khac", parent);
  }
  return parent;
}
async function findFolder(token: string, name: string, parent: string): Promise<string | null> {
  const q = `name='${name.replace(/'/g, "\'")}' and '${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&${SHARED}`, { headers: AUTHH(token) });
  const j = await r.json() as { files?: { id: string }[] };
  return j.files?.length ? j.files[0].id : null;
}
async function ensureDbPath(token: string, env: Env, segments: string[]): Promise<string> {
  let parent = await ensureFolder(token, DB_SUBFOLDER, rootOf(env));
  for (const seg of segments) parent = await ensureFolder(token, safeName(seg) || "khac", parent);
  return parent;
}
/** Lưu (archive) nhiều dataURI ảnh vào Drive — LUÔN đổ vào cây MEDIA theo ĐÚNG CĂN (hoặc KHU với dự án
 *  khu public), là chuẩn duy nhất cho dữ liệu công trường (xem can-media.functions.ts):
 *    "Data Source" › DATABASE › <App> › Media › <Dự án> › [<Toà>] › <Căn|Khu> › "Hình ảnh" › ảnh
 *  KHÔNG còn kho ảnh "cấp dự án": ảnh nào cũng phải thuộc một căn/khu thì mới tìm lại được.
 *  `toa` để trống = dự án không chia Toà (khu public) → bỏ luôn cấp đó. Thiếu `can` thì ném lỗi. */
export async function driveArchiveImages(app: string, projectName: string, dataUris: string[],
  loc: { toa?: string; can: string; category?: string; hid?: string }): Promise<{ id: string; link: string }[]> {
  const env = await getEnv();
  if (!env) throw new Error("Không lấy được env.");
  if (!(loc.can || "").trim()) throw new Error("Thiếu căn/khu — ảnh phải gắn vào một căn hoặc khu.");
  const token = await accessToken(env);
  const folder = await ensureDbPath(token, env, _mediaFolderPath(projectName, loc.toa || "", loc.can, loc.category === "Video" ? "video" : "photo", app, loc.hid));
  const out: { id: string; link: string }[] = [];
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  for (let i = 0; i < dataUris.length; i++) {
    const ext = (dataUris[i].match(/^data:image\/(\w+)/)?.[1] || "jpg").replace("jpeg", "jpg");
    out.push(await uploadFile(token, folder, `anh-${stamp}-${i + 1}.${ext}`, dataUris[i]));
  }
  return out;
}

/** UTF-8 → base64 (btoa chỉ nuốt được chuỗi nhị phân 0–255; tiếng Việt phải mã hoá TextEncoder trước). */
function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
/** Lưu 1 SNAPSHOT JSON (upsert theo tên) vào "Data Source" › DATABASE › <…path> › <fileName>.
 *  path = mảng thư mục (vd ["Hiệu suất dự án"], ["DST"], ["ePMP","Ghi chú"]). Ghi đè bản cũ, không
 *  phình folder. Best-effort: caller tự bọc try/catch để Drive lỗi không chặn KV. */
export async function driveArchiveJson(path: string[], fileName: string, json: string): Promise<{ id: string; link: string; updated: boolean }> {
  const env = await getEnv();
  if (!env) throw new Error("Không lấy được env.");
  const token = await accessToken(env);
  const folder = await ensureDbPath(token, env, path);
  const name = safeName(fileName) || "data.json";
  const uri = "data:application/json;base64," + utf8ToBase64(json);
  const existing = await findFileByName(token, folder, name);
  const res = existing ? await updateFileMedia(token, existing, uri) : await uploadFile(token, folder, name, uri);
  return { id: res.id, link: res.link, updated: !!existing };
}

/** Như driveArchiveJson nhưng cho VĂN BẢN thô (CSV/TXT…). Upsert theo tên trong "Data Source"›DATABASE›<path>. */
export async function driveArchiveText(path: string[], fileName: string, text: string, mime = "text/plain"): Promise<{ id: string; link: string; updated: boolean }> {
  const env = await getEnv();
  if (!env) throw new Error("Không lấy được env.");
  const token = await accessToken(env);
  const folder = await ensureDbPath(token, env, path);
  const name = safeName(fileName) || "data.txt";
  // LƯU Ý: dataUriParts chỉ nhận đúng dạng data:<mime>;base64,… — KHÔNG thêm ;charset (sẽ bị coi là sai định dạng).
  const uri = "data:" + mime + ";base64," + utf8ToBase64(text);
  const existing = await findFileByName(token, folder, name);
  const res = existing ? await updateFileMedia(token, existing, uri) : await uploadFile(token, folder, name, uri);
  return { id: res.id, link: res.link, updated: !!existing };
}

// ── SERVER FUNCTIONS (client gọi) ────────────────────────────────────────────

/** Kiểm tra kết nối: đủ config? refresh token đổi được access token? vào được folder gốc? */
export const driveStatus = createServerFn({ method: "POST" }).handler(async (): Promise<{ ok: boolean; msg: string; folder?: string }> => {
  const env = await getEnv();
  if (!env) return { ok: false, msg: "Không lấy được env." };
  const e = env as Env;
  if (!e.GDRIVE_OAUTH_CLIENT_ID || !e.GDRIVE_OAUTH_CLIENT_SECRET) return { ok: false, msg: "Chưa có GDRIVE_OAUTH_CLIENT_ID / _SECRET." };
  if (!e.GDRIVE_OAUTH_REFRESH) return { ok: false, msg: "Chưa có GDRIVE_OAUTH_REFRESH (chạy scripts/mint-drive-token.mjs)." };
  try {
    const token = await accessToken(e);
    const root = rootOf(e);
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${root}?fields=id,name&${SHARED}`, { headers: AUTHH(token) });
    const j = await r.json() as { id?: string; name?: string; error?: { message?: string } };
    if (!j.id) return { ok: false, msg: "Có token nhưng chưa vào được folder gốc: " + (j.error?.message || "không rõ") };
    return { ok: true, msg: `Kết nối OK · thấy folder “${j.name}”.`, folder: j.name };
  } catch (err) { return { ok: false, msg: (err as Error).message }; }
});

/** Upload nhiều ảnh (dataURI) vào thư mục con theo dự án; trả [{id, link, name}]. */
export const driveUpload = createServerFn({ method: "POST" })
  .validator((d: { projectKey: string; projectName?: string; files: { name: string; dataUri: string }[] }) => d)
  .handler(async ({ data }): Promise<{ uploaded: { id: string; link: string; name: string }[] }> => {
    const env = await getEnv();
    if (!env) throw new Error("Không lấy được env.");
    const token = await accessToken(env);
    const folderName = safeName(data.projectName || data.projectKey) || data.projectKey;
    const folder = await ensureFolder(token, folderName, rootOf(env));
    const uploaded: { id: string; link: string; name: string }[] = [];
    for (const f of data.files) { const u = await uploadFile(token, folder, f.name, f.dataUri); uploaded.push({ ...u, name: f.name }); }
    return { uploaded };
  });

/** LƯU 1 BẢN BÁO CÁO (PDF) vào "Data Source" › DATABASE › `folderName` › `fileName`, UPSERT theo tên:
 *  đã có file cùng tên → GHI ĐÈ (giữ id/link, folder không phình); chưa có → tạo mới. Dùng cho bản PDF
 *  tuân thủ mà Apps Script trong file gốc sẽ đính kèm mail. Trả {id, link, updated}.
 *  LÀ HÀM THUẦN (không phải serverFn) — gọi qua serverFn `saveComplianceReportPdf` ở edits.functions.ts
 *  bằng dynamic import, để module này KHÔNG lọt vào bundle client (import-protection chặn server import). */
export async function driveSaveReportImpl(path: string[], fileName: string, dataUri: string): Promise<{ id: string; link: string; updated: boolean }> {
  const env = await getEnv();
  if (!env) throw new Error("Không lấy được env.");
  const token = await accessToken(env);
  // "Data Source" › DATABASE › <…path, vd ["ePMP","Báo cáo tuân thủ"]> › file.
  const folder = await ensureDbPath(token, env, path);
  const name = safeName(fileName) || "bao-cao.pdf";
  const existing = await findFileByName(token, folder, name);
  const res = existing ? await updateFileMedia(token, existing, dataUri) : await uploadFile(token, folder, name, dataUri);
  return { id: res.id, link: res.link, updated: !!existing };
}

/** Liệt kê file trong thư mục con của 1 dự án → [{id, name, link}]. */
export const driveList = createServerFn({ method: "POST" })
  .validator((d: { projectKey: string; projectName?: string }) => d)
  .handler(async ({ data }): Promise<{ files: { id: string; name: string; link: string }[] }> => {
    const env = await getEnv();
    if (!env) throw new Error("Không lấy được env.");
    const token = await accessToken(env);
    const root = rootOf(env);
    const folderName = safeName(data.projectName || data.projectKey) || data.projectKey;
    const q = `name='${folderName.replace(/'/g, "\\'")}' and '${root}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const fr = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&${SHARED}`, { headers: AUTHH(token) });
    const fj = await fr.json() as { files?: { id: string }[] };
    if (!fj.files?.length) return { files: [] };
    const q2 = `'${fj.files[0].id}' in parents and trashed=false`;
    const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q2)}&fields=files(id,name,webViewLink)&orderBy=createdTime desc&${SHARED}`, { headers: AUTHH(token) });
    const j = await r.json() as { files?: { id: string; name: string; webViewLink?: string }[] };
    return { files: (j.files || []).map((f) => ({ id: f.id, name: f.name, link: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view` })) };
  });

/** Liệt kê file trong 1 CHUỖI thư mục DATABASE (vd ["ePMP","Video","Mini Hotel"]) → [{id,name,link}].
 *  Tạo folder nếu chưa có (ensureDbPath) để lần upload sau có chỗ. HÀM THUẦN — gọi qua serverFn dynamic-import. */
export async function driveListDirImpl(path: string[]): Promise<{ id: string; name: string; link: string }[]> {
  const env = await getEnv(); if (!env) throw new Error("Không lấy được env.");
  const token = await accessToken(env);
  const folder = await ensureDbPath(token, env, path);
  const q = `'${folder}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&orderBy=name&${SHARED}`, { headers: AUTHH(token) });
  const j = await r.json() as { files?: { id: string; name: string; webViewLink?: string }[] };
  return (j.files || []).map((f) => ({ id: f.id, name: f.name, link: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view` }));
}

/** Liệt kê CON của 1 path: tách riêng FILE (không phải folder) và FOLDER con. 1 truy vấn. HÀM THUẦN.
 *  CHỈ ĐỌC — dùng findDbPath (KHÔNG tạo thư mục): xem một căn chưa có gì thì trả rỗng, tuyệt đối không
 *  đẻ folder. Trước đây dùng ensureDbPath nên chỉ mở popup xem cũng tạo folder, và 2 lời gọi song song
 *  (Hình ảnh + Video) còn tạo trùng folder căn. Thư mục chỉ sinh ra lúc UPLOAD thật. */
export async function driveListChildrenImpl(path: string[]): Promise<{ files: { id: string; name: string; link: string }[]; folders: { id: string; name: string }[] }> {
  const env = await getEnv(); if (!env) throw new Error("Không lấy được env.");
  const token = await accessToken(env);
  const folder = await findDbPath(token, env, path);
  if (!folder) return { files: [], folders: [] };
  const q = `'${folder}' in parents and trashed=false`;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,webViewLink,size)&orderBy=name&pageSize=1000&${SHARED}`, { headers: AUTHH(token) });
  const j = await r.json() as { files?: { id: string; name: string; mimeType: string; webViewLink?: string; size?: string }[] };
  const files: { id: string; name: string; link: string }[] = [];
  const folders: { id: string; name: string }[] = [];
  for (const f of (j.files || [])) {
    if (f.mimeType === "application/vnd.google-apps.folder") folders.push({ id: f.id, name: f.name });
    // Bỏ file 0 BYTE ở đây nữa (cùng lý do với driveListFilesByParents): upload hụt để lại vỏ rỗng,
    // mở ra là Google trả lỗi. Lọc cả hai chỗ liệt kê thì vỏ rỗng không lọt vào đâu được.
    else if (!(f.size != null && Number(f.size) === 0)) files.push({ id: f.id, name: f.name, link: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view` });
  }
  return { files, folders };
}

/** Liệt kê THƯ MỤC CON của NHIỀU folder trong 1 lượt (chia lô 40) — để quét cây Media nhanh, khỏi gọi
 *  từng folder một (64 phòng × 2 = 128 lượt thì chậm chết). Trả kèm `parent` để dựng lại cây. */
export async function driveListFoldersByParents(parentIds: string[]): Promise<{ id: string; name: string; parent: string }[]> {
  if (!parentIds.length) return [];
  const env = await getEnv(); if (!env) throw new Error("Không lấy được env.");
  const token = await accessToken(env);
  const out: { id: string; name: string; parent: string }[] = [];
  for (let i = 0; i < parentIds.length; i += 40) {
    const chunk = parentIds.slice(i, i + 40);
    const q = `trashed=false and mimeType='application/vnd.google-apps.folder' and (${chunk.map((id) => `'${id}' in parents`).join(" or ")})`;
    const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,parents,size)&pageSize=1000&${SHARED}`, { headers: AUTHH(token) });
    const j = await r.json() as { files?: { id: string; name: string; parents?: string[] }[] };
    for (const f of (j.files || [])) out.push({ id: f.id, name: f.name, parent: f.parents?.[0] || "" });
  }
  return out;
}

/** Liệt kê FILE nằm trong BẤT KỲ folder nào thuộc `parentIds` (query OR nhiều parent, kèm `parent`).
 *  Lấy clip của nhiều thư mục căn cùng lúc, không gọi Drive N lần. HÀM THUẦN. */
export async function driveListFilesByParents(parentIds: string[]): Promise<{ id: string; name: string; link: string; parent: string; at: string }[]> {
  if (!parentIds.length) return [];
  const env = await getEnv(); if (!env) throw new Error("Không lấy được env.");
  const token = await accessToken(env);
  const out: { id: string; name: string; link: string; parent: string; at: string }[] = [];
  for (let i = 0; i < parentIds.length; i += 40) {   // chia lô để query không quá dài
    const chunk = parentIds.slice(i, i + 40);
    const q = `trashed=false and mimeType!='application/vnd.google-apps.folder' and (${chunk.map((id) => `'${id}' in parents`).join(" or ")})`;
    const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink,parents,size,createdTime)&pageSize=1000&${SHARED}`, { headers: AUTHH(token) });
    const j = await r.json() as { files?: { id: string; name: string; webViewLink?: string; parents?: string[]; size?: string; createdTime?: string }[] };
    // BỎ FILE 0 BYTE: upload hụt giữa chừng (rớt mạng, iOS khoá màn) để lại cái vỏ file rỗng trên Drive.
    // Vỏ đó vẫn hiện thành thẻ video, bấm vào thì Google trả lỗi 400. Không liệt kê nữa.
    for (const f of (j.files || [])) {
      if (f.size != null && Number(f.size) === 0) continue;
      // createdTime = GIỜ TẢI LÊN thật (ISO). Tên file chỉ có ngày quay, không đủ để chấm dấu theo giờ.
      out.push({ id: f.id, name: f.name, link: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`, parent: f.parents?.[0] || "", at: f.createdTime || "" });
    }
  }
  return out;
}

/** ĐỌC 1 FILE theo id → { mime, b64 } (tải qua OAuth, KHÔNG cần chia sẻ công khai). Dùng hiện ẢNH từ Drive
 *  (ảnh trong My Drive riêng → không nhúng trực tiếp được; phải tải byte qua Worker). HÀM THUẦN. */
export async function driveReadFileB64Impl(fileId: string): Promise<{ mime: string; b64: string }> {
  const env = await getEnv(); if (!env) throw new Error("Không lấy được env.");
  const token = await accessToken(env);
  const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType,size,name&${SHARED}`, { headers: AUTHH(token) });
  const mj = await meta.json() as { mimeType?: string; size?: string; name?: string };
  // CHẶN FILE QUÁ TO: hàm này nạp cả file vào bộ nhớ rồi mã hoá base64 (phình thêm ~33%). Worker chỉ có
  // 128MB — file vài chục MB là đủ làm sập nguyên request, người dùng thấy app "đứng" chứ không thấy lỗi.
  // 40MB là trần an toàn: clip công trường hiện nay 5–26MB, ảnh thì vài MB.
  const MAX = 40 * 1024 * 1024;
  const sz = Number(mj.size ?? 0);
  if (sz > MAX) throw new Error(`Tệp ${mj.name ?? ""} nặng ${(sz / 1048576).toFixed(0)}MB, vượt mức xem trực tiếp (40MB). Mở bằng Google Drive để xem.`);
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&${SHARED}`, { headers: AUTHH(token) });
  if (!r.ok) throw new Error(`Tải ảnh Drive lỗi (mã ${r.status}).`);
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = ""; const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode(...buf.subarray(i, i + CH));
  return { mime: mj.mimeType || "image/jpeg", b64: btoa(bin) };
}

/** Bỏ vào thùng rác MỌI file trùng TÊN trong 1 thư mục (không đụng thư mục con). Dùng trước khi upload
 *  bản mới cùng tên — Drive CHO PHÉP trùng tên nên không dọn thì mỗi lần nạp lại đẻ thêm 1 bản. */
export async function driveTrashByName(path: string[], fileName: string): Promise<number> {
  const env = await getEnv(); if (!env) return 0;
  const token = await accessToken(env);
  const folder = await findDbPath(token, env, path); if (!folder) return 0;
  const nm = safeName(fileName);
  const q = `'${folder}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder' and name='${nm.replace(/'/g, "\'")}'`;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&${SHARED}`, { headers: AUTHH(token) });
  const j = await r.json() as { files?: { id: string }[] };
  let n = 0;
  for (const f of (j.files || [])) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?${SHARED}`, {
      method: "PATCH", headers: { ...AUTHH(token), "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }),
    });
    n++;
  }
  return n;
}

/** FILE MỚI NHẤT trong 1 thư mục — tìm TỪ GỐC "Data Source" (KHÔNG chui qua DATABASE), vì thư mục
 *  "Mã màu" chủ nhà tạo nằm NGANG HÀNG với DATABASE. Không thấy ở gốc thì thử luôn dưới DATABASE cho
 *  chắc. Trả null nếu không có file nào. CHỈ ĐỌC, không tạo thư mục. */
export async function driveNewestFileIn(path: string[]): Promise<{ id: string; name: string } | null> {
  const env = await getEnv(); if (!env) return null;
  const token = await accessToken(env);
  const roots = [rootOf(env), await findFolder(token, DB_SUBFOLDER, rootOf(env))];
  for (const root of roots) {
    if (!root) continue;
    let parent: string | null = root;
    for (const seg of path) { if (!parent) break; parent = await findFolder(token, seg, parent); }
    if (!parent) continue;
    const q = `'${parent}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`;
    const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=20&${SHARED}`, { headers: AUTHH(token) });
    const j = await r.json() as { files?: { id: string; name: string }[] };
    if (j.files?.length) return { id: j.files[0].id, name: j.files[0].name };
  }
  return null;
}

/** Tải 1 file Drive về dạng CHỮ (utf-8) — dùng cho CSV/JSON nhỏ như bảng mã màu. */
export async function driveReadTextImpl(fileId: string): Promise<{ text: string }> {
  const env = await getEnv(); if (!env) throw new Error("Không lấy được env.");
  const token = await accessToken(env);
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&${SHARED}`, { headers: AUTHH(token) });
  if (!r.ok) throw new Error("Không tải được file: " + r.status);
  return { text: await r.text() };
}

/** Tạo PHIÊN UPLOAD TRỰC TIẾP (resumable) vào 1 folder DATABASE → trả session URL để TRÌNH DUYỆT PUT
 *  file THẲNG lên Google (byte KHÔNG qua Worker → hết lo OOM/giới hạn, file lớn vẫn được). HÀM THUẦN. */
export async function driveCreateResumableSession(path: string[], fileName: string, mimeType: string): Promise<{ uploadUrl: string }> {
  const env = await getEnv(); if (!env) throw new Error("Không lấy được env.");
  const token = await accessToken(env);
  const folder = await ensureDbPath(token, env, path);
  const name = safeName(fileName) || "clip.mp4";
  const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink&${SHARED}`, {
    method: "POST",
    headers: { ...AUTHH(token), "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mimeType || "video/mp4" },
    body: JSON.stringify({ name, parents: [folder] }),
  });
  if (!r.ok) throw new Error("Không tạo được phiên upload Drive: " + (await r.text()).slice(0, 160));
  const loc = r.headers.get("location");
  if (!loc) throw new Error("Drive không trả session URL (thiếu header Location).");
  return { uploadUrl: loc };
}

/** Xoá (đưa vào thùng rác Drive) 1 file theo id. */
export const driveDelete = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const env = await getEnv();
    if (!env) throw new Error("Không lấy được env.");
    const token = await accessToken(env);
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}?${SHARED}`, {
      method: "PATCH", headers: { ...AUTHH(token), "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }),
    });
    return { ok: r.ok };
  });
