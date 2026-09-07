/**
 * ĐƯỜNG DẪN KHO MEDIA CÔNG TRƯỜNG — module THUẦN (không import gì của server) để CẢ client lẫn server
 * dùng CHUNG một cách đặt tên. Trước đây mỗi bên tự chuẩn hoá một kiểu (app Media cắt 60 ký tự, archive
 * ảnh của dashboard cắt 120) ⇒ dự án tên dài rơi vào HAI thư mục khác nhau, up một nơi đọc một nẻo.
 *
 *    ePMP › Media › <MÃ CT> › [<Toà>] › <Căn|Khu> › ("Hình ảnh" | "Video")
 */

/** Bỏ ký tự Drive không nhận, gộp khoảng trắng, cắt 60 ký tự. */
export const mediaSafe = (s: string): string =>
  (s || "").trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").slice(0, 60);

/** MÃ CT CHUẨN HOÁ để đặt tên thư mục: "ct25-040, 038…" → "CT25-040". Nguồn hay ghi gộp nhiều mã
 *  trong một ô, lấy mã ĐẦU TIÊN. Không đúng khuôn mã thì trả rỗng để bên gọi lùi về cách cũ. */
export function maCTChuan(maCT?: string): string {
  const dau = (maCT || "").split(/[,;/]/)[0].replace(/\s+/g, "").toUpperCase();
  return /^CT\d{2}-\d+$/.test(dau) ? dau : "";
}

/** TÊN THƯ MỤC DỰ ÁN = MÃ CT (chốt 07/09/2026). Mã CT là số hiệu công trình, gán một lần và không
 *  đổi; tên công trình thì sửa tới sửa lui, viết hoa thường mỗi lúc một kiểu, dài thì bị cắt — neo
 *  theo tên là kho media dễ tách làm đôi sau một lần đổi tên.
 *  NHIỀU DỰ ÁN CHUNG MỘT MÃ CT thì DÙNG CHUNG một thư mục (chốt cùng ngày) — bên trong đã chia theo
 *  Toà / Căn nên vẫn tìm ra đúng chỗ.
 *  Không có mã CT thì lùi về ID cứng rồi tên trần, để dữ liệu cũ vẫn đọc được. */
export function mediaProjectFolder(project: string, hid?: string, maCT?: string): string {
  const ma = maCTChuan(maCT);
  if (ma) return ma;
  const base = mediaSafe(project) || "Khac";
  const h = (hid || "").trim();
  return h ? `${base.slice(0, 46)} [${mediaSafe(h)}]` : base;
}

/** Đường dẫn đầy đủ tới thư mục ảnh/video của 1 căn (hoặc 1 khu).
 *  `toa` rỗng = dự án không chia toà (khu public) → bỏ hẳn cấp đó. */
export function mediaFolderPath(project: string, toa: string, can: string, kind: "photo" | "video",
  app = "ePMP", hid?: string, maCT?: string): string[] {
  const t = mediaSafe(toa);
  return [app, "Media", mediaProjectFolder(project, hid, maCT), ...(t ? [t] : []), mediaSafe(can) || "Khac",
    kind === "video" ? "Video" : "Hình ảnh"];
}
