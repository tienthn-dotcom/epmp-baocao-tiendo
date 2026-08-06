/**
 * ĐỌC HYPERLINK "Thi công lắp đặt" → fileId Summary, CHẠY Ở CLIENT (trình duyệt).
 * Trước đây làm trên Cloudflare Worker (getInstallLinks) → parse xlsx trên Worker gây Error 1102
 * (vượt RAM/CPU). Nay client đã tải sẵn file Timeline (bytes) cho dữ liệu chính → đọc hyperlink
 * TỪ CHÍNH bytes đó, Worker KHỎI parse. Xem [[project-pmo-dashboard-repo-location]].
 */
import * as XLSX from "xlsx";

const idFromUrl = (u: string): string | null => {
  const m = String(u).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
};
/** gid (mã tab) trong hyperlink — để tải ĐÚNG tab (Summary vs Public Summary). null nếu không có. */
const gidFromUrl = (u: string): string | null => {
  const m = String(u).match(/[#?&]gid=(\d+)/);
  return m ? m[1] : null;
};

/** Buffer xlsx (đã tải cho dữ liệu chính) → map { maCT → fileId } của ô "Thi công lắp đặt" có
 *  hyperlink. Chỉ đọc sheet "Timeline". An toàn: lỗi thì trả {} (không chặn app). */
export function readInstallLinks(buf: ArrayBuffer): Record<string, string> {
  try {
    const wb = XLSX.read(buf, { type: "array", sheets: ["Timeline"] });
    const sh = wb.Sheets["Timeline"] ?? wb.Sheets[wb.SheetNames[0]];
    if (!sh || !sh["!ref"]) return {};
    const rng = XLSX.utils.decode_range(sh["!ref"]);
    const ec = XLSX.utils.encode_cell;
    const map: Record<string, string> = {};
    // Cột STT (ID phân cấp, KHÔNG lặp) → gắn link theo TỪNG DÒNG: 1 dự án có NHIỀU matrix
    // (phòng / Public / …) không đụng nhau. File không có STT → lùi về khoá theo mã dự án (maCT).
    let sttCol = -1;
    for (let r = rng.s.r; r <= Math.min(rng.s.r + 14, rng.e.r) && sttCol < 0; r++)
      for (let c = rng.s.c; c <= rng.e.c; c++) {
        const h = String((sh[ec({ r, c })] as XLSX.CellObject | undefined)?.v ?? "").trim().toLowerCase();
        if (/^stt$|^id$|^mã\s*id$/.test(h) && !/d[ựu]\s*[áa]n/.test(h)) { sttCol = c; break; }
      }
    let curMaCT = "";
    for (let r = rng.s.r; r <= rng.e.r; r++) {
      for (let c = rng.s.c; c <= Math.min(rng.s.c + 12, rng.e.c); c++) {
        const v = String((sh[ec({ r, c })] as XLSX.CellObject | undefined)?.v ?? "").trim();
        if (/^CT\d{2}-\d/.test(v)) { curMaCT = v; break; }
      }
      for (let c = rng.s.c; c <= rng.e.c; c++) {
        const cl = sh[ec({ r, c })] as (XLSX.CellObject & { l?: { Target?: string } }) | undefined;
        const target = cl?.l?.Target;
        if (target && /spreadsheets\/d\//.test(target) && /thi\s*công\s*lắp/i.test(String(cl?.v ?? ""))) {
          const fid = idFromUrl(target);
          const gid = gidFromUrl(target);
          // Mã hoá "fileId|gid" (kèm gid nếu hyperlink trỏ đúng 1 tab) → client tách ra ở SummaryDialog.
          if (fid) {
            const link = gid ? fid + "|" + gid : fid;
            const rowId = sttCol >= 0 ? String((sh[ec({ r, c: sttCol })] as XLSX.CellObject | undefined)?.v ?? "").trim() : "";
            if (rowId) map["id:" + rowId] = link;   // khoá theo DÒNG (ưu tiên) → nhiều link/1 dự án không đụng
            if (curMaCT) map[curMaCT] = link;         // fallback theo dự án (file cũ không có STT)
          }
        }
      }
    }
    return map;
  } catch { return {}; }
}
