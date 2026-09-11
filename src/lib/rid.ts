/**
 * RID — SỐ ĐỊNH DANH DÒNG do PMO tự cắm, kiểu như số căn cước: mỗi dòng một số, cắm rồi là theo
 * dòng đó suốt đời. Đây là ĐỊA CHỈ BỀN NHẤT của một đầu việc.
 *
 * App giữ BỐN ĐỊA CHỈ cho mỗi dòng, ưu tiên từ bền tới mong manh:
 *
 *     rid:<số>  →  h:<IDCUNG>  →  id:<STT>  →  mã+tên+giai đoạn
 *
 * Ghi chú nằm ở địa chỉ nào thì đọc ra từ địa chỉ đó — KHÔNG dời hàng loạt. Dời cả kho một lượt là
 * canh bạc: sai một phép ánh xạ thì note nhảy sang dự án khác, mà nhảy rồi thì không biết đường lần
 * về. Cứ để chúng chuyển dần khi có người sửa, còn RID nằm sẵn đó làm lưới đỡ.
 *
 * KHOÁ CHỈ LẤY PHẦN SỐ. RID là một CON SỐ; "1", "ePMP1", "ePMP 1" là cùng một dòng, chỉ khác cách
 * trang trí. Bám nguyên chữ thì mỗi lần nguồn đổi cách ghi tiền tố là cả kho note mất địa chỉ —
 * đúng chuyện đã xảy ra ngày 10/09. Lấy phần số thì đổi tiền tố kiểu gì địa chỉ vẫn y nguyên.
 */

/** Phần SỐ của RID — địa chỉ thật. "ePMP 682" · "ePMP682" · "682" → "682". */
export function ridSo(rid: string): string {
  const so = rid.replace(/\D+/g, "");
  return so.replace(/^0+(?=\d)/, "");   // "007" và "7" là một
}

/** Dạng chuẩn khi RID KHÔNG có chữ số nào (hiếm) — giữ chữ, bỏ khoảng trắng, in hoa. */
export function ridChuan(rid: string): string {
  return rid.trim().replace(/\s+/g, "").toUpperCase();
}

/**
 * Các địa chỉ `rid:` của một dòng, theo thứ tự ưu tiên:
 *   1. phần số — đích GHI, và là địa chỉ bền qua mọi lần đổi cách ghi;
 *   2. dạng chuẩn có chữ ("EPMP682") — note ghi trong giai đoạn 10/09 nằm ở đây;
 *   3. đúng chữ trong file — phòng bản ghi cũ hơn nữa.
 * Trả mảng rỗng nếu dòng chưa cắm RID.
 */
export function ridKeys(rid: string | undefined | null): string[] {
  const raw = (rid ?? "").trim();
  if (!raw) return [];
  const ks: string[] = [];
  const them = (k: string) => { if (k && !ks.includes(k)) ks.push(k); };
  const so = ridSo(raw);
  if (so) them(`rid:${so}`);
  them(`rid:${ridChuan(raw)}`);
  them(`rid:${raw}`);
  return ks;
}
