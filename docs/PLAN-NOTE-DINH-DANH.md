# Note/Vướng mắc trôi sang công việc khác - phân tích nguyên nhân và kế hoạch sửa

Đo ngày 05/10/2026. Chưa sửa một dòng code nào.

**Nguồn số liệu**
- File nguồn: `mp26.xlsx` = bản tải trực tiếp từ Project Master Plan 2.6 (`fileId 1hx8yzpoQio4yla3jmooni5cu1g9-M7tu`), sheet `Timeline`, đúng bản app đang đọc.
- Kho ghi chú: `.data/pmo-edits.json`, **bản chụp local ngày 02/10/2026**, KHÔNG phải KV production. Mọi con số về kho note bên dưới phải đo lại trên production trước khi chốt khối lượng di trú. Lý do: đọc KV production đang bị chặn (xem memory `khong-doc-duoc-production`).
- Script đo nằm trong scratchpad phiên này: `do-rid.mjs`, `mo-phong-khoa.mjs`, `do-bam.mjs`, `tach-mat.mjs`.

---

## A. Root Cause

**Giả thuyết ban đầu (note khoá theo row index / tên công việc) KHÔNG phải nguyên nhân chính.** App đã có hệ định danh 4 tầng từ lâu, có mỏ neo, có dò trôi, có công cụ dời khoá. Không có `notes[index]` nào, không có `noteMap[task.name]` nào. `key={index}` trong React không liên quan (xem mục E).

Nguyên nhân thật nằm ở **hàm phân giải khoá `nk()`**:

```
src/routes/index.tsx:3249
const nk = (it) => { const cs = itemKeysOf(it); return cs.find(rowHasData) ?? cs[0]; }
```

`nk()` không trả khoá bền nhất của dòng. Nó trả **khoá ứng viên ĐẦU TIÊN mà trong kho đang CÓ dữ liệu**. Chuỗi ứng viên là `rid: → h: → id:<STT> → composite`.

Hậu quả: một dòng có RID riêng, duy nhất, hoàn toàn khoẻ, nếu ô `rid:` của nó đang trống mà ô `id:<STT>` lại đang có dữ liệu (do dòng KHÁC ghi vào) thì `nk()` bỏ qua RID và **bám vào ô của dòng khác**. Bám rồi thì cả ĐỌC lẫn GHI đều vào ô đó, vì cùng một `nk()` dùng cho hai việc (`index.tsx:3518` lấy khoá để vẽ ô và để gửi lên server).

Hai điều kiện phụ làm cái bẫy này nổ thường xuyên:

1. `id:<STT>` **không gắn với dự án nào**. Khoá chỉ là `id:` + số STT, không có mã CT. Hai dự án khác nhau cùng có dòng STT `5.5` thì dùng chung một ô lưu.
2. `rowHasData` tính cả `completedDates` và `hiddenMap`, không chỉ `edits` (`index.tsx:3245`). Nên một ô chỉ có cờ ẩn hoặc ngày hoàn thành, không có chữ nào, cũng đủ để kéo `nk()` bám vào.

Đây đúng là cơ chế gây ra hiện tượng anh thấy: đổi thứ tự dòng, thêm/xoá dòng, đánh lại STT trong file nguồn đều làm ứng viên `id:<STT>` của một dòng trỏ sang số mà dòng khác đang chiếm.

### Contributing factors

Xếp theo mức đóng góp, tất cả đều đo được:

| # | Yếu tố | Số đo trên file 2.6 |
|---|---|---|
| 1 | RID bị trùng nên app phải bỏ | 158 số RID trùng, phủ **358 dòng** |
| 2 | RID để trống | **56 dòng** |
| 3 | Cột IDCUNG **không tồn tại** trong file 2.6 nên tầng `h:` chết hẳn | `detectHidCol` trả -1 |
| 4 | STT trùng | **285 giá trị STT** bị từ 2 dòng dùng |
| 5 | Ghi chú thiếu dấu danh tính `dc` nên không tra ngược được | **174 / 324** ô |
| 6 | `dupIdx` tính theo thứ tự xuất hiện trong dự án, chèn dòng cùng mã ở trên là lệch | `parser.ts:878-882` |

Cộng lại: trong 1332 dòng có dữ liệu, chỉ **918 dòng (68,9%)** thực sự có địa chỉ `rid:`. **414 dòng** rơi xuống `id:<STT>`, và tầng `h:` không đỡ được vì file không có cột IDCUNG.

### Secondary bugs

Hai lỗi độc lập, không phải nguyên nhân của hiện tượng trôi nhưng phải sửa cùng:

- **`projectKeyOf` và `projectKeysOf` ghép composite khác nhau.** `filter.ts:261` ghi `code\u0000name`, `filter.ts:269` đọc `code + " " + name`. Khoá ghi và khoá đọc dự phòng không bao giờ gặp nhau ở tầng composite cấp dự án.
- **`projectKeysOf` được import mà không dùng.** `index.tsx:36` import, cả file không gọi lần nào. Ghi chú **cấp dự án** vì vậy KHÔNG có đọc dự phòng: `pkProj` chỉ gọi `projectKeyOf`. Nguồn đổi RID hay STT cấp dự án là note cấp dự án mất luôn, không có lưới đỡ nào.

---

## B. Evidence từ codebase

### B1. Chuỗi khoá - `index.tsx:2316-2341`

```
itemKeyOf(it)  = ridKeys(it.rid)[0]
               | `h:${projHid}:${rawCode}:${dupIdx}`
               | `id:${it.id}`
               | `${projectCode}\0${projectName}\0${rawCode}\0${dupIdx}`

itemKeysOf(it) = cùng 4 tầng, trả CẢ MẢNG (dùng cho đọc dự phòng)
```

Tầng 3 là `id:${it.id.trim()}` - **không có mã dự án trong khoá**. Xác nhận bằng mắt trên code.

### B2. Hàm bám - `index.tsx:3245-3249`

```
rowHasData = (k) => edits[k] !== undefined || completedDates[k] !== undefined || hiddenMap[k] !== undefined
nk         = (it) => itemKeysOf(it).find(rowHasData) ?? itemKeysOf(it)[0]
```

### B3. Chính codebase đã ghi rằng `nk()` không ổn định - `index.tsx:2679`

> "`nk()` còn tệ hơn: nó chọn khoá theo edits + completed + hidden, ba query về ba thời điểm, nên ba lượt chạy cho ra ba bộ khoá khác nhau."

Nghĩa là trong **cùng một lần mở app**, `nk()` của một dòng có thể đổi giá trị giữa các lượt render, tuỳ query nào về trước. Đã được chặn một phần bằng `dangTaiKho` (useIsFetching) cho các effect ghi nền, nhưng bản thân `nk()` dùng để vẽ và để ghi note thì không bị chặn.

### B4. Đo trên file nguồn thật

```
tổng dòng có dữ liệu      : 1332
  có RID                  : 1276
  RID để trống            :   56
  số RID duy nhất         : 1076
  số RID bị trùng         :  158  -> 358 dòng bị app bỏ RID
  => dòng có địa chỉ rid: :  918  (68,9%)
  => dòng rơi xuống STT   :  414
có STT 1332/1332, trong đó 285 giá trị STT bị trùng
cột IDCUNG               : KHÔNG CÓ (hidCol = -1)
```

Vài số RID trùng: `205 x5, 206 x5, 207 x5, 208 x5, 209 x5, 210 x5, 211 x5, 212 x5`. Khớp đúng ghi chú trong `parser.ts:595-604`: trùng sinh ra khi copy nguyên khối dự án, `stamp-rid.gs` chỉ điền ô trống nên bản sao giữ y số cũ.

### B5. Mô phỏng `itemKeyOf` trên file nguồn - ô lưu bị dùng chung

```
1178 dòng hạng mục -> 1156 ô lưu
22 ô bị 2 dòng dùng chung (44 dòng)
cả 22 ô đều ở tầng id:  (tầng rid: không có ô nào bị trùng)
cả 22 ô đều bị 2 dự án KHÁC NHAU dùng chung
```

Ví dụ:

```
id:5.5  <- CT26-011 Trục Đông Tây 2C / SD   +   CT26-044 Văn Lang Empire Golf Club / GCN
id:32.6 <- CT26-122 APEC S6_M-Gallery / TKSX +  CT26-050 THV_Penthouse 2A / SX
id:14.5 <- CT26-078 Nam Phương Hoàng Hậu / SD + CT26-077 43 ĐTM_Marriott_Phòng / SD
```

### B6. Mô phỏng `nk()` - thiệt hại thật

Đây là phép đo quan trọng nhất. Chạy trên file nguồn 2.6 + kho note bản chụp 02/10:

```
dòng hạng mục trong nguồn               : 1178
dòng đang hiện một ghi chú              :  215
  trong đó BÁM vào ô KHÔNG phải ưu tiên :  142
     - dấu danh tính KHÁC dòng đang hiện:   61   <- GHI CHÚ ĐỨNG SAI CHỖ
     - ô không có dấu danh tính         :   81   <- không kết luận được
Ô ghi chú bị >=2 dòng cùng chiếu        :   62 ô / 124 dòng
```

**61 ghi chú đang hiện ở dòng mà chính dấu danh tính của nó nói là của dòng khác.** Đây không phải suy đoán: `ItemEdit.dc` do app tự đóng dấu lúc người dùng ghi, nên nó là lời khai của chính ghi chú đó.

Ví dụ cụ thể:

```
ô id:6.1    đang hiện ở : CT25-070 Nam Phương Hoàng Hậu Public / TK
            dấu ghi là  : CT26-011 · Trục Đông Tây 2C_Phòng (6 blocks) · Phát hành thiết kế
            nội dung    : "Còn căn Suite 2BR chưa chốt TK"

ô id:27.6   đang hiện ở : CT26-041 APEC_S3_Public / TKSX
            dấu ghi là  : CT26-129 · APEC_S4_Vách modular đại trà · Triển khai sản xuất

ô id:33.6   đang hiện ở : CT26-074 Mini Hotel_GĐ2_ĐẠI TRÀ / SX
            dấu ghi là  : CT26-122 · APEC S6_M-Gallery_MUR · Triển khai sản xuất

ô id:25.7   đang hiện ở : CT26-029 THV_Căn hộ 2B-L06 / TC
            dấu ghi là  : CT26-083 · APEC_S4_Khách sạn Marriott Khối phòng · Sản xuất nhập kho
```

### B7. Kho note đang nằm ở tầng nào

```
256 ô có chữ, theo hình dạng khoá:
  id:              233   (91%)
  composite-4phần   11
  rid:               8
  composite-2phần    3
  composite-6phần    1
```

**91% ghi chú đang nằm ở tầng `id:<STT>`** - đúng tầng mong manh nhất. Chỉ 8 ô ở tầng `rid:`. Nghĩa là dù app đã ưu tiên ghi theo RID từ 11/09, `nk()` vẫn kéo phần lớn lượt ghi về lại tầng `id:` vì ở đó đang có dữ liệu.

### B8. Cổng dữ liệu đã cảnh báo nhưng không chặn

`parser.ts:1118-1121` đã có check `sttDup`:

> "`${sttDupCount}` dòng TRÙNG STT (ID) - Vướng mắc có thể nhảy sang dòng khác hoặc bị đè mất"

Mức `warn`, hiện trong Hệ thống → Cảnh báo dữ liệu, chỉ PMO/admin thấy. Changelog v3.41.0 ghi "STT file hiện tại: SẠCH" - lúc đó sạch, bây giờ 285 giá trị trùng. Cảnh báo chạy đúng, chỉ là không ai chặn.

### Mức tin cậy

**Confirmed** (đọc code hoặc đo được):
- Cơ chế bám của `nk()`; `id:` không gắn dự án; `rowHasData` tính cả completed/hidden.
- Cột IDCUNG không có trong file 2.6, tầng `h:` chết.
- Toàn bộ số ở B4, B5, B7.
- 61 ghi chú đứng sai chỗ và 62 ô bị 2 dòng cùng chiếu (B6), trên bản chụp 02/10.
- Lệch dấu ngăn `projectKeyOf` / `projectKeysOf`; `projectKeysOf` không được gọi.

**Likely**:
- 81 ô bám lệch nhưng không có dấu danh tính phần lớn cũng sai chỗ. Cùng tầng `id:`, cùng cách bám, chỉ thiếu lời khai.
- Số trên production lớn hơn bản chụp local, vì bản chụp chỉ là bản dev.

**Unknown / cần xác minh**:
- Số thật trên KV production. Phải đo lại trước khi chạy di trú.
- `completedDates` và `hiddenMap` góp thêm bao nhiêu lượt bám sai. Đo B6 chỉ dùng `edits`, nên 142 là **cận dưới**.
- Ghi chú cấp dự án lệch bao nhiêu. Phép đo B6 chỉ mô phỏng dòng hạng mục, chưa mô phỏng `pkProj`.

Cần xem thêm để chốt hai mục cuối: `src/lib/edits.functions.ts` (`readAll`), kho `pmo-completed.json`, `pmo-hidden.json`, và mô phỏng `projectKeyOf` trên cùng file nguồn.

---

## C. Current Identity Model

Dòng nào là "cùng một đầu việc" qua các lần import:

| Tầng | Khoá | Bền khi | Vỡ khi | Phủ thực tế |
|---|---|---|---|---|
| 1 | `rid:<số>` | RID duy nhất và có điền | RID trùng hoặc trống | 918/1332 = 68,9% |
| 2 | `h:<IDCUNG>:<mã>:<dupIdx>` | nguồn có cột IDCUNG | không có cột | **0%** |
| 3 | `id:<STT>` | STT không đổi, không trùng | đánh lại STT, trùng STT | 414 dòng, 285 STT trùng |
| 4 | `<mã CT>\0<tên>\0<mã GĐ>\0<dupIdx>` | tên dự án không đổi | đổi tên dự án, chèn dòng cùng mã | ~0% (mọi dòng đều có STT) |

Khoá bền thật sự chỉ có tầng 1. Tầng 2 chết. Tầng 3 và 4 đều phụ thuộc vị trí hoặc tên.

Ngoài khoá, mỗi ghi chú còn mang `ItemEdit.dc` = `mã CT ‖ tên dự án ‖ giai đoạn ‖ mô tả ‖ RID`, đóng dấu lúc ghi. Đây là tài sản quan trọng nhất cho việc di trú: 150/324 ô đã có dấu.

Và có `pmo-noteanchor.json` = mỏ neo baseline, ghi "trước đó note này nằm ở đâu".

---

## D. Target Identity Model

Không đổi kiến trúc. Giữ nguyên 4 tầng, sửa 3 chỗ:

**D1. `id:` phải gắn dự án.** Khoá mới `id:<mã CT>:<STT>`. STT trùng giữa hai dự án thì hết va nhau. Đây là thay đổi nhỏ nhất xoá được 22/22 ô va chạm đo ở B5.

**D2. `nk()` không được bám theo "ô nào có dữ liệu".** Thay bằng: bám theo **ô nào có dữ liệu VÀ dấu danh tính khớp dòng này**. Ô không có dấu thì chỉ bám khi khoá đó không ứng với dòng nào khác. Quy tắc:

```
nk(it):
  cs = itemKeysOf(it)
  1. ô nào có dc khớp dinh4(danh tính hiện tại của it)        -> lấy ô đó
  2. không có, thì ô nào có dữ liệu mà KHÔNG ô nào tranh      -> lấy ô đó
  3. không có                                                 -> cs[0] (đích ghi mới)
```

Bước 2 cần biết "ô này có dòng nào khác cũng ứng không" - tính một lần cho cả bảng, không tính theo từng dòng.

**D3. `task_id` bất biến.** `rid:<số>` chính là nó, miễn RID duy nhất. Tiêu chí bất biến: một số RID chỉ được một dòng dùng, và không bao giờ bị gán lại cho dòng khác. Hiện 158 số vi phạm. Việc này **phải sửa ở file nguồn**, app không tự sửa được: app không có cách nào biết trong 5 dòng cùng RID 205 thì dòng nào là chủ.

Không dùng tên công việc làm ID. Không sinh ID mới phía app, vì ID do app sinh sẽ mất mỗi khi nguồn thay dòng.

Schema giữ nguyên, không đổi:

```json
"rid:530": {
  "dc": "CT26-011||Trục Đông Tây 2C||TKSX||Triển khai sản xuất||ePMP530",
  "noteMsgs":   [{ "id": "...", "text": "...", "author": "...", "at": "..." }],
  "actionMsgs": [...],
  "pic": "...", "deadline": "2026-10-20", "updatedAt": "..."
}
```

`dc` đã là đúng thứ cần. Chỉ cần đóng dấu cho **đủ 100% ô** thay vì 150/324.

---

## E. Data Flow hiện tại

```
Google Sheet / xlsx Project Master Plan 2.6, sheet Timeline
  -> sheets.functions.ts  tải file
  -> parser.ts  parseTimelineRows
         detectColumns          neo theo header "Show"
         detectRidCol           quét cửa sổ header-1 .. header+2
         detectHidCol           -> -1, KHÔNG CÓ cột IDCUNG
         detectIdCol            -> cột 12 (STT)
         đếm RID trùng -> ridTrung (158 số)
         ridOf()   trùng thì trả undefined  -> 358 dòng mất địa chỉ RID
         dupIdx    đếm theo thứ tự xuất hiện trong dự án
  -> ItemRow { rid?, id?, projHid?, projectCode, projectName, rawCode, dupIdx }
  -> index.tsx
         itemKeysOf(it)  -> [rid:.., (h:..), id:<STT>, composite]
         nk(it)          -> ứng viên ĐẦU TIÊN có dữ liệu          <-- ĐIỂM VỠ
  -> sort / filter  (chỉ đổi thứ tự hiển thị, KHÔNG đụng khoá)
  -> render  edits[nk(it)]
  -> người dùng gõ -> editMessages({ key: nk(it), dc: danhChiNow[key] })
  -> edits.functions.ts  readAll -> merge -> writeAll
  -> KV PMO_EDITS  "edits:v1" = { [key]: ItemEdit }
  -> reload: fetchEdits -> lại qua nk()                            <-- bám lại, có thể bám chỗ khác
```

**Sort và filter không phải nguyên nhân.** Chúng chỉ đổi thứ tự `items` để vẽ, không tham gia sinh khoá. `key={index}` trong React cũng không phải nguyên nhân: khoá React chỉ ảnh hưởng việc tái dùng DOM node, còn note đọc từ `edits[nk(it)]` nên nội dung luôn đúng theo `it`, không theo vị trí node. Em có kiểm, không thấy chỗ nào lấy note theo index mảng.

Lý do anh thấy "sort/filter cũng trôi": `nk()` phụ thuộc `rowHasData`, tức phụ thuộc ba query về không cùng lúc (B3). Thao tác nào làm component tính lại `nk()` trong lúc ba query chưa về đủ cũng cho ra bộ khoá khác. Sort/filter là thao tác hay làm nhất nên hay thấy nhất.

---

## F. Data Flow sau khi sửa

```
parser.ts   không đổi, trừ việc trả thêm danh sách STT trùng theo dự án cho cổng dữ liệu
  -> ItemRow  không đổi
  -> itemKeyOf   tầng 3 đổi thành  id:<mã CT>:<STT>
     itemKeysOf  trả thêm `id:<STT>` cũ ở CUỐI mảng (đọc dự phòng, không ghi)
  -> nk(it)  chọn theo DẤU DANH TÍNH, không theo "có dữ liệu"           <-- đã bịt
  -> render  edits[nk(it)]        giữ nguyên
  -> ghi     editMessages({ key, dc })   giữ nguyên, dc luôn gửi
  -> KV      cùng một key "edits:v1", cùng schema                        <-- không đổi schema
```

---

## G. Migration Strategy

Nguyên tắc: **không xoá, không reset, không dời hàng loạt một lượt.** Codebase đã chốt nguyên tắc này trong `rid.ts`: "Dời cả kho một lượt là canh bạc: sai một phép ánh xạ thì note nhảy sang dự án khác, mà nhảy rồi thì không biết đường lần về."

### Phân loại trước khi dời

| Nhóm | Dấu hiệu | Số (bản chụp 02/10) | Xử lý |
|---|---|---|---|
| G1 | `dc` có, ứng đúng 1 dòng trong nguồn | cần đo lại | dời tự động `id:X` -> `id:<CT>:X` hoặc `rid:` |
| G2 | `dc` có, ứng nhiều dòng | 22 ô va chạm | **không đoán**, đẩy ra bảng cho PMO chọn tay |
| G3 | `dc` có, không ứng dòng nào | cần đo lại | giữ tại chỗ, xếp vào Cảnh báo dữ liệu |
| G4 | `dc` không có, mỏ neo có | trong 174 ô | dùng mỏ neo `pmo-noteanchor.json` thay `dc`, rồi theo G1/G2 |
| G5 | Không `dc`, không mỏ neo | 86 ô | **không dời**, giữ nguyên khoá cũ, chỉ đọc dự phòng |

### Thứ tự chạy

1. **Sao lưu trước.** `pmo-baks.json` đã có cơ chế; thêm một bản ghim ngày trước khi dời. Không chạy bước nào khi chưa có bản sao lưu đọc lại được.
2. **Đóng dấu `dc` cho đủ 100% ô** bằng effect `dongDauDanhChi` đã có (`index.tsx:2995-3008`). Hiện effect này chỉ chạy khi `me?.isAdmin` và chỉ một lượt mỗi phiên. Phải chạy cho tới khi không còn ô thiếu dấu. Đây là bước ĐẦU TIÊN vì mọi bước sau dựa vào `dc`.
3. **Dời G1** bằng `remapKeys` đã có (`edits.functions.ts:754`). Hàm này đã xử lý đúng: đích trống thì dời, đích có rồi thì **gộp danh sách message** chứ không đè, và đổi id message trùng để không mất tin. Dùng nguyên, không viết mới.
4. **Đẩy G2 + G3 + G5 ra bảng** trong Hệ thống → Cảnh báo dữ liệu, mỗi dòng một nút "Đưa về đây". `note-lac.ts` đã có sẵn ba luật an toàn cho việc này, dùng lại.
5. **Sửa 158 RID trùng và 56 RID trống ở file nguồn.** Việc này của PMO, app chỉ liệt kê. Sửa xong thì phủ `rid:` lên gần 100% và tầng `id:` gần như không còn ai dùng.

### Trường hợp không tự dời được

- Hai dòng cùng danh tính 4 phần (cùng mã CT, cùng tên, cùng giai đoạn, cùng mô tả). Có thật trong nguồn: CT26-078 có 9 outlet khác nhau nhưng ô tên chứa xuống dòng. -> hỏi người, không đoán.
- Ô đích đang giữ ghi chú của dòng khác. -> phải xử lý ô đích trước, không trộn. Trộn hai dự án vào một ô là không gỡ ra được.
- G5. -> để nguyên. Note vẫn hiện nhờ đọc dự phòng, chỉ không bền.

**Cần migration script riêng không?** Không. `remapKeys` + `syncNoteAnchors` + `dongDauDanhChi` đã đủ, đều là server function có sẵn và đều no-overwrite. Chỉ cần một trang điều khiển trong Cảnh báo dữ liệu để bấm từng nhóm.

---

## H. Implementation Plan

### Phase 1 - Data model

| | |
|---|---|
| File | `src/routes/index.tsx` (2316-2341), `src/lib/filter.ts` (255-271) |
| Hiện tại | `itemKeyOf` tầng 3 = `id:${it.id}`. `projectKeyOf` composite dùng `\0`, `projectKeysOf` dùng dấu cách. |
| Mới | Tầng 3 = `id:${maCT}:${it.id}`. `itemKeysOf` trả thêm `id:${it.id}` ở **cuối** mảng để đọc được note cũ. Sửa `projectKeysOf` dùng `\0` cho khớp `projectKeyOf`. |
| Phụ thuộc | không |
| Rủi ro | Thấp. Khoá mới chưa có ai ghi, khoá cũ vẫn đọc được qua dự phòng. |
| Ảnh hưởng di trú | Mở đường cho Phase 5. Chưa dời gì. |

Mã CT phải chuẩn hoá: lấy mã đầu nếu ô có nhiều mã cách nhau bởi dấu phẩy (đã có `maCT1` ở `index.tsx:3019`), in hoa, bỏ khoảng trắng. Chuẩn hoá không đồng nhất ở hai nơi là sinh ra một lớp lỗi mới.

### Phase 2 - Identity resolution

| | |
|---|---|
| File | `src/routes/index.tsx` (3245-3249) |
| Hiện tại | `nk = (it) => itemKeysOf(it).find(rowHasData) ?? cs[0]` |
| Mới | Chọn theo `dc` khớp trước, rồi mới tới "có dữ liệu mà không ai tranh", cuối cùng `cs[0]`. Xem D2. |
| Phụ thuộc | Phase 1 |
| Rủi ro | **Cao nhất trong cả kế hoạch.** Đổi `nk()` là đổi ô mà mọi dòng đang đọc. Sai là note biến mất khỏi mắt người dùng ngay lập tức, trên app đang có 10-17 người dùng mỗi ngày. |
| Ảnh hưởng di trú | Không dời dữ liệu, chỉ đổi cách chọn ô. |

Bắt buộc: tính bảng "khoá -> các dòng ứng với nó" **một lần** trong `useMemo` theo `data.items`, không tính trong `nk()`. Nếu không thì mỗi lần vẽ một dòng lại quét cả 1178 dòng, và đây là app đang bị trần CPU 2s của Cloudflare free.

Bắt buộc: `nk()` không được phụ thuộc `completedDates` và `hiddenMap` nữa, hoặc phải chặn bằng `dangTaiKho` như các effect ghi nền. Nếu không thì vẫn còn lỗi "ba query về ba thời điểm cho ba bộ khoá" ở B3.

### Phase 3 - Note persistence

| | |
|---|---|
| File | `src/lib/edits.functions.ts` |
| Hiện tại | `editMessages` nhận `dc` optional (`:343`), chỉ ghi khi `op` là add/edit và client có gửi. `saveEdits` (PIC/deadline) **không nhận `dc` gì cả**. |
| Mới | `dc` thành bắt buộc cho add/edit. `saveEdits` cũng đóng dấu. Entry nào vào kho mà không có `dc` thì ghi log. |
| Phụ thuộc | Phase 1 |
| Rủi ho | Thấp. Thêm trường, không đổi schema, không đổi `KV_KEY`. |
| Ảnh hưởng di trú | Từ đây trở đi không sinh thêm ô thiếu dấu. |

Giữ nguyên `KV_KEY = "edits:v1"`. Đổi tên khoá KV là reset cả kho.

### Phase 4 - Frontend state / rendering

| | |
|---|---|
| File | `src/routes/index.tsx` |
| Hiện tại | `pkProj` chỉ gọi `projectKeyOf`, không có đọc dự phòng cấp dự án. `projectKeysOf` import mà không dùng. |
| Mới | Thêm `npk()` cho cấp dự án, cùng quy tắc D2. Gọi `projectKeysOf`. |
| Phụ thuộc | Phase 1, 2 |
| Rủi ro | Trung bình. Note cấp dự án hiện chưa có lưới đỡ nào, thêm vào là tốt hơn, nhưng phải kiểm không làm ô cấp dự án hút note cấp hạng mục. |
| Ảnh hưởng di trú | Lộ ra các note cấp dự án đang mất, cần đo lại con số. |

Không đụng `key={...}` của React. Đã kiểm, không phải nguyên nhân.

### Phase 5 - Migration

| | |
|---|---|
| File | `src/lib/edits.functions.ts` (dùng `remapKeys`, `syncNoteAnchors`, `dongDauDanhChi` sẵn có), thêm UI trong Cảnh báo dữ liệu |
| Hiện tại | `fixDriftTo` / `fixAllDrift` / `applyAuditAll` đã có, nhưng chạy trên cơ chế mỏ neo và nhật ký cũ |
| Mới | Chạy đủ 5 bước ở mục G. Mỗi bước một nút, hiện số trước khi bấm. |
| Phụ thuộc | Phase 1-4 xong và đã chạy ổn ít nhất một tuần |
| Rủi ro | Cao nếu chạy hàng loạt. Thấp nếu G1 trước, G2 để người chọn. |
| Ảnh hưởng di trú | Đây chính là bước di trú. |

### Phase 6 - Tests

Xem mục I. Viết **trước** Phase 2, không viết sau.

### Phase 7 - Cleanup

- Bỏ tầng `h:` khỏi chuỗi ghi nếu PMO xác nhận không bao giờ thêm cột IDCUNG. Giữ trong chuỗi ĐỌC vì có thể còn note cũ ở đó.
- Nâng `sttDup` từ `warn` lên mức hiện rõ hơn, và chỉ đếm STT trùng **trong cùng dự án** sau khi Phase 1 xong, vì trùng khác dự án đã hết nguy hiểm.
- Thêm check mới: `ridDup` và `ridBlank` liệt kê đích danh dòng, cho PMO sửa nguồn.

---

## I. Test Plan

Viết trong `tests/`, dùng vitest như các test có sẵn. Dựng bảng nguồn giả rồi chạy `parseTimelineRows` + `itemKeysOf` + `nk`.

| Kịch bản | Mong đợi |
|---|---|
| Sort dòng | `nk()` không đổi với mọi dòng |
| Filter dòng | `nk()` không đổi; dòng bị ẩn không làm dòng khác đổi khoá |
| Đổi tên công việc (cột mô tả) | note vẫn đúng dòng |
| Đổi tên dự án | note vẫn đúng dòng khi có RID; khi không có RID thì vào Cảnh báo, KHÔNG trôi sang dòng khác |
| Chèn dòng phía trên | `nk()` không đổi |
| Xoá dòng khác | `nk()` không đổi |
| Re-import cùng nguồn | `nk()` giống hệt lần trước, từng dòng |
| Hai dự án cùng STT `5.5` | hai khoá KHÁC nhau, note không chiếu lẫn |
| Hai dòng cùng RID | cả hai bị bỏ RID, lùi tầng dưới, không dùng chung ô |
| RID trống | lùi tầng dưới, có khoá, không throw |
| Dòng không có STT lẫn RID | về composite, có khoá |
| Ô đích đang có note của dòng khác | KHÔNG bám vào, không gộp |
| Ô đích có note cùng danh tính | gộp, không mất message nào |
| Di trú note cũ `id:5.5` -> `id:CT26-011:5.5` | nội dung y nguyên, số message y nguyên |
| Di trú khi đích đã có | gộp hai danh sách, không đè, id message trùng được đổi |
| `completedDates` về sau `edits` | `nk()` ra cùng kết quả ở cả hai thời điểm |
| Ô chỉ có cờ ẩn, không có chữ | không kéo dòng khác bám vào |

Thêm vào: lấy đúng 22 ô va chạm đo ở B5 làm fixture. Test nào cũng tốt hơn nếu dùng dữ liệu thật đã gây lỗi.

Ngoài unit test, cần một phép đo chạy được trên file nguồn thật, kiểu `do-bam.mjs` trong scratchpad, để sau Phase 2 xác nhận con số 61 và 62 về 0.

---

## J. Risks / Edge Cases

| Rủi ro | Mức | Chặn bằng |
|---|---|---|
| Đổi `nk()` làm note biến mất trước mắt 10-17 người đang dùng | Cao | Test trước, deploy ngoài giờ, giữ chuỗi đọc dự phòng đủ dài, có đường lùi |
| Dời hàng loạt sai một phép ánh xạ -> note nhảy sang dự án khác, không lần về được | Cao | Sao lưu trước; G1 tự động, G2 người chọn; `remapKeys` đã no-overwrite |
| Trần ghi KV 1.000 lượt/ngày | Trung bình | `remapKeys` ghi một lượt cho cả lô; đóng dấu `dc` cũng gộp một lượt; chặn bằng `dangTaiKho` |
| Trần CPU 2s | Trung bình | Bảng "khoá -> dòng" tính một lần trong `useMemo`, không tính trong `nk()` |
| Hai phiên cùng sửa một ô | Thấp | Đã là last-write-wins theo từng đầu việc, message là danh sách nên nối thêm |
| Nguồn thêm cột IDCUNG giữa lúc đang di trú | Thấp | Tầng `h:` xen vào giữa chuỗi -> đổi ưu tiên. Chốt thứ tự tầng trước khi chạy Phase 5 |
| 9 outlet CT26-078 cùng danh tính 4 phần | Đã gặp | Không đoán, vào G2 |
| Note cấp dự án và note cấp hạng mục dùng chung kho `edits` | Trung bình | Cùng một `KV_KEY`, nên khoá cấp dự án và cấp hạng mục phải không bao giờ sinh ra chuỗi giống nhau. `projectKeyOf` trả `id:<STT>` cho dự án, `itemKeyOf` cũng trả `id:<STT>` cho hạng mục -> **đã có nguy cơ va nhau**. Phase 1 phải tách tiền tố cho hai cấp |

Mục cuối là một phát hiện phụ cần xác minh thêm: cả hai cấp đều sinh khoá dạng `id:<STT>` từ cùng một cột STT, và dòng dự án lẫn dòng hạng mục đều có STT. Cần đo xem có cặp nào đang va thật.

---

## K. Files to Change

| File | Việc |
|---|---|
| `src/routes/index.tsx` | `itemKeyOf`, `itemKeysOf` (2316-2341); `nk`, `rowHasData` (3245-3249); thêm `npk` cho cấp dự án; bảng "khoá -> dòng" dạng useMemo |
| `src/lib/filter.ts` | `projectKeyOf`, `projectKeysOf` (255-271) - khớp dấu ngăn, thêm tiền tố tách cấp |
| `src/lib/edits.functions.ts` | `editMessages` bắt buộc `dc`; `saveEdits` đóng dấu `dc` |
| `src/lib/parser.ts` | check `sttDup` đổi thành đếm theo dự án; thêm `ridDup` / `ridBlank` liệt kê đích danh |
| `tests/` | file test mới theo mục I |
| UI Cảnh báo dữ liệu | bảng 5 nhóm G1-G5 kèm nút "Đưa về đây" |

## L. Files NOT to Change

| File | Vì sao |
|---|---|
| `src/lib/rid.ts` | `ridSo` / `ridKeys` đang đúng. Đụng vào là đổi địa chỉ của 918 dòng |
| `src/lib/note-lac.ts` | Ba luật an toàn đang đúng, dùng lại nguyên |
| `remapKeys`, `syncNoteAnchors` trong `edits.functions.ts` | Đã no-overwrite, đã gộp message đúng. Dùng lại, không viết mới |
| `KV_KEY = "edits:v1"` | Đổi là reset cả kho |
| `ItemEdit` schema | Không cần đổi. `dc` đã là đúng thứ cần |
| `scripts/stamp-rid.gs` | Apps Script phía nguồn, ngoài phạm vi. Chỉ ghi lại rằng nó chỉ điền ô trống nên copy khối là sinh RID trùng |
| Mọi `key={...}` của React | Không phải nguyên nhân |
| `src/lib/compliance-file.ts`, `mtld-*`, `perf-chart-app.tsx` | Không liên quan |

---

## M. Definition of Done

1. Chạy lại `do-bam.mjs` trên file nguồn mới nhất: **0 ghi chú có dấu danh tính khác dòng đang hiện** (hiện 61), **0 ô bị 2 dòng cùng chiếu** (hiện 62).
2. Chạy lại `mo-phong-khoa.mjs`: **0 ô lưu bị nhiều dòng dùng chung** (hiện 22).
3. 100% ô có chữ đều có `dc`. Hiện 150/324.
4. Toàn bộ test ở mục I xanh.
5. Đổi tên một công việc trong file nguồn, re-import, note vẫn đúng dòng. Kiểm bằng tay trên 3 dự án.
6. Đánh lại STT của một dự án, re-import, không note nào đổi chỗ.
7. Không mất ô nào: số ô có chữ trước và sau di trú bằng nhau, hoặc nhỏ hơn đúng bằng số ô đã gộp có chủ ý, và nêu rõ ô nào gộp vào đâu.
8. Có bản sao lưu đọc lại được, ghim ngày, trước khi chạy bước dời đầu tiên.
9. Cảnh báo dữ liệu liệt kê đích danh 158 RID trùng và 56 RID trống để PMO sửa nguồn.
10. Đo lại số lượt ghi KV mỗi ngày, không tăng so với trước.

---

## Sơ đồ

```
FILE NGUỒN  Project Master Plan, sheet Timeline
     |      cột RID  (158 số trùng, 56 trống  -> PMO phải sửa ở đây)
     v
STABLE TASK ID
     rid:<số>                       918/1332 dòng, bền
     id:<mã CT>:<STT>               phần còn lại, bền trong một dự án
     composite                      lưới cuối
     v
TASK OBJECT  ItemRow { rid, id, projectCode, projectName, rawCode, dupIdx }
     v
NOTE(task_id)  nk() chọn ô theo DẤU DANH TÍNH, không theo "ô nào có dữ liệu"
     v
PERSISTENCE  KV PMO_EDITS  "edits:v1"
     { [task_id]: { dc, noteMsgs[], actionMsgs[], pic, deadline, updatedAt } }
                     ^
                     dấu danh tính - để sau này còn lần về được
```

---

## Việc đầu tiên nên làm

Không phải sửa code. Là **sửa 158 RID trùng ở file nguồn**. Riêng việc đó đưa phủ `rid:` từ 68,9% lên gần 100%, và khi gần như mọi dòng có địa chỉ bền thì tầng `id:<STT>` gần như không còn ai dùng, cái bẫy của `nk()` gần như không nổ nữa. Sửa code là để bịt bẫy cho chắc, nhưng sửa nguồn là thứ cho kết quả nhiều nhất trên một đơn vị công.

App không tự sửa được chuyện này: trong 5 dòng cùng mang RID 205, app không có cách nào biết dòng nào là chủ.
