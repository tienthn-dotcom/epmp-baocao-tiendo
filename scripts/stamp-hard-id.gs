/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ĐÓNG DẤU ID CỨNG cho file Master Plan (Timeline) — khoá BỀN cho vướng mắc.
 * ═══════════════════════════════════════════════════════════════════════════
 *  VÌ SAO: app khoá vướng mắc theo STT. STT bị đánh lại/sắp lại là vướng mắc "nhảy" dự án.
 *  Cột "IDCUNG" là mã VĨNH VIỄN gán 1 lần cho MỖI DÒNG DỰ ÁN (P0001, P0002…), KHÔNG đổi khi
 *  STT đổi, KHÔNG tái dùng. App đọc cột này → khoá theo ID cứng thay STT.
 *
 *  CÁCH DÙNG (file phải là GOOGLE SHEET, không phải .xlsx — nếu .xlsx: File▸Lưu dạng Google Sheets):
 *    1. Extensions ▸ Apps Script ▸ dán file này.
 *    2. Chạy hàm `stampHardIds` 1 lần (cấp quyền nếu hỏi). Nó:
 *         · tạo cột "IDCUNG" (nếu chưa có, đặt ở CUỐI để không xô lệch cột nào);
 *         · dòng DỰ ÁN nào CHƯA có ID → cấp mã mới P0001, P0002… (tăng dần, không tái dùng);
 *         · dòng đã có ID → GIỮ NGUYÊN (không đụng).
 *    3. Về sau thêm dự án mới rồi chạy lại (hoặc bật trigger onEdit ở dưới) — chỉ cấp cho dòng mới.
 *
 *  AN TOÀN: chỉ GHI vào ô IDCUNG còn trống của DÒNG DỰ ÁN; tuyệt đối không đụng cột/dòng khác.
 */

var SHEET_NAME = 'Timeline';
var HEADER_ROW = 6;            // hàng tiêu đề (ô "Stt", "Show"…)
var HID_HEADER = 'IDCUNG';
var DATA_START = 7;            // dòng dữ liệu đầu

function stampHardIds() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('Không thấy sheet "' + SHEET_NAME + '".');

  var lastCol = sh.getLastColumn();
  var header = sh.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
  var sttCol = colOf_(header, /^stt$/i);
  if (sttCol < 0) throw new Error('Không thấy cột "Stt" ở hàng ' + HEADER_ROW + '.');

  var hidCol = colOf_(header, new RegExp('^' + HID_HEADER + '$', 'i'));
  if (hidCol < 0) {              // chưa có → tạo cột mới ở CUỐI (không xô lệch cột hiện có)
    hidCol = lastCol + 1;
    sh.getRange(HEADER_ROW, hidCol).setValue(HID_HEADER).setFontWeight('bold');
  }

  var lastRow = sh.getLastRow();
  var n = lastRow - DATA_START + 1;
  if (n <= 0) { Logger.log('Không có dòng dữ liệu.'); return; }
  var stt = sh.getRange(DATA_START, sttCol, n, 1).getValues();
  var hid = sh.getRange(DATA_START, hidCol, n, 1).getValues();

  // Mã lớn nhất đang có → không tái dùng.
  var maxN = 0;
  for (var i = 0; i < n; i++) {
    var m = String(hid[i][0] || '').match(/^P(\d+)$/i);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }

  var stamped = 0;
  for (var j = 0; j < n; j++) {
    var s = String(stt[j][0] == null ? '' : stt[j][0]).trim();
    var isProject = /^\d+$/.test(s);          // dòng DỰ ÁN = STT số nguyên (không có dấu chấm)
    if (!isProject) continue;
    if (String(hid[j][0] || '').trim() !== '') continue;  // đã có ID → giữ
    maxN++;
    hid[j][0] = 'P' + ('0000' + maxN).slice(-4);          // P0001, P0002…
    stamped++;
  }
  if (stamped > 0) sh.getRange(DATA_START, hidCol, n, 1).setValues(hid);
  Logger.log('Đã cấp ' + stamped + ' ID cứng mới. Mã lớn nhất hiện tại: P' + ('0000' + maxN).slice(-4) + '. Cột IDCUNG = số ' + hidCol + '.');
}

/** (Tuỳ chọn) Tự đóng dấu khi có người sửa sheet — bật: chạy `createStampTrigger` 1 lần. */
function createStampTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'stampHardIds') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('stampHardIds').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
  Logger.log('Đã bật trigger onEdit → tự cấp ID cho dòng dự án mới.');
}

/** Tìm cột (1-based) theo regex tiêu đề; -1 nếu không có. */
function colOf_(header, re) {
  for (var c = 0; c < header.length; c++) {
    var h = String(header[c] == null ? '' : header[c]).trim();
    if (re.test(h)) return c + 1;
  }
  return -1;
}
