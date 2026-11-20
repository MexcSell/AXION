// Opens EVERY registered dialog (with no props and with a rich props bag), asserts it renders as an
// aria-modal dialog with no errors, records its spec DL id, and checks Escape closes it.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5190';
let ids = [];
const bag = {
  missionId: 'M-126', agentId: 'coder-01', artifactId: 'M-126-A1', version: 'v1.0', approvalId: 'APR-M-126-1', taskId: 'T-12601',
  k: 'mission.aiSummary', mode: 'reply', question: 'Publish now?', replyTo: 'APR-M-126-1',
  message: { id: 'm1', from: 'gm', to: 'coder-01', kind: 'report', text: 'hello', agoMin: 3 },
  attachment: { id: 'a1', name: 'evidence.png', kind: 'image', size: '12 KB' },
};
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1672, height: 941 } });
await ctx.addInitScript(() => localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { motion: 'reduced' }, version: 0 })));
const p = await ctx.newPage(); await p.addInitScript(() => localStorage.setItem('axion.testhook', '1'));
let errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(base + '/overview', { waitUntil: 'networkidle' });
ids = (await p.evaluate(() => window.__axion.dialogIds())).sort().map((id) => ({ id, file: '' }));
const rows = []; let fails = 0;
for (const { id, file } of ids) {
  for (const [label, props] of [['no-props', undefined], ['props', bag]]) {
    errs = [];
    await p.evaluate(() => window.__axion.closeAll());
    await p.waitForTimeout(450);
    await p.evaluate(([id, props]) => window.__axion.openDialog(id, props), [id, props]);
    let ok = true, dl = '', note = '';
    try {
      await p.waitForSelector('[aria-modal=true]', { timeout: 2500 });
      dl = await p.locator('[aria-modal=true]').last().getAttribute('data-dialog') ?? '';
      const title = await p.locator('[aria-modal=true] #modal-title').last().textContent().catch(() => '');
      if (/could not open/i.test(title ?? '')) { ok = false; note = 'error boundary'; }
      await p.keyboard.press('Escape');
      await p.waitForTimeout(700);
      if (await p.locator('[aria-modal=true]').count()) { note += ' Escape did not close'; ok = false; }
    } catch { ok = false; note = 'no modal rendered'; }
    if (errs.length) { ok = false; note += ' ' + errs[0].slice(0, 140); }
    if (!ok) fails++;
    rows.push(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(26)} ${label.padEnd(8)} ${dl.padEnd(7)} ${file}${note ? '  <- ' + note : ''}`);
  }
}
console.log(rows.join('\n'));
console.log(`\n${ids.length} dialogs × 2 = ${rows.length} checks, ${fails} failures`);
writeFileSync('docs/dialog-ledger.txt', rows.join('\n') + '\n');
await b.close();
