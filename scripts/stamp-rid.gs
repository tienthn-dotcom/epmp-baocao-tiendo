/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CẤP RID — MÃ CỨNG CHO TỪNG DÒNG (chống mất/trôi ghi chú vĩnh viễn)
 * ═══════════════════════════════════════════════════════════════════════════
 *  Dán TOÀN BỘ file này vào Apps Script CỦA FILE MASTER PLAN (file nguồn app đọc),
 *  rồi chạy `stampRid`. Nó cấp cho mỗi DÒNG một mã RID:
 *      · nhập vào 1 lần, CỨNG ở đó, KHÔNG bao giờ đổi, KHÔNG bao giờ tái dùng;
 *      · dòng mới → số kế tiếp; dòng cũ đã có RID → GIỮ NGUYÊN (không đụng).
 *  Nhờ đó: STT đánh lại, đổi tên, mã CT trùng, chèn dự án, đảo thứ tự, hide/hiện —
 *  RID không đổi → ghi chú bám RID không lạc. (Chỉ mất khi XOÁ HẲN dòng, nên cứ hide.)
 *
 *  ┌─ CÁCH DÙNG ─────────────────────────────────────────────────────────────┐
 *  │ 1) Mở file Master Plan → Extensions/Tiện ích mở rộng → Apps Script.       │
 *  │ 2) Dán file này vào, Lưu.                                                 │
 *  │ 3) Để DRY_RUN = true, chạy `stampRid` 1 lần → xem Execution log:          │
 *  │       "Sẽ cấp RID cho N dòng ... (thử, chưa ghi)".                        │
 *  │    Kiểm N có hợp lý không (≈ tổng số dòng dự án + công đoạn đang có).      │
 *  │ 4) Ưng thì đổi DRY_RUN = false, chạy `stampRid` lại 1 lần → GHI THẬT.     │
 *  │ 5) Xong. Từ nay không cần chạy tay: onEditInstall/onOpen sẽ tự cấp cho    │
 *  │    dòng mới. (Muốn tự động: chạy `setupRidTrigger` 1 lần.)                │
 *  └──────────────────────────────────────────────────────────────────────────┘
 *
 *  AN TOÀN:
 *   · Chỉ ĐIỀN vào ô RID TRỐNG. Ô đã có RID → không bao giờ đụng.
 *   · Số kế tiếp = MAX(bộ đếm đã lưu, RID lớn nhất đang có) + 1 → không tái dùng
 *     kể cả khi xoá dòng có RID lớn nhất, kể cả khi copy file (đếm lưu trong file).
 *   · Tự thêm cột "RID" nếu chưa có (đặt ở cột cuối cùng, không đè dữ liệu).
 */

// ─── CẤU HÌNH ────────────────────────────────────────────────────────────────
var DRY_RUN    = true;    // <<< true = chạy thử (chỉ log). Đổi false để GHI THẬT.
var RID_HEADER = 'RID';   // tên cột chứa mã cứng.
var RID_PREFIX = 'R';     // tiền tố mã (R000123). Đổi tuỳ thích, giữ NGẮN GỌN.
var RID_PAD    = 6;       // số chữ số (R + 6 số).
var COUNTER_CELL_NAME = 'RID_COUNTER'; // named range 1 ô lưu bộ đếm (đặt ở sheet ẩn "_rid").
// ─────────────────────────────────────────────────────────────────────────────


/** HÀM CHÍNH — cấp RID cho mọi dòng dữ liệu đang thiếu. */
function stampRid() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = pickTimelineSheet_(ss);
  if (!sh) { Logger.log('KHÔNG tìm được tab có hàng tiêu đề "Show". Kiểm lại đúng file Master Plan.'); return; }

  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  var grid = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var det = detectCols_(grid);
  if (!det) { Logger.log('KHÔNG dò được cột (thiếu hàng "Show" + các cột kết thúc/mô tả/mã...).'); return; }

  // Cột RID: tìm theo tên; chưa có → thêm ở cột CUỐI (không đè dữ liệu).
  var ridCol = findHeaderCol_(grid, det.headerIdx, RID_HEADER);
  if (ridCol < 0) {
    ridCol = lastCol + 1;
    if (!DRY_RUN) sh.getRange(det.headerIdx + 1, ridCol).setValue(RID_HEADER);
    Logger.log('Cột RID chưa có → thêm ở cột #' + ridCol + ' (header "' + RID_HEADER + '").');
  } else {
    Logger.log('Cột RID đã có ở cột #' + ridCol + '.');
  }

  // Đọc RID hiện có + tìm số lớn nhất (để không cấp trùng).
  var n = lastRow - (det.headerIdx + 1);
  if (n <= 0) { Logger.log('Không có dòng dữ liệu nào dưới tiêu đề.'); return; }
  var startRow = det.headerIdx + 2; // hàng dữ liệu đầu (1-based); headerIdx là 0-based
  var ridVals = (ridCol <= lastCol) ? sh.getRange(startRow, ridCol, n, 1).getValues() : newBlank_(n);
  var nameVals = sh.getRange(startRow, det.name + 1, n, 1).getValues();
  var codeVals = sh.getRange(startRow, det.code + 1, n, 1).getValues();
  var maVals   = sh.getRange(startRow, det.maCT + 1, n, 1).getValues();

  var maxExisting = 0;
  for (var i = 0; i < n; i++) {
    var num = parseRid_(ridVals[i][0]);
    if (num > maxExisting) maxExisting = num;
  }
  var counter = Math.max(readCounter_(ss), maxExisting);

  // Cấp cho dòng CÓ nội dung (tên/mã/maCT) mà ô RID đang TRỐNG.
  var out = [], stamped = 0, kept = 0, blankRows = 0;
  for (var r = 0; r < n; r++) {
    var cur = String(ridVals[r][0] || '').trim();
    var hasContent = String(nameVals[r][0] || '').trim() || String(codeVals[r][0] || '').trim() || String(maVals[r][0] || '').trim();
    if (!hasContent) { out.push([cur]); blankRows++; continue; }   // dòng trống hẳn → bỏ qua
    if (cur) { out.push([cur]); kept++; continue; }                // đã có RID → giữ nguyên
    counter++;
    out.push([makeRid_(counter)]);
    stamped++;
  }

  Logger.log((DRY_RUN ? '[THỬ] Sẽ cấp' : '[GHI THẬT] Đã cấp') + ' RID cho ' + stamped + ' dòng mới. '
    + 'Giữ nguyên ' + kept + ' dòng đã có. Bỏ ' + blankRows + ' dòng trống. Bộ đếm mới = ' + counter + '.');

  if (DRY_RUN) { Logger.log('*** DRY_RUN: chưa ghi. Đổi DRY_RUN=false rồi chạy lại để ghi thật. ***'); return; }
  if (stamped > 0 || ridCol > lastCol) sh.getRange(startRow, ridCol, n, 1).setValues(out);
  writeCounter_(ss, counter);
  Logger.log('Xong. RID đã cắm cứng.');
}

/** Đặt trigger tự cấp RID khi có chỉnh sửa (dòng mới tự có RID trước khi app đọc). Chạy 1 lần. */
function setupRidTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onEditStampRid') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onEditStampRid').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
  Logger.log('Đã đặt trigger onEdit → tự cấp RID cho dòng mới.');
}
/** Trigger onEdit — cấp RID lặng lẽ (không log ồn). Tôn trọng DRY_RUN=false mới ghi. */
function onEditStampRid() { var keep = DRY_RUN; DRY_RUN = false; try { stampRid(); } finally { DRY_RUN = keep; } }


/* ── DÒ CẤU TRÚC (mượn logic parser của app: tìm hàng "Show") ──────────────── */
function pickTimelineSheet_(ss) {
  var shs = ss.getSheets();
  for (var s = 0; s < shs.length; s++) {
    var lr = shs[s].getLastRow(), lc = shs[s].getLastColumn();
    if (lr < 1 || lc < 1) continue;
    var top = shs[s].getRange(1, 1, Math.min(15, lr), lc).getValues();
    if (detectCols_(top)) return shs[s];
  }
  return null;
}
function detectCols_(grid) {
  var headerIdx = -1, showIdx = -1;
  var n = Math.min(15, grid.length);
  for (var i = 0; i < n; i++) {
    var r = grid[i] || [], idx = -1;
    for (var c = 0; c < r.length; c++) if (cell_(r[c]).toLowerCase() === 'show') { idx = c; break; }
    if (idx < 0) continue;
    var joined = r.map(cell_).join(' | ').toLowerCase();
    if (!/kết\s*thúc|bắt\s*đầu|mô\s*tả|%\s*thực\s*tế|vướng\s*mắc|(^|\|)\s*mã\s*(\||$)/.test(joined)) continue;
    headerIdx = i; showIdx = idx; break;
  }
  if (headerIdx < 0) return null;
  var header = grid[headerIdx] || [];
  function findRe(re) { for (var c = 0; c < header.length; c++) { var h = cell_(header[c]).toLowerCase(); if (h && re.test(h)) return c; } return -1; }
  var cols = { headerIdx: headerIdx, show: showIdx, name: showIdx + 1, maCT: showIdx + 3, code: showIdx + 7 };
  var o;
  o = findRe(/^ma\s*ct$|^mã\s*ct$/); if (o >= 0) cols.maCT = o;
  o = findRe(/^mã$/);                if (o >= 0) cols.code = o;
  return cols;
}
function findHeaderCol_(grid, headerIdx, name) {
  var header = grid[headerIdx] || [], t = String(name).trim().toLowerCase();
  for (var c = 0; c < header.length; c++) if (cell_(header[c]).toLowerCase() === t) return c + 1;
  return -1;
}

/* ── BỘ ĐẾM lưu TRONG FILE (đi theo file kể cả copy) ───────────────────────── */
function readCounter_(ss) {
  try { var r = ss.getRangeByName(COUNTER_CELL_NAME); if (r) { var v = parseInt(r.getValue(), 10); return isNaN(v) ? 0 : v; } } catch (e) {}
  return 0;
}
function writeCounter_(ss, val) {
  var r; try { r = ss.getRangeByName(COUNTER_CELL_NAME); } catch (e) { r = null; }
  if (!r) {
    var sh = ss.getSheetByName('_rid') || ss.insertSheet('_rid');
    sh.hideSheet();
    r = sh.getRange('A1');
    ss.setNamedRange(COUNTER_CELL_NAME, r);
  }
  r.setValue(val);
}

/* ── TIỆN ÍCH ─────────────────────────────────────────────────────────────── */
function cell_(v) { return v == null ? '' : String(v).trim(); }
function newBlank_(n) { var a = []; for (var i = 0; i < n; i++) a.push(['']); return a; }
function parseRid_(v) { var m = String(v == null ? '' : v).match(/(\d+)\s*$/); return m ? parseInt(m[1], 10) : 0; }
function makeRid_(num) { var s = String(num); while (s.length < RID_PAD) s = '0' + s; return RID_PREFIX + s; }
