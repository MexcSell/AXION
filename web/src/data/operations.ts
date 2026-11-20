import { seeded } from '@/data/agents';

export type Health = 'good' | 'warn' | 'bad';
export interface Service { unit: string; desc: string; health: Health; state: 'active (running)' | 'active (exited)' | 'activating'; pid: number; mem: number; cpu: number; uptime: string; lastRestart: string; version: string; deps: string[]; users: string; spark: number[] }

const sp = (k: string, base: number) => { const r = seeded(k); return Array.from({ length: 24 }, () => Math.round(base + (r() - .5) * base * .6)); };

export const SERVICES: Service[] = [
  { unit: 'axion-api.service', desc: 'HTTP API, auth and event stream', health: 'good', state: 'active (running)', pid: 1182, mem: 412, cpu: 14, uptime: '12d 4h', lastRestart: '2026-11-08 02:10 UTC', version: 'v3.2.0', deps: ['postgresql.service', 'model-gateway.service'], users: 'All signed-in users (about 30 s of reconnects)', spark: sp('api', 40) },
  { unit: 'mission-worker.service', desc: 'Executes mission tasks and agent instances', health: 'good', state: 'active (running)', pid: 1244, mem: 986, cpu: 38, uptime: '5d 19h', lastRestart: '2026-11-14 21:40 UTC', version: 'v3.2.0', deps: ['axion-api.service'], users: 'Running missions pause at the next checkpoint', spark: sp('mw', 55) },
  { unit: 'browser-worker.service', desc: 'Chromium sessions for browser agents', health: 'warn', state: 'active (running)', pid: 1307, mem: 1620, cpu: 52, uptime: '1d 3h', lastRestart: '2026-11-19 16:02 UTC', version: 'v3.2.0', deps: ['axion-api.service'], users: 'Active browser sessions end; grants stay valid', spark: sp('bw', 62) },
  { unit: 'evaluator-worker.service', desc: 'Independent verification and scoring', health: 'good', state: 'active (running)', pid: 1391, mem: 540, cpu: 21, uptime: '8d 2h', lastRestart: '2026-11-12 08:30 UTC', version: 'v3.2.0', deps: ['axion-api.service', 'model-gateway.service'], users: 'Verification jobs are re-queued', spark: sp('ev', 30) },
  { unit: 'model-gateway.service', desc: 'Routes model calls, budgets and fallbacks', health: 'good', state: 'active (running)', pid: 1098, mem: 308, cpu: 9, uptime: '12d 4h', lastRestart: '2026-11-08 02:10 UTC', version: 'v1.9.4', deps: [], users: 'In-flight model calls retry automatically', spark: sp('mg', 25) },
  { unit: 'watchdog.service', desc: 'Health checks, restarts and recovery hooks', health: 'good', state: 'active (running)', pid: 901, mem: 64, cpu: 2, uptime: '27d 11h', lastRestart: '2026-10-24 04:00 UTC', version: 'v1.4.1', deps: [], users: 'Automatic recovery pauses while it is down', spark: sp('wd', 8) },
];

export interface Worker { id: string; unit: string; agent: string; job: string; progress: number; crashes: number; restarts: number; pinned: string; state: 'running' | 'idle' | 'draining' }
export const WORKERS: Worker[] = [
  { id: 'mw-01', unit: 'mission-worker', agent: 'Coder-01', job: 'M-126 · Migrate checkout header', progress: 72, crashes: 0, restarts: 1, pinned: 'v2.3.0', state: 'running' },
  { id: 'mw-02', unit: 'mission-worker', agent: 'QA-01', job: 'M-126 · Visual diff dark mode', progress: 41, crashes: 0, restarts: 0, pinned: 'v2.1.4', state: 'running' },
  { id: 'mw-03', unit: 'mission-worker', agent: 'Researcher-01', job: 'M-129 · Competitor pricing scan', progress: 88, crashes: 1, restarts: 2, pinned: 'v2.2.0', state: 'running' },
  { id: 'mw-04', unit: 'mission-worker', agent: '-', job: 'No allocation', progress: 0, crashes: 0, restarts: 0, pinned: '-', state: 'idle' },
  { id: 'bw-01', unit: 'browser-worker', agent: 'Browser-01', job: 'M-129 · Collect public docs', progress: 57, crashes: 2, restarts: 3, pinned: 'v2.0.8', state: 'running' },
  { id: 'bw-02', unit: 'browser-worker', agent: 'Browser-02', job: 'M-131 · Form dry-run (fixture)', progress: 100, crashes: 0, restarts: 0, pinned: 'v2.0.8', state: 'draining' },
  { id: 'ev-01', unit: 'evaluator-worker', agent: 'Evaluator-01', job: 'M-126 · Verify checkout tests', progress: 63, crashes: 0, restarts: 0, pinned: 'v2.4.0', state: 'running' },
];

export interface Queue { name: string; pending: number; running: number; failed: number; retry: number; max: number; oldest: string }
export const QUEUES: Queue[] = [
  { name: 'mission.tasks', pending: 14, running: 6, failed: 1, retry: 2, max: 8, oldest: '41 s' },
  { name: 'browser.actions', pending: 5, running: 3, failed: 0, retry: 1, max: 4, oldest: '12 s' },
  { name: 'evaluation.verify', pending: 9, running: 2, failed: 0, retry: 0, max: 4, oldest: '1 m 20 s' },
  { name: 'model.calls', pending: 3, running: 5, failed: 2, retry: 3, max: 12, oldest: '3 s' },
  { name: 'knowledge.sync', pending: 22, running: 1, failed: 0, retry: 0, max: 2, oldest: '6 m' },
  { name: 'notifications', pending: 0, running: 0, failed: 0, retry: 0, max: 2, oldest: '-' },
];

export interface BrowserHost { id: string; profile: string; mission: string; mem: number; tabs: number; state: 'attached' | 'orphan' | 'idle'; crashes: number; started: string }
export const BROWSER_HOSTS: BrowserHost[] = [
  { id: 'chr-4a1', profile: 'mission-M-129', mission: 'M-129', mem: 612, tabs: 4, state: 'attached', crashes: 0, started: '18 m ago' },
  { id: 'chr-4a2', profile: 'mission-M-131', mission: 'M-131', mem: 388, tabs: 2, state: 'attached', crashes: 1, started: '41 m ago' },
  { id: 'chr-3f9', profile: 'mission-M-118', mission: 'M-118 (archived)', mem: 204, tabs: 1, state: 'orphan', crashes: 0, started: '2 h ago' },
  { id: 'chr-4b0', profile: 'warm-pool', mission: '-', mem: 96, tabs: 0, state: 'idle', crashes: 0, started: '6 h ago' },
];
export const CRASH_REPORTS = [
  { id: 'cr-2291', host: 'chr-4a2', reason: 'Renderer out of memory (tab 2)', when: '41 m ago' },
  { id: 'cr-2284', host: 'chr-4a0', reason: 'GPU process exited, session recovered', when: '3 h ago' },
];

export const STORAGE_AREAS = [
  { key: 'db', label: 'Database', used: 38, total: 120, unit: 'GB', hue: 262, note: 'Last integrity check: 2h ago, OK' },
  { key: 'art', label: 'Artifacts', used: 212, total: 500, unit: 'GB', hue: 190, note: 'Versioned results and mission media' },
  { key: 'bak', label: 'Backups', used: 96, total: 300, unit: 'GB', hue: 148, note: '14 snapshots, newest 03:00 UTC' },
  { key: 'log', label: 'Logs', used: 18, total: 60, unit: 'GB', hue: 38, note: 'Rotated daily, 30 day retention' },
];

export type Sev = 'debug' | 'info' | 'warn' | 'error';
export interface LogLine { id: number; t: string; sev: Sev; svc: string; msg: string; cid: string }
const LOG_TEMPLATES: [Sev, string, string][] = [
  ['info', 'axion-api', 'GET /api/missions 200 in 38 ms user=[REDACTED:user]'],
  ['info', 'mission-worker', 'task T-2041 checkpoint saved, progress=72%'],
  ['debug', 'model-gateway', 'route=primary model=reasoner-large tokens_in=1820 key=[REDACTED:api-key]'],
  ['info', 'evaluator-worker', 'verification passed 14/14 checks for artifact A-883'],
  ['warn', 'browser-worker', 'tab 2 memory 612 MB above soft limit 512 MB, context chr-4a2'],
  ['info', 'watchdog', 'health check ok: 6/6 units, 142 ms'],
  ['error', 'model-gateway', 'upstream timeout after 30 s, fallback=secondary, retry 1/3'],
  ['info', 'axion-api', 'approval AP-311 granted by [REDACTED:user] origin=docs.example.com'],
  ['warn', 'mission-worker', 'task T-2038 retry 2/3 reason=selector_not_found'],
  ['debug', 'browser-worker', 'navigation https://docs.example.com/?token=[REDACTED:token] 200'],
  ['info', 'knowledge-sync', 'indexed 38 documents, 0 skipped'],
  ['error', 'browser-worker', 'renderer crashed chr-4a2 tab 2, session recovered'],
  ['info', 'mission-worker', 'agent Coder-01 reported evidence E-4412 (screenshot, diff)'],
  ['warn', 'axion-api', 'rate limit 80% for client [REDACTED:ip]'],
];
export function makeLog(i: number): LogLine {
  const r = seeded('log' + i);
  const [sev, svc, msg] = LOG_TEMPLATES[Math.floor(r() * LOG_TEMPLATES.length)];
  const s = (14 * 3600 + 22 * 60 + i * 3) % 86400;
  const t = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
  return { id: i, t, sev, svc, msg, cid: 'c-' + Math.floor(r() * 0xfffff).toString(16).padStart(5, '0') };
}

export const RELEASES = [
  { v: 'v3.2.0', note: 'Current', date: '2026-11-08', state: 'active', verified: true },
  { v: 'v3.1.4', note: 'Last good (rollback target)', date: '2026-10-29', state: 'last-good', verified: true },
  { v: 'v3.1.3', note: 'Previous', date: '2026-10-17', state: 'archived', verified: true },
];
export const INCIDENTS = [
  { id: 'INC-014', when: '2026-11-14 21:38', sev: 'warn' as Sev, title: 'mission-worker restarted by watchdog', res: 'Recovered in 22 s, no data loss' },
  { id: 'INC-013', when: '2026-11-02 09:15', sev: 'error' as Sev, title: 'model-gateway upstream outage', res: 'Fallback route used, 3 tasks retried' },
  { id: 'INC-012', when: '2026-10-21 17:02', sev: 'info' as Sev, title: 'Planned database migration', res: 'Completed, rollback script verified' },
];
export const READINESS = [
  { k: 'Previous release package present', ok: true },
  { k: 'Database migration reversible', ok: true },
  { k: 'Configuration snapshot matches', ok: true },
  { k: 'Free capacity above 20%', ok: true },
  { k: 'Restore dry-run less than 7 days old', ok: false },
];
export const SNAPSHOTS = [
  { id: 'snap-1120-0300', date: '2026-11-20 03:00 UTC', size: '6.8 GB', hash: 'sha256:9f3c…a71e', compat: 'Compatible with v3.2.0', verified: true },
  { id: 'snap-1119-0300', date: '2026-11-19 03:00 UTC', size: '6.7 GB', hash: 'sha256:41d8…02bc', compat: 'Compatible with v3.2.0', verified: true },
  { id: 'snap-1108-0300', date: '2026-11-08 03:00 UTC', size: '6.1 GB', hash: 'sha256:c0a2…5d19', compat: 'Needs migration 0042', verified: true },
];
