// Cycle 28: sign-out cleanup must cancel the pending version-proposals refresh (api/events.ts), like every other
// debounced refresh, so the next session never gets a stale re-read. Runs against the demo dev server: it imports the
// app's own modules in the page, swaps EventSource for a fake, and counts refresh requests.
// Usage: BASE=http://127.0.0.1:7690 node scripts/c28-signout-refresh.mjs
import { chromium } from 'playwright';
import { signIn } from './_session.mjs';
import { resolveBase } from './_base.mjs';
const base = resolveBase();
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext(); await signIn(ctx);
const p = await ctx.newPage();
await p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
await p.locator('.mission-row').first().waitFor({ timeout: 20000 });
const r = await p.evaluate(async () => {
  // the same module instance the app uses (the dev server may add a ?t= version to its URL)
  const urlOf = (name) => { const e = performance.getEntriesByType('resource').map((x) => new URL(x.name)).filter((u) => u.pathname === name).pop(); return e ? e.pathname + e.search : name; };
  const sync = await import(urlOf('/src/api/events.ts')); const vp = await import(urlOf('/src/api/versionProposals.ts'));
  const listeners = {};
  window.EventSource = class { static CLOSED = 2; readyState = 1; addEventListener(t, f) { listeners[t] = f; } close() {} };
  const fire = () => listeners['agent.updated']?.({ lastEventId: '', data: JSON.stringify({ subject: { kind: 'agent', id: 'x' } }) });
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  // control: an agent event with the stream left running does request a refresh
  let stop = sync.startSync(); const t0 = vp.versionProposalsTick(); fire(); await wait(400); const control = vp.versionProposalsTick() - t0; stop();
  // sign out while the refresh is pending (150 ms debounce)
  stop = sync.startSync(); const t1 = vp.versionProposalsTick(); fire(); stop(); await wait(400);
  return { control, afterSignOut: vp.versionProposalsTick() - t1 };
});
await b.close();
const ok = r.control >= 1 && r.afterSignOut === 0;
console.log(`${ok ? 'PASS' : 'FAIL'} refresh requested with stream open: ${r.control}; requested after sign-out cleanup: ${r.afterSignOut}`);
process.exit(ok ? 0 : 1);
