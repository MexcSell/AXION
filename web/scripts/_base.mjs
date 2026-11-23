// c92 (H23): the one place a verification script resolves its BASE URL.
// An explicit BASE (or a base argument) is always honoured. With none, the live-web default (127.0.0.1:5190) applies ONLY when the
// script runs from the integration tree (/home/luca/AXION), so verify-all and the integrator are unchanged. From anywhere else
// (a lane worktree, /tmp) it refuses instead of silently pointing at the live ports 5190 / 5191.
const INTEGRATION = '/home/luca/AXION';
const LIVE_DEFAULT = 'http://127.0.0.1:5190';

/** Pure: { base } or { error }. `arg` is an optional command-line base (it wins over env). */
export function pickBase({ env, cwd, arg }) {
  const explicit = arg || env.BASE;
  if (explicit) return { base: explicit };
  if (cwd === INTEGRATION || cwd.startsWith(INTEGRATION + '/')) return { base: LIVE_DEFAULT };
  return { error: `BASE is not set and the working directory (${cwd}) is not the integration tree ${INTEGRATION}: refusing to default to the live port 5190. Set BASE=http://127.0.0.1:<your lane port>.` };
}

/** The base URL, or a message on stderr and exit code 2. */
export function resolveBase(arg) {
  const r = pickBase({ env: process.env, cwd: process.cwd(), arg });
  if (r.error) { console.error(r.error); process.exit(2); }
  return r.base;
}
