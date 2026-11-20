import { seeded } from '@/data/agents';

/* DEMO fixtures for the Evolution Lab (spec 4.11, 10.9). Deterministic. */

export type Tier = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
export interface LadderStep { tier: Tier; name: string; scope: string; gate: string; hue: number; owner: boolean; tests: string[]; active: number }

export const LADDER: LadderStep[] = [
  { tier: 'L0', name: 'Suggest', scope: 'Prompt and strategy suggestions', gate: 'Auto-eval + peer review', hue: 195, owner: false, tests: ['fixed'], active: 5 },
  { tier: 'L1', name: 'Recipe', scope: 'Declarative locator / recipe improvement', gate: 'Fixed + fresh sets, independent evaluator', hue: 165, owner: false, tests: ['fixed', 'fresh'], active: 3 },
  { tier: 'L2', name: 'Package', scope: 'Agent skill, prompt or role package', gate: 'Fixed + fresh + regression, security review', hue: 215, owner: false, tests: ['fixed', 'fresh', 'regression'], active: 4 },
  { tier: 'L3', name: 'Source', scope: 'Source-code change', gate: 'All suites + security + Owner approval', hue: 275, owner: true, tests: ['fixed', 'fresh', 'regression', 'security'], active: 2 },
  { tier: 'L4', name: 'Structure', scope: 'Company structure / policy change', gate: 'All suites + Owner + constitutional review', hue: 320, owner: true, tests: ['fixed', 'fresh', 'regression', 'security'], active: 1 },
];

export type ProposalStatus = 'draft' | 'queued' | 'testing' | 'review' | 'promoted' | 'rejected';
export interface Proposal {
  id: string; title: string; target: string; role: string; tier: Tier; risk: 'low' | 'medium' | 'high'; author: string;
  hypothesis: string; baseline: string; candidate: string; status: ProposalStatus; expected: string; ageH: number;
}
export const PROPOSALS: Proposal[] = [
  { id: 'EV-118', title: 'Checkout-form locator fallback chain', target: 'Browser-01', role: 'browser', tier: 'L1', risk: 'low', author: 'Optimizer-01', hypothesis: 'Adding role+label fallbacks before CSS selectors cuts locator failures by 30%.', baseline: 'v2.3.0', candidate: 'v2.3.1-c1', status: 'testing', expected: '+4.1 pp pass', ageH: 6 },
  { id: 'EV-117', title: 'Planner: dependency-first decomposition prompt', target: 'Planner-01', role: 'planning', tier: 'L2', risk: 'medium', author: 'Optimizer-01', hypothesis: 'Listing blocking dependencies before tasks reduces re-plans per mission.', baseline: 'v2.4.0', candidate: 'v2.5.0-c2', status: 'review', expected: '-18% re-plans', ageH: 20 },
  { id: 'EV-116', title: 'Coder: test-first scaffold recipe', target: 'Coder-01', role: 'dev', tier: 'L2', risk: 'medium', author: 'Mentor-01', hypothesis: 'Writing the failing test first improves first-attempt QA pass rate.', baseline: 'v2.4.0', candidate: 'v2.5.0-c1', status: 'testing', expected: '+3.2 pp QA pass', ageH: 31 },
  { id: 'EV-115', title: 'Research: citation verifier source ranking', target: 'Researcher-01', role: 'research', tier: 'L0', risk: 'low', author: 'Optimizer-01', hypothesis: 'Ranking primary sources first lowers unverifiable claims.', baseline: 'v2.4.0', candidate: 'strategy-s7', status: 'queued', expected: '-22% unverified', ageH: 40 },
  { id: 'EV-114', title: 'Gateway: cache normalised system prompts', target: 'Model gateway', role: 'optimize', tier: 'L3', risk: 'high', author: 'Coder-01', hypothesis: 'Prompt-cache keys on normalised system prompts cut input cost 14%.', baseline: 'gw-1.8.2', candidate: 'gw-1.9.0-rc1', status: 'review', expected: '-14% cost', ageH: 52 },
  { id: 'EV-113', title: 'Split QA into visual + functional squads', target: 'Organization', role: 'qa', tier: 'L4', risk: 'high', author: 'GM', hypothesis: 'Two specialised QA squads shorten verification queue time.', baseline: 'org-r12', candidate: 'org-r13-draft', status: 'draft', expected: '-26% queue time', ageH: 70 },
  { id: 'EV-112', title: 'Comms: concise-summary tone preset', target: 'Comms-01', role: 'comms', tier: 'L0', risk: 'low', author: 'Mentor-01', hypothesis: 'Shorter status summaries raise read-through rate.', baseline: 'v2.3.8', candidate: 'strategy-s5', status: 'promoted', expected: '+9% read-through', ageH: 120 },
  { id: 'EV-111', title: 'Ops: aggressive retry backoff', target: 'Ops-01', role: 'ops', tier: 'L1', risk: 'low', author: 'Optimizer-01', hypothesis: 'Shorter backoff improves recovery time.', baseline: 'v2.3.9', candidate: 'v2.3.10-c1', status: 'rejected', expected: '-12% MTTR', ageH: 150 },
];

export interface Arm { n: number; pass: number; quality: number; cost: number; latency: number; secReg: number }
export interface Experiment {
  id: string; proposal: string; name: string; status: 'running' | 'complete' | 'failed'; progress: number; evaluator: string; author: string;
  baseline: Arm; candidate: Arm; confidence: number; pValue: number; caps: string; suites: { key: string; n: number; base: number; cand: number }[];
  verdict: 'win' | 'neutral' | 'loss';
}
export const EXPERIMENTS: Experiment[] = [
  { id: 'XP-402', proposal: 'EV-118', name: 'Locator fallback chain vs v2.3.0', status: 'running', progress: 72, evaluator: 'Tester-01', author: 'Optimizer-01',
    baseline: { n: 240, pass: 91.7, quality: 88, cost: 0.41, latency: 6.8, secReg: 0 }, candidate: { n: 240, pass: 95.4, quality: 90, cost: 0.43, latency: 6.5, secReg: 0 },
    confidence: 94, pValue: 0.06, caps: '$18 / 2h cap, sandbox-3', suites: [{ key: 'Fixed', n: 120, base: 92, cand: 96 }, { key: 'Fresh', n: 60, base: 90, cand: 94 }, { key: 'Regression', n: 40, base: 93, cand: 95 }, { key: 'Security', n: 20, base: 100, cand: 100 }], verdict: 'win' },
  { id: 'XP-401', proposal: 'EV-117', name: 'Dependency-first planning prompt', status: 'complete', progress: 100, evaluator: 'Tester-01', author: 'Optimizer-01',
    baseline: { n: 180, pass: 93.9, quality: 86, cost: 0.62, latency: 9.1, secReg: 0 }, candidate: { n: 180, pass: 96.7, quality: 91, cost: 0.58, latency: 8.4, secReg: 0 },
    confidence: 97, pValue: 0.03, caps: '$24 / 3h cap, sandbox-1', suites: [{ key: 'Fixed', n: 90, base: 94, cand: 97 }, { key: 'Fresh', n: 50, base: 92, cand: 96 }, { key: 'Regression', n: 30, base: 95, cand: 97 }, { key: 'Security', n: 10, base: 100, cand: 100 }], verdict: 'win' },
  { id: 'XP-400', proposal: 'EV-116', name: 'Test-first scaffold recipe', status: 'running', progress: 38, evaluator: 'Security-01', author: 'Mentor-01',
    baseline: { n: 96, pass: 94.8, quality: 89, cost: 0.88, latency: 14.2, secReg: 0 }, candidate: { n: 96, pass: 96.9, quality: 90, cost: 0.97, latency: 15.0, secReg: 0 },
    confidence: 71, pValue: 0.29, caps: '$30 / 4h cap, sandbox-2', suites: [{ key: 'Fixed', n: 50, base: 95, cand: 97 }, { key: 'Fresh', n: 26, base: 94, cand: 96 }, { key: 'Regression', n: 12, base: 95, cand: 97 }, { key: 'Security', n: 8, base: 100, cand: 100 }], verdict: 'neutral' },
  { id: 'XP-399', proposal: 'EV-111', name: 'Aggressive retry backoff', status: 'failed', progress: 100, evaluator: 'Tester-01', author: 'Optimizer-01',
    baseline: { n: 150, pass: 97.3, quality: 93, cost: 0.3, latency: 4.2, secReg: 0 }, candidate: { n: 150, pass: 92.0, quality: 88, cost: 0.36, latency: 4.0, secReg: 2 },
    confidence: 99, pValue: 0.01, caps: '$12 / 1h cap, sandbox-3', suites: [{ key: 'Fixed', n: 80, base: 98, cand: 93 }, { key: 'Fresh', n: 40, base: 96, cand: 91 }, { key: 'Regression', n: 20, base: 97, cand: 90 }, { key: 'Security', n: 10, base: 100, cand: 80 }], verdict: 'loss' },
];

export const FAILURE_CLASSES = [
  { key: 'Locator miss', color: 'var(--accent-2)', base: 31, cand: 18 },
  { key: 'Tool timeout', color: 'var(--info)', base: 22, cand: 19 },
  { key: 'Bad plan', color: 'var(--violet)', base: 17, cand: 12 },
  { key: 'Hallucinated fact', color: 'var(--warn)', base: 12, cand: 11 },
  { key: 'Policy block', color: 'var(--gold)', base: 9, cand: 9 },
  { key: 'Other', color: 'var(--text-dim)', base: 6, cand: 5 },
];

export const BENCH_LABELS = Array.from({ length: 14 }, (_, i) => `Run ${i + 1}`);
export function benchSeries() {
  const r = seeded('bench');
  const base = BENCH_LABELS.map((_, i) => Math.round((90.5 + i * 0.12 + r() * 1.6) * 10) / 10);
  const cand = BENCH_LABELS.map((_, i) => Math.round((90.8 + i * 0.42 + r() * 1.4) * 10) / 10);
  return { base, cand };
}
export const BENCH_SUITES = [
  { key: 'Fixed', desc: 'Frozen tasks, never edited by candidates', n: 420, pass: 96.2, kind: 'good' },
  { key: 'Fresh challenge', desc: 'Newly sampled tasks the candidate has never seen', n: 180, pass: 94.4, kind: 'good' },
  { key: 'Regression', desc: 'Previously failed tasks, kept forever', n: 96, pass: 93.8, kind: 'warn' },
  { key: 'Security', desc: 'Prompt-injection, scope and secret-leak probes', n: 64, pass: 100, kind: 'good' },
] as const;

export interface MentorRec { agent: string; role: string; mentor: string; curriculum: string; gained: string; progress: number; reeval: string; trend: number[] }
export const MENTORING: MentorRec[] = [
  { agent: 'Tester-01', role: 'qa', mentor: 'Mentor-01', curriculum: 'Visual-diff triage', gained: 'Visual diff +9 (n=64)', progress: 78, reeval: 'in 2 d', trend: [82, 84, 83, 86, 88, 90, 91] },
  { agent: 'Coder-01', role: 'dev', mentor: 'Mentor-01', curriculum: 'Test-first discipline', gained: 'Testing +6 (n=48)', progress: 55, reeval: 'in 4 d', trend: [88, 89, 88, 90, 91, 92, 93] },
  { agent: 'Comms-01', role: 'comms', mentor: 'Mentor-01', curriculum: 'Concise status summaries', gained: 'Summaries +5 (n=72)', progress: 92, reeval: 'tomorrow', trend: [85, 86, 88, 89, 89, 91, 92] },
  { agent: 'Researcher-01', role: 'research', mentor: 'Analyst-01', curriculum: 'Primary-source citation', gained: 'Citation +7 (n=55)', progress: 41, reeval: 'in 6 d', trend: [86, 87, 87, 89, 90, 90, 92] },
  { agent: 'Ops-01', role: 'ops', mentor: 'Security-01', curriculum: 'Incident runbook drills', gained: 'Incidents +4 (n=30)', progress: 63, reeval: 'in 3 d', trend: [90, 91, 90, 92, 92, 93, 94] },
  { agent: 'Planner-01', role: 'planning', mentor: 'Optimizer-01', curriculum: 'Risk-aware scheduling', gained: 'Risk +8 (n=41)', progress: 30, reeval: 'in 8 d', trend: [84, 85, 87, 87, 88, 90, 91] },
];

export const STAGES = ['Candidate', 'Isolated tests', 'Independent eval', 'Security review', 'Owner approval', 'Staged rollout'];
export interface Reviewer { name: string; kind: 'author' | 'evaluator' | 'security' | 'owner'; independent: boolean; done: boolean }
export interface Promotion {
  id: string; proposal: string; title: string; tier: Tier; from: string; to: string; stage: number; needsOwner: boolean; delta: string; confidence: number;
  secRegressions: number; reviewers: Reviewer[]; rollout: number[]; rollback: string; risk: 'low' | 'medium' | 'high';
}
export const PROMOTIONS: Promotion[] = [
  { id: 'PR-77', proposal: 'EV-114', title: 'Gateway prompt-cache keys', tier: 'L3', from: 'gw-1.8.2', to: 'gw-1.9.0', stage: 4, needsOwner: true, delta: '-14.2% cost, quality flat', confidence: 96, secRegressions: 0, risk: 'high',
    reviewers: [{ name: 'Coder-01', kind: 'author', independent: false, done: true }, { name: 'Tester-01', kind: 'evaluator', independent: true, done: true }, { name: 'Security-01', kind: 'security', independent: true, done: true }, { name: 'Owner', kind: 'owner', independent: true, done: false }], rollout: [10, 50, 100], rollback: 'Route to gw-1.8.2 (immutable, last-good)' },
  { id: 'PR-76', proposal: 'EV-117', title: 'Planner dependency-first prompt', tier: 'L2', from: 'v2.4.0', to: 'v2.5.0', stage: 3, needsOwner: false, delta: '+2.8 pp pass, -18% re-plans', confidence: 97, secRegressions: 0, risk: 'medium',
    reviewers: [{ name: 'Optimizer-01', kind: 'author', independent: false, done: true }, { name: 'Tester-01', kind: 'evaluator', independent: true, done: true }, { name: 'Security-01', kind: 'security', independent: true, done: false }], rollout: [10, 50, 100], rollback: 'Pin new missions to Planner-01 v2.4.0' },
  { id: 'PR-75', proposal: 'EV-118', title: 'Locator fallback chain', tier: 'L1', from: 'v2.3.0', to: 'v2.3.1', stage: 2, needsOwner: false, delta: '+3.7 pp pass', confidence: 94, secRegressions: 0, risk: 'low',
    reviewers: [{ name: 'Optimizer-01', kind: 'author', independent: false, done: true }, { name: 'Tester-01', kind: 'evaluator', independent: true, done: false }], rollout: [25, 100], rollback: 'Recipe flag off, previous locator set restored' },
  { id: 'PR-74', proposal: 'EV-113', title: 'QA squad split (org r13)', tier: 'L4', from: 'org-r12', to: 'org-r13', stage: 4, needsOwner: true, delta: '-26% queue time (modelled)', confidence: 82, secRegressions: 1, risk: 'high',
    reviewers: [{ name: 'GM', kind: 'author', independent: false, done: true }, { name: 'Auditor-01', kind: 'evaluator', independent: true, done: true }, { name: 'Security-01', kind: 'security', independent: true, done: true }, { name: 'Owner', kind: 'owner', independent: true, done: false }], rollout: [100], rollback: 'Restore org-r12 revision (immutable)' },
];

export interface DagNode { id: string; label: string; col: number; row: number; kind: 'stable' | 'current' | 'last-good' | 'candidate' | 'failed' | 'archived'; note: string }
export const DAG_NODES: DagNode[] = [
  { id: 'v2.0.0', label: 'v2.0.0', col: 0, row: 1, kind: 'archived', note: 'First evaluated baseline' },
  { id: 'v2.1.0', label: 'v2.1.0', col: 1, row: 1, kind: 'archived', note: 'Skill package: browser forms' },
  { id: 'v2.2.0', label: 'v2.2.0', col: 2, row: 1, kind: 'last-good', note: 'Last good: all gates green, health check passed' },
  { id: 'x-229', label: 'EV-109', col: 3, row: 0, kind: 'failed', note: 'Failed: +2 security regressions' },
  { id: 'v2.3.0', label: 'v2.3.0', col: 3, row: 1, kind: 'stable', note: 'Stable: pinned by 9 live missions' },
  { id: 'x-111', label: 'EV-111', col: 4, row: 2, kind: 'failed', note: 'Failed: aggressive retry backoff, -5.3 pp' },
  { id: 'v2.4.0', label: 'v2.4.0', col: 4, row: 1, kind: 'current', note: 'Current: default for new instances' },
  { id: 'c-118', label: 'v2.3.1-c1', col: 5, row: 2, kind: 'candidate', note: 'Candidate: locator fallback (testing)' },
  { id: 'c-117', label: 'v2.5.0-c2', col: 5, row: 1, kind: 'candidate', note: 'Candidate: dependency-first plan (review)' },
  { id: 'c-116', label: 'v2.5.0-c1', col: 5, row: 0, kind: 'candidate', note: 'Candidate: test-first scaffold (testing)' },
];
export const DAG_EDGES: [string, string][] = [
  ['v2.0.0', 'v2.1.0'], ['v2.1.0', 'v2.2.0'], ['v2.2.0', 'v2.3.0'], ['v2.2.0', 'x-229'], ['v2.3.0', 'v2.4.0'], ['v2.3.0', 'x-111'],
  ['v2.4.0', 'c-117'], ['v2.4.0', 'c-116'], ['v2.3.0', 'c-118'],
];
export const HISTORY_LOG = [
  { t: 'Nov 19 14:02', e: 'EV-117 sent to independent evaluation', who: 'Optimizer-01', kind: 'info' },
  { t: 'Nov 18 09:40', e: 'EV-112 promoted to stable (L0, auto-approved by policy)', who: 'Tester-01', kind: 'good' },
  { t: 'Nov 17 16:21', e: 'EV-111 rejected: security regression x2, restored v2.3.9', who: 'Security-01', kind: 'bad' },
  { t: 'Nov 15 11:05', e: 'v2.4.0 promoted by Owner after staged rollout 10/50/100', who: 'Owner', kind: 'good' },
  { t: 'Nov 12 08:30', e: 'Learning retained: "role+label locators beat CSS on dynamic forms"', who: 'Knowledge-01', kind: 'violet' },
  { t: 'Nov 09 17:48', e: 'EV-109 failed (2 security regressions); lesson recorded', who: 'Security-01', kind: 'bad' },
];

/* Tiny demo store so the Promotions page and the DL-55 dialog share decisions. */
import { create } from 'zustand';
export type Decision = { verdict: 'approved' | 'rejected'; comment: string; at: number };
interface PromoState { decisions: Record<string, Decision>; decide: (id: string, d: Decision) => void; reset: () => void }
export const usePromos = create<PromoState>((set) => ({
  decisions: {},
  decide: (id, d) => set((s) => ({ decisions: { ...s.decisions, [id]: d } })),
  reset: () => set({ decisions: {} }),
}));
