/**
 * HÀNG ĐỢI CHẶN SỐ LƯỢT CHẠY CÙNG LÚC.
 *
 * Vì sao có: màn MTLĐ bày 21 thẻ, mỗi thẻ bắt máy chủ tải nguyên một file PDF rồi mã hoá lại.
 * Hai mươi mốt cái cùng lúc thì Worker chạm trần bộ nhớ và Cloudflare trả lỗi 1102 — đã xảy ra
 * thật trên bản chính thức ngày 29/09/2026, hai lần, đều ngay sau một lượt mở màn MTLĐ.
 *
 * WHILE CHỨ KHÔNG PHẢI IF — đây là chỗ bản vá đầu làm sai:
 * ```
 * SAI   if (dangChay >= max) await doi();     // tỉnh dậy là tăng thẳng
 * ĐÚNG  while (dangChay >= max) await doi();  // tỉnh dậy phải XÉT LẠI
 * ```
 * Đánh thức người đợi chỉ XẾP LỊCH chứ không chạy ngay. Xen vào khoảng đó, một lượt khác có thể
 * thấy chỗ trống và đi luôn; lúc người đợi tỉnh dậy mà tăng thẳng thì số lượt chạy cùng lúc vượt
 * quá trần. Lỗi kinh điển của cổng đếm, và phép kiểm trong tests/hang-doi.test.ts gác đúng chỗ đó.
 *
 * HẠN GIỜ: quá hạn thì NHẢ CHỖ cho hàng chạy tiếp, dù lượt đó chưa xong. Không có chốt này thì
 * một lượt treo mãi là cả hàng đứng im và mọi thẻ bên dưới kẹt ở "Đang tải chart…" vĩnh viễn.
 * Đổi lại có lúc dôi ra quá trần trong chốc lát — thà vậy còn hơn khoá chết cả màn.
 *
 * Lượt nào NÉM LỖI vẫn phải nhả chỗ, nếu không hàng cạn dần rồi tắc hẳn.
 *
 * MỘT CHỖ BIẾT TRƯỚC, chưa sửa vì chưa cần: người đợi tỉnh dậy mà vẫn hết chỗ thì tự đẩy mình
 * xuống CUỐI hàng, nên về lý thuyết có thể bị vượt mặt mãi. Với trần 2 và số việc hữu hạn (21 thẻ)
 * thì hàng vẫn cạn, nên để nguyên. Ai nâng trần hoặc đem hàng này sang chỗ có việc chảy vào liên
 * tục thì phải đổi sang xếp theo thứ tự đến trước.
 */

export type HangDoi = {
  /** Xếp hàng chạy `viec`. Trả về đúng thứ `viec` trả về, ném đúng thứ `viec` ném. */
  <T>(viec: () => Promise<T>): Promise<T>;
};

export function taoHangDoi(max: number, hanGiay = 45): HangDoi {
  let dangChay = 0;
  const doi: (() => void)[] = [];
  return async function xepHang<T>(viec: () => Promise<T>): Promise<T> {
    while (dangChay >= max) await new Promise<void>((ok) => doi.push(ok));
    dangChay++;
    let daNha = false;
    const nha = () => {
      if (daNha) return;
      daNha = true;
      dangChay--;
      doi.shift()?.();
    };
    const dongHo = hanGiay > 0 ? setTimeout(nha, hanGiay * 1000) : null;
    try {
      return await viec();
    } finally {
      if (dongHo !== null) clearTimeout(dongHo);
      nha();
    }
  };
}
