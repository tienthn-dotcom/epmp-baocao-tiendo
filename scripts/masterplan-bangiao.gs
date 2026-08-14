/**
 * ĐỔ "NGÀY BÀN GIAO" (= Ngày kết thúc dòng DỰ ÁN) từ file MASTER PLAN → sheet "TỔNG HỢP DỮ LIỆU THI CÔNG LẮP ĐẶT".
 * ---------------------------------------------------------------------------------------------------------------
 * • Khớp theo MÃ CT (cột A của sheet đích). Một dòng đích có thể GỘP nhiều mã ("CT25-051, CT25-038")
 *   → lấy ngày bàn giao MUỘN NHẤT trong cụm (coi như cả cụm bàn giao xong ở ngày trễ nhất).
 * • Nguồn: dòng DỰ ÁN (dòng cha) = dòng có cột "Stt" là SỐ NGUYÊN (1, 2, 3…); bỏ dòng đầu việc con (1.1, 1.2…).
 * • Ghi kết quả vào cột B của sheet đích (ô giữa "Mã CT" và "Dự Án").
 *
 * CÁCH DÙNG: mở file đích → Extensions → Apps Script → dán file này → Save → chạy hàm doDoNgayBanGiao()
 *            (hoặc dùng menu "⟳ Master Plan ▸ Đổ ngày bàn giao" xuất hiện khi mở lại file).
 */

const CFG = {
  // NGUỒN — file Master Plan
  SRC_ID:        '1fBAL3KIwYqaosMtjaq8cxvRSkcHmQicD',
  SRC_GID:       331696853,   // tab Master Plan trong file nguồn
  SRC_DATA_ROW:  7,           // dòng dữ liệu đầu tiên (dòng 6 là tiêu đề)
  SRC_COL_STT:   12,          // L  — Stt (số nguyên = dòng dự án)
  SRC_COL_MACT:  10,          // J  — Mã CT (có thể nhiều mã, cách nhau dấu phẩy)
  SRC_COL_END:   18,          // R  — Ngày kết thúc / Bàn giao (dòng dự án)

  // ĐÍCH — sheet TỔNG HỢP (để trống DST_ID nếu dán script NGAY TRONG file đích → tự dùng file đang mở)
  DST_ID:        '',          // '' = dùng SpreadsheetApp.getActive() (script gắn trong file đích)
  DST_GID:       0,           // tab "TỔNG HỢP"
  DST_DATA_ROW:  3,           // dòng dữ liệu đầu tiên (dòng 2 là tiêu đề)
  DST_COL_CODE:  1,           // A  — Mã CT (để khớp)
  DST_COL_OUT:   2,           // B  — ô ghi Ngày bàn giao

  // ĐỊNH DẠNG GHI RA:  'date' = 31/12/2026  |  'monthyear' = 12/2026 (giống ô "8/2026" đang có)
  OUTPUT: 'monthyear',
  // Cách gộp khi 1 dòng đích có nhiều mã khác ngày:  'latest' = trễ nhất (mặc định) | 'earliest' = sớm nhất
  GROUP: 'latest',
};

/** Tạo menu khi mở file. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⟳ Master Plan')
    .addItem('Đổ ngày bàn giao', 'doDoNgayBanGiao')
    .addToUi();
}

/** HÀM CHÍNH — chạy cái này. */
function doDoNgayBanGiao() {
  const tz = Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh';

  // 1) NGUỒN: dựng map  mã CT → ngày bàn giao (Date)  từ các dòng DỰ ÁN.
  const src = sheetByGid_(CFG.SRC_ID, CFG.SRC_GID);
  const sv  = src.getDataRange().getValues();
  const code2end = {};
  for (let r = CFG.SRC_DATA_ROW - 1; r < sv.length; r++) {
    const stt = String(sv[r][CFG.SRC_COL_STT - 1]).trim();
    if (!/^\d+$/.test(stt)) continue;                       // chỉ dòng dự án (Stt nguyên)
    const end = toDate_(sv[r][CFG.SRC_COL_END - 1]);
    if (!end) continue;
    String(sv[r][CFG.SRC_COL_MACT - 1]).split(',').forEach(function (c) {
      c = c.trim(); if (c) code2end[c] = end;
    });
  }

  // 2) ĐÍCH: với mỗi dòng, gom ngày theo các mã rồi ghi ra cột B.
  const dst   = sheetByGid_(CFG.DST_ID, CFG.DST_GID);   // DST_ID='' → dùng file đang mở (script gắn trong file đích)
  const last  = dst.getLastRow();
  const start = CFG.DST_DATA_ROW;
  if (last < start) { toast_('Sheet đích chưa có dòng dữ liệu.'); return; }

  const codes = dst.getRange(start, CFG.DST_COL_CODE, last - start + 1, 1).getValues();
  const out = [], now = new Date();
  let hit = 0, miss = 0;
  for (let i = 0; i < codes.length; i++) {
    const raw = String(codes[i][0] || '').trim();
    if (!raw) { out.push(['']); continue; }
    const ds = raw.split(',').map(function (x) { return x.trim(); }).filter(Boolean)
                  .map(function (c) { return code2end[c]; }).filter(Boolean);
    if (!ds.length) { out.push(['']); miss++; continue; }
    const t = (CFG.GROUP === 'earliest')
      ? Math.min.apply(null, ds.map(function (d) { return d.getTime(); }))
      : Math.max.apply(null, ds.map(function (d) { return d.getTime(); }));
    const d = new Date(t);
    out.push([ CFG.OUTPUT === 'date' ? d : Utilities.formatDate(d, tz, 'M/yyyy') ]);
    hit++;
  }
  const rng = dst.getRange(start, CFG.DST_COL_OUT, out.length, 1);
  if (CFG.OUTPUT === 'date') rng.setNumberFormat('dd/MM/yyyy');
  rng.setValues(out);
  toast_('Đã đổ ngày bàn giao: ' + hit + ' dòng khớp' + (miss ? ', ' + miss + ' dòng không tìm thấy mã' : '') + '.');
}

/* ───────── tiện ích ───────── */

/** Lấy sheet theo gid (bền hơn theo tên). */
function sheetByGid_(fileId, gid) {
  const ss = fileId ? SpreadsheetApp.openById(fileId) : SpreadsheetApp.getActive();
  const sh = ss.getSheets().filter(function (s) { return s.getSheetId() === gid; })[0];
  if (!sh) throw new Error('Không thấy tab gid=' + gid + ' trong file ' + (fileId || 'đang mở'));
  return sh;
}
/** Chuẩn hoá về Date: nhận Date sẵn, hoặc chuỗi "d/m/yy", "d/m/yyyy", "yyyy-mm-dd". */
function toDate_(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  const s = String(v || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);   // d/m/yy hoặc d/m/yyyy
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return new Date(y, +m[2] - 1, +m[1]); }
  m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);          // yyyy-mm-dd
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function toast_(msg) {
  try { SpreadsheetApp.getActive().toast(msg, 'Master Plan → Bàn giao', 6); } catch (e) { Logger.log(msg); }
}
