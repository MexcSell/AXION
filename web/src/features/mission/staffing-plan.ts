import { AGENT_BY_ID } from '../../data/agents';
import type { Mission, MissionFile, MissionFileKind } from '../../data/types';

/**
 * Mission staffing, pure part (owner update 2026-11-20 u1; split out in Stage 5 so the server runs the same steps).
 * A user only enters the mission's content (text + files). Then:
 *   1. the General Manager reads it and appoints the mission's general executor;
 *   2. the executor brings the agents the mission needs, one by one, while the mission runs.
 * One agent per role: the executor never brings two agents with the same duty.
 * Relative imports only: the server (Node) imports this file directly.
 */

export type StaffStage = 'reading' | 'appointing' | 'recruiting' | 'working';
export interface StaffLog { at: number; text: string; agentId?: string; by?: string }
/**
 * `plan[].managerId` and `org` exist only on real missions created from cycle 11 on (staffed by the active organisation,
 * see ./staffing-org): the agent the planned one joins under, and where the executor came from. Demo staffing never sets them.
 */
export interface Staffing {
  stage: StaffStage; plan: { agentId: string; why: string; managerId?: string }[]; joined: number; log: StaffLog[];
  org?: { revision?: number; dept: string; executorFrom: 'head' | 'fixture' };
}

const KIND_WORDS: [Mission['kind'], RegExp][] = [
  ['self-update', /\b(axion|dashboard|this (app|site|ui)|self[- ]?update|plug-?in)\b/i],
  ['research', /\b(research|investigat|compare|competitor|market|report|analy[sz]e|study|find out)\b/i],
  ['training', /\b(train|teach|mentor|learn|coach|exercise)\b/i],
  ['website', /\b(website|web ?site|page|landing|homepage|frontend|ui|app|mobile|ios|android)\b/i],
  ['data', /\b(data|dataset|csv|spreadsheet|catalog|database|clean|migrate)\b/i],
  ['automation', /\b(automat|bot|schedule|workflow|scrape|crawl|job search|bid)\b/i],
  ['structure', /\b(structure|reorgani[sz]|org chart|department|restructure)\b/i],
];
export function guessKind(text: string, files: MissionFile[] = []): Mission['kind'] {
  for (const [k, re] of KIND_WORDS) if (re.test(text)) return k;
  if (files.some((f) => f.kind === 'video' || f.kind === 'image')) return 'website';
  if (files.some((f) => f.kind === 'pdf' || f.kind === 'doc' || f.kind === 'txt')) return 'research';
  return 'automation';
}

/** First sentence or line of the content, trimmed to a readable title. */
export function deriveTitle(text: string, files: MissionFile[] = []): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return files.length ? `Work on ${files[0].name}${files.length > 1 ? ` (+${files.length - 1})` : ''}` : 'New mission';
  const first = t.split(/(?<=[.!?。])\s|\n/)[0];
  const s = first.length > 64 ? first.slice(0, 61).replace(/\s+\S*$/, '') + '…' : first;
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/[.。]$/, '');
}

export function fileKind(name: string, mime: string): MissionFileKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (mime.startsWith('text/') || /\.(txt|md|csv|log|json)$/i.test(name)) return 'txt';
  if (/\.(docx?|odt|rtf|pptx?|xlsx?)$/i.test(name) || /word|officedocument|opendocument/.test(mime)) return 'doc';
  return 'file';
}

/** The GM's choice of general executor for a kind of mission. */
const EXECUTOR: Record<Mission['kind'], string> = {
  website: 'coder-01', research: 'researcher-01', training: 'mentor-01', data: 'analyst-01',
  automation: 'integrator-01', structure: 'planner-01', 'self-update': 'coder-01',
};
export const executorFor = (kind: Mission['kind']) => EXECUTOR[kind];

/** Agents the executor brings, with the reason it gives. Unique roles only. */
const RECRUITS: Record<Mission['kind'], [string, string][]> = {
  website: [['planner-01', 'plans pages and order of work'], ['designer-01', 'designs the screens'], ['browser-01', 'checks the live site in a granted browser'], ['tester-01', 'verifies every page independently'], ['writer-01', 'writes the on-page copy']],
  research: [['analyst-01', 'turns findings into numbers'], ['browser-01', 'reads sources in granted sites'], ['knowledge-01', 'keeps sources and citations'], ['writer-01', 'writes the final report'], ['tester-01', 'fact-checks every claim']],
  training: [['tester-01', 'builds the evaluation set'], ['optimizer-01', 'tunes prompts and recipes'], ['analyst-01', 'measures before and after']],
  data: [['integrator-01', 'connects the data sources'], ['knowledge-01', 'deduplicates and indexes'], ['tester-01', 'validates the output']],
  automation: [['browser-01', 'operates the target sites'], ['security-01', 'reviews risky actions first'], ['tester-01', 'verifies each run'], ['ops-01', 'schedules and monitors the job']],
  structure: [['analyst-01', 'simulates the impact'], ['security-01', 'checks access changes'], ['comms-01', 'explains the change to everyone']],
  'self-update': [['designer-01', 'designs the change'], ['tester-01', 'runs every test suite'], ['security-01', 'reviews the patch'], ['release-01', 'prepares a safe rollout']],
};

export function staffingPlan(kind: Mission['kind'], text: string): { executorId: string; plan: { agentId: string; why: string }[] } {
  const executorId = EXECUTOR[kind];
  const seen = new Set([executorId, 'gm']);
  const plan: { agentId: string; why: string }[] = [];
  for (const [id, why] of RECRUITS[kind]) if (!seen.has(id) && AGENT_BY_ID[id]) { seen.add(id); plan.push({ agentId: id, why }); }
  // The Model Loader joins when the content mentions models, voice or heavy media.
  if (/\b(model|voice|audio|video|speech|llm)\b/i.test(text) && !seen.has('loader-01')) plan.push({ agentId: 'loader-01', why: 'picks the right model for each agent' });
  return { executorId, plan };
}

/** Who the general executor is: explicit, else the first non-GM agent (fixtures). */
export function executorOf(m: Mission): string | undefined {
  if (m.executorId) return m.executorId;
  if (m.leadId !== 'gm') return m.leadId;
  return m.agentIds.find((a) => a !== 'gm');
}

/** One step forward: reading → appointing → recruiting (one agent per tick) → working. */
export function advance(m: Mission, now: number): Partial<Mission> | null {
  const s = m.staffing;
  if (!s || s.stage === 'working' || m.status === 'paused' || m.status === 'archived') return null;
  const name = (id?: string) => (id ? AGENT_BY_ID[id]?.name ?? id : '');
  if (s.stage === 'reading') {
    const ex = m.executorId!;
    return {
      agentIds: m.agentIds.includes(ex) ? m.agentIds : [...m.agentIds, ex],
      staffing: { ...s, stage: 'appointing', log: [...s.log, { at: now, by: 'gm', agentId: ex, text: `GM appointed ${name(ex)}${s.org?.executorFrom === 'head' ? ` (head of ${s.org.dept}${s.org.revision !== undefined ? `, org rev ${s.org.revision}` : ''})` : ''} as the general executor` }] },
      lastEvent: `GM appointed ${name(ex)} as executor`, lastEventAgoMin: 0,
    };
  }
  if (s.joined < s.plan.length) {
    const next = s.plan[s.joined];
    return {
      agentIds: m.agentIds.includes(next.agentId) ? m.agentIds : [...m.agentIds, next.agentId],
      staffing: { ...s, stage: 'recruiting', joined: s.joined + 1, log: [...s.log, { at: now, by: m.executorId, agentId: next.agentId, text: `${name(m.executorId)} brought ${name(next.agentId)}${next.managerId && next.managerId !== m.executorId ? ` under ${name(next.managerId)}` : ''} — ${next.why}` }] },
      lastEvent: `${name(next.agentId)} joined`, lastEventAgoMin: 0,
    };
  }
  return {
    status: m.status === 'planning' ? 'running' : m.status, progress: Math.max(m.progress, 4),
    staffing: { ...s, stage: 'working', log: [...s.log, { at: now, by: m.executorId, text: `All ${s.plan.length + 1} agents are working. Each records tokens, time, CPU and RAM.` }] },
    summary: `${name(m.executorId)} leads ${s.plan.length} agents. The first verified checkpoint will update this summary.`, summaryAgoMin: 0,
    lastEvent: 'Staffing complete · work started', lastEventAgoMin: 0,
  };
}

/**
 * One driver tick (demo mode). `captured` only says which missions to consider; each one is re-read through `fresh`
 * right before its step, so a mission archived or paused after the caller's render-time list was taken never advances.
 */
export function tickStaffing(captured: Mission[], fresh: (id: string) => Mission | undefined, update: (id: string, patch: Partial<Mission>) => void, now: number) {
  for (const c of captured) {
    const m = fresh(c.id);
    const p = m && advance(m, now);
    if (p) update(c.id, p);
  }
}
