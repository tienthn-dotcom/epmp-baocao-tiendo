/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  BÁO CÁO TUÂN THỦ — FILE GỘP (bridge 2.3 → AutoData  +  tự thêm/xoá dự án + tick ✔o x)
 * ═══════════════════════════════════════════════════════════════════════════
 *  Gộp 2 script cũ ("ETL FROM 2.3" + "Báo cáo tuân thủ") thành 1. Dán TOÀN BỘ file này vào
 *  Apps Script của LINK1 (file báo cáo tuân thủ). XOÁ 2 file .gs cũ để khỏi chạy trùng.
 *
 *  MỖI GIỜ (1 trigger duy nhất → runComplianceReport) tự làm:
 *   1) Đọc 2.3 (.xlsx riêng tư) → ghi tab "AutoData" (thêm cột KEY = khoá cứng).
 *   2) Thêm dự án MỚI, XOÁ dự án đã ẩn/xoá ở 2.3, và tick ✔/o/x theo lịch (T4 21h / T5 12h).
 *
 *  ★ CHỐNG "ĐỔI TÊN LÀ GÃY HÀM": khớp AutoData ↔ bảng theo KHOÁ CỨNG (IDCUNG) thay vì tên.
 *     • 2.3 CÓ cột "IDCUNG" → khoá = IDCUNG (đổi tên dự án thoải mái, hàm vẫn chạy).
 *     • 2.3 KHÔNG có IDCUNG → tự lùi về khoá = tên (chuẩn hoá). Log ghi rõ "Khoá dùng".
 *       → Nếu log báo "name", nên thêm cột IDCUNG vào 2.3 để hết hẳn cảnh chỉnh tay.
 *     • Dòng cũ đang lưu TÊN ở cột E được TỰ DI TRÚ sang khoá cứng ở lần chạy đầu (không mất
 *       lịch sử tick). Công thức PM/Ngày dùng INDEX/MATCH theo khoá (cột F của AutoData).
 *
 *  ★ TỰ XOÁ DÒNG "MỒ CÔI": dự án không còn trong AutoData (ẩn/xoá ở 2.3) → xoá khỏi bảng,
 *     hết cảnh dự án đã xong nằm trơ dòng trống. KHOÁ AN TOÀN: bridge lỗi / AutoData rỗng →
 *     BỎ QUA thêm/xoá (không bao giờ xoá sạch bảng vì một lần đọc 2.3 hỏng).
 *
 *  CÀI 1 LẦN:
 *   1) Bật Advanced Drive Service: "Services" (+) → "Drive API" → Add.
 *   2) Chạy `runComplianceReport` 1 lần → Authorize. Xem Execution log:
 *        · "Bridge: N dự án. Khoá dùng: {...}"  → kiểm IDCUNG hay name.
 *        · "XOÁ .../THÊM .../Di trú ..."         → xem có đúng ý không.
 *   3) Ưng log rồi đổi DRY_RUN = false → chạy lại 1 lần cho ghi thật.
 *   4) Chạy `setupTrigger` 1 lần → tự chạy mỗi giờ (đã xoá mọi trigger cũ để khỏi trùng).
 */

// ─── CẤU HÌNH ────────────────────────────────────────────────────────────────
var DRY_RUN         = true;   // <<< true = chạy thử (chỉ log, KHÔNG ghi bảng báo cáo); false = ghi thật.
var SOURCE_FILE_ID  = '1fBAL3KIwYqaosMtjaq8cxvRSkcHmQicD';                 // file 2.3 (.xlsx). CHỈ ĐỌC.
var BRIDGE_SHEET_ID = '15pcqb0ExFQ5uF9CuKSx6O6y9GN4kfiNf6IARN98pJbA';    // = LINK1 (file báo cáo tuân thủ). GHI.
var BRIDGE_TAB      = 'AutoData';                                         // tab trung gian trong LINK1.

var REPORT_SHEET    = 'Báo cáo tuân thủ PMP';
var TITLE_CELL      = 'D3';
var HEADER_ROW      = 9;      // hàng tiêu đề cột (Location/STT/…)
var DATA_START_ROW  = 11;     // dòng dự án đầu tiên
var C_MP = 1, C_LOC = 2, C_STT = 3, C_DATE = 4, C_KEY = 5, C_NAME = 6, C_PM = 7, C_EMAIL = 8;
var WEEK_COL_START  = 11;     // cột K (ngày tuần đầu tiên)
var ONTIME_LE_WED   = false;  // true = "≤ Thứ 4 = đúng hạn"; false = "đúng ngày Thứ 4".

// Rule "không trình BOD: −10 điểm/tuần" — mặc định TẮT (chưa có nguồn). Bật: điền cột đếm + BOD_DEDUCT=true.
var BOD_DEDUCT      = false;
var BOD_COUNT_COL   = '';
// ─────────────────────────────────────────────────────────────────────────────


/* ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  MAIN + TRIGGER                                                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝ */

/** HÀM CHÍNH — để trigger gọi mỗi giờ. Tự canh giờ để tick đúng lúc. */
function runComplianceReport() {
  // 1) Bridge 2.3 → AutoData. Nếu LỖI thì bỏ qua thêm/xoá dự án (tránh xoá nhầm khi 2.3 đọc hỏng).
  var bridgeCount = -1;
  try { bridgeCount = syncComplianceBridge(); }
  catch (e) { Logger.log('BRIDGE LỖI → bỏ qua thêm/xoá dự án lần này (không xoá nhầm): ' + e); }

  var ss = SpreadsheetApp.openById(BRIDGE_SHEET_ID);
  var sh = ss.getSheetByName(REPORT_SHEET);
  if (!sh) throw new Error('Không thấy sheet "' + REPORT_SHEET + '".');

  crUpdateTitle_(sh);
  if (bridgeCount > 0) crSyncProjects_(ss, sh);         // thêm + XOÁ + di trú khoá (chỉ khi bridge có data)
  else Logger.log('Bỏ qua thêm/xoá dự án (bridge chưa có dữ liệu) — an toàn.');
  var range = crManageColumns_(ss, sh);                 // {first,last,cols} các Thứ 4 tháng này
  crUpdateScores_(sh, range);                           // cột I (đếm x) + J (điểm 100−25x−10o)
  crMarkWeek_(ss, sh, range);                           // tick ✔/o/x cột tuần hiện tại (theo lịch)
  Logger.log(DRY_RUN ? '*** DRY_RUN: chưa ghi bảng báo cáo. Đổi DRY_RUN=false để chạy thật. ***'
                     : 'Đã chạy thật xong.');
}

/** Đặt lịch: 1 trigger DUY NHẤT chạy mỗi giờ. Xoá mọi trigger cũ (bridge/report) để khỏi trùng. Chạy 1 lần. */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'runComplianceReport' || f === 'syncComplianceBridge') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runComplianceReport').timeBased().everyHours(1).create();
  Logger.log('Đã đặt 1 lịch chạy mỗi giờ (runComplianceReport). Đã xoá mọi trigger cũ.');
}


/* ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  BRIDGE — đọc 2.3.xlsx → AutoData (thêm cột KEY = khoá cứng)                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝ */

/** Đọc 2.3 → ghi AutoData. Trả về SỐ dự án đọc được (0 = không có → gọi bên trên sẽ bỏ qua thêm/xoá). */
function syncComplianceBridge() {
  if (!BRIDGE_SHEET_ID) throw new Error('Chưa điền BRIDGE_SHEET_ID.');
  var src = openSourceAsSheet_();
  try {
    var grid = pickTimelineGrid_(src.ss);
    var list = extractProjects_(grid);
    writeBridge_(list);                                  // AutoData là tab trung gian → ghi cả khi DRY_RUN.
    var kt = {}; list.forEach(function (p) { kt[p.keyType] = (kt[p.keyType] || 0) + 1; });
    Logger.log('Bridge: ' + list.length + ' dự án. Khoá dùng: ' + JSON.stringify(kt));
    return list.length;
  } finally {
    if (src.tmpId) DriveApp.getFileById(src.tmpId).setTrashed(true);   // dọn bản sao tạm
  }
}

/** Mở 2.3: thử mở trực tiếp (.xlsx), không được thì convert bản sao tạm (cần Drive API). */
function openSourceAsSheet_() {
  try {
    var direct = SpreadsheetApp.openById(SOURCE_FILE_ID);
    if (direct && direct.getSheets().length > 0) return { ss: direct, tmpId: null };
  } catch (e) { /* rơi xuống convert */ }

  if (typeof Drive === 'undefined') {
    throw new Error('Mở trực tiếp .xlsx không được và Drive API CHƯA bật. ' +
      'Bên trái editor: "Services" (+) → "Drive API" → Add → chạy lại.');
  }
  var title = '[tmp] compliance-src ' + Date.now();
  var copy = Drive.Files.copy(
    { title: title, name: title, mimeType: MimeType.GOOGLE_SHEETS },
    SOURCE_FILE_ID, { supportsAllDrives: true });
  return { ss: SpreadsheetApp.openById(copy.id), tmpId: copy.id };
}

/** Chọn TAB Timeline = tab đầu có dòng header "Show". Không thấy → tab đầu. */
function pickTimelineGrid_(ss) {
  var sheets = ss.getSheets();
  for (var s = 0; s < sheets.length; s++) {
    var vals = sheets[s].getDataRange().getValues();
    if (detectCols_(vals)) return vals;
  }
  return sheets[0].getDataRange().getValues();
}

/** DÒ CỘT (chép logic detectColumns của app) + thêm dò IDCUNG (khoá cứng). */
function detectCols_(grid) {
  var headerIdx = -1, showIdx = -1;
  var n = Math.min(15, grid.length);
  for (var i = 0; i < n; i++) {
    var r = grid[i] || [];
    var idx = -1;
    for (var c = 0; c < r.length; c++) {
      if (cell_(r[c]).toLowerCase() === 'show') { idx = c; break; }
    }
    if (idx < 0) continue;
    var joined = r.map(cell_).join(' | ').toLowerCase();
    if (!/kết\s*thúc|bắt\s*đầu|mô\s*tả|%\s*thực\s*tế|vướng\s*mắc|(^|\|)\s*mã\s*(\||$)/.test(joined)) continue;
    headerIdx = i; showIdx = idx; break;
  }
  if (headerIdx < 0) return null;

  var header = grid[headerIdx] || [];
  function findRe(re) {
    for (var c = 0; c < header.length; c++) {
      var h = cell_(header[c]).toLowerCase();
      if (h && re.test(h)) return c;
    }
    return -1;
  }
  var cols = {
    headerIdx: headerIdx,
    show: showIdx,
    name: showIdx + 1,   // Tên dự án (F)
    maCT: showIdx + 3,   // Mã CT (H)
    code: showIdx + 7,   // Mã / rawCode (L)
    pm: showIdx + 9      // Người phụ trách (N)
  };
  var o;
  o = findRe(/^ma\s*ct$|^mã\s*ct$/);      if (o >= 0) cols.maCT = o;
  o = findRe(/^mã$/);                     if (o >= 0) cols.code = o;
  o = findRe(/người\s*phụ\s*trách/);      if (o >= 0) cols.pm = o;

  // IDCUNG = KHOÁ CỨNG (vd "P0025") — bền nhất, không đổi khi đổi tên/đánh lại STT.
  cols.id = findRe(/^idcung$|id\s*c[ứu]ng|hard\s*id/);

  // STT/ID phân cấp: đúng "STT"/"ID"/"Mã ID", KHÔNG kèm "dự án" (tránh cột Top-20). (Chỉ để hiển thị.)
  cols.stt = -1;
  for (var c2 = 0; c2 < header.length; c2++) {
    var h2 = cell_(header[c2]).toLowerCase();
    if (!h2) continue;
    if (/d[ựu]\s*[áa]n/.test(h2)) continue;
    if (/^stt$|^id$|^mã\s*id$/.test(h2)) { cols.stt = c2; break; }
  }
  cols.location = findRe(/location|khu\s*vực|vùng|region/);
  cols.update   = findRe(/ng[àa]y\s*update|ng[àa]y\s*c[ậa]p\s*nh[ậa]t/);
  return cols;
}

/** Chỉ lấy DÒNG DỰ ÁN CHA đang Show. Mỗi dự án gắn KHOÁ: IDCUNG nếu có, không thì tên chuẩn hoá. */
function extractProjects_(grid) {
  var cols = detectCols_(grid);
  if (!cols) throw new Error('Không tìm được dòng header "Show" trong 2.3 (sai tab hoặc file đổi cấu trúc).');
  var out = [];
  for (var i = cols.headerIdx + 1; i < grid.length; i++) {
    var r = grid[i] || [];
    var code = cell_(r[cols.code]);
    var name = cell_(r[cols.name]);
    var maCT = cell_(r[cols.maCT]);
    if (!code && !name && !maCT) continue;
    if (!isParent_(code, maCT, name)) continue;
    if (!isShown_(r[cols.show])) continue;

    var disp = name || code || maCT;
    var idv  = cols.id >= 0 ? cell_(r[cols.id]) : '';
    var key, keyType;
    if (idv) { key = 'H:' + idv; keyType = 'IDCUNG'; }          // khoá cứng — bền nhất
    else     { key = 'N:' + crNorm_(disp); keyType = 'name'; }  // lùi về tên (chuẩn hoá)

    out.push({
      stt: cols.stt >= 0 ? cell_(r[cols.stt]) : '',
      name: disp,
      pm: pmFirst_(r[cols.pm]),
      location: cols.location >= 0 ? cell_(r[cols.location]) : '',
      update: cols.update >= 0 ? toIso_(r[cols.update]) : '',
      key: key,
      keyType: keyType
    });
  }
  return out;
}

function isParent_(code, maCT, name) {
  if (!code) return false;
  if (/^CT/i.test(code)) return true;
  if (maCT && code === maCT && name) return true;
  return false;
}
function isShown_(v) { return cell_(v).toLowerCase() === 'show'; }

/** PM = dòng ĐẦU ô "Người phụ trách chính", bỏ nhãn "PM"/dòng "DPM". */
function pmFirst_(v) {
  var raw = v == null ? '' : String(v);
  var lines = raw.split(/\r?\n|;|\|/)
    .map(function (l) { return l.replace(/\s+/g, ' ').trim(); })
    .filter(function (l) { return l && !/^pm\b[:\s\-.]*$/i.test(l); });
  var pmLine = '';
  for (var i = 0; i < lines.length; i++) {
    if (!/^d\s*pm\b/i.test(lines[i])) { pmLine = lines[i]; break; }
  }
  return pmLine.replace(/^pm\b[:\s\-.]*/i, '').trim();
}

/** Ngày → ISO yyyy-mm-dd. '' nếu trống/không đọc được. */
function toIso_(v) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return v.getFullYear() + '-' + pad2_(v.getMonth() + 1) + '-' + pad2_(v.getDate());
  }
  var raw = String(v).trim();
  var m = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    var a = parseInt(m[1], 10), b = parseInt(m[2], 10), y = m[3];
    if (y.length === 2) y = '20' + y;
    var d, mo;
    if (a > 12) { d = a; mo = b; } else if (b > 12) { mo = a; d = b; } else { d = a; mo = b; }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return y + '-' + pad2_(mo) + '-' + pad2_(d);
  }
  m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
  return '';
}

/** Ghi AutoData. Cột: A=STT B=Tên C=PM D=Location E=Ngày update F=KEY G=Đồng bộ lúc.
 *  (A–E GIỮ NGUYÊN như bản cũ để app đọc không lệch; F=KEY là cột MỚI cho khớp khoá.) */
function writeBridge_(list) {
  var ss = SpreadsheetApp.openById(BRIDGE_SHEET_ID);
  var sh = ss.getSheetByName(BRIDGE_TAB) || ss.insertSheet(BRIDGE_TAB);
  sh.clear();
  var now = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd HH:mm');
  var head = ['STT', 'Tên dự án', 'PM', 'Location', 'Ngày update', 'KEY', 'Đồng bộ lúc'];
  var rows = [head];
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    rows.push([p.stt, p.name, p.pm, p.location, p.update, p.key, i === 0 ? now : '']);
  }
  sh.getRange(1, 1, rows.length, head.length).setValues(rows);
}


/* ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  REPORT — tiêu đề / thêm-xoá dự án (khớp khoá) / cột tuần / điểm / tick     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝ */

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

/* ── 2) THÊM dự án mới + XOÁ dự án đã ẩn/xoá + DI TRÚ khoá — khớp theo KHOÁ CỨNG (cột F AutoData) ── */
function crSyncProjects_(ss, sh) {
  var ad = ss.getSheetByName(AUTODATA_SHEET_());
  if (!ad) { Logger.log('Không thấy tab AutoData — bỏ qua thêm/xoá.'); return; }
  var adRows = ad.getDataRange().getValues();               // [STT,Tên,PM,Location,Update,KEY,SyncTime]
  if (adRows.length < 2) { Logger.log('AutoData rỗng — bỏ qua thêm/xoá (an toàn).'); return; }
  var AD_NAME = 1, AD_PM = 2, AD_LOC = 3, AD_KEY = 5;

  // Bản đồ AutoData: theo KHOÁ (F) và theo TÊN chuẩn hoá (để di trú dòng cũ lưu tên ở cột E).
  var byKey = {}, byName = {};
  for (var i = 1; i < adRows.length; i++) {
    var key = String(adRows[i][AD_KEY] || '').trim(); if (!key) continue;
    var nm = String(adRows[i][AD_NAME] || '').replace(/\s+/g, ' ').trim();
    byKey[key] = { name: nm, pm: String(adRows[i][AD_PM] || '').split(/\r?\n/)[0].trim(), loc: String(adRows[i][AD_LOC] || '').trim() };
    var nk = crNorm_(nm); if (nk && !byName[nk]) byName[nk] = key;
  }

  // Khớp 1 dòng bảng → khoá AutoData: ưu tiên khoá thẳng (E), rồi di trú theo tên (F hoặc E cũ).
  function matchRow(eVal, fVal) {
    if (eVal && byKey[eVal]) return eVal;
    var nk = crNorm_(fVal || eVal);
    if (nk && byName[nk]) return byName[nk];
    return '';
  }

  // ── PHA 1: XOÁ dòng "mồ côi" (không còn trong AutoData = đã ẩn/xoá ở 2.3) ──
  var lastRow = crLastDataRow_(sh);
  var toRemove = [], removeNames = [];
  if (lastRow >= DATA_START_ROW) {
    var ef = sh.getRange(DATA_START_ROW, C_KEY, lastRow - DATA_START_ROW + 1, 2).getValues();   // E,F
    for (var j = 0; j < ef.length; j++) {
      var e = String(ef[j][0] || '').trim(), f = String(ef[j][1] || '').replace(/\s+/g, ' ').trim();
      if (!e && !f) continue;                                // dòng trống sẵn — bỏ qua
      if (!matchRow(e, f)) { toRemove.push(DATA_START_ROW + j); removeNames.push(f || e); }
    }
  }
  if (toRemove.length) {
    Logger.log('XOÁ ' + toRemove.length + ' dòng (dự án đã ẩn/xoá ở 2.3): ' + removeNames.join(' | '));
    if (!DRY_RUN) for (var r = toRemove.length - 1; r >= 0; r--) sh.deleteRow(toRemove[r]);   // xoá từ DƯỚI lên
  } else Logger.log('Không có dự án cần xoá.');

  // ── PHA 2: di trú khoá cho dòng cũ + đánh dấu dự án đã có ──
  lastRow = crLastDataRow_(sh);                              // đọc lại sau khi xoá
  var present = {}, migrated = 0;
  if (lastRow >= DATA_START_ROW) {
    var ef2 = sh.getRange(DATA_START_ROW, C_KEY, lastRow - DATA_START_ROW + 1, 2).getValues();
    for (var j2 = 0; j2 < ef2.length; j2++) {
      var row = DATA_START_ROW + j2;
      var e2 = String(ef2[j2][0] || '').trim(), f2 = String(ef2[j2][1] || '').replace(/\s+/g, ' ').trim();
      var mk = matchRow(e2, f2);
      if (!mk) continue;                                     // (còn sót do DRY_RUN chưa xoá) — bỏ qua
      present[mk] = true;
      if (e2 !== mk) {                                       // E đang là tên (bản cũ) → ghi lại = khoá cứng
        migrated++;
        if (!DRY_RUN) sh.getRange(row, C_KEY).setValue(mk);
      }
    }
  }
  if (migrated) Logger.log('Di trú khoá (tên → khoá cứng): ' + migrated + ' dòng.');

  // ── Thêm dự án MỚI (trong AutoData, chưa có trong bảng) ──
  var toAdd = [];
  for (var key in byKey) if (!present[key]) toAdd.push({ key: key, name: byKey[key].name, pm: byKey[key].pm, loc: byKey[key].loc });
  if (!toAdd.length) Logger.log('Không có dự án mới.');
  else {
    Logger.log('THÊM ' + toAdd.length + ' dự án mới: ' + toAdd.map(function (p) { return p.name; }).join(' | '));
    if (!DRY_RUN) {
      var rAdd = crLastDataRow_(sh) + 1;
      toAdd.forEach(function (p) {
        sh.getRange(rAdd, C_LOC).setValue(p.loc);
        sh.getRange(rAdd, C_KEY).setValue(p.key);            // E = khoá cứng
        sh.getRange(rAdd, C_NAME).setValue(p.name);          // F = tên (hiển thị)
        crRefreshRow_(sh, rAdd, true);                       // C,D,G,H = công thức (C luôn set cho dòng thêm)
        rAdd++;
      });
    }
  }

  // ── Làm tươi công thức C/D/G/H cho MỌI dòng (idempotent): sửa lệch sau xoá + khớp theo khoá ──
  if (!DRY_RUN) {
    var lr = crLastDataRow_(sh);
    for (var rr = DATA_START_ROW; rr <= lr; rr++) crRefreshRow_(sh, rr, rr > DATA_START_ROW);
  }
}

/** Đặt công thức 1 dòng. C=STT (dòng trên +1) chỉ set khi setStt=true (tránh đụng dòng đầu bảng).
 *  D=Ngày update, G=PM → INDEX/MATCH theo KHOÁ (E) trong cột F của AutoData (đổi tên vẫn khớp).
 *  H=email theo PM. Dùng dấu CHẤM PHẨY ";" phân tách tham số (sheet locale VN đọc "," thành text). */
function crRefreshRow_(sh, r, setStt) {
  if (setStt) sh.getRange(r, C_STT).setFormula('=C' + (r - 1) + '+1');
  sh.getRange(r, C_DATE ).setFormula('=IFERROR(INDEX(AutoData!$E:$E;MATCH(TRIM(E' + r + ');AutoData!$F:$F;0));"")');
  sh.getRange(r, C_PM   ).setFormula('=IFERROR(INDEX(AutoData!$C:$C;MATCH(TRIM(E' + r + ');AutoData!$F:$F;0));"")');
  sh.getRange(r, C_EMAIL).setFormula('=IFERROR(VLOOKUP(G' + r + ';DATA!$A$4:$B$35;2;FALSE);"")');
}

/* ── 3) QUẢN CỘT: cột tuần = các Thứ 4 tháng này; ẩn tháng khác. Trả {first,last,cols}. ── */
function crManageColumns_(ss, sh) {
  var tz = ss.getSpreadsheetTimeZone();
  var now = new Date();
  var curMonth = Utilities.formatDate(now, tz, 'yyyy-MM');
  var y = parseInt(Utilities.formatDate(now, tz, 'yyyy'), 10);
  var m = parseInt(Utilities.formatDate(now, tz, 'MM'), 10);
  var weds = crWedsOfMonth_(y, m, tz);

  var header = sh.getRange(HEADER_ROW, 1, 1, sh.getLastColumn()).getValues()[0];
  var weekCols = [];
  for (var c = WEEK_COL_START - 1; c < header.length; c++) {
    if (header[c] instanceof Date) weekCols.push({ col: c + 1, date: crIso_(header[c], tz) });
  }
  var haveDate = {}; weekCols.forEach(function (w) { haveDate[w.date] = w.col; });
  var reusable = weekCols.filter(function (w) {
    return w.date.slice(0, 7) === curMonth && weds.indexOf(w.date) < 0 && crColEmpty_(sh, w.col);
  });
  var lastWeekCol = weekCols.length ? weekCols[weekCols.length - 1].col : (WEEK_COL_START - 1);

  weds.forEach(function (wd) {
    if (haveDate[wd]) return;
    if (reusable.length) {
      var rc = reusable.shift();
      Logger.log('Cột: đổi nhãn #' + rc.col + ' ' + rc.date + ' → ' + wd);
      if (!DRY_RUN) sh.getRange(HEADER_ROW, rc.col).setValue(crParseIso_(wd));
      haveDate[wd] = rc.col;
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

  var cols = weds.map(function (wd) { return haveDate[wd]; }).filter(function (x) { return x; }).sort(function (a, b) { return a - b; });
  return cols.length ? { first: cols[0], last: cols[cols.length - 1], cols: cols } : null;
}

/* ── 4) CỘT I (lũy kế x) + J (điểm 100−25x−10o) — công thức, phạm vi = Thứ 4 tháng này ── */
function crUpdateScores_(sh, range) {
  if (!range) { Logger.log('Điểm: chưa có cột tháng này — bỏ qua.'); return; }
  var lastRow = crLastDataRow_(sh);
  if (lastRow < DATA_START_ROW) return;
  Logger.log('Điểm: I=đếm "x", J=100−25x−10o trên dải ' + crColA1_(range.first) + '..' + crColA1_(range.last) + ' cho ' + (lastRow - DATA_START_ROW + 1) + ' dòng.');
  if (DRY_RUN) return;
  var bodOn = BOD_DEDUCT && /^[A-Z]+$/i.test(BOD_COUNT_COL);
  if (BOD_DEDUCT && !bodOn) Logger.log('BOD: BOD_DEDUCT=true nhưng BOD_COUNT_COL rỗng/không hợp lệ → BỎ QUA trừ BOD.');
  for (var r = DATA_START_ROW; r <= lastRow; r++) {
    var rng = crColA1_(range.first) + r + ':' + crColA1_(range.last) + r;
    var bod = bodOn ? ('-10*N(' + BOD_COUNT_COL.toUpperCase() + r + ')') : '';
    sh.getRange(r, 9).setFormula('=COUNTIF(' + rng + ';"x")');
    // Điểm CÓ THỂ ÂM (bỏ sàn MAX(0,…) theo yêu cầu): 100 − 25·x − 10·o (− 10·BOD nếu bật).
    sh.getRange(r, 10).setFormula('=100-25*COUNTIF(' + rng + ';"x")-10*COUNTIF(' + rng + ';"o")' + bod + '');
  }
}

/* ── 5) TICK ✔/o/x cột tuần hiện tại (T4 21h: ảnh chụp; T5 12h: chốt & khoá) ── */
function crMarkWeek_(ss, sh, range) {
  var tz = ss.getSpreadsheetTimeZone();
  var now = new Date();
  var dow = parseInt(Utilities.formatDate(now, tz, 'u'), 10);   // 1=T2 … 3=T4, 4=T5 … 7=CN
  var hour = parseInt(Utilities.formatDate(now, tz, 'H'), 10);
  var isWed = (dow === 3 && hour >= 21);
  var isThu = (dow === 4 && hour >= 12 && hour < 14);
  if (!isWed && !isThu) { Logger.log('Ngoài khung quét (T4 21h / T5 12h) — bỏ tick. Nay dow=' + dow + ' h=' + hour); return; }

  var mon = new Date(now.getTime() - (dow - 1) * 86400000);
  var wed = crIso_(new Date(mon.getTime() + 2 * 86400000), tz);
  var thu = crIso_(new Date(mon.getTime() + 3 * 86400000), tz);
  var monIso = crIso_(mon, tz), sunIso = crIso_(new Date(mon.getTime() + 6 * 86400000), tz);

  var header = sh.getRange(HEADER_ROW, 1, 1, sh.getLastColumn()).getValues()[0];
  var col = -1, colDate = '';
  for (var c = WEEK_COL_START - 1; c < header.length; c++) {
    var h = header[c];
    if (!(h instanceof Date)) continue;
    var hs = crIso_(h, tz);
    if (hs >= monIso && hs <= sunIso) { col = c + 1; colDate = hs; break; }
  }
  if (col < 0) { Logger.log('Không thấy cột tuần cho ' + monIso + '..' + sunIso + '.'); return; }

  var props = PropertiesService.getScriptProperties();
  var lockKey = 'CR_LOCK_' + colDate;
  if (props.getProperty(lockKey)) { Logger.log('Cột ' + colDate + ' ĐÃ KHOÁ — bỏ qua.'); return; }

  var lastRow = crLastDataRow_(sh);
  if (lastRow < DATA_START_ROW) { Logger.log('Bảng trống.'); return; }
  var n = lastRow - DATA_START_ROW + 1;
  var dates = sh.getRange(DATA_START_ROW, C_DATE, n, 1).getValues();
  var prev  = sh.getRange(DATA_START_ROW, col, n, 1).getValues();
  var out = [], cnt = { '✓': 0, o: 0, x: 0 }, missT4 = 0;
  for (var i = 0; i < n; i++) {
    var d = dates[i][0];
    var ds = (d instanceof Date) ? crIso_(d, tz) : String(d || '').slice(0, 10);
    var onTime = (ds === wed || (ONTIME_LE_WED && ds && ds <= wed && ds >= monIso));
    var mark;
    if (isWed) {
      mark = onTime ? '✓' : 'x';
    } else {
      var cur = String(prev[i][0] || '').trim();
      if (cur === '✓') mark = '✓';
      else if (ds === wed || ds === thu) { mark = 'o'; if (cur === '') missT4++; }
      else mark = 'x';
    }
    cnt[mark]++;
    out.push([mark]);
  }
  if (missT4) Logger.log('LƯU Ý: ' + missT4 + ' dòng TRỐNG lúc T5 (trigger 21h T4 có thể chưa chạy) → tạm "o".');
  Logger.log('Tick cột ' + colDate + ' (' + (isWed ? 'T4' : 'T5-chốt') + '): ✓=' + cnt['✓'] + ' o=' + cnt.o + ' x=' + cnt.x);
  if (DRY_RUN) return;
  sh.getRange(DATA_START_ROW, col, n, 1).setValues(out);
  if (isThu) props.setProperty(lockKey, '1');
}


/* ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  TIỆN ÍCH                                                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝ */
function AUTODATA_SHEET_() { return BRIDGE_TAB; }
function cell_(v) { return v == null ? '' : String(v).trim(); }
function pad2_(x) { x = String(x); return x.length < 2 ? '0' + x : x; }
function crNorm_(v) {
  return String(v == null ? '' : v).toLowerCase().replace(/[\r\n]+/g, ' ').replace(/[.]/g, '').replace(/\s+/g, ' ').trim();
}
function crIso_(d, tz) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); }
function crWedsOfMonth_(y, m, tz) {
  var out = [], d = new Date(y, m - 1, 1);
  while (d.getMonth() === m - 1) {
    if (d.getDay() === 3) out.push(Utilities.formatDate(d, tz, 'yyyy-MM-dd'));
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}
function crParseIso_(iso) { var p = iso.split('-'); return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)); }
function crColEmpty_(sh, col) {
  var lastRow = crLastDataRow_(sh);
  if (lastRow < DATA_START_ROW) return true;
  var vals = sh.getRange(DATA_START_ROW, col, lastRow - DATA_START_ROW + 1, 1).getValues();
  return vals.every(function (r) { return String(r[0]).trim() === ''; });
}
function crColA1_(n) { var s = ''; while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
function crLastDataRow_(sh) {
  var col = sh.getRange(DATA_START_ROW, C_NAME, sh.getMaxRows() - DATA_START_ROW + 1, 1).getValues();
  var last = DATA_START_ROW - 1;
  for (var i = 0; i < col.length; i++) if (String(col[i][0]).trim() !== '') last = DATA_START_ROW + i;
  return last;
}
