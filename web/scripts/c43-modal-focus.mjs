// Cycle 43: the dialog's delayed first-field focus (30 ms after mount) must not steal focus from a field already focused inside it.
// Found by flows.mjs "u1 · News": fill() into the textarea landed in the title input when the late focus ran between focus and typing.
// The check focuses the textarea in the same task the dialog appears (MutationObserver), then waits past the timer. Deterministic.
// Usage: BASE=http://127.0.0.1:9290 node scripts/c43-modal-focus.mjs   (exit 1 on failure)
import { chromium } from 'playwright';
import { signIn } from './_session.mjs';
import { resolveBase } from './_base.mjs';
const base = resolveBase();
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1672, height: 941 } });
await signIn(ctx);
const p = await ctx.newPage();
await p.goto(base + '/notifications?tab=news', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: 'Add news' }).first().waitFor({ timeout: 15000 });
const res = await p.evaluate(() => new Promise((resolve) => {
  const mo = new MutationObserver(() => {
    const ta = document.querySelector('.modal textarea');
    if (!ta) return;
    mo.disconnect(); ta.focus(); // the user is already in the content field
    setTimeout(() => resolve({ onTextarea: document.activeElement === ta, active: String(document.activeElement?.tagName) + '.' + String(document.activeElement?.className).slice(0, 30) }), 250);
  });
  mo.observe(document.body, { childList: true, subtree: true });
  [...document.querySelectorAll('button')].find((x) => /Add news/.test(x.textContent))?.click();
  setTimeout(() => resolve({ onTextarea: false, active: 'dialog never opened' }), 8000);
}));
console.log(res.onTextarea ? 'PASS dialog keeps focus in the field already focused' : 'FAIL focus moved to ' + res.active);
await b.close();
process.exit(res.onTextarea ? 0 : 1);
