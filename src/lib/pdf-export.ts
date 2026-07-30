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

const MARGIN = 7;
const GAP = 2.5; // khoảng cách giữa các khối (mm)

async function snap(el: HTMLElement): Promise<HTMLCanvasElement> {
  return html2canvas(el, {
    scale: 2,
    backgroundColor: "#ffffff",
    logging: false,
    onclone: (doc: Document) => {
      // ── CHUẨN HOÁ FONT KHI CHỤP (sửa "chữ bị bóp/chèn dấu cách/cắt cột" + để MỌI TRÌNH DUYỆT ra
      //    giống nhau) ── App dùng "Inter, system-ui" nhưng html2canvas vẽ chữ qua canvas ctx.font,
      //    mà "system-ui" KHÔNG được canvas phân giải nhất quán (mỗi trình duyệt fallback 1 font khác,
      //    thường RỘNG hơn → tràn ô → cắt Mã, chèn space vào ngày). Ép về "Segoe UI" (chính là font
      //    system-ui trên Windows — Chrome/Edge/Cốc Cốc đều có) để ảnh chụp KHỚP màn hình & GIỐNG NHAU
      //    mọi trình duyệt. tabular-nums cũng dễ giãn khi đổi font → ép normal cho số khỏi lệch.
      const st = doc.createElement("style");
      st.textContent = `*{font-family:"Segoe UI",Arial,Helvetica,sans-serif !important;font-variant-numeric:normal !important;letter-spacing:normal !important}`;
      doc.head.appendChild(st);
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
  /** Hướng giấy A4: "landscape" (ngang, mặc định) hoặc "portrait" (DỌC — cho điện thoại / in A4 dọc).
   *  Dọc dùng CÙNG ảnh chụp bảng, chỉ thu tỉ lệ cho vừa bề rộng dọc (196mm) → chữ nhỏ hơn nhưng
   *  KHÔNG đè/chồng cột vì thu ĐỀU (mọi cột giữ đúng tỉ lệ như bản ngang). */
  orientation?: "landscape" | "portrait";
  fileName: string;
}): Promise<number> {
  const portrait = opts.orientation === "portrait";
  const pageW = portrait ? 210 : 297; // A4 (mm)
  const pageH = portrait ? 297 : 210;
  const innerW = pageW - MARGIN * 2;
  const bottomY = pageH - MARGIN;
  const pdf = new jsPDF({ orientation: portrait ? "portrait" : "landscape", unit: "mm", format: "a4" });
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

  // Chụp RIÊNG phần HEADER (tạm ẩn tbody) → ảnh header SẠCH, KHÔNG dính viền/nền XANH của HÀNG ĐẦU
  // (dòng "đã bàn giao" có border-emerald + bg xanh ngay dưới header → nếu cắt header từ ảnh bảng sẽ
  // lẹm vệt xanh vào MỌI header lặp qua trang). Bảng table-fixed + colgroup % nên ẩn tbody vẫn đúng cột.
  let theadCv: HTMLCanvasElement | null = null;
  const tbodyEl = tbl.tBodies[0] as HTMLElement | undefined;
  if (tbl.tHead && tbodyEl) {
    const prevDisp = tbodyEl.style.display;
    tbodyEl.style.display = "none";
    void tbl.offsetHeight;
    theadCv = await snap(tbl);
    tbodyEl.style.display = prevDisp;
    void tbl.offsetHeight;
  }

  const cv = await snap(tbl);
  const pxW = tbl.offsetWidth || 1;
  const k = cv.width / pxW;        // px DOM → px canvas
  const mmPerPx = innerW / pxW;    // px DOM → mm trên giấy

  // Cắt vùng [topPx, topPx+hPx] khỏi ảnh bảng. Dùng floor(top)/ceil(bottom) để LUÔN BAO TRỌN hàng
  // (không lẹm mất đỉnh/đáy do làm tròn) — hết clip ~1-2px ở hàng đầu mỗi trang.
  const slice = (topPx: number, hPx: number): HTMLCanvasElement => {
    const srcTop = Math.floor(topPx * k);
    const srcBot = Math.ceil((topPx + hPx) * k);
    const c = document.createElement("canvas");
    c.width = cv.width;
    c.height = Math.max(1, srcBot - srcTop);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(cv, 0, srcTop, cv.width, c.height, 0, 0, cv.width, c.height);
    return c;
  };

  const rows = bodyRows;
  // Header vẽ ở đầu mỗi trang: DÙNG ẢNH HEADER SẠCH (theadCv, không xanh) nhưng vẽ ở ĐÚNG chiều cao
  // rows[0].offsetTop (ranh giới thead/body trong ảnh BẢNG) → khít với body bên dưới, KHÔNG clip đỉnh
  // hàng đầu, KHÔNG hở. Body vẫn cắt từ cv bắt đầu ở rows[i].offsetTop.
  const theadHpx = rows.length ? rows[0].offsetTop : (tbl.tHead?.offsetHeight ?? 0);
  const theadMm = theadHpx * mmPerPx;
  const drawThead = () => { if (theadCv && theadHpx > 0) { pdf.addImage(theadCv.toDataURL("image/jpeg", 0.92), "JPEG", MARGIN, y, innerW, theadMm); y += theadMm; } };

  if (rows.length === 0) {
    const hMm = (cv.height / cv.width) * innerW;
    if (y + hMm > bottomY) { pdf.addPage(); y = MARGIN; }
    draw(cv, hMm);
  } else {
    // Đệm an toàn (mm) tránh hàng dính SÁT mép dưới do làm tròn → nhìn như bị cắt.
    const SAFE = 0.6;
    let i = 0;
    while (i < rows.length) {
      const firstMm = rows[i].offsetHeight * mmPerPx;
      // Sang TRANG MỚI nếu header + hàng đầu không vừa chỗ còn lại (và hiện KHÔNG ở đầu trang).
      if (y > MARGIN + 0.5 && y + theadMm + firstMm > bottomY) { pdf.addPage(); y = MARGIN; }
      // Tiêu đề cột lặp lại ở đầu phần bảng của mỗi trang (ảnh header RIÊNG, không dính hàng đầu).
      drawThead();
      const avail = bottomY - y - SAFE; // chỗ còn cho HÀNG (đã trừ header vừa vẽ).
      // Gom TỐI ĐA số hàng NGUYÊN vừa trang — KHÔNG cắt đôi bất kỳ hàng nào.
      const startTop = rows[i].offsetTop;
      let j = i;
      let acc = 0;
      while (j < rows.length) {
        const rMm = rows[j].offsetHeight * mmPerPx;
        if (j > i && acc + rMm > avail) break;
        acc += rMm;
        j++;
      }
      const endBottom = rows[j - 1].offsetTop + rows[j - 1].offsetHeight;
      const groupMm = (endBottom - startTop) * mmPerPx;
      const img = slice(startTop, endBottom - startTop).toDataURL("image/jpeg", 0.92);
      if (groupMm > avail) {
        // MỘT hàng đơn CAO HƠN cả trang (vd dòng dự án nhiều bong bóng vướng mắc) → THU cả hàng cho
        // VỪA 1 trang (giữ tỉ lệ, căn giữa) — thà nhỏ lại còn hơn cắt ngang giữa hàng.
        const scale = avail / groupMm;
        const wMm = innerW * scale;
        pdf.addImage(img, "JPEG", MARGIN + (innerW - wMm) / 2, y, wMm, avail);
        y += avail;
      } else {
        pdf.addImage(img, "JPEG", MARGIN, y, innerW, groupMm);
        y += groupMm;
      }
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
