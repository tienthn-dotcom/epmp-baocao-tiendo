/**
 * CỬA ĐỌC DỮ LIỆU CHO AGENT NGOÀI — phần LUẬT (module thuần, không DOM, không React).
 *
 * Anh Tiến 20/10/2026: sếp muốn một AI agent ở tài khoản khác lấy được số của ePMP để làm báo cáo.
 * Agent KHÔNG đăng nhập Google được, nên không đi cửa người dùng. Cửa này nhận token riêng, trả
 * JSON thuần, chỉ ĐỌC.
 *
 * ── VÌ SAO KHÔNG ĐỌC THẲNG FILE NGUỒN TRONG WORKER ──────────────────────────────────────────
 * Đo ngày 20/10/2026 trên chính file Master Plan đang chạy: tải 0,92 MB mất 1.950 ms, rồi
 * `XLSX.read` ngốn thêm 1.027 ms CPU — mà đó là trên máy để bàn, Worker còn chậm hơn. Gói
 * Cloudflare Free cho 2 giây CPU mỗi lượt. Parse trong Worker là chết chắc (đúng vết xe OOM 1102
 * mà `etl.ts` đã ghi lại).
 *
 * Nên theo đúng khuôn `etl.ts` đã chốt: CLIENT parse (nó vốn đã parse để vẽ bảng) rồi đẩy một
 * BẢN CHỤP gọn vào KV; cửa này chỉ đọc KV ra, không tính lại gì. Đổi lại, số ở đây mới tới lần
 * cuối có người mở app — `luc` trong mỗi câu trả lời nói rõ mốc đó, agent phải đọc và nói ra,
 * đừng để sếp tưởng là số thời gian thực.
 */

/** Một đầu việc đã chuẩn hoá — y hệt thứ bảng chính đang bày, chỉ đổi sang tên trường tiếng Việt. */
export type DongEpmp = {
  maCT: string;
  duAn: string;
  vung: string;
  cum: string;
  pm: string;
  hangMuc: string;
  /** Viết tắt hạng mục: TK · BG · MA · VT · SD · TKSX · GCN · SX · TC. */
  abbr: string;
  nguoiPhuTrach: string;
  batDau: string | null;
  ketThuc: string | null;
  pctKeHoach: number | null;
  pctThucTe: number | null;
  /** > 0 là đã quá mốc kết thúc. null = chưa có mốc. */
  soNgayTre: number | null;
  /** late = trễ tiến độ · trim = cần cắt đầu việc · focus = cần tập trung · none = không cảnh báo. */
  canhBao: "late" | "trim" | "focus" | "none";
  vuongMac: string;
  giaiPhap: string;
  soMa?: { nhan: string; xong: number | null; tong: number }[];
};

export type AnhChupEpmp = {
  v: 1;
  /** Lúc CLIENT chụp (ISO). Đây là tuổi thật của số, không phải lúc agent gọi. */
  luc: string;
  nguon: string;
  /** Vân tay của nguồn — chỉ ghi đè KV khi vân tay đổi, để không đốt hạn mức ghi KV. */
  vanTay: string;
  dong: DongEpmp[];
};

export const NHAN_CANH_BAO: Record<DongEpmp["canhBao"], string> = {
  late: "Trễ tiến độ",
  trim: "Cần cắt đầu việc",
  focus: "Cần tập trung",
  none: "Không cảnh báo",
};

/* ── LỌC ───────────────────────────────────────────────────────────────────────────────────── */

export type BoLocApi = {
  vung?: string; pm?: string; maCT?: string; hangMuc?: string;
  canhBao?: DongEpmp["canhBao"];
  /** Chỉ lấy dòng đã quá mốc kết thúc. */
  chiTre?: boolean;
};

const khongDau = (s: string) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().trim();
const khop = (a: string | undefined, b: string) => !a || khongDau(a) === khongDau(b);

export function locDong(ds: readonly DongEpmp[], loc: BoLocApi = {}): DongEpmp[] {
  return ds.filter((d) =>
    khop(loc.vung, d.vung) && khop(loc.pm, d.pm) && khop(loc.maCT, d.maCT)
    && khop(loc.hangMuc, d.hangMuc)
    && (!loc.canhBao || d.canhBao === loc.canhBao)
    && (!loc.chiTre || (d.soNgayTre ?? 0) > 0));
}

/* ── GOM SỐ ────────────────────────────────────────────────────────────────────────────────── */

export type TomTatDuAn = {
  maCT: string; duAn: string; vung: string; pm: string;
  soDauViec: number; soTre: number; treNhat: number | null;
  pctTrungBinh: number | null;
};

/** Gom theo DỰ ÁN. Trung bình chỉ tính dòng CÓ nhập % — dòng trống không được kéo số xuống. */
export function tomTatTheoDuAn(ds: readonly DongEpmp[]): TomTatDuAn[] {
  const m = new Map<string, DongEpmp[]>();
  for (const d of ds) { const a = m.get(d.maCT); if (a) a.push(d); else m.set(d.maCT, [d]); }
  return [...m.values()].map((g) => {
    const ps = g.map((x) => x.pctThucTe).filter((v): v is number => v != null);
    const tre = g.map((x) => x.soNgayTre ?? 0).filter((v) => v > 0);
    return {
      maCT: g[0].maCT, duAn: g[0].duAn, vung: g[0].vung, pm: g[0].pm,
      soDauViec: g.length,
      soTre: tre.length,
      treNhat: tre.length ? Math.max(...tre) : null,
      pctTrungBinh: ps.length ? Math.round(ps.reduce((a, b) => a + b, 0) / ps.length) : null,
    };
  }).sort((a, b) => b.soTre - a.soTre || a.duAn.localeCompare(b.duAn, "vi"));
}

export type NhomCanhBao = { ma: DongEpmp["canhBao"]; nhan: string; so: number; duAn: number };

/** Đếm theo nhóm cảnh báo — đúng ba nhóm bảng chính đang dùng, bỏ nhóm "none". */
export function demCanhBao(ds: readonly DongEpmp[]): NhomCanhBao[] {
  return (["late", "trim", "focus"] as const).map((ma) => {
    const g = ds.filter((d) => d.canhBao === ma);
    return { ma, nhan: NHAN_CANH_BAO[ma], so: g.length, duAn: new Set(g.map((d) => d.maCT)).size };
  });
}

/** Đếm theo một trường để agent biết có những giá trị nào mà lọc (vùng / PM / hạng mục). */
export function demTheo(ds: readonly DongEpmp[], truong: "vung" | "pm" | "hangMuc" | "cum"): { ten: string; so: number }[] {
  const m = new Map<string, number>();
  for (const d of ds) { const v = (d[truong] || "").trim(); if (v) m.set(v, (m.get(v) ?? 0) + 1); }
  return [...m.entries()].map(([ten, so]) => ({ ten, so })).sort((a, b) => b.so - a.so || a.ten.localeCompare(b.ten, "vi"));
}

/* ── VÂN TAY ───────────────────────────────────────────────────────────────────────────────── */

/** Vân tay rẻ của một bản chụp: số dòng + tổng các số hay đổi. Dùng để KHỎI ghi KV khi không có
 *  gì mới — hạn mức gói Free là 1.000 lượt ghi/ngày cho CẢ app, mà 10-17 người mở mỗi ngày. */
export function vanTayCua(ds: readonly DongEpmp[]): string {
  let a = 0, b = 0;
  for (const d of ds) {
    a = (a + (d.pctThucTe ?? -1) + (d.soNgayTre ?? 0) * 7) % 2147483647;
    b = (b + d.maCT.length + d.hangMuc.length + (d.ketThuc ? d.ketThuc.length : 0)) % 2147483647;
  }
  return `${ds.length}-${a}-${b}`;
}
