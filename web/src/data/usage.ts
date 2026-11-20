import { seeded } from '@/data/agents';

/* DEMO fixtures for Usage & Budgets (spec 4.15). Month-to-date spend $2,840 of $3,750 (76%). */
export const SPEND = 2840;
export const BUDGET = 3750;
export const DAYS = Array.from({ length: 20 }, (_, i) => `Nov ${i + 1}`);
export function dailySpend() {
  const r = seeded('daily');
  const raw = DAYS.map((_, i) => 100 + i * 2.2 + r() * 70);
  const tot = raw.reduce((a, b) => a + b, 0);
  const d = raw.map((v) => Math.round((v / tot) * SPEND));
  d[d.length - 1] += SPEND - d.reduce((a, b) => a + b, 0);
  return d;
}
export function cumulative(d: number[]) { let a = 0; return d.map((v) => (a += v)); }

export const BY_MODEL = [
  { label: 'claude-sonnet-5-5', value: 1120, color: 'var(--info)', calls: 48210, tokens: '312M' },
  { label: 'claude-opus-5-5', value: 760, color: 'var(--violet)', calls: 6120, tokens: '38M' },
  { label: 'claude-haiku-5-5', value: 410, color: 'var(--accent-2)', calls: 91400, tokens: '402M' },
  { label: 'claude-fable-5-2', value: 330, color: 'var(--gold)', calls: 2900, tokens: '54M' },
  { label: 'Speech + translate', value: 140, color: 'var(--good)', calls: 12800, tokens: '620 min' },
  { label: 'Embeddings', value: 80, color: 'var(--text-dim)', calls: 188000, tokens: '96M' },
];
export const BY_DEPT = [
  { label: 'Engineering', value: 980, color: 'var(--accent)' },
  { label: 'Research', value: 640, color: 'var(--accent-2)' },
  { label: 'Operations', value: 420, color: 'var(--good)' },
  { label: 'QA', value: 380, color: 'var(--warn)' },
  { label: 'Knowledge', value: 260, color: 'var(--info)' },
  { label: 'Other', value: 160, color: 'var(--text-dim)' },
];
export const LIMITS = [
  { key: 'Monthly spend', used: 2840, cap: 3750, soft: 3000, unit: '$', scope: 'Workspace', consequence: 'Hard cap pauses non-critical missions' },
  { key: 'Opus 5.5 calls / day', used: 410, cap: 600, soft: 480, unit: '', scope: 'Model', consequence: 'Falls back to Sonnet 5.5' },
  { key: 'Website actions / day', used: 1260, cap: 2000, soft: 1600, unit: '', scope: 'Browser', consequence: 'Browser actions queue until reset' },
  { key: 'Speech minutes / month', used: 620, cap: 1500, soft: 1200, unit: ' min', scope: 'Voice', consequence: 'Voice pipeline disabled' },
  { key: 'Run slots (concurrent)', used: 9, cap: 12, soft: 10, unit: '', scope: 'Runtime', consequence: 'New missions wait in queue' },
  { key: 'Memory per instance', used: 3.1, cap: 4, soft: 3.5, unit: ' GB', scope: 'Runtime', consequence: 'Instance compacts memory' },
];
export const ALERTS = [
  { id: 'AL-9', sev: 'warn' as const, title: 'Spend at 76% with 10 days left', body: 'Linear pace projects $4,010 by month end, above the $3,750 cap.', ago: '12 min ago', scope: 'Workspace' },
  { id: 'AL-8', sev: 'bad' as const, title: 'M-131 cost anomaly: 3.4x baseline', body: 'Retry loop on a browser task re-sent full pages. Mission paused by policy.', ago: '3 h ago', scope: 'Mission M-131' },
  { id: 'AL-7', sev: 'warn' as const, title: 'Opus 5.5 at 68% of daily call cap', body: 'Planner and Research are both routing to Opus first.', ago: '5 h ago', scope: 'Model' },
  { id: 'AL-6', sev: 'info' as const, title: 'Cloud speech vendor degraded', body: 'Voice fallback to local TTS is active. No cost impact.', ago: 'Yesterday', scope: 'Provider' },
  { id: 'AL-5', sev: 'good' as const, title: 'Prompt cache saved $212 this week', body: 'Cache hit rate rose from 41% to 58%.', ago: '2 d ago', scope: 'Optimisation' },
];

export interface Scenario { agents: number; missions: number; opusShare: number; cache: number; budget: number }
export const DEFAULT_SCENARIO: Scenario = { agents: 38, missions: 12, opusShare: 18, cache: 58, budget: BUDGET };
/** Month-end projection: simple model over the remaining 10 days. */
export function project(s: Scenario) {
  const d = dailySpend();
  const cum = cumulative(d);
  const base = d.slice(-7).reduce((a, b) => a + b, 0) / 7;
  const mult = (0.55 + (s.agents / 38) * 0.2 + (s.missions / 12) * 0.25) * (1 + (s.opusShare - 18) * 0.012) * (1 - (s.cache - 58) * 0.004);
  const daily = base * mult * 0.715;
  const proj = Array.from({ length: 10 }, (_, i) => Math.round(cum[cum.length - 1] + daily * (i + 1)));
  const lo = proj.map((v, i) => Math.round(cum[cum.length - 1] + (v - cum[cum.length - 1]) * (0.9 - i * 0.004)));
  const hi = proj.map((v, i) => Math.round(cum[cum.length - 1] + (v - cum[cum.length - 1]) * (1.1 + i * 0.006)));
  return { cum, proj, lo, hi, end: proj[proj.length - 1], daily };
}

import { create } from 'zustand';
interface LimitState { over: Record<string, { soft: number; cap: number; note?: string }>; revisions: number; save: (key: string, v: { soft: number; cap: number; note?: string }) => void }
export const useLimits = create<LimitState>((set) => ({ over: {}, revisions: 14, save: (key, v) => set((s) => ({ over: { ...s.over, [key]: v }, revisions: s.revisions + 1 })) }));
export const VERIFIED_OUTCOMES = 1486;
