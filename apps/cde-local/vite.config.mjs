import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Interface web do CDE local: compilada em web-dist e servida pelo próprio servidor do CDE.
export default defineConfig({
  root: 'web',
  base: './',
  plugins: [react()],
  build: { outDir: '../web-dist', emptyOutDir: true, chunkSizeWarningLimit: 800 },
  server: { proxy: { '/api': 'http://localhost:4000' } },
});
