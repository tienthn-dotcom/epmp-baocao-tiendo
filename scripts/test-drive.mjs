/** Test end-to-end Drive OAuth: đọc .env → access token → đọc folder gốc → tạo thư mục thử →
 *  upload 1 file text nhỏ → list → XOÁ sạch (folder + file). In kết quả, KHÔNG in secret. */
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2];
}
const ID = env.GDRIVE_OAUTH_CLIENT_ID, SEC = env.GDRIVE_OAUTH_CLIENT_SECRET, REF = env.GDRIVE_OAUTH_REFRESH;
const ROOT = env.GDRIVE_ROOT || "1O9VktCpBENaZB1xgABr8MfIbl3YW8hFO";
const SHARED = "supportsAllDrives=true&includeItemsFromAllDrives=true";

async function token() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: ID, client_secret: SEC, refresh_token: REF, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("token lỗi: " + JSON.stringify(j));
  return j.access_token;
}
const H = (t) => ({ Authorization: `Bearer ${t}` });

const t = await token();
console.log("1) access token: OK");

// đọc folder gốc
let r = await fetch(`https://www.googleapis.com/drive/v3/files/${ROOT}?fields=id,name,owners(emailAddress)&${SHARED}`, { headers: H(t) });
let j = await r.json();
if (!j.id) { console.error("2) đọc folder gốc THẤT BẠI:", JSON.stringify(j)); process.exit(1); }
console.log(`2) folder gốc: "${j.name}" (chủ: ${j.owners?.[0]?.emailAddress || "?"})`);

// tạo thư mục thử
r = await fetch(`https://www.googleapis.com/drive/v3/files?${SHARED}&fields=id`, {
  method: "POST", headers: { ...H(t), "content-type": "application/json" },
  body: JSON.stringify({ name: "__pmo_test__", mimeType: "application/vnd.google-apps.folder", parents: [ROOT] }),
});
j = await r.json();
if (!j.id) { console.error("3) tạo thư mục THẤT BẠI:", JSON.stringify(j)); process.exit(1); }
const folder = j.id;
console.log("3) tạo thư mục con: OK");

// upload 1 file text nhỏ (multipart)
const boundary = "test" + Date.now();
const meta = JSON.stringify({ name: "hello.txt", parents: [folder] });
const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: text/plain\r\n\r\nxin chao PMO\r\n--${boundary}--`;
r = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&${SHARED}`, {
  method: "POST", headers: { ...H(t), "content-type": `multipart/related; boundary=${boundary}` }, body,
});
j = await r.json();
if (!j.id) { console.error("4) UPLOAD THẤT BẠI:", JSON.stringify(j)); process.exit(1); }
const fileId = j.id;
console.log("4) upload file: OK →", j.webViewLink);

// list
r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folder}' in parents and trashed=false`)}&fields=files(name)&${SHARED}`, { headers: H(t) });
j = await r.json();
console.log("5) list trong thư mục:", (j.files || []).map((f) => f.name).join(", "));

// dọn sạch: xoá file + folder (xoá hẳn cho gọn)
await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?${SHARED}`, { method: "DELETE", headers: H(t) });
await fetch(`https://www.googleapis.com/drive/v3/files/${folder}?${SHARED}`, { method: "DELETE", headers: H(t) });
console.log("6) dọn sạch (xoá file + thư mục thử): OK");
console.log("\n✅ DRIVE OK TOÀN TẬP — đọc + tạo thư mục + upload + list + xoá đều chạy.");
