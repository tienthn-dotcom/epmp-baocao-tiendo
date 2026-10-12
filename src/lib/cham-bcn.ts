/**
 * TỰ CHẤM TUÂN THỦ MỖI NGÀY RỒI GHI THẲNG VÀO FILE NGUỒN — PHẦN LUẬT (module thuần).
 *
 * Anh Tiến 12/10/2026: *"app của chúng ta sẽ auto data đẩy dữ liệu về đây, tracking dựa theo lần
 * vào xuất PDF của ePMP […] hay là có người mở file nguồn mà không phải là Thân Hoàng Nhật Tiến,
 * thì sẽ tick vào ô […] mục tiêu của việc này là để giảm tải việc tôi phải ngồi rà soát mỗi ngày"*.
 *
 * ── HAI BẰNG CHỨNG, LẤY CÁI SỚM NHẤT ────────────────────────────────────────────────────────
 *   1. Lượt xuất PDF dự án trên ePMP (nhật ký D1, action `export_pdf_duan`).
 *   2. File ma trận của dự án trên Drive ĐƯỢC SỬA trong ngày, người sửa cuối KHÔNG phải anh Tiến.
 *
 * ĐO TRƯỚC KHI DỰNG — và phép đo đổi hẳn trọng số hai nguồn. Ngày 12/10/2026, đếm trong D1:
 * `export_pdf_duan` có ĐÚNG 0 DÒNG kể từ khi nút đó tồn tại. Chấm chỉ theo nó thì cả bảng ra "X",
 * tức là đổ oan cho toàn bộ PM bằng một con số nhìn rất giống dữ liệu thật. Nguồn thật đang chạy
 * là nguồn số 2: sáng 12/10 lúc 10:06 đã có 4 mã CT được người khác anh Tiến sửa file.
 * Vẫn giữ cả hai: nguồn 1 không sai, chỉ là chưa ai dùng; mai kia có người bấm thì nó tự tính.
 *
 * ── "MỞ FILE" KHÔNG ĐO ĐƯỢC, "SỬA FILE" THÌ ĐO ĐƯỢC ────────────────────────────────────────
 * Google KHÔNG cho biết ai MỞ một file ra xem (Drive API không có loại hoạt động "view"; muốn có
 * thì phải bật nhật ký kiểm toán cấp quản trị Workspace). Cái đo được là `modifiedTime` +
 * `lastModifyingUser`. Đây là chỗ bản này KHÁC câu chữ anh Tiến dặn, nên nói thẳng ra chứ không
 * lặng lẽ đổi: mở ra ngó mà không sửa gì thì không ai thấy, kể cả Google.
 *
 * ── VÌ SAO LOẠI ANH TIẾN ────────────────────────────────────────────────────────────────────
 * Token Drive của app CHÍNH LÀ tài khoản `tienthn@aacorporation.com`, và anh Tiến mở file nguồn
 * mỗi ngày để rà soát. Không loại ra thì mỗi lần anh rà là cả bảng tự tick — báo cáo tự khen mình.
 *
 * ── CHỈ CHẤM DÒNG "THI CÔNG LẮP ĐẶT" ────────────────────────────────────────────────────────
 * Anh Tiến chốt 12/10/2026. Hai dòng Quân số (hạn 09:00) và Sản lượng (hạn 18:00) nguồn nằm chỗ
 * khác, app chưa biết đường tới, nên robot KHÔNG đụng vào — để trống cho người chấm tay, chứ đoán
 * bừa thì còn tệ hơn bỏ trống.
 *
 * ── BA ĐIỀU CHẶN TAY ROBOT, ĐỪNG GỠ ─────────────────────────────────────────────────────────
 *   · CHỈ GHI VÀO Ô TRỐNG. Ô đã có gì đó là người đã chấm tay — robot không được đè lên.
 *   · CHỈ GHI ĐÚNG CỘT CỦA HÔM NAY, và chỉ khi nhãn tháng trong file khớp tháng hiện tại. File
 *     đang ở tháng cũ mà ghi vào là đè lên số liệu tháng cũ (ngày 12/10/2026 file vẫn ghi
 *     "THÁNG 09/2026" — đúng cái bẫy này).
 *   · KHÔNG CHẤM NGÀY CHƯA XONG. "X" chỉ đặt khi đã qua 20:00; trước đó để trống.
 */
import { dauTheoPhut, lucVn, type DauPdf } from "@/lib/cham-theo-pdf";

/* ── KÝ HIỆU ─────────────────────────────────────────────────────────────────
   Lấy ĐÚNG ký tự file đang dùng, không tự chọn ký tự "đẹp hơn": ô đếm của file là
   `=COUNTIF($I16:$AO16,"X")` nên viết thường "x" là luỹ kế không cộng, mà bảng vẫn trông bình
   thường. Đo file ngày 12/10/2026: 124 ô "✓" (U+2713), 87 ô "X" hoa, 8 ô "O" hoa, 191 ô "n/a". */
export const KY_HIEU: Record<DauPdf, string> = { P: "✓", o: "O", x: "X" };

/** Tên hạng mục robot được phép chấm. So khớp bỏ dấu nên "Thi cong lap dat" cũng khớp. */
export const HANG_MUC_ROBOT = /^thi\s*cong\s*lap\s*dat$/;

const kh = (v: unknown): string =>
  String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

const s = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();

/* ── MÃ CT ───────────────────────────────────────────────────────────────────
   Ô "Mã CT" của bảng gộp nhiều mã, và gộp theo kiểu người viết tay:
       "CT26-078, CT26-055, CT25-070"     → ba mã đủ
       "CT25-040, 038, 037, 027, 026"     → mã đầu đủ, các mã sau RỤNG TIỀN TỐ
   Bỏ qua kiểu thứ hai là mất đúng những dòng gộp nhiều căn — mà đó lại là các dự án lớn. */
export function tachMaCT(v: unknown): string[] {
  const ra: string[] = [];
  let tienTo = "";
  for (const p of String(v ?? "").split(/[,;\n/]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(CT\s*\d{2})\s*-\s*(\d{2,3})$/i.exec(p);
    if (m) {
      tienTo = m[1].replace(/\s+/g, "").toUpperCase();
      ra.push(`${tienTo}-${m[2].padStart(3, "0")}`);
      continue;
    }
    const n = /^(\d{2,3})$/.exec(p);
    if (n && tienTo) ra.push(`${tienTo}-${n[1].padStart(3, "0")}`);
  }
  return [...new Set(ra)];
}

/* ── KHUNG BẢNG ──────────────────────────────────────────────────────────────
   Dò theo NHÃN, không neo chỉ số ô — y như bcn-file.ts. Khác một điểm quan trọng: lưới ở đây lấy
   thẳng từ Sheets API (values.get) nên GIỮ NGUYÊN dòng trống, tức chỉ số dòng ở đây = số dòng
   thật trong Sheet. Bộ đọc của app (bcn-file.ts) đọc qua xlsx với `blankrows:false` nên chỉ số
   của nó LỆCH — đừng mượn chỉ số của bên kia để tính địa chỉ ô. */
export type DongBcn = {
  /** Chỉ số dòng 0-based trong lưới = (số dòng trong Sheet − 1). */
  r: number;
  ma: string[];
  ten: string;
  hangMuc: string;
};

export type KhungBcn = {
  dongTieuDe: number;
  /** Dòng chứa số ngày (01…31). */
  dongSoNgay: number;
  /** Các cột ngày: chỉ số cột 0-based + số ngày đã chuẩn hoá hai chữ số. */
  cotNgay: { c: number; so: string }[];
  /** "09/2026" — lấy ở nhãn TRÊN VÙNG NGÀY, giống bcn-file.ts. Rỗng nếu không đọc được. */
  thangLabel: string;
  /** Ô chứa nhãn tháng, để lúc sang tháng biết ghi vào đâu. */
  oNhanThang: { r: number; c: number } | null;
  cotMa: number;
  dong: DongBcn[];
};

/** Lấy dòng đầu của ô ngày: ô cuối tháng hay ghi "31\nT7" (xem bcn-file.ts). */
const soNgayCuaO = (v: unknown): string => {
  const d1 = String(v ?? "").split(/\r?\n/)[0].trim();
  return /^\d{1,2}$/.test(d1) ? d1.padStart(2, "0") : "";
};

export function doKhung(grid: unknown[][]): KhungBcn | null {
  let dongTieuDe = -1;
  for (let r = 0; r < Math.min(grid.length, 60); r++) {
    const o = (grid[r] ?? []).map(kh);
    if (o.includes("stt") && o.includes("ma ct") && o.includes("hang muc")) { dongTieuDe = r; break; }
  }
  if (dongTieuDe < 0) return null;
  const H = grid[dongTieuDe] ?? [];
  const cotCua = (nhan: string) => { const t = kh(nhan); for (let c = 0; c < H.length; c++) if (kh(H[c]) === t) return c; return -1; };
  const cotMa = cotCua("Mã CT"), cotTen = cotCua("Dự án"), cotHm = cotCua("Hạng mục");
  if (cotMa < 0 || cotHm < 0) return null;

  /* DÒNG SỐ NGÀY tự khai mình: nó là dòng DUY NHẤT dưới tiêu đề có một dãy ≥ 20 ô toàn số ngày.
     Dò thế này thì chèn thêm một dòng tiêu đề phụ cũng không lệch. */
  let dongSoNgay = -1, cotNgay: { c: number; so: string }[] = [];
  for (let r = dongTieuDe; r < Math.min(grid.length, dongTieuDe + 8); r++) {
    const hang = grid[r] ?? [];
    const co: { c: number; so: string }[] = [];
    for (let c = 0; c < hang.length; c++) { const so = soNgayCuaO(hang[c]); if (so) co.push({ c, so }); }
    if (co.length >= 20) { dongSoNgay = r; cotNgay = co; break; }
  }
  if (dongSoNgay < 0) return null;

  /* NHÃN THÁNG nằm đâu đó giữa dòng tiêu đề và dòng số ngày, ở cột đầu vùng ngày. Giữ lại ĐỊA CHỈ
     chứ không chỉ giá trị: lúc sang tháng phải ghi đè đúng ô đó. */
  let oNhanThang: { r: number; c: number } | null = null, thangLabel = "";
  for (let r = dongTieuDe; r <= dongSoNgay && !oNhanThang; r++)
    for (const o of (grid[r] ?? []).keys()) {
      const m = s((grid[r] ?? [])[o]).match(/TH[ÁA]NG\s*(\d{1,2}\/\d{4})/i);
      if (m) { oNhanThang = { r, c: o }; thangLabel = m[1]; break; }
    }

  const dong: DongBcn[] = [];
  let maHien: string[] = [], tenHien = "";
  for (let r = dongSoNgay + 1; r < grid.length; r++) {
    const hang = grid[r] ?? [];
    const hm = s(hang[cotHm]);
    if (!hm) continue;
    /* Ô nhận dạng dự án chỉ điền ở DÒNG ĐẦU của cụm ba hạng mục (ô gộp trong Sheet) → giữ lại mã
       của dự án đang xét cho hai dòng sau. */
    const maO = tachMaCT(hang[cotMa]);
    if (maO.length) { maHien = maO; tenHien = cotTen >= 0 ? s(hang[cotTen]) : ""; }
    dong.push({ r, ma: maHien, ten: tenHien, hangMuc: hm });
  }
  return { dongTieuDe, dongSoNgay, cotNgay, thangLabel, oNhanThang, cotMa, dong };
}

/* ── BẰNG CHỨNG ──────────────────────────────────────────────────────────── */

export type BangChung = {
  /** Phút trong ngày theo giờ VN. */
  phut: number;
  nguon: "file" | "pdf";
  /** Ai làm — để ghi vào sổ chạy, tiện soi khi anh Tiến hỏi "sao dự án này lại tick". */
  ai: string;
};

/** Bằng chứng sớm nhất trong ngày của một dòng (gộp mọi mã CT của dòng đó). */
export function somNhat(theoMa: ReadonlyMap<string, BangChung[]>, ma: readonly string[]): BangChung | null {
  let tot: BangChung | null = null;
  for (const m of ma) for (const b of theoMa.get(m) ?? []) if (!tot || b.phut < tot.phut) tot = b;
  return tot;
}

/* ── KẾ HOẠCH GHI ────────────────────────────────────────────────────────── */

export type OGhi = { r: number; c: number; giaTri: string };

export type KeHoach = {
  /** Các ô sẽ ghi. Rỗng = không có gì để ghi (và đó là kết quả hợp lệ). */
  o: OGhi[];
  /** Dòng bỏ qua kèm lý do — in ra sổ chạy để biết vì sao một dự án không có dấu. */
  boQua: { ten: string; ma: string[]; vi: string }[];
  /** Cột ngày hôm nay, -1 nếu bảng không có cột đó. */
  cotHomNay: number;
};

/**
 * Lên kế hoạch ghi cho MỘT ngày.
 *
 * @param ngay    ngày VN "YYYY-MM-DD" đang chấm
 * @param chot    true = lượt chốt sau 20:00 (ô còn trống thành "X");
 *                false = lượt 18:00 (chỉ ghi ✓/O, chưa kết tội ai)
 */
export function lenKeHoach(args: {
  khung: KhungBcn;
  grid: unknown[][];
  theoMa: ReadonlyMap<string, BangChung[]>;
  ngay: string;
  chot: boolean;
  /** Mã CT app KHÔNG có nguồn nào để nhìn → không chấm, kể cả lượt chốt. */
  khongDoDuoc?: ReadonlySet<string>;
}): KeHoach {
  const { khung, grid, theoMa, ngay, chot, khongDoDuoc } = args;
  const soNgay = ngay.slice(8, 10);
  const cot = khung.cotNgay.find((x) => x.so === soNgay)?.c ?? -1;
  const o: OGhi[] = [];
  const boQua: KeHoach["boQua"] = [];
  if (cot < 0) return { o, boQua, cotHomNay: -1 };

  for (const d of khung.dong) {
    if (!HANG_MUC_ROBOT.test(kh(d.hangMuc))) continue;              // chỉ dòng Thi công lắp đặt
    if (!d.ma.length) { boQua.push({ ten: d.ten, ma: [], vi: "dòng không có mã CT" }); continue; }

    const dangCo = s((grid[d.r] ?? [])[cot]);
    if (dangCo) { boQua.push({ ten: d.ten, ma: d.ma, vi: `ô đã có "${dangCo}"` }); continue; }

    const bc = somNhat(theoMa, d.ma);
    if (bc) { o.push({ r: d.r, c: cot, giaTri: KY_HIEU[dauTheoPhut(bc.phut)] }); continue; }

    /* KHÔNG CÓ BẰNG CHỨNG. Trước 20:00 thì chưa kết luận được. Sau 20:00 thì là "X" — TRỪ những
       dự án app không có cửa nào để nhìn (chưa gắn ma trận, chưa từng xuất PDF): chấm "X" cho
       người mà mình không có cách quan sát là chấm oan, và oan kiểu này không ai cãi được. */
    if (!chot) { boQua.push({ ten: d.ten, ma: d.ma, vi: "chưa có báo cáo, chưa tới lượt chốt" }); continue; }
    if (khongDoDuoc && d.ma.every((m) => khongDoDuoc.has(m))) {
      boQua.push({ ten: d.ten, ma: d.ma, vi: "app không có nguồn nào để nhìn dự án này" });
      continue;
    }
    o.push({ r: d.r, c: cot, giaTri: KY_HIEU.x });
  }
  return { o, boQua, cotHomNay: cot };
}

/* ── SANG THÁNG ──────────────────────────────────────────────────────────────
   Anh Tiến chốt 12/10/2026: robot tự dọn bảng đầu tháng, giữ lại tháng cũ ở một tab riêng.
   File CHỈ GIỮ MỘT THÁNG; không chụp lại trước khi xoá là mất sạch tháng cũ. */

/** Tháng "MM/YYYY" của một ngày ISO. */
export const thangCua = (ngay: string): string => `${ngay.slice(5, 7)}/${ngay.slice(0, 4)}`;

/** Tên tab lưu tháng cũ: "BCN 09-2026". */
export const tenTabLuu = (thangLabel: string): string => `BCN ${thangLabel.replace("/", "-")}`;

/** Bảng đang ở tháng nào so với hôm nay. `null` = không đọc được nhãn tháng → ĐỪNG ĐỤNG GÌ. */
export function xetThang(khung: KhungBcn, ngay: string): "khop" | "cu" | "la" | null {
  if (!khung.thangLabel) return null;
  const nay = thangCua(ngay);
  if (khung.thangLabel === nay) return "khop";
  const [mc, yc] = khung.thangLabel.split("/").map(Number);
  const [mn, yn] = nay.split("/").map(Number);
  if (!Number.isFinite(mc) || !Number.isFinite(yc)) return null;
  /* "cu" = bảng đang ở tháng TRƯỚC hôm nay → tới lúc dọn. "la" = bảng ở tháng TƯƠNG LAI, nghĩa là
     có người đã sửa tay sang tháng khác; robot đứng im chứ không đoán. */
  return yc * 12 + mc < yn * 12 + mn ? "cu" : "la";
}

/** Thứ trong tuần kiểu file đang dùng: T2…T7, CN. */
export function thuVn(ngay: string): string {
  const t = new Date(`${ngay}T00:00:00Z`).getUTCDay();
  return t === 0 ? "CN" : `T${t + 1}`;
}

/** Các ngày của tháng chứa `ngay`, dạng "01"…"31". */
export function ngayCuaThang(ngay: string): string[] {
  const nam = +ngay.slice(0, 4), thg = +ngay.slice(5, 7);
  const cuoi = new Date(Date.UTC(nam, thg, 0)).getUTCDate();
  return Array.from({ length: cuoi }, (_, i) => String(i + 1).padStart(2, "0"));
}

/**
 * Kế hoạch dọn bảng sang tháng mới: ô nhãn tháng, dòng thứ, dòng số ngày, và vùng dấu phải xoá.
 * KHÔNG tự chạy — bên gọi phải chụp tab cũ xong mới được áp.
 */
export function lenKeHoachSangThang(khung: KhungBcn, ngay: string): {
  o: OGhi[];
  /** Vùng dấu cần xoá: từ cột ngày đầu tới cột ngày cuối, từ dòng đầu dữ liệu tới dòng cuối. */
  xoa: { r1: number; c1: number; r2: number; c2: number } | null;
} {
  const o: OGhi[] = [];
  const ngays = ngayCuaThang(ngay);
  if (khung.oNhanThang) o.push({ r: khung.oNhanThang.r, c: khung.oNhanThang.c, giaTri: `THÁNG ${thangCua(ngay)}` });

  const dongThu = khung.dongSoNgay - 1;
  khung.cotNgay.forEach((x, i) => {
    const so = ngays[i] ?? "";                       // tháng 28/30 ngày → cột thừa để TRỐNG
    o.push({ r: khung.dongSoNgay, c: x.c, giaTri: so });
    if (dongThu > khung.dongTieuDe) o.push({ r: dongThu, c: x.c, giaTri: so ? thuVn(`${ngay.slice(0, 7)}-${so}`) : "" });
  });

  const c1 = khung.cotNgay[0]?.c, c2 = khung.cotNgay[khung.cotNgay.length - 1]?.c;
  const r1 = khung.dong[0]?.r, r2 = khung.dong[khung.dong.length - 1]?.r;
  const xoa = c1 != null && c2 != null && r1 != null && r2 != null ? { r1, c1, r2, c2 } : null;
  return { o, xoa };
}

/* ── ĐỊA CHỈ Ô ───────────────────────────────────────────────────────────── */

/** Chỉ số cột 0-based → chữ cột kiểu Sheet ("A", "Z", "AA"). */
export function chuCot(c: number): string {
  let n = c + 1, t = "";
  while (n > 0) { const d = (n - 1) % 26; t = String.fromCharCode(65 + d) + t; n = Math.floor((n - 1) / 26); }
  return t;
}

/** Địa chỉ A1 có kèm tên tab, dạng Sheets API nhận: "'BCN_BangCham'!I16". */
export function diaChi(tab: string, r: number, c: number): string {
  return `'${tab.replace(/'/g, "''")}'!${chuCot(c)}${r + 1}`;
}

/** Gom các ô rời thành danh sách range 1 ô cho values:batchUpdate. */
export function thanhRange(tab: string, o: readonly OGhi[]): { range: string; values: string[][] }[] {
  return o.map((x) => ({ range: diaChi(tab, x.r, x.c), values: [[x.giaTri]] }));
}

export { dauTheoPhut, lucVn };
