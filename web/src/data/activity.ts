import { seeded } from './agents';
import type { Mission } from './types';

/**
 * Per-agent activity records (owner update 2026-11-20 u1): every agent records what it does while it works a mission —
 * token consumption, active time, current CPU and RAM — and periodically merges the mission instance's experience back
 * into the original agent. DEMO: deterministic per (mission, agent); `live` jitter is applied by useLiveActivity().
 * There is no money anywhere: tokens and time are the activity measures.
 */
export interface ActivityLogLine { agoMin: number; text: string; tokens: number; kind: 'think' | 'tool' | 'browse' | 'write' | 'merge' | 'message' }

export interface AgentActivity {
  missionId: string;
  agentId: string;
  tokensIn: number;
  tokensOut: number;
  tokens: number;
  /** active (working, not waiting) minutes in this mission */
  activeMin: number;
  /** current CPU share of its VM, % */
  cpu: number;
  /** current resident memory, MB */
  ramMb: number;
  /** VM the instance runs on */
  vm: string;
  /** what it is doing right now */
  action: string;
  /** last tokens-per-minute samples (oldest → newest) */
  spark: number[];
  /** experience merge back into the original agent */
  merge: { everyMin: number; lastAgoMin: number; nextInMin: number; pending: number; merged: number };
  log: ActivityLogLine[];
}

const RUNNING = ['running', 'planning', 'verifying', 'waiting'];
const ACTIONS = [
  'Reading the mission brief', 'Drafting the plan', 'Calling a tool', 'Writing code', 'Checking evidence', 'Browsing a granted site',
  'Summarizing results', 'Waiting for a reply', 'Running tests', 'Merging experience into the original agent',
];
const LOG: [ActivityLogLine['kind'], string][] = [
  ['think', 'Planned the next step'], ['tool', 'Ran a tool call'], ['browse', 'Opened a page in the granted origin'], ['write', 'Wrote a draft section'],
  ['message', 'Reported progress to its superior'], ['merge', 'Merged new experience into the original agent'], ['tool', 'Ran the test suite'],
  ['think', 'Re-read the acceptance criteria'], ['write', 'Updated the result version'],
];
export const VMS_FOR_ACTIVITY = ['vm-01', 'vm-02', 'vm-03', 'vm-gpu-01'];

const cache = new Map<string, AgentActivity>();

export function activityFor(m: Mission, agentId: string): AgentActivity {
  const key = `${m.id}:${agentId}:${m.status}:${m.agentIds.length}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = seeded(m.id + ':' + agentId);
  const running = RUNNING.includes(m.status);
  const scale = Math.max(0.15, m.elapsedH / 20);
  const lead = agentId === m.leadId;
  const tokensIn = Math.round((40_000 + r() * 260_000) * scale * (lead ? 1.6 : 1));
  const tokensOut = Math.round(tokensIn * (0.18 + r() * 0.2));
  const every = [10, 15, 20, 30][Math.floor(r() * 4)];
  const last = Math.floor(r() * every);
  const a: AgentActivity = {
    missionId: m.id, agentId, tokensIn, tokensOut, tokens: tokensIn + tokensOut,
    activeMin: Math.round(m.elapsedH * 60 * (0.25 + r() * 0.55)),
    cpu: running ? Math.round(6 + r() * 58) : 0,
    ramMb: running ? Math.round(180 + r() * 1400) : 0,
    vm: VMS_FOR_ACTIVITY[Math.floor(r() * VMS_FOR_ACTIVITY.length)],
    action: running ? ACTIONS[Math.floor(r() * ACTIONS.length)] : m.status === 'completed' ? 'Finished — experience merged' : m.status === 'draft' ? 'Not started' : 'Idle',
    spark: Array.from({ length: 16 }, () => Math.round(running ? 200 + r() * 1800 : r() * 80)),
    merge: { everyMin: every, lastAgoMin: last, nextInMin: every - last, pending: running ? Math.floor(r() * 6) : 0, merged: Math.round(scale * (3 + r() * 20)) },
    log: Array.from({ length: 8 }, (_, i) => { const [kind, text] = LOG[Math.floor(r() * LOG.length)]; return { agoMin: i * (3 + Math.floor(r() * 9)), text, kind, tokens: Math.round(300 + r() * 9000) }; }),
  };
  cache.set(key, a);
  return a;
}

export function missionActivity(m: Mission): AgentActivity[] {
  return m.agentIds.map((id) => activityFor(m, id));
}

export function missionTotals(m: Mission) {
  const rows = missionActivity(m);
  return {
    tokens: rows.reduce((s, x) => s + x.tokens, 0),
    activeMin: rows.reduce((s, x) => s + x.activeMin, 0),
    cpu: rows.length ? Math.round(rows.reduce((s, x) => s + x.cpu, 0) / rows.length) : 0,
    ramMb: rows.reduce((s, x) => s + x.ramMb, 0),
  };
}

/** Every mission instance of one agent (an agent can work several missions at the same time). */
export function agentInstances(agentId: string, missions: Mission[]): AgentActivity[] {
  return missions.filter((m) => m.agentIds.includes(agentId) && m.status !== 'archived').map((m) => activityFor(m, agentId));
}

export const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
export const fmtMin = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h ${n % 60}m` : `${n}m`);
export const fmtMb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n} MB`);
