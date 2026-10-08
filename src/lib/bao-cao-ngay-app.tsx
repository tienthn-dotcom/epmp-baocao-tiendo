/**
 * BÁO CÁO TUÂN THỦ MỖI NGÀY — màn hình.
 *
 * Anh Tiến 07/10/2026: *"tôi vẫn chưa thấy báo cáo tuân thủ mỗi ngày đâu nhé, triển khai dần đi"*.
 * Đây là bước 2 (bước 1 là cho bộ đọc chạy được trên file thật — xem tests/bcn-file-that.test.ts).
 *
 * BÀY GÌ: mỗi dự án BA dòng (Quân số · Thi công lắp đặt · Sản lượng), mỗi ngày một cột dấu.
 *
 * VÌ SAO CUỘN NGANG, GHIM CỘT TRÁI: một tháng là 31 cột ngày, cộng tên dự án và PM thì bảng tràn
 * ở mọi bề ngang màn hình. Gói theo tuần rồi bấm xổ thì gọn hơn, nhưng mất cái nhìn liền mạch cả
 * tháng — mà nhìn liền mạch mới thấy được ai trễ dồn vào mấy ngày nào. Nên cuộn ngang, và GHIM
 * cột trái để cuộn tới đâu cũng còn biết đang đọc dòng của ai.
 *
 * SỐ LIỆU ĐỌC THẲNG TỪ FILE NGUỒN, app KHÔNG chấm lại — giống hệt bản tháng. Điểm, dấu, mốc giờ,
 * chú thích đều là của file. App chỉ bày.
 */
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, RefreshCw, ExternalLink, AlertTriangle, FileDown } from "lucide-react";
import { taiBangCham, BCN_FILE_URL } from "@/lib/bcn-tai";
import type { BcnDuAn, BcnMark } from "@/lib/bcn-file";
import { diemPm } from "@/lib/bcn-file";
import { fetchLuotXuatPdf } from "@/lib/cham-pdf.functions";
import { gomLuot, dauCuaNgay, NGAY_BAT_DAU_CHAM } from "@/lib/cham-theo-pdf";
import { loiNoi } from "@/lib/loi-noi";
import { track } from "@/lib/track";

/* DẤU — LẤY ĐÚNG BỘ CỦA BÁO CÁO TUÂN THỦ THÁNG (ComplianceMark trong routes/index.tsx), để hai
   báo cáo đọc như một: ✓ xanh lùi lại, o vàng, ✕ đỏ đậm nổi bật, – xám nhạt.

   GLYPH KÝ TỰ, KHÔNG ICON SVG — và đây không phải chuyện thẩm mỹ: html2canvas (thứ dựng bản PDF)
   render SVG không ổn định, dấu ✓/✕ bị méo hoặc mất hẳn trong file xuất ra. Bản tháng đã vấp và
   đã ghi lại; đừng đổi sang icon.

   KHÔNG TÔ NỀN Ô: 31 cột ngày mà ô nào cũng có nền thì bảng thành tấm chăn vá, nhìn không ra chỗ
   cần chú ý. Chỉ ✕ mới có nền nhạt — nó là ngoại lệ cần đập vào mắt. */
const MAU_DAU: Record<Exclude<BcnMark, null>, { nen?: string; chu: string; ky: string; co: number; dam: number }> = {
  P: { chu: "#10b981", ky: "✓", co: 13, dam: 700 },
  o: { chu: "#f59e0b", ky: "o", co: 17, dam: 900 },
  x: { chu: "#dc2626", ky: "✕", co: 13, dam: 700, nen: "#fef2f2" },
  na: { chu: "#cbd5e1", ky: "–", co: 11, dam: 400 },
};

const mauDiem = (d: number | null): string =>
  d == null ? "#94a3b8" : d >= 90 ? "#15803d" : d >= 75 ? "#b45309" : "#b91c1c";

/** Cột ngày của CHỦ NHẬT tô nền xám — ngày không chấm, để mắt khỏi đọc nhầm ô trống thành bỏ sót. */
const laChuNhat = (thu: string) => /^cn$/i.test(thu.trim());

/** "TCLĐ" và "Thi công lắp đặt" là MỘT (anh Tiến chốt 08/10/2026) — nhận cả hai cách gõ trong file. */
const laTcld = (ten: string) => /tcl[đd]|thi\s*c[ôo]ng\s*l[ắa]p\s*[đd][ặa]t/i.test(ten);

export function BaoCaoNgayDialog({ onClose }: { onClose: () => void }) {
  const [bump, setBump] = useState(0);
  /* HAI REF CHO BẢN PDF: khối đầu báo cáo và bảng. Bộ máy xuất (lib/pdf-export.ts) CHỤP chính hai
     phần tử này — dùng lại đúng đường của báo cáo tuân thủ tháng, nên bản ngày ra cùng một khuôn:
     cùng lề, cùng cách cắt trang, cùng cỡ chữ. */
  const refDau = useRef<HTMLDivElement>(null);
  const refBang = useRef<HTMLTableElement>(null);
  const [dangXuat, setDangXuat] = useState(false);
  const [ketQuaXuat, setKetQuaXuat] = useState("");
  const q = useQuery({
    queryKey: ["bcn-bang-cham", bump],
    queryFn: () => taiBangCham(bump > 0),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const d = q.data?.data;
  const diemCuaPm = useMemo(() => (d ? diemPm(d.duAn) : new Map<string, number>()), [d]);

  /* ── DẤU SUY RA TỪ LƯỢT XUẤT PDF ───────────────────────────────────────────
     Anh Tiến 08/10/2026: *"nút xuất PDF TCLĐ của dự án đi, cứ xuất = báo cáo"*.
     Bày thành MỘT DÒNG RIÊNG dưới ba hạng mục đọc từ file, KHÔNG đè lên dòng "Thi công lắp đặt".
     Hai nguồn đang chạy song song nên phải nhìn thấy cả hai mới biết chúng có khớp nhau không;
     đè lên là mất luôn cái đối chứng, mà đây là bảng chấm người. */
  const thangIso = useMemo(() => {
    const m = /^(\d{2})\/(\d{4})$/.exec(d?.thangLabel ?? "");
    return m ? `${m[2]}-${m[1]}` : "";
  }, [d?.thangLabel]);

  const qPdf = useQuery({
    queryKey: ["bcn-luot-pdf", thangIso],
    queryFn: () => fetchLuotXuatPdf({ data: { thang: thangIso } }),
    enabled: !!thangIso,
    staleTime: 60_000,
  });
  const bangPdf = useMemo(() => gomLuot(qPdf.data?.luot ?? []), [qPdf.data]);
  /* Mốc "bây giờ" ghim một lần mỗi lần mở: để nó chạy theo đồng hồ thì bảng tự đổi dấu giữa lúc
     đang xem, mà người xem không hiểu vì sao. */
  const [bayGio] = useState(() => Date.now());
  /* Khoá ghép hai bên: mã CT bỏ khoảng trắng, chữ HOA. File chấm và app gõ mã khác kiểu
     ("CT25-040, 038" vs "CT25-040,038"), còn tên dự án thì khác hẳn nhau nên không ghép theo tên. */
  const chuanMa = (s: string) => s.replace(/\s+/g, "").toUpperCase();
  const bangPdfTheoMa = useMemo(() => {
    const m = new Map<string, Map<string, "P" | "o" | "x">>();
    for (const [k, v] of bangPdf) m.set(chuanMa(k), v);
    return m;
  }, [bangPdf]);

  /* Dự án CHƯA CÓ DẤU NÀO xếp xuống cuối: đầu bảng để dành cho chỗ thật sự có gì để xem. Trong
     mỗi nhóm thì điểm thấp lên trước — người cần nhắc nằm trên cùng, giống bản tháng. */
  const duAnXep = useMemo(() => {
    if (!d) return [] as BcnDuAn[];
    return [...d.duAn].sort((a, b) => {
      const ca = a.diem == null ? 1 : 0, cb = b.diem == null ? 1 : 0;
      if (ca !== cb) return ca - cb;
      if (a.diem != null && b.diem != null && a.diem !== b.diem) return a.diem - b.diem;
      return (a.stt ?? 9999) - (b.stt ?? 9999);
    });
  }, [d]);

  const soNgayCoDau = useMemo(() => {
    if (!d) return 0;
    const co = new Set<number>();
    for (const p of d.duAn) for (const h of p.hangMuc) h.marks.forEach((m, i) => { if (m) co.add(i); });
    return co.size;
  }, [d]);

  /* XUẤT PDF — dùng LẠI bộ máy của báo cáo tuân thủ tháng (exportDashboardPdf), không viết bản
     thứ hai. Hai báo cáo ra cùng một khuôn, và mọi thứ bản tháng đã vấp rồi sửa (lề, cắt trang
     theo ranh giới hàng, glyph thay icon) thì bản ngày hưởng luôn.
     KHỔ NGANG: 31 cột ngày, khổ dọc thì chữ nhỏ tới mức không đọc nổi.
     TÊN FILE theo khuôn PMO đã chốt 05/10/2026: yymmdd_Tên cố định_MM.YYYY */
  const xuatPdf = async () => {
    if (!refBang.current || dangXuat) return;
    setDangXuat(true);
    try {
      const { exportDashboardPdf } = await import("@/lib/pdf-export");
      /* BỎ KHỐI CÓ BỀ NGANG 0. html2canvas chụp khối rộng 0 ra ảnh rỗng, rồi jsPDF chia cho 0 và
         ném "Invalid argument passed to jsPDF.scale" — bản PDF hỏng hẳn chứ không chỉ thiếu phần
         đầu. Khối đầu nằm trong hàng flex nên có lúc đo ra 0 (đo thật 08/10/2026: 0 × 794).
         Thà PDF thiếu dòng tiêu đề còn hơn không có PDF. */
      const khoi = [refDau.current].filter((el): el is HTMLDivElement => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      });
      const n = new Date();
      const p2 = (x: number) => String(x).padStart(2, "0");
      const yymmdd = `${String(n.getFullYear()).slice(2)}${p2(n.getMonth() + 1)}${p2(n.getDate())}`;
      const ky = d?.thangLabel ? d.thangLabel.replace("/", ".") : `${p2(n.getMonth() + 1)}.${n.getFullYear()}`;
      const r = await exportDashboardPdf({
        blocks: khoi,
        table: refBang.current,
        wide: true, orientation: "landscape", tableFitOnePage: true,
        fileName: `${yymmdd}_Báo cáo tuân thủ hằng ngày_${ky}.pdf`,
      });
      setKetQuaXuat(`Đã tải bản PDF · ${r.pages} trang`);
      window.setTimeout(() => setKetQuaXuat(""), 6000);
      track("export_pdf", `Báo cáo tuân thủ hằng ngày${d?.thangLabel ? ` tháng ${d.thangLabel}` : ""}`);
    } catch (e) {
      /* Không nuốt lặng: người bấm phải biết nó hỏng, chứ không phải đứng chờ một file không bao giờ tới. */
      setKetQuaXuat(`Không dựng được PDF: ${loiNoi(e)}`);
    } finally { setDangXuat(false); }
  };

  const oNen: React.CSSProperties = { position: "sticky", background: "#fff", zIndex: 2 };
  const th: React.CSSProperties = { padding: "6px 8px", fontSize: 11.5, fontWeight: 700, color: "#334155", borderBottom: "2px solid #0f172a", whiteSpace: "nowrap", textAlign: "left" };
  const td: React.CSSProperties = { padding: "4px 8px", fontSize: 12, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" };

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 12, width: "min(1500px, 100%)", height: "min(900px, 100%)", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,.35)" }}>

        {/* ── ĐẦU BÁO CÁO ─────────────────────────────────────────────── */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div ref={refDau} style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: "#0f172a" }}>
              Đánh giá tuân thủ báo cáo hằng ngày{d?.thangLabel ? ` · Tháng ${d.thangLabel}` : ""}
            </div>
            <div style={{ marginTop: 3, fontSize: 11.5, color: "#64748b", display: "flex", gap: 14, flexWrap: "wrap" }}>
              {d?.ngayCapNhat && <span>Dữ liệu tính đến <b style={{ color: "#334155" }}>{d.ngayCapNhat}</b></span>}
              {d && <span>{d.duAn.length} dự án · {d.ngay.length} ngày · đã chấm {soNgayCoDau} ngày</span>}
            </div>
            {d?.mocGio && <div style={{ marginTop: 4, fontSize: 11.5, color: "#475569" }}>{d.mocGio}</div>}
            {/* Phản hồi cho chính thao tác người dùng vừa bấm — tự tắt sau vài giây. */}
            {ketQuaXuat && <div style={{ marginTop: 4, fontSize: 11.5, fontWeight: 600, color: ketQuaXuat.startsWith("Không") ? "#b91c1c" : "#15803d" }}>{ketQuaXuat}</div>}
            {/* KHÔNG bày chuyện nội bộ (app bắt đầu ghi từ ngày nào, đã ghi nhận mấy lượt) lên đây —
                người xem báo cáo không cần biết, và nó làm loãng phần số liệu. */}
          </div>
          <button type="button" onClick={xuatPdf} disabled={dangXuat || !d}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid #0f172a", borderRadius: 7, padding: "5px 10px", fontSize: 12, fontWeight: 700, background: "#0f172a", color: "#fff", cursor: dangXuat || !d ? "default" : "pointer", opacity: dangXuat || !d ? 0.5 : 1 }}>
            <FileDown className="h-3.5 w-3.5" /> {dangXuat ? "Đang dựng…" : "Xuất PDF"}
          </button>
          <button type="button" onClick={() => { setBump((n) => n + 1); track("bcn_lam_moi", ""); }}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid #cbd5e1", borderRadius: 7, padding: "5px 10px", fontSize: 12, fontWeight: 600, background: "#fff", cursor: "pointer" }}>
            <RefreshCw className="h-3.5 w-3.5" /> Làm mới
          </button>
          <a href={BCN_FILE_URL} target="_blank" rel="noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid #cbd5e1", borderRadius: 7, padding: "5px 10px", fontSize: 12, fontWeight: 600, color: "#334155", textDecoration: "none" }}>
            <ExternalLink className="h-3.5 w-3.5" /> File nguồn
          </a>
          <button type="button" onClick={onClose} aria-label="Đóng"
            style={{ border: "none", background: "transparent", cursor: "pointer", color: "#64748b", padding: 4 }}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── BẢNG ────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {q.isPending ? (
            <div style={{ padding: 24, color: "#64748b", fontSize: 13 }}>Đang tải bảng chấm…</div>
          ) : q.isError ? (
            <div style={{ padding: 24, color: "#b91c1c", fontSize: 13, display: "flex", gap: 8, alignItems: "flex-start" }}>
              <AlertTriangle className="h-4 w-4" style={{ marginTop: 2, flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 700 }}>Chưa đọc được file nguồn.</div>
                <div style={{ marginTop: 3 }}>{loiNoi(q.error)}</div>
              </div>
            </div>
          ) : !d || !d.duAn.length ? (
            <div style={{ padding: 24, color: "#64748b", fontSize: 13 }}>
              File nguồn chưa có dòng dự án nào đọc được. Kiểm tra lại tab bảng chấm.
            </div>
          ) : (
            <table ref={refBang} style={{ borderCollapse: "separate", borderSpacing: 0, width: "max-content", minWidth: "100%" }}>
              <thead>
                <tr>
                  {/* GHIM BA CỘT TRÁI — cuộn ngang tới cuối tháng vẫn biết đang đọc dòng của ai. */}
                  <th style={{ ...th, ...oNen, left: 0, minWidth: 210, borderRight: "1px solid #cbd5e1" }}>Dự án</th>
                  <th style={{ ...th, ...oNen, left: 210, minWidth: 150, borderRight: "1px solid #cbd5e1" }}>PM</th>
                  <th style={{ ...th, ...oNen, left: 360, minWidth: 132, borderRight: "2px solid #0f172a" }}>Hạng mục</th>
                  {d.ngay.map((n, i) => (
                    <th key={i} style={{ ...th, textAlign: "center", minWidth: 30, background: laChuNhat(n.thu) ? "#f1f5f9" : undefined }}>
                      <div style={{ fontSize: 9.5, fontWeight: 600, color: "#94a3b8" }}>{n.thu}</div>
                      <div>{n.so}</div>
                    </th>
                  ))}
                  <th style={{ ...th, textAlign: "center", minWidth: 52, borderLeft: "2px solid #0f172a" }}>Điểm</th>
                </tr>
              </thead>
              <tbody>
                {duAnXep.map((p, pi) => {
                  /* DÒNG THỨ TƯ: dấu suy ra từ lượt xuất PDF. Dựng thành một "hạng mục ảo" để nó đi
                     chung đường vẽ với ba hạng mục thật — khỏi có hai nhánh render dễ lệch nhau. */
                  /* TCLĐ = "Thi công lắp đặt", MỘT DÒNG — anh Tiến chốt 08/10/2026 ("gộp đi").
                     Dấu của dòng đó nay suy ra từ lượt xuất PDF, KHÔNG đọc từ file nữa.

                     CÒN TRỐNG THÌ LẤY DẤU CŨ CỦA FILE. Nhật ký chỉ có từ 08/10, nên nếu bỏ hẳn dấu
                     file thì mọi ngày trước đó trắng bong — xoá sạch phần đã chấm tay bao lâu nay.
                     Vậy: có dấu theo PDF thì dùng, không có thì rơi về dấu file. Từ ngày app bắt
                     đầu ghi trở đi, PDF quyết — kể cả khi nó ra ✕ vì không ai bấm xuất. */
                  const ma = chuanMa(p.maCT);
                  const hangMucVe = p.hangMuc.map((h) => {
                    if (!laTcld(h.ten)) return h;
                    return { ...h, marks: h.marks.map((m, i) => (
                      (thangIso ? dauCuaNgay(bangPdfTheoMa, ma, `${thangIso}-${d.ngay[i].so}`, bayGio) : null) ?? m
                    )) };
                  });
                  return hangMucVe.map((h, hi) => {
                  const dau = hi === 0;                       // dòng đầu của cụm → kẻ đậm phía trên
                  const vien = dau && pi > 0 ? "2px solid #cbd5e1" : undefined;
                  const laPdf = "theoPdf" in h;
                  return (
                    <tr key={`${pi}-${hi}`}>
                      {dau && (
                        <>
                          <td rowSpan={p.hangMuc.length} style={{ ...td, ...oNen, left: 0, borderRight: "1px solid #cbd5e1", borderTop: vien, verticalAlign: "top" }}>
                            <div style={{ fontWeight: 700, color: "#0f172a", whiteSpace: "normal", maxWidth: 200 }}>{p.ten}</div>
                            <div style={{ fontSize: 10.5, color: "#94a3b8", fontFamily: "ui-monospace,monospace" }}>{p.maCT}</div>
                          </td>
                          <td rowSpan={p.hangMuc.length} style={{ ...td, ...oNen, left: 210, borderRight: "1px solid #cbd5e1", borderTop: vien, verticalAlign: "top", color: "#334155" }}>
                            <div style={{ whiteSpace: "normal", maxWidth: 140 }}>{p.pm}</div>
                            {diemCuaPm.has(p.pm) && (
                              <div style={{ fontSize: 10.5, color: mauDiem(diemCuaPm.get(p.pm) ?? null), fontWeight: 700 }}>
                                TB {diemCuaPm.get(p.pm)}
                              </div>
                            )}
                          </td>
                        </>
                      )}
                      <td style={{ ...td, ...oNen, left: 360, borderRight: "2px solid #0f172a", borderTop: vien, color: "#475569" }}>{h.ten}</td>
                      {h.marks.map((m, i) => {
                        const cn = laChuNhat(d.ngay[i]?.thu ?? "");
                        const mau = m ? MAU_DAU[m] : null;
                        return (
                          <td key={i} style={{ ...td, borderTop: vien, textAlign: "center", padding: "4px 2px",
                            background: mau?.nen ?? (cn ? "#f8fafc" : undefined),
                            color: mau ? mau.chu : "#e2e8f0", fontSize: mau ? mau.co : 12, fontWeight: mau ? mau.dam : 400, lineHeight: 1 }}>
                            {mau ? mau.ky : ""}
                          </td>
                        );
                      })}
                      <td style={{ ...td, borderTop: vien, borderLeft: "2px solid #0f172a", textAlign: "center", fontWeight: 700,
                        color: mauDiem(h.diem), background: laPdf ? "#f0f9ff" : undefined }}>
                        {laPdf ? "" : (h.diem ?? "–")}
                      </td>
                    </tr>
                  );
                  });
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── CHÚ THÍCH — nguyên văn của file, KHÔNG gõ lại trong code ──── */}
        {d && (d.chuThich.length > 0 || d.cachTinh.length > 0) && (
          <div style={{ borderTop: "1px solid #e2e8f0", padding: "8px 16px", fontSize: 11.5, color: "#475569", display: "flex", gap: 18, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", gap: 10 }}>
              {(Object.keys(MAU_DAU) as Exclude<BcnMark, null>[]).map((k) => (
                <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ color: MAU_DAU[k].chu, fontSize: MAU_DAU[k].co, fontWeight: MAU_DAU[k].dam, lineHeight: 1 }}>{MAU_DAU[k].ky}</span>
                  {k === "P" ? "đúng hạn" : k === "o" ? "trễ" : k === "x" ? "không báo cáo" : "không áp dụng"}
                </span>
              ))}
            </span>
            {d.cachTinh.map((t, i) => <span key={i}>{t}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}
