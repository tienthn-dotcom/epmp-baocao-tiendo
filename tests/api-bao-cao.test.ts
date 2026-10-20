/* CỬA ĐỌC CHO AGENT — kiểm phần luật.
 *
 * Số ra cửa này đi thẳng vào báo cáo của sếp mà KHÔNG ai ở giữa soi lại. Nên chỗ cần chắc là:
 * lọc không được âm thầm nuốt dòng, trung bình không được tính cả dòng chưa nhập, và vân tay
 * phải đổi khi số đổi (không thì KV giữ mãi bản cũ mà agent tưởng là mới).
 */
import { describe, expect, it } from "vitest";
import {
  demCanhBao, demTheo, locDong, tomTatTheoDuAn, vanTayCua, type DongEpmp,
} from "@/lib/api-bao-cao";

const d = (o: Partial<DongEpmp> = {}): DongEpmp => ({
  maCT: "CT26-055", duAn: "Nam Phương Hoàng Hậu", vung: "Phú Quốc", cum: "Nam Phương PQ",
  pm: "Đặng Ngọc Sáu", hangMuc: "Đặt vật tư", abbr: "VT", nguoiPhuTrach: "PM & NM",
  batDau: "2026-09-01", ketThuc: "2026-10-30",
  pctKeHoach: 60, pctThucTe: 50, soNgayTre: null, canhBao: "none",
  vuongMac: "", giaiPhap: "", ...o,
});

describe("lọc", () => {
  const ds = [
    d({ maCT: "A", vung: "Phú Quốc", pm: "Sáu", canhBao: "late", soNgayTre: 12 }),
    d({ maCT: "B", vung: "Bắc", pm: "Cừ", canhBao: "focus" }),
    d({ maCT: "C", vung: "Bắc", pm: "Sáu", hangMuc: "Thi công lắp đặt" }),
  ];
  it("theo vùng, PM, mã CT, hạng mục", () => {
    expect(locDong(ds, { vung: "Bắc" }).map((x) => x.maCT)).toEqual(["B", "C"]);
    expect(locDong(ds, { pm: "Sáu" }).map((x) => x.maCT)).toEqual(["A", "C"]);
    expect(locDong(ds, { maCT: "B" }).map((x) => x.maCT)).toEqual(["B"]);
    expect(locDong(ds, { hangMuc: "Thi công lắp đặt" }).map((x) => x.maCT)).toEqual(["C"]);
  });
  /* Agent gõ tay tham số, không gõ nổi dấu — không khớp được thì nó tưởng dự án không tồn tại. */
  it("không phân biệt dấu và hoa thường", () => {
    expect(locDong(ds, { vung: "bac" }).map((x) => x.maCT)).toEqual(["B", "C"]);
    expect(locDong(ds, { vung: "BẮC" }).map((x) => x.maCT)).toEqual(["B", "C"]);
  });
  it("nhiều bộ lọc thì giao nhau", () => {
    expect(locDong(ds, { vung: "Bắc", pm: "Sáu" }).map((x) => x.maCT)).toEqual(["C"]);
  });
  it("chỉ lấy dòng trễ", () => expect(locDong(ds, { chiTre: true }).map((x) => x.maCT)).toEqual(["A"]));
  it("không lọc gì thì trả đủ, không nuốt dòng nào", () => expect(locDong(ds).length).toBe(3));
});

describe("gom theo dự án", () => {
  const ds = [
    d({ maCT: "A", pctThucTe: 100, soNgayTre: 5 }),
    d({ maCT: "A", pctThucTe: null, soNgayTre: 30 }),
    d({ maCT: "A", pctThucTe: 50 }),
    d({ maCT: "B", pctThucTe: 20 }),
  ];
  const t = tomTatTheoDuAn(ds);
  it("mỗi mã CT một dòng, dự án trễ nhiều lên trước", () => expect(t.map((x) => x.maCT)).toEqual(["A", "B"]));
  it("đếm đủ đầu việc kể cả dòng chưa nhập %", () => expect(t[0].soDauViec).toBe(3));
  /* Dòng chưa nhập % KHÔNG được vào mẫu số, nếu không trung bình tụt xuống vô cớ. */
  it("trung bình chỉ tính dòng có %", () => expect(t[0].pctTrungBinh).toBe(75));
  it("đếm trễ và lấy số trễ lớn nhất", () => {
    expect(t[0].soTre).toBe(2);
    expect(t[0].treNhat).toBe(30);
  });
  it("không dòng nào có % thì trả null chứ không phải 0", () => {
    expect(tomTatTheoDuAn([d({ pctThucTe: null })])[0].pctTrungBinh).toBeNull();
  });
});

describe("đếm cảnh báo", () => {
  const ds = [
    d({ maCT: "A", canhBao: "late" }), d({ maCT: "A", canhBao: "late" }),
    d({ maCT: "B", canhBao: "focus" }), d({ maCT: "C", canhBao: "none" }),
  ];
  it("đúng ba nhóm, bỏ nhóm none", () => {
    expect(demCanhBao(ds).map((x) => x.ma)).toEqual(["late", "trim", "focus"]);
  });
  it("đếm cả số đầu việc lẫn số dự án", () => {
    const late = demCanhBao(ds).find((x) => x.ma === "late")!;
    expect(late.so).toBe(2);
    expect(late.duAn).toBe(1);
  });
  it("nhóm rỗng vẫn hiện với số 0, không biến mất", () => {
    expect(demCanhBao(ds).find((x) => x.ma === "trim")!.so).toBe(0);
  });
  it("đếm theo trường để agent biết lọc được những gì", () => {
    expect(demTheo([d({ vung: "Bắc" }), d({ vung: "Bắc" }), d({ vung: "Nam" })], "vung"))
      .toEqual([{ ten: "Bắc", so: 2 }, { ten: "Nam", so: 1 }]);
  });
});

describe("vân tay", () => {
  const a = [d({ maCT: "A", pctThucTe: 50 }), d({ maCT: "B", pctThucTe: 70 })];
  it("cùng dữ liệu thì cùng vân tay", () => expect(vanTayCua(a)).toBe(vanTayCua([...a])));
  /* Vân tay không đổi khi số đổi = KV giữ bản cũ mãi mãi, agent đọc số chết mà tưởng mới. */
  it("đổi % thì vân tay đổi", () => {
    expect(vanTayCua([d({ maCT: "A", pctThucTe: 51 }), a[1]])).not.toBe(vanTayCua(a));
  });
  it("đổi số ngày trễ thì vân tay đổi", () => {
    expect(vanTayCua([d({ maCT: "A", pctThucTe: 50, soNgayTre: 3 }), a[1]])).not.toBe(vanTayCua(a));
  });
  it("thêm bớt dòng thì vân tay đổi", () => {
    expect(vanTayCua([...a, d({ maCT: "C" })])).not.toBe(vanTayCua(a));
  });
});
