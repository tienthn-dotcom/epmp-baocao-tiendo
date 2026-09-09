/**
 * KHO LỊCH SỬ LẮP ĐẶT TRÊN DRIVE — mỗi dự án một file CSV, mỗi ngày vài dòng (một dòng / một khu).
 *
 *    Data Source › DATABASE › ePMP › MTLĐ › Lịch sử › <MÃ CT>.csv
 *
 * Vì sao CSV trên Drive chứ không nhét KV: đây là dữ liệu CỘNG DỒN, càng ngày càng dài, và người
 * dùng phải mở được bằng Excel để tự đối chiếu. KV để cho thứ app đọc liên tục, không phải kho lịch sử.
 *
 * Việc PARSE ma trận nằm ở CLIENT (nơi vốn đã tải file về để vẽ) — worker mà mở .xlsx 2MB là dính
 * Error 1102. Server chỉ nhận mấy dòng số đã tính sẵn rồi ghép vào file.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { docCsv, sangCsv, gopMoc, tenFileLichSu, type MocNgay } from "@/lib/mtld-history";

const DUONG = ["MTLĐ", "Lịch sử"];   // dưới DATABASE › ePMP (ensureDbPath tự thêm hai cấp đó)

const MocSchema = z.object({
  ngay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  maCT: z.string().max(120),
  duAn: z.string().max(300),
  sheet: z.string().max(200),
  khu: z.string().max(200),
  scope: z.string().max(20),
  pct: z.number().nullable(),
  canXong: z.number().int().min(0).max(100000),
  canTong: z.number().int().min(0).max(100000),
});

/** Ghi mốc của MỘT dự án cho MỘT ngày. Chấm lại trong ngày thì đè, không đẻ dòng trùng. */
export const luuMocLapDat = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({
    maCT: z.string().max(120),
    duAn: z.string().max(300),
    rows: z.array(MocSchema).min(1).max(500),
  }).parse(input))
  .handler(async ({ data }): Promise<{ ok: boolean; tong: number; them: number; bo?: string }> => {
    const drive = await import("@/lib/drive.functions");
    if (!(await drive.driveIsConfigured())) return { ok: false, tong: 0, them: 0, bo: "chưa cấu hình Google Drive" };
    const ten = tenFileLichSu(data.maCT, data.duAn);
    const cu = await docFile(drive, ten);
    const gop = gopMoc(cu, data.rows as MocNgay[]);
    if (gop.length === cu.length && cu.length) {
      // Không có gì mới (đã chấm hôm nay, số y hệt) → khỏi ghi đè, đỡ một lượt gọi Drive.
      const nayCoRoi = cu.some((r) => r.ngay === data.rows[0].ngay);
      if (nayCoRoi) return { ok: true, tong: cu.length, them: 0 };
    }
    await drive.driveArchiveText(DUONG, ten, sangCsv(gop), "text/csv");
    return { ok: true, tong: gop.length, them: gop.length - cu.length };
  });

/** Đọc lại toàn bộ lịch sử của một dự án (để vẽ đường cong / bảng). */
export const docMocLapDat = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({
    maCT: z.string().max(120),
    duAn: z.string().max(300),
  }).parse(input))
  .handler(async ({ data }): Promise<{ rows: MocNgay[] }> => {
    const drive = await import("@/lib/drive.functions");
    if (!(await drive.driveIsConfigured())) return { rows: [] };
    return { rows: await docFile(drive, tenFileLichSu(data.maCT, data.duAn)) };
  });

/** Đọc file CSV lịch sử; chưa có file thì coi như kho rỗng (lần chấm đầu tiên của dự án). */
async function docFile(drive: typeof import("@/lib/drive.functions"), ten: string): Promise<MocNgay[]> {
  try {
    const trong = await drive.driveListChildrenImpl(["ePMP", ...DUONG]);
    const f = trong.files.find((x) => x.name === ten);
    if (!f) return [];
    const { text } = await drive.driveReadTextImpl(f.id);
    return docCsv(text);
  } catch { return []; }
}
