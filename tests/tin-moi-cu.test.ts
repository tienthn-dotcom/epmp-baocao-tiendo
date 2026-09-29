/**
 * Ô VƯỚNG MẮC CẤP DỰ ÁN CHỈ CHIẾU MỘT TIN.
 *
 * Dựng đúng ca người dùng kể (28/09/2026):
 *   *"dữ liệu bên app nhập vào là ngày 23/09, mà trong ngày 25/09 có thông tin mới, tôi update vào,
 *   thì show lên thông tin mới hơn (tức là 25/09) mới là đúng... rồi cỡ tuần sau thông tin mới hơn
 *   được sync qua, là ngày 28/09 đi, thì khi sync qua ẩn cái cmt ngày 25/09 là đủ"*.
 */
import { describe, it, expect } from "vitest";
import { chiaTinMoiCu } from "@/lib/tin-moi-cu";
import { MSG_NGUON } from "@/lib/types";
import type { ChatMsg } from "@/lib/edits.functions";

const tin = (id: string, at: string, text = id): ChatMsg => ({ id, text, author: "a@b.com", at });
/** Tin của file nguồn: mốc `at` chỉ có NGÀY, không có giờ. */
const nguon = (at: string): ChatMsg => ({ id: MSG_NGUON, text: "câu của file nguồn", author: "", at });

describe("ca người dùng kể", () => {
  it("gõ 23/09 rồi gõ 25/09 → chiếu đúng tin 25/09", () => {
    const r = chiaTinMoiCu([tin("a", "2026-09-23T02:00:00.000Z"), tin("b", "2026-09-25T02:00:00.000Z")]);
    expect(r.moi.map((m) => m.id)).toEqual(["b"]);
    expect(r.cu.map((m) => m.id)).toEqual(["a"]);
  });

  it("nguồn sync tin 28/09 → chiếu tin nguồn, tin app 25/09 gấp lại", () => {
    const r = chiaTinMoiCu([nguon("2026-09-28"), tin("b", "2026-09-25T02:00:00.000Z")]);
    expect(r.moi[0].id).toBe(MSG_NGUON);
    expect(r.cu.map((m) => m.id)).toEqual(["b"]);
  });

  it("nguồn còn cũ hơn tin gõ trong app → chiếu tin app", () => {
    const r = chiaTinMoiCu([nguon("2026-09-23"), tin("b", "2026-09-25T02:00:00.000Z")]);
    expect(r.moi.map((m) => m.id)).toEqual(["b"]);
    expect(r.cu[0].id).toBe(MSG_NGUON);
  });

  it("cùng một ngày: tin gõ trong app mới hơn tin của file nguồn", () => {
    const r = chiaTinMoiCu([nguon("2026-09-25"), tin("b", "2026-09-25T02:00:00.000Z")]);
    expect(r.moi.map((m) => m.id)).toEqual(["b"]);
  });
});

describe("KHÔNG CHẮC THÌ KHÔNG GIẤU", () => {
  it("một tin thiếu mốc at → chiếu hết, không gấp cái nào", () => {
    const thieu: ChatMsg = { id: "x", text: "không có mốc", author: "a@b.com", at: "" };
    const r = chiaTinMoiCu([thieu, tin("b", "2026-09-25T02:00:00.000Z")]);
    expect(r.moi).toHaveLength(2);
    expect(r.cu).toHaveLength(0);
  });

  it("một tin thì để nguyên, ô rỗng thì không vỡ", () => {
    expect(chiaTinMoiCu([tin("a", "2026-09-23")]).cu).toHaveLength(0);
    expect(chiaTinMoiCu([]).moi).toHaveLength(0);
  });
});

describe("chỉ gấp khi nhìn, không đụng vào kho", () => {
  it("trả về đúng những tin đưa vào, không sửa, không đánh dấu ẩn", () => {
    const vao = [tin("a", "2026-09-23T02:00:00.000Z"), tin("b", "2026-09-25T02:00:00.000Z")];
    const ban = JSON.parse(JSON.stringify(vao));
    const r = chiaTinMoiCu(vao);
    expect(vao).toEqual(ban);
    expect([...r.moi, ...r.cu].every((m) => !m.hidden)).toBe(true);
    expect(r.moi.length + r.cu.length).toBe(vao.length);
  });

  it("chạy lại trên chính kết quả cũ vẫn ra một kết quả (hội tụ)", () => {
    const vao = [tin("a", "2026-09-23"), tin("b", "2026-09-25"), nguon("2026-09-24")];
    const l1 = chiaTinMoiCu(vao);
    const l2 = chiaTinMoiCu(vao);
    expect(l1).toEqual(l2);
  });
});

describe("ba tin trở lên", () => {
  it("chỉ tin mới nhất được chiếu, mọi tin còn lại gấp", () => {
    const r = chiaTinMoiCu([tin("a", "2026-09-23"), tin("c", "2026-09-28"), tin("b", "2026-09-25")]);
    expect(r.moi.map((m) => m.id)).toEqual(["c"]);
    expect(r.cu.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("hai tin trùng mốc thì tin đứng sau thắng, và chỉ MỘT tin được chiếu", () => {
    const r = chiaTinMoiCu([tin("a", "2026-09-25"), tin("b", "2026-09-25")]);
    expect(r.moi.map((m) => m.id)).toEqual(["b"]);
    expect(r.cu.map((m) => m.id)).toEqual(["a"]);
  });
});
