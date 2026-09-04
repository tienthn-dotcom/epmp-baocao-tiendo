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
const mediaPath = (drive: { mediaFolderPath: (p: string, t: string, c: string, k: "photo" | "video", app?: string, hid?: string) => string[] },
  project: string, toa: string, can: string, kind: string, hid?: string) =>
  drive.mediaFolderPath(project, toa, can, kind === "video" ? "video" : "photo", "ePMP", hid);
const rid6 = () => Math.random().toString(36).slice(2, 8);

/** Cấp PHIÊN UPLOAD 1 file media (ảnh/video) cho 1 PHÒNG (Toà + căn) của 1 DỰ ÁN. Trả { uploadUrl, name }. */
export const startCanMediaUpload = createServerFn({ method: "POST" })
  .validator((d: { project: string; hid?: string; toa?: string; can: string; kind: "photo" | "video"; ext: string; mime: string }) => d)
  .handler(async ({ data }): Promise<{ uploadUrl: string; name: string }> => {
    const drive = await import("@/lib/drive.functions");
    if (!(await drive.driveIsConfigured())) throw new Error("Chưa cấu hình Google Drive (thiếu GDRIVE_OAUTH_*).");
    const can = safeCan(data.can);
    if (!can) throw new Error("Thiếu tên phòng.");
    const d = new Date(Date.now() + 7 * 3600_000); const p2 = (n: number) => String(n).padStart(2, "0");
    const stamp = `${p2(d.getUTCDate())}-${p2(d.getUTCMonth() + 1)}-${String(d.getUTCFullYear()).slice(2)}`;
    const name = `${can}_${stamp}_${rid6()}.${cleanExt(data.ext)}`;   // rand → up nhiều file 1 lượt không trùng tên
    const { uploadUrl } = await drive.driveCreateResumableSession(mediaPath(drive, data.project, data.toa || "", can, data.kind, data.hid), name, data.mime || (data.kind === "photo" ? "image/jpeg" : "video/mp4"));
    return { uploadUrl, name };
  });

/** Liệt kê media của 1 PHÒNG (Toà + căn) → { photos, videos }. */
export const listCanMedia = createServerFn({ method: "POST" })
  .validator((d: { project: string; hid?: string; toa?: string; can: string }) => d)
  .handler(async ({ data }): Promise<{ photos: { id: string; name: string; link: string }[]; videos: { id: string; name: string; link: string; date: string }[] }> => {
    const drive = await import("@/lib/drive.functions");
    if (!(await drive.driveIsConfigured())) return { photos: [], videos: [] };
    const dateOf = (fname: string) => { const b = fname.replace(/\.[^.]+$/, ""); const m = b.match(/(\d{2}-\d{2}-\d{2})/); return m ? m[1] : ""; };
    const [ph, vd] = await Promise.all([
      drive.driveListChildrenImpl(mediaPath(drive, data.project, data.toa || "", data.can, "photo", data.hid)).then((r) => r.files).catch(() => []),
      drive.driveListChildrenImpl(mediaPath(drive, data.project, data.toa || "", data.can, "video", data.hid)).then((r) => r.files).catch(() => []),
    ]);
    const byNew = (a: { name: string }, b: { name: string }) => b.name.localeCompare(a.name);
    return {
      photos: ph.slice().sort(byNew).map((f) => ({ id: f.id, name: f.name, link: f.link })),
      videos: vd.slice().sort(byNew).map((f) => ({ id: f.id, name: f.name, link: f.link, date: dateOf(f.name) })),
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
  .validator((d: { project: string; hid?: string }) => d)
  .handler(async ({ data }): Promise<{ cans: { toa: string; can: string; photos: number; videos: number; media: { id: string; kind: "photo" | "video"; date: string }[] }[] }> => {
    const drive = await import("@/lib/drive.functions");
    if (!(await drive.driveIsConfigured())) return { cans: [] };
    const project = drive.mediaProjectFolder(data.project, data.hid);
    const KIND = new Set(["Hình ảnh", "Video"]);
    const root = await drive.driveListChildrenImpl(["ePMP", "Media", project]);
    const lvl1 = root.folders.filter((f) => !KIND.has(f.name));          // Toà, hoặc Khu (khu public)
    if (!lvl1.length) return { cans: [] };

    const lvl2 = await drive.driveListFoldersByParents(lvl1.map((f) => f.id));
    const name1 = new Map(lvl1.map((f) => [f.id, f.name] as const));
    // Ô "căn/khu" = folder mà con của nó là Hình ảnh/Video. Gom mọi thư mục KIND kèm căn/khu sở hữu.
    const cans = new Map<string, { toa: string; can: string; photos: number; videos: number; media: { id: string; kind: "photo" | "video"; date: string }[] }>();
    const kindOwner = new Map<string, { key: string; kind: string }>();
    const keyOf = (toa: string, can: string) => `${toa} ${can}`;
    const own = (toa: string, can: string, kindId: string, kindName: string) => {
      const key = keyOf(toa, can);
      if (!cans.has(key)) cans.set(key, { toa, can, photos: 0, videos: 0, media: [] });
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
      // Giữ luôn ID để popup xem được TOÀN BỘ media của dự án (gộp theo phòng/khu) mà không phải
      // gọi Drive lại từng phòng. Ngày lấy từ đuôi tên file "<căn>_<dd-mm-yy>_<rid>.<ext>".
      const base = f.name.replace(/\.[^.]+$/, "");
      const dm = base.match(/(\d{2}-\d{2}-\d{2})/);
      c.media.push({ id: f.id, kind: o.kind === "Video" ? "video" : "photo", date: dm ? dm[1] : "" });
    }
    return { cans: [...cans.values()].filter((c) => c.photos || c.videos) };
  });
