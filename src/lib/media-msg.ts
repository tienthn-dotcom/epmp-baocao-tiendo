/**
 * CHÚ THÍCH ẢNH/CLIP — KIỂU DỮ LIỆU + CÁCH ĐỌC, module THUẦN (không đụng gì của server) để CẢ
 * client lẫn server dùng chung. Để trong can-media.functions.ts thì client import vào là kéo theo
 * cả module server, Vite chặn ngay ("Import denied in client environment").
 *
 * Chuỗi tin nằm trong phần MÔ TẢ của chính tệp trên Drive, dạng JSON. Chú thích viết trước
 * 07/09/2026 là một dòng chữ trần — vẫn đọc được, coi như một tin không rõ người viết.
 */

export type MediaMsg = {
  id: string;
  text: string;
  author: string;   // email người viết (lấy từ phiên đăng nhập, client không tự khai được)
  at: string;       // ISO thời điểm viết
};

/** Trần số tin mỗi ảnh/clip — phần mô tả trên Drive chỉ chứa được khoảng 4000 ký tự. */
export const MEDIA_MSG_MAX = 30;

export function parseMediaMsgs(desc?: string): MediaMsg[] {
  const raw = (desc || "").trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const arr = JSON.parse(raw) as MediaMsg[];
      if (Array.isArray(arr)) return arr.filter((m) => m && typeof m.text === "string");
    } catch { /* hỏng JSON → coi như chữ trần ở dưới */ }
  }
  return [{ id: "cu", text: raw, author: "(cũ)", at: "" }];
}

/** Cắt chú thích còn 100 TỪ (chốt với chủ nhà) và gộp xuống dòng cho gọn một đoạn. */
export function capNganMsg(s?: string): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const tu = t.split(" ");
  return (tu.length > 100 ? tu.slice(0, 100).join(" ") + "…" : t).slice(0, 1000);
}
