/**
 * ĐỌC FILE NGUỒN TUÂN THỦ (Google Sheet RIÊNG cho function này — tách khỏi PMP).
 *  • App CHỈ RENDER: mọi data ✔/o/x, vùng, PM, lũy kế, VÀ ĐIỂM lấy THẲNG từ file (ý PMO).
 *  • ĐIỂM DỰ ÁN: đọc cột "Điểm" (J) do Apps Script chấm (nguồn DUY NHẤT — chứa cả rule
 *    "không trình BOD" khi bật). Thiếu cột/ô rỗng → FALLBACK tự tính 100−25x−10o.
 *  • Chấm theo THÁNG: "số lần không cập nhật" & fallback CHỈ tính trên cột tuần THÁNG hiện tại.
 *  • Điểm PM = TRUNG BÌNH điểm dự án (gộp bỏ DPM) — app tự tính từ score đọc được.
 * Chạy Ở CLIENT (parse text CSV do fetchSheetCsv trả về) — Worker KHÔNG parse.
 */

/** ✔ = đúng hạn (P) · o = trễ · x = không cập nhật · null = trống/chưa có. */
export type CMark = "P" | "o" | "x" | null;

export type ComplianceFileRow = {
  stt: number | null;
  vung: string;
  name: string;
  pm: string;                 // dòng ĐẦU ô "Người phụ trách chính" (bỏ ghi chú phụ)
  lastUpdate: string | null;  // dd/mm giữ nguyên như file
  needsMp: boolean;           // ô "Cần lập MP mới" khác rỗng
  marks: CMark[];             // khớp `weeks` (các tuần THÁNG CHẤM)
  countX: number;
  countO: number;
  score: number | null;       // app chấm: 100−25x−10o. null nếu chưa có mark nào
};

export type ComplianceFileData = {
  monthLabel: string;         // "07/2026" (rỗng nếu không đọc được)
  weeks: string[];            // nhãn cột tuần của tháng chấm (vd 01/07…29/07)
  rows: ComplianceFileRow[];
  updatedLabel: string | null; // "Ngày cập nhật" ghi trong file (nếu có)
};

/** CSV parser tự chứa (RFC4180): xử lý ô có dấu ", xuống dòng, và "" thoát dấu nháy. */
function parseCsv(text: string): string[][] {
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const toMark = (v: string): CMark => {
  const t = (v || "").trim();
  if (!t) return null;
  if (t === "✔" || t === "✓" || /^[pv]$/i.test(t)) return "P";
  if (/^o$/i.test(t)) return "o";
  if (/^x$/i.test(t)) return "x";
  return null;
};

/** Đọc ô "Điểm" (cột J) từ file: số ≤100 (CÓ THỂ ÂM). Rỗng/không phải số → null (để fallback tự tính). */
const toScore = (v: string): number | null => {
  const t = (v || "").trim();
  if (!t) return null;
  const n = parseFloat(t.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.round(n));   // CHO PHÉP ÂM: bỏ sàn 0 (100−25x−10o có thể < 0)
};

/** Parse text CSV của file tuân thủ → dữ liệu bảng. Ném lỗi rõ nếu không nhận diện được header. */
export function parseComplianceFile(csvText: string): ComplianceFileData {
  const grid = parseCsv(csvText);

  // 1) DÒNG HEADER = dòng vừa có "Location" vừa có "Tên dự án".
  let hIdx = -1;
  for (let i = 0; i < grid.length; i++) {
    const r = grid[i].map((c) => (c || "").trim());
    if (r.includes("Location") && r.includes("Tên dự án")) { hIdx = i; break; }
  }
  if (hIdx < 0) throw new Error("Không nhận diện được file tuân thủ (thiếu cột Location / Tên dự án). Kiểm tra đúng tab/gid chưa.");
  const header = grid[hIdx].map((c) => (c || "").trim());
  const find = (label: string) => header.findIndex((c) => c === label);
  const findHas = (kw: string) => header.findIndex((c) => c.includes(kw));
  const cVung = find("Location");
  const cStt = find("STT");
  const cLast = findHas("Ngày cập nhật");
  const cName = find("Tên dự án");
  const cPm = findHas("Người phụ trách");
  const cNeed = findHas("Cần lập MP");
  const cScore = findHas("Điểm");   // cột J: điểm dự án Apps Script đã chấm (100−25x−10o[−BOD])

  // 2) THÁNG CHẤM: đọc "THÁNG MM/YYYY" ở các dòng phía trên header.
  let mm = "", monthLabel = "";
  for (let i = 0; i < hIdx; i++) {
    const m = grid[i].join(" ").match(/TH[ÁA]NG\s*(\d{1,2})\/(\d{4})/i);
    if (m) { mm = m[1].padStart(2, "0"); monthLabel = `${mm}/${m[2]}`; break; }
  }

  // 3) CỘT TUẦN = ô header dạng dd/mm; GIỮ các tuần thuộc THÁNG CHẤM (mm). Không đọc được
  //    tháng → giữ tất cả (an toàn, thà hiện thừa còn hơn giấu data).
  const weekCols: { idx: number; label: string }[] = [];
  header.forEach((h, c) => {
    const wm = h.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (wm && (!mm || wm[2].padStart(2, "0") === mm)) weekCols.push({ idx: c, label: h });
  });

  // 4) Nhãn "Ngày cập nhật:" (nếu có) — hiện lên cho biết file chốt lúc nào.
  let updatedLabel: string | null = null;
  for (let i = 0; i < hIdx; i++) {
    const j = grid[i].findIndex((c) => /Ngày cập nhật:/i.test(c || ""));
    if (j >= 0) { updatedLabel = (grid[i][j + 2] || grid[i][j + 1] || "").trim() || null; if (updatedLabel) break; }
  }

  // 5) DỮ LIỆU: từ dưới header tới hết; bỏ dòng không có STT + tên.
  const rows: ComplianceFileRow[] = [];
  for (let i = hIdx + 1; i < grid.length; i++) {
    const r = grid[i];
    const name = (r[cName] || "").trim();
    const stt = parseInt((r[cStt] || "").trim(), 10);
    if (!name || Number.isNaN(stt)) continue;
    const marks = weekCols.map((w) => toMark(r[w.idx] || ""));
    const countX = marks.filter((m) => m === "x").length;
    const countO = marks.filter((m) => m === "o").length;
    const hasAny = marks.some((m) => m !== null);
    // ĐIỂM: ưu tiên ĐỌC cột "Điểm" (J) Apps Script đã chấm (nguồn duy nhất — có cả rule BOD sau này);
    // thiếu cột / ô rỗng thì FALLBACK tự tính 100−25x−10o. Dự án chưa có mark nào → null (chưa chấm).
    const sheetScore = cScore >= 0 ? toScore(r[cScore] || "") : null;
    rows.push({
      stt,
      vung: (r[cVung] || "").trim(),
      name,
      pm: (r[cPm] || "").split("\n")[0].trim(),
      lastUpdate: (r[cLast] || "").trim() || null,
      needsMp: cNeed >= 0 && !!(r[cNeed] || "").trim(),
      marks, countX, countO,
      score: sheetScore != null ? sheetScore : (hasAny ? Math.min(100, 100 - 25 * countX - 10 * countO) : null),
    });
  }

  return { monthLabel, weeks: weekCols.map((w) => w.label), rows, updatedLabel };
}

/** Điểm PM = TRUNG BÌNH CỘNG điểm các dự án PM quản (bỏ dự án score null). */
export function pmAverages(rows: ComplianceFileRow[]): Map<string, number | null> {
  const g = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.pm) continue;
    const arr = g.get(r.pm) ?? [];
    if (r.score != null) arr.push(r.score);
    g.set(r.pm, arr);
  }
  const out = new Map<string, number | null>();
  for (const [pm, arr] of g) out.set(pm, arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
  return out;
}
