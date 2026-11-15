import solidPlugin from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Hot reload is for the dev server; in tests it breaks module loading on Windows.
  plugins: [solidPlugin({ hot: false })],
  test: {
    environment: "jsdom",
    globals: true,
    // Helper worktrees under .claude hold copies of the tests; never run those.
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/**"],
    setupFiles: ["./src/renderer/src/setupTests.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/testing/**", "src/renderer/src/ui/icons.ts"],
      reporter: ["text-summary", "json-summary"],
    },
  },
});
