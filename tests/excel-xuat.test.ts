/* XUẤT EXCEL — file tải về phải ĐỌC ĐƯỢC NGAY, không phải bung nhóm mới thấy.
 *
 * Anh Tiến 05/10/2026: *"tại sao xuất excel về, lại không xem được gì trong file vậy"*.
 * Mở ruột file ra thì thấy hai thứ:
 *   · MỌI dòng hạng mục đều mang `hidden="1"` — chỉ còn mấy dòng dự án hiện ra;
 *   · `<autoFilter ref="A3:K3"/>` — vùng lọc phủ đúng MỘT dòng tiêu đề, không phủ dữ liệu.
 * Hai cái cộng lại: Excel coi các dòng ẩn là "đã bị lọc bỏ", nút bung nhóm mất tác dụng, nên người
 * ta tải về và không có đường nào thấy chi tiết.
 *
 * Test này gác cả hai, vì đây là loại lỗi KHÔNG lộ ra khi chạy app: hàm chạy trơn, không ném lỗi,
 * file tải về đúng tên đúng dung lượng — chỉ khi mở bằng Excel mới biết. Nó nằm im từ v3.23.0
 * (31/07) tới 05/10.
 */
import { describe, expect, it, beforeAll } from "vitest";
import JSZip from "jszip";
import { exportTableXlsx, type XlsxTableRow } from "@/lib/excel-export";

const COT = [
  { label: "Ngày update", width: 12, align: "center" as const },
  { label: "Mã", width: 14, align: "left" as const },
  { label: "Tên dự án / Hạng mục", width: 40, wrap: true, align: "left" as const },
  { label: "Người phụ trách", width: 20, align: "left" as const },
  { label: "Bắt đầu", width: 12, align: "center" as const, numFmt: "dd/mm/yy" },
  { label: "Kết thúc", width: 12, align: "center" as const, numFmt: "dd/mm/yy" },
  { label: "% thực tế", width: 9, align: "center" as const },
  { label: "Quá hạn", width: 9, align: "center" as const },
  { label: "Tình trạng", width: 16, align: "center" as const },
];

const HANG: XlsxTableRow[] = [
  { kind: "group", cells: ["29/09", "CT26-041", "APEC_S3_Public", "Nguyễn Văn Có", "25/03/26", "30/12/26", null, null, ""] },
  { kind: "item", statusColor: "AMBER", cells: [null, "TK", "Phát hành thiết kế", "Sun Group", "22/04/26", "20/06/26", 90, 107, "CẦN CẮT ĐẦU VIỆC"] },
  { kind: "item", statusColor: "AMBER", cells: [null, "SX", "Sản xuất nhập kho", "NM", "30/06/26", "30/10/26", 0, null, "CẦN TẬP TRUNG"] },
  { kind: "group", cells: ["30/09", "CT26-055", "Nam Phương Hoàng Hậu", "Đặng Ngọc Sáu", "01/04/26", "30/12/26", null, null, ""] },
  { kind: "item", statusColor: "RED", cells: [null, "TC", "Thi công lắp đặt", "PM", "15/10/26", "30/12/26", 0, 12, "TRỄ TIẾN ĐỘ"] },
];

/** Chạy đúng hàm app gọi, chặn chỗ nó lưu file để lấy lại bytes. */
async function xuatRaBytes(): Promise<Buffer> {
  let buf: unknown = null;
  const g = globalThis as Record<string, unknown>;
  const BlobThat = g.Blob;
  g.Blob = class { __buf: unknown; constructor(parts: unknown[]) { this.__buf = parts[0]; } };
  g.URL = { createObjectURL: (b: { __buf: unknown }) => { buf = b.__buf; return "blob:test"; }, revokeObjectURL: () => {} };
  g.document = {
    createElement: () => ({ href: "", download: "", click: () => {}, remove: () => {} }),
    body: { appendChild: () => {} },
  };
  try {
    await exportTableXlsx({
      columns: COT, statusColIndex: 8, finishColIndex: 5, pctColIndex: 6, overdueColIndex: 7,
      overdueAlertDays: 14, rows: HANG, todayIso: "2026-10-05", filterSummary: "Tất cả dự án",
    });
  } finally { g.Blob = BlobThat; }
  if (!buf) throw new Error("không bắt được bytes của file");
  return Buffer.from(buf as ArrayBuffer);
}

describe("file Excel tải về", () => {
  let ws: import("exceljs").Worksheet;
  /** XML thô của sheet. PHẢI soi bản thô: ExcelJS đọc lại file KHÔNG khôi phục cờ `hidden`, nên
   *  assert trên model của nó là viết một test không bao giờ đỏ được — đã thử, nó xanh cả khi lỗi
   *  còn nguyên. */
  let xml: string;

  beforeAll(async () => {
    const bytes = await xuatRaBytes();
    const ExcelJS = (await import("exceljs")).default ?? (await import("exceljs"));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    ws = wb.worksheets[0];
    const zip = await JSZip.loadAsync(bytes);
    xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  }, 60_000);

  it("KHÔNG dòng nào bị ẩn — mở file lên là đọc được ngay", () => {
    /* Soi XML THÔ chứ không soi model ExcelJS: ExcelJS đọc lại file KHÔNG khôi phục cờ
       `hidden`, nên assert trên model của nó là viết một test không bao giờ đỏ được — đã thử,
       nó xanh cả khi lỗi còn nguyên. */
    const an = xml.match(/<row [^>]*hidden="1"[^>]*>/g) ?? [];
    expect(an).toEqual([]);
  });

  it("vẫn giữ nhóm outline để ai muốn thu gọn thì bấm 1/2 ở lề trái", () => {
    expect(ws.getRow(4).outlineLevel).toBe(0);
    expect(ws.getRow(5).outlineLevel).toBe(1);
  });

  it("đủ số dòng dữ liệu: 3 dòng đầu + từng hàng truyền vào", () => {
    // Dòng 1 tiêu đề · 2 phạm vi lọc · 3 header cột · rồi tới dữ liệu.
    expect(ws.getRow(4).getCell(2).value).toBe("CT26-041");
    expect(ws.getRow(5).getCell(3).value).toBe("Phát hành thiết kế");
    expect(ws.getRow(7).getCell(2).value).toBe("CT26-055");
    expect(ws.getRow(8).getCell(3).value).toBe("Thi công lắp đặt");
  });

  it("vùng lọc phủ HẾT dữ liệu, không chỉ dòng tiêu đề", () => {
    const af = ws.autoFilter as { from: { row: number }; to: { row: number } } | string;
    const den = typeof af === "string" ? +(af.match(/\d+$/)?.[0] ?? 0) : af.to.row;
    const tu = typeof af === "string" ? 3 : af.from.row;
    expect(tu).toBe(3);
    expect(den).toBe(3 + HANG.length);   // 3 dòng đầu + số hàng
  });

  it("mức ưu tiên định dạng có điều kiện phải DUY NHẤT trong cả sheet", () => {
    /* Trùng priority là Excel coi file hỏng và THAY cả xl/worksheets/sheet1.xml bằng bản rỗng:
       "Replaced Part: /xl/worksheets/sheet1.xml part with XML error" — mở lên trắng trơn.
       File vẫn WELL-FORMED về XML (đã chạy saxes: 0 lỗi) nên thư viện đọc vẫn ra đủ dòng; chỉ
       Excel mới bắt. Đó là lý do lỗi này sống lâu mà không ai thấy. */
    const ds = [...xml.matchAll(/<cfRule[^>]*priority="(\d+)"/g)].map((m) => m[1]);
    expect(ds.length).toBeGreaterThan(0);
    expect(new Set(ds).size).toBe(ds.length);
  });

  it("dòng dự án chữ TRẮNG thì phải có nền đậm — nếu không là trắng trên trắng", () => {
    const o = ws.getRow(4).getCell(2);
    const chu = (o.font?.color as { argb?: string } | undefined)?.argb;
    const nen = (o.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb;
    expect(chu).toBe("FFFFFFFF");
    expect(nen).toBeTruthy();
    expect(nen).not.toBe("FFFFFFFF");
  });
});
