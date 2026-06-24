import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@veydrift/shared": resolve(__dirname, "../shared/src/index.ts"),
      "@keel/shared": resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
