/** Test UPSERT (driveSaveReport): tạo thư mục thử → upload file theo tên → GHI ĐÈ cùng tên (PATCH media)
 *  → list phải còn ĐÚNG 1 file, nội dung = bản mới → dọn sạch. Chứng minh logic upsert không phình folder. */
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2];
}
const ID = env.GDRIVE_OAUTH_CLIENT_ID, SEC = env.GDRIVE_OAUTH_CLIENT_SECRET, REF = env.GDRIVE_OAUTH_REFRESH;
const ROOT = env.GDRIVE_ROOT || "1O9VktCpBENaZB1xgABr8MfIbl3YW8hFO";
const SHARED = "supportsAllDrives=true&includeItemsFromAllDrives=true";
const H = (t) => ({ Authorization: `Bearer ${t}` });

async function token() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: ID, client_secret: SEC, refresh_token: REF, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("token lỗi: " + JSON.stringify(j));
  return j.access_token;
}
async function uploadMultipart(t, folder, name, mime, text) {
  const b = "test" + Date.now();
  const meta = JSON.stringify({ name, parents: [folder] });
  const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n${text}\r\n--${b}--`;
  const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&${SHARED}`, {
    method: "POST", headers: { ...H(t), "content-type": `multipart/related; boundary=${b}` }, body,
  });
  return (await r.json()).id;
}
async function findByName(t, folder, name) {
  const q = `name='${name}' and '${folder}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&${SHARED}`, { headers: H(t) });
  return (await r.json()).files?.[0]?.id || "";
}
async function updateMedia(t, fileId, mime, text) {
  const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id&${SHARED}`, {
    method: "PATCH", headers: { ...H(t), "content-type": mime }, body: text,
  });
  return (await r.json()).id;
}

const t = await token();
console.log("1) access token: OK");

// thư mục thử
let r = await fetch(`https://www.googleapis.com/drive/v3/files?${SHARED}&fields=id`, {
  method: "POST", headers: { ...H(t), "content-type": "application/json" },
  body: JSON.stringify({ name: "__pmo_test_report__", mimeType: "application/vnd.google-apps.folder", parents: [ROOT] }),
});
const folder = (await r.json()).id;
console.log("2) thư mục thử: OK");

const NAME = "BaoCaoTuanThu_MP_test.pdf";
const id1 = await uploadMultipart(t, folder, NAME, "application/pdf", "PDF-BAN-1");
console.log("3) upload lần 1:", id1 ? "OK" : "LỖI");

// UPSERT: tìm theo tên → có → ghi đè media
const found = await findByName(t, folder, NAME);
if (found !== id1) { console.error("4) findByName SAI: mong", id1, "nhận", found); process.exit(1); }
const id2 = await updateMedia(t, found, "application/pdf", "PDF-BAN-2-GHI-DE");
console.log("4) ghi đè cùng id:", id2 === id1 ? "OK (giữ nguyên id)" : `LỖI (id đổi ${id1}→${id2})`);

// list: phải còn ĐÚNG 1 file
r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folder}' in parents and trashed=false`)}&fields=files(id,name)&${SHARED}`, { headers: H(t) });
const files = (await r.json()).files || [];
console.log("5) số file trong thư mục:", files.length, files.length === 1 ? "→ ĐÚNG (upsert không phình)" : "→ SAI");

// đọc nội dung: phải là bản 2
r = await fetch(`https://www.googleapis.com/drive/v3/files/${id1}?alt=media&${SHARED}`, { headers: H(t) });
const content = await r.text();
console.log("6) nội dung:", content === "PDF-BAN-2-GHI-DE" ? "OK (đã là bản mới)" : `SAI ("${content}")`);

// dọn
await fetch(`https://www.googleapis.com/drive/v3/files/${folder}?${SHARED}`, { method: "DELETE", headers: H(t) });
console.log("7) dọn sạch: OK");

const pass = found === id1 && id2 === id1 && files.length === 1 && content === "PDF-BAN-2-GHI-DE";
console.log(pass ? "\n✅ UPSERT OK: cùng tên → ghi đè, folder không phình, nội dung mới." : "\n❌ CÓ BƯỚC SAI — xem trên.");
process.exit(pass ? 0 : 1);
