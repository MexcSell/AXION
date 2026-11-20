import { create } from 'zustand';
import { seeded } from './agents';

/** DEMO fixtures for Knowledge (spec §4.10). */
export type KnowType = 'guide' | 'lesson' | 'fact' | 'skill';
export interface KnowItem { id: string; title: string; type: KnowType; scope: string; trust: number; expiresDays: number; source: string; tags: string[]; updatedMin: number; uses: number; summary: string; }
export const KNOWLEDGE: KnowItem[] = [
  { id: 'K-501', title: 'Checkout flow: postal code field is lazy-rendered', type: 'lesson', scope: 'Browser agents', trust: 94, expiresDays: 60, source: 'M-127 · replay RP-88', tags: ['checkout', 'locator'], updatedMin: 120, uses: 31, summary: 'Wait for the shipping form hydration signal before typing; avoids 14% locator misses.' },
  { id: 'K-502', title: 'Design token naming guide', type: 'guide', scope: 'All agents', trust: 98, expiresDays: 365, source: 'design-tokens.json v1.3', tags: ['design', 'tokens'], updatedMin: 900, uses: 112, summary: 'Semantic tokens first (surface, accent); never hardcode hex in components.' },
  { id: 'K-503', title: 'WCAG contrast thresholds used by QA', type: 'fact', scope: 'QA · Dev', trust: 99, expiresDays: 730, source: 'wcag.org/TR/WCAG22', tags: ['a11y'], updatedMin: 4000, uses: 64, summary: '4.5:1 body text, 3:1 large text and UI components.' },
  { id: 'K-504', title: 'Release canary: 10% for 30 minutes', type: 'skill', scope: 'Release team', trust: 92, expiresDays: 120, source: 'Release playbook v4', tags: ['release', 'canary'], updatedMin: 1500, uses: 22, summary: 'Auto rollback when error rate exceeds 1% over two consecutive windows.' },
  { id: 'K-505', title: 'Competitor A pricing tiers (Nov)', type: 'fact', scope: 'M-130 only', trust: 81, expiresDays: 14, source: 'competitor-a.example.org/pricing', tags: ['pricing', 'research'], updatedMin: 240, uses: 9, summary: 'Three tiers, annual discount 17%; enterprise is contact-sales.' },
  { id: 'K-506', title: 'Never bypass CAPTCHA: escalate to owner', type: 'guide', scope: 'Browser agents', trust: 100, expiresDays: 999, source: 'Policy P-07', tags: ['policy', 'browser'], updatedMin: 12000, uses: 40, summary: 'Pause the session and request human takeover; log the gate event.' },
  { id: 'K-507', title: 'CSP header fix pattern for inline styles', type: 'lesson', scope: 'Security · Dev', trust: 88, expiresDays: 90, source: 'M-132 · csp-fix.patch', tags: ['csp', 'security'], updatedMin: 80, uses: 5, summary: 'Use nonce-based style-src; test on staging first with report-only.' },
  { id: 'K-508', title: 'Visual diff threshold calibration', type: 'skill', scope: 'QA', trust: 90, expiresDays: 180, source: 'M-126 · visual-diff-report', tags: ['qa', 'visual'], updatedMin: 520, uses: 17, summary: 'Use 0.3% pixel tolerance with anti-aliasing mask for font rendering.' },
];

export interface ResearchReq { id: string; title: string; agentId: string; state: 'queued' | 'running' | 'review' | 'done'; confidence: number; sources: number; findings: number; ageMin: number; missionId: string; }
export const RESEARCH: ResearchReq[] = [
  { id: 'RS-71', title: 'Competitor pricing & packaging comparison', agentId: 'researcher-01', state: 'running', confidence: 78, sources: 12, findings: 18, ageMin: 190, missionId: 'M-130' },
  { id: 'RS-72', title: 'Best practices: checkout accessibility', agentId: 'analyst-01', state: 'review', confidence: 91, sources: 8, findings: 11, ageMin: 420, missionId: 'M-127' },
  { id: 'RS-73', title: 'CSP report-only rollout strategies', agentId: 'security-01', state: 'done', confidence: 94, sources: 6, findings: 9, ageMin: 1300, missionId: 'M-132' },
  { id: 'RS-74', title: 'Dark-mode contrast on data tables', agentId: 'researcher-01', state: 'queued', confidence: 0, sources: 0, findings: 0, ageMin: 20, missionId: 'M-126' },
];

export interface KSource { id: string; label: string; kind: 'domain' | 'repo' | 'file'; trust: 'verified' | 'reviewed' | 'untrusted'; relevance: number; docs: number; scanMin: number; }
export const SOURCES: KSource[] = [
  { id: 'S-1', label: 'docs.example.com', kind: 'domain', trust: 'verified', relevance: 96, docs: 214, scanMin: 60 },
  { id: 'S-2', label: 'wcag.org', kind: 'domain', trust: 'verified', relevance: 88, docs: 61, scanMin: 1440 },
  { id: 'S-3', label: 'github.com/example/axion-web', kind: 'repo', trust: 'reviewed', relevance: 92, docs: 480, scanMin: 120 },
  { id: 'S-4', label: 'competitor-a.example.org', kind: 'domain', trust: 'untrusted', relevance: 67, docs: 14, scanMin: 240 },
  { id: 'S-5', label: 'brand-guidelines.pdf', kind: 'file', trust: 'reviewed', relevance: 83, docs: 1, scanMin: 5000 },
  { id: 'S-6', label: 'forum.random-tips.net', kind: 'domain', trust: 'untrusted', relevance: 31, docs: 5, scanMin: 900 },
];

export interface Citation { id: string; statement: string; source: string; span: string; hash: string; retrievedMin: number; supported: boolean; }
export const CITATIONS: Citation[] = [
  { id: 'C-1', statement: 'Competitor A offers a 17% annual discount.', source: 'competitor-a.example.org/pricing', span: 'p.2 · "Save 17% with annual billing"', hash: 'sha256:a91c04e2', retrievedMin: 240, supported: true },
  { id: 'C-2', statement: 'Body text must reach a 4.5:1 contrast ratio.', source: 'wcag.org/TR/WCAG22', span: '§1.4.3 · lines 12-14', hash: 'sha256:5be7712d', retrievedMin: 1440, supported: true },
  { id: 'C-3', statement: 'Competitor A churn fell 40% after redesign.', source: 'forum.random-tips.net/t/882', span: '(not found in retrieved text)', hash: 'sha256:00000000', retrievedMin: 900, supported: false },
  { id: 'C-4', statement: 'Nonce-based style-src removes the need for unsafe-inline.', source: 'docs.example.com/security/csp', span: '§3 · "Prefer nonces"', hash: 'sha256:c33d9f10', retrievedMin: 60, supported: true },
  { id: 'C-5', statement: 'Canary of 10% for 30 minutes is the org default.', source: 'Release playbook v4', span: 'p.5 · table 2', hash: 'sha256:19ab7c44', retrievedMin: 1500, supported: true },
];

export interface LearnItem { id: string; lesson: string; missionId: string; agentId: string; evidence: number; confidence: number; dup?: string; conflict?: string; scope: string; }
const L: [string, string, string, number, string?, string?][] = [
  ['Wait for hydration marker before typing in lazy-rendered forms.', 'M-127', 'browser-01', 3, 'K-501'],
  ['Prefer role+name locators; CSS selectors broke 3 times after redesign.', 'M-126', 'tester-01', 5],
  ['Staging pricing page needs a 2 s warm-up before screenshots.', 'M-128', 'browser-02', 2, undefined, 'K-502 says no warm-up needed'],
  ['Release rollback drills should include DB migration checks.', 'M-129', 'release-01', 4],
  ['Skip cookie banner via recipe RC-12 rather than clicking by coordinates.', 'M-132', 'browser-01', 6, 'K-506'],
  ['Competitor pricing pages change copy weekly: re-verify before citing.', 'M-130', 'researcher-01', 2],
];
export const LEARNING: LearnItem[] = L.map(([lesson, missionId, agentId, evidence, dup, conflict], i) => ({
  id: `LQ-${90 + i}`, lesson, missionId, agentId, evidence, confidence: Math.round(70 + seeded(lesson)() * 28), dup, conflict, scope: i % 2 ? 'Mission team' : 'All Browser agents',
}));

interface KState {
  queue: LearnItem[]; items: KnowItem[]; sources: KSource[]; research: ResearchReq[]; decided: { id: string; d: 'accepted' | 'rejected' }[];
  decide: (id: string, d: 'accepted' | 'rejected', edited?: string) => void; addSource: (s: KSource) => void; removeSource: (id: string) => void; addResearch: (r: ResearchReq) => void; edit: (id: string, lesson: string) => void;
}
export const useKnowledge = create<KState>()((set, get) => ({
  queue: LEARNING, items: KNOWLEDGE, sources: SOURCES, research: RESEARCH, decided: [],
  decide: (id, d, edited) => {
    const it = get().queue.find((q) => q.id === id); if (!it) return;
    set((s) => ({
      queue: s.queue.filter((q) => q.id !== id), decided: [{ id, d }, ...s.decided],
      items: d === 'accepted' ? [{ id: `K-${600 + s.decided.length}`, title: (edited ?? it.lesson).slice(0, 70), type: 'lesson', scope: it.scope, trust: it.confidence, expiresDays: 90, source: `${it.missionId} · ${it.id}`, tags: ['learned'], updatedMin: 1, uses: 0, summary: edited ?? it.lesson }, ...s.items] : s.items,
    }));
  },
  edit: (id, lesson) => set((s) => ({ queue: s.queue.map((q) => (q.id === id ? { ...q, lesson } : q)) })),
  addSource: (n) => set((s) => ({ sources: [n, ...s.sources] })),
  removeSource: (id) => set((s) => ({ sources: s.sources.filter((x) => x.id !== id) })),
  addResearch: (r) => set((s) => ({ research: [r, ...s.research] })),
}));
