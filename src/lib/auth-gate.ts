/**
 * CỔNG CHẶN — gọi từ src/server.ts trước khi request chạm vào ứng dụng.
 *
 * Trả `null` = cho đi tiếp. Trả `Response` = chặn lại (redirect / trang lỗi).
 *
 * Vì sao đặt ở tầng Worker chứ không phải trong React: mọi thứ chạy trên Worker đều đi
 * qua đây — trang SSR, server function (đọc/ghi KV), tất cả. Chặn trong React thì server
 * function vẫn gọi thẳng được, coi như không khoá.
 */
import {
  SESSION_COOKIE, STATE_COOKIE, SESSION_TTL_SEC,
  type AuthEnv, buildAuthUrl, cookieHeader, decideAccess, exchangeCode,
  readAllowlist, readCookie, signSession, verifySession,
} from "./auth";
import { authErrorPage, deniedPage, notConfiguredPage } from "./auth-pages";

/** Lấy env THẬT của Cloudflare.
 *
 *  CẠM BẪY: entry thật của Worker là index.mjs do Nitro sinh, KHÔNG phải src/server.ts.
 *  Nitro làm:  fetch(request, env, ctx) { globalThis.__env__ = env; ... nitroApp.fetch(request) }
 *  — tức nó nuốt `env` vào global rồi gọi tiếp CHỈ với `request`. Nên tham số `env` mà
 *  src/server.ts nhận được là RỖNG, và mọi biến/secret đọc qua nó đều undefined.
 *  Đây đúng là lý do lib/edits.functions.ts cũng phải dò __env__ để lấy KV binding.
 *  Vẫn nhận tham số `env` làm ưu tiên 1, phòng khi Nitro đổi cách nối dây sau này. */
export function resolveEnv(passed: unknown): AuthEnv {
  const p = (passed ?? {}) as Record<string, unknown>;
  if (p.GOOGLE_CLIENT_ID || p.SESSION_SECRET || p.PMO_EDITS) return p as AuthEnv;
  const g = globalThis as unknown as Record<string, unknown>;
  return ((g.__env__ ?? g.__cf_env__ ?? p) as AuthEnv) ?? ({} as AuthEnv);
}

const isHttps = (url: URL) => url.protocol === "https:";

function redirect(to: string, extraCookies: string[] = []): Response {
  const h = new Headers({ location: to });
  for (const c of extraCookies) h.append("set-cookie", c);
  return new Response(null, { status: 302, headers: h });
}
function html(body: string, status: number, extraCookies: string[] = []): Response {
  const h = new Headers({ "content-type": "text/html; charset=utf-8" });
  for (const c of extraCookies) h.append("set-cookie", c);
  return new Response(body, { status, headers: h });
}
const kill = (name: string, url: URL) => cookieHeader(name, "", 0, isHttps(url));

export async function authGate(request: Request, envIn: unknown): Promise<Response | null> {
  const url = new URL(request.url);
  const env = resolveEnv(envIn);
  const configured = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET);

  if (!configured) {
    // Chưa có secret = hoặc bản DEV (vite, không nạp secret), hoặc bản PROD cấu hình thiếu.
    //  · DEV build (import.meta.env.DEV = true) → MỞ HẲN, không auth: để vừa phát triển vừa
    //    chia sẻ xem thử qua tunnel/LAN (không chỉ localhost). URL tunnel là ngẫu nhiên, tạm,
    //    do chính người chạy phát cho ai xem.
    //  · PROD build thiếu secret → CHẶN HẾT (503, fail-closed) như cũ, tránh lỡ mở toang.
    // An toàn kép: prod luôn CÓ secret ⇒ rơi vào nhánh `configured` bên dưới (bắt đăng nhập),
    // KHÔNG bao giờ chạm nhánh này; vite thay import.meta.env.DEV = false khi build prod.
    if (import.meta.env.DEV) return null;
    return html(notConfiguredPage(), 503);
  }
  const secret = env.SESSION_SECRET!;

  /* ── /auth/logout ── */
  if (url.pathname === "/auth/logout") {
    return redirect("/auth/login", [kill(SESSION_COOKIE, url), kill(STATE_COOKIE, url)]);
  }

  /* ── /auth/login: sinh state chống CSRF rồi đẩy sang Google ── */
  if (url.pathname === "/auth/login") {
    const next = url.searchParams.get("next") || "/";
    // state = chuỗi ngẫu nhiên + đường quay về, ký kèm để không bị sửa.
    const nonce = crypto.randomUUID();
    const state = await signSession({ email: nonce, name: next, exp: Math.floor(Date.now() / 1000) + 600 }, secret);
    return redirect(buildAuthUrl(url, env.GOOGLE_CLIENT_ID!, state, env.ALLOWED_HD), [
      cookieHeader(STATE_COOKIE, state, 600, isHttps(url)),
    ]);
  }

  /* ── /auth/callback: Google gọi ngược về ── */
  if (url.pathname === "/auth/callback") {
    const err = url.searchParams.get("error");
    if (err) return html(authErrorPage(`Google trả lỗi: ${err}`), 400, [kill(STATE_COOKIE, url)]);

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return html(authErrorPage("Thiếu mã xác thực từ Google."), 400, [kill(STATE_COOKIE, url)]);

    // Chống CSRF: state trên URL phải TRÙNG state trong cookie, và phải còn chữ ký hợp lệ.
    // Thiếu bước này thì kẻ khác ép được người dùng đăng nhập vào tài khoản của chúng.
    const cookieState = readCookie(request, STATE_COOKIE);
    if (!cookieState || cookieState !== state) {
      return html(authErrorPage("Phiên đăng nhập không khớp. Hãy thử lại từ đầu."), 400, [kill(STATE_COOKIE, url)]);
    }
    const parsed = await verifySession(state, secret);
    if (!parsed) return html(authErrorPage("Phiên đăng nhập đã hết hạn. Hãy thử lại."), 400, [kill(STATE_COOKIE, url)]);

    let who;
    try {
      who = await exchangeCode(code, url, env);
    } catch (e) {
      return html(authErrorPage((e as Error).message), 400, [kill(STATE_COOKIE, url)]);
    }

    const allow = await readAllowlist(env);
    const verdict = decideAccess(who.email, who.hd, allow, env.ALLOWED_HD);
    if (!verdict.ok) {
      // Đã xác thực được là ai, nhưng KHÔNG có quyền → 403 và nói rõ lý do, đừng để người
      // dùng loay hoay không biết mình sai ở đâu.
      return html(deniedPage(who.email, verdict.reason), 403, [kill(STATE_COOKIE, url)]);
    }

    const session = { email: who.email, name: who.name, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC };
    const token = await signSession(session, secret);
    const next = parsed.name && parsed.name.startsWith("/") ? parsed.name : "/"; // chỉ nhận đường DẪN NỘI BỘ
    return redirect(next, [
      cookieHeader(SESSION_COOKIE, token, SESSION_TTL_SEC, isHttps(url)),
      kill(STATE_COOKIE, url),
    ]);
  }

  /* ── Mọi đường khác: bắt buộc có phiên hợp lệ ── */
  const session = await verifySession(readCookie(request, SESSION_COOKIE), secret);
  if (session) return null;

  // Server function (POST/fetch) mà hết phiên → trả 401 thay vì redirect, để phía client
  // biết đường báo "hết phiên" chứ không nhận về nguyên trang HTML của Google rồi vỡ parse.
  const wantsHtml = (request.headers.get("accept") || "").includes("text/html");
  if (!wantsHtml || request.method !== "GET") {
    return new Response(JSON.stringify({ error: "unauthenticated", message: "Phiên đã hết hạn. Tải lại trang để đăng nhập." }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  return redirect(`/auth/login?next=${encodeURIComponent(url.pathname + url.search)}`);
}
