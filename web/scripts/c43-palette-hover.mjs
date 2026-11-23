// Cycle 43: regression check for the command palette's highlighted row. A pointer resting on a row deep in the long initial list used to
// leave the selection index past a shorter filtered list; Enter then ran nothing. Real mouse (the handler is onMouseMove), CPU throttled
// so the hover lands late, as on a loaded machine. Two orders per try: hover then type, and hover racing the typing.
// Usage: BASE=http://127.0.0.1:9290 [TRIES=6] [THROTTLE=4] node scripts/c43-palette-hover.mjs   (exit 1 on any failure)
import { chromium } from 'playwright';
import { signIn } from './_session.mjs';
import { resolveBase } from './_base.mjs';
const base = resolveBase();
const TRIES = Number(process.env.TRIES || 6), THROTTLE = Number(process.env.THROTTLE || 4), ROW = 10;
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1672, height: 941 } });
await signIn(ctx);
const p = await ctx.newPage();
await (await ctx.newCDPSession(p)).send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
const fails = [];
for (let i = 0; i < TRIES; i++) {
  const racing = i % 2 === 1;
  await p.goto(base + '/missions', { waitUntil: 'networkidle' });
  await p.keyboard.press('Control+k');
  const row = p.locator('.palette-item').nth(ROW);
  await row.waitFor({ timeout: 20000 });
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  const hover = p.mouse.move(box.x + 60, box.y + box.height / 2);
  if (!racing) await hover;
  await p.locator('.palette-input').fill('settings navigation');
  await hover;
  await p.keyboard.press('Enter');
  // Enter must run the highlighted row (the first result, or the one the pointer rests on): the palette closes. The old code ran nothing.
  await p.locator('.palette').waitFor({ state: 'detached', timeout: 15000 }).catch(() => fails.push(`try ${i + 1}${racing ? ' (racing)' : ''}: Enter did nothing after a hover on row ${ROW} and a shorter result list (palette still open)`));
}
console.log(fails.length ? 'FAIL ' + fails.join('; ') : `PASS palette Enter after a hover on a deep row, ${TRIES}/${TRIES}`);
await b.close();
process.exit(fails.length ? 1 : 0);
