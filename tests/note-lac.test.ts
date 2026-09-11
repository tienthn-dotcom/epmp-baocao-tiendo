/**
 * GHI CHÚ MẤT ĐỊA CHỈ — thứ người dùng kêu là "note biến mất".
 * Công cụ dữ liệu đời trước chỉ soi ghi chú còn khoá sống (loại TRÔI), nên loại MẤT không nằm
 * trong danh sách nào. Bộ kiểm này chốt luật tìm lại + ba luật an toàn.
 */
import { describe, it, expect } from "vitest";
import { timNoteLac, dinh4, type NguonLac } from "@/lib/note-lac";

const TBP_MA = "CT26-007||Tiến Bộ Plaza_BP12_Public||Trình duyệt mẫu||duyệt mẫu";
const TBP_VT = "CT26-007||Tiến Bộ Plaza_BP12_Public||Đặt vật tư||đặt vật tư";
const THV_MA = "CT25-099||THV_Căn hộ 2B-L11||Trình duyệt mẫu||duyệt mẫu";

/** Dựng nguồn: `edits` là { khoá: dc }, `coChuDs` là các khoá có chữ. */
function nguon(edits: Record<string, string | undefined>, nay: Record<string, string>, neo: Record<string, string> = {}, coChuDs?: string[]): NguonLac {
  const co = new Set(coChuDs ?? Object.keys(edits));
  return {
    edits: Object.fromEntries(Object.entries(edits).map(([k, dc]) => [k, dc ? { dc } : {}])),
    neo, nay,
    coChu: (k) => co.has(k),
    trichDoan: (k) => `nội dung ${k}`,
  };
}

describe("dinh4", () => {
  it("bỏ phần RID để so được với mỏ neo đời cũ (chỉ có 4 phần)", () => {
    expect(dinh4("A||B||C||D||ePMP530")).toBe("A||B||C||D");
    expect(dinh4("A||B||C||D")).toBe("A||B||C||D");
    expect(dinh4(undefined)).toBe("");
  });
});

describe("timNoteLac", () => {
  it("khoá chết + danh tính khớp đúng một dòng → chỉ ra đích", () => {
    // RID 530 bị trùng nên app bỏ; dòng đó nay chạy bằng STT.
    const r = timNoteLac(nguon({ "rid:530": TBP_MA + "||ePMP530" }, { "id:77.3": TBP_MA }));
    expect(r).toHaveLength(1);
    expect(r[0].dich).toBe("id:77.3");
    expect(r[0].vuong).toBe("");
    expect(r[0].canGop).toBe(false);
  });

  it("khoá còn khớp một dòng → KHÔNG tính là mất (đó là loại trôi)", () => {
    const r = timNoteLac(nguon({ "id:77.3": TBP_MA }, { "id:77.3": TBP_MA }));
    expect(r).toHaveLength(0);
  });

  it("ghi chú rỗng (đã ẩn/xoá hết tin) thì bỏ qua", () => {
    const r = timNoteLac(nguon({ "rid:530": TBP_MA }, { "id:77.3": TBP_MA }, {}, []));
    expect(r).toHaveLength(0);
  });

  it("chưa có dấu danh tính thì lùi về MỎ NEO", () => {
    const r = timNoteLac(nguon({ "id:26.3": undefined }, { "id:27.3": TBP_MA }, { "id:26.3": TBP_MA }));
    expect(r[0].dich).toBe("id:27.3");
  });

  it("LUẬT 1 — danh tính ứng với NHIỀU dòng thì không đoán", () => {
    const r = timNoteLac(nguon({ "rid:530": TBP_MA }, { "id:77.3": TBP_MA, "id:99.3": TBP_MA }));
    expect(r[0].dich).toBeNull();
    expect(r[0].vuong).toContain("2 dòng");
  });

  it("LUẬT 2 — đích đang giữ ghi chú của DÒNG KHÁC thì không trộn", () => {
    const r = timNoteLac(nguon(
      { "rid:530": TBP_MA, "id:77.3": THV_MA },     // ô đích đang giữ ghi chú của THV
      { "id:77.3": TBP_MA },
    ));
    const x = r.find((y) => y.key === "rid:530")!;
    expect(x.dich).toBeNull();
    expect(x.vuong).toContain("dòng khác");
  });

  it("đích có ghi chú CÙNG DÒNG thì gộp được (một ô chứa nhiều tin)", () => {
    const r = timNoteLac(nguon(
      { "rid:530": TBP_MA + "||ePMP530", "id:77.3": TBP_MA },
      { "id:77.3": TBP_MA },
    ));
    const x = r.find((y) => y.key === "rid:530")!;
    expect(x.dich).toBe("id:77.3");
    expect(x.canGop).toBe(true);
  });

  it("LUẬT 3 — không có danh tính lẫn mỏ neo thì nói thẳng là chịu", () => {
    const r = timNoteLac(nguon({ "id:28.7d": undefined }, { "id:77.3": TBP_MA }));
    expect(r[0].dich).toBeNull();
    expect(r[0].vuong).toContain("chưa có dấu danh tính");
  });

  it("dòng cũ không còn trong nguồn (đã xoá / tắt Show) → báo đúng lý do", () => {
    const r = timNoteLac(nguon({ "rid:999": TBP_VT }, { "id:77.3": TBP_MA }));
    expect(r[0].dich).toBeNull();
    expect(r[0].vuong).toContain("không còn trong nguồn");
  });

  it("xếp cái đưa về được lên trước", () => {
    const r = timNoteLac(nguon(
      { "id:28.7d": undefined, "rid:530": TBP_MA },
      { "id:77.3": TBP_MA },
    ));
    expect(r.map((x) => x.key)).toEqual(["rid:530", "id:28.7d"]);
  });

  it("dấu danh tính ĐƯỢC ƯU TIÊN hơn mỏ neo cũ (mỏ neo có thể lỗi thời)", () => {
    const r = timNoteLac(nguon(
      { "rid:530": TBP_VT + "||ePMP530" },
      { "id:77.3": TBP_MA, "id:77.4": TBP_VT },
      { "rid:530": TBP_MA },
    ));
    expect(r[0].dich).toBe("id:77.4");
  });
});
