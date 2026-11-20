import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { seeded } from '@/data/agents';

/**
 * Job Search plug-in (owner update 2026-11-20 u1) — built on the former Browser Studio.
 * The user adds job-site URLs; the site's autopilot agent (derived from Homepage-01) investigates the site in a managed
 * browser, records the jobs it finds, and bids with a copy of the user's profile tailored to each job.
 * DEMO: everything is simulated and kept in this browser.
 */
export type SiteState = 'scanning' | 'idle' | 'paused' | 'blocked';
export interface JobSite { id: string; url: string; domain: string; name: string; agentId: string; state: SiteState; addedAt: number; found: number; lastRunAt: number; page: number }
export type JobStatus = 'found' | 'drafting' | 'bid' | 'won' | 'lost' | 'skipped';
export interface Job {
  id: string; siteId: string; title: string; company: string; remote: string; rate: string; skills: string[];
  match: number; status: JobStatus; foundAt: number; bidAt?: number; decidedAt?: number; url: string; summary: string;
  /** what the agent changed in the profile for this job */
  tailored?: { headline: string; emphasis: string[]; letter: string };
}
export interface ProfileDoc { id: string; name: string; kind: 'pdf' | 'doc' | 'txt' | 'image' | 'file'; size: number; addedAt: number }
export interface JobProfile { headline: string; text: string; docs: ProfileDoc[]; updatedAt: number }
export interface InvestigationStep { at: number; siteId: string; text: string; kind: 'open' | 'read' | 'match' | 'draft' | 'bid' | 'result' | 'learn' }

const SITE_AGENT: Record<string, string> = { 'upwork.com': 'site-upwork', 'freelancer.com': 'site-freelancer', 'wanted.co.kr': 'site-wanted' };
export const agentForDomain = (d: string) => SITE_AGENT[d] ?? 'homepage-01';
export const domainFrom = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url.replace(/^https?:\/\//, '').split('/')[0]; } };

const TITLES = [
  ['Senior React developer for SaaS dashboard', 'React, TypeScript, Charts'], ['Next.js marketing site rebuild', 'Next.js, SEO, Tailwind'],
  ['Playwright test suite for checkout', 'Playwright, QA, CI'], ['Mobile app MVP (React Native)', 'React Native, Firebase'],
  ['AI agent integration with Claude API', 'Node.js, LLM, Tool use'], ['Data dashboard with real-time charts', 'React, WebSocket, D3'],
  ['Accessibility audit and fixes', 'WCAG, ARIA, CSS'], ['Chrome extension for job tracking', 'TypeScript, Extensions'],
  ['Design system in Figma + React', 'Design tokens, Storybook'], ['Scraper for public price lists', 'Python, Playwright'],
  ['Korean/English landing page', 'i18n, Next.js'], ['Backend API hardening', 'Node.js, Security, OAuth'],
] as const;
const COMPANIES = ['Northwind Labs', 'Blue Harbor', 'Kite & Co', 'Moonbase Studio', 'Pixelfield', 'Arcadia Health', 'Seoul Mobility', 'Lumen Retail', 'Tidewater', 'Oakline'];
const RATES = ['$40–60/h', '$55–80/h', '$30–45/h', 'Fixed · listed', '₩ per project', '$70–95/h'];

function makeJob(site: JobSite, n: number, at: number): Job {
  const r = seeded(site.id + ':' + n);
  const [title, skills] = TITLES[Math.floor(r() * TITLES.length)];
  return {
    id: `${site.id}-j${n}`, siteId: site.id, title, company: COMPANIES[Math.floor(r() * COMPANIES.length)], remote: r() > .3 ? 'Remote' : 'Hybrid · Seoul',
    rate: RATES[Math.floor(r() * RATES.length)], skills: skills.split(', '), match: Math.round(58 + r() * 40), status: 'found', foundAt: at,
    url: `https://${site.domain}/jobs/${(n * 7919 + 1000).toString(36)}`, summary: `${title}. The client needs ${skills.toLowerCase()} and wants a first milestone within two weeks.`,
  };
}
function tailor(job: Job, profile: JobProfile): Job['tailored'] {
  const top = job.skills.slice(0, 2).join(' and ');
  return {
    headline: `${profile.headline.split('·')[0].trim()} · ${top} specialist`,
    emphasis: [`Moved ${job.skills[0]} projects to the top`, `Quoted the client’s goal in the opening line`, `Attached the most relevant document (${profile.docs[0]?.name ?? 'portfolio'})`],
    letter: `Hello ${job.company} team — you need ${top}. I have shipped similar work and can deliver the first milestone in two weeks. Here is how I would start: …`,
  };
}

const T = Date.now();
const SEED_SITES: JobSite[] = [
  { id: 's-upwork', url: 'https://www.upwork.com/nx/search/jobs?q=react', domain: 'upwork.com', name: 'Upwork', agentId: 'site-upwork', state: 'scanning', addedAt: T - 3 * 86_400_000, found: 0, lastRunAt: T - 60_000, page: 2 },
  { id: 's-freelancer', url: 'https://www.freelancer.com/jobs/react-js', domain: 'freelancer.com', name: 'Freelancer', agentId: 'site-freelancer', state: 'idle', addedAt: T - 2 * 86_400_000, found: 0, lastRunAt: T - 40 * 60_000, page: 1 },
  { id: 's-wanted', url: 'https://www.wanted.co.kr/wdlist/518', domain: 'wanted.co.kr', name: 'Wanted', agentId: 'site-wanted', state: 'idle', addedAt: T - 86_400_000, found: 0, lastRunAt: T - 3 * 3_600_000, page: 1 },
];
const SEED_PROFILE: JobProfile = {
  headline: 'Full-stack developer · React, TypeScript, AI agents',
  text: '8 years building web apps. Strong in React/Next.js, TypeScript and Node.js. Recent work: agent dashboards, Playwright test automation, accessibility fixes. Available 30 h/week, Seoul timezone (KST), English and Korean.',
  docs: [{ id: 'd1', name: 'resume-2026.pdf', kind: 'pdf', size: 182_000, addedAt: T - 5 * 86_400_000 }, { id: 'd2', name: 'portfolio.pdf', kind: 'pdf', size: 2_400_000, addedAt: T - 5 * 86_400_000 }],
  updatedAt: T - 5 * 86_400_000,
};
function seedJobs(): Job[] {
  const out: Job[] = [];
  const statuses: JobStatus[] = ['won', 'bid', 'lost', 'bid', 'drafting', 'found', 'skipped', 'found', 'bid', 'found'];
  SEED_SITES.forEach((s, si) => {
    for (let n = 0; n < (si === 0 ? 7 : 4); n++) {
      const j = makeJob(s, n, T - (n + 1) * 3_600_000 * (si + 1));
      j.status = statuses[(n + si * 3) % statuses.length];
      if (['bid', 'won', 'lost'].includes(j.status)) { j.bidAt = j.foundAt + 20 * 60_000; j.tailored = tailor(j, SEED_PROFILE); }
      if (j.status === 'won' || j.status === 'lost') j.decidedAt = j.foundAt + 26 * 3_600_000;
      out.push(j);
    }
  });
  return out;
}

interface JobsState {
  sites: JobSite[];
  jobs: Job[];
  profile: JobProfile;
  steps: InvestigationStep[];
  addSite: (url: string) => { ok: true; site: JobSite } | { ok: false; error: string };
  removeSite: (id: string) => void;
  setSiteState: (id: string, state: SiteState) => void;
  setProfile: (p: Partial<JobProfile>) => void;
  addDocs: (docs: ProfileDoc[]) => void;
  removeDoc: (id: string) => void;
  setJobStatus: (id: string, status: JobStatus) => void;
  /** one simulation tick for a scanning site: read a page, find a job, draft or bid */
  tick: (siteId: string) => void;
}

export const useJobs = create<JobsState>()(persist((set, get) => ({
  sites: SEED_SITES.map((s) => ({ ...s, found: seedJobs().filter((j) => j.siteId === s.id).length })),
  jobs: seedJobs(),
  profile: SEED_PROFILE,
  steps: [
    { at: T - 9 * 60_000, siteId: 's-upwork', kind: 'open', text: 'Opened upwork.com job search for “react” (read-only grant)' },
    { at: T - 8 * 60_000, siteId: 's-upwork', kind: 'read', text: 'Read 12 listings on page 1' },
    { at: T - 7 * 60_000, siteId: 's-upwork', kind: 'match', text: 'Match 87% — “Mobile app MVP (React Native)”: drafting a tailored bid' },
    { at: T - 6 * 60_000, siteId: 's-upwork', kind: 'learn', text: 'Learned: links in the first message get proposals rejected — shared with Homepage-01' },
    { at: T - 5 * 60_000, siteId: 's-upwork', kind: 'open', text: 'Opened results page 2' },
    { at: T - 50 * 60_000, siteId: 's-freelancer', kind: 'read', text: 'Read 8 listings; 1 above the bid threshold' },
    { at: T - 3 * 3_600_000, siteId: 's-wanted', kind: 'learn', text: 'Learned the Korean resume fields for wanted.co.kr' },
  ],
  addSite: (raw) => {
    const url = raw.trim().match(/^https?:\/\//i) ? raw.trim() : `https://${raw.trim()}`;
    let domain = '';
    try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch { return { ok: false, error: 'Enter a valid site address, e.g. https://remoteok.com' }; }
    if (!/\.[a-z]{2,}$/i.test(domain)) return { ok: false, error: 'Enter a valid site address, e.g. https://remoteok.com' };
    if (get().sites.some((s) => s.domain === domain)) return { ok: false, error: `${domain} is already being searched` };
    const site: JobSite = { id: 's-' + domain.replace(/[^a-z0-9]+/gi, '-'), url, domain, name: domain.split('.')[0].replace(/^\w/, (c) => c.toUpperCase()), agentId: agentForDomain(domain), state: 'scanning', addedAt: Date.now(), found: 0, lastRunAt: Date.now(), page: 1 };
    set((s) => ({ sites: [...s.sites, site], steps: [...s.steps, { at: Date.now(), siteId: site.id, kind: 'open' as const, text: `Opened ${domain} in a managed browser (read-only grant)` }].slice(-120) }));
    return { ok: true, site };
  },
  removeSite: (id) => set((s) => ({ sites: s.sites.filter((x) => x.id !== id), jobs: s.jobs.filter((j) => j.siteId !== id) })),
  setSiteState: (id, state) => set((s) => ({ sites: s.sites.map((x) => (x.id === id ? { ...x, state, lastRunAt: Date.now() } : x)) })),
  setProfile: (p) => set((s) => ({ profile: { ...s.profile, ...p, updatedAt: Date.now() } })),
  addDocs: (docs) => set((s) => ({ profile: { ...s.profile, docs: [...s.profile.docs, ...docs], updatedAt: Date.now() } })),
  removeDoc: (id) => set((s) => ({ profile: { ...s.profile, docs: s.profile.docs.filter((d) => d.id !== id), updatedAt: Date.now() } })),
  setJobStatus: (id, status) => set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, status, ...(status === 'bid' ? { bidAt: Date.now(), tailored: j.tailored ?? tailor(j, s.profile) } : {}), ...(status === 'won' || status === 'lost' ? { decidedAt: Date.now() } : {}) } : j)) })),
  tick: (siteId) => {
    const st = get();
    const site = st.sites.find((x) => x.id === siteId);
    if (!site || site.state !== 'scanning') return;
    const now = Date.now();
    const mine = st.jobs.filter((j) => j.siteId === siteId);
    const drafting = mine.find((j) => j.status === 'drafting');
    const step = (kind: InvestigationStep['kind'], text: string): InvestigationStep => ({ at: now, siteId, kind, text });
    if (drafting) {
      // submit the tailored bid
      set((s) => ({
        jobs: s.jobs.map((j) => (j.id === drafting.id ? { ...j, status: 'bid', bidAt: now, tailored: tailor(j, s.profile) } : j)),
        steps: [...s.steps, step('bid', `Submitted a bid for “${drafting.title}” with the profile tailored to it`)].slice(-120),
      }));
      return;
    }
    const r = seeded(siteId + mine.length + ':' + Math.floor(now / 4000))();
    if (r < .55) {
      const job = makeJob(site, mine.length + 100, now);
      const good = job.match >= 75;
      set((s) => ({
        jobs: [{ ...job, status: good ? 'drafting' : 'found' }, ...s.jobs],
        sites: s.sites.map((x) => (x.id === siteId ? { ...x, found: x.found + 1, lastRunAt: now } : x)),
        steps: [...s.steps, step('read', `Read “${job.title}” (${job.company})`), step('match', `Match ${job.match}% — ${good ? 'drafting a tailored bid' : 'saved, below the bid threshold (75%)'}`), ...(good ? [step('draft', `Tailoring the profile: ${job.skills.slice(0, 2).join(', ')} first`)] : [])].slice(-120),
      }));
    } else {
      set((s) => ({
        sites: s.sites.map((x) => (x.id === siteId ? { ...x, page: x.page + 1, lastRunAt: now } : x)),
        steps: [...s.steps, step(r < .8 ? 'open' : 'learn', r < .8 ? `Opened results page ${site.page + 1}` : `Learned: ${['this site lazy-loads more jobs on scroll', 'filters reset after login', 'remote filter is in the second menu'][Math.floor(r * 10) % 3]} — shared with Homepage-01`)].slice(-120),
      }));
    }
    // older bids get an answer now and then
    const open = get().jobs.find((j) => j.siteId === siteId && j.status === 'bid' && j.bidAt && now - j.bidAt > 20_000);
    if (open && r > .7) set((s) => ({ jobs: s.jobs.map((j) => (j.id === open.id ? { ...j, status: r > .85 ? 'won' : 'lost', decidedAt: now } : j)), steps: [...s.steps, step('result', `${r > .85 ? 'Won' : 'Not selected for'} “${open.title}”`)].slice(-120) }));
  },
}), { name: 'axion.jobs.v1', version: 1, storage: createJSONStorage(() => localStorage), partialize: (s) => ({ sites: s.sites, jobs: s.jobs.slice(0, 200), profile: s.profile, steps: s.steps.slice(-60) }) as unknown as JobsState }));

if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === 'axion.jobs.v1') void useJobs.persist.rehydrate(); });
