/**
 * ĐỌC LỖI THÀNH CÂU NÓI ĐƯỢC.
 *
 * Khắp app đang viết `(e as Error).message` để bày lỗi lên toast. Câu đó chỉ đúng khi thứ bị ném
 * LÀ một `Error`. Mà `throw` trong JavaScript ném được BẤT KỲ giá trị nào, và mấy thứ hay ném nhất
 * ở đây lại không phải Error:
 *   · server function của TanStack Start từ chối bằng một object phản hồi (có `status`/`statusText`);
 *   · `fetch` hỏng mạng;
 *   · Cloudflare Worker chết vì quá 2s CPU — request đứt giữa chừng.
 * Những ca đó `.message` ra `undefined`, nên người dùng thấy đúng chữ "Thao tác thất bại: undefined"
 * (anh Tiến gặp 06/10/2026) và KHÔNG AI biết chuyện gì xảy ra — kể cả người viết app.
 *
 * Hàm này moi ra chuỗi nói được từ mọi hình dạng, và khi bí thì nói thẳng là bí kèm chỗ để tra,
 * chứ không in ra "undefined".
 */

/** Lấy một câu mô tả lỗi, luôn khác rỗng. */
export function loiNoi(e: unknown): string {
  if (typeof e === "string" && e.trim()) return e.trim();
  if (e instanceof Error && e.message) return e.message;

  const o = e as Record<string, unknown> | null | undefined;
  if (o && typeof o === "object") {
    for (const k of ["message", "error", "statusText", "detail"] as const) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    // Lỗi HTTP thường chỉ có mã — vẫn hơn hẳn "undefined", vì mã nói được tầng nào hỏng.
    const st = o["status"];
    if (typeof st === "number") return `máy chủ trả mã ${st}`;
    try {
      const j = JSON.stringify(e);
      if (j && j !== "{}" && j !== "null") return j.slice(0, 200);
    } catch { /* có vòng lặp tham chiếu thì thôi */ }
  }
  return "không rõ nguyên nhân — mở Console (F12) xem dòng đỏ ngay trước thông báo này";
}

/** Vừa ghi nguyên con lỗi ra Console vừa trả câu nói được.
 *
 *  Dùng cho các thao tác GHI dữ liệu: khi người dùng báo lỗi, thứ duy nhất tra ngược được là dòng
 *  Console — mà `loiNoi` thì cố tình cắt ngắn cho vừa toast. Hai việc khác nhau, nên làm cả hai. */
export function loiNoiVaGhi(viec: string, e: unknown): string {
  try { console.error(`[${viec}]`, e); } catch { /* console bị chặn thì kệ */ }
  return loiNoi(e);
}
