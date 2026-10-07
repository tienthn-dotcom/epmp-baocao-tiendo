/**
 * TẢI BẢNG CHẤM TUÂN THỦ MỖI NGÀY VỀ CLIENT.
 *
 * Ranh giới giữ y như mọi nguồn khác của app: Worker CHỈ tải byte và cache, CLIENT mới parse xlsx.
 * Worker parse xlsx là đường đã chết một lần rồi (Error 1102 vì OOM) — xem ghi chú đầu
 * mtld-install.functions.ts.
 *
 * ĐI QUA `getSummaryFile` THEO gid, không tự fetch:
 *   · `export?format=xlsx&gid=` trả ĐÚNG MỘT TAB (~vài chục KB) thay vì cả file;
 *   · bản tải được cache trong KV dưới một khoá, và warmer tự làm mới lúc 18:00 / 20:00 — nên mở
 *     báo cáo KHÔNG tốn thêm lượt ghi KV nào. Gói free chỉ cho 1.000 lượt ghi mỗi ngày và app đã
 *     tràn thật 03/10/2026, nên đây không phải chuyện nhỏ.
 */
import { getSummaryFile } from "@/lib/mtld-install.functions";
import { parseBcnGrid, type BcnData } from "@/lib/bcn-file";

/** File nguồn + tab bảng chấm. Lấy từ chính file anh Tiến gửi; gid tra ngày 07/10/2026. */
export const BCN_FILE_ID = "1NLUB2757Bnw3G_lVZwbykfi-jkfwEBx1z--_4CgvcEY";
export const BCN_GID_BANG_CHAM = "1300036777";
/** Link mở thẳng tab bảng chấm — cho nút "Xem file nguồn". */
export const BCN_FILE_URL = `https://docs.google.com/spreadsheets/d/${BCN_FILE_ID}/edit?gid=${BCN_GID_BANG_CHAM}`;

const b64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
};

export type BcnTai = { data: BcnData; ts: number };

/** Tải + parse bảng chấm. `force` bỏ qua cache, lấy bản mới nhất từ Drive (nút "Làm mới"). */
export async function taiBangCham(force?: boolean): Promise<BcnTai> {
  const res = await getSummaryFile({ data: { fileId: BCN_FILE_ID, gid: BCN_GID_BANG_CHAM, force: force || undefined } });
  if (!res?.b64) throw new Error('Không tải được file nguồn — kiểm tra chia sẻ "Anyone with the link".');
  const XLSX = await import("xlsx");
  const wb = XLSX.read(b64ToBytes(res.b64), { type: "array" });
  /* Tải theo gid nên workbook chỉ có đúng một tab; vẫn dò theo tên trước phòng khi Google đổi cách
     trả về, rồi mới lùi về tab đầu. */
  const ten = wb.SheetNames.find((n) => /bangcham|b[ảa]ng ch[ấa]m/i.test(n)) ?? wb.SheetNames[0];
  const sh = wb.Sheets[ten];
  if (!sh) throw new Error("File nguồn không có tab bảng chấm.");
  /* `blankrows: false` bỏ dòng trống — bộ đọc dò tiêu đề theo nhãn nên không phụ thuộc số dòng,
     mà bỏ dòng trống thì dòng tiêu đề nằm gần đầu hơn, đỡ rủi ro. `raw: false` để ngày tháng ra
     chuỗi đã định dạng thay vì số sê-ri của Excel. */
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sh, { header: 1, blankrows: false, defval: null, raw: false });
  return { data: parseBcnGrid(grid), ts: res.ts || Date.now() };
}
