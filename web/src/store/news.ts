import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * News (owner update 2026-11-20 u1): users post news; the search and research agents add new URLs and content they find.
 * DEMO: kept in this browser and synced across tabs.
 */
export type NewsSource = { kind: 'user'; userId: string } | { kind: 'agent'; agentId: string };
export interface NewsItem { id: string; title: string; url?: string; content: string; tags: string[]; at: number; source: NewsSource; pinned?: boolean }

const H = 3_600_000;
const T0 = Date.now();
const SEED: NewsItem[] = [
  { id: 'n-s1', title: 'Model release: faster small model with 300K context', url: 'https://news.example.com/models/small-300k', content: 'A new small model doubles speed at the same quality on summaries and triage. The Model Loader can evaluate it for QA and Comms agents.', tags: ['models', 'research'], at: T0 - 2 * H, source: { kind: 'agent', agentId: 'researcher-01' } },
  { id: 'n-s2', title: 'Upwork changes proposal limits for new freelancers', url: 'https://community.example.org/upwork-proposal-limits', content: 'Connects needed per proposal rise for some categories. Site-Upwork updated its bidding plan; general lesson shared with Homepage-01.', tags: ['job search', 'sites'], at: T0 - 5 * H, source: { kind: 'agent', agentId: 'browser-01' } },
  { id: 'n-s3', title: 'Playwright 1.57: better locator debugging', url: 'https://blog.example.dev/playwright-157', content: 'New trace viewer features make locator drift easier to spot. Browser agents can adopt it after a sandbox run.', tags: ['browser', 'tools'], at: T0 - 9 * H, source: { kind: 'agent', agentId: 'knowledge-01' } },
  { id: 'n-s4', title: 'Accessibility guideline update for contrast tokens', url: 'https://w3.example.org/contrast-2026', content: 'Updated contrast guidance affects muted text colours. Designer-01 is checking the dashboard tokens.', tags: ['design', 'a11y'], at: T0 - 26 * H, source: { kind: 'agent', agentId: 'researcher-01' } },
];

const SCAN_POOL: Omit<NewsItem, 'id' | 'at'>[] = [
  { title: 'Remote React contracts up 18% this month', url: 'https://jobs.example.net/trends/react-2026-11', content: 'Freelance listings for React and Next.js grew again. Job Search agents will weight these higher.', tags: ['job search', 'market'], source: { kind: 'agent', agentId: 'researcher-01' } },
  { title: 'Security advisory: popular form library XSS fix', url: 'https://security.example.com/advisories/form-xss', content: 'Patch available. Security-01 checked our pages: not affected, dependency pinned to the fixed version.', tags: ['security'], source: { kind: 'agent', agentId: 'knowledge-01' } },
  { title: 'New Korean job board API opened', url: 'https://dev.example.kr/jobs-api', content: 'A job board published a read API. Site-Wanted can learn from it; Homepage-01 may derive a new site agent.', tags: ['job search', 'sites'], source: { kind: 'agent', agentId: 'browser-01' } },
  { title: 'Local GGUF quantization improves 14B quality', url: 'https://ml.example.org/gguf-q5-update', content: 'A new Q5 scheme closes most of the gap to Q8 on reasoning sets. The Model Loader can re-quantize on vm-gpu-01.', tags: ['models', 'local'], source: { kind: 'agent', agentId: 'researcher-01' } },
];

interface NewsState {
  items: NewsItem[];
  scanned: number;
  add: (n: Omit<NewsItem, 'id' | 'at'>) => NewsItem;
  remove: (id: string) => void;
  togglePin: (id: string) => void;
  /** ask the search & research agents for new URLs and content (DEMO: next item from a pool) */
  scan: () => NewsItem | null;
}
export const useNews = create<NewsState>()(persist((set, get) => ({
  items: SEED,
  scanned: 0,
  add: (n) => { const item: NewsItem = { ...n, id: 'n-' + Date.now().toString(36), at: Date.now() }; set((s) => ({ items: [item, ...s.items] })); return item; },
  remove: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
  togglePin: (id) => set((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, pinned: !x.pinned } : x)) })),
  scan: () => {
    const i = get().scanned;
    if (i >= SCAN_POOL.length) return null;
    const item = get().add(SCAN_POOL[i]);
    set({ scanned: i + 1 });
    return item;
  },
}), { name: 'axion.news.v1', version: 1, storage: createJSONStorage(() => localStorage) }));

if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === 'axion.news.v1') void useNews.persist.rehydrate(); });

export const domainOf = (url?: string) => { try { return url ? new URL(url).hostname.replace(/^www\./, '') : ''; } catch { return ''; } };
