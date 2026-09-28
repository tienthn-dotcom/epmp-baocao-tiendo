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

const MARGIN = 12;   // lề TRÁI/PHẢI 12mm (~1.2cm) — KHỚP file mẫu A4; nền xám vẫn tràn mép trang.
const MARGIN_Y = 7;  // lề TRÊN/DƯỚI 7mm — hẹp hơn 12mm cũ để bảng CAO hơn, chữ to & dễ đọc (kể cả trên điện thoại).
const GAP = 2.5; // khoảng cách giữa các khối (mm)
const PAGE_BG_RGB: [number, number, number] = [238, 241, 244]; // #eef1f4 — nền xám nhạt cả trang (card trắng nổi lên như mẫu)
const PAGE_BG_HEX = "#eef1f4";                                   // dùng cho html2canvas để header/chú thích BLEND vào nền xám (hết dải trắng)

/** Chuẩn hoá DOM CLONE trước khi html2canvas chụp (dùng CHUNG cho mọi khối + bảng, và cũng là
 *  layout mà ta ĐO ranh giới hàng để cắt trang → đo & chụp luôn KHỚP nhau). */
function applyExportClone(doc: Document): void {
  // ── CHUẨN HOÁ FONT (sửa "chữ bị bóp/chèn dấu cách/cắt cột" + để MỌI TRÌNH DUYỆT ra giống nhau) ──
  //    App dùng "Inter, system-ui" nhưng html2canvas vẽ chữ qua canvas ctx.font, mà "system-ui" KHÔNG
  //    được canvas phân giải nhất quán (mỗi trình duyệt fallback 1 font khác, thường RỘNG hơn → tràn ô
  //    → cắt Mã, chèn space vào ngày). Ép về "Segoe UI" (font system-ui trên Windows) để ảnh khớp màn &
  //    GIỐNG NHAU mọi trình duyệt. tabular-nums dễ giãn khi đổi font → ép normal cho số khỏi lệch.
  const st = doc.createElement("style");
  st.textContent = `*{font-family:"Segoe UI",Arial,Helvetica,sans-serif !important;font-variant-numeric:normal !important;letter-spacing:normal !important}`
    // Line chia nhóm PM (.pm-group-line) CHỈ hiển thị trên APP — trong BẢN IN PDF ẩn đi (giữ nguyên các viền khác).
    + `.pm-group-line{border-top-color:transparent !important}`
    // STATIC-HOÁ MỌI phần tử sticky (thead + th + cột đóng băng): nếu để sticky, khi người dùng ĐÃ CUỘN
    // bảng rồi mới xuất, html2canvas chụp header ở vị trí "dán" theo scroll → header đi theo chỗ cuộn +
    // rowSpan (2 cột PM) bị xô lệch nhìn như chưa merge. Ép static → header về đúng đầu bảng, dòng chảy tự nhiên.
    + `thead,th,tr,[class*="sticky"]{position:static !important;top:auto !important}`;
  doc.head.appendChild(st);
  // Bỏ mọi điều khiển vô dụng trên giấy (đã gắn class print:hidden trong JSX)
  doc.querySelectorAll('[class*="print:hidden"]').forEach((n) => n.remove());
  // Header bảng đừng sticky trong ảnh chụp (class-based lẫn inline — xem thêm rule CSS ở trên)
  doc.querySelectorAll<HTMLElement>("thead, th").forEach((n) => { n.classList.remove("sticky"); n.style.position = "static"; });
  // Bảng "Tổng thể tiến độ" đóng băng cột trái bằng inline position:sticky — html2canvas không mô phỏng
  // sticky nên cột sẽ đè/lệch. Trả về static để mọi cột nằm đúng dòng chảy tự nhiên.
  doc.querySelectorAll<HTMLElement>('[style*="position: sticky"], [style*="position:sticky"]')
    .forEach((n) => { n.style.position = "static"; });
}

async function snap(el: HTMLElement, bg: string = "#ffffff"): Promise<HTMLCanvasElement> {
  return html2canvas(el, { scale: 2, backgroundColor: bg, logging: false, onclone: applyExportClone });
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
  /** GỘP: các khối (header + chú thích cách tính điểm) vẽ Ở ĐẦU TRANG CHI TIẾT — để trang 2+ GIỐNG HỆT bản
   *  in RIÊNG Chi tiết (header + chú thích + bảng cùng 1 trang). Bỏ trống → trang bảng không có header. */
  detailBlocks?: HTMLElement[];
  /** ÉP BẢNG GỌN 1 TRANG: thu NGUYÊN ảnh bảng cho vừa chiều cao còn lại (chữ tự nhỏ) — KHÔNG cắt sang
   *  trang 2. Dùng khi sếp yêu cầu "chi tiết chỉ 1 trang". */
  tableFitOnePage?: boolean;
  /** GIỮ TỈ LỆ CỘT theo colgroup (form người dùng kéo) — KHÔNG "chia đều" lại bề ngang. Vẫn autofit LẤP ĐẦY
   *  bề ngang (bằng khối chú thích ở trên) + thu vừa 1 trang. Dùng cho bảng tuân thủ đã có form. */
  keepColWidths?: boolean;
  /** (đi kèm keepColWidths) Các CỘT nhận phần bề rộng dư khi lấp đầy trang — vd [1,3] = Người phụ trách +
   *  Tên dự án nở ra, các cột khác giữ tỉ lệ. Bỏ trống → nở đều mọi cột. */
  growCols?: number[];
  /** Ẩn (display:none) các phần tử này KHI chụp blocks rồi TRẢ LẠI — vd giấu chú thích khỏi trang Tóm tắt
   *  khi xuất RIÊNG bản Tóm tắt. */
  hideInBlocks?: HTMLElement[];
  /** XEM TRƯỚC: KHÔNG tải file — trả về `blobUrl` để app hiển thị trong iframe (người dùng soát rồi tự
   *  Tải/In). Bỏ trống/false → tải file như cũ. */
  preview?: boolean;
  /** LẤY DỮ LIỆU: trả về `dataUri` (data:application/pdf;base64,…) để luồng khác dùng (vd đẩy lên Drive).
   *  Ưu tiên cao hơn `preview`. Mặc định KHÔNG tải file — kết hợp `download:true` để VỪA tải VỪA lấy dataUri. */
  toDataUri?: boolean;
  /** Chỉ có tác dụng cùng `toDataUri`: tải file xuống (pdf.save) TRƯỚC khi trả dataUri → 1 lần dựng, vừa
   *  tải cho người dùng vừa có bytes để lưu Drive. */
  download?: boolean;
  fileName: string;
}): Promise<{ pages: number; blobUrl?: string; dataUri?: string }> {
  const portrait = opts.orientation === "portrait";
  const pageW = portrait ? 210 : 297; // A4 (mm)
  const pageH = portrait ? 297 : 210;
  const innerW = pageW - MARGIN * 2;
  const bottomY = pageH - MARGIN_Y;
  const pdf = new jsPDF({ orientation: portrait ? "portrait" : "landscape", unit: "mm", format: "a4" });
  let y = MARGIN_Y;

  // FIT-TOGETHER: bản Chi tiết đứng RIÊNG (header + bảng CÙNG 1 trang, ép gọn 1 trang). Header & bảng phải
  // thu theo CÙNG một tỉ lệ (mm/px) để cỡ chữ ĂN KHỚP nhau — tránh header to đùng khi chữ bảng bị nhỏ —
  // trong khi bảng vẫn phủ hết bề rộng trang. (Bản GỘP có bảng ở trang riêng nên KHÔNG áp dụng.)
  const fitTogether = !!(opts.table && opts.tableFitOnePage && !opts.tableStartsNewPage && !opts.singlePage);
  // GỘP: trang Chi tiết (trang 2+) vẽ header + chú thích + bảng CÙNG 1 trang, GIỐNG HỆT bản in riêng Chi tiết.
  const detailBlocks = opts.detailBlocks ?? [];
  const fitDetail = !!(opts.table && opts.tableStartsNewPage && detailBlocks.length);
  const fitBlocks: HTMLCanvasElement[] = [];

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
    // ÉP 1 TRANG: chụp hết block rồi thu cho vừa CHIỀU CAO còn lại. Bố cục ĐI TỪ TRÊN XUỐNG (KHÔNG căn giữa
    // dọc — tránh "dư 1 đống" phía trên); nội dung ngắn thì để trống phần dưới, không phóng to.
    // Snap với NỀN XÁM để header BLEND vào trang (hết dải trắng trên đầu).
    pdf.setFillColor(...PAGE_BG_RGB); pdf.rect(0, 0, pageW, pageH, "F");  // NỀN XÁM nhạt cả trang (card trắng nổi lên như mẫu)
    const cvs: HTMLCanvasElement[] = [];
    for (const b of opts.blocks) cvs.push(await snap(b, PAGE_BG_HEX));
    // Cùng lý do với chỗ chặn ảnh BẢNG bên dưới: khối nào chụp ra rộng 0 thì phép chia dưới đây ra
    // Infinity/NaN rồi jsPDF ném một câu tiếng Anh không ai hiểu. Chặn sớm, nói bằng tiếng Việt.
    if (cvs.some(c => !c.width || !c.height)) {
      throw new Error("Không chụp được phần tiêu đề để dựng PDF (ảnh chụp rộng 0). Cửa sổ đang quá hẹp — mở rộng cửa sổ rồi xuất lại.");
    }
    const contentH = cvs.reduce((s, cv) => s + (cv.height / cv.width) * innerW, 0);
    const gaps = GAP * (cvs.length - 1);
    const avail = bottomY - y;
    const fillScale = (avail - gaps) / Math.max(1, contentH);       // tỉ lệ để LẤP HẾT chiều cao còn lại
    const maxScaleW = (pageW - 6) / innerW;                         // cho PHÓNG TO lấp bớt khoảng trống dưới, cap bề rộng ≤ pageW−6mm (3mm/bên)
    const scale = Math.max(0.01, Math.min(fillScale, maxScaleW));   // nội dung ngắn → phóng vừa phải; nội dung dài → thu cho vừa
    for (const cv of cvs) {
      const hMm = (cv.height / cv.width) * innerW * scale;
      const wMm = innerW * scale;
      pdf.addImage(cv.toDataURL("image/jpeg", 0.92), "JPEG", (pageW - wMm) / 2, y, wMm, hMm);  // căn giữa theo BỀ RỘNG TRANG (scale có thể >1)
      y += hMm + GAP;
    }
  } else if (fitTogether) {
    // Chỉ CHỤP các khối header, CHƯA vẽ — vẽ sau cùng với bảng ở CÙNG tỉ lệ (xem nhánh vẽ bên dưới).
    // Snap NỀN XÁM để header/chú thích BLEND vào trang (hết dải trắng), giống trang Tóm tắt.
    for (const b of opts.blocks) fitBlocks.push(await snap(b, PAGE_BG_HEX));
  } else {
    for (const b of opts.blocks) {
      const cv = await snap(b);
      const hMm = (cv.height / cv.width) * innerW;
      if (y + hMm > bottomY) { pdf.addPage(); y = MARGIN_Y; }
      draw(cv, hMm);
      y += GAP;
    }
  }
  tempHidden.forEach(({ el, disp }) => { el.style.display = disp; });   // trả lại các phần tử vừa giấu

  /* ── Bảng (BỎ QUA nếu không truyền table — vd xuất biểu đồ Tóm tắt) ── */
  const tbl = opts.table;
  if (tbl) {
  // GỘP: sang TRANG MỚI cho phần bảng (trang trước là Tóm tắt).
  if (opts.tableStartsNewPage && y > MARGIN_Y + 0.5) { pdf.addPage(); y = MARGIN_Y; }
  // GỘP: chụp header + chú thích cho TRANG CHI TIẾT (nền xám → blend), để trang bảng GIỐNG HỆT bản in riêng.
  const detailCvs: HTMLCanvasElement[] = [];
  if (fitDetail) { for (const b of detailBlocks) detailCvs.push(await snap(b, PAGE_BG_HEX)); }
  const detailHeaderHmm = detailCvs.reduce((s, cv) => s + (cv.height / cv.width) * innerW, 0) + GAP * detailCvs.length;
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
  // Style tạm để "giàn đều cột" (padding ngang) + nén hàng (padding dọc) — đặt INLINE trên từng ô vì
  // html2canvas chỉ chụp chắc chắn style inline / computed, KHÔNG chắc chụp <style> chèn vào <head>.
  let fitCells: Element[] | null = null;
  let fitCellStyles: (string | null)[] | null = null;
  let savedColW: string[] | null = null;                        // width gốc của <col> (keepColWidths sửa tạm rồi trả lại)
  if (!opts.wide) {
    tbl.style.width = `${PDF_TABLE_WIDTH}px`;
    tbl.style.minWidth = `${PDF_TABLE_WIDTH}px`;
    tbl.style.maxWidth = `${PDF_TABLE_WIDTH}px`;
    // Cỡ chữ phải TƯƠNG ỨNG với bề rộng vừa ép (xem lib/table-scale.ts). Trước đây ghi
    // cứng 11px — đó là cỡ dành cho bảng 1532px, đặt lên bảng 1280px thì chữ to hơn cột
    // ⇒ badge tràn trong PDF dù trên màn hình vẫn đẹp.
    tbl.style.fontSize = `${PDF_TABLE_FONT_PX}px`;
  }
  if (opts.tableFitOnePage) {
    // Bảng tuân thủ mỗi dòng chỉ 1 HÀNG → làm rộng cột KHÔNG giảm chiều cao (px). Để gọn 1 trang mà vẫn
    // KÍN + GIÀN ĐỀU bề ngang: (1) thu nhỏ chữ + nén chiều cao hàng cho bảng thấp lại; (2) chia phần bề
    // rộng còn thiếu ĐỀU cho MỌI cột bằng padding ngang (không dồn hết vào cột "Tên dự án" như khi ép
    // width) → mọi cột tách ra đều nhau, phủ kín bề ngang trang. Chừa chỗ header vẽ FULL bề ngang.
    const headerHmm = fitTogether
      ? fitBlocks.reduce((s, cv) => s + (cv.height / cv.width) * innerW, 0) + GAP * fitBlocks.length
      : fitDetail
      ? detailHeaderHmm                                        // GỘP: chừa đúng chiều cao header + chú thích (như in riêng)
      : (opts.tableStartsNewPage ? 8 : 40);                    // GỘP không header: bảng ở TRANG RIÊNG nên chỉ chừa ~8mm
    // Chiều cao THỰC còn lại cho bảng = (đáy trang − y hiện tại đã gồm lề trên + TIÊU ĐỀ) − header/chú thích.
    // Trước đây lấy (pageH − lề×2) − header → QUÊN trừ tiêu đề (~13mm) nên bảng dựng cho khung cao hơn thực,
    // lúc vẽ phải thu nhỏ (s<1) → co vào giữa, chừa trắng 2 bên + chữ nhỏ. Nay tính đúng → bảng lấp KÍN, chữ to tối đa.
    const availMm = Math.max(1, (bottomY - y) - headerHmm);
    const N = tbl.tHead?.rows?.[0]?.cells.length || tbl.rows?.[0]?.cells.length || 1;
    fitCells = Array.from(tbl.querySelectorAll("th,td"));
    fitCellStyles = fitCells.map((c) => c.getAttribute("style"));
    // (1) Chữ nhỏ lại (inline trên bảng) + hàng sát lại (padding dọc inline từng ô) → bảng THẤP xuống.
    const baseFont = parseFloat(getComputedStyle(tbl).fontSize) || 11;
    // CÓ FORM (keepColWidths): GIỮ NGUYÊN cỡ chữ người dùng chỉnh (không co) → cỡ chữ ĂN thẳng vào bản in.
    // Không form: co nhẹ (0.95) cho bảng thấp lại, vừa 1 trang.
    tbl.style.fontSize = opts.keepColWidths ? `${baseFont}px` : `${Math.max(7, Math.round(baseFont * 0.95 * 10) / 10)}px`;
    // SIẾT LINE-HEIGHT sát cỡ chữ → chữ LẤP ĐẦY ô, bỏ khoảng trống dòng. Nhờ vậy tăng cỡ chữ sẽ ĂN vào bản in
    // (chữ to hơn trong cùng chiều cao hàng, chưa làm hàng cao thêm cho tới khi chữ vượt chiều cao hàng).
    // CHỈ ÁP KHI CHỤP XUẤT PDF (khôi phục ngay sau) → KHÔNG đụng bản trên app.
    // Bảng 77 dòng ÉP 1 TRANG: chiều cao mỗi hàng càng thấp → cả bảng càng ngắn → phóng to lấp trang → CHỮ IN TO NHẤT.
    // Siết line-height + đệm dọc tới mức tối thiểu vẫn đọc được (1.1 / 1.5px) để tối đa cỡ chữ trên 1 trang.
    const lh = opts.keepColWidths ? "1.1" : "1.05";
    const padV = opts.keepColWidths ? "1.5px" : "1px";
    tbl.style.lineHeight = lh;
    fitCells.forEach((c) => { (c as HTMLElement).style.paddingTop = padV; (c as HTMLElement).style.paddingBottom = padV; (c as HTMLElement).style.lineHeight = lh; });
    // GIỮ TỈ LỆ CỘT THEO FORM (keepColWidths): bảng đã có colgroup % do người dùng KÉO → KHÔNG chia đều lại,
    // để nguyên tỉ lệ (cột "Đổi tiến độ" hẹp thì tiêu đề tự xuống 4 dòng như trên màn); phần VẼ bên dưới tự
    // thu cho vừa 1 trang. Ngược lại (bảng cũ không form): chia đều bề ngang cho phủ kín trang.
    if (!opts.keepColWidths) {
      // Đo bề rộng NỘI DUNG thật: bảng w-full bị KHOÁ theo khung cha → tạm mở max-content để đo + giàn đều.
      tbl.style.width = "max-content"; tbl.style.minWidth = "0"; tbl.style.maxWidth = "none";
      void tbl.offsetHeight;
      const contentW = tbl.offsetWidth || PDF_TABLE_WIDTH, natH = tbl.offsetHeight || 1;
      const wantW = Math.max(contentW, Math.ceil(natH * innerW / availMm));
      const padEach = Math.round((wantW - contentW) / (2 * N));
      if (padEach > 0) {
        fitCells.forEach((c) => { (c as HTMLElement).style.paddingLeft = `${padEach}px`; (c as HTMLElement).style.paddingRight = `${padEach}px`; });
      }
      tbl.style.width = `${wantW}px`; tbl.style.minWidth = `${wantW}px`; tbl.style.maxWidth = `${wantW}px`;
      void tbl.offsetHeight;                                    // reflow: cột giãn đều + bảng phủ kín bề ngang
    } else {
      // GIỮ TỈ LỆ CỘT + LẤP ĐẦY BỀ NGANG (bằng khối chú thích ở trên): tính bề rộng cần để khi thu vừa CHIỀU
      // CAO còn lại thì phủ kín innerW; phần DƯ so với hiện tại DỒN vào growCols (Tên dự án + Người phụ trách),
      // các cột khác GIỮ NGUYÊN px → không "ép 2 bên bằng y app", không giàn đều.
      const headCells = Array.from(tbl.tHead?.rows?.[0]?.cells ?? []) as HTMLElement[];
      const curW = headCells.map((c) => c.offsetWidth);
      const curTotal = curW.reduce((a, b) => a + b, 0) || tbl.offsetWidth || PDF_TABLE_WIDTH;
      const natH = tbl.offsetHeight || 1;
      const wantW = Math.max(curTotal, Math.ceil(natH * innerW / availMm));
      const extra = wantW - curTotal;
      const cols = Array.from(tbl.querySelectorAll("col")) as HTMLElement[];
      savedColW = cols.map((c) => c.style.width);
      const newW = curW.slice();
      const grow = (opts.growCols ?? []).filter((i) => i >= 0 && i < curW.length);
      if (extra > 0 && grow.length) {
        const wsum = grow.reduce((s, i) => s + curW[i], 0) || grow.length;   // chia theo tỉ trọng bề rộng hiện có (Tên rộng hơn → nhận nhiều hơn)
        grow.forEach((i) => { newW[i] += extra * (curW[i] / wsum); });
      } else if (extra > 0) {
        newW.forEach((_, i) => { newW[i] += extra / newW.length; });          // không chỉ định → nở đều
      }
      cols.forEach((c, i) => { if (newW[i]) c.style.width = `${newW[i]}px`; });
      tbl.style.width = `${wantW}px`; tbl.style.minWidth = `${wantW}px`; tbl.style.maxWidth = `${wantW}px`;
      void tbl.offsetHeight;
    }
  }
  // Bỏ chiều cao hàng do "equalize" ép trên màn hình (có thể còn dính giá trị
  // cũ khi cửa sổ từng hẹp → hàng phồng → PDF thừa hàng chục trang). Chụp bảng
  // ở CHIỀU CAO TỰ NHIÊN để cả ảnh chụp lẫn phép cắt trang dùng cùng số đo.
  const bodyRows = tbl.tBodies[0] ? Array.from(tbl.tBodies[0].rows) as HTMLTableRowElement[] : [];
  const savedHeights = bodyRows.map(r => r.style.height);
  // CÓ FORM (keepColWidths): GIỮ chiều cao hàng người dùng chỉnh (rowH đồng đều) → ăn vào bản in.
  // Không form: xoá height cũ (equalize màn hình) để chụp ở chiều cao tự nhiên.
  if (!opts.keepColWidths) bodyRows.forEach(r => { r.style.height = ""; });
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
  if (fitCells && fitCellStyles) {                             // trả lại style gốc từng ô (padding giàn cột)
    fitCells.forEach((c, i) => { const s = fitCellStyles![i]; if (s == null) c.removeAttribute("style"); else c.setAttribute("style", s); });
    fitCells = null; fitCellStyles = null;
  }
  if (savedColW) {                                             // trả lại width % cho <col> (keepColWidths đã sửa tạm → px)
    Array.from(tbl.querySelectorAll("col")).forEach((c, i) => { (c as HTMLElement).style.width = savedColW![i] ?? ""; });
    savedColW = null;
  }

  /* ẢNH BẢNG RỘNG 0 HOẶC CAO 0 → DỪNG NGAY, đừng đi tiếp. Đặt SAU khối khôi phục ở trên để bảng
     trên màn hình đã được trả lại style gốc rồi mới ném — ném sớm là để lại cái bảng méo.

     Vì sao phải chặn: CẢ BA nhánh vẽ bảng bên dưới đều chia cho `cv.width` để suy chiều cao theo
     tỉ lệ (`(cv.height / cv.width) * innerW`). Chia cho 0 ra Infinity/NaN, `pdf.addImage` nhận NaN,
     và jsPDF ném đúng một câu tiếng Anh vô nghĩa với người dùng: "Invalid argument passed to
     jsPDF.scale". Người dùng đọc câu đó thì không biết phải làm gì.

     Đo 30/09/2026: khi vùng chính của app co lại còn khoảng 24px bề ngang thì html2canvas trả về
     ảnh rộng 0 và xuất PDF chết đúng kiểu trên. Ở 375 · 700 · 1000 · 1024 · 1440px thì chụp bình
     thường — tức đây là trạng thái bố cục suy biến chứ không phải lỗi gặp ở khổ cửa sổ thường dùng.
     Hỏng thì phải hỏng TO và nói được việc người dùng làm được. */
  if (!cv.width || !cv.height) {
    throw new Error("Không chụp được bảng để dựng PDF (ảnh chụp rộng 0). Cửa sổ đang quá hẹp — mở rộng cửa sổ rồi xuất lại.");
  }
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

  if (opts.tableFitOnePage && (fitTogether || fitDetail)) {
    // CHI TIẾT (in riêng = fitTogether · hoặc TRANG 2+ bản GỘP = fitDetail): vẽ GIỐNG HỆT nhau — header + chú
    // thích FULL bề ngang (như mẫu), rồi bảng FULL bề ngang ngay dưới — CẢ HAI kín bề ngang trang, không "cục
    // ở giữa". NỀN XÁM cả trang để header/chú thích blend (hết dải trắng), bảng trắng nổi lên như card.
    pdf.setFillColor(...PAGE_BG_RGB); pdf.rect(0, 0, pageW, pageH, "F");
    const heads = fitTogether ? fitBlocks : detailCvs;
    // Tiêu đề (khối đầu) HỤT SÁT khối "Cách tính" bên dưới → bớt khoảng trắng dưới tiêu đề trong bản in
    // (yêu cầu: tiêu đề thấp xuống). Các khối sau vẫn cách GAP như cũ.
    heads.forEach((c, hi) => {
      const hMm = (c.height / c.width) * innerW;
      pdf.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", MARGIN, y, innerW, hMm);
      y += hMm + (hi === 0 && heads.length > 1 ? 0.5 : GAP);
    });
    const tHmm = (cv.height / cv.width) * innerW;
    const s = Math.min(1, (bottomY - y) / tHmm);
    const wMm = innerW * s, hMm = tHmm * s;
    pdf.addImage(cv.toDataURL("image/jpeg", 0.92), "JPEG", MARGIN + (innerW - wMm) / 2, y, wMm, hMm);
  } else if (opts.tableFitOnePage) {
    // GỘP (bảng ở TRANG RIÊNG): vẽ NGUYÊN ảnh bảng, thu tỉ lệ cho vừa CHIỀU CAO còn lại (chữ tự nhỏ theo),
    // căn giữa ngang; KHÔNG cắt/không sang trang 2.
    const natHmm = (cv.height / cv.width) * innerW;
    const scale = Math.min(1, (bottomY - y) / natHmm);
    const wMm = innerW * scale, hMm = natHmm * scale;
    pdf.addImage(cv.toDataURL("image/jpeg", 0.92), "JPEG", MARGIN + (innerW - wMm) / 2, y, wMm, hMm);
  } else {
  const n = tops.length;
  if (n === 0) {
    const hMm = (cv.height / cv.width) * innerW;
    if (y + hMm > bottomY) { pdf.addPage(); y = MARGIN_Y; }
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
      if (y > MARGIN_Y + 0.5 && y + theadMm + row0Mm > bottomY - SAFE) { pdf.addPage(); y = MARGIN_Y; }
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
  }
  } // hết if (tbl)

  const pages = pdf.getNumberOfPages();
  if (opts.toDataUri) {
    // Trả base64 để đẩy Drive (đính kèm mail). download:true → TẢI luôn cho người dùng (1 lần dựng, vừa
    // tải vừa có bytes để lưu Drive). CHUẨN HOÁ: jsPDF trả "data:application/pdf;filename=…;base64,…" (có
    // chèn ;filename=) → cắt lấy đúng phần base64 rồi ghép lại "data:application/pdf;base64,…" cho khớp validator.
    if (opts.download) pdf.save(opts.fileName);
    const raw = pdf.output("datauristring") as unknown as string;
    const i = raw.indexOf("base64,");
    const dataUri = i >= 0 ? "data:application/pdf;base64," + raw.slice(i + 7) : raw;
    return { pages, dataUri };
  }
  if (opts.preview) {
    // Trả blob URL để app xem trước trong iframe (không tải xuống). Người dùng bấm Tải/In trong dialog.
    const blobUrl = pdf.output("bloburl") as unknown as string;
    return { pages, blobUrl: String(blobUrl) };
  }
  pdf.save(opts.fileName);
  return { pages };
}
