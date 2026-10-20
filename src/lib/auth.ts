/**
 * ĐĂNG NHẬP BẰNG GOOGLE — cổng chặn của ePMP.
 *
 * Vì sao tự làm thay vì dùng Cloudflare Access: Access bắt gắn thẻ tín dụng vào tài khoản
 * Cloudflare của công ty (PMO chốt 17/07/2026 là không làm vậy). Không có cách nào vừa
 * không thẻ vừa không viết code.
 *
 * Chốt chặn đặt ở src/server.ts — MỌI request của Worker đều đi qua đó, nên không có
 * đường vòng nào lọt qua được (trang SSR, server function, ghi/đọc KV).
 *
 * PHẠM VI BẢO VỆ — nói rõ để không ai hiểu nhầm:
 *   ✔ Trang dashboard, mọi server function, toàn bộ ghi chú PM nhập trong KV.
 *   ✘ File tĩnh /assets/*.js — Cloudflare phục vụ thẳng, KHÔNG qua Worker. Bundle đó có
 *     chứa link Google Sheet. PMO đã biết và chấp nhận (sheet vốn đang chia sẻ công khai,
 *     ai có link là đọc được dù có đăng nhập app hay không). Muốn bịt luôn thì thêm
 *     `run_worker_first: true` vào assets trong scripts/patch-wrangler.cjs VÀ tự phục vụ
 *     asset qua env.ASSETS — chưa làm vì chưa cần theo mức rủi ro PMO chấp nhận.
 *
 * Luồng chuẩn OAuth 2.0 Authorization Code:
 *   /auth/login    → đẩy sang Google (kèm `state` chống CSRF)
 *   /auth/callback → đổi code lấy token TRỰC TIẾP với Google (server-to-server, có client
 *                    secret) → kiểm iss/aud/exp/email_verified → đối chiếu danh sách trong
 *                    KV → phát cookie phiên
 *   /auth/logout   → xoá cookie
 */

export const SESSION_COOKIE = "epmp_session";
export const STATE_COOKIE = "epmp_oauth_state";
/** Phiên sống 12 tiếng — đủ một ngày làm việc, hết ngày phải đăng nhập lại. */
export const SESSION_TTL_SEC = 12 * 60 * 60;
/** Khoá KV chứa danh sách email được phép. Sửa danh sách KHÔNG cần deploy lại. */
export const ALLOWLIST_KEY = "auth:allow:v1";

export type Session = { email: string; name: string; exp: number };

type KVLike = {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string) => Promise<void>;
};

export type AuthEnv = {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  /** Giới hạn thêm theo domain Workspace. Rỗng = không xét domain, chỉ xét danh sách. */
  ALLOWED_HD?: string;
  PMO_EDITS?: KVLike;
  /** CHÌA RIÊNG CHO MÁY — chuỗi bí mật để warmer tự mở app thứ Tư 20:00 mà bấm nút
   *  "Cập nhật bản gửi mail". Xem ROBOT_EMAIL và nhánh robot trong auth-gate.ts.
   *  KHÔNG đặt = không có đường nào vào app bằng chìa này. */
  RENDER_TOKEN?: string;
  /** CHÌA RIÊNG CHO AGENT NGOÀI — cửa /may/bao-cao, chỉ ĐỌC. Tách hẳn khỏi RENDER_TOKEN để thu
   *  hồi được mà không gãy warmer và cửa dựng PDF. KHÔNG đặt = cửa tự đóng. */
  AGENT_TOKEN?: string;
};

/** DANH TÍNH CỦA MÁY khi nó tự bấm "Cập nhật bản gửi mail".
 *
 *  Để một email RIÊNG, không mượn email người thật: nhật ký giám sát ghi đúng là máy làm, và
 *  muốn rà lại việc gì do máy làm thì lọc đúng một chuỗi này. Email này KHÔNG có vai trong
 *  roles:v1 — nó chỉ được phép gọi đúng saveComplianceReportPdf, xem chốt quyền ở đó. */
export const ROBOT_EMAIL = "robot-tuanthu@aacorporation.com";

/** So hai chuỗi bí mật mà KHÔNG để lộ qua thời gian so sánh (tránh dò từng ký tự). */
export function bangNhauAnToan(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

/* ───────────────────────── base64url ───────────────────────── */

function b64uEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** Cấp phát trên ArrayBuffer tường minh: mặc định `new Uint8Array(n)` mang kiểu
 *  ArrayBufferLike (có thể là SharedArrayBuffer), mà WebCrypto chỉ nhận ArrayBuffer. */
function b64uDecode(str: string): Uint8Array<ArrayBuffer> {
  const pad = str.length % 4 ? "=".repeat(4 - (str.length % 4)) : "";
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const te = new TextEncoder();

/* ───────────────────────── ký / mở cookie phiên ───────────────────────── */

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", te.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** Cookie phiên = base64url(JSON) + "." + base64url(HMAC-SHA256). Người dùng KHÔNG sửa
 *  được nội dung (đổi email trong cookie là chữ ký sai ⇒ bị loại). */
export async function signSession(session: Session, secret: string): Promise<string> {
  const body = b64uEncode(te.encode(JSON.stringify(session)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), te.encode(body));
  return `${body}.${b64uEncode(new Uint8Array(sig))}`;
}

export async function verifySession(token: string | null | undefined, secret: string): Promise<Session | null> {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), b64uDecode(sig), te.encode(body));
  } catch {
    return null;
  }
  if (!ok) return null; // chữ ký sai → cookie bị sửa hoặc secret đã đổi
  try {
    const s = JSON.parse(new TextDecoder().decode(b64uDecode(body))) as Session;
    if (!s?.email || typeof s.exp !== "number") return null;
    if (s.exp <= Math.floor(Date.now() / 1000)) return null; // hết hạn
    return s;
  } catch {
    return null;
  }
}

/* ───────────────────────── cookie helpers ───────────────────────── */

export function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** `Secure` chỉ gắn khi chạy HTTPS: localhost là http, gắn Secure vào là trình duyệt bỏ
 *  cookie ⇒ đăng nhập ở máy dev quay vòng vô tận. */
export function cookieHeader(name: string, value: string, maxAgeSec: number, isHttps: boolean): string {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",                 // JS trong trang không đọc được ⇒ XSS không cuỗm được phiên
    "SameSite=Lax",             // Lax (không phải Strict): Strict thì cookie không được gửi
                                // khi Google redirect ngược về ⇒ callback luôn thất bại
    `Max-Age=${maxAgeSec}`,
  ];
  if (isHttps) bits.push("Secure");
  return bits.join("; ");
}

/* ───────────────────────── danh sách được phép ───────────────────────── */

/** Đọc danh sách email từ KV. Trả `null` khi KHÔNG đọc được (chưa seed, KV lỗi…).
 *  Phân biệt null với mảng rỗng là CỐ Ý: null ⇒ chưa cấu hình ⇒ nơi gọi phải TỪ CHỐI
 *  tất cả (fail-closed), chứ không được hiểu thành "không giới hạn". */
export async function readAllowlist(env: AuthEnv): Promise<string[] | null> {
  if (!env.PMO_EDITS) return null;
  try {
    const raw = await env.PMO_EDITS.get(ALLOWLIST_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    return arr.map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  } catch {
    return null;
  }
}

export type AccessDecision = { ok: true } | { ok: false; reason: string };

/** Dấu MỞ THEO DOMAIN: danh sách chứa phần tử này ⇒ bất kỳ ai có email thuộc domain
 *  công ty (ALLOWED_HD) đều vào được, không cần liệt kê từng người.
 *  Đặt trong KV nên đổi qua lại giữa 2 chế độ chỉ là sửa 1 giá trị, KHÔNG cần deploy:
 *    ["*"]                          → mở cho cả @aacorporation.com
 *    ["a@...","b@..."]              → chỉ 5 người cụ thể
 *    ["*","ngoai@gmail.com"]        → cả domain + vài ngoại lệ ngoài domain */
export const DOMAIN_WILDCARD = "*";

/** Quyết định cho vào hay không. Tách riêng khỏi phần HTTP để test được độc lập. */
export function decideAccess(email: string, hd: string | undefined, allow: string[] | null, allowedHd?: string): AccessDecision {
  const e = email.trim().toLowerCase();
  if (!e) return { ok: false, reason: "Không đọc được email từ Google." };
  // Chưa seed danh sách → CHẶN HẾT. Tuyệt đối không được mặc định "cho qua": quên seed
  // mà lại mở toang thì còn tệ hơn không có đăng nhập, vì ai cũng tưởng đã khoá.
  if (!allow) return { ok: false, reason: "Danh sách người dùng chưa được cấu hình. Liên hệ OCC." };

  const dom = allowedHd?.trim().toLowerCase();

  // Chế độ MỞ THEO DOMAIN.
  if (allow.includes(DOMAIN_WILDCARD)) {
    // "*" mà KHÔNG có domain nào để giới hạn = mở cho cả internet → chặn (fail-closed).
    // Bắt buộc phải cấu hình ALLOWED_HD mới cho dùng "*".
    if (!dom) return { ok: false, reason: "Chưa cấu hình domain công ty (ALLOWED_HD)." };
    // email đã được Google xác minh (email_verified) và KHÔNG thể giả — không ai lập được
    // tài khoản Google có đuôi @aacorporation.com trừ khi công ty (chủ Workspace) cấp.
    const emailThuocDomain = e.endsWith("@" + dom);
    // hd (nếu Google có gửi) phải khớp; tài khoản Workspace luôn có hd, Gmail thường thì không.
    const hdKhop = !hd || hd.trim().toLowerCase() === dom;
    if (emailThuocDomain && hdKhop) return { ok: true };
    // Vẫn cho ngoại lệ: email cụ thể ngoài domain nhưng có trong danh sách.
    if (allow.includes(e)) return { ok: true };
    return { ok: false, reason: `Chỉ tài khoản @${dom} mới được vào ePMP.` };
  }

  // Chế độ DANH SÁCH CỤ THỂ (+ siết domain nếu có cấu hình ALLOWED_HD).
  if (dom && hd?.trim().toLowerCase() !== dom) {
    return { ok: false, reason: `Tài khoản phải thuộc ${dom}.` };
  }
  if (!allow.includes(e)) return { ok: false, reason: `${email} chưa được cấp quyền vào ePMP.` };
  return { ok: true };
}

/* ───────────────────────── Google OAuth ───────────────────────── */

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";

export function redirectUriOf(url: URL): string {
  return `${url.origin}/auth/callback`;
}

export function buildAuthUrl(url: URL, clientId: string, state: string, allowedHd?: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUriOf(url),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  // KHÔNG gắn `hd`: dù Google nói `hd` chỉ là gợi ý, thực tế nó CHẶN CỨNG tài khoản ngoài domain
  // ngay ở màn chọn tài khoản → các NGOẠI LỆ ngoài domain (gmail trong allowlist) không đăng nhập được.
  // Chốt bảo mật thật nằm ở decideAccess() phía server (chỉ @domain + email ngoại lệ trong danh sách),
  // nên bỏ `hd` KHÔNG làm hở quyền — chỉ để màn chọn tài khoản hiện đủ mọi tài khoản Google.
  void allowedHd;
  return `${GOOGLE_AUTH}?${p.toString()}`;
}

export type GoogleIdentity = { email: string; name: string; hd?: string };

/** Đổi authorization code lấy id_token, NÓI CHUYỆN THẲNG với Google (server-to-server,
 *  HTTPS, có client secret). Google nói rõ trong tài liệu OpenID Connect: token nhận theo
 *  đường này chắc chắn là của Google nên KHÔNG bắt buộc verify chữ ký. Dù vậy vẫn kiểm
 *  iss/aud/exp/email_verified bên dưới — rẻ, và chặn được ca cấu hình sai client_id. */
export async function exchangeCode(code: string, url: URL, env: AuthEnv): Promise<GoogleIdentity> {
  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUriOf(url),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google từ chối đổi mã (HTTP ${res.status}). Kiểm tra Client ID/Secret và Redirect URI.`);
  }
  const data = (await res.json()) as { id_token?: string };
  if (!data.id_token) throw new Error("Google không trả id_token.");

  const parts = data.id_token.split(".");
  if (parts.length !== 3) throw new Error("id_token sai định dạng.");
  const claims = JSON.parse(new TextDecoder().decode(b64uDecode(parts[1]))) as Record<string, unknown>;

  const iss = String(claims.iss ?? "");
  if (iss !== "https://accounts.google.com" && iss !== "accounts.google.com") {
    throw new Error("id_token không do Google phát hành.");
  }
  if (String(claims.aud ?? "") !== env.GOOGLE_CLIENT_ID) throw new Error("id_token không dành cho ứng dụng này.");
  if (Number(claims.exp ?? 0) <= Math.floor(Date.now() / 1000)) throw new Error("id_token đã hết hạn.");
  if (claims.email_verified === false) throw new Error("Email chưa được Google xác minh.");

  return {
    email: String(claims.email ?? ""),
    name: String(claims.name ?? claims.email ?? ""),
    hd: claims.hd ? String(claims.hd) : undefined,
  };
}
