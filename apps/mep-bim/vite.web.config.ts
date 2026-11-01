// Executa somente a interface no navegador (sem Electron), útil para
// desenvolvimento rápido e testes automatizados: npm run dev:web
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react()],
  server: { port: 5180 },
});
