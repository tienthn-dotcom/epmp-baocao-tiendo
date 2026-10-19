/**
 * KHO DỮ LIỆU DÙNG CHUNG cho app "Báo cáo" (thanh trái).
 *
 * Trạm xuất báo cáo cần danh sách đầu việc ĐÃ TÍNH SẴN của màn Project Master Plan (tramDong trong
 * routes/index.tsx — vùng, cụm, PM, % kế hoạch/thực tế, số mã, vướng mắc…). Tính lại ở app Báo cáo là
 * nhân đôi cả bộ máy đọc file + luật cảnh báo, và sớm muộn hai nơi lệch nhau. Nên màn ePMP ĐẨY bản đã
 * tính vào đây mỗi khi đổi, app Báo cáo chỉ đọc.
 *
 * Mở app là vào ePMP trước (rail mặc định), nên lúc bấm sang Báo cáo dữ liệu thường đã có. Nếu chưa
 * (bấm quá nhanh lúc file còn đang tải) thì app Báo cáo nói rõ và cho nút quay về ePMP.
 */
import { useSyncExternalStore } from "react";
import type { DongNguon } from "@/lib/tram-bao-cao";

export type NguonTram = { dong: DongNguon[]; thuTuAbbr: readonly string[]; nguoiXuat: string; luc: number };

let hienTai: NguonTram | null = null;
const nghe = new Set<() => void>();

export function datNguonTram(n: Omit<NguonTram, "luc">): void {
  hienTai = { ...n, luc: Date.now() };
  nghe.forEach((f) => f());
}

export function useNguonTram(): NguonTram | null {
  return useSyncExternalStore(
    (f) => { nghe.add(f); return () => { nghe.delete(f); }; },
    () => hienTai,
    () => null,
  );
}
