/**
 * BÁO CÁO TUÂN THỦ CẬP NHẬT MASTER PLAN — tính theo THÁNG.
 *
 * LUẬT (chốt với PMO 24/07): chấm theo TỪNG TUẦN, KHOÁ CỨNG theo THỨ trong tuần. Cập nhật phải
 * rơi ĐÚNG tuần đang xét mới được tính — update của tuần khác, hay rơi vào THỨ 2 / cuối tuần,
 * đều KHÔNG "cứu" được tuần này (siết ngày để tuân thủ có nghĩa, không phải ngày nào cũng vào):
 *  • P (đúng hạn)       = cập nhật vào THỨ 3 hoặc THỨ 4 của tuần (hạn chính = THỨ 4).
 *  • o (chậm)           = cập nhật vào THỨ 5 hoặc THỨ 6.
 *  • x (không cập nhật) = hết THỨ 6 mà tuần đó KHÔNG có cập nhật nào rơi vào T3–T6.
 *  • Ô để TRỐNG (null) khi: (a) khung T3→T6 CHƯA đóng (chưa hết THỨ 6) và chưa có cập nhật hợp
 *    lệ — chưa kết luận vội; (b) chưa có dữ liệu lịch sử cho tuần đó — KHÔNG bịa thành "x",
 *    vì báo cáo này dùng để đánh giá PM, một dấu "x" sai là oan cho người ta.
 * VD: hạn THỨ 4 (15/7) nhưng PM đến THỨ 2 (20/7) mới cập nhật → tuần 15/7 = x (20/7 không rơi
 *     vào T3–T6 của tuần nào). Tuần kế (T4 = 22/7) muốn P/o phải cập nhật LẠI trong T3–T6 tuần
 *     đó; giữ nguyên ngày 20/7 (T2) thì tuần 22/7 cũng = x.
 *
 * NGUỒN: `UpdateHistory` = { [projectKey]: các ngày update ĐÃ TỪNG ghi nhận }.
 * Sheet chỉ giữ lần cập nhật GẦN NHẤT nên app phải tự tích luỹ (xem edits.functions.ts).
 */

const DAY = 86400000;

/** Ngày ISO (YYYY-MM-DD) → mốc UTC. Dùng UTC để không lệch múi giờ. */
function ts(iso: string): number {
  return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
}
function toIso(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export type Mark = "P" | "o" | "x" | null;

export type Cycle = {
  /** THỨ 3 — mở khung "đúng hạn" (ISO). */
  tue: string;
  /** Hạn chính: THỨ 4 của tuần (ISO). */
  wed: string;
  /** THỨ 5 — mở khung "chậm" (ISO). */
  thu: string;
  /** THỨ 6 — ĐÓNG khung / chốt tuần (ISO). */
  fri: string;
  /** Ngày chốt tuần = THỨ 6 (giữ field cho phần hiển thị cũ). */
  checkpoint: string;
};

/**
 * Dựng các chu kỳ tuần của 1 THÁNG: mỗi chu kỳ neo theo THỨ 4 nằm trong tháng đó.
 * @param monthKey "YYYY-MM"
 */
export function cyclesOfMonth(monthKey: string): Cycle[] {
  const y = +monthKey.slice(0, 4);
  const m = +monthKey.slice(5, 7) - 1;
  const out: Cycle[] = [];
  const first = Date.UTC(y, m, 1);
  const last = Date.UTC(y, m + 1, 0);
  // Tìm THỨ 4 đầu tiên của tháng (getUTCDay: 0=CN … 3=T4).
  let t = first;
  while (new Date(t).getUTCDay() !== 3) t += DAY;
  for (; t <= last; t += 7 * DAY) {
    out.push({
      tue: toIso(t - DAY),            // THỨ 3 — mở khung đúng hạn
      wed: toIso(t),                  // THỨ 4 — hạn chính
      thu: toIso(t + DAY),            // THỨ 5 — mở khung chậm
      fri: toIso(t + 2 * DAY),        // THỨ 6 — đóng khung (chốt tuần)
      checkpoint: toIso(t + 2 * DAY), // ngày chốt = THỨ 6
    });
  }
  return out;
}

/**
 * Chấm 1 chu kỳ (1 tuần) cho 1 dự án — KHOÁ CỨNG theo THỨ trong tuần.
 * @param dates  các ngày update ĐÃ ghi nhận của dự án (ISO)
 * @param cycle  tuần đang xét (T3=tue, T4=wed, T5=thu, T6=fri)
 * @param today  hôm nay (ISO) — khung T3→T6 chưa đóng thì chưa kết luận
 * @param firstSeen ngày sớm nhất app có dữ liệu; trước mốc này = không biết → null
 */
export function markCycle(dates: string[], cycle: Cycle, today: string, firstSeen: string | null): Mark {
  const tue = ts(cycle.tue), wed = ts(cycle.wed), thu = ts(cycle.thu), fri = ts(cycle.fri);

  // CHỈ tính ngày update rơi ĐÚNG khung của TUẦN NÀY. Có cập nhật hợp lệ thì chấm NGAY (P/o),
  // bất kể firstSeen: có ngày update rơi vào tuần này thì hiển nhiên app ĐÃ biết dự án lúc đó.
  //  • P (đúng hạn): update vào THỨ 3 hoặc THỨ 4.
  if (dates.some(d => { const x = ts(d); return x === tue || x === wed; })) return "P";
  //  • o (chậm): update vào THỨ 5 hoặc THỨ 6.
  if (dates.some(d => { const x = ts(d); return x === thu || x === fri; })) return "o";

  // Chưa có cập nhật hợp lệ mà khung T3→T6 CHƯA đóng (hôm nay ≤ THỨ 6) → CHƯA kết luận (null).
  // Update ở THỨ 2 / cuối tuần / tuần khác không rơi vào khung nên không xét ở đây.
  if (ts(today) <= fri) return null;

  // Khung đã đóng mà tuần này KHÔNG có cập nhật hợp lệ → KHÔNG cập nhật (x). Nhưng chỉ khi app
  // thực sự đã theo dõi dự án tại thời điểm này (firstSeen RIÊNG từng dự án) — tránh đổ oan cho
  // dự án mới vào theo dõi (tuần nằm TRƯỚC ngày app lần đầu biết dự án → null).
  if (!firstSeen || wed < ts(firstSeen)) return null;
  return "x";
}

/* ─────────────────────── CHẤM ĐIỂM TUÂN THỦ (theo THÁNG) ───────────────────────
 * Mô hình "điểm từng tuần rồi lấy trung bình":
 *   • Mỗi TUẦN đã chấm cho điểm: đúng hạn P = 100 · trễ o = 60 · không cập nhật x = 0.
 *   • ĐIỂM DỰ ÁN (tuân thủ) = trung bình điểm các tuần ĐÃ chấm (bỏ tuần null). Toàn P → 100;
 *     toàn x → 0 (đúng chủ trương "không cập nhật toàn bộ thì 0"). Chưa có tuần nào chấm
 *     được → null ("chưa đủ dữ liệu"): KHÔNG chấm 0 vì có thể dự án mới, tránh đổ oan.
 *   • ĐIỂM PM = trung bình điểm các dự án PM quản (dự án null bị bỏ khi lấy trung bình).
 *
 * TRỪ CHẤT LƯỢNG MASTER PLAN (điểm trừ "lặt vặt", CÓ TRẦN): tính theo TỈ LỆ đầu việc đang
 * quản bị khiếm khuyết — thiếu định lượng (%), thiếu ngày, thiếu người phụ trách. Vài lỗi
 * lẻ chỉ trừ nhẹ; 100% đầu việc dính lỗi mới trừ tối đa của loại đó. ĐIỂM CUỐI = kẹp(0..100,
 * điểm cập nhật − trừ chất lượng).
 *
 * MUỐN NỚI/SIẾT: chỉnh đúng các số trong SCORING dưới đây, không phải sửa chỗ nào khác. */
export const SCORING = {
  /** TRỪ ĐIỂM theo LẦN, từ mốc 100 (chốt 23/07): mỗi tuần KHÔNG cập nhật −25, mỗi tuần TRỄ
   *  −10. Điểm kẹp 0..100. Chỉnh 2 số này để nới/siết. */
  deduct: { missed: 25, late: 10 },
  /** Trừ chất lượng: điểm trừ TỐI ĐA mỗi loại (khi 100% đầu việc dính lỗi đó); cộng lại
   *  nhưng không vượt `cap`. Tính theo tỉ lệ nên lỗi lẻ chỉ trừ tương ứng phần nhỏ. */
  quality: { quant: 8, dates: 4, pic: 3, cap: 15 },
};

/** Số liệu khiếm khuyết chất lượng Master Plan của 1 dự án (đếm trên đầu việc ĐANG QUẢN). */
export type QualitySignal = { active: number; missingQuant: number; missingDates: number; missingPic: number };

/** Điểm tuân thủ cập nhật của 1 dự án = 100 − 25×(số X) − 10×(số trễ), kẹp 0..100. CHỈ tính
 *  các tuần ĐÃ chấm (bỏ tuần null); chưa có tuần nào chấm được → null ("chưa đủ dữ liệu"). */
export function updateScoreOf(marks: Mark[]): number | null {
  const assessed = marks.filter((m): m is "P" | "o" | "x" => m === "P" || m === "o" || m === "x");
  if (!assessed.length) return null;
  const x = assessed.filter(m => m === "x").length;
  const o = assessed.filter(m => m === "o").length;
  return Math.max(0, Math.min(100, 100 - SCORING.deduct.missed * x - SCORING.deduct.late * o));
}

/** Điểm trừ chất lượng (0..cap), theo TỈ LỆ đầu việc lỗi. */
export function qualityPenaltyOf(q: QualitySignal | undefined): number {
  if (!q || q.active <= 0) return 0;
  const w = SCORING.quality;
  const pen =
    w.quant * (q.missingQuant / q.active) +
    w.dates * (q.missingDates / q.active) +
    w.pic * (q.missingPic / q.active);
  return Math.min(w.cap, Math.round(pen));
}

export function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Trung bình các điểm (bỏ null). null nếu không có điểm nào — dùng cho ĐIỂM PM. */
export function meanScore(scores: (number | null)[]): number | null {
  const s = scores.filter((v): v is number => v != null);
  if (!s.length) return null;
  return Math.round(s.reduce((a, b) => a + b, 0) / s.length);
}

export type ProjectCompliance = {
  key: string;
  maCT: string;
  name: string;
  pm: string;
  /** Phó PM (DPM) của dự án — để TÁCH NHÓM trách nhiệm (PM+DPM = 1 nhóm). Rỗng nếu không có. */
  dpm: string;
  /** Ngày update gần nhất (ISO) — từ sheet. */
  lastUpdate: string | null;
  marks: Mark[];
  /** Số lần "x" trong tháng. */
  soLanKhongCapNhat: number;
  /** Điểm tuân thủ cập nhật (0..100) TRƯỚC khi trừ chất lượng. null = chưa đủ dữ liệu. */
  updateScore: number | null;
  /** Điểm trừ chất lượng Master Plan (0..cap). */
  qualityPenalty: number;
  /** Số liệu khiếm khuyết (để hiển thị lý do trừ). */
  quality: QualitySignal;
  /** ĐIỂM CUỐI (0..100) = kẹp(updateScore − qualityPenalty). null nếu updateScore null. */
  score: number | null;
};

export type ComplianceReport = {
  monthKey: string;
  cycles: Cycle[];
  projects: ProjectCompliance[];
  /** Chu kỳ gần nhất đã tới hạn (index trong `cycles`), -1 nếu chưa có. */
  cycleHienTai: number;
  /** Thống kê cho chu kỳ hiện tại. */
  duAnDungHan: number;
  duAnTong: number;
  pmDungHan: number;
  pmTong: number;
};

export type ProjectInput = {
  key: string; maCT: string; name: string; pm: string; dpm?: string; updateDate: string | null;
  /** Tín hiệu chất lượng Master Plan (đếm ở nơi gọi, từ đầu việc đang quản). Bỏ trống =
   *  không trừ chất lượng (điểm chỉ theo tuân thủ cập nhật). */
  quality?: QualitySignal;
};

/** Khoá NHÓM trách nhiệm = PM + DPM. Cùng PM nhưng DPM khác nhau ⇒ 2 nhóm riêng biệt.
 *  Không có DPM ⇒ nhóm chính là PM. Dùng cho cả đếm "PM đúng hạn" lẫn gộp hàng ở dialog. */
export function pmGroupKey(pm: string, dpm: string): string {
  return dpm && dpm.trim() ? `${pm}${dpm.trim()}` : pm;
}

/** Dựng báo cáo tuân thủ của 1 tháng. */
export function buildComplianceReport(
  projects: ProjectInput[],
  history: Record<string, string[]>,
  monthKey: string,
  today: string,
): ComplianceReport {
  const cycles = cyclesOfMonth(monthKey);

  const rows: ProjectCompliance[] = projects.map(p => {
    // Lịch sử + ngày hiện tại trên sheet (phòng khi chưa kịp ghi nhận).
    const set = new Set(history[p.key] ?? []);
    if (p.updateDate) set.add(p.updateDate);
    const dates = [...set].sort();
    // #2 FIX: mốc "app lần đầu biết dự án" tính RIÊNG từng dự án = ngày sớm nhất CHÍNH nó
    // có dữ liệu. Trước đây dùng mốc CHUNG toàn bảng nên dự án mới vào theo dõi bị "x" oan
    // cho các tuần đầu tháng → số liệu chênh, "người có người không".
    const firstSeen = dates.length ? dates[0] : null;
    const marks = cycles.map(c => markCycle(dates, c, today, firstSeen));
    const quality: QualitySignal = p.quality ?? { active: 0, missingQuant: 0, missingDates: 0, missingPic: 0 };
    const uScore = updateScoreOf(marks);
    return {
      key: p.key, maCT: p.maCT, name: p.name, pm: p.pm, dpm: (p.dpm ?? "").trim(),
      lastUpdate: dates.length ? dates[dates.length - 1] : null,
      marks,
      soLanKhongCapNhat: marks.filter(m => m === "x").length,
      updateScore: uScore == null ? null : Math.round(uScore),
      // BỎ chấm chất lượng Master Plan (chốt 28/07): điểm CHỈ theo 3 tiêu chí tuân thủ
      // (đúng hạn giữ nguyên · trễ −10 · không cập nhật −25). qualityPenalty giữ 0 cho tương thích.
      qualityPenalty: 0,
      quality,
      score: uScore == null ? null : clampScore(uScore),
    };
  });

  // Chu kỳ hiện tại = chu kỳ CUỐI CÙNG đã tới hạn (T4 <= hôm nay).
  let cycleHienTai = -1;
  cycles.forEach((c, i) => { if (ts(today) >= ts(c.wed)) cycleHienTai = i; });

  let duAnDungHan = 0, duAnTong = 0;
  const pmOk = new Map<string, boolean>();
  if (cycleHienTai >= 0) {
    for (const r of rows) {
      const m = r.marks[cycleHienTai];
      if (m == null) continue;
      duAnTong++;
      if (m === "P") duAnDungHan++;
      // Đếm theo NHÓM PM+DPM (chốt 23/07): cùng PM nhưng DPM khác nhau ⇒ 2 nhóm riêng. Một
      // nhóm "đúng hạn" khi MỌI dự án của nhóm đều P tuần này.
      const gk = pmGroupKey(r.pm, r.dpm);
      const cur = pmOk.get(gk);
      pmOk.set(gk, (cur ?? true) && m === "P");
    }
  }
  return {
    monthKey, cycles, projects: rows, cycleHienTai,
    duAnDungHan, duAnTong,
    pmDungHan: [...pmOk.values()].filter(Boolean).length,
    pmTong: pmOk.size,
  };
}
