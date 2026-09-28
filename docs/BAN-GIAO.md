# SỔ BÀN GIAO

Bốn box nói chuyện với nhau qua đúng file này.

**Luật dùng sổ:**
- Mỗi box **đọc từ đầu sổ** trước khi làm, để biết chuyện đã tới đâu
- Chỉ **ghi thêm** phần của mình, **không sửa, không xoá** phần của box khác
- Một việc xong thì chuyển cả khối xuống `docs/BAN-GIAO-CU.md` và dọn sổ này cho việc mới
- Nền tảng chung (con số, luật, sổ lỗi) nằm ở `docs/NEN-TANG.md`, **không chép lại vào đây**

---

# VIỆC ĐANG LÀM

**V11 · GIẢM LAG — ba nhánh chạy SONG SONG**
Plan mở 28/09/2026. Người dùng: *"cần 4 người ngồi lại phát triển cho app bớt lag"*.

**Đây là việc đầu tiên chạy song song.** Ba box nhận ba nhánh KHÔNG đụng nhau, làm cùng lúc, rồi gặp nhau ở cuối. Lý do đổi cách: dây chuyền tuần tự làm ba box rảnh trong lúc một box làm, và Plan đã để việc nằm chờ nhiều lần.

---

## ① PLAN — SỐ ĐO, chung cho cả ba nhánh

### Đo trên app thật (máy chủ nội bộ, đã nóng máy, dữ liệu thật 83 dự án)

```
28 luot goi may chu luc mo app  ·  TONG THOI GIAN CHO 82.442 ms

14.592 ms   listMediaProjects        <- quet Drive 5 cap
 5.718 ms   index.tsx
 5.050 ms   index.tsx
 4.657 ms   index.tsx
 4.609 ms   index.tsx
 4.581 ms   fetchUpdateHistory   ┐
 4.580 ms   fetchCompletedDates  │
 4.579 ms   fetchEdits           │  SAU luot, thoi gian GIONG HET NHAU
 4.579 ms   fetchMpFlags         │
 4.578 ms   fetchHiddenRows      │
 4.563 ms   fetchNoteAnchors     ┘
 4.046 ms   index.tsx
```

**Sáu lượt trùng nhau tới từng mili giây = chúng KHÔNG chậm, chúng BỊ XẾP HÀNG.** Đây là nghẽn cổ chai, không phải 28 chỗ chậm riêng lẻ. Sửa cái đầu có thể kéo theo cả đám.

### Đo trên production (Cloudflare, 1.476 lượt ngày 28/09)

```
CPU  p50    3.793 us  (3,8 ms)        <- Worker gan nhu khong tinh gi
CPU  p99  100.400 us
Cho  p50  206.038 us  (206 ms)        <- gap 54 lan CPU
Cho  p99  12.813.716 us (12,8 GIAY)
```

Hai phép đo **độc lập, cùng chỉ một hướng**: Worker ngồi chờ bên ngoài. Và 12,8 giây khớp cỡ với 14,6 giây của `listMediaProjects`.

### Thủ phạm số một, đã truy tới gốc

`index.tsx` gọi `listMediaProjects` lúc mở app (`staleTime` 10 phút). Hàm đó (`can-media.functions.ts:308`) **đi sâu 5 cấp qua toàn bộ thư mục Media trên Drive**:

```
for (depth = 0; depth < 5; depth++) {
  await driveListFilesByParents(level);     // goi Drive
  await driveListFoldersByParents(level);   // goi Drive
}
```
85 dự án × toà × phòng × (Hình ảnh|Video). Nó trả về **một danh sách tên dự án có ảnh** - dùng cho một dấu hiệu hiển thị. **14,6 giây cho một cái dấu.**
Chạy lại mỗi 10 phút cho **từng người**; 10-17 người thì Drive bị gọi gần như liên tục.

### Chỗ Plan CHƯA biết, nói thẳng

- Bốn lượt `index.tsx` 4-5,7 giây **chưa truy được là gì**. Có thể là mã trang, có thể là server-fn khác. Chưa đo xong.
- Số ở trên là **máy chủ nội bộ**, không phải production, và là **một máy** - máy của Plan. App **không có một phép đo thời gian nào** (`grep performance.now` ra rỗng) nên không ai biết máy người dùng thật ra sao.
- Chưa biết `listMediaProjects` có thật sự chặn năm lượt kia không, hay chúng chờ vì lý do khác. **Đó là việc của nhánh B.**

---

## BA NHÁNH, KHÔNG ĐỤNG NHAU

### NHÁNH A — box THỰC THI — giết lượt quét Drive 14,6 giây

**Việc:** `listMediaProjects` thôi quét Drive ở mỗi lượt mở app của mỗi người.

Ba hướng, Thực thi chọn và **nói rõ vì sao chọn**:
1. **Cron quét sẵn, lưu vào kho** - warmer chạy một lần, mọi người đọc kết quả. Đổi 14,6 giây của mỗi người thành một lượt quét mỗi ngày.
2. **Hoãn tới khi cần** - chỉ gọi khi người dùng mở phần Media. Màn hình chính không cần biết dự án nào có ảnh ngay lúc mở.
3. **Cả hai.**

**Ràng buộc:**
- Dấu hiệu "dự án có ảnh" **không được sai**. Mất một cái dấu thì chỉ khó chịu; **hiện sai** thì người ta mở ra rồi thấy trống, tệ hơn.
- Nếu đi hướng 1: **không được thêm đường ghi KV nào chạy theo người dùng**. Cron ghi thì được, mỗi lượt mở app ghi thì không.
- Không đụng `CanMediaDialog`, không đụng đường tải ảnh.

**Cách biết là đúng:** đếm lại 28 lượt gọi lúc mở app. Nêu **cả hai** con số: tổng thời gian chờ trước và sau. Và xác nhận dấu hiệu "có ảnh" vẫn đúng trên ít nhất 5 dự án có ảnh thật và 5 dự án không có.

### NHÁNH B — box TEST — đo cho ra chỗ nghẽn thật

**Việc:** chứng minh hoặc bác bỏ giả thuyết "sáu lượt kia bị xếp hàng sau `listMediaProjects`".

Đây **không phải** việc viết phép kiểm. Đây là việc đo. Bốn câu cần trả lời bằng số:
1. Sáu lượt `fetch*` kia **bắt đầu** lúc nào, **kết thúc** lúc nào? Trùng thời gian vì xếp hàng, hay vì cùng chờ một thứ?
2. Bốn lượt `index.tsx` 4-5,7 giây **là gì**? Plan chưa truy được.
3. Bỏ `listMediaProjects` ra (chặn tạm ở máy) thì 27 lượt còn lại mất bao lâu? **Đây là phép đo quyết định** - nó nói cho cả đội biết nhánh A đáng giá bao nhiêu.
4. Có lượt nào **chờ lẫn nhau** không - tức phải xong cái này mới chạy cái kia?

**Không sửa code sản phẩm.** Đo xong báo số.

### NHÁNH C — box REVIEW — gắn đồng hồ vào app

**Việc:** app **không có một phép đo thời gian nào**. Mọi số của cả đội đều từ máy Plan. Gắn ba mốc, ghi vào bảng D1 sẵn có (đang dùng 0,65% hạn mức, **không đụng trần KV**): tải trang xong, dữ liệu về xong, đọc xong file nguồn.

Đây là nhánh **quan trọng nhất về lâu dài**: không có nó thì lần sau lại đoán.

**Ràng buộc:**
- **Không bao giờ ném lỗi**, không chặn đường nào. Nó chạy ở mọi lượt mở app - hỏng thì bỏ qua, y như `demGhiKv`.
- **Không ghi lên KV.** D1 thì được.
- Không ghi thêm thứ nhận dạng cá nhân ngoài những gì nhật ký **đã** ghi.
- Vai Review vốn không sửa code sản phẩm. Lần này **được phép**, vì đây là việc đo chứ không đổi hành vi, và vì cả đội đang mù. Nói rõ trong mục ④ là đã sửa gì.

**Cách biết là đúng:** một ngày sau, một câu SQL ra được bảng thời gian **theo người và theo giờ**.

---

## GẶP NHAU Ở CUỐI

Nhánh A ra bản sửa, nhánh B ra số chứng minh bản sửa đáng giá bao nhiêu, nhánh C ra đồng hồ để đo trên máy người dùng thật.
**Không deploy nhánh nào một mình.** Gộp lại, Plan soát, rồi người dùng bấm.

**Thứ tự nếu phải chọn:** A trước (cắt nhiều nhất), C ngay sau (để lần sau khỏi đoán), B chạy song song vì nó không đụng code.

---























---

## ② THỰC THI

> *Mục ② của các việc trước nằm trong thông điệp commit: V4a/V4b `c188f92` · `a914b2f` · `f9c901b`,
> V5 `72ea874` · `5fe969d` · `426e60c`, V6 `6e7c903` · `6c43124`, V8a `bce0f29`,
> V10 `46f7da8`, đổi nhãn PMO→OCC `1c311a4`.*

# V11 · NHÁNH A — thôi quét Drive 14 giây ở đường mở app

Commit `e022600` (bản sửa) và `5439316` (sửa một câu ghi chú sai). **Không deploy.**

**ĐÃ LÀM**

`src/lib/can-media.functions.ts`:
- Thêm `getMediaCoAnh` — **đọc kho** `media:coanh:v1`, không quét Drive.
- Tách phần quét Drive thành `quetMediaCoAnh()` dùng chung; `listMediaProjects` giữ lại làm đường
  quét thật cho cron / lúc cần số tươi.
- Kho quá hạn (6 giờ) → trả bản cũ **ngay**, quét lại ở nền, có ghim chặn quét chồng trong cùng isolate.

`src/routes/index.tsx`: đổi truy vấn `["media-projects"] → ["media-co-anh"]`, gọi `getMediaCoAnh`.
Thêm mục CHANGELOG `v3.115.0`.

**TỰ ĐO LẠI TRƯỚC KHI SỬA, không tin con số của người khác**

`listMediaProjects()` = **14.167 ms**, trả về đúng **2 tên dự án**. Mười bốn giây quét Drive cho
một cái dấu hiệu, chạy lại mỗi 10 phút, cho từng người. Đường đọc kho đo được **7 ms**.

**HỎNG VỀ PHÍA AN TOÀN — chỗ này tôi phải sửa lại sau khi đo**

Bản đầu: kho rỗng → trả mảng rỗng, quét ở nền. Chạy dev mới phát hiện **không có binding KV**, nên
kho không bao giờ được ghi và **mọi dấu 🎬 biến mất vĩnh viễn mà không ai báo**.

Nay: kho rỗng → **quét ngay tại chỗ** rồi mới trả. Lượt đầu sau mỗi cửa sổ 6 giờ vẫn tốn ~14 giây
đúng như hôm nay, nhưng **không bao giờ tệ hơn hôm nay**, và mọi lượt sau chỉ còn ~7 ms.
Đổi 14 giây của **một người mỗi 6 giờ**, lấy 14 giây của **mọi người mỗi 10 phút**.
Quét hụt (Drive lỗi) thì **không** ghi đè danh sách cũ bằng mảng rỗng.

**HAI HƯỚNG RƠI KHÔNG ĐỐI XỨNG — và mặc định nghiêng đúng phía an toàn** (điểm box Test nêu)

Kho chưa sẵn sàng → không tên dự án nào trong danh sách → **không dự án nào có dấu**. Tức rơi về
phía **mất dấu** (chỉ khó chịu), không bao giờ rơi về phía **hiện dấu sai** (mở ra thấy trống).
Không có đường nào sinh ra tên dự án mà không phải từ một lượt quét Drive thật.

**DẤU HIỆU KHÔNG THỂ SAI LỆCH VÌ KIẾN TRÚC:** `getMediaCoAnh` trả về **đúng cái mảng** mà
`listMediaProjects` vẫn trả, cho **đúng chỗ dùng**. Khác biệt duy nhất là chỗ cất.
Đối chiếu trên app: vẫn đúng 2 dự án (CT26-060, CT25-038); trên bảng chính đúng **CT25-038 có dấu
🎬 và 59 dự án còn lại không có**.

**CÂU PLAN HỎI — ba lượt ghi có chạy sớm hơn hoặc nhiều hơn không?**

**Sớm hơn, không nhiều hơn.** Đo một lượt mở app trên bản sửa:
```
media             @  9.295 ms
saveProjRegions   @ 23.796 ms
saveInstallList   @ 23.798 ms      mỗi hàm ĐÚNG 1 lượt
saveMediaProjects @ 23.799 ms
```
Ba lượt ghi nằm sau cổng `dangTaiKho > 0`, mà cổng đó chỉ mở khi mọi truy vấn xong — kể cả lượt
media. Ở production media trả về ~7 ms nên chúng sẽ chạy **sớm hơn ~14 giây**, cùng số lượt.

Phép đo độc lập củng cố: ở V10, khi chuyển app qua lại thì media được phục vụ từ bộ nhớ (đã tức
thì sẵn), và ba hàm vẫn ra **1 lượt mỗi lần mount**. Nên kịch bản "media nhanh làm cổng mở sớm rồi
effect chạy nhiều lần" — đúng bẫy **L5** — **không xảy ra**.

**MỘT CÂU GHI CHÚ SAI CỦA CHÍNH TÔI, đã sửa ở `5439316`**

Bản đầu tôi viết lượt media "chặn hàng sáu hàm `fetch*` của edits.functions". Đó là lý do tôi
**chép lại từ Plan mà không tự kiểm** — đúng loại sai mà chính tôi đã bắt lỗi Plan hai lần trong
ngày. Box Test đo waterfall và bác: **17 lượt đọc xong hết ở mốc 1.275 ms**, chúng không chờ gì.
Thứ nó thật sự chặn là **ba lượt ghi**. Kết luận "nên bỏ lượt media" không đổi, nhưng lý do sai nằm
trong ghi chú thì người sau sẽ tin nó.

Mức đáng giá (số của box Test): bỏ lượt media ra thì khung mở app **14.346 ms → 2.880 ms**; mọi thứ
không dính media đã xong từ mốc **4.047 ms**.

**ĐÃ ĐO**
```
tsc                   : sạch
vitest                : 455 passed | 2 expected fail | 0 failed | 34 file
build                 : qua
quét byte điều khiển  : 16 byte toàn cây = mốc nền (1 byte trong can-media.functions.ts là của sẵn,
                        thuộc việc V1 — tôi không thêm byte nào)
ghi KV thêm mỗi lần mở app : 0. Lượt ghi duy nhất phát sinh là 1 lượt mỗi 6 giờ khi làm mới kho,
                        KHÔNG chạy theo số người dùng.
```

**CHỖ TÔI KHÔNG CHẮC**

1. **Không nghiệm thu được đường đọc nhanh end-to-end.** Dev không có binding KV nên `khoKv()` trả
   `null`, kho luôn rỗng, và nó luôn rơi vào nhánh quét tại chỗ. Con số 7 ms là đo lượt đọc KV thật
   lúc kho chưa có gì. **Phải chạy ở nơi có KV mới xác nhận được**, và phép đo đúng là: lượt đầu
   sau 6 giờ tốn bao lâu, các lượt sau tốn bao lâu. Ai nhìn số localhost rồi kết luận "sửa xong vẫn
   15 giây" là đang đo một thứ khác.
2. **Chỗ đúng đắn hơn cho việc quét là cron của warmer** (cron ghi, người dùng chỉ đọc). Tôi không
   làm vì warmer là worker riêng phải deploy riêng. Đã ghi rõ trong code: khi cron nhận việc này thì
   bỏ khối làm mới ở nền đi, phần đọc giữ nguyên.
3. **Cửa sổ 6 giờ là tôi chọn**, không phải số đo. Dữ liệu đổi khi có người tải ảnh lên — tôi không
   đo được nhịp đó. Thấy chưa hợp thì đổi một hằng số.

**CHƯA LÀM**

- **Không đụng** hai lượt ghi KV mỗi lần mở app ở `mtld-install.functions.ts:257` và `:358` — Plan
  xếp thành việc riêng. *Bổ sung một điểm cho lúc đo:* chúng đi qua `putNeuKhac` nên **gọi không
  đồng nghĩa với ghi**; số lượt ghi thật chỉ bằng số lần nội dung đổi, phải đọc bảng `kv_write`
  trên D1 mới biết.
- **Không deploy.** Đúng lệnh: đang giờ mọi người làm báo cáo.

---

## ③ TEST

### V11 · NHÁNH B — ĐO. Không phải phán quyết.

Đo trên dev server đang chạy ở cổng 8080 (của box khác, tôi dùng chung, **không sửa `launch.json`**),
1440px, dữ liệu thật. Ba lượt tải nguội. Số lấy từ Resource Timing: `startTime`, `requestStart`,
`responseEnd` của từng lượt, không chỉ `duration`.

**ĐIỀU QUAN TRỌNG NHẤT, ĐỌC TRƯỚC MỌI CON SỐ: dev KHÔNG CÓ binding KV, nên nhánh A không đo được ở
đây.** `getMediaCoAnh` chỉ nhanh khi đọc được bản đã lưu trong KV; `khoKv()` trả `null` trong dev nên
nhánh "kho trống → quét ngay tại chỗ" chạy **mọi lượt**. Bằng chứng không phải ghi chú trong code mà
là số đo: hai lượt tải liên tiếp cách nhau vài phút đều tốn 16,2 s rồi 14,4 s. Nếu KV có tác dụng thì
lượt thứ hai đã phải ~7 ms. **Mọi kết luận "nhánh A không nhanh hơn" rút từ máy này đều SAI** — phải
đo trên môi trường có KV.

**BA LƯỢT TẢI**

| | Lượt 1 (code cũ) | Lượt 2 (nhánh A) | Lượt 3 (nhánh A) |
|---|---|---|---|
| Hàm media | `listMediaProjects` | `getMediaCoAnh` | `getMediaCoAnh` |
| Thời gian của nó | **14.208 ms** | **16.229 ms** | **14.393 ms** |
| Lượt fetch | 23 | 24 | 20 |
| Tổng thời lượng cộng dồn | 18.699 ms | — | 19.123 ms |
| Khung từ lượt đầu tới lượt cuối | 14.346 ms | — | ~15.200 ms |

Giữa lượt 1 và lượt 2, nhánh A đáp xuống cây (`src/lib/can-media.functions.ts` và `index.tsx` đang
sửa dở, **chưa commit**) — nên tôi đo được cả trước lẫn sau, tình cờ.

**CÂU 1 — sáu lượt `fetch*` 4.578 ms: KHÔNG tái hiện được, và giả thuyết xếp hàng KHÔNG đứng vững**

Trên máy này sáu hàm đó chạy **15 tới 61 ms**, không phải 4.578 ms.

Quan trọng hơn: ở lượt 1, **17 lượt khởi động trong vòng 1 ms của nhau** (1.209–1.210 ms), và thời
gian chờ kết nối (`requestStart − startTime`) của chúng là **2 tới 52 ms**. Nếu trình duyệt giới hạn
6 kết nối mỗi host thì 11 lượt phải nằm chờ hàng giây. Chúng không chờ. **Trình duyệt không hề xếp
hàng chúng lại** — giả thuyết của Plan không khớp với số đo.

Giả thuyết thay thế, khớp với dữ liệu của Plan hơn: sáu lượt ấy **cùng được thả ra một lúc** vì
chúng cùng chờ **máy chủ**, không phải chờ trình duyệt. Dev server là một tiến trình Node đơn luồng;
lượt quét Drive nặng chiếm vòng lặp sự kiện thì mọi lượt tới sau đều đứng đó tới khi nó nhả, rồi
được phục vụ gần như đồng thời — đúng chữ ký "sáu lượt trùng nhau tới từng mili giây". Trên máy này
sáu lượt ấy **thắng cuộc đua**: chúng xong ở 1.275 ms trong khi lượt quét chạy tới 15.417 ms.

Cách kiểm giả thuyết này: đo lại trên máy của Plan và xem sáu lượt ấy **kết thúc** lúc nào. Nếu cùng
kết thúc trong vài mili giây của nhau thì là chờ máy chủ; nếu kết thúc rải đều thì là chuyện khác.
`duration` không phân biệt được hai cảnh đó, `responseEnd` thì có.

**CÂU 2 — bốn lượt "index.tsx" 4–5,7 giây KHÔNG phải server-fn**

Chúng là lượt kiểu **`script`**: trình duyệt xin Vite dev server trả về chính file mã nguồn đã biên
dịch.

```
/src/routes/index.tsx?tsr-split=component   2.218.285 byte   2.807 ms  (sau khi file bị sửa)
/src/routes/index.tsx                       1.115.262 byte      62 ms
/src/routes/index.tsx?tsr-split=component   2.218.285 byte      30 ms  (máy đã nóng)
```

Cùng một đường dẫn, lúc 2.807 ms lúc 30 ms — khác nhau ở chỗ module đã được biên dịch sẵn hay chưa.
Vì thế chúng không giải mã ra tên hàm: **chúng không có tên hàm**. Và **production không có chúng**:
bản dựng ra phục vụ gói đã đóng, không biên dịch tại chỗ.

→ Một phần đáng kể trong 82.442 ms của Plan là **chi phí của môi trường dev**, không phải độ trễ
người dùng thật chịu. Tối ưu theo con số đó là tối ưu một cái bóng.

**CÂU 3 — PHÉP ĐO QUYẾT ĐỊNH: lượt quét media chiếm gần trọn khung thời gian**

Tôi **không chặn được** `listMediaProjects` đúng lúc tải: bẫy `fetch` của tôi gắn được sớm nhất ở
3.710 ms, còn lượt gọi bắt đầu ở 1.209 ms. Và "Làm mới" **không** chạy lại hàm media nên không dùng
làm phép đo thay thế được. Nói thẳng: phép chặn Plan yêu cầu, tôi không làm được bằng cách không
đụng vào mã nguồn.

Nhưng waterfall trả lời thẳng câu hỏi, vì nó cho biết **cái gì xong lúc nào**:

```
lượt fetch đầu tiên      1.167 ms
17 lượt đọc xong hết     1.275 ms
getLinksUpdatedAt xong   2.650 ms
fetchSheetXlsx xong      4.047 ms   <- MỌI THỨ KHÔNG DÍNH MEDIA ĐÃ XONG Ở ĐÂY
listMediaProjects xong  15.417 ms
ba lượt save* xong      15.513 ms
```

**Bỏ lượt media ra thì khung 14.346 ms còn 2.880 ms — giảm khoảng 11,5 giây, tức 80%.** Trả lời
đúng câu Plan hỏi: đây là cảnh "giảm 60 giây", không phải cảnh "giảm 14 giây". Nó **không** chặn 17
lượt đọc kia (chúng xong từ giây đầu), nhưng nó chiếm gần trọn khung thời gian và chặn ba lượt ghi.

**CÂU 4 — CÓ, đúng ba lượt chờ lẫn nhau, và cả ba là lượt GHI**

`saveProjRegions` · `saveInstallList` · `saveMediaProjects` khởi động **81 ms** sau khi hàm media kết
thúc, ở **cả ba lượt tải** (15.498 sau 15.417 · 21.916 sau 21.828 · 15.168 sau ~14.400+672). Không
lượt nào khác chờ lượt nào.

Đáng chú ý cho phần hạn mức, không thuộc câu Plan hỏi nhưng phải nói: hai trong ba lượt ấy gọi
`putNeuKhac` vào `PMO_EDITS` (`mtld-install.functions.ts:257` và `:358`), tức **ghi KV mỗi lần mở
app**. Trong dev không có KV nên chúng là lượt rỗng, còn trên production thì không. Với 10–17 người
và trần 1.000 lượt ghi/ngày, đây là chỗ đáng đo riêng.

**CHƯA ĐO ĐƯỢC**

- **Nhánh A có nhanh hơn không.** Không đo được ở dev vì thiếu KV. Cần đo trên môi trường có KV, và
  phép đo phải là: lượt đầu sau 6 giờ tốn bao lâu, các lượt sau tốn bao lâu.
- **Lượt chặn media đúng lúc tải.** Không làm được nếu không đụng mã nguồn.
- **Máy người dùng thật và production.** Mọi số trên là một máy, một dev server, một mạng.
- **Vì sao máy Plan ra 4.578 ms còn máy này ra 15–61 ms cho cùng sáu hàm.** Mới có giả thuyết, chưa
  có phép đo phân giải được.

---

### V5 — `72ea874` + `5fe969d` — **ĐẠT KÈM LƯU Ý**

Đo trên **app thật đang chạy**, không chỉ đọc code. Hành vi qua ba lần tải trang đúng cả ba, sáu số
đầu trang đứng yên tuyệt đối, dữ liệu rác không làm trắng bảng. Lưu ý lớn nhất: **đặc tả đòi một
phép kiểm mà V5 không có phép kiểm nào**.

**CÁCH ĐO.** Cổng 8080 đã có dev server của box khác. Tôi **không** sửa `launch.json` (cấu hình dùng
chung, và cổng đó có thể đang cần cho callback Google) — dùng luôn server đó, nó chạy đúng cây này.

**PHÉP ĐO CHÍNH — ba lần tải trang, 1440px**

| Trạng thái kho | Sau khi tải xong | Nút hiện chữ | Đạt |
|---|---|---|---|
| xoá sạch khoá (máy mới) | **BẬT** | `✓ Đang hiện việc đã xong` | ✓ |
| tắt bằng nút rồi tải lại | **TẮT** | `Hiện tất cả đầu việc` | ✓ |
| bật rồi tải lại | **BẬT** | `✓ Đang hiện việc đã xong` | ✓ |

Lượt bấm nút thật sự ghi kho: bấm một cái, `pmo.master.showdone.v1` đổi `"1"` → `"0"` ngay.

**SÁU SỐ ĐẦU TRANG — đứng yên tuyệt đối**

Đo trước và sau khi bấm nút **trong cùng một lượt** (không so với số của box khác — dữ liệu sống,
số đổi theo giờ): `69 · 80 · 58 · 87 · 7 · 36` cả khi bật lẫn khi tắt, cả khi nhóm đang thu lẫn khi
đã mở hết. Đúng như Thực thi báo, chỉ khác con số vì đo cách nhau vài giờ.

**(4) LỜI TRONG GHI CHÚ Ở `index.tsx:3406` — ĐÚNG, và đúng vì một lý do MẠNH HƠN lời nó tự nhận**

Ghi chú nói việc đã xong *có* đi tới KPI, an toàn là nhờ nó không mang nhãn cảnh báo. Tôi truy tới
chỗ tính nhãn: `alertKind` có nhánh `isDone ? "none"` đứng **trước** luật ép-trễ, và
`isDone = pctActual != null && pctActual >= 100` — đúng bằng điều kiện `doneEnriched` dùng để lọc.
Nên việc đã xong **không thể** mang nhãn cảnh báo. Đây là **code chặn**, không phải may mắn của dữ
liệu. Không tìm được đường nào làm một việc đã xong mang nhãn cảnh báo.

**MỘT GIẢ THUYẾT TÔI ĐÃ TRUY VÀ LOẠI TRỪ** — ghi lại để Review khỏi mò lại.

`parser.ts:918` bỏ dòng ≥100% khỏi `data.items` **chỉ khi nó không suspect**:
`if (!actNorm.suspect && pctActual != null && pctActual >= 100) continue;`. Tôi ngờ một dòng vừa
suspect vừa ≥100% sẽ nằm trong **cả** `items` lẫn `allItems`, và khi bật nút thì
`enriched.concat(doneEnriched)` cho ra **dòng lặp** — mà nay mặc định bật nên ai cũng thấy.

**Không xảy ra.** `normPctStrict` trả `{ value: null, suspect: true }` — hễ suspect thì `pctActual`
là `null`, mà `doneEnriched` đòi `pctActual >= 100`. Dòng suspect không bao giờ vào tập thứ hai.
Vế `!actNorm.suspect` ở dòng 918 thực ra là thừa, nhưng thừa vô hại.

**(5) `tableProjectCount` nhánh CÓ LỌC — xác nhận Plan đúng, và nói thẳng chỗ tôi không chốt được**

Nhánh có lọc đếm `new Set(sortedAlerts.map(pkItem)).size`. Một dự án mà **mọi** đầu việc đều đã xong
thì chỉ xuất hiện khi bật nút, nên số dự án **sẽ** tăng. Đây là tính chất của code, đọc ra được chứ
không cần dữ liệu. Hôm nay không có dự án nào như vậy nên số đứng yên.

**Tôi không dựng được phép kiểm cho nó**, và lý do đáng ghi: `tableProjectCount` cùng `pkItem` nằm
**bên trong thân component** `index.tsx`, không export, không gọi từ ngoài được. Muốn chốt thì phải
kéo phép đếm ra một hàm thuần — cùng loại việc với chỗ dựng cột mà Plan đã xếp hàng đợi ở V4a.

**DỮ LIỆU RÁC (3) — bốn mẫu, đều rơi về mặc định BẬT, không trắng bảng, không ném lỗi**

| Ghi vào khoá | Kết quả | Trang dựng ra |
|---|---|---|
| `""` chuỗi rỗng | BẬT | đủ, 20.623 ký tự · 70 dòng |
| `"true"` | BẬT | đủ, như trên |
| JSON dài 5.014 ký tự | BẬT | đủ, như trên |
| xoá hẳn khoá | BẬT | đủ, như trên |

Đúng như code: chỉ nhận `"0"` và `"1"`, còn lại coi như chưa có gì.

**(2) LỆCH HYDRATION — có cảnh báo trong console, nhưng KHÔNG phải của V5**

Đây là chỗ Plan dặn soi kỹ nhất, và nó suýt thành báo động nhầm. Mở app với kho `"0"` (khác mặc
định) thì console **có** lỗi `A tree hydrated but some attributes...`. Nhưng tôi chạy **đối chứng**
với kho `"1"` — tức `showDone` không hề đổi giá trị — và vẫn ra **10** lỗi y hệt.

Toàn bộ lệch nằm trên thuộc tính `data-tsd-source` do công cụ dev chèn, lệch số dòng/cột giữa bản
máy chủ và bản trình duyệt, ở `__root.tsx` lẫn `index.tsx`. Không một dòng nào nhắc `showDone`. Đây
đúng là con lỗi dev có sẵn mà Thực thi đã khai từ vòng V2b. **Khuôn `useState` + `useEffect` chép
đúng và không sinh lệch mới.**

**CHI PHÍ VẼ THÊM — Thực thi khai chưa đo, tôi đo được**

| | Dòng `<tr>` | Nút DOM |
|---|---|---|
| Mặc định (nhóm còn thu), tắt hay bật | **70** | 3.403 |
| Mở hết nhóm, **tắt** | 374 | 16.362 |
| Mở hết nhóm, **bật** | **574** | **24.518** |

Hai điều rút ra. Thứ nhất: **mặc định không tốn gì cả** — nhóm còn thu thì dòng đầu việc chưa được
dựng, bật hay tắt đều đúng 70 dòng. Nỗi lo "vẽ thêm 199 dòng cho mọi người mỗi lần mở app" **không
xảy ra ở lượt mở app**. Thứ hai: chi phí chỉ đến khi bấm "Mở tất cả", và khi đó là **+200 dòng,
+8.156 nút DOM, khoảng +50%**. Con số +200 khớp với 199 đầu việc Thực thi đếm được.

**CHẠY**

```
vitest : 433 passed | 2 expected fail | 32 file   — KHÔNG phép nào đang xanh bị đỏ
tsc    : sạch
375px  : scrollWidth = clientWidth = 375, không tràn ngang
1440px : bảng bình thường, badge v3.111.0
```

**LỖI TÌM ĐƯỢC**

**① · Tiêu chí 7 của đặc tả CHƯA ĐẠT: V5 không có một phép kiểm tự động nào — MỨC: NÊN SỬA**

Đặc tả đòi *"thêm phép kiểm cho hàm đọc/ghi lựa chọn"*. Đo lại: `grep -ril showDone tests/` ra
**rỗng**, và hai commit V5 **không đụng tới thư mục `tests/`**. Bộ kiểm đi từ 431 lên 433 là nhờ hai
commit V4b trước đó, không phải nhờ V5.

Nguyên nhân là cấu trúc chứ không phải lười: phép đọc/ghi nằm **inline trong thân component**, không
export, nên không có gì để gọi từ bộ kiểm. Cùng đúng một hình dạng với lỗi ⑤ ở trên và với chỗ dựng
cột của V4a — ba lần liên tiếp cùng một nguyên nhân.

Tôi **không** viết một phép kiểm chép lại logic đó sang file kiểm: chép là tạo ra bản thứ hai rồi
hai bản trôi xa nhau, đúng cái bẫy đã ghi nhận ở V4a. Đề nghị Plan xếp một việc gọn: kéo
`docShowDone()` / `ghiShowDone()` ra một hàm thuần, rồi bộ kiểm gọi thẳng.

Không chặn, vì hành vi đã được đo trực tiếp trên app ở bảng trên — nhưng phép đo ấy **làm tay,
không tự lặp lại**, đúng thứ sẽ mục đi sau vài vòng.

**② · Người đã tắt sẽ thấy bảng đầy đủ LOÉ LÊN rồi co lại — MỨC: LƯU Ý, là hệ quả bắt buộc**

Bắt được lúc đo: ngay sau khi tải trang với kho `"0"`, nút vẫn hiện `✓ Đang hiện việc đã xong`, rồi
mới đổi sang `Hiện tất cả đầu việc` khi `useEffect` chạy. Tức lượt vẽ đầu luôn theo **mặc định BẬT**,
bản đã lưu chỉ tới sau.

Đây **không phải lỗi** — nó là cái giá của chính ràng buộc 1, và ràng buộc 1 tồn tại để tránh lệch
hydration, thứ tệ hơn nhiều. Bề rộng cột cũng đang nháy y như vậy. Nhưng nay mặc định đổi từ tắt
sang bật nên cái nháy này **mới xuất hiện với nhóm người thích bảng gọn**, và họ là nhóm duy nhất
gặp nó. Nói ra để Review và người dùng biết trước, đừng để ai báo "app bị giật" rồi cả đội đi tìm.

**CHƯA KIỂM ĐƯỢC**

- **Cửa sổ ẩn danh thật.** Tôi giả lập được kho trống, nhưng không giả lập được trường hợp trình
  duyệt **chặn hẳn** `localStorage` khiến `getItem`/`setItem` **ném lỗi**. Đọc code thì cả hai chiều
  đều bọc `try/catch` nên đường đi rõ ràng, nhưng tôi không chạy thật được. Y như Thực thi đã khai.
- **Chi phí trên máy yếu.** Tôi đếm được +8.156 nút DOM khi mở hết nhóm, nhưng không đo được thời
  gian vẽ trên máy người dùng thật. "Không thấy chậm trên máy tôi" vẫn không phải một phép đo.
- **Người dùng quen bảng gọn phản ứng ra sao.** Ngoài tầm bộ kiểm.

---

### V4a + V4b — `c188f92` · `8763e2a` · `a914b2f` · `a8119f2` — **ĐẠT KÈM LƯU Ý**

Không tìm được lỗi nào chặn được hai bản này. Luật 5.2 **giữ đúng ở tầng file** cho cả phần số lẫn
phần nhìn: ô % chưa đo không có `<v>` trong XML, ô đo được 0 có `<v>0</v>`. Năm lưu ý bên dưới, và
một việc tôi tự làm sai phải nhận.

**TÔI TỰ LÀM ĐỔ CÂY CHUNG — nhận trước khi nói chuyện khác.** Bản sửa dở của tôi ở
`tests/matrix-reader.test.ts` gọi biến `wbChung` chưa khai, để nguyên trong cây dùng chung một lúc và
làm cả bộ kiểm đỏ. Plan phải nhắc. Đã sửa xong ở `2ba7ebd`. Hai chuyện rút ra: **đừng để file sửa dở
qua đêm trong cây bốn box dùng chung**, và `L15` đúng một cách đau — `tsc` báo sạch exit 0 ngay trong
lúc file kiểm gọi biến không tồn tại, vì `tsconfig.json` không phủ `tests/`.

**ĐÃ VIẾT**

12 phép kiểm trong `tests/excel-nhin-ranh-gioi.test.ts`, soi ở **tầng hành vi**: dựng file `.xlsx`
thật qua `exportTableXlsx`, rồi đọc ngược — hai đường, `exceljs` cho đối tượng và `fflate` cho **XML
thô**, vì thứ Excel đọc là file chứ không phải đối tượng trong bộ nhớ.

*Đã xác nhận ĐỎ trên bản chưa sửa: **có**.* Không `git stash` (luật 5.6). Dựng bản V4a từ
`git show c188f92:src/lib/excel-export.ts` ra file tạm rồi chạy phép kiểm lên nó: bản đó có **0** lời
gọi `addConditionalFormatting`, phép kiểm **ĐỎ** (`expected 0 to be greater than 0`). Xoá file đo ngay.

**RANH GIỚI ĐÃ SOI**

| Ranh giới | Kết quả |
|---|---|
| **Ô % chưa đo · đo được 0 · đo được 85** | `null` → thẻ tự đóng không `<v>` · `0` → `<v>0</v>` · `85` → `<v>85</v>`. Ba trạng thái **không bị gộp** |
| Định dạng trên ô trống | ô trống **không** đóng `0"%"`; ô 0 thì có — đóng vào ô rỗng là mời Excel vẽ ra một con số |
| Thang data bar vs lối lưu số | `cfvo` = 0..100 **và** ô lưu `85` — chốt cả cặp trong một phép kiểm, không thể đổi lệch một đầu |
| Vùng tô vs khối chú giải | `G4:G9` và `H4:H9` dừng đúng dòng dữ liệu cuối; khối `CHÚ GIẢI` nằm **sau** đó |
| Ngưỡng quá hạn | bậc nặng = `String(OD_ALERT_DAYS)` lấy từ `lib/filter`, bậc nhẹ = `0`. Đúng **hai** bậc, không có `colorScale` |
| Màu chú giải vs màu ô thật | ba màu `STATUS_FILL` dùng trong bảng đều có ô chú giải mang đúng màu đó, so ở tầng file |
| Chiều cao dòng | dòng dữ liệu **không** bị đặt chiều cao tay (điều kiện cần để Excel tự giãn) |

**(c) Ngưỡng khai một chỗ — xác nhận.** `OD_ALERT_DAYS = 14` chỉ khai ở `src/lib/filter.ts:34`.
`excel-export.ts` nhận qua tham số `overdueAlertDays`, không đặt số mới. `IMMINENT_DEADLINE_DAYS`
cũng bằng 14 nhưng là khái niệm khác, không phải bản chép.

**CHẠY**

```
vitest : 431 passed | 2 expected fail | 32 file      (mốc nền 419 | 2 | 31 → chênh +12 đúng phần tôi thêm)
tsc    : sạch — NHƯNG xem lỗi ④, dòng này chưa bao giờ nói gì về tests/
quét byte điều khiển : file mới sạch
```

Mốc nền dịch từ 418 lên 419 giữa lúc tôi làm, vì Thực thi commit `a8119f2` xen vào. Đã đo lại thay
vì trừ nhẩm.

**LỖI TÌM ĐƯỢC**

**① · `exceljs` KHÔNG ghi `showValue` / `minLength` / `maxLength` vào file — MỨC: NHẸ**

Đo từ XML thô của file thật. Khối `<dataBar>` xuất ra chỉ có đúng thế này:

```xml
<dataBar><cfvo type="num" val="0"/><cfvo type="num" val="100"/><color rgb="FF5EE9B5"/></dataBar>
```

Ba tuỳ chọn `showValue: true, minLength: 0, maxLength: 100` mà code khai **không có một attribute nào
tới được file** — chuỗi `showValue` không xuất hiện ở đâu trong `sheet1.xml`. Excel sẽ vẽ theo mặc
định của nó, không theo con số code ghi.

Hôm nay vô hại vì mặc định trùng ý muốn ở chỗ quan trọng nhất (vẫn hiện số trong ô). Nhưng ghi chú
trong code đang lập luận *dựa vào* ba tuỳ chọn đó, và ai sau này đặt `showValue: false` hay sửa
`minLength` sẽ thấy file không đổi gì mà không hiểu vì sao. Đã chốt bằng một phép kiểm dán nhãn
**BẪY** — nó đỏ khi nào exceljs bắt đầu ghi chúng, lúc đó đọc lại ghi chú.

**② · `oNgay` quy một ngày SAI thành một ngày KHÁC mà trông có thật — MỨC: LƯU Ý (đã đo, chưa xảy ra)**

Việc V4a. `oNgay` cắt chuỗi rồi `new Date(Date.UTC(y, m-1, d))`. `Date.UTC` **quy tràn** thay vì từ
chối: `"2027-02-29"` ra **01/03/2027**, `"2026-02-31"` ra **03/03/2026**.

Bản cũ ghi chữ `"31/02/26"` — sai nhưng **lộ ra**, người đọc thấy ngay là dữ liệu bẩn. Bản mới ghi
`03/03/26` — một ngày hợp lệ, **trông không có gì bất thường**. Trên bảng dùng để đánh giá PM, sai mà
lộ còn đỡ hơn sai mà mượt.

`parser.ts:283` có chặn `mo > 12 || day > 31`, nên tháng 13 không lọt. Nhưng **không** chặn ngày 31
của tháng 30 ngày, cũng không chặn 29/02 năm không nhuận. Và `ngayLinkIso` (`parser.ts:489`) không
soát dải nào cả.

**Đã đo trên dữ liệu thật:** quét 8 file JSON trong `.data/` (bản chụp tới 25/09), **5.076** chuỗi
dạng `yyyy-mm-dd`, **0 chuỗi ngoài dải**. Nên đây là rủi ro trong code, **không phải lỗi đang xảy
ra** — đừng phóng to. Nhưng nó không nằm trong phạm vi V4a/V4b nên tôi không đề nghị sửa ở vòng này;
đề nghị Plan xếp hàng đợi một việc: `oNgay` trả `null` khi ngày quy tràn.

**③ · Bộ kiểm chống trôi màu canh 7 trên 67 mã màu, và bỏ đúng `STATUS_FILL` — MỨC: NHẸ**

`tests/excel-mau-khop-app.test.ts` chắc hơn Plan lo: nó có phép "đọc được cả hai bảng màu" và
`toBeTruthy` kèm thông điệp, nên đổi tên hằng `GC` là **đỏ to**, không âm thầm xanh. Lỗ nằm ở chỗ
khác: nó chỉ so **nội dung khối `const MAU`** — 7 mã màu. Đếm trong cùng file có **60 mã màu viết
thẳng vào code ngoài khối đó**, 59 mã không khớp giá trị nào trong `MAU`. Trong số đó có
`STATUS_FILL` ở dòng 612–614 (`FFEF4444` · `FFF59E0B` · `FF059669`) — **đúng ba màu mà khối chú giải
vừa được viết lại để giải thích**, và cả `FF16202E` của thanh tiêu đề (6 chỗ).

Đã vá phần nguy hiểm nhất bằng phép kiểm so ở **tầng file**: màu ô chú giải phải bằng màu ô Tình
trạng thật trong bảng. Phần còn lại (thanh tiêu đề, chữ phụ) chưa canh — nói ra chứ không lờ.

**④ · `tsc` không phủ `tests/` → 16 lỗi kiểu đang ẩn, hai lỗi nằm trong bộ kiểm V4a — MỨC: NÊN SỬA**

`L15` Review tìm ra là đúng, tôi đo lại cho ra số. Bắc giàn một `tsconfig` tạm phủ `tests/` rồi chạy
`tsc`: **16 lỗi ở 9 file kiểm**. Không lỗi nào trong ba file của tôi. Hai lỗi đáng chú ý nằm trong
`tests/excel-o-that.test.ts` — bộ kiểm của chính việc V4a:

```
tests/excel-o-that.test.ts(193,27): Property 'ySplit' does not exist on type 'Partial<WorksheetView>'
tests/excel-o-that.test.ts(217,27): Property 'xSplit' does not exist on type 'Partial<WorksheetView>'
```

Phép kiểm vẫn chạy đúng vì vitest không soi kiểu, nhưng đó là hai chỗ đọc thuộc tính mà kiểu bảo
không tồn tại — đúng loại chỗ sẽ vỡ im lặng khi nâng phiên bản exceljs. Đề nghị Plan xếp việc: thêm
một `tsconfig` phủ `tests/` và một dòng lệnh trong phần 6 NEN-TANG, để dòng `tsc: sạch` của cả bốn
box nói được điều gì đó về bộ kiểm.

**⑤ · Quyết định của Test về phép kiểm `matrix-reader` đang đỏ — đã làm, commit `2ba7ebd`**

Đặt **mốc riêng 20 giây** cho đúng phép kiểm đó, **không** nâng `testTimeout` toàn cục.

Lý do phải ghi lại cho đúng: **nó trôi nổi theo máy, không phải mới chậm đi.** Cùng commit, cùng file
nguồn, đo được 1.263 ms (máy Review) · 5.943 ms (máy Plan) · 6.140–8.352 ms (máy Thực thi và máy
này). Kết luận "có gì đó vừa chậm đi" là sai — Plan đã tự đính chính, tôi xác nhận. Phép kiểm ấy nặng
vì nó **đọc lại nguyên file 2,1 MB lần thứ hai**: `parseMatrixWorkbook` đã parse một lượt, còn
`findMatrixSheets` cần chính đối tượng workbook nên phải có lượt riêng.

Tôi đã thử dời lượt parse ấy ra tầng module cho phép kiểm chạy còn vài ms — **rồi tự bỏ**, vì nó
không bỏ được lượt parse nào, chỉ đẩy chi phí ra ngoài vùng bấm giờ. Đó đúng là mẹo che ngưỡng mà
chính tôi vừa phê ở lỗi ①. Mốc riêng thì trung thực hơn: ngưỡng chặt giữ nguyên cho hơn 400 phép
còn lại, mà chạm 20 giây thì đúng là có gì chậm đi thật.

**CHƯA KIỂM ĐƯỢC**

- **Chuẩn nghiệm thu thật của việc này.** Anh Tiến chấm bằng **mắt** trên file mở bằng **Excel**:
  màu sắc, bố cục, "đẹp như PDF". Tôi không có Excel trên máy này. Mọi kết luận ở trên đọc từ XML và
  từ exceljs. **Phép kiểm xanh không thay được một lượt mở file bằng Excel.**
- **Chiều cao tự giãn (b).** Chỉ chốt được điều kiện cần — không còn chiều cao đặt tay. Excel có giãn
  đủ chữ hay không thì phải mở ra xem. Đúng như Plan dặn: ghi *chưa kiểm được*, không suy.
- **Data bar vẽ ra sao trên ô 0 và ô trống.** File bảo đảm ô trống không có giá trị nào để vẽ, và ô 0
  có số để hiện. Nhưng bề ngang thanh ở giá trị 0 là do mặc định của Excel quyết (xem lỗi ①), nên
  hình thật ra sao tôi không khẳng định.
- **Tắt đường lưới, đóng băng cột.** Có trong file; trông thế nào khi mở thì chưa kiểm.
- **1440px / 375px.** Không áp dụng — việc này không đổi một pixel nào trên app.

---

### V2b — `40eae6c` — **ĐẠT KÈM LƯU Ý**

Không tìm được lỗi nào chặn được bản này. Ràng buộc 2 (băm hỏng thì không ném) **giữ đúng** dưới mọi
cách tôi phá. Ba lưu ý bên dưới: một chỗ làm thừa ngoài phạm vi khai báo, một lỗ hổng bộ kiểm tôi đã
vá, và một chỗ **đọc số dễ sai** — chỗ thứ ba đáng đọc nhất vì nó ảnh hưởng thẳng tới kết luận mà
cả việc V2b sinh ra để rút.

**ĐÃ VIẾT**

18 phép kiểm trong `tests/kv-dem-bam-ranh-gioi.test.ts`.

*Đã xác nhận ĐỎ trên bản chưa sửa: **có**.* Không dùng `git stash` (luật 5.6 — Thực thi đang mở cùng
cây). Thay vào đó dựng hai bản đối chiếu ra file tạm rồi chạy phép kiểm lên chúng:

| Bản đối chiếu | Dựng bằng | Kết quả |
|---|---|---|
| Bản trước V2b | `git show 40eae6c~1:src/lib/kv-dem.ts` | **ĐỎ** — "dòng đếm mang theo băm", "đường delete băm rỗng ở cột thứ ba" |
| Bản đột biến: bỏ đúng một dòng `ALTER` | `sed` trên bản đang chạy | **ĐỎ** — "lượt dựng bảng đầu tiên phát ra câu ALTER" |
| Bản đang chạy (đối chứng) | nguyên trạng | **XANH** — phép kiểm không đỏ vì lý do khác |

Ba file đo đã xoá ngay sau khi chạy, cây git sạch.

Hai phép kiểm trong bộ mới **tự mang đối chứng**: phép ĐỐI CHỨNG đầu nhóm "ràng buộc 2" chứng minh
cái `crypto` giả thật sự phá được một phép băm không có lớp đỡ. Không có nó thì ba phép sau xanh mà
chẳng chứng minh điều gì.

**RANH GIỚI ĐÃ SOI**

| Ranh giới | Ngay dưới | Đúng bằng | Ngay trên | Kết quả |
|---|---|---|---|---|
| Mốc cắt 128 KB | 131.071 → hai băm **khác** | 131.072 → hai băm **khác** (băm trọn) | 131.073 → hai băm **BẰNG NHAU** | giới hạn đã chốt |
| Độ dài payload | `""` → băm rỗng | `" "` → băm thật 12 hex | `"  "` → băm khác `" "` | ô trống ≠ ô khoảng trắng |
| Nội dung băm được | `undefined` → rỗng | chuỗi thường | 300 KB → vẫn 12 hex | không ném ở đầu nào |
| Chữ tiếng Việt | dựng sẵn (NFC) | tổ hợp (NFD) | HOA / thường | ba thứ ra ba băm khác nhau |
| `crypto.subtle` | ném lỗi → `""` | không có `subtle` → `""` | bình thường → 12 hex | ràng buộc 2 giữ |
| Số lượt dựng bảng | 1 lượt ghi | 3 lượt ghi | — | `CREATE`/`ALTER` chạy đúng **1** lần |
| Tham số thứ hai | thiếu (`delete`) | rỗng | có nội dung | dòng đếm **luôn** được ghi |

**CHẠY**

```
vitest : 387 passed | 2 expected fail | 29 file   (mốc nền 369 | 2 | 28 → chênh +18 đúng phần tôi thêm)
tsc    : sạch (exit 0)
quét byte điều khiển : file mới sạch; toàn cây vẫn 16 byte · 7 file — đúng mốc nền, tôi không đụng
```

Mốc nền 369 | 2 | 28 tôi tự chạy lại, khớp cả báo cáo của Thực thi lẫn của Plan.

**LỖI TÌM ĐƯỢC**

**① · `index.tsx` có 16 dòng bị đổi ký tự cuối dòng, ngoài phạm vi đã khai — MỨC: NHẸ**

Mục ② khai `index.tsx` chỉ sửa "mục CHANGELOG". Thực tế commit `40eae6c` đụng 36 dòng ở file đó:
4 dòng CHANGELOG, còn lại là **16 dòng (2661–2676) đổi từ LF đơn sang CRLF** — khối `danhChiNow`.

```
trước : ... 63 20 76 c3 a0 6f        (hết dòng, không có 0x0d)
sau   : ... 76 c3 a0 6f 0d           (thêm 0x0d)
```

Không đổi hành vi: cả 16 dòng nằm trong một khối ghi chú và mã thường, `\r` cuối dòng ngoài chuỗi
là khoảng trắng với trình biên dịch. Và nó làm file **nhất quán hơn** — 16 dòng đó vốn là chỗ lệch
duy nhất trong file toàn CRLF. Nhưng nó không được khai, và nó chiếm **30 trên 36 dòng** của diff
`index.tsx`, tức là ai soi diff sẽ phải lội qua đống nhiễu để tìm 4 dòng thật. Đề nghị Thực thi chỉ
sửa lại một chữ trong mục ② cho khớp thực tế, không cần đụng code.

**② · Câu `ALTER TABLE` không có phép kiểm nào chốt — MỨC: NHẸ, TÔI ĐÃ VÁ**

`tests/kv-dem-bam.test.ts` không có một lần nhắc nào tới `ALTER` (`grep -c "ALTER"` → **0**), và
hàm trợ giúp `cauCo` dựng ra trong file đó **không được dùng ở đâu cả**. Hệ quả: xoá đúng dòng
`ALTER` đi thì **cả 11 phép kiểm vẫn xanh**, trong khi cột `bam` không bao giờ có trên một bảng đã
tồn tại, câu chèn ba cột hỏng mãi, đường lùi nuốt lỗi — và đồng hồ đứng im mà không ai được báo.
Tôi đã đo đúng tình huống đó (bảng ở mục ĐÃ VIẾT) và thêm phép kiểm chốt lại. Không phải lỗi code.

**③ · Hai chuỗi NHÌN GIỐNG HỆT NHAU ra hai băm khác nhau — MỨC: LƯU Ý KHI ĐỌC SỐ**

Đây là chỗ đáng chú ý nhất, và nó **không phải lỗi** — băm đang làm đúng việc của nó.

Tiếng Việt có hai lối dựng cùng một chữ: dựng sẵn (NFC) và tổ hợp (NFD). `"Dự án Sun Group"` viết
theo hai lối cho ra hai chuỗi byte khác nhau, nên hai băm khác nhau, dù trên màn hình giống hệt.

Vì sao nó quan trọng với đúng việc này: câu hỏi V2b sinh ra để trả lời là *"63 lượt ghi kia là 63
nội dung khác nhau hay một nội dung ghi 63 lần"*. Nếu nguồn Master Plan lẫn cả hai lối gõ — chuyện
thường gặp khi dữ liệu đi qua nhiều máy và nhiều lần dán — thì cột `bam` sẽ báo **"nhiều nội dung
khác nhau"** cho thứ thực chất là một. Đọc thẳng con số đó là kết luận nhầm sang hướng (c), rồi đi
sửa nhầm chỗ. Đã chốt bằng phép kiểm để người đọc số biết mà trừ hao.

**CHƯA KIỂM ĐƯỢC**

- **`crypto.subtle` trên Workers thật.** vitest chạy trên Node. Tôi kiểm được *hành vi khi nó hỏng*
  (băm rỗng, không ném, dòng đếm vẫn ghi) nhưng **không kiểm được nó có chạy hay không** trên
  Workers. Bảng ba nhánh ở cuối mục ① là đường đỡ đúng chỗ này — phải chạy **ngay sau deploy**,
  đừng đợi hết ngày.
- **`ALTER TABLE` trên D1 thật.** Tôi giả lập được cả hai nhánh (thành công, và ném "duplicate
  column"), nhưng chưa ai chạy nó trên D1 production. Cột đã được Plan thêm tay 24/09 nên nhánh sẽ
  chạy là nhánh "đã có cột" — nhánh tôi đã chốt bằng phép kiểm.
- **CPU thêm trên Workers.** Không đo được từ máy. SHA-256 native trên tối đa 128 KB, suy luận là
  nhỏ so với trần 2.010.000 µs, nhưng đó là suy luận — giống hệt điều Thực thi đã tự nêu.
- **App trên localhost.** Tôi không mở lại. Thứ duy nhất người dùng thấy đổi là badge phiên bản
  `3.109.0 → 3.109.1` cộng hai dòng CHANGELOG, và Thực thi đã đo ở 1440px lẫn 375px. Không phép
  kiểm nào của tôi chạm tới đường đó — nói thẳng ra đây chứ không lờ đi.
- **Con số thật.** Việc này cần deploy rồi chờ một ngày mới có số. Đó là điểm của nó.

---

### Vòng trước — V1, soi đặc tả ngày 21/09 (giữ lại, V1 vẫn nằm trong hàng đợi)

**PHÁN QUYẾT** — **KHÔNG ĐẠT (trả về ① PLAN, trước khi Thực thi bắt đầu)**

Mục ② còn trắng nên **chưa có bản sửa nào để kiểm**. Đây là lượt soi ĐẶC TẢ, không phải lượt soi code.
Soi xong thì đặc tả ① hỏng ở một chỗ đủ để làm hỏng cả việc: **danh sách đóng thiếu một file**.

**LỖI TÌM ĐƯỢC**

**① · Danh sách "đóng, đã đo" của Plan thiếu `scripts/bao-cao-hang-ngay.gs` — MỨC: CHẶN**

Tôi đo lại độc lập trên cùng cây làm việc, cùng phạm vi `src/ tests/ scripts/ docs/`, cùng dải byte
mà chính Plan viết ra ở tiêu chí 3 (`0x00-0x08, 0x0b, 0x0c, 0x0e-0x1f`), cùng danh sách đuôi file
mà Plan liệt kê (`.ts .tsx .js .mjs .cjs .gs .md .json`):

| | Plan ghi | Tôi đo |
|---|---|---|
| Byte | 14 | **16** |
| File | 6 | **7** |
| Dòng | 12 | **14** |

Chỗ lệch nằm gọn ở một file Plan không hề nhắc:

```
scripts/bao-cao-hang-ngay.gs:341  [DC1 0x11]
scripts/bao-cao-hang-ngay.gs:342  [DC1 0x11]
```

Trừ hai byte đó ra thì 14/6/12 của Plan khớp tôi từng dòng một. Nói cách khác Plan không đo sai
12 dòng kia - Plan **bỏ sót nguyên một file**.

**Vì sao nó chặn, chứ không phải chuyện nhỏ:** đặc tả ① tự mâu thuẫn với chính nó.
- Tiêu chí 1 đòi **0 byte** trong `src/ tests/ scripts/ docs/` - `scripts/` nằm trong đó.
- Tiêu chí 3 bắt phép kiểm mới quét cả đuôi `.gs`, và dải byte đã nêu **có chứa 0x11**.
- Nhưng PHẠM VI lại ghi "đúng 12 dòng ở 6 file dưới đây" và "**không chạm file nào khác**".

Thực thi làm đúng PHẠM VI thì tiêu chí 1 và 3 đỏ. Làm cho tiêu chí 1 và 3 xanh thì phạm PHẠM VI.
Không có đường nào đi lọt. Và chính Plan đã dặn ở CHỖ CÒN MƠ HỒ: *"quét ra con số khác 14 thì
dừng lại, báo Plan, đừng tự quyết"* - tôi đang làm đúng câu đó.

**Thêm một chi tiết đáng chú ý:** file bị sót lại đúng là file Apps Script. L1 trong sổ lỗi ghi
nguyên văn *"dán vào Apps Script bị nuốt"*. Hai byte này nằm trong **thân ghi chú**, không nằm
trong chuỗi khoá, nên **không đổi hành vi app** - đừng phóng to. Nhưng ghi chú đó đang giải thích
cho người sau *vì sao phải dùng `String.fromCharCode(0)` chứ đừng nhúng byte thẳng*, và nó tự nhúng
byte thẳng để minh hoạ. Dán file vào trình soạn Apps Script là mất.

**Cần Plan quyết một trong hai, đừng để Thực thi tự đoán:**
- (a) Đưa `scripts/bao-cao-hang-ngay.gs:341,342` vào bảng phạm vi → con số chốt thành **16 / 7 / 14**; hoặc
- (b) Giữ nguyên 12 dòng, và sửa tiêu chí 1 + 3 để **loại trừ tường minh** file đó, kèm lý do.

**② · Lệnh quét chính thức ở NEN-TANG phần 6 báo "sạch" cho file CÓ byte lạ — MỨC: CHẶN**

Đây là lỗi nặng hơn lỗi ①, vì nó là **cái thước**. Lệnh ở NEN-TANG phần 6 chỉ dò 5 giá trị
(`0x00, 0x08, 0x0b, 0x0c, 0x1b`). Chạy đúng lệnh đó trên chính các file đang bẩn:

```
scripts/bao-cao-hang-ngay.gs  sach      <- thật ra có 2 byte 0x11
src/lib/compliance.ts         sach      <- thật ra có 1 byte 0x01
src/lib/parser.ts             CO 2 BYTE LA
```

**3 trên 16 byte vô hình với chính công cụ của đội.** Mục "ĐÃ ĐO" của cả bốn box đều có dòng
`quét byte điều khiển: sạch/có`, và dòng đó đang nói dối. Nếu Thực thi dùng lệnh này để tự nghiệm
thu, nó sẽ báo sạch trong khi `compliance.ts` vẫn còn 0x01 - đúng con byte Plan dặn kỹ nhất là
đừng đụng nhầm.

Đã sửa lệnh trong NEN-TANG phần 6 cho phủ hết dải, và ghi **L13**. Xem mục ⑤.

**ĐÃ ĐO - MỐC NỀN ĐỂ SAU NÀY ĐỐI CHIẾU** (đo 21/09/2026, trước khi Thực thi đụng gì)

```
tsc                    : sạch
vitest                 : 358 passed | 2 expected fail | 27 file
byte điều khiển        : 16 byte · 7 file · 14 dòng
   0x00 (NUL)          : 13
   0x01 (SOH)          : 1     src/lib/compliance.ts:203
   0x11 (DC1)          : 2     scripts/bao-cao-hang-ngay.gs:341,342
```

Lệnh quét tôi dùng nằm ở NEN-TANG phần 6 (bản đã sửa) - cùng dải byte, cùng danh sách đuôi file
mà tiêu chí 3 của Plan yêu cầu, nên Thực thi và Review đo lại sẽ ra đúng ba con số trên.

**CHƯA KIỂM ĐƯỢC**

- **Toàn bộ V1.** Chưa có code để kiểm. Khi ② có bản sửa, tôi còn phải soi: chứng minh tương đương
  từng byte (tiêu chí 5), khoá `toa|can` xuyên server-client, khoá `code|name` ở bốn chỗ, và
  **0x01 của `compliance.ts` không bị thống nhất nhầm về 0x00**.
- **Phép kiểm `tests/khong-byte-dieu-khien.test.ts`** chưa tồn tại - Thực thi viết. Tôi sẽ soi hai
  thứ: nó có đỏ trên bản chưa sửa không, và nó có bắt được **cả 0x01 lẫn 0x11** không, hay lại
  chép nhầm dải hẹp của lệnh cũ.
- **Đường dùng khoá trên app thật** (ma trận Media, tiêu chí 6): cần mở app, chưa làm ở lượt này
  vì chưa có gì thay đổi để mà so.

---

## ④ REVIEW

Review nhận vai 28/09/2026 (trước đó session này làm Test vòng V1). **Mỗi bản một phán quyết riêng.**
Việc đang làm — **V11 nhánh C** — ở ngay dưới. V5 · V2b · V4a · V4b đã phán quyết, nằm phía sau.

---

## V11 NHÁNH C · GẮN ĐỒNG HỒ VÀO APP — Review **VIẾT CODE**, đây là NGOẠI LỆ

### ĐỌC CHỖ NÀY TRƯỚC: ai soi nhánh này?

**Không phải tôi.** Plan giao nhánh C cho box Review và nói rõ đây là ngoại lệ. Tôi nhận việc, nhưng
phải ghi thành chữ một điều mà cả `box-4-REVIEW.md` lẫn bảng dây chuyền ở NEN-TANG đều chốt:
*Review không sửa code.* Luật đó có lý do, và lý do đó chính là tình huống này — **tôi vừa viết thì
tôi không còn là cửa cuối được nữa.** Tự phán quyết code của mình là bỏ hẳn một cửa kiểm, không phải
tiết kiệm được một vòng.

**Nhánh C cần một box KHÁC soi trước khi gộp.** Đừng để nó đi thẳng ra deploy vì "Review làm rồi".

**Các file tôi đã đụng** (ghi ra đây vì đây là ngoại lệ, không phải tiền lệ mới):

```
MỚI   src/lib/dong-ho.ts          — module đồng hồ, không phụ thuộc gì ngoài `performance`
MỚI   tests/dong-ho.test.ts       — 14 phép kiểm
SỬA   src/routes/index.tsx        — ĐÚNG 5 chỗ: 1 dòng import · moc("trang") · moc("nguon")
                                     · moc("doc") · chốt-và-ghi. Không đụng gì khác.
```

### VIỆC ĐÃ LÀM

App không có một phép đo thời gian nào (`grep performance.now src/` ra rỗng), nên mọi con số về lag
cả đội đang bàn đều đo trên **một máy**. Nhánh này gắn ba mốc, tính bằng mili giây kể từ lúc trình
duyệt bắt đầu mở trang:

| Mốc | Đặt ở đâu | Đo được đoạn nào |
|---|---|---|
| `trang` | `useEffect` gắn kết của `Dashboard` | dựng trang |
| `nguon` | ngay sau `fetchSheetXlsx` | chờ máy chủ + Drive |
| `doc` | ngay sau `parseXlsxBuffer` | đọc file .xlsx ở máy người dùng |

Hiệu hai mốc liền nhau là ba đoạn cần tách. Gói lại thành một chuỗi JSON ~50 ký tự rồi đẩy qua
`track()` **sẵn có** — không dựng đường gửi thứ hai — vào bảng D1 `access_log`.

Câu SQL đọc số ra (theo giờ và theo người) nằm ở đầu `src/lib/dong-ho.ts`. Dùng `json_extract`, nên
không phải bóc chuỗi bằng `substr`.

### BỐN RÀNG BUỘC — GIỮ Ở ĐÂU, VÀ CHỨNG MINH THẾ NÀO

**1. Không bao giờ ném lỗi.** Đây là ràng buộc nặng nhất, và ở chỗ này nó **nặng hơn vẻ ngoài của
nó**. `moc("nguon")` và `moc("doc")` nằm **trong khối `try` của `queryFn`**, mà khối đó bắt lỗi rồi
**rơi sang đường tải CSV dự phòng**. Nên nếu đồng hồ ném, hậu quả không phải "mất số đo" — mà là
**app âm thầm đổi đường tải dữ liệu**. Đúng họ hàng L3: hỏng mà không ai được báo.

Vì thế phép kiểm **chốt bằng hành vi, không chốt bằng dấu vết**. Mỗi phép dựng lại đúng hình dạng
khối `try/catch` đó rồi phá đồng hồ, và hỏi đúng một câu: hàm trả về **bản thật** hay **bản dự
phòng**?

```
khong co `performance`            -> BAN THAT
`performance.now` nem loi         -> BAN THAT
`now` khong phai ham              -> BAN THAT
`now` tra NaN / Infinity / so am  -> BAN THAT, va khong ghi moc rac
`JSON.stringify` nem loi          -> BAN THAT
doc duoc binh thuong (DOI CHUNG)  -> BAN THAT, VA co goi do
```

Phép đối chứng cuối là bắt buộc: không có nó thì năm phép trên xanh mà chẳng chứng minh gì.

**2. Không ghi lên KV.** `grep '\.put(|putNeuKhac|demGhiKv' src/lib/dong-ho.ts` → **0**. Module này
không biết KV là gì; nó chỉ dựng một chuỗi. Trần 1.000 lượt/ngày không bị đụng.

**3. Không thêm thứ nhận dạng cá nhân.** Gói đo có đúng ba con số. Email do `recordActivity` tự đọc
từ cookie phiên như nó vẫn làm cho mọi dòng nhật ký khác.

**4. Không đổi hành vi người dùng thấy được.** Không dựng gì, không chặn gì. `track()` chạy nền và
vốn đã nuốt mọi lỗi.

### MỘT DÒNG MỖI LƯỢT MỞ APP — chỗ dễ đội số nhất, và có phép kiểm riêng

Tiêu chí của Plan: *"số dòng D1 mỗi ngày tăng đúng bằng số lượt mở app, không hơn"*. Chỗ dễ vỡ là
V10 — nó giữ dữ liệu 5 phút, nên `queryFn` chạy lại mỗi lần người dùng bấm làm mới hoặc chuyển qua
lại màn hình. Nếu mỗi lượt đó ghi một dòng thì con số hết nghĩa.

`chotDongHo()` trả chuỗi **đúng một lần** cho mỗi lượt tải trang. Phép kiểm gọi `đườngMởApp()` ba
lần liên tiếp và đòi: lần 1 có gói, lần 2 và 3 **null**, cả ba lần đều ra bản thật. Bản demo cũng
không ghi dòng nào — hai mốc `nguon`/`doc` chỉ đặt trên đường tải thật, nên nó không bao giờ đủ bộ.

### ĐÃ GỠ LỚP ĐỠ RA ĐỂ KIỂM CHỨNG PHÉP KIỂM

Một bộ kiểm không bao giờ đỏ là một bộ kiểm vô dụng. Tôi sao lưu file ra ngoài rồi gỡ từng lớp:

| Gỡ cái gì | Kết quả |
|---|---|
| Bỏ `try/catch` của `moc()` | **3 phép ĐỎ** |
| Bỏ riêng lớp lọc `isFinite` trong `bayGio()` | **1 phép ĐỎ** (phép NaN/Infinity/số âm) |
| Phục hồi | 14/14 xanh trở lại |

**Và tôi đã phải sửa một phép kiểm của chính mình vì nó xanh vì LÝ DO SAI.** Bản đầu của phép
NaN/Infinity không đặt mốc `trang`, nên `chotDongHo()` trả `null` vì **thiếu mốc** chứ không vì lọc
được số rác — nó xanh kể cả khi gỡ hẳn lớp lọc. Đúng con "xanh giả" mà tôi viết lời mở đầu của file
kiểm để chống, và tôi vẫn vấp. Đã sửa: đặt `trang` bằng một đồng hồ tốt trước, rồi mới phá.

### ĐÃ ĐO

```
tsc                        : sạch (exit 0)
vitest                     : 455 passed | 2 expected fail | 34 file | 0 FAILED
   riêng tests/dong-ho     : 14 passed
build                      : qua (exit 0)
quét byte điều khiển       : 16 byte · 7 file · 14 dòng — đúng mốc nền, hai file mới SẠCH
đường ghi KV thêm          : 0
```

**Số trên đo ở cây đang mang CẢ HAI nhánh** — không tách riêng được nhánh C, lý do ở mục kế tiếp.
Riêng `tests/dong-ho.test.ts` và `src/lib/dong-ho.ts` thì độc lập hoàn toàn, chạy một mình cũng
14/14.

### CẢNH BÁO CÂY DÙNG CHUNG — L12, LẦN NÀY TRÊN FILE NGUỒN

`src/routes/index.tsx` đang mang việc chưa commit của **cả nhánh A lẫn nhánh C**:

```
nhanh A (Thuc thi) : listMediaProjects -> getMediaCoAnh, doi queryKey
nhanh C (toi)      : 1 import + 3 loi goi moc() + 2 dong chot-va-ghi
```

Ai `git add src/routes/index.tsx` trước mà không để ý là quét luôn phần người kia. Tôi đã báo box
Thực thi và **đề nghị họ commit trước, tôi chờ** — phần họ đụng hai file và có file riêng, phần tôi
đụng đúng năm chỗ nhỏ nên tách sau dễ hơn. Ai phải commit chung file đó thì dùng `git add -p`, bỏ
qua hunk có chữ `moc(` / `chotDongHo` / `dong-ho`.

Đây là cái giá của việc chạy song song trên một cây. Không phải lỗi của ai, nhưng nó **sẽ** cắn nếu
không ai nói trước.

**VÀ NÓ ĐÃ CẮN, TRONG LÚC TÔI ĐANG VIẾT ĐOẠN TRÊN. Đã xử lý xong, ghi lại vì đáng nhớ.**

Cảnh báo của tôi tới lúc box Thực thi đang giữa lượt, nên nó xếp hàng và commit đi trước. Commit
`6b97d2e` gom nhánh A **cộng 8 dòng nhánh C của tôi** trong `index.tsx`, nhưng **không** gom
`src/lib/dong-ho.ts` — file mà 8 dòng ấy `import`. Hai file của tôi lúc đó còn ở trạng thái chưa
theo dõi nên `git add` không chạm tới.

Thông điệp commit ghi *"tsc sach · vitest 455 passed · build qua"*. **Đúng với cây làm việc, sai
với commit.** Tôi kiểm bằng cách `git worktree add --detach 6b97d2e` rồi chạy ở đó:

```
tsc   : src/routes/index.tsx(55,33): error TS2307:
        Cannot find module '@/lib/dong-ho' or its corresponding type declarations.   exit 2
build : Build failed in 7.95s                                                        exit 1
```

**HEAD không dựng được.** Không phải lỗi logic — chỉ là commit lấy đúng một nửa của một thay đổi.

Box Thực thi tự phát hiện và sửa đúng cách: `reset` bỏ `6b97d2e`, commit lại sạch thành `e022600`.
Tôi đã kiểm lại `e022600`: **không lẫn một dòng nào** của nhánh C (`grep` phần thêm ra 0), và chạy ở
cây riêng thì `tsc` sạch · `build` qua · 441 passed | 2 expected fail | 33 file. **HEAD lành.**

Một chỗ tôi tự vấp trong lúc dọn, ghi ra vì nó là bài học cho chính tôi: sau lượt `reset` tôi chạy
`grep -c` trên `index.tsx` để xem ba mốc còn không, ra **0**, nên tưởng chúng bị cuốn đi và gắn lại.
Thật ra chúng vẫn còn — `index.tsx` **có byte NUL** nên `grep` coi nó là file nhị phân và đếm sai;
phải dùng `grep -a`. Đúng cái bẫy đã ghi sẵn ở mục ĐÃ ĐO TRƯỚC của V1 (*"grep coi file đó là Binary
file nên grep THƯỜNG không tìm thấy gì"*) — có trong sổ mà tôi vẫn vấp. Hệ quả: tôi thêm trùng một
dòng `import` và một lời gọi `moc("trang")`, phát hiện ngay khi đếm lại bằng `grep -a` và đã gỡ.
Đếm lại sau khi sửa: mỗi thứ đúng **một** lần.

**Đã thêm `L16` vào NEN-TANG phần 4** — *Báo cáo đo trên CÂY, nhưng commit chỉ là MỘT PHẦN của cây.*
Khác L12: L12 là quét **thừa** phần người khác, L16 là quét **thiếu** — lấy nửa của một thay đổi.
Cách chặn: `tsc`/`build` ở thư mục làm việc **không** chứng minh được commit dựng được, vì file chưa
theo dõi vẫn nằm đó; muốn chắc thì `git worktree add --detach <commit>` rồi chạy ở đó.

### SỐ NÀO ĐO Ở ĐÂU — VÀ SỐ NÀO KHÔNG ĐƯỢC ĐEM SO VỚI NHAU

Plan nhờ ghi rõ chỗ này sau khi nhánh B làm đổ hai kết luận của chính Plan. Đây là phần **đáng đọc
nhất của cả nhánh C**, vì nhánh C sinh ra đúng để chặn cái bẫy đó — mà bản thân nó cũng dính nếu
người đọc không biết số đến từ đâu.

**Ba môi trường, ba loại số, KHÔNG thay nhau được:**

| Đo ở đâu | Cho biết gì | KHÔNG cho biết gì |
|---|---|---|
| **Máy dev** (`npm run dev`) | đường code chạy đúng không | **thời gian người dùng chịu** |
| **Production, phía Worker** (D1 `kv_write`, log Cloudflare) | CPU và thời gian chờ **của máy chủ** | máy người dùng, mạng người dùng |
| **Production, phía người dùng** (đồng hồ này) | **thời gian thật người dùng ngồi chờ** | máy chủ tốn CPU bao nhiêu |

**Vì sao số dev KHÔNG đem so với production được — hai chỗ cụ thể, cả hai vừa được nhánh B chỉ ra:**

1. **Bốn lượt "index.tsx" 4–5,7 giây trong bảng 82.442 ms không phải server-fn.** Đó là Vite trả về
   mã nguồn đã biên dịch (2,2 MB), và **production không có chúng**. Tức một phần đáng kể của con số
   82.442 ms là **chi phí của môi trường dev**, không phải độ trễ người dùng thật chịu.
2. **Giả thuyết "sáu lượt bị trình duyệt xếp hàng" không đứng vững:** 17 lượt khởi động trong vòng
   1 ms của nhau, chờ kết nối chỉ 2–52 ms.

**Hệ quả THẲNG cho chính đồng hồ này — đọc trước khi dùng số của nó:**

- **Mốc `trang` đo ở máy dev là vô nghĩa để so với production.** Nó đặt ở `useEffect` gắn kết của
  `Dashboard`, tức **sau** khi trình duyệt tải xong mã trang. Ở dev, phần tải đó là 2,2 MB mã chưa
  gói; ở production là gói đã chia nhỏ và có cache. Cùng một con số, hai nghĩa khác hẳn.
- **Hai mốc `nguon` và `doc` thì so được**, vì cả hai đều đo một việc có thật ở cả hai nơi: đi lấy
  file nguồn, và đọc file .xlsx. Nhưng `nguon` ở dev không qua Cloudflare nên vẫn không bằng.
- **Chạy thử ở máy dev CÓ ghi dòng** — `recordActivity` ở dev ghi vào `.data/pmo-access-log.json`
  chứ không vào D1 production. Nên dev không làm bẩn số thật, nhưng **cũng đừng lấy số dev báo cáo**.

**Luật rút ra, một câu:** con số nào cũng phải đi kèm chỗ đo. Bảng `do_lag` chỉ có nghĩa khi đọc
**từ production**, và chỉ so được **production với production** — cùng giờ, cùng nhóm người dùng.
So một lượt dev với một lượt production là dựng ra một kết luận không có thật, đúng việc vừa xảy ra
với con số 82.442 ms.

### CHƯA LÀM / CHƯA KIỂM ĐƯỢC

- **Chưa chạy trên app thật.** Tôi không mở app, nên chưa thấy một dòng `do_lag` nào ra đời. Phép đo
  quyết định — *"sau một ngày chạy thật, câu SQL ra bảng thời gian theo người và theo giờ"* — chỉ trả
  lời được **sau khi deploy**.
- **Chưa biết mốc `trang` có đúng là thứ người dùng cảm nhận không.** Nó đặt ở `useEffect` gắn kết
  của `Dashboard`, tức lúc React gắn xong, **không phải** lúc mắt người thấy đủ bảng. Muốn đúng
  nghĩa "trang đã dùng được" thì phải đo ở một mốc khác. Nêu ra đây vì nó là chỗ dễ đọc nhầm con số
  nhất về sau.
- **Chưa đo chi phí của chính cái đồng hồ.** Nó thêm một lượt gọi máy chủ mỗi lần mở app. Chuyện này
  hơi trớ trêu trong một việc về giảm lag, nhưng lượt đó chạy **sau khi mọi thứ xong** và không ai
  chờ nó. Vẫn nên đo, và tôi chưa đo.
- **Không soi nhánh A và nhánh B.** Không phải việc của lượt này.

---

## V5 · mặc định HIỆN TẤT CẢ ĐẦU VIỆC — `72ea874` + `5fe969d` — **ĐẠT KÈM LƯU Ý**

Không có gì đủ để chặn. Đo ở **cây riêng sạch tại `1025393`** (`65bb640` và `1025393` chỉ đụng
`docs/`, đã kiểm):

```
tsc                  : sạch (exit 0)
vitest               : 433 passed | 2 expected fail | 32 file | 0 FAILED
build                : qua (exit 0)
quét byte điều khiển : 16 byte · 7 file · 14 dòng — đúng mốc nền
đường ghi KV mới     : 0 — grep `put(` / `putNeuKhac` / `demGhiKv` trên diff V5 ra RỖNG
```

Hạn mức: **đúng**, và lý do Thực thi nêu là lý do đúng. Đây là thiết lập từng máy; đưa nó vào KV thì
mỗi lượt bấm của 10–17 người ăn thẳng vào trần 1.000 lượt/ngày. `localStorage` là chỗ đúng.

Cấu trúc code: `useState(true)` là hằng, `localStorage` chỉ đọc trong `useEffect`, ghi chỉ trong
callback. Cả ba cổng đều bọc `try/catch`. Không có đường nào cho kho cục bộ hỏng làm sập render.

### BỐN CÂU PLAN HỎI

**Câu 1 · Chấp nhận tiêu chí 7 CHƯA ĐẠT — ĐÚNG, và tôi có bằng chứng cứng cho việc đó.**

Plan lo mình chấp nhận sai. Không sai. Tôi kiểm hạ tầng kiểm của repo:

```
jsdom / @testing-library / happy-dom trong package.json : KHÔNG CÓ
vitest.config.ts · environment                          : "node"
số phép kiểm render component trong tests/              : 0
```

Phép đọc/ghi nằm inline trong thân component, không export. Với `environment: "node"` và **không một
mẩu hạ tầng render nào**, không có cách nào gọi tới nó. Viết được một phép kiểm thì phải **chép lại
logic** — tạo bản thứ hai rồi hai bản trôi xa nhau, đúng cái bẫy đã ghi ở V4a. Hoặc phải dựng cả
tầng kiểm DOM, việc lớn hơn chính V5.

Test **đúng khi không viết**. Plan **đúng khi chấp nhận**. Và V7 (kéo logic ra) là bản sửa thật.
Đây không phải chỗ đáng chặn.

*Nếu muốn một lớp gác rẻ trong lúc chờ V7:* repo đã có tiền lệ đúng loại — `excel-mau-khop-app.test.ts`
đọc `index.tsx` bằng `fs` rồi soi chữ, **kèm một phép tự gác** để regex hết khớp thì đỏ to chứ không
âm thầm so tập rỗng. Cùng lối đó có thể chốt ba điều mà không chép logic: khoá có hậu tố phiên bản,
chỉ nhận `"0"`/`"1"`, và mặc định là `true`. Cái đáng gác nhất là **mặc định**: nó là thứ người dùng
vừa yêu cầu đổi, và là thứ dễ bị lật lại nhất khi ai đó dọn code.

**Câu 2 · Ghi chú mới ở `index.tsx:3406` — kết luận đúng, nhưng LÝ DO đưa ra vẫn là lý do yếu hơn.**

Tôi xác nhận chuyện Test truy được. Có **hai** hàng rào trong code, không phải một:

```
dòng 3291 : forcedLate = projectLate && !isPhatSinh && !delivered && !isDone
dòng 3295 : isDone ? "none"        ← đứng TRƯỚC nhánh forcedLate
```

Việc đã xong bị loại ở cả hai chỗ, độc lập nhau. Nên "việc đã xong không mang nhãn cảnh báo" là
**tính chất của CODE**, chắc chắn, không phụ thuộc dữ liệu.

**Nhưng ghi chú mới không nói thế.** Nó ghi *"chỉ lý do đầu là chắc"* rồi chứng minh lý do đó bằng
**một phép đo trên dữ liệu hôm nay** (69·79·59·90·7·36). Đúng loại bằng chứng mà chính ghi chú đó
dùng để nói lý do 2 là *không* chắc. Người đọc kỹ sẽ thấy hai lý do được chống bằng cùng một loại
bằng chứng, rồi kết luận **cả hai** đều tuỳ dữ liệu — tức yên tâm hoặc lo lắng vì lý do sai, đúng
thứ Plan muốn tránh.

Sửa một dòng là xong: dẫn `index.tsx:3295` (và `:3291`) vào lý do 1. Phép đo giữ lại làm đối chứng,
nhưng **cái chắc là code, không phải con số**.

**Câu 3 · Có, tôi cũng không nghĩ ra cách chốt nào mà không kéo hàm ra.** Xác nhận đúng như Test nói:
`tableProjectCount` là `useMemo` (dòng 4398), `pkItem` là `useCallback` (dòng 2580), không cái nào
export, và không có tầng render để đi vòng. Lớp gác đọc-chữ-nguồn thì chốt được *hình dáng* chứ không
chốt được *hành vi* — với một con số dùng để đánh giá PM thì thế là gác hờ, dễ làm người ta yên tâm
hơn mức thực có. Tôi **không đề nghị** làm nó ở đây.

Nên trong lúc chờ V7, **lớp gác duy nhất của chỗ này là chính ghi chú kia.** Đó là lý do câu 2 và
mục dưới đây quan trọng hơn vẻ ngoài của chúng.

**Câu 4 · Lỗi hydration — xác nhận là lỗi dev có sẵn, và tôi đến kết luận đó bằng đường khác.**

Cách Test làm là cách đúng: chạy **đối chứng** với `showDone` không đổi giá trị, ra 10 lỗi y hệt, toàn
bộ trên thuộc tính do công cụ dev chèn. Đó là một phép đối chứng thật, không phải suy diễn.

Tôi xác nhận bằng đường độc lập — **cấu trúc code**: `useState(true)` là hằng nên máy chủ và trình
duyệt dựng ra cùng một thứ; `localStorage` chỉ đọc trong `useEffect`, mà `useEffect` không chạy khi
dựng ở máy chủ; đường ghi nằm trong callback. **V5 không có đường nào sinh ra lệch hydration.** Hai
đường khác nhau, cùng một kết luận. Chuyện này Thực thi làm đúng ngay từ đầu: ghi chú của họ nói rõ
*"đọc localStorage thẳng trong useState là lệch hydration"* — họ biết trước cái bẫy chứ không vấp
rồi mới sửa.

### MỘT CHỖ TEST VÀ PLAN ĐỀU CHƯA THẤY — nhánh thứ BA

Ghi chú mới viết: *"`tableProjectCount` rẽ **hai** nhánh"*. Code rẽ **ba**, và nhánh bị bỏ quên đứng
**đầu tiên**:

```ts
if (filters.mpOnly) return mpProjectRows.length;   // ← nhánh này, ghi chú không nhắc
return hasAnyFilter ? new Set(sortedAlerts.map(pkItem)).size : activeProjectCount;
```

Và nhánh đó mang **đúng cùng một rủi ro**. `mpProjectRows` kết thúc bằng:

```ts
.filter(r => { const hasCtx = filters.depts.length > 0 || filters.stages.length > 0 || … ;
               return hasCtx ? r.active > 0 : true; })
```

với `active: its.length`, mà `its` gom từ `tableItems` — **`tableItems` CÓ nối `doneEnriched`**
(`useMemo` khai đúng `tableItems` trong danh sách phụ thuộc, nên nó thật sự chạy lại). Tức: ở chế độ
**gộp theo dự án CÓ bộ lọc ngữ cảnh**, một dự án mà mọi đầu việc khớp lọc đều đã xong sẽ có
`active === 0` khi tắt nút → bị lọc ra; bật nút → `active > 0` → hiện lên. **Số dự án tăng.**

Cùng cách hỏng, cùng mức: **hôm nay dữ liệu không có ca nào**, không con số nào sai. Nhưng ghi chú
kia được viết lại **chính để chỉ đường cho người sau khi số nhảy**, mà nó chỉ có một trong hai chỗ
cần chỉ. Người gặp số nhảy ở chế độ gộp sẽ đi soi nhánh 2, thấy `sortedAlerts` không tham gia, rồi
mò lại từ đầu — đúng thứ ghi chú sinh ra để tránh.

*Tin tốt kèm theo:* `alerts: its.filter(i => i._alert !== "none").length` trên cùng dòng dự án thì
**an toàn**, và an toàn vì đúng lý do ở câu 2 — việc đã xong không mang nhãn cảnh báo, code chặn ở
dòng 3295. Ba số cảnh báo đầu trang cũng thế.

### NÊN SỬA, KHÔNG CHẶN

1. **Thêm nhánh `mpOnly` vào ghi chú** (mục trên). Đây là mục đáng làm nhất — nó rẻ, và ghi chú đang
   là lớp gác duy nhất của chỗ này cho tới V7.
2. **Dẫn `index.tsx:3295` + `:3291` vào lý do 1** thay vì chỉ dẫn phép đo (câu 2).
3. **Hai số dòng trong ghi chú SAI ngay lúc viết.** Kiểm tại chính commit `5fe969d`:

   | Ghi chú viết | Thực tế tại `5fe969d` | Lệch |
   |---|---|---|
   | `tableProjectCount` (≈4343) | **4398** | 55 dòng |
   | `tableItems` (≈3767) | **3819** | 52 dòng |

   Độ lệch gần bằng nhau ở cả hai, mà `5fe969d` cộng thêm ~52 dòng phía trên — nên rất có thể số dòng
   được đọc **trước** khi chèn ghi chú, rồi viết vào sau. Dòng 4343 lại là một `useMemo` cũng đang
   đếm khoá dự án, nên người đọc nhảy tới đó **tưởng mình đúng chỗ** trong khi không phải. Đây là
   kiểu sai tệ hơn một con số lệch bình thường. Cách chữa bền hơn số dòng: dẫn theo **tên hằng**.

### LƯU Ý PLAN NHỜ CÂN — bảng LOÉ LÊN rồi co lại: **GHI NỢ, KHÔNG CHẶN**

Người đã tắt nút sẽ thấy bảng đầy đủ loé lên rồi co lại, vì ràng buộc 1 bắt lượt vẽ đầu phải là mặc
định. Tôi cân thế này:

- **Không sai một con số nào, không sập gì.** Ưu tiên 1 và 2 của vai Review đều sạch.
- **Đã có tiền lệ trong chính app:** bề rộng cột nhảy y như vậy, từ trước V5, và không ai coi đó là
  lỗi chặn.
- **Chỉ nhóm đã tự tắt gặp phải** — tức nhóm nhỏ, và là nhóm đã biết mình đổi thiết lập.
- **Cách chữa đắt hơn bệnh.** Muốn hết loé thì phải biết lựa chọn **trước lượt vẽ đầu**: hoặc nhét
  một script chặn vào đầu trang, hoặc chuyển sang cookie để máy chủ đọc được. Cả hai đều đụng vào
  đúng vùng hydration/SSR — chỗ mà chính V5 vừa cẩn thận đi vòng để tránh. Đổi một cái nháy dưới một
  giây lấy một rủi ro ở tầng đó là lỗ.

Một chỗ nó **nhẹ hơn** bề rộng cột thì tôi cũng nói cho cân: cột nhảy là đổi bề ngang, còn cái này
đổi **số dòng** (70 → 270 → 70), nên chiều cao trang nhảy và ai bấm ngay lúc đó có thể bấm nhầm
dòng. Vẫn không đủ để chặn, nhưng nếu sau này có người phàn nàn thì đây là chỗ đã biết trước.

### GHI NHẬN CHỖ PLAN TỰ ĐÍNH CHÍNH

Plan từng nói với người dùng rằng bật mặc định là *"vẽ thêm 199 dòng mỗi lần mở app cho mọi người"*,
rồi tự đính chính sau khi Test đếm nút DOM: nhóm con thu lại (mặc định) thì bật hay tắt đều **70
dòng / 3.403 nút**; chi phí chỉ đến khi bấm "Mở tất cả", và khi đó là **+200 dòng / +8.156 nút**.

Đáng ghi vì hai lẽ. Một: nó là **con số thay cho một lời phỏng đoán**, đúng cách làm việc của dây
chuyền này. Hai: lời phỏng đoán đó đã đi tới **người dùng** rồi mới bị sửa — tức một nỗi lo không
tồn tại đã được đặt lên bàn của người quyết định. Đính chính là đúng; điều đáng nhớ là đừng đưa số
chưa đo cho người dùng ngay từ đầu.

### CHƯA KIỂM ĐƯỢC

- **Tôi không mở app.** Ba lần tải trang mà Test đo (kho trống → BẬT · `"0"` → TẮT · `"1"` → BẬT) là
  phép đo đúng chỗ, tôi đọc lại đường code thấy khớp, nhưng **không tự chạy lại**.
- **Trình duyệt chặn lưu trữ** (ẩn danh, chặn cookie): đọc code thì `try/catch` bọc cả hai đầu và rơi
  về mặc định BẬT. Không tự dựng được tình huống đó.
- **Cái nháy** ở mục trên: tôi suy ra từ ràng buộc 1 và cấu trúc code, **chưa thấy bằng mắt**.

---

### PHÁN QUYẾT NGẮN — BA BẢN VÒNG TRƯỚC

| Bản | Commit | Phán quyết |
|---|---|---|
| **V2b** · băm vào bảng đếm D1 | `40eae6c` (v3.109.1) | **ĐẠT KÈM ĐIỀU KIỆN** |
| **V4a** · xuất Excel ô thật | `c188f92` (v3.110.0) | **ĐẠT KÈM ĐIỀU KIỆN** |
| **V4b** · phần nhìn ngang PDF | `a914b2f` + `a8119f2` + `29af58e` | **ĐẠT KÈM ĐIỀU KIỆN** |

Không tìm được lỗi nào trong ba bản đủ để chặn. Điều kiện là **bốn việc phải làm**, không phải bốn
chỗ phải sửa code — liệt kê ở cuối. Điều kiện số 1 là điều kiện quan trọng nhất, và nó không nằm
trong code của bản nào.

*V4b được soi ở lượt sau, phán quyết riêng ở mục **BẢN 3** phía dưới. Phần "ĐÃ TỰ CHẠY LẠI" ngay
dưới đây là số đo của lượt đầu (ghim ở `8763e2a`, chỉ có V2b + V4a); số đo cho V4b ghim ở `d439041`
nằm trong mục BẢN 3.*

### ĐÃ TỰ CHẠY LẠI

**Đo ở CÂY RIÊNG, ghim vào đúng commit đang phán quyết.** Cây làm việc chung không dùng để đo được
(lý do ở mục kế tiếp), nên tôi dựng `git worktree` tách ra ở `8763e2a` — cây **sạch**, không một
dòng chưa commit — rồi chạy ở đó. Không đụng file nào của ai.

```
worktree tại 8763e2a (chứa cả V2b lẫn V4a), git status TRỐNG:
tsc                  : sạch (exit 0)
vitest               : 387 passed | 0 failed | 0 expected fail | 29 file
build                : qua (exit 0)
quét byte điều khiển : 16 byte · 7 file · 14 dòng — ĐÚNG mốc nền, không bản nào thêm byte
                       (0x00 ×13 · 0x01 ×1 · 0x11 ×2)
cột `bam` trên D1 production : CÓ THẬT — tự đọc, không tin lời khai
```

**Bộ kiểm XANH SẠCH ở commit đang phán quyết — kể cả `matrix-reader`.** 29 trên 29 file, không một
phép đỏ. Nghĩa là phép đỏ mà cả Plan lẫn Thực thi báo **không nằm trong hai bản này**, và ở đây nó
cũng không quá hạn.

*Đo thêm trên cây chung để đối chiếu:* `1 FAILED | 398 passed | 2 expected fail | 30 file`. Chênh
lệch so với số ghim ở trên là do cây chung đang mang việc chưa commit của box khác cộng một file kiểm
chưa theo dõi của tôi từ vòng V1.

**CÂY LÀM VIỆC CHUNG ĐANG MANG CODE CHƯA AI SOI — ĐỌC CHỖ NÀY TRƯỚC KHI BẤM DEPLOY.**

Trong lúc tôi soi, cây chung chuyển từ "chỉ sửa file kiểm" sang có **code sản phẩm chưa commit**:

```
 M src/lib/excel-export.ts   +143 dòng   (không phải chuyện ký tự cuối dòng — diff --ignore-all-space y hệt)
 M src/routes/index.tsx       +11 dòng
 M tests/matrix-reader.test.ts
```

Đọc nội dung thì rõ đây là **V4b** (phần NHÌN) đang được viết: bảng màu `MAU` chép từ `GC`,
`xSplit: 3`, `pageSetup` A4 ngang, `printTitlesRow`, thanh màu trong ô. Nó sửa **đúng
`exportTableXlsx`** — hàm tôi đang phán quyết cho V4a.

**Phán quyết của tôi gắn vào COMMIT, không gắn vào cây:** `40eae6c` cho V2b,
`c188f92` + `8763e2a` cho V4a. **Tôi không phán quyết gì về 154 dòng chưa commit kia** — chưa qua ②,
chưa qua ③, chưa ai soi. `wrangler deploy` dựng từ **cây**, không dựng từ commit, nên bấm deploy lúc
này là **đưa cả V4b chưa soi lên production**. Đúng họ hàng L12: cây git là cây dùng chung.

**PHÉP ĐỎ KHÔNG PHẢI CỦA HAI BẢN NÀY, VÀ KHÔNG PHẢI QUÁ HẠN NHƯ ĐÃ MÔ TẢ.**

Tôi được giao thông tin là `findMatrixSheets` đỏ vì quá hạn 5.000 ms. **Trên cây hiện tại không
phải vậy.** Nó đỏ vì:

```
ReferenceError: wbChung is not defined
   tests/matrix-reader.test.ts:54
```

Bản sửa chưa commit đang nằm trong cây **còn dở**: nó đổi lời gọi sang `wbChung` nhưng **chưa khai
biến đó ở đâu cả**, và khai `HAN_DOC_LAI_FILE = 20_000` rồi **không dùng**. Ai chạy `vitest` lúc này
sẽ thấy một phép đỏ với nguyên nhân hoàn toàn khác nguyên nhân đã báo.

Còn bản **đã commit** của file đó thì **chạy qua trên máy này**, đo ba lượt liền:

```
findMatrixSheets : 1.263 ms · 1.296 ms · 1.263 ms      (mốc mặc định 5.000 ms)
```

Đối chiếu: Plan đo 5.943 ms, Thực thi đo 6.543 / 7.125 / 8.352 ms. Cùng một commit, cùng một file
nguồn. Kết luận: phép kiểm này **phụ thuộc máy và tải**, không phải code chậm đi. Nó nằm ở 25% mốc
trên máy này và vượt mốc trên máy khác. Cả Plan lẫn Thực thi đều báo trung thực những gì họ thấy —
chỉ là cái họ thấy không phải một hằng số. Việc nâng mốc vẫn đáng làm, nhưng **lý do đúng là "phép
kiểm đọc file thật nên thời gian trôi nổi theo máy"**, không phải "có gì đó vừa chậm đi".

**MỘT PHÁT HIỆN KÈM THEO — `tsc` không phủ `tests/`.** `tsconfig.json` khai
`include: ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts", "eslint.config.js"]`. Không có `tests`.
Vì thế `tsc` báo **sạch** ngay trong lúc `tests/matrix-reader.test.ts` gọi một biến không tồn tại.
Dòng `tsc: sạch` trong mục ĐÃ ĐO của cả bốn box **chưa bao giờ nói gì về file kiểm**. Đây đúng họ
hàng L13 (cái thước hụt), nhưng khác chỗ: thước này không sai, nó chỉ hẹp hơn mọi người tưởng.

---

### BẢN 1 · V2b — `40eae6c` — ĐẠT KÈM ĐIỀU KIỆN

**ĐỐI CHIẾU ĐẶC TẢ**

- **Làm đủ: có.** Băm ngắn có, cột `bam` có, đường lùi hai cột có, `demGhiKv` giữ tham số thứ hai
  không bắt buộc nên đường `delete` gọi kiểu cũ vẫn chạy.
- **Làm thừa: không.** Hai file `edits.functions.ts` và `mtld-install.functions.ts` mỗi file đúng
  **một dòng**, ngoài phạm vi khai báo nhưng **không có đường nào khác** — `demGhiKv` không thể băm
  thứ nó không được đưa. Thực thi đã tự khai chỗ này trong thông điệp commit. Đây không phải thừa,
  đây là phạm vi đặc tả viết hụt.

**ĐÃ TỰ KIỂM, KHÔNG TIN LỜI KHAI**

*Cột `bam` trên production.* Plan khai đã tự chạy `ALTER TABLE` ngày 24/09. Tôi đọc thẳng:

```
PRAGMA table_info(kv_write)  →  id INTEGER · ts TEXT · kho TEXT · bam TEXT
```

**Lời khai đứng.** Nghĩa là nhánh sẽ chạy trên production là nhánh "đã có cột" — đúng nhánh Test đã
chốt bằng phép kiểm. Ghi thêm cho người sau: ghi chú cũ của tôi nói `wrangler --remote` bị chặn ở
dự án này; **hôm nay nó chạy được** (served_by v3-prod, colo SIN).

*Chi phí CPU của hàm băm — cả Thực thi lẫn Test đều để ở dạng "suy luận là nhỏ". Tôi đo ra số:*

| Payload | Trung vị | % trần CPU (2.010.000 µs) |
|---|---|---|
| kho `mtld` thật, ~40 KB | **153 µs** | 0,008% |
| đúng mốc cắt 128 KB | **359 µs** | 0,018% |
| `sfile:` 2 MB base64 | **405 µs** | 0,020% |
| `sfile:` 8 MB | **366 µs** | 0,018% |

Hai điều rút ra. Một: chi phí **dưới một phần năm nghìn** trần CPU, không phải chỗ đáng lo. Hai —
đáng hơn: payload **8 MB tốn bằng 128 KB** (366 so với 359 µs). Đó là bằng chứng mốc cắt `CAT_BAM`
**thật sự chặn**, chứ không chỉ có vẻ chặn. Nếu băm trọn, 8 MB sẽ tốn gấp 64 lần. Lo ngại L9 mà
Thực thi nêu ra là lo đúng chỗ, và cách chặn cũng đúng.

*Ràng buộc "băm hỏng thì không ném".* Đọc lại đường code: `bamNgan` bọc trọn trong `try/catch` trả
`""`; `crypto` không có hay `subtle` không có đều rơi vào `catch` đó; `demGhiKv` lại bọc thêm một
lớp `try/catch` ngoài cùng. Ba lớp đỡ, không có đường nào cho lỗi đếm leo lên lượt ghi thật. Đúng
bài học L3.

**PHẢI SỬA TRƯỚC KHI DEPLOY** — không có.

**NÊN SỬA, KHÔNG CHẶN**

1. **Đường lùi hai cột không chốt lại, nên nó thử lại mỗi lượt ghi.** Nếu `ALTER` hỏng vì lý do
   thật (không phải "đã có cột"), `banSan` vẫn thành `true`, rồi **mỗi** lượt ghi KV sau đó sẽ chạy
   câu chèn ba cột (hỏng) rồi mới chèn hai cột — **hai câu D1 cho mỗi lượt ghi**, suốt đời isolate
   đó. Không đốt hạn mức đáng kể (câu hỏng không tính là dòng ghi, mà bảng này chỉ ~500 dòng/ngày),
   nhưng thêm một vòng đi-về D1 cho mỗi lượt ghi thì không cần thiết. Một cờ `coCotBam` nhớ lại kết
   quả lần đầu là xong.
2. **Bảng đếm giờ có cột `bam` nhưng không có gì dọn nó.** Bảng chỉ có `idx_kvw_ts`, không thấy
   đường xoá dòng cũ. Cột thêm vào làm mỗi dòng nặng hơn 12 byte; ~500 dòng/ngày thì lâu dài vẫn
   đáng có một câu dọn theo `ts`. Ngoài phạm vi V2b, ghi vào hàng đợi.

**RỦI RO KHI DEPLOY**

- **Ảnh hưởng ai:** không ai thấy gì. Người dùng chỉ thấy badge `3.109.0 → 3.109.1` và hai dòng
  CHANGELOG. Không đổi số, không đổi màn hình.
- **Hỏng thì sao:** trường hợp xấu nhất là **mất cái băm, không mất dòng đếm** — đã có đường lùi.
  Trường hợp xấu hơn (mất cả dòng đếm) cần D1 hỏng, mà lúc đó bảng đếm hỏng sẵn rồi, không phải do
  bản này. Lượt ghi KV thật **không** nằm trong đường nào có thể hỏng vì băm.
- **Lùi lại được không:** được, `wrangler rollback` hoặc deploy lại commit trước. Cột `bam` để lại
  trên D1 cũng vô hại — bản cũ chèn hai cột, cột thứ ba nhận NULL.
- **Hạn mức KV: thêm 0 lượt/ngày.** Không có đường ghi KV mới; số dòng D1 mỗi ngày không đổi, chỉ
  mỗi dòng mang thêm một cột.

---

### BẢN 2 · V4a — `c188f92` + `8763e2a` — ĐẠT KÈM ĐIỀU KIỆN

**ĐỐI CHIẾU ĐẶC TẢ**

- **Làm đủ: có**, cả bảy tiêu chí của mục ①. Ba cột ngày ra `Date`, `%` và `Quá hạn` ra số, cột chữ
  giữ chữ, `numFmt` giữ cho bảng nhìn như cũ.
- **Làm thừa: không.** Chỗ duy nhất đáng bàn là ô ngày trống nay **rỗng thật** thay vì chữ `—` —
  Plan đã tự duyệt ở phần sửa đặc tả và tôi đồng ý: để chữ `—` trong cột ngày là **phá đúng phép
  sắp xếp mà việc này sinh ra để sửa**. Đây là làm đúng, không phải làm thừa.

**ĐÃ TỰ KIỂM**

*Luật 5.2 — chỗ nguy hiểm nhất của dự án này.* Soi thẳng vào chỗ dựng ô:

```
% thực tế  : it.pctActual != null ? Math.round(it.pctActual) : null     → 0 giữ là 0, chưa đo là TRỐNG  ✓
dòng nhóm  : null, null                                                 → không phải 0  ✓
đóng numFmt: cell.value != null && cell.value !== ""                    → 0 vẫn được đóng định dạng  ✓
                                                                          ô trống KHÔNG bị đóng dd/mm/yy  ✓
```

Chỗ cuối quan trọng hơn vẻ ngoài của nó: đóng `dd/mm/yy` lên ô rỗng là mời Excel vẽ ra `00/01/00`,
tức biến *chưa có* thành *một ngày có thật*. Bản này chặn đúng chỗ đó.

*`XlsxTableRow` mở rộng kiểu có làm lây sang đường xuất ma trận không — Plan dặn kiểm riêng.*
Không. `XlsxTableRow` và `XlsxCell` chỉ xuất hiện ở dòng 577–623, tức khối kiểu ngay **trước**
`exportTableXlsx` (dòng 615). `exportMatrixXlsx` nằm ở dòng 233–570 và **không nhắc tới chúng một
lần nào**. Lời khai của Thực thi đứng.

*Bộ kiểm có thật sự kiểm gì không.* Có, và đây là bộ kiểm tốt. Nó chạy trọn `exportTableXlsx`, bắt
lấy `Blob` thật, **đọc ngược file `.xlsx` bằng exceljs** rồi soi từng ô — không phải đọc mã nguồn.
Phép chốt lý do tồn tại của cả việc (`SẮP XẾP THEO HẠN`) so cả hai chiều: sắp theo `Date` ra
`15/06/25 · 01/12/25 · 02/01/26`, sắp theo chữ ra `01/12/25 · 02/01/26 · 15/06/25`. Có phép riêng
cho `0` khác `TRỐNG`, có phép riêng cho `CT26-032` vẫn là chuỗi.

**PHẢI SỬA TRƯỚC KHI DEPLOY** — không có.

**NÊN SỬA, KHÔNG CHẶN**

1. **Ngày trước năm 1900 ra số thứ tự ÂM, Excel không vẽ được.** Tôi đo thẳng bằng exceljs:

   | ISO trong nguồn | Số thứ tự trong `sheet1.xml` |
   |---|---|
   | `2026-09-15` | 46280 |
   | `1900-01-01` | 2 |
   | `1899-12-30` | **0** |
   | `1899-09-15` | **-106** |
   | `0202-09-15` | **-619923** |

   Số âm thì Excel hiện `########` chứ không hiện ngày. Bản cũ ghi chữ `15/09/1899` — xấu nhưng đọc
   được. **Đã đo trên nguồn thật: không bắn.** 6 file Master Plan, **4.348 ngày**, không ngày nào
   ngoài khoảng 1900–2100. Đây là rủi ro tiềm ẩn, tôi không phóng to hơn thế.

2. **Ngày không tồn tại bị cuộn sang ngày khác, trong im lặng — đáng lo hơn mục 1.**
   `toIso` chỉ chặn `day > 31`, nên `31/02/2026` **đi qua** thành `2026-02-31`. `oNgay` dựng
   `Date.UTC(2026, 1, 31)` = **`2026-03-03`**. Bản cũ hiện chữ `31/02/26`, người đọc thấy ngay là
   nhầm. Bản mới hiện `03/03/26` — **một ngày trông hoàn toàn hợp lệ, và sai**. Trái luật 5.3 (chọn
   cách lộ ra, đừng chọn cách âm thầm), trên cột dùng để đánh giá PM. **Đã đo: cũng không bắn** —
   0 trên 4.348 ngày bị cuộn. Cách chặn gọn: sau khi dựng `Date`, so lại `getUTCDate()` với số ngày
   đã đọc, lệch thì trả `null`. Ba dòng, nhưng **đừng nhét vào V4a** — nó đụng `oNgay` là chỗ đang
   được phán quyết, và nó là việc của `toIso` nhiều hơn.

3. **Cột `Quá hạn` gộp "0 ngày" với "chưa có hạn".** `getDaysOverdue` trả `number | null`: `null`
   khi **không có deadline**, `0` khi **đã đo và không trễ**. Chỗ dựng ô dùng
   `it.overdueDays ? it.overdueDays : null` nên **cả hai** thành ô trống. Đúng thứ luật 5.2 cấm —
   nhưng đây là **hành vi có từ trước**, và Thực thi giữ y thế **có chủ ý**, khai rõ, vì vòng này
   đã chốt "không đổi cái nhìn thấy". Tôi đồng ý với lựa chọn đó ở vòng này. Đáng chú ý là ô ngay
   bên cạnh (`%`) thì **có** phân biệt, nên hai ô cạnh nhau đang dùng hai luật khác nhau. Không sinh
   ra con số sai nào (ô trống không vào tổng, mà 0 cũng cộng ra 0), nên không chặn.

4. **Bộ kiểm tự khai lại danh sách cột.** Thực thi đã tự nêu ở mục ② số 2, Plan đã xếp vào hàng đợi.
   Tôi xác nhận đúng: mảng `COLS` trong file kiểm là bản chép tay của `cols` trong `index.tsx`. Đổi
   `numFmt` một bên mà quên bên kia thì bộ kiểm vẫn xanh. Không chặn, nhưng đây là loại lỗ **tự mở
   rộng theo thời gian**.

**RỦI RO KHI DEPLOY**

- **Ảnh hưởng ai:** ai bấm "Xuất Excel". Thấy đổi đúng hai thứ: sắp xếp theo ngày **ra đúng thứ tự**
  (trước là sai), và ô ngày trống **rỗng** thay vì dấu `—`. Màu, cột, thứ tự cột, độ rộng: không đổi.
- **Hỏng thì sao:** xấu nhất là file xuất ra có ô ngày hiện `########` (mục 1) hoặc một ngày bị cuộn
  (mục 2). Cả hai đều cần dữ liệu nguồn mà hôm nay **không có** — 0 trên 4.348. Không có đường nào
  làm sập app: cả việc nằm trong một nút bấm, không chạm đường nạp dữ liệu.
- **Lùi lại được không:** được, deploy lại commit trước. Không có dữ liệu nào bị biến đổi — chỉ là
  file người dùng tự tải về.
- **Hạn mức KV: thêm 0 lượt/ngày.** Không có đường ghi KV nào trong việc này; tôi đã tự soi diff cả
  hai file, không có `put`, không có `demGhiKv`.

---

### BỔ SUNG 28/09 — Plan đổi chuẩn chấm, và V4b đã kịp lên commit `a914b2f`

Plan gửi chuẩn nghiệm thu mới của người dùng (*"file excel phải đẹp như PDF luôn, về màu sắc, bố
cục"*) kèm ba câu hỏi khác cho V4a, và nhờ soi **đặc tả V4b trước khi Thực thi tốn công**. Trong lúc
tôi soi đặc tả thì V4b đã commit xong (`a914b2f`). Nên phần dưới vừa trả lời ba câu, vừa nói luôn
**lỗ nào của đặc tả V4b đã bịt và lỗ nào chưa** — soi trên code thật thay vì đoán.

**BA CÂU VỀ V4a**

**(a) V4a có làm sai gì không — KHÔNG.** Đã soi ở phần trên: `%` phân biệt `0` với chưa-đo, dòng
nhóm để `null` chứ không `0`, `numFmt` không đóng lên ô rỗng, `CT26-032` vẫn là chuỗi, ngày không
lệch múi giờ. Hai ranh giới tôi tìm được (năm trước 1900 ra số âm; ngày không tồn tại bị cuộn im
lặng) đo trên 6 file thật · **4.348 ngày** · **0 lần bắn**.

**(b) V4a có cản đường V4b không — KHÔNG, ngược lại nó vừa vặn đúng chỗ.** Đây là chỗ đáng nói:

V4b dựng data bar với thang **tuyệt đối** `cfvo: [{type:"num", value:0}, {type:"num", value:100}]`.
Thang đó **chỉ đúng vì V4a chọn lưu `85` chứ không lưu `0.85`**. Nếu V4a đi đường `0.85` + `0%` thì
mọi thanh màu sẽ dài khoảng 1% ô — nhìn như chưa ai làm gì. Thực thi V4a đã chọn `85` vì lý do khác
(lọc "lớn hơn 80" gõ được số 80), nhưng lựa chọn đó **tình cờ cứu luôn V4b**. Ghi lại để sau này ai
định đổi sang `0.85` thì biết là phải đổi cả `cfvo`.

Thêm: ràng buộc 2 của V4b (ô chưa có số **không được vẽ thanh nào**) giữ đúng **nhờ V4a** — vì V4a
để ô trống là trống thật, Excel không khớp `greaterThan 0` nên không tô. Nếu V4a ghi `0` vào đó thì
data bar sẽ vẽ một thanh dài 0 ở ô chưa đo, tức biến *chưa đo* thành *0%* **bằng hình ảnh**.

**(c) Có chỗ nào V4b phải đập đi làm lại — KHÔNG có, nhưng có một cái bẫy đã gài sẵn.**

V4b chỉ thêm hàng ở **cuối** bảng (khối chú giải) nên 32 chỗ neo hàng cứng trong
`tests/excel-o-that.test.ts` (`getRow(4)` = dòng dữ liệu đầu, `ref` bắt đầu `G4`) **không bị xê**.
Không phải làm lại gì.

Nhưng: **32 chỗ neo cứng đó là bẫy cho việc tiếp theo.** Thêm bất kỳ khối nào **phía trên** bảng —
mà đó đúng là thứ tôi đề nghị ở dưới — sẽ đẩy mọi hàng xuống và làm đỏ hàng loạt phép kiểm, trong
khi file xuất ra hoàn toàn đúng. Ai làm việc đó thì **neo động trước** (tìm hàng có nhãn
`"Ngày update"` rồi cộng 1), đừng sửa 32 con số bằng tay.

**BA LỖ TRONG ĐẶC TẢ V4b — V4b KHÔNG BỊT, VÀ ĐÂY MỚI LÀ CHỖ CÁCH BẢN PDF XA NHẤT**

Tôi đọc `pdf-export.ts` rồi đọc chỗ app gọi nó (`index.tsx:4374`). **PDF không phải là cái bảng.**
Nó là bốn thứ ghép lại:

```
title      : #pdf-title
blocks     : #pdf-kpi      — dải 6 thẻ KPI (Dự án hiện hành · Trễ tiến độ · …)
             #pdf-stages   — 7 thẻ giai đoạn, mỗi thẻ một thanh xanh/đỏ/vàng/xám, kèm hàng chú giải
table      : #pdf-table
nền        : #eef1f4 xám nhạt, card trắng nổi lên, KHÔNG có đường lưới
```

Excel xuất ra có: một dòng tiêu đề, một dòng "Phạm vi:", cái bảng, và (sau V4b) khối chú giải cuối.
**Không có KPI. Không có thẻ giai đoạn. Vẫn còn đường lưới.**

Chuẩn chấm của người dùng là *"người thứ ba nhìn hai cái phải thấy cùng một báo cáo, cùng bộ màu,
cùng bố cục"*. Đặt hai file cạnh nhau thì thứ đập vào mắt trước **không phải** chiều cao hàng hay
thanh màu — mà là **bản PDF mở ra có một trang tóm tắt, bản Excel thì vào thẳng bảng dữ liệu**.
Bảy việc trong đặc tả V4b đều nằm **trong** cái bảng; không việc nào nói tới hai khối kia.

| # | Thiếu | Công | Ghi chú |
|---|---|---|---|
| **1** | **Tắt đường lưới** — `ws.views[0].showGridLines = false` | **một dòng** | Đổi nhiều nhất trên mỗi đồng công. Có lưới thì mắt đọc ra "bảng tính"; tắt đi mới ra "báo cáo". PDF không có lưới. Tôi đã grep: chưa có ở đâu trong `excel-export.ts`. |
| **2** | **Dải KPI ở đầu sheet** — 6 ô KPI, mỗi ô một nhãn + một số, tô theo tone như app | trung bình | Đây là **cả trang đầu của bản PDF**. Số đã có sẵn trong `p.projectCount`, `p.lateCount`… ở `index.tsx`; chỉ cần truyền xuống. |
| **3** | **Khối 7 thẻ giai đoạn** — tên giai đoạn + viết tắt + số việc theo bậc màu | nặng hơn | Thanh xếp lớp của app (xanh mờ → đỏ → vàng → xám) Excel không vẽ nổi trong một ô. Làm được: mỗi giai đoạn một hàng, bốn cột số theo bậc màu. **Đừng nhận việc theo cách "vẽ lại đúng cái thanh"** — đó lại là cái bẫy "giống hệt PDF" mà chính Plan đã cảnh báo. |

Việc 1 đáng làm **ngay**, gần như không có giá. Việc 2 và 3 nên để Plan quyết có mở V4c hay không —
nhưng **phải nói với người dùng là Excel hiện chưa có hai khối đó**, đừng để họ mở file ra mới thấy.

**MỘT CHỖ ĐẶC TẢ V4b VIẾT SAI, VÀ THỰC THI ĐÃ KHÔNG CHÉP THEO — GHI LẠI KẺO NGƯỜI SAU "SỬA" NGƯỢC**

Đặc tả mục 5 bảo khối chú giải ghi *"đúng chữ như chú thích trên app"* rồi liệt kê
`Trễ tiến độ · Cần cắt đầu việc · Cần tập trung · Đã hoàn thành`. **Hai câu đó chống nhau.** Chú
giải thật trên app (`index.tsx:4802`) ghi `Hoàn thành · Cảnh báo đỏ · Cảnh báo vàng · Đang triển
khai` — tức **theo MÀU**, kèm ghi chú tại chỗ nói thẳng *"ghi tên nhãn là sai"* vì một màu gom nhiều
nhãn. Bốn chữ đặc tả liệt kê là `ALERT_TXT`, vốn dùng cho **chữ trong ô cột Tình trạng**, không phải
cho chú giải. Đặc tả trộn hai bộ từ vựng khác nhau của app.

**Thực thi đã bắt được chỗ này và làm đúng**, không chép theo đặc tả: khối chú giải trong `a914b2f`
tách làm hai hàng — hàng màu ghi `Nặng / Cần chú ý / Đã hoàn thành` kèm câu *"Màu nói MỨC NGHIÊM
TRỌNG, không dính chết vào nhãn"*, rồi hàng dưới liệt kê bốn nhãn **như từ vựng**, không gán màu.
Đây là cách giải đúng, và tốt hơn cả phương án chép y nguyên chú giải app.

Còn lại một chuyện nhỏ thật: chữ trên Excel (`Nặng / Cần chú ý`) khác chữ trên app (`Cảnh báo đỏ /
Cảnh báo vàng`), và Excel không có mục xám `Đang triển khai`. Chấm cạnh nhau thì người thứ ba sẽ
thấy hai chú giải khác chữ. **Nên thống nhất về đúng chữ của app**, không chặn.

**Plan sửa lại mục 5 của đặc tả** để người sau không đọc đặc tả rồi "sửa" ngược lại thành sai.

**TRẢ LỜI LUÔN CHỖ CÒN MƠ HỒ CỦA ĐẶC TẢ V4b** (ngưỡng Quá hạn, Plan chưa đo): chỉ có **một** ngưỡng,
`OD_ALERT_DAYS = 14` ở `src/lib/filter.ts:34`, và app chia **hai bậc** ở `filter.ts:138`
(`>= 14` → bậc A, `> 0` → bậc B, còn lại C). V4b tô đúng hai bậc đó và **không** tự chế thang màu
liên tục — đúng. Không có ngưỡng thứ hai nào để phải hỏi lại.

**V4b CHƯA CÓ PHÁN QUYẾT.** Phần trên là soi đặc tả và soi ba chỗ Plan hỏi, **không phải** phán quyết
cho `a914b2f`. V4b cần một lượt Review riêng: nó thêm 143 dòng vào `exportTableXlsx`, có bảng màu
chép tay, có định dạng điều kiện, có `pageSetup`. Tôi chưa chạy lại gì trên commit đó.

---

### BẢN 3 · V4b — `a914b2f` + `a8119f2` + `29af58e` — ĐẠT KÈM ĐIỀU KIỆN

Đây là phán quyết mà phần trên còn để trống. Soi trên commit, đo ở **cây riêng sạch tại `d439041`**.

```
tsc                  : sạch (exit 0)
vitest               : 407 passed | 0 failed | 30 file
build                : qua (exit 0)
quét byte điều khiển : 16 byte · 7 file · 14 dòng — đúng mốc nền, V4b không thêm byte
```

*Đối chiếu số của Thực thi:* họ báo `419 passed | 2 expected fail | 31 file`. Khớp — chênh đúng 12
phép cộng một file, là file kiểm V1 của tôi còn chưa theo dõi trong cây (`407 + 12 = 419`). Báo cáo
của họ trung thực.

**ĐỐI CHIẾU ĐẶC TẢ**

- **Làm đủ: có**, cả bảy việc. Và **làm thêm hai thứ đúng chỗ** — tắt đường lưới, ghi rõ ràng buộc
  thang data bar — cả hai đều là chỗ tôi chỉ ra ở phần trên, không phải tự mở rộng phạm vi.
- **Làm thừa: không.** Hai khối KPI và thẻ giai đoạn **vẫn thiếu**, nhưng đó không phải lỗi V4b:
  chúng nằm ngoài bảy việc của đặc tả. Thực thi đã không tự làm — đúng.

**ĐÃ TỰ KIỂM TRÊN FILE THẬT, KHÔNG CHỈ TIN BỘ KIỂM**

Tôi dựng file `.xlsx` qua đúng `exportTableXlsx`, bung zip rồi đọc `xl/worksheets/sheet1.xml`.
Lý do không chỉ chạy bộ kiểm: phép kiểm của họ xét **mô hình exceljs**
(`WS.views[0].showGridLines`), còn thứ người dùng mở là **file XML**. Hai chỗ đó có thể lệch nhau, và
đó đúng loại lỗ đã để `numFmt` của V4a không ai gác được. Kết quả — khớp:

```
sheetViews : <sheetView workbookViewId="0" showGridLines="0">   → lưới ĐÃ TẮT trong FILE
pane       : xSplit="3" ySplit="3" state="frozen"               → đóng băng cả cột lẫn hàng
pageSetup  : paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"
Print_Titles (workbook.xml) : 'Báo cáo'!$3:$3                   → lặp tiêu đề mọi trang
headerFooter : &C&9Trang &P / &N                                → số trang ở chân
dataBar    : sqref G4:G7 · cfvo num=0 · num=100                 → thang TUYỆT ĐỐI, đúng lối lưu 85
Quá hạn    : sqref H4:H7 · cellIs ×2                            → hai bậc, không thang liên tục
dung lượng : 9.148 byte cho 4 dòng                              → ràng buộc 4 không thành vấn đề
```

*Một chỗ đáng khen vì nó dễ sai:* dải định dạng điều kiện dừng ở **đúng dòng dữ liệu cuối**
(`G4:G7` với 4 dòng), nên khối chú giải thêm ở dưới **không bị tô lây**. Nếu tính dải sau khi thêm
chú giải thì ô chú giải sẽ mọc thanh màu — không ai để ý cho tới lúc mở file.

*Phép kiểm chống lệch màu `tests/excel-mau-khop-app.test.ts` là bộ kiểm tốt.* Nó đọc thẳng
`src/routes/index.tsx` bằng `fs`, rút khối `const GC = { … }` bằng regex rồi so từng màu. Quan trọng
hơn: nó **tự gác chính nó** — có một phép kiểm đòi `Object.keys(mauGC()).length > 5`, nên nếu ai
đổi cách viết `GC` làm regex hết khớp thì bộ kiểm **đỏ to** chứ không âm thầm so sánh một tập rỗng.
Đây đúng là lời đáp cho chỗ tôi phê ở V4a (bộ kiểm tự khai lại danh sách cột).

**PHẢI SỬA TRƯỚC KHI DEPLOY** — không có.

**NÊN SỬA, KHÔNG CHẶN**

1. **Chiều cao hàng — việc "NẶNG NHẤT" của đặc tả, và là thứ duy nhất tôi KHÔNG xác minh được từ
   máy.** Cách làm là **bỏ hẳn `row.height`** để Excel tự giãn. Soi trong file:

   ```
   sheetFormatPr : defaultRowHeight="16" outlineLevelRow="1" … customHeight="1"
   hàng 1,2,3    : có ht + customHeight   (tiêu đề — đặt tay, đúng)
   hàng 4 trở đi : KHÔNG có ht, KHÔNG có customHeight
   ```

   Dòng dữ liệu **không bị đánh dấu chiều cao đặt tay** — đó là **điều kiện cần** để Excel tự giãn,
   và nó đạt. Nhưng `sheetFormatPr` mang `customHeight="1"` (do `defaultRowHeight: 16` ở
   `properties`), nghĩa là *chiều cao mặc định của sheet là do người đặt*. Theo chuẩn thì cờ đó nói
   về **mặc định của sheet**, không đánh dấu từng hàng, nên nó **không đáng lẽ** chặn việc tự giãn.

   Tôi nói "không đáng lẽ" vì **tôi không chạy được Excel thật để biết chắc**. Điều kiện cần thì
   đạt; điều kiện đủ thì chỉ Excel trả lời được. Đây là thứ **phải xem đầu tiên** khi mở file, và
   nếu chữ vẫn cụt thì chỗ đáng thử đầu tiên là **bỏ `defaultRowHeight` khỏi `properties`** — không
   phải quay lại đặt `row.height`.

2. **Chú giải: mục xám ghi "Đang triển khai (ô trống)" nhưng tô bằng `MAU.nenCon` (#F8FAFC).**
   Thực thi giải thích đúng là màu chú giải phải trùng thứ nó đang chú thích, và ô Tình trạng trống
   thì nền là màu dòng con. Nhưng #F8FAFC gần như trắng, cạnh ba ô đỏ/vàng/xanh đậm thì nó **trông
   như một ô rỗng lỡ tay** chứ không như một mục chú giải. Thêm viền mảnh quanh ô đó là xong. Nhỏ,
   nhưng nó nằm trong khối mà người nhận đọc để hiểu cả bảng.

3. **Hai khối còn thiếu so với PDF (KPI, thẻ giai đoạn).** Đã nói ở phần trên. Không tính vào V4b.

**RỦI RO KHI DEPLOY**

- **Ảnh hưởng ai:** ai bấm "Xuất Excel". Lần này họ thấy đổi **nhiều**: mất đường lưới, dòng con có
  nền xám nhạt, hàng quá hạn nền ấm + mép trái, cột % có thanh màu, cột Quá hạn tô hai bậc, cuối
  bảng có khối chú giải, bấm in ra A4 ngang vừa một trang bề ngang.
- **Hỏng thì sao:** xấu nhất là **file nhìn không như ý** — không có đường nào làm sai một con số,
  vì V4b chỉ thêm `fill`, `numFmt`, `conditionalFormatting` và `pageSetup`; không chỗ nào đụng
  `cells`. Tôi đã soi diff cả hai commit để chắc điều đó. Không chạm đường nạp dữ liệu, không chạm
  KV, không chạm `exportMatrixXlsx`.
- **Lùi lại được không:** được, deploy lại commit trước. Không dữ liệu nào bị biến đổi.
- **Hạn mức KV: thêm 0 lượt/ngày.**

**BA CHỖ PLAN NHỜ SOI THÊM — trả lời, và một lời khai phải sửa lại**

**Chỗ 1 · Bẫy 32 chỗ neo hàng cứng: `a8119f2` KHÔNG thêm gì phía trên bảng, nên bẫy chưa nổ.**
Tôi grep mọi `addRow` mới trong commit đó: không có dòng nào nằm trước vòng ghi dữ liệu — chỉ có
khối chú giải ở **cuối**. Dò lại trong file thật: dữ liệu vẫn bắt đầu ở **hàng 4**. Nên phép kiểm
**không nói dối**; nó chỉ **chưa bị thử** ở tình huống đó, và vẫn neo cứng. Bẫy còn nguyên cho việc
nào thêm khối phía trên (tức đúng việc dải KPI).

**Chỗ 2 · Lời khai "ba tuỳ chọn data bar là vô hiệu" — SAI VỚI HAI TRONG BA.** Đây là chỗ đáng sửa
nhất trong ba chỗ, vì nếu tin lời khai đó rồi đi dọn code thì **đổi cái người dùng nhìn thấy**.

exceljs ghi data bar ra **hai khối**, không phải một:

```
khối cũ (trong <conditionalFormatting sqref="G4:G6">):
   <dataBar><cfvo type="num" val="0"/><cfvo type="num" val="100"/><color rgb="FF5EE9B5"/></dataBar>

khối x14 (trong <extLst> cấp worksheet, uri 78C0D931-… — Excel 2010+ ĐỌC KHỐI NÀY):
   <x14:dataBar minLength="0" maxLength="100" gradient="0">
     <x14:cfvo type="num"><xm:f>0</xm:f></x14:cfvo>
     <x14:cfvo type="num"><xm:f>100</xm:f></x14:cfvo>
   </x14:dataBar>
```

| Tuỳ chọn trong code | Có vào file? | Hệ quả |
|---|---|---|
| `minLength: 0` | **CÓ** — `x14:dataBar/@minLength` | có tác dụng |
| `maxLength: 100` | **CÓ** — `x14:dataBar/@maxLength` | có tác dụng |
| `gradient: false` | **CÓ** — `gradient="0"` | có tác dụng: thanh **đặc**, không chuyển sắc |
| `showValue: true` | **KHÔNG** | vô hại — mặc định của chuẩn đã là `1`, trùng ý muốn |

Nên: **chỉ `showValue` bị bỏ**, và nó bị bỏ một cách vô hại. Ba cái kia có hiệu lực thật.
**Đừng dọn chúng đi.** Bỏ `gradient: false` là để Excel quay về mặc định chuyển sắc — thanh màu đổi
từ đặc sang gradient, tức đổi cái người dùng nhìn, mà không có phép kiểm nào bắt.

Ghi chú trong code **không cần sửa**: nó lập luận từ `cfvo`, không lập luận từ ba tuỳ chọn kia.

**Chỗ 3 · Mã màu viết thẳng: phần lớn vô hại, đúng MỘT chỗ đáng dọn.** Tôi đếm lại được **67** mã
(Plan báo 59 — chênh vì file đã đổi từ lúc Plan đếm), rồi tách theo đường xuất:

| Ở đâu | Số mã | Đánh giá |
|---|---|---|
| Khối `MAU` | 7 | đang được `tests/excel-mau-khop-app.test.ts` canh |
| `exportMatrixXlsx` (dòng 233–637) | 24 | **đường xuất KHÁC**, đặc tả cấm đụng. Không canh là ĐÚNG. Cả 6 lần `FF16202E` nằm ở đây. |
| `exportTableXlsx` (từ dòng 638) | 18 | xem dưới |
| Ngoài hai hàm (`STATUS_FILL` v.v.) | 18 | |

Trong 18 mã của `exportTableXlsx`: **17 là màu trung tính** — chữ trắng `FFFFFFFF`, chữ đậm
`FF1B1B1B`, viền mảnh `FFE2E8F0`/`FFCBD5E0`, chữ mờ `FF5B6B7E`. Bốn mã khác nhau, không mang nghĩa
nghiệp vụ nào, **không có gì để trôi**.

**Đúng một mã mang nghĩa: dòng 745, `"FFEF4444"`** — nền đỏ ô ngày kết thúc khi dự án quá hạn. Và
`STATUS_FILL.RED.bg` cũng là `"FFEF4444"`. **Cùng một sắc đỏ viết ở hai chỗ.** Thêm một cặp nữa cùng
loại: `MAU.duAnXong = "FF059669"` trùng `STATUS_FILL.GREEN.bg = "FF059669"`.

Hôm nay hai bên bằng nhau nên không sai gì. Nhưng cách hỏng thì cụ thể: ai chỉnh một sắc đỏ, ô ngày
quá hạn thôi khớp badge Tình trạng, và người đọc thấy **hai mức đỏ khác nhau** — đúng lập luận mà
chính Thực thi đã dùng để giữ màu chú giải. Sửa gọn: dòng 745 dùng `STATUS_FILL.RED.bg`, và
`MAU.duAnXong` trỏ về `STATUS_FILL.GREEN.bg`. **Nợ gọn gàng, không chặn.**

**V4b CÓ COMMIT THỨ BA: `29af58e` — HAI MỤC "NÊN SỬA" CỦA TÔI ĐÃ ĐƯỢC LÀM**

Giữa lúc tôi soi, Thực thi làm đúng hai việc tôi nêu ở mục NÊN SỬA phía trên rồi commit thành
`29af58e`:
- **bỏ `defaultRowHeight: 16`** khỏi `properties` của `exportTableXlsx` — đúng chỗ tôi bảo thử đầu
  tiên nếu chữ vẫn cụt, và họ làm ngay thay vì để treo chờ mở Excel;
- **thêm viền mảnh** quanh ô chú giải xám.

Tôi dò lại file thật sau thay đổi: `<sheetFormatPr defaultRowHeight="15" …>` — **`customHeight` đã
hết**, hàng 4 trở đi vẫn không có `ht` lẫn `customHeight`. Đây là cấu hình sạch nhất cho việc tự
giãn: không còn một cờ nào ở tầng nào nói rằng chiều cao là do người đặt. Khả năng hỏng mà tôi
**không kiểm được** đã bị gỡ hẳn chứ không để chờ.

`defaultRowHeight: 16` ở dòng 281 **vẫn còn** — nhưng đó là trong `exportMatrixXlsx`, đường xuất khác
mà đặc tả cấm đụng. Đúng.

Đo lại ở **cây riêng sạch tại `29af58e`**:

```
tsc                  : sạch (exit 0)
vitest               : 432 passed | 2 expected fail | 32 file | 0 FAILED
build                : qua (exit 0)
quét byte điều khiển : 16 byte · 7 file · 14 dòng — đúng mốc nền
```

Khớp từng con số với báo cáo của Thực thi. *Hai phép `expected fail` giờ xuất hiện cả ở cây sạch:
`55a11bc` đã **nhận file kiểm mồ côi** `tests/chu-gach-ngang-ranh-gioi.test.ts` của tôi từ vòng V1
vào cây, nguyên vẹn. Nghĩa là hai lỗi L7 còn sống tôi tìm được ở vòng đó nay **đã có người gác** thay
vì nằm ngoài cây — tốt.*

**Phán quyết V4b ở trên phủ cả ba commit: `a914b2f` + `a8119f2` + `29af58e`.**

**BA THỨ KHÔNG BOX NÀO NGHIỆM THU ĐƯỢC TỪ MÁY — chốt lại cho anh Tiến**

Cả bốn box đều dừng ở cùng chỗ: **chưa ai mở file bằng Excel thật.** Mọi kết luận đọc từ XML và từ
exceljs. Ba thứ dưới đây **chỉ mắt người mở file trả lời được**, và tôi không giả vờ đã kiểm:

1. **Chiều cao hàng có tự giãn không** — ô "Vướng mắc" dài nhất có hiện đủ chữ. Điều kiện cần đã
   đạt (không hàng dữ liệu nào bị đánh dấu chiều cao đặt tay, và `customHeight` cấp sheet đã bỏ).
   Đây là việc **NẶNG NHẤT** của vòng này.
2. **Thanh màu ở ô có giá trị 0** vẽ ra thế nào. Trong file là số `0` thật với `minLength="0"`, nên
   *đáng lẽ* là một thanh dài 0 — nhưng "đáng lẽ" ở đây là suy từ chuẩn. Cần xem nó khác ô **trống**
   (không có thanh) đủ rõ hay không, vì hai thứ đó mang hai nghĩa khác nhau (luật 5.2).
3. **Bấm `Ctrl+P`** có vừa một trang bề ngang và có lặp hàng tiêu đề ở trang 2 trở đi.

**Một câu cho gọn:** V4b làm đúng và làm sạch phần việc nó nhận. Thứ còn cách bản PDF không phải
chất lượng của V4b — mà là **phạm vi**: Excel vẫn chưa có trang tóm tắt mà PDF có.

---

### BỐN ĐIỀU KIỆN — áp cho cả ba bản

**ĐK1 · Deploy phải xuất phát từ CÂY SẠCH ở commit đã có phán quyết. Đây là điều kiện chặn thật.**

*Cập nhật cuối 28/09:* lúc tôi viết điều kiện này, 154 dòng V4b đang nằm trong cây chưa commit. Thực
thi **đã commit chúng** thành `a914b2f`, và commit đó **chỉ gồm 4 đường dẫn code/test** — không kéo
theo mục ④ tôi đang viết. Làm đúng luật 5.6 và L12.

Nên lỗ hổng "deploy dựng từ cây bẩn" đã đóng. Nhưng điều kiện **vẫn còn**, chỉ đổi lý do:

- `a914b2f` (V4b) **chưa có phán quyết Review nào.** Deploy `main` lúc này là đưa V4b lên production
  không qua cửa cuối. Phán quyết ở mục này chỉ phủ `40eae6c` và `c188f92`+`8763e2a`.
- V2b **không nằm trong đường đó**: nó ở `40eae6c`, độc lập hoàn toàn với V4 (không chung file, không
  chung đường gọi). Muốn deploy V2b một mình thì deploy từ một commit không chứa V4b, hoặc chờ V4b
  có phán quyết rồi lên cả ba.

Ai bấm deploy: `git status --short` phải trống ở `src/`, **và** commit đang deploy phải là commit có
phán quyết trong mục này.

**ĐK2 · Dọn phép kiểm đang đỏ trước khi bấm deploy.** Không phải vì nó liên quan hai bản này — nó
không liên quan. Mà vì deploy trong lúc bộ kiểm đỏ là **tự bỏ lưới an toàn**: lần sau ai chạy
`vitest` cũng thấy một phép đỏ và sẽ học cách bỏ qua nó. Box Test kia cần **hoàn thành hoặc hoàn
tác** bản sửa `tests/matrix-reader.test.ts` đang dở (`wbChung` chưa khai). Tôi **không sửa** —
không phải việc của Review, và đó là việc đang làm dở của người khác.

**ĐK3 · V2b: chạy bảng ba nhánh NGAY SAU deploy, đừng đợi hết ngày.** Đây là chỗ không ai kiểm được
từ máy: `crypto.subtle` trên Workers. Bảng ba nhánh ở cuối mục ① là đường đỡ đúng chỗ, và nó **đủ
đỡ** — nó phân biệt được cả ba trường hợp (băm chạy / băm rỗng / dòng đếm mất hẳn) bằng một câu SQL.
Thêm một điều cụ thể: câu kiểm phải bao gồm `SELECT COUNT(*) FROM kv_write WHERE bam IS NULL AND
ts >= <ngày deploy>`. Nếu con số đó **lớn hơn 0**, nghĩa là đường lùi hai cột đang chạy — tức
`crypto.subtle` hoặc cột `bam` có vấn đề, và cái băm đang im lặng không có. Không hỏi câu đó thì
hỏng kiểu đó **không phát ra tiếng nào**, đúng họ hàng L3 mà Plan đã lo.

**ĐK4 · V4a: mở file xuất ra bằng Excel thật, đúng một lần.** Thực thi đã tự khai đây là chỗ họ
không làm được (mục ② số 5) và họ khai đúng. Mọi kết luận — của Thực thi, của Test, và của tôi —
đều đọc XML trong file `.xlsx` chứ không mở Excel. Chuẩn OOXML nói ô mang `numFmtId` trỏ `dd/mm/yy`
sẽ hiện ra thế, và tôi tin, nhưng **một lần mở thật** là rẻ hơn nhiều so với gửi cho Ban điều hành
một file hiện `########`. Việc cần làm đúng ba thứ: bấm sắp xếp cột "Ngày kết thúc" xem có ra đúng
thứ tự thời gian, bôi đen cột "Quá hạn" xem thanh dưới có hiện Sum, và bấm dấu `+` ở lề trái xem
nhóm có xổ ra.

**THỨ TỰ — đã cập nhật sau khi Plan chốt `baef39b`.**

Plan vừa chốt *"không deploy V4a một mình, ghép với V4b rồi lên một lần"*, vì V4a sửa một thứ đang
sai nhưng người dùng mở file ra gần như không thấy khác. Tôi soi V4a về mặt **kỹ thuật** và nó lành;
việc nó có đủ để xuất hiện trước người dùng một mình hay không là **quyết định của Plan và người
dùng**, không phải của Review. Phán quyết ĐẠT KÈM ĐIỀU KIỆN của tôi cho V4a **giữ nguyên** — nó nói
code này an toàn để lên, không nói nó nên lên lúc nào.

Hệ quả gộp lại:

1. **V2b lên trước, một mình, được.** Nó độc lập hoàn toàn với V4: không chung file, không chung
   đường. Deploy nó không phải chờ V4b. Cần ĐK1 (cây sạch) + ĐK2 (bộ kiểm xanh) + ĐK3.
2. **V4a chờ V4b.** Quyết định của Plan làm ĐK1 chỉ còn **một đường**: V4b đi trọn dây chuyền, rồi
   lên cùng V4a. Không còn phải stash gì nữa — nhưng lúc đó **V4b phải có phán quyết Review riêng**,
   và 154 dòng đang nằm trong cây hôm nay **chưa có**.
3. **ĐK4 (mở bằng Excel thật) dịch sang buổi deploy V4a+V4b**, và lúc đó đáng làm gộp một lần: V4b
   sinh ra để sửa phần nhìn, nên dù sao cũng phải mở Excel thật mới nghiệm thu được nó.

---

## ⑤ BÀI HỌC MỚI

**Vòng V2b + V4a (28/09) — REVIEW đã thêm `L15` vào NEN-TANG.md phần 4** — *`tsc` không phủ
`tests/`, nên "tsc sạch" chưa bao giờ nói gì về file kiểm.* Có ngày, có con số, có chỗ nó vừa để lọt
thật (`wbChung` không tồn tại mà `tsc` exit 0).

**Và đã ghim một chỗ TRỐNG ở `L14`.** Commit `40eae6c` ghi *"xem L14"* nhưng mục đó **chưa bao giờ
được viết**. Nội dung thì đọc được từ chính thông điệp commit — *chốt bằng số lượt `put`, không chốt
bằng dấu vết gián tiếp* — nhưng tôi không viết hộ: người viết dòng ấy biết chuyện gì đã xảy ra, tôi
chỉ biết nó được nhắc tới. Tôi đã đánh dấu `L14` là **chưa viết, đừng ai lấy số đó**, và mục của tôi
lấy `L15`. Việc này đúng thứ luật 5.4 dựng ra để chặn: mã lỗi trong ghi chú mà trỏ vào chỗ trống thì
người sau đi tìm không thấy gì, rồi "dọn dẹp" đoạn code kèm nó.

Chỗ đáng nhớ nhất của lượt Review này không phải hai bản code — cả hai đều lành. Nó là chuyện
**cùng một phép kiểm, cùng một commit, ba máy ra ba kết quả**: `findMatrixSheets` chạy 1.263 ms trên
máy này, 5.943 ms ở Plan, 8.352 ms ở Thực thi. Cả ba báo trung thực. Không ai sai. Nhưng nếu chỉ một
người đo rồi kết luận "có gì đó vừa chậm đi", cả đội sẽ đi tìm một nguyên nhân không tồn tại. Phép
kiểm nào đọc file thật thì thời gian của nó **không phải một hằng số** — đừng chốt mốc sát, và đừng
đọc một lần đo như một sự thật.

---

**Vòng V2b (24/09) — TEST: không thêm mục nào.** Chỗ NFC/NFD ở mục ③ là một cái bẫy thật, nhưng sổ
lỗi phần 4 là sổ **những lần đã hỏng thật, có ngày tháng**. Cái này chưa làm hỏng gì — nó mới chỉ
có thể làm đọc sai một con số chưa được đo. Chốt bằng phép kiểm là đủ; nhét vào sổ lỗi bây giờ là
làm loãng thứ đang có giá trị vì nó toàn chuyện đã xảy ra. Nếu khi đọc số thật mà nó gây kết luận
sai, lúc đó mới thành `L15` kèm ngày và con số.

---

**Vòng V1 (21/09) — TEST đã thêm `L13` vào NEN-TANG.md phần 4** — *Cái thước tự nó sai, và không ai đo lại cái thước.*

Và đã **sửa luôn lệnh quét ở NEN-TANG phần 6**, vì để nguyên thì cả bốn box vẫn đo bằng cái thước
hụt. Lệnh mới: nhận thư mục, tự đi vào trong, phủ đúng dải `0x00-0x08 · 0x0b · 0x0c · 0x0e-0x1f`,
in tên file · số dòng · mã byte. Chạy lên cây hiện tại ra **16 byte**, khớp từng dòng với phép đo
độc lập ở mục ③.

Đây là chỗ đáng nhớ nhất của lượt này: lỗi ① (Plan sót một file) **không phải Plan cẩu thả** - Plan
dùng đúng công cụ mà sổ nền tảng đưa cho, và công cụ đó mù với `0x11`. Sửa người thì hỏng lại,
sửa cái thước thì hết.
