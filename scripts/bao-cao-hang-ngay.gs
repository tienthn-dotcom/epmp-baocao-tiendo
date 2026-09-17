/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  BẢNG CHẤM TUÂN THỦ BÁO CÁO HẰNG NGÀY
 *  Quân số · Thi công lắp đặt · Sản lượng
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Dán file này vào Apps Script CỦA FILE "Báo cáo tuân thủ PMP", rồi chạy `taoBangChamNgay`.
 *
 *  NÓ LÀM GÌ
 *  ---------
 *  Tạo (hoặc dựng lại) đúng MỘT tab tên "BC Hằng ngày", khuôn giống hệt tab tuân thủ tuần đang có,
 *  chỉ khác ba điểm:
 *    · mỗi dự án có BA DÒNG — Quân số, Thi công lắp đặt, Sản lượng;
 *    · cột là NGÀY LIÊN TIẾP (01, 02, 03…) thay vì các mốc thứ Tư hằng tuần;
 *    · mức trừ theo khung báo cáo ngày: trễ −2, không báo cáo −5 (khác tuần: −10 / −25).
 *
 *  THÁNG TỰ CHẠY. Cột ngày là CÔNG THỨC neo vào TODAY(), nên sang tháng mới bảng tự nhảy sang
 *  tháng đó, không ai phải sửa. Tháng 28, 30 hay 31 ngày đều tự co giãn: ngày vượt khỏi tháng
 *  hiện hành sẽ tự để trống.
 *
 *  KHÔNG ĐỤNG TAB NÀO KHÁC
 *  -----------------------
 *  Script chỉ ghi vào tab "BC Hằng ngày". Tab "Báo cáo tuân thủ PMP" (bản PDF gửi hằng tuần lấy
 *  từ đó), "AutoData", "LOG_NhacNho", "DATA" đều không bị chạm tới. Danh sách dự án ĐỌC từ
 *  AutoData — đọc thôi, không ghi.
 *
 *  CHẠY LẠI NHIỀU LẦN VÔ HẠI, nhưng xem kỹ mục GIỮ DẤU ĐÃ CHẤM ngay dưới.
 */

// ─── CẤU HÌNH ──────────────────────────────────────────────────────────────────
var BCN_TAB = 'BC Hằng ngày';      // tên tab sẽ tạo
var BCN_NGUON = 'AutoData';        // tab chứa danh sách dự án (chỉ ĐỌC)
var BCN_TRU_TRE = 2;               // trễ: trừ 2
var BCN_TRU_KHONG = 5;             // không báo cáo: trừ 5

/** Ba hạng mục và giờ hạn. Đổi giờ thì sửa ở đây, không sửa chỗ nào khác. */
var BCN_HANG_MUC = [
  { ten: 'Quân số',    han: '09:00', tre: '11:00' },
  { ten: 'TC lắp đặt', han: '17:30', tre: '19:30' },
  { ten: 'Sản lượng',  han: '18:00', tre: '20:00' },
];
// ───────────────────────────────────────────────────────────────────────────────

var BCN_COT_CO_DINH = 11;   // A..K là phần cố định, cột ngày bắt đầu từ L
var BCN_SO_NGAY = 31;       // luôn dựng đủ 31 cột; ngày thừa tự để trống bằng công thức
var BCN_HANG_TIEU_DE = 9;   // khớp đúng tab tuân thủ tuần
var BCN_HANG_DAU = 11;


/** HÀM CHÍNH — tạo hoặc dựng lại bảng chấm. */
function taoBangChamNgay() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var duAn = _bcnDocDuAn(ss);
  if (!duAn.length) {
    Logger.log('KHÔNG đọc được dự án nào từ tab "' + BCN_NGUON + '". Kiểm lại tên tab.');
    return 'Không có dự án.';
  }

  var cu = ss.getSheetByName(BCN_TAB);
  var dauCu = cu ? _bcnLuuDau(cu) : {};        // GIỮ DẤU ĐÃ CHẤM, xem mục dưới
  var sh = cu || ss.insertSheet(BCN_TAB);
  sh.clear();
  sh.clearConditionalFormatRules();

  var soCot = BCN_COT_CO_DINH + BCN_SO_NGAY;
  var soDong = duAn.length * BCN_HANG_MUC.length;

  _bcnDungDauTrang(sh, soCot, duAn.length);
  _bcnDungTieuDe(sh, soCot);
  _bcnDungThanBang(sh, duAn, dauCu);
  _bcnToMau(sh, soDong);
  _bcnDinhDang(sh, soCot, soDong);

  var giuLai = 0;
  for (var k in dauCu) giuLai++;
  Logger.log('Xong. ' + duAn.length + ' dự án × ' + BCN_HANG_MUC.length + ' hạng mục = ' + soDong + ' dòng.'
    + (giuLai ? '  Giữ lại dấu của ' + giuLai + ' dòng đã chấm trước đó.' : ''));
  return 'Đã dựng ' + soDong + ' dòng.';
}


/* ═══════════════ GIỮ DẤU ĐÃ CHẤM ═══════════════
 *
 * Dựng lại bảng mà xoá sạch dấu thì công chấm cả tháng đi tong. Nên trước khi xoá, script chụp lại
 * toàn bộ dấu đang có, khoá theo "tên dự án ‖ hạng mục ‖ NGÀY THẬT" (không phải theo vị trí cột).
 * Dựng xong thì trả dấu về đúng ô của đúng ngày đó.
 *
 * Nhờ khoá theo NGÀY THẬT nên chạy lại vào tháng sau cũng không kéo nhầm dấu tháng trước sang. */
function _bcnLuuDau(sh) {
  var ra = {};
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < BCN_HANG_DAU || lastCol <= BCN_COT_CO_DINH) return ra;

  var ngay = sh.getRange(BCN_HANG_TIEU_DE, BCN_COT_CO_DINH + 1, 1, lastCol - BCN_COT_CO_DINH).getValues()[0];
  var than = sh.getRange(BCN_HANG_DAU, 1, lastRow - BCN_HANG_DAU + 1, lastCol).getValues();

  for (var r = 0; r < than.length; r++) {
    var ten = String(than[r][3] || '').trim();      // D = Tên dự án
    var hm = String(than[r][6] || '').trim();       // G = Hạng mục
    if (!ten || !hm) continue;
    for (var c = 0; c < ngay.length; c++) {
      var dau = String(than[r][BCN_COT_CO_DINH + c] || '').trim();
      if (!dau) continue;
      var d = _bcnNgayISO(ngay[c]);
      if (!d) continue;
      ra[_bcnKhoa(ten, hm, d)] = dau;
    }
  }
  return ra;
}

function _bcnNgayISO(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return '';
}


/* ═══════════════ ĐỌC DANH SÁCH DỰ ÁN ═══════════════
 * Lấy từ AutoData để dùng CHUNG một nguồn với báo cáo tuần — hai bảng không bao giờ lệch danh sách.
 * Cột: A STT · B Tên dự án · C PM · D Location · F KEY */
function _bcnDocDuAn(ss) {
  var sh = ss.getSheetByName(BCN_NGUON);
  if (!sh) return [];
  var n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  var v = sh.getRange(2, 1, n, 6).getValues();
  var ra = [], thay = {};
  for (var i = 0; i < v.length; i++) {
    var ten = String(v[i][1] || '').trim();
    if (!ten) continue;
    var khoa = String(v[i][5] || '').trim();
    if (thay[ten]) continue;                       // trùng tên thì giữ dòng đầu
    thay[ten] = true;
    ra.push({ ten: ten, pm: String(v[i][2] || '').trim(), vung: String(v[i][3] || '').trim(), khoa: khoa });
  }
  return ra;
}


/* ═══════════════ ĐẦU TRANG ═══════════════ */
function _bcnDungDauTrang(sh, soCot, soDuAn) {
  sh.getRange(3, 1, 1, soCot).merge();
  sh.getRange(3, 1).setValue('BÁO CÁO TUÂN THỦ BÁO CÁO HẰNG NGÀY')
    .setFontSize(16).setFontWeight('bold').setFontColor('#ffffff')
    .setBackground('#1e3a5f').setVerticalAlignment('middle');
  sh.setRowHeight(3, 28);

  sh.getRange(5, 1).setValue('Tổng hợp bởi:').setFontWeight('bold');
  sh.getRange(5, 3).setValue('Bộ phận Project Planning');

  // NGÀY HÔM NAY ngay trên đầu báo cáo — nhìn là biết bản này còn mới hay đã cũ.
  sh.getRange(6, 1).setValue('Ngày cập nhật:').setFontWeight('bold');
  sh.getRange(6, 3).setFormula('=TODAY()').setNumberFormat('dd/mm/yyyy')
    .setFontWeight('bold').setFontColor('#c00000');

  sh.getRange(7, 1).setValue('Tháng chấm:').setFontWeight('bold');
  sh.getRange(7, 3).setFormula('=TEXT(TODAY(),"mm/yyyy")').setFontWeight('bold');

  sh.getRange(5, 5).setValue('Tiêu chí chấm điểm').setFontWeight('bold');
  sh.getRange(5, 7).setValue('(1) Khởi điểm 100 điểm mỗi hạng mục, trừ dần, sàn 0');
  sh.getRange(6, 7).setValue('(2) Nộp trong 120 phút sau hạn: TRỄ, trừ ' + BCN_TRU_TRE + ' điểm');
  sh.getRange(7, 7).setValue('(3) Quá cửa sổ trễ hoặc không nộp: trừ ' + BCN_TRU_KHONG + ' điểm');

  // Chú giải ký hiệu, đặt cuối phần cố định cho khỏi đè chữ tiêu chí.
  var cChu = BCN_COT_CO_DINH - 1;
  var chu = [['✓', 'Nộp đúng hạn'], ['o', 'Nộp trễ'], ['x', 'Không nộp'], ['', 'Ô trống: ngày không chấm']];
  for (var i = 0; i < chu.length; i++) {
    sh.getRange(5 + i, cChu).setValue(chu[i][0]).setHorizontalAlignment('center').setFontWeight('bold');
    sh.getRange(5 + i, cChu + 1).setValue(chu[i][1]).setFontSize(9);
  }

  sh.getRange(8, 1).setValue(soDuAn + ' dự án · 3 hạng mục · giờ hạn: Quân số '
    + BCN_HANG_MUC[0].han + ' · TC lắp đặt ' + BCN_HANG_MUC[1].han + ' · Sản lượng ' + BCN_HANG_MUC[2].han)
    .setFontSize(9).setFontColor('#5a6b7b');
}


/* ═══════════════ HÀNG TIÊU ĐỀ ═══════════════ */
function _bcnDungTieuDe(sh, soCot) {
  var r = BCN_HANG_TIEU_DE;
  var ten = ['Location', 'STT', 'KEY', 'Tên dự án', 'Người phụ trách', 'Email',
             'Hạng mục', 'Giờ hạn', 'Lũy kế không báo cáo', 'Điểm tuân thủ', 'Xếp loại'];
  sh.getRange(r, 1, 1, ten.length).setValues([ten]);

  /* CỘT NGÀY LÀ CÔNG THỨC, KHÔNG PHẢI NGÀY CHẾT.
     Ô đầu neo vào TODAY() nên sang tháng là cả dải tự nhảy theo, không ai phải sửa tay.
     Từ ô thứ hai trở đi: chỉ lấy ngày kế tiếp NẾU vẫn còn trong tháng hiện hành, hết tháng thì
     để trống. Nhờ vậy tháng 28, 30 hay 31 ngày đều tự co giãn. */
  var c1 = BCN_COT_CO_DINH + 1;
  sh.getRange(r, c1).setFormula('=EOMONTH(TODAY(),-1)+1');
  for (var i = 1; i < BCN_SO_NGAY; i++) {
    var truoc = _bcnA1(r, BCN_COT_CO_DINH + i);
    sh.getRange(r, BCN_COT_CO_DINH + 1 + i)
      .setFormula('=IF(' + truoc + '="","",IF(MONTH(' + truoc + '+1)=MONTH($'
        + _bcnCotChu(c1) + '$' + r + '),' + truoc + '+1,""))');
  }
  sh.getRange(r, c1, 1, BCN_SO_NGAY).setNumberFormat('dd');

  sh.getRange(r, 1, 1, soCot)
    .setBackground('#1e3a5f').setFontColor('#ffffff').setFontWeight('bold')
    .setFontSize(9).setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setWrap(true);
  sh.setRowHeight(r, 34);
}


/* ═══════════════ THÂN BẢNG ═══════════════ */
function _bcnDungThanBang(sh, duAn, dauCu) {
  var soDong = duAn.length * BCN_HANG_MUC.length;
  var giaTri = [], congThuc = [];

  for (var i = 0; i < duAn.length; i++) {
    var p = duAn[i];
    for (var k = 0; k < BCN_HANG_MUC.length; k++) {
      var hm = BCN_HANG_MUC[k];
      var r = BCN_HANG_DAU + giaTri.length;
      var d1 = _bcnA1(r, BCN_COT_CO_DINH + 1);
      var d2 = _bcnA1(r, BCN_COT_CO_DINH + BCN_SO_NGAY);
      var oLuyKe = _bcnA1(r, 9), oDiem = _bcnA1(r, 10);

      // Cột A..F chỉ ghi ở DÒNG ĐẦU của mỗi dự án, ba dòng sau đó gộp ô lại cho dễ đọc.
      giaTri.push([
        k === 0 ? p.vung : '', k === 0 ? (i + 1) : '', k === 0 ? p.khoa : '',
        k === 0 ? p.ten : '', k === 0 ? p.pm : '', '',
        hm.ten, hm.han + ' → ' + hm.tre, '', '', '',
      ]);

      congThuc.push([
        // Email tra từ tab DATA, y hệt cách báo cáo tuần đang làm.
        k === 0 ? '=IFERROR(VLOOKUP(' + _bcnA1(r, 5) + ',DATA!$A$4:$B$100,2,FALSE),"")' : '',
        '=COUNTIF(' + d1 + ':' + d2 + ',"x")',
        // CHƯA chấm được ngày nào thì để TRỐNG, không cho 100 điểm — chưa có dữ liệu mà cho điểm
        // tuyệt đối là báo cáo sai sự thật.
        '=IF(COUNTA(' + d1 + ':' + d2 + ')=0,"",MAX(0,100-' + BCN_TRU_TRE + '*COUNTIF(' + d1 + ':' + d2
          + ',"o")-' + BCN_TRU_KHONG + '*' + oLuyKe + '))',
        '=IF(' + oDiem + '="","",IF(' + oDiem + '>=95,"A",IF(' + oDiem + '>=85,"B",IF(' + oDiem + '>=70,"C","D"))))',
      ]);

    }
  }

  sh.getRange(BCN_HANG_DAU, 1, soDong, 11).setValues(giaTri);
  for (var j = 0; j < congThuc.length; j++) {
    var rr = BCN_HANG_DAU + j;
    if (congThuc[j][0]) sh.getRange(rr, 6).setFormula(congThuc[j][0]);
    sh.getRange(rr, 9).setFormula(congThuc[j][1]);
    sh.getRange(rr, 10).setFormula(congThuc[j][2]);
    sh.getRange(rr, 11).setFormula(congThuc[j][3]);
  }

  // Gộp ô A..F cho ba dòng của mỗi dự án.
  for (var m = 0; m < duAn.length; m++) {
    var r0 = BCN_HANG_DAU + m * BCN_HANG_MUC.length;
    for (var c2 = 1; c2 <= 6; c2++) sh.getRange(r0, c2, BCN_HANG_MUC.length, 1).merge();
  }

  // Trả dấu cũ về đúng ô.
  _bcnTraDau(sh, duAn, dauCu);
}

function _bcnTraDau(sh, duAn, dauCu) {
  var co = false;
  for (var k in dauCu) { co = true; break; }
  if (!co) return;

  var ngay = sh.getRange(BCN_HANG_TIEU_DE, BCN_COT_CO_DINH + 1, 1, BCN_SO_NGAY).getValues()[0];
  for (var i = 0; i < duAn.length; i++) {
    for (var h = 0; h < BCN_HANG_MUC.length; h++) {
      var r = BCN_HANG_DAU + i * BCN_HANG_MUC.length + h;
      for (var c = 0; c < BCN_SO_NGAY; c++) {
        var d = _bcnNgayISO(ngay[c]);
        if (!d) continue;
        var v = dauCu[_bcnKhoa(duAn[i].ten, BCN_HANG_MUC[h].ten, d)];
        if (v) sh.getRange(r, BCN_COT_CO_DINH + 1 + c).setValue(v);
      }
    }
  }
}


/* ═══════════════ MÀU VÀ RÀNG BUỘC ═══════════════ */
function _bcnToMau(sh, soDong) {
  var c1 = BCN_COT_CO_DINH + 1;
  var vungNgay = sh.getRange(BCN_HANG_DAU, c1, soDong, BCN_SO_NGAY);
  var vungLoai = sh.getRange(BCN_HANG_DAU, 11, soDong, 1);
  var r = [];

  // Cuối tuần: tô xám cả cột để mắt tự bỏ qua. Neo theo hàng tiêu đề nên tháng đổi là màu đổi theo.
  var oNgay = _bcnCotChu(c1) + '$' + BCN_HANG_TIEU_DE;
  r.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(' + oNgay + '<>"",WEEKDAY(' + oNgay + ',2)>5)')
    .setBackground('#eceff1').setRanges([vungNgay]).build());

  r.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('x')
    .setBackground('#f8d7da').setFontColor('#c00000').setBold(true).setRanges([vungNgay]).build());
  r.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('o')
    .setBackground('#fff0d4').setFontColor('#9a6400').setBold(true).setRanges([vungNgay]).build());
  r.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('✓')
    .setFontColor('#1e7b3e').setRanges([vungNgay]).build());

  var loai = [['A', '#c6e7c6', '#1e7b3e'], ['B', '#d9ead3', '#1e7b3e'],
              ['C', '#fde9cf', '#9a6400'], ['D', '#f8d7da', '#c00000']];
  for (var i = 0; i < loai.length; i++) {
    r.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(loai[i][0])
      .setBackground(loai[i][1]).setFontColor(loai[i][2]).setBold(true).setRanges([vungLoai]).build());
  }
  sh.setConditionalFormatRules(r);

  // Ô ngày chỉ nhận đúng ba ký hiệu — gõ bậy là Sheets chặn ngay, khỏi sai rồi mới phát hiện.
  vungNgay.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['✓', 'o', 'x'], true)
    .setAllowInvalid(false)
    .setHelpText('Chỉ nhận ✓ (đúng hạn), o (trễ) hoặc x (không nộp). Để trống nghĩa là ngày không chấm.')
    .build());
}

function _bcnDinhDang(sh, soCot, soDong) {
  sh.setFrozenRows(BCN_HANG_TIEU_DE);
  sh.setFrozenColumns(8);                       // khoá tới cột "Giờ hạn"
  sh.hideColumns(3);                            // cột KEY chỉ để tra, không cần nhìn

  var rong = [70, 42, 120, 260, 170, 200, 92, 96, 62, 62, 62];
  for (var i = 0; i < rong.length; i++) sh.setColumnWidth(i + 1, rong[i]);
  for (var c = BCN_COT_CO_DINH + 1; c <= soCot; c++) sh.setColumnWidth(c, 30);

  var than = sh.getRange(BCN_HANG_DAU, 1, soDong, soCot);
  than.setFontSize(9).setVerticalAlignment('middle')
    .setBorder(true, true, true, true, true, true, '#bfc7cf', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(BCN_HANG_DAU, 7, soDong, soCot - 6).setHorizontalAlignment('center');
  sh.getRange(BCN_HANG_DAU, 10, soDong, 2).setFontWeight('bold').setFontSize(10);
  sh.getRange(BCN_HANG_DAU, 7, soDong, 1).setFontWeight('bold').setFontColor('#1e3a5f');
  sh.getRange(BCN_HANG_DAU, 8, soDong, 1).setFontSize(8).setFontColor('#5a6b7b');
}


/* ═══════════════ PHỤ ═══════════════ */
/** Kho� nh� d�u: t�n d� �n + h�ng m�c + ng�y. D�ng k� t� NUL l�m d�u ph�n t�ch v� n� KH�NG BAO GI�
 *  xu�t hi�n trong t�n d� �n, n�n kh�ng c� c�a n�o hai d�ng kh�c nhau �ng chung m�t kho�.
 *  Vi�t b�ng String.fromCharCode(0) ch� KH�NG nh�ng k� t� � th�ng v�o m�: nh�ng th�ng th� l�c d�n
 *  v�o tr�nh so�n Apps Script n� b� nu�t m�t, v� hai ch� d�ng kho� s� l�ch nhau trong im l�ng. */
function _bcnKhoa(ten, hangMuc, ngayISO) {
  var nul = String.fromCharCode(0);
  return ten + nul + hangMuc + nul + ngayISO;
}

function _bcnCotChu(c) {
  var s = '';
  while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; }
  return s;
}
function _bcnA1(r, c) { return _bcnCotChu(c) + r; }


/** Đặt lịch dựng lại bảng vào 00:05 ngày 1 hằng tháng, để tháng mới có bảng mới sẵn sàng.
 *  Gọi tay MỘT LẦN là xong. Dấu của tháng cũ vẫn được giữ theo ngày thật nên không mất gì. */
function datLichHangThang() {
  var cu = ScriptApp.getProjectTriggers();
  for (var i = 0; i < cu.length; i++) {
    if (cu[i].getHandlerFunction() === 'taoBangChamNgay') ScriptApp.deleteTrigger(cu[i]);
  }
  ScriptApp.newTrigger('taoBangChamNgay').timeBased().onMonthDay(1).atHour(0).create();
  return 'Đã đặt lịch: dựng lại bảng vào ngày 1 hằng tháng.';
}
