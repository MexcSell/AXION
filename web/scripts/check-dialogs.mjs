// Every openDialog('id') used in src must exist in the runtime dialog registry (needs the dev/preview server).
import { chromium } from 'playwright';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveBase } from './_base.mjs';
const base = resolveBase();
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const used = new Map();
for (const f of walk('src').filter((f) => /\.tsx?$/.test(f))) for (const m of readFileSync(f, 'utf8').matchAll(/openDialog\(\s*['"]([\w-]+)['"]/g)) used.set(m[1], [...new Set([...(used.get(m[1]) ?? []), f])]);
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const p = await b.newPage(); await p.addInitScript(() => { localStorage.setItem('axion.testhook', '1'); localStorage.setItem('axion.data-mode', 'demo'); }); await p.goto(base + '/overview', { waitUntil: 'networkidle' });
const defined = new Set(await p.evaluate(() => window.__axion.dialogIds()));
await b.close();
const missing = [...used.keys()].filter((k) => !defined.has(k));
console.log(`dialogs defined: ${defined.size}, ids opened in code: ${used.size}`);
console.log(missing.length ? 'MISSING:\n' + missing.map((k) => `  ${k}  <- ${used.get(k).join(', ')}`).join('\n') : 'All opened dialog ids are defined.');
console.log('Defined but never opened:', [...defined].filter((k) => !used.has(k)).join(', ') || 'none');
process.exit(missing.length ? 1 : 0);
