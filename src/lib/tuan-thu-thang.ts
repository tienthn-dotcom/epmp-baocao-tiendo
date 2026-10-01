/**
 * BÁO CÁO TUÂN THỦ — XEM VÀ XUẤT LẠI THÁNG CŨ.
 *
 * VÌ SAO CẦN: file tuân thủ trên Drive chỉ giữ THÁNG ĐANG CHẠY. Sáng 01/10/2026 nó nhảy sang
 * tháng 10 (bốn cột tuần 07/10 · 14/10 · 21/10 · 28/10, mọi ô trống, mọi dự án 100 điểm) và số
 * liệu tháng 9 biến mất khỏi file. Anh Tiến cần xuất lại tháng 9 để gửi thì không còn gì để xuất.
 *
 * NGUỒN DUY NHẤT CÒN LẠI là lịch sử NGÀY CẬP NHẬT app tự ghi (`updates:v1`) — app chấm lại được
 * bất kỳ tháng nào từ đó, bằng ĐÚNG bộ luật đang chấm tháng hiện tại (`buildComplianceReport`).
 *
 * MODULE NÀY CHỈ LÀM MỘT VIỆC: đổi kết quả chấm của app sang ĐÚNG hình dạng dòng mà file tuân
 * thủ trả ra. Nhờ vậy cái bảng, bộ lọc Vùng, và hàm xuất PDF giữ nguyên không phải sửa một dòng —
 * tháng cũ in ra y hệt tháng đang chạy.
 *
 * NGÀY UPDATE LẤY TỪ FILE NGUỒN (tab AutoData), không lấy từ kho của app — xem lib/auto-data.ts.
 */
import type { CMark, ComplianceFileData, ComplianceFileRow } from "./compliance-file";
import type { ComplianceReport } from "./compliance";
import { cyclesOfMonth } from "./compliance";

/** "2026-09" → "09/2026", đúng kiểu nhãn file tuân thủ đang dùng. */
export function nhanThang(monthKey: string): string {
  return `${monthKey.slice(5, 7)}/${monthKey.slice(0, 4)}`;
}

/** "09/2026" → "2026-09". Rỗng / lạ → null. */
export function thangTuNhan(nhan: string | undefined | null): string | null {
  const m = (nhan || "").match(/^(\d{2})\/(\d{4})$/);
  return m ? `${m[2]}-${m[1]}` : null;
}

const ddmm = (iso: string | null): string | null => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : null);

/**
 * Các tháng app CHẤM LẠI được, mới nhất đứng đầu.
 *
 * Lấy từ chính lịch sử ngày cập nhật: tháng nào không có ngày nào thì chấm ra bảng trống, bày
 * lên chỉ làm người ta tưởng mất dữ liệu. Luôn có tháng hiện tại kể cả khi lịch sử chưa có gì.
 */
export function thangCoTheCham(history: Record<string, string[]>, homNay: string): string[] {
  const co = new Set<string>([homNay.slice(0, 7)]);
  for (const ds of Object.values(history ?? {})) {
    for (const d of ds ?? []) {
      const k = (d || "").slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(k) && k <= homNay.slice(0, 7)) co.add(k);
    }
  }
  return [...co].sort().reverse();
}

/**
 * Đổi kết quả chấm của app sang hình dạng dòng của file tuân thủ.
 * @param rep       kết quả `buildComplianceReport` cho tháng cần xem
 * @param vungCuaTen tra Vùng theo tên dự án (dialog đã có sẵn bảng này)
 */
export function doiSangDangFile(
  rep: ComplianceReport,
  vungCuaTen: (ten: string) => string,
): ComplianceFileData {
  const rows: ComplianceFileRow[] = rep.projects.map((p, i) => {
    const marks = p.marks as CMark[];
    return {
      stt: i + 1,
      vung: vungCuaTen(p.name),
      name: p.name,
      pm: p.pm,
      lastUpdate: ddmm(p.lastUpdate),
      marks,
      countX: marks.filter((m) => m === "x").length,
      countO: marks.filter((m) => m === "o").length,
      // Cột điểm của file là ĐIỂM NỀN (100−25x−10o). Phần trừ theo số tuần cờ BOD do chính
      // dialog cộng vào sau (finalScoreOf), nên ở đây KHÔNG trừ trước kẻo trừ hai lần.
      score: p.updateScore,
    };
  });
  return {
    monthLabel: nhanThang(rep.monthKey),
    // Nhãn cột tuần = dd/mm của THỨ TƯ mỗi chu kỳ — đúng kiểu file đang ghi (07/10 · 14/10 …).
    weeks: rep.cycles.map((c) => `${c.wed.slice(8, 10)}/${c.wed.slice(5, 7)}`),
    rows,
    updatedLabel: null,
  };
}

/**
 * NGÀY DÙNG ĐỂ CHẤM một tháng.
 *
 * `markCycle` trong lib/compliance.ts có một nhánh để TRỐNG khi khung tuần T3→T6 chưa qua. Đó là
 * thứ nằm sẵn trong code, KHÔNG phải luật anh Tiến đặt — anh ấy nói thẳng 01/10/2026:
 * *"làm gì có luật nào là chờ hết tuần"* và *"cần gì phải chờ 2/10"*.
 *
 * Hệ quả của nhánh đó: xem lại tháng 9 vào ngày 01/10 thì cột 30/09 để trống, vì thứ 6 của tuần
 * ấy rơi sang 02/10. Tháng đã hết mà báo cáo vẫn treo một cột trống.
 *
 * Nên: THÁNG ĐÃ QUA chấm dứt điểm, lấy mốc sau chu kỳ cuối một ngày. Tháng ĐANG CHẠY không đụng
 * tới — tuần của tuần này vẫn để trống như cũ, tránh chấm 'không cập nhật' cho một tuần chưa hết.
 */
export function ngayChamThang(monthKey: string, homNay: string): string {
  if (monthKey >= homNay.slice(0, 7)) return homNay;   // tháng đang chạy (hoặc tương lai) → như cũ
  const ck = cyclesOfMonth(monthKey);
  if (!ck.length) return homNay;
  const sau = Date.parse(ck[ck.length - 1].fri + "T00:00:00Z") + 86400000;
  return new Date(sau).toISOString().slice(0, 10);
}
