/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TỰ DỰNG PDF BÁO CÁO TUÂN THỦ → GOOGLE DRIVE (không cần ai bật máy)
 * ═══════════════════════════════════════════════════════════════════════════
 *  Dán THÊM file này vào Apps Script của LINK1 (file báo cáo tuân thủ), để cạnh
 *  file gộp đang chạy. KHÔNG phải sửa gì trong file cũ.
 *
 *  VÌ SAO CẦN: PDF trên app dựng bằng cách chụp lại giao diện trong trình duyệt —
 *  máy tắt là không ai dựng được. Còn bảng tuân thủ vốn nằm ngay trong Sheet này,
 *  nên Apps Script tự xuất PDF được, chạy trên máy chủ Google, máy ai tắt cũng kệ.
 *
 *  CHẠY LÚC NÀO: bám theo lượt MỖI GIỜ sẵn có. Mỗi lượt làm đúng thứ tự
 *      chấm ✔/o/x  →  dựng PDF  →  ghi đè vào Drive
 *  nên thư mục đích lúc nào cũng có bản không quá một giờ tuổi. Tới giờ trigger
 *  gửi mail chạy, file mới nhất đã nằm sẵn ở đó — không phải canh giờ với nhau.
 *
 *  GHI ĐÈ theo NGÀY: mỗi ngày đúng một file "BaoCaoTuanThu_MP_<ngày>.pdf", chạy lại
 *  trong ngày thì thay bản cũ. Chỗ gửi mail cứ lấy PDF mới nhất là đúng bài.
 *
 *  CÀI 1 LẦN:
 *    1) Dán file này vào Apps Script của LINK1.
 *    2) Chạy `autoPdfDryRun` → xem Execution log, kiểm tên file + thư mục đích.
 *    3) Chạy `setupHourlyTriggerWithPdf` một lần → từ đó mỗi giờ tự chấm + tự dựng PDF.
 *       (Hàm này thay luôn lịch cũ, không để hai lịch chạy trùng.)
 */

// ─── CẤU HÌNH ────────────────────────────────────────────────────────────────
/** Thư mục Drive: Data Source › DATABASE › ePMP › Báo cáo tuân thủ (app cũng lưu vào đây). */
var PDF_FOLDER_ID = '1eaWbpc4wQUCCmC3mSmhZ0dpPqH3oZZHm';
/** Đặt tên GIỐNG HỆT bản app xuất tay, để chỗ gửi mail "lấy PDF mới nhất" không phải sửa gì. */
var PDF_NAME_PREFIX = 'BaoCaoTuanThu_MP_';
// ─────────────────────────────────────────────────────────────────────────────


/** VIỆC MỖI GIỜ: chấm điểm xong mới dựng PDF. Trigger trỏ vào hàm này. */
function runComplianceReportWithPdf() {
  // 1) Chấm ✔/o/x + đồng bộ dự án — dùng lại y nguyên hàm của file gộp, không viết lại logic.
  try {
    runComplianceReport();
  } catch (e) {
    // Chấm hỏng thì VẪN dựng PDF từ số đang có: thà thư mục có bản hôm nay còn hơn để trống,
    // vì bên gửi mail chỉ biết lấy file mới nhất chứ không biết hôm nay chấm có trục trặc.
    Logger.log('runComplianceReport lỗi (vẫn dựng PDF từ số hiện có): ' + e);
  }
  // 2) Dựng PDF + ghi Drive.
  try {
    var f = exportCompliancePdfToDrive_(false);
    Logger.log('Đã ghi Drive: ' + f.getName() + ' · ' + Math.round(f.getSize() / 1024) + 'KB');
  } catch (e2) {
    // Dựng PDF hỏng KHÔNG được làm hỏng luôn việc chấm điểm ở trên (đã ghi bảng xong rồi).
    Logger.log('DỰNG PDF LỖI: ' + e2);
  }
}


/** Chạy thử: chỉ log, KHÔNG ghi Drive. Dùng để soi tên file + thư mục trước khi bật lịch. */
function autoPdfDryRun() {
  exportCompliancePdfToDrive_(true);
}


/**
 * Xuất tab báo cáo → PDF → ghi vào thư mục Drive.
 * Trùng tên (chạy lại trong cùng ngày) thì bỏ bản cũ, giữ đúng MỘT file mỗi ngày — chỗ
 * "lấy PDF mới nhất" không bao giờ vớ nhầm bản cũ hơn.
 */
function exportCompliancePdfToDrive_(dryRun) {
  var ss = SpreadsheetApp.openById(BRIDGE_SHEET_ID);
  var sh = ss.getSheetByName(REPORT_SHEET);
  if (!sh) throw new Error('Không thấy sheet "' + REPORT_SHEET + '".');

  var tz = ss.getSpreadsheetTimeZone();
  var name = PDF_NAME_PREFIX + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd') + '.pdf';

  // Khổ NGANG, vừa bề ngang, bỏ lưới và mấy thứ Google chèn thêm. Chỉ xuất đúng tab báo cáo
  // (gid), và chỉ các cột đang HIỆN — file gộp đã ẩn sẵn cột của tháng khác.
  var url = 'https://docs.google.com/spreadsheets/d/' + BRIDGE_SHEET_ID + '/export'
    + '?format=pdf'
    + '&gid=' + sh.getSheetId()
    + '&portrait=false'      // khổ ngang
    + '&size=A3'             // bảng nhiều cột tuần — A3 cho chữ khỏi bị ép quá nhỏ
    + '&scale=4'             // 4 = vừa bề ngang trang
    + '&fitw=true'
    + '&gridlines=false'
    + '&printtitle=false'
    + '&sheetnames=false'
    + '&pagenumbers=false'
    + '&attachment=true'
    + '&top_margin=0.30&bottom_margin=0.30&left_margin=0.30&right_margin=0.30';

  Logger.log('Xuất PDF: ' + name + ' ← tab "' + REPORT_SHEET + '" (gid ' + sh.getSheetId() + ')');
  if (dryRun) {
    var folderDry = DriveApp.getFolderById(PDF_FOLDER_ID);
    Logger.log('*** DRY RUN — không ghi. Thư mục đích: ' + folderDry.getName() + ' (' + PDF_FOLDER_ID + ')');
    return null;
  }

  var res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Google trả lỗi ' + res.getResponseCode() + ' khi xuất PDF: ' + res.getContentText().slice(0, 200));
  }

  var folder = DriveApp.getFolderById(PDF_FOLDER_ID);
  // Ghi bản mới TRƯỚC, xoá bản cũ SAU: nếu đúng lúc này bên gửi mail đang quét thư mục thì nó
  // vẫn thấy một file hợp lệ, không bao giờ gặp cảnh thư mục trống giữa chừng.
  var created = folder.createFile(res.getBlob().setName(name));
  var old = folder.getFilesByName(name);
  while (old.hasNext()) {
    var f = old.next();
    if (f.getId() !== created.getId()) f.setTrashed(true);
  }
  return created;
}


/** Đặt lịch MỖI GIỜ, gọi hàm gộp (chấm điểm + dựng PDF). Xoá lịch cũ để khỏi chạy trùng. Chạy 1 lần. */
function setupHourlyTriggerWithPdf() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'runComplianceReport' || f === 'syncComplianceBridge' || f === 'runComplianceReportWithPdf') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('runComplianceReportWithPdf').timeBased().everyHours(1).create();
  Logger.log('Đã đặt 1 lịch mỗi giờ: chấm điểm → dựng PDF → ghi Drive. Đã xoá mọi lịch cũ.');
}
