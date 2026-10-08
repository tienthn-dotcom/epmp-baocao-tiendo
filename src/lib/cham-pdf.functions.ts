/**
 * ĐỌC NGƯỢC NHẬT KÝ → DẤU TUÂN THỦ THEO LƯỢT XUẤT PDF.
 *
 * Luật chấm nằm ở src/lib/cham-theo-pdf.ts (module thuần, test được). Đây chỉ là đường lấy dữ liệu:
 * hỏi D1 lấy các dòng `export_pdf_duan` trong một tháng, rồi trả về NGUYÊN mốc thời gian + mã dự án.
 *
 * TRẢ VỀ MỐC THÔ, KHÔNG CHẤM Ở SERVER. Chấm ở client bằng đúng module đã test; server mà chấm thêm
 * một lần nữa là có hai bản luật, rồi một ngày nào đó hai bản lệch nhau mà không ai biết bên nào đúng.
 *
 * QUYỀN: hàm này KHÔNG trả email ai bấm, chỉ trả mã dự án + mốc giờ — tức là số liệu của báo cáo,
 * không phải nhật ký giám sát. Nên mở cho PMO/BOD xem như báo cáo tuân thủ, không bắt phải admin.
 * (fetchActivityLog vẫn admin-only vì nó trả nguyên nhật ký kèm email.)
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { khoaDuAn, type LuotXuat } from "@/lib/cham-theo-pdf";

type D1Nhe = {
  prepare(q: string): { bind(...a: unknown[]): { all<T>(): Promise<{ results?: T[] }> } };
};

async function getD1(): Promise<D1Nhe | null> {
  try {
    const mod = (await import("@tanstack/react-start/server")) as Record<string, unknown>;
    const ev = (mod.getEvent as undefined | (() => unknown))?.() as
      { context?: { cloudflare?: { env?: Record<string, unknown> } } } | undefined;
    const d1 = ev?.context?.cloudflare?.env?.PMO_LOG;
    if (d1) return d1 as D1Nhe;
  } catch { /* runtime khác */ }
  const g = globalThis as unknown as Record<string, unknown>;
  const env = (g.__env__ ?? null) as Record<string, unknown> | null;
  return ((env?.PMO_LOG ?? g.PMO_LOG) as D1Nhe | undefined) ?? null;
}

/** Dòng trả về: mốc ISO + mã CT. KHÔNG kèm email — xem ghi chú quyền ở đầu file. */
export type LuotPdf = LuotXuat;

export const fetchLuotXuatPdf = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({
    /** "YYYY-MM" — tháng cần lấy, theo giờ VN. */
    thang: z.string().regex(/^\d{4}-\d{2}$/),
  }).parse(input))
  .handler(async ({ data }): Promise<{ luot: LuotPdf[] }> => {
    const d1 = await getD1();

    /* KHOẢNG LẤY NỚI RA MỖI ĐẦU MỘT NGÀY. Nhật ký ghi ISO theo UTC còn ngày chấm tính theo giờ VN
       (UTC+7), nên một lượt xuất lúc 00:30 ngày 01 giờ VN nằm ở 17:30 ngày 31 tháng trước theo UTC.
       Cắt đúng mép tháng theo UTC là mất những lượt đó — mất im lặng, bảng vẫn đầy. Lấy dư rồi để
       bên gom tự xếp vào đúng ngày VN. */
    const [nam, thg] = data.thang.split("-").map(Number);
    const tu = new Date(Date.UTC(nam, thg - 1, 1) - 86_400_000).toISOString();
    const den = new Date(Date.UTC(nam, thg, 1) + 86_400_000).toISOString();

    try {
      const tho = d1
        ? (await d1
            .prepare("SELECT ts, detail FROM access_log WHERE action = ? AND ts >= ? AND ts < ? ORDER BY ts ASC")
            .bind("export_pdf_duan", tu, den)
            .all<{ ts: string; detail: string | null }>()).results ?? []
        /* KHÔNG CÓ D1 (chạy ở máy) → đọc tệp nhật ký dev, y như activity.functions.ts. Thiếu nhánh
           này thì ở máy không bao giờ thử được vòng khép kín "bấm xuất → thấy dấu", mà đó lại đúng
           là thứ cần xem trước khi đẩy lên live. */
        : await docNhatKyDev(tu, den);
      const luot: LuotPdf[] = [];
      for (const r of tho) {
        const duAn = khoaDuAn(r.detail);
        if (duAn) luot.push({ ts: r.ts, duAn });       // dòng không đọc ra mã CT thì bỏ, KHÔNG đoán
      }
      return { luot };
    } catch {
      /* Bảng chưa có (app chưa ghi lần nào) → coi như chưa có lượt nào. Không ném: báo cáo vẫn phải
         mở được, chỉ là cột theo PDF còn trống. */
      return { luot: [] };
    }
  });

/** Đọc tệp nhật ký khi chạy ở máy (không có D1). Đường dẫn khớp DEV_LOG_FILE của activity.functions.ts. */
async function docNhatKyDev(tu: string, den: string): Promise<{ ts: string; detail: string | null }[]> {
  try {
    const fs = await import("node:fs/promises");
    const rows = JSON.parse(await fs.readFile(".data/pmo-access-log.json", "utf8")) as
      { ts: string; action: string; detail?: string | null }[];
    return rows
      .filter((r) => r.action === "export_pdf_duan" && r.ts >= tu && r.ts < den)
      .map((r) => ({ ts: r.ts, detail: r.detail ?? null }))
      .sort((a, b) => a.ts.localeCompare(b.ts));
  } catch { return []; }
}
