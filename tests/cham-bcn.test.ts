/* LUẬT TỰ CHẤM RỒI GHI VÀO FILE NGUỒN — đây là chỗ MÁY CHẤM NGƯỜI rồi GHI THẲNG vào file của
 * phòng OCC, nên mỗi điều chặn tay nó phải có một ca kiểm giữ, không chỉ có comment.
 *
 * Anh Tiến 12/10/2026: *"auto data đẩy dữ liệu về đây […] giảm tải việc tôi phải ngồi rà soát"*.
 */
import { describe, expect, it } from "vitest";
import {
  KY_HIEU, chuCot, diaChi, doKhung, lenKeHoach, lenKeHoachSangThang,
  ngayCuaThang, somNhat, tachMaCT, tenTabLuu, thanhRange, thuVn, xetThang,
  type BangChung,
} from "@/lib/cham-bcn";

/* ── LƯỚI MẪU — dựng theo đúng hình file thật (có DÒNG TRỐNG, vì Sheets API giữ nguyên) ──
   Dòng (0-based): 0 tiêu đề sheet · 1 ngày cập nhật · 2-9 bảng điểm PM · 10 TRỐNG
   11 tiêu đề cột · 12 nhãn tháng · 13 thứ · 14 số ngày · 15 dòng đếm · 16+ dữ liệu. */
function luoi(opts?: { thang?: string; soNgay?: number; dauSan?: Record<string, string> }) {
  const thang = opts?.thang ?? "10/2026";
  const n = opts?.soNgay ?? 31;
  const C = 8;                                   // cột ngày bắt đầu ở chỉ số 8 (cột I)
  const g: unknown[][] = Array.from({ length: 24 }, () => []);
  g[0] = ["ĐÁNH GIÁ TUÂN THỦ BÁO CÁO HẰNG NGÀY - THÁNG 10/2026"];
  g[11] = ["STT", "Vùng", "Mã CT", "Dự án", "PM", "Hạng mục", null, "Luỹ kế không báo cáo"];
  g[12] = []; g[12][C] = `THÁNG ${thang}`;
  g[13] = []; g[14] = [];
  for (let i = 0; i < n; i++) {
    g[13][C + i] = "T3";
    g[14][C + i] = String(i + 1).padStart(2, "0");
  }
  const duAn = [
    ["1", "Phú Quốc", "CT26-040", "Apec S2", "Nguyễn Văn Có"],
    ["2", "", "CT26-078, CT26-055, CT25-070", "Nam Phương", "Trần Quốc Lý"],
    ["3", "", "CT25-040, 038, 037", "Mini Hotel B6-B9", "Lê Tuấn"],
  ];
  let r = 16;
  for (const d of duAn) {
    for (const hm of ["Quân số", "Thi công lắp đặt", "Sản lượng"]) {
      g[r] = hm === "Quân số" ? [...d, hm] : [null, null, null, null, null, hm];
      r++;
    }
  }
  for (const [o, v] of Object.entries(opts?.dauSan ?? {})) {
    const [rr, cc] = o.split(",").map(Number);
    (g[rr] ??= [])[cc] = v;
  }
  return g;
}

const bc = (phut: number, nguon: BangChung["nguon"] = "file", ai = "ai đó"): BangChung => ({ phut, nguon, ai });
const keHoach = (over: Partial<Parameters<typeof lenKeHoach>[0]> = {}) => {
  const grid = over.grid ?? luoi();
  const khung = doKhung(grid)!;
  return lenKeHoach({ khung, grid, theoMa: new Map(), ngay: "2026-10-12", chot: false, ...over });
};

describe("tách mã CT", () => {
  it("một mã", () => expect(tachMaCT("CT26-040")).toEqual(["CT26-040"]));
  it("nhiều mã đủ tiền tố", () =>
    expect(tachMaCT("CT26-078, CT26-055, CT25-070")).toEqual(["CT26-078", "CT26-055", "CT25-070"]));
  /* Kiểu ghi tắt của file: mã sau rụng tiền tố. Bỏ qua là mất đúng mấy dòng gộp nhiều căn. */
  it("mã sau rụng tiền tố thì mượn tiền tố của mã trước", () =>
    expect(tachMaCT("CT25-040, 038, 037, 027, 026"))
      .toEqual(["CT25-040", "CT25-038", "CT25-037", "CT25-027", "CT25-026"]));
  it("đổi tiền tố giữa chừng", () =>
    expect(tachMaCT("CT25-081, CT26-002")).toEqual(["CT25-081", "CT26-002"]));
  it("ô trống / chữ linh tinh → rỗng, KHÔNG đoán", () => {
    expect(tachMaCT("")).toEqual([]);
    expect(tachMaCT("chưa có mã")).toEqual([]);
    expect(tachMaCT("038")).toEqual([]);           // không có tiền tố nào trước đó
  });
});

describe("đọc khung bảng", () => {
  const k = doKhung(luoi())!;
  it("tìm đúng dòng tiêu đề dù phía trên có bảng điểm PM và dòng trống", () => expect(k.dongTieuDe).toBe(11));
  it("đọc đủ 31 cột ngày", () => expect(k.cotNgay).toHaveLength(31));
  it("giữ ĐỊA CHỈ ô nhãn tháng, không chỉ giá trị", () => {
    expect(k.thangLabel).toBe("10/2026");
    expect(k.oNhanThang).toEqual({ r: 12, c: 8 });
  });
  it("mỗi dự án ba dòng, hai dòng sau kế thừa mã của dòng đầu (ô gộp)", () => {
    expect(k.dong).toHaveLength(9);
    expect(k.dong[1].hangMuc).toBe("Thi công lắp đặt");
    expect(k.dong[1].ma).toEqual(["CT26-040"]);
    expect(k.dong[2].ma).toEqual(["CT26-040"]);
  });
  it("lưới không phải bảng chấm → null, không đoán bừa", () => {
    expect(doKhung([["linh", "tinh"], ["abc"]])).toBeNull();
  });
  /* CHỈ SỐ DÒNG PHẢI LÀ DÒNG THẬT TRONG SHEET. Lệch một dòng là ghi dấu sang dự án khác. */
  it("dòng Thi công lắp đặt của dự án 1 nằm đúng dòng 18 trong Sheet", () => {
    expect(k.dong[1].r).toBe(17);                  // 0-based 17 = dòng 18
  });
});

describe("chấm một ngày", () => {
  const tcld1 = 17;                                 // dòng TCLĐ của dự án 1
  const cot12 = 8 + 11;                             // cột ngày 12

  it("đúng hạn → ✓", () => {
    const kh = keHoach({ theoMa: new Map([["CT26-040", [bc(17 * 60 + 59)]]]) });
    expect(kh.o).toEqual([{ r: tcld1, c: cot12, giaTri: "✓" }]);
  });
  it("đúng 18:00 vẫn ✓, 18:01 thành O", () => {
    expect(keHoach({ theoMa: new Map([["CT26-040", [bc(18 * 60)]]]) }).o[0].giaTri).toBe("✓");
    expect(keHoach({ theoMa: new Map([["CT26-040", [bc(18 * 60 + 1)]]]) }).o[0].giaTri).toBe("O");
  });
  it("đúng 20:00 vẫn O, 20:01 thành X", () => {
    expect(keHoach({ theoMa: new Map([["CT26-040", [bc(20 * 60)]]]) }).o[0].giaTri).toBe("O");
    expect(keHoach({ theoMa: new Map([["CT26-040", [bc(20 * 60 + 1)]]]) }).o[0].giaTri).toBe("X");
  });
  it("nhiều bằng chứng trong ngày → lấy cái SỚM NHẤT", () => {
    const kh = keHoach({ theoMa: new Map([["CT26-040", [bc(21 * 60, "pdf"), bc(9 * 60)]]]) });
    expect(kh.o[0].giaTri).toBe("✓");
  });
  it("bằng chứng của BẤT KỲ mã nào trong ô gộp đều tính cho cả dòng", () => {
    const kh = keHoach({ theoMa: new Map([["CT25-070", [bc(8 * 60)]]]) });
    expect(kh.o).toEqual([{ r: 20, c: cot12, giaTri: "✓" }]);   // dòng TCLĐ của dự án 2
  });

  /* ── BA ĐIỀU CHẶN TAY ROBOT ─────────────────────────────────────────── */
  it("CHỈ chạm dòng Thi công lắp đặt, không đụng Quân số / Sản lượng", () => {
    const kh = keHoach({ theoMa: new Map([["CT26-040", [bc(60)]]]) });
    expect(kh.o.map((x) => x.r)).toEqual([tcld1]);
  });
  it("KHÔNG đè lên ô người đã chấm tay", () => {
    const grid = luoi({ dauSan: { [`${tcld1},${cot12}`]: "n/a" } });
    const kh = keHoach({ grid, theoMa: new Map([["CT26-040", [bc(60)]]]) });
    expect(kh.o).toEqual([]);
    expect(kh.boQua.some((b) => b.vi.includes('đã có "n/a"'))).toBe(true);
  });
  it("chưa tới lượt chốt thì KHÔNG kết tội ai", () => {
    const kh = keHoach({ chot: false });
    expect(kh.o).toEqual([]);
    expect(kh.boQua).toHaveLength(3);
  });
  it("lượt chốt: không có bằng chứng → X", () => {
    const kh = keHoach({ chot: true });
    expect(kh.o.every((x) => x.giaTri === "X")).toBe(true);
    expect(kh.o).toHaveLength(3);
  });
  /* Chấm X cho dự án mà app KHÔNG CÓ CỬA NÀO để nhìn là chấm oan — và oan kiểu này không cãi được. */
  it("lượt chốt: dự án app không nhìn thấy được thì BỎ TRỐNG, không X", () => {
    const kh = keHoach({ chot: true, khongDoDuoc: new Set(["CT26-040"]) });
    expect(kh.o.map((x) => x.r)).not.toContain(tcld1);
    expect(kh.boQua.some((b) => b.vi.includes("không có nguồn nào"))).toBe(true);
  });
  it("một mã trong ô gộp nhìn được thì cả dòng vẫn bị chốt X", () => {
    const kh = keHoach({ chot: true, khongDoDuoc: new Set(["CT26-078", "CT26-055"]) });
    expect(kh.o.map((x) => x.r)).toContain(20);
  });
  it("ngày không có cột trong bảng → không ghi gì", () => {
    const kh = keHoach({ ngay: "2026-10-31", grid: luoi({ soNgay: 30 }), chot: true });
    expect(kh.cotHomNay).toBe(-1);
    expect(kh.o).toEqual([]);
  });
});

describe("bằng chứng sớm nhất", () => {
  it("không có gì → null", () => expect(somNhat(new Map(), ["CT26-040"])).toBeNull());
  it("so qua nhiều mã", () => {
    const m = new Map([["A", [bc(600)]], ["B", [bc(300)]]]);
    expect(somNhat(m, ["A", "B"])?.phut).toBe(300);
  });
});

describe("sang tháng", () => {
  const k = (thang: string) => doKhung(luoi({ thang }))!;
  it("khớp tháng hiện tại", () => expect(xetThang(k("10/2026"), "2026-10-12")).toBe("khop"));
  it("bảng còn ở tháng trước → tới lúc dọn", () => expect(xetThang(k("09/2026"), "2026-10-12")).toBe("cu"));
  it("bảng ở tháng tương lai → ĐỨNG IM, có người sửa tay", () =>
    expect(xetThang(k("11/2026"), "2026-10-12")).toBe("la"));
  it("không đọc được nhãn tháng → null", () => {
    const g = luoi(); g[12] = [];
    expect(xetThang(doKhung(g)!, "2026-10-12")).toBeNull();
  });
  it("tên tab lưu tháng cũ", () => expect(tenTabLuu("09/2026")).toBe("BCN 09-2026"));

  it("dọn bảng: ghi lại nhãn tháng, dãy ngày và thứ", () => {
    const kh = lenKeHoachSangThang(k("09/2026"), "2026-10-01");
    expect(kh.o[0]).toEqual({ r: 12, c: 8, giaTri: "THÁNG 10/2026" });
    expect(kh.o.find((x) => x.r === 14 && x.c === 8)?.giaTri).toBe("01");
    expect(kh.o.find((x) => x.r === 13 && x.c === 8)?.giaTri).toBe("T5");   // 01/10/2026 là thứ Năm
  });
  /* Tháng ngắn thì cột thừa phải TRỐNG, không để sót ngày của tháng trước. */
  it("tháng 30 ngày → cột thứ 31 bị xoá trắng", () => {
    const kh = lenKeHoachSangThang(k("10/2026"), "2026-11-01");
    expect(kh.o.find((x) => x.r === 14 && x.c === 8 + 30)?.giaTri).toBe("");
    expect(kh.o.find((x) => x.r === 13 && x.c === 8 + 30)?.giaTri).toBe("");
  });
  it("vùng dấu cần xoá phủ từ dòng dữ liệu đầu tới cuối", () => {
    const kh = lenKeHoachSangThang(k("09/2026"), "2026-10-01");
    expect(kh.xoa).toEqual({ r1: 16, c1: 8, r2: 24, c2: 38 });
  });
  it("tháng 2 năm thường có 28 ngày", () => expect(ngayCuaThang("2026-02-10")).toHaveLength(28));
  it("thứ trong tuần theo kiểu file", () => {
    expect(thuVn("2026-10-11")).toBe("CN");
    expect(thuVn("2026-10-12")).toBe("T2");
  });
});

describe("địa chỉ ô", () => {
  it("chữ cột", () => {
    expect(chuCot(0)).toBe("A");
    expect(chuCot(8)).toBe("I");
    expect(chuCot(25)).toBe("Z");
    expect(chuCot(26)).toBe("AA");
    expect(chuCot(40)).toBe("AO");
  });
  it("A1 kèm tên tab, dòng tính từ 1", () => expect(diaChi("BCN_BangCham", 17, 8)).toBe("'BCN_BangCham'!I18"));
  it("tên tab có dấu nháy thì nhân đôi", () => expect(diaChi("A'B", 0, 0)).toBe("'A''B'!A1"));
  it("gom thành range cho batchUpdate", () => {
    expect(thanhRange("T", [{ r: 1, c: 2, giaTri: "✓" }]))
      .toEqual([{ range: "'T'!C2", values: [["✓"]] }]);
  });
});

describe("ký hiệu", () => {
  /* Ô đếm của file là COUNTIF(...,"X") nên phải là X HOA. Viết thường là luỹ kế không cộng mà
     bảng vẫn trông bình thường. */
  it("đúng ký tự file đang dùng", () => {
    expect(KY_HIEU).toEqual({ P: "✓", o: "O", x: "X" });
    expect(KY_HIEU.x).toBe(KY_HIEU.x.toUpperCase());
  });
});
