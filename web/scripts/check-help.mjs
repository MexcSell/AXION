// Static check: every help key referenced in src (help="..", k="..", HelpTrigger k, Field help) exists in the registry.
import { chromium } from 'playwright';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk('src').filter((f) => /\.tsx?$/.test(f));
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const pg = await b.newPage(); await pg.addInitScript(() => { localStorage.setItem('axion.testhook', '1'); localStorage.setItem('axion.data-mode', 'demo'); }); await pg.goto((process.env.BASE || 'http://127.0.0.1:5190') + '/overview', { waitUntil: 'networkidle' });
const defined = new Set(await pg.evaluate(() => window.__axion.helpKeys()));
await b.close();
const used = new Map();
const add = (k, f) => used.set(k, [...new Set([...(used.get(k) ?? []), f])]);
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\b(?:help|k)=["']([\w.-]+)["']/g)) add(m[1], f);
  for (const m of s.matchAll(/\b(?:help|helpKey|k):\s*['"]([a-z][\w-]*\.[\w.-]+)['"]/g)) add(m[1], f);
}
const missing = [...used.keys()].filter((k) => !defined.has(k));
console.log(`help entries defined: ${defined.size}, keys referenced: ${used.size}`);
console.log(missing.length ? 'MISSING:\n' + missing.map((k) => `  ${k}  <- ${used.get(k).join(', ')}`).join('\n') : 'All referenced help keys are defined.');
process.exit(missing.length ? 1 : 0);
