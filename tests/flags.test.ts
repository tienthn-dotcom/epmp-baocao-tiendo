import { describe, it, expect, afterEach } from "vitest";
import { detectStage, featureOn } from "../src/lib/flags";

/** Đặt hostname giả cho window để test detectStage. */
function setHost(h: string | null) {
  if (h === null) { (globalThis as { window?: unknown }).window = undefined; return; }
  (globalThis as { window?: unknown }).window = { location: { hostname: h } };
}
afterEach(() => setHost(null));

describe("detectStage — nhận diện bản LIVE / DEV", () => {
  it("localhost → dev", () => { setHost("localhost"); expect(detectStage()).toBe("dev"); });
  it("127.0.0.1 → dev", () => { setHost("127.0.0.1"); expect(detectStage()).toBe("dev"); });
  it("workers.dev (bản chính thức) → live", () => {
    setHost("baocao-tiendo-pmo.tienthn.workers.dev");
    expect(detectStage()).toBe("live");
  });
  it("SSR (không có window) → live — an toàn, không lỡ hiện tính năng dở", () => {
    setHost(null);
    expect(detectStage()).toBe("live");
  });
  it("subdomain admin/staging deploy riêng sau này → dev", () => {
    setHost("admin.baocao.example.com"); expect(detectStage()).toBe("dev");
    setHost("baocao-admin.tienthn.workers.dev"); expect(detectStage()).toBe("dev");
  });
});

describe("featureOn — ma trận bật/tắt", () => {
  it("Đánh giá tuân thủ: BẬT cả hai bản (28/07 đưa lên live sau khi duyệt số)", () => {
    expect(featureOn("complianceReport", "dev")).toBe(true);
    expect(featureOn("complianceReport", "live")).toBe(true);
  });
  it("Tác vụ con Gantt: BẬT cả hai bản (28/07 đưa lên live)", () => {
    expect(featureOn("ganttChildTasks", "dev")).toBe(true);
    expect(featureOn("ganttChildTasks", "live")).toBe(true);
  });
  it("App Shell (thanh dọc multi-app): BẬT cả hai bản (17/08 deploy app Chi tiết tiến độ)", () => {
    expect(featureOn("appShell", "dev")).toBe(true);
    expect(featureOn("appShell", "live")).toBe(true);
  });
});
