/** Seed 1 PDF MẪU vào Data Source › DATABASE › ePMP › Báo cáo tuân thủ để test đính kèm mail.
 *  Dựng PDF tối giản (tự tính xref → hợp lệ), upload qua Drive OAuth. Bản thật sẽ ghi đè khi admin bấm ☁. */
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2];
}
const ROOT = "1O9VktCpBENaZB1xgABr8MfIbl3YW8hFO";
const S = "supportsAllDrives=true&includeItemsFromAllDrives=true";
const H = (t) => ({ Authorization: "Bearer " + t });

async function token() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GDRIVE_OAUTH_CLIENT_ID, client_secret: env.GDRIVE_OAUTH_CLIENT_SECRET, refresh_token: env.GDRIVE_OAUTH_REFRESH, grant_type: "refresh_token" }),
  });
  return (await r.json()).access_token;
}
async function ensure(t, name, parent) {
  const q = `name='${name.replace(/'/g, "\\'")}' and '${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  let j = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&${S}`, { headers: H(t) })).json();
  if (j.files && j.files[0]) return j.files[0].id;
  j = await (await fetch(`https://www.googleapis.com/drive/v3/files?${S}&fields=id`, { method: "POST", headers: { ...H(t), "content-type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }) })).json();
  return j.id;
}

// ── Dựng PDF tối giản 1 trang có chữ (tự tính offset cho xref hợp lệ) ──
function buildPdf(lines) {
  const enc = new TextEncoder();
  const objs = [];
  objs.push("<</Type/Catalog/Pages 2 0 R>>");
  objs.push("<</Type/Pages/Kids[3 0 R]/Count 1>>");
  objs.push("<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>");
  let stream = "BT /F1 18 Tf 60 780 Td 22 TL\n";
  for (const ln of lines) stream += `(${ln.replace(/[()\\]/g, "\\$&")}) Tj T*\n`;
  stream += "ET";
  objs.push(`<</Length ${enc.encode(stream).length}>>\nstream\n${stream}\nendstream`);
  objs.push("<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>");

  let pdf = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((body, i) => { offs.push(enc.encode(pdf).length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xrefPos = enc.encode(pdf).length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) pdf += String(o).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF`;
  return enc.encode(pdf);
}

const t = await token();
const db = await ensure(t, "DATABASE", ROOT);
const app = await ensure(t, "ePMP", db);
const folder = await ensure(t, "Báo cáo tuân thủ", app);
console.log("Folder Báo cáo tuân thủ:", folder);

const bytes = buildPdf([
  "BAO CAO TUAN THU CAP NHAT MASTER PLAN - BAN TEST",
  "",
  "Day la file PDF MAU de kiem tra dinh kem email.",
  "Ban that se ghi de khi admin bam nut Cap nhat ban gui mail tren ePMP.",
]);
const NAME = "BaoCaoTuanThu_MP_TEST.pdf";
const boundary = "seed" + Date.now();
const encTE = new TextEncoder();
const meta = JSON.stringify({ name: NAME, parents: [folder] });
const pre = encTE.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`);
const post = encTE.encode(`\r\n--${boundary}--`);
const body = new Uint8Array(pre.length + bytes.length + post.length);
body.set(pre, 0); body.set(bytes, pre.length); body.set(post, pre.length + bytes.length);
const up = await (await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink&${S}`, {
  method: "POST", headers: { ...H(t), "content-type": `multipart/related; boundary=${boundary}` }, body,
})).json();
console.log("Đã upload:", JSON.stringify(up));
