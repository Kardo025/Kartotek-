import { createRequire } from "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
const require = createRequire(import.meta.url);

// `vite build --watch` (started by `npm start` at the repository root): copy every rebuild to ..\src\ with the licence banner,
// so the desktop window can reload it. A normal `npm run build` copies in its own second step instead.
const copyToSrc = {
  name: "kartotek-copy-to-src",
  closeBundle() { if (process.env.KARTOTEK_WATCH_COPY === "1") require("./scripts/copy-build.cjs")(); },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), copyToSrc],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "dist", emptyOutDir: true, cssCodeSplit: false, assetsInlineLimit: 100000000,
    lib: { entry: "src/main.jsx", name: "KartotekUI", formats: ["iife"], fileName: () => "ui.js", cssFileName: "ui" }
  }
});
