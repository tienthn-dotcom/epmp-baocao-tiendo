/**
 * VÙNG DỰ ÁN — MỘT NƠI DUY NHẤT định nghĩa: chuẩn hoá tên vùng, thứ tự trình bày, màu nhận diện.
 *
 * Nguồn sự thật là file PMP của ePMP (cột Location/Khu vực của đầu việc). Báo cáo tuân thủ và app
 * "Hiệu suất dự án" đều gom theo vùng — trước đây logic nằm trong routes/index.tsx nên app khác
 * không dùng được. Tách ra đây để hai chỗ CHẮC CHẮN chia vùng giống hệt nhau.
 *
 * Nhận đủ kiểu ghi đang có trong dữ liệu: tiếng Anh (North/Middle/South/Overseas), mã ngắn (PQ, MB,
 * MT, MN, NN), tiếng Việt có dấu lẫn không dấu, và tên thành phố hay gặp. Lạ quá thì GIỮ NGUYÊN chữ
 * gốc và xếp xuống cuối — thà lộ ra một nhãn lạ còn hơn âm thầm nhét nhầm vùng.
 */

export const VUNG_ORDER = ["Phú Quốc", "Bắc", "Trung", "Nam", "Nước Ngoài"] as const;

export function vungVN(raw: string): string {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return "—";
  if (/ph[uú]\s*qu[oố]c|^pq$/.test(s)) return "Phú Quốc";
  if (/oversea|overseas|foreign|n[uư][oớ]c\s*ngo[aà]i|^nn$/.test(s)) return "Nước Ngoài";
  if (/north|b[aắ]c|^mb$|h[aà]\s*n[oộ]i|hanoi/.test(s)) return "Bắc";
  if (/middle|central|trung|^mt$|đ[aà]\s*n[aẵ]ng|danang/.test(s)) return "Trung";
  if (/south|nam|^mn$|h[oồ]\s*ch[ií]|hcm|s[aà]i\s*g[oò]n/.test(s)) return "Nam";
  return raw.trim();
}

/** Thứ tự trình bày: Phú Quốc → Bắc → Trung → Nam → Nước Ngoài; vùng lạ / trống xuống cuối. */
export const vungRank = (v: string): number => {
  const i = (VUNG_ORDER as readonly string[]).indexOf(v);
  return i < 0 ? 99 : i;
};

/** Màu nhận diện vùng — dùng làm VIỀN thẻ để liếc một cái là biết cụm nào. Chọn tông đậm, tách bạch
 *  với nhau cả khi in đen trắng (đậm/nhạt khác nhau) lẫn với người mù màu đỏ-lục (đỏ vs xanh dương
 *  vs tím khác hẳn độ sáng). */
export const VUNG_COLOR: Record<string, string> = {
  "Phú Quốc": "#b91c1c",   // đỏ đậm
  "Bắc": "#1d4ed8",        // xanh dương đậm
  "Trung": "#b45309",      // cam đất
  "Nam": "#047857",        // xanh lá đậm
  "Nước Ngoài": "#6d28d9", // tím
};
export const vungColor = (v: string): string => VUNG_COLOR[v] ?? "#94a3b8";

/** Chuẩn hoá TÊN DỰ ÁN để ghép giữa các nguồn (bỏ dấu, bỏ ký tự lạ) — cùng cách với ePMP. */
export function normProjName(s: string): string {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * TRA VÙNG cho một cái tên, chấp nhận tên GỌN hơn tên trong ePMP.
 * App "Hiệu suất dự án" gọi theo nhóm ("43 ĐTM", "APEC S4"), còn ePMP ghi tên dự án đầy đủ
 * ("43 ĐTM_St.Regis_Phòng", "APEC S4 - Khách sạn Marriott - Khối phòng") → khớp thẳng sẽ trượt.
 * Thứ tự: khớp ĐÚNG trước; không có thì tìm các dòng chứa trọn cụm từ đó (đầu / giữa / cuối, theo
 * RANH GIỚI TỪ để "cat ba" không dính vào "cat bao").
 * CHỈ nhận khi MỌI dòng khớp cùng một vùng — dính hai vùng khác nhau thì trả rỗng, thà để "—" còn
 * hơn xếp bừa một dự án vào nhầm cụm.
 */
export function lookupRegion(map: Record<string, string>, name: string): string {
  const k = normProjName(name);
  if (!k) return "";
  if (map[k]) return map[k];
  const hits = new Set<string>();
  for (const [key, v] of Object.entries(map)) {
    if (key.startsWith(k + " ") || key.endsWith(" " + k) || key.includes(" " + k + " ")) hits.add(v);
  }
  return hits.size === 1 ? [...hits][0] : "";
}
