// Shared by every verification script: start each browser context signed in as the first administrator.
// The app honours `axion.demo-autologin` only while no account exists (fresh context), so the real
// register → approve flow stays testable (set NO_LOGIN=1 to skip). Owner update 2026-11-20 u1.
export async function signIn(ctx, name = process.env.LOGIN_AS || 'Luca') {
  if (process.env.NO_LOGIN) return;
  await ctx.addInitScript((n) => { try { localStorage.setItem('axion.demo-autologin', n); } catch { /* ignore */ } }, name);
}
