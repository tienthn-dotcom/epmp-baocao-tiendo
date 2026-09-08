/**
 * XEM NHƯ NGƯỜI DÙNG THƯỜNG — công tắc chỉ đổi GIAO DIỆN, không đổi quyền thật.
 *
 * Admin và PMO bật lên để thấy đúng những gì người thường thấy: nút quản trị, app riêng,
 * cột thao tác đều ẩn đi. Hai lúc cần: kiểm xem người khác mở app ra thấy gì, và chụp màn
 * báo cáo cho gọn, không vướng nút.
 *
 * Đây KHÔNG phải hàng rào bảo mật. Server vẫn chốt quyền theo phiên đăng nhập như cũ: bật
 * công tắc này rồi gọi API quản trị thì server vẫn cho qua, vì người gọi thật sự vẫn là admin.
 * Công tắc chỉ để NHÌN, đừng dùng nó thay cho phân quyền.
 *
 * Trạng thái nằm ở localStorage nên chỉ ảnh hưởng máy đang ngồi, không đụng người khác, và
 * tự tắt khi xoá dữ liệu trình duyệt. Mọi màn hình cùng nghe một sự kiện nên bật là đổi ngay,
 * không phải tải lại trang.
 */
import { useEffect, useState } from "react";

const LS_KEY = "pmo-xem-nhu-user";
const SU_KIEN = "pmo-xem-nhu-user-doi";

export function dangXemNhuUser(): boolean {
  try { return localStorage.getItem(LS_KEY) === "1"; } catch { return false; }
}

export function datXemNhuUser(bat: boolean): void {
  try { localStorage.setItem(LS_KEY, bat ? "1" : "0"); } catch { /* trình duyệt chặn lưu → bỏ qua */ }
  try { window.dispatchEvent(new CustomEvent(SU_KIEN)); } catch { /* ngoài trình duyệt */ }
}

/** Hook dùng trong component. Trả false ở lần render đầu (server-side) để không lệch hydration. */
export function useXemNhuUser(): boolean {
  const [bat, setBat] = useState(false);
  useEffect(() => {
    const doc = () => setBat(dangXemNhuUser());
    doc();
    window.addEventListener(SU_KIEN, doc);
    window.addEventListener("storage", doc);   // đổi ở tab khác cũng theo
    return () => { window.removeEventListener(SU_KIEN, doc); window.removeEventListener("storage", doc); };
  }, []);
  return bat;
}
