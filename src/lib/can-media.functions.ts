/**
 * MEDIA CÔNG TRƯỜNG — đường dẫn Drive CHUẨN DUY NHẤT cho mọi dữ liệu ảnh/video công trường:
 *    DATABASE › ePMP › Media › <Dự án> › <Toà> › <tên phòng> › ("Hình ảnh" | "Video") › <file>
 * Cấp Toà BẮT BUỘC khi dự án chia Toà — mã căn TRÙNG nhau giữa các Toà (609 có ở B1, B2, B3).
 *
 * Upload TRỰC TIẾP client → Drive: Worker cấp 1 "vé" (phiên resumable) trỏ đúng folder, trình duyệt PUT
 * byte THẲNG lên Google (byte KHÔNG qua Worker → hết OOM, file lớn OK). Xem: ảnh tải byte qua Worker
 * (file trong My Drive riêng không nhúng thẳng được), video nhúng iframe /preview.
 * Drive helper ở drive.functions (DYNAMIC import trong handler → module server không lọt bundle client).
 *
 * LỊCH SỬ: app cũ "Video tại công trường" từng ghi vào `ePMP/Mini Hotel PQ (B1-B5) Phòng/Video/<Toà>/<căn>`.
 * Toàn bộ clip ĐÃ được scripts/media-migrate.mjs dời sang cây Media ở trên (dời file, giữ id → link cũ vẫn
 * sống), app cũ đã gỡ. Đừng dựng lại nhánh đường dẫn cũ.
 */
import { createServerFn } from "@tanstack/react-start";
import { parseMediaMsgs, capNganMsg, MEDIA_MSG_MAX, type MediaMsg } from "@/lib/media-msg";
import { DEFAULT_ADMINS, isAdminEmail, normEmail } from "@/lib/activity";
import { DEFAULT_ROLES, roleOf, type UserRole } from "@/lib/roles";
import { SESSION_COOKIE, readCookie, verifySession } from "@/lib/auth";

// LƯU Ý (giống edits.functions.ts): file này BỊ CLIENT IMPORT. Mọi hàm đụng server-only
// ("@tanstack/react-start/server") phải là hàm NỘI BỘ, không export — export ra là import-protection
// chặn cả app ("Import denied in client environment").
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

/** Email người đang gọi, lấy từ COOKIE PHIÊN đã ký — client không tự khai được là mình là ai. */
async function nguoiGoi(devAs?: string | null): Promise<string | null> {
  const env = await serverEnv();
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
  if (import.meta.env.DEV) return devAs ? normEmail(devAs) : "tienthn@aacorporation.com";
  return null;
}

/** Sửa/xoá được chú thích của NGƯỜI KHÁC: admin và PMO — cùng luật với box Vướng mắc bên ePMP. */
async function laAdminHoacPmo(devAs?: string | null): Promise<boolean> {
  const email = await nguoiGoi(devAs);
  if (!email) return false;
  if (isAdminEmail(email, DEFAULT_ADMINS)) return true;
  try {
    const env = await serverEnv();
    const kv = env.PMO_EDITS as undefined | { get: (k: string) => Promise<string | null> };
    const raw = kv ? await kv.get("roles:v1") : null;
    const map = (raw ? JSON.parse(raw) : {}) as Record<string, UserRole>;
    return roleOf(Object.keys(map).length ? map : DEFAULT_ROLES, email) === "PMO";
  } catch { return false; }
}

const cleanExt = (e: string) => (e || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "mp4";
const safeCan = (s: string) => (s || "").trim().replace(/[\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").slice(0, 60);

/* ═══════════════════════════════════════════════════════════════════════════
 *  MEDIA THEO PHÒNG/CĂN (bản đại trùng tu) — MỖI PHÒNG 1 KHO ẢNH + VIDEO, folder chuẩn:
 *    DATABASE › ePMP › Media › <Dự án> › <tên phòng> › "Hình ảnh" | "Video" › <file>
 *  Upload TRỰC TIẾP client→Drive (resumable), nhiều file 1 lượt. Xem: ảnh tải byte qua Worker (My Drive
 *  riêng không nhúng thẳng được), video nhúng iframe /preview như cũ.
 * ═══════════════════════════════════════════════════════════════════════════ */
const KIND_FOLDER = (kind: string) => (kind === "photo" ? "Hình ảnh" : "Video");
// DATABASE › ePMP › Media › <Dự án> › <Toà> › <tên phòng> › Hình ảnh|Video. Toà có thể rỗng (dự án không chia Toà).
/** Đường dẫn Media — GỌI THẲNG hàm dùng chung ở drive.functions (đừng dựng lại ở đây: hai bộ chuẩn hoá
 *  khác nhau từng làm ảnh up từ dashboard và ảnh của app Media rơi vào 2 folder khác tên). */
const mediaPath = (drive: { mediaFolderPath: (p: string, t: string, c: string, k: "photo" | "video", app?: string, hid?: string, maCT?: string) => string[] },
  project: string, toa: string, can: string, kind: string, hid?: string, maCT?: string) =>
  drive.mediaFolderPath(project, toa, can, kind === "video" ? "video" : "photo", "ePMP", hid, maCT);
const rid6 = () => Math.random().toString(36).slice(2, 8);
/** Số mục mới nhất mỗi căn mà màn hình nạp sẵn (Drive vẫn giữ đủ, xem cũ thì bấm "Xem thêm"). */
const MEDIA_MOI_NHAT = 2;
/** CHÚ THÍCH ảnh/clip — cắt còn 100 TỪ (chốt với chủ nhà) và bỏ xuống dòng cho gọn một đoạn.
 *  Chặn ở SERVER chứ không chỉ ở ô nhập: client sửa được, server thì không. */
const capNgan = (s?: string): string | undefined => {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  const tu = t.split(" ");
  return (tu.length > 100 ? tu.slice(0, 100).join(" ") + "…" : t).slice(0, 1000);
};

/** Cấp PHIÊN UPLOAD 1 file media (ảnh/video) cho 1 PHÒNG (Toà + căn) của 1 DỰ ÁN. Trả { uploadUrl, name }. */
export const startCanMediaUpload = createServerFn({ method: "POST" })
  .validator((d: { project: string; hid?: string; maCT?: string; toa?: string; can: string; kind: "photo" | "video"; ext: string; mime: string; origin?: string; caption?: string; devAs?: string | null }) => d)
  .handler(async ({ data }): Promise<{ uploadUrl: string; name: string }> => {
    const drive = await import("@/lib/drive.functions");
    if (!(await drive.driveIsConfigured())) throw new Error("Chưa cấu hình Google Drive (thiếu GDRIVE_OAUTH_*).");
    const can = safeCan(data.can);
    if (!can) throw new Error("Thiếu tên phòng.");
    // CHÚ THÍCH LÀ BẮT BUỘC: tải ảnh/clip lên đồng thời phải nói hiện trạng đang tới đâu. Chặn ở
    // SERVER chứ không riêng ở nút bấm — người dùng gọi thẳng API vẫn không lách được.
    const loi = capNganMsg(data.caption);
    if (!loi) throw new Error("Phải ghi chú thích (báo hiện trạng) trước khi tải lên.");
    const nguoi = (await nguoiGoi(data.devAs)) || "(không rõ)";
    // Chú thích thành TIN ĐẦU TIÊN trong hộp thoại của tệp: có người viết, có ngày giờ.
    const tin = JSON.stringify([{ id: rid6() + Date.now().toString(36).slice(-4), text: loi, author: nguoi, at: new Date().toISOString() }]);
    const d = new Date(Date.now() + 7 * 3600_000); const p2 = (n: number) => String(n).padStart(2, "0");
    const stamp = `${p2(d.getUTCDate())}-${p2(d.getUTCMonth() + 1)}-${String(d.getUTCFullYear()).slice(2)}`;
    const name = `${can}_${stamp}_${rid6()}.${cleanExt(data.ext)}`;   // rand → up nhiều file 1 lượt không trùng tên
    const { uploadUrl } = await drive.driveCreateResumableSession(mediaPath(drive, data.project, data.toa || "", can, data.kind, data.hid, data.maCT), name, data.mime || (data.kind === "photo" ? "image/jpeg" : "video/mp4"), data.origin, tin);
    return { uploadUrl, name };
  });

/** TẢI PDF LÊN CHO 1 HẠNG MỤC — mở phiên upload, client PUT thẳng lên Google (không qua Worker).
 *  Nhiều công đoạn chỉ cần đính một file PDF chứ không có ma trận Excel; đây là đường cho việc đó.
 *  Lưu vào: DATABASE › ePMP › Tài liệu hạng mục › <mã CT hoặc khoá dự án> › <tên>.pdf
 *  Tên file kèm ngày + mã ngẫu nhiên: tải lại nhiều lần không đè mất bản cũ, muốn xem bản nào cũng còn. */
export const startItemPdfUpload = createServerFn({ method: "POST" })
  .validator((d: { key: string; label?: string; fileName: string; origin?: string }) => d)
  .handler(async ({ data }): Promise<{ uploadUrl: string; name: string }> => {
    const drive = await import("@/lib/drive.functions");
    if (!(await drive.driveIsConfigured())) throw new Error("Chưa cấu hình Google Drive (thiếu GDRIVE_OAUTH_*).");
    const folder = (data.label || data.key || "Khac").replace(/[\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "Khac";
    const base = (data.fileName || "tai-lieu").replace(/\.[^.]+$/, "").replace(/[\/:*?"<>|]+/g, "-").trim().slice(0, 60) || "tai-lieu";
    const d = new Date(Date.now() + 7 * 3600_000); const p2 = (n: number) => String(n).padStart(2, "0");
    const stamp = `${p2(d.getUTCDate())}-${p2(d.getUTCMonth() + 1)}-${String(d.getUTCFullYear()).slice(2)}`;
    const name = `${base}_${stamp}_${rid6()}.pdf`;
    const { uploadUrl } = await drive.driveCreateResumableSession(["ePMP", "Tài liệu hạng mục", folder], name, "application/pdf", data.origin);
    return { uploadUrl, name };
  });

/** ĐỌC TÀI LIỆU PDF của hạng mục → base64 (client dựng blob rồi xem).
 *  Đi qua token của app nên NGƯỜI XEM KHÔNG CẦN quyền Drive — ai vào được app là xem được, giống
 *  ảnh/clip công trường. Hàm dùng chung đã chặn tệp >40MB (Worker chỉ có 128MB bộ nhớ). */
export const readItemPdf = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<{ b64: string; mime: string }> => {
    const drive = await import("@/lib/drive.functions");
    const { mime, b64 } = await drive.driveReadFileB64Impl(data.id);
    return { b64, mime: mime || "application/pdf" };
  });

/* ── CHÚ THÍCH ẢNH/CLIP = HỘP THOẠI, KHÔNG PHẢI MỘT DÒNG CHỮ ────────────────────────────────
   Giống hệt ô "Vướng mắc / Giải pháp" bên ePMP: nhiều người viết được, mỗi tin có NGƯỜI VIẾT và
   NGÀY VIẾT. Cả chuỗi tin nằm trong phần mô tả của chính tệp trên Drive (JSON) — xoá tệp là mất
   theo, không phải nuôi thêm một kho riêng rồi lệch nhau.
   Tin cũ ở dạng một dòng chữ trần (trước 07/09/2026) vẫn đọc được: coi như một tin không rõ người. */
const rid10 = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

/** Thêm / sửa / xoá một tin chú thích của 1 ảnh-clip. Trả về CHUỖI TIN sau khi đổi. */
export const editMediaMsg = createServerFn({ method: "POST" })
  .validator((d: { id: string; op: "add" | "edit" | "del"; msgId?: string; text?: string; devAs?: string | null }) => d)
  .handler(async ({ data }): Promise<{ msgs: MediaMsg[] }> => {
    const drive = await import("@/lib/drive.functions");
    if (!(await drive.driveIsConfigured())) throw new Error("Chưa cấu hình Google Drive.");
    if (!/^[a-zA-Z0-9_-]{10,}$/.test(data.id || "")) throw new Error("Thiếu tệp cần ghi chú thích.");
    const me = await nguoiGoi(data.devAs);
    if (!me) throw new Error("Cần đăng nhập mới ghi được chú thích.");

    const cur = parseMediaMsgs((await drive.driveGetDescription(data.id)) || "");
    let msgs = cur;
    if (data.op === "add") {
      const t = capNganMsg(data.text);
      if (!t) throw new Error("Chưa nhập nội dung.");
      msgs = [...cur, { id: rid10(), text: t, author: me, at: new Date().toISOString() }].slice(-MEDIA_MSG_MAX);
    } else {
      const i = cur.findIndex((m) => m.id === data.msgId);
      if (i < 0) throw new Error("Không thấy tin cần sửa.");
      // Sửa/xoá: tác giả tự làm được; admin và PMO làm được cho mọi tin (giống bên Vướng mắc).
      const quyen = cur[i].author === me || (await laAdminHoacPmo(data.devAs));
      if (!quyen) throw new Error("Chỉ người viết, admin hoặc PMO mới sửa được tin này.");
      if (data.op === "del") msgs = cur.filter((_, k) => k !== i);
      else {
        const t = capNganMsg(data.text);
        if (!t) throw new Error("Chưa nhập nội dung.");
        msgs = cur.map((m, k) => (k === i ? { ...m, text: t } : m));
      }
    }
    const ok = await drive.driveSetDescription(data.id, msgs.length ? JSON.stringify(msgs) : "");
    if (!ok) throw new Error("Drive không nhận chú thích (thử lại sau).");
    return { msgs };
  });

/** Liệt kê media của 1 PHÒNG (Toà + căn) → { photos, videos }. */
export const listCanMedia = createServerFn({ method: "POST" })
  .validator((d: { project: string; hid?: string; maCT?: string; toa?: string; can: string }) => d)
  .handler(async ({ data }): Promise<{ photos: { id: string; name: string; link: string; desc?: string }[]; videos: { id: string; name: string; link: string; date: string; desc?: string }[] }> => {
    const drive = await import("@/lib/drive.functions");
    if (!(await drive.driveIsConfigured())) return { photos: [], videos: [] };
    const dateOf = (fname: string) => { const b = fname.replace(/\.[^.]+$/, ""); const m = b.match(/(\d{2}-\d{2}-\d{2})/); return m ? m[1] : ""; };
    const [ph, vd] = await Promise.all([
      drive.driveListChildrenImpl(mediaPath(drive, data.project, data.toa || "", data.can, "photo", data.hid, data.maCT)).then((r) => r.files).catch(() => []),
      drive.driveListChildrenImpl(mediaPath(drive, data.project, data.toa || "", data.can, "video", data.hid, data.maCT)).then((r) => r.files).catch(() => []),
    ]);
    const byNew = (a: { name: string }, b: { name: string }) => b.name.localeCompare(a.name);
    return {
      photos: ph.slice().sort(byNew).map((f) => ({ id: f.id, name: f.name, link: f.link, ...(f.desc ? { desc: f.desc } : {}) })),
      videos: vd.slice().sort(byNew).map((f) => ({ id: f.id, name: f.name, link: f.link, date: dateOf(f.name), ...(f.desc ? { desc: f.desc } : {}) })),
    };
  });

/** Đọc 1 ẢNH Drive → data URI (để hiện trong lưới ảnh). */
export const readCanMediaB64 = createServerFn({ method: "POST" })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<{ dataUri: string }> => {
    const drive = await import("@/lib/drive.functions");
    const { mime, b64 } = await drive.driveReadFileB64Impl(data.id);
    return { dataUri: `data:${mime};base64,${b64}` };
  });

/** QUÉT NHANH cả cây Media của 1 dự án → CĂN/KHU NÀO ĐÃ CÓ ẢNH/VIDEO (để chấm dấu lên ma trận:
 *  nhìn là biết chỗ nào đã có tư liệu, chỗ nào còn trống).
 *  Chịu cả 2 dáng cây: `<Dự án>/<Toà>/<Căn>/(Hình ảnh|Video)` và `<Dự án>/<Khu>/(Hình ảnh|Video)`
 *  (khu public không chia Toà) — phân biệt bằng: con của nó tên "Hình ảnh"/"Video" thì chính nó là căn/khu.
 *  Quét theo LÔ (driveList*ByParents) nên chỉ tốn ~4 lượt gọi Drive, không phải mỗi phòng một lượt. */
export const listProjectMedia = createServerFn({ method: "POST" })
  .validator((d: { project: string; hid?: string; maCT?: string }) => d)
  .handler(async ({ data }): Promise<{ cans: { toa: string; can: string; photos: number; videos: number; at: string; media: { id: string; kind: "photo" | "video"; date: string; desc?: string; at?: string }[]; tong: number }[] }> => {
    const drive = await import("@/lib/drive.functions");
    if (!(await drive.driveIsConfigured())) return { cans: [] };
    const project = drive.mediaProjectFolder(data.project, data.hid, data.maCT);
    const KIND = new Set(["Hình ảnh", "Video"]);
    const root = await drive.driveListChildrenImpl(["ePMP", "Media", project]);
    const lvl1 = root.folders.filter((f) => !KIND.has(f.name));          // Toà, hoặc Khu (khu public)
    if (!lvl1.length) return { cans: [] };

    const lvl2 = await drive.driveListFoldersByParents(lvl1.map((f) => f.id));
    const name1 = new Map(lvl1.map((f) => [f.id, f.name] as const));
    // Ô "căn/khu" = folder mà con của nó là Hình ảnh/Video. Gom mọi thư mục KIND kèm căn/khu sở hữu.
    const cans = new Map<string, { toa: string; can: string; photos: number; videos: number; at: string; media: { id: string; kind: "photo" | "video"; date: string; desc?: string; at?: string }[]; tong: number }>();
    const kindOwner = new Map<string, { key: string; kind: string }>();
    const keyOf = (toa: string, can: string) => `${toa} ${can}`;
    const own = (toa: string, can: string, kindId: string, kindName: string) => {
      const key = keyOf(toa, can);
      if (!cans.has(key)) cans.set(key, { toa, can, photos: 0, videos: 0, at: "", media: [], tong: 0 });
      kindOwner.set(kindId, { key, kind: kindName });
    };
    // lvl1 chính là căn/khu (không có cấp Toà)
    for (const f of lvl2) if (KIND.has(f.name)) own("", name1.get(f.parent) || "", f.id, f.name);
    // còn lại: lvl1 = Toà, lvl2 = căn → cần thêm 1 tầng nữa
    const rooms = lvl2.filter((f) => !KIND.has(f.name));
    if (rooms.length) {
      const nameRoom = new Map(rooms.map((f) => [f.id, f] as const));
      for (const k of await drive.driveListFoldersByParents(rooms.map((f) => f.id))) {
        if (!KIND.has(k.name)) continue;
        const room = nameRoom.get(k.parent); if (!room) continue;
        own(name1.get(room.parent) || "", room.name, k.id, k.name);
      }
    }
    for (const f of await drive.driveListFilesByParents([...kindOwner.keys()])) {
      const o = kindOwner.get(f.parent); if (!o) continue;
      const c = cans.get(o.key); if (!c) continue;
      if (o.kind === "Video") c.videos++; else c.photos++;
      // GIỜ TẢI LÊN GẦN NHẤT của căn — chấm dấu trên ma trận đổi màu / độ đầy theo giờ (xem markStyle).
      if (f.at && f.at > c.at) c.at = f.at;
      // Giữ luôn ID để popup xem được TOÀN BỘ media của dự án (gộp theo phòng/khu) mà không phải
      // gọi Drive lại từng phòng. Ngày lấy từ đuôi tên file "<căn>_<dd-mm-yy>_<rid>.<ext>".
      const base = f.name.replace(/\.[^.]+$/, "");
      const dm = base.match(/(\d{2}-\d{2}-\d{2})/);
      c.media.push({ id: f.id, kind: o.kind === "Video" ? "video" : "photo", date: dm ? dm[1] : "", ...(f.desc ? { desc: f.desc } : {}), ...(f.at ? { at: f.at } : {}) });
    }
    // CHỈ TRẢ 2 MỤC MỚI NHẤT MỖI CĂN. Một dự án vài chục căn × chục clip là hàng trăm mục nặng
    // vô ích: xem tiến độ chỉ cần bản mới nhất và bản kế trước để đối chiếu. Drive vẫn giữ nguyên
    // toàn bộ; muốn xem cũ thì bấm "Xem thêm" trong popup, lúc đó mới gọi listCanMedia lấy đủ.
    const out = [...cans.values()].filter((c) => c.photos || c.videos);
    for (const c of out) {
      c.tong = c.media.length;
      // Mới nhất trước: ưu tiên giờ tải lên thật (createdTime), thiếu thì lùi về ngày trong tên tệp.
      c.media.sort((a, b) => (b.at || b.date || "").localeCompare(a.at || a.date || ""));
      c.media = c.media.slice(0, MEDIA_MOI_NHAT);
    }
    return { cans: out };
  });

/** DỰ ÁN NÀO TRONG CÂY MEDIA ĐÃ CÓ ÍT NHẤT 1 FILE — để dashboard ePMP chỉ hiện nút "🎬 Media" ở những
 *  dự án thật sự có ảnh/video (dự án trống thì đừng bày nút cho rối).
 *  Quét theo LÔ (mỗi cấp 1-vài lượt gọi) chứ không đi từng dự án; kết quả nên cache lâu ở client. */
export const listMediaProjects = createServerFn({ method: "GET" })
  .handler(async (): Promise<{ projects: string[] }> => {
    const drive = await import("@/lib/drive.functions");
    if (!(await drive.driveIsConfigured())) return { projects: [] };
    const root = await drive.driveListChildrenImpl(["ePMP", "Media"]);
    if (!root.folders.length) return { projects: [] };
    const owner = new Map<string, string>();            // id thư mục con → tên dự án gốc
    for (const p of root.folders) owner.set(p.id, p.name);
    let level = root.folders.map((f) => f.id);
    const has = new Set<string>();
    // File nằm SÂU 4 cấp: <Dự án>/<Toà>/<Phòng>/(Hình ảnh|Video)/file — nên phải đi đủ 4-5 cấp,
    // dừng sớm ở cấp 3 thì không gặp file nào và kết luận "dự án nào cũng trống".
    for (let depth = 0; depth < 5 && level.length; depth++) {
      for (const f of await drive.driveListFilesByParents(level)) {
        const nm = owner.get(f.parent); if (nm) has.add(nm);
      }
      const next = await drive.driveListFoldersByParents(level);
      for (const f of next) { const nm = owner.get(f.parent); if (nm) owner.set(f.id, nm); }
      level = next.map((f) => f.id).filter((id) => owner.has(id));
    }
    return { projects: [...has] };
  });
