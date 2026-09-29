/**
 * THANH LỌC KHÔNG ĐƯỢC TRÀN THÊM HÀNG — chặn `L11` tái phát lần thứ ba.
 *
 * L11 đã xảy ra HAI lần, cùng một kiểu: thêm một bộ lọc vào thanh lọc mà không nới số ô của grid.
 *   · lần 1 — thêm bộ lọc "Chủ đầu tư"  → tràn 3 hàng, sửa ở commit `7a26e27`
 *   · lần 2 — thêm bộ lọc "Bình luận"   → tràn 3 hàng, sửa ở commit `2f43087`
 * Cả hai lần diff đều sạch, bộ kiểm đều xanh, và giao diện vẫn hỏng — người dùng là người phát hiện.
 *
 * ── VÌ SAO KHÔNG ĐẾM SỐ HÀNG THẬT ─────────────────────────────────────────────────────────────
 * Cách đúng nhất là dựng thanh lọc rồi gom `offsetTop` của từng ô grid. Nhưng vitest chạy trên
 * node, và **jsdom KHÔNG tính bố cục**: nó không dựng CSS grid, `offsetTop` luôn trả 0. Một phép
 * kiểm đếm hàng viết trên jsdom sẽ LUÔN XANH — tức là một phép kiểm trang trí, tệ hơn không có.
 * Ai định "nâng cấp" file này sang jsdom thì đọc lại đoạn này trước.
 *
 * Nên file này chốt thứ KIỂM ĐƯỢC mà vẫn bắt đúng kiểu hỏng đã xảy ra hai lần: **số ô khai trong
 * grid phải đủ cho số phần tử đang xếp vào đó**. Thêm bộ lọc thứ 10 mà quên nới `xl:grid-cols-[…]`
 * là ĐỎ ngay, trước khi ai kịp deploy.
 *
 * ── CHỖ NÓ KHÔNG THAY ĐƯỢC ────────────────────────────────────────────────────────────────────
 * Phép kiểm này KHÔNG biết thanh lọc trông ra sao. Nó không bắt được: ô quá rộng làm tràn ngang,
 * nhãn dài làm vỡ chữ, hay khoảng cách xấu. Trước mỗi lần deploy vẫn phải mở app thật và đếm số
 * hàng bằng `offsetTop` ở 1920 / 1440 / 1280 px (phải ra 1 hàng) và 1100 / 1024 px (2 hàng là
 * đúng). Đếm nhớ gộp cả con của lớp bọc `md:contents` — `container.children` chỉ trả về 3 phần tử
 * vì lớp bọc ấy tan vào grid, đếm hụt là tưởng nhầm đang 1 hàng.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Kết quả soi một khối JSX thanh lọc. */
type SoiThanhLoc = {
  oMd: number;        // số ô grid khai ở breakpoint md
  oXl: number;        // số ô grid khai ở breakpoint xl
  soPhanTu: number;   // số phần tử thật sự xếp vào grid khi ở md trở lên
  ten: string[];      // tên từng phần tử, để thông điệp lỗi chỉ đúng chỗ
};

/**
 * Rút số ô grid và số phần tử từ mã nguồn thanh lọc.
 *
 * Tách riêng thành hàm THUẦN để chính nó kiểm được bằng chuỗi tự dựng — nhờ vậy file này tự chứng
 * minh mình có răng, không cần sửa mã sản phẩm để thử.
 */
export function soiThanhLoc(src: string): SoiThanhLoc | null {
  // Neo vào chính khai báo grid của thanh lọc. Đổi cách khai thì phép kiểm ĐỎ chứ không âm thầm xanh.
  const moKhoi = /<div className="[^"]*xl:grid-cols-\[[^"]*"[^>]*>/.exec(src);
  if (!moKhoi) return null;

  const dem = (s: string) => (s.match(/_/g) ?? []).length + 1; // "a_auto_auto" → 3 ô
  const lay = (bp: string) => {
    const m = new RegExp(bp + ":grid-cols-\\[([^\\]]*)\\]").exec(moKhoi[0]);
    return m ? dem(m[1]) : 0;
  };

  // Thân khối: từ sau thẻ mở tới thẻ đóng của chính nó, bám theo độ sâu thẻ <div>.
  let i = moKhoi.index + moKhoi[0].length;
  let sau = 1;
  const batDau = i;
  while (i < src.length && sau > 0) {
    const mo = src.indexOf("<div", i);
    const dong = src.indexOf("</div>", i);
    if (dong < 0) break;
    if (mo >= 0 && mo < dong) { sau++; i = mo + 4; } else { sau--; i = dong + 6; }
  }
  const than = src.slice(batDau, i);

  // Phần tử xếp vào grid khi ở md trở lên:
  //   · ô tìm (thẻ div đầu khối)
  //   · mỗi <MultiSelect …>
  //   · nút "Cần cập nhật MP"
  // Nút "Bộ lọc (n)" KHÔNG tính: nó mang `md:hidden` nên ở md trở lên không chiếm ô nào.
  const ten: string[] = ["ô tìm"];
  for (const m of than.matchAll(/<MultiSelect\s[\s\S]*?label="([^"]+)"/g)) ten.push(m[1]);
  if (/Cần cập nhật MP/.test(than)) ten.push("Cần cập nhật MP");

  return { oMd: lay("md"), oXl: lay("xl"), soPhanTu: ten.length, ten };
}

const nguon = readFileSync(fileURLToPath(new URL("../src/routes/index.tsx", import.meta.url)), "utf8");

describe("THANH LỌC — số ô grid phải đủ cho số bộ lọc (chặn L11 lần thứ ba)", () => {
  it("tìm được khối thanh lọc trong index.tsx — không tìm được là ĐỎ, không phải bỏ qua", () => {
    // Nếu ai đổi cách khai grid mà phép kiểm âm thầm xanh thì nó thành đồ trang trí. Chặn ngay đây.
    expect(soiThanhLoc(nguon), "không thấy khối grid có `xl:grid-cols-[…]` — đổi cách khai thì sửa cả phép kiểm này").not.toBeNull();
  });

  it("breakpoint xl: số ô grid phải BẰNG ĐÚNG số phần tử — thêm bộ lọc thì phải nới ô", () => {
    const s = soiThanhLoc(nguon)!;
    expect(
      s.oXl,
      `xl khai ${s.oXl} ô nhưng thanh lọc có ${s.soPhanTu} phần tử (${s.ten.join(" · ")}).\n` +
        `Thiếu ô thì phần tử cuối rớt xuống hàng hai — đúng L11, đã xảy ra hai lần.\n` +
        `Thừa ô thì có ô mồ côi kéo giãn hàng. Sửa xl:grid-cols-[…] cho khớp số phần tử.`,
    ).toBe(s.soPhanTu);
  });

  it("breakpoint md: xếp gọn trong 2 hàng, và hàng cuối không được chỉ có 1 ô mồ côi", () => {
    const s = soiThanhLoc(nguon)!;
    const soHang = Math.ceil(s.soPhanTu / s.oMd);
    const oHangCuoi = s.soPhanTu - s.oMd * (soHang - 1);
    expect(soHang, `md khai ${s.oMd} ô cho ${s.soPhanTu} phần tử → ${soHang} hàng. Quá 2 hàng là ăn hết màn hình trước khi thấy dữ liệu.`).toBeLessThanOrEqual(2);
    if (soHang === 2) {
      expect(oHangCuoi, `hàng cuối chỉ có ${oHangCuoi} ô giữa ${s.oMd} ô — nhìn như lỗi. Chọn số ô chia cho đều hơn.`).toBeGreaterThan(1);
    }
  });

  it("ĐỐI CHỨNG: phép soi thật sự bắt được cảnh 'thêm bộ lọc mà quên nới ô'", () => {
    // Không có phép này thì ba phép trên xanh mà chẳng chứng minh điều gì. Dựng một thanh lọc giả
    // đúng hình dạng thật nhưng THIẾU một ô, xem phép soi có kêu không.
    const gia = `
      <div className="grid gap-1.5 md:grid-cols-[minmax(160px,1fr)_auto] xl:grid-cols-[minmax(200px,1fr)_auto]">
        <div className="relative"><input /></div>
        <button className="md:hidden">Bộ lọc</button>
        <div className="md:contents">
          <MultiSelect label="PM" selected={a} />
          <MultiSelect label="Vùng" selected={b} />
          <button>Cần cập nhật MP</button>
        </div>
      </div>`;
    const s = soiThanhLoc(gia)!;
    expect(s.oXl).toBe(2);          // khai 2 ô
    expect(s.soPhanTu).toBe(4);     // nhưng có 4 phần tử: ô tìm · PM · Vùng · Cần cập nhật MP
    expect(s.oXl).not.toBe(s.soPhanTu);   // → phép kiểm thứ hai sẽ ĐỎ ở bản như thế này
  });

  it("ĐỐI CHỨNG: đổi cách khai grid thì phép soi trả null chứ không lặng lẽ cho qua", () => {
    expect(soiThanhLoc(`<div className="flex flex-wrap gap-2"><MultiSelect label="PM" /></div>`)).toBeNull();
  });
});
