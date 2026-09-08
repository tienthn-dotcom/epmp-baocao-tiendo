/**
 * PARSER "MasterPlan chi tiết" (app #3) — đọc file cấu trúc GIỐNG MasterPlan nhưng phân cấp SÂU hơn,
 * dựng thành CÂY N-TẦNG (đệ quy). Xem bản đồ cấu trúc trong scratchpad/MAP-file-chi-tiet.md.
 *
 * Quy tắc phân cấp (cột "Stt"):
 *   - số nguyên `1`           → DỰ ÁN (L1); Stt reset mỗi dự án.
 *   - số có chấm `1.2.3`      → tầng = (số dấu chấm)+1; cha = Stt bỏ đoạn cuối.
 *   - chữ đơn `a,b,c`         → con của nút SỐ gần nhất (numeric leaf).
 * Map cột theo TÊN ở hàng tiêu đề (dò động) → chịu được xê dịch cột.
 */
export type DetailNode = {
  level: number;
  stt: string;            // khoá trong 1 dự án (đã chuẩn hoá; chữ → "<numeric>.<chữ>")
  ma: string;             // cột "Mã": VT/SX/TC…
  name: string;           // cột "Mô tả"
  owner: string;
  start: string;
  end: string;
  unit: string;           // cột "ĐVT" — đơn vị tính của khối lượng (m², m³, bộ, cái…)
  qtyTotal: string;       // cột vàng "Khối lượng tổng"
  qtyDone: string;        // cột vàng "Khối lượng đã làm" — % lá = qtyDone / qtyTotal
  pctPlan: string;
  pctActual: string;
  week: string[];         // lưới tuần (giá trị từng cột tuần)
  children: DetailNode[];
};
/** `srcId` — nguon (file) da sinh ra du an nay. DST gop nhieu nguon vao mot bang nen moi dong phai
 *  nho minh tu dau ra: xoa mot nguon la go dung phan cua nguon do, va nut "Mo file goc" tro dung file. */
export type DetailProject = DetailNode & { maCT: string; groupDA: string; location: string; srcId?: string };
export type DetailPlan = { weeks: string[]; projects: DetailProject[] };

type Row = (string | number | null)[];
const S = (v: unknown) => (v == null ? "" : String(v).trim());

/** Dò chỉ số cột theo tên tiêu đề (khớp gần đúng, không phân biệt hoa thường / khoảng trắng). */
function mapCols(header: Row) {
  const H = header.map((h) => S(h).toLowerCase().replace(/\s+/g, " "));
  const has = (i: number, ...kw: string[]) => kw.some((k) => H[i].includes(k));
  const find = (...kw: string[]) => H.findIndex((_, i) => has(i, ...kw));
  const exact = (t: string) => H.findIndex((h) => h === t);
  return {
    stt: exact("stt"),
    ma: exact("mã"),
    mota: find("mô tả"),
    owner: find("người phụ trách"),
    start: find("bắt đầu", "ngày ghi nhận", "ghi nhận"),          // "Bắt đầu" hoặc "Ngày ghi nhận"
    end: find("kết thúc", "deadline cam kết", "deadline"),        // "Kết thúc" hoặc "Deadline cam kết"
    unit: find("đvt", "đơn vị"),                                  // cột "ĐVT"
    qtyTotal: H.findIndex((h) => h.includes("khối lượng") && h.includes("tổng")),        // cột vàng "Khối lượng tổng"
    qtyDone: H.findIndex((h) => h.includes("khối lượng") && (h.includes("đã làm") || h.includes("đã"))), // cột vàng "Khối lượng đã làm"
    pctPlan: find("% dự kiến", "dự kiến"),
    pctActual: H.findIndex((h) => /thực tế/.test(h)),
    maCT: exact("mact"),
    group: find("group da"),
    loc: find("location"),
    // lưới tuần = các cột SAU "Quá hạn"/nguồn lực có nhãn là NGÀY (dd hoặc dd/mm) — bắt từ header số.
  };
}

/** Chỉ số cột đầu của LƯỚI TUẦN = cột đầu tiên (sau cột %/quá hạn) có nhãn dạng ngày ở BẤT KỲ hàng tiêu đề trên. */
function weekStart(rows: Row[], headerRow: number, afterCol: number): number {
  const isDate = (v: unknown) => /^\d{1,2}(\/\d{1,2})?$/.test(S(v));
  for (let c = afterCol; c < (rows[headerRow]?.length ?? 0) + 80; c++) {
    for (let r = 0; r <= headerRow; r++) { if (isDate(rows[r]?.[c])) return c; }
  }
  return -1;
}

export function parseDetailPlan(rows: Row[]): DetailPlan {
  // 1) Tìm hàng tiêu đề (chứa "Stt" + "Mô tả").
  let hr = -1;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const r = (rows[i] ?? []).map(S);
    if (r.includes("Stt") && r.some((c) => /mô tả/i.test(c))) { hr = i; break; }
  }
  if (hr < 0) return { weeks: [], projects: [] };
  const c = mapCols(rows[hr]);
  const wc = weekStart(rows, hr, Math.max(c.pctActual, c.end, c.mota) + 2);
  const weekHeaderRow = rows[hr]; // nhãn tuần lấy ở hàng tiêu đề (nếu trống thì để index)
  const weeks: string[] = [];
  if (wc >= 0) for (let col = wc; col < (weekHeaderRow?.length ?? 0); col++) weeks.push(S(weekHeaderRow[col]) || String(col - wc + 1));

  const g = (r: Row, i: number) => (i >= 0 && r[i] != null ? S(r[i]) : "");
  const weekOf = (r: Row) => (wc < 0 ? [] : weeks.map((_, k) => g(r, wc + k)));

  const projects: DetailProject[] = [];
  let proj: DetailProject | null = null;
  const byStt = new Map<string, DetailNode>();
  const synth = new Set<DetailNode>();                        // nút HEADER tự sinh (cha tới sau) — sẽ khớp lại khi gặp dòng thật
  let lastNumeric: { level: number; stt: string } | null = null;
  const EMPTY: Row = [];

  const node = (r: Row, level: number, stt: string): DetailNode => ({
    level, stt, ma: g(r, c.ma), name: g(r, c.mota), owner: g(r, c.owner),
    start: g(r, c.start), end: g(r, c.end), unit: g(r, c.unit), qtyTotal: g(r, c.qtyTotal), qtyDone: g(r, c.qtyDone), pctPlan: g(r, c.pctPlan), pctActual: g(r, c.pctActual),
    week: weekOf(r), children: [],
  });

  // Đảm bảo MỌI tổ tiên của 1 Stt chấm đã tồn tại (tự sinh header rỗng nếu cha chưa xuất hiện) → trả về nút CHA trực tiếp.
  // Nhờ vậy dòng con LUÔN chui đúng mục cha, không rơi thẳng vào dự án thành dòng "mồ côi" lệch chỗ.
  const ensureParent = (stt: string): DetailNode | null => {
    const parts = stt.split(".");
    let parent: DetailNode | null = byStt.get(parts[0]) ?? proj;   // gốc "3" = dự án
    for (let d = 1; d < parts.length - 1; d++) {
      const key = parts.slice(0, d + 1).join(".");
      let nd = byStt.get(key);
      if (!nd) { nd = node(EMPTY, d + 1, key); synth.add(nd); parent?.children.push(nd); byStt.set(key, nd); }
      parent = nd;
    }
    return parent;
  };

  for (let i = hr + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const stt = g(r, c.stt);
    if (!stt && !g(r, c.mota)) continue;
    if (/^\d+$/.test(stt)) {                                  // DỰ ÁN (L1)
      if (!g(r, c.mota)) continue;                            // số nhưng KHÔNG có tên → dòng tổng/chân trang, bỏ (tránh "khu ma")
      const n = node(r, 1, stt);
      proj = { ...n, maCT: g(r, c.maCT), groupDA: g(r, c.group), location: g(r, c.loc) };
      projects.push(proj); byStt.clear(); byStt.set(stt, proj); lastNumeric = { level: 1, stt };
    } else if (/^\d+(\.\d+)+$/.test(stt)) {                   // numeric dotted
      const segs = stt.split(".");
      if (proj && segs[0] !== proj.stt) {                     // Stt SAI GỐC (gốc ≠ số dự án) → typo nhập liệu: gắn làm con của mục gần nhất
        const parent = (lastNumeric && byStt.get(lastNumeric.stt)) || proj;
        const level: number = (lastNumeric?.level ?? 1) + 1;
        const n = node(r, level, stt);
        parent?.children.push(n); byStt.set(stt, n); lastNumeric = { level, stt };
      } else {
        const level = segs.length;
        const parent = ensureParent(stt);
        const exist = byStt.get(stt);
        if (exist && synth.has(exist)) {                      // đã tự sinh header tạm cho Stt này → ĐIỀN dòng thật vào (giữ nguyên con đã gắn)
          Object.assign(exist, node(r, level, stt), { children: exist.children });
          synth.delete(exist); lastNumeric = { level, stt };
        } else {                                              // dòng mới (kể cả trùng Stt thật) → gắn dưới đúng cha
          const n = node(r, level, stt);
          parent?.children.push(n); byStt.set(stt, n); lastNumeric = { level, stt };
        }
      }
    } else if (/^[A-Za-z]+$/.test(stt)) {                     // chữ → con của numeric leaf
      const parent = lastNumeric ? byStt.get(lastNumeric.stt) ?? proj : proj;
      const level = (lastNumeric?.level ?? 1) + 1;
      const key = (lastNumeric?.stt ?? "") + "." + stt;
      const n = node(r, level, key);
      parent?.children.push(n); byStt.set(key, n);
    }
  }
  // Dọn HEADER TẠM chưa được điền (cha xuất hiện sau mà rốt cuộc KHÔNG có dòng thật) → bỏ, kéo con lên đúng cấp trên.
  const prune = (list: DetailNode[]): DetailNode[] => {
    const out: DetailNode[] = [];
    for (const ch of list) {
      ch.children = prune(ch.children);
      if (synth.has(ch)) out.push(...ch.children);   // header tạm rỗng: bỏ mình, giữ con
      else out.push(ch);
    }
    return out;
  };
  projects.forEach((p) => { p.children = prune(p.children); });
  return { weeks, projects };
}

/** Đếm tổng số nút (để hiện "N đầu việc"). */
export function countNodes(n: DetailNode): number {
  return 1 + n.children.reduce((s, ch) => s + countNodes(ch), 0);
}
