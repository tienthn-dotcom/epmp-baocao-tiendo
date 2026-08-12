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

/** Chuẩn hoá DOM CLONE trước khi html2canvas chụp (dùng CHUNG cho mọi khối + bảng, và cũng là
 *  layout mà ta ĐO ranh giới hàng để cắt trang → đo & chụp luôn KHỚP nhau). */
function applyExportClone(doc: Document): void {
  // ── CHUẨN HOÁ FONT (sửa "chữ bị bóp/chèn dấu cách/cắt cột" + để MỌI TRÌNH DUYỆT ra giống nhau) ──
  //    App dùng "Inter, system-ui" nhưng html2canvas vẽ chữ qua canvas ctx.font, mà "system-ui" KHÔNG
  //    được canvas phân giải nhất quán (mỗi trình duyệt fallback 1 font khác, thường RỘNG hơn → tràn ô
  //    → cắt Mã, chèn space vào ngày). Ép về "Segoe UI" (font system-ui trên Windows) để ảnh khớp màn &
  //    GIỐNG NHAU mọi trình duyệt. tabular-nums dễ giãn khi đổi font → ép normal cho số khỏi lệch.
  const st = doc.createElement("style");
  st.textContent = `*{font-family:"Segoe UI",Arial,Helvetica,sans-serif !important;font-variant-numeric:normal !important;letter-spacing:normal !important}`;
  doc.head.appendChild(st);
  // Bỏ mọi điều khiển vô dụng trên giấy (đã gắn class print:hidden trong JSX)
  doc.querySelectorAll('[class*="print:hidden"]').forEach((n) => n.remove());
  // Header bảng đừng sticky trong ảnh chụp
  doc.querySelectorAll("thead").forEach((n) => (n as HTMLElement).classList.remove("sticky"));
  // Bảng "Tổng thể tiến độ" đóng băng cột trái bằng inline position:sticky — html2canvas không mô phỏng
  // sticky nên cột sẽ đè/lệch. Trả về static để mọi cột nằm đúng dòng chảy tự nhiên.
  doc.querySelectorAll<HTMLElement>('[style*="position: sticky"], [style*="position:sticky"]')
    .forEach((n) => { n.style.position = "static"; });
}

async function snap(el: HTMLElement): Promise<HTMLCanvasElement> {
  return html2canvas(el, { scale: 2, backgroundColor: "#ffffff", logging: false, onclone: applyExportClone });
}

export async function exportDashboardPdf(opts: {
  /** Khối tiêu đề (2 dòng tên báo cáo) — vẽ NHỎ GỌN ở góc trên trái trang 1. */
  title?: HTMLElement | null;
  /** Các khối phía trên (giữ nguyên khối, không cắt ngang). */
  blocks: HTMLElement[];
  /** Bảng cần xuất — cắt trang theo ranh giới hàng. BỎ TRỐNG (null) khi chỉ xuất khối (vd biểu đồ
   *  Tóm tắt không có bảng) → engine chỉ vẽ title + blocks. */
  table?: HTMLTableElement | null;
  /** Bảng RỘNG tự nhiên (Tổng thể tiến độ): KHÔNG ép về 1280px mà giữ bề rộng thật
   *  rồi thu tỉ lệ cho vừa khổ giấy — nếu ép sẽ bóp méo lưới tuần. */
  wide?: boolean;
  /** Hướng giấy A4: "landscape" (ngang, mặc định) hoặc "portrait" (DỌC — cho điện thoại / in A4 dọc).
   *  Dọc dùng CÙNG ảnh chụp bảng, chỉ thu tỉ lệ cho vừa bề rộng dọc (196mm) → chữ nhỏ hơn nhưng
   *  KHÔNG đè/chồng cột vì thu ĐỀU (mọi cột giữ đúng tỉ lệ như bản ngang). */
  orientation?: "landscape" | "portrait";
  /** ÉP GỌN 1 TRANG: thu toàn bộ khối (title + blocks) cho vừa CHIỀU CAO còn lại của trang (giữ tỉ lệ,
   *  căn giữa) → chắc chắn 1 trang. Dùng cho trang Tóm tắt (biểu đồ + bảng gọn). KHÔNG cắt trang. */
  singlePage?: boolean;
  /** GỘP: bảng BẮT ĐẦU Ở TRANG MỚI (trang trước dành riêng cho blocks Tóm tắt). */
  tableStartsNewPage?: boolean;
  /** Ẩn (display:none) các phần tử này KHI chụp blocks rồi TRẢ LẠI — vd giấu chú thích khỏi trang Tóm tắt
   *  khi xuất RIÊNG bản Tóm tắt. */
  hideInBlocks?: HTMLElement[];
  /** XEM TRƯỚC: KHÔNG tải file — trả về `blobUrl` để app hiển thị trong iframe (người dùng soát rồi tự
   *  Tải/In). Bỏ trống/false → tải file như cũ. */
  preview?: boolean;
  fileName: string;
}): Promise<{ pages: number; blobUrl?: string }> {
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
  // Giấu tạm 1 số phần tử khỏi ẢNH BLOCKS (vd chú thích ✓/o/x không thuộc trang Tóm tắt) — trả lại ngay sau.
  const tempHidden = (opts.hideInBlocks ?? []).map((el) => ({ el, disp: el.style.display }));
  tempHidden.forEach(({ el }) => { el.style.display = "none"; });
  if (opts.singlePage && opts.blocks.length) {
    // ÉP 1 TRANG: chụp hết block, thu theo HỆ SỐ CHUNG cho vừa chiều cao còn lại (giữ tỉ lệ, căn giữa).
    const cvs: HTMLCanvasElement[] = [];
    for (const b of opts.blocks) cvs.push(await snap(b));
    const natH = cvs.reduce((s, cv) => s + (cv.height / cv.width) * innerW, 0) + GAP * (cvs.length - 1);
    const scale = Math.min(1, (bottomY - y) / natH);
    for (const cv of cvs) {
      const hMm = (cv.height / cv.width) * innerW * scale;
      const wMm = innerW * scale;
      pdf.addImage(cv.toDataURL("image/jpeg", 0.92), "JPEG", MARGIN + (innerW - wMm) / 2, y, wMm, hMm);
      y += hMm + GAP;
    }
  } else {
    for (const b of opts.blocks) {
      const cv = await snap(b);
      const hMm = (cv.height / cv.width) * innerW;
      if (y + hMm > bottomY) { pdf.addPage(); y = MARGIN; }
      draw(cv, hMm);
      y += GAP;
    }
  }
  tempHidden.forEach(({ el, disp }) => { el.style.display = disp; });   // trả lại các phần tử vừa giấu

  /* ── Bảng (BỎ QUA nếu không truyền table — vd xuất biểu đồ Tóm tắt) ── */
  const tbl = opts.table;
  if (tbl) {
  // GỘP: sang TRANG MỚI cho phần bảng (trang trước là Tóm tắt).
  if (opts.tableStartsNewPage && y > MARGIN + 0.5) { pdf.addPage(); y = MARGIN; }
  // Đo ranh giới hàng phải trên ĐÚNG bảng đang chụp. TRƯỚC: hardcode getElementById("pdf-table") →
  // bảng tuân thủ / khối in master KHÔNG mang id đó nên đo nhầm bảng chính #pdf-table (đang ẩn sau
  // modal) ⇒ thead/hàng-đầu lệch + sót dải navy "đen" dưới bảng. Gán id tạm nếu bảng chưa có id,
  // rồi truy đúng id đó trong clone; gỡ lại sau khi chụp.
  const CAP_ID = "__pdf_capture_table__";
  const hadOwnId = !!tbl.id;
  if (!hadOwnId) tbl.id = CAP_ID;
  const capId = tbl.id;
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

  // Số đo DỰ PHÒNG trên DOM sống (dùng nếu vì lý do nào đó không đo được trong clone).
  const livePxW = tbl.offsetWidth || PDF_TABLE_WIDTH;
  const liveTops = bodyRows.map(r => r.offsetTop);
  const liveTheadBot = bodyRows.length ? bodyRows[0].offsetTop : (tbl.tHead?.offsetHeight ?? 0);

  // Chụp bảng 1 lần + ĐO RANH GIỚI HÀNG NGAY TRONG CLONE (đúng toạ độ của ẢNH). Vì clone bị đổi font
  // (Segoe UI) + gỡ control nên CHIỀU CAO hàng KHÁC DOM sống (Inter) — đo trên DOM sống thì vị trí cắt
  // LỆCH → header đè nội dung + hàng bị cắt ngang. Đo trong clone = khớp TUYỆT ĐỐI với ảnh.
  const cm: { tops: number[]; heights: number[]; theadBot: number; cloneW: number } =
    { tops: [], heights: [], theadBot: 0, cloneW: PDF_TABLE_WIDTH };
  const cv = await html2canvas(tbl, {
    scale: 2, backgroundColor: "#ffffff", logging: false,
    onclone: (doc: Document) => {
      applyExportClone(doc);
      const t = (doc.getElementById(capId) as HTMLTableElement | null) ?? doc.querySelector("table");
      const rs = t?.tBodies[0] ? (Array.from(t.tBodies[0].rows) as HTMLTableRowElement[]) : [];
      if (t && rs.length) {
        cm.tops = rs.map(r => r.offsetTop);
        cm.heights = rs.map(r => r.offsetHeight);
        cm.theadBot = rs[0].offsetTop;
        cm.cloneW = t.offsetWidth || PDF_TABLE_WIDTH;
      }
    },
  });

  // Khôi phục bảng NGAY (mọi số đo đã nằm trong cm/live + cv) → màn hình tự cân bằng lại hàng.
  bodyRows.forEach((r, i) => { r.style.height = savedHeights[i] ?? ""; });
  tbl.style.cssText = savedTblCss;
  if (!hadOwnId) tbl.removeAttribute("id");
  window.dispatchEvent(new Event("resize"));

  // Ưu tiên số đo CLONE (khớp ảnh); chỉ rơi về số đo DOM sống nếu clone không đo được (đủ hàng &
  // có layout thật — offsetTop>0). Phòng khi html2canvas render clone chưa xong layout → trả 0 hết.
  const ok = cm.tops.length === bodyRows.length && cm.tops.length > 0
    && cm.theadBot > 0 && cm.tops[cm.tops.length - 1] > cm.theadBot;
  const tops = ok ? cm.tops : liveTops;
  const theadTopCss = ok ? cm.theadBot : liveTheadBot;
  const W = (ok ? cm.cloneW : livePxW) || 1;

  const px2cv = (cssY: number) => Math.round(cssY * (cv.width / W)); // CSS px (theo W) → Y trong ẢNH
  const cv2mm = (py: number) => (py / cv.width) * innerW;            // px cao trong ảnh → mm (giữ tỉ lệ)
  // Cắt dải [y0,y1) theo trục Y của ẢNH.
  const sliceY = (y0: number, y1: number): string => {
    const h = Math.max(1, y1 - y0);
    const c = document.createElement("canvas");
    c.width = cv.width; c.height = h;
    c.getContext("2d")!.drawImage(cv, 0, y0, cv.width, h, 0, 0, cv.width, h);
    return c.toDataURL("image/jpeg", 0.92);
  };

  const n = tops.length;
  if (n === 0) {
    const hMm = (cv.height / cv.width) * innerW;
    if (y + hMm > bottomY) { pdf.addPage(); y = MARGIN; }
    pdf.addImage(cv.toDataURL("image/jpeg", 0.92), "JPEG", MARGIN, y, innerW, hMm);
  } else {
    // RANH GIỚI Y (ảnh) dùng CHUNG cho thead + từng hàng → không hở, không chồng, không lẹm vệt xanh.
    const bnd: number[] = tops.map(px2cv);
    // Đáy hàng cuối = ĐÁY ẢNH thật. Với border-collapse, viền đáy CÙNG của bảng nằm NGOÀI
    // (đỉnh+chiều-cao-hàng-cuối) → cắt đúng số đó sẽ LẸM MẤT line dưới cùng. Dùng cv.height để giữ trọn
    // (không nhỏ hơn mép hàng cuối đo được, phòng làm tròn).
    bnd.push(cv.height);
    const theadBotY = px2cv(theadTopCss);
    const theadImg = sliceY(0, theadBotY);          // ảnh header SẠCH (cắt trên ĐÚNG mép hàng đầu → không xanh)
    const theadMm = cv2mm(theadBotY);
    const SAFE = 0.5;                               // đệm mm chống làm tròn dính sát mép dưới

    let i = 0;
    while (i < n) {
      const row0Mm = cv2mm(bnd[i + 1] - bnd[i]);
      // Hết chỗ cho header + HÀNG ĐẦU → sang trang mới (nếu chưa ở đầu trang). "Qua trang thì qua HẾT hàng".
      if (y > MARGIN + 0.5 && y + theadMm + row0Mm > bottomY - SAFE) { pdf.addPage(); y = MARGIN; }
      // Header lặp ở đầu phần bảng mỗi trang.
      pdf.addImage(theadImg, "JPEG", MARGIN, y, innerW, theadMm); y += theadMm;
      const avail = bottomY - y - SAFE;
      // Gom TỐI ĐA hàng NGUYÊN vừa chỗ còn lại — KHÔNG cắt đôi hàng nào.
      let j = i;
      while (j < n) {
        if (j > i && cv2mm(bnd[j + 1] - bnd[i]) > avail) break;
        j++;
      }
      const groupMm = cv2mm(bnd[j] - bnd[i]);
      const img = sliceY(bnd[i], bnd[j]);
      if (groupMm > avail) {
        // 1 HÀNG cao hơn cả trang (dòng dự án nhiều bong bóng) → THU cho vừa (giữ tỉ lệ, căn giữa) thay
        // vì cắt ngang. Hiếm gặp; thà nhỏ lại còn hơn mất nội dung.
        const s = avail / groupMm, wMm = innerW * s;
        pdf.addImage(img, "JPEG", MARGIN + (innerW - wMm) / 2, y, wMm, avail); y += avail;
      } else {
        pdf.addImage(img, "JPEG", MARGIN, y, innerW, groupMm); y += groupMm;
      }
      i = j;
    }
  }
  } // hết if (tbl)

  const pages = pdf.getNumberOfPages();
  if (opts.preview) {
    // Trả blob URL để app xem trước trong iframe (không tải xuống). Người dùng bấm Tải/In trong dialog.
    const blobUrl = pdf.output("bloburl") as unknown as string;
    return { pages, blobUrl: String(blobUrl) };
  }
  pdf.save(opts.fileName);
  return { pages };
}
