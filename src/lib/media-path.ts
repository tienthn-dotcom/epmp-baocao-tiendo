/**
 * ĐƯỜNG DẪN KHO MEDIA CÔNG TRƯỜNG — module THUẦN (không import gì của server) để CẢ client lẫn server
 * dùng CHUNG một cách đặt tên. Trước đây mỗi bên tự chuẩn hoá một kiểu (app Media cắt 60 ký tự, archive
 * ảnh của dashboard cắt 120) ⇒ dự án tên dài rơi vào HAI thư mục khác nhau, up một nơi đọc một nẻo.
 *
 *    ePMP › Media › "<tên dự án> [<ID cứng>]" › [<Toà>] › <Căn|Khu> › ("Hình ảnh" | "Video")
 */

/** Bỏ ký tự Drive không nhận, gộp khoảng trắng, cắt 60 ký tự. */
export const mediaSafe = (s: string): string =>
  (s || "").trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").slice(0, 60);

/** TÊN THƯ MỤC DỰ ÁN — neo theo **ID CỨNG** (cột IDCUNG, vd "P0025") chứ không chỉ theo tên: tên dự án
 *  đổi được, bị cắt khi dài, và nhiều dự án tên na ná nhau → neo theo tên thì hai dự án khác nhau dễ
 *  dùng chung một kho. ID cứng gán 1 lần, không đổi, không tái dùng.
 *  Nguồn chưa có cột IDCUNG (hid rỗng) → lùi về tên trần như cũ, dữ liệu đang có vẫn đọc bình thường. */
export function mediaProjectFolder(project: string, hid?: string): string {
  const base = mediaSafe(project) || "Khac";
  const h = (hid || "").trim();
  return h ? `${base.slice(0, 46)} [${mediaSafe(h)}]` : base;
}

/** Đường dẫn đầy đủ tới thư mục ảnh/video của 1 căn (hoặc 1 khu).
 *  `toa` rỗng = dự án không chia toà (khu public) → bỏ hẳn cấp đó. */
export function mediaFolderPath(project: string, toa: string, can: string, kind: "photo" | "video",
  app = "ePMP", hid?: string): string[] {
  const t = mediaSafe(toa);
  return [app, "Media", mediaProjectFolder(project, hid), ...(t ? [t] : []), mediaSafe(can) || "Khac",
    kind === "video" ? "Video" : "Hình ảnh"];
}
