// Nitro tự sinh .output/server/wrangler.json mỗi lần build và KHÔNG biết tới KV binding
// hay biến môi trường — script này chèn vào sau build, trước khi deploy.
// Chạy qua: npm run deploy  (build → patch → wrangler deploy)
const fs = require("node:fs");
const path = require("node:path");

const WRANGLER = path.join(__dirname, "..", ".output", "server", "wrangler.json");
const KV_BINDING = { binding: "PMO_EDITS", id: "2bdbce7b49014e538ee3156728ab9548" };

// D1 (SQLite) chứa NHẬT KÝ GIÁM SÁT (bảng access_log). Bảng tự tạo ở lần ghi đầu
// (activity.functions.ts → ensureD1), không cần migration thủ công.
// CÁCH LẤY id: chạy `npx wrangler d1 create pmo-audit` MỘT LẦN → dán database_id vào đây.
// Để trống ⇒ KHÔNG gắn binding: nhật ký sẽ RỖNG trên live nhưng app vẫn chạy bình thường
// (mọi thao tác ghi/đọc log được bọc try/catch, hỏng không ảnh hưởng người dùng).
const D1_LOG = { binding: "PMO_LOG", database_name: "pmo-audit", database_id: "ea3aca84-e754-44fb-947f-ca442b3f7b19" };

// Biến CÔNG KHAI — để ở đây (không phải secret) vì chúng vốn không bí mật:
//  • GOOGLE_CLIENT_ID hiện nguyên trên thanh địa chỉ mỗi lần chuyển sang Google đăng nhập.
//  • ALLOWED_HD chỉ là tên miền công ty.
// Hai thứ THẬT SỰ bí mật (GOOGLE_CLIENT_SECRET, SESSION_SECRET) nạp bằng
// `wrangler secret put` và KHÔNG BAO GIỜ được nằm trong repo.
const VARS = {
  GOOGLE_CLIENT_ID: "40832479653-knnhdr2qmg6ajauk5egmi8ngpo3k9pln.apps.googleusercontent.com",
  ALLOWED_HD: "aacorporation.com",
};

const cfg = JSON.parse(fs.readFileSync(WRANGLER, "utf8"));
// ÉP TÊN WORKER = worker LIVE thật. Từ khi thêm git remote (github), Nitro tự đặt tên worker theo
// tên repo (tienthn-dotcom-epmp-baocao-tiendo) → deploy NHẦM sang worker mới, URL live cũ không cập
// nhật. Ghim cứng để mọi deploy luôn trúng đúng worker/URL đang chạy.
cfg.name = "baocao-tiendo-pmo";
// GỠ cờ nodejs_compat: từ 2026-08-04 Cloudflare đặt nó làm MẶC ĐỊNH và TỪ CHỐI khi khai báo tường
// minh (lỗi validation 10021). Nitro vẫn tự thêm cờ này → phải lọc bỏ trước khi deploy. nodejs_compat
// vẫn hoạt động (mặc định), nên gỡ khai báo KHÔNG ảnh hưởng runtime.
if (Array.isArray(cfg.compatibility_flags)) {
  cfg.compatibility_flags = cfg.compatibility_flags.filter((f) => f !== "nodejs_compat");
  if (cfg.compatibility_flags.length === 0) delete cfg.compatibility_flags;
}
cfg.kv_namespaces = [KV_BINDING];
cfg.vars = { ...(cfg.vars ?? {}), ...VARS };
// Chỉ gắn D1 khi đã có database_id — tránh deploy hỏng vì binding trỏ vào id rỗng.
if (D1_LOG.database_id) cfg.d1_databases = [D1_LOG];
fs.writeFileSync(WRANGLER, JSON.stringify(cfg, null, 2));
const d1Note = D1_LOG.database_id ? ` · D1 ${D1_LOG.binding} (${D1_LOG.database_name})` : " · D1 CHƯA gắn (thiếu database_id)";
console.log(`[patch-wrangler] KV ${KV_BINDING.binding} (${KV_BINDING.id})${d1Note} · vars: ${Object.keys(VARS).join(", ")}`);
