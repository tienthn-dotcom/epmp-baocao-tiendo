/**
 * XUẤT PDF = "CHỤP" ĐÚNG GIAO DIỆN đang hiển thị rồi ghép thành PDF A4 ngang.
 *
 * Vì sao không dùng window.print(): hộp thoại in phụ thuộc cài đặt máy từng
 * người (khổ giấy, lề, header/footer thời gian của Chrome) → bố cục vỡ tùy máy.
 * Cách này app tự dựng file: nhìn trên màn hình sao, PDF ra đúng vậy, mọi máy
 * như nhau, không hộp thoại, không dòng thời gian góc trang.
 *
 * Kỹ thuật:
 *  - html2canvas-pro (hỗ trợ màu oklch của Tailwind v4) chụp từng khối.
 *  - Các khối trên (KPI, thẻ giai đoạn) giữ nguyên, không cắt ngang khối.
 *  - Bảng: chụp nguyên bảng một lần, sang trang thì CẮT ĐÚNG RANH GIỚI HÀNG
 *    và vẽ lại tiêu đề cột ở đầu mỗi trang.
 *  - Mọi phần tử có class "print:hidden" (nút, tay kéo cột…) bị loại khỏi ảnh.
 */
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas-pro";
import { PDF_TABLE_WIDTH, PDF_TABLE_FONT_PX } from "./table-scale";

const PAGE_W = 297; // A4 ngang (mm)
const PAGE_H = 210;
const MARGIN = 7;
const GAP = 2.5; // khoảng cách giữa các khối (mm)

async function snap(el: HTMLElement): Promise<HTMLCanvasElement> {
  return html2canvas(el, {
    scale: 2,
    backgroundColor: "#ffffff",
    logging: false,
    onclone: (doc: Document) => {
      // Bỏ mọi điều khiển vô dụng trên giấy (đã gắn class print:hidden trong JSX)
      doc.querySelectorAll('[class*="print:hidden"]').forEach((n) => n.remove());
      // Header bảng đừng sticky trong ảnh chụp
      doc.querySelectorAll("thead.sticky, thead .sticky").forEach((n) => n.classList.remove("sticky"));
      doc.querySelectorAll("thead").forEach((n) => (n as HTMLElement).classList.remove("sticky"));
      // Bảng "Tổng thể tiến độ" đóng băng cột trái bằng inline position:sticky —
      // html2canvas không mô phỏng sticky nên cột sẽ đè/lệch. Trả về static để
      // mọi cột nằm đúng dòng chảy tự nhiên (ảnh chụp = đủ bảng, không chồng chữ).
      doc.querySelectorAll<HTMLElement>('[style*="position: sticky"], [style*="position:sticky"]')
        .forEach((n) => { n.style.position = "static"; });
    },
  });
}

export async function exportDashboardPdf(opts: {
  /** Khối tiêu đề (2 dòng tên báo cáo) — vẽ NHỎ GỌN ở góc trên trái trang 1. */
  title?: HTMLElement | null;
  /** Các khối phía trên (giữ nguyên khối, không cắt ngang). */
  blocks: HTMLElement[];
  /** Bảng cần xuất — cắt trang theo ranh giới hàng. */
  table: HTMLTableElement;
  /** Bảng RỘNG tự nhiên (Tổng thể tiến độ): KHÔNG ép về 1280px mà giữ bề rộng thật
   *  rồi thu tỉ lệ cho vừa khổ giấy — nếu ép sẽ bóp méo lưới tuần. */
  wide?: boolean;
  fileName: string;
}): Promise<number> {
  const innerW = PAGE_W - MARGIN * 2;
  const bottomY = PAGE_H - MARGIN;
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  let y = MARGIN;

  // Đợi web-font tải xong TRƯỚC khi chụp: Safari/Firefox hay chụp lúc font chưa sẵn
  // → chữ lệch/khác Chrome. Chờ document.fonts.ready để MỌI trình duyệt cùng layout.
  try { await (document as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready; } catch { /* */ }

  const draw = (cv: HTMLCanvasElement, hMm: number) => {
    pdf.addImage(cv.toDataURL("image/jpeg", 0.92), "JPEG", MARGIN, y, innerW, hMm);
    y += hMm;
  };

  /* ── Tiêu đề báo cáo: góc trên trái, vừa đủ nhìn (cao ~10mm) ── */
  if (opts.title) {
    // Bỏ CẮT CHỮ (class "truncate") để tên báo cáo hiện ĐỦ trong PDF: html2canvas
    // chụp đúng những gì đang render, nên nới rộng trước khi chụp rồi khôi phục ngay.
    const el = opts.title;
    const prevEl = el.style.cssText;
    const clamped = Array.from(el.querySelectorAll<HTMLElement>('[class*="truncate"]'));
    const savedCss = clamped.map((n) => n.style.cssText);
    el.style.width = "max-content";
    el.style.maxWidth = "none";
    clamped.forEach((n) => {
      n.style.overflow = "visible";
      n.style.textOverflow = "clip";
      n.style.whiteSpace = "nowrap";
      n.style.maxWidth = "none";
      n.style.width = "auto";
    });
    void el.offsetWidth; // buộc reflow trước khi chụp
    const cv = await snap(el);
    el.style.cssText = prevEl;
    clamped.forEach((n, i) => { n.style.cssText = savedCss[i]; });
    const hMm = 10;
    const wMm = Math.min((cv.width / cv.height) * hMm, innerW);
    pdf.addImage(cv.toDataURL("image/png"), "PNG", MARGIN, y, wMm, hMm);
    y += hMm + 3;
  }

  /* ── Khối trên ── */
  for (const b of opts.blocks) {
    const cv = await snap(b);
    const hMm = (cv.height / cv.width) * innerW;
    if (y + hMm > bottomY) { pdf.addPage(); y = MARGIN; }
    draw(cv, hMm);
    y += GAP;
  }

  /* ── Bảng ── */
  const tbl = opts.table;
  // CỐ ĐỊNH bề rộng + cỡ chữ khi chụp → PDF GIỐNG NHAU trên mọi màn hình & trình duyệt
  // (bỏ phụ thuộc clamp(vw) responsive + giảm khác biệt render Chrome/Safari/Firefox).
  // Khôi phục nguyên trạng ngay sau khi chụp xong.
  const savedTblCss = tbl.style.cssText;
  if (!opts.wide) {
    tbl.style.width = `${PDF_TABLE_WIDTH}px`;
    tbl.style.minWidth = `${PDF_TABLE_WIDTH}px`;
    tbl.style.maxWidth = `${PDF_TABLE_WIDTH}px`;
    // Cỡ chữ phải TƯƠNG ỨNG với bề rộng vừa ép (xem lib/table-scale.ts). Trước đây ghi
    // cứng 11px — đó là cỡ dành cho bảng 1532px, đặt lên bảng 1280px thì chữ to hơn cột
    // ⇒ badge tràn trong PDF dù trên màn hình vẫn đẹp.
    tbl.style.fontSize = `${PDF_TABLE_FONT_PX}px`;
  }
  // Bỏ chiều cao hàng do "equalize" ép trên màn hình (có thể còn dính giá trị
  // cũ khi cửa sổ từng hẹp → hàng phồng → PDF thừa hàng chục trang). Chụp bảng
  // ở CHIỀU CAO TỰ NHIÊN để cả ảnh chụp lẫn phép cắt trang dùng cùng số đo.
  const bodyRows = tbl.tBodies[0] ? Array.from(tbl.tBodies[0].rows) as HTMLTableRowElement[] : [];
  const savedHeights = bodyRows.map(r => r.style.height);
  bodyRows.forEach(r => { r.style.height = ""; });
  void tbl.offsetHeight; // buộc reflow trước khi chụp
  const cv = await snap(tbl);
  const pxW = tbl.offsetWidth || 1;
  const k = cv.width / pxW;        // px DOM → px canvas
  const mmPerPx = innerW / pxW;    // px DOM → mm trên giấy

  const slice = (topPx: number, hPx: number): HTMLCanvasElement => {
    const c = document.createElement("canvas");
    c.width = cv.width;
    c.height = Math.max(1, Math.round(hPx * k));
    const ctx = c.getContext("2d")!;
    ctx.drawImage(cv, 0, Math.round(topPx * k), cv.width, c.height, 0, 0, cv.width, c.height);
    return c;
  };

  const theadHpx = tbl.tHead?.offsetHeight ?? 0;
  const theadMm = theadHpx * mmPerPx;
  const rows = bodyRows;

  if (rows.length === 0) {
    const hMm = (cv.height / cv.width) * innerW;
    if (y + hMm > bottomY) { pdf.addPage(); y = MARGIN; }
    draw(cv, hMm);
  } else {
    let i = 0;
    while (i < rows.length) {
      const firstMm = rows[i].offsetHeight * mmPerPx;
      if (y + theadMm + firstMm > bottomY) { pdf.addPage(); y = MARGIN; }
      // Tiêu đề cột lặp lại ở đầu phần bảng của mỗi trang
      if (theadHpx > 0) draw(slice(0, theadHpx), theadMm);
      // Gom tối đa số hàng vừa trang — không cắt đôi hàng
      const startTop = rows[i].offsetTop;
      let j = i;
      let acc = 0;
      while (j < rows.length) {
        const rMm = rows[j].offsetHeight * mmPerPx;
        if (j > i && y + acc + rMm > bottomY) break;
        acc += rMm;
        j++;
      }
      const endBottom = rows[j - 1].offsetTop + rows[j - 1].offsetHeight;
      draw(slice(startTop, endBottom - startTop), (endBottom - startTop) * mmPerPx);
      i = j;
    }
  }

  // Trả lại chiều cao cũ + bề rộng/cỡ chữ responsive + phát sự kiện resize để màn hình
  // tự cân bằng lại hàng.
  bodyRows.forEach((r, i) => { r.style.height = savedHeights[i] ?? ""; });
  tbl.style.cssText = savedTblCss;
  window.dispatchEvent(new Event("resize"));

  pdf.save(opts.fileName);
  return pdf.getNumberOfPages();
}
