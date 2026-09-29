/**
 * Ô VƯỚNG MẮC CẤP DỰ ÁN CHỈ CHIẾU MỘT TIN: tin MỚI NHẤT. Tin cũ gấp lại.
 *
 * Người dùng chốt 28/09/2026: *"tôi muốn là vướng mắc cấp dự án chỉ có 1 cmt, nên nếu có thông tin
 * mới thì ưu tiên chiếu 1 thông tin mới, trừ khi tôi bỏ ẩn thì mới hiện 2 cmt"*.
 *
 * GIẤU KHI NHÌN, KHÔNG SỬA KHO. App KHÔNG tự đóng cờ ẩn lên ghi chú người khác đã gõ: tin cũ còn
 * nguyên, bấm "+n tin cũ" là hiện lại, mở hộp thoại vẫn thấy đủ và vẫn ẩn/xoá được như cũ. Đổi lại
 * thì không tốn lượt ghi KV nào (trần 1.000 lượt/ngày), và không có đường nào làm mất ghi chú.
 *
 * KHÔNG CHẮC THÌ KHÔNG GIẤU: chỉ cần một tin thiếu mốc `at` là chiếu hết, vì lúc đó không có cách
 * nào biết tin nào mới hơn. Thà hiện thừa còn hơn giấu nhầm câu người ta vừa gõ.
 *
 * SO BẰNG CHUỖI `at`: tin của file nguồn ghi "2026-09-28" (chỉ ngày), tin gõ trong app ghi
 * "2026-09-25T09:04:03.617Z". So chuỗi ra đúng thứ tự ngày; cùng một ngày thì tin gõ trong app (có
 * giờ) tính là mới hơn tin của file nguồn. Bằng nhau nữa thì tin đứng sau trong mảng thắng.
 *
 * Module THUẦN để test được — luật này quyết định người dùng NHÌN THẤY câu nào, đọc sai là họ đọc
 * nhầm tình hình dự án.
 */
import type { ChatMsg } from "@/lib/edits.functions";

export function chiaTinMoiCu(msgs: ChatMsg[]): { moi: ChatMsg[]; cu: ChatMsg[] } {
  if (msgs.length <= 1 || msgs.some((m) => !m.at)) return { moi: msgs, cu: [] };
  let iMoi = 0;
  for (let i = 1; i < msgs.length; i++) if ((msgs[i].at ?? "") >= (msgs[iMoi].at ?? "")) iMoi = i;
  return { moi: [msgs[iMoi]], cu: msgs.filter((_, i) => i !== iMoi) };
}
