/**
 * ĐỌC BẢNG "BÁO CÁO % HOÀN THÀNH LẮP ĐẶT SO VỚI KẾ HOẠCH".
 *
 * Đây là tab mà các dự án ĐANG GẮN vào popup Thi công lắp đặt — không phải ma trận định lượng.
 * Mỗi dòng là MỘT KHU, và bảng đã tính sẵn đúng những thứ cần để so dự án với dự án:
 *   % Hoàn thành dự kiến · % Hoàn thành thực tế · % xong hôm trước · % tăng thêm trong ngày ·
 *   Chênh lệch so với kế hoạch · CẢNH BÁO TRỄ TIẾN ĐỘ · ngày bàn giao · số ngày còn lại.
 *
 * VÌ SAO ĐỌC THEO TÊN CỘT chứ không theo vị trí: mỗi dự án dựng bảng một kiểu — dòng tiêu đề khi ở
 * hàng 2 khi ở hàng 3, cột "% xong hôm trước" khi đứng trước khi đứng sau "% thực tế", cột khu khi
 * tên "Các khu" khi "Các khu PUBLIC". Bám vị trí là sai ngay dự án thứ hai.
 *
 * MỘT TAB CÓ THỂ CHỨA NHIỀU DỰ ÁN (tab Public của Nam Phương có cả CT25-070 lẫn CT26-055/078). Nên
 * khi bảng có cột "Mã dự án" thì PHẢI lọc theo mã, không thì số của dự án khác chạy vào thẻ mình.
 *
 * Module THUẦN — không đụng server, để client và test dùng chung một cách tính.
 */

/** Một dòng khu đã đọc được. Phần trăm để nguyên thang 0..1 như trong file. */
export type KhuBaoCao = {
  khu: string;
  maCT: string;
  pctThuc: number | null;
  pctDuKien: number | null;
  pctHomTruoc: number | null;
  tangTrongNgay: number | null;
  chenhLech: number | null;
  canhBao: string;
  ngayBanGiao: string | null;
  soNgayConLai: number | null;
};

export type BaoCao =
  | { ok: true; tieuDe: string; khu: KhuBaoCao[] }
  | { ok: false; loi: string };

/** Bảng 2 chiều thô: [dòng][cột]. Bên gọi tự lo việc lấy từ worksheet ra. */
export type O = string | number | boolean | Date | null | undefined;

const chu = (v: O): string => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v)).replace(/\s+/g, " ").trim();
const so = (v: O): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[%\s]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const COT = {
  khu: /^các khu\b|^khu vực$|^hạng mục$/i,
  maCT: /^mã dự án$|^mã ct$/i,
  batDau: /ngày bắt đầu/i,
  banGiao: /ngày bàn giao/i,
  conLai: /số ngày còn lại/i,
  duKien: /% ?hoàn thành dự kiến/i,
  thuc: /% ?hoàn thành thực tế/i,
  homTruoc: /xong hôm trước/i,
  tang: /tăng thêm trong ngày/i,
  canhBao: /cảnh báo/i,
  chenh: /chênh lệch/i,
} as const;

/**
 * Đọc bảng báo cáo từ mảng 2 chiều.
 * @param maCT lọc theo mã dự án khi bảng có cột "Mã dự án" (tab dùng chung nhiều dự án).
 */
export function docBaoCao(rows: O[][], maCT?: string): BaoCao {
  if (!rows?.length) return { ok: false, loi: "bảng rỗng" };

  // 1) DÒNG TIÊU ĐỀ: dòng đầu tiên (trong 10 dòng đầu) có cả cột khu lẫn cột "% Hoàn thành thực tế".
  let hdr = -1;
  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const o = (rows[r] || []).map(chu);
    if (o.some((v) => COT.khu.test(v)) && o.some((v) => COT.thuc.test(v))) { hdr = r; break; }
  }
  if (hdr < 0) return { ok: false, loi: "không thấy dòng tiêu đề (Các khu / % Hoàn thành thực tế)" };

  const head = (rows[hdr] || []).map(chu);
  const tim = (re: RegExp): number => head.findIndex((v) => re.test(v));
  const c = {
    khu: tim(COT.khu), maCT: tim(COT.maCT), banGiao: tim(COT.banGiao), conLai: tim(COT.conLai),
    duKien: tim(COT.duKien), thuc: tim(COT.thuc), homTruoc: tim(COT.homTruoc),
    tang: tim(COT.tang), canhBao: tim(COT.canhBao), chenh: tim(COT.chenh),
  };
  if (c.khu < 0 || c.thuc < 0) return { ok: false, loi: "thiếu cột khu hoặc % thực tế" };

  // Tiêu đề bảng: dòng nào phía trên có chữ "BÁO CÁO" — chỉ để hiển thị, không dùng để tính.
  let tieuDe = "";
  for (let r = 0; r < hdr; r++) {
    const d = (rows[r] || []).map(chu).find((v) => /báo cáo/i.test(v));
    if (d) { tieuDe = d; break; }
  }

  // 2) CÁC DÒNG KHU. Bảng hết là hết — gặp 5 dòng trống liên tiếp thì dừng, đừng quét xuống khối khác.
  const lay = (row: O[], i: number): O => (i >= 0 ? row[i] : null);
  const khu: KhuBaoCao[] = [];
  let trong = 0;
  const loc = (maCT || "").trim().toUpperCase();
  for (let r = hdr + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const ten = chu(lay(row, c.khu));
    if (!ten) { if (++trong >= 5 && khu.length) break; continue; }
    trong = 0;
    if (/^các khu|^tổng|^total$/i.test(ten)) continue;         // tiêu đề lặp / dòng tổng của bảng
    const ma = chu(lay(row, c.maCT)).toUpperCase();
    if (loc && c.maCT >= 0 && ma && ma !== loc) continue;      // tab dùng chung → chỉ lấy dự án mình
    const thuc = so(lay(row, c.thuc));
    const duKien = so(lay(row, c.duKien));
    if (thuc == null && duKien == null) continue;              // dòng chữ, không phải dòng số
    khu.push({
      khu: ten, maCT: ma,
      pctThuc: thuc, pctDuKien: duKien,
      pctHomTruoc: so(lay(row, c.homTruoc)),
      tangTrongNgay: so(lay(row, c.tang)),
      chenhLech: so(lay(row, c.chenh)),
      canhBao: chu(lay(row, c.canhBao)),
      ngayBanGiao: chu(lay(row, c.banGiao)) || null,
      soNgayConLai: so(lay(row, c.conLai)),
    });
  }
  if (!khu.length) return { ok: false, loi: loc ? `bảng không có dòng nào của ${loc}` : "bảng không có dòng khu nào" };
  return { ok: true, tieuDe, khu };
}

/* ── TÓM TẮT MỘT DỰ ÁN ──────────────────────────────────────────────────────────────────────── */

export type TomTat = {
  soKhu: number;
  pctThuc: number | null;      // 0..100
  pctDuKien: number | null;    // 0..100
  chenhLech: number | null;    // 0..100, âm = trễ so với kế hoạch
  tangHomNay: number | null;   // 0..100, phần trăm nhích thêm trong ngày
  dat: number; chamNhe: number; baoDong: number;
  soNgayConLai: number | null; // của khu gấp nhất (nhỏ nhất)
};

const tb = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const tram = (v: number | null): number | null => (v == null ? null : Math.round(v * 1000) / 10);

/**
 * Gộp các khu thành một dòng số cho thẻ.
 * Trung bình KHÔNG trọng số vì bảng không cho khối lượng từng khu — đúng bằng cách người ta đang
 * đọc bảng bằng mắt, và không bịa ra trọng số mình tự nghĩ.
 */
export function tomTat(khu: KhuBaoCao[]): TomTat {
  const thuc = tb(khu.map((k) => k.pctThuc));
  const duKien = tb(khu.map((k) => k.pctDuKien));
  const nhan = (k: KhuBaoCao) => k.canhBao.toLowerCase();
  return {
    soKhu: khu.length,
    pctThuc: tram(thuc),
    pctDuKien: tram(duKien),
    chenhLech: thuc != null && duKien != null ? tram(thuc - duKien) : tram(tb(khu.map((k) => k.chenhLech))),
    tangHomNay: tram(tb(khu.map((k) => k.tangTrongNgay))),
    dat: khu.filter((k) => /đạt|xong|hoàn thành/.test(nhan(k))).length,
    baoDong: khu.filter((k) => /báo động|nghiêm|đỏ/.test(nhan(k))).length,
    chamNhe: khu.filter((k) => /chậm/.test(nhan(k)) && !/báo động/.test(nhan(k))).length,
    soNgayConLai: khu.map((k) => k.soNgayConLai).filter((v): v is number => v != null).sort((a, b) => a - b)[0] ?? null,
  };
}

/* ── DẠNG THỨ HAI: MA TRẬN CÓ CỘT "% THỰC HIỆN" ─────────────────────────────────────────────
 *
 * Không phải dự án nào cũng gắn bảng báo cáo. Có dự án gắn thẳng ma trận ("MA TRẬN BÀN GIAO VÀ %
 * THỰC HIỆN KHU CÔNG CỘNG 4S"): mấy chục cột công đoạn, và một cột % ở cuối. Ma trận kiểu này không
 * có cột kế hoạch, nên thẻ chỉ rút ra được % thực tế và số đơn vị — thiếu thì để trống.
 *
 * KHÔNG dùng reader ma trận sẵn có ở đây: reader đó đòi header phải đủ Tòa + Căn + Khối lượng, mà
 * ma trận Public thì không có cột "Tòa" — đòi đúng bộ ba là loại oan gần hết ma trận Public.
 */
export type BangPct = { ok: true; ten: string; dong: { ten: string; pct: number }[] } | { ok: false; loi: string };

/* CHỈ nhận cột ghi rõ là PHẦN TRĂM. Từng cho khớp cả cột "TỔNG" — và tab Summary của Mini Hotel có
   cột "Tổng" đếm SỐ CĂN (427), thế là thẻ hiện 127%. Số sai tệ hơn nhiều so với không có số. */
const COT_PCT = /%\s*(thực hiện|hoàn thành|hoan thanh)|(thực hiện|hoàn thành)\s*%/i;
const COT_TEN = /^căn$|^các khu|^khu\b|^khu vực$|^hạng mục$|^tên|^t[òo]a$/i;

/** Đọc bảng dạng "mỗi dòng một đơn vị + một cột phần trăm". Trả % theo thang 0..1. */
export function docBangPct(rows: O[][]): BangPct {
  if (!rows?.length) return { ok: false, loi: "bảng rỗng" };
  let hdr = -1, cPct = -1;
  for (let r = 0; r < Math.min(8, rows.length) && hdr < 0; r++) {
    const o = (rows[r] || []).map(chu);
    // Lấy cột % ở BÊN PHẢI NHẤT: ma trận hay có % của từng công đoạn, cột tổng luôn nằm cuối.
    // Ô tiêu đề là NHÃN NGẮN. Không chặn độ dài thì dòng tựa đề "MA TRẬN BÀN GIAO VÀ % THỰC HIỆN
    // KHU CÔNG CỘNG 4S" cũng khớp, và cả bảng đọc lệch sang cột chữ.
    for (let c = o.length - 1; c >= 0; c--) if (o[c].length <= 24 && COT_PCT.test(o[c])) { hdr = r; cPct = c; break; }
  }
  if (hdr < 0) return { ok: false, loi: "tab này không có cột phần trăm" };

  const head = (rows[hdr] || []).map(chu);
  // Cột TÊN: ưu tiên "Căn" — dòng tổng của toà/tầng để trống ô căn, nên bám cột này là tự loại được
  // dòng tổng, khỏi cộng trùng. Không có thì lấy cột chữ đầu tiên.
  let cTen = head.findIndex((v) => COT_TEN.test(v));
  if (cTen < 0) cTen = 0;

  const dong: { ten: string; pct: number }[] = [];
  let trong = 0;
  for (let r = hdr + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const ten = chu(row[cTen]);
    if (!ten) { if (++trong >= 8 && dong.length) break; continue; }
    trong = 0;
    if (/^t[ổo]ng|^total$|^ghi chú/i.test(ten)) continue;
    const v = so(row[cPct]);
    // Phần trăm trong mọi file đang dùng đều ghi thang 0..1. Gặp số ngoài khoảng đó thì đấy không
    // phải cột phần trăm (hoặc dòng đó là số lượng) — bỏ qua, đừng đoán rồi chia 100.
    if (v == null || v < 0 || v > 1.001) continue;
    dong.push({ ten, pct: v });
  }
  if (!dong.length) return { ok: false, loi: "cột phần trăm không có dòng nào đọc được" };
  return { ok: true, ten: head[cPct] || "%", dong };
}

/** Đưa bảng dạng ma trận về cùng khuôn TomTat với bảng báo cáo (thiếu kế hoạch thì để trống). */
export function tomTatBangPct(dong: { ten: string; pct: number }[]): TomTat {
  const tb0 = dong.reduce((a, b) => a + b.pct, 0) / dong.length;
  return {
    soKhu: dong.length,
    pctThuc: tram(tb0), pctDuKien: null, chenhLech: null, tangHomNay: null,
    dat: dong.filter((d) => d.pct >= 0.999).length,
    chamNhe: 0, baoDong: 0, soNgayConLai: null,
  };
}

/** Public hay khối phòng: đọc từ tiêu đề bảng + tên tab + tên dự án, ưu tiên cái nói rõ nhất. */
export function doanNhom(tieuDe: string, tenTab: string, tenDuAn: string): "public" | "rooms" {
  const t = `${tieuDe} ${tenTab} ${tenDuAn}`.toLowerCase();
  if (/public|lobby|khu công cộng/.test(t)) return "public";
  return "rooms";
}
