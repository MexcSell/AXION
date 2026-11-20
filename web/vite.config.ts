import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const API = process.env.AXION_API || 'http://127.0.0.1:5191';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@contracts': fileURLToPath(new URL('../shared/contracts/src/index.ts', import.meta.url)), '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // /api goes to the AXION server (127.0.0.1:5191; AXION_API=http://127.0.0.1:5192 for the e2e server).
  server: { host: '127.0.0.1', port: 5190, strictPort: false, proxy: { '/api': { target: API, changeOrigin: false } }, fs: { allow: ['..'] } },
  preview: { host: '127.0.0.1', port: 4190, proxy: { '/api': { target: API, changeOrigin: false } } },
  build: { chunkSizeWarningLimit: 1500 },
});
