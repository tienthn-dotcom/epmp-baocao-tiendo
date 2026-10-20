/**
 * BÁO CÁO TUÂN THỦ TỔNG HỢP — BẢN PDF THEO ĐÚNG FORM SHEET ANH TIẾN ĐÃ CHỈNH.
 *
 * Anh Tiến 19/10/2026 gửi "Báo cáo tuân thủ Tổng Hợp (1).xlsx" (bản sửa theo ý sếp) và dặn: *"sửa
 * script sau vẽ y như này, và sửa pdf trên app chạy đúng theo này"*. Nên bản PDF trên app dựng LẠI
 * đúng form của sheet (do Apps Script `bdth_boCuc_` vẽ), không dùng mẫu khác:
 *   đầu trang (tên · OCC · Tổng số | Dữ liệu tính đến bên phải) → khung 3 ô (Điểm PM · Cách tính điểm
 *   dự án · Cách tính điểm PM) → bảng tiêu đề nền tối, Vùng / Người phụ trách gộp ô.
 * Bề rộng cột = đúng số đo px của sheet (BE_RONG dưới đây = `L.widths` của script). Sửa form ở script
 * thì sửa cả ở đây.
 *
 * DỰNG BẰNG DOM rồi chụp html2canvas-pro → jsPDF (như tram-bao-cao-pdf.ts): jsPDF vẽ chữ vector không
 * đủ dấu tiếng Việt, chụp qua trình duyệt thì dấu chuẩn.
 *
 * KHỔ A4 DỌC. Bảng vừa một trang (cao không quá 1,35 trang) thì thu nhỏ gói gọn MỘT trang — tránh cảnh 2 dòng cuối
 * rơi lẻ sang trang 2. Dài hơn thì cắt trang theo dòng, ĐO thật (gắn dòng rồi đo, tràn thì sang trang),
 * mỗi trang lặp lại tiêu đề bảng và gộp lại ô Vùng / Người phụ trách trong trang đó.
 */
import { gomVungPm, mauDiemPm, nhanThang, xepTheoTenGoi, type DuAnTongHop, type PmTongHop } from "@/lib/bang-diem-tong-hop";

/* ── SỐ ĐO (px) — chép từ script ───────────────────────────────────────────────────────────── */
/** Bề rộng 32 cột nền (cột 1 = A). Y hệt `L.widths` trong bdth_boCuc_. */
const BE_RONG = Array.from({ length: 32 }, (_, k) => {
  const i = k + 1;
  return i === 9 ? 13 : i === 14 ? 25 : i === 16 ? 54 : i === 27 ? 47 : i >= 28 ? 39 : 34;
});
const rong = (dau: number, so: number) => BE_RONG.slice(dau - 1, dau - 1 + so).reduce((a, b) => a + b, 0);
const CONTENT_W = rong(1, 32);              // 1116
const LE = 24;
const TRANG_W = CONTENT_W + LE * 2;         // 1164
const TRANG_H = Math.round(TRANG_W * 297 / 210);
const THAN_H = TRANG_H - LE * 2;
/** Cao không quá ngần này lần một trang thì thu nhỏ gói gọn MỘT trang (như báo cáo tuân thủ Master Plan:
    83 dự án một trang A4). Quá thì cắt nhiều trang — chữ thu nhỏ hơn nữa là khó đọc khi in. */
const GOP_MOT_TRANG = 1.35;
/** Cột bảng: [cột nền đầu, số cột] — y hệt BDTH_COT. */
const COT = { vung: [1, 2], pm: [3, 4], ten: [7, 12], tong: [19, 2], qs: [21, 2], sl: [23, 2], tc: [25, 2], tuan: [27, 3], thang: [30, 3] } as const;

const M = {
  nen: "#eef2f6", khung: "#f7f9fb", vien: "#cbd5e1", vienBang: "#d4dbe3",
  tieuDe: "#1e3a5f", phu: "#0f766e", chuMo: "#64748b", chu: "#0f172a", chuVua: "#334155", trong: "#cbd5e1",
  dauBang: "#1e293b", dauNhan: "#16a34a", do: "#dc2626", cam: "#d97706",
};
const FONT = "Arial,'Helvetica Neue',Helvetica,sans-serif";
const PT = (pt: number) => `${(pt * 4) / 3}px`;   // cỡ chữ sheet (pt) → px

export type ThongTinForm = { thang: string; capNhatLuc: string };

const el = (tag: string, css: string, chu?: string): HTMLElement => {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (chu != null) e.textContent = chu;
  return e;
};
const so = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const chu = (v: unknown) => (so(v) ? v.toLocaleString("vi-VN", { maximumFractionDigits: 1 }) : "");

/* ── ĐẦU TRANG + KHUNG 3 Ô ─────────────────────────────────────────────────────────────────── */

function khoiDau(bang: { duAn: DuAnTongHop[] }, tt: ThongTinForm): HTMLElement {
  const b = el("div", `background:${M.nen};display:flex;justify-content:space-between;align-items:flex-start;padding:4px 4px 6px`);
  const trai = el("div", "");
  trai.appendChild(el("div", `font-size:${PT(15)};font-weight:700;color:${M.tieuDe};line-height:30px`, `Báo cáo tuân thủ tổng hợp - Tháng ${nhanThang(tt.thang)}`));
  trai.appendChild(el("div", `font-size:${PT(9)};font-weight:700;color:${M.phu};line-height:17px`, "OCC · PHÒNG ĐIỀU HÀNH TRUNG TÂM"));
  const tong = el("div", `font-size:${PT(9)};color:${M.chuMo};line-height:17px`, "Tổng số: ");
  tong.appendChild(el("b", `color:${M.chuVua}`, String(bang.duAn.length)));
  tong.appendChild(document.createTextNode(" dự án"));
  trai.appendChild(tong);
  b.appendChild(trai);
  const phai = el("div", `text-align:right;padding-top:14px;white-space:nowrap`);
  phai.appendChild(el("span", `font-size:${PT(11)};color:${M.chuMo}`, "Dữ liệu tính đến: "));
  phai.appendChild(el("span", `font-size:${PT(15)};font-weight:700;color:${M.tieuDe}`, (tt.capNhatLuc || "").split(" ")[0]));
  b.appendChild(phai);
  return b;
}

function khung(pm: PmTongHop[]): HTMLElement {
  const ds = [...pm].sort((a, b) => xepTheoTenGoi(a.pm, b.pm));
  const nR = Math.max(Math.ceil(ds.length / 3), 1);
  const vo = el("div", `background:${M.nen};padding:0 0 30px`);   // 30px = dòng đệm + hai dòng cách của sheet
  const b = el("div", `display:flex;background:${M.khung};border:1px solid ${M.vien};font-size:${PT(9)};color:${M.chuVua}`);
  const o = (w: number, ke: boolean) => el("div", `width:${w}px;box-sizing:border-box;padding:4px 4px 6px;${ke ? `border-left:1px solid ${M.vien};` : ""}display:flex;flex-direction:column`);
  const tieuDe = (t: string) => el("div", `font-weight:700;line-height:20px;height:20px`, t);

  // Ô 1 — Điểm PM: 3 cột cặp tên (4 cột nền) + điểm (1 cột nền), chạy dọc
  const o1 = o(rong(1, 15), false);
  o1.appendChild(tieuDe("Điểm PM:"));
  const luoi = el("div", "display:flex");
  for (let k = 0; k < 3; k++) {
    const cot = el("div", `display:flex;flex-direction:column;width:${rong(1 + 5 * k, 5)}px`);
    for (let r = 0; r < nR; r++) {
      const p = ds[k * nR + r];
      const hang = el("div", `display:flex;justify-content:space-between;align-items:center;height:16px;${k ? "padding-left:9px;" : ""}`);
      if (p) {
        hang.appendChild(el("span", `font-weight:700;color:${M.chu};white-space:nowrap;overflow:hidden`, p.pm));
        hang.appendChild(el("span", `font-weight:700;color:${mauDiemPm(p.tong)};padding-left:4px`, so(p.tong) ? String(Math.round(p.tong)) : "—"));
      }
      cot.appendChild(hang);
    }
    luoi.appendChild(cot);
  }
  o1.appendChild(luoi);
  b.appendChild(o1);

  // Ô 2 — Cách tính điểm dự án (căn giữa theo chiều dọc)
  const o2 = o(rong(16, 9), true);
  o2.appendChild(tieuDe("Cách tính điểm dự án:"));
  const than2 = el("div", "flex:1;display:flex;flex-direction:column;justify-content:center;line-height:1.35");
  const dong = (parts: [string, string?, boolean?][]) => {
    const d = el("div", "");
    parts.forEach(([t, mau, dam]) => d.appendChild(el("span", `${mau ? `color:${mau};` : ""}${dam ? "font-weight:700;" : ""}`, t)));
    return d;
  };
  than2.appendChild(dong([["(1) Báo cáo ngày: "], ["100 điểm/tháng", M.chu, true], ["; trễ/thiếu "], ["−2", M.cam, true], ["; không báo cáo "], ["−5", M.do, true], ["."]]));
  than2.appendChild(dong([["(2) Báo cáo tuần: không cập nhật "], ["−25", M.do, true], ["; trễ "], ["−10", M.cam, true], ["."]]));
  than2.appendChild(dong([["(3) Báo cáo tháng:"]]));
  than2.appendChild(dong([["(4) Điểm trung bình = tổng các ô điểm có số ÷ số ô có số (ô chưa có dữ liệu không tính).", M.chu, true]]));
  o2.appendChild(than2);
  b.appendChild(o2);

  // Ô 3 — Cách tính điểm PM (phân số)
  const o3 = o(rong(25, 8), true);
  o3.appendChild(tieuDe("Cách tính điểm PM:"));
  const than3 = el("div", "flex:1;display:flex;align-items:center");
  than3.appendChild(el("div", `width:${rong(25, 2)}px;text-align:right;padding-right:4px;box-sizing:border-box`, "Điểm PM ="));
  const ps = el("div", `width:${rong(27, 6)}px;text-align:center`);
  ps.appendChild(el("div", "border-bottom:1px solid #64748b;padding-bottom:2px", "Tổng điểm ô có số của mọi dự án PM quản lý"));
  ps.appendChild(el("div", "padding-top:2px", "Số ô có số"));
  than3.appendChild(ps);
  o3.appendChild(than3);
  b.appendChild(o3);

  // chiều cao thân khung = đúng số dòng của sheet: tiêu đề 20 + max(nR, 6) dòng 16px + đệm
  b.style.minHeight = `${20 + 2 + Math.max(nR, 6) * 16 + 8}px`;
  vo.appendChild(b);
  return vo;
}

/* ── BẢNG ──────────────────────────────────────────────────────────────────────────────────── */

const TH = `background:${M.dauBang};color:#fff;font-weight:700;font-size:${PT(9)};text-align:center;vertical-align:middle;border:1px solid #475569;padding:2px 3px;line-height:1.2`;
const TD = `border:1px solid ${M.vienBang};font-size:${PT(9.5)};vertical-align:middle;padding:0 3px;height:17px;line-height:16px;white-space:nowrap;overflow:hidden`;

function bangMoi(): { bang: HTMLTableElement; tbody: HTMLTableSectionElement } {
  const bang = document.createElement("table");
  bang.style.cssText = `width:${CONTENT_W}px;border-collapse:collapse;table-layout:fixed;font-family:${FONT};background:#fff`;
  const cg = document.createElement("colgroup");
  (["vung", "pm", "ten", "tong", "qs", "sl", "tc", "tuan", "thang"] as const).forEach((k) => {
    const c = document.createElement("col");
    c.style.width = `${rong(COT[k][0], COT[k][1])}px`;
    cg.appendChild(c);
  });
  bang.appendChild(cg);
  const thead = document.createElement("thead");
  const r1 = document.createElement("tr"), r2 = document.createElement("tr");
  const th = (tr: HTMLTableRowElement, t: string, rs = 1, cs = 1, nen?: string, h?: number) => {
    const x = document.createElement("th");
    x.innerHTML = t; x.rowSpan = rs; x.colSpan = cs;
    x.style.cssText = TH + (nen ? `;background:${nen}` : "") + (h ? `;height:${h}px` : "");
    tr.appendChild(x);
  };
  th(r1, "Vùng", 2, 1, undefined, 22); th(r1, "Người phụ trách", 2); th(r1, "Tên dự án", 2); th(r1, "Điểm<br>trung bình", 2, 1, M.dauNhan);
  th(r1, "Báo cáo ngày", 1, 3); th(r1, "Báo cáo tuần"); th(r1, "Báo cáo tháng");
  th(r2, "Quân số<br>(09:00)", 1, 1, undefined, 34); th(r2, "Sản lượng<br>(12:00)"); th(r2, "Thi công LĐ<br>(18:00)"); th(r2, "Master Plan<br>(PMP)"); th(r2, "Điểm tháng");
  thead.appendChild(r1); thead.appendChild(r2);
  bang.appendChild(thead);
  const tbody = document.createElement("tbody");
  bang.appendChild(tbody);
  return { bang, tbody };
}

function oDiem(v: unknown, dam = false): HTMLTableCellElement {
  const td = document.createElement("td");
  let t = "–", mau = M.trong;
  if (so(v)) { t = chu(v); mau = v < 50 ? M.do : dam ? M.chu : M.chuVua; }
  else if (v === "n/a") { t = "n/a"; mau = M.chuMo; }
  td.textContent = t;
  td.style.cssText = `${TD};text-align:center;color:${mau};${dam ? `font-weight:700;font-size:${PT(10)};` : ""}`;
  return td;
}

type DongIn = { vung: string; pm: string; r: DuAnTongHop };

/* ── DỰNG TRANG ────────────────────────────────────────────────────────────────────────────── */

function trangMoi(): { trang: HTMLElement; than: HTMLElement } {
  const trang = el("div", `width:${TRANG_W}px;height:${TRANG_H}px;box-sizing:border-box;background:#fff;font-family:${FONT};overflow:hidden;position:relative`);
  const than = el("div", `position:absolute;left:${LE}px;top:${LE}px;width:${CONTENT_W}px;height:${THAN_H}px;overflow:hidden`);
  trang.appendChild(than);
  return { trang, than };
}

/**
 * Dựng các trang A4 (DOM) cho một tháng. Phải gắn `host` vào document trước khi gọi — cắt trang cần
 * đo bố cục thật.
 */
export function dungTrangForm(bang: { duAn: DuAnTongHop[]; pm: PmTongHop[] }, tt: ThongTinForm, host: HTMLElement): HTMLElement[] {
  const dong: DongIn[] = [];
  gomVungPm(bang.duAn).forEach((v) => v.pms.forEach((g) => g.dong.forEach((r) => dong.push({ vung: v.vung, pm: g.pm, r }))));

  const dau = () => { const f = document.createDocumentFragment(); f.appendChild(khoiDau(bang, tt)); f.appendChild(khung(bang.pm)); return f; };

  /* Thử MỘT trang: dựng hết rồi đo. Cao không quá GOP_MOT_TRANG lần thì thu nhỏ cả khối cho vừa một trang. */
  {
    const { trang, than } = trangMoi();
    host.appendChild(trang);
    const khoi = el("div", `width:${CONTENT_W}px;transform-origin:top left`);
    khoi.appendChild(dau());
    const { bang: tb, tbody } = bangMoi();
    themDong(tbody, dong);
    khoi.appendChild(tb);
    than.appendChild(khoi);
    const cao = khoi.scrollHeight;
    if (cao <= THAN_H * GOP_MOT_TRANG) {
      if (cao > THAN_H) {
        const s = THAN_H / cao;
        khoi.style.transform = `scale(${s})`;
        khoi.style.marginLeft = `${(CONTENT_W * (1 - s)) / 2}px`;   // thu nhỏ thì căn giữa ngang
      }
      return [trang];
    }
    host.removeChild(trang);
  }

  /* Nhiều trang: gắn từng dòng rồi đo, tràn thì sang trang mới (tiêu đề bảng lặp lại). */
  const trangs: HTMLElement[] = [];
  let than!: HTMLElement, tbody!: HTMLTableSectionElement;
  let trongTrang: DongIn[] = [];
  const mo = (dauTrang: boolean) => {
    const t = trangMoi();
    host.appendChild(t.trang); trangs.push(t.trang); than = t.than;
    if (dauTrang) than.appendChild(dau());
    const b = bangMoi();
    than.appendChild(b.bang); tbody = b.tbody; trongTrang = [];
  };
  mo(true);
  for (const d of dong) {
    trongTrang.push(d);
    themDong(tbody, trongTrang, true);
    if (than.scrollHeight > THAN_H && trongTrang.length > 1) {
      trongTrang.pop();
      themDong(tbody, trongTrang, true);
      mo(false);
      trongTrang.push(d);
      themDong(tbody, trongTrang, true);
    }
  }
  return trangs;
}

/** Vẽ (lại) thân bảng cho danh sách dòng; ô Vùng / Người phụ trách gộp theo nhóm liền nhau. */
function themDong(tbody: HTMLTableSectionElement, ds: DongIn[], veLai = false): void {
  if (veLai) tbody.textContent = "";
  for (let i = 0; i < ds.length; i++) {
    const d = ds[i];
    const tr = document.createElement("tr");
    const dauVung = i === 0 || ds[i - 1].vung !== d.vung;
    const dauPm = dauVung || ds[i - 1].pm !== d.pm;
    if (dauVung) {
      let n = 1; while (i + n < ds.length && ds[i + n].vung === d.vung) n++;
      const td = document.createElement("td");
      td.rowSpan = n; td.textContent = d.vung;
      td.style.cssText = `${TD};white-space:normal;text-align:center;font-weight:700;color:${M.chu}`;
      tr.appendChild(td);
    }
    if (dauPm) {
      let n = 1; while (i + n < ds.length && ds[i + n].vung === d.vung && ds[i + n].pm === d.pm) n++;
      const td = document.createElement("td");
      td.rowSpan = n; td.textContent = d.pm;
      td.style.cssText = `${TD};white-space:normal;text-align:center;color:${M.chuVua}`;
      tr.appendChild(td);
    }
    const ten = document.createElement("td");
    ten.textContent = d.r.ten;
    ten.style.cssText = `${TD};font-weight:700;color:${M.chu};text-overflow:ellipsis`;
    tr.appendChild(ten);
    tr.appendChild(oDiem(d.r.tong, true));
    tr.appendChild(oDiem(d.r.qs)); tr.appendChild(oDiem(d.r.sl)); tr.appendChild(oDiem(d.r.tc));
    tr.appendChild(oDiem(d.r.tuan)); tr.appendChild(oDiem(d.r.thangBC));
    tbody.appendChild(tr);
  }
}

/* ── XUẤT / XEM TRƯỚC ──────────────────────────────────────────────────────────────────────── */

export const tenTepForm = (thang: string, ngay = new Date()): string => {
  const p2 = (x: number) => String(x).padStart(2, "0");
  return `${String(ngay.getFullYear()).slice(2)}${p2(ngay.getMonth() + 1)}${p2(ngay.getDate())}_Báo cáo tuân thủ tổng hợp_${thang.slice(5, 7)}.${thang.slice(0, 4)}.pdf`;
};

/** Dựng rồi tải PDF A4 dọc. Trả tên tệp. */
export async function xuatPdfForm(bang: { duAn: DuAnTongHop[]; pm: PmTongHop[] }, tt: ThongTinForm): Promise<{ ten: string; soTrang: number }> {
  const [{ jsPDF }, h2c] = await Promise.all([import("jspdf"), import("html2canvas-pro")]);
  const html2canvas = h2c.default;
  const host = el("div", "position:fixed;left:-99999px;top:0;z-index:-1;background:#fff");
  document.body.appendChild(host);
  try {
    try { await (document as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready; } catch { /* trình duyệt cũ */ }
    const trangs = dungTrangForm(bang, tt, host);
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    for (let i = 0; i < trangs.length; i++) {
      const cv = await html2canvas(trangs[i], { scale: 2, backgroundColor: "#ffffff", logging: false });
      if (i > 0) pdf.addPage();
      pdf.addImage(cv.toDataURL("image/png"), "PNG", 0, 0, 210, 297);
    }
    const ten = tenTepForm(tt.thang);
    pdf.save(ten);
    return { ten, soTrang: trangs.length };
  } finally {
    host.remove();
  }
}

/** Dựng các trang vào `host` để xem trước (không tải tệp). Trả số trang. */
export function xemTruocForm(bang: { duAn: DuAnTongHop[]; pm: PmTongHop[] }, tt: ThongTinForm, host: HTMLElement): number {
  host.textContent = "";
  const trangs = dungTrangForm(bang, tt, host);
  trangs.forEach((t, i) => { t.style.margin = i ? "14px 0 0" : "0"; t.style.boxShadow = "0 1px 6px rgba(15,23,42,.18)"; });
  return trangs.length;
}

export const KHO_TRANG = { W: TRANG_W, H: TRANG_H };
