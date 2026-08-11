/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  BÁO CÁO TỔNG HỢP LẮP ĐẶT — gom "Summary" (khu PHÒNG) + "Public Summary" (khu PUBLIC)
 *  của mọi file matrix về 1 sheet tổng hợp.
 * ═══════════════════════════════════════════════════════════════════════════
 *  DÁN vào Apps Script GẮN VỚI SHEET TỔNG HỢP (mở sheet tổng hợp → Extensions → Apps Script).
 *  Chạy hàm `buildAggregateReport`.
 *
 *  2 LOẠI TAB NGUỒN (mỗi file dự án thường có cả hai):
 *   • "Summary"        = khu PHÒNG — MA TRẬN (block × cột %: Mặt bằng/giao thô/tinh/defect/đã giao).
 *                        Lấy % mỗi BLOCK (ưu tiên cột "đã giao", không thì cột % cuối).
 *   • "Public Summary" = khu PUBLIC — BẢNG theo khu (STT/Khu/Bắt đầu/Bàn giao/% thực tế/cảnh báo…).
 *
 *  LÀM GÌ:
 *   1. Mở PMP master (Timeline) → quét ô chữ "Thi công lắp đặt" CÓ HYPERLINK → danh sách file + maCT.
 *   2. Mỗi FILE (gộp trùng — 1 file nhiều dự án đọc 1 lần): mở, đọc tab Summary + Public Summary.
 *   3. Ghi 2 tab: "Tổng hợp" (1 dòng/file) + "Chi tiết theo khu" (mỗi khu/block 1 dòng, cột "Loại"
 *      = Phòng/Public). File thiếu tab nào → liệt kê ở cuối "Tổng hợp" để chuẩn hoá.
 *
 *  AN TOÀN: AGG_DRY_RUN = true → CHỈ ghi Execution log, KHÔNG đụng sheet. Xem log ổn rồi đổi false.
 *  QUYỀN: tài khoản chạy phải MỞ ĐƯỢC các file matrix (kể cả private) — chạy bằng tài khoản anh.
 */

// ─── CẤU HÌNH ───
var AGG_DRY_RUN   = true;                                       // <<< true = chạy thử; false = ghi thật
var MASTER_ID     = '1hx8yzpoQio4yla3jmooni5cu1g9-M7tu';        // PMP master (Timeline)
var MASTER_TAB    = 'Timeline';
var LINK_TEXT_RE  = /thi\s*c[ôo]ng\s*l[ắa]p/i;                  // chữ trong ô hyperlink
var PS_TAB_RE     = /public\s*summary/i;                        // tab khu PUBLIC
var SUM_TAB_RE    = /^\s*summary\s*$/i;                         // tab khu PHÒNG ("Summary", KHÔNG phải Public)
var TAB_SUMMARY   = 'Tổng hợp';
var TAB_DETAIL    = 'Chi tiết theo khu';

/** HÀM CHÍNH. */
function buildAggregateReport() {
  var links = agExtractLinks_();
  Logger.log('Tìm thấy ' + links.length + ' hyperlink "Thi công lắp đặt".');
  if (!links.length) { Logger.log('KHÔNG có link — kiểm tra MASTER_ID/MASTER_TAB/chữ ô.'); return; }

  var byFile = {};
  links.forEach(function (l) {
    if (!byFile[l.fileId]) byFile[l.fileId] = {};
    if (l.maCT) byFile[l.fileId][l.maCT] = true;
  });
  var fileIds = Object.keys(byFile);
  Logger.log('Số FILE matrix (gộp trùng): ' + fileIds.length);

  var summaryRows = [], detailRows = [], missing = [];

  fileIds.forEach(function (fid) {
    var maCTs = Object.keys(byFile[fid]).join(', ');
    var url = 'https://docs.google.com/spreadsheets/d/' + fid + '/edit';
    var ss;
    try { ss = SpreadsheetApp.openById(fid); }
    catch (e) { Logger.log('  ✗ MỞ LỖI ' + fid + ' (' + maCTs + '): ' + e); missing.push([maCTs, '(không mở được — quyền?)', 'cả hai', url]); return; }

    var psSheet = null, sumSheet = null, names = [];
    ss.getSheets().forEach(function (s) {
      var nm = s.getName(); names.push(nm);
      if (!psSheet && PS_TAB_RE.test(nm)) psSheet = s;
      if (!sumSheet && SUM_TAB_RE.test(nm)) sumSheet = s;
    });

    // ── PUBLIC (Public Summary) ──
    var proj = '', pubN = 0, pubAvg = '', warnN = 0, maxDl = '', repDate = '';
    if (psSheet) {
      var ps = agReadPublicSummary_(psSheet);
      if (ps && ps.rows.length) {
        proj = ps.title || ss.getName(); repDate = ps.repDate || '';
        pubN = ps.rows.length;
        var acts = ps.rows.map(function (r) { return r.actual; }).filter(function (v) { return v != null; });
        pubAvg = acts.length ? Math.round(acts.reduce(function (a, b) { return a + b; }, 0) / acts.length * 100) + '%' : '';
        warnN = ps.rows.filter(function (r) { return /chậm|báo động/i.test(r.warn); }).length;
        maxDl = ps.rows.map(function (r) { return r.deadline; }).filter(Boolean).sort().slice(-1)[0] || '';
        ps.rows.forEach(function (r) {
          detailRows.push(['Public', proj, r.stt, r.khu, r.start, r.deadline,
            r.actual == null ? '' : Math.round(r.actual * 100) + '%',
            r.today == null ? '' : (r.today * 100).toFixed(2) + '%', r.warn,
            r.diff == null ? '' : Math.round(r.diff * 100) + '%']);
        });
      }
    }

    // ── PHÒNG (Summary matrix) ──
    var roomN = 0, roomAvg = '';
    if (sumSheet) {
      var sm = agReadSummaryMatrix_(sumSheet);
      if (sm && sm.blocks.length) {
        if (!proj) proj = ss.getName();
        var mains = sm.blocks.map(function (b) { return b.main; }).filter(function (v) { return v != null; });
        roomN = sm.blocks.length;
        roomAvg = mains.length ? Math.round(mains.reduce(function (a, b) { return a + b; }, 0) / mains.length * 100) + '%' : '';
        sm.blocks.forEach(function (b) {
          detailRows.push(['Phòng', proj || ss.getName(), '', b.label, '', '',
            b.main == null ? '' : Math.round(b.main * 100) + '%', '', '', '']);
        });
      }
    }

    // ── thiếu tab nào? ──
    var lack = [];
    if (!psSheet) lack.push('Public Summary');
    if (!sumSheet) lack.push('Summary(phòng)');
    if (lack.length) { Logger.log('  – ' + maCTs + ' [' + ss.getName() + '] THIẾU: ' + lack.join(' + ') + '. Tabs: ' + names.join(' | ')); missing.push([maCTs, ss.getName(), lack.join(' + '), url]); }

    if (psSheet || sumSheet) {
      summaryRows.push([proj || ss.getName(), maCTs, pubAvg, pubN, roomAvg, roomN, warnN, maxDl, repDate, url]);
      Logger.log('  ✓ ' + maCTs + ' [' + (proj || ss.getName()) + '] Public ' + pubN + ' khu (' + pubAvg + ') · Phòng ' + roomN + ' block (' + roomAvg + ')');
    }
  });

  Logger.log('TỔNG: ' + summaryRows.length + ' file · ' + detailRows.length + ' dòng chi tiết · ' + missing.length + ' file thiếu tab.');
  if (AGG_DRY_RUN) { Logger.log('*** AGG_DRY_RUN: chưa ghi sheet. Đổi AGG_DRY_RUN=false để ghi thật. ***'); return; }
  agWriteTabs_(summaryRows, detailRows, missing);
  Logger.log('Đã ghi 2 tab vào sheet tổng hợp.');
}

/* ── 1) Quét master Timeline lấy hyperlink "Thi công lắp đặt" ── */
function agExtractLinks_() {
  var sh = SpreadsheetApp.openById(MASTER_ID).getSheetByName(MASTER_TAB);
  if (!sh) throw new Error('Không thấy tab "' + MASTER_TAB + '" trong master.');
  var rng = sh.getDataRange(), rich = rng.getRichTextValues(), vals = rng.getValues();
  var out = [], curMaCT = '';
  for (var r = 0; r < vals.length; r++) {
    for (var cc = 0; cc < Math.min(13, vals[r].length); cc++) {
      var v = String(vals[r][cc] == null ? '' : vals[r][cc]).trim();
      if (/^CT\d{2}-\d/.test(v)) { curMaCT = v.match(/^CT\d{2}-\d[\w.\-]*/)[0]; break; }
    }
    for (var c = 0; c < rich[r].length; c++) {
      var rt = rich[r][c]; if (!rt) continue;
      if (!LINK_TEXT_RE.test(String(vals[r][c] == null ? '' : vals[r][c]))) continue;
      var url = rt.getLinkUrl();
      if (!url) { var runs = rt.getRuns(); for (var i = 0; i < runs.length && !url; i++) url = runs[i].getLinkUrl(); }
      if (!url || !/spreadsheets\/d\//.test(url)) continue;
      var fid = (url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
      if (fid) out.push({ maCT: curMaCT, fileId: fid, row: r + 1 });
    }
  }
  return out;
}

/* ── 2a) Đọc Public Summary (bảng khu public) ── */
function agReadPublicSummary_(sh) {
  var vals = sh.getDataRange().getValues(); if (!vals.length) return null;
  var S = function (v) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); };
  var title = S(vals[0][0]), repDate = '';
  for (var r0 = 0; r0 < Math.min(4, vals.length); r0++)
    for (var c0 = 0; c0 < vals[r0].length; c0++)
      if (/ngày báo cáo/i.test(S(vals[r0][c0]))) { repDate = agDate_(vals[r0][c0 + 1]); break; }
  var hr = -1;
  for (var r = 0; r < Math.min(8, vals.length); r++) {
    var j = vals[r].map(function (x) { return S(x).toLowerCase(); }).join(' | ');
    if (/(các khu|\| khu )/.test(j) && /thực tế/.test(j)) { hr = r; break; }
  }
  if (hr < 0) return { title: title, repDate: repDate, rows: [] };
  var find = function (re) { for (var c = 0; c < vals[hr].length; c++) if (re.test(S(vals[hr][c]).toLowerCase())) return c; return -1; };
  var cStt = find(/số thứ tự|^stt/), cKhu = find(/các khu|^khu$/), cStart = find(/bắt đầu/), cDl = find(/bàn giao/),
      cAct = find(/thực tế/), cDiff = find(/chênh lệch/), cWarn = find(/cảnh báo/), cToday = find(/tăng thêm/);
  if (cKhu < 0) cKhu = 1;
  var rows = [];
  for (var rr = hr + 1; rr < vals.length; rr++) {
    var khu = S(vals[rr][cKhu]); if (!khu) break;
    rows.push({ stt: S(vals[rr][cStt >= 0 ? cStt : 0]), khu: khu,
      start: agDate_(vals[rr][cStart]), deadline: agDate_(vals[rr][cDl]),
      actual: agFrac_(vals[rr][cAct]), today: agFrac_(vals[rr][cToday]),
      diff: agFrac_(vals[rr][cDiff]), warn: S(vals[rr][cWarn]) });
  }
  return { title: title, repDate: repDate, rows: rows };
}

/* ── 2b) Đọc Summary matrix (khu phòng) → % mỗi block (bám cấu trúc như summary-render) ── */
function agReadSummaryMatrix_(sh) {
  var vals = sh.getDataRange().getValues(); if (!vals.length) return { blocks: [] };
  var S = function (v) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); };
  // Cột legend (ô "Màu") → chặn bên phải để block không đụng legend.
  var legCol = -1;
  for (var r = 0; r < Math.min(20, vals.length) && legCol < 0; r++)
    for (var c = 0; c < vals[r].length; c++)
      if (S(vals[r][c]).toLowerCase() === 'màu') { legCol = c; break; }
  var bound = legCol >= 0 ? legCol : (vals[0] ? vals[0].length : 0);
  var isHdr = function (rr) { var a = false, b = false; for (var c = 0; c < bound; c++) { var v = S(vals[rr][c]); if (v === '01') a = true; else if (v === '02') b = true; } return a && b; };
  var hdrs = []; for (var r2 = 0; r2 < vals.length; r2++) if (isHdr(r2)) hdrs.push(r2);
  var blocks = [];
  hdrs.forEach(function (hr, bi) {
    var label = S(vals[hr][0]) || ('Block ' + (bi + 1));
    var unitCols = [], pctCols = [];
    for (var c = 1; c < bound; c++) {
      var h = S(vals[hr][c]);
      if (!h) { if (pctCols.length || unitCols.length) break; else continue; }
      if (/^\d{1,3}$/.test(h) || /^hl$/i.test(h)) unitCols.push(c);
      else if (unitCols.length && /mặt\s*bằng|giao\s*th[ôo]|tinh|defect|xo[áa]|đã\s*giao|%/i.test(h)) pctCols.push({ c: c, label: h });
      else if (unitCols.length) break;
    }
    var next = bi + 1 < hdrs.length ? hdrs[bi + 1] : vals.length;
    var dataRows = []; for (var r3 = hr + 1; r3 < next; r3++) { if (!S(vals[r3][0])) break; dataRows.push(r3); }
    var pctVal = function (c) { for (var i = 0; i < dataRows.length; i++) { var v = vals[dataRows[i]][c]; if (typeof v === 'number' && v >= 0 && v <= 1) return v; } return null; };
    var pcts = pctCols.map(function (p) { return { label: p.label, value: pctVal(p.c) }; }).filter(function (x) { return x.value != null; });
    var main = null;
    for (var k = 0; k < pcts.length; k++) if (/đã\s*giao/i.test(pcts[k].label)) main = pcts[k].value;
    if (main == null && pcts.length) main = pcts[pcts.length - 1].value;
    blocks.push({ label: label, pcts: pcts, main: main });
  });
  return { blocks: blocks };
}

/* ── 3) Ghi 2 tab ── */
function agWriteTabs_(summaryRows, detailRows, missing) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s1 = ss.getSheetByName(TAB_SUMMARY) || ss.insertSheet(TAB_SUMMARY); s1.clear();
  var h1 = ['Dự án', 'Mã CT', '% TB Public', 'Số khu Public', '% TB Phòng', 'Số block Phòng', 'Số khu cảnh báo', 'Bàn giao xa nhất', 'Ngày báo cáo', 'Link file'];
  s1.getRange(1, 1, 1, h1.length).setValues([h1]).setFontWeight('bold').setBackground('#1f3b63').setFontColor('#ffffff');
  if (summaryRows.length) s1.getRange(2, 1, summaryRows.length, h1.length).setValues(summaryRows);
  var mr = summaryRows.length + 3;
  s1.getRange(mr, 1).setValue('THIẾU TAB (cần bổ sung để gom đủ):').setFontWeight('bold').setFontColor('#b91c1c');
  var h2 = ['Mã CT', 'Tên file', 'Thiếu', 'Link file'];
  s1.getRange(mr + 1, 1, 1, h2.length).setValues([h2]).setFontWeight('bold').setBackground('#fde2e2');
  if (missing.length) s1.getRange(mr + 2, 1, missing.length, h2.length).setValues(missing);
  s1.setFrozenRows(1); s1.autoResizeColumns(1, h1.length);

  var s2 = ss.getSheetByName(TAB_DETAIL) || ss.insertSheet(TAB_DETAIL); s2.clear();
  var h3 = ['Loại', 'Dự án', 'STT', 'Khu / Block', 'Ngày bắt đầu', 'Ngày bàn giao', '% thực tế', '% tăng thêm', 'Cảnh báo', 'Chênh lệch'];
  s2.getRange(1, 1, 1, h3.length).setValues([h3]).setFontWeight('bold').setBackground('#1f3b63').setFontColor('#ffffff');
  if (detailRows.length) s2.getRange(2, 1, detailRows.length, h3.length).setValues(detailRows);
  s2.setFrozenRows(1); s2.autoResizeColumns(1, h3.length);
}

/* ── tiện ích ── */
function agFrac_(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.abs(v) > 1.5 ? v / 100 : v;
  var s = String(v).replace(/[%\s]/g, '').replace(',', '.');
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  var n = parseFloat(s); return Math.abs(n) > 1.5 ? n / 100 : n;
}
function agDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime()))
    return ('0' + v.getDate()).slice(-2) + '/' + ('0' + (v.getMonth() + 1)).slice(-2) + '/' + v.getFullYear();
  var s = v == null ? '' : String(v).trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ('0' + m[3]).slice(-2) + '/' + ('0' + m[2]).slice(-2) + '/' + m[1];
  return s;
}
