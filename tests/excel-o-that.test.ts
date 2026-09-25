/**
 * XUẤT EXCEL PHẢI RA Ô THẬT, KHÔNG PHẢI Ô CHỮ.
 *
 * Chú thích của app hứa "ô THẬT (lọc / sắp xếp / sửa ngay trong Excel)". Khi mọi ô còn là chữ thì
 * bấm sắp xếp cột ngày trong Excel ra THỨ TỰ CHỮ CÁI: `01/12/25` đứng trước `02/01/26`. Người nhận
 * file bấm sắp xếp theo hạn rồi tin vào một thứ tự sai — mà bảng này dùng để đánh giá PM.
 *
 * Bộ kiểm này KHÔNG chỉ gọi hàm dựng ô. Nó chạy trọn `exportTableXlsx` thật, bắt lấy file .xlsx
 * vừa dựng, **đọc ngược lại bằng exceljs** rồi soi từng ô. Tin vào phép kiểm chỉ đọc mã nguồn thì
 * không trả lời được câu "mở file ra Excel có đúng không".
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { oNgay, type XlsxTableRow } from "@/lib/excel-export";

/* ── Dựng đủ DOM giả để chạy được đường tải file trong môi trường node ────────────────────── */
let batDuoc: Blob | null = null;
const cuu: Record<string, unknown> = {};
beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  cuu.document = g.document;
  cuu.createObjectURL = (URL as unknown as Record<string, unknown>).createObjectURL;
  cuu.revokeObjectURL = (URL as unknown as Record<string, unknown>).revokeObjectURL;
  (URL as unknown as Record<string, unknown>).createObjectURL = (b: Blob) => { batDuoc = b; return "blob:gia"; };
  (URL as unknown as Record<string, unknown>).revokeObjectURL = () => {};
  g.document = {
    createElement: () => ({ href: "", download: "", click() {}, remove() {} }),
    body: { appendChild() {} },
  };
});
afterAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = cuu.document;
  (URL as unknown as Record<string, unknown>).createObjectURL = cuu.createObjectURL;
  (URL as unknown as Record<string, unknown>).revokeObjectURL = cuu.revokeObjectURL;
});

/** Cột dựng ĐÚNG như index.tsx đang gọi — đổi bên đó mà quên bên này thì bộ kiểm hết ý nghĩa. */
const COLS = [
  { label: "Ngày update", width: 12, align: "center" as const, numFmt: "dd/mm/yy" },
  { label: "Mã", width: 15, align: "left" as const },
  { label: "Tên dự án / Hạng mục", width: 42, wrap: true, align: "left" as const },
  { label: "Người phụ trách chính", width: 22, wrap: true, align: "left" as const },
  { label: "Ngày bắt đầu", width: 12, align: "center" as const, numFmt: "dd/mm/yy" },
  { label: "Ngày kết thúc", width: 12, align: "center" as const, numFmt: "dd/mm/yy" },
  { label: "% thực tế", width: 9, align: "center" as const, numFmt: '0"%"' },
  { label: "Quá hạn", width: 9, align: "center" as const, numFmt: '0" ngày"' },
  { label: "Tình trạng", width: 15, align: "center" as const },
  { label: "Vướng mắc / Cần xử lý", width: 48, wrap: true, align: "left" as const },
  { label: "Giải pháp / Action plan", width: 48, wrap: true, align: "left" as const },
];

/* Ba hạn CỐ Ý xếp sao cho thứ tự chữ cái KHÁC thứ tự thời gian — đó là cả lý do của việc này. */
const HAN = ["2025-12-01", "2026-01-02", "2025-06-15"];

const DONG: XlsxTableRow[] = [
  { kind: "group", delivered: false, late: false, statusColor: null,
    cells: [oNgay("2026-09-20"), "CT26-032", "Dự án A", "Nguyễn Văn A",
            oNgay("2025-01-01"), oNgay(HAN[0]), null, null, "", "", ""] },
  { kind: "item", statusColor: null,
    cells: [null, "TK", "Thiết kế", "B", oNgay("2025-02-01"), oNgay(HAN[1]), 85, 5, "Trễ tiến độ", "vướng", "giải"] },
  { kind: "item", statusColor: null,
    cells: [null, "MA", "Duyệt mẫu", "C", oNgay("2025-03-01"), oNgay(HAN[2]), 0, null, "", "", ""] },
  { kind: "item", statusColor: null,
    cells: [null, "VT", "Đặt vật tư", "D", null, null, null, null, "", "", ""] },
];

/**
 * Dựng file MỘT LẦN rồi mọi phép kiểm soi chung — đừng dựng lại ở từng phép.
 * Mỗi lượt dựng + đọc lại workbook tốn gần một giây; dựng tám lần thì riêng file này đủ làm những
 * phép kiểm CHẠY SONG SONG ở file khác vượt ngưỡng 5 giây rồi đỏ oan. Đã gặp thật lúc viết bài này.
 */
let WS: ExcelJS.Worksheet;
beforeAll(async () => {
  const { exportTableXlsx } = await import("@/lib/excel-export");
  batDuoc = null;
  await exportTableXlsx({
    columns: COLS, statusColIndex: 8, finishColIndex: 5, rows: DONG,
    todayIso: "2026-09-25", filterSummary: "Tất cả", updatedAt: "2026-09-24",
  });
  expect(batDuoc).not.toBeNull();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await (batDuoc as unknown as Blob).arrayBuffer());
  WS = wb.getWorksheet("Báo cáo")!;
});

describe("oNgay — ô ngày hoặc ô TRỐNG, không bao giờ ngày 1900", () => {
  it("ISO hợp lệ → đúng ngày đó, không lệch một hôm", () => {
    const d = oNgay("2026-09-15")!;
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth() + 1).toBe(9);
    expect(d.getUTCDate()).toBe(15);
  });

  it("ISO có giờ và có lệch múi giờ → vẫn ĐÚNG ngày ghi trong chuỗi", () => {
    // Đi đường `new Date(iso)` thì chuỗi này lùi về ngày 14 theo giờ UTC. Lệch một ngày trong im
    // lặng trên bảng đánh giá PM là thứ tệ nhất có thể xảy ra ở đây.
    expect(oNgay("2026-09-15T00:00:00+07:00")!.getUTCDate()).toBe(15);
    expect(oNgay("2026-09-15T23:30:00Z")!.getUTCDate()).toBe(15);
  });

  it("không có ngày → null, KHÔNG phải ngày 1900 và không phải chuỗi rỗng", () => {
    expect(oNgay(null)).toBeNull();
    expect(oNgay(undefined)).toBeNull();
    expect(oNgay("")).toBeNull();
    expect(oNgay("—")).toBeNull();
    expect(oNgay("không phải ngày")).toBeNull();
  });
});

describe("file .xlsx dựng ra — soi ngược từng ô", () => {
  it("cột ngày là NGÀY THẬT, và hiện vẫn dd/mm/yy", async () => {
    const ws = WS;
    const o = ws.getRow(4).getCell(6);           // dòng 4 = dòng dữ liệu đầu (3 dòng đầu là tiêu đề)
    expect(o.value).toBeInstanceOf(Date);
    expect((o.value as Date).getUTCDate()).toBe(1);
    expect((o.value as Date).getUTCMonth() + 1).toBe(12);
    expect(o.numFmt).toBe("dd/mm/yy");           // nhìn không đổi
  });

  it("SẮP XẾP THEO HẠN RA ĐÚNG THỨ TỰ THỜI GIAN — đây là cả lý do của việc này", async () => {
    const ws = WS;
    const hanTrongFile: Date[] = [];
    for (let r = 4; r <= 6; r++) hanTrongFile.push(ws.getRow(r).getCell(6).value as Date);

    // SAU: Excel sắp theo giá trị ngày → đúng thứ tự thời gian.
    const sau = [...hanTrongFile].sort((a, b) => a.getTime() - b.getTime())
      .map((d) => d.toISOString().slice(0, 10));
    expect(sau).toEqual(["2025-06-15", "2025-12-01", "2026-01-02"]);

    // TRƯỚC: bản cũ ghi chữ dd/mm/yy, Excel sắp theo chữ cái → SAI.
    const chu = HAN.map((iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)!; return `${m[3]}/${m[2]}/${m[1].slice(2)}`; });
    const truoc = [...chu].sort();
    expect(truoc).toEqual(["01/12/25", "02/01/26", "15/06/25"]);   // 01/12/25 đứng TRƯỚC 02/01/26
    expect(truoc).not.toEqual(chu.map((_, i) => chu[[2, 0, 1][i]]));
  });

  it("% là SỐ, và 0% khác hẳn CHƯA CÓ SỐ", async () => {
    const ws = WS;
    expect(ws.getRow(5).getCell(7).value).toBe(85);
    expect(ws.getRow(5).getCell(7).numFmt).toBe('0"%"');
    // 0 phải là SỐ 0 THẬT — dòng đã đo và được 0, không phải dòng chưa đo.
    expect(ws.getRow(6).getCell(7).value).toBe(0);
    // Chưa có số thì TRỐNG. Ghi 0 vào đây là biến dòng chưa đo thành dòng 0%, tức báo cáo sai sự
    // thật về một PM — luật 5.2.
    expect(ws.getRow(7).getCell(7).value == null).toBe(true);
  });

  it("Quá hạn là SỐ nguyên (Excel cộng được), vẫn hiện “5 ngày”", async () => {
    const ws = WS;
    expect(ws.getRow(5).getCell(8).value).toBe(5);
    expect(typeof ws.getRow(5).getCell(8).value).toBe("number");
    expect(ws.getRow(5).getCell(8).numFmt).toBe('0" ngày"');
  });

  it("dòng nhóm dự án: ô % và Quá hạn TRỐNG, không phải 0", async () => {
    const ws = WS;
    expect(ws.getRow(4).getCell(7).value == null).toBe(true);
    expect(ws.getRow(4).getCell(8).value == null).toBe(true);
  });

  it("không có ngày → ô TRỐNG THẬT, không có ngày 1900 và không đóng định dạng ngày", async () => {
    const ws = WS;
    const o = ws.getRow(7).getCell(6);
    expect(o.value == null).toBe(true);
    expect(o.numFmt).toBeFalsy();     // đóng dd/mm/yy lên ô rỗng là mời Excel vẽ ra 00/01/00
  });

  it("cột CHỮ vẫn là chữ — mã kiểu CT26-032 không bị Excel đoán kiểu", async () => {
    const ws = WS;
    expect(ws.getRow(4).getCell(2).value).toBe("CT26-032");
    expect(typeof ws.getRow(4).getCell(2).value).toBe("string");
    expect(ws.getRow(4).getCell(2).numFmt).toBeFalsy();
  });

  it("nhóm xổ giữ nguyên: dòng con ẩn sẵn, mức outline đúng, nút xổ ở TRÊN", async () => {
    const ws = WS;
    expect(ws.getRow(4).outlineLevel).toBe(0);    // dòng dự án
    expect(ws.getRow(5).outlineLevel).toBe(1);    // công đoạn con
    expect(ws.getRow(5).hidden).toBe(true);       // thu lại mặc định — người dùng đã chốt, đừng đổi
    // summaryBelow: false = nút xổ nằm ở dòng dự án phía TRÊN. Gán qua `as any` nên phải soi lại
    // trong file thật chứ không tin vào mã nguồn.
    expect((ws.properties as unknown as { outlineProperties?: { summaryBelow?: boolean } })
      .outlineProperties?.summaryBelow).toBe(false);
  });

  it("phần đã có sẵn không bị đụng: tiêu đề, dòng lọc, đóng băng, autoFilter", async () => {
    const ws = WS;
    expect(String(ws.getRow(1).getCell(1).value)).toContain("Báo cáo tiến độ Master Plan");
    expect(String(ws.getRow(2).getCell(1).value)).toContain("Phạm vi:");
    expect(ws.getRow(3).getCell(6).value).toBe("Ngày kết thúc");
    expect(ws.views?.[0]?.ySplit).toBe(3);
    expect(ws.autoFilter).toBeTruthy();
  });
});
