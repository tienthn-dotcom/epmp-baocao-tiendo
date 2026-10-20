/**
 * APP "BÁO CÁO" — thanh trái (app-shell). Anh Tiến 19/10/2026: *"lập riêng 1 mảng cho báo cáo luôn,
 * này là báo cáo tuân thủ tổng hợp, còn mảng báo cáo bộ lọc theo template […] tạo thành 1 app riêng
 * nằm bên cột bên trái"*.
 *
 * Hai mảng:
 *   1. Tuân thủ tổng hợp — bảng điểm ngày + tuần + tháng (bang-diem-tong-hop-app.tsx); PDF dựng đúng
 *      form sheet anh Tiến chỉnh 19/10/2026 (bao-cao-tong-hop-form.ts).
 *   2. Xuất theo bộ lọc — Trạm xuất báo cáo (tram-bao-cao-app.tsx, mẫu công ty logo AA), dữ liệu lấy từ màn ePMP qua
 *      bao-cao-nguon.ts.
 * Hai màn này vẫn mở được từ menu Hệ thống của ePMP như cũ.
 */
import { useState } from "react";
import { ClipboardCheck, FileText, Loader2 } from "lucide-react";
import { BangDiemTongHopDialog } from "@/lib/bang-diem-tong-hop-app";
import TramBaoCao from "@/lib/tram-bao-cao-app";
import { useNguonTram } from "@/lib/bao-cao-nguon";
import { vungRank } from "@/lib/vung";
import { track } from "@/lib/track";

type Mang = "tuanthu" | "boloc";
const MANG: { id: Mang; ten: string; moTa: string; icon: React.ReactNode }[] = [
  { id: "tuanthu", ten: "Tuân thủ tổng hợp", moTa: "Báo cáo ngày · tuần · tháng", icon: <ClipboardCheck className="h-4 w-4" /> },
  { id: "boloc", ten: "Xuất theo bộ lọc", moTa: "Hạng mục · vùng · PM · dự án", icon: <FileText className="h-4 w-4" /> },
];

export function BaoCaoApp({ onMoEpmp }: { onMoEpmp?: () => void }) {
  const [mang, setMang] = useState<Mang>("tuanthu");
  const nguon = useNguonTram();

  return (
    <div className="flex h-screen min-h-0 flex-col bg-slate-100">
      {/* ── ĐẦU APP: tên + chọn mảng ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-3 py-2 sm:px-4">
        <div className="flex items-center gap-2">
          <span className="inline-block h-6 w-1.5 rounded-full bg-[#A51C21]" />
          <div>
            <div className="text-[15px] font-extrabold leading-tight text-[#1F3864]">Báo cáo</div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">OCC · Xuất theo mẫu công ty</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {MANG.map((m) => (
            <button key={m.id} onClick={() => { setMang(m.id); track("bao_cao_mang", m.id); }}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left transition ${mang === m.id ? "border-[#1F3864] bg-[#1F3864] text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}>
              {m.icon}
              <span>
                <span className="block text-[12px] font-bold leading-tight">{m.ten}</span>
                <span className={`block text-[10px] leading-tight ${mang === m.id ? "text-white/70" : "text-slate-400"}`}>{m.moTa}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── NỘI DUNG MẢNG ── */}
      <div className="flex min-h-0 flex-1 flex-col p-2 sm:p-3">
        {mang === "tuanthu" ? (
          <BangDiemTongHopDialog nhung />
        ) : nguon && nguon.dong.length ? (
          <TramBaoCao nhung dong={nguon.dong} rank={vungRank} thuTuAbbr={nguon.thuTuAbbr} nguoiXuat={nguon.nguoiXuat} onClose={() => setMang("tuanthu")} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-slate-200 bg-white p-6 text-center">
            {nguon ? (
              <div className="text-sm text-slate-600">Dữ liệu Master Plan chưa có đầu việc nào để xuất.</div>
            ) : (
              <>
                <Loader2 className="mb-2 h-5 w-5 animate-spin text-slate-400" />
                <div className="text-sm font-semibold text-slate-700">Chưa có dữ liệu Master Plan</div>
                <div className="mt-1 max-w-md text-[12px] text-slate-500">
                  Trạm xuất báo cáo dùng chính số liệu màn Project Master Plan đã tải. Mở Project Master Plan một lần
                  (đợi bảng hiện xong) rồi quay lại đây.
                </div>
                {onMoEpmp && (
                  <button onClick={onMoEpmp} className="mt-3 rounded-md bg-[#1F3864] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#162b4d]">
                    Mở Project Master Plan
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
