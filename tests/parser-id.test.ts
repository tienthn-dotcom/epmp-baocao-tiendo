import { test, expect } from "bun:test";
import { parseTimelineRows } from "../src/lib/parser";
import { projectKeyOf } from "../src/lib/filter";

/** Dựng Timeline có cột STT (ID phân cấp) ở cột A (index 0). Header hàng 6 (index 5). */
function buildRowsWithId(idCol: boolean): unknown[][] {
  const rows: unknown[][] = [];
  for (let i = 0; i < 7; i++) rows.push([]);
  const header: unknown[] = new Array(21).fill(null);
  if (idCol) header[0] = "STT";
  header[4] = "Show"; header[11] = "Mã"; header[12] = "Mô tả";
  header[13] = "Người phụ trách chính"; header[14] = "Bắt đầu"; header[15] = "Kết thúc";
  header[18] = "% thực tế"; header[20] = "Vướng mắc / Cần xử lý";
  rows[5] = header;
  // Dự án (cha)
  const parent: unknown[] = new Array(21).fill(null);
  if (idCol) parent[0] = "70";
  parent[4] = "show"; parent[5] = "Dự án A"; parent[6] = "Chủ ĐT"; parent[7] = "CT-A"; parent[11] = "CT-A";
  rows.push(parent);
  // Hạng mục TK
  const tk: unknown[] = new Array(21).fill(null);
  if (idCol) tk[0] = "70.1";
  tk[4] = "show"; tk[11] = "TK-01"; tk[12] = "Thiết kế"; tk[13] = "Người A";
  tk[15] = "25/12/2026"; tk[18] = "50%";
  rows.push(tk);
  // Hạng mục Thi công lắp đặt (cha của Block)
  const tc: unknown[] = new Array(21).fill(null);
  if (idCol) tc[0] = "70.2";
  tc[4] = "show"; tc[11] = "TC"; tc[12] = "Thi công lắp đặt"; tc[13] = "Người B";
  tc[15] = "25/12/2026"; tc[18] = "40%";
  rows.push(tc);
  // Block con TC1 (kind tho: ô U+1 là số)
  const b1: unknown[] = new Array(21).fill(null);
  if (idCol) b1[0] = "70.2a";
  b1[4] = "show"; b1[11] = "TC1"; b1[12] = "Block 1"; b1[18] = "40%";
  b1[21] = 3; b1[22] = 3; b1[24] = 10; // giao thô 3/10
  rows.push(b1);
  return rows;
}

const REF = "2026-06-18";

test("đọc ID phân cấp từ cột STT: dự án / hạng mục / block", () => {
  const data = parseTimelineRows(buildRowsWithId(true), REF);
  expect(data.projects.length).toBe(1);
  expect(data.projects[0].id).toBe("70");
  const tk = data.items.find((i) => i.rawCode === "TK-01");
  expect(tk?.id).toBe("70.1");
  const tc = data.projects[0].allItems.find((i) => i.rawCode === "TC");
  expect(tc?.blocks?.length).toBe(1);
  expect(tc?.blocks?.[0].id).toBe("70.2a");
});

test("không có cột STT → id undefined (nguồn cũ vẫn chạy)", () => {
  const data = parseTimelineRows(buildRowsWithId(false), REF);
  expect(data.projects[0].id).toBeUndefined();
  expect(data.items.find((i) => i.rawCode === "TK-01")?.id).toBeUndefined();
});

test('cột "STT Dự án" (Top-20) KHÔNG bị nhận nhầm là cột ID', () => {
  const rows = buildRowsWithId(false);
  // Thêm cột "STT Dự án" (Top-20) — không được đọc thành id.
  rows[5][1] = "STT Dự án";
  rows[7][1] = 5; // dòng dự án
  const data = parseTimelineRows(rows, REF);
  expect(data.projects[0].id).toBeUndefined();
  expect(data.projects[0].rank).toBe(5); // vẫn đọc đúng làm rank Top-20
});

test("projectKeyOf: ưu tiên id, fallback mã+tên", () => {
  expect(projectKeyOf("CT-A", "Dự án A", "70")).toBe("id:70");
  expect(projectKeyOf("CT-A", "Dự án A", "  ")).toBe(`CT-A${String.fromCharCode(0)}Dự án A`);
  expect(projectKeyOf("CT-A", "Dự án A")).toBe(`CT-A${String.fromCharCode(0)}Dự án A`);
});
