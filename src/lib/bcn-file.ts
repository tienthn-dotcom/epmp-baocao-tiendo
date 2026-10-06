/**
 * BÁO CÁO TUÂN THỦ THEO NGÀY (BCN) — ĐỌC FILE NGUỒN.
 *
 * Nguồn: Google Sheet "ĐÁNH GIÁ TUÂN THỦ BÁO CÁO HẰNG NGÀY", tab `BCN_BangCham`.
 * File tự chấm sẵn; app chỉ ĐỌC dấu và số lên, KHÔNG chấm lại. Đây là bài học đắt nhất của báo
 * cáo tuân thủ THÁNG: app từng chấm lại các kỳ cũ bằng luật hiện hành và cho ra số khác file.
 *
 * BA MỐC MỖI NGÀY (ghi ngay trong file, ô S2):
 *     Quân số 09:00  ·  Sản lượng 12:00  ·  Thi công lắp đặt 18:00
 * Nên MỖI DỰ ÁN CÓ BA DÒNG, mỗi dòng một hạng mục. Đo trên file 05/10/2026: 32 dự án × 3 = 96 dòng.
 *
 * DẤU (ô R4):  ✓ đúng hạn · O trễ hoặc thiếu · X quá hạn hoặc không báo cáo · n/a chưa cần báo cáo.
 * ĐIỂM (ô Y4): mỗi hạng mục khởi 100 điểm/tháng, trễ/thiếu −2, không báo cáo −5.
 *              Điểm PM = tổng điểm các dự án PM quản ÷ số dự án.
 * Đã đối chiếu công thức với CHÍNH cột điểm của file trên toàn bộ 96 dòng: khớp tuyệt đối.
 *
 * BỐ CỤC LƯỚI (1-based như Excel):
 *     dòng 2    E: "Ngày cập nhật: dd/mm/yyyy"      S: câu ba mốc giờ
 *     dòng 4    R: chú thích dấu                    Y: cách tính điểm
 *     dòng 12   A STT · B Vùng · C Mã CT · D Dự án · E PM · F Hạng mục
 *               H "Luỹ kế không báo cáo" · I "THÁNG mm/yyyy" · AP,AS "TỔNG KẾT ĐIỂM"
 *     dòng 13   thứ trong tuần theo cột ngày (T2…CN)
 *     dòng 14   số ngày 01…31
 *     dòng 15   dòng ĐẾM của file (bỏ qua)
 *     dòng 16+  dữ liệu; ô nhận dạng dự án chỉ điền ở DÒNG ĐẦU của cụm ba hạng mục
 *
 * KHÔNG NEO CHỈ SỐ CỘT. Dò theo nhãn ở dòng tiêu đề, y như parser của Master Plan: file chèn thêm
 * một cột là mọi chỉ số cứng lệch hết, mà lệch kiểu đó không báo lỗi — nó chỉ đọc ra số sai.
 */

/** Dấu một ô ngày. `null` = ô trống (chưa tới ngày đó, hoặc file chưa điền). */
export type BcnMark = "P" | "o" | "x" | "na" | null;

/** Một HẠNG MỤC báo cáo của một dự án (Quân số / Sản lượng / Thi công lắp đặt). */
export type BcnHangMuc = {
  ten: string;
  marks: BcnMark[];
  demP: number;
  demO: number;
  demX: number;
  demNa: number;
  /** 100 − 2·O − 5·X. `null` khi cả tháng chưa có dấu nào — chưa có gì để chấm. */
  diem: number | null;
  /** Cột "Luỹ kế không báo cáo" của file. */
  luyKe: number | null;
};

export type BcnDuAn = {
  stt: number | null;
  vung: string;
  maCT: string;
  ten: string;
  pm: string;
  hangMuc: BcnHangMuc[];
  /** Trung bình điểm các hạng mục (làm tròn). `null` khi chưa hạng mục nào có điểm. */
  diem: number | null;
};

/** Một cột ngày. */
export type BcnNgay = { so: string; thu: string };

export type BcnData = {
  /** "09/2026" — rỗng nếu không đọc được. */
  thangLabel: string;
  /** "05/10/2026" — null nếu file không ghi. */
  ngayCapNhat: string | null;
  ngay: BcnNgay[];
  duAn: BcnDuAn[];
  /** Nguyên văn câu ba mốc giờ trong file — bày lên đầu báo cáo, KHÔNG gõ lại trong code. */
  mocGio: string;
  /** Các dòng chú thích dấu, nguyên văn. */
  chuThich: string[];
  /** Các dòng cách tính điểm, nguyên văn. */
  cachTinh: string[];
};

const s = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
/** Giữ xuống dòng (ô chú thích nhiều dòng), chỉ gọn khoảng trắng thừa trong từng dòng. */
const sNhieuDong = (v: unknown): string[] =>
  String(v ?? "").split(/\r?\n/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);

/** Bỏ dấu + thường hoá để so nhãn (file gõ mỗi kỳ một kiểu hoa/thường). */
const kh = (v: unknown): string =>
  s(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

/** Ô dấu → mã. Nhận cả "✓" "v" "P" cho đúng hạn, "o"/"0" cho trễ, "x" cho không báo cáo. */
export function docMark(v: unknown): BcnMark {
  const t = s(v);
  if (!t) return null;
  if (/^n\s*\/\s*a$/i.test(t)) return "na";
  if (t === "✓" || t === "✔" || /^[pv]$/i.test(t)) return "P";
  if (/^o$/i.test(t)) return "o";
  if (/^x$/i.test(t)) return "x";
  return null;                                  // ký hiệu lạ → KHÔNG đoán, để trống
}

const soNguyen = (v: unknown): number | null => {
  const t = s(v).replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(+t);
};

/** Tìm dòng tiêu đề: dòng CÓ ĐỦ bốn nhãn neo. Trả -1 nếu không thấy. */
function timDongTieuDe(grid: unknown[][]): number {
  for (let r = 0; r < Math.min(grid.length, 60); r++) {
    const o = (grid[r] ?? []).map(kh);
    if (o.includes("stt") && o.includes("vung") && o.includes("du an") && o.includes("hang muc")) return r;
  }
  return -1;
}

/** Chỉ số cột của một nhãn trên dòng tiêu đề (-1 nếu không có). */
function cotCua(hang: unknown[], nhan: string): number {
  const t = kh(nhan);
  for (let c = 0; c < hang.length; c++) if (kh(hang[c]) === t) return c;
  return -1;
}

/** Ô đầu tiên trong lưới khớp một biểu thức — để nhặt câu mốc giờ / chú thích mà khỏi neo ô cứng. */
function timO(grid: unknown[][], re: RegExp, hetDong = 12): string {
  for (let r = 0; r < Math.min(grid.length, hetDong); r++)
    for (const o of grid[r] ?? []) { const t = String(o ?? ""); if (re.test(t)) return t; }
  return "";
}

export function parseBcnGrid(grid: unknown[][]): BcnData {
  const hdr = timDongTieuDe(grid);
  if (hdr < 0) {
    return { thangLabel: "", ngayCapNhat: null, ngay: [], duAn: [], mocGio: "", chuThich: [], cachTinh: [] };
  }
  const H = grid[hdr] ?? [];
  const cStt = cotCua(H, "STT"), cVung = cotCua(H, "Vùng"), cMa = cotCua(H, "Mã CT");
  const cTen = cotCua(H, "Dự án"), cPm = cotCua(H, "PM"), cHm = cotCua(H, "Hạng mục");
  const cLuyKe = (() => { for (let c = 0; c < H.length; c++) if (kh(H[c]).startsWith("luy ke")) return c; return -1; })();

  /* CỘT NGÀY — lấy từ DÒNG SỐ NGÀY (hdr+2), không đếm từ một cột cố định: dòng đó chỉ có số ở đúng
     các cột ngày, nên nó tự khai đâu là vùng ngày. Dòng hdr+1 cho thứ trong tuần. */
  const hThu = grid[hdr + 1] ?? [], hSo = grid[hdr + 2] ?? [];
  const cotNgay: number[] = [];
  for (let c = 0; c < hSo.length; c++) if (/^\d{1,2}$/.test(s(hSo[c]))) cotNgay.push(c);
  const ngay: BcnNgay[] = cotNgay.map((c) => ({ so: s(hSo[c]).padStart(2, "0"), thu: s(hThu[c]) }));

  /* NHÃN THÁNG nằm trên chính dòng tiêu đề, ở ô mở đầu vùng ngày ("THÁNG 09/2026"). */
  const thangLabel = (() => {
    for (const o of H) { const m = s(o).match(/TH[ÁA]NG\s*(\d{1,2}\/\d{4})/i); if (m) return m[1]; }
    const m2 = timO(grid, /TH[ÁA]NG\s*\d{1,2}\/\d{4}/i).match(/TH[ÁA]NG\s*(\d{1,2}\/\d{4})/i);
    return m2 ? m2[1] : "";
  })();
  const ngayCapNhat = (() => {
    const m = timO(grid, /Ng[àa]y c[ậa]p nh[ậa]t/i).match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    return m ? m[1] : null;
  })();
  const mocGio = s(timO(grid, /M[ốo]c b[áa]o c[áa]o m[ỗo]i ng[àa]y/i));
  const chuThich = sNhieuDong(timO(grid, /CH[ÚU] TH[ÍI]CH/i) === "" ? "" : "")
    .concat(sNhieuDong((grid.flat().find((o) => /B[áa]o c[áa]o [đd][úu]ng h[ạa]n/i.test(String(o ?? ""))) ?? "")));
  const cachTinh = sNhieuDong(grid.flat().find((o) => /kh[ởo]i [đd]i[ểe]m 100/i.test(String(o ?? ""))) ?? "");

  /* DỮ LIỆU — ô nhận dạng dự án chỉ điền ở DÒNG ĐẦU của cụm ba hạng mục, các dòng sau để trống
     (ô gộp trong Sheet). Nên GIỮ dự án hiện hành và gắn hạng mục vào nó. */
  const duAn: BcnDuAn[] = [];
  let hien: BcnDuAn | null = null;
  for (let r = hdr + 3; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const hm = cHm >= 0 ? s(row[cHm]) : "";
    if (!hm) continue;                                   // không phải dòng hạng mục
    const ten = cTen >= 0 ? s(row[cTen]) : "";
    if (ten || (cStt >= 0 && s(row[cStt]))) {
      hien = { stt: cStt >= 0 ? soNguyen(row[cStt]) : null, vung: cVung >= 0 ? s(row[cVung]) : "",
        maCT: cMa >= 0 ? s(row[cMa]) : "", ten, pm: cPm >= 0 ? s(row[cPm]) : "", hangMuc: [], diem: null };
      duAn.push(hien);
    }
    if (!hien) continue;                                 // hạng mục mồ côi (không có dự án đứng trước)

    const marks = cotNgay.map((c) => docMark(row[c]));
    let demP = 0, demO = 0, demX = 0, demNa = 0;
    for (const m of marks) { if (m === "P") demP++; else if (m === "o") demO++; else if (m === "x") demX++; else if (m === "na") demNa++; }
    /* CHƯA CÓ DẤU NÀO → null, KHÔNG phải 100. Một hạng mục chưa tới lượt báo cáo mà cho 100 điểm
       là khen người ta vì chưa làm gì — đúng loại sai âm thầm mà báo cáo đánh giá người không được phép có. */
    const coDau = demP + demO + demX + demNa > 0;
    hien.hangMuc.push({
      ten: hm, marks, demP, demO, demX, demNa,
      diem: coDau ? 100 - 2 * demO - 5 * demX : null,
      luyKe: cLuyKe >= 0 ? soNguyen(row[cLuyKe]) : null,
    });
  }

  for (const d of duAn) {
    const co = d.hangMuc.map((h) => h.diem).filter((x): x is number => x != null);
    d.diem = co.length ? Math.round(co.reduce((a, b) => a + b, 0) / co.length) : null;
  }

  return { thangLabel, ngayCapNhat, ngay, duAn, mocGio, chuThich, cachTinh };
}

/** ĐIỂM PM = tổng điểm các dự án PM quản ÷ số dự án (đúng câu ghi trong file). Dự án chưa có điểm
 *  thì KHÔNG tính vào mẫu số — chia cho một dự án chưa chấm là kéo điểm PM xuống vô cớ. */
export function diemPm(duAn: readonly BcnDuAn[]): Map<string, number> {
  const gom = new Map<string, { tong: number; n: number }>();
  for (const d of duAn) {
    if (d.diem == null || !d.pm) continue;
    const g = gom.get(d.pm) ?? { tong: 0, n: 0 };
    g.tong += d.diem; g.n++;
    gom.set(d.pm, g);
  }
  const ra = new Map<string, number>();
  for (const [pm, g] of gom) ra.set(pm, Math.round(g.tong / g.n));
  return ra;
}
