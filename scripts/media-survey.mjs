/**
 * KHẢO SÁT cây Drive: DATABASE › ePMP › Media › <dự án> › <Toà> › <phòng> › (Hình ảnh|Video)
 *   node scripts/media-survey.mjs                (mặc định: Mini Hotel PQ (B1-B5) Phòng)
 *   node scripts/media-survey.mjs "<tên dự án>"  (dự án khác)
 * Chỉ ĐỌC, không sửa gì.
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) process.env[m[1]] = m[2]; }
const ROOT = "1O9VktCpBENaZB1xgABr8MfIbl3YW8hFO"; const S = "supportsAllDrives=true&includeItemsFromAllDrives=true";
const FOLDER = "application/vnd.google-apps.folder";
const PROJECT = process.argv[2] || "Mini Hotel PQ (B1-B5) Phòng";
const b = new URLSearchParams({ client_id: process.env.GDRIVE_OAUTH_CLIENT_ID, client_secret: process.env.GDRIVE_OAUTH_CLIENT_SECRET, refresh_token: process.env.GDRIVE_OAUTH_REFRESH, grant_type: "refresh_token" });
const tj = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: b })).json();
const H = { Authorization: `Bearer ${tj.access_token}` };
async function ls(p) { const q = `'${p}' in parents and trashed=false`; const r = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size)&pageSize=1000&${S}`, { headers: H })).json(); return r.files || []; }
async function fc(p, n) { return (await ls(p)).find((f) => f.name === n && f.mimeType === FOLDER); }

let ep = ROOT; for (const s of ["DATABASE", "ePMP"]) ep = (await fc(ep, s)).id;
const medias = (await ls(ep)).filter((f) => f.name === "Media" && f.mimeType === FOLDER);
console.log(`ePMP có ${medias.length} folder "Media"`);
for (const media of medias) {
  console.log(`\n=== Media (${media.id}) ===`);
  for (const proj of await ls(media.id)) {
    const mark = proj.name === PROJECT ? " ◀ KHẢO SÁT" : "";
    console.log(` • dự án: ${proj.name}${proj.mimeType !== FOLDER ? " [FILE!]" : ""}${mark}`);
    if (proj.name !== PROJECT || proj.mimeType !== FOLDER) continue;
    for (const toa of await ls(proj.id)) {
      if (toa.mimeType !== FOLDER) { console.log(`    - [FILE lạc] ${toa.name}`); continue; }
      const rooms = await ls(toa.id);
      if (toa.name === "Hình ảnh" || toa.name === "Video") {   // ảnh/video CHUNG của dự án, không phải Toà
        console.log(`    ▸ [chung dự án] ${toa.name} — ${rooms.filter((f) => f.mimeType !== FOLDER).length} file`);
        continue;
      }
      console.log(`    ▸ Toà ${toa.name} — ${rooms.length} mục`);
      for (const room of rooms) {
        if (room.mimeType !== FOLDER) { console.log(`        [FILE lạc] ${room.name}`); continue; }
        const kinds = await ls(room.id);
        const parts = [];
        for (const k of kinds) {
          if (k.mimeType !== FOLDER) { parts.push(`[FILE lạc ${k.name}]`); continue; }
          const files = (await ls(k.id)).filter((f) => f.mimeType !== FOLDER);
          parts.push(`${k.name}=${files.length}`);
        }
        console.log(`        phòng ${room.name}: ${parts.join(" · ") || "(rỗng)"}`);
      }
    }
  }
}
