/**
 * DỜI/CHUẨN HOÁ MEDIA MINI HOTEL trên Google Drive về cấu trúc chuẩn:
 *   DATABASE › ePMP › Media › Mini Hotel PQ (B1-B5) Phòng › <Toà> › <tên phòng> › (Hình ảnh | Video) › file
 * Gộp cả cây CŨ (ePMP › Mini Hotel PQ (B1-B5) Phòng › Video › <Toà> › …) lẫn cây Media hiện có,
 * đưa MỌI clip vào đúng <Toà>/<phòng>/Video. Dời file (giữ id → link không đổi), KHÔNG xoá file.
 * Chạy:  node scripts/media-migrate.mjs        (DRY-RUN, chỉ in)
 *        node scripts/media-migrate.mjs --go    (dời thật)
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) process.env[m[1]] = m[2]; }
const GO = process.argv.includes("--go");
const ROOT = "1O9VktCpBENaZB1xgABr8MfIbl3YW8hFO";
const S = "supportsAllDrives=true&includeItemsFromAllDrives=true";
const PROJECT = "Mini Hotel PQ (B1-B5) Phòng";
const FOLDER = "application/vnd.google-apps.folder";
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;

const b = new URLSearchParams({ client_id: process.env.GDRIVE_OAUTH_CLIENT_ID, client_secret: process.env.GDRIVE_OAUTH_CLIENT_SECRET, refresh_token: process.env.GDRIVE_OAUTH_REFRESH, grant_type: "refresh_token" });
const tj = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: b })).json();
const H = { Authorization: `Bearer ${tj.access_token}` };

async function ls(p) { const q = `'${p}' in parents and trashed=false`; const r = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,parents)&pageSize=1000&${S}`, { headers: H })).json(); return r.files || []; }
async function findChild(parent, name, folderOnly = true) { return (await ls(parent)).find((f) => f.name === name && (!folderOnly || f.mimeType === FOLDER)); }
async function findAll(parent, name) { return (await ls(parent)).filter((f) => f.name === name); }
async function mkFolder(parent, name) {
  const ex = await findChild(parent, name); if (ex) return ex.id;
  if (!GO) return `(TẠO:${name})`;
  const cr = await (await fetch(`https://www.googleapis.com/drive/v3/files?${S}&fields=id`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) })).json();
  return cr.id;
}
async function ensurePath(baseId, segs) { let cur = baseId; for (const s of segs) cur = await mkFolder(cur, s); return cur; }
async function moveFile(fileId, oldParent, newParent) {
  if (!GO) return;
  await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?addParents=${newParent}&removeParents=${oldParent}&${S}&fields=id`, { method: "PATCH", headers: H });
}
const roomOf = (fname) => { const base = fname.replace(/\.[^.]+$/, ""); const us = base.indexOf("_"); return (us >= 0 ? base.slice(0, us) : base).trim(); };

// ── Định vị cây ──
let ep = ROOT; for (const s of ["DATABASE", "ePMP"]) ep = (await findChild(ep, s)).id;

// Media (xử lý TRÙNG: gộp về 1). Lấy tất cả folder tên "Media"; chọn cái CÓ Mini Hotel làm chính.
const medias = await findAll(ep, "Media");
let mediaId = null;
for (const m of medias) { if (await findChild(m.id, PROJECT)) { mediaId = m.id; break; } }
if (!mediaId) mediaId = medias[0] ? medias[0].id : await mkFolder(ep, "Media");
const dupMedias = medias.filter((m) => m.id !== mediaId);
const mediaProjId = await mkFolder(mediaId, PROJECT);   // base đích

let moves = 0, mkdirs = new Set();
function planMove(fileId, fromLabel, toSegs, fname) {
  moves++;
  console.log(`  MOVE  ${fromLabel}/${fname}\n     -> Media/${PROJECT}/${toSegs.join("/")}/${fname}`);
}

// Chuẩn hoá 1 Toà: đưa mọi clip về <Toà>/<phòng>/Video. `toaSrcId` = folder Toà nguồn; `toaName` = "B1"…
async function normalizeToa(toaSrcId, toaName, srcLabel) {
  for (const item of await ls(toaSrcId)) {
    if (item.mimeType === FOLDER) {
      // folder phòng: file trực tiếp bên trong → dời vào <phòng>/Video; giữ Hình ảnh/Video sẵn có
      const room = item.name;
      for (const f of await ls(item.id)) {
        if (f.mimeType === FOLDER) continue; // Hình ảnh / Video đã đúng — bỏ qua
        const kind = VIDEO_EXT.test(f.name) ? "Video" : "Hình ảnh";
        const dest = await ensurePath(mediaProjId, [toaName, room, kind]);
        planMove(f.id, `${srcLabel}/${toaName}/${room}`, [toaName, room, kind], f.name);
        await moveFile(f.id, item.id, dest); mkdirs.add(`${toaName}/${room}/${kind}`);
      }
    } else {
      // file phẳng trong Toà → phòng = tên trước "_ngày"
      const room = roomOf(item.name) || "khac";
      const kind = VIDEO_EXT.test(item.name) ? "Video" : "Hình ảnh";
      const dest = await ensurePath(mediaProjId, [toaName, room, kind]);
      planMove(item.id, `${srcLabel}/${toaName}`, [toaName, room, kind], item.name);
      await moveFile(item.id, toaSrcId, dest); mkdirs.add(`${toaName}/${room}/${kind}`);
    }
  }
}

console.log(GO ? "=== DỜI THẬT ===" : "=== DRY-RUN (chưa đụng gì) ===");
if (dupMedias.length) console.log(`⚠ Có ${dupMedias.length} folder "Media" TRÙNG (sẽ dọn nếu rỗng).`);

// 1) Chuẩn hoá cây Media hiện có
console.log(`\n[Media] chuẩn hoá các Toà đã có:`);
for (const toa of await ls(mediaProjId)) { if (toa.mimeType === FOLDER) await normalizeToa(toa.id, toa.name, "Media"); }

// 2) Gộp cây CŨ: ePMP › Mini Hotel PQ (B1-B5) Phòng › Video › <Toà>
const oldProj = await findChild(ep, PROJECT);
if (oldProj) {
  const oldVideo = await findChild(oldProj.id, "Video");
  if (oldVideo) { console.log(`\n[Cũ] gộp ePMP/${PROJECT}/Video/* vào Media:`); for (const toa of await ls(oldVideo.id)) { if (toa.mimeType === FOLDER) await normalizeToa(toa.id, toa.name, "Cũ"); } }
  const oldImg = await findChild(oldProj.id, "Hình ảnh");
  if (oldImg) { const imgs = (await ls(oldImg.id)).filter((f) => f.mimeType !== FOLDER); if (imgs.length) console.log(`\n[Cũ] còn ${imgs.length} ảnh dự-án-chung ở ePMP/${PROJECT}/Hình ảnh → GIỮ NGUYÊN (không thuộc phòng nào).`); }
}

console.log(`\nTỔNG: ${moves} file cần dời · ${mkdirs.size} folder <Toà/phòng/loại> đích.`);
console.log(GO ? "✅ Đã dời xong." : "→ Chạy lại với --go để dời thật.");
