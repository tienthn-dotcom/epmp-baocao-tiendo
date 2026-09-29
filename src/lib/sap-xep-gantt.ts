/**
 * SẮP XẾP BẢNG "TỔNG THỂ TIẾN ĐỘ" THEO CỘT.
 *
 * Người dùng chốt 29/09/2026: *"bên bảng tổng thể tiến độ đang tự sắp xếp theo ngày bàn giao, mà
 * tôi muốn optional hơn cho từng người, nên hãy set up cho tôi được sort theo các cột"*.
 *
 * TRƯỚC ĐÂY bảng này sắp cứng theo Ngày kết thúc rồi tới Mã CT, không ai đổi được. Nay bấm tiêu đề
 * cột là đổi, và lựa chọn đó NHỚ THEO TỪNG MÁY (cùng chỗ nhớ với bề rộng cột và "hiện việc đã
 * xong") — máy anh A sắp theo Quá hạn không làm đổi bảng của anh B.
 *
 * CHUỖI SẮP XẾP RIÊNG với bảng "Việc cần xử lý". Hai bảng nhìn cùng một tập dự án nhưng dùng để
 * làm hai việc khác nhau; bấm sắp xếp ở bảng này mà bảng kia nhảy theo là bất ngờ không cần thiết.
 *
 * LUẬT SO SÁNH lấy đúng của bảng "Việc cần xử lý" để hai bảng hành xử giống nhau:
 *   · Ô TRỐNG LUÔN XUỐNG CUỐI, ở cả chiều tăng lẫn chiều giảm. Dự án chưa có ngày bàn giao mà
 *     nhảy lên đầu khi sắp giảm dần thì nhìn như lỗi.
 *   · Chữ so theo tiếng Việt, có hiểu SỐ trong chuỗi ("CT25-9" trước "CT25-10").
 *   · Sau khoá người dùng chọn, luôn nối thêm tie-break chuẩn để dòng cùng giá trị đứng cạnh nhau
 *     theo thứ tự hợp lý, không nhảy loạn mỗi lần vẽ lại.
 *
 * Module THUẦN để test được — sắp sai thì người ta đọc nhầm dự án nào gấp hơn dự án nào.
 */

/** Các cột bấm sắp xếp được, đúng 8 cột trái của bảng. */
export type KhoaGantt =
  | "updateDate" | "maCT" | "name" | "projectDeadline" | "start" | "finish" | "actualPct" | "overdue";

export type ThuTuGantt = { key: KhoaGantt; dir: "asc" | "desc" };

/** Phần của một dòng Gantt mà việc sắp xếp cần đọc. */
export type DongGantt = {
  updateDate?: string | null;
  maCT?: string | null;
  name?: string | null;
  projEnd?: string | null;
  start?: string | null;
  end?: string | null;
  pct?: number | null;
  overdue?: number | null;
};

/** Thứ tự MẶC ĐỊNH — đúng thứ tự bảng vẫn chạy từ trước, để chưa ai bấm gì thì không có gì đổi. */
export const MAC_DINH: ThuTuGantt[] = [{ key: "finish", dir: "asc" }, { key: "maCT", dir: "asc" }];

/** Nối sau chuỗi người dùng chọn, bỏ khoá đã có. */
const TIE_BREAK: ThuTuGantt[] = [
  { key: "finish", dir: "asc" },
  { key: "maCT", dir: "asc" },
  { key: "name", dir: "asc" },
  { key: "start", dir: "asc" },
];

const mocNgay = (iso?: string | null): number | null =>
  iso ? new Date(iso.slice(0, 10) + "T00:00:00Z").getTime() : null;

function giaTri(d: DongGantt, k: KhoaGantt): number | string | null {
  switch (k) {
    case "updateDate": return mocNgay(d.updateDate);
    case "maCT": return d.maCT || null;
    case "name": return d.name || null;
    case "projectDeadline": return mocNgay(d.projEnd);
    case "start": return mocNgay(d.start);
    case "finish": return mocNgay(d.end);
    case "actualPct": return d.pct ?? null;
    case "overdue": return d.overdue ?? null;
    default: return null;
  }
}

/** Bấm một cột: chưa chọn → giảm dần; bấm lại → tăng dần; bấm lần ba → bỏ cột đó khỏi chuỗi.
 *  Cột đã chọn trước đó tụt xuống làm khoá phụ, giữ tối đa 3 khoá. Giống hệt bảng "Việc cần xử lý". */
export function bamCot(chain: ThuTuGantt[], k: KhoaGantt): ThuTuGantt[] {
  const i = chain.findIndex((s) => s.key === k);
  if (i === 0) {
    if (chain[0].dir === "desc") return [{ key: k, dir: "asc" }, ...chain.slice(1)];
    return chain.slice(1);
  }
  return [{ key: k, dir: "desc" as const }, ...chain.filter((s) => s.key !== k)].slice(0, 3);
}

/** Sắp xếp. KHÔNG sửa mảng gốc. Chuỗi rỗng thì dùng thứ tự mặc định. */
export function sapXepGantt<T extends DongGantt>(rows: readonly T[], chain: readonly ThuTuGantt[]): T[] {
  const dung = chain.length ? chain : MAC_DINH;
  const day: ThuTuGantt[] = [...dung, ...TIE_BREAK.filter((c) => !dung.some((s) => s.key === c.key))];
  return [...rows].sort((a, b) => {
    for (const spec of day) {
      const va = giaTri(a, spec.key), vb = giaTri(b, spec.key);
      if (va == null && vb == null) continue;
      if (va == null) return 1;            // ô trống LUÔN xuống cuối, kể cả khi sắp giảm dần
      if (vb == null) return -1;
      let cmp = 0;
      if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb), "vi", { sensitivity: "base", numeric: true });
      if (cmp !== 0) return spec.dir === "desc" ? -cmp : cmp;
    }
    return 0;
  });
}
