import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

// The web UI is built to dist/ui and served by the Markas host (`markas serve`).
export default defineConfig({
  root: fileURLToPath(new URL("./src/renderer", import.meta.url)),
  plugins: [solidPlugin(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL("./dist/ui", import.meta.url)),
    emptyOutDir: true,
  },
});
