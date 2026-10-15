/**
 * DÒ LỖI SỐ LIỆU TRONG FILE NGUỒN — module thuần.
 *
 * Anh Tiến 15/10/2026, kèm ba ảnh chụp đặt cạnh nhau (app · công cụ dữ liệu · file Excel):
 * *"Làm sao auto nhận diện lỗi >>> người vô đọc thấy được lỗi ở đâu >>> xử lý […] show được số
 * lỗi không khớp, có thể filter >> rồi PC vùng nào nhìn vô vùng mình rồi đi rà, thay vì phải rà
 * thủ công trên excel, hoặc sạn sót hoài hoài cho đến khi bị phát hiện"*.
 *
 * ── APP ĐÃ BIẾT LỖI TỪ TRƯỚC, CHỈ LÀ KHÔNG AI THẤY ──────────────────────────────────────────
 * Ca anh Tiến chụp: Villa Bason V60, dòng "Sản xuất nhập kho" ghi 0% trong khi khối số mã bên
 * phải file ghi 41/50 (53%). App có bắt — nhưng chỉ hiện khi RÊ CHUỘT vào đúng ô đó, và chấm một
 * chấm vàng bé xíu trước con số. Không ai đi rê chuột qua 217 đầu việc để tìm lỗi.
 *
 * Nên module này KHÔNG phát minh luật mới. Nó lấy đúng luật đang chạy trong popup % (pctSuspect
 * ở index.tsx) rồi TÁCH THÀNH TỪNG LOẠI để đếm được, lọc được, giao được cho đúng người.
 *
 * ── BỐN LOẠI LỖI ────────────────────────────────────────────────────────────────────────────
 *   lech       % nhập tay lệch với số mã  (ca Villa Bason)
 *   thieuSoMa  giai đoạn đáng lẽ có số mã nhưng file không có → không đối chiếu được
 *   trong      giai đoạn cần số mà ô % bỏ trống
 *   hong       ô % nhập sai định dạng
 *
 * ── CHỈ XÉT GIAI ĐOẠN CÓ NHẬP SỐ MÃ ─────────────────────────────────────────────────────────
 * Trình duyệt mẫu · Đặt vật tư · Triển khai sản xuất · Sản xuất nhập kho. Mấy giai đoạn khác
 * (Thiết kế, LOA, Thi công lắp đặt) tính % theo cách khác nên không có gì để đối chiếu — kêu lên
 * là kêu oan, mà một bảng lỗi kêu oan thì lần sau không ai mở nữa.
 */

/** Giai đoạn CÓ nhập "số mã / tổng mã" trong file nguồn. Giữ khớp với COUNT_STAGES ở index.tsx. */
export const GIAI_DOAN_CO_SO_MA: ReadonlySet<string> = new Set([
  "Trình duyệt mẫu", "Đặt vật tư", "Triển khai sản xuất", "Sản xuất nhập kho",
]);

/** Lệch bao nhiêu điểm phần trăm thì mới kêu. Dưới mức này là sai số làm tròn. */
export const NGUONG_LECH = 3;

export type LoaiLoi = "lech" | "thieuSoMa" | "trong" | "hong";

export const NHAN_LOAI: Record<LoaiLoi, string> = {
  lech: "% lệch với số mã",
  thieuSoMa: "Thiếu chi tiết số mã",
  trong: "Chưa nhập %",
  hong: "% nhập sai định dạng",
};

/** Dòng đưa vào để xét. Bên gọi tự rút từ EnrichedItem — module này không biết React. */
export type DongXet = {
  maCT: string;
  duAn: string;
  /** Tên hạng mục/giai đoạn hiển thị. */
  hangMuc: string;
  /** Giai đoạn chuẩn (stage) — dùng để quyết định có xét hay không. */
  giaiDoan: string;
  stt?: string;
  vung?: string;
  pm?: string;
  cum?: string;
  pctActual: number | null;
  pctActualInvalid?: boolean;
  soMa?: readonly { label: string; done: number | null; total: number }[];
};

export type LoiDong = {
  loai: LoaiLoi;
  /** "hong" là sai hẳn, còn lại là cần rà. */
  nang: boolean;
  maCT: string;
  duAn: string;
  hangMuc: string;
  stt?: string;
  vung: string;
  pm: string;
  cum: string;
  /** Câu mô tả ngắn, đọc là hiểu phải làm gì. */
  moTa: string;
  /** Số đang ghi trong file, để người rà biết tìm cái gì. */
  dangGhi: string;
  /** Số theo chi tiết số mã (rỗng khi không có). */
  theoSoMa: string;
};

/** Gộp các dòng số mã của một giai đoạn. Giữ ĐÚNG hai cách tính của app:
 *  · tb   = trung bình % các dòng con (luật gốc: Đặt vật tư = TB của VT.CT và VT.NM)
 *  · gop  = Σ đã làm / Σ tổng
 *  Chỉ kêu lệch khi % người nhập lệch với CẢ HAI — PM nhập theo kiểu nào cũng không bị oan. */
export function gopSoMa(soMa: readonly { label: string; done: number | null; total: number }[]): {
  tongXong: number; tongMa: number; tb: number | null; gop: number | null;
} {
  const dong = soMa.map((c) => ({ xong: c.done ?? 0, tong: c.total, pct: c.total > 0 ? Math.round(((c.done ?? 0) / c.total) * 100) : null }));
  const tongXong = dong.reduce((a, d) => a + d.xong, 0);
  const tongMa = dong.reduce((a, d) => a + d.tong, 0);
  const ps = dong.map((d) => d.pct).filter((v): v is number => v != null);
  return {
    tongXong, tongMa,
    tb: ps.length ? Math.round(ps.reduce((a, b) => a + b, 0) / ps.length) : null,
    gop: tongMa > 0 ? Math.round((tongXong / tongMa) * 100) : null,
  };
}

/** Xét MỘT dòng. `null` = dòng sạch. */
export function xetDong(d: DongXet): LoiDong | null {
  const chung = {
    maCT: d.maCT, duAn: d.duAn, hangMuc: d.hangMuc, stt: d.stt,
    vung: d.vung || "—", pm: d.pm || "—", cum: d.cum || "—",
  };
  const pct = d.pctActual;

  /* Ô % hỏng thì kêu ở MỌI giai đoạn — đây là lỗi gõ, không liên quan tới số mã. */
  if (d.pctActualInvalid) {
    return { ...chung, loai: "hong", nang: true, moTa: "Ô % thực tế nhập không đọc được.", dangGhi: "(không đọc được)", theoSoMa: "" };
  }
  if (!GIAI_DOAN_CO_SO_MA.has(d.giaiDoan)) return null;

  if (pct == null) {
    return { ...chung, loai: "trong", nang: false, moTa: "Giai đoạn này cần số mã nhưng ô % thực tế đang trống.", dangGhi: "(trống)", theoSoMa: "" };
  }
  if (!d.soMa?.length) {
    return { ...chung, loai: "thieuSoMa", nang: false, moTa: "Nhập tay, file không có chi tiết số mã nên không đối chiếu được.", dangGhi: `${pct}%`, theoSoMa: "" };
  }
  const g = gopSoMa(d.soMa);
  const lech = g.tb != null && g.gop != null
    && Math.abs(pct - g.tb) >= NGUONG_LECH && Math.abs(pct - g.gop) >= NGUONG_LECH;
  if (!lech) return null;
  return {
    ...chung, loai: "lech", nang: false,
    moTa: `Ô % ghi ${pct}% nhưng số mã cho ra ${g.gop}%.`,
    dangGhi: `${pct}%`,
    theoSoMa: `${g.tongXong}/${g.tongMa} mã · ${g.gop}%`,
  };
}

/** Quét cả bảng. Giữ nguyên thứ tự đưa vào — bên gọi đã sắp theo ý của bảng. */
export function doLoiDuLieu(ds: readonly DongXet[]): LoiDong[] {
  const ra: LoiDong[] = [];
  for (const d of ds) {
    const l = xetDong(d);
    if (l) ra.push(l);
  }
  return ra;
}

/** Đếm theo loại — cho mấy con số trên đầu bảng. */
export function demTheoLoai(ds: readonly LoiDong[]): Record<LoaiLoi, number> {
  const d: Record<LoaiLoi, number> = { lech: 0, thieuSoMa: 0, trong: 0, hong: 0 };
  for (const l of ds) d[l.loai]++;
  return d;
}

/** Đếm theo một trường để dựng ô lọc (vùng / PM / cụm). Bỏ qua "—". */
export function demTheo(ds: readonly LoiDong[], truong: "vung" | "pm" | "cum"): { ten: string; so: number }[] {
  const m = new Map<string, number>();
  for (const l of ds) {
    const v = l[truong];
    if (!v || v === "—") continue;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()].map(([ten, so]) => ({ ten, so })).sort((a, b) => b.so - a.so || a.ten.localeCompare(b.ten, "vi"));
}

/** Lọc theo bộ lọc đang bật. Nhiều bộ lọc cùng bật thì GIAO NHAU, y như bảng chính. */
export function locLoi(ds: readonly LoiDong[], loc: { loai?: LoaiLoi | ""; vung?: string; pm?: string; cum?: string; tim?: string }): LoiDong[] {
  const t = (loc.tim ?? "").trim().toLowerCase();
  return ds.filter((l) => {
    if (loc.loai && l.loai !== loc.loai) return false;
    if (loc.vung && l.vung !== loc.vung) return false;
    if (loc.pm && l.pm !== loc.pm) return false;
    if (loc.cum && l.cum !== loc.cum) return false;
    if (t && !`${l.maCT} ${l.duAn} ${l.hangMuc}`.toLowerCase().includes(t)) return false;
    return true;
  });
}
