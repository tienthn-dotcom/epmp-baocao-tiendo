/**
 * DỌN & CHUẨN HOÁ cây Media Mini Hotel:
 *  1) Xoá cây CŨ rỗng (ePMP/Mini Hotel.../Video).
 *  2) Xoá folder RÁC rỗng nằm SAI chỗ: con trực tiếp của Media/<dự án> mà KHÔNG phải Toà B1-B5
 *     (vd "609" top-level, "L04-B2", "L05-Đã giao thô- 362" — do bấm ô ma trận suy sai lúc test).
 *  3) Xoá folder "Media" TRÙNG rỗng.
 *  4) ĐẢM BẢO mỗi PHÒNG (dưới B1-B5) có ĐỦ 2 thư mục "Hình ảnh" + "Video".
 *  GIỮ NGUYÊN: Toà B1-B5, phòng hợp lệ, và 2 thư mục Hình ảnh/Video (kể cả rỗng).
 *   node scripts/media-cleanup.mjs        (DRY) | --go (làm thật)
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) process.env[m[1]] = m[2]; }
const GO = process.argv.includes("--go");
const ROOT = "1O9VktCpBENaZB1xgABr8MfIbl3YW8hFO"; const S = "supportsAllDrives=true&includeItemsFromAllDrives=true";
const FOLDER = "application/vnd.google-apps.folder"; const PROJECT = "Mini Hotel PQ (B1-B5) Phòng";
const TOA_OK = /^B[1-5]$/i;
// Cấp DỰ ÁN có 2 thư mục hợp lệ ngoài các Toà: ảnh/video CHUNG của dự án (không thuộc phòng nào)
// — driveArchiveImages ghi ảnh hiện trường vào đây. KHÔNG được trash dù đang rỗng.
const PROJ_OK = new Set(["Hình ảnh", "Video"]);
const b = new URLSearchParams({ client_id: process.env.GDRIVE_OAUTH_CLIENT_ID, client_secret: process.env.GDRIVE_OAUTH_CLIENT_SECRET, refresh_token: process.env.GDRIVE_OAUTH_REFRESH, grant_type: "refresh_token" });
const tj = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: b })).json();
const H = { Authorization: `Bearer ${tj.access_token}` };
async function ls(p) { const q = `'${p}' in parents and trashed=false`; const r = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&pageSize=1000&${S}`, { headers: H })).json(); return r.files || []; }
async function fc(p, n) { return (await ls(p)).find((f) => f.name === n && f.mimeType === FOLDER); }
async function trash(id) { if (GO) await fetch(`https://www.googleapis.com/drive/v3/files/${id}?${S}`, { method: "PATCH", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) }); }
async function mkFolder(parent, name) { if (!GO) { console.log("  TẠO:", name); return "(dry)"; } const cr = await (await fetch(`https://www.googleapis.com/drive/v3/files?${S}&fields=id`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) })).json(); return cr.id; }
async function hasAnyFile(id) { for (const k of await ls(id)) { if (k.mimeType !== FOLDER) return true; if (await hasAnyFile(k.id)) return true; } return false; }

let trashed = 0, created = 0;
let ep = ROOT; for (const s of ["DATABASE", "ePMP"]) ep = (await fc(ep, s)).id;
console.log(GO ? "=== DỌN THẬT ===" : "=== DRY ===");

// 1) cây cũ rỗng
const oldProj = await fc(ep, PROJECT);
if (oldProj) { const ov = await fc(oldProj.id, "Video"); if (ov && !(await hasAnyFile(ov.id))) { console.log("TRASH cây cũ Video (rỗng)"); trashed++; await trash(ov.id); } }

// 2)+3)+4) trong (các) folder Media
for (const media of (await ls(ep)).filter((f) => f.name === "Media" && f.mimeType === FOLDER)) {
  const proj = await fc(media.id, PROJECT);
  if (proj) {
    for (const child of await ls(proj.id)) {
      if (child.mimeType !== FOLDER) continue;
      if (PROJ_OK.has(child.name)) continue;                                    // ảnh/video CHUNG của dự án → giữ
      if (!TOA_OK.test(child.name)) {   // con KHÔNG phải Toà → rác nếu rỗng
        if (!(await hasAnyFile(child.id))) { console.log("TRASH rác sai chỗ:", child.name); trashed++; await trash(child.id); }
        else console.log("⚠ GIỮ (có file nhưng sai chỗ, xem lại tay):", child.name);
        continue;
      }
      // Toà hợp lệ → mỗi PHÒNG đảm bảo đủ Hình ảnh + Video
      for (const room of await ls(child.id)) {
        if (room.mimeType !== FOLDER) continue;
        for (const kind of ["Hình ảnh", "Video"]) {
          if (!(await fc(room.id, kind))) { console.log(`  + tạo ${child.name}/${room.name}/${kind}`); created++; await mkFolder(room.id, kind); }
        }
      }
    }
  }
  // Media rỗng hẳn → trash (folder trùng)
  if (!(await ls(media.id)).length) { console.log("TRASH Media rỗng (trùng)"); trashed++; await trash(media.id); }
}
console.log(`\nTrash ${trashed} folder rác/rỗng · tạo ${created} thư mục thiếu.`);
console.log(GO ? "✅ Xong." : "→ --go để làm thật.");
