/**
 * TRẠM XUẤT BÁO CÁO — màn hình chọn và xem trước.
 *
 * Anh Tiến 16/10/2026: *"vào đó, chọn xuất báo cáo -> chọn hạng mục báo cáo -> chọn vùng,
 * dự án,… (bộ lọc) […] có thể lựa chọn giữa việc xuất số % hay là xuất số mã cụ thể bên ô bên
 * phải […] xuất phát là đạt chuẩn chỉ cần đem đi báo cáo luôn"*.
 *
 * ── XEM TRƯỚC LÀ CHÍNH BẢN IN ───────────────────────────────────────────────────────────────
 * Khung bên phải KHÔNG phải bản phác. Nó gọi đúng `dungTrang()` mà lúc xuất PDF sẽ gọi, chỉ thu
 * nhỏ lại. Thấy sao in ra vậy — khỏi cảnh bấm xuất, mở tệp, thấy lệch, quay lại sửa.
 *
 * Số đếm ngay cạnh mỗi ô lọc để biết bấm vào còn lại bao nhiêu dòng trước khi bấm.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import {
  LOAI_META, dsDuAn, dsLoc, dungBaoCao, locDong,
  type BoLoc, type DongNguon, type KieuSo, type LoaiBaoCao,
} from "@/lib/tram-bao-cao";
import { xemTruoc, xuatPdf } from "@/lib/tram-bao-cao-pdf";

const LOAI: LoaiBaoCao[] = ["hangMuc", "tongHop", "treHan"];
/** Khổ A4 ở 96dpi — giữ khớp với tram-bao-cao-pdf.ts. */
const TRANG_W = 794, TRANG_H = 1123;

export type TramProps = {
  dong: DongNguon[];
  /** Thứ tự vùng chuẩn của app (vungRank). */
  rank: (v: string) => number;
  /** Thứ tự viết tắt hạng mục của app (STAGE_ABBR_ORDER). */
  thuTuAbbr: readonly string[];
  nguoiXuat?: string;
  onClose: () => void;
};

const oLoc = "h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[12px] text-slate-700 outline-none focus:border-teal-500";
const nhanLoc = "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400";

export default function TramBaoCao({ dong, rank, thuTuAbbr, nguoiXuat, onClose }: TramProps) {
  const [loai, setLoai] = useState<LoaiBaoCao>("hangMuc");
  const [kieu, setKieu] = useState<KieuSo>("pct");
  const [hangMuc, setHangMuc] = useState("");
  const [vung, setVung] = useState("");
  const [cum, setCum] = useState("");
  const [pm, setPm] = useState("");
  const [tim, setTim] = useState("");
  const [chonDuAn, setChonDuAn] = useState<string[]>([]);
  const [moDuAn, setMoDuAn] = useState(false);
  const [dangXuat, setDangXuat] = useState(false);
  const [soTrang, setSoTrang] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  /* Tỉ lệ thu nhỏ khung xem trước: ĐO bề ngang thật rồi tính, không chốt cứng 0,72. Trên điện
     thoại khung chỉ rộng ~340px, để 0,72 là trang A4 (572px) thò ra ngoài rồi cuộn ngang. */
  const khungRef = useRef<HTMLDivElement>(null);
  const [ti, setTi] = useState(0.72);
  useEffect(() => {
    const k = khungRef.current;
    if (!k || typeof ResizeObserver === "undefined") return;
    const do_ = () => setTi(Math.min(0.72, Math.max(0.3, (k.clientWidth - 32) / TRANG_W)));
    do_();
    const ro = new ResizeObserver(do_);
    ro.observe(k);
    return () => ro.disconnect();
  }, []);

  /* Mặc định mở ra là hạng mục nhiều dòng nhất — đỡ một cú bấm cho việc hay làm nhất. */
  const dsHangMuc = useMemo(() => dsLoc(dong, "hangMuc"), [dong]);
  useEffect(() => {
    if (!hangMuc && dsHangMuc.length) setHangMuc(dsHangMuc[0].ten);
  }, [dsHangMuc, hangMuc]);

  const loc: BoLoc = useMemo(
    () => ({ hangMuc: loai === "hangMuc" ? hangMuc : "", vung, cum, pm, tim, duAn: chonDuAn }),
    [loai, hangMuc, vung, cum, pm, tim, chonDuAn],
  );

  /* Ô lọc đếm trên tập ĐÃ áp các lọc KHÁC — bấm vào là biết còn lại bao nhiêu, không phải đoán. */
  const demTren = useMemo(() => locDong(dong, { ...loc, vung: "", cum: "", pm: "", duAn: [] }), [dong, loc]);
  const dsVung = useMemo(() => dsLoc(demTren, "vung", (a, b) => rank(a) - rank(b)), [demTren, rank]);
  const dsCum = useMemo(() => dsLoc(locDong(demTren, { vung }), "cum"), [demTren, vung]);
  const dsPm = useMemo(() => dsLoc(locDong(demTren, { vung, cum }), "pm"), [demTren, vung, cum]);
  const dsDA = useMemo(() => dsDuAn(locDong(demTren, { vung, cum, pm })), [demTren, vung, cum, pm]);

  const ban = useMemo(
    () => dungBaoCao(dong, { loai, kieu, loc, rank, thuTuAbbr }),
    [dong, loai, kieu, loc, rank, thuTuAbbr],
  );

  useEffect(() => {
    const h = hostRef.current;
    if (!h) return;
    setSoTrang(xemTruoc(ban, h, { nguoiXuat }));
    return () => { h.textContent = ""; };
  }, [ban, nguoiXuat]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const xoaLoc = () => { setVung(""); setCum(""); setPm(""); setTim(""); setChonDuAn([]); };
  const coLoc = !!(vung || cum || pm || tim || chonDuAn.length);

  const doXuat = async () => {
    if (ban.soDong === 0) { toast.error("Bộ lọc đang không ra dòng nào."); return; }
    setDangXuat(true);
    try {
      const ten = await xuatPdf(ban, { nguoiXuat });
      toast.success(`Đã tải ${ten}`);
    } catch (e) {
      console.error("[Trạm báo cáo] xuất lỗi:", e);
      toast.error(`Xuất PDF lỗi: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDangXuat(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/55 p-0 sm:p-4">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-none bg-white shadow-2xl sm:rounded-lg">
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-2.5">
          <FileText className="h-4 w-4 text-[#A51C21]" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-bold text-slate-800">Trạm xuất báo cáo</div>
            <div className="truncate text-[11px] text-slate-500">
              {ban.soDong} dòng · {soTrang} trang A4
            </div>
          </div>
          <button onClick={doXuat} disabled={dangXuat || ban.soDong === 0}
            className="flex h-8 items-center gap-1.5 rounded-md bg-[#1F3864] px-3 text-[12px] font-semibold text-white hover:bg-[#162b4d] disabled:opacity-50">
            {dangXuat ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {dangXuat ? "Đang dựng…" : "Xuất PDF"}
          </button>
          <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* ── BÊN TRÁI: CHỌN ─────────────────────────────────────────────────────────── */}
          <div className="shrink-0 space-y-3 overflow-auto border-b border-slate-200 p-4 lg:w-[310px] lg:border-b-0 lg:border-r">
            <div>
              <span className={nhanLoc}>1 · Loại báo cáo</span>
              <div className="space-y-1.5">
                {LOAI.map((k) => (
                  <button key={k} onClick={() => setLoai(k)}
                    className={`block w-full rounded-md border px-2.5 py-1.5 text-left ${loai === k ? "border-[#1F3864] bg-[#1F3864]/5" : "border-slate-200 hover:border-slate-300"}`}>
                    <div className={`text-[12px] font-semibold ${loai === k ? "text-[#1F3864]" : "text-slate-700"}`}>{LOAI_META[k].ten}</div>
                    <div className="text-[10.5px] leading-tight text-slate-500">{LOAI_META[k].moTa}</div>
                  </button>
                ))}
              </div>
            </div>

            {loai === "hangMuc" && (
              <div>
                <span className={nhanLoc}>2 · Hạng mục</span>
                <select value={hangMuc} onChange={(e) => setHangMuc(e.target.value)} className={oLoc}>
                  <option value="">Tất cả hạng mục</option>
                  {dsHangMuc.map((h) => <option key={h.ten} value={h.ten}>{h.ten} ({h.so})</option>)}
                </select>
              </div>
            )}

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className={`${nhanLoc} mb-0`}>{loai === "hangMuc" ? 3 : 2} · Bộ lọc</span>
                {coLoc && <button onClick={xoaLoc} className="text-[10.5px] font-semibold text-slate-500 hover:text-slate-700">Xoá lọc</button>}
              </div>
              <div className="space-y-1.5">
                <select value={vung} onChange={(e) => { setVung(e.target.value); setCum(""); setPm(""); setChonDuAn([]); }} className={oLoc}>
                  <option value="">Tất cả vùng</option>
                  {dsVung.map((v) => <option key={v.ten} value={v.ten}>{v.ten} ({v.so})</option>)}
                </select>
                <select value={cum} onChange={(e) => { setCum(e.target.value); setChonDuAn([]); }} className={oLoc}>
                  <option value="">Tất cả cụm</option>
                  {dsCum.map((v) => <option key={v.ten} value={v.ten}>{v.ten} ({v.so})</option>)}
                </select>
                <select value={pm} onChange={(e) => { setPm(e.target.value); setChonDuAn([]); }} className={oLoc}>
                  <option value="">Tất cả PM</option>
                  {dsPm.map((v) => <option key={v.ten} value={v.ten}>{v.ten} ({v.so})</option>)}
                </select>
                <input value={tim} onChange={(e) => setTim(e.target.value)} placeholder="Tìm mã CT hoặc tên dự án…" className={oLoc} />
              </div>

              <button onClick={() => setMoDuAn((v) => !v)}
                className="mt-1.5 flex h-8 w-full items-center justify-between rounded-md border border-slate-300 px-2 text-[12px] text-slate-700 hover:border-teal-500">
                <span>{chonDuAn.length ? `${chonDuAn.length} dự án được chọn` : `Chọn dự án (${dsDA.length})`}</span>
                <span className="text-[9px] text-slate-400">{moDuAn ? "▲" : "▼"}</span>
              </button>
              {moDuAn && (
                <div className="mt-1 max-h-44 overflow-auto rounded-md border border-slate-200 p-1">
                  {dsDA.length === 0 && <div className="px-1.5 py-2 text-[11px] text-slate-400">Không còn dự án nào trong bộ lọc.</div>}
                  {dsDA.map((d) => {
                    const on = chonDuAn.includes(d.maCT);
                    return (
                      <label key={d.maCT} className="flex cursor-pointer items-start gap-1.5 rounded px-1.5 py-1 hover:bg-slate-50">
                        <input type="checkbox" checked={on} className="mt-0.5 h-3 w-3 accent-[#1F3864]"
                          onChange={() => setChonDuAn((p) => on ? p.filter((x) => x !== d.maCT) : [...p, d.maCT])} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11.5px] font-medium text-slate-700">{d.duAn}</span>
                          <span className="block text-[10px] text-slate-400">{d.maCT} · {d.vung}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <span className={nhanLoc}>{loai === "hangMuc" ? 4 : 3} · Cột số liệu bên phải</span>
              <div className="flex rounded-md border border-slate-300 p-0.5">
                {([["pct", "% tiến độ"], ["ma", "Số mã"]] as [KieuSo, string][]).map(([k, n]) => (
                  <button key={k} onClick={() => setKieu(k)}
                    className={`flex-1 rounded px-2 py-1 text-[11.5px] font-semibold ${kieu === k ? "bg-[#1F3864] text-white" : "text-slate-600 hover:bg-slate-50"}`}>
                    {n}
                  </button>
                ))}
              </div>
              {/* Nói thẳng giới hạn: ba giai đoạn kia không nhập số mã trong file nguồn. */}
              {kieu === "ma" && (
                <div className="mt-1 text-[10.5px] leading-tight text-amber-700">
                  Chỉ các hạng mục có nhập số mã trong file nguồn mới ra số; còn lại để trống.
                </div>
              )}
            </div>
          </div>

          {/* ── BÊN PHẢI: XEM TRƯỚC ────────────────────────────────────────────────────── */}
          <div ref={khungRef} className="min-h-0 flex-1 overflow-auto bg-slate-200 p-4">
            {/* Thu nhỏ bằng transform nên chiều cao thật KHÔNG co theo — phải đặt lại, không thì
                khung cuộn thừa ra một khoảng trắng dài bằng 28% số trang. */}
            <div className="mx-auto" style={{ width: TRANG_W * ti, height: soTrang ? (soTrang * TRANG_H + (soTrang - 1) * 14) * ti : 0 }}>
              <div ref={hostRef} style={{ width: TRANG_W, transform: `scale(${ti})`, transformOrigin: "top left" }} /></div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
