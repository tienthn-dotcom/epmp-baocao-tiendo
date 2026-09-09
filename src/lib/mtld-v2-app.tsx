/**
 * THEO DÕI LẮP ĐẶT — BẢN THỬ (chỉ admin thấy, đang phát triển).
 *
 * Cùng tinh thần app MTLĐ hiện có, khác đúng một chỗ: KHÔNG bày bảng gốc ra trang tổng.
 * Mỗi dự án dựng bảng một kiểu — khác cột, khác cách gom, khác bảng màu — nên xếp cạnh nhau thì mỗi
 * ô nói một thứ tiếng, không so dự án này với dự án kia được.
 *
 * Ở đây mọi dự án quy về CÙNG MỘT KHUÔN THẺ, dựng từ mấy con số bảng nào cũng có:
 *   % thực tế · % kế hoạch · chênh lệch · nhích thêm hôm nay · số khu đạt / chậm / báo động.
 * Thẻ chia hai nhóm KHỐI PHÒNG và PUBLIC — hai loại đó đọc theo hai cách khác nhau, gộp một lưới là
 * so nhầm. Bấm vào thẻ mới mở bảng gốc: heatmap và mã màu giữ nguyên, không mất gì.
 *
 * SỐ ĐỌC Ở CLIENT: worker mà mở .xlsx là dính Error 1102. Tải bằng ĐÚNG cách popup đang tải
 * (getSummaryFile theo tên tab) nên dùng chung luôn cache của popup — không đẻ thêm lượt đọc KV, và
 * số trên thẻ chắc chắn khớp số trong bảng gốc.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { getInstallList, getSummaryFile } from "@/lib/mtld-install.functions";
import { docBaoCao, docBangPct, tomTat, tomTatBangPct, doanNhom, type O, type TomTat } from "@/lib/mtld-baocao";
import { MatrixFormEditor } from "@/lib/matrix-form-editor";
import { useIsMobile } from "@/lib/use-breakpoint";
import { track } from "@/lib/track";

const T = {
  bg: "#0a0e15", side: "#10151e", panel: "#131a26", line: "#232c3d",
  ink: "#e7ebf3", soft: "#a3adc2", faint: "#6b7488",
  xanh: "#35c281", vang: "#e0b13a", do: "#e0574a", accent: "#5b8cff",
};

const CUNG_LUC = 4;    // số dự án đọc file cùng lúc — nhiều hơn thì nghẽn, ít hơn thì chờ lâu
const DOT_DAU = 12;    // số thẻ đọc số ngay khi mở; phần còn lại chờ cuộn tới

type Proj = {
  fileId: string; gid?: string; name: string; maCT: string; hid?: string;
  region?: string; groupDA?: string;
  sheet?: string; range?: string; tl?: string; br?: string; formKey?: string; chart?: boolean; noMx?: boolean;
};
const pid = (p: Proj) => `${p.fileId}|${p.gid || ""}|${p.formKey || ""}`;

/** Cùng khoá localStorage app MTLĐ đang dùng — máy đã mở Dashboard thì vào đây có danh sách ngay,
 *  không phải chờ KV. KV vẫn là nguồn thật; cái này chỉ để khỏi đứng trước màn hình trống. */
const LS_KEY = "mtld:install:v2";
function docLs(): Proj[] {
  try { const l = JSON.parse(localStorage.getItem(LS_KEY) || "[]"); return Array.isArray(l) ? (l as Proj[]) : []; }
  catch { return []; }
}

type So = { tt?: TomTat; nhom: "public" | "rooms"; tieuDe: string; loi?: string };

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

async function docSo(p: Proj): Promise<So> {
  const doan = doanNhom("", p.sheet || "", p.name);
  // TẢI Y HỆT POPUP: theo TÊN TAB, không theo gid. Vài dự án khai gid trỏ tab khác với tab đã chọn
  // (Mini Hotel: sheet "Summary" nhưng gid lại là "Public Summary") — bám tên tab thì thẻ và bảng
  // gốc luôn cùng một nguồn, lại xài chung cache nên không tốn thêm lượt đọc.
  const r = await getSummaryFile({ data: { fileId: p.fileId, sheet: p.sheet || undefined } });
  if (!r?.b64) return { nhom: doan, tieuDe: "", loi: "không tải được file" };
  const XLSX = await import("xlsx");
  const wb = XLSX.read(b64ToBuf(r.b64), { type: "array", cellDates: true });
  const ten = p.sheet && wb.SheetNames.includes(p.sheet) ? p.sheet : wb.SheetNames[0];
  const sh = wb.Sheets[ten];
  if (!sh) return { nhom: doan, tieuDe: "", loi: "không thấy tab đã khai" };
  const rows = XLSX.utils.sheet_to_json<O[]>(sh, { header: 1, defval: null });
  const bc = docBaoCao(rows, p.maCT);
  if (bc.ok) return { tt: tomTat(bc.khu), nhom: doanNhom(bc.tieuDe, ten, p.name), tieuDe: bc.tieuDe };

  /* NHIỀU DẠNG TAB CÙNG TỒN TẠI. Phần lớn dự án gắn bảng "BÁO CÁO % HOÀN THÀNH" (có kế hoạch, có
     cảnh báo); một số gắn thẳng ma trận, chỉ có cột "% THỰC HIỆN". Thử dạng giàu trước, không được
     thì rút lấy phần trăm — thẻ khi đó thiếu phần kế hoạch, và nói rõ là thiếu. */
  const bp = docBangPct(rows);
  if (bp.ok) return { tt: tomTatBangPct(bp.dong), nhom: doanNhom("", ten, p.name), tieuDe: "" };
  return { nhom: doan, tieuDe: "", loi: bp.loi };
}

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
        <div style={{ fontSize: 21, fontWeight: 800, color: mau, lineHeight: 1, whiteSpace: "nowrap" }}>
          {dangDoc ? "…" : tt?.pctThuc == null ? "—" : sos(tt.pctThuc)}
        </div>
      </div>

      {dangDoc ? (
        <div style={{ fontSize: 11.5, color: T.faint }}>đang đọc bảng…</div>
      ) : so?.loi ? (
        <div style={{ fontSize: 11.5, color: T.vang, lineHeight: 1.5 }}>{so.loi} — bấm để mở bảng gốc</div>
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

function Chip({ n, nhan, mau }: { n: number; nhan: string; mau: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, border: `1px solid ${T.line}`, borderRadius: 999, padding: "2px 8px", color: T.soft }}>
      <b style={{ color: mau }}>{n}</b>{nhan}
    </span>
  );
}

export function MtldV2App() {
  const narrow = useIsMobile();
  const [bump, setBump] = useState(0);
  const [mo, setMo] = useState<Proj | null>(null);
  const [xep, setXep] = useState<"tre" | "ten">("tre");

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

  /* AI CHƯA NHÌN THÌ CHƯA ĐỌC. Mỗi dự án đọc số = một lượt tải file; mở app mà nạp hết mấy chục dự
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
  // Đếm số đã xong để nới làn kế tiếp. Phải qua ref vì `choPhep` cần tính TRƯỚC khi gọi useQueries;
  // ghi xong thì ép vẽ lại một nhịp.
  const [, veLai] = useState(0);
  useEffect(() => {
    const n = kq.filter((q) => q.isSuccess || q.isError).length;
    if (n !== xongRef.current) { xongRef.current = n; veLai((x) => x + 1); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trangThai]);
  // Cuộn tới đáy lưới → nới mốc, nạp tiếp một đợt.
  useEffect(() => {
    const el = dayRef.current;
    if (!el || dich >= list.length) return;
    const ob = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) setDich((n) => Math.min(list.length, n + DOT_DAU));
    }, { rootMargin: "300px" });
    ob.observe(el);
    return () => ob.disconnect();
  }, [dich, list.length]);

  const nhom = useMemo(() => {
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
    const g: Record<string, Muc[]> = { rooms: [], public: [] };
    for (const m of mucs) g[nhomCua(m)].push(m);
    return [
      { key: "rooms", ten: "KHỐI PHÒNG", ds: g.rooms.sort(sapXep) },
      { key: "public", ten: "PUBLIC", ds: g.public.sort(sapXep) },
    ].filter((n) => n.ds.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, trangThai, xep]);

  const nut = (dang: boolean) => ({
    padding: "5px 11px", fontSize: 11.5, fontWeight: 600 as const, cursor: "pointer", border: "none",
    background: dang ? T.accent : "transparent", color: dang ? "#fff" : T.soft,
  });

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
          <button type="button" onClick={() => setBump((n) => n + 1)}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, background: T.panel, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 6, padding: "5px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <RefreshCw className="h-3.5 w-3.5" /> Làm mới
          </button>
        </div>
      </div>

      <div style={{ padding: narrow ? 12 : 20 }}>
        {listQ.isPending && !list.length ? (
          <div style={{ color: T.faint, fontSize: 13, padding: 48, textAlign: "center" }}>Đang tải danh sách dự án…</div>
        ) : !list.length ? (
          <div style={{ color: T.soft, fontSize: 13, padding: 48, textAlign: "center", lineHeight: 1.7 }}>
            Chưa có danh sách dự án. Mở <b style={{ color: T.ink }}>Project Master Plan</b> một lần để nạp danh sách link lắp đặt, rồi quay lại đây.
          </div>
        ) : nhom.map((n) => {
          const co = n.ds.filter((m) => m.so?.tt);
          const tre = co.filter((m) => (m.so!.tt!.chenhLech ?? 0) < -1).length;
          return (
            <div key={n.key} style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".09em", color: T.soft }}>{n.ten}</span>
                <span style={{ fontSize: 11.5, color: T.faint }}>{n.ds.length} dự án</span>
                {tre > 0 && <span style={{ fontSize: 11.5, color: T.faint }}>· <b style={{ color: T.do }}>{tre}</b> trễ kế hoạch</span>}
              </div>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: `repeat(auto-fill, minmax(${narrow ? 240 : 262}px, 1fr))`, alignItems: "start" }}>
                {n.ds.map((m) => (
                  <The key={pid(m.p)} p={m.p} so={m.so} dangDoc={m.dangDoc}
                    onMo={() => { setMo(m.p); track("mtld2_mo", `${m.p.maCT} · ${m.p.name}`); }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Mốc nạp: cuộn chạm tới là nới thêm một đợt. */}
      <div ref={dayRef} style={{ height: 1 }} />

      {mo && <ChiTiet p={mo} onDong={() => setMo(null)} narrow={narrow} />}
    </div>
  );
}

/** Chi tiết = bảng GỐC, y hệt popup của app chính — không vẽ lại, không diễn giải thêm. */
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
            style={{ marginLeft: "auto", flexShrink: 0, width: 32, height: 32, borderRadius: 8, border: `1px solid ${T.line}`, background: "#1b2333", color: "#cbd5e1", fontSize: 15, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 14, background: "#fff" }}>
          <MatrixFormEditor fid={p.fileId} opts={{ sheetName: p.sheet, range: p.range, tl: p.tl, br: p.br }}
            formKey={p.formKey || ""} canEdit={false} force={0} />
        </div>
      </div>
    </div>
  );
}
