# HANDOFF — Media công trường (đại trùng tu "Video tại công trường")

> File này gom TOÀN BỘ logic + chi tiết của tính năng để phiên chat sau tiếp tục mà **không sửa sai logic đã chốt** và **không phá dữ liệu Drive đã sắp**. Đọc hết trước khi đụng code.
>
> **Repo THẬT:** `D:\CẦN SẮP XẾP\pmptaskstracker-main\pmptaskstracker-main` (KHÔNG phải bản `D:\AACORP\...\baocaotiendo-main` — bản đó cũ).
> **Ràng buộc số 1:** ĐANG LÀM — **KHÔNG deploy**, phải preview cho kỹ. Chỉ deploy khi chủ nhà nói đúng chữ "deploy đi".

---

## 0. Lệnh & môi trường

- Dev: `npm run dev` (Vite v7, cổng **8080**). Nếu server chết (HTTP 000) thì chạy lại `(npm run dev > /tmp/vitedev.log 2>&1 &)`.
- Typecheck: `npx tsc --noEmit` (lệnh build **KHÔNG** typecheck).
- Deploy (CHỈ khi được bảo): `npm run deploy` = vite build + patch-wrangler.cjs + wrangler deploy.
- Test: `npx vitest`.
- **KHÔNG parse xlsx trên Cloudflare Worker** (OOM → Error 1102). Worker chỉ tải file (base64), parse HẾT ở client. Upload file to lên Drive bằng **resumable session**: Worker tạo session, client PUT byte thẳng lên Google (bypass OOM).
- Nền tảng: TanStack Start (React) trên Cloudflare Workers. serverFn qua `createServerFn` (dùng `.validator` hoặc `.inputValidator`).

### Credentials Drive (`.env` ở gốc repo, prod = wrangler secret)
```
GDRIVE_OAUTH_CLIENT_ID=...
GDRIVE_OAUTH_CLIENT_SECRET=...
GDRIVE_OAUTH_REFRESH=...          # refresh token, KHÔNG dùng service account
```
- `DEFAULT_ROOT = "1O9VktCpBENaZB1xgABr8MfIbl3YW8hFO"` = folder "Data Source" (share cho tienthn@aacorporation).
- `DB_SUBFOLDER = "DATABASE"`. `ensureDbPath()` dựng folder lồng nhau.
- File nằm trong My Drive RIÊNG → không nhúng iframe trực tiếp cho người ngoài (đòi đăng nhập).

---

## 1. MỤC TIÊU (toàn bộ yêu cầu chủ nhà — giữ đúng)

1. Đại trùng tu app cũ "Video tại công trường" → **dashboard "Media công trường"**.
2. Trên cùng có **dropdown chọn dự án**. **CHỌN DỰ ÁN LÀ TỰ NHẢY RA MA TRẬN** (heatmap) — không phải bấm lọc/gõ tay.
3. Ma trận = bê **nguyên heatmap lắp đặt thật**, **tô màu y hệt**. Click 1 **Ô (1 phòng)** → popup xem **ẢNH + VIDEO** của phòng + **upload** (ảnh & video), **upload NHIỀU FILE 1 lượt**.
4. Media gắn **theo PHÒNG** (cả phòng 1 kho chung), KHÔNG theo từng ô (căn×công đoạn).
5. Folder Drive tự tổ chức chuẩn (mục 3 bên dưới). Up vào là có tổ chức folder hợp lý luôn.
6. **Sắp xếp lại file cũ** vào cấu trúc này (ĐÃ LÀM XONG bằng script). "làm cho kỹ, app đỡ nặng".
7. Heatmap **chữ đồng màu nền** (ẩn chữ, chỉ thấy màu).
8. Heatmap tô theo **quy ước 7 màu chuẩn có thứ tự** (mục 4).
9. **Mini Hotel trước**, mở rộng dự án khác sau.
10. **Responsive** điện thoại + máy tính. App nhẹ (đọc từ Drive, không ôm dữ liệu).
11. **KHÔNG deploy** — preview kỹ.

### Chốt từ các câu hỏi (AskUserQuestion)
- Media: **"Theo CĂN (cả căn chung 1 kho)"**.
- Phạm vi: **"Mini Hotel trước, mở rộng sau"**.
- Heatmap: **"Cả hai: nền ma trận thật + ô căn bấm được"**.

---

## 2. LOGIC CỐT LÕI — "TẠI SAO" (ĐỪNG SỬA NGƯỢC)

- **Cấp Toà là BẮT BUỘC** trong đường dẫn: mã căn TRÙNG số giữa các Toà (609 có ở B1, B2, B3 = 3 phòng khác nhau). Bỏ Toà → đụng nhau, mất dữ liệu. Nên path LUÔN có `<Toà>` trước `<phòng>`.
- **`mediaPath()` bỏ cấp Toà nếu `toa` rỗng** (cho dự án không chia Toà về sau); Mini Hotel LUÔN có Toà B1-B5.
- **Media theo PHÒNG, không theo ô**: chủ nhà chọn "theo CĂN". Click ô bất kỳ của phòng → mở đúng kho phòng đó. Đừng làm mỗi ô 1 kho.
- **Suy phòng/Toà từ ô ma trận = HEURISTIC** (vì heatmap là HTML, giá trị ô là **mã trạng thái** không phải mã căn). Nên popup **cho sửa Toà + Phòng bằng tay** để KHÔNG BAO GIỜ gắn nhầm. Khi mở được ma trận thật thì tinh chỉnh `canOf()` cho khớp layout, **nhưng vẫn giữ ô sửa tay** làm chốt an toàn.
- **Hiện ảnh phải tải byte qua Worker** (`readCanMediaB64` → base64). ĐỪNG đổi sang nhúng URL trực tiếp (sẽ đòi đăng nhập/hỏng).
- **Video** dùng iframe `drive.../preview` — chạy cho người ĐÃ đăng nhập Drive (chủ/PMO). Người ngoài cần set "anyone with link → viewer" — **chờ chủ nhà đồng ý, đừng tự bật share**.
- **`blendText` (KHÔNG đặt tên `hideText`)**: `matrix-form-editor.tsx` ĐÃ có hàm `hideText` (nút "Ẩn chữ" thủ công của editor). Prop tự-động-ẩn-chữ PHẢI tên khác = `blendText` → truyền vào `rangeToHtml(..., hideText=blendText)`. Trong `sheet-dump.ts`: `if (hideText && bg) fg = bg`. Đừng đụng nút `hideText` cũ.
- **Nguồn dropdown**: `getInstallList()` (KV `mtld:install:list:v2`) + localStorage `mtld:install:v2` (mồi/fallback). Danh sách do **ePMP dashboard** (index.tsx ~2251) đẩy TỪ `sheetViews[stableProjKey].fileId` (link PMO gắn qua `getSheetViews`, KV `sheetview:v1`) trên dự án có công đoạn "Thi công lắp đặt". **Dev demo rỗng là bình thường** → cần gắn/nạp 1 ma trận thật. ĐỪNG đổi nguồn dropdown khi chưa hiểu chỗ này.
- **Màu heatmap**: lấy theo `legendCodeColors` (đọc màu khai trong file, cột **"Tăng hôm nay"**). "Màu chưa lên" = ma trận đang không ra màu → PHẢI mở ma trận thật xem giá trị ô rồi quyết: (a) file đã có legend đúng → chỉ render đúng nhánh; hay (b) map **giá trị ô → 7 màu chuẩn** (mục 4). **Đừng hardcode màu bừa khi chưa nhìn ma trận.**
- **ManualEntry là FALLBACK**, không phải luồng chính. Khi dropdown có dự án + ma trận render → luồng chính là dropdown→ma trận→click ô. Ẩn ManualEntry khi luồng chính chạy.
- **App `media` đang `live:false`** (dev-only) — duyệt xong mới bật. App cũ `clipcan` (video) VẪN live, **đừng gỡ vội** (chưa có gì thay thế toàn bộ).

---

## 3. CẤU TRÚC DRIVE (chốt)

```
Database / ePMP / Media / <Dự án> / <Toà> / <tên phòng> / (Hình ảnh | Video) / <file>
```
- Mini Hotel: dự án = `Mini Hotel PQ (B1-B5) Phòng`, Toà = `B1`..`B5`.
- Mỗi PHÒNG phải có **đủ 2 thư mục**: `Hình ảnh` và `Video`. Video up vào `Video`, ảnh vào `Hình ảnh`.
- Ảnh **dự-án-chung** (`ePMP/Mini Hotel PQ (B1-B5) Phòng/Hình ảnh`, ~6 tấm) **GIỮ NGUYÊN** — không thuộc phòng nào.

### Trạng thái Drive: ĐÃ SẮP XONG
- `scripts/media-migrate.mjs --go` đã chạy: dời 60 clip về `Media/<Toà>/<phòng>/(Hình ảnh|Video)`. **Dời file (giữ id → link không đổi), KHÔNG xoá file.** Gộp cả cây cũ (`ePMP/Mini Hotel.../Video/<Toà>`) lẫn file phẳng `<room>_<date>.ext` (phòng = tên trước "_").
- `scripts/media-cleanup.mjs --go` đã chạy: trash rác nằm sai chỗ (con của `Media/<dự án>` không phải Toà B1-B5, vd "609" top-level, "L04-B2", "L05-Đã giao thô- 362"), trash cây Video cũ rỗng + Media trùng rỗng, tạo đủ `Hình ảnh` còn thiếu (giờ mỗi phòng có cả 2).
- Quy tắc trong script: `TOA_OK=/^B[1-5]$/i`; chỉ trash folder **rỗng**; folder có file mà sai chỗ thì GIỮ + cảnh báo (xử tay). **Đừng chạy lại kiểu phá.**

---

## 4. QUY ƯỚC 7 MÀU HEATMAP (chuẩn chung, dùng cho MỌI heatmap)

Thứ tự thấp → cao:

| # | Trạng thái | Hex |
|---|---|---|
| 1 | Chưa nhận mặt bằng | `#B02418` |
| 2 | Đang thi công | `#D9D9D9` |
| 3 | Đã giao thô | `#93C5FD` |
| 4 | Đã giao tinh (Nội bộ) | `#4E80EE` |
| 5 | Đã đóng defect PMU | `#1E3A8A` |
| 6 | Đã ra list Defects (Vận hành) | `#C2FEBA` |
| 7 | Bàn giao Vận hành | `#059669` |
| X | (không áp dụng) | `#A6A6A6` |

---

## 5. FILE & CODE

### `src/lib/can-media-app.tsx` (NEW — app chính)
- `CanMediaApp`: đọc `getInstallList()` (KV) + localStorage `"mtld:install:v2"` (`MTLD_INSTALL_LS`, khai **local** — đừng import từ app-shell để tránh vòng import) cho dropdown. Mini Hotel sắp đầu (`isMini`). Chọn dự án → `<MatrixBoard>`. Danh sách rỗng → `<ManualEntry>`.
- `MatrixBoard({proj, onPick})`: render `<MatrixFormEditor ... hideChrome natural blendText />`. onClick đọc `e.target.closest("td[data-c]")`, gọi `canOf(td, table)` suy phòng → `onPick("", can)` (Toà "" để user set trong popup).
- `canOf(td, table)`: nếu `/^\D{0,3}\d{3,}\D{0,3}$/.test(self)` → trả `self`; else ghép **nhãn hàng** (td đầu không rỗng cùng `data-r`) + **tiêu đề cột** (td đầu không rỗng cùng `data-c`, `data-r` nhỏ nhất) thành `rowLbl-colHdr`.
- `CanMediaDialog({project, initialToa, initialCan, onClose})`: state `toa`+`can` **sửa được ở header**; `listCanMedia({data:{project,toa,can}})`; mục Ảnh (grid qua `useImageUrls`→`readCanMediaB64`) + Video (thumbnail → iframe `/preview`); `onFiles(kind, files)` lặp **nhiều file** → `startCanMediaUpload({data:{project,toa,can,kind,ext,mime}})` → client PUT.
- `ManualEntry`: project + Toà chips (B1-B5 + text) + input phòng → `onOpen(project, toa, can)`. **FALLBACK only.**
- Phụ: `MediaSection` (nút upload `multiple`), `Empty`, `useImageUrls` (fetch ảnh Drive → cache dataURI).

### `src/lib/can-clip.functions.ts` (thêm serverFn media)
- `KIND_FOLDER = (kind) => kind === "photo" ? "Hình ảnh" : "Video"`.
- `mediaPath(project, toa, can, kind)`: `const toaS = safeCan(toa); return ["ePMP","Media", safeCan(project)||"Khac", ...(toaS?[toaS]:[]), safeCan(can)||"Khac", KIND_FOLDER(kind)]`.
- `startCanMediaUpload` (validator `{project, toa?, can, kind, ext, mime}`): tên file `${can}_${stamp}_${rid6()}.${ext}` → `driveCreateResumableSession(mediaPath(...))`.
- `listCanMedia` (validator `{project, toa?, can}`): song song `driveListChildrenImpl` trên path photo+video → `{photos, videos(sort theo ngày)}`.
- `readCanMediaB64` (validator `{id}`): `driveReadFileB64Impl` → `{dataUri}`.

### `src/lib/drive.functions.ts` (thêm helper)
- `driveListChildrenImpl(path)` → `{files:[{id,name,link}], folders:[{id,name}]}`.
- `driveListFilesByParents(parentIds)` → files kèm `.parent` (OR query theo lô 40).
- `driveReadFileB64Impl(fileId)` → `{mime, b64}` (tải qua OAuth).
- (`driveArchiveText` có sẵn từ việc backup audit; đã bỏ bug `;charset=utf-8` trong dataURI.)

### `src/lib/sheet-dump.ts`
- `rangeToHtml(sh, rangeStr?, codeColors?, spec?, hideText?)` — thêm tham số thứ 5. Sau khi tính `fg`: `if (hideText && bg) fg = bg;` (ô có nền thì hoà chữ vào nền; ô nhãn không nền vẫn thấy chữ).
- **`rangeToHtml` là renderer DUY NHẤT phát ô địa chỉ hoá `<td data-r data-c>`.** `summaryToHtml` (heatmap auto) KHÔNG có toạ độ ô. `readMatrixSheet` (matrix-reader.ts) cho `RawUnit{toa,tang,can,pct}` nhưng chỉ với sheet "MA TRẬN ĐỊNH LƯỢNG", chưa đấu vào popup.
- Ưu tiên màu ô: form `cellColor` → `codeColor`(theo value) → rule → `legendCodeColors` (cột "Tăng hôm nay") → CF → "X"=`#A6A6A6`.

### `src/lib/matrix-form-editor.tsx`
- Thêm prop `blendText?: boolean` (**KHÔNG** đặt `hideText` — tên đã dùng cho nút thủ công `const hideText = () => ... cellFg=transparent`).
- `const html = useMemo(() => rangeToHtml(region.sh, region.range, region.codeColors, spec, blendText), [region, spec, blendText]);`

### `src/lib/app-shell.tsx`
- Import `Images` (lucide) + `CanMediaApp`. APPS: `{ id:"media", name:"Media công trường", sub:"Ma trận + ảnh/video theo căn", icon:<Images className="h-5 w-5"/> }` (không có `live` → dev-only).
- Dispatch: `: shellOn && effectiveApp === "media" ? <CanMediaApp />`.
- App cũ `clipcan`/`CanClipApp` vẫn còn, **chưa gỡ**.
- Tham chiếu: `MtldApp` (~282) là mẫu "dự án → ma trận" có sẵn (đọc localStorage + getInstallList; PopupCell/PopupModal render MatrixFormEditor).

### `scripts/media-migrate.mjs` & `scripts/media-cleanup.mjs`
Đã chạy `--go`. Xem mục 3. Dời-không-xoá; chỉ trash rỗng/rác.

---

## 6. LỖI ĐÃ GẶP & CÁCH SỬA

- **dataURI charset bug** (`driveArchiveText`): URI có `;charset=utf-8;base64,` → regex `/^data:([^;]+);base64,(.*)$/s` fail. Sửa: bỏ charset, dùng `"data:"+mime+";base64,"+utf8ToBase64(text)`.
- **Trùng định danh `hideText`** (TS2300/TS2322): file đã có `const hideText`. Sửa: đổi prop mới thành `blendText`.
- **Vòng import** (can-media-app ↔ app-shell): sửa bằng khai `const MTLD_INSTALL_LS = "mtld:install:v2"` **local**, không import.
- **Dropdown rỗng trên dev**: `getInstallList` (KV) rỗng vì dev demo không có dự án Mini Hotel "Thi công lắp đặt" gắn link PMO. Đã thêm fallback đọc localStorage. Muốn thấy ma trận: gắn/nạp link ma trận thật.
- **Video hiện "Đăng nhập"**: file trong My Drive riêng, iframe `/preview` cần đăng nhập. Chạy cho chủ (tienthn). Cần share "anyone with link" cho người ngoài (chờ chủ nhà đồng ý).
- **Auto-mode safety block**: một classifier riêng chặn Edit/browser giữa phiên (kích bởi nội dung trước đó), kéo dài hết phiên; chỉ hết khi TẮT auto mode hoặc mở phiên mới. `/auto-mode-setup` cấu hình allow/deny, KHÔNG gỡ block phiên.
- **Dev server 000**: chạy lại `(npm run dev > /tmp/vitedev.log 2>&1 &)`.

---

## 6B. ĐÃ CHỐT PHIÊN 04/09 — MÀU, SUY PHÒNG, QUYỀN CHỈNH (ĐỪNG SỬA NGƯỢC)

### a) "Màu chưa lên" — nguyên nhân THẬT và cách sửa (`summary-render.ts` → `legendCodeColors`)
File Mini Hotel có **2 bảng legend trên CÙNG 1 HÀNG** (r11): bảng chung ở cột 27-33 và bảng riêng từng Toà
ở cột 45+. Vòng dò cũ quét hết hàng nên `cMau` bị ghi đè sang bảng sau, **lệch cột** với "Diễn giải" →
mã→màu lệch 1 bậc. Thêm nữa cột **"Tăng hôm nay" ở file này chứa SỐ, không phải hex** → rơi xuống fill
tĩnh (`#FDF2D0`/`#FBE4D5`) nên nhìn như "chưa lên màu".

Đã sửa 3 điểm, giữ nguyên logic này:
1. Lấy **bảng legend ĐẦU TIÊN**, các cột phụ chỉ nhận trong phạm vi bảng đó (dừng ở ô "Màu" kế tiếp).
2. **Mã ô đọc từ chính cột "Màu"** khi file gõ sẵn mã vào đó (mã hợp lệ = 1-2 chữ số hoặc "X"; giá trị lạ
   như "123" coi là mã TRỐNG). Không có mã nào → mới lùi về đánh số theo thứ tự dòng như cũ.
3. **Tô theo THỨ HẠNG dòng legend** trên `STD_RAMP` (7 màu chuẩn, thấp→cao), KHÔNG so tên. Lý do: mỗi file
   gọi tên công đoạn một kiểu, so tên sẽ vỡ thang. "X" nằm NGOÀI thang (`#A6A6A6`, không chiếm bậc).
   Ưu tiên: hex khai trong legend > thang thứ hạng > map tên > fill ô.

Kết quả trên Mini Hotel (đã verify cả trên preview lẫn harness node):
`(trống)`→#B02418 · `1`→#D9D9D9 · `2`→#93C5FD · `3`→#4E80EE · `4`→#1E3A8A · `5`→#C2FEBA · `6`→#059669 · `X`→#A6A6A6.

> **LƯU Ý gửi chủ nhà:** TÊN công đoạn trong file KHÁC quy ước mục 4 ở bậc 5-6 (file: "Đã ra list Defect
> (Vận hành)" rồi "Xoá list Defect (Vận hành)"; quy ước: "Đã đóng defect PMU" rồi "Đã ra list Defects").
> Đang tô theo THỨ TỰ của file. Nếu muốn đổi, phải chốt lại thứ tự — đừng tự đảo.

### b) Ô TRỐNG trong lưới = bậc thấp nhất (`sheet-dump.ts` → `rangeToHtml`)
`legendCodeColors` trả thêm khoá `""` (dòng legend đầu, vd "Chưa bàn giao"). `rangeToHtml` chỉ tô ô trống
**NẰM TRONG LƯỚI**: nhận hàng header block bằng **dãy ≥3 ô 2 chữ số ở cột LIỀN NHAU, TĂNG ĐÚNG 1**
("01","02","03"…) → nhớ tập cột đơn vị; dòng dưới có ≥1 ô có giá trị mới là dòng căn. Bắt buộc kiểm
"tăng đúng 1", nếu chỉ xét "2 chữ số" thì **dòng tổng** ("Lũy kế" 84/82/59…) cũng bị nhận là header.

### c) `canAt()` — suy (Toà, phòng) từ ô (`can-media-app.tsx`), THAY cho `canOf()` cũ
Cấu trúc thật: hàng header block `[B1][01][02]…[18][HL]` (ô trái nhất = **TOÀ**), hàng dữ liệu
`[L06] 2 2 3 …` (ô trái nhất = **TẦNG**). ⇒ **phòng = số tầng + số căn** (L06 × "01" → `601`); cột "HL" →
`Hanh lang T6` — khớp đúng tên folder Drive.
Ba chốt chặn bắt buộc (thiếu là ra phòng ma):
- hàng header phải qua `isHeaderRow` (dãy ≥3 ô tăng đúng 1), **không** chỉ "ô cùng cột là số 2 chữ số";
- ô cùng cột trên header phải là `01..18`/`HL`, nếu là cột % / cột chú giải → trả null;
- **TẦNG phải lấy đúng CỘT NHÃN của block** (cùng cột với ô "B1"), không lấy "ô có chữ đầu tiên của hàng".
Verify: quét toàn bảng ra đúng **470 ô căn**, chỉ 5 Toà B1-B5 (B1 90 · B2 95 · B3 80 · B4 95 · B5 110),
có đủ `Hanh lang T2..T6`. Trước khi sửa còn sinh Toà giả "Lũy kế" / "Còn lại cần giao" / "L05".

### d) ADMIN CHỈNH MA TRẬN NHƯ EXCEL (yêu cầu chủ nhà 04/09)
- `MatrixBoard` nhận `canEdit` (admin hoặc PMO, qua `whoami` + `fetchUserRoles`/`roleOf` như app-shell).
  Truyền `canEdit` + `hideChrome={!canEdit}` cho `MatrixFormEditor` → hiện sẵn thanh "Chỉnh như Excel"
  (Tô ô · Tô theo mã · Màu chữ · Ẩn chữ · Kiểu 1/2 · Rộng cột · Cao dòng · Sửa chữ · **Ẩn cột · Ẩn dòng ·
  Hiện lại** · Hoàn tác · Lưu form · Xoá form). KHÔNG cần viết editor mới.
- **Đang chỉnh thì KHÔNG mở popup media**: `onClick` thoát sớm khi thấy `.mfe-host.mfe-edit` (class do
  editor tự gắn). Nhờ vậy chuột thuộc về việc quét chọn ô.
- **`formKey` RIÊNG cho màn media**: `mediaFormKey(p) = <formKey dashboard> + "::media"`. Ma trận lấy theo
  link PMO gắn, DÙNG CHUNG với dashboard ePMP — nếu xài chung form thì admin ẩn dòng ở đây sẽ **ẩn luôn
  trên dashboard**. Tách khoá để trim thoải mái. ĐỪNG gộp lại.

### d2) Bổ sung công cụ chỉnh (yêu cầu chủ nhà 04/09, đợt 2) — `matrix-form-editor.tsx`
- **`clearText` "Xoá chữ"**: đè chữ rỗng lên MỌI ô đang chọn (Delete của Excel). **Phím tắt `Delete`/
  `Backspace`** khi đang chỉnh; `Esc` bỏ chọn. Handler bỏ qua nếu con trỏ đang trong input/contentEditable
  (không cướp phím lúc double-click gõ ô).
- **`editText` "Sửa chữ" nay HÀNG LOẠT**: gõ 1 lần áp cho mọi ô đang chọn (trước chỉ ô đầu khối). Chọn 1 ô
  thì y như cũ → không phá dùng cũ ở dashboard.
- **`resetText` "Bỏ đè chữ"**: gỡ chữ đã gõ đè, ô hiện lại giá trị THẬT của file.
- **`clearAll` "Xoá sạch ô"**: trả khối về đúng file gốc (xoá chữ đè + màu nền + màu chữ + màu theo mã +
  luật tô thông minh chồng lên khối).
- **Số liệu trong file KHÔNG bao giờ bị đụng** — tất cả chỉ là form hiển thị, "Xoá form" là về gốc.

### d3) Khung chiếu ma trận + bề rộng trang — `can-media-app.tsx`
- `PAGE_W = 1880` (trước 1180): ma trận 5 Toà × 18-21 căn rất rộng, để trang rộng gần hết màn.
- Khung `.mtx-box`: `resize: vertical` → **kéo mép dưới đổi cao khung**; cỡ nhớ trong localStorage
  `media:matrixBoxH` (mặc định 720). CSS kèm theo bắt buộc, đừng bỏ:
  `.mtx-box>div{height:100%}` (prop `natural` không đặt h-full) ·
  `.mtx-box .mfe-host{flex:1;min-height:0;overflow:auto}` (CHỈ vùng bảng cuộn → thanh công cụ đứng yên) ·
  `.mtx-box .sd-scroll{max-height:none;overflow:visible}` (bỏ trần 88vh mặc định).
- **Bỏ `hideChrome`**: nay LUÔN hiện thanh công cụ để người xem thường cũng có nút zoom −/100%/+;
  `canEdit` mới là thứ quyết định có nhóm nút chỉnh hay không.

### d4) ĐỢT 3 (04/09, chiều) — GỘP APP + công cụ chỉnh + BẢNG KHU

**GỘP 1 APP DUY NHẤT.** App cũ `clipcan` "Video tại công trường" ĐÃ GỠ; `can-clip-app.tsx` và
`can-clip.functions.ts` đã XOÁ, đổi thành **`src/lib/can-media.functions.ts`** (chỉ còn đường dẫn Media
chuẩn). App `media` nay `live: true`. Nút **🎬 Video** trên dashboard ePMP không mở dialog cũ nữa mà bắn
`window.dispatchEvent(new CustomEvent("epmp:open-app", {detail:{app:"media", project:<tên>}}))`;
`app-shell` nghe sự kiện này → chuyển app + `CanMediaApp({wantProject})` khớp TÊN dự án để chọn sẵn.
**Đừng dựng lại đường dẫn cũ** `ePMP/Mini Hotel PQ (B1-B5) Phòng/Video/<Toà>/<căn>` — clip đã dời hết.

**XOÁ CỘT / XOÁ DÒNG THẬT** (`sheet-dump.ts`): trước đây `hiddenC` chỉ đặt `width:0` nhưng
`.sd-tb td{min-width:42px}` đè lại → cột vẫn chiếm chỗ, **nút nhìn như hỏng**. Nay `rangeToHtml`
KHÔNG VẼ hàng/cột trong `hiddenR/hiddenC`, phần còn lại dồn sát. Kèm theo:
- `liveOf(merge)` → ô gộp vẽ tại ô CÒN LẠI đầu tiên, `colspan/rowspan` đếm theo phần còn lại (ô neo có
  thể vừa bị xoá → không có cái này là dòng hụt ô, bảng lệch cột).
- form của ô gộp bám ô NEO (`const k = key(src.r, src.c)`), `data-r/data-c` cũng theo ô neo.
- `matrix-form-editor` kéo mép cột: `<col>` giờ chỉ còn cột chưa xoá → phải ĐẾM (`hidCRef`), không tra
  được bằng `idx - startC` nữa.
Nút đổi tên: **Xoá cột · Xoá dòng · Khôi phục (N)**.

**XOÁ Ô / SỬA HÀNG LOẠT**: "Xoá chữ" (+ phím `Delete`/`Backspace`, `Esc` bỏ chọn) · "Sửa chữ" nay áp cho
MỌI ô đang chọn · "Bỏ đè chữ" · "Xoá sạch ô". LƯU Ý `clearAll` phải ÉP `cellText:""` +
`cellColor:"transparent"`, KHÔNG được chỉ xoá key form — ô chưa từng tô thì xoá key không đổi gì trên màn
hình, người dùng tưởng nút hỏng (đúng lỗi đã báo).

**ZOOM**: `natural` đang khoá `zoom:1` (ô MTLĐ đã co bằng transform, chồng zoom gây lỗi paint). Thêm prop
**`zoomable`** để màn Media bật zoom thật. Đừng bỏ khoá này cho ô MTLĐ.

**KHUNG CHIẾU KÉO 2 BÊN, LƯU VÀO FORM** (`boxResize`): khung nằm TRONG `MatrixFormEditor` (class `.mfe-box`),
3 tay kéo `.mfe-grip-l/-r/-b`. Mép trái/phải nới **±2·dx** nên bảng LUÔN CÂN GIỮA (kéo 1 bên thì lệch,
xấu — chủ nhà đã phản ánh). Cỡ lưu ở **`spec.boxW/boxH`** (đã thêm vào `FormSpec` + `SheetForm` + zod)
→ admin bấm **💾 Lưu form** là MỌI NGƯỜI thấy đúng cỡ đó. Có nút "Cỡ khung mặc định".
CSS bắt buộc trong `MFE_CSS`: `.mfe-box .mfe-host{flex:1;min-height:0;overflow:auto}` (chỉ vùng bảng cuộn
→ thanh công cụ đứng yên) và `.mfe-box .sd-scroll{max-height:none;overflow:visible}` (bỏ trần 88vh).
`can-media-app` KHÔNG còn khung tự chế / localStorage nữa.

**BẢNG KHU** (`ZoneBoard` trong `can-media-app.tsx`) — cho dự án **khu public**: chart dạng khác, không
dựng được bản đồ ô nên không dùng heatmap. Lưới đơn giản `cols` cột, **mỗi ô là 1 KHU**; bấm ô → mở kho
ảnh/video của khu (`ePMP/Media/<dự án>/<tên khu>/(Hình ảnh|Video)` — KHÔNG có cấp Toà, `mediaPath` tự bỏ
khi `toa` rỗng). Admin: chọn số cột 2-5 · ＋ Thêm khu · double-click ô để đổi tên (để trống = xoá) ·
💾 Lưu bảng khu. Lưu ở `spec.zones = {cols, names}` dưới khoá **`media:zones::<maCT|tên dự án>`** trong
CÙNG kho form → admin lưu là mọi người thấy. Header có nút chuyển **Ma trận / Bảng khu**; dự án đã dựng
bảng khu thì mặc định mở thẳng bảng khu.

### d5) ĐỢT 4 (04/09, tối) — CÂY DRIVE GỌN LẠI · DẤU CÓ MEDIA · BẢNG KHU TỪ SHEET

**CÂY DRIVE — chỉ còn `Media`.** `ePMP/Mini Hotel PQ (B1-B5) Phòng/` (nằm NGOÀI Media) đã dời vào trong
bằng `scripts/media-fold-legacy.mjs --go` (dời file giữ id → link cũ sống; chỉ trash vỏ rỗng). Nay `ePMP`
chỉ còn `Media` · `Nhật ký giám sát` · `Báo cáo tuân thủ` · `Ghi chú`.
Đã sửa kèm để lần dọn sau không phá: `media-cleanup.mjs` có `PROJ_OK={"Hình ảnh","Video"}` (KHÔNG trash 2
thư mục cấp dự án dù rỗng) và `media-survey.mjs` in chúng là "[chung dự án]" thay vì nhầm là Toà.

**UP ẢNH TỪ POPUP DỰ ÁN (ePMP) NAY CŨNG VỀ ĐÚNG CĂN/KHU.** `ProjImageSetupDialog` (index.tsx) thêm 2 ô
**Toà** + **Căn / Khu**; `saveProjImage` nhận `toa`/`can`; `driveArchiveImages(app, project, uris, {toa, can})`
ghi vào `ePMP/Media/<Dự án>/[<Toà>]/<Căn|Khu>/Hình ảnh` — CÙNG chỗ với ảnh up từ app Media.
**Bỏ hẳn kho ảnh "cấp dự án"**: không nhập căn/khu thì KHÔNG đẩy Drive (ảnh vẫn lưu trong app).

**DẤU "CĂN NÀY ĐÃ CÓ MEDIA".** `listProjectMedia({project})` (can-media.functions.ts) quét cả cây bằng
`driveListFoldersByParents` + `driveListFilesByParents` → chỉ ~4 lượt gọi Drive cho 64 phòng (đừng quay
lại kiểu gọi từng phòng). Chịu cả 2 dáng cây (`<Toà>/<Căn>/KIND` và `<Khu>/KIND`) — phân biệt bằng
"con của nó tên Hình ảnh/Video thì chính nó là căn/khu".
UI: chấm tròn trắng góc dưới-phải ô (`td.has-media::after`), tooltip "B1 · 609 — 0 ảnh · 1 video", đếm
tổng ở thanh trên. Bảng bị editor render lại thì **MutationObserver** chấm lại, khỏi mất dấu.

**CHÚ GIẢI MÀU ĐỌC TỪ FILE, KHÔNG ĐỌC DOM.** Admin xoá cột legend khỏi bảng cho gọn → cách cũ (quét ô
"Diễn giải" trong DOM) mất sạch chú giải, mà chữ lại đang ẩn → không ai biết màu nghĩa gì. Nay
`legendEntries(sh)` (summary-render.ts, `legendCodeColors` là wrapper của nó) trả {code, text, color};
`MatrixFormEditor` có prop **`onLegend`** đẩy ra ngoài. Đừng quay lại đọc DOM.

**BẢNG KHU = DỮ LIỆU CỦA SHEET, BỐ CỤC LẠI (chủ nhà chốt).** Dự án khu public KHÔNG phải heatmap mà là
BẢNG BÁO CÁO có sẵn cột **"Các khu"** (Public Toilet 1,3 · Khối A · Main Lobby · Nhà Hàng Maxine…).
- `zonesOfSheet(sh, range)` đọc thẳng cột đó (regex `ZONE_HDR`) → danh sách khu. **Admin KHÔNG phải gõ lại.**
- `ZoneBoard` bố cục lại thành **lưới ô** (mỗi ô 1 khu) đúng form chủ nhà đưa, KHÔNG để nguyên bảng báo cáo.
- **TỰ CHỌN KIỂU, không có nút chuyển tay**: `CanMediaApp` load region 1 lần → có cột "Các khu" thì ra
  ZoneBoard, không thì ra MatrixBoard (heatmap). Nút "Ma trận / Bảng khu" đã BỎ.
- Bấm ô khu → popup media với `toa=""`, `can=<tên khu>` → `ePMP/Media/<Dự án>/<tên khu>/(Hình ảnh|Video)`.
- Admin chỉnh **SỐ CỘT** (2-5) và **KÉO MÉP DƯỚI ô để đổi chiều cao**, rồi Lưu → `spec.zones = {cols, h}`
  dưới khoá `media:zones::<maCT>`, mọi người thấy chung. `zones.names` đã BỎ (tên khu luôn lấy từ sheet).
  ⚠ **BẪY ĐÃ DÍNH**: hàm `saveSheetForm` có bộ kiểm "form rỗng thì XOÁ key"; lúc đầu nó xét
  `!s.zones?.names.length`, mà `names` nay luôn rỗng ⇒ mọi lần lưu bảng khu đều bị coi là rỗng và bị xoá
  → nút "Lưu bố cục" nhìn như không có tác dụng. Đã sửa thành `!s.zones`. Thêm trường mới vào `SheetForm`
  thì NHỚ cập nhật cả bộ kiểm này, không thì lưu xong mất trắng.
Verify: CT25-070 Nhà hàng Maxine → 18 khu đúng tên sheet; bấm "Main Lobby" → popup đúng khu.

### d6) ĐỢT 5 (04/09, sau deploy v3.88.0) — NHẬN DIỆN BẢNG TỔNG QUÁT + CHỐNG ĐẺ FOLDER TRÙNG

**SỐ CĂN KHÔNG PHẢI LÚC NÀO CŨNG 2 CHỮ SỐ.** Hyatt Regency Hạ Long (CT24-035) đánh căn `1..16` (không
đệm 0) và tầng `L6..L22` → luật cũ chỉ nhận `/^\d{2}$/` nên KHÔNG nhận ra hàng header ⇒ **heatmap hiện
ra nhưng bấm không được**. Sửa ở CẢ HAI nơi (phải đồng bộ, lệch nhau là ẩn chữ / tô ô trống sai):
- `can-media-app.tsx`: `isUnitHdr` = `/^\d{1,3}$/` hoặc `HL`; `isHeaderRow` đòi dãy **≥4** ô liền cột tăng
  đúng 1 (`UNIT_RUN`) — nới từ 2-chữ-số sang 1-3 chữ số thì phải siết độ dài run, không thì dòng số liệu
  bị nhận nhầm là header.
- `sheet-dump.ts` (`gridCell`): cùng luật `/^\d{1,3}$/` + `best >= 4`.
- **Mã căn luôn đệm 2 chữ số**: `${tầng}${pad2(đơn vị)}` → L22×"1" = **2201**, L6×"1" = **601**,
  Mini Hotel L06×"01" = **601** (không đổi). Đừng bỏ `pad2`, không thì ra "221".
- **Ô đầu hàng header chưa chắc là TOÀ**: Hyatt ghi "KHU PHÒNG" (tiêu đề cột), lấy nguyên si sẽ đẻ thư
  mục Drive tên "KHU PHÒNG". `toaOf()` chỉ nhận mã toà ngắn (B1 · A · Tháp A · Khối B), còn lại trả `""`
  = dự án 1 toà.
Kiểm chứng: Mini Hotel ra **465 ô** (B1 90 · B2 90 · B3 80 · B4 95 · B5 110) — B1/B2 KHÔNG có cột HL nên
465 mới đúng, con số 470 trước kia là đếm dư do luật cũ lỏng.

**CỘT KHU: cùng form nhưng khác chữ.** "Các khu" (NPHH) · "Các khu PUBLIC" (Villa Tulip 3) → `ZONE_HDR`
đổi thành `/^(các\s+)?(khu\s*vực|tên\s*khu|hạng\s*mục|khu)\b/i` (nhận cả đuôi phía sau).
Và `zonesOfSheet` **ưu tiên heatmap**: gọi `hasUnitBlocks()` trước, sheet nào là ma trận căn thì trả `[]`
ngay — không thì một sheet ma trận lỡ có chữ "khu" sẽ bị đổ nhầm sang bảng khu.
(Form `PUBLIC 4S` của Tây Hồ View / Chairman Villa là dạng KHÁC: cột `CĂN` + nhiều cột công đoạn — chủ
nhà chốt "mấy cái khác form thì từ từ", chưa làm.)

**⚠ GỐC RỄ VỤ FOLDER TRÙNG TÊN (quan trọng, đừng làm hỏng lại).** `driveListChildrenImpl` trước đây dùng
`ensureDbPath` = *tìm-hoặc-TẠO*. Mà `listCanMedia` đọc "Hình ảnh" và "Video" bằng `Promise.all` → hai lời
gọi SONG SONG cùng thấy thiếu thư mục căn và cùng tạo ⇒ **2 folder căn trùng tên**; app chỉ đọc được cái
đầu nên ảnh nằm folder này, video nằm folder kia. Đúng các căn từng mở popup: B4/607, B4/Hanh lang
T2·T3·T4·T6, B3/205, B1/509, B1/601, B3/208.
- Sửa: thêm `findDbPath()` / `findFolder()` = **CHỈ TÌM, KHÔNG TẠO**; `driveListChildrenImpl` dùng nó và
  trả rỗng khi thiếu. **Mọi thao tác ĐỌC phải dùng findDbPath.** Thư mục chỉ sinh ra lúc UPLOAD thật.
- Dọn hậu quả: `scripts/media-dedupe.mjs` (giữ folder nhiều file nhất, dời file sang, trash bản rỗng).
  Đã chạy 2 đợt, gộp 10 phòng trùng. **LƯU Ý: chạy lại NGAY sau `--go` có thể báo 0 do Drive chưa đồng
  bộ — chờ vài giây rồi kiểm lại.**
- Verify: mở popup 3 căn trống (B1/201·202·203) → số folder phòng đứng yên 75, dedupe báo 0.

### d7) ĐỢT 6 — POPUP MEDIA MỚI + ĐƯỜNG DẪN DÙNG CHUNG (chưa deploy)

**MỘT KHO CHUNG, 2 PHẠM VI.** `CanMediaDialog` nhận prop `scope`:
- `"can"` — bấm 1 Ô ma trận → chỉ media của phòng/khu đó.
- `"project"` — nút **“🖼 Toàn bộ media dự án”** cạnh ô chọn dự án → media CẢ dự án, **vẫn gom theo
  phòng** (mỗi nhóm có nhãn "B3 · Hanh lang T2 (1)") để người khác nhìn là biết của phòng nào.
Bố cục: khung xem LỚN (ảnh thì hiện ảnh, video thì phát video) + nút ‹ › + phím ←/→ + dải thumbnail
CUỘN NGANG ở dưới. Ở phạm vi "project", ô Toà/Phòng **chạy theo item đang xem** → bấm "＋ Tải ảnh" là vào
đúng phòng đang nhìn; vì thế thứ tự nhóm phải CỐ ĐỊNH (không đẩy "phòng đang mở" lên đầu), nếu không dải
thumbnail nhảy loạn mỗi lần bấm.
Nguồn dữ liệu = `listProjectMedia` (1 lượt quét cả dự án, trả kèm ID + ngày), **dùng chung queryKey
`["projmedia", project]` với dấu chấm ngoài ma trận** → up xong invalidate 1 lần là cả hai cùng cập nhật.

**ĐƯỜNG DẪN MEDIA CHỈ CÒN MỘT NƠI DỰNG.** Trước có 2 bộ chuẩn hoá: app Media cắt **60** ký tự, archive ảnh
của dashboard đi qua `safeName` cắt **120** ⇒ dự án tên dài (vd "Mini Hotel PQ (B1-B5) Public: Lobby - Gym
- Kid - Spa - Restaurants", 68 ký tự) rơi vào HAI folder khác tên → up bên dashboard, app Media báo "chưa
có ảnh". Nay `drive.functions` xuất **`mediaSafe()` + `mediaFolderPath()`**, mọi nơi ghi/đọc đều gọi nó.
(Bằng chứng lỗi có thật: trên Drive đang có folder tên đúng 60 ký tự
`"Tây Hồ View - Public (Tháp 4S) (Gym, Spa, Swimming Pool, ADD"`.)

**KHỚP DỰ ÁN PHẢI CHÍNH XÁC.** `wantProject` trước khớp "lỏng" (includes) và không khớp thì im lặng giữ dự
án đầu danh sách ⇒ bấm 🎬 Video ở "Mini Hotel PQ (B6-B9)" lại hiện media của "(B1-B5)". Nay chỉ khớp
CHÍNH XÁC theo tên chuẩn hoá; trượt thì hiện thẻ "dự án chưa gắn link ma trận", **không bao giờ hiện
media của dự án khác**.

**TRẠNG THÁI TẢI.** Đang tải thì ghi "Đang tải ảnh / video…" / "đang dò căn có media…", lỗi thì ghi "không
đọc được Drive" — KHÔNG được hiện "chưa có" lúc chưa tải xong (gây hiểu lầm là mất dữ liệu).

**`scripts/media-dedupe.mjs` nay quét MỌI dự án** (bỏ tham số = quét hết). Đã gộp thêm
`Nam Phương Hoàng Hậu Phòng › A/105` và `Mini Hotel › B1/606`.

### ⏭ CÒN NỢ: NEO MEDIA THEO **RID** (chủ nhà yêu cầu, CHƯA làm)
Hiện thư mục dự án trên Drive đặt theo **TÊN**. Chủ nhà muốn neo theo **RID** (mã cứng từng dòng của
Master Plan, xem `scripts/stamp-rid.gs`, `types.ts` rid) cho khỏi lẫn khi trùng/đổi tên.
Việc phải làm, có 2 chỗ ĐỘNG tới hệ thống khác nên cần chốt trước khi làm:
1. `index.tsx` (~2276) dựng `named[]` cho install list — hiện **DEDUP theo `sig = fileId|gid|formKey`**,
   nghĩa là *nhiều dự án gắn CÙNG 1 ma trận thì gộp làm 1 thẻ* (đây cũng là lý do B6-B9 không có thẻ
   riêng). Muốn media tách theo dự án thì phải thêm `rid` vào entry và dedup theo `sig|rid` →
   **MtldApp sẽ hiện 2 thẻ cho 2 dự án dùng chung 1 ma trận** (đổi hành vi app đang LIVE).
2. Thư mục Drive đổi tên thành dạng có RID (vd `<tên dự án> [R<rid>]`) → phải **đổi tên 18 folder dự án
   đang có** + giai đoạn đọc phải fallback về tên cũ, hoặc migrate 1 lần bằng script.

### d8) NEO MEDIA THEO **ID CỨNG DỰ ÁN** (đã code, CHƯA đổi tên folder Drive)

Chủ nhà yêu cầu "cắm vị trí video theo RID". RID là mã CỨNG TỪNG DÒNG; mã cứng CẤP DỰ ÁN tương ứng là
**IDCUNG** — có sẵn trên mọi dòng con dưới tên `ItemRow.projHid` (vd `"P0025"`, xem types.ts). Dùng cái này.

**Đã làm (an toàn, không đụng dữ liệu Drive):**
1. `InstallListItem` + zod + `InstallProj` thêm `hid`. `index.tsx` đẩy `hid: it.projHid`.
2. **Bỏ gộp dự án ở chỗ ĐẨY danh sách.** Trước dedup theo `sig = fileId|gid|formKey` ⇒ *nhiều dự án gắn
   chung 1 ma trận bị gộp thành 1 thẻ* — chính là gốc của việc B6-B9 ăn media của B1-B5. Nay `sig` kèm
   `projHid` nên mỗi dự án một thẻ. **MTLĐ KHÔNG đổi hành vi** vì app đó tự gộp lại bằng `dedupInstall()`
   (theo sig) lúc render — đã kiểm.
3. `projId()` của Media = `H:<hid>` khi có ID cứng, không thì lùi về `fileId|gid` như cũ. Dropdown Media
   gộp theo DỰ ÁN chứ không theo ma trận.
4. `drive.functions` thêm **`mediaProjectFolder(name, hid)`** → thư mục dự án đặt tên `"<tên> [P0025]"`.
   `mediaFolderPath(..., hid)`; `startCanMediaUpload` · `listCanMedia` · `listProjectMedia` ·
   `driveArchiveImages` (popup ảnh ePMP) đều nhận `hid`.
   **Nguồn chưa có cột IDCUNG → hid rỗng → tên thư mục TRẦN như cũ**, nên dữ liệu đang có vẫn đọc bình
   thường (đã kiểm trên dev: 3 dự án, 71 căn có media hiện đủ).

**CÒN LẠI — cần chủ nhà cho phép mới chạy:** `scripts/media-rename-hid.mjs` đổi tên 18 folder dự án đang
có sang dạng `"<tên> [ID cứng]"`. CHỈ đổi tên (id thư mục giữ nguyên → link cũ vẫn sống), không dời/xoá
file. Cần 1 file `map.json` dạng `[{name, hid}]` — lấy từ install list SAU KHI deploy (dashboard mới đẩy
`hid` lên KV). Trình tự đúng: **deploy → mở ePMP cho dashboard đẩy hid → xuất map.json → chạy dry → --go**.

### d9) LỐI VÀO MEDIA NGAY TRÊN DASHBOARD ePMP

Nút ở dòng dự án đổi từ **"🎬 Video"** (chỉ Mini Hotel, bấm là NHẢY sang app Media) thành **"🎬 Media"**
(MỌI dự án, mở THẲNG popup tại chỗ). `CanMediaDialog` được `export` để `index.tsx` dùng lại — cùng một
popup với app Media, chỉ khác `scope`:
- dashboard / nút "Toàn bộ media dự án" → `scope="project"`: cả dự án, gom theo phòng/khu;
- bấm 1 ô ma trận trong app Media → `scope="can"`: đúng phòng đó.
`projKey` = `H:<hid>` (ID cứng) hoặc `N:<tên>` — dùng làm queryKey, chung với dấu chấm ngoài ma trận.
Verify: bấm ở dòng CT25-038 → 76 media, nhóm "B1 · 609 (1)", "B2 · 508 (1)"…
Sự kiện `epmp:open-app` (app-shell vẫn nghe) giờ KHÔNG còn ai bắn từ nút này nữa — giữ lại vì là cơ chế
chung để nhảy app, đừng tưởng chết mà gỡ.

### e) Khảo sát Drive
`scripts/media-survey.mjs` (mới, CHỈ ĐỌC): in cây `Media/<dự án>/<Toà>/<phòng>/(Hình ảnh|Video)` + đếm file.
Xác nhận 04/09: B1 2 phòng · B2 6 · B3 17 · B4 7 · B5 32; mỗi phòng đủ 2 thư mục.

---

## 7. CHỨNG NHẬN ĐÃ ĐẠT (đừng làm lại từ đầu)

- Pipeline Drive chạy end-to-end qua harness node: upload → tạo folder lồng → list → đọc ảnh → PASS.
- Popup media verify trên preview với data thật đã dời: Toà B1 · Phòng 609 → hiện đúng clip trong mục Video.
- Sắp xếp Drive: xong (60 clip, mỗi phòng đủ Hình ảnh + Video, đã trash rác).

---

## 8. THỨ TỰ LÀM TIẾP (cập nhật 04/09/2026)

**ĐÃ XONG** (verify trên preview, chưa deploy):
1. ✅ Ma trận Mini Hotel hiện ra từ dropdown (localStorage/KV có sẵn dự án `CT25-038`).
2. ✅ Màu 7 bậc lên đúng + `blendText` ẩn chữ + ô trống trong lưới ra đỏ (mục 6B a/b).
3. ✅ `canAt()` suy Toà+phòng khớp layout thật, 470 ô căn, không còn phòng ma (mục 6B c).
   Click thử: B1 L06 cột "09" → **B1 · 609** (Drive: Video 1) · B3 L06 cột "HL" → **B3 · Hanh lang T6**
   (Drive: Video 1). Popup hiện đúng số video.
4. ✅ Admin chỉnh ma trận như Excel, form tách riêng khỏi dashboard (mục 6B d).
5. ✅ Chú giải màu dưới tiêu đề: đọc diễn giải từ legend của chính file, tô cùng công thức renderer.
6. ✅ Responsive điện thoại 375px: KHÔNG cuộn ngang trang, ma trận tự cuộn trong khung.
7. ✅ `ManualEntry` chỉ hiện khi dropdown rỗng (đã là fallback đúng).

**CÒN LẠI:**
- [x] ~~Công cụ chỉnh~~: đã thêm Xoá chữ (+phím Delete) · Sửa chữ hàng loạt · Bỏ đè chữ · Xoá sạch ô;
      trang rộng 1880; khung ma trận kéo đổi cỡ, nhớ cỡ. Verify: quét 10 ô → Delete xoá sạch → "Bỏ đè chữ"
      trả lại đúng 84/82/59/71/67/1/5/12/10/35 → "Hoàn tác" sạch dirty (không lưu rác vào form).
- [ ] Test **upload nhiều file** thật (ảnh + video) → chưa chạy lại ở phiên này vì sẽ ghi file rác vào
      Drive thật; xin chủ nhà cho phép rồi test + xoá file test. (Pipeline đã PASS ở phiên trước.)
- [ ] Quyết **share video** cho người không phải chủ Drive (iframe `/preview` đòi đăng nhập).
      Có `scripts/media-share-domain.mjs` — chỉ chạy khi chủ nhà đồng ý.
- [ ] Chủ nhà duyệt xong mới bật `live: true` cho app `media` + tính chuyện gộp/thay app cũ `clipcan`.
- [ ] **KHÔNG deploy** tới khi chủ nhà nói "deploy đi" (nhớ bump `APP_VERSION` + changelog khi deploy).

**Ghi chú còn mở:** các dòng tổng đầu bảng ("Tăng hôm trước", "Lũy kế", "Còn lại cần giao") có số trùng mã
trạng thái nên bị tô màu theo mã — nhìn hơi lạ. Nay admin tự **Ẩn dòng** được nên tạm để vậy; nếu muốn
chặn hẳn thì phải giới hạn lớp tô-theo-mã chỉ trong block căn (ảnh hưởng cả popup ma trận của dashboard,
cần cân nhắc kỹ).

## 9. NHẮC NHỚ (từ memory dự án)

- `feedback-preview-before-deploy`: ePMP là app LIVE; sửa xong để user duyệt localhost TRƯỚC.
- `feedback-production-quality-gate`: mọi task = production; tự test + tự chấm ≥90.
- `feedback-self-review-before-ship`: tự rà lỗi hay gặp (sticky header, z-index, overflow, OKLCH, hydration) trước khi báo xong.
- `feedback-bump-version-on-deploy`: mỗi deploy nhớ tăng APP_VERSION + changelog (chỉ khi deploy).
- `project-heatmap-standard-colors`: quy ước màu (mục 4).
- `reference-epmp-github`: repo backup private `tienthn-dotcom/epmp-baocao-tiendo` — commit+push mỗi đợt sửa.
