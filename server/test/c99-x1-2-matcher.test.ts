import { describe, it, expect } from 'vitest';
import { globMatch, matchesAnyPattern } from '../src/exec-profile/paths.ts';
import { mulberry32 } from '../src/evolution/stats.ts';

// The c99 speed-up of globMatch must not change any answer. REFERENCE is the c94 matcher exactly as it was at 8a02c4b (full-array DP).
type RTok = { t: 'lit'; c: string } | { t: 'any1' } | { t: 'star' } | { t: 'dstar' } | { t: 'dslash' };
function refTokenise(glob: string): RTok[] {
  const out: RTok[] = [];
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { i += 2; if (out[out.length - 1]?.t !== 'dslash') out.push({ t: 'dslash' }); } else { i += 1; if (out[out.length - 1]?.t !== 'dstar') out.push({ t: 'dstar' }); }
    } else if (c === '*') { if (out[out.length - 1]?.t !== 'star') out.push({ t: 'star' }); }
    else if (c === '?') out.push({ t: 'any1' });
    else out.push({ t: 'lit', c: c.toLowerCase() });
  }
  return out;
}
function refMatch(glob: string, path: string): boolean {
  const toks = refTokenise(glob);
  const p = path.toLowerCase();
  const n = p.length;
  let dp = new Uint8Array(n + 1); dp[0] = 1;
  for (const tk of toks) {
    const nx = new Uint8Array(n + 1);
    if (tk.t === 'lit') { for (let i = 0; i < n; i++) if (dp[i] && p[i] === tk.c) nx[i + 1] = 1; }
    else if (tk.t === 'any1') { for (let i = 0; i < n; i++) if (dp[i] && p[i] !== '/') nx[i + 1] = 1; }
    else if (tk.t === 'star') { let run = 0; for (let j = 0; j <= n; j++) { run = dp[j] || (run && j > 0 && p[j - 1] !== '/') ? 1 : 0; nx[j] = run; } }
    else if (tk.t === 'dstar') { let run = 0; for (let j = 0; j <= n; j++) { if (dp[j]) run = 1; nx[j] = run; } }
    else { let seen = 0; for (let j = 0; j <= n; j++) { if (dp[j]) nx[j] = 1; if (j > 0 && p[j - 1] === '/' && seen) nx[j] = 1; if (dp[j]) seen = 1; } }
    dp = nx;
  }
  return dp[n] === 1;
}
describe('c99: the faster glob matcher gives the same answers as the c94 matcher', () => {
  it('300000 seeded random pattern and path pairs, 0 differences', () => {
    const rnd = mulberry32(99001);
    const pick = (a: readonly string[]) => a[Math.floor(rnd() * a.length)];
    const patAlpha = ['a', 'b', 'A', '.', '/', '/', '*', '*', '?', '**', '**/', '.env', 'k', '-'];
    const pathAlpha = ['a', 'b', 'A', '.', '/', '/', 'k', '-', '.env', 'ab', '\u00e9'];
    let diff = 0; let hits = 0;
    for (let i = 0; i < 300_000; i++) {
      let g = ''; const gl = 1 + Math.floor(rnd() * 8); for (let k = 0; k < gl; k++) g += pick(patAlpha);
      let p = ''; const pl = Math.floor(rnd() * 10); for (let k = 0; k < pl; k++) p += pick(pathAlpha);
      const a = refMatch(g, p); const b = globMatch(g, p);
      if (a) hits++;
      if (a !== b) diff++;
    }
    console.info('C99 glob differential: 300000 pairs, %d matches, %d differences', hits, diff);
    expect(hits).toBeGreaterThan(2000);
    expect(diff).toBe(0);
  });
});
describe('c99: matchesAnyPattern (one pass over the directory form) equals the c94 two-pass rule', () => {
  it('100000 seeded random cases including paths with a length-changing character, 0 differences', () => {
    const rnd = mulberry32(99002);
    const pick = (a: readonly string[]) => a[Math.floor(rnd() * a.length)];
    const patAlpha = ['a', 'b', '.', '/', '/', '*', '?', '**/', '**', '.ssh', 'k'];
    const pathAlpha = ['a', 'b', '.', '/', '/', 'k', '.ssh', 'ab', '\u0130'];
    let diff = 0; let hits = 0;
    for (let i = 0; i < 100_000; i++) {
      const pats: string[] = [];
      for (let q = 0; q < 1 + Math.floor(rnd() * 3); q++) { let g = ''; const gl = 1 + Math.floor(rnd() * 6); for (let k = 0; k < gl; k++) g += pick(patAlpha); pats.push(g); }
      let p = ''; const pl = Math.floor(rnd() * 8); for (let k = 0; k < pl; k++) p += pick(pathAlpha);
      const dir = p.endsWith('/') ? p : p + '/';
      const a = pats.some((g) => refMatch(g, p) || refMatch(g, dir));
      const b = matchesAnyPattern(p, pats);
      if (a) hits++;
      if (a !== b) diff++;
    }
    console.info('C99 matchesAnyPattern differential: 100000 cases, %d matches, %d differences', hits, diff);
    expect(hits).toBeGreaterThan(1000);
    expect(diff).toBe(0);
  });
});
