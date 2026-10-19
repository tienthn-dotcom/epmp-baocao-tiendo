/* MÀU LEGEND CỦA MA TRẬN — thứ tự ưu tiên và chuyện hai dòng trùng mã.
 *
 * Anh Tiến 19/10/2026, kèm ảnh chụp Mini Hotel PQ (B1-B5) Phòng: *"màu trớt quớt, sai hoàn toàn so
 * với bảng màu ta đã chốt trong các báo cáo nhé"*.
 *
 * Đây là kiểu lỗi không ai bắt được bằng mắt: ma trận VẪN ra màu, vẫn nhìn như có nghĩa, chỉ là
 * sai bậc. Nên bộ kiểm này dựng lại ĐÚNG bảng legend của file đó (đo ngày 19/10, 9 dòng, hai dòng
 * đuôi là dòng đếm chứ không phải bậc trạng thái) và khoá từng màu một.
 */
import { describe, expect, it, beforeEach } from "vitest";
import type { WorkSheet } from "xlsx";
import { legendCodeColors, legendEntries, setStatusColorMap, STD_RAMP } from "@/lib/summary-render";

/** Bảng mã màu CHỐT, bản đang nằm trên Drive "Data Source › Mã màu › heatmap-colors.csv". */
const BANG_CHOT = [
  { name: "Chưa bàn giao", hex: "#C00000" },
  { name: "Đang thi công", hex: "#D3E8FE" },
  { name: "Đã giao thô", hex: "#3B82F6" },
  { name: "Đã giao tinh (PMU)", hex: "#1E3A8A" },
  { name: "Đã ra list Defect (Vận hành)", hex: "#AFD8C7" },
  { name: "Xoá list Defect (Vận hành)", hex: "#059669" },
  { name: "Đã giao Vận Hành", hex: "#006100" },
  { name: "Không có thi công", hex: "#A6A6A6" },
];

/** Conditional formatting ĐỌC TỪ CHÍNH FILE Mini Hotel PQ (B1-B5) — màu Excel đang hiện. */
const CF_FILE: Record<string, string> = {
  "": "#C00000", "1": "#FFF2CD", "2": "#3B82F6", "3": "#1E3A8A",
  "4": "#AFD8C7", "5": "#059669", "6": "#006100",
};

/** Chín dòng legend của file đó, đúng thứ tự và đúng cột Mã (hai dòng cuối là dòng ĐẾM). */
const DONG: [string, string][] = [
  ["Chưa bàn giao", ""],
  ["Đang thi công", "1"],
  ["Đã giao thô", "2"],
  ["Đã giao tinh (PMU)", "3"],
  ["Đã ra list Defect (Vận hành)", "4"],
  ["Xoá list Defect (Vận hành)", "5"],
  ["Xóa list Defect bàn giao VH", "6"],
  ["Căn MEP đã T&C", "6"],
  ["Bàn giao VH thực tế", ""],
];

/** Dựng worksheet kiểu SheetJS: cột A = ô màu, B = Diễn giải, C = Nhập. */
function sheet(dong: [string, string][], fill?: Record<number, string>): WorkSheet {
  const sh: Record<string, unknown> = {
    A1: { t: "s", v: "Màu" }, B1: { t: "s", v: "Diễn giải" }, C1: { t: "s", v: "Nhập" },
  };
  dong.forEach(([text, code], i) => {
    const r = i + 2;
    sh["A" + r] = fill?.[i] ? { t: "s", v: "", s: { fgColor: { rgb: fill[i].slice(1) } } } : { t: "s", v: "" };
    sh["B" + r] = { t: "s", v: text };
    sh["C" + r] = { t: "s", v: code };
  });
  sh["!ref"] = `A1:C${dong.length + 1}`;
  return sh as WorkSheet;
}

const mau = (sh: WorkSheet, cf?: Record<string, string>) =>
  Object.fromEntries(legendEntries(sh, cf).map((e) => [e.text, e.color]));

describe("ca thật: Mini Hotel PQ (B1-B5) Phòng, 19/10/2026", () => {
  beforeEach(() => setStatusColorMap(BANG_CHOT));
  const sh = sheet(DONG);

  it("sáu dòng có tên trong bảng chốt thì ăn ĐÚNG màu bảng chốt", () => {
    const m = mau(sh, CF_FILE);
    expect(m["Chưa bàn giao"]).toBe("#C00000");
    expect(m["Đang thi công"]).toBe("#D3E8FE");
    expect(m["Đã giao thô"]).toBe("#3B82F6");
    expect(m["Đã giao tinh (PMU)"]).toBe("#1E3A8A");
    expect(m["Đã ra list Defect (Vận hành)"]).toBe("#AFD8C7");
    expect(m["Xoá list Defect (Vận hành)"]).toBe("#059669");
  });

  /* ĐÂY LÀ LỖI ANH TIẾN THẤY: mã 6 phủ 306 ô, bản cũ tô #C2FEBA — màu của thang đoán, không hề
     có trong bảng chốt. File đã khai mã 6 = #006100, cứ lấy đúng cái đó. */
  it("dòng KHÔNG có trong bảng chốt thì lấy màu thật của file, KHÔNG đoán theo bậc", () => {
    const m = mau(sh, CF_FILE);
    expect(m["Xóa list Defect bàn giao VH"]).toBe("#006100");
    expect(m["Căn MEP đã T&C"]).toBe("#006100");
  });

  it("không màu nào rơi ra ngoài bảng chốt", () => {
    const hop = new Set(BANG_CHOT.map((x) => x.hex));
    const la = legendEntries(sh, CF_FILE).filter((e) => !hop.has(e.color));
    expect(la.map((e) => `${e.text}=${e.color}`)).toEqual([]);
  });

  /* Hai dòng đuôi để trống / lặp mã. Dòng sau thắng thì mã "" (ĐỎ, chưa bàn giao) hoá xanh lá —
     tức mọi căn chưa bàn giao nhìn như đã xong. Đúng kiểu sai mà nhìn vẫn hợp lý. */
  it("dòng legend trùng mã: dòng ĐẦU thắng, mã trống không bị cướp", () => {
    const cc = legendCodeColors(sh, CF_FILE);
    expect(cc[""]).toBe("#C00000");
    expect(cc["6"]).toBe("#006100");
  });
});

describe("thứ tự ưu tiên", () => {
  const sh = sheet(DONG);

  it("bảng chốt THẮNG màu thật của file", () => {
    setStatusColorMap(BANG_CHOT);
    // File khai mã 1 = #FFF2CD (vàng nhạt), bảng chốt nói "Đang thi công" = #D3E8FE → theo bảng chốt.
    expect(mau(sh, CF_FILE)["Đang thi công"]).toBe("#D3E8FE");
  });

  it("không có bảng chốt thì theo màu thật của file", () => {
    setStatusColorMap([]);
    const m = mau(sh, CF_FILE);
    expect(m["Đang thi công"]).toBe("#FFF2CD");
    expect(m["Xóa list Defect bàn giao VH"]).toBe("#006100");
  });

  /* Thang 7 cấp vẫn còn, nhưng là phương án CUỐI — file không có CF, tên không tra được. */
  it("hết cách mới đoán theo thang 7 cấp", () => {
    setStatusColorMap([]);
    const la = sheet([["Bậc một", "1"], ["Bậc hai", "2"], ["Bậc ba", "3"]]);
    expect(legendEntries(la).map((e) => e.color)).toEqual([STD_RAMP[0], STD_RAMP[3], STD_RAMP[6]]);
  });

  it("fill tĩnh của ô legend đứng trên thang đoán", () => {
    setStatusColorMap([]);
    const la = sheet([["Bậc một", "1"], ["Bậc hai", "2"], ["Bậc ba", "3"]], { 1: "#ABCDEF" });
    expect(legendEntries(la)[1].color).toBe("#ABCDEF");
  });

  it('ô "X" luôn là xám không-thi-công, không chiếm bậc của thang', () => {
    setStatusColorMap([]);
    const la = sheet([["Chưa bàn giao", "1"], ["Không có thi công", "X"], ["Xong", "2"]]);
    const e = legendEntries(la);
    expect(e[1].color).toBe("#A6A6A6");
    expect([e[0].color, e[2].color]).toEqual([STD_RAMP[0], STD_RAMP[6]]);
  });
});
