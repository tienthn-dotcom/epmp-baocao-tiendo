/* BÁO CÁO GỬI BOD — luật xếp cụm và luật dán nhãn vận hành.
 *
 * Anh Tiến 13/10/2026 gửi bản tuần 40 và chốt: *"đang chạy = trong 7 ngày gần nhất có người sửa
 * file ma trận"*. Báo cáo này đi thẳng lên BOD nên hai thứ phải chắc: KHÔNG rơi dự án nào, và
 * nhãn vận hành không được dán nhầm.
 */
import { describe, expect, it } from "vitest";
import {
  CUM, NGUONG_VAN_HANH_NGAY, cumCuaVung, dangChay, dongTong, nhanVanHanh, tenTep, xepTrangBod,
  type MucMaTran,
} from "@/lib/bao-cao-bod";

const NAY = Date.parse("2026-10-13T04:00:00Z");
const truoc = (ngay: number) => new Date(NAY - ngay * 86_400_000).toISOString();
const muc = (maCT: string, region: string, fileId = maCT): MucMaTran =>
  ({ fileId, maCT, name: `Dự án ${maCT}`, region });

describe("đang chạy hay chưa", () => {
  it("sửa hôm nay → đang chạy", () => expect(dangChay(truoc(0), NAY)).toBe(true));
  it("sửa 6 ngày trước → vẫn đang chạy", () => expect(dangChay(truoc(6), NAY)).toBe(true));
  it("đúng 7 ngày → vẫn tính là đang chạy", () => expect(dangChay(truoc(7), NAY)).toBe(true));
  it("8 ngày không ai đụng → chưa vận hành", () => expect(dangChay(truoc(8), NAY)).toBe(false));
  /* Không hỏi được ngày sửa thì KHÔNG dán "đã vận hành" — khen nhầm nặng hơn chê nhầm ở báo cáo
     gửi BOD, vì nó giấu đi đúng dự án đang bỏ bê. */
  it("không biết ngày sửa → chưa vận hành", () => {
    expect(dangChay(null, NAY)).toBe(false);
    expect(dangChay(undefined, NAY)).toBe(false);
    expect(dangChay("hôm kia", NAY)).toBe(false);
  });
  it("ngưỡng đổi được để test, mặc định 7 ngày", () => {
    expect(NGUONG_VAN_HANH_NGAY).toBe(7);
    expect(dangChay(truoc(10), NAY, 14)).toBe(true);
  });
  it("nhãn đúng chữ bản BOD đang dùng", () => {
    expect(nhanVanHanh(true)).toBe("TCLĐ: ĐÃ VẬN HÀNH");
    expect(nhanVanHanh(false)).toBe("TCLĐ: CHƯA VẬN HÀNH");
  });
});

describe("cụm", () => {
  it("đúng thứ tự bản BOD tuần 40", () => {
    expect(CUM.map((c) => `${c.ma}. ${c.ten}`).slice(0, 4))
      .toEqual(["I. CỤM PHÚ QUỐC", "II. CỤM MIỀN NAM", "III. CỤM MIỀN TRUNG", "IV. CỤM MIỀN BẮC"]);
  });
  it("mã vùng của danh sách MTLĐ vào đúng cụm", () => {
    expect(cumCuaVung("PQ")).toBe(0);
    expect(cumCuaVung("HCM")).toBe(1);
    expect(cumCuaVung("South")).toBe(1);
    expect(cumCuaVung("Middle")).toBe(2);
    expect(cumCuaVung("North")).toBe(3);
    expect(cumCuaVung("Oversea")).toBe(4);
  });
  /* Vùng lạ KHÔNG được làm rơi dự án khỏi báo cáo — đẩy xuống cụm cuối rồi ai đọc cũng thấy. */
  it("vùng lạ / để trống vẫn có chỗ, không bị bỏ", () => {
    expect(cumCuaVung("Sao Hoả")).toBe(CUM.length - 1);
    expect(cumCuaVung(undefined)).toBe(CUM.length - 1);
  });
});

describe("xếp trang", () => {
  const ds = [
    muc("CT-B1", "North"), muc("CT-P1", "PQ"), muc("CT-M1", "Middle"),
    muc("CT-P2", "PQ"), muc("CT-N1", "HCM"),
  ];
  const ngay = new Map<string, string | null>([
    ["CT-P1", truoc(1)], ["CT-P2", truoc(30)], ["CT-N1", truoc(2)],
    ["CT-M1", null], ["CT-B1", truoc(3)],
  ]);
  const tr = xepTrangBod(ds, ngay, NAY);

  it("không rơi dự án nào", () => expect(tr).toHaveLength(ds.length));
  it("gom theo cụm, đúng thứ tự cụm", () => {
    expect(tr.map((t) => t.cum)).toEqual([
      "I. CỤM PHÚ QUỐC", "I. CỤM PHÚ QUỐC", "II. CỤM MIỀN NAM", "III. CỤM MIỀN TRUNG", "IV. CỤM MIỀN BẮC",
    ]);
  });
  /* Trong một cụm thì GIỮ NGUYÊN thứ tự danh sách gốc — PMO đã có ý khi sắp. */
  it("trong cụm giữ nguyên thứ tự gốc", () => {
    expect(tr.filter((t) => t.cum.includes("PHÚ QUỐC")).map((t) => t.maCT)).toEqual(["CT-P1", "CT-P2"]);
  });
  it("số thứ tự chạy liên tục trong cả báo cáo", () => {
    expect(tr.map((t) => t.stt)).toEqual([1, 2, 3, 4, 5]);
  });
  it("dán nhãn theo ngày sửa của đúng file đó", () => {
    expect(tr.find((t) => t.maCT === "CT-P1")!.chay).toBe(true);
    expect(tr.find((t) => t.maCT === "CT-P2")!.chay).toBe(false);   // 30 ngày không ai đụng
    expect(tr.find((t) => t.maCT === "CT-M1")!.chay).toBe(false);   // không biết ngày sửa
  });
  /* Nhiều dự án dùng CHUNG một file ma trận (Tây Hồ View 11 dự án một file) → cùng một ngày sửa,
     cùng một nhãn. Đúng theo luật, và phải không rơi dự án nào trong nhóm đó. */
  it("nhiều dự án chung một file thì cùng nhãn, không mất dự án", () => {
    const chung = [muc("CT-X1", "North", "F1"), muc("CT-X2", "North", "F1")];
    const r = xepTrangBod(chung, new Map([["F1", truoc(1)]]), NAY);
    expect(r).toHaveLength(2);
    expect(r.every((t) => t.chay)).toBe(true);
  });
  it("danh sách rỗng → báo cáo rỗng, không nổ", () => {
    expect(xepTrangBod([], new Map(), NAY)).toEqual([]);
  });
});

describe("chữ phụ", () => {
  it("tên tệp theo ngày giờ VN", () => expect(tenTep(NAY)).toBe("BAO_CAO_TCLD_TTBG_13-10-2026.pdf"));
  it("dòng tổng ở bìa", () => {
    const ds = [muc("A", "PQ"), muc("B", "PQ")];
    const r = xepTrangBod(ds, new Map([["A", truoc(1)]]), NAY);
    expect(dongTong(r)).toBe("2 ma trận · 1 đã vận hành · 1 chưa vận hành");
  });
});
