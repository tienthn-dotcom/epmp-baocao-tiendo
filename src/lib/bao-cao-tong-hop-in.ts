/**
 * BÁO CÁO TUÂN THỦ TỔNG HỢP → BẢN IN THEO MẪU CÔNG TY.
 *
 * Anh Tiến 19/10/2026: "set up 1 template hoàn chỉnh để xuất báo cáo chuẩn template". App đã có sẵn
 * mẫu công ty do Trạm xuất báo cáo dựng theo bản PR anh gửi (1PR_Holiday Inn Ba Na_061026.pdf):
 * A4 dọc, dải đỏ #A51C21 trên dưới, chỉ cam, logo AA, tiêu đề navy, hàng KPI, bảng đầu navy, chân
 * trang có số trang, khối "Đánh giá nhanh". Ở đây chỉ ĐỔ SỐ của bảng tổng hợp vào đúng khuôn
 * `BanBaoCao` đó rồi dùng lại `dungTrang` / `xuatPdf` / `xemTruoc` của tram-bao-cao-pdf.ts — một
 * mẫu cho mọi bản xuất từ app Báo cáo, sửa mẫu một chỗ là mọi báo cáo đổi theo.
 */
import type { BanBaoCao, NhomIn, O } from "@/lib/tram-bao-cao";
import { gomVungPm, nhanThang, xepTheoTenGoi, type DuAnTongHop, type PmTongHop } from "@/lib/bang-diem-tong-hop";

const so = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const chu = (v: unknown): string => (so(v) ? v.toLocaleString("vi-VN", { maximumFractionDigits: 1 }) : v === "n/a" ? "n/a" : "—");
/** Điểm: dưới 50 đỏ (như form tuân thủ), từ 90 lục, còn lại mực thường. */
const oDiem = (v: unknown, dam = false): O => ({ t: chu(v), phai: true, dam, mau: !so(v) ? "mute" : v < 50 ? "do" : v >= 90 ? "luc" : "ink" });

export const COT_TONG_HOP: BanBaoCao["cot"] = [
  { ten: "Người phụ trách", rong: 15 },
  { ten: "Dự án", rong: 35 },
  { ten: "Điểm TB", rong: 8, phai: true },
  { ten: "Quân số", rong: 7, phai: true },
  { ten: "Sản lượng", rong: 8, phai: true },
  { ten: "Thi công LĐ", rong: 9, phai: true },
  { ten: "Master Plan", rong: 9, phai: true },
  { ten: "Tháng", rong: 6, phai: true },
];

/** TB làm tròn số nguyên — cho cột Điểm TB và KPI "Điểm trung bình" (chốt 19/10/2026). */
const tbTron = (a: readonly unknown[]): number | "" => {
  const n = a.filter(so);
  return n.length ? Math.round(n.reduce((x, y) => x + y, 0) / n.length) : "";
};
const tb = (a: readonly unknown[]): number | "" => {
  const n = a.filter(so);
  return n.length ? Math.round((n.reduce((x, y) => x + y, 0) / n.length) * 10) / 10 : "";
};

/** Dựng bản in cho 1 tháng từ kết quả `dungBangTongHop`. */
export function banTongHop(bang: { duAn: DuAnTongHop[]; pm: PmTongHop[] }, thang: string, capNhatLuc: string): BanBaoCao {
  const da = bang.duAn;
  const nhom: NhomIn[] = gomVungPm(da).map((v) => {
    const dong: O[][] = [];
    for (const g of v.pms) {
      g.dong.forEach((r, i) => dong.push([
        { t: i === 0 ? g.pm : "", mau: "navy", dam: i === 0 },
        { t: r.ten, dam: true },
        oDiem(r.tong, true), oDiem(r.qs), oDiem(r.sl), oDiem(r.tc), oDiem(r.tuan), oDiem(r.thangBC),
      ]));
    }
    const ds = v.pms.flatMap((g) => g.dong);
    const tong: O[] = [
      { t: `TB vùng · ${ds.length} dự án`, dam: true, mau: "navy" }, { t: "" },
      oDiem(tbTron(ds.map((x) => x.tong)), true), oDiem(tb(ds.map((x) => x.qs))), oDiem(tb(ds.map((x) => x.sl))),
      oDiem(tb(ds.map((x) => x.tc))), oDiem(tb(ds.map((x) => x.tuan))), oDiem(tb(ds.map((x) => x.thangBC))),
    ];
    return { ten: `Vùng ${v.vung}`, dong, tong };
  });

  // Nhóm cuối: điểm theo PM — cùng cột, cột "Dự án" ghi số dự án PM quản lý
  const pmXep = [...bang.pm].sort((a, b) => xepTheoTenGoi(a.pm, b.pm));
  if (pmXep.length) {
    nhom.push({
      ten: "Điểm theo PM",
      dong: pmXep.map((p) => [
        { t: p.pm, mau: "navy", dam: true }, { t: `${p.soDuAn} dự án`, mau: "mute" },
        oDiem(p.tong, true), oDiem(p.qs), oDiem(p.sl), oDiem(p.tc), oDiem(p.tuan), oDiem(p.thangBC),
      ]),
    });
  }

  const tbAll = tbTron(da.map((x) => x.tong));
  const duoi50 = da.filter((x) => so(x.tong) && x.tong < 50).length;
  const khongNgay = da.filter((x) => !so(x.qs) && !so(x.sl) && !so(x.tc)).length;
  const pmCoDiem = pmXep.filter((p) => so(p.tong)) as (PmTongHop & { tong: number })[];
  const pmThap = [...pmCoDiem].sort((a, b) => a.tong - b.tong).slice(0, 3);
  const daThap = da.filter((x) => so(x.tong)).sort((a, b) => (a.tong as number) - (b.tong as number)).slice(0, 3);

  const nhanXet: string[] = [];
  if (da.length) {
    nhanXet.push(`${da.length} dự án trong danh sách Báo cáo tuân thủ PMP tháng ${nhanThang(thang)}; điểm trung bình toàn bộ ${chu(tbAll)}.`);
    if (pmThap.length) nhanXet.push(`PM điểm thấp nhất: ${pmThap.map((p) => `${p.pm} (${chu(p.tong)})`).join(", ")}.`);
    if (daThap.length) nhanXet.push(`Dự án điểm thấp nhất: ${daThap.map((x) => `${x.ten} (${chu(x.tong)})`).join("; ")}.`);
    if (duoi50) nhanXet.push(`${duoi50} dự án dưới 50 điểm — cần nhắc PM cập nhật đúng hạn.`);
    if (khongNgay) nhanXet.push(`${khongNgay} dự án chưa có điểm báo cáo ngày (chưa gán nhóm BCN hoặc không theo dõi hằng ngày); điểm trung bình chỉ tính trên các cột có số.`);
  }

  return {
    tieuDe: `Báo cáo tuân thủ tổng hợp - Tháng ${nhanThang(thang)}`,
    phuDe: `Báo cáo ngày (Quân số · Sản lượng · Thi công LĐ) · Báo cáo tuần (Master Plan) · Báo cáo tháng${capNhatLuc ? ` · Dữ liệu tính đến ${capNhatLuc}` : ""}`,
    kpi: [
      { so: String(da.length), nhan: "Dự án", mau: "navy" },
      { so: chu(tbAll), nhan: "Điểm trung bình", mau: so(tbAll) && tbAll < 50 ? "do" : "luc" },
      { so: String(duoi50), nhan: "Dự án dưới 50", mau: duoi50 ? "do" : "luc" },
      { so: String(pmXep.length), nhan: "PM", mau: "navy" },
      { so: String(khongNgay), nhan: "Chưa có báo cáo ngày", mau: khongNgay ? "cam" : "luc" },
    ],
    cot: COT_TONG_HOP,
    nhom,
    soDong: da.length,
    nhanXet,
  };
}
