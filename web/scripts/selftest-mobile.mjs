// c40: forced-failure proof for api-mobile's MEASURE. A static element clipped by 10 px must still be reported;
// the same element marked data-exiting (animating out) is skipped; a fitting element is clean.
// Run: node scripts/selftest-mobile.mjs   (headless browser, no server, no database)
import { chromium } from 'playwright';
import { MEASURE } from './_mobile-measure.mjs';
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
let bad = 0; const t = (n, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); if (!ok) bad++; };
const run = async (html) => { await p.setContent(`<body style="margin:0">${html}</body>`); return p.evaluate(MEASURE); };
const btn = (left, extra = '') => `<div ${extra}><button style="position:absolute;left:${left}px;top:10px;width:60px;height:44px">Go</button></div>`;
t('a static control clipped by 10 px FAILs (reported clipped)', (await run(btn(340))).clipped.length === 1);
t('a static control that fits is clean', (await run(btn(300))).clipped.length === 0);
t('an exiting control (data-exiting) is skipped', (await run(btn(340, 'data-exiting="true"'))).clipped.length === 0);
t('data-exiting="false" does not hide a clipped control', (await run(btn(340, 'data-exiting="false"'))).clipped.length === 1);
t('a static control clipped on the left FAILs', (await run(btn(-10))).clipped.length === 1);
await b.close(); process.exit(bad ? 1 : 0);
