/**
 * TRẠM XUẤT BÁO CÁO — phần DỰNG TRANG GIẤY.
 *
 * Nhận `BanBaoCao` (đã đếm xong ở `tram-bao-cao.ts`) rồi dựng từng trang A4 thành phần tử DOM
 * thật, sau đó chụp bằng html2canvas-pro và dán vào jsPDF. Cùng đường đi với bản báo cáo dự án
 * có sẵn (`pdf-project-report.ts`): jsPDF vẽ chữ vector KHÔNG đủ dấu tiếng Việt, chụp qua trình
 * duyệt thì dấu chuẩn.
 *
 * ── BẢN MẪU ─────────────────────────────────────────────────────────────────────────────────
 * Anh Tiến gửi `1PR_Holiday Inn Ba Na_061026.pdf` làm chuẩn. Đo lại từ chính tệp đó, không ước
 * lượng bằng mắt: khung đỏ #A51C21 trên dưới, chỉ cam #E8762C, chữ tiêu đề navy #1F3864, đầu
 * bảng navy nền đặc chữ trắng, số liệu nổi màu cam/lục/đỏ, chân trang chữ trắng trong dải đỏ.
 *
 * ── CẮT TRANG BẰNG CÁCH ĐO THẬT ─────────────────────────────────────────────────────────────
 * Không tính nhẩm "mỗi trang chứa N dòng". Dòng được gắn vào trang rồi ĐO; tràn thì gỡ ra, mở
 * trang mới, gắn lại. Tính nhẩm thì sớm muộn cũng có bản dài hơn dự tính và mất dòng cuối —
 * mất dòng trong bản gửi BOD là kiểu sai không ai thấy.
 */
import { AA_LOGO_DATA_URI } from "@/lib/aa-logo";
import type { BanBaoCao, Mau, O } from "@/lib/tram-bao-cao";
import { tenTep } from "@/lib/tram-bao-cao";

/* Đo từ bản mẫu — xem đầu tệp. */
const C = {
  do: "#A51C21", cam: "#E8762C", navy: "#1F3864", luc: "#2E7D32",
  ink: "#2B2B2B", mute: "#6E6E6E", line: "#E4E4E4", soc: "#F6F6F6", cong: "#EEF1F6", trang: "#FFFFFF",
};
const MAU: Record<Mau, string> = { ink: C.ink, mute: C.mute, navy: C.navy, do: C.do, cam: C.cam, luc: C.luc };

/* A4 ở 96dpi. Lề 15mm = 57px, đo lại từ bản mẫu. */
const TRANG_W = 794, TRANG_H = 1123, LE = 57;
const DAI_TREN = 20;   // dải đỏ 16 + chỉ cam 4
const DAI_DUOI = 38;   // chỉ cam 4 + dải đỏ 34 (có chữ chân trang)
const THAN_TOP = DAI_TREN + 16;
const THAN_BOT = DAI_DUOI + 12;
const THAN_H = TRANG_H - THAN_TOP - THAN_BOT;

const FONT = "'Segoe UI',Inter,system-ui,'Helvetica Neue',Arial,sans-serif";

export type ThongTinIn = {
  /** Dòng "Số liệu ngày …" dưới tiêu đề. Mặc định hôm nay. */
  ngay?: Date;
  /** Chữ bên trái chân trang. */
  nguon?: string;
  /** Người xuất — ghép vào chân trang để biết bản này ai dựng. */
  nguoiXuat?: string;
};

const el = (tag: string, css: string, chu?: string): HTMLElement => {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (chu != null) e.textContent = chu;
  return e;
};

const ngayChu = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

/* ── KHUNG MỘT TRANG ───────────────────────────────────────────────────────────────────────── */

function trangMoi(tt: ThongTinIn, ngay: Date): { trang: HTMLElement; than: HTMLElement; soTrang: HTMLElement } {
  const trang = el("div", `position:relative;width:${TRANG_W}px;height:${TRANG_H}px;box-sizing:border-box;`
    + `background:${C.trang};font-family:${FONT};color:${C.ink};overflow:hidden`);

  trang.appendChild(el("div", `position:absolute;left:0;right:0;top:0;height:16px;background:${C.do}`));
  trang.appendChild(el("div", `position:absolute;left:0;right:0;top:16px;height:4px;background:${C.cam}`));
  trang.appendChild(el("div", `position:absolute;left:0;right:0;bottom:34px;height:4px;background:${C.cam}`));

  const chan = el("div", `position:absolute;left:0;right:0;bottom:0;height:34px;background:${C.do};`
    + `display:flex;align-items:center;justify-content:space-between;padding:0 ${LE}px;box-sizing:border-box`);
  chan.appendChild(el("div", "font-size:8.5px;color:#FFFFFF;letter-spacing:.3px",
    tt.nguon || "OCC · Phòng Điều hành Trung tâm · ePMP"));
  const phai = el("div", "display:flex;align-items:center;gap:14px");
  const soTrang = el("div", "font-size:8.5px;color:#F3D6D7", "");
  phai.appendChild(soTrang);
  phai.appendChild(el("div", "font-size:9px;font-weight:700;color:#FFFFFF", ngayChu(ngay)));
  chan.appendChild(phai);
  trang.appendChild(chan);

  const than = el("div", `position:absolute;left:${LE}px;right:${LE}px;top:${THAN_TOP}px;height:${THAN_H}px;overflow:hidden`);
  trang.appendChild(than);
  return { trang, than, soTrang };
}

/* ── CÁC KHỐI NỘI DUNG ─────────────────────────────────────────────────────────────────────── */

function khoiDau(ban: BanBaoCao, ngay: Date): HTMLElement {
  const b = el("div", "");
  const hang = el("div", "display:flex;align-items:flex-end;justify-content:space-between;gap:20px");

  const logo = document.createElement("img");
  logo.src = AA_LOGO_DATA_URI;
  logo.style.cssText = "height:44px;width:auto;object-fit:contain;display:block";
  hang.appendChild(logo);

  const phai = el("div", "text-align:right;min-width:0;flex:1");
  phai.appendChild(el("div", `font-size:19px;font-weight:800;color:${C.navy};line-height:1.15;letter-spacing:.2px`, ban.tieuDe));
  if (ban.phuDe) phai.appendChild(el("div", `font-size:10px;color:${C.mute};margin-top:3px`, ban.phuDe));
  phai.appendChild(el("div", `font-size:9px;color:${C.mute};margin-top:2px`, `Số liệu ngày ${ngayChu(ngay)}`));
  hang.appendChild(phai);
  b.appendChild(hang);
  b.appendChild(el("div", `height:1px;background:${C.line};margin:11px 0 0`));
  return b;
}

function khoiKpi(ban: BanBaoCao): HTMLElement {
  const b = el("div", "display:flex;align-items:flex-start;padding:13px 0 12px");
  for (const k of ban.kpi) {
    const o = el("div", "flex:1;min-width:0;text-align:center;padding:0 4px");
    /* Ô "20009/33895 mã đã xong" dài gấp đôi "62" — để nguyên 22px là tràn sang ô bên cạnh. */
    const co = k.so.length > 10 ? 15 : k.so.length > 6 ? 18 : 22;
    o.appendChild(el("div", `font-size:${co}px;font-weight:800;line-height:1.05;color:${MAU[k.mau]};font-variant-numeric:tabular-nums`, k.so));
    o.appendChild(el("div", `font-size:8.5px;color:${C.mute};margin-top:3px;line-height:1.25`, k.nhan));
    b.appendChild(o);
  }
  const vo = el("div", "");
  vo.appendChild(b);
  vo.appendChild(el("div", `height:1px;background:${C.line}`));
  return vo;
}

function tieuDeNhom(ten: string, tiep: boolean): HTMLElement {
  return el("div", `font-size:11px;font-weight:800;color:${C.navy};letter-spacing:.3px;`
    + "text-transform:uppercase;margin:13px 0 5px", tiep ? `${ten} (tiếp)` : ten);
}

function bangMoi(ban: BanBaoCao): { bang: HTMLTableElement; than: HTMLTableSectionElement } {
  const bang = document.createElement("table");
  bang.style.cssText = "width:100%;border-collapse:collapse;table-layout:fixed";
  const tong = ban.cot.reduce((a, c) => a + c.rong, 0);
  const cg = document.createElement("colgroup");
  for (const c of ban.cot) {
    const col = document.createElement("col");
    col.style.width = `${(c.rong / tong) * 100}%`;
    cg.appendChild(col);
  }
  bang.appendChild(cg);

  const thead = document.createElement("thead");
  const tr = document.createElement("tr");
  for (const c of ban.cot) {
    const th = document.createElement("th");
    th.textContent = c.ten;
    th.style.cssText = `background:${C.navy};color:#FFFFFF;font-size:9px;font-weight:700;padding:5px 6px;`
      + `text-align:${c.phai ? "right" : "left"};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;
    tr.appendChild(th);
  }
  thead.appendChild(tr);
  bang.appendChild(thead);

  const than = document.createElement("tbody");
  bang.appendChild(than);
  return { bang, than };
}

function dongBang(o: O[], soc: boolean, cong = false): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.style.cssText = cong
    ? `background:${C.cong};border-top:1px solid ${C.navy}`
    : `background:${soc ? C.soc : C.trang};border-bottom:1px solid #EFEFEF`;
  for (const c of o) {
    const td = document.createElement("td");
    td.textContent = c.t;
    td.style.cssText = `font-size:9px;padding:4px 6px;line-height:1.3;color:${MAU[c.mau ?? "ink"]};`
      + `${c.dam ? "font-weight:700;" : ""}text-align:${c.phai ? "right" : "left"};`
      + "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums";
    tr.appendChild(td);
  }
  return tr;
}

function khoiNhanXet(ban: BanBaoCao): HTMLElement {
  const b = el("div", "margin-top:15px;break-inside:avoid");
  b.appendChild(el("div", `font-size:11px;font-weight:800;color:${C.navy};letter-spacing:.3px;margin-bottom:5px`, "ĐÁNH GIÁ NHANH"));
  for (const s of ban.nhanXet) {
    const d = el("div", `font-size:9.5px;color:${C.ink};line-height:1.5;padding-left:10px;position:relative`);
    d.appendChild(el("span", `position:absolute;left:0;top:0;color:${C.cam};font-weight:800`, "•"));
    d.appendChild(el("span", "", s));
    b.appendChild(d);
  }
  return b;
}

/* ── CẮT TRANG ─────────────────────────────────────────────────────────────────────────────── */

/**
 * Dựng danh sách trang A4 (phần tử DOM) cho một bản báo cáo.
 * Phải gắn `host` vào document trước khi gọi — đo chiều cao cần bố cục thật.
 */
export function dungTrang(ban: BanBaoCao, host: HTMLElement, tt: ThongTinIn = {}): HTMLElement[] {
  const ngay = tt.ngay ?? new Date();
  const trangs: HTMLElement[] = [];
  const soTrangEls: HTMLElement[] = [];

  let than!: HTMLElement;
  const mo = (): void => {
    const t = trangMoi(tt, ngay);
    host.appendChild(t.trang);
    trangs.push(t.trang);
    soTrangEls.push(t.soTrang);
    than = t.than;
  };
  /** Gắn rồi ĐO. Tràn thì gỡ ra, mở trang mới, gắn lại. Trả true nếu đã sang trang. */
  const gan = (node: HTMLElement, lamLaiDau?: () => void): boolean => {
    than.appendChild(node);
    if (than.scrollHeight <= THAN_H) return false;
    than.removeChild(node);
    mo();
    lamLaiDau?.();
    than.appendChild(node);
    return true;
  };

  mo();
  than.appendChild(khoiDau(ban, ngay));
  than.appendChild(khoiKpi(ban));

  if (ban.soDong === 0) {
    than.appendChild(el("div", `margin-top:40px;text-align:center;font-size:11px;color:${C.mute}`,
      "Không có dòng nào khớp bộ lọc đang chọn."));
  }

  for (const nhom of ban.nhom) {
    let tiep = false;
    let boc = el("div", "");
    let { bang, than: tbody } = bangMoi(ban);
    const dungDau = () => {
      boc = el("div", "");
      boc.appendChild(tieuDeNhom(nhom.ten, tiep));
      const b = bangMoi(ban);
      bang = b.bang; tbody = b.than;
      boc.appendChild(bang);
      than.appendChild(boc);
    };
    boc.appendChild(tieuDeNhom(nhom.ten, false));
    boc.appendChild(bang);
    /* Tiêu đề nhóm + đầu bảng phải sang trang CÙNG NHAU, không được đứng lẻ cuối trang. */
    gan(boc);

    for (let i = 0; i < nhom.dong.length; i++) {
      const tr = dongBang(nhom.dong[i], i % 2 === 1);
      tbody.appendChild(tr);
      if (than.scrollHeight > THAN_H) {
        tbody.removeChild(tr);
        mo();
        tiep = true;
        dungDau();
        tbody.appendChild(tr);
      }
    }
    if (nhom.tong) {
      const tr = dongBang(nhom.tong, false, true);
      tbody.appendChild(tr);
      if (than.scrollHeight > THAN_H) {
        tbody.removeChild(tr);
        mo();
        tiep = true;
        dungDau();
        tbody.appendChild(tr);
      }
    }
  }

  if (ban.nhanXet.length) gan(khoiNhanXet(ban));

  const tong = trangs.length;
  soTrangEls.forEach((e, i) => { e.textContent = `Trang ${i + 1}/${tong}`; });
  return trangs;
}

/* ── XUẤT ──────────────────────────────────────────────────────────────────────────────────── */

/** Chụp các trang đã dựng rồi ghi thành PDF A4 dọc. Trả tên tệp đã tải. */
export async function xuatPdf(ban: BanBaoCao, tt: ThongTinIn = {}): Promise<string> {
  const [{ jsPDF }, html2canvasMod] = await Promise.all([import("jspdf"), import("html2canvas-pro")]);
  const html2canvas = html2canvasMod.default;

  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-99999px;top:0;z-index:-1;background:${C.trang}`;
  document.body.appendChild(host);
  try {
    try { await (document as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready; } catch { /* trình duyệt cũ */ }
    const trangs = dungTrang(ban, host, tt);
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    for (let i = 0; i < trangs.length; i++) {
      const cv = await html2canvas(trangs[i], { scale: 2, backgroundColor: C.trang, logging: false });
      if (i > 0) pdf.addPage();
      /* PNG chứ không JPEG: trang này gần như toàn mảng màu phẳng + chữ nhỏ, nên PNG vừa NHẸ HƠN
         vừa nét hơn. Đo thật trên một trang bảng dày: PNG 492 KB · JPEG q94 622 KB · q85 456 KB
         (q85 nhẹ hơn chút nhưng chữ 9px bị nhoè viền). */
      pdf.addImage(cv.toDataURL("image/png"), "PNG", 0, 0, 210, 297);
    }
    const ten = tenTep(ban, tt.ngay ?? new Date());
    pdf.save(ten);
    return ten;
  } finally {
    host.remove();
  }
}

/** Dựng TRANG ĐẦU để xem trước trong hộp thoại (không tải tệp). Bên gọi tự dọn host. */
export function xemTruoc(ban: BanBaoCao, host: HTMLElement, tt: ThongTinIn = {}): number {
  host.textContent = "";
  const trangs = dungTrang(ban, host, tt);
  trangs.forEach((t, i) => { t.style.margin = i ? "14px 0 0" : "0"; t.style.boxShadow = "0 1px 6px rgba(15,23,42,.18)"; });
  return trangs.length;
}
