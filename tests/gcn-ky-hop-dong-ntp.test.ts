/* MÃ "GCN" = KÝ HỢP ĐỒNG NTP — phải được nạp, không bị bỏ như mã lạ.
 *
 * Anh Tiến 09/10/2026: *"hiện trong file nguồn có thêm dòng GCN có mã là GCN -> tên là Ký hợp đồng
 * NTP, cho lên app luôn nhé, show full"*.
 *
 * Đo file nguồn thật ngày 09/10/2026 TRƯỚC khi sửa: 6 dòng mã GCN ở 6 dự án, và CẢ SÁU bị
 * `continue` ở nhánh "mã không thuộc nhóm giai đoạn nào" — trên app sáu đầu việc đó coi như không
 * tồn tại. Mất kiểu này KHÔNG báo lỗi: bảng vẫn vẽ, dự án vẫn có đủ các giai đoạn khác, chỉ thiếu
 * đúng việc ký hợp đồng nhà thầu phụ — tức mốc đang chặn cả chuỗi sau nó.
 *
 * Bộ kiểm này canh HAI đầu:
 *   1. GCN vào được `items`, mang stage "Khác" (KHÔNG tự phong nó thành giai đoạn thứ tám).
 *   2. Mã thật sự lạ VẪN bị bỏ và VẪN bị cổng dữ liệu kêu — nới allowlist không được nới thành
 *      "nhận tất", vì khi file đổi quy ước mã thì phải lộ ra chứ không nuốt im lặng.
 */
import { describe, expect, it } from "vitest";
import { parseTimelineRows } from "@/lib/parser";

const REF = "2026-10-09";

/** Lưới Timeline tối giản: tiêu đề ở dòng 6 (index 5), rồi 1 dòng dự án + các dòng con theo `ma`. */
function luoi(con: Array<{ ma: string; moTa: string; pct?: unknown }>): unknown[][] {
  const rows: unknown[][] = [];
  for (let i = 0; i < 7; i++) rows.push([]);
  const header: unknown[] = new Array(21).fill(null);
  header[4] = "Show"; header[11] = "Mã"; header[12] = "Mô tả";
  header[13] = "Người phụ trách chính"; header[14] = "Bắt đầu"; header[15] = "Kết thúc";
  header[18] = "% thực tế"; header[20] = "Vướng mắc / Cần xử lý";
  rows[5] = header;

  const cha: unknown[] = new Array(21).fill(null);
  cha[4] = "show"; cha[5] = "Dự án A"; cha[6] = "Chủ ĐT"; cha[7] = "CT-A"; cha[11] = "CT-A";
  rows.push(cha);

  for (const c of con) {
    const r: unknown[] = new Array(21).fill(null);
    r[4] = "show"; r[11] = c.ma; r[12] = c.moTa; r[13] = "TĐT - Mr Minh";
    r[15] = "30/08/2026"; r[18] = c.pct ?? "25%";
    rows.push(r);
  }
  return rows;
}

const kiemMaLa = (d: ReturnType<typeof parseTimelineRows>) =>
  d.quality?.checks.find((c) => c.id === "unknownPrefix");

describe("mã GCN", () => {
  it("được nạp lên app, KHÔNG bị bỏ", () => {
    const d = parseTimelineRows(luoi([{ ma: "GCN", moTa: "Ký hợp đồng NTP" }]), REF);
    expect(d.items.map((i) => i.rawCode)).toEqual(["GCN"]);
    expect(d.items[0].desc).toBe("Ký hợp đồng NTP");
  });

  it('mang giai đoạn "Khác" — không phải giai đoạn thứ tám', () => {
    const d = parseTimelineRows(luoi([{ ma: "GCN", moTa: "Ký hợp đồng NTP" }]), REF);
    expect(d.items[0].stage).toBe("Khác");
  });

  it("cổng dữ liệu KHÔNG còn kêu GCN là mã bị bỏ", () => {
    const d = parseTimelineRows(luoi([{ ma: "GCN", moTa: "Ký hợp đồng NTP" }]), REF);
    const chk = kiemMaLa(d);
    expect((chk?.items ?? []).join(" ")).not.toContain("GCN");
  });

  it("đứng cạnh các giai đoạn khác thì không đụng gì tới chúng", () => {
    const d = parseTimelineRows(
      luoi([
        { ma: "TK-01", moTa: "Phát hành thiết kế" },
        { ma: "GCN", moTa: "Ký hợp đồng NTP" },
        { ma: "SX-01", moTa: "Sản xuất nhập kho" },
      ]),
      REF,
    );
    expect(d.items.map((i) => i.rawCode)).toEqual(["TK-01", "GCN", "SX-01"]);
    expect(d.items.map((i) => i.stage)).toEqual(["Phát hành thiết kế", "Khác", "Sản xuất nhập kho"]);
  });

  /* GCN đã xong 100% thì ẩn y như mọi dòng xong khác — luật cũ của app, không có ngoại lệ cho
     mã mới. Đo file thật 09/10: 2 trong 6 dòng GCN đang 100% (THV Nhà hàng Tây Ban Nha & Italia). */
  it("GCN 100% bị lọc khỏi bảng như mọi dòng đã xong", () => {
    const d = parseTimelineRows(luoi([{ ma: "GCN", moTa: "Ký hợp đồng NTP", pct: "100%" }]), REF);
    expect(d.items.length).toBe(0);
  });

  /* CHỐT CHẶN NGƯỢC: nới allowlist cho GCN KHÔNG được biến nó thành "nhận mọi mã". */
  it("mã lạ thật sự VẪN bị bỏ và VẪN bị kêu", () => {
    const d = parseTimelineRows(luoi([{ ma: "XYZ-99", moTa: "Việc gì không rõ" }]), REF);
    expect(d.items.length).toBe(0);
    expect((kiemMaLa(d)?.items ?? []).join(" ")).toContain("XYZ-99");
  });

  /* Mã trong file có thể gõ hoa/thường lẫn lộn — khớp phải không phân biệt. */
  it("gõ thường vẫn nhận", () => {
    const d = parseTimelineRows(luoi([{ ma: "gcn", moTa: "Ký hợp đồng NTP" }]), REF);
    expect(d.items.length).toBe(1);
  });

  /* MÃ CÓ SỐ ĐUÔI vẫn nhận — file nguồn đánh số mã theo dòng ("TC01", "TKSX1", "TK-01"), nên
     allowlist khớp theo ĐẦU MÃ y như mọi mã khác, không đòi mã trần. */
  it('mã có đuôi ("GCN01") vẫn nhận, vẫn "Khác"', () => {
    const d = parseTimelineRows(luoi([{ ma: "GCN01", moTa: "Ký hợp đồng NTP" }]), REF);
    expect(d.items.length).toBe(1);
    expect(d.items[0].stage).toBe("Khác");
  });
});
