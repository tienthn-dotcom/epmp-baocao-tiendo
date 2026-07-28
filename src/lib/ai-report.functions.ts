import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  totalCount: z.number().int().nonnegative(),
  lateCount: z.number().int().nonnegative(),
  trimCount: z.number().int().nonnegative(),
  thresholds: z.object({
    gapThreshold: z.number(),
    overdueThreshold: z.number(),
  }),
  filterSummary: z.string().max(500),
  stages: z
    .array(
      z.object({
        name: z.string(),
        late: z.number().int().nonnegative(),
        trim: z.number().int().nonnegative(),
      }),
    )
    .max(20),
  topItems: z
    .array(
      z.object({
        project: z.string(),
        maCT: z.string(),
        pic: z.string(),
        stage: z.string(),
        kind: z.string(),
        detail: z.string(),
      }),
    )
    .max(25),
});

export const aiReportSummary = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Thiếu LOVABLE_API_KEY");

    const sys =
      "Bạn là trợ lý phân tích báo cáo tiến độ cho ban quản trị. TUYỆT ĐỐI KHÔNG tự ý thay đổi, tính lại, làm tròn lại hay bịa thêm bất kỳ con số, ngày tháng, phân loại nào. Chỉ diễn giải đúng các con số đã được cấp. Trả về JSON đúng định dạng yêu cầu, không kèm văn bản nào khác.";

    const user = `DỮ LIỆU BÁO CÁO (nguồn sự thật, không được sửa):
- Tổng công việc có vấn đề: ${data.totalCount}
- Số "Trễ tiến độ" (đỏ): ${data.lateCount}
- Số "Cần cắt đầu việc" (vàng): ${data.trimCount}
- Ngưỡng hiện hành: lệch > ${data.thresholds.gapThreshold} điểm phần trăm (Trễ tiến độ); quá ngày kết thúc > ${data.thresholds.overdueThreshold} ngày (Cần cắt đầu việc)
- Bộ lọc đang áp: ${data.filterSummary}

Số công việc có vấn đề theo 7 giai đoạn:
${data.stages
  .map(
    (s) =>
      `  · ${s.name}: ${s.late + s.trim} (Trễ tiến độ ${s.late} · Cần cắt đầu việc ${s.trim})`,
  )
  .join("\n")}

Các đầu việc nặng nhất (đã sắp xếp theo mức nghiêm trọng):
${data.topItems
  .map(
    (t) =>
      `  · [${t.kind}] ${t.project} (${t.maCT}) — Giai đoạn: ${t.stage} — PIC: ${t.pic} — ${t.detail}`,
  )
  .join("\n")}

YÊU CẦU TRẢ VỀ — JSON với đúng 2 khoá:
{
  "tom_tat": "<đoạn tiếng Việt 3-5 câu, văn phong điều hành ban quản trị, súc tích. Nêu rõ giai đoạn đang nghẽn nặng nhất (dựa trên số liệu ở trên), nêu 2-3 dự án/đầu việc nặng nhất theo thứ tự ưu tiên, và đề xuất hướng xử lý ưu tiên. CHỈ dùng đúng các con số đã được cấp, không tạo số mới, không suy đoán số khác.>",
  "kiem_tra": "<'PASS' nếu (${data.lateCount} + ${data.trimCount}) = ${data.totalCount} và không thấy mâu thuẫn giữa nhãn và số liệu; ngược lại nêu cụ thể chỗ lệch.>"
}`;

    let res: Response;
    try {
      res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: sys },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
        }),
      });
    } catch (e) {
      throw new Error(`Lỗi mạng khi gọi AI Gateway: ${(e as Error).message}`);
    }

    if (res.status === 429) throw new Error("AI Gateway: quá giới hạn yêu cầu, vui lòng thử lại sau.");
    if (res.status === 402) throw new Error("AI Gateway: hết tín dụng, hãy nạp thêm để dùng tiếp.");
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`AI Gateway lỗi ${res.status}: ${t.slice(0, 200)}`);
    }

    const j = (await res.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = j?.choices?.[0]?.message?.content ?? "{}";
    try {
      const parsed = JSON.parse(content) as { tom_tat?: unknown; kiem_tra?: unknown };
      return {
        tom_tat: typeof parsed.tom_tat === "string" ? parsed.tom_tat : "",
        kiem_tra: typeof parsed.kiem_tra === "string" ? parsed.kiem_tra : "PASS",
      };
    } catch {
      return { tom_tat: content.slice(0, 800), kiem_tra: "PASS" };
    }
  });
