/** Sắp xếp bảng "Tổng thể tiến độ" theo cột. */
import { describe, it, expect } from "vitest";
import { sapXepGantt, bamCot, MAC_DINH, type DongGantt, type ThuTuGantt } from "@/lib/sap-xep-gantt";

const d = (o: Partial<DongGantt> & { maCT: string }): DongGantt => ({ name: o.maCT, ...o });
const ma = (ds: DongGantt[]) => ds.map((x) => x.maCT);

describe("chưa bấm gì thì giữ nguyên thứ tự vẫn chạy", () => {
  it("mặc định = ngày kết thúc tăng dần, cùng ngày thì theo mã CT", () => {
    const ds = [
      d({ maCT: "CT25-070", end: "2026-09-30" }),
      d({ maCT: "CT25-002", end: "2026-10-10" }),
      d({ maCT: "CT25-055", end: "2026-09-30" }),
    ];
    expect(ma(sapXepGantt(ds, []))).toEqual(["CT25-055", "CT25-070", "CT25-002"]);
  });

  it("mã CT sắp theo SỐ, không theo chữ: CT25-9 trước CT25-10", () => {
    const ds = [d({ maCT: "CT25-10", end: "2026-09-30" }), d({ maCT: "CT25-9", end: "2026-09-30" })];
    expect(ma(sapXepGantt(ds, []))).toEqual(["CT25-9", "CT25-10"]);
  });
});

describe("sắp theo từng cột", () => {
  const ds = [
    d({ maCT: "A", overdue: 5, pct: 20, updateDate: "2026-09-20", projEnd: "2026-12-30", start: "2026-03-01" }),
    d({ maCT: "B", overdue: 91, pct: 95, updateDate: "2026-09-24", projEnd: "2026-09-30", start: "2026-01-01" }),
    d({ maCT: "C", overdue: 0, pct: 60, updateDate: "2026-09-16", projEnd: "2026-10-15", start: "2026-06-01" }),
  ];

  it("quá hạn nhiều nhất lên đầu", () =>
    expect(ma(sapXepGantt(ds, [{ key: "overdue", dir: "desc" }]))).toEqual(["B", "A", "C"]));

  it("phần trăm thực tế thấp nhất lên đầu", () =>
    expect(ma(sapXepGantt(ds, [{ key: "actualPct", dir: "asc" }]))).toEqual(["A", "C", "B"]));

  it("cập nhật mới nhất lên đầu", () =>
    expect(ma(sapXepGantt(ds, [{ key: "updateDate", dir: "desc" }]))).toEqual(["B", "A", "C"]));

  it("ngày bàn giao gần nhất lên đầu", () =>
    expect(ma(sapXepGantt(ds, [{ key: "projectDeadline", dir: "asc" }]))).toEqual(["B", "C", "A"]));

  it("ngày bắt đầu sớm nhất lên đầu", () =>
    expect(ma(sapXepGantt(ds, [{ key: "start", dir: "asc" }]))).toEqual(["B", "A", "C"]));

  it("tên dự án theo vần tiếng Việt", () => {
    const v = [d({ maCT: "1", name: "Đà Nẵng" }), d({ maCT: "2", name: "Cát Bà" }), d({ maCT: "3", name: "Hạ Long" })];
    expect(sapXepGantt(v, [{ key: "name", dir: "asc" }]).map((x) => x.name)).toEqual(["Cát Bà", "Đà Nẵng", "Hạ Long"]);
  });
});

describe("Ô TRỐNG LUÔN XUỐNG CUỐI, cả hai chiều", () => {
  const ds = [d({ maCT: "A", overdue: 5 }), d({ maCT: "TRONG", overdue: null }), d({ maCT: "B", overdue: 91 })];

  it("chiều giảm", () => expect(ma(sapXepGantt(ds, [{ key: "overdue", dir: "desc" }]))).toEqual(["B", "A", "TRONG"]));
  it("chiều tăng", () => expect(ma(sapXepGantt(ds, [{ key: "overdue", dir: "asc" }]))).toEqual(["A", "B", "TRONG"]));

  it("dự án chưa có ngày bàn giao cũng xuống cuối", () => {
    const v = [d({ maCT: "X", projEnd: null }), d({ maCT: "Y", projEnd: "2026-10-15" })];
    expect(ma(sapXepGantt(v, [{ key: "projectDeadline", dir: "desc" }]))).toEqual(["Y", "X"]);
  });
});

describe("nhiều khoá", () => {
  it("khoá phụ quyết định khi khoá chính bằng nhau", () => {
    const ds = [
      d({ maCT: "A", overdue: 5, pct: 90 }),
      d({ maCT: "B", overdue: 5, pct: 10 }),
      d({ maCT: "C", overdue: 9, pct: 50 }),
    ];
    const chain: ThuTuGantt[] = [{ key: "overdue", dir: "desc" }, { key: "actualPct", dir: "asc" }];
    expect(ma(sapXepGantt(ds, chain))).toEqual(["C", "B", "A"]);
  });
});

describe("bấm tiêu đề cột", () => {
  it("bấm lần đầu = giảm dần, lần hai = tăng dần, lần ba = bỏ", () => {
    let c: ThuTuGantt[] = [];
    c = bamCot(c, "overdue");
    expect(c).toEqual([{ key: "overdue", dir: "desc" }]);
    c = bamCot(c, "overdue");
    expect(c).toEqual([{ key: "overdue", dir: "asc" }]);
    c = bamCot(c, "overdue");
    expect(c).toEqual([]);
  });

  it("cột mới thành khoá chính, cột cũ tụt xuống làm khoá phụ", () => {
    let c = bamCot([], "overdue");
    c = bamCot(c, "actualPct");
    expect(c.map((x) => x.key)).toEqual(["actualPct", "overdue"]);
  });

  it("giữ tối đa 3 khoá", () => {
    let c: ThuTuGantt[] = [];
    for (const k of ["overdue", "actualPct", "name", "maCT", "start"] as const) c = bamCot(c, k);
    expect(c).toHaveLength(3);
    expect(c[0].key).toBe("start");
  });

  it("bỏ khoá chính thì khoá phụ lên thay", () => {
    let c = bamCot(bamCot([], "overdue"), "actualPct");
    c = bamCot(c, "actualPct");   // asc
    c = bamCot(c, "actualPct");   // bỏ
    expect(c.map((x) => x.key)).toEqual(["overdue"]);
  });
});

describe("không đụng vào mảng gốc", () => {
  it("trả mảng mới, mảng đưa vào giữ nguyên thứ tự", () => {
    const ds = [d({ maCT: "B", end: "2026-10-10" }), d({ maCT: "A", end: "2026-09-30" })];
    const ban = ds.map((x) => x.maCT);
    const ra = sapXepGantt(ds, MAC_DINH);
    expect(ds.map((x) => x.maCT)).toEqual(ban);
    expect(ra).not.toBe(ds);
    expect(ma(ra)).toEqual(["A", "B"]);
  });
});
