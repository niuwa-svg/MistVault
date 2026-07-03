import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const sharedAlias = resolve(__dirname, "src/shared");

export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": sharedAlias
    }
  },
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true
  }
});
