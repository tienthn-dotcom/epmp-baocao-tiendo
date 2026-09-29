/**
 * HÀNG ĐỢI CHẶN SỐ LƯỢT CHẠY CÙNG LÚC — phép kiểm gác lỗi đã lọt lên bản chính thức.
 *
 * Bản vá lỗi 1102 ngày 29/09/2026 viết `if (dangChay >= max) await doi()` thay vì `while`. Box
 * Review bắt được khi hậu kiểm. Phép kiểm "hai lượt gọi liên tiếp" KHÔNG bắt được lỗi đó — phải
 * dựng đúng cảnh: một lượt xen vào giữa lúc người đợi đang được đánh thức.
 */
import { describe, it, expect } from "vitest";
import { taoHangDoi } from "@/lib/hang-doi";

/** Đo số lượt chạy cùng lúc CAO NHẤT mà hàng đợi để lọt. */
function doDem() {
  let dang = 0, cao = 0;
  return {
    get cao() { return cao; },
    viec: (ms: number) => async () => {
      dang++; cao = Math.max(cao, dang);
      await new Promise((r) => setTimeout(r, ms));
      dang--;
      return ms;
    },
  };
}

describe("không bao giờ vượt trần", () => {
  it("thả 21 lượt một lúc, trần 2 → cao nhất đúng 2", async () => {
    const q = taoHangDoi(2);
    const d = doDem();
    await Promise.all(Array.from({ length: 21 }, () => q(d.viec(5))));
    expect(d.cao).toBe(2);
  });

  it("trần 1 → chạy lần lượt, không bao giờ có 2 lượt cùng lúc", async () => {
    const q = taoHangDoi(1);
    const d = doDem();
    await Promise.all(Array.from({ length: 8 }, () => q(d.viec(3))));
    expect(d.cao).toBe(1);
  });

  it("LƯỢT XEN ĐÚNG KHE cũng không làm vượt trần — ca mà bản vá đầu làm sai", async () => {
    /* ĐÂY LÀ PHÉP KIỂM CÓ RĂNG, và cái khe phải dựng cho đúng mới bắt được.
     *
     * Thả 21 lượt một lúc rồi đếm KHÔNG bắt được lỗi `if` — đã thử, vẫn xanh. Lý do: người đợi
     * được đánh thức bằng một vi tác vụ nằm CUỐI hàng, nên bình thường không ai chen vào giữa
     * lúc chỗ vừa trống và lúc người đợi tỉnh dậy.
     *
     * Khe thật nằm ở đây: gắn thêm một `.then` vào CHÍNH cái promise mà việc đang chạy trả về.
     * Khi promise đó xong, hai thứ được xếp lịch liền nhau —
     *   1. đoạn tiếp của hàng đợi (nhả chỗ: trừ số đang chạy, rồi đánh thức người đợi ở CUỐI hàng)
     *   2. `.then` của phép kiểm  ← chạy NGAY SAU, tức sau khi chỗ đã trống, trước khi người đợi tỉnh
     * Lượt mới gọi ở bước 2 thấy còn chỗ nên đi thẳng. Người đợi tỉnh sau: viết `while` thì nó
     * xét lại và nằm xuống tiếp; viết `if` thì nó tăng thẳng → ba lượt chạy cùng lúc.
     *
     * Đổi `while` thành `if` trong lib/hang-doi.ts thì ca này PHẢI đỏ. Ai sửa hàng đợi mà thấy nó
     * vẫn xanh trong cả hai cách viết thì phép kiểm đã mất răng, dựng lại cái khe. */
    const q = taoHangDoi(1, 0);
    let dang = 0, cao = 0;
    const chay = async (ms: number) => {
      dang++; cao = Math.max(cao, dang);
      await new Promise((r) => setTimeout(r, ms));
      dang--;
    };

    /* `viec` phải TRẢ VỀ ĐÚNG `trong`, không được bọc trong một hàm async khác: bọc lại là hàng
       đợi chờ một promise KHÁC, và `.then` của phép kiểm chạy sớm hơn cả lúc chỗ được nhả — khe
       trượt mất, phép kiểm xanh cả hai cách viết. Đã vấp đúng chỗ này một lần. */
    const trong = new Promise((r) => setTimeout(r, 5));
    const t1 = q(() => trong);                       // chiếm chỗ
    const nguoiDoi = q(() => chay(5));               // nằm đợi
    const xenVao: Promise<unknown>[] = [];
    trong.then(() => { xenVao.push(q(() => chay(5))); });   // xen đúng khe

    await Promise.all([t1, nguoiDoi]);
    await Promise.all(xenVao);
    expect(cao).toBe(1);
  });
});

describe("không được tắc hàng", () => {
  it("lượt NÉM LỖI vẫn nhả chỗ, các lượt sau vẫn chạy", async () => {
    const q = taoHangDoi(1);
    const ra: string[] = [];
    const hong = q(async () => { throw new Error("hỏng"); }).catch(() => ra.push("bắt được lỗi"));
    const sau = q(async () => { ra.push("lượt sau vẫn chạy"); });
    await Promise.all([hong, sau]);
    // KHÔNG xét thứ tự: chỗ bắt lỗi nằm ở một nhịp vi tác vụ khác, hai cái có thể đảo nhau.
    // Thứ cần gác là "lượt sau VẪN CHẠY", tức chỗ đã được nhả dù lượt trước ném lỗi.
    expect(ra).toContain("lượt sau vẫn chạy");
    expect(ra).toContain("bắt được lỗi");
  });

  it("một lượt TREO MÃI thì quá hạn là nhả chỗ, hàng chạy tiếp", async () => {
    const q = taoHangDoi(1, 0.02);            // hạn 20ms cho nhanh
    let xong = false;
    void q(() => new Promise(() => { /* không bao giờ xong */ }));
    await q(async () => { xong = true; });
    expect(xong).toBe(true);
  });
});

describe("trả về đúng thứ việc trả về", () => {
  it("giữ nguyên giá trị và giữ nguyên lỗi", async () => {
    const q = taoHangDoi(2);
    await expect(q(async () => 42)).resolves.toBe(42);
    await expect(q(async () => { throw new Error("y nguyên"); })).rejects.toThrow("y nguyên");
  });

  it("chạy đủ MỌI lượt, không nuốt cái nào", async () => {
    const q = taoHangDoi(3);
    const ra = await Promise.all(Array.from({ length: 12 }, (_, i) => q(async () => i)));
    expect(ra).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});
