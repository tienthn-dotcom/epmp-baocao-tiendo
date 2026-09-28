/**
 * RANH GIỚI của phần NHÌN trong file Excel (việc V4b).
 *
 * `tests/excel-o-that.test.ts` đã chốt ĐƯỜNG CHÍNH của V4a (ngày là ngày, % là số) và
 * `tests/excel-mau-khop-app.test.ts` canh bảng màu khỏi trôi. File này soi bốn chỗ hai file kia
 * chưa với tới, và đều soi Ở TẦNG HÀNH VI — dựng file thật rồi đọc ngược, không đọc mã nguồn:
 *
 *   1. Ô TRỐNG vs SỐ 0 trong phần nhìn (luật 5.2 áp cho cả hình ảnh). Thang data bar 0..100 DÍNH
 *      CHẶT vào lối lưu `85`; đổi một đầu mà quên đầu kia thì mọi thanh co lại còn 1% bề ngang mà
 *      không có gì báo lỗi. Chốt cả cặp trong MỘT phép kiểm để không thể đổi lệch.
 *   2. Vùng tô có trùm sang KHỐI CHÚ GIẢI hay không. Vùng tính bằng `3 + rows.length`, còn chú
 *      giải thêm vào SAU — thêm một dòng nào trước đó là vùng lệch và chú giải bị vẽ thanh màu.
 *   3. Ngưỡng quá hạn phải LẤY TỪ `OD_ALERT_DAYS`, không phải số 14 gõ lại.
 *   4. Màu khối chú giải phải bằng màu ô thật trong bảng. `excel-mau-khop-app` chỉ so khối `MAU`
 *      (7 mã màu), trong khi `STATUS_FILL` — đúng ba màu mà chú giải giải thích — nằm NGOÀI khối
 *      đó, cùng 59 mã màu khác viết thẳng vào code. Phép kiểm này đóng đúng chỗ hở ấy.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { unzipSync, strFromU8 } from "fflate";
import { oNgay, exportTableXlsx, type XlsxTableRow } from "@/lib/excel-export";
import { OD_ALERT_DAYS } from "@/lib/filter";

/* ── DOM giả để chạy được đường tải file trong node (cùng lối với tests/excel-o-that.test.ts) ── */
let batDuoc: Blob | null = null;
const cuu: Record<string, unknown> = {};
beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  const u = URL as unknown as Record<string, unknown>;
  cuu.document = g.document;
  cuu.createObjectURL = u.createObjectURL;
  cuu.revokeObjectURL = u.revokeObjectURL;
  u.createObjectURL = (b: Blob) => { batDuoc = b; return "blob:gia"; };
  u.revokeObjectURL = () => {};
  g.document = {
    createElement: () => ({ href: "", download: "", click() {}, remove() {} }),
    body: { appendChild() {} },
  };
});
afterAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  const u = URL as unknown as Record<string, unknown>;
  g.document = cuu.document;
  u.createObjectURL = cuu.createObjectURL;
  u.revokeObjectURL = cuu.revokeObjectURL;
});

const COT_PCT = 6;        // 0-based — "% thực tế"
const COT_QUAHAN = 7;     // 0-based — "Quá hạn"
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

/** Ba dòng dựng đúng ba tình huống của luật 5.2: CHƯA ĐO · ĐO ĐƯỢC 0 · ĐO ĐƯỢC 85. */
function dongMau(): XlsxTableRow[] {
  const o = (pct: number | null, quaHan: number | null, mau?: "RED" | "AMBER" | "GREEN") => ({
    kind: "item" as const,
    statusColor: mau,
    cells: [oNgay("2026-09-20"), "CT26-032", "Đầu việc", "Nguyễn Văn A",
            oNgay("2025-01-01"), oNgay("2026-03-01"), pct, quaHan, mau ? "Trễ tiến độ" : "", "", ""],
  });
  return [
    { kind: "group", delivered: false, late: false,
      cells: [oNgay("2026-09-20"), "CT26-032", "Dự án A", "Nguyễn Văn A",
              oNgay("2025-01-01"), oNgay("2026-03-01"), null, null, "", "", ""] },
    o(null, null),                                   // CHƯA ĐO   → ô trống thật
    o(0, 0),                                         // ĐO ĐƯỢC 0 → số 0 thật
    o(85, 30, "RED"),                                // quá hạn NẶNG (>= ngưỡng)
    o(50, 3, "AMBER"),                               // quá hạn nhẹ (> 0)
    o(100, null, "GREEN"),
  ];
}

async function dungFile(rows = dongMau()) {
  batDuoc = null;
  await exportTableXlsx({
    columns: COLS, statusColIndex: 8, finishColIndex: 5,
    pctColIndex: COT_PCT, overdueColIndex: COT_QUAHAN, overdueAlertDays: OD_ALERT_DAYS,
    rows, todayIso: "2026-09-28", filterSummary: "Tất cả",
  });
  expect(batDuoc, "không bắt được file xuất ra").toBeTruthy();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await batDuoc!.arrayBuffer());
  return { wb, ws: wb.getWorksheet("Báo cáo")!, soDong: rows.length };
}

/** Cùng file đó nhưng đọc XML THÔ — thứ Excel thật sự đọc, không qua lớp diễn giải của exceljs. */
async function dungFileXml(rows = dongMau()) {
  batDuoc = null;
  await exportTableXlsx({
    columns: COLS, statusColIndex: 8, finishColIndex: 5,
    pctColIndex: COT_PCT, overdueColIndex: COT_QUAHAN, overdueAlertDays: OD_ALERT_DAYS,
    rows, todayIso: "2026-09-28", filterSummary: "Tất cả",
  });
  const zip = unzipSync(new Uint8Array(await batDuoc!.arrayBuffer()));
  const ten = Object.keys(zip).find((k) => /worksheets\/sheet1\.xml$/.test(k))!;
  return { xml: strFromU8(zip[ten]) };
}

/** Lấy các quy tắc tô điều kiện đã ghi vào file, theo vùng. */
function quyTac(ws: ExcelJSType_Worksheet) {
  const cf = (ws as unknown as { conditionalFormattings?: { ref: string; rules: Record<string, unknown>[] }[] })
    .conditionalFormattings ?? [];
  return cf;
}
type ExcelJSType_Worksheet = ExcelJS.Worksheet;

describe("Ô TRỐNG vs SỐ 0 — luật 5.2 áp cho cả phần nhìn", () => {
  it("chưa đo → ô % TRỐNG THẬT; đo được 0 → SỐ 0 THẬT, hai thứ không được gộp", async () => {
    // Đây là chỗ nặng nhất của cả việc. Trên dữ liệu thật Thực thi đo được 69 ô trống và 129 ô là
    // số 0 thật. Gộp hai thứ lại là biến 69 dòng chưa đo thành "đã đo và được 0" — báo cáo sai về
    // một PM, mà lần này sai bằng HÌNH ẢNH nên càng khó bắt.
    const { ws } = await dungFile();
    const oChuaDo = ws.getRow(5).getCell(COT_PCT + 1);
    const oBangKhong = ws.getRow(6).getCell(COT_PCT + 1);
    expect(oChuaDo.value, "ô chưa đo phải TRỐNG, không phải 0").toBe(null);
    expect(oBangKhong.value, "đo được 0 là một con số THẬT").toBe(0);
    expect(typeof oBangKhong.value).toBe("number");
  });

  it("ô % trống KHÔNG được đóng định dạng — đóng vào là mời Excel vẽ ra một con số", async () => {
    const { ws } = await dungFile();
    expect(ws.getRow(5).getCell(COT_PCT + 1).numFmt).toBeFalsy();
    expect(ws.getRow(6).getCell(COT_PCT + 1).numFmt).toBe('0"%"');   // ô 0 thì CÓ, vì nó có số
  });

  it("BẪY: exceljs KHÔNG ghi showValue / minLength / maxLength vào file — ba tuỳ chọn đó vô hiệu", async () => {
    // Hành vi ĐANG CÓ, không phải hành vi mong muốn. Giữ lại để không ai tin vào ba tuỳ chọn ấy.
    //
    // `excel-export.ts` khai `showValue: true, minLength: 0, maxLength: 100` cho quy tắc dataBar.
    // Đọc XML trong file .xlsx thật ra thì khối `<dataBar>` CHỈ có hai `<cfvo>` và một `<color>` —
    // không một attribute nào trong ba cái kia tới được file. Excel sẽ vẽ theo mặc định của nó,
    // không theo con số code ghi.
    //
    // Vì sao vẫn quan trọng dù nhìn qua thấy ổn: ai sau này đặt `showValue: false` để bỏ chữ trong
    // ô, hoặc đổi `minLength` cho thanh bắt đầu từ 0, sẽ thấy file KHÔNG đổi gì và không hiểu tại
    // sao. Muốn đổi thật thì phải ghi thẳng attribute vào XML, không qua exceljs.
    // Phép kiểm này ĐỎ khi nào exceljs bắt đầu ghi chúng — lúc đó đọc lại ghi chú này.
    const { xml } = await dungFileXml();
    const khoi = /<dataBar>[\s\S]*?<\/dataBar>/.exec(xml);
    expect(khoi, "không tìm thấy khối <dataBar> nào trong file").toBeTruthy();
    expect(khoi![0]).not.toMatch(/showValue/);
    expect(khoi![0]).not.toMatch(/minLength/);
    expect(khoi![0]).not.toMatch(/maxLength/);
    // Hai thứ THẬT SỰ tới được file:
    expect(khoi![0]).toMatch(/<cfvo type="num" val="0"\/>/);
    expect(khoi![0]).toMatch(/<cfvo type="num" val="100"\/>/);
  });

  it("ô % chưa đo không có <v> trong XML — trống ở tầng file, không phải trống ở tầng hiển thị", async () => {
    // Đọc thẳng XML chứ không qua exceljs: thứ Excel đọc là file, không phải đối tượng trong bộ nhớ.
    const { xml } = await dungFileXml();
    expect(xml).toMatch(/<c r="G5"[^>]*\/>/);          // dòng 5 = "chưa đo" → thẻ tự đóng, KHÔNG có <v>
    expect(xml).toMatch(/<c r="G6"[^>]*><v>0<\/v>/);   // dòng 6 = đo được 0 → có <v>0</v>
  });

  it("THANG 0..100 phải đi cùng lối lưu 85 — chốt CẢ CẶP để không ai đổi lệch một đầu", async () => {
    // Nếu sau này đổi sang lưu 0.85 + định dạng `0%` mà quên hạ `cfvo` xuống 0..1, mọi thanh màu
    // co lại còn khoảng 1% bề ngang ô và KHÔNG có gì báo lỗi. Phép kiểm này khẳng định đồng thời:
    // ô lưu 85 (không phải 0.85) VÀ thang chạy tới 100 (không phải 1).
    const { ws } = await dungFile();
    expect(ws.getRow(7).getCell(COT_PCT + 1).value).toBe(85);
    const bar = quyTac(ws).flatMap((c) => c.rules).find((r) => r.type === "dataBar")!;
    const cfvo = bar.cfvo as { type: string; value: number }[];
    expect(cfvo.map((x) => x.value)).toEqual([0, 100]);
  });
});

describe("VÙNG TÔ không được trùm sang khối chú giải", () => {
  it("vùng thanh màu dừng ĐÚNG ở dòng dữ liệu cuối, không ăn sang chú giải", async () => {
    // Vùng tính bằng `3 + rows.length`, còn chú giải `addRow` vào SAU. Thêm bất kỳ dòng nào trước
    // chỗ tính vùng là vùng lệch, và các ô số trong chú giải bị vẽ thanh màu — trông như dữ liệu.
    const { ws, soDong } = await dungFile();
    const bar = quyTac(ws).find((c) => c.rules.some((r) => r.type === "dataBar"))!;
    expect(bar.ref).toBe(`G4:G${3 + soDong}`);
    // Và khối chú giải thật sự nằm SAU dòng đó.
    let dongChuGiai = -1;
    ws.eachRow((r, i) => { if (r.getCell(1).value === "CHÚ GIẢI") dongChuGiai = i; });
    expect(dongChuGiai).toBeGreaterThan(3 + soDong);
  });

  it("vùng tô cột Quá hạn cũng dừng đúng chỗ đó", async () => {
    const { ws, soDong } = await dungFile();
    const cf = quyTac(ws).find((c) => c.rules.some((r) => r.type === "cellIs"))!;
    expect(cf.ref).toBe(`H4:H${3 + soDong}`);
  });
});

describe("NGƯỠNG QUÁ HẠN lấy từ một chỗ duy nhất", () => {
  it("bậc NẶNG dùng đúng OD_ALERT_DAYS của lib/filter, không phải số gõ lại", async () => {
    // `OD_ALERT_DAYS` khai đúng một chỗ (src/lib/filter.ts:34). Nếu ai đổi ngưỡng bên đó mà file
    // Excel vẫn tô theo 14 thì bảng và file nói hai luật khác nhau về cùng một dự án.
    const { ws } = await dungFile();
    const cf = quyTac(ws).find((c) => c.rules.some((r) => r.type === "cellIs"))!;
    const nang = cf.rules.find((r) => r.operator === "greaterThanOrEqual")!;
    const nhe = cf.rules.find((r) => r.operator === "greaterThan")!;
    expect((nang.formulae as string[])[0]).toBe(String(OD_ALERT_DAYS));
    expect((nhe.formulae as string[])[0]).toBe("0");
  });

  it("đúng HAI bậc, không phải thang màu liên tục", async () => {
    // App chia hai bậc (filter.ts:138). Thang liên tục là tự chế một luật thứ ba mà app không chạy.
    const { ws } = await dungFile();
    const cf = quyTac(ws).find((c) => c.rules.some((r) => r.type === "cellIs"))!;
    expect(cf.rules.filter((r) => r.type === "cellIs").length).toBe(2);
    expect(cf.rules.some((r) => r.type === "colorScale")).toBe(false);
  });
});

describe("CHÚ GIẢI phải nói đúng cái đang nằm trong bảng", () => {
  it("màu ô chú giải BẰNG màu ô Tình trạng thật trong bảng", async () => {
    // `excel-mau-khop-app.test.ts` chỉ so khối `MAU` (7 mã). `STATUS_FILL` — đúng ba màu mà chú
    // giải giải thích — nằm NGOÀI khối đó nên không phép kiểm nào canh. Đổi một trong ba mà quên
    // đổi chú giải thì file tự mâu thuẫn: chú giải bảo đỏ là một sắc, ô trong bảng lại sắc khác.
    // So ở tầng FILE nên không phụ thuộc cách viết hằng.
    const { ws } = await dungFile();
    const nen = (dong: number, cot: number) =>
      (ws.getRow(dong).getCell(cot).fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb;

    const oDoTrongBang = nen(7, 9);      // dòng statusColor RED, cột Tình trạng
    const oVangTrongBang = nen(8, 9);    // AMBER
    const oXanhTrongBang = nen(9, 9);    // GREEN
    expect(oDoTrongBang).toBeTruthy();

    let dongMauChuGiai = -1;
    ws.eachRow((r, i) => { if (r.getCell(1).value === "CHÚ GIẢI") dongMauChuGiai = i + 1; });
    expect(dongMauChuGiai).toBeGreaterThan(0);
    const oChuGiai = [1, 2, 3, 4].map((c) => nen(dongMauChuGiai, c));

    for (const mau of [oDoTrongBang, oVangTrongBang, oXanhTrongBang]) {
      expect(oChuGiai, `màu ${mau} có trong bảng nhưng không có ô chú giải nào mang màu đó`).toContain(mau);
    }
  });

  it("chú giải nói ô trống KHÁC 0 — bằng chữ, cho người đọc file chứ không cho người đọc code", async () => {
    const { ws } = await dungFile();
    let chu = "";
    ws.eachRow((r) => { r.eachCell((c) => { if (typeof c.value === "string") chu += c.value + "\n"; }); });
    expect(chu).toMatch(/Ô trống/i);
    expect(chu).toMatch(/khác với 0|khác 0/i);
  });
});

describe("CHIỀU CAO DÒNG — chỉ chốt được phần nằm trong file", () => {
  it("dòng dữ liệu KHÔNG bị đặt chiều cao tay, để Excel tự giãn theo chữ", async () => {
    // Excel chỉ tự giãn chiều cao khi hàng KHÔNG có chiều cao đặt tay. Bỏ `row.height` là điều
    // kiện CẦN, và đây là thứ duy nhất kiểm được từ máy này.
    // KHÔNG kiểm được: Excel thật có giãn ra đủ chữ hay không — cần mở bằng Excel, xem mục ③.
    const { ws } = await dungFile();
    for (const d of [4, 5, 6, 7]) {
      expect(ws.getRow(d).height, `dòng ${d} vẫn bị đặt chiều cao tay`).toBeFalsy();
    }
  });
});
