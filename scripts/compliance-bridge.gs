/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  BRIDGE TUÂN THỦ  —  đọc file 2.3 (.xlsx riêng tư trên Drive) → sheet trung gian
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  VÌ SAO CÓ FILE NÀY:
 *   • File 2.3 là .xlsx trên Drive, CHỈ @aacorporation.com xem được (riêng tư).
 *   • App (Cloudflare Worker) tải file ẩn danh → KHÔNG đọc được file riêng tư.
 *   • IMPORTRANGE không chạy trên .xlsx.
 *   → Script này chạy DƯỚI tài khoản @aa CỦA ANH (vốn có quyền xem 2.3), mỗi giờ
 *     đọc 2.3, trích 5 cột vô hại (STT · Tên · PM · Location · Ngày update) của MỖI
 *     DỰ ÁN đang Show, ghi sang 1 Google Sheet trung gian. Sheet trung gian share
 *     "Anyone with the link (Viewer)" → app đọc bình thường. 2.3 KHÔNG hề bị mở ra.
 *   • Chỉ ĐỌC 2.3 (tạo bản sao tạm để convert rồi xoá) → KHÔNG BAO GIỜ ghi ngược,
 *     nên KHÔNG THỂ làm hư công thức file gốc.
 *
 *  DÁN Ở ĐÂU: mở LINK1 (file có mẫu bảng báo cáo tuân thủ — file app ĐANG đọc) →
 *   Extensions (Tiện ích mở rộng) → Apps Script → dán file này. Script sẽ đọc 2.3 (link2)
 *   rồi ghi vào 1 TAB MỚI ("AutoData") trong chính link1 — KHÔNG đụng tab mẫu cũ.
 *   (KHÔNG dán vào file 2.3, KHÔNG tạo file mới, KHÔNG dùng IMPORTRANGE.)
 *
 *  CÁCH DÙNG (làm 1 lần):
 *   1. BRIDGE_SHEET_ID bên dưới điền ID của LINK1 (nếu đúng file 15pcqb0… thì đã điền sẵn).
 *   2. Bật Advanced Drive Service: bên trái "Services" (+) → chọn "Drive API" → Add.
 *   3. Chạy hàm `syncComplianceBridge` 1 lần → bấm Authorize (cho quyền đọc Drive + sửa link1).
 *   4. Kiểm tra link1 có tab mới "AutoData" với 6 cột dữ liệu.
 *   5. Chạy `createHourlyTrigger` 1 lần → tự đồng bộ mỗi giờ.
 *   6. Gửi Tiên biết tab "AutoData" đã có số → Tiên chỉnh app đọc tab đó. (link1 vốn đã share.)
 *
 *  Logic nhận diện cột/dòng SAO CHÉP y hệt src/lib/parser.ts (detectColumns / isParent /
 *  isShown / toIso) — 2.3 đổi version cột vẫn bắt đúng nhờ neo theo ô "Show".
 */

// ─── CẤU HÌNH — sửa 2 dòng này ───────────────────────────────────────────────
var SOURCE_FILE_ID  = '1fBAL3KIwYqaosMtjaq8cxvRSkcHmQicD';                 // file 2.3 (.xlsx) = link2. ĐỌC.
var BRIDGE_SHEET_ID = '15pcqb0ExFQ5uF9CuKSx6O6y9GN4kfiNf6IARN98pJbA';    // = LINK1 (file báo cáo tuân thủ). GHI vào. Kiểm tra khớp ID link1 của anh.
var BRIDGE_TAB      = 'AutoData';                                         // tab MỚI trong link1 (không đụng tab mẫu cũ)
// ─────────────────────────────────────────────────────────────────────────────

/** HÀM CHÍNH — chạy tay hoặc để trigger gọi mỗi giờ. */
function syncComplianceBridge() {
  if (!BRIDGE_SHEET_ID) throw new Error('Chưa điền BRIDGE_SHEET_ID (ID sheet trung gian).');
  var src = openSourceAsSheet_();
  try {
    var grid = pickTimelineGrid_(src.ss);
    var list = extractProjects_(grid);
    writeBridge_(list);
    Logger.log('Đồng bộ xong: ' + list.length + ' dự án.');
  } finally {
    if (src.tmpId) DriveApp.getFileById(src.tmpId).setTrashed(true); // dọn bản sao tạm
  }
}

/** Đặt lịch tự chạy mỗi giờ. Chạy 1 lần. (Xoá lịch cũ trước để không nhân đôi.) */
function createHourlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncComplianceBridge') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncComplianceBridge').timeBased().everyHours(1).create();
  Logger.log('Đã đặt lịch chạy mỗi giờ.');
}

/* ── Đọc 2.3.xlsx ──
 *  Bước 1: THỬ mở thẳng bằng SpreadsheetApp (Google hỗ trợ đọc .xlsx ở chế độ Office) —
 *          nếu được thì KHỎI cần Drive API.
 *  Bước 2: nếu mở thẳng không ra, convert 1 bản sao tạm sang Google Sheet (cần Drive API). */
function openSourceAsSheet_() {
  // Bước 1 — mở trực tiếp
  try {
    var direct = SpreadsheetApp.openById(SOURCE_FILE_ID);
    if (direct && direct.getSheets().length > 0) return { ss: direct, tmpId: null };
  } catch (e) { /* rơi xuống convert */ }

  // Bước 2 — convert (cần Advanced Drive Service)
  if (typeof Drive === 'undefined') {
    throw new Error(
      'Mở trực tiếp .xlsx không được và Drive API CHƯA bật. ' +
      'Bên trái editor bấm "Services" (dấu +) → chọn "Drive API" → Add → chạy lại.'
    );
  }
  var title = '[tmp] compliance-src ' + Date.now();
  // Kèm cả `title` (Drive v2) lẫn `name` (Drive v3) để tương thích mọi phiên bản advanced service;
  // supportsAllDrives phòng khi 2.3 nằm trong Shared Drive.
  var copy = Drive.Files.copy(
    { title: title, name: title, mimeType: MimeType.GOOGLE_SHEETS },
    SOURCE_FILE_ID,
    { supportsAllDrives: true }
  );
  return { ss: SpreadsheetApp.openById(copy.id), tmpId: copy.id };
}

/** Chọn TAB Timeline = tab đầu tiên có dòng header "Show". Không thấy → tab đầu. */
function pickTimelineGrid_(ss) {
  var sheets = ss.getSheets();
  for (var s = 0; s < sheets.length; s++) {
    var vals = sheets[s].getDataRange().getValues();
    if (detectCols_(vals)) return vals;
  }
  return sheets[0].getDataRange().getValues();
}

/* ── DÒ CỘT (chép logic detectColumns của app) ── */
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

  // STT/ID phân cấp: đúng "STT"/"ID"/"Mã ID", KHÔNG kèm "dự án" (tránh cột Top-20).
  cols.stt = -1;
  for (var c = 0; c < header.length; c++) {
    var h = cell_(header[c]).toLowerCase();
    if (!h) continue;
    if (/d[ựu]\s*[áa]n/.test(h)) continue;
    if (/^stt$|^id$|^mã\s*id$/.test(h)) { cols.stt = c; break; }
  }
  cols.location = findRe(/location|khu\s*vực|vùng|region/);
  cols.update   = findRe(/ng[àa]y\s*update|ng[àa]y\s*c[ậa]p\s*nh[ậa]t/);
  return cols;
}

/* ── Chỉ lấy DÒNG DỰ ÁN CHA đang Show (chép isParent/isShown của app) ── */
function extractProjects_(grid) {
  var cols = detectCols_(grid);
  if (!cols) throw new Error('Không tìm được dòng header "Show" trong file 2.3 (sai tab hoặc file đổi cấu trúc).');
  var out = [];
  for (var i = cols.headerIdx + 1; i < grid.length; i++) {
    var r = grid[i] || [];
    var code = cell_(r[cols.code]);
    var name = cell_(r[cols.name]);
    var maCT = cell_(r[cols.maCT]);
    if (!code && !name && !maCT) continue;
    if (!isParent_(code, maCT, name)) continue;
    if (!isShown_(r[cols.show])) continue;
    out.push({
      stt: cols.stt >= 0 ? cell_(r[cols.stt]) : '',
      name: name || code || maCT,
      pm: pmFirst_(r[cols.pm]),
      location: cols.location >= 0 ? cell_(r[cols.location]) : '',
      update: cols.update >= 0 ? toIso_(r[cols.update]) : ''
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

/** PM = dòng ĐẦU ô "Người phụ trách chính", bỏ nhãn "PM"/dòng "DPM" (= tên đầu tiên). */
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

/** Ngày → ISO yyyy-mm-dd (Date cell hoặc chuỗi dd/mm/yyyy). '' nếu trống/không đọc được. */
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

/* ── Ghi ra sheet trung gian ── */
function writeBridge_(list) {
  var ss = SpreadsheetApp.openById(BRIDGE_SHEET_ID);
  var sh = ss.getSheetByName(BRIDGE_TAB) || ss.insertSheet(BRIDGE_TAB);
  sh.clear();
  var now = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd HH:mm');
  var head = ['STT', 'Tên dự án', 'PM', 'Location', 'Ngày update', 'Đồng bộ lúc'];
  var rows = [head];
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    rows.push([p.stt, p.name, p.pm, p.location, p.update, i === 0 ? now : '']);
  }
  sh.getRange(1, 1, rows.length, head.length).setValues(rows);
}

/* ── tiện ích ── */
function cell_(v) { return v == null ? '' : String(v).trim(); }
function pad2_(x) { x = String(x); return x.length < 2 ? '0' + x : x; }
