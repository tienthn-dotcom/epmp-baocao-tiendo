/**
 * THEO DÕI LẮP ĐẶT — BẢN THỬ (chỉ admin thấy, đang phát triển).
 *
 * KHÁC BẢN ĐANG CHẠY ở chỗ: không bày lại bảng gốc của từng dự án ra trang tổng. Mỗi dự án một kiểu
 * bảng, xếp cạnh nhau thì mỗi ô nói một thứ tiếng, không so được với nhau. Ở đây RÚT SỐ ra khỏi bảng
 * rồi dựng dashboard trên số đó:
 *
 *   1. Rút  — đọc tab dự án đang gắn, lấy % thực tế / % kế hoạch / cảnh báo theo từng khu.
 *   2. Cất  — mỗi ngày ghi một mốc vào kho (D1, bảng `lapdat_moc`); ghi rồi thì thôi, không ghi lại.
 *   3. Vẽ   — số tổng và đường tiến độ đọc từ KHO, không mở lại file gốc.
 *
 * Nhờ bước 2 mà có thứ bảng gốc không có: hôm qua so với hôm nay, và đường tiến độ theo thời gian.
 * Dự án nào không rút được số thì nạp bằng CSV (cùng bộ cột với bảng SQL) — xem panel "Kho số".
 *
 * Bấm vào thẻ vẫn mở bảng gốc, heatmap và mã màu giữ nguyên.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Database, X } from "lucide-react";
import { getInstallList, getSummaryFile } from "@/lib/mtld-install.functions";
import { docBaoCao, docBangPct, tomTat, tomTatBangPct, doanNhom, type O, type TomTat } from "@/lib/mtld-baocao";
import { docTrangThaiPhong, congTrangThai, type TrangThaiPhong } from "@/lib/mtld-trangthai";
import { luuMocKho, docKho, napCsvKho, xuatCsvKho } from "@/lib/lapdat-kho.functions";
import { duongNgay, moiNhatTheoDuAn, tongQuan, SQL_TAO_BANG, COT_KHO, type MocKho } from "@/lib/lapdat-kho";
import { MatrixFormEditor } from "@/lib/matrix-form-editor";
import { useIsMobile } from "@/lib/use-breakpoint";
import { track } from "@/lib/track";

const T = {
  bg: "#0a0e15", side: "#10151e", panel: "#131a26", line: "#232c3d",
  ink: "#e7ebf3", soft: "#a3adc2", faint: "#6b7488",
  xanh: "#35c281", vang: "#e0b13a", do: "#e0574a", accent: "#5b8cff",
};

const CUNG_LUC = 4;    // số dự án đọc file cùng lúc — nhiều hơn thì nghẽn, ít hơn thì chờ lâu
const DOT_DAU = 12;    // số thẻ rút số ngay khi mở; phần còn lại chờ cuộn tới

type Proj = {
  fileId: string; gid?: string; name: string; maCT: string; hid?: string;
  region?: string; groupDA?: string;
  sheet?: string; range?: string; tl?: string; br?: string; formKey?: string; chart?: boolean; noMx?: boolean;
};
const pid = (p: Proj) => `${p.fileId}|${p.gid || ""}|${p.formKey || ""}`;

/** Cùng khoá localStorage app MTLĐ đang dùng — máy đã mở Dashboard thì vào đây có danh sách ngay. */
const LS_KEY = "mtld:install:v2";
function docLs(): Proj[] {
  try { const l = JSON.parse(localStorage.getItem(LS_KEY) || "[]"); return Array.isArray(l) ? (l as Proj[]) : []; }
  catch { return []; }
}

const homNay = () => new Date().toISOString().slice(0, 10);
const p100 = (v: number | null | undefined): number | null => (v == null ? null : Math.round(v * 1000) / 10);

type So = { tt?: TomTat; phong?: TrangThaiPhong; nhom: "public" | "rooms"; tieuDe: string; loi?: string };

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

/**
 * Rút số của MỘT dự án rồi cất mốc hôm nay vào kho.
 * Tải bằng ĐÚNG cách popup đang tải (theo tên tab, không theo gid): vài dự án khai gid trỏ tab khác
 * với tab đã chọn, bám tên tab thì thẻ và bảng gốc luôn cùng một nguồn, lại xài chung cache nên
 * không tốn thêm lượt đọc.
 */
async function docSo(p: Proj): Promise<So> {
  const doan = doanNhom("", p.sheet || "", p.name);
  const r = await getSummaryFile({ data: { fileId: p.fileId, sheet: p.sheet || undefined } });
  if (!r?.b64) return { nhom: doan, tieuDe: "", loi: "không tải được file" };
  const XLSX = await import("xlsx");
  const wb = XLSX.read(b64ToBuf(r.b64), { type: "array", cellDates: true });
  const ten = p.sheet && wb.SheetNames.includes(p.sheet) ? p.sheet : wb.SheetNames[0];
  const sh = wb.Sheets[ten];
  if (!sh) return { nhom: doan, tieuDe: "", loi: "không thấy tab đã khai" };
  /* Bù cột trống ở đầu: sheet_to_json bắt đầu từ ô đầu của vùng dữ liệu (có file là B1), trong khi
     toạ độ merge là TUYỆT ĐỐI. Không bù thì tra merge lệch nguyên một cột. */
  const goc = XLSX.utils.decode_range(sh["!ref"] ?? "A1").s.c;
  const rows = (XLSX.utils.sheet_to_json<O[]>(sh, { header: 1, defval: null, blankrows: true }) as O[][])
    .map((r) => (goc ? (Array(goc).fill(null) as O[]).concat(r ?? []) : (r ?? [])));
  const ngay = homNay();

  // Dạng 1 — bảng "BÁO CÁO % HOÀN THÀNH": có kế hoạch, có cảnh báo, đủ để nói trễ hay không.
  const bc = docBaoCao(rows, p.maCT);
  if (bc.ok) {
    const nhom = doanNhom(bc.tieuDe, ten, p.name);
    void catMoc(bc.khu.map((k) => ({
      ngay, maCT: p.maCT, duAn: p.name, khu: k.khu, scope: nhom,
      pctThuc: p100(k.pctThuc), pctDuKien: p100(k.pctDuKien), pctHomTruoc: p100(k.pctHomTruoc),
      chenhLech: p100(k.chenhLech), tangNgay: p100(k.tangTrongNgay),
      canhBao: k.canhBao, ngayBanGiao: k.ngayBanGiao ?? "", soNgayConLai: k.soNgayConLai,
      nguon: "bang",
    })));
    return { tt: tomTat(bc.khu), nhom, tieuDe: bc.tieuDe };
  }

  /* Dạng 2 — KHỐI PHÒNG: không phải bảng phần trăm mà là BẢNG ĐẾM CĂN theo bốn chặng bàn giao
     (giao thô → giao tinh → xoá list Defect → bàn giao vận hành). Thử trước dạng phần trăm chung
     vì nó đặc thù hơn: đòi đúng dòng "Lũy kế" và nhãn chặng. */
  const tp = docTrangThaiPhong(rows, (sh["!merges"] ?? []) as never[]);
  if (tp.ok) return { phong: tp.tt, nhom: "rooms", tieuDe: "" };

  // Dạng 3 — ma trận chỉ có cột "% THỰC HIỆN": không có kế hoạch, chỉ cất được % thực tế.
  const bp = docBangPct(rows);
  if (bp.ok) {
    const nhom = doanNhom("", ten, p.name);
    void catMoc(bp.dong.map((d) => ({
      ngay, maCT: p.maCT, duAn: p.name, khu: d.ten, scope: nhom,
      pctThuc: p100(d.pct), pctDuKien: null, pctHomTruoc: null, chenhLech: null, tangNgay: null,
      canhBao: "", ngayBanGiao: "", soNgayConLai: null, nguon: "matran",
    })));
    return { tt: tomTatBangPct(bp.dong), nhom, tieuDe: "" };
  }

  return { nhom: doan, tieuDe: "", loi: bp.loi };
}

/** Cất mốc vào kho. Hỏng thì thôi — kho là thứ cộng thêm, không được làm chết màn hình đang xem. */
async function catMoc(rows: MocKho[]): Promise<void> {
  if (!rows.length) return;
  try { await luuMocKho({ data: { rows } }); } catch { /* kho lỗi → bỏ qua */ }
}

/* ── mấy mảnh nhỏ dùng lại ──────────────────────────────────────────────────────────────────── */

/** Màu theo mức TRỄ so với kế hoạch, không theo % tuyệt đối: dự án mới chạy 10% mà đúng kế hoạch thì
 *  không có gì đáng báo động, còn 90% mà trễ 20% thì có. */
const mauTheoTre = (chenh: number | null | undefined): string =>
  chenh == null ? T.faint : chenh >= -1 ? T.xanh : chenh >= -10 ? T.vang : T.do;
/** Bảng ma trận không có cột kế hoạch → không nói được trễ hay không, đành tô theo % tuyệt đối. */
const mauTheoPct = (v: number | null | undefined): string =>
  v == null ? T.faint : v >= 95 ? T.xanh : v >= 60 ? T.vang : T.do;
const mauThe = (tt?: TomTat): string =>
  tt?.chenhLech != null ? mauTheoTre(tt.chenhLech) : mauTheoPct(tt?.pctThuc);

const sos = (v: number | null | undefined, hau = "%"): string =>
  v == null ? "—" : `${Math.round(v * 10) / 10}${hau}`.replace(".", ",");
const ngayNgan = (s: string) => (s.length >= 10 ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : s);

/** Thanh % thực tế, có VẠCH kế hoạch — nhìn phát biết đang trước hay sau kế hoạch. */
function Thanh({ thuc, keHoach, mau }: { thuc: number | null; keHoach: number | null; mau: string }) {
  const t = Math.max(0, Math.min(100, thuc ?? 0));
  const k = keHoach == null ? null : Math.max(0, Math.min(100, keHoach));
  return (
    <div style={{ position: "relative", height: 7, borderRadius: 4, background: "#1b2333", overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${t}%`, background: mau, borderRadius: 4 }} />
      {k != null && (
        <span title={`Kế hoạch ${sos(k)}`}
          style={{ position: "absolute", top: -1, bottom: -1, left: `calc(${k}% - 1px)`, width: 2, background: "#e7ebf3", opacity: .75 }} />
      )}
    </div>
  );
}

function Chip({ n, nhan, mau }: { n: number; nhan: string; mau: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, border: `1px solid ${T.line}`, borderRadius: 999, padding: "2px 8px", color: T.soft }}>
      <b style={{ color: mau }}>{n}</b>{nhan}
    </span>
  );
}

/** Một con số nhỏ trong dòng tóm tắt — dùng thay cho thẻ to khi số đó chỉ để liếc qua. */
function SoNho({ nhan, gt, mau }: { nhan: string; gt: string; mau?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5 }}>
      <span style={{ fontSize: 10.5, color: T.faint, textTransform: "uppercase", letterSpacing: ".05em" }}>{nhan}</span>
      <b style={{ fontSize: 14, color: mau ?? T.ink }}>{gt}</b>
    </span>
  );
}

/** Bốn thẻ KPI khối phòng — đúng bốn chặng PMO chốt. "Ra list Defect" là chặng trung gian, chỉ
 *  hiện trong phễu của từng dự án chứ không lên thẻ tổng. */
const THE_KPI = [
  { nhan: "đã giao thô", mau: "#5b8cff", lay: (t: TrangThaiPhong) => t.giaoTho },
  { nhan: "đã giao tinh", mau: "#35c281", lay: (t: TrangThaiPhong) => t.giaoTinh },
  { nhan: "đã xoá defect", mau: "#e0b13a", lay: (t: TrangThaiPhong) => t.xoaDefect },
  { nhan: "đã giao vận hành", mau: "#c07ce0", lay: (t: TrangThaiPhong) => t.giaoVanHanh },
] as const;

function O1({ nhan, so, mau, phu }: { nhan: string; so: string; mau?: string; phu?: string }) {
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 10, padding: "10px 13px", minWidth: 128 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".07em", color: T.faint, textTransform: "uppercase" }}>{nhan}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: mau ?? T.ink, lineHeight: 1.25, marginTop: 3 }}>{so}</div>
      {phu && <div style={{ fontSize: 10.5, color: T.faint, marginTop: 1 }}>{phu}</div>}
    </div>
  );
}

/* ── ĐƯỜNG TIẾN ĐỘ (từ kho) ─────────────────────────────────────────────────────────────────── */

/**
 * Hai đường: thực tế và kế hoạch, trục dọc ghim 0..100 để hình dạng đường không đổi theo dữ liệu.
 * Vẽ tay bằng SVG — kéo cả thư viện chart về chỉ để vẽ hai nét là không đáng.
 */
function DuongTienDo({ diem, narrow }: { diem: { ngay: string; thuc: number | null; keHoach: number | null }[]; narrow: boolean }) {
  const W = 600, H = narrow ? 120 : 150, L = 4;
  if (diem.length < 2) {
    return (
      <div style={{ padding: "22px 14px", fontSize: 12, color: T.faint, lineHeight: 1.6 }}>
        Kho mới có {diem.length === 1 ? "một ngày" : "chưa có ngày nào"}. Mỗi ngày mở app một lần là kho tự dày thêm, vài ngày nữa sẽ có đường.
      </div>
    );
  }
  const x = (i: number) => (i / (diem.length - 1)) * (W - L * 2) + L;
  const y = (v: number) => H - L - (v / 100) * (H - L * 2);
  const net = (lay: (d: typeof diem[number]) => number | null): string => {
    const ps: string[] = [];
    diem.forEach((d, i) => { const v = lay(d); if (v != null) ps.push(`${x(i)},${y(v)}`); });
    return ps.join(" ");
  };
  const thuc = net((d) => d.thuc), kh = net((d) => d.keHoach);
  return (
    <div>
      {/* Nhãn trục dọc để ngoài SVG: svg đang kéo giãn theo bề ngang (preserveAspectRatio="none")
          nên chữ vẽ bên trong sẽ bị méo. */}
      <div style={{ display: "flex", gap: 7 }}>
        <div style={{ width: 24, height: H, position: "relative", flexShrink: 0, fontSize: 9.5, color: T.faint }}>
          {[100, 50, 0].map((v, i) => (
            <span key={v} style={{ position: "absolute", right: 0, top: `calc(${i * 50}% - ${i === 0 ? 0 : i === 1 ? 5 : 10}px)` }}>{v}%</span>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block", width: "100%", height: H }} role="img" aria-label="Đường tiến độ thực tế so với kế hoạch">
        {[0, 25, 50, 75, 100].map((g) => (
          <line key={g} x1={0} x2={W} y1={y(g)} y2={y(g)} stroke={T.line} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {kh && <polyline points={kh} fill="none" stroke={T.soft} strokeWidth={1.5} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
        {thuc && <polyline points={thuc} fill="none" stroke={T.accent} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: T.faint, marginTop: 4 }}>
        <span>{ngayNgan(diem[0].ngay)}</span>
        <span style={{ display: "inline-flex", gap: 12 }}>
          <span><span style={{ display: "inline-block", width: 10, height: 2, background: T.accent, verticalAlign: "middle", marginRight: 4 }} />thực tế</span>
          <span><span style={{ display: "inline-block", width: 10, height: 2, background: T.soft, verticalAlign: "middle", marginRight: 4 }} />kế hoạch</span>
        </span>
        <span>{ngayNgan(diem[diem.length - 1].ngay)}</span>
      </div>
        </div>
      </div>
    </div>
  );
}

/* ── THẺ DỰ ÁN ──────────────────────────────────────────────────────────────────────────────── */

/** Bốn chặng bàn giao, vẽ thành một thanh phễu: chặng sau luôn nằm gọn trong chặng trước. */
const CHANG_MAU = [
  { lay: (t: TrangThaiPhong) => t.giaoTho, ten: "thô", mau: "#5b8cff" },
  { lay: (t: TrangThaiPhong) => t.giaoTinh, ten: "tinh", mau: "#35c281" },
  { lay: (t: TrangThaiPhong) => t.raDefect, ten: "ra defect", mau: "#8a94ab" },
  { lay: (t: TrangThaiPhong) => t.xoaDefect, ten: "xoá defect", mau: "#e0b13a" },
  { lay: (t: TrangThaiPhong) => t.giaoVanHanh, ten: "vận hành", mau: "#c07ce0" },
] as const;

function PheuPhong({ t }: { t: TrangThaiPhong }) {
  const tong = t.tongCan || 0;
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {CHANG_MAU.map((c) => {
          const v = c.lay(t);
          return (
            <div key={c.ten} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontSize: 10, color: T.faint, width: 62, flexShrink: 0 }}>{c.ten}</span>
              <div style={{ flex: 1, height: 6, borderRadius: 3, background: "#1b2333", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${tong && v != null ? Math.min(100, (v / tong) * 100) : 0}%`, background: c.mau, borderRadius: 3 }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: v == null ? T.faint : T.ink, width: 34, textAlign: "right", flexShrink: 0 }}>
                {v == null ? "—" : v}
              </span>
            </div>
          );
        })}
      </div>
      {t.thieuNhan.length > 0 && (
        <div style={{ fontSize: 10.5, color: T.vang, lineHeight: 1.45 }}>
          file chưa ghi nhãn: {t.thieuNhan.join(" · ")}
        </div>
      )}
    </>
  );
}

function The({ p, so, dangDoc, onMo }: { p: Proj; so?: So; dangDoc: boolean; onMo: () => void }) {
  const tt = so?.tt;
  const mau = mauThe(tt);
  return (
    <button type="button" onClick={onMo} title="Bấm để xem bảng gốc"
      style={{
        textAlign: "left", background: T.panel, border: `1px solid ${T.line}`, borderRadius: 12,
        padding: 13, cursor: "pointer", display: "flex", flexDirection: "column", gap: 9, minHeight: 156, color: T.ink,
      }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {p.name || p.maCT}
          </div>
          <div style={{ fontSize: 10.5, color: T.faint, fontFamily: "ui-monospace,monospace", marginTop: 3 }}>
            {p.maCT}{p.region ? ` · ${p.region}` : ""}
          </div>
        </div>
        <div style={{ fontSize: 21, fontWeight: 800, color: so?.phong ? T.ink : mau, lineHeight: 1, whiteSpace: "nowrap" }}>
          {dangDoc ? "…" : so?.phong ? (so.phong.tongCan ?? "—") : tt?.pctThuc == null ? "—" : sos(tt.pctThuc)}
        </div>
      </div>

      {dangDoc ? (
        <div style={{ fontSize: 11.5, color: T.faint }}>đang đọc bảng…</div>
      ) : so?.loi ? (
        <div style={{ fontSize: 11.5, color: T.vang, lineHeight: 1.5 }}>{so.loi} — bấm để mở bảng gốc</div>
      ) : so?.phong ? (
        <>
          <div style={{ fontSize: 11.5, color: T.soft, marginTop: -3 }}>căn · theo chặng bàn giao</div>
          <PheuPhong t={so.phong} />
        </>
      ) : tt ? (
        <>
          <Thanh thuc={tt.pctThuc} keHoach={tt.pctDuKien} mau={mau} />
          {tt.pctDuKien != null ? (
            <div style={{ fontSize: 12, color: T.soft }}>
              kế hoạch {sos(tt.pctDuKien)}
              {tt.chenhLech != null && (
                <b style={{ color: mau, marginLeft: 6 }}>
                  {tt.chenhLech >= -1 ? "đúng kế hoạch" : `trễ ${sos(Math.abs(tt.chenhLech))}`}
                </b>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: T.faint }}>bảng không có cột kế hoạch</div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, fontSize: 10.5 }}>
            <Chip n={tt.soKhu} nhan="khu" mau={T.faint} />
            {tt.dat > 0 && <Chip n={tt.dat} nhan="đạt" mau={T.xanh} />}
            {tt.chamNhe > 0 && <Chip n={tt.chamNhe} nhan="chậm nhẹ" mau={T.vang} />}
            {tt.baoDong > 0 && <Chip n={tt.baoDong} nhan="báo động" mau={T.do} />}
          </div>
          {(tt.tangHomNay != null || tt.soNgayConLai != null) && (
            <div style={{ fontSize: 11, color: T.faint, lineHeight: 1.45 }}>
              {tt.tangHomNay == null ? "" : tt.tangHomNay > 0 ? `+${sos(tt.tangHomNay)} hôm nay` : "hôm nay chưa nhích"}
              {tt.soNgayConLai != null && (
                <span>{tt.tangHomNay == null ? "" : " · "}{tt.soNgayConLai >= 0 ? `còn ${tt.soNgayConLai} ngày` : `quá hạn ${-tt.soNgayConLai} ngày`}</span>
              )}
            </div>
          )}
        </>
      ) : null}
    </button>
  );
}

/* ── MÀN CHÍNH ──────────────────────────────────────────────────────────────────────────────── */

export function MtldV2App() {
  const narrow = useIsMobile();
  const qc = useQueryClient();
  const [bump, setBump] = useState(0);
  const [mo, setMo] = useState<Proj | null>(null);
  const [xep, setXep] = useState<"tre" | "ten">("tre");
  const [moKho, setMoKho] = useState(false);
  const [moChart, setMoChart] = useState(false);        // đường tiến độ mặc định ĐÓNG
  const [moChuaDoc, setMoChuaDoc] = useState(false);    // mục "chưa rút được số" mặc định ĐÓNG

  const [tuLs, setTuLs] = useState<Proj[]>([]);
  useEffect(() => { setTuLs(docLs()); }, []);
  const listQ = useQuery({ queryKey: ["mtld2-list", bump], queryFn: () => getInstallList(), staleTime: 60_000 });
  const list = useMemo(() => {
    const tuKv = (listQ.data?.list ?? []) as Proj[];
    const l = tuKv.length ? tuKv : tuLs;
    const thay = new Set<string>(); const ra: Proj[] = [];
    for (const p of l) { const k = pid(p); if (thay.has(k)) continue; thay.add(k); ra.push(p); }
    return ra.sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }, [listQ.data, tuLs]);

  /* AI CHƯA NHÌN THÌ CHƯA ĐỌC. Mỗi dự án rút số = một lượt tải file; mở app mà nạp hết mấy chục dự
     án là làm việc thừa cho những thẻ người ta còn chưa cuộn tới. Nên:
       · `dich`    = mốc đã cuộn tới (12 thẻ đầu, cuộn tới đâu nới thêm tới đó);
       · `choPhep` = trong mốc đó chỉ mở CUNG_LUC lượt một lúc, xong cái nào mở tiếp cái đó. */
  const [dich, setDich] = useState(DOT_DAU);
  const dayRef = useRef<HTMLDivElement>(null);
  const xongRef = useRef(0);
  useEffect(() => { setDich(DOT_DAU); xongRef.current = 0; }, [list.length, bump]);
  const choPhep = Math.min(dich, xongRef.current + CUNG_LUC);
  const kq = useQueries({
    queries: list.map((p, i) => ({
      queryKey: ["mtld2-so", pid(p), bump],
      queryFn: () => docSo(p),
      enabled: i < choPhep,
      staleTime: 10 * 60 * 1000,
      retry: 0,
    })),
  });

  type Muc = { p: Proj; so?: So; dangDoc: boolean };
  const trangThai = kq.map((q) => q.status).join(",");
  // Đếm số đã xong để nới làn kế tiếp. Phải qua ref vì `choPhep` cần tính TRƯỚC khi gọi useQueries.
  const [, veLai] = useState(0);
  useEffect(() => {
    const n = kq.filter((q) => q.isSuccess || q.isError).length;
    if (n !== xongRef.current) { xongRef.current = n; veLai((x) => x + 1); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trangThai]);
  useEffect(() => {
    const el = dayRef.current;
    if (!el || dich >= list.length) return;
    const ob = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) setDich((n) => Math.min(list.length, n + DOT_DAU));
    }, { rootMargin: "300px" });
    ob.observe(el);
    return () => ob.disconnect();
  }, [dich, list.length]);

  const khoQ = useQuery({
    queryKey: ["mtld2-kho", bump],
    queryFn: () => docKho({ data: { soNgay: 120 } }),
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });
  /* Mốc vừa rút được cất vào kho ở NỀN, nên số tổng đọc lúc mở màn là số CŨ. Đợi loạt thẻ lắng
     xuống (không đổi trạng thái thêm trong 1,5 giây) rồi đọc kho lại MỘT lần — đọc lại sau mỗi thẻ
     thì mỗi lần mở app là mấy chục lượt gọi thừa. */
  const daDoc = useRef(false);
  useEffect(() => {
    if (daDoc.current || !kq.some((q) => q.isSuccess)) return;
    const t = setTimeout(() => { daDoc.current = true; qc.invalidateQueries({ queryKey: ["mtld2-kho"] }); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trangThai]);
  useEffect(() => { daDoc.current = false; }, [bump]);
  const khoRows = (khoQ.data?.rows ?? []) as MocKho[];
  const diem = useMemo(() => duongNgay(khoRows), [khoRows]);
  const tong = useMemo(() => tongQuan(moiNhatTheoDuAn(khoRows)), [khoRows]);

  /* BỐN THẺ KPI KHỐI PHÒNG — cộng dồn số căn theo chặng bàn giao của mọi dự án đọc được. */
  const tongPhong = useMemo(() => {
    const ds = kq.map((q) => q.data?.phong).filter((x): x is TrangThaiPhong => !!x);
    return ds.length ? congTrangThai(ds) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trangThai]);

  const boCuc = useMemo(() => {
    const mucs: Muc[] = list.map((p, i) => ({
      p, so: kq[i]?.data, dangDoc: !kq[i] || (!kq[i].isSuccess && !kq[i].isError),
    }));
    // Nhóm: ưu tiên cái ĐỌC ĐƯỢC từ tiêu đề bảng; chưa đọc xong thì đoán theo tên tab / tên dự án
    // (cùng một hàm) nên thẻ không nhảy nhóm sau khi tải xong.
    const nhomCua = (m: Muc) => m.so?.nhom ?? doanNhom("", m.p.sheet || "", m.p.name);
    const sapXep = (a: Muc, b: Muc) => {
      if (xep === "ten") return a.p.name.localeCompare(b.p.name, "vi");
      const va = a.so?.tt?.chenhLech ?? 999, vb = b.so?.tt?.chenhLech ?? 999;   // trễ nhất lên đầu
      return va - vb || a.p.name.localeCompare(b.p.name, "vi");
    };
    /* Dự án CHƯA ĐỌC ĐƯỢC SỐ tách hẳn xuống cuối trang. Để lẫn trong lưới thì mỗi thẻ một chiều
       cao, hàng nào cũng so le, mà thứ đáng nhìn lại bị mấy thẻ báo lỗi chen giữa. */
    const chuaDoc = mucs.filter((m) => !!m.so?.loi).sort((a, b) => a.p.name.localeCompare(b.p.name, "vi"));
    const g: Record<string, Muc[]> = { rooms: [], public: [] };
    for (const m of mucs) if (!m.so?.loi) g[nhomCua(m)].push(m);
    return {
      nhom: [
        { key: "rooms", ten: "KHỐI PHÒNG", ds: g.rooms.sort(sapXep) },
        { key: "public", ten: "PUBLIC", ds: g.public.sort(sapXep) },
      ].filter((n) => n.ds.length),
      chuaDoc,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, trangThai, xep]);
  const { nhom, chuaDoc } = boCuc;

  const nut = (dang: boolean) => ({
    padding: "5px 11px", fontSize: 11.5, fontWeight: 600 as const, cursor: "pointer", border: "none",
    background: dang ? T.accent : "transparent", color: dang ? "#fff" : T.soft,
  });
  const nutPhu = {
    display: "inline-flex", alignItems: "center", gap: 5, background: T.panel, color: T.ink,
    border: `1px solid ${T.line}`, borderRadius: 6, padding: "5px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer",
  } as const;

  return (
    <div style={{ minHeight: "100vh", width: "100%", background: T.bg, color: T.ink, fontFamily: "system-ui,-apple-system,Segoe UI,sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, padding: narrow ? "11px 12px" : "12px 20px", borderBottom: `1px solid ${T.line}`, background: T.side }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: T.xanh, boxShadow: "0 0 0 3px rgba(53,194,129,.18)" }} />
        <span style={{ fontSize: 14, fontWeight: 700 }}>Theo dõi lắp đặt — bản thử</span>
        <span style={{ fontSize: 12, color: T.soft }}>{list.length} dự án</span>
        <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", borderRadius: 6, overflow: "hidden", border: `1px solid ${T.line}` }}>
            <button type="button" onClick={() => setXep("tre")} style={nut(xep === "tre")}>Trễ nhất trước</button>
            <button type="button" onClick={() => setXep("ten")} style={nut(xep === "ten")}>Tên A–Z</button>
          </span>
          <button type="button" onClick={() => setMoKho(true)} style={nutPhu}><Database className="h-3.5 w-3.5" /> Kho số</button>
          <button type="button" onClick={() => { setBump((n) => n + 1); qc.invalidateQueries({ queryKey: ["mtld2-kho"] }); }} style={nutPhu}>
            <RefreshCw className="h-3.5 w-3.5" /> Làm mới
          </button>
        </div>
      </div>

      {/* Giới hạn bề ngang: màn 1900px mà dàn hết thì một hàng 8 thẻ, tên dự án nào cũng gãy hai
          dòng rồi cụt. Khung 1440 giữ thẻ đủ rộng để đọc được tên. */}
      <div style={{ padding: narrow ? 12 : 20, maxWidth: 1440, margin: "0 auto" }}>

        {/* ── HÀNG ĐẦU: BỐN THẺ KPI KHỐI PHÒNG. Đây là thứ cần nhìn trước. ── */}
        {tongPhong && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 9, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".09em", color: T.soft }}>KHỐI PHÒNG · BÀN GIAO</span>
              <span style={{ fontSize: 11.5, color: T.faint }}>
                {tongPhong.soDuAn} dự án{tongPhong.tongCan != null ? ` · ${tongPhong.tongCan} căn` : ""}
              </span>
            </div>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: `repeat(auto-fit, minmax(${narrow ? 150 : 190}px, 1fr))` }}>
              {THE_KPI.map((c) => {
                const v = c.lay(tongPhong);
                const tong = tongPhong.tongCan || 0;
                return (
                  <O1 key={c.nhan} nhan={c.nhan} so={v == null ? "—" : String(v)} mau={v == null ? T.faint : c.mau}
                    phu={v == null ? "chưa file nào ghi nhãn"
                      : tong ? `${(Math.round((v / tong) * 1000) / 10).toString().replace(".", ",")}% trên ${tong} căn` : undefined} />
                );
              })}
            </div>
            {tongPhong.thieuNhan.length > 0 && (
              <div style={{ fontSize: 10.5, color: T.faint, marginTop: 7 }}>
                có file chưa ghi nhãn chặng: {tongPhong.thieuNhan.join(" · ")}
              </div>
            )}
          </div>
        )}

        {/* ── HÀNG HAI: số phần trăm gom thành MỘT DÒNG. Trước là năm thẻ to, chiếm cả tầng màn
             hình cho năm con số mà không con nào là thứ phải nhìn trước. ── */}
        <div style={{ display: "flex", alignItems: "center", gap: narrow ? 10 : 18, flexWrap: "wrap",
          background: T.panel, border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 13px", marginBottom: 14 }}>
          <SoNho nhan="% thực tế" gt={sos(tong.thuc)} mau={mauTheoTre(tong.chenh)} />
          <SoNho nhan="so kế hoạch" mau={mauTheoTre(tong.chenh)}
            gt={tong.chenh == null ? "—" : `${tong.chenh > 0 ? "+" : ""}${sos(tong.chenh)}`} />
          <SoNho nhan="dự án trễ" gt={String(tong.soTre)} mau={tong.soTre ? T.vang : T.xanh} />
          <SoNho nhan="khu báo động" gt={String(tong.soBaoDong)} mau={tong.soBaoDong ? T.do : T.xanh} />
          <SoNho nhan="quá hạn bàn giao" gt={String(tong.soQuaHan)} mau={tong.soQuaHan ? T.do : T.xanh} />
          <span style={{ fontSize: 10.5, color: T.faint, marginLeft: "auto" }}>
            {tong.ngayMoiNhat ? `chốt ${ngayNgan(tong.ngayMoiNhat)} · ` : ""}{tong.soCoKeHoach}/{tong.soDuAn} dự án có kế hoạch
          </span>
          <button type="button" onClick={() => setMoChart((v) => !v)}
            style={{ background: "transparent", border: `1px solid ${T.line}`, borderRadius: 6, color: T.soft, fontSize: 11, fontWeight: 600, padding: "3px 9px", cursor: "pointer" }}>
            {moChart ? "Ẩn đường tiến độ" : `Đường tiến độ (${diem.length} ngày)`}
          </button>
        </div>

        {/* Đường tiến độ: mặc định ĐÓNG. Kho mới có vài ngày nên nó gần như một nét thẳng — để mở
            sẵn thì chiếm một phần ba màn hình mà chẳng nói được gì. */}
        {moChart && (
          <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 12, padding: narrow ? 12 : 14, marginBottom: 18 }}>
            <DuongTienDo diem={diem} narrow={narrow} />
            {(() => {
              const c = diem.at(-1);
              return c && c.soCoKeHoach > 0 && c.soCoKeHoach < c.soDuAn ? (
                <div style={{ fontSize: 10.5, color: T.faint, marginTop: 5 }}>
                  đường kế hoạch tính trên {c.soCoKeHoach}/{c.soDuAn} dự án có cột kế hoạch
                </div>
              ) : null;
            })()}
          </div>
        )}

        {listQ.isPending && !list.length ? (
          <div style={{ color: T.faint, fontSize: 13, padding: 48, textAlign: "center" }}>Đang tải danh sách dự án…</div>
        ) : !list.length ? (
          <div style={{ color: T.soft, fontSize: 13, padding: 48, textAlign: "center", lineHeight: 1.7 }}>
            Chưa có danh sách dự án. Mở <b style={{ color: T.ink }}>Project Master Plan</b> một lần để nạp danh sách link lắp đặt, rồi quay lại đây.
          </div>
        ) : <>
          {nhom.map((n) => {
            const tre = n.ds.filter((m) => (m.so?.tt?.chenhLech ?? 0) < -1).length;
            return (
              <div key={n.key} style={{ marginBottom: 22 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".09em", color: T.soft }}>{n.ten}</span>
                  <span style={{ fontSize: 11.5, color: T.faint }}>{n.ds.length} dự án</span>
                  {tre > 0 && <span style={{ fontSize: 11.5, color: T.faint }}>· <b style={{ color: T.do }}>{tre}</b> trễ kế hoạch</span>}
                </div>
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: `repeat(auto-fill, minmax(${narrow ? 240 : 272}px, 1fr))`, alignItems: "stretch" }}>
                  {n.ds.map((m) => (
                    <The key={pid(m.p)} p={m.p} so={m.so} dangDoc={m.dangDoc}
                      onMo={() => { setMo(m.p); track("mtld2_mo", `${m.p.maCT} · ${m.p.name}`); }} />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Dự án chưa rút được số — gom cuối trang, mặc định đóng. Vẫn bấm vào xem bảng gốc được. */}
          {chuaDoc.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              <button type="button" onClick={() => setMoChuaDoc((v) => !v)}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "transparent", border: "none", cursor: "pointer", padding: 0, marginBottom: 10 }}>
                <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".09em", color: T.soft }}>CHƯA RÚT ĐƯỢC SỐ</span>
                <span style={{ fontSize: 11.5, color: T.faint }}>{chuaDoc.length} dự án · {moChuaDoc ? "thu lại" : "xem"}</span>
              </button>
              {moChuaDoc && (
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: `repeat(auto-fill, minmax(${narrow ? 240 : 272}px, 1fr))`, alignItems: "stretch" }}>
                  {chuaDoc.map((m) => (
                    <The key={pid(m.p)} p={m.p} so={m.so} dangDoc={m.dangDoc}
                      onMo={() => { setMo(m.p); track("mtld2_mo", `${m.p.maCT} · ${m.p.name}`); }} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>}
      </div>

      {/* Mốc nạp: cuộn chạm tới là nới thêm một đợt. */}
      <div ref={dayRef} style={{ height: 1 }} />

      {mo && <ChiTiet p={mo} onDong={() => setMo(null)} narrow={narrow} />}
      {moKho && <KhoSo onDong={() => setMoKho(false)} narrow={narrow} soDong={khoRows.length}
        xong={() => qc.invalidateQueries({ queryKey: ["mtld2-kho"] })} />}
    </div>
  );
}

/* ── KHO SỐ: nạp thêm bằng CSV, xuất ra CSV, và câu SQL để nạp hàng loạt ────────────────────── */

function KhoSo({ onDong, narrow, soDong, xong }: { onDong: () => void; narrow: boolean; soDong: number; xong: () => void }) {
  const [csv, setCsv] = useState("");
  const [dangNap, setDangNap] = useState(false);
  const [ketQua, setKetQua] = useState<string | null>(null);
  const mauCsv = `${COT_KHO.join(",")}\n2026-09-09,CT25-070,Nam Phương Public,Main Lobby,public,96.7,100,96.7,-3.3,0,CHẬM NHẸ,2026-08-30,-10,csv`;

  async function nap() {
    setDangNap(true); setKetQua(null);
    try {
      const r = await napCsvKho({ data: { csv } });
      setKetQua(`Đã nạp ${r.ghi} dòng${r.bo ? `, bỏ ${r.bo} dòng` : ""}.${r.loi.length ? " " + r.loi.join(" · ") : ""}`);
      if (r.ghi) { setCsv(""); xong(); }
    } catch (e) { setKetQua((e as Error).message); }
    finally { setDangNap(false); }
  }
  async function xuat() {
    try {
      const r = await xuatCsvKho({ data: {} });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([r.csv], { type: "text/csv;charset=utf-8" }));
      a.download = `lapdat-kho-${homNay()}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      setKetQua(`Đã xuất ${r.soDong} dòng.`);
    } catch (e) { setKetQua((e as Error).message); }
  }

  const o = { background: T.bg, border: `1px solid ${T.line}`, borderRadius: 8, color: T.ink, fontSize: 12, padding: 9, width: "100%", fontFamily: "ui-monospace,monospace" } as const;
  const nutC = { background: T.accent, color: "#fff", border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" } as const;
  const nutP = { background: T.panel, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 7, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" } as const;

  return (
    <div onClick={onDong} style={{ position: "fixed", inset: 0, zIndex: 210, background: "rgba(2,6,23,.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: narrow ? 0 : 24 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ display: "flex", flexDirection: "column", width: "min(760px, 96vw)", maxHeight: "92vh", background: T.side, border: `1px solid ${T.line}`, borderRadius: narrow ? 0 : 14, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 15px", borderBottom: `1px solid ${T.line}` }}>
          <Database className="h-4 w-4" style={{ color: T.soft }} />
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>Kho số lắp đặt</span>
          <span style={{ fontSize: 11.5, color: T.faint }}>{soDong} dòng đang xem</span>
          <button type="button" onClick={onDong} title="Đóng"
            style={{ marginLeft: "auto", width: 30, height: 30, borderRadius: 8, border: `1px solid ${T.line}`, background: T.panel, color: T.soft, cursor: "pointer", display: "grid", placeItems: "center" }}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div style={{ padding: 15, overflow: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: 12, color: T.soft, marginBottom: 6, lineHeight: 1.6 }}>
              Dán CSV vào đây để bù số cho dự án chưa rút tự động được. Bốn cột bắt buộc:
              <b style={{ color: T.ink }}> ngay, maCT, duAn, khu</b>. Cùng ngày cùng khu thì đè, chạy lại không sinh dòng trùng.
            </div>
            <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={7} spellCheck={false}
              placeholder={mauCsv} style={{ ...o, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 9, flexWrap: "wrap" }}>
              <button type="button" onClick={nap} disabled={dangNap || csv.trim().length < 10} style={{ ...nutC, opacity: dangNap || csv.trim().length < 10 ? .5 : 1 }}>
                {dangNap ? "Đang nạp…" : "Nạp vào kho"}
              </button>
              <button type="button" onClick={xuat} style={nutP}>Xuất CSV</button>
              <button type="button" onClick={() => setCsv(mauCsv)} style={nutP}>Chèn dòng mẫu</button>
            </div>
            {ketQua && <div style={{ fontSize: 12, color: T.ink, marginTop: 9, lineHeight: 1.6 }}>{ketQua}</div>}
          </div>

          <div>
            <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".07em", color: T.soft, marginBottom: 6 }}>NẠP HÀNG LOẠT BẰNG SQL</div>
            <div style={{ fontSize: 12, color: T.soft, marginBottom: 6, lineHeight: 1.6 }}>
              Kho là bảng <code style={{ color: T.ink }}>lapdat_moc</code> trên D1 <code style={{ color: T.ink }}>pmo-audit</code>, cùng bộ cột với CSV ở trên.
            </div>
            <pre style={{ ...o, margin: 0, whiteSpace: "pre-wrap", fontSize: 11, color: T.soft, lineHeight: 1.55 }}>
{SQL_TAO_BANG};

-- nạp từ máy:
npx wrangler d1 execute pmo-audit --remote --file=./lapdat.sql

-- xem thử:
npx wrangler d1 execute pmo-audit --remote --command="SELECT ngay, COUNT(*) FROM lapdat_moc GROUP BY ngay ORDER BY ngay DESC LIMIT 10"</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── CHI TIẾT: bảng GỐC, y hệt popup của app chính ──────────────────────────────────────────── */

function ChiTiet({ p, onDong, narrow }: { p: Proj; onDong: () => void; narrow: boolean }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onDong(); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onDong]);
  return (
    <div onClick={onDong}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(2,6,23,.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: narrow ? 0 : 24 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ display: "flex", flexDirection: "column", width: "min(1500px, 98vw)", height: narrow ? "100vh" : "94vh", background: "#fff", borderRadius: narrow ? 0 : 14, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, background: T.panel, color: T.ink, padding: "10px 14px", flexShrink: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
          <span style={{ fontFamily: "ui-monospace,monospace", fontSize: 11, color: T.faint, flexShrink: 0 }}>{p.maCT}</span>
          <button type="button" onClick={onDong} title="Đóng (Esc)"
            style={{ marginLeft: "auto", flexShrink: 0, width: 32, height: 32, borderRadius: 8, border: `1px solid ${T.line}`, background: "#1b2333", color: "#cbd5e1", cursor: "pointer", display: "grid", placeItems: "center" }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 14, background: "#fff" }}>
          <MatrixFormEditor fid={p.fileId} opts={{ sheetName: p.sheet, range: p.range, tl: p.tl, br: p.br }}
            formKey={p.formKey || ""} canEdit={false} force={0} />
        </div>
      </div>
    </div>
  );
}
