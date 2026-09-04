/**
 * CHIA SẺ folder Media cho TOÀN DOMAIN aacorporation.com (quyền XEM) — để nhân sự công trường xem được
 * VIDEO qua iframe drive.google.com/.../preview (ảnh thì app tự tải byte, không cần quyền này).
 * File/thư mục BÊN TRONG Media kế thừa quyền này, cả clip cũ lẫn file upload sau → chỉ cần set 1 lần.
 * Người ngoài domain KHÔNG xem được.
 *   node scripts/media-share-domain.mjs         (DRY — chỉ xem quyền hiện có)
 *   node scripts/media-share-domain.mjs --go    (set thật)
 *   node scripts/media-share-domain.mjs --undo  (thu hồi quyền domain đã set)
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) process.env[m[1]] = m[2]; }
const GO = process.argv.includes("--go"), UNDO = process.argv.includes("--undo");
const DOMAIN = "aacorporation.com";
const ROOT = "1O9VktCpBENaZB1xgABr8MfIbl3YW8hFO", S = "supportsAllDrives=true&includeItemsFromAllDrives=true";
const FOLDER = "application/vnd.google-apps.folder";
const b = new URLSearchParams({ client_id: process.env.GDRIVE_OAUTH_CLIENT_ID, client_secret: process.env.GDRIVE_OAUTH_CLIENT_SECRET, refresh_token: process.env.GDRIVE_OAUTH_REFRESH, grant_type: "refresh_token" });
const tj = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: b })).json();
const H = { Authorization: "Bearer " + tj.access_token };
const ls = async (p) => ((await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${p}' in parents and trashed=false`)}&fields=files(id,name,mimeType)&pageSize=1000&${S}`, { headers: H })).json()).files || []);
const fc = async (p, n) => (await ls(p)).find((f) => f.name === n && f.mimeType === FOLDER);

let id = ROOT;
for (const s of ["DATABASE", "ePMP", "Media"]) { const f = await fc(id, s); if (!f) { console.log("KHÔNG thấy folder:", s); process.exit(1); } id = f.id; }
console.log("Folder Media:", id);

const perms = async () => ((await (await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions?fields=permissions(id,type,role,domain,emailAddress)&${S}`, { headers: H })).json()).permissions || []);
const before = await perms();
console.log("QUYỀN HIỆN CÓ:"); for (const p of before) console.log("  ", p.type, p.role, p.domain || p.emailAddress || "");

const mine = before.find((p) => p.type === "domain" && p.domain === DOMAIN);
if (UNDO) {
  if (!mine) { console.log("\nKhông có quyền domain nào để thu hồi."); process.exit(0); }
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions/${mine.id}?${S}`, { method: "DELETE", headers: H });
  console.log("\nTHU HỒI quyền domain:", r.status === 204 ? "xong" : await r.text());
  process.exit(0);
}
if (mine) { console.log(`\nĐÃ có quyền domain ${DOMAIN} (${mine.role}) — không làm gì thêm.`); process.exit(0); }
if (!GO) { console.log(`\n→ SẼ thêm: type=domain, domain=${DOMAIN}, role=reader. Thêm --go để làm thật.`); process.exit(0); }

const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions?${S}&sendNotificationEmail=false&fields=id,type,role,domain`, {
  method: "POST", headers: { ...H, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "domain", domain: DOMAIN, role: "reader" }),
});
const j = await res.json();
if (!res.ok) { console.log("\nLỖI:", res.status, JSON.stringify(j)); process.exit(1); }
console.log("\nĐÃ SET:", JSON.stringify(j));
console.log("QUYỀN SAU KHI SET:"); for (const p of await perms()) console.log("  ", p.type, p.role, p.domain || p.emailAddress || "");
