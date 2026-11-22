// Cycle 52 (H10): sign-out cleanup must cancel the pending task-reviews refresh (api/events.ts), like every other
// debounced refresh, so the next session never gets a stale re-read. Runs against the demo dev server: it imports the
// app's own modules in the page, swaps EventSource for a fake, and counts refresh requests.
// Usage: BASE=http://127.0.0.1:10190 node scripts/c52-signout-refresh.mjs
import { chromium } from 'playwright';
import { signIn } from './_session.mjs';
const base = process.env.BASE || 'http://127.0.0.1:5190';
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext(); await signIn(ctx);
const p = await ctx.newPage();
await p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
await p.locator('.mission-row').first().waitFor({ timeout: 20000 });
const r = await p.evaluate(async () => {
  // the same module instance the app uses (the dev server may add a ?t= version to its URL)
  const urlOf = (name) => { const e = performance.getEntriesByType('resource').map((x) => new URL(x.name)).filter((u) => u.pathname === name).pop(); return e ? e.pathname + e.search : name; };
  const sync = await import(urlOf('/src/api/events.ts')); const tr = await import(urlOf('/src/api/taskReviews.ts'));
  const listeners = {};
  window.EventSource = class { static CLOSED = 2; readyState = 1; addEventListener(t, f) { listeners[t] = f; } close() {} };
  const fire = () => listeners['task.reviewed']?.({ lastEventId: '', data: JSON.stringify({ subject: { kind: 'task', id: 'x' } }) });
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  // control: a task.reviewed event with the stream left running does request a refresh
  let stop = sync.startSync(); const t0 = tr.taskReviewsTick(); fire(); await wait(400); const control = tr.taskReviewsTick() - t0; stop();
  // sign out while the refresh is pending (150 ms debounce)
  stop = sync.startSync(); const t1 = tr.taskReviewsTick(); fire(); stop(); await wait(400);
  return { control, afterSignOut: tr.taskReviewsTick() - t1 };
});
await b.close();
const ok = r.control >= 1 && r.afterSignOut === 0;
console.log(`${ok ? 'PASS' : 'FAIL'} task-reviews refresh requested with stream open: ${r.control}; requested after sign-out cleanup: ${r.afterSignOut}`);
process.exit(ok ? 0 : 1);
