import { create } from 'zustand';
import { AGENTS, AGENT_BY_ID, seeded } from './agents';

/**
 * Knowledge follows the agent lineage (owner update 2026-11-20 u1).
 * A derived agent keeps the experience specific to its speciality ("own") and shares general lessons with its parent
 * ("shared up"). The parent makes shared lessons available to all its descendants ("inherited").
 *   Coder-01 → Mobile-Dev-01 keeps "SwiftUI list diffing", shares "write the failing test first" up to Coder-01.
 *   Homepage-01 → Site-Upwork keeps "Upwork proposal form v3", shares "back off on HTTP 429" so every site agent learns it.
 */
export type KnowledgeScope = 'own' | 'shared';
export interface Lesson { id: string; agentId: string; title: string; scope: KnowledgeScope; uses: number; agoD: number; from?: string }

const OWN: Record<string, string[]> = {
  'coder-01': ['Monorepo build cache layout', 'TypeScript strict-mode migration steps'],
  'mobile-dev-01': ['SwiftUI list diffing without flicker', 'Android background sync limits', 'App Store screenshot sizes'],
  'web-dev-01': ['Core Web Vitals budget per route', 'Next.js image sizes for hero banners', 'Sitemap split above 50k URLs'],
  'browser-01': ['Shadow-DOM locator fallbacks', 'Cookie-banner dismissal order'],
  'homepage-01': ['Homepage section order by conversion', 'Which job sites allow automated proposals'],
  'site-upwork': ['Upwork proposal form layout v3', 'Proposal credits needed per bid on Upwork', 'Upwork rejects links in the first message'],
  'site-freelancer': ['Freelancer.com daily bid limit', 'Milestone wording that wins on Freelancer'],
  'site-wanted': ['Wanted.co.kr resume fields (Korean)', 'Wanted application follow-up timing'],
};
const SHARED: Record<string, string[]> = {
  'mobile-dev-01': ['Write the failing test first, then the fix', 'Keep API clients behind one interface'],
  'web-dev-01': ['Prefer semantic HTML before ARIA', 'Measure before optimizing'],
  'coder-01': ['Small pull requests get verified faster'],
  'homepage-01': ['Never submit a form without the owner’s grant', 'Screenshot before and after every action'],
  'site-upwork': ['Back off for 60 s after HTTP 429', 'Tailor the first two lines to the job title'],
  'site-freelancer': ['Quote the client’s own words in the opening line'],
  'site-wanted': ['Attach the portfolio PDF, not a link'],
  'browser-01': ['Wait for network idle before reading prices'],
};

function build(): Lesson[] {
  const out: Lesson[] = [];
  for (const a of AGENTS) {
    const r = seeded('kn' + a.id);
    (OWN[a.id] ?? []).forEach((t, i) => out.push({ id: `${a.id}-o${i}`, agentId: a.id, title: t, scope: 'own', uses: 3 + Math.round(r() * 40), agoD: Math.round(r() * 20) }));
    (SHARED[a.id] ?? []).forEach((t, i) => out.push({ id: `${a.id}-s${i}`, agentId: a.id, title: t, scope: 'shared', uses: 10 + Math.round(r() * 90), agoD: Math.round(r() * 30) }));
  }
  return out;
}

interface LineageState {
  lessons: Lesson[];
  /** move one of an agent's own lessons up: it becomes a shared lesson its parent passes to every descendant */
  shareUp: (lessonId: string) => void;
  /** keep a shared lesson private to its agent again */
  keepOwn: (lessonId: string) => void;
}
export const useLineage = create<LineageState>((set) => ({
  lessons: build(),
  shareUp: (id) => set((s) => ({ lessons: s.lessons.map((l) => (l.id === id ? { ...l, scope: 'shared', agoD: 0 } : l)) })),
  keepOwn: (id) => set((s) => ({ lessons: s.lessons.map((l) => (l.id === id ? { ...l, scope: 'own' } : l)) })),
}));

/** Root agents of a lineage (agents with derived children, or derived themselves). */
export function lineageRoots() {
  const roots = AGENTS.filter((a) => !a.parentId && AGENTS.some((c) => c.parentId === a.id));
  return roots;
}
export function ancestors(id: string): string[] {
  const out: string[] = [];
  let cur = AGENT_BY_ID[id]?.parentId;
  while (cur) { out.push(cur); cur = AGENT_BY_ID[cur]?.parentId; }
  return out;
}
export function descendants(id: string): string[] {
  const kids = AGENTS.filter((a) => a.parentId === id).map((a) => a.id);
  return kids.flatMap((k) => [k, ...descendants(k)]);
}

/** What an agent can use: its own lessons, what it shared, and what flows down from ancestors (shared lessons of ancestors and siblings). */
export function knowledgeOf(id: string, lessons: Lesson[]) {
  const own = lessons.filter((l) => l.agentId === id && l.scope === 'own');
  const sharedUp = lessons.filter((l) => l.agentId === id && l.scope === 'shared');
  const anc = ancestors(id);
  const root = anc[anc.length - 1] ?? id;
  const family = [root, ...descendants(root)].filter((x) => x !== id);
  const inherited = lessons.filter((l) => l.scope === 'shared' && family.includes(l.agentId)).map((l) => ({ ...l, from: l.agentId }));
  return { own, sharedUp, inherited };
}
