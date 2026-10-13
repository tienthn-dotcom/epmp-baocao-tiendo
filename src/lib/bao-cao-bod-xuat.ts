/**
 * XUẤT HÀNG LOẠT — GHÉP MỌI MA TRẬN THÀNH MỘT FILE PDF KIỂU BẢN GỬI BOD.
 *
 * Luật (cụm, thứ tự, nhãn vận hành) nằm ở `bao-cao-bod.ts`. Đây là phần chạy: tải, ghép, dán chữ.
 *
 * ── BA QUYẾT ĐỊNH, ĐỀU CÓ LÝ DO ─────────────────────────────────────────────────────────────
 *
 * 1. LẤY ĐÚNG BẢN PDF GOOGLE ĐÃ RENDER, không tự vẽ lại bảng. Ruột các trang trong bản BOD chính
 *    là bản Google xuất của tab ma trận (chart, màu, định dạng y hệt màn hình). App vốn đã tải và
 *    cache sẵn mấy bản đó cho popup, warmer làm mới lúc 18:00 và 20:00 — nên bấm nút là ghép từ
 *    cache, không phải dựng lại 46 lần.
 *
 * 2. DÁI TIÊU ĐỀ VẼ BẰNG CANVAS RỒI DÁN VÀO DẠNG ẢNH, không dùng chữ của pdf-lib. Font chuẩn của
 *    pdf-lib là WinAnsi, KHÔNG có chữ Việt có dấu: "CỤM PHÚ QUỐC" sẽ ra "CM PH QUC" hoặc ném lỗi.
 *    Nhúng font TTF thì phải kéo thêm fontkit và một tệp font vài trăm KB. Trình duyệt vốn vẽ chữ
 *    Việt chuẩn sẵn, nên vẽ ra canvas rồi dán ảnh là đường ngắn nhất và không sai dấu.
 *
 * 3. TẢI THEO LÔ, không thả hết một lượt. 46 lượt gọi song song thì Worker phải giữ 46 tệp PDF
 *    trong bộ nhớ cùng lúc — đúng kiểu đã làm màn MTLĐ chết Error 1102 hồi tháng 9.
 */
import { getSheetPdf } from "@/lib/mtld-install.functions";
import { tenTep, type TrangBod } from "@/lib/bao-cao-bod";

/** Mỗi lượt tải bao nhiêu ma trận. Giữ nhỏ — xem lý do 3 ở đầu tệp. */
const SONG_SONG = 3;

export type TienTrinh = { xong: number; tong: number; dang: string };

const b64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
};

/** Vẽ một dải chữ ra PNG (chữ Việt chuẩn vì để trình duyệt vẽ). Trả bytes PNG. */
function veDai(rong: number, cao: number, ve: (c: CanvasRenderingContext2D) => void): Uint8Array {
  const cv = document.createElement("canvas");
  cv.width = rong; cv.height = cao;
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error("Trình duyệt không cho vẽ canvas.");
  ve(ctx);
  const url = cv.toDataURL("image/png");
  return b64ToBytes(url.slice(url.indexOf(",") + 1));
}

/** Dải tiêu đề dán lên đầu mỗi trang ma trận. */
function daiTieuDe(t: TrangBod, rongPt: number): Uint8Array {
  const S = 3;                                   // vẽ to gấp 3 rồi thu lại cho nét
  const rong = Math.round(rongPt * S), cao = 42 * S;
  return veDai(rong, cao, (c) => {
    c.fillStyle = "#1E3A5F";                     // navy, cùng tông với báo cáo tuân thủ
    c.fillRect(0, 0, rong, cao);
    c.fillStyle = "#ffffff";
    c.font = `700 ${11 * S}px Arial, sans-serif`;
    c.textBaseline = "middle";
    c.fillText(`${t.cum}   ·   ${t.stt}. ${t.ten}`, 14 * S, cao * 0.34, rong - 220 * S);
    c.font = `400 ${9.5 * S}px Arial, sans-serif`;
    c.fillStyle = "#cbd5e1";
    c.fillText(t.maCT, 14 * S, cao * 0.72, rong - 220 * S);
    // Nhãn vận hành: xanh lá = đang chạy, xám = chưa.
    const w = 150 * S, h = 22 * S, x = rong - w - 14 * S, y = (cao - h) / 2;
    c.fillStyle = t.chay ? "#10b981" : "#64748b";
    c.fillRect(x, y, w, h);
    c.fillStyle = "#ffffff";
    c.font = `700 ${9.5 * S}px Arial, sans-serif`;
    c.textAlign = "center";
    c.fillText(t.nhan, x + w / 2, y + h / 2);
  });
}

/** Trang bìa. */
function trangBia(rong: number, cao: number, tuan: string, tong: string): Uint8Array {
  const S = 2;
  return veDai(Math.round(rong * S), Math.round(cao * S), (c) => {
    const W = rong * S, H = cao * S;
    c.fillStyle = "#ffffff"; c.fillRect(0, 0, W, H);
    c.fillStyle = "#1E3A5F"; c.fillRect(0, 0, W, 150 * S);
    c.fillStyle = "#ffffff"; c.textAlign = "center";
    c.font = `700 ${22 * S}px Arial, sans-serif`;
    c.fillText("BÁO CÁO TỔNG HỢP TCLĐ VÀ TTBG", W / 2, 62 * S);
    c.font = `700 ${16 * S}px Arial, sans-serif`;
    c.fillText("CÁC DỰ ÁN ĐANG VẬN HÀNH", W / 2, 95 * S);
    c.font = `400 ${13 * S}px Arial, sans-serif`;
    c.fillStyle = "#cbd5e1";
    c.fillText(tuan, W / 2, 124 * S);
    c.fillStyle = "#0f172a";
    c.font = `400 ${12 * S}px Arial, sans-serif`;
    c.fillText(tong, W / 2, 200 * S);
    c.textAlign = "left";
    c.fillStyle = "#334155";
    c.font = `700 ${13 * S}px Arial, sans-serif`;
    c.fillText("A. BÁO CÁO TỔNG THỂ", 60 * S, 260 * S);
    c.font = `400 ${12 * S}px Arial, sans-serif`;
    c.fillText("I.   Tổng quan thi công lắp đặt (TCLĐ)", 80 * S, 288 * S);
    c.fillText("II.  Tổng quan tình trạng bàn giao (TTBG)", 80 * S, 312 * S);
    c.font = `700 ${13 * S}px Arial, sans-serif`;
    c.fillText("B. CHI TIẾT TỪNG DỰ ÁN", 60 * S, 352 * S);
    c.font = `400 ${11 * S}px Arial, sans-serif`;
    c.fillStyle = "#64748b";
    c.fillText("Mỗi trang là ma trận của một dự án, xếp theo cụm.", 80 * S, 378 * S);
    c.fillText("Nhãn “ĐÃ VẬN HÀNH” = trong 7 ngày gần nhất có người cập nhật file ma trận.", 80 * S, 400 * S);
  });
}

/**
 * Dựng cả báo cáo rồi tải về.
 *
 * @param trang   danh sách trang đã xếp (xem xepTrangBod)
 * @param tuan    chữ hiện ở bìa, vd "TUẦN 42 · 13/10/2026"
 * @param bao     gọi sau mỗi ma trận xong, để giao diện báo tiến trình
 */
export async function xuatBaoCaoBod(trang: readonly TrangBod[], tuan: string, bao?: (t: TienTrinh) => void): Promise<{ soTrang: number; hut: string[] }> {
  const { PDFDocument } = await import("pdf-lib");
  const ra = await PDFDocument.create();
  const hut: string[] = [];

  /* Tải trước theo lô, giữ ĐÚNG THỨ TỰ của `trang` (Promise.all giữ thứ tự mảng). */
  const tep: (Uint8Array | null)[] = [];
  for (let i = 0; i < trang.length; i += SONG_SONG) {
    const lo = trang.slice(i, i + SONG_SONG);
    const kq = await Promise.all(lo.map(async (t) => {
      try {
        const r = await getSheetPdf({ data: { fileId: t.muc.fileId, gid: t.muc.gid, range: t.muc.range } });
        return b64ToBytes(r.b64);
      } catch { return null; }
    }));
    tep.push(...kq);
    bao?.({ xong: Math.min(i + SONG_SONG, trang.length), tong: trang.length, dang: lo[lo.length - 1]?.ten ?? "" });
  }

  /* Bìa — dựng theo khổ trang đầu tiên đọc được, để bìa cùng cỡ với ruột. */
  let khoRong = 841.89, khoCao = 595.276;                 // A4 ngang, mặc định
  for (let i = 0; i < tep.length; i++) {
    const b = tep[i];
    if (!b) continue;
    try {
      const d = await PDFDocument.load(b, { ignoreEncryption: true });
      const p = d.getPage(0);
      khoRong = p.getWidth(); khoCao = p.getHeight();
      break;
    } catch { /* tệp hỏng → thử tệp sau */ }
  }
  const bia = ra.addPage([khoRong, khoCao]);
  const anhBia = await ra.embedPng(trangBia(khoRong, khoCao, tuan, `${trang.length} ma trận · ${trang.filter((t) => t.chay).length} đã vận hành · ${trang.filter((t) => !t.chay).length} chưa vận hành`));
  bia.drawImage(anhBia, { x: 0, y: 0, width: khoRong, height: khoCao });

  /* Ghép từng ma trận + dán dải tiêu đề. */
  for (let i = 0; i < trang.length; i++) {
    const t = trang[i], b = tep[i];
    if (!b) { hut.push(`${t.maCT} · ${t.ten}`); continue; }
    let nguon;
    try { nguon = await PDFDocument.load(b, { ignoreEncryption: true }); }
    catch { hut.push(`${t.maCT} · ${t.ten}`); continue; }
    const chep = await ra.copyPages(nguon, nguon.getPageIndices());
    for (const p of chep) ra.addPage(p);
    /* MỘT MA TRẬN CÓ THỂ RA NHIỀU TRANG. Dán dải tiêu đề lên TRANG ĐẦU thôi — dán cả cụm thì
       người đọc tưởng mỗi trang một dự án, đếm nhầm số dự án trong báo cáo. */
    const dau = chep[0];
    if (!dau) { hut.push(`${t.maCT} · ${t.ten}`); continue; }
    const anh = await ra.embedPng(daiTieuDe(t, dau.getWidth()));
    dau.drawImage(anh, { x: 0, y: dau.getHeight() - 42, width: dau.getWidth(), height: 42 });
  }

  const bytes = await ra.save();
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = tenTep(Date.now());
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { soTrang: ra.getPageCount(), hut };
}
