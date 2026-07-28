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
  it("Đánh giá tuân thủ: DEV bật, LIVE tắt (21/07 tạm ẩn bản nâng cấp trên live)", () => {
    expect(featureOn("complianceReport", "dev")).toBe(true);
    expect(featureOn("complianceReport", "live")).toBe(false);
  });
  it("Tác vụ con Gantt: DEV bật, LIVE tắt (21/07 tạm ẩn dòng con trên live)", () => {
    expect(featureOn("ganttChildTasks", "dev")).toBe(true);
    expect(featureOn("ganttChildTasks", "live")).toBe(false);
  });
  it("App Shell (thanh dọc multi-app): DEV bật, LIVE tắt (đang phát triển, chưa cho lên live)", () => {
    expect(featureOn("appShell", "dev")).toBe(true);
    expect(featureOn("appShell", "live")).toBe(false);
  });
});
