// Shared by every verification script: start each browser context signed in as the first administrator.
// The app honours `axion.demo-autologin` only while no account exists (fresh context), so the real
// register → approve flow stays testable (set NO_LOGIN=1 to skip). Owner update 2026-11-20 u1.
// Stage 5: these scripts check the offline DEMO data, so every context is pinned to demo mode
// (DATA_MODE=api skips that; the api-mode checks are scripts/api-*.mjs).
export async function demoMode(ctx) {
  if (process.env.DATA_MODE === 'api') return;
  await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'demo'); } catch { /* ignore */ } });
}
export async function signIn(ctx, name = process.env.LOGIN_AS || 'Luca') {
  await demoMode(ctx);
  if (process.env.NO_LOGIN) return;
  await ctx.addInitScript((n) => { try { localStorage.setItem('axion.demo-autologin', n); } catch { /* ignore */ } }, name);
}
