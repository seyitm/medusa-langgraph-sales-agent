import { defineConfig } from "vitest/config";

export default defineConfig({
  logLevel: "error",
  test: {
    environment: "node",
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
