/** Các trang HTML của luồng đăng nhập. Tách khỏi auth.ts để phần logic thuần tuý test
 *  được mà không dính chuỗi HTML. */

const SHELL = (title: string, accent: string, body: string) => `<!doctype html>
<html lang="vi"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · ePMP</title>
<style>
  *{box-sizing:border-box} body{margin:0;font-family:ui-sans-serif,system-ui,"Segoe UI",Roboto,sans-serif;
    background:#f1f5f9;color:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;max-width:460px;width:100%;
    box-shadow:0 1px 3px rgba(15,23,42,.08);overflow:hidden}
  .bar{height:4px;background:${accent}}
  .in{padding:26px 28px}
  .eyebrow{font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#0f766e;margin-bottom:6px}
  h1{margin:0 0 10px;font-size:17px;font-weight:800}
  p{margin:0 0 10px;font-size:13px;line-height:1.6;color:#475569}
  .mail{font-weight:700;color:#0f172a}
  .btn{display:inline-flex;align-items:center;gap:8px;margin-top:8px;background:#00786f;color:#fff;
    text-decoration:none;font-size:13px;font-weight:600;padding:9px 16px;border-radius:8px}
  .btn:hover{background:#065f5a}
  .foot{margin-top:16px;padding-top:12px;border-top:1px solid #f1f5f9;font-size:11px;color:#94a3b8}
</style></head>
<body><div class="card"><div class="bar"></div><div class="in">
  <div class="eyebrow">ePMP · Projects Master Plan</div>
  ${body}
  <div class="foot">OCC · Bộ phận Project Planning — AA Corporation</div>
</div></div></body></html>`;

/** Email hợp lệ với Google nhưng KHÔNG nằm trong danh sách được cấp quyền. */
export const deniedPage = (email: string, reason: string) =>
  SHELL("Không có quyền", "#dc2626", `
  <h1>Tài khoản chưa được cấp quyền</h1>
  <p>Bạn đang đăng nhập bằng <span class="mail">${escapeHtml(email)}</span>.</p>
  <p>${escapeHtml(reason)}</p>
  <p>Nếu bạn cần xem báo cáo này, liên hệ OCC để được thêm vào danh sách.</p>
  <a class="btn" href="/auth/logout">Đăng nhập bằng tài khoản khác</a>`);

/** Lỗi trong luồng OAuth (sai cấu hình, Google từ chối, state không khớp…). */
export const authErrorPage = (message: string) =>
  SHELL("Lỗi đăng nhập", "#dc2626", `
  <h1>Không đăng nhập được</h1>
  <p>${escapeHtml(message)}</p>
  <a class="btn" href="/auth/login">Thử lại</a>`);

/** Thiếu biến môi trường trên production. CỐ Ý chặn hết thay vì cho qua: quên cấu hình
 *  mà app vẫn mở thì nguy hơn hẳn, vì mọi người tưởng đã khoá. */
export const notConfiguredPage = () =>
  SHELL("Chưa cấu hình", "#f59e0b", `
  <h1>Chưa cấu hình đăng nhập</h1>
  <p>Ứng dụng chưa được nạp <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>
     hoặc <code>SESSION_SECRET</code>.</p>
  <p>Truy cập bị chặn cho tới khi cấu hình xong. Liên hệ OCC.</p>`);

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
