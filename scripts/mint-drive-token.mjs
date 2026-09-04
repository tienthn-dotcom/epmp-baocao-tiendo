/**
 * LẤY GOOGLE DRIVE REFRESH TOKEN (chạy 1 lần, trên máy anh).
 * Không ghi bí mật ra file — chỉ IN refresh token ra màn hình để anh copy vào .env.
 *
 * CÁCH DÙNG (trong thư mục dự án):
 *   1) Vào Google Cloud Console → OAuth client (Web) → thêm Authorized redirect URI:
 *        http://localhost:5858/oauth2callback
 *   2) Chạy 1 trong 2:
 *        node scripts/mint-drive-token.mjs path\to\oauth-client.json
 *      hoặc đặt sẵn GDRIVE_OAUTH_CLIENT_ID / GDRIVE_OAUTH_CLIENT_SECRET trong .env rồi:
 *        node scripts/mint-drive-token.mjs
 *   3) Mở URL script in ra → đăng nhập TÀI KHOẢN SỞ HỮU FOLDER → Cho phép.
 *   4) Script in "GDRIVE_OAUTH_REFRESH=..." → dán cả 3 dòng (CLIENT_ID/SECRET/REFRESH) vào .env.
 */
import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";

/** Ghi 3 biến GDRIVE_OAUTH_* vào .env, GIỮ NGUYÊN các dòng khác. */
function writeEnv(vars) {
  let lines = [];
  try { lines = readFileSync(".env", "utf8").split(/\r?\n/); } catch { /* chưa có .env */ }
  const keep = lines.filter((l) => l.trim() && !/^\s*GDRIVE_OAUTH_(CLIENT_ID|CLIENT_SECRET|REFRESH)\s*=/.test(l));
  const out = [...keep, `GDRIVE_OAUTH_CLIENT_ID=${vars.id}`, `GDRIVE_OAUTH_CLIENT_SECRET=${vars.secret}`, `GDRIVE_OAUTH_REFRESH=${vars.refresh}`];
  writeFileSync(".env", out.join("\n") + "\n", "utf8");
}

const PORT = Number(process.env.PORT) || 5858;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
const SCOPE = "https://www.googleapis.com/auth/drive";

// —— Lấy client_id / client_secret: từ file JSON (arg) hoặc từ .env ——
function loadCreds() {
  const arg = process.argv[2];
  if (arg) {
    const raw = JSON.parse(readFileSync(arg, "utf8"));
    const w = raw.web || raw.installed || raw;
    if (!w.client_id || !w.client_secret) throw new Error("File JSON thiếu client_id/client_secret.");
    return { id: w.client_id, secret: w.client_secret };
  }
  // đọc .env thủ công (không cần thư viện)
  let env = {};
  try {
    for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) env[m[1]] = m[2];
    }
  } catch { /* không có .env */ }
  const id = env.GDRIVE_OAUTH_CLIENT_ID || process.env.GDRIVE_OAUTH_CLIENT_ID;
  const secret = env.GDRIVE_OAUTH_CLIENT_SECRET || process.env.GDRIVE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Không thấy client_id/secret. Truyền file JSON làm tham số, hoặc đặt GDRIVE_OAUTH_CLIENT_ID/_SECRET trong .env.");
  return { id, secret };
}

const { id, secret } = loadCreds();

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: id,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  });

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname !== "/oauth2callback") { res.writeHead(404); res.end("not found"); return; }
  const code = u.searchParams.get("code");
  const err = u.searchParams.get("error");
  if (err) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(`<h2>Lỗi: ${err}</h2>`); console.error("Google trả lỗi:", err); server.close(); return; }
  if (!code) { res.writeHead(400); res.end("thiếu code"); return; }
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id, client_secret: secret, code, grant_type: "authorization_code", redirect_uri: REDIRECT }),
    });
    const j = await r.json();
    if (!j.refresh_token) throw new Error("Không có refresh_token trong phản hồi: " + JSON.stringify(j));
    writeEnv({ id, secret, refresh: j.refresh_token });
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<h2>Xong! Đã ghi refresh token vào .env. Có thể đóng tab này.</h2>");
    console.log("\n✅ Đã ghi GDRIVE_OAUTH_CLIENT_ID / _SECRET / _REFRESH vào .env.\n");
  } catch (e) {
    res.writeHead(500); res.end("lỗi đổi token, xem console");
    console.error("Đổi token thất bại:", e.message);
  } finally { setTimeout(() => server.close(), 500); }
});

server.listen(PORT, () => {
  console.log(`\nĐang chờ ở ${REDIRECT}`);
  console.log("\n1) Đảm bảo redirect URI trên đã được thêm vào OAuth client trong Google Console.");
  console.log("2) Mở URL sau trong trình duyệt, đăng nhập TÀI KHOẢN SỞ HỮU FOLDER, bấm Cho phép:\n");
  console.log(String(authUrl) + "\n");
});
