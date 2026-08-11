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
 *                       cuối bảng (điền Location/Tên; C,D,G,H set CÔNG THỨC để tự chạy — G=PM tra
 *                       AutoData theo tên nên PM đổi ở nguồn thì tự cập nhật).
 *    3. crManageColumns: cột tuần = các THỨ 4 của THÁNG HIỆN TẠI. Thiếu cột nào thì đổi nhãn cột
 *                       trống cùng tháng (vd cột Thứ 3 04/08 → Thứ 4 05/08) hoặc chèn cột mới.
 *                       ẨN mọi cột tuần KHÔNG thuộc tháng hiện tại; HIỆN các cột Thứ 4 tháng này.
 *    4. crUpdateScores: cột I = ĐẾM "x" (lũy kế không cập nhật trong tháng); cột J = ĐIỂM
 *                       = MAX(0, 100 − 25·(số x) − 10·(số o)) — công thức trên dải Thứ 4 tháng này.
 *                       (Tùy chọn) trừ thêm 10·(số tuần không trình BOD) nếu bật BOD_DEDUCT.
 *                       ĐÂY LÀ NGUỒN ĐIỂM DUY NHẤT — app CHỈ ĐỌC cột J để render, KHÔNG tự tính.
 *                       Điểm PM (trung bình, gộp bỏ DPM) do APP tự tính từ cột J — không ở đây.
 *    5. crMarkWeek    : quét theo lịch (trigger Thứ 4 21h + Thứ 5 12h), tick cột tuần hiện tại:
 *         · Thứ 4 (~21h): ẢNH CHỤP — ngày cập nhật == T4 → "✓" (đúng hạn), còn lại → "x".
 *         · Thứ 5 (~12h): CHỐT — GIỮ "✓" của tối T4; ai còn "x" mà giờ ĐÃ có ngày cập nhật
 *                          (== T4 sau 21h HOẶC == T5) → "o" (TRỄ); còn lại giữ "x"; rồi KHOÁ cột.
 *           (Mấu chốt: "✓" CHỈ do lần quét 21h T4 tạo ra — vì ô ngày chỉ có NGÀY, không có GIỜ,
 *            cập nhật SAU 21h T4 nhìn ngày vẫn = T4 nên phải dựa ảnh chụp T4 để biết trễ → "o".)
 *       (Cột tuần này = cột có ngày Thứ 4 rơi trong tuần Thứ2–CN chứa hôm nay.)
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

// ─── RULE "KHÔNG TRÌNH BOD: −10 điểm / MỖI TUẦN" (mặc định TẮT — chưa có nguồn dữ liệu) ───
//  Cách bật khi có dữ liệu:
//   1) Thêm 1 cột "Số tuần không trình BOD" (đếm tay, hoặc công thức của anh) — vd cột AA.
//   2) BOD_COUNT_COL = 'AA';  BOD_DEDUCT = true;
//  → Điểm dự án = MAX(0, 100 − 25·x − 10·o − 10·(số tuần không trình BOD)).
//  Để TẮT: BOD_DEDUCT = false → công thức giữ nguyên 100−25x−10o (như hiện tại).
var BOD_DEDUCT    = false;
var BOD_COUNT_COL = '';                            // chữ cột đếm "số tuần không trình BOD" (điền khi bật)

/** HÀM CHÍNH — để trigger gọi mỗi giờ. */
function runComplianceReport() {
  // Làm tươi AutoData trước (nếu bridge cùng project) để ngày cập nhật mới nhất.
  try { if (typeof syncComplianceBridge === 'function') syncComplianceBridge(); } catch (e) { Logger.log('Bridge sync lỗi (bỏ qua): ' + e); }

  var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(BRIDGE_SHEET_ID);
  var sh = ss.getSheetByName(REPORT_SHEET);
  if (!sh) throw new Error('Không thấy sheet "' + REPORT_SHEET + '".');

  crUpdateTitle_(sh);
  crSyncProjects_(ss, sh);
  var range = crManageColumns_(ss, sh);   // {first,last} cột Thứ 4 tháng này
  crUpdateScores_(sh, range);             // cột I (đếm x) + J (điểm 100−25x−10o)
  crMarkWeek_(ss, sh, range);
  Logger.log(DRY_RUN ? '*** DRY_RUN: chưa ghi gì. Đổi DRY_RUN=false để chạy thật. ***' : 'Đã chạy thật xong.');
}

/** Đặt lịch: Thứ 4 ~21h (quét đúng hạn) + Thứ 5 ~12h (chốt & khoá). Chạy 1 lần.
 *  (Apps Script atHour(h) bắn trong khung [h:00, h+1:00) → khớp cửa sổ ở crMarkWeek_.) */
function createComplianceTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runComplianceReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runComplianceReport').timeBased()
    .onWeekDay(ScriptApp.WeekDay.WEDNESDAY).atHour(21).create();   // quét Thứ 4 ~21h
  ScriptApp.newTrigger('runComplianceReport').timeBased()
    .onWeekDay(ScriptApp.WeekDay.THURSDAY).atHour(12).create();    // chốt Thứ 5 ~12h
  Logger.log('Đã đặt lịch: Thứ 4 ~21h + Thứ 5 ~12h.');
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
    // G = PM: CÔNG THỨC tự tra từ AutoData theo TÊN (E), cột 2 của B:E (= cột C = PM) → PM đổi ở
    // nguồn thì tự cập nhật, không "đông cứng" giá trị lúc thêm dòng. (dùng dấu PHẨY — Apps Script
    // luôn nhận en-US; sheet locale sẽ tự hiện thành ";".)
    sh.getRange(r, C_PM).setFormula('=IFERROR(VLOOKUP(TRIM(E' + r + '), AutoData!$B:$E, 2, 0), "")');
    sh.getRange(r, C_STT).setFormula('=C' + (r - 1) + '+1');
    sh.getRange(r, C_DATE).setFormula('=IFERROR(VLOOKUP(TRIM(E' + r + '), AutoData!$B:$E, 4, 0), "")');
    sh.getRange(r, C_EMAIL).setFormula('=IFERROR(VLOOKUP(G' + r + ',DATA!$A$4:$B$35,2,FALSE),"")');
    r++;
  });
}

/* ── 3) QUẢN CỘT: cột tuần = các Thứ 4 tháng này; ẩn tháng khác. Trả {first,last} (cột index). ── */
function crManageColumns_(ss, sh) {
  var tz = ss.getSpreadsheetTimeZone();
  var now = new Date();
  var curMonth = Utilities.formatDate(now, tz, 'yyyy-MM');
  var y = parseInt(Utilities.formatDate(now, tz, 'yyyy'), 10);
  var m = parseInt(Utilities.formatDate(now, tz, 'MM'), 10);
  var weds = crWedsOfMonth_(y, m, tz);                 // ['2026-08-05','2026-08-12',...]

  var header = sh.getRange(HEADER_ROW, 1, 1, sh.getLastColumn()).getValues()[0];
  var weekCols = [];
  for (var c = WEEK_COL_START - 1; c < header.length; c++) {
    if (header[c] instanceof Date) weekCols.push({ col: c + 1, date: crIso_(header[c], tz) });
  }
  var haveDate = {}; weekCols.forEach(function (w) { haveDate[w.date] = w.col; });
  // Cột cùng tháng nhưng KHÔNG phải Thứ 4 cần dùng, lại đang trống → tái dùng (đổi nhãn).
  var reusable = weekCols.filter(function (w) {
    return w.date.slice(0, 7) === curMonth && weds.indexOf(w.date) < 0 && crColEmpty_(sh, w.col);
  });
  var lastWeekCol = weekCols.length ? weekCols[weekCols.length - 1].col : (WEEK_COL_START - 1);

  weds.forEach(function (wd) {
    if (haveDate[wd]) return;
    if (reusable.length) {
      var r = reusable.shift();
      Logger.log('Cột: đổi nhãn #' + r.col + ' ' + r.date + ' → ' + wd);
      if (!DRY_RUN) sh.getRange(HEADER_ROW, r.col).setValue(crParseIso_(wd));
      haveDate[wd] = r.col;
    } else {
      Logger.log('Cột: TẠO cột mới ' + wd + ' (sau cột #' + lastWeekCol + ')');
      if (!DRY_RUN) {
        sh.insertColumnAfter(lastWeekCol);
        sh.getRange(HEADER_ROW, lastWeekCol).copyTo(sh.getRange(HEADER_ROW, lastWeekCol + 1), { formatOnly: true });
        sh.getRange(HEADER_ROW, lastWeekCol + 1).setValue(crParseIso_(wd));
      }
      lastWeekCol++;
      haveDate[wd] = lastWeekCol;
    }
  });

  // Ẩn/hiện. (Dry-run chỉ log.)
  if (DRY_RUN) {
    var hide = weekCols.filter(function (w) { return w.date.slice(0, 7) !== curMonth; }).map(function (w) { return w.date; });
    Logger.log('Cột: sẽ ẨN tháng khác (' + hide.length + '): ' + hide.join(', '));
    Logger.log('Cột: sẽ HIỆN Thứ 4 tháng ' + curMonth + ': ' + weds.join(', '));
  } else {
    var h2 = sh.getRange(HEADER_ROW, 1, 1, sh.getLastColumn()).getValues()[0];
    for (var c2 = WEEK_COL_START - 1; c2 < h2.length; c2++) {
      if (!(h2[c2] instanceof Date)) continue;
      if (weds.indexOf(crIso_(h2[c2], tz)) >= 0) sh.showColumns(c2 + 1);
      else sh.hideColumns(c2 + 1);
    }
  }

  // Dải cột Thứ 4 tháng này (liền kề) → cho chấm điểm & tick.
  var cols = weds.map(function (wd) { return haveDate[wd]; }).filter(function (x) { return x; }).sort(function (a, b) { return a - b; });
  return cols.length ? { first: cols[0], last: cols[cols.length - 1], cols: cols } : null;
}

/* ── 4) CỘT I (lũy kế x) + J (điểm 100−25x−10o) bằng CÔNG THỨC, phạm vi = Thứ 4 tháng này ── */
function crUpdateScores_(sh, range) {
  if (!range) { Logger.log('Điểm: chưa có cột tháng này — bỏ qua.'); return; }
  var lastRow = crLastDataRow_(sh);
  if (lastRow < DATA_START_ROW) return;
  var a1 = crColA1_(range.first) + '{r}:' + crColA1_(range.last) + '{r}';
  Logger.log('Điểm: cột I=đếm "x", J=100−25x−10o trên dải ' + crColA1_(range.first) + '..' + crColA1_(range.last) + ' cho ' + (lastRow - DATA_START_ROW + 1) + ' dòng.');
  if (DRY_RUN) return;
  var bodOn = BOD_DEDUCT && /^[A-Z]+$/i.test(BOD_COUNT_COL);
  if (BOD_DEDUCT && !bodOn) Logger.log('BOD: BOD_DEDUCT=true nhưng BOD_COUNT_COL rỗng/không hợp lệ → BỎ QUA trừ BOD.');
  for (var r = DATA_START_ROW; r <= lastRow; r++) {
    var rng = crColA1_(range.first) + r + ':' + crColA1_(range.last) + r;
    var bod = bodOn ? ('-10*N(' + BOD_COUNT_COL.toUpperCase() + r + ')') : '';   // −10 mỗi tuần không trình BOD
    sh.getRange(r, 9).setFormula('=COUNTIF(' + rng + ',"x")');                    // I = Lũy kế không cập nhật
    sh.getRange(r, 10).setFormula('=MAX(0,100-25*COUNTIF(' + rng + ',"x")-10*COUNTIF(' + rng + ',"o")' + bod + ')'); // J = Điểm
  }
}

/* ── 5) TICK ✔/o/x cột tuần hiện tại ── */
function crMarkWeek_(ss, sh, range) {
  var tz = ss.getSpreadsheetTimeZone();
  var now = new Date();
  var dow = parseInt(Utilities.formatDate(now, tz, 'u'), 10);   // 1=T2 … 3=T4, 4=T5 … 7=CN
  var hour = parseInt(Utilities.formatDate(now, tz, 'H'), 10);
  var isWed = (dow === 3 && hour >= 21);               // khớp trigger Thứ 4 21h (fire 21:00–22:00)
  var isThu = (dow === 4 && hour >= 12 && hour < 14);  // khớp trigger Thứ 5 12h (fire 12:00–13:00)
  if (!isWed && !isThu) { Logger.log('Ngoài khung quét (T4 21h / T5 12h) — bỏ tick. Nay dow=' + dow + ' h=' + hour); return; }

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
  var prev  = sh.getRange(DATA_START_ROW, col, n, 1).getValues();     // ✓/x đã chấm tối T4 (để GIỮ đúng hạn)
  var out = [], cnt = { '✓': 0, o: 0, x: 0 };
  var missT4 = 0;
  for (var i = 0; i < n; i++) {
    var d = dates[i][0];
    var ds = (d instanceof Date) ? crIso_(d, tz) : String(d || '').slice(0, 10);
    var onTime = (ds === wed || (ONTIME_LE_WED && ds && ds <= wed && ds >= monIso));
    var mark;
    if (isWed) {
      // Ảnh chụp lúc 21h T4: đã cập nhật (ngày = T4) → ✓ đúng hạn; chưa → x.
      mark = onTime ? '✓' : 'x';
    } else { // isThu — CHỐT & KHOÁ: giữ ✓ của T4, chỉ nâng x→o cho ai VỪA cập nhật (trễ)
      var cur = String(prev[i][0] || '').trim();
      if (cur === '✓') {
        mark = '✓';                               // đã đúng hạn từ tối T4 → GIỮ NGUYÊN
      } else if (ds === wed || ds === thu) {
        mark = 'o';                               // cập nhật TRỄ: sau 21h T4 (ngày=T4) hoặc sang T5
        if (cur === '') missT4++;                 // ô trống = tối T4 chưa quét được (trigger lỡ)
      } else {
        mark = 'x';                               // vẫn CHƯA cập nhật
      }
    }
    cnt[mark]++;
    out.push([mark]);
  }
  if (missT4) Logger.log('LƯU Ý: ' + missT4 + ' dòng đang TRỐNG lúc T5 (trigger 21h T4 có thể chưa chạy) → tạm tính "o".');
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
/** Danh sách các Thứ 4 (yyyy-MM-dd) trong tháng m/y. */
function crWedsOfMonth_(y, m, tz) {
  var out = [], d = new Date(y, m - 1, 1);
  while (d.getMonth() === m - 1) {
    if (d.getDay() === 3) out.push(Utilities.formatDate(d, tz, 'yyyy-MM-dd')); // 3 = Thứ 4
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}
function crParseIso_(iso) { var p = iso.split('-'); return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)); }
/** Cột (index) có trống ở mọi dòng dữ liệu không? */
function crColEmpty_(sh, col) {
  var lastRow = crLastDataRow_(sh);
  if (lastRow < DATA_START_ROW) return true;
  var vals = sh.getRange(DATA_START_ROW, col, lastRow - DATA_START_ROW + 1, 1).getValues();
  return vals.every(function (r) { return String(r[0]).trim() === ''; });
}
/** Index cột (1-based) → chữ cái A1 (1→A, 27→AA…). */
function crColA1_(n) { var s = ''; while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
