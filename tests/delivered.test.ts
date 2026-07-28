import { describe, it, expect } from "vitest";
import { noteSaysDelivered } from "../src/lib/parser";

/** Luật: dòng dự án cha ghi "đã bàn giao / đã hoàn tất" ⇒ dự án xong, gỡ hết cảnh báo.
 *  Rủi ro lớn nhất KHÔNG phải bỏ sót mà là BẮT NHẦM: trong nguồn 07/2026 có 23 note
 *  dòng cha chứa chữ "bàn giao" nhưng ý nghĩa ngược hẳn (cảnh báo trễ). Bắt nhầm một
 *  cái là tô xanh + xoá cảnh báo của cả một dự án đang trễ ⇒ PMO mất dấu. Các test
 *  "bẫy" dưới đây chép NGUYÊN VĂN từ file nguồn thật, không phải ví dụ bịa. */
describe("noteSaysDelivered — bắt ĐÚNG dự án đã xong", () => {
  const xong = [
    ["CT26-062", "Dự án đã bàn giao đúng tiến độ & chất lượng"],
    ["CT26-049", "Đã bàn giao dự án, còn điều chỉnh vài hạng mục theo yêu cầu của văn phòng chính phủ"],
    ["CT26-019", "PMO: đã hoàn tất thi công lắp đặt, giai đoạn defect bàn giao chủ đầu tư"],
  ];
  for (const [ma, note] of xong) {
    it(`${ma} → đã xong`, () => expect(noteSaysDelivered(note)).toBe(true));
  }

  it("chấp nhận ĐÚNG 1 từ đệm giữa 'đã' và 'bàn giao'", () => {
    expect(noteSaysDelivered("Dự án đã được bàn giao")).toBe(true);
  });

  it("không phụ thuộc dấu tiếng Việt / hoa thường", () => {
    expect(noteSaysDelivered("DA BAN GIAO TOAN BO")).toBe(true);
    expect(noteSaysDelivered("ĐÃ HOÀN THÀNH")).toBe(true);
  });
});

describe("noteSaysDelivered — KHÔNG bắt nhầm note cảnh báo (nguyên văn từ nguồn)", () => {
  const bay = [
    "PMO: Trễ tiến độ bàn giao. Cần NM-PM chốt BOT giao hàng cam kết, tracking mỗi ngày đảm bảo tiến độ bàn giao 25/07",
    "PMO: Tiến độ bàn giao đã trượt. Cần PM cập nhật tiến độ bàn giao dự án mới",
    "PMO: Cảnh báo trễ tiến độ. Cần PM-NM chốt BOT cam kết, tracking mỗi tuần đảm bảo tiến độ bàn giao 30/07",
    "PMO: Cảnh báo trượt tiến độ. Cần PM-NM chốt BOT giao hàng cam kết, đảm bảo tiến độ bàn giao",
    "PMO: Mốc bàn giao dời từ 15/07 đến 20/07,",
    "Không vấn đề. Đã giao hàng 100%, CĐT chậm bàn giao mặt bằng.",
    "Chưa chốt hợp đồng & tiến độ bàn giao. Cần QS cập nhật thông tin.",
    "Đã trễ tiến độ. Cần hàng & quân. Gấp rút bàn giao.",
    "Kế hoạch: 06/02 nhận hàng, lắp đặt bàn giao 09/02",
    "PMO: Tiến độ dời từ 30/06 đến 30/08, cần PM trình BOD phê duyệt (bitrix). Cần PM-NM chốt BOT giao hàng cam kết, tracking mỗi tuần để đáp ứng tiến độ bàn giao",
    "ĐANG BÀN GIAO, SỬA DEFECT LIST",
  ];
  for (const note of bay) {
    it(`KHÔNG xong: "${note.slice(0, 46)}…"`, () => expect(noteSaysDelivered(note)).toBe(false));
  }

  it("note rỗng → không xong", () => {
    expect(noteSaysDelivered("")).toBe(false);
  });

  it('"đã" gắn với động từ KHÁC thì không tính (đây là ca dễ sai nhất)', () => {
    // "đã trượt", "đã chốt" — có "đã", có "bàn giao", nhưng không đi cùng nhau.
    expect(noteSaysDelivered("Tiến độ bàn giao đã trượt")).toBe(false);
    expect(noteSaysDelivered("PMO: đã chốt chủ trường, cần PM lập lại tiến độ")).toBe(false);
  });

  it("QUÁ 1 từ đệm thì KHÔNG tính — chặt có chủ đích, đừng nới khi thấy test này", () => {
    // Nới dung sai lên 2+ từ là đổi chiều rủi ro sang hướng đắt hơn:
    //  - Luật chặt sai  → dự án xong vẫn hiện navy. PMO NHÌN THẤY ngay, báo là sửa.
    //  - Luật lỏng sai  → dự án ĐANG TRỄ âm thầm thành xanh, cảnh báo biến mất. KHÔNG
    //                     ai thấy, tới lúc vỡ tiến độ mới lộ.
    // Gặp note thật bị bỏ sót thì thêm nguyên văn nó vào nhóm "đã xong" ở trên rồi mở
    // rộng luật cho vừa đúng ca đó — KHÔNG nới chung chung.
    expect(noteSaysDelivered("Dự án đã chính thức bàn giao")).toBe(false);
  });
});
