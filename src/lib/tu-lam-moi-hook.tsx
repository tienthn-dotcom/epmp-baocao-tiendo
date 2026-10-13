/**
 * HOOK "MỞ LÀ TỰ LẤY BẢN MỚI". Luật nằm ở tu-lam-moi.ts; đây là phần nối vào React.
 *
 * Tách khỏi file luật để chỗ kia test được mà không cần dựng React, và để hai popup (bảng chính
 * với màn MTLĐ) dùng CHUNG một đường — hai bản sao thì sớm muộn cũng lệch nhau.
 *
 * HOOK KHÔNG TỰ HỎI DRIVE. Cả hai popup vốn đã hỏi ngày sửa cuối để bày dòng "Ngày cập nhật",
 * nên hook chỉ nhận lại con số đó. Tự hỏi thêm một lượt nữa là hỏi Drive hai lần cho cùng một
 * câu hỏi, mỗi lần mở popup.
 */
import { useEffect, useRef, useState } from "react";
import { canLamMoi, type TrangThaiTuMoi } from "@/lib/tu-lam-moi";

/**
 * @param ts           mốc của bản đang xem; chưa tải xong thì để 0/undefined, hook nằm im
 * @param modifiedTime ngày sửa cuối của file (ISO) — phải là số MỚI HỎI, không phải số cache lâu
 * @param onLamMoi     gọi đúng một lần khi file đã đổi; bên gọi tự tải lại (force)
 */
export function useTuLamMoi(ts: number | null | undefined, modifiedTime: string | null | undefined, onLamMoi: () => void): TrangThaiTuMoi {
  const [trangThai, setTrangThai] = useState<TrangThaiTuMoi>("cho");
  /* MỖI BẢN CACHE CHỈ XÉT MỘT LẦN. Khoá gồm cả `ts`: tải lại xong thì ts đổi → xét lại một lượt
     nữa, lần này bản mới không còn cũ hơn file nên dừng. Thiếu khoá này là vòng tải lại vô tận. */
  const daXet = useRef("");
  /* Giữ callback trong ref để nó KHÔNG nằm trong deps — bên gọi hay truyền hàm inline, mà hàm
     inline thì mỗi lần render lại là một hàm khác, kéo theo xét lại từ đầu. */
  const cb = useRef(onLamMoi);
  cb.current = onLamMoi;

  useEffect(() => {
    if (!ts) return;                       // chưa có bản nào trên màn thì chưa có gì để so
    if (modifiedTime === undefined) { setTrangThai("dang"); return; }   // đang hỏi Drive
    const khoa = `${ts}|${modifiedTime ?? ""}`;
    if (daXet.current === khoa) return;
    daXet.current = khoa;
    if (!modifiedTime) { setTrangThai("hut"); return; }                 // hỏi hụt → giữ bản đang xem
    if (canLamMoi(ts, modifiedTime)) { setTrangThai("daLamMoi"); cb.current(); }
    else setTrangThai("moiNhat");
  }, [ts, modifiedTime]);

  return trangThai;
}
