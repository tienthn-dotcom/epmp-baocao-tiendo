import { defineConfig } from "vitest/config";

// Cho phép chạy tests bằng `npx vitest run` trên máy không có bun:
// parser.test.ts import từ "bun:test" — alias sang "vitest" (API test/expect tương thích).
export default defineConfig({
  resolve: {
    alias: {
      "bun:test": "vitest",
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
