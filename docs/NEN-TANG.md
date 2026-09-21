# NỀN TẢNG CHUNG - CẢ BỐN BOX ĐỌC FILE NÀY

Đây là **nguồn sự thật duy nhất** của dây chuyền. Mọi con số, mọi luật, mọi bài học đều nằm ở đây và **chỉ ở đây**.

Bốn box không chép lại nội dung file này vào prompt riêng. Học được điều gì mới thì **sửa file này**, không sửa prompt của box.

Đọc file này **đầu mỗi phiên**, trước khi làm bất cứ việc gì.

---

## 1. DÂY CHUYỀN

```
PLAN  ──►  THỰC THI  ──►  TEST  ──►  REVIEW  ──►  người dùng bấm deploy
  ▲                                      │
  └────── trả về khi KHÔNG ĐẠT ──────────┘
```

| Box | Làm gì | Tuyệt đối không |
|---|---|---|
| **1 · Plan** | ra đặc tả, đo trước trên dữ liệu thật | không viết code |
| **2 · Thực thi** | viết code đúng đặc tả | không deploy, không mở rộng phạm vi |
| **3 · Test** | tìm cách làm nó gãy | không sửa code sản phẩm |
| **4 · Review** | phán quyết đạt hay không | không sửa code, không deploy |

**Bốn box nói chuyện với nhau qua `docs/BAN-GIAO.md`.** Mỗi box đọc phần của box trước, ghi tiếp phần của mình, không xoá phần người khác.

---

## 2. DỰ ÁN

App **ePMP** - bảng theo dõi tiến độ dự án, Khối Dự Án, AA Corporation.

- TanStack Start (React 19, Vite 7) trên Cloudflare Workers
- Nguồn dữ liệu: file Master Plan trên Google Drive, parse **ở máy người dùng** (Worker mà parse .xlsx 2MB là dính Error 1102)
- Kho người dùng nhập: Cloudflare KV `PMO_EDITS` · nhật ký: D1 `pmo-audit`

**App đang chạy thật.** Số trên bảng dùng để **đánh giá PM** và báo cáo lên Ban điều hành.

> Một con số sai còn tệ hơn không có số. Người chịu hậu quả là PM ngồi ngoài công trường, không phải chúng ta.

---

## 3. NHỮNG CON SỐ CỦA DỰ ÁN

| | |
|---|---|
| Người dùng mỗi ngày làm việc | 10 tới 17 |
| Thao tác mỗi ngày | 145 tới 540 |
| Dự án đang Show | khoảng 82 tới 85 |
| **Trần ghi KV** | **1.000 lượt/ngày** (gói free) |
| Đã tràn thật | 09, 10, 11/09/2026 - 1.068 · 1.143 · 1.122 |
| Tỉ lệ ghi lành mạnh | **1,3 tới 1,5** lượt trên mỗi thao tác người dùng |
| Trần CPU mỗi lượt Worker | khoảng 2.010.000 µs |
| Trần cron | 5 cái mỗi tài khoản |

Đo lại khi cần:

```bash
# lượt ghi KV theo ngày và theo kho
npx wrangler d1 execute pmo-audit --remote --command \
  "SELECT substr(ts,1,10) ngay, kho, COUNT(*) n FROM kv_write GROUP BY 1,2 ORDER BY 1, 3 DESC"

# thao tác người dùng theo ngày
npx wrangler d1 execute pmo-audit --remote --command \
  "SELECT substr(ts,1,10) ngay, COUNT(*) n, COUNT(DISTINCT email) nguoi FROM access_log GROUP BY 1"
```

---

## 4. SỔ LỖI - NHỮNG LẦN ĐÃ HỎNG THẬT

Không phải lo xa. Mỗi mục là một lần app hỏng, có ngày tháng. Đây là chỗ đáng đào nhất khi viết, khi kiểm, khi soi.

**L1 · Ký tự điều khiển lọt vào mã nguồn.** Viết code qua heredoc của shell làm `\b` thành byte 0x08, `\u0000` thành byte 0x00. Regex `/\bra…defect/` thành `/^Hra…defect/` và **lên tới production**. Lần khác hai chỗ dựng khoá dùng byte NUL thật, dán vào Apps Script bị nuốt, hai chỗ lệch nhau **trong im lặng**.
→ Viết file bằng công cụ ghi file, đừng nhồi qua shell. Viết xong **quét lại**.

**L2 · `\b` không chạy sau chữ có dấu.** `/giao\s*th[ôo]\b/` không bao giờ khớp "giao thô": ranh giới từ của regex chỉ hiểu ASCII.
→ Bỏ dấu trước rồi mới so khớp, và bỏ ở **cả hai** vế.

**L3 · Bọc binding Cloudflare bằng `Proxy`.** `put`/`delete` mất `this`, Workers từ chối "Illegal invocation". Mọi thao tác GHI hỏng sạch, không ai báo lỗi.
→ Trả object thường, gọi qua closure.

**L4 · Nâng một mục kiểm chất lượng lên mức `error`.** `assertDataQuality()` ném lỗi khi gặp bất kỳ mục error nào → cả app không nạp được dữ liệu. Ai còn cache thấy bản cũ, ai máy mới thì trắng bảng.
→ Chỉ `header` và `projects` được phép ở mức error. Đã có bộ kiểm chốt luật này.

**L5 · Ghi vào kho khi app còn đang tải.** Effect nền chạy lại mỗi khi một query vừa về, mỗi lượt tính ra payload khác nhau rồi ghi đè lẫn nhau. Riêng một kho ăn 25 lượt ghi/giờ.
→ Cổng `if (dangTaiKho > 0) return;`

**L6 · Ghi kho từ dữ liệu DEMO.** App có nhịp render rơi về demo trước khi dữ liệu thật về. Nhịp đó đẩy bản ngắn lên kho, nhịp sau đẩy bản thật đè lại - hai lượt ghi mỗi lần mở app.
→ Cổng `if (dataMode === "demo") return;`

**L7 · Đọc ô Excel mà bỏ qua định dạng.** PMO gạch ngang ngày cũ khi dời hạn: `trước ~~15/09~~ 22/09`. Đọc giá trị thường thì gạch mất, phép dò "trước dd/mm" vớ đúng ngày đã huỷ. **7 dự án hiện sai hạn trình BOD nhiều ngày.**

**L8 · RID trùng làm ghi chú nhảy dự án.** 152 số RID bị 336 dòng dùng chung; ghi chú dự án này hiện trên dự án khác.

**L9 · Cron chết vì quá CPU mỗi ngày suốt một tuần** mà không ai biết, vì không ai đi đọc log.

**L10 · Đoán một phép ánh xạ để "sửa" dữ liệu hàng loạt.** Phép đoán "dịch đều +5" sai: độ lệch thật là +1, +5, +6, và hai ghi chú đập về cùng một dòng.
→ Không chứng minh được từng cái thì không được đụng.

**L11 · Thứ làm gãy chỗ khác mà không đụng vào chỗ đó.** Thêm bộ lọc Chủ đầu tư làm thanh lọc tràn xuống 3 hàng (commit 7a26e27). Diff sạch, test xanh, và giao diện vẫn hỏng. Loại này **không soi ra được bằng diff** - phải nghĩ ra mới thấy.
→ Plan phải ghi rõ **code nào dùng chung** bị đụng tới. Test soi trúng đích hơn nhiều khi biết trước chỗ đó.

**L12 · `git add -A` quét luôn việc của box khác.** Bốn box cùng mở **một thư mục làm việc**, nên cây git là cây dùng chung. Plan chạy `git add -A` và kéo nguyên ba file đang làm dở của box Test vào commit của mình, dưới một thông điệp không nói gì về chúng (21/09/2026, đã tách lại bằng `git reset --soft`).
→ **Chỉ add đúng đường dẫn mình đã sửa.** Chạy `git status --short` trước khi commit, và không bao giờ `git add -A` / `git add .` ở dự án này.

---

## 5. LUẬT CỨNG - ÁP CHO CẢ BỐN BOX

### 5.1 Hạn mức

Thêm bất kỳ đường ghi KV nào, phải trả lời được: **một lần mở app tốn thêm bao nhiêu lượt ghi?** Không trả lời được thì chưa được viết.

Mọi effect ghi **bắt buộc** đủ hai cổng:

```ts
if (dataMode === "demo") return;      // L6
if (dangTaiKho > 0) return;           // L5
```

Thiếu một trong hai → **KHÔNG ĐẠT**, dù mọi test đều xanh.

### 5.2 Dữ liệu chưa có thì để trống

Chưa đủ dữ liệu mà cho điểm tuyệt đối là **báo cáo sai sự thật**.

- Chưa chấm được ngày nào → `null`, **không phải 0, không phải 100**
- Ô trống → *không biết*, **không phải** *bằng không* hay *thuộc nhóm còn lại*
- Trung bình → bỏ qua phần tử chưa có, không tính như 0

### 5.3 Không đoán thay người dùng

Buộc phải chọn thì chọn cách **lộ ra**, đừng chọn cách **âm thầm**. Vùng lạ thì giữ nguyên chữ gốc; mã lạ thì đưa vào nhóm "còn lại" chứ đừng bỏ rơi.

### 5.4 Ghi chú giải thích VÌ SAO

```
SAI   // Lọc dự án theo vùng
ĐÚNG  // Vùng lạ thì GIỮ NGUYÊN chữ gốc, không đoán bừa: thà lộ một nhãn lạ để người ta
      // sửa dữ liệu, còn hơn âm thầm xếp nhầm vùng rồi không ai biết.
```

Chỗ nào từng hỏng, ghi rõ hỏng ra sao và ngày nào, kèm mã lỗi trong sổ (`L7`). Không ghi thì người sau sẽ "dọn dẹp" nó và tái tạo đúng con bug.

### 5.5 Tiếng Việt

Ghi chú code, tên phép kiểm, chữ trên giao diện: **tiếng Việt**.
Thông điệp commit: **không dấu** (ASCII), kết bằng dòng `Co-Authored-By` do người dùng quy định.

### 5.6 Cây git là cây DÙNG CHUNG

Bốn box mở cùng một thư mục. Thứ bạn thấy trong `git status` có thể là việc đang làm dở của box khác.

- Commit thì **liệt kê đúng đường dẫn** mình đã sửa. **Không** `git add -A`, **không** `git add .` (xem L12).
- Thấy file lạ chưa theo dõi thì **để yên**, đừng xoá, đừng commit hộ. Hỏi qua sổ bàn giao.
- Không `git stash` khi box khác đang làm: stash cuốn luôn thay đổi của họ. Test cần stash để xác nhận phép kiểm đỏ thì **hẹn với Thực thi trước**.

---

## 6. LỆNH

```bash
npx tsc --noEmit            # kiểu, phải sạch
npx vitest run              # toàn bộ bộ kiểm
npx vitest run tests/<tên>  # một file
npm run build               # dựng
node scripts/patch-wrangler.cjs   # đóng dấu version
npx wrangler deploy         # CHỈ người dùng bấm, sau khi Review đạt
```

Kiểm trên app: dùng **công cụ preview**, không chạy dev server bằng shell. Phải kiểm ở **1440px và 375px**.

Quét byte điều khiển sau khi sửa file (xem L1):

```bash
node -e "const fs=require('fs');const x={0:'NUL',8:'BS',11:'VT',12:'FF',27:'ESC'};for(const f of process.argv.slice(1)){const b=fs.readFileSync(f);const h=[...b].filter(v=>x[v]).length;console.log(f,h?'CO '+h+' BYTE LA':'sach')}" <các file vừa sửa>
```

---

## 7. KHI NÀO PHẢI HỎI NGƯỜI DÙNG

Không box nào được tự quyết bốn việc sau:

1. Yêu cầu có **nhiều hơn một cách đọc**, và hai cách cho kết quả khác nhau
2. Đụng tới **luật tính điểm** hoặc **mốc giờ** - thứ ảnh hưởng đánh giá con người
3. **Sửa dữ liệu hàng loạt** mà không chứng minh được từng dòng (xem L10)
4. **Xoá** thứ gì đó

Còn lại thì quyết, nêu rõ đã quyết theo hướng nào trong sổ bàn giao, rồi đi tiếp.

---

## 8. HỌC ĐƯỢC ĐIỀU MỚI THÌ LÀM GÌ

Bất kỳ box nào phát hiện một cái bẫy chưa có trong sổ:

1. Thêm mục `L<số tiếp theo>` vào phần 4, kèm **ngày** và **con số đo được**
2. Nếu nó đáng thành luật, thêm vào phần 5
3. Nói rõ trong sổ bàn giao là đã thêm mục nào

Đây là thứ làm dây chuyền khoẻ lên theo thời gian. Sổ lỗi càng dày, bug lọt càng ít.
