// Shared by every verification script: start each browser context signed in.
// Demo mode (default for these scripts): the app honours `axion.demo-autologin` only while no account exists (fresh
// context), so the real register → approve flow stays testable (set NO_LOGIN=1 to skip). Owner update 2026-11-20 u1.
// DATA_MODE=api (Stage 5, run through scripts/api-e2e.sh): signs in on the e2e server through its API; the first name
// becomes the administrator, any other name is approved by that administrator first.
import { request } from 'playwright';

const API = process.env.DATA_MODE === 'api';
const BASE = () => process.env.BASE || 'http://127.0.0.1:5190';
/** `networkidle` never fires while the live event stream is open, so api runs wait for the DOM and then settle(). */
export const navWait = () => (API ? 'domcontentloaded' : 'networkidle');
export async function settle(p, ms = 500) {
  if (!API) return;
  try { await p.waitForSelector('.rail-nav', { timeout: 15000 }); await p.waitForSelector('.conn-badge[data-conn="live"]', { timeout: 15000 }); } catch { /* the caller reports what it sees */ }
  await p.waitForTimeout(ms);
}

export async function demoMode(ctx) {
  if (API) { await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); } catch { /* ignore */ } }); return; }
  await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'demo'); } catch { /* ignore */ } });
}

const signedIn = new Map();
const device = { name: 'Chrome on Linux (script)', kind: 'desktop', browser: 'Chrome' };
async function apiConnect(rc, name, password) {
  const r = await rc.post(BASE() + '/api/v1/auth/connect', { data: { name, password, device } });
  return { status: r.status(), body: await r.json().catch(() => ({})) };
}

export async function signIn(ctx, name = process.env.LOGIN_AS || 'Luca') {
  await demoMode(ctx);
  if (process.env.NO_LOGIN) return;
  if (!API) {
    await ctx.addInitScript((n) => { try { localStorage.setItem('axion.demo-autologin', n); } catch { /* ignore */ } }, name);
    return;
  }
  const pass = 'script-pass-1';
  // scripts that open several contexts (e.g. one per screen size) reuse the first sign-in: same browser, same device
  if (signedIn.has(name)) { await ctx.addCookies(signedIn.get(name)); return; }
  const remember = async () => signedIn.set(name, await ctx.cookies());
  if (name === 'Luca') { const r = await apiConnect(ctx.request, 'Luca', pass); if (r.status !== 200) throw new Error('admin sign-in failed: ' + JSON.stringify(r.body)); await remember(); return; }
  const admin = await request.newContext();
  const a = await apiConnect(admin, 'Luca', pass);
  if (a.status !== 200) throw new Error('admin sign-in failed: ' + JSON.stringify(a.body));
  const w = await apiConnect(ctx.request, name, pass);
  if (w.status === 202) {
    const csrf = a.body.me.csrf;
    const users = await (await admin.get(BASE() + '/api/v1/users')).json();
    const u = users.users.find((x) => x.name === name);
    await admin.post(BASE() + `/api/v1/users/${u.id}/approve`, { headers: { 'x-csrf': csrf }, data: {} });
    const ok = await ctx.request.get(BASE() + '/api/v1/auth/wait');
    if (ok.status() !== 200) throw new Error('member approval failed');
  }
  await admin.dispose();
  await remember();
}
