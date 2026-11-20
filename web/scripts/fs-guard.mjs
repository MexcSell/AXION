// Stage 5 fix I6: the dev server must not serve files outside web/ and shared/ (backups, uploads, server code, .env).
// Usage: node scripts/fs-guard.mjs [base]   (needs the dev server)
import { readdirSync } from 'node:fs';
const base = process.argv[2] || process.env.BASE || 'http://127.0.0.1:5190';
const root = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const dumps = (() => { try { return readdirSync(root + '/backups').filter((f) => f.endsWith('.dump')); } catch { return []; } })();
const must404 = [...dumps.map((f) => `/@fs${root}/backups/${f}`), `/@fs${root}/server/README.md`, `/@fs${root}/server/.env`, `/@fs${root}/server/src/app.ts`, `/@fs${root}/update/2026-11-20_u1.md`];
const must200 = [`/@fs${root}/shared/contracts/src/index.ts`, '/src/main.tsx'];
let fail = 0;
for (const p of must404) { const s = (await fetch(base + p)).status; const ok = s === 403 || s === 404; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} blocked ${p} → ${s}`); }
for (const p of must200) { const s = (await fetch(base + p)).status; if (s !== 200) fail++; console.log(`${s === 200 ? 'PASS' : 'FAIL'} served ${p} → ${s}`); }
console.log(fail ? `${fail} FAILED` : 'fs guard OK');
process.exit(fail ? 1 : 0);
