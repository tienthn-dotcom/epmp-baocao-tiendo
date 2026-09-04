/**
 * BREAKPOINT DÙNG CHUNG CHO CẢ APP — một nơi duy nhất định nghĩa "thế nào là điện thoại / máy tính
 * bảng / máy tính", để mỗi màn không tự đặt mốc một kiểu (trước đây mỗi chỗ tự `matchMedia` riêng).
 *
 * MỐC (theo thiết bị thật của người dùng, không phải con số đẹp):
 *   mobile  ≤ 767   — iPhone SE 320 · iPhone thường 375-430
 *   tablet  768-1023
 *   desktop ≥ 1024
 *
 * NGUYÊN TẮC: hook này để ĐỔI BỐ CỤC (bảng → thẻ, rail → drawer, modal → sheet), KHÔNG dùng để thu nhỏ
 * chữ. Cái gì rộng quá thì giữ tỷ lệ cho cuộn ngang trong khung riêng (xem FitOrScroll), đừng ép co.
 *
 * SSR: lần render đầu luôn trả "desktop" để khớp HTML server dựng ra (tránh lệch hydration), rồi mới
 * chỉnh lại ở client.
 */
import { useEffect, useState } from "react";

export const BP = { mobile: 768, tablet: 1024 } as const;
export type Breakpoint = "mobile" | "tablet" | "desktop";

const readBp = (): Breakpoint => {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  return w < BP.mobile ? "mobile" : w < BP.tablet ? "tablet" : "desktop";
};

/** Khổ màn hiện tại. Tự cập nhật khi xoay ngang/dọc hoặc đổi cỡ cửa sổ. */
export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>("desktop");
  useEffect(() => {
    const on = () => setBp(readBp());
    on();
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => { window.removeEventListener("resize", on); window.removeEventListener("orientationchange", on); };
  }, []);
  return bp;
}

/** Điện thoại (< 768). Dùng cho quyết định bố cục 2 nhánh. */
export const useIsMobile = (): boolean => useBreakpoint() === "mobile";
/** Điện thoại HOẶC máy tính bảng (< 1024) — chỗ nào cần gọn cả trên tablet thì dùng cái này. */
export function useIsNarrow(): boolean { const b = useBreakpoint(); return b !== "desktop"; }
