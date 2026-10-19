/**
 * BẢNG ĐIỂM TUÂN THỦ TỔNG HỢP — màn hình (Hệ thống ▸ "Bảng điểm tuân thủ tổng hợp").
 *
 * Anh Tiến 19/10/2026: trình bày "y hệt form" báo cáo tuân thủ cập nhật Master Plan (ComplianceDialog),
 * duyệt bản Google Sheet trước rồi mới đưa lên app. Bố cục giữ đúng bản sheet đã duyệt:
 *   đầu trang 3 dòng · khung 4 ô (Điểm PM · Chú thích · Cách tính điểm dự án · Cách tính điểm PM)
 *   · bảng tiêu đề nền tối, Vùng / Người phụ trách gộp ô, ĐIỂM TRUNG BÌNH ngay sau tên dự án.
 *
 * SỐ LIỆU: đọc 4 tab do Apps Script `BangDiemTongHop.gs` ghi trong file BCN — app không chấm lại,
 * chỉ dựng bảng bằng đúng phép của script (lib/bang-diem-tong-hop.ts). Script chạy mỗi giờ.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, RefreshCw, ExternalLink, FileDown, Eye, Loader2 } from "lucide-react";
import { getSummaryFile } from "@/lib/mtld-install.functions";
import { BCN_FILE_ID } from "@/lib/bcn-tai";
import { docTongHop, dungBangTongHop, gomVungPm, mauDiemPm, nhanThang, xepTheoTenGoi, type DiemO, type LuoiTongHop } from "@/lib/bang-diem-tong-hop";
import { loiNoi } from "@/lib/loi-noi";
import { banTongHop } from "@/lib/bao-cao-tong-hop-in";
import type { BanBaoCao } from "@/lib/tram-bao-cao";
import { track } from "@/lib/track";

/* GID 4 tab do script tạo — tra ngày 19/10/2026 trên file thật. Đi theo gid để Worker tải ĐÚNG MỘT
   TAB (vài chục KB) và cache riêng; kèm TÊN tab để nếu gid đổi (tab bị xoá rồi script tạo lại) thì
   Worker lùi về tải nguyên file rồi tách đúng tab theo tên — xem refreshAndStore. */
const TAB = {
  bcn: { gid: "879453739", ten: "AutoData_BCN" },
  pmp: { gid: "758381692", ten: "AutoData_PMP" },
  map: { gid: "1054911417", ten: "MAP_PMP_BCN" },
  nhap: { gid: "1074735093", ten: "Nhập báo cáo tháng" },
} as const;
const GID_BANG = "1795553287";
const FILE_URL = `https://docs.google.com/spreadsheets/d/${BCN_FILE_ID}/edit?gid=${GID_BANG}`;

const b64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
};

async function taiTongHop(force: boolean) {
  const XLSX = await import("xlsx");
  const motTab = async (t: { gid: string; ten: string }): Promise<unknown[][]> => {
    const res = await getSummaryFile({ data: { fileId: BCN_FILE_ID, gid: t.gid, sheet: t.ten, force: force || undefined } });
    if (!res?.b64) throw new Error(`Không tải được tab "${t.ten}" — kiểm tra chia sẻ "Anyone with the link".`);
    const wb = XLSX.read(b64ToBytes(res.b64), { type: "array", cellDates: true });
    const ten = wb.SheetNames.find((n) => n.trim() === t.ten) ?? wb.SheetNames[0];
    return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[ten], { header: 1, defval: null, raw: true, blankrows: false });
  };
  const [bcn, pmp, map, nhap] = await Promise.all([motTab(TAB.bcn), motTab(TAB.pmp), motTab(TAB.map), motTab(TAB.nhap)]);
  const L: LuoiTongHop = { bcn, pmp, map, nhap };
  if (!String(bcn[0]?.[0] ?? "").startsWith("Tháng")) throw new Error('Tab AutoData_BCN chưa đúng mẫu — chạy hàm caiDatBangDiemTongHop trong Apps Script của file BCN.');
  return docTongHop(L);
}

/** Màn hẹp (điện thoại) — sếp xem app bằng điện thoại, mọi màn phải dùng đủ ở 375px. */
function useHep(px = 640): boolean {
  const [hep, setHep] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px}px)`);
    const f = () => setHep(mq.matches);
    f(); mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, [px]);
  return hep;
}

const fmt = (v: unknown): string => (typeof v === "number" ? v.toLocaleString("vi-VN", { maximumFractionDigits: 1 }) : "");

/** Ô điểm: <50 chữ đỏ như form; "n/a" xám; trống "–" nhạt. */
function ODiem({ v, dam }: { v: DiemO | number | ""; dam?: boolean }) {
  if (typeof v === "number") {
    return <span className={`tabular-nums ${dam ? "text-[13px] font-extrabold" : ""}`} style={{ color: v < 50 ? "#dc2626" : dam ? "#0f172a" : "#334155" }}>{fmt(v)}</span>;
  }
  if (v === "n/a") return <span className="text-slate-400">n/a</span>;
  return <span className="text-slate-300" title="Chưa có dữ liệu">–</span>;
}

/** Khổ A4 ở 96dpi — giữ khớp với tram-bao-cao-pdf.ts. */
const TRANG_W = 794, TRANG_H = 1123;

/** Xem trước BẢN IN MẪU AA — chính `dungTrang` lúc xuất sẽ gọi, chỉ thu nhỏ (thấy sao in ra vậy). */
function XemBanIn({ ban, onClose, onXuat, dangXuat }: { ban: BanBaoCao; onClose: () => void; onXuat: () => void; dangXuat: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const khung = useRef<HTMLDivElement>(null);
  const [soTrang, setSoTrang] = useState(0);
  const [ti, setTi] = useState(0.72);
  useEffect(() => {
    const k = khung.current;
    if (!k) return;
    const doTi = () => setTi(Math.min(0.9, Math.max(0.3, (k.clientWidth - 32) / TRANG_W)));
    doTi();
    const ro = new ResizeObserver(doTi);
    ro.observe(k);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const h = host.current;
    if (!h) return;
    let huy = false;
    void import("@/lib/tram-bao-cao-pdf").then(({ xemTruoc }) => { if (!huy) setSoTrang(xemTruoc(ban, h)); });
    return () => { huy = true; h.textContent = ""; };
  }, [ban]);
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-900/60 p-0 sm:p-4" onClick={onClose}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-bold text-slate-800">Bản in theo mẫu công ty</div>
            <div className="text-[11px] text-slate-500">{soTrang} trang A4 · chính là bản sẽ tải về</div>
          </div>
          <button onClick={onXuat} disabled={dangXuat}
            className="flex h-8 items-center gap-1.5 rounded-md bg-[#1F3864] px-3 text-[12px] font-semibold text-white hover:bg-[#162b4d] disabled:opacity-50">
            {dangXuat ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}{dangXuat ? "Đang dựng…" : "Tải PDF"}
          </button>
          <button onClick={onClose} aria-label="Đóng" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>
        <div ref={khung} className="min-h-0 flex-1 overflow-auto bg-slate-200 p-4">
          <div className="mx-auto" style={{ width: TRANG_W * ti, height: soTrang ? (soTrang * TRANG_H + (soTrang - 1) * 14) * ti : 0 }}>
            <div ref={host} style={{ width: TRANG_W, transform: `scale(${ti})`, transformOrigin: "top left" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** `nhung` = đặt thẳng trong trang (app "Báo cáo" ở thanh trái) thay vì hộp thoại. */
export function BangDiemTongHopDialog({ onClose, nhung }: { onClose?: () => void; nhung?: boolean }) {
  const [bump, setBump] = useState(0);
  const q = useQuery({
    queryKey: ["bang-diem-tong-hop", bump],
    queryFn: () => taiTongHop(bump > 0),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const d = q.data;
  const [thangChon, setThangChon] = useState("");
  const thangNay = useMemo(() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; }, []);
  const thang = d ? (d.cacThang.includes(thangChon) ? thangChon : d.cacThang.includes(thangNay) ? thangNay : d.cacThang[0] ?? thangNay) : thangNay;
  const bang = useMemo(() => (d ? dungBangTongHop(thang, d) : null), [d, thang]);
  const nhom = useMemo(() => (bang ? gomVungPm(bang.duAn) : []), [bang]);
  const pmXep = useMemo(() => (bang ? [...bang.pm].sort((a, b) => xepTheoTenGoi(a.pm, b.pm)) : []), [bang]);

  const refDau = useRef<HTMLDivElement>(null);
  const refKhung = useRef<HTMLDivElement>(null);
  const refBang = useRef<HTMLTableElement>(null);
  const [dangXuat, setDangXuat] = useState(false);
  const [thongBao, setThongBao] = useState("");
  const [xemIn, setXemIn] = useState(false);
  const banIn = useMemo(() => (bang ? banTongHop(bang, thang, d?.capNhatLuc ?? "") : null), [bang, thang, d?.capNhatLuc]);
  const dong = onClose ?? (() => {});

  /* XUẤT PDF THEO MẪU CÔNG TY — cùng khuôn với Trạm xuất báo cáo (lib/bao-cao-tong-hop-in.ts). */
  const xuatPdfMau = async () => {
    if (!banIn || dangXuat) return;
    setDangXuat(true);
    try {
      const { xuatPdf } = await import("@/lib/tram-bao-cao-pdf");
      const ten = await xuatPdf(banIn);
      setThongBao(`Đã tải ${ten}`);
      window.setTimeout(() => setThongBao(""), 6000);
      track("export_pdf", `Tuân thủ tổng hợp (mẫu AA) tháng ${nhanThang(thang)}`);
    } catch (e) {
      setThongBao(`Không dựng được PDF: ${loiNoi(e)}`);
    } finally { setDangXuat(false); }
  };

  /* BẢN NHƯ MÀN HÌNH — chụp đúng form trên màn (exportDashboardPdf, khổ dọc gọn một trang như bản
     tuân thủ Master Plan). Tên file theo khuôn PMO: yymmdd_Tên cố định_MM.YYYY */
  const xuatPdfManHinh = async () => {
    if (!refBang.current || dangXuat) return;
    setDangXuat(true);
    try {
      const { exportDashboardPdf } = await import("@/lib/pdf-export");
      const khoi = [refDau.current, refKhung.current].filter((el): el is HTMLDivElement => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1;   // khối rộng 0 làm jsPDF chia cho 0 — xem bao-cao-ngay-app
      });
      const n = new Date();
      const p2 = (x: number) => String(x).padStart(2, "0");
      const yymmdd = `${String(n.getFullYear()).slice(2)}${p2(n.getMonth() + 1)}${p2(n.getDate())}`;
      const r = await exportDashboardPdf({
        blocks: khoi, table: refBang.current, wide: true, orientation: "portrait", tableFitOnePage: true, keepColWidths: true,
        fileName: `${yymmdd}_Báo cáo tuân thủ tổng hợp_${thang.slice(5, 7)}.${thang.slice(0, 4)}.pdf`,
      });
      setThongBao(`Đã tải bản PDF · ${r.pages} trang`);
      window.setTimeout(() => setThongBao(""), 6000);
      track("export_pdf", `Bảng điểm tuân thủ tổng hợp tháng ${nhanThang(thang)}`);
    } catch (e) {
      setThongBao(`Không dựng được PDF: ${loiNoi(e)}`);
    } finally { setDangXuat(false); }
  };

  const thc = "border-r border-slate-600 bg-[#1e293b] px-2 py-1.5 text-center font-semibold whitespace-normal";
  const hep = useHep();
  const nPm = pmXep.length;
  const soCotPm = hep ? 1 : nPm > 10 ? 3 : 2;

  return (
    <div onClick={nhung ? undefined : dong} className={nhung ? "flex h-full min-h-0 flex-col" : "fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4"}>
      {xemIn && banIn && <XemBanIn ban={banIn} onClose={() => setXemIn(false)} onXuat={() => void xuatPdfMau()} dangXuat={dangXuat} />}
      <div onClick={(e) => e.stopPropagation()} className={nhung
        ? "flex min-h-0 w-full flex-1 flex-col rounded-xl border border-slate-200 bg-white"
        : "flex max-h-[94vh] w-full max-w-[1360px] flex-col rounded-xl border border-slate-200 bg-white shadow-xl"}>
        {/* ── ĐẦU TRANG (đi vào PDF) + điều khiển (không vào PDF) ── */}
        <div className="flex flex-wrap items-start justify-between gap-2 px-4 pb-1 pt-2 sm:px-5">
          <div ref={refDau} className="min-w-0 flex-1 bg-white text-left">
            <div className="text-base font-extrabold tracking-tight text-[#1e3a5f]">Báo cáo tuân thủ tổng hợp - Tháng {nhanThang(thang)}</div>
            <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-teal-700">OCC · Phòng Điều hành Trung tâm</div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              Dữ liệu tính đến: <b className="tabular-nums text-slate-700">{d?.capNhatLuc || "—"}</b> · Tổng số: <b className="tabular-nums text-slate-700">{bang?.duAn.length ?? 0}</b> dự án
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              Tháng
              <select value={thang} onChange={(e) => { setThangChon(e.target.value); track("bdth_doi_thang", e.target.value); }}
                className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-[11.5px] font-semibold text-slate-800 outline-none hover:border-slate-500 focus:border-slate-600">
                {(d?.cacThang.length ? d.cacThang : [thang]).map((t) => <option key={t} value={t}>{nhanThang(t)}</option>)}
              </select>
            </label>
            <button onClick={() => setBump((b) => b + 1)} disabled={q.isFetching} title="Tải lại bản mới nhất từ file (script tự cập nhật file mỗi giờ)"
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`} />Làm mới
            </button>
            <a href={FILE_URL} target="_blank" rel="noreferrer" title="Mở sheet bảng điểm trong file nguồn"
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
              <ExternalLink className="h-3.5 w-3.5" />File nguồn
            </a>
            <button onClick={() => void xuatPdfManHinh()} disabled={!bang?.duAn.length || dangXuat} title="Chụp đúng form đang thấy trên màn hình ra PDF"
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              <FileDown className="h-3.5 w-3.5" />PDF như màn hình
            </button>
            <button onClick={() => setXemIn(true)} disabled={!bang?.duAn.length} title="Xem trước bản in theo mẫu công ty (logo AA, khung đỏ) rồi tải"
              className="inline-flex items-center gap-1 rounded-md border border-[#1F3864] bg-white px-2 py-1 text-[11px] font-semibold text-[#1F3864] hover:bg-[#1F3864]/5 disabled:opacity-40">
              <Eye className="h-3.5 w-3.5" />Xem bản in
            </button>
            <button onClick={() => void xuatPdfMau()} disabled={!bang?.duAn.length || dangXuat} title="Xuất PDF theo mẫu công ty (A4 dọc, logo AA)"
              className="inline-flex items-center gap-1 rounded-md bg-[#1F3864] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#162b4d] disabled:opacity-40">
              <FileDown className="h-3.5 w-3.5" />{dangXuat ? "Đang tạo…" : "Xuất PDF mẫu chuẩn"}
            </button>
            {!nhung && <button onClick={dong} aria-label="Đóng" title="Đóng" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>}
          </div>
          {thongBao && <div className="w-full text-right text-[11px] text-slate-500">{thongBao}</div>}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 pb-3 sm:px-5">
          {q.isLoading ? (
            <div className="py-16 text-center text-sm text-slate-500">Đang tải bảng điểm…</div>
          ) : q.error ? (
            <div className="py-14 text-center">
              <div className="text-sm font-semibold text-red-600">Không tải được bảng điểm</div>
              <div className="mx-auto mt-1 max-w-lg whitespace-pre-wrap text-[11px] text-slate-500">{loiNoi(q.error)}</div>
              <button onClick={() => setBump((b) => b + 1)} className="mt-3 rounded-md bg-teal-700 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-800">Thử lại</button>
            </div>
          ) : !bang ? null : (
            <>
              {/* ── KHUNG 4 Ô — cùng khuôn với báo cáo tuân thủ Master Plan ── */}
              <div ref={refKhung} className="mb-2 flex flex-wrap items-stretch overflow-hidden rounded-md border border-slate-300 bg-white text-[10px] leading-snug text-slate-600 md:flex-nowrap">
                <div className="flex basis-full flex-col border-b border-slate-300 px-3 py-2 md:basis-auto md:flex-[2.4] md:border-b-0 md:border-r">
                  <div className="mb-2 font-semibold text-slate-700">Điểm PM:</div>
                  {nPm ? (
                    <div className="grid gap-x-4 leading-[1.3]" style={{ fontSize: soCotPm === 3 ? 11 : 12, gridAutoFlow: "column", gridTemplateRows: `repeat(${Math.ceil(nPm / soCotPm)}, auto)` }}>
                      {pmXep.map((p) => (
                        <div key={p.pm} className="flex items-baseline justify-between gap-2 leading-tight" title={`${p.soDuAn} dự án`}>
                          <span className="whitespace-nowrap font-bold text-slate-800">{p.pm}</span>
                          <b className="shrink-0 tabular-nums" style={{ color: mauDiemPm(p.tong) }}>{typeof p.tong === "number" ? Math.round(p.tong) : "—"}</b>
                        </div>
                      ))}
                    </div>
                  ) : <div className="text-slate-400">Chưa có dữ liệu tháng này.</div>}
                </div>
                <div className="flex basis-full flex-col border-b border-slate-300 px-3 py-2 md:basis-auto md:flex-[0.55] md:border-b-0 md:border-r">
                  <div className="mb-2 font-semibold text-slate-700">Chú thích:</div>
                  <div className="flex flex-col gap-1.5">
                    <div className="whitespace-nowrap"><b className="text-red-600">45</b>&nbsp; Điểm dưới 50</div>
                    <div className="whitespace-nowrap"><b className="text-slate-900">90</b>&nbsp; Từ 50 trở lên</div>
                    <div className="whitespace-nowrap"><b className="text-slate-300">–</b>&nbsp;&nbsp; Chưa có điểm</div>
                    <div className="mt-1 whitespace-nowrap">Điểm PM: <b style={{ color: "#16a34a" }}>≥70</b> · <b style={{ color: "#ca8a04" }}>50–69</b> · <b style={{ color: "#dc2626" }}>&lt;50</b></div>
                  </div>
                </div>
                <div className="flex basis-full flex-col border-b border-slate-300 px-3 py-2 md:basis-auto md:flex-1 md:border-b-0 md:border-r">
                  <div className="mb-2 font-semibold text-slate-700">Cách tính điểm dự án:</div>
                  <div className="flex flex-col gap-1.5">
                    <div>(1) Báo cáo ngày (cột AS sheet BCN_BangCham, theo nhóm dự án BCN): <b className="text-slate-800">100 điểm/tháng</b>; trễ/thiếu <b className="text-amber-600">−2</b>; không báo cáo <b className="text-red-600">−5</b>.</div>
                    <div>(2) Báo cáo tuần (cột J, file PMP): không cập nhật <b className="text-red-600">−25</b>; trễ <b className="text-amber-600">−10</b>.</div>
                    <div>(3) Báo cáo tháng: nhập ở sheet “Nhập báo cáo tháng”.</div>
                    <div><b className="text-slate-800">(4) Điểm trung bình = tổng các ô điểm có số ÷ số ô có số</b> (ô chưa có dữ liệu không tính).</div>
                  </div>
                </div>
                <div className="flex basis-full flex-col px-3 py-2 md:basis-auto md:flex-1">
                  <div className="mb-2 font-semibold text-slate-700">Cách tính điểm PM:</div>
                  <div className="flex flex-1 items-center gap-2">
                    <span className="whitespace-nowrap">Điểm PM =</span>
                    <span className="inline-flex flex-col text-center leading-relaxed">
                      <span className="border-b border-slate-500 px-1 pb-1">Tổng điểm trung bình các dự án PM quản lý</span>
                      <span className="px-1 pt-1">Tổng số dự án PM quản lý</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* ── BẢNG ── điện thoại: giữ khổ đọc được rồi cuộn ngang (mẫu FitOrScroll của app) */}
              <div className="overflow-x-auto">
                <table ref={refBang} className="w-full min-w-[900px] table-fixed border-collapse text-[11px] [&_tbody_td]:border-b [&_tbody_td]:border-slate-300">
                  <colgroup>
                    <col style={{ width: "7%" }} /><col style={{ width: "13%" }} /><col style={{ width: "30%" }} /><col style={{ width: "8%" }} />
                    <col style={{ width: "8%" }} /><col style={{ width: "8%" }} /><col style={{ width: "8%" }} /><col style={{ width: "9%" }} /><col style={{ width: "9%" }} />
                  </colgroup>
                  <thead className="text-white">
                    <tr>
                      <th rowSpan={2} className={thc}>Vùng</th>
                      <th rowSpan={2} className={thc}>Người phụ trách</th>
                      <th rowSpan={2} className={thc}>Tên dự án</th>
                      <th rowSpan={2} className={`${thc} !bg-[#16a34a]`} title="Tổng các ô điểm có số ÷ số ô có số">Điểm<br />trung bình</th>
                      <th colSpan={3} className={thc}>Báo cáo ngày</th>
                      <th className={thc}>Báo cáo tuần</th>
                      <th className={`${thc} border-r-0`}>Báo cáo tháng</th>
                    </tr>
                    <tr>
                      <th className={thc}>Quân số<br />(09:00)</th>
                      <th className={thc}>Sản lượng<br />(12:00)</th>
                      <th className={thc}>Thi công LĐ<br />(18:00)</th>
                      <th className={thc} title="Điểm cột J của dự án trong Báo cáo tuân thủ cập nhật PMP">Master Plan<br />(PMP)</th>
                      <th className={`${thc} border-r-0`}>Điểm tháng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!bang.duAn.length && (
                      <tr><td colSpan={9} className="px-3 py-6 text-center text-[12px] text-slate-500">Chưa có dữ liệu tháng {nhanThang(thang)}.</td></tr>
                    )}
                    {nhom.map((v) => v.pms.map((g, gi) => g.dong.map((r, ri) => (
                      <tr key={`${v.vung}|${g.pm}|${r.key}`} className="hover:bg-slate-50/60">
                        {gi === 0 && ri === 0 && (
                          <td rowSpan={v.soDong} className="border-r border-slate-200 bg-slate-50 px-2 py-1 text-center align-middle font-bold text-[#1e3a5f] whitespace-normal break-words">{v.vung}</td>
                        )}
                        {ri === 0 && (
                          <td rowSpan={g.dong.length} className="border-r border-slate-100 px-2 py-1 text-center align-middle font-medium text-slate-900">{g.pm}</td>
                        )}
                        <td className="border-r border-slate-100 px-2 py-1 font-semibold text-slate-900"
                          title={`Mã CT: ${r.maCT || "—"}\nBáo cáo ngày theo dự án BCN: ${r.bcnTen || "(chưa gán — xem sheet MAP_PMP_BCN)"}`}>
                          <div className="line-clamp-1">{r.ten}</div>
                        </td>
                        <td className="border-r border-slate-200 bg-emerald-50/40 px-2 py-1 text-center"><ODiem v={r.tong} dam /></td>
                        {/* Báo cáo ngày chỉ có theo NHÓM BCN → dự án nhận điểm của nhóm được gán */}
                        {(["qs", "sl", "tc"] as const).map((k) => (
                          <td key={k} className="border-r border-slate-100 px-2 py-1 text-center" title={r.bcnTen ? `Theo dự án BCN: ${r.bcnTen}` : "Chưa gán dự án BCN"}><ODiem v={r[k]} /></td>
                        ))}
                        <td className="border-r border-slate-100 px-2 py-1 text-center"><ODiem v={r.tuan} /></td>
                        <td className="px-2 py-1 text-center"><ODiem v={r.thangBC} /></td>
                      </tr>
                    ))))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
