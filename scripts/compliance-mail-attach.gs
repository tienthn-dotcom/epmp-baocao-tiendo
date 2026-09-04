/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ĐÍNH KÈM PDF BÁO CÁO TUÂN THỦ VÀO MAIL TỰ ĐỘNG
 * ═══════════════════════════════════════════════════════════════════════════
 *  Dán đoạn này vào CÙNG project Apps Script đang auto gửi mail trong FILE GỐC.
 *
 *  CƠ CHẾ:
 *   - Bên ePMP, PMO bấm nút "☁ Lưu để gửi mail" trong popup Báo cáo tuân thủ →
 *     app đẩy ĐÚNG bản PDF đó lên Google Drive: folder "Data Source" › thư mục con
 *     "Báo cáo tuân thủ", tên `BaoCaoTuanThu_MP_<MMYYYY>.pdf` (ghi đè mỗi kỳ).
 *   - Hàm getComplianceReportPdf_() dưới đây tìm file ĐÚNG THÁNG HIỆN TẠI trong
 *     thư mục đó (không có thì lấy PDF mới nhất) và trả về Blob để đính kèm.
 *   - Có kiểm tra "TƯƠI": nếu file cũ hơn MAX_AGE_DAYS ngày → coi như CHƯA có bản
 *     kỳ này (trả null) để mình quyết định gửi kèm ghi chú hay bỏ đính kèm.
 *
 *  QUYỀN: script chạy dưới tài khoản tienthn@aacorporation.com — tài khoản này ĐÃ
 *   được share folder "Data Source", nên DriveApp đọc được. Lần chạy đầu sau khi
 *   thêm DriveApp, Apps Script sẽ xin cấp lại quyền Drive → bấm đồng ý 1 lần.
 */

// ─── CẤU HÌNH ───
//  Đường dẫn Drive: "Data Source" › DATABASE › ePMP › "Báo cáo tuân thủ" › <PDF> (khớp app đẩy lên).
var REPORT_ROOT_FOLDER_ID = '1O9VktCpBENaZB1xgABr8MfIbl3YW8hFO'; // folder "Data Source"
var REPORT_DB_SUBFOLDER   = 'DATABASE';                          // cấp con chứa dữ liệu mọi app (khớp CHÍNH XÁC tên Drive)
var REPORT_APP_SUBFOLDER  = 'ePMP';                              // folder tổng của app ePMP trong DATABASE
var REPORT_SUBFOLDER      = 'Báo cáo tuân thủ';                   // thư mục con app tạo trong ePMP
var REPORT_MAX_AGE_DAYS   = 8;                                    // cũ hơn ngần này → coi như chưa có bản kỳ này

/**
 * Lấy Blob PDF báo cáo tuân thủ để đính kèm.
 * @return {{blob: Blob, name: string, fresh: boolean, ageDays: number}|null}
 *         null nếu không tìm thấy PDF nào trong thư mục.
 */
function getComplianceReportPdf_() {
  var root = DriveApp.getFolderById(REPORT_ROOT_FOLDER_ID);
  // Data Source › DATABASE › ePMP › Báo cáo tuân thủ (đi lần lượt từng cấp).
  var dbs = root.getFoldersByName(REPORT_DB_SUBFOLDER);
  if (!dbs.hasNext()) { Logger.log('Chưa thấy thư mục "' + REPORT_DB_SUBFOLDER + '" trong Data Source.'); return null; }
  var apps = dbs.next().getFoldersByName(REPORT_APP_SUBFOLDER);
  if (!apps.hasNext()) { Logger.log('Chưa thấy thư mục "' + REPORT_APP_SUBFOLDER + '" trong DATABASE.'); return null; }
  var subs = apps.next().getFoldersByName(REPORT_SUBFOLDER);
  if (!subs.hasNext()) { Logger.log('Chưa thấy thư mục "' + REPORT_SUBFOLDER + '" trong ' + REPORT_APP_SUBFOLDER + '.'); return null; }
  var folder = subs.next();

  var tz  = Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh';
  var now = new Date();
  var mmYYYY = Utilities.formatDate(now, tz, 'MMyyyy');            // vd "082026" — khớp tên file kỳ này

  // Duyệt mọi file PDF: ưu tiên file tên chứa MMYYYY (đúng kỳ); song song ghi nhớ file MỚI NHẤT.
  var files = folder.getFiles();
  var exact = null, newest = null;
  while (files.hasNext()) {
    var f = files.next();
    if (String(f.getMimeType()) !== 'application/pdf') continue;
    if (!newest || f.getLastUpdated().getTime() > newest.getLastUpdated().getTime()) newest = f;
    if (f.getName().indexOf(mmYYYY) >= 0) {
      if (!exact || f.getLastUpdated().getTime() > exact.getLastUpdated().getTime()) exact = f;
    }
  }
  var pick = exact || newest;
  if (!pick) { Logger.log('Thư mục "' + REPORT_SUBFOLDER + '" chưa có file PDF nào.'); return null; }

  var ageDays = Math.floor((now.getTime() - pick.getLastUpdated().getTime()) / 86400000);
  var fresh   = ageDays <= REPORT_MAX_AGE_DAYS;
  Logger.log('PDF đính kèm: "' + pick.getName() + '" · cập nhật cách đây ' + ageDays + ' ngày · '
             + (exact ? 'khớp kỳ ' + mmYYYY : 'lấy bản mới nhất (không có bản đúng kỳ)') + (fresh ? '' : ' · ĐÃ CŨ'));
  return { blob: pick.getBlob().setName(pick.getName()), name: pick.getName(), fresh: fresh, ageDays: ageDays };
}

/* ───────────────────────────────────────────────────────────────────────────
 *  CÁCH GẮN VÀO SCRIPT "nhacNhoTuanNay" ĐANG CÓ (chỉ THÊM, không sửa logic cũ)
 *
 *  ① Ngay sau dòng   const logSh = getLogSheet(ss);   thêm 2 dòng:
 *        const rep = getComplianceReportPdf_();
 *        const attach = (rep && rep.fresh) ? [rep.blob] : [];
 *
 *  ② Ở NHÁNH TEST — đổi:
 *        GmailApp.sendEmail(CFG.TEST_MODE_TO, subject, htmlToText(html), { htmlBody: html });
 *     thành:
 *        GmailApp.sendEmail(CFG.TEST_MODE_TO, subject, htmlToText(html), { htmlBody: html, attachments: attach });
 *
 *  ③ Ở NHÁNH THẬT — đổi:
 *        GmailApp.sendEmail(email, CFG.SUBJECT, htmlToText(html), CFG.CC ? { htmlBody: html, cc: CFG.CC } : { htmlBody: html });
 *     thành:
 *        GmailApp.sendEmail(email, CFG.SUBJECT, htmlToText(html), CFG.CC ? { htmlBody: html, cc: CFG.CC, attachments: attach } : { htmlBody: html, attachments: attach });
 *
 *  Vậy là xong — mọi phần còn lại giữ nguyên. Nếu chưa có bản PDF tươi trên Drive
 *  thì attach = [] → mail vẫn gửi bình thường, chỉ không kèm file (không lỗi).
 * ─────────────────────────────────────────────────────────────────────────── */

/** Chạy tay để KIỂM TRA nhanh: có lấy được PDF không, tươi không (xem Execution log). */
function testComplianceReportPdf() {
  var rep = getComplianceReportPdf_();
  if (!rep) { Logger.log('KẾT QUẢ: chưa có PDF trong thư mục.'); return; }
  Logger.log('KẾT QUẢ: ' + rep.name + ' · ' + (rep.fresh ? 'TƯƠI' : 'CŨ (' + rep.ageDays + ' ngày)') + ' · ' + rep.blob.getBytes().length + ' bytes');
}
