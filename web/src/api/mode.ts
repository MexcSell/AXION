/**
 * Data mode (Stage 5).
 *  - 'api'  : sign-in, users, missions, approvals and notifications come from the AXION server (default).
 *  - 'demo' : everything stays in this browser, exactly like the prototype (offline crawls and screenshots).
 * `?data=demo` / `?data=api` switches this tab and is remembered for the tab (it survives client-side navigation).
 * Scripts can also set localStorage 'axion.data-mode' before the app loads.
 */
export type DataMode = 'api' | 'demo';
const KEY = 'axion.data-mode';

function resolve(): DataMode {
  const env = (import.meta.env.VITE_DATA_MODE as string | undefined) === 'demo' ? 'demo' : 'api';
  if (typeof window === 'undefined') return env;
  try {
    const q = new URLSearchParams(window.location.search).get('data');
    if (q === 'demo' || q === 'api') { sessionStorage.setItem(KEY, q); return q; }
    const s = sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY);
    if (s === 'demo' || s === 'api') return s;
  } catch { /* storage blocked */ }
  return env;
}

const MODE: DataMode = resolve();
export const dataMode = (): DataMode => MODE;
export const isApi = () => MODE === 'api';

/** Reload this tab in the other mode. */
export function switchMode(m: DataMode) {
  try { sessionStorage.setItem(KEY, m); } catch { /* ignore */ }
  const u = new URL(window.location.href);
  u.searchParams.set('data', m);
  window.location.assign(u.toString());
}

/**
 * Stage 6 (decision E8): activity numbers (tokens, CPU, RAM, active time) are DEMO data. They are shown, tagged DEMO, for
 * demo mode and DEMO missions; a real mission in api mode shows "not measured yet" (measured from Stage 9/10) and nothing ticks.
 */
export const hasDemoActivity = (m: { demo?: boolean }) => !isApi() || !!m.demo;
