/**
 * GHI NGÀY SỬA CUỐI CỦA FILE MA TRẬN VÀO CHÍNH FILE NGUỒN
 * ========================================================
 * Dán vào: file nguồn ePMP → Tiện ích mở rộng (Extensions) → Apps Script → dán đè vào Code.gs.
 * Chạy thử một lần: chọn hàm `capNhatNgayLink` → Run (lần đầu Google sẽ hỏi cấp quyền).
 * Đặt chạy tự động: chọn hàm `datLichHangNgay` → Run (một lần duy nhất).
 *
 * NÓ LÀM GÌ
 * ---------
 * Mỗi dòng trong tab Timeline có thể mang một hyperlink "Thi công lắp đặt" trỏ tới file ma trận
 * riêng của dự án. Script duyệt các ô đó, hỏi Drive xem file ấy sửa lần cuối lúc nào, rồi ghi ngày
 * vào cột "Ngày file link" ở cuối bảng (tự tạo nếu chưa có).
 *
 * VÌ SAO LÀM Ở ĐÂY MÀ KHÔNG ĐỂ APP TỰ HỎI
 * ---------------------------------------
 * App đọc file nguồn sẵn rồi, nên ngày nằm sẵn trong đó là app KHÔNG phải gọi Drive lần nào, cũng
 * không phải ghi vào kho riêng. Ngày lại hiện ngay trong sheet, ai mở sheet cũng thấy.
 *
 * MỘT SCRIPT DÙNG CHO TẤT CẢ: đặt trong FILE NGUỒN, không phải trong từng file ma trận. Cắm vào
 * từng file ma trận thì sao chép file là mất script, đổi chủ sở hữu là hỏng, sửa một lỗi phải sửa
 * mấy chục nơi.
 *
 * AN TOÀN
 * -------
 * · Chỉ GHI vào đúng một cột do nó tạo ra. Không đụng cột nào khác, không chèn/xoá dòng.
 * · File nào không có quyền đọc thì để trống ô đó và đếm vào mục "hỏng", không làm dừng cả lượt.
 * · Chạy lại nhiều lần vô hại — ghi đè đúng cột đó.
 */

/* ─── CHỈNH Ở ĐÂY NẾU CẦN ──────────────────────────────────────────────────────────────────── */

/** Tên tab chứa bảng tiến độ. */
var TEN_TAB = "Timeline";

/** Tiêu đề cột script sẽ ghi vào. App tìm cột theo đúng chữ này. */
var TIEU_DE_COT = "Ngày file link";

/** Dòng tiêu đề (đánh số như trên Google Sheet: 1, 2, 3…). File hiện tại để ở dòng 6. */
var DONG_TIEU_DE = 6;

/** Chỉ quét hyperlink trong chừng này cột đầu — quét cả bảng thì chậm mà link không nằm xa vậy. */
var SO_COT_QUET = 30;

/** Định dạng ngày ghi ra. "dd/MM/yyyy" cho dễ đọc; đổi thành "yyyy-MM-dd" nếu muốn máy đọc. */
var DINH_DANG_NGAY = "dd/MM/yyyy";

/* ─── PHẦN CHẠY ───────────────────────────────────────────────────────────────────────────── */

/** Hàm chính. Chạy tay hoặc để lịch gọi mỗi ngày. */
function capNhatNgayLink() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(TEN_TAB);
  if (!sheet) throw new Error('Không thấy tab "' + TEN_TAB + '"');

  var soDong = sheet.getLastRow();
  var soCot = Math.min(sheet.getLastColumn(), SO_COT_QUET);
  if (soDong <= DONG_TIEU_DE) return _ketQua(0, 0, 0, "bảng chưa có dòng dữ liệu");

  var dongDau = DONG_TIEU_DE + 1;
  var soDongDL = soDong - DONG_TIEU_DE;
  var vung = sheet.getRange(dongDau, 1, soDongDL, soCot);

  // Lấy MỘT LẦN cả ba thứ: chữ trong ô, link kiểu "chèn liên kết", và link kiểu công thức
  // HYPERLINK(). Gọi từng ô một thì mấy nghìn lượt gọi, chạy cả phút.
  var chu = vung.getDisplayValues();
  var giau = vung.getRichTextValues();
  var ct = vung.getFormulas();

  var cotGhi = _timHoacTaoCot(sheet);
  var ngayCu = sheet.getRange(dongDau, cotGhi, soDongDL, 1).getValues();

  var kho = {};              // fileId → ngày, để hai dòng chung một file chỉ hỏi Drive một lượt
  var ra = [];
  var coLink = 0, ok = 0, hong = 0;

  for (var i = 0; i < soDongDL; i++) {
    var id = null;
    for (var j = 0; j < soCot && !id; j++) {
      // App nhận link theo ô có chữ "Thi công lắp đặt" — bám đúng luật đó để hai bên không lệch.
      if (!/thi\s*c[ôo]ng\s*l[ắa]p/i.test(chu[i][j] || "")) continue;
      id = _layFileId(_layUrl(giau[i][j], ct[i][j]));
    }
    if (!id) { ra.push([ngayCu[i][0]]); continue; }   // dòng không có link: GIỮ NGUYÊN ô cũ

    coLink++;
    if (!(id in kho)) {
      try {
        kho[id] = Utilities.formatDate(
          DriveApp.getFileById(id).getLastUpdated(),
          Session.getScriptTimeZone(), DINH_DANG_NGAY);
      } catch (e) {
        kho[id] = "";          // không có quyền đọc / file đã xoá → để trống, không làm dừng lượt chạy
      }
    }
    if (kho[id]) ok++; else hong++;
    ra.push([kho[id]]);
  }

  // GHI MỘT LẦN cho cả cột.
  sheet.getRange(dongDau, cotGhi, soDongDL, 1).setValues(ra);
  return _ketQua(coLink, ok, hong, "");
}

/** Đặt lịch chạy mỗi ngày một lần (khoảng 6h sáng). Gọi tay MỘT LẦN là xong. */
function datLichHangNgay() {
  var cu = ScriptApp.getProjectTriggers();
  for (var i = 0; i < cu.length; i++) {
    if (cu[i].getHandlerFunction() === "capNhatNgayLink") ScriptApp.deleteTrigger(cu[i]);
  }
  ScriptApp.newTrigger("capNhatNgayLink").timeBased().atHour(6).everyDays(1).create();
  return "Đã đặt lịch: chạy mỗi ngày khoảng 6h sáng.";
}

/* ─── PHẦN PHỤ ────────────────────────────────────────────────────────────────────────────── */

/** Tìm cột có đúng tiêu đề; chưa có thì tạo mới ở ngay sau cột cuối cùng. */
function _timHoacTaoCot(sheet) {
  var soCot = sheet.getLastColumn();
  var tieuDe = sheet.getRange(DONG_TIEU_DE, 1, 1, soCot).getDisplayValues()[0];
  for (var i = 0; i < tieuDe.length; i++) {
    if (String(tieuDe[i]).trim() === TIEU_DE_COT) return i + 1;
  }
  var moi = soCot + 1;
  sheet.getRange(DONG_TIEU_DE, moi).setValue(TIEU_DE_COT).setFontWeight("bold");
  sheet.setColumnWidth(moi, 120);
  return moi;
}

/** URL của ô: ưu tiên link "chèn liên kết", không có thì dò trong công thức HYPERLINK(). */
function _layUrl(oGiau, congThuc) {
  if (oGiau) {
    var link = oGiau.getLinkUrl();
    if (link) return link;
    var doan = oGiau.getRuns();          // link có thể chỉ gắn vào MỘT ĐOẠN chữ trong ô
    for (var i = 0; i < doan.length; i++) {
      var u = doan[i].getLinkUrl();
      if (u) return u;
    }
  }
  var m = /HYPERLINK\(\s*"([^"]+)"/i.exec(congThuc || "");
  return m ? m[1] : null;
}

/** fileId trong URL Google Sheet. */
function _layFileId(url) {
  if (!url) return null;
  var m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(url);
  return m ? m[1] : null;
}

function _ketQua(coLink, ok, hong, ghiChu) {
  var s = "Dòng có link: " + coLink + " · lấy được ngày: " + ok + " · không đọc được: " + hong
        + (ghiChu ? " · " + ghiChu : "");
  Logger.log(s);
  return s;
}
