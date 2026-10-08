/**
 * Ô CHỌN DỰ ÁN GÕ-ĐỂ-LỌC.
 *
 * Anh Tiến 08/10/2026: *"chỉnh cái hình ảnh mỗi ngày á, tìm dự án khó quá, cho 1 cách nào hay hơn,
 * tìm theo tên chẳng hạn"* — kèm ảnh chụp ô xổ đang đổ ra hơn ba chục dòng phải cuộn tay.
 *
 * Ô xổ `<select>` của trình duyệt không gõ tìm được (gõ chỉ nhảy theo chữ cái đầu, mà tên dự án hay
 * bắt đầu bằng cùng một chữ: "Nam Phương…" có bốn dòng liền nhau). Nên thay bằng ô bấm ra bảng
 * chọn CÓ Ô GÕ TÌM.
 *
 * BA ĐIỀU KHÔNG ĐƯỢC BỎ, vì thiếu cái nào là dùng ức chế hơn ô xổ cũ:
 *   1. GÕ KHÔNG DẤU VẪN RA. Người gõ nhanh không bỏ dấu — "tay ho" phải ra "Tây Hồ". Dùng chung
 *      normProjName với mọi chỗ tìm khác của app, khỏi mỗi nơi khớp một kiểu.
 *   2. TÌM CẢ MÃ CT. Nhiều người nhớ mã chứ không nhớ tên.
 *   3. BÀN PHÍM ĐI ĐƯỢC. ↑ ↓ chạy, Enter chọn, Esc đóng. Mở ra là con trỏ nằm sẵn trong ô gõ —
 *      không phải bấm thêm một nhát nữa mới gõ được.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { normProjName } from "@/lib/vung";

export type MucChon = {
  /** Giá trị trả về khi chọn. */
  id: string;
  ten: string;
  maCT?: string;
  /** Tên nhóm để xếp vào ("Xem theo từng căn" / "Xem cả dự án"). Bỏ trống → không chia nhóm. */
  nhom?: string;
};

export function ChonDuAn({ muc, giaTri, onChon, mau = "sang", rong }: {
  muc: readonly MucChon[];
  giaTri: string;
  onChon: (id: string) => void;
  /** "sang" = nền trắng chữ đậm (dùng trên dải header xanh). */
  mau?: "sang";
  rong?: number | string;
}) {
  const [mo, setMo] = useState(false);
  const [q, setQ] = useState("");
  const [iSang, setISang] = useState(0);          // dòng đang sáng, cho bàn phím
  const hopRef = useRef<HTMLDivElement>(null);
  const oGoRef = useRef<HTMLInputElement>(null);

  const dangChon = muc.find((m) => m.id === giaTri);

  const loc = useMemo(() => {
    const k = normProjName(q);
    if (!k) return muc;
    return muc.filter((m) => `${normProjName(m.ten)} ${normProjName(m.maCT ?? "")}`.includes(k));
  }, [muc, q]);

  /* Chia nhóm NHƯNG GIỮ THỨ TỰ nhóm như thứ tự gặp trong danh sách gốc — đừng tự xếp lại, bên gọi
     đã có ý khi xếp ("Xem theo từng căn" trước, "Xem cả dự án" sau). */
  const theoNhom = useMemo(() => {
    const m = new Map<string, MucChon[]>();
    for (const x of loc) {
      const k = x.nhom ?? "";
      const a = m.get(k); if (a) a.push(x); else m.set(k, [x]);
    }
    return [...m.entries()];
  }, [loc]);

  /* Danh sách PHẲNG theo đúng thứ tự đang bày — bàn phím chạy trên cái này, nên nó phải khớp
     tuyệt đối với cái mắt thấy, nếu không ↓ một nhát lại nhảy sang dòng khác. */
  const phang = useMemo(() => theoNhom.flatMap(([, ds]) => ds), [theoNhom]);

  useEffect(() => { setISang(0); }, [q, mo]);

  useEffect(() => {
    if (!mo) return;
    oGoRef.current?.focus();
    const ngoai = (e: MouseEvent) => { if (!hopRef.current?.contains(e.target as Node)) setMo(false); };
    document.addEventListener("mousedown", ngoai);
    return () => document.removeEventListener("mousedown", ngoai);
  }, [mo]);

  const chon = (id: string) => { onChon(id); setMo(false); setQ(""); };

  const phim = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setMo(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setISang((i) => Math.min(i + 1, phang.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setISang((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter") { e.preventDefault(); const m = phang[iSang]; if (m) chon(m.id); }
  };

  const nhan = dangChon ? `${dangChon.ten}${dangChon.maCT ? ` · ${dangChon.maCT}` : ""}` : "(chưa chọn dự án)";

  return (
    <div ref={hopRef} style={{ position: "relative", flex: 1, minWidth: 0, maxWidth: rong ?? "100%" }}>
      <button type="button" onClick={() => setMo((v) => !v)} title={nhan}
        style={{ width: "100%", height: 40, borderRadius: 10, border: "none", padding: "0 34px 0 12px", fontSize: 14, fontWeight: 700,
          color: mau === "sang" ? "#0f172a" : "#fff", background: "#fff", textAlign: "left", cursor: "pointer",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", position: "relative" }}>
        {nhan}
        <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#64748b" }}>▾</span>
      </button>

      {mo && (
        <div style={{ position: "absolute", zIndex: 60, top: 44, left: 0, right: 0, minWidth: 280, background: "#fff", borderRadius: 10,
          boxShadow: "0 18px 44px rgba(15,23,42,.28)", border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <div style={{ padding: 8, borderBottom: "1px solid #e2e8f0" }}>
            <input ref={oGoRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={phim}
              placeholder="Gõ tên dự án hoặc mã CT…"
              style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, padding: "7px 10px", fontSize: 13.5, outline: "none", color: "#0f172a" }} />
          </div>

          <div style={{ maxHeight: 340, overflowY: "auto" }}>
            {!phang.length ? (
              /* Tìm hụt phải NÓI, đừng để bảng trắng rồi người ta tưởng hỏng. */
              <div style={{ padding: "14px 12px", fontSize: 12.5, color: "#64748b" }}>Không có dự án nào khớp “{q}”.</div>
            ) : theoNhom.map(([ten, ds]) => (
              <div key={ten || "_"}>
                {ten && (
                  <div style={{ position: "sticky", top: 0, background: "#f8fafc", padding: "5px 12px", fontSize: 11, fontWeight: 700,
                    color: "#64748b", textTransform: "uppercase", letterSpacing: ".04em", borderBottom: "1px solid #eef2f7" }}>{ten}</div>
                )}
                {ds.map((m) => {
                  const i = phang.indexOf(m);
                  const sang = i === iSang;
                  const dang = m.id === giaTri;
                  return (
                    <button key={m.id} type="button" onClick={() => chon(m.id)} onMouseEnter={() => setISang(i)}
                      style={{ display: "block", width: "100%", textAlign: "left", border: "none", cursor: "pointer",
                        background: sang ? "#eff6ff" : dang ? "#f8fafc" : "#fff", padding: "7px 12px", fontSize: 13,
                        color: "#0f172a", fontWeight: dang ? 700 : 500, borderLeft: `3px solid ${dang ? "#2563eb" : "transparent"}` }}>
                      {m.ten}
                      {m.maCT && <span style={{ color: "#94a3b8", fontWeight: 500 }}> · {m.maCT}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {muc.length > 8 && (
            <div style={{ padding: "5px 12px", borderTop: "1px solid #e2e8f0", fontSize: 11, color: "#94a3b8", background: "#f8fafc" }}>
              {phang.length}/{muc.length} dự án
            </div>
          )}
        </div>
      )}
    </div>
  );
}
