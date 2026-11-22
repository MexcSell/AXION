// Exact, deterministic statistics for evaluation verdicts. Pure: no I/O, no clock, no Math.random.

/** Exact two-sided binomial sign test (p = 0.5). Ties are excluded by the caller: pass only wins and losses. */
export function signTestTwoSided(wins: number, losses: number): { n: number; p: number } {
  if (!Number.isInteger(wins) || !Number.isInteger(losses) || wins < 0 || losses < 0) {
    throw new Error('wins and losses must be non-negative integers');
  }
  const n = wins + losses;
  if (n === 0) return { n: 0, p: 1 };
  const m = Math.min(wins, losses);
  // P(X <= m) * 2 with X ~ Bin(n, 1/2), summed exactly with BigInt: numerator / 2^n
  let c = 1n;
  let num = 0n;
  for (let i = 0; i <= m; i++) {
    num += c;
    c = (c * BigInt(n - i)) / BigInt(i + 1);
  }
  const den = 1n << BigInt(n);
  if (2n * num >= den) return { n, p: 1 };
  return { n, p: ratio(2n * num, den) };
}

function ratio(a: bigint, b: bigint): number {
  // a/b as a double without overflowing Number(b): keep 60 significant bits of each
  const sa = Math.max(0, a.toString(2).length - 60);
  const sb = Math.max(0, b.toString(2).length - 60);
  return (Number(a >> BigInt(sa)) / Number(b >> BigInt(sb))) * 2 ** (sa - sb);
}

// ---- Student t ----

function lgamma(x: number): number {
  // Lanczos approximation (g=7, n=9), relative error ~1e-15
  const g = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = g[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += g[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 500; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

function betaI(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** CDF of Student's t with df degrees of freedom. */
export function tCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const tail = 0.5 * betaI(df / 2, 0.5, x);
  return t > 0 ? 1 - tail : tail;
}

/** The 97.5th percentile of Student's t (two-sided 95 % critical value), by bisection on the exact CDF. */
export function tQuantile975(df: number): number {
  if (!(df >= 1)) throw new Error('df must be >= 1');
  if (df === Infinity) return 1.959964; // the normal 97.5th percentile
  let lo = 0;
  let hi = 1e6;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < 0.975) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface MeanCI { n: number; mean: number | null; low: number | null; high: number | null; df: number | null }

/** Mean of paired differences with a two-sided 95 % t interval. */
export function pairedMeanCI(diffs: number[]): MeanCI {
  const n = diffs.length;
  if (n === 0) return { n, mean: null, low: null, high: null, df: null };
  const mean = diffs.reduce((s, d) => s + d, 0) / n;
  if (n < 2) return { n, mean, low: null, high: null, df: null };
  const sd = Math.sqrt(diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / (n - 1));
  const half = tQuantile975(n - 1) * (sd / Math.sqrt(n));
  return { n, mean, low: mean - half, high: mean + half, df: n - 1 };
}

// ---- pass^k (tau-bench) ----

/**
 * pass^k: the chance that ALL k attempts at a case pass, averaged over cases. With m >= k recorded attempts of which c
 * passed, the unbiased estimate for a case is C(c,k)/C(m,k); for k = m it is the share of cases that passed every
 * attempt. Returns null when there are no cases or any case has fewer than k attempts.
 */
export function passHatK(passes: boolean[][], k: number): number | null {
  if (!passes.length || !Number.isInteger(k) || k < 1) return null;
  let sum = 0;
  for (const row of passes) {
    const m = row.length;
    if (m < k) return null;
    const c = row.filter(Boolean).length;
    let ratioV = 1;
    for (let i = 0; i < k; i++) ratioV *= (c - i) / (m - i);
    sum += Math.max(0, ratioV);
  }
  return sum / passes.length;
}

// ---- seeded resampling ----

/** mulberry32: a small seeded PRNG; same seed, same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percentile bootstrap 95 % interval of the mean, seeded and deterministic. */
export function bootstrapMeanCI(values: number[], resamples: number, seed: number): { low: number; high: number } {
  const n = values.length;
  if (!n) throw new Error('no values');
  const rnd = mulberry32(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += values[Math.floor(rnd() * n)];
    means.push(s / n);
  }
  means.sort((x, y) => x - y);
  const at = (q: number) => means[Math.min(resamples - 1, Math.max(0, Math.floor(q * resamples)))];
  return { low: at(0.025), high: at(0.975) };
}
