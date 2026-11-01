import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    root: "src/renderer",
    base: "./",
    plugins: [react()],
    // web-ifc-api.js traz as classes de todo o schema IFC (~6 MB); carregado do disco.
    build: { chunkSizeWarningLimit: 8000, rollupOptions: { input: resolve(__dirname, "src/renderer/index.html") } },
  },
});
