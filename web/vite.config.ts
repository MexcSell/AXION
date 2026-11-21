import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { WEB_SECURITY_HEADERS } from './security-headers.ts';

const API = process.env.AXION_API || 'http://127.0.0.1:5191';
// When the API drops a streamed response (restart), end the browser's side too, so EventSource reconnects at once
// instead of holding a silent, dead stream (http-proxy keeps it open otherwise).
type Proxy = { on: (ev: 'proxyRes', f: (up: NodeJS.ReadableStream & { on: (e: string, f: () => void) => void }, req: unknown, res: { destroy: () => void; writableEnded: boolean }) => void) => void };
const apiProxy = { target: API, changeOrigin: false, configure: (proxy: Proxy) => { proxy.on('proxyRes', (up, _req, res) => { up.on('aborted', () => res.destroy()); up.on('close', () => { if (!res.writableEnded) res.destroy(); }); }); } };

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@contracts': fileURLToPath(new URL('../shared/contracts/src/index.ts', import.meta.url)), '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // /api goes to the AXION server (127.0.0.1:5191; AXION_API=http://127.0.0.1:5192 for the e2e server).
  server: { host: '127.0.0.1', port: 5190, strictPort: false, proxy: { '/api': apiProxy }, fs: { allow: ['.', '../shared'], deny: ['.env', '.env.*', '*.dump', '**/backups/**', '**/server/**'] } },
  preview: { host: '127.0.0.1', port: 4190, proxy: { '/api': apiProxy }, headers: WEB_SECURITY_HEADERS }, // cycle 14: strict CSP on the built app
  build: { chunkSizeWarningLimit: 1500 },
});
