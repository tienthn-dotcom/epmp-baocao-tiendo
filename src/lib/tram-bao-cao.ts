/**
 * TRẠM XUẤT BÁO CÁO — phần ĐẦU NÃO (thuần, không React, không DOM).
 *
 * Anh Tiến 16/10/2026, kèm bản mẫu `1PR_Holiday Inn Ba Na_061026.pdf`:
 * *"tôi muốn xây riêng tính năng xuất báo cáo […] chọn hạng mục báo cáo -> chọn vùng, dự án,…
 * (bộ lọc) […] có thể lựa chọn giữa việc xuất số % hay là xuất số mã cụ thể bên ô bên phải […]
 * xuất ra dạng như template, có logo, đẹp, đầy đủ […] xuất phát là đạt chuẩn chỉ cần đem đi
 * báo cáo luôn"*.
 *
 * ── TÁCH LÀM HAI, CÓ LÝ DO ───────────────────────────────────────────────────────────────────
 * Tệp này CHỈ chọn dòng, gom nhóm, đếm số, rồi trả về một BẢN BÁO CÁO đã xếp sẵn thành ô chữ.
 * Việc vẽ ra PDF nằm ở `tram-bao-cao-pdf.ts`. Nhờ vậy mọi con số in lên bản gửi sếp đều kiểm
 * được bằng test, không phải mở PDF ra soi mắt thường.
 *
 * ── KHÔNG PHÁT MINH LUẬT ────────────────────────────────────────────────────────────────────
 * % lấy thẳng ô "% thực tế" của file nguồn. Số mã lấy thẳng khối breakdown. Trễ hạn lấy thẳng
 * `overdueDays` app đã tính. Chỗ nào file để trống thì bản in để "—", KHÔNG đoán thành 0 —
 * một con số bịa trong bản gửi BOD là kiểu sai không ai bắt được.
 */

/** Một dòng đầu việc đưa vào trạm. Bên gọi tự rút từ EnrichedItem. */
export type DongNguon = {
  maCT: string;
  duAn: string;
  cdt?: string;
  vung: string;
  cum: string;
  pm: string;
  /** Nhãn hạng mục đầy đủ ("Đặt vật tư"). */
  hangMuc: string;
  /** Viết tắt hạng mục ("VT", "TKSX", "GCN"…) — dùng làm cột ở báo cáo tổng hợp. */
  abbr: string;
  pctPlan: number | null;
  pctActual: number | null;
  start: string | null;
  deadline: string | null;
  /** Số ngày trễ (>0 là trễ). null = chưa có mốc. */
  overdueDays: number | null;
  soMa?: readonly { label: string; done: number | null; total: number }[];
  /** Vướng mắc rút gọn — chỉ in ở báo cáo trễ hạn. */
  vuongMac?: string;
};

export type LoaiBaoCao = "hangMuc" | "tongHop" | "treHan";

export const LOAI_META: Record<LoaiBaoCao, { ten: string; moTa: string }> = {
  hangMuc: { ten: "Theo hạng mục", moTa: "Một hạng mục, liệt kê từng dự án: kế hoạch, thực tế, số mã, mốc ngày." },
  tongHop: { ten: "Tổng hợp tiến độ", moTa: "Mỗi dự án một dòng, các hạng mục xếp thành cột." },
  treHan: { ten: "Việc trễ hạn", moTa: "Chỉ những đầu việc đã quá mốc kết thúc, xếp trễ nhiều lên trước." },
};

/** Người dùng chọn in số gì ở cột bên phải. */
export type KieuSo = "pct" | "ma";

export type BoLoc = {
  hangMuc?: string;
  vung?: string;
  cum?: string;
  pm?: string;
  /** Danh sách mã CT được chọn. Rỗng = lấy tất cả. */
  duAn?: readonly string[];
  tim?: string;
};

export type Mau = "ink" | "mute" | "navy" | "do" | "cam" | "luc";

/** Một ô trong bảng của bản in. */
export type O = { t: string; mau?: Mau; dam?: boolean; phai?: boolean };

export type NhomIn = { ten: string; dong: O[][]; tong?: O[] };

export type BanBaoCao = {
  tieuDe: string;
  /** Dòng dưới tiêu đề: đang lọc những gì. */
  phuDe: string;
  kpi: { so: string; nhan: string; mau: Mau }[];
  cot: { ten: string; phai?: boolean; rong: number }[];
  nhom: NhomIn[];
  /** Số dòng thật (không kể dòng tổng) — để báo "không có dòng nào". */
  soDong: number;
  /** Mấy dòng nhận xét tự rút từ chính số liệu. Rỗng thì bản in bỏ hẳn khối này. */
  nhanXet: string[];
};

/* ── TIỆN ÍCH NHỎ ──────────────────────────────────────────────────────────────────────────── */

export const khongDau = (s: string): string =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();

/** "2026-10-16" → "16/10/2026". Ô trống trả "—". */
export function ngayVN(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

/** % in ra bản giấy. null → "—" (KHÔNG hoá thành 0%). */
export const pctVN = (v: number | null | undefined): string =>
  v == null || Number.isNaN(v) ? "—" : `${Math.round(v)}%`;

/** Cộng dồn khối số mã của một dòng. Không có số mã → null. */
export function congSoMa(soMa: DongNguon["soMa"]): { xong: number; tong: number } | null {
  if (!soMa?.length) return null;
  let xong = 0, tong = 0;
  for (const c of soMa) { xong += c.done ?? 0; tong += c.total; }
  return tong > 0 ? { xong, tong } : null;
}

/** "41/50" — ô bên phải khi người dùng chọn in số mã. */
export function soMaGon(soMa: DongNguon["soMa"]): string {
  const g = congSoMa(soMa);
  return g ? `${g.xong}/${g.tong}` : "—";
}

/** Màu của một ô % theo mức độ: xong → lục, trống → xám, còn lại → mực thường. */
function mauPct(v: number | null): Mau {
  if (v == null) return "mute";
  if (v >= 100) return "luc";
  return "ink";
}

/** Ô "trễ": số ngày quá hạn, in đỏ. Chưa trễ thì để gạch ngang cho đỡ rối mắt. */
function oTre(d: number | null): O {
  if (d == null || d <= 0) return { t: "—", mau: "mute", phai: true };
  return { t: `${d}`, mau: "do", dam: true, phai: true };
}

/* ── LỌC ───────────────────────────────────────────────────────────────────────────────────── */

export function locDong(ds: readonly DongNguon[], loc: BoLoc): DongNguon[] {
  const tim = khongDau((loc.tim ?? "").trim());
  const duAn = loc.duAn && loc.duAn.length ? new Set(loc.duAn) : null;
  return ds.filter((d) => {
    if (loc.hangMuc && d.hangMuc !== loc.hangMuc) return false;
    if (loc.vung && d.vung !== loc.vung) return false;
    if (loc.cum && d.cum !== loc.cum) return false;
    if (loc.pm && d.pm !== loc.pm) return false;
    if (duAn && !duAn.has(d.maCT)) return false;
    if (tim && !khongDau(`${d.maCT} ${d.duAn}`).includes(tim)) return false;
    return true;
  });
}

/** Danh sách lựa chọn cho một ô lọc, kèm số dòng — để người chọn biết bấm vào ra bao nhiêu. */
export function dsLoc(
  ds: readonly DongNguon[],
  truong: "hangMuc" | "vung" | "cum" | "pm",
  thuTu?: (a: string, b: string) => number,
): { ten: string; so: number }[] {
  const m = new Map<string, number>();
  for (const d of ds) {
    const v = (d[truong] || "").trim();
    if (!v || v === "—") continue;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  const ra = [...m.entries()].map(([ten, so]) => ({ ten, so }));
  ra.sort(thuTu ? (a, b) => thuTu(a.ten, b.ten) : (a, b) => b.so - a.so || a.ten.localeCompare(b.ten, "vi"));
  return ra;
}

/** Danh sách dự án (mã + tên) có trong tập đang xét, để chọn đích danh. */
export function dsDuAn(ds: readonly DongNguon[]): { maCT: string; duAn: string; vung: string }[] {
  const m = new Map<string, { maCT: string; duAn: string; vung: string }>();
  for (const d of ds) if (!m.has(d.maCT)) m.set(d.maCT, { maCT: d.maCT, duAn: d.duAn, vung: d.vung });
  return [...m.values()].sort((a, b) => a.duAn.localeCompare(b.duAn, "vi"));
}

/* ── ĐẾM SỐ ĐẦU BẢNG ───────────────────────────────────────────────────────────────────────── */

export type TomTat = {
  soDuAn: number;
  soViec: number;
  /** Trung bình % thực tế của các dòng CÓ nhập %. null khi không dòng nào có. */
  pctTB: number | null;
  soXong: number;
  soTre: number;
  maXong: number;
  maTong: number;
};

export function demTomTat(ds: readonly DongNguon[]): TomTat {
  const duAn = new Set<string>();
  let soXong = 0, soTre = 0, maXong = 0, maTong = 0;
  const pcts: number[] = [];
  for (const d of ds) {
    duAn.add(d.maCT);
    if (d.pctActual != null) {
      pcts.push(d.pctActual);
      if (d.pctActual >= 100) soXong++;
    }
    if ((d.overdueDays ?? 0) > 0) soTre++;
    const g = congSoMa(d.soMa);
    if (g) { maXong += g.xong; maTong += g.tong; }
  }
  return {
    soDuAn: duAn.size,
    soViec: ds.length,
    pctTB: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null,
    soXong, soTre, maXong, maTong,
  };
}

/* ── GOM NHÓM THEO VÙNG ────────────────────────────────────────────────────────────────────── */

/** Gom theo vùng rồi theo dự án. `rank` cho phép bên gọi áp thứ tự vùng chuẩn của app. */
export function gomTheoVung(
  ds: readonly DongNguon[],
  rank: (v: string) => number = () => 0,
): { vung: string; dong: DongNguon[] }[] {
  const m = new Map<string, DongNguon[]>();
  for (const d of ds) {
    const v = d.vung || "—";
    const a = m.get(v);
    if (a) a.push(d); else m.set(v, [d]);
  }
  return [...m.entries()]
    .map(([vung, dong]) => ({
      vung,
      dong: [...dong].sort((a, b) => a.duAn.localeCompare(b.duAn, "vi") || a.abbr.localeCompare(b.abbr)),
    }))
    .sort((a, b) => rank(a.vung) - rank(b.vung) || a.vung.localeCompare(b.vung, "vi"));
}

/* ── DỰNG BẢN BÁO CÁO ──────────────────────────────────────────────────────────────────────── */

function kpiChung(t: TomTat, kieu: KieuSo): BanBaoCao["kpi"] {
  const ra: BanBaoCao["kpi"] = [
    { so: `${t.soDuAn}`, nhan: "dự án", mau: "navy" },
    { so: `${t.soViec}`, nhan: "đầu việc", mau: "navy" },
  ];
  if (kieu === "ma" && t.maTong > 0) {
    ra.push({ so: `${t.maXong}/${t.maTong}`, nhan: `mã đã xong (${Math.round((t.maXong / t.maTong) * 100)}%)`, mau: "cam" });
  } else {
    ra.push({ so: pctVN(t.pctTB), nhan: "tiến độ trung bình", mau: "cam" });
  }
  ra.push({ so: `${t.soXong}`, nhan: "đầu việc đã xong", mau: "luc" });
  ra.push({ so: `${t.soTre}`, nhan: "đầu việc trễ hạn", mau: t.soTre > 0 ? "do" : "mute" });
  return ra;
}

function moTaLoc(loc: BoLoc, loai: LoaiBaoCao): string {
  const p: string[] = [];
  if (loai === "hangMuc") p.push(`Hạng mục: ${loc.hangMuc || "tất cả"}`);
  p.push(`Vùng: ${loc.vung || "tất cả"}`);
  if (loc.cum) p.push(`Cụm: ${loc.cum}`);
  if (loc.pm) p.push(`PM: ${loc.pm}`);
  if (loc.duAn?.length) p.push(`${loc.duAn.length} dự án được chọn`);
  if (loc.tim?.trim()) p.push(`Tìm: "${loc.tim.trim()}"`);
  return p.join("  ·  ");
}

/** Mấy câu nhận xét rút THẲNG từ số vừa đếm. Không có gì đáng nói thì trả mảng rỗng —
 *  thà để trống còn hơn in một câu sáo rỗng lên bản gửi sếp. */
function rutNhanXet(ds: readonly DongNguon[], t: TomTat, kieu: KieuSo, loai: LoaiBaoCao): string[] {
  const ra: string[] = [];
  if (t.soViec === 0) return ra;

  const tre = ds.filter((d) => (d.overdueDays ?? 0) > 0).sort((a, b) => (b.overdueDays ?? 0) - (a.overdueDays ?? 0));
  if (tre.length) {
    const n = tre[0];
    /* Bản TRỄ HẠN vốn đã lọc chỉ còn dòng trễ — ghi "176/176 đã quá mốc" là câu thừa, đọc như lỗi. */
    ra.push(loai === "treHan"
      ? `Trễ nhất: ${n.duAn} — ${n.hangMuc}, ${n.overdueDays} ngày. Quá 30 ngày: ${tre.filter((x) => (x.overdueDays ?? 0) > 30).length} đầu việc.`
      : `${tre.length}/${t.soViec} đầu việc đã quá mốc kết thúc. Trễ nhất: ${n.duAn} — ${n.hangMuc}, ${n.overdueDays} ngày.`);
  }

  const chuaChay = ds.filter((d) => d.pctActual != null && d.pctActual === 0);
  if (chuaChay.length) {
    const duAn = new Set(chuaChay.map((d) => d.maCT));
    ra.push(`${chuaChay.length} đầu việc còn ở 0%, thuộc ${duAn.size} dự án.`);
  }

  const thieu = ds.filter((d) => d.pctActual == null);
  if (thieu.length) ra.push(`${thieu.length} đầu việc chưa nhập % thực tế trong file nguồn — số ở bảng để trống, chưa tính vào trung bình.`);

  if (kieu === "ma" && t.maTong > 0) {
    ra.push(`Còn ${t.maTong - t.maXong} mã chưa xong trên tổng ${t.maTong} mã.`);
  } else if (t.pctTB != null) {
    const tb = t.pctTB;
    const duoiTB = ds.filter((d) => d.pctActual != null && d.pctActual < tb).length;
    ra.push(`Tiến độ trung bình ${tb}%; ${duoiTB} đầu việc đang dưới mức này.`);
  }
  return ra;
}

/** Báo cáo THEO HẠNG MỤC — mỗi dòng là một đầu việc, gom theo vùng. */
function dungHangMuc(
  ds: readonly DongNguon[], kieu: KieuSo, rank: (v: string) => number, motHangMuc: boolean,
): Pick<BanBaoCao, "cot" | "nhom"> {
  /* Lọc đúng MỘT hạng mục thì cột "Hạng mục" chép lại tiêu đề ở mọi dòng — bỏ đi, nhường bề
     ngang cho tên dự án và hai cột ngày (để 8 đơn vị thì ngày bị cắt thành "25/06/2…"). */
  const cot: BanBaoCao["cot"] = [
    { ten: "Mã CT", rong: 9 },
    { ten: "Dự án", rong: motHangMuc ? 32 : 24 },
    ...(motHangMuc ? [] : [{ ten: "Hạng mục", rong: 13 }]),
    { ten: "PM", rong: motHangMuc ? 16 : 13 },
    { ten: "Bắt đầu", rong: 10, phai: true },
    { ten: "Kết thúc", rong: 10, phai: true },
    { ten: "Kế hoạch", rong: 9, phai: true },
    { ten: kieu === "ma" ? "Số mã" : "Thực tế", rong: 9, phai: true },
    { ten: "Trễ", rong: 6, phai: true },
  ];
  const nhom = gomTheoVung(ds, rank).map(({ vung, dong }) => {
    const t = demTomTat(dong);
    return {
      ten: `${vung} — ${t.soDuAn} dự án, ${t.soViec} đầu việc`,
      dong: dong.map((d): O[] => [
        { t: d.maCT, mau: "mute" },
        { t: d.duAn, dam: true },
        ...(motHangMuc ? [] : [{ t: d.hangMuc, mau: "mute" } as O]),
        { t: d.pm || "—", mau: "mute" },
        { t: ngayVN(d.start), mau: "mute", phai: true },
        { t: ngayVN(d.deadline), mau: "mute", phai: true },
        { t: pctVN(d.pctPlan), mau: "mute", phai: true },
        kieu === "ma"
          ? { t: soMaGon(d.soMa), dam: true, phai: true, mau: d.soMa?.length ? "ink" : "mute" }
          : { t: pctVN(d.pctActual), dam: true, phai: true, mau: mauPct(d.pctActual) },
        oTre(d.overdueDays),
      ]),
      tong: [
        { t: "Cộng", dam: true },
        ...Array.from({ length: motHangMuc ? 4 : 5 }, (): O => ({ t: "" })),
        { t: "", phai: true },
        kieu === "ma"
          ? { t: t.maTong > 0 ? `${t.maXong}/${t.maTong}` : "—", dam: true, phai: true }
          : { t: pctVN(t.pctTB), dam: true, phai: true },
        { t: t.soTre ? `${t.soTre}` : "—", dam: true, phai: true, mau: t.soTre ? "do" : "mute" },
      ] as O[],
    };
  });
  return { cot, nhom };
}

/** Báo cáo TỔNG HỢP — mỗi dự án một dòng, hạng mục xếp thành cột theo `thuTuAbbr`. */
function dungTongHop(
  ds: readonly DongNguon[],
  kieu: KieuSo,
  rank: (v: string) => number,
  thuTuAbbr: readonly string[],
): Pick<BanBaoCao, "cot" | "nhom"> {
  const coAbbr = thuTuAbbr.filter((a) => ds.some((d) => d.abbr === a));
  const cot: BanBaoCao["cot"] = [
    { ten: "Mã CT", rong: 9 },
    { ten: "Dự án", rong: 24 },
    { ten: "PM", rong: 11 },
    /* 8 đơn vị cho mỗi hạng mục: ô kiểu "41/50" cần ~45px, để 6 là cắt mất chữ số. */
    ...coAbbr.map((a) => ({ ten: a, rong: 8, phai: true })),
    { ten: "Trễ", rong: 5, phai: true },
  ];
  const nhom = gomTheoVung(ds, rank).map(({ vung, dong }) => {
    const theoDuAn = new Map<string, DongNguon[]>();
    for (const d of dong) {
      const a = theoDuAn.get(d.maCT);
      if (a) a.push(d); else theoDuAn.set(d.maCT, [d]);
    }
    const hang = [...theoDuAn.values()].sort((a, b) => a[0].duAn.localeCompare(b[0].duAn, "vi"));
    return {
      ten: `${vung} — ${hang.length} dự án`,
      dong: hang.map((viec): O[] => {
        const d0 = viec[0];
        const tre = viec.reduce((a, v) => a + ((v.overdueDays ?? 0) > 0 ? 1 : 0), 0);
        const o: O[] = [{ t: d0.maCT, mau: "mute" }, { t: d0.duAn, dam: true }, { t: d0.pm || "—", mau: "mute" }];
        for (const a of coAbbr) {
          const v = viec.filter((x) => x.abbr === a);
          if (!v.length) { o.push({ t: "", mau: "mute", phai: true }); continue; }
          if (kieu === "ma") {
            const g = v.map((x) => congSoMa(x.soMa)).filter((x): x is { xong: number; tong: number } => !!x);
            o.push(g.length
              ? { t: `${g.reduce((s, x) => s + x.xong, 0)}/${g.reduce((s, x) => s + x.tong, 0)}`, phai: true, dam: true }
              : { t: "—", mau: "mute", phai: true });
          } else {
            const ps = v.map((x) => x.pctActual).filter((x): x is number => x != null);
            const tb = ps.length ? Math.round(ps.reduce((s, x) => s + x, 0) / ps.length) : null;
            o.push({ t: pctVN(tb), phai: true, dam: true, mau: mauPct(tb) });
          }
        }
        o.push(tre ? { t: `${tre}`, mau: "do", dam: true, phai: true } : { t: "—", mau: "mute", phai: true });
        return o;
      }),
    };
  });
  return { cot, nhom };
}

/** Báo cáo TRỄ HẠN — chỉ dòng quá mốc, trễ nhiều lên trước, kèm vướng mắc. */
function dungTreHan(ds: readonly DongNguon[], rank: (v: string) => number): Pick<BanBaoCao, "cot" | "nhom"> {
  const cot: BanBaoCao["cot"] = [
    { ten: "Mã CT", rong: 9 },
    { ten: "Dự án", rong: 22 },
    { ten: "Hạng mục", rong: 12 },
    { ten: "PM", rong: 11 },
    { ten: "Kết thúc", rong: 10, phai: true },
    { ten: "Trễ (ngày)", rong: 8, phai: true },
    { ten: "Thực tế", rong: 8, phai: true },
    { ten: "Vướng mắc", rong: 20 },
  ];
  const nhom = gomTheoVung(ds, rank).map(({ vung, dong }) => {
    const xep = [...dong].sort((a, b) => (b.overdueDays ?? 0) - (a.overdueDays ?? 0));
    return {
      ten: `${vung} — ${xep.length} đầu việc trễ`,
      dong: xep.map((d): O[] => [
        { t: d.maCT, mau: "mute" },
        { t: d.duAn, dam: true },
        { t: d.hangMuc, mau: "mute" },
        { t: d.pm || "—", mau: "mute" },
        { t: ngayVN(d.deadline), mau: "mute", phai: true },
        oTre(d.overdueDays),
        { t: pctVN(d.pctActual), dam: true, phai: true, mau: mauPct(d.pctActual) },
        { t: d.vuongMac || "—", mau: d.vuongMac ? "ink" : "mute" },
      ]),
    };
  });
  return { cot, nhom };
}

export type ThamSo = {
  loai: LoaiBaoCao;
  kieu: KieuSo;
  loc: BoLoc;
  /** Thứ tự vùng của app (vungRank). */
  rank?: (v: string) => number;
  /** Thứ tự viết tắt hạng mục của app (STAGE_ABBR_ORDER) — chỉ dùng cho bản tổng hợp. */
  thuTuAbbr?: readonly string[];
};

export function dungBaoCao(ds: readonly DongNguon[], ts: ThamSo): BanBaoCao {
  const rank = ts.rank ?? (() => 0);
  let loc = locDong(ds, ts.loc);
  if (ts.loai === "treHan") loc = loc.filter((d) => (d.overdueDays ?? 0) > 0);

  const t = demTomTat(loc);
  const than =
    ts.loai === "tongHop" ? dungTongHop(loc, ts.kieu, rank, ts.thuTuAbbr ?? [])
      : ts.loai === "treHan" ? dungTreHan(loc, rank)
        : dungHangMuc(loc, ts.kieu, rank, !!ts.loc.hangMuc);

  const tieuDe =
    ts.loai === "tongHop" ? "BÁO CÁO TỔNG HỢP TIẾN ĐỘ"
      : ts.loai === "treHan" ? "BÁO CÁO ĐẦU VIỆC TRỄ HẠN"
        : `BÁO CÁO HẠNG MỤC: ${(ts.loc.hangMuc || "TẤT CẢ HẠNG MỤC").toUpperCase()}`;

  return {
    tieuDe,
    phuDe: moTaLoc(ts.loc, ts.loai),
    kpi: kpiChung(t, ts.kieu),
    ...than,
    soDong: loc.length,
    nhanXet: rutNhanXet(loc, t, ts.kieu, ts.loai),
  };
}

/** Tên tệp PDF — bỏ ký tự Windows không nhận, không để dài quá. */
export function tenTep(ban: BanBaoCao, ngay = new Date()): string {
  const dd = String(ngay.getDate()).padStart(2, "0");
  const mm = String(ngay.getMonth() + 1).padStart(2, "0");
  const goc = khongDau(ban.tieuDe).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return `${goc || "bao_cao"}_${dd}${mm}${ngay.getFullYear()}.pdf`;
}
