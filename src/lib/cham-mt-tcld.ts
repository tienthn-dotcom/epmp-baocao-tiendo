/**
 * CHẤM "CẬP NHẬT MT TCLĐ" THEO MỐC GIỜ TRONG NGÀY.
 *
 * Anh Tiến chốt 01/10/2026: *"chấm báo cáo tuân thủ cập nhật MT TCLĐ — trước 18:05 là đúng, sau
 * là trễ, sau 20h là không update"*.
 *
 * KHÁC HẲN cách chấm tuân thủ đang có: cái kia chấm theo TUẦN dựa trên ngày ghi trong cột Ngày
 * update của file PMP. Cái này chấm theo NGÀY dựa trên GIỜ SỬA THẬT của file MT TCLĐ trên Drive.
 * Hai thước đo hai thứ khác nhau, đừng gộp.
 *
 * GIỜ VIỆT NAM. Drive trả `modifiedTime` theo giờ quốc tế (UTC). Chấm theo giờ UTC thì mốc 18:05
 * thành 01:05 sáng — sai toàn bộ. Mọi phép so trong file này đều quy về giờ Việt Nam trước.
 *
 * KHÔNG CÓ DỮ LIỆU THÌ KHÔNG CHẤM. Dự án chưa gắn link MT TCLĐ trả `null`, không trả "x" — cùng
 * nếp với báo cáo tuân thủ đang xử lý tuần chưa tới hạn: chưa đủ dữ liệu thì để trống chứ không
 * cho 0, tránh đổ oan dự án mới hoặc dự án không thuộc diện có MT TCLĐ (anh Tiến chốt 01/10).
 *
 * Module THUẦN để test được — chấm sai một mốc giờ là trừ điểm oan cả một PM.
 */

/** P = đúng hạn · o = trễ · x = không cập nhật · null = chưa đủ dữ liệu, không chấm. */
export type MocTcld = "P" | "o" | "x" | null;

/** Mốc giờ, phút tính theo GIỜ VIỆT NAM. Muốn nới/siết thì sửa đúng hai số này. */
export const MOC_GIO = {
  /** Sửa trước mốc này là ĐÚNG HẠN. 18:05. */
  dungHan: { gio: 18, phut: 5 },
  /** Từ mốc trên tới mốc này là TRỄ; qua mốc này coi như KHÔNG cập nhật. 20:00. */
  hetHan: { gio: 20, phut: 0 },
};

const LECH_VN_PHUT = 7 * 60;   // Việt Nam = UTC+7, không có giờ mùa hè

/** Đổi một mốc ISO (UTC) sang "ngày" và "số phút trong ngày" theo GIỜ VIỆT NAM. */
export function theoGioVn(iso: string): { ngay: string; phut: number } | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const vn = new Date(t + LECH_VN_PHUT * 60_000);
  const ngay = vn.toISOString().slice(0, 10);
  const phut = vn.getUTCHours() * 60 + vn.getUTCMinutes();
  return { ngay, phut };
}

const phutCuaMoc = (m: { gio: number; phut: number }) => m.gio * 60 + m.phut;

/**
 * Chấm một ngày.
 * @param modifiedTime ISO giờ sửa file MT TCLĐ lần cuối (Drive trả về). null = chưa gắn link
 *                     hoặc chưa đọc được → KHÔNG chấm.
 * @param ngayCham     ngày đang chấm, dạng "yyyy-mm-dd" theo GIỜ VIỆT NAM.
 */
export function chamNgay(modifiedTime: string | null | undefined, ngayCham: string): MocTcld {
  if (!modifiedTime) return null;
  const v = theoGioVn(modifiedTime);
  if (!v) return null;
  // Sửa vào NGÀY KHÁC (thường là hôm trước) ⇒ hôm nay không ai đụng vào ⇒ không cập nhật.
  if (v.ngay !== ngayCham) return "x";
  if (v.phut < phutCuaMoc(MOC_GIO.dungHan)) return "P";
  if (v.phut < phutCuaMoc(MOC_GIO.hetHan)) return "o";
  return "x";
}

/** Chữ hiện ra cho người đọc. */
export const NHAN_MOC: Record<"P" | "o" | "x", string> = {
  P: "Đúng hạn",
  o: "Trễ",
  x: "Không cập nhật",
};

/** Giờ sửa viết gọn để bày cạnh dấu chấm: "17:42" — hoặc rỗng khi không có. */
export function gioGon(modifiedTime: string | null | undefined): string {
  if (!modifiedTime) return "";
  const v = theoGioVn(modifiedTime);
  if (!v) return "";
  return `${String(Math.floor(v.phut / 60)).padStart(2, "0")}:${String(v.phut % 60).padStart(2, "0")}`;
}
