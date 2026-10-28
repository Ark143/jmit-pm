import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative base + HashRouter keeps the build portable on GitHub Pages,
  // Netlify, or any static host without a rewrite rule.
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
