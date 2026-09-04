/**
 * FILE SKILL — "AI Decision & ETL Engine" cho PMO Nội thất.
 * Đây là BỘ NÃO (tri thức + quy tắc + hợp đồng đầu ra) mà AI/engine dùng để chẩn đoán tiến độ.
 *
 * Dùng ở 2 nơi:
 *   • Engine TẤT ĐỊNH (pmo-engine.ts) đọc các HẰNG SỐ luật ở đây để tính health-check / delay / bottleneck /
 *     mức cảnh báo — minh bạch, audit được, không cần LLM.
 *   • Lớp DIỄN GIẢI (LLM) dùng PMO_SYSTEM_PROMPT làm system prompt (RAG: nạp thêm record + skill) để
 *     sinh root_cause_summary / recommended_decisions / suggested_issue_update bằng ngôn ngữ tự nhiên.
 */

// ── QUY TRÌNH DỰ ÁN CHUẨN (thứ tự công đoạn, để phân tích tác động dây chuyền) ──────────────────
// Thiết kế/Shop Drawing → Duyệt Mẫu (MA) → Đặt Vật tư (VT) → Triển khai SX (TKSX) → SX Nhập kho (SX)
// → Thi công Lắp đặt (TC) → Bàn giao (BOT/Handover).
export const STAGE_PIPELINE = ["MA", "VT", "TKSX", "SX", "TC"] as const;
export type Stage = (typeof STAGE_PIPELINE)[number];
export const STAGE_LABEL: Record<string, string> = {
  MA: "Duyệt mẫu", VT: "Đặt vật tư", TKSX: "Triển khai SX", SX: "Sản xuất nhập kho", TC: "Thi công lắp đặt",
};
export const STAGE_ORDER: Record<string, number> = Object.fromEntries(STAGE_PIPELINE.map((s, i) => [s, i]));
const EARLY_STAGES: Stage[] = ["MA", "VT", "TKSX"];   // công đoạn đầu (chuẩn bị)
const LATE_STAGES: Stage[] = ["SX", "TC"];            // công đoạn sau (sản xuất/thi công)
export const isEarlyStage = (s: string) => EARLY_STAGES.includes(s as Stage);
export const isLateStage = (s: string) => LATE_STAGES.includes(s as Stage);

// ── NGƯỠNG 4 MỨC CẢNH BÁO (chốt theo skill PMO) ────────────────────────────────────────────────
export type AlertLevel = "NORMAL" | "WARNING" | "HIGH_RISK" | "CRITICAL";
export const ALERT_RULES = {
  // WARNING: trễ công đoạn ĐẦU (VT/TKSX/MA) ≤ 3 ngày, chưa ảnh hưởng mốc Bàn giao.
  earlyDelayWarnMax: 3,
  // HIGH_RISK: trễ SX/TC 4–7 ngày, có rủi ro trễ mốc Bàn giao.
  lateDelayHighMin: 4,
  lateDelayHighMax: 7,
  // CRITICAL: trễ mốc Bàn giao (BOT) HOẶC blocker chưa có giải pháp > 48h.
  blockerCriticalHours: 48,
} as const;

// ── HỢP ĐỒNG ĐẦU RA (JSON chuẩn để App tự trigger UI/thông báo) ────────────────────────────────
export type PmoDiagnosis = {
  project_id: string;
  etl_health_check: {
    data_integrity: "VALID" | "INVALID_LOGIC";
    detected_anomalies: string[];
  };
  pmo_diagnosis: {
    overall_status: AlertLevel;
    critical_bottleneck_stage: Stage | null;
    delay_days_vs_bot: number;                 // >0 = trễ so với mốc bàn giao/cam kết
    root_cause_summary: string;
  };
  decision_making: {
    primary_action: string;
    recommended_decisions: string[];
    assigned_to_pic: string;
    suggested_issue_update: string;
  };
};

/** Ngữ cảnh bổ sung ngoài record (mốc bàn giao, blocker, lịch sử cập nhật) — điền dần khi nối ePMP. */
export type ProjectContext = {
  botDate?: string;              // mốc Bàn giao cam kết (dd/mm/yy) — nếu có
  openBlockerHours?: number;     // blocker chưa giải quyết bao nhiêu giờ (từ Vướng mắc)
  hasIssueText?: boolean;        // cột Vướng mắc có nội dung chưa
  latePic?: string;              // PIC hay cập nhật trễ (từ Update History)
};

/** SYSTEM PROMPT cho lớp LLM (khi chốt engine A: Claude API). Đã gói role + ETL logic + luật + hợp đồng. */
export const PMO_SYSTEM_PROMPT = `Bạn là "Chuyên gia Phân tích Dữ liệu Dự án Nội thất & Thư ký PMO Cấp cao" (Senior PMO & Interior Project Data Analyst) cho team Project Planning.

LĨNH VỰC: Thi công & Sản xuất Nội thất (khối dự án, căn hộ mẫu, villa, văn phòng, khách sạn).
QUY TRÌNH CHUẨN: Thiết kế/Shop Drawing → Duyệt Mẫu (MA) → Đặt Vật tư (VT) → Triển khai SX (TKSX) → Sản xuất Nhập kho (SX) → Thi công Lắp đặt (TC) → Bàn giao (BOT/Handover).

Bạn nhận DỮ LIỆU ĐÃ CHUẨN HOÁ (records: dự án, công đoạn, đầu việc, ngày kế hoạch/thực tế, %, khối lượng, vướng mắc, PIC). Thực hiện tư duy ETL 3 bước:

1) EXTRACT & VALIDATE: phát hiện mâu thuẫn logic thời gian (deadline TC trước deadline SX; chưa có ngày bắt đầu thực tế nhưng đã 100%); dữ liệu thiếu (trễ nhưng cột Vướng mắc trống).
2) TRANSFORM & ROOT CAUSE: tính số ngày chậm (delay days) so với mốc cam kết/Bàn giao; phân tích TÁC ĐỘNG DÂY CHUYỀN (chậm VT → kéo TKSX → trễ SX → nguy cơ vỡ mốc TC); phân tích xu hướng theo lịch sử cập nhật.
3) LOAD & DECISION: phân loại 4 mức — 🟢 NORMAL (đúng hạn) / 🟡 WARNING (trễ công đoạn đầu VT/TKSX ≤3 ngày, chưa ảnh hưởng bàn giao) / 🟠 HIGH_RISK (trễ SX/TC 4–7 ngày, rủi ro trễ bàn giao) / 🔴 CRITICAL (trễ mốc Bàn giao HOẶC blocker chưa giải quyết >48h).

NGUYÊN TẮC BẮT BUỘC:
- CHỈ kết luận dựa trên số liệu được cấp; KHÔNG bịa số; nếu thiếu dữ liệu, nói rõ "thiếu dữ liệu".
- Luôn TRÍCH DẪN mã CT / công đoạn cụ thể trong phần root_cause_summary.
- Bạn CỐ VẤN — con người QUYẾT. Không tự thực thi hành động.
- Trả về ĐÚNG JSON theo schema PmoDiagnosis, không thêm chữ ngoài JSON.`;
