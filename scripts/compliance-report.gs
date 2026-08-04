/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  BÁO CÁO TUÂN THỦ — tự thêm dự án mới + tick ✔/o/x theo tuần + tiêu đề theo tháng
 * ═══════════════════════════════════════════════════════════════════════════
 *  Dán chung project "PMP Reminder" (cùng chỗ file ETL FROM 2.3.gs = bridge 2.3→AutoData).
 *  Chạy hàm `runComplianceReport` bằng trigger MỖI GIỜ; nó tự canh giờ để tick đúng lúc.
 *
 *  ĐÃ CÓ SẴN TRONG SHEET (KHÔNG đụng): D=ngày cập nhật (VLOOKUP AutoData), H=email (VLOOKUP
 *  DATA), C=STT (+1), K..Z=ngày tuần (+7). Script chỉ làm 3 việc:
 *    1. crUpdateTitle : D3 → "BÁO CÁO TUÂN THỦ CẬP NHẬT MASTER PLAN THÁNG MM/YYYY" (tháng hiện tại).
 *    2. crSyncProjects: dự án có trong AutoData mà CHƯA có trong bảng (khớp theo TÊN) → thêm dòng
 *                       cuối bảng (điền Location/Tên/PM; C,D,H set công thức để tự chạy).
 *    3. crMarkWeek    : quét theo lịch, tick cột tuần hiện tại:
 *         · Thứ 4 (>=21h): ngày cập nhật == HÔM NAY → "✓", còn lại → "x".
 *         · Thứ 5 (<12h) : ngày cập nhật == T4 tuần này → "✓"; == HÔM NAY(T5) → "o"; còn lại → "x";
 *                          rồi KHOÁ cột (ScriptProperties) — không sửa lại nữa.
 *       (Cột tuần này = cột K..Z có ngày rơi trong tuần Thứ2–CN chứa hôm nay. Không tạo cột mới.)
 *
 *  AN TOÀN: để DRY_RUN = true → chỉ GHI LOG "sẽ làm gì", KHÔNG đụng file. Chạy thử, xem
 *  Execution log đúng ý rồi đổi DRY_RUN = false để chạy thật.
 */

// ─── CẤU HÌNH ───
var DRY_RUN        = true;                       // <<< để true chạy thử; false = ghi thật
var REPORT_SHEET   = 'Báo cáo tuân thủ PMP';
var AUTODATA_SHEET = 'AutoData';
var TITLE_CELL     = 'D3';
var HEADER_ROW     = 9;                           // hàng tiêu đề cột (Location/STT/…)
var DATA_START_ROW = 11;                          // dòng dự án đầu tiên
var C_MP = 1, C_LOC = 2, C_STT = 3, C_DATE = 4, C_KEY = 5, C_NAME = 6, C_PM = 7, C_EMAIL = 8;
var WEEK_COL_START = 11;                          // cột K (ngày tuần đầu tiên)
// Nếu muốn "≤ Thứ 4 = đúng hạn" thay vì "đúng ngày Thứ 4", đổi ONTIME_LE_WED = true.
var ONTIME_LE_WED  = false;

/** HÀM CHÍNH — để trigger gọi mỗi giờ. */
function runComplianceReport() {
  // Làm tươi AutoData trước (nếu bridge cùng project) để ngày cập nhật mới nhất.
  try { if (typeof syncComplianceBridge === 'function') syncComplianceBridge(); } catch (e) { Logger.log('Bridge sync lỗi (bỏ qua): ' + e); }

  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(BRIDGE_SHEET_ID);
  var sh = ss.getSheetByName(REPORT_SHEET);
  if (!sh) throw new Error('Không thấy sheet "' + REPORT_SHEET + '".');

  crUpdateTitle_(sh);
  crSyncProjects_(ss, sh);
  crMarkWeek_(ss, sh);
  Logger.log(DRY_RUN ? '*** DRY_RUN: chưa ghi gì. Đổi DRY_RUN=false để chạy thật. ***' : 'Đã chạy thật xong.');
}

/** Đặt lịch chạy mỗi giờ. Chạy 1 lần. */
function createComplianceTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runComplianceReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runComplianceReport').timeBased().everyHours(1).create();
  Logger.log('Đã đặt lịch runComplianceReport mỗi giờ.');
}

/* ── 1) TIÊU ĐỀ theo tháng ── */
function crUpdateTitle_(sh) {
  var tz = sh.getParent().getSpreadsheetTimeZone();
  var mmYYYY = Utilities.formatDate(new Date(), tz, 'MM/yyyy');
  var want = 'BÁO CÁO TUÂN THỦ CẬP NHẬT MASTER PLAN THÁNG ' + mmYYYY;
  var cur = String(sh.getRange(TITLE_CELL).getValue() || '');
  if (cur === want) { Logger.log('Tiêu đề đã đúng: ' + want); return; }
  Logger.log('Tiêu đề: "' + cur + '" → "' + want + '"');
  if (!DRY_RUN) sh.getRange(TITLE_CELL).setValue(want);
}

/* ── 2) THÊM DỰ ÁN MỚI từ AutoData (khớp theo TÊN) ── */
function crSyncProjects_(ss, sh) {
  var ad = ss.getSheetByName(AUTODATA_SHEET);
  if (!ad) { Logger.log('Không thấy tab AutoData — bỏ qua thêm dự án.'); return; }
  var adRows = ad.getDataRange().getValues();           // [STT,Tên,PM,Location,Ngày update,...]
  var lastRow = crLastDataRow_(sh);
  // Tập tên đã có (chuẩn hoá cả cột KEY E lẫn Tên F).
  var have = {};
  if (lastRow >= DATA_START_ROW) {
    var exist = sh.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, C_NAME).getValues();
    exist.forEach(function (r) {
      var k = crNorm_(r[C_KEY - 1]); if (k) have[k] = true;
      var f = crNorm_(r[C_NAME - 1]); if (f) have[f] = true;
    });
  }
  var toAdd = [], seenNew = {};
  for (var i = 1; i < adRows.length; i++) {              // bỏ header AutoData
    var name = String(adRows[i][1] || '').replace(/\s+/g, ' ').trim();  // B = Tên
    if (!name) continue;
    var key = crNorm_(name);
    if (have[key] || seenNew[key]) continue;             // đã có / trùng trong đợt thêm
    seenNew[key] = true;
    toAdd.push({ name: name, pm: String(adRows[i][2] || '').split(/\r?\n/)[0].trim(), loc: String(adRows[i][3] || '').trim() });
  }
  if (!toAdd.length) { Logger.log('Không có dự án mới.'); return; }
  Logger.log('Dự án MỚI sẽ thêm (' + toAdd.length + '): ' + toAdd.map(function (p) { return p.name; }).join(' | '));
  if (DRY_RUN) return;
  var r = lastRow + 1;
  toAdd.forEach(function (p) {
    sh.getRange(r, C_LOC).setValue(p.loc);
    sh.getRange(r, C_KEY).setValue(p.name);
    sh.getRange(r, C_NAME).setValue(p.name);
    sh.getRange(r, C_PM).setValue(p.pm);
    sh.getRange(r, C_STT).setFormula('=C' + (r - 1) + '+1');
    sh.getRange(r, C_DATE).setFormula('=IFERROR(VLOOKUP(TRIM(E' + r + '), AutoData!$B:$E, 4, 0), "")');
    sh.getRange(r, C_EMAIL).setFormula('=IFERROR(VLOOKUP(G' + r + ',DATA!$A$4:$B$35,2,FALSE),"")');
    r++;
  });
}

/* ── 3) TICK ✔/o/x cột tuần hiện tại ── */
function crMarkWeek_(ss, sh) {
  var tz = ss.getSpreadsheetTimeZone();
  var now = new Date();
  var dow = parseInt(Utilities.formatDate(now, tz, 'u'), 10);   // 1=T2 … 3=T4, 4=T5 … 7=CN
  var hour = parseInt(Utilities.formatDate(now, tz, 'H'), 10);
  var isWed = (dow === 3 && hour >= 21);
  var isThu = (dow === 4 && hour < 12);
  if (!isWed && !isThu) { Logger.log('Ngoài khung quét (T4≥21h hoặc T5<12h) — bỏ tick. Nay dow=' + dow + ' h=' + hour); return; }

  // Ngày Thứ2, Thứ4, Thứ5 của TUẦN NÀY (yyyy-MM-dd).
  var mon = new Date(now.getTime() - (dow - 1) * 86400000);
  var wed = crIso_(new Date(mon.getTime() + 2 * 86400000), tz);
  var thu = crIso_(new Date(mon.getTime() + 3 * 86400000), tz);
  var monIso = crIso_(mon, tz), sunIso = crIso_(new Date(mon.getTime() + 6 * 86400000), tz);

  // Tìm cột tuần này = cột K..Z có ngày rơi trong [Thứ2..CN].
  var header = sh.getRange(HEADER_ROW, 1, 1, sh.getLastColumn()).getValues()[0];
  var col = -1, colDate = '';
  for (var c = WEEK_COL_START - 1; c < header.length; c++) {
    var h = header[c];
    if (!(h instanceof Date)) continue;                          // hết dải ngày → dừng vùng tuần
    var hs = crIso_(h, tz);
    if (hs >= monIso && hs <= sunIso) { col = c + 1; colDate = hs; break; }
  }
  if (col < 0) { Logger.log('Không thấy cột tuần cho tuần ' + monIso + '..' + sunIso + ' (cần thêm cột thủ công/nới +7).'); return; }

  var props = PropertiesService.getScriptProperties();
  var lockKey = 'CR_LOCK_' + colDate;
  if (props.getProperty(lockKey)) { Logger.log('Cột ' + colDate + ' ĐÃ KHOÁ — bỏ qua.'); return; }

  var lastRow = crLastDataRow_(sh);
  if (lastRow < DATA_START_ROW) { Logger.log('Bảng trống.'); return; }
  var n = lastRow - DATA_START_ROW + 1;
  var dates = sh.getRange(DATA_START_ROW, C_DATE, n, 1).getValues();  // ngày cập nhật (đã VLOOKUP)
  var out = [], cnt = { '✓': 0, o: 0, x: 0 };
  for (var i = 0; i < n; i++) {
    var d = dates[i][0];
    var ds = (d instanceof Date) ? crIso_(d, tz) : String(d || '').slice(0, 10);
    var mark;
    if (isWed) {
      mark = (ds === wed || (ONTIME_LE_WED && ds && ds <= wed && ds >= monIso)) ? '✓' : 'x';
    } else { // isThu — chốt & khoá
      if (ds === wed || (ONTIME_LE_WED && ds && ds <= wed && ds >= monIso)) mark = '✓';
      else if (ds === thu) mark = 'o';
      else mark = 'x';
    }
    cnt[mark]++;
    out.push([mark]);
  }
  Logger.log('Tick cột ' + colDate + ' (' + (isWed ? 'T4' : 'T5-chốt') + '): ✓=' + cnt['✓'] + ' o=' + cnt.o + ' x=' + cnt.x);
  if (DRY_RUN) return;
  sh.getRange(DATA_START_ROW, col, n, 1).setValues(out);
  if (isThu) props.setProperty(lockKey, '1');           // khoá sau khi chốt Thứ 5
}

/* ── tiện ích (đặt tên riêng, tránh trùng với ETL FROM 2.3.gs) ── */
function crLastDataRow_(sh) {
  var col = sh.getRange(DATA_START_ROW, C_NAME, sh.getMaxRows() - DATA_START_ROW + 1, 1).getValues();
  var last = DATA_START_ROW - 1;
  for (var i = 0; i < col.length; i++) if (String(col[i][0]).trim() !== '') last = DATA_START_ROW + i;
  return last;
}
function crNorm_(v) {
  return String(v == null ? '' : v).toLowerCase().replace(/[\r\n]+/g, ' ').replace(/[.]/g, '').replace(/\s+/g, ' ').trim();
}
function crIso_(d, tz) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); }
