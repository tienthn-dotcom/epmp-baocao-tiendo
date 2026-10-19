/* NHÃN CỘT ĐƠN VỊ của ma trận bàn giao.
 *
 * Anh Tiến 19/10/2026, ảnh chụp Hyatt Hạ Long: *"2.1, với 2.2 bị lỗi, không up clip vào được"*.
 * Hai cột đó là CĂN CHÈN giữa 02 và 03. Luật cũ chỉ nhận số nguyên nên app coi chúng không phải
 * căn: bấm vào thì hiện "Ô này không phải căn" và không mở được cửa tải ảnh/clip.
 *
 * Luật này dùng CHUNG cho hai nơi (sheet-dump vẽ ô, can-media-app bắt click). Lệch nhau là ra
 * đúng cảnh ô có màu mà bấm vào lại báo không phải căn, nên khoá lại ở đây.
 */
import { describe, expect, it } from "vitest";
import { RE_DON_VI } from "@/lib/sheet-dump";

const nhan = (t: string) => RE_DON_VI.test(t);

describe("nhãn cột đơn vị", () => {
  it("số phòng thường", () => {
    for (const t of ["1", "01", "02", "7", "16", "255"]) expect(nhan(t), t).toBe(true);
  });

  /* Ca của anh Tiến. */
  it("căn chèn dạng số lẻ", () => {
    for (const t of ["2.1", "2.2", "10.1", "2-1"]) expect(nhan(t), t).toBe(true);
  });

  it("hành lang", () => {
    expect(nhan("HL")).toBe(true);
    expect(nhan("hl")).toBe(true);
  });

  /* Cột KHÔNG phải căn phải bị loại, nếu không thì cột %, cột chú giải cũng thành căn và sinh ra
     "phòng ma" trong kho ảnh trên Drive. */
  it("loại cột không phải căn", () => {
    for (const t of ["", " ", "%", "0%", "85%", "Tổng", "Luỹ kế", "PHÒNG", "Màu", "Diễn giải",
      "1234", "2.", ".2", "2.123", "1.2.3", "B1", "X"]) expect(nhan(t), t).toBe(false);
  });
});
