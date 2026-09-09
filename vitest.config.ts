import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Cho phép chạy tests bằng `npx vitest run` trên máy không có bun:
// parser.test.ts import từ "bun:test" — alias sang "vitest" (API test/expect tương thích).
export default defineConfig({
  resolve: {
    alias: {
      "bun:test": "vitest",
      // App import theo "@/lib/..." — không khai ở đây thì test nào dùng đường dẫn đó không nạp được.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
