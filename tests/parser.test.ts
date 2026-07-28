import { test, expect } from "bun:test";
import * as XLSX from "xlsx";
import { parseTimelineRows, parseXlsxBuffer } from "../src/lib/parser";

/** Build a minimal Timeline sheet matrix with one parent + one child row.
 *  Header row at index 5, data from index 7. Columns: see COL in parser.ts. */
function buildRows(opts: {
  pctPlan: unknown;
  pctActual: unknown;
  deadline: unknown;
  overdue?: unknown;
}): unknown[][] {
  const rows: unknown[][] = [];
  for (let i = 0; i < 7; i++) rows.push([]);
  // Header hàng 6 (index 5) như file thật — cần cho bộ DÒ CỘT ĐỘNG.
  const header: unknown[] = new Array(21).fill(null);
  header[4] = "Show"; header[11] = "Mã"; header[12] = "Mô tả";
  header[13] = "Người phụ trách chính"; header[14] = "Bắt đầu"; header[15] = "Kết thúc";
  header[18] = "% thực tế"; header[20] = "Vướng mắc / Cần xử lý";
  rows[5] = header;
  // Parent row (CT...)
  const parent: unknown[] = new Array(21).fill(null);
  parent[4] = "show";      // E
  parent[5] = "Dự án A";   // F
  parent[6] = "Chủ ĐT";    // G
  parent[7] = "CT-A";      // H maCT
  parent[11] = "CT-A";     // L rawCode (parent)
  rows.push(parent);
  // Child row (stage TK)
  const child: unknown[] = new Array(21).fill(null);
  child[4] = "show";
  child[11] = "TK-01";                 // L rawCode
  child[12] = "Thiết kế bản vẽ";       // M desc
  child[13] = "Người A";               // N owner
  child[15] = opts.deadline;           // P deadline
  child[17] = opts.pctPlan;            // R %plan
  child[18] = opts.pctActual;          // S %actual
  child[19] = opts.overdue ?? null;    // T overdue days
  rows.push(child);
  return rows;
}

const REF = "2026-06-18";

test("Excel raw decimal 0.9 is kept (not treated as completed)", () => {
  const data = parseTimelineRows(
    buildRows({ pctPlan: 1.0, pctActual: 0.9, deadline: new Date(2026, 4, 25) }),
    REF,
  );
  expect(data.items.length).toBe(1);
  expect(data.items[0].pctActual).toBe(90);
  // Quy tắc đã chốt: BỎ cột "% dự kiến" trong file (dữ liệu rác) —
  // parser luôn trả null; % dự kiến thật tính động qua computePlanPct.
  expect(data.items[0].pctPlan).toBe(null);
});

test('CSV string "90%" is kept (not treated as completed)', () => {
  const data = parseTimelineRows(
    buildRows({ pctPlan: "100%", pctActual: "90%", deadline: "25/05/2026" }),
    REF,
  );
  expect(data.items.length).toBe(1);
  expect(data.items[0].pctActual).toBe(90);
  // Như trên: cột "% dự kiến" trong file bị bỏ — luôn null.
  expect(data.items[0].pctPlan).toBe(null);
});

test("100% actual is filtered out (both raw forms)", () => {
  const a = parseTimelineRows(
    buildRows({ pctPlan: 1, pctActual: 1, deadline: new Date(2026, 4, 25) }),
    REF,
  );
  const b = parseTimelineRows(
    buildRows({ pctPlan: "100%", pctActual: "100%", deadline: "25/05/2026" }),
    REF,
  );
  expect(a.items.length).toBe(0);
  expect(b.items.length).toBe(0);
});

test("Date object vs dd/mm/yyyy string yield same overdueDays", () => {
  const excel = parseTimelineRows(
    buildRows({ pctPlan: 1.0, pctActual: 0.5, deadline: new Date(2026, 4, 25) }),
    REF,
  );
  const csv = parseTimelineRows(
    buildRows({ pctPlan: "100%", pctActual: "50%", deadline: "25/05/2026" }),
    REF,
  );
  expect(excel.items[0].deadline).toBe("2026-05-25");
  expect(csv.items[0].deadline).toBe("2026-05-25");
  expect(excel.items[0].overdueDays).toBe(csv.items[0].overdueDays);
});

test("US-style m/d/yyyy disambiguates correctly (5/25/2026 → May 25)", () => {
  const data = parseTimelineRows(
    buildRows({ pctPlan: "100%", pctActual: "50%", deadline: "5/25/2026" }),
    REF,
  );
  expect(data.items[0].deadline).toBe("2026-05-25");
});

test("Ambiguous d/m vs m/d defaults to d/m (VN locale): 5/6/2026 → 5 June", () => {
  const data = parseTimelineRows(
    buildRows({ pctPlan: "100%", pctActual: "50%", deadline: "5/6/2026" }),
    REF,
  );
  expect(data.items[0].deadline).toBe("2026-06-05");
});

test("A1: Excel serial date (đọc không cellDates) ra đúng ngày, không lệch múi giờ", () => {
  // 46167 = 2026-05-25 (serial Excel). Nhánh số của toIso dùng XLSX.SSF.parse_date_code
  // — thuần số học, kết quả y hệt ở mọi TZ (UTC lẫn Asia/Ho_Chi_Minh).
  const data = parseTimelineRows(
    buildRows({ pctPlan: null, pctActual: "50%", deadline: 46167 }),
    REF,
  );
  expect(data.items[0].deadline).toBe("2026-05-25");
});

test('Cột "Cần cập nhật MP": tìm theo tiêu đề hàng 6, đọc ở dòng dự án cha', () => {
  const flagged = buildRows({ pctPlan: null, pctActual: "50%", deadline: "25/05/2026" });
  flagged[5][25] = "Cần cập nhật MP";   // header row (index 5) — vị trí bất kỳ
  flagged[7][25] = "x";                  // dòng cha (index 7): ô khác rỗng = đánh dấu
  const a = parseTimelineRows(flagged, REF);
  expect(a.projects[0].needsMpUpdate).toBe(true);

  const notFlagged = buildRows({ pctPlan: null, pctActual: "50%", deadline: "25/05/2026" });
  notFlagged[5][25] = "Cần cập nhật MP"; // có cột nhưng ô dòng cha rỗng
  const b = parseTimelineRows(notFlagged, REF);
  expect(b.projects[0].needsMpUpdate).toBe(false);
});

test('Ghi chú "cần cập nhật tiến độ MP" trong cột Vướng mắc → cờ needsMpUpdate', () => {
  // Trên dòng cha (col U = index 20)
  const a = buildRows({ pctPlan: null, pctActual: "50%", deadline: "25/05/2026" });
  a[7][20] = "Cần cập nhật tiến độ Master Plan trình BOD phê duyệt";
  expect(parseTimelineRows(a, REF).projects[0].needsMpUpdate).toBe(true);

  // Trên đầu việc đang làm, KHÔNG DẤU + viết thường vẫn bắt được
  const b = buildRows({ pctPlan: null, pctActual: "50%", deadline: "25/05/2026" });
  b[8][20] = "vuong mac nha thau, can cap nhat lai tien do";
  expect(parseTimelineRows(b, REF).projects[0].needsMpUpdate).toBe(true);

  // "cập nhật MP" gọn cũng bắt được
  const c = buildRows({ pctPlan: null, pctActual: "50%", deadline: "25/05/2026" });
  c[8][20] = "chờ duyệt mẫu; cập nhật MP tuần sau";
  expect(parseTimelineRows(c, REF).projects[0].needsMpUpdate).toBe(true);

  // Ghi chú thường (không nói tới cập nhật tiến độ/MP) → KHÔNG cờ
  const d = buildRows({ pctPlan: null, pctActual: "50%", deadline: "25/05/2026" });
  d[8][20] = "Vướng mặt bằng, chờ chủ đầu tư bàn giao";
  expect(parseTimelineRows(d, REF).projects[0].needsMpUpdate).toBe(false);

  // "PMP" không được bắt nhầm thành "MP"
  const e = buildRows({ pctPlan: null, pctActual: "50%", deadline: "25/05/2026" });
  e[8][20] = "cập nhật file PMP";
  expect(parseTimelineRows(e, REF).projects[0].needsMpUpdate).toBe(false);
});

test("Ô Vướng mắc bị MERGE dọc → ghi chú lan xuống mọi hạng mục trong vùng merge", async () => {
  // Parent (row 7) + 2 child (row 8, 9); ghi chú chỉ nằm ở ô đầu vùng merge (row 8),
  // vùng merge phủ row 8..9 ở cột U (index 20) — như file PMP thật.
  const rows = buildRows({ pctPlan: null, pctActual: "50%", deadline: "25/05/2026" });
  const child2 = [...(rows[8] as unknown[])];
  child2[11] = "VT-01"; // rawCode khác để thành hạng mục thứ 2
  rows.push(child2);
  rows[8][20] = "Chờ CĐT duyệt mẫu, cần đẩy nhanh";
  rows[0][0] = "Báo cáo"; // neo A1 để !ref của sheet bắt đầu từ hàng 0 (giữ đúng chỉ số hàng)

  const ws = XLSX.utils.aoa_to_sheet(rows as unknown[][]);
  ws["!merges"] = [{ s: { r: 8, c: 20 }, e: { r: 9, c: 20 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Timeline");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

  const data = await parseXlsxBuffer(buf, REF);
  expect(data.items.length).toBe(2);
  expect(data.items[0].note).toBe("Chờ CĐT duyệt mẫu, cần đẩy nhanh");
  expect(data.items[1].note).toBe("Chờ CĐT duyệt mẫu, cần đẩy nhanh");
});

test("Cờ shown: dòng Hide vào allItems với shown=false, không vào items", () => {
  const rows = buildRows({ pctPlan: null, pctActual: "50%", deadline: "25/05/2026" });
  const hiddenChild = [...(rows[8] as unknown[])];
  hiddenChild[4] = "hide";      // Show = hide
  hiddenChild[11] = "VT-01";
  rows.push(hiddenChild);
  const data = parseTimelineRows(rows, REF);
  expect(data.items.length).toBe(1); // chỉ dòng show
  const all = data.projects[0].allItems;
  expect(all.length).toBe(2);        // allItems giữ cả dòng hide (cho xuất Excel)
  expect(all.find(i => i.rawCode === "TK-01")?.shown).toBe(true);
  expect(all.find(i => i.rawCode === "VT-01")?.shown).toBe(false);
});

test("Cổng dữ liệu: nguồn chuẩn → quality OK kèm thống kê đúng", () => {
  const rows = buildRows({ pctPlan: null, pctActual: "50%", deadline: "25/05/2026" });
  rows[5][4] = "Show"; // header hàng 6 có từ khoá
  const q = parseTimelineRows(rows, REF).quality!;
  expect(q.level).toBe("ok");
  expect(q.stats.shownProjects).toBe(1);
  expect(q.stats.activeItems).toBe(1);
});

test("Cổng dữ liệu: sai tab (không header, không dự án) → level ERROR", () => {
  const rows: unknown[][] = [];
  for (let i = 0; i < 12; i++) rows.push(["x", "y", "z"]); // dữ liệu vu vơ
  const q = parseTimelineRows(rows, REF).quality!;
  expect(q.level).toBe("error");
  expect(q.checks.some(c => c.id === "projects" && c.level === "error")).toBe(true);
});

test("Cổng dữ liệu: mã prefix lạ bị bỏ qua → cảnh báo, không nuốt trong im lặng", () => {
  const rows = buildRows({ pctPlan: null, pctActual: "50%", deadline: "25/05/2026" });
  rows[5][4] = "Show";
  const weird = [...(rows[8] as unknown[])];
  weird[11] = "XYZ-99"; // prefix không thuộc nhóm nào
  rows.push(weird);
  const q = parseTimelineRows(rows, REF).quality!;
  expect(q.level).toBe("warn");
  const chk = q.checks.find(c => c.id === "unknownPrefix")!;
  expect(chk.level).toBe("warn");
  expect(chk.detail).toContain("XYZ-99");
});

test("Edge case: 0% plan + 0% actual but overdue → kept (computed, not from col T)", () => {
  const data = parseTimelineRows(
    // col T cố tình sai (999) — phải bị BỎ QUA; overdueDays tính từ Finish vs REF.
    buildRows({ pctPlan: 0, pctActual: 0, deadline: "25/05/2026", overdue: 999 }),
    REF,
  );
  expect(data.items.length).toBe(1);
  // REF=2026-06-18, Finish=2026-05-25 → 24 ngày
  expect(data.items[0].overdueDays).toBe(24);
});
