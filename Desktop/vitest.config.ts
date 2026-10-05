import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@renderer": resolve(__dirname, "src/renderer/src"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    passWithNoTests: true,
    setupFiles: ["./src/renderer/src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts"],
    // Theta: the app is always a client of a server. Tests must never reach
    // a real one (or the user's real app settings).
    env: {
      THETA_LOCAL_SERVER_URL: "http://127.0.0.1:9",
      THETA_APP_SETTINGS_DIR: resolve(__dirname, "node_modules/.cache/theta-test-settings"),
      HERMES_HOME: resolve(__dirname, "node_modules/.cache/theta-test-home"),
    },
  },
});
