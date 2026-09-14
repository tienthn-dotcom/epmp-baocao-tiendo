/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  VÁ RID BỊ TRÙNG — cấp lại số cho những dòng đang dùng chung một số RID
 * ═══════════════════════════════════════════════════════════════════════════
 *  Dán TOÀN BỘ file này vào Apps Script CỦA FILE MASTER PLAN — cùng chỗ đã dán
 *  stamp-rid.gs (hai file sống chung được, tên hàm không đụng nhau).
 *
 *  CHẠY:  chọn hàm `soatRidTrung` → Run → đọc Execution log xem kế hoạch.
 *         Ưng thì đổi VA_DRY_RUN = false → chọn `vaRidTrung` → Run → ghi thật.
 *
 *  ┌─ VÌ SAO CẦN ─────────────────────────────────────────────────────────────┐
 *  │ Đo trên file ngày 14/09/2026: 1.077 số RID khác nhau, trong đó 152 số bị  │
 *  │ 336 DÒNG dùng chung — sinh ra khi copy nguyên khối dự án, vì stamp-rid    │
 *  │ chỉ điền vào ô TRỐNG nên bản sao giữ y số cũ. Ví dụ số 205 nằm trên 5 dự  │
 *  │ án khác nhau của khối APEC.                                              │
 *  │                                                                          │
 *  │ RID là ĐỊA CHỈ ƯU TIÊN của ghi chú. Một số dùng cho nhiều dòng thì mấy    │
 *  │ dòng đó chung một ô lưu → ghi chú của dự án này hiện trên dự án khác.     │
 *  │ App đã tự phòng bằng cách BỎ HẲN các số trùng (parser.ts · ridOf) và lùi  │
 *  │ về IDCUNG/STT. An toàn, nhưng 336 dòng đó mất lưới đỡ RID: STT xê dịch    │
 *  │ một lần là ghi chú lạc, đúng chuyện đã xảy ra ngày 10/09.                 │
 *  └──────────────────────────────────────────────────────────────────────────┘
 *
 *  ┌─ VÌ SAO ĐỔI SỐ Ở ĐÂY LÀ AN TOÀN ────────────────────────────────────────┐
 *  │ Vì app ĐANG BỎ những số trùng, nên HIỆN KHÔNG CÓ ghi chú nào bám vào     │
 *  │ chúng — ghi chú của các dòng đó đang nằm ở khoá IDCUNG/STT. Đổi số trùng │
 *  │ thành số mới KHÔNG dời được ghi chú của ai. Vá xong thì các dòng đó mới  │
 *  │ BẮT ĐẦU có địa chỉ RID dùng được.                                        │
 *  │                                                                          │
 *  │ Ngược lại, đổi một RID ĐANG DUY NHẤT thì RẤT NGUY: ghi chú bám số đó sẽ  │
 *  │ mất địa chỉ. Vì thế script này TUYỆT ĐỐI không đụng số duy nhất.          │
 *  └──────────────────────────────────────────────────────────────────────────┘
 *
 *  CÁCH VÁ: trong mỗi nhóm trùng, dòng ĐẦU TIÊN giữ số cũ, các dòng sau nhận số
 *  mới kế tiếp. Nhờ vậy số cũ cũng trở thành duy nhất và dùng được luôn.
 *
 *  AN TOÀN:
 *   · Chỉ ghi vào đúng cột RID. Không chèn/xoá dòng, không đụng cột nào khác.
 *   · Số mới lấy từ CÙNG bộ đếm với stamp-rid.gs → không bao giờ cấp trùng lại.
 *   · Giữ ĐÚNG kiểu ghi đang có trong file (tự nhận "ePMP1" hay "R000123"…).
 *   · Chạy lại nhiều lần vô hại: hết số trùng thì nó báo "không có gì để vá".
 */

// ─── CẤU HÌNH ────────────────────────────────────────────────────────────────
var VA_DRY_RUN = true;           // <<< true = chỉ log kế hoạch. Đổi false để GHI THẬT.
var VA_RID_HEADER = 'RID';       // chỉ dùng trong thông báo lỗi — việc DÒ cột do _vaTimCotRid lo.
var VA_COUNTER = 'RID_COUNTER';  // named range bộ đếm (khớp stamp-rid.gs).
// ─────────────────────────────────────────────────────────────────────────────


/** CHẠY THỬ — chỉ liệt kê, không ghi gì. Gọi hàm này trước. */
function soatRidTrung() {
  var keep = VA_DRY_RUN;
  VA_DRY_RUN = true;
  try { return vaRidTrung(); } finally { VA_DRY_RUN = keep; }
}

/** HÀM CHÍNH — cấp lại số cho các dòng RID trùng. */
function vaRidTrung() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = _vaChonTab(ss);
  if (!sh) { Logger.log('KHÔNG tìm được tab có hàng tiêu đề "Show". Kiểm lại đúng file Master Plan.'); return; }

  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  // 12 hàng đầu là đủ: hàng tiêu đề nằm trong đó, và cửa sổ dò RID chỉ rộng thêm 2 hàng.
  var grid = sh.getRange(1, 1, Math.min(lastRow, 12), lastCol).getValues();
  var headerIdx = _vaTimHeader(grid);
  if (headerIdx < 0) { Logger.log('KHÔNG dò được hàng tiêu đề (cần có ô "Show").'); return; }

  var ridCol = _vaTimCotRid(grid, headerIdx);
  if (ridCol < 0) { Logger.log('KHÔNG thấy cột "' + VA_RID_HEADER + '". Chạy stamp-rid.gs trước đã.'); return; }
  Logger.log('Cột RID: #' + ridCol + ' · hàng tiêu đề: ' + (headerIdx + 1));

  var startRow = headerIdx + 2;                 // hàng dữ liệu đầu (1-based)
  var n = lastRow - (headerIdx + 1);
  if (n <= 0) { Logger.log('Không có dòng dữ liệu nào.'); return; }

  var rid = sh.getRange(startRow, ridCol, n, 1).getValues();
  var nhan = _vaLayNhan(sh, grid, headerIdx, startRow, n);   // chỉ để log cho người đọc

  // ── Đếm số lần dùng của TỪNG SỐ (so theo PHẦN SỐ, y như app: bỏ chữ, bỏ 0 ở đầu) ──
  var dem = {}, so = [];
  for (var i = 0; i < n; i++) {
    var s = _vaPhanSo(rid[i][0]);
    so.push(s);
    if (s) dem[s] = (dem[s] || 0) + 1;
  }

  // ── Số kế tiếp: MAX(bộ đếm đã lưu, số lớn nhất đang có) để không bao giờ cấp trùng lại ──
  var lonNhat = 0;
  for (var k in dem) { var v = parseInt(k, 10); if (!isNaN(v) && v > lonNhat) lonNhat = v; }
  var demLuu = 0;
  try {
    var rr = ss.getRangeByName(VA_COUNTER);
    if (rr) { var dv = parseInt(rr.getValue(), 10); if (!isNaN(dv)) demLuu = dv; }
  } catch (e) { /* chưa có bộ đếm → dùng số lớn nhất đang có */ }
  var ke = Math.max(demLuu, lonNhat);

  var kieu = _vaDoKieu(rid);   // giữ đúng cách ghi đang có trong file

  // ── Kế hoạch: trong mỗi nhóm trùng, dòng ĐẦU giữ số cũ, các dòng sau nhận số mới ──
  var daGiuLai = {}, keHoach = [], soNhom = {};
  for (var r = 0; r < n; r++) {
    var s2 = so[r];
    if (!s2 || dem[s2] < 2) continue;                        // trống hoặc đã duy nhất → KHÔNG ĐỤNG
    if (!daGiuLai[s2]) { daGiuLai[s2] = true; continue; }     // dòng đầu của nhóm: giữ nguyên
    ke++;
    soNhom[s2] = true;
    keHoach.push({ dong: startRow + r, cu: String(rid[r][0]), moi: _vaGhiSo(ke, kieu), nhan: nhan[r] });
  }

  if (!keHoach.length) {
    Logger.log('Không có gì để vá: mọi số RID đang dùng đều là duy nhất.');
    return 'Không có gì để vá.';
  }

  Logger.log('── KẾ HOẠCH VÁ ── ' + keHoach.length + ' dòng, thuộc ' + Object.keys(soNhom).length + ' số bị trùng.');
  Logger.log('Kiểu ghi giữ nguyên, số mới sẽ trông như: ' + _vaGhiSo(ke, kieu));
  for (var j = 0; j < keHoach.length; j++) {
    var p = keHoach[j];
    Logger.log('  dòng ' + p.dong + ':  ' + p.cu + '  →  ' + p.moi + '   ' + p.nhan);
  }

  if (VA_DRY_RUN) {
    Logger.log('(CHẠY THỬ — chưa ghi gì. Đổi VA_DRY_RUN = false rồi chạy `vaRidTrung` để ghi thật.)');
    return 'Thử: sẽ vá ' + keHoach.length + ' dòng.';
  }

  // ── GHI THẬT: chỉ đúng cột RID, từng ô một ──
  for (var m = 0; m < keHoach.length; m++) {
    sh.getRange(keHoach[m].dong, ridCol).setValue(keHoach[m].moi);
  }
  _vaLuuDem(ss, ke);
  Logger.log('ĐÃ VÁ ' + keHoach.length + ' dòng. Bộ đếm nay là ' + ke + '.');
  return 'Đã vá ' + keHoach.length + ' dòng.';
}


/* ─── PHẦN PHỤ ─────────────────────────────────────────────────────────────── */

/** Tab chứa bảng tiến độ = tab đầu tiên có ô "Show" trong 12 hàng đầu. */
function _vaChonTab(ss) {
  var shs = ss.getSheets();
  for (var i = 0; i < shs.length; i++) {
    var lc = shs[i].getLastColumn(), lr = Math.min(shs[i].getLastRow(), 12);
    if (lc < 1 || lr < 1) continue;
    if (_vaTimHeader(shs[i].getRange(1, 1, lr, lc).getValues()) >= 0) return shs[i];
  }
  return null;
}

/** Hàng tiêu đề (0-based) = hàng có ô đúng chữ "Show". */
function _vaTimHeader(grid) {
  for (var r = 0; r < grid.length; r++) {
    for (var c = 0; c < grid[r].length; c++) {
      if (String(grid[r][c] == null ? '' : grid[r][c]).trim().toLowerCase() === 'show') return r;
    }
  }
  return -1;
}

/** Cột có đúng tiêu đề `name` (1-based). -1 nếu không có. */
function _vaTimCot(grid, headerIdx, name) {
  var row = grid[headerIdx] || [];
  for (var c = 0; c < row.length; c++) {
    if (String(row[c] == null ? '' : row[c]).trim().toLowerCase() === String(name).toLowerCase()) return c + 1;
  }
  return -1;
}

/** Cột RID (1-based). QUÉT CỬA SỔ headerIdx-1 .. headerIdx+2, KHÔNG chỉ hàng tiêu đề.
 *  Trong file Master Plan thật, nhãn "RID" nằm ở hàng 7 còn hàng tiêu đề là hàng 6 — dò đúng một
 *  hàng tiêu đề thì KHÔNG THẤY CỘT NÀO, và đó chính là lý do app từng không đọc được cột này suốt
 *  một thời gian dài. Luật ở đây khớp y parser.ts · detectRidCol. */
function _vaTimCotRid(grid, headerIdx) {
  var tu = Math.max(0, headerIdx - 1), den = headerIdx + 2;
  for (var r = tu; r <= den; r++) {
    var row = grid[r];
    if (!row) continue;
    for (var c = 0; c < row.length; c++) {
      var h = String(row[c] == null ? '' : row[c]).toLowerCase().replace(/s+/g, '');
      if (!h) continue;
      if (h === 'rid' || h === 'r.i.d' || h === 'rowid') return c + 1;
    }
  }
  return -1;
}

/** PHẦN SỐ của một RID — đúng luật app dùng (lib/rid.ts · ridSo): bỏ hết chữ, bỏ 0 ở đầu. */
function _vaPhanSo(v) {
  var s = String(v == null ? '' : v).replace(/\D+/g, '');
  return s.replace(/^0+(?=\d)/, '');
}

/** Dò KIỂU GHI đang dùng trong file để số mới trông giống số cũ.
 *  "ePMP1" → { tienTo: 'ePMP', pad: 0 };  "R000123" → { tienTo: 'R', pad: 6 }. */
function _vaDoKieu(rid) {
  var dem = {};
  for (var i = 0; i < rid.length; i++) {
    var s = String(rid[i][0] == null ? '' : rid[i][0]).trim();
    if (!s) continue;
    var m = s.match(/^(.*?)(\d+)$/);
    if (!m) continue;
    var key = m[1] + '|' + (/^0\d/.test(m[2]) ? m[2].length : 0);
    dem[key] = (dem[key] || 0) + 1;
  }
  var best = null, bestN = -1;
  for (var k in dem) if (dem[k] > bestN) { bestN = dem[k]; best = k; }
  if (best === null) return { tienTo: '', pad: 0 };
  var p = best.split('|');
  return { tienTo: p[0], pad: parseInt(p[1], 10) || 0 };
}

function _vaGhiSo(num, kieu) {
  var s = String(num);
  while (s.length < kieu.pad) s = '0' + s;
  return kieu.tienTo + s;
}

/** Nhãn "MãCT · Mô tả" của từng dòng — chỉ để log cho người đọc hiểu đang nói dòng nào. */
function _vaLayNhan(sh, grid, headerIdx, startRow, n) {
  var cMa = _vaTimCot(grid, headerIdx, 'MaCT');
  if (cMa < 0) cMa = _vaTimCot(grid, headerIdx, 'Mã CT');
  var cMo = _vaTimCot(grid, headerIdx, 'Mô tả');
  var ma = cMa > 0 ? sh.getRange(startRow, cMa, n, 1).getDisplayValues() : null;
  var mo = cMo > 0 ? sh.getRange(startRow, cMo, n, 1).getDisplayValues() : null;
  var out = [];
  for (var i = 0; i < n; i++) {
    var a = ma ? String(ma[i][0] || '').trim() : '';
    var b = mo ? String(mo[i][0] || '').trim() : '';
    out.push((a ? a + ' · ' : '') + b.substring(0, 44));
  }
  return out;
}

function _vaLuuDem(ss, val) {
  var r;
  try { r = ss.getRangeByName(VA_COUNTER); } catch (e) { r = null; }
  if (!r) {
    var sh = ss.getSheetByName('_rid') || ss.insertSheet('_rid');
    sh.hideSheet();
    r = sh.getRange('A1');
    ss.setNamedRange(VA_COUNTER, r);
  }
  r.setValue(val);
}
