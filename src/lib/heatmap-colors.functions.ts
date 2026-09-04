/**
 * MÃ MÀU HEATMAP LẤY TỪ DRIVE — chủ nhà chỉ cần **quăng file mã màu mới** vào thư mục
 *     "Data Source" › **Mã màu**
 * là app tự áp, KHÔNG phải sửa code, KHÔNG phải deploy lại.
 *
 * ĐỌC FILE MỚI NHẤT trong thư mục đó. Nhận 2 định dạng cho dễ (Excel bấm "Lưu thành CSV" là xong):
 *   · **CSV / TXT** — mỗi dòng: `<mã màu>,<diễn giải>` (thứ tự 2 cột đảo cũng được, tự nhận cột nào là
 *     mã màu). Có dòng tiêu đề cũng được, tự bỏ. Ngăn cách bằng `,` `;` hoặc Tab.
 *   · **JSON** — `{"Đang thi công":"#d3ef8e", …}` hoặc `[{"name":"…","hex":"…"}]`.
 *
 * KHỚP THEO **DIỄN GIẢI** (bỏ dấu, không phân biệt hoa thường) chứ không theo mã số ô — vì mỗi file
 * ma trận đánh mã khác nhau, nhưng tên công đoạn thì giống. Tên nào không có trong file mã màu thì
 * app lùi về thang màu chuẩn như cũ.
 */
import { createServerFn } from "@tanstack/react-start";

export type ColorRow = { name: string; hex: string };

const FOLDER = "Mã màu";
/** "d9d9d9" / "#D9D9D9" / "FF93C5FD" → "#RRGGBB"; không phải mã màu → null. */
const hex6 = (s: string): string | null => {
  let h = String(s || "").trim().replace(/^#/, "");
  if (h.length === 8) h = h.slice(2);
  return /^[0-9a-fA-F]{6}$/.test(h) ? "#" + h.toUpperCase() : null;
};

/** CSV/TXT → [{name, hex}]. Tự dò cột nào là mã màu nên không sợ đảo cột. */
function parseCsv(text: string): ColorRow[] {
  const out: ColorRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") === false && !line) continue;
    const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cells.length < 2) continue;
    const hi = cells.findIndex((c) => hex6(c));
    if (hi < 0) continue;                                   // dòng tiêu đề / dòng rác → bỏ
    const hex = hex6(cells[hi])!;
    const name = cells.filter((_, i) => i !== hi).find((c) => c && !hex6(c)) || "";
    if (name) out.push({ name, hex });
  }
  return out;
}

function parseJson(text: string): ColorRow[] {
  const out: ColorRow[] = [];
  try {
    const j = JSON.parse(text) as unknown;
    if (Array.isArray(j)) {
      for (const it of j as { name?: string; hex?: string; color?: string; ten?: string }[]) {
        const hex = hex6(it.hex || it.color || ""); const name = (it.name || it.ten || "").trim();
        if (hex && name) out.push({ name, hex });
      }
    } else if (j && typeof j === "object") {
      for (const [k, v] of Object.entries(j as Record<string, string>)) {
        const hex = hex6(v); if (hex && k.trim()) out.push({ name: k.trim(), hex });
      }
    }
  } catch { /* không phải JSON hợp lệ */ }
  return out;
}

/** Đọc bảng mã màu mới nhất. Không có thư mục / không có file hợp lệ → [] (app dùng thang chuẩn sẵn có). */
export const getHeatmapColors = createServerFn({ method: "GET" })
  .handler(async (): Promise<{ colors: ColorRow[]; src: string }> => {
    const drive = await import("@/lib/drive.functions");
    if (!(await drive.driveIsConfigured())) return { colors: [], src: "" };
    try {
      const f = await drive.driveNewestFileIn([FOLDER]);
      if (!f) return { colors: [], src: "" };
      const { text } = await drive.driveReadTextImpl(f.id);
      const rows = /\.json$/i.test(f.name) ? parseJson(text) : (parseCsv(text).length ? parseCsv(text) : parseJson(text));
      return { colors: rows, src: rows.length ? f.name : "" };
    } catch { return { colors: [], src: "" }; }
  });
