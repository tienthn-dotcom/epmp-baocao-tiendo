/* GIỮ DẤU DANH TÍNH — `dongDauDanhChi` không được đè dấu khi mỏ neo nói khác.
 *
 * Vì sao phải có luật này: đo ngày 05/10/2026 trên nguồn thật, 34 ghi chú đang hiện ở dòng của một
 * DỰ ÁN KHÁC với dự án ghi trên dấu. Hàm đóng dấu lại ghi đè vô điều kiện bằng danh tính của DÒNG
 * ĐANG HIỂN THỊ. Nghĩa là mỗi lần admin mở app, 34 cái dấu đó bị viết lại theo dòng sai — xoá mất
 * bằng chứng cuối cùng để tra về đúng chỗ. Mỏ neo thì ghi một lần rồi giữ, nên nó là lời khai gốc.
 *
 * Sai ở đây hỏng theo kiểu KHÔNG AI THẤY, và hỏng theo cả hai chiều:
 *   · lỏng quá → bằng chứng bị xoá dần, mỗi ngày một ít, tới lúc cần thì không còn gì;
 *   · chặt quá → chặn nhầm cả những ô chỉ đang THIẾU dấu, mà đóng dấu mới là việc chính của hàm.
 * Nên khoá bằng test, với ĐÚNG định dạng hai kho đang ghi trong thực tế.
 */
import { describe, expect, it } from "vitest";
import { goi4, soKhac } from "@/lib/note-lac";

/* Định dạng THẬT, chép từ index.tsx:
 *   mỏ neo  cấp hạng mục : maCT||tênDA||giai đoạn||mô tả            (4 trường)
 *   dấu dc  cấp hạng mục : maCT||tênDA||giai đoạn||mô tả||RID       (5 trường)
 *   mỏ neo  cấp dự án    : maCT||tênDA||__DUAN__                    (3 trường)
 *   dấu dc  cấp dự án    : maCT||tênDA||__DUAN__||""||RID           (5 trường, trường 4 RỖNG)   */
const neoHangMuc = "CT26-011||Trục Đông Tây 2C||Triển khai sản xuất||triển khai sản xuất";
const dcHangMuc = "CT26-011||Trục Đông Tây 2C||Triển khai sản xuất||triển khai sản xuất||ePMP530";
const neoDuAn = "CT26-011||Trục Đông Tây 2C||__DUAN__";
const dcDuAn = "CT26-011||Trục Đông Tây 2C||__DUAN__||||ePMP28";

describe("goi4 — cắt 4 trường, bỏ trường rỗng ở đuôi", () => {
  it("cấp dự án: mỏ neo 3 trường và dc 5 trường rút về CÙNG một chuỗi", () => {
    expect(goi4(neoDuAn)).toBe(goi4(dcDuAn));
  });
  it("cấp hạng mục: bỏ đúng phần RID, giữ nguyên 4 trường đầu", () => {
    expect(goi4(dcHangMuc)).toBe(neoHangMuc);
  });
  it("không nuốt trường rỗng NẰM GIỮA", () => {
    expect(goi4("CT26-011||||Thi công lắp đặt||mô tả")).toBe("CT26-011||||Thi công lắp đặt||mô tả");
  });
  it("chuỗi rỗng / undefined → rỗng", () => {
    expect(goi4(undefined)).toBe("");
    expect(goi4("")).toBe("");
    expect(goi4("||||")).toBe("");
  });
});

describe("soKhac — có nên chặn lượt đè dấu không", () => {
  it("KHÔNG chặn khi chưa có mỏ neo — ô thiếu dấu vẫn phải được điền", () => {
    expect(soKhac(undefined, dcHangMuc)).toBe(false);
    expect(soKhac("", dcHangMuc)).toBe(false);
  });
  it("KHÔNG chặn khi mỏ neo và dấu mới cùng một dòng (cấp hạng mục)", () => {
    expect(soKhac(neoHangMuc, dcHangMuc)).toBe(false);
  });
  it("KHÔNG chặn ở CẤP DỰ ÁN — hai kho khác độ dài, so thẳng là lệch giả", () => {
    // Đây là cái bẫy: nếu so nguyên chuỗi thì mọi note cấp dự án đều bị chặn, chặn im lặng.
    expect(soKhac(neoDuAn, dcDuAn)).toBe(false);
  });
  it("CHẶN khi dấu mới trỏ sang DỰ ÁN KHÁC — đúng 34 ca đo được 05/10", () => {
    const dcSaiDuAn = "CT26-129||APEC_S4_Vách modular đại trà||Triển khai sản xuất||triển khai sản xuất||ePMP900";
    expect(soKhac(neoHangMuc, dcSaiDuAn)).toBe(true);
  });
  it("CHẶN khi cùng dự án nhưng khác GIAI ĐOẠN", () => {
    const dcSaiGd = "CT26-011||Trục Đông Tây 2C||Sản xuất nhập kho||sản xuất nhập kho||ePMP531";
    expect(soKhac(neoHangMuc, dcSaiGd)).toBe(true);
  });
  it("CHẶN khi tên dự án đổi — để người xem quyết, không tự đè", () => {
    const dcDoiTen = "CT26-011||Trục Đông Tây 2C_Phòng (F12)||Triển khai sản xuất||triển khai sản xuất||ePMP530";
    expect(soKhac(neoHangMuc, dcDoiTen)).toBe(true);
  });
  it("RID đổi mà 4 trường đầu y nguyên → KHÔNG chặn (nguồn vừa đánh lại RID là chuyện bình thường)", () => {
    // Anh Tiến sửa sạch RID trùng ngày 05/10: nhiều dòng được cấp số mới. Dấu phải cập nhật theo,
    // nếu không thì sửa nguồn xong là cả kho dấu đứng im với số RID đã chết.
    const dcRidMoi = "CT26-011||Trục Đông Tây 2C||Triển khai sản xuất||triển khai sản xuất||ePMP1207";
    expect(soKhac(neoHangMuc, dcRidMoi)).toBe(false);
  });
});
