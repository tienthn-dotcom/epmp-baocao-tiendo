/**
 * CHỐNG MẤT DỮ LIỆU KHI DEPLOY — 2 lớp, tách riêng để dễ gỡ/đọc:
 *   • Lớp 1: NHÁP soạn (Vướng mắc/Giải pháp) lưu vào localStorage → SỐNG QUA reload/ép cập nhật.
 *     + `useUnsavedGuard()` cảnh báo khi đóng/tải lại tab lúc còn nháp chưa gửi.
 *     (ChatBox vốn đã: gửi lỗi thì GIỮ chữ + toast báo; đây bổ sung để reload không mất.)
 *   • Lớp 2: `VersionBanner` hỏi /version.json (bản đang live) mỗi vài phút + khi quay lại tab;
 *     nếu bản live > bản đang mở → banner "Đã có bản mới, tải lại" (không chặn thao tác).
 * /version.json do scripts/patch-wrangler.cjs ghi lúc deploy (đọc APP_VERSION từ routes/index.tsx).
 */
import { useEffect, useState } from "react";

// ── Lớp 1: kho NHÁP bền (localStorage) ─────────────────────────────────────
const DP = "chatdraft:v1:";
export const chatDraftStore = {
  get(k: string): string { try { return localStorage.getItem(DP + k) ?? ""; } catch { return ""; } },
  set(k: string, v: string) { try { if (v) localStorage.setItem(DP + k, v); else localStorage.removeItem(DP + k); } catch { /* private mode… */ } },
  hasAny(): boolean {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(DP) && (localStorage.getItem(key) || "").trim()) return true;
      }
    } catch { /* ignore */ }
    return false;
  },
};

/** Cảnh báo trước khi đóng/tải lại tab nếu còn NHÁP chưa gửi (nháp vẫn được giữ trong localStorage). */
export function useUnsavedGuard() {
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (chatDraftStore.hasAny()) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);
}

// ── Lớp 2: banner báo có bản mới ───────────────────────────────────────────
export function VersionBanner({ current }: { current: string }) {
  const [latest, setLatest] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    const check = async () => {
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { v?: string };
        if (!stop && j?.v && j.v !== current) setLatest(j.v);
      } catch { /* offline / chưa có file → bỏ qua */ }
    };
    void check();
    const iv = setInterval(() => void check(), 3 * 60 * 1000);
    const onVis = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [current]);

  if (!latest) return null;
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999, background: "#0f766e", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "8px 14px", fontSize: 13, fontWeight: 600, flexWrap: "wrap", boxShadow: "0 2px 12px rgba(2,6,23,.28)" }}>
      <span>Đã có bản cập nhật mới ({latest}). Lưu xong hãy tải lại trang để tránh mất dữ liệu.</span>
      <button onClick={() => { try { location.reload(); } catch { /* */ } }}
        style={{ background: "#fff", color: "#0f766e", borderRadius: 6, padding: "4px 14px", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
        Tải lại ngay
      </button>
    </div>
  );
}
