/**
 * TRỢ LÝ ePMP — GIAO DIỆN.
 *
 * Không phải ô chat dán thêm. Đây là LỚP HIỂU nằm trên app:
 *  · Máy tính  — nút nhỏ góc phải, mở ra PANEL BÊN PHẢI 400px, nới rộng được, không che bảng.
 *  · Điện thoại — tấm trượt từ đáy, kéo thành toàn màn.
 *  · Ctrl/⌘ + K mở, Esc đóng.
 *
 * NGỮ CẢNH LUÔN HIỆN Ở ĐẦU KHUNG: đang ở màn nào, lọc gì, mở dự án nào — và đổi được phạm vi
 * giữa "phần đang lọc" và "tất cả dự án". Người dùng nhìn là biết trợ lý đang đứng ở đâu, không
 * phải đoán.
 *
 * CÂU TRẢ LỜI KHÔNG PHẢI ĐOẠN VĂN: nó là các khối dựng thành giao diện — thẻ số, danh sách dự án
 * bấm được, nút đưa thẳng tới bộ lọc tương ứng. Trả lời xong là đi tới được, không phải đọc rồi
 * tự mò menu.
 *
 * MÀU và bo góc lấy của app (navy #1e3a5f), để trợ lý trông như một phần của app chứ không như
 * một cửa sổ lạ dán vào.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, X, Maximize2, Minimize2, ArrowUp, RotateCcw, ChevronRight } from "lucide-react";
import type { CauTraLoi, Khoi, Lenh, Mau, NguonHoi } from "./kieu";
import { traLoi } from "./hoi-dap";

const NAVY = "#1e3a5f";
const LS_LICH_SU = "pmo.troly.v1";

type Tin =
  | { ai: "nguoi"; chu: string }
  | { ai: "troly"; tra: CauTraLoi };

/* ── mấy mảnh vẽ ────────────────────────────────────────────────────────────── */

const MAU_NEN: Record<Mau, string> = {
  do: "border-red-200 bg-red-50 text-red-900",
  vang: "border-amber-200 bg-amber-50 text-amber-900",
  xanh: "border-emerald-200 bg-emerald-50 text-emerald-900",
  trung: "border-slate-200 bg-slate-50 text-slate-700",
};
const MAU_CHAM: Record<Mau, string> = { do: "bg-red-500", vang: "bg-amber-500", xanh: "bg-emerald-500", trung: "bg-slate-400" };

/** **đậm** và xuống dòng — đủ cho câu trả lời, không kéo cả bộ markdown vào gói. */
function ChuDam({ chu }: { chu: string }) {
  return (
    <>
      {chu.split("\n").map((dong, i) => (
        <span key={i} className="block">
          {dong.split(/(\*\*[^*]+\*\*)/g).map((m, j) =>
            m.startsWith("**") && m.endsWith("**")
              ? <b key={j} className="font-semibold text-slate-900">{m.slice(2, -2)}</b>
              : <span key={j}>{m}</span>)}
        </span>
      ))}
    </>
  );
}

function VeKhoi({ k, chayLenh }: { k: Khoi; chayLenh: (l: Lenh) => void }) {
  if (k.loai === "chu") return <p className="text-[12.5px] leading-relaxed text-slate-700"><ChuDam chu={k.chu} /></p>;

  if (k.loai === "nhac") {
    return (
      <div className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[12px] leading-relaxed ${MAU_NEN[k.mau]}`}>
        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${MAU_CHAM[k.mau]}`} />
        <span><ChuDam chu={k.chu} /></span>
      </div>
    );
  }

  if (k.loai === "the-so") {
    return (
      <div className="grid grid-cols-2 gap-1.5">
        {k.the.map((t, i) => (
          <div key={i} className={`rounded-lg border px-2.5 py-1.5 ${t.mau ? MAU_NEN[t.mau] : "border-slate-200 bg-white text-slate-700"}`}>
            <div className="text-[9.5px] font-semibold uppercase tracking-wide opacity-70">{t.nhan}</div>
            <div className="text-[15px] font-bold leading-tight tabular-nums">{t.gia}</div>
            {t.phu && <div className="text-[10px] opacity-75">{t.phu}</div>}
          </div>
        ))}
      </div>
    );
  }

  if (k.loai === "bang") {
    return (
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
              {k.cot.map((c, i) => <th key={i} className="px-2 py-1.5 font-semibold">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {k.dong.map((d, i) => (
              <tr key={i} className="border-t border-slate-100">
                {d.map((o, j) => <td key={j} className="px-2 py-1.5 text-slate-700">{o}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {k.ghiChu && <div className="border-t border-slate-100 px-2 py-1 text-[10.5px] text-slate-500">{k.ghiChu}</div>}
      </div>
    );
  }

  /* danh sách dự án — bấm là mở đúng dòng đó trên bảng */
  return (
    <div className="space-y-1">
      {k.ds.map((d) => (
        <button key={d.khoa} type="button" onClick={() => chayLenh({ kieu: "mo-du-an", khoa: d.khoa })}
          className="group flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left transition hover:border-slate-400 hover:bg-slate-50">
          {d.mau && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${MAU_CHAM[d.mau]}`} />}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-semibold text-slate-800">{d.ten}</span>
            <span className="block truncate text-[10.5px] text-slate-500">{d.maCT}{d.phu ? ` · ${d.phu}` : ""}</span>
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-slate-500" />
        </button>
      ))}
      {!!k.con && <div className="px-1 text-[11px] text-slate-500">còn {k.con} dự án nữa — bấm nút bên dưới để xem đủ trên bảng</div>}
    </div>
  );
}

/* ── khung chính ────────────────────────────────────────────────────────────── */

export function TroLy({ layNguon, chayLenh }: { layNguon: () => NguonHoi; chayLenh: (l: Lenh) => void }) {
  const [mo, setMo] = useState(false);
  const [rong, setRong] = useState(false);
  const [tin, setTin] = useState<Tin[]>([]);
  const [nhap, setNhap] = useState("");
  const [dangNghi, setDangNghi] = useState<string | null>(null);
  const [pham, setPham] = useState<"dang-loc" | "tat-ca">("dang-loc");
  const oCuon = useRef<HTMLDivElement>(null);
  const oNhap = useRef<HTMLTextAreaElement>(null);

  /* Ctrl/⌘+K mở, Esc đóng. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setMo((v) => !v); }
      else if (e.key === "Escape" && mo) setMo(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mo]);

  /* Nhớ vài câu gần nhất theo máy — mở lại không mất mạch. Hỏng thì bỏ qua. */
  useEffect(() => {
    try { const raw = localStorage.getItem(LS_LICH_SU); if (raw) setTin(JSON.parse(raw) as Tin[]); } catch { /* */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(LS_LICH_SU, JSON.stringify(tin.slice(-12))); } catch { /* */ }
  }, [tin]);

  useEffect(() => { if (mo) { oCuon.current?.scrollTo({ top: oCuon.current.scrollHeight, behavior: "smooth" }); oNhap.current?.focus(); } }, [mo, tin, dangNghi]);

  const hoi = useCallback(async (cau: string) => {
    const c = cau.trim();
    if (!c || dangNghi) return;
    setNhap("");
    setTin((t) => [...t, { ai: "nguoi", chu: c }]);
    // Trạng thái xử lý ở mức giao diện — nói đang làm gì, KHÔNG bày cách nghĩ.
    const n = { ...layNguon() };
    n.nguCanh = { ...n.nguCanh, pham };
    setDangNghi("Đọc dữ liệu đang bày…");
    await new Promise((r) => setTimeout(r, 160));
    setDangNghi(`Đối chiếu ${n.duAn.length} dự án…`);
    await new Promise((r) => setTimeout(r, 200));
    const tra = traLoi(c, n);
    setDangNghi(null);
    setTin((t) => [...t, { ai: "troly", tra }]);
  }, [dangNghi, layNguon, pham]);

  const nc = mo ? layNguon().nguCanh : null;
  const TEN_MAN: Record<string, string> = { "danh-sach": "Việc cần xử lý", "tong-the": "Tổng thể tiến độ", mtld: "MTLĐ", khac: "ePMP" };

  /* Câu gợi ý ĐỔI THEO chỗ đang đứng. */
  const goiYDau = nc?.duAnDangMo
    ? [`${nc.duAnDangMo.ten} thế nào rồi?`, "Dự án này có gì cần xử lý?", "Cú pháp ghi cần trình BOD thế nào?"]
    : nc?.man === "tong-the"
      ? ["Dự án nào đang trễ?", "Bàn giao tháng sau có gì?", "Cách sắp xếp bảng theo cột"]
      : nc?.man === "mtld"
        ? ["Màn MTLĐ dùng để làm gì?", "Dự án nào chưa gắn báo cáo?", "Tổng quan hôm nay"]
        : ["Tổng quan hôm nay", "Dự án nào đang trễ?", "Dự án nào cần trình BOD?", "Bàn giao tháng sau có gì?"];

  return (
    <>
      {/* NÚT MỞ — nhỏ, nép góc, không che nội dung. Ẩn khi in. */}
      {!mo && (
        <button type="button" onClick={() => setMo(true)} title="Trợ lý ePMP (Ctrl+K)"
          className="fixed bottom-4 right-4 z-[60] flex h-11 items-center gap-2 rounded-full pl-3 pr-4 text-[12.5px] font-semibold text-white shadow-lg transition hover:brightness-110 print:hidden"
          style={{ background: NAVY }}>
          <Sparkles className="h-4 w-4" />
          Trợ lý
        </button>
      )}

      {mo && (
        <>
          {/* Nền mờ CHỈ trên điện thoại — máy tính giữ bảng nhìn được, panel không chặn thao tác. */}
          <div className="fixed inset-0 z-[59] bg-slate-900/30 sm:hidden" onClick={() => setMo(false)} />
          <aside
            className={`fixed z-[60] flex flex-col overflow-hidden border-slate-200 bg-white shadow-2xl print:hidden
              inset-x-0 bottom-0 top-[12%] rounded-t-2xl border-t
              sm:inset-y-0 sm:left-auto sm:right-0 sm:top-0 sm:rounded-none sm:border-l ${rong ? "sm:w-[560px]" : "sm:w-[400px]"}`}>

            {/* ── ĐẦU KHUNG ── */}
            <header className="shrink-0 text-white" style={{ background: NAVY }}>
              <div className="flex items-center gap-2 px-3 py-2.5">
                <Sparkles className="h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold leading-tight">Trợ lý ePMP</div>
                  <div className="text-[10px] leading-tight text-white/70">hỏi về dữ liệu và cách dùng app</div>
                </div>
                <button type="button" onClick={() => setRong((v) => !v)} title={rong ? "Thu hẹp" : "Nới rộng"}
                  className="hidden rounded p-1 text-white/80 hover:bg-white/15 hover:text-white sm:block">
                  {rong ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                </button>
                <button type="button" onClick={() => setMo(false)} title="Đóng (Esc)" className="rounded p-1 text-white/80 hover:bg-white/15 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* NGỮ CẢNH — trợ lý đang đứng ở đâu, và tính trên phạm vi nào. */}
              {nc && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/15 px-3 py-1.5 text-[10.5px] text-white/85">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {TEN_MAN[nc.man] ?? "ePMP"}
                  </span>
                  {nc.duAnDangMo && <span className="truncate rounded bg-white/15 px-1.5 py-0.5">đang mở: {nc.duAnDangMo.ten}</span>}
                  {nc.boLoc.length > 0 && <span className="truncate">{nc.boLoc.join(" · ")}</span>}
                  <span className="ml-auto inline-flex overflow-hidden rounded border border-white/25">
                    {(["dang-loc", "tat-ca"] as const).map((p) => (
                      <button key={p} type="button" onClick={() => setPham(p)}
                        title={p === "dang-loc" ? "Tính trên phần bảng đang hiện" : "Tính trên tất cả dự án"}
                        className={`px-1.5 py-0.5 ${pham === p ? "bg-white text-[#1e3a5f] font-semibold" : "text-white/80 hover:bg-white/10"}`}>
                        {p === "dang-loc" ? `đang lọc (${nc.dongDangHien})` : "tất cả"}
                      </button>
                    ))}
                  </span>
                </div>
              )}
            </header>

            {/* ── HỘI THOẠI ── */}
            <div ref={oCuon} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 px-3 py-3">
              {tin.length === 0 && (
                <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="text-[13px] font-semibold text-slate-800">Hỏi tôi bất cứ gì về ePMP</div>
                  <p className="text-[12px] leading-relaxed text-slate-600">
                    Tôi đọc đúng con số app đang bày và luôn nói số lấy từ đâu. Không chắc thì tôi nói thẳng là chưa biết chứ không đoán.
                  </p>
                </div>
              )}

              {tin.map((t, i) => t.ai === "nguoi" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm px-3 py-1.5 text-[12.5px] text-white" style={{ background: NAVY }}>{t.chu}</div>
                </div>
              ) : (
                <div key={i} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="text-[13px] font-bold leading-snug text-slate-900">{t.tra.tieuDe}</div>
                  {t.tra.khoi.map((k, j) => <VeKhoi key={j} k={k} chayLenh={chayLenh} />)}
                  {!!t.tra.hanhDong?.length && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {t.tra.hanhDong.map((h, j) => (
                        <button key={j} type="button" onClick={() => { chayLenh(h.lenh); setMo(false); }}
                          className="rounded-md px-2.5 py-1 text-[11.5px] font-semibold text-white transition hover:brightness-110"
                          style={{ background: NAVY }}>{h.nhan}</button>
                      ))}
                    </div>
                  )}
                  {t.tra.nguon && <div className="border-t border-slate-100 pt-1.5 text-[10.5px] text-slate-500">Số lấy từ: {t.tra.nguon}</div>}
                  {!!t.tra.goiY?.length && (
                    <div className="flex flex-wrap gap-1.5">
                      {t.tra.goiY.map((g, j) => (
                        <button key={j} type="button" onClick={() => void hoi(g)}
                          className="rounded-full border border-slate-300 px-2.5 py-1 text-[11px] text-slate-600 transition hover:border-slate-500 hover:text-slate-900">{g}</button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {dangNghi && (
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-500">
                  <span className="flex gap-1">
                    {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" style={{ animationDelay: `${i * 140}ms` }} />)}
                  </span>
                  {dangNghi}
                </div>
              )}

              {tin.length === 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {goiYDau.map((g) => (
                    <button key={g} type="button" onClick={() => void hoi(g)}
                      className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11.5px] text-slate-700 transition hover:border-slate-500 hover:bg-slate-50">{g}</button>
                  ))}
                </div>
              )}
            </div>

            {/* ── Ô NHẬP ── */}
            <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-2">
              <div className="flex items-end gap-2">
                <textarea ref={oNhap} rows={1} value={nhap} onChange={(e) => setNhap(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void hoi(nhap); } }}
                  placeholder="Hỏi về dự án, master plan, hay cách dùng app…"
                  className="max-h-24 min-h-[36px] flex-1 resize-none rounded-lg border border-slate-300 px-2.5 py-2 text-[12.5px] outline-none placeholder:text-slate-400 focus:border-slate-500" />
                <button type="button" onClick={() => void hoi(nhap)} disabled={!nhap.trim() || !!dangNghi} title="Gửi (Enter)"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white transition disabled:opacity-35"
                  style={{ background: NAVY }}>
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
                <span>Enter để gửi · Shift+Enter xuống dòng</span>
                {tin.length > 0 && (
                  <button type="button" onClick={() => setTin([])} className="ml-auto inline-flex items-center gap-1 hover:text-slate-700">
                    <RotateCcw className="h-3 w-3" />hội thoại mới
                  </button>
                )}
              </div>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
