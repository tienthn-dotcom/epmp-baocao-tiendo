# BÀN GIAO ePMP

Mọi thứ cần để **chạy tiếp và sửa được** app ePMP. Đọc hết file này là dựng lại được từ số không.

> **Phạm vi:** chỉ bàn giao APP. Skill xuất báo cáo tuần Master Plan (chạy trên máy cá nhân bằng
> Excel) KHÔNG thuộc đợt bàn giao này.

---

## 1. App này là gì

Bảng theo dõi tiến độ dự án nội thất của AA Corporation, phòng OCC dùng hằng ngày (10-17 người).
Chạy trên Cloudflare Workers, dữ liệu gốc nằm trên Google Sheet và Google Drive.

| | |
|---|---|
| Đang chạy tại | https://baocao-tiendo-pmo.tienthn.workers.dev |
| Mã nguồn | github.com/tienthn-dotcom/epmp-baocao-tiendo |
| Thư mục trên máy cũ | `D:\CẦN SẮP XẾP\pmptaskstracker-main\pmptaskstracker-main` |

**Ba cái tên khác nhau cùng chỉ một dự án** (thư mục · repo · worker). Dễ nhầm, nhớ kỹ.

Công nghệ: TanStack Start (React 19, Vite 7) chạy trên Cloudflare Workers. Dữ liệu người dùng nhập
nằm ở KV, nhật ký ở D1, số liệu gốc đọc từ Google Sheet.

---

## 2. Cần được cấp những gì

### 2.1 Cloudflare — mời vào tài khoản, đừng copy API token

| Thứ | Giá trị |
|---|---|
| Worker chính | `baocao-tiendo-pmo` |
| Worker phụ (cron) | `baocao-tiendo-warmer` |
| KV (dùng chung 2 worker) | `PMO_EDITS` · id `2bdbce7b49014e538ee3156728ab9548` |
| D1 (nhật ký giám sát) | `pmo-audit` · id `ea3aca84-e754-44fb-947f-ca442b3f7b19` |
| Khác | Browser Rendering · Service binding · 4 cron |

### 2.2 Secret

Đặt bằng `npx wrangler secret put <TÊN> --name <worker>`. Không có secret nào nằm trong repo
(`.env` đã bị `.gitignore` loại).

**`baocao-tiendo-pmo`** — 6 cái:
`GDRIVE_OAUTH_CLIENT_ID` · `GDRIVE_OAUTH_CLIENT_SECRET` · `GDRIVE_OAUTH_REFRESH` ·
`GOOGLE_CLIENT_SECRET` · `SESSION_SECRET` · `RENDER_TOKEN`

Tuỳ chọn: `AGENT_TOKEN` — chìa cho cửa đọc số của công cụ ngoài (mục 6). Không đặt thì cửa đóng.

**`baocao-tiendo-warmer`** — 4 cái:
`GDRIVE_OAUTH_CLIENT_ID` · `GDRIVE_OAUTH_CLIENT_SECRET` · `GDRIVE_OAUTH_REFRESH` · `RENDER_TOKEN`

`RENDER_TOKEN` phải **trùng chuỗi** ở cả hai worker, nếu không cron không bấm được nút bên app.

Biến thường (không bí mật, nằm trong `scripts/patch-wrangler.cjs`):
`GOOGLE_CLIENT_ID` · `ALLOWED_HD = aacorporation.com`

### 2.3 Google

- **OAuth client** trong Google Cloud (chứa `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).
  Redirect URI phải là `https://<worker>/auth/callback`. Đổi tên worker là phải sửa chỗ này.
- **Quyền trên các file nguồn** (mục 4).

> ### ⚠ VIỆC PHẢI LÀM TRƯỚC KHI NGƯỜI CŨ NGHỈ
> `GDRIVE_OAUTH_REFRESH` là refresh token Drive của **chính tài khoản tienthn@aacorporation.com**.
> Tài khoản đó bị khoá là **chết toàn bộ phần Drive**: ma trận lắp đặt, media công trường, báo cáo
> tuân thủ, và cả worker warmer. Token đó còn mở được Drive cá nhân chứ không riêng ePMP.
>
> **Phải tạo lại bộ OAuth bằng tài khoản sẽ ở lại** (hoặc một service account của công ty), chạy
> `scripts/mint-drive-token.mjs` lấy refresh token mới, `wrangler secret put` đè lên cả hai worker,
> rồi test. Làm sớm, đừng để sát ngày.

---

## 3. Ai được vào app

Hai cửa, qua được **cả hai** mới vào được:

1. **Google OAuth** — bắt buộc đăng nhập.
2. **Danh sách quyền trong KV** (`auth:allow`) — hiện để `["*", "<một email gmail ngoại lệ>"]`.
   Dấu `*` nghĩa là mở theo domain: mọi tài khoản `@aacorporation.com` vào được.
   `ALLOWED_HD` bắt buộc phải có, nếu không `*` bị từ chối (tránh mở toang ra internet).

Thêm người ngoài domain: thêm email vào danh sách KV — nhưng người đó vẫn phải có tài khoản Google.

Phân vai trong app (`roles:v1` ở KV): **PMO · OCC · BOD · PM**. PMO và OCC quyền ngang nhau.

---

## 4. Dữ liệu gốc nằm ngoài code

App không tự sinh số. Sửa mấy file này là app đổi theo, **không cần deploy**.

| File | Dùng cho |
|---|---|
| Master Plan — sheet `1hx8yzpoQio4yla3jmooni5cu1g9-M7tu`, tab `Timeline` | Toàn bộ dự án và đầu việc |
| Đánh giá tuân thủ — sheet `15pcqb0ExFQ5uF9CuKSx6O6y9GN4kfiNf6IARN98pJbA` | Chấm tuân thủ báo cáo |
| Drive `Data Source` — folder `1O9VktCpBENaZB1xgABr8MfIbl3YW8hFO` | Thư mục gốc mọi nguồn phụ |
| `Data Source › Mã màu › heatmap-colors.csv` | **Bảng màu của mọi ma trận.** Thay file là đổi màu toàn app |
| Các file ma trận từng dự án | Popup ma trận, tường lắp đặt, media theo căn |
| `DATABASE › ePMP` | Nơi app ghi PDF, media, sao lưu |

**App bám theo TÊN CỘT, không bám vị trí.** Đổi tên cột trong file nguồn là app hỏng dù code không
đụng gì. Trước khi sửa cấu trúc file, thử trên bản sao.

### Apps Script — ⚠ còn thiếu một cái

`scripts/` có 11 file `.gs`, nhưng bản **đang chạy** nằm trong chính các file Google Sheet, hai bên
có thể đã lệch nhau.

**`BangDiemTongHop.gs` KHÔNG có bản nào trong repo** — chỉ tồn tại bên trong file BCN. Nó là trạm
tính điểm tuân thủ tổng hợp, app chỉ đọc kết quả. Mở Sheet, copy script ra, commit vào `scripts/`
trước khi làm gì khác.

---

## 5. Chạy và deploy

```bash
npm install          # cần Node
npm run dev          # chạy ở máy, cổng 8080
npm run deploy       # vite build && node scripts/patch-wrangler.cjs && npx wrangler deploy
```

> **Đừng bao giờ `wrangler deploy` trần.** Repo KHÔNG có `wrangler.toml` ở gốc — cấu hình được
> sinh ra lúc build tại `.output/server/wrangler.json`, rồi `scripts/patch-wrangler.cjs` mới ghim
> tên worker, KV, D1 vào. Bỏ bước giữa là wrangler tự suy tên từ repo và **deploy sang một worker
> mới toanh**, URL thật đứng yên mà không ai biết.

Worker phụ deploy riêng: `cd warmer && npx wrangler deploy`.

Phiên bản app lấy từ `CHANGELOG[0].v` trong `src/routes/index.tsx` — thêm một mục ở đầu mảng mỗi
lần deploy, số phiên bản tự theo.

Muốn biết app đang chạy bản nào thì xem badge phiên bản trên app, **đừng xem GitHub** — deploy đi
thẳng từ ổ đĩa, GitHub có thể tụt lại.

Chạy ở máy cần file `.env` với 3 giá trị `GDRIVE_OAUTH_*` (xin từ người bàn giao, hoặc tự mint).

---

## 6. Các cửa cho máy (không qua đăng nhập)

| Đường | Chìa | Làm gì |
|---|---|---|
| `/may/bao-cao?phan=…` | `AGENT_TOKEN` | **Chỉ đọc.** Trả JSON cho công cụ ngoài làm báo cáo. Gọi không tham số thì trả bản đồ hướng dẫn |
| `/may/cham-bcn` | `RENDER_TOKEN` | Cron chấm tuân thủ hằng ngày |
| `/?tudong=1` | `RENDER_TOKEN` | Cron dựng PDF tuân thủ (phiên robot 10 phút) |

Không đặt chìa = cửa đóng. Ba cửa này là đường duy nhất vào app mà không cần tài khoản Google.

Ai cầm `AGENT_TOKEN` là đọc được **toàn bộ** số, không lọc theo người. Thu hồi bằng
`wrangler secret delete AGENT_TOKEN --name baocao-tiendo-pmo`, app không hề hấn.

---

## 7. Các trần đã đụng — biết trước kẻo mất buổi

Gói Cloudflare Workers Free:

| Trần | Hệ quả thật đã gặp |
|---|---|
| **2 giây CPU / lượt** | Worker **không parse nổi xlsx** (riêng `XLSX.read` file Master Plan đã 1.027 ms). Vì vậy mọi việc đọc file nguồn đều làm Ở CLIENT rồi đẩy kết quả lên KV — xem `src/lib/etl.ts`. Đừng chuyển ngược vào Worker |
| **1.000 lượt ghi KV / ngày** | Cho cả app, mà mỗi ngày 10-17 người mở. Mọi chỗ ghi KV đều phải có chốt "chỉ ghi khi đổi" |
| **5 cron trigger** | Đang dùng 4. Xin cái thứ 6 là Cloudflare từ chối thẳng (mã 10072) |
| **50 subrequest / lượt** | Tải nhiều file Drive phải chia lô, không thả song song |

Cron đếm thứ theo **1 = Chủ Nhật**. Đừng neo thứ vào biểu thức cron — kiểm thứ trong code.

---

## 8. Cấu trúc mã nguồn

```
src/routes/index.tsx     Dashboard chính (rất lớn, chứa CHANGELOG + phiên bản)
src/lib/*.ts             Module thuần — luật nghiệp vụ, có bộ kiểm riêng
src/lib/*.functions.ts   Server function (chạy trên Worker)
src/lib/*-app.tsx        Các app con: MTLĐ, Hiệu suất, Hình ảnh mỗi ngày, Trợ lý…
src/lib/auth*.ts         Cổng chặn — chạy TRƯỚC mọi request
scripts/*.gs             Apps Script (bản chép)
scripts/patch-wrangler.cjs   BẮT BUỘC chạy sau build
warmer/                  Worker phụ chạy cron
tests/                   Hơn 1.000 ca kiểm — chạy `npx vitest run`
```

Quy ước trong mã: luật nghiệp vụ tách ra module thuần để test được, comment ghi **lý do và số đo
thật** chứ không chỉ mô tả code. Giữ nếp đó.

---

## 9. Việc đầu tiên nên làm

1. Vào được Cloudflare, xem hai worker còn sống.
2. Đặt lại bộ OAuth Drive bằng tài khoản sẽ ở lại (mục 2.3) — **việc gấp nhất**.
3. Copy `BangDiemTongHop.gs` từ Sheet về `scripts/` (mục 4).
4. `npm install && npx vitest run` — hơn 1.000 ca phải xanh hết.
5. Sửa một chữ vặt rồi `npm run deploy`, xem badge phiên bản trên app có đổi không. Đổi được là
   nắm được đường deploy.
