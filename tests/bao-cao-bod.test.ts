/* BÁO CÁO GỬI BOD — luật xếp cụm và luật dán nhãn vận hành.
 *
 * Anh Tiến 13/10/2026 gửi bản tuần 40; 16/10/2026 đổi nguồn nhãn: *"dựa vào thông tin mới bên
 * sheet Tracking tiến độ, đánh lại cho tôi trên header mỗi page tình trạng đã vận hành hoặc chưa
 * vận hành"*. Báo cáo này đi thẳng lên BOD nên hai thứ phải chắc: KHÔNG rơi dự án nào, và nhãn
 * vận hành không được dán nhầm.
 *
 * Luật cũ (ngày sửa file trong 7 ngày) đã BỎ — phép đoán đó chỉ dùng khi chưa ai chấm tay.
 */
import { describe, expect, it } from "vitest";
import {
  CUM, cumCuaVung, dongTong, laTabBod, locTabBod, tenTep, thieuTrongTracking, xepTrangBod,
  type MucMaTran,
} from "@/lib/bao-cao-bod";
import { docTracking } from "@/lib/tracking-vanhanh";

const NAY = Date.parse("2026-10-13T04:00:00Z");
const truoc = (ngay: number) => new Date(NAY - ngay * 86_400_000).toISOString();
const muc = (maCT: string, region: string, fileId = maCT): MucMaTran =>
  ({ fileId, maCT, name: `Dự án ${maCT}`, region });

/** Bảng tracking giả: mỗi dòng "Dự án <maCT>" + trạng thái. */
const TAB = String.fromCharCode(9);
const bangCua = (cap: readonly [string, string][]) =>
  docTracking(cap.map(([ma, tt], i) => [`${i + 1}`, "PM", `Dự án ${ma}`, "Vùng", tt, ""].join(TAB)).join("\n"));

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
  const bang = bangCua([
    ["CT-P1", "Đã vận hành"], ["CT-P2", "Chưa vận hành"], ["CT-N1", "Chưa triển khai"],
    ["CT-B1", "Không cần triển khai"],
  ]);   // CT-M1 CỐ TÌNH không có trong bảng
  const tr = xepTrangBod(ds, bang, ngay);

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
  it("dán nhãn theo ĐÚNG dòng của dự án đó trong bảng tracking", () => {
    const o = (ma: string) => tr.find((t) => t.maCT === ma)!;
    expect(o("CT-P1").tt).toBe("da");
    expect(o("CT-P1").nhan).toBe("TCLĐ: ĐÃ VẬN HÀNH");
    expect(o("CT-P2").tt).toBe("chua");
    expect(o("CT-N1").tt).toBe("chuaTrienKhai");
    expect(o("CT-B1").tt).toBe("khongCan");
    expect(tr.filter((t) => t.chay).map((t) => t.maCT)).toEqual(["CT-P1"]);
  });
  /* Ngày sửa file KHÔNG còn quyết định nhãn — CT-P2 sửa cách đây 30 ngày vẫn chỉ là "chưa vận
     hành" vì bảng ghi vậy, còn CT-B1 sửa 3 ngày trước vẫn là "không cần triển khai". */
  it("ngày sửa chỉ đi kèm để hiện, không đổi nhãn", () => {
    expect(tr.find((t) => t.maCT === "CT-B1")!.ngaySua).toBe(truoc(3));
    expect(tr.find((t) => t.maCT === "CT-B1")!.tt).toBe("khongCan");
    expect(tr.find((t) => t.maCT === "CT-M1")!.ngaySua).toBeNull();
  });
  /* Không có trong bảng thì để "chưa rõ" và NÓI RA, không lùi về phép đoán cũ. */
  it("ma trận thiếu trong bảng thì chưa rõ và được liệt kê", () => {
    expect(tr.find((t) => t.maCT === "CT-M1")!.tt).toBe("chuaRo");
    expect(thieuTrongTracking(tr)).toEqual(["CT-M1 · Dự án CT-M1"]);
  });
  /* Nhiều dự án dùng CHUNG một file ma trận (Tây Hồ View 11 dự án một file) → cùng một ngày sửa,
     cùng một nhãn. Đúng theo luật, và phải không rơi dự án nào trong nhóm đó. */
  it("nhiều dự án chung một file nhưng nhãn theo TỪNG dự án", () => {
    const chung = [muc("CT-X1", "North", "F1"), muc("CT-X2", "North", "F1")];
    const r = xepTrangBod(chung, bangCua([["CT-X1", "Đã vận hành"], ["CT-X2", "Chưa vận hành"]]),
      new Map([["F1", truoc(1)]]));
    expect(r).toHaveLength(2);
    expect(r.map((t) => t.tt)).toEqual(["da", "chua"]);
  });
  it("danh sách rỗng → báo cáo rỗng, không nổ", () => {
    expect(xepTrangBod([], bangCua([]))).toEqual([]);
  });
});

describe("chữ phụ", () => {
  it("tên tệp theo ngày giờ VN", () => expect(tenTep(NAY)).toBe("BAO_CAO_TCLD_TTBG_13-10-2026.pdf"));
  it("dòng tổng ở bìa tách riêng phần ngoài diện", () => {
    const ds = [muc("A", "PQ"), muc("B", "PQ"), muc("C", "PQ")];
    const r = xepTrangBod(ds, bangCua([["A", "Đã vận hành"], ["B", "Chưa vận hành"], ["C", "Không cần triển khai"]]));
    expect(dongTong(r)).toBe("3 ma trận · 1 đã vận hành · 1 chưa vận hành · 1 ngoài diện");
  });
});

/* ── CHỈ LẤY TAB 1B / 2B / 3B ────────────────────────────────────────────────
   Anh Tiến 13/10/2026: *"chỉ lấy mấy sheet 1B, 2B, 3B thôi"*. Lọc kiểu này rất dễ lọc nhầm cả
   dự án ra khỏi báo cáo gửi BOD, nên ranh giới phải có ca kiểm giữ. */
describe("lọc tab 1B/2B/3B", () => {
  it("nhận đúng ba bộ tab báo cáo, mọi kiểu gõ gặp trong danh sách thật", () => {
    for (const s of ["1B. Báo cáo TCLĐ", "1B.TCLĐ PHÒNG", "2B. Báo cáo TTBG Phòng",
      "3B. Báo cáo TCLĐ Public", "3B. Báo cáo TCLĐ public CT25-07", " 2b. báo cáo ttbg"])
      expect(laTabBod(s)).toBe(true);
  });
  it("loại tab làm việc nội bộ", () => {
    for (const s of ["Summary", "CT26-078 Summary", "MT TTBG", "SUMMARY PUBLIC",
      "CHATEAU- MA TRAN LAP DAT", "Public Summary 2", "", undefined])
      expect(laTabBod(s)).toBe(false);
  });
  /* "4B" hay "11B" KHÔNG phải bộ tab chuẩn — nới ra là lại lọt mấy tab nội bộ. */
  it("số khác 1/2/3 thì không nhận", () => {
    expect(laTabBod("4B. Báo cáo gì đó")).toBe(false);
    expect(laTabBod("11B. Báo cáo")).toBe(false);
  });
  it("tách ra hai phần, không mất mục nào", () => {
    const ds = [{ sheet: "1B. Báo cáo TCLĐ" }, { sheet: "Summary" }, { sheet: "2B. Báo cáo TTBG" }];
    const { lay, bo } = locTabBod(ds);
    expect(lay).toHaveLength(2);
    expect(bo).toHaveLength(1);
    expect(lay.length + bo.length).toBe(ds.length);
  });
});
