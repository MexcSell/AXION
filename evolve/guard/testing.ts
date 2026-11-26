// Test helpers for the Guard adapters (R13): a fake Host that records every argv and answers from a small Docker/git
// simulator, a fake clock (sleep advances now), deterministic random ids, and scripted fetch answers. No real process runs.

import type { Host, RunOpts, RunResult } from './host.ts';

export type Call = { cmd: string; args: string[]; env?: Record<string, string> };
type Answer = Partial<RunResult> | undefined;
export type Handler = (c: Call) => Answer | Promise<Answer>;

export type Ctr = { running: boolean; restart: string; ports?: string; networks: string[]; image: string; logOpts?: Record<string, string> };

/** docker run/create options that take no value (everything else starting with '-' takes one, unless written --x=y) */
const FLAGS = new Set(['-d', '--init', '--rm', '--read-only']);
/** the image argument of a `docker run|create …` argv (the first argument that is not an option or an option's value) */
export function runImage(a: string[]): string {
  for (let i = 1; i < a.length;) {
    const x = a[i];
    if (!x.startsWith('-')) return x;
    i += FLAGS.has(x) || x.includes('=') ? 1 : 2;
  }
  return '';
}

export const T0 = Date.parse('2026-11-26T12:00:00.000Z');
const NO_SUCH = (name: string): RunResult => ({ code: 1, stdout: '', stderr: `Error: No such container: ${name}\n` });

/** A tiny model of the Docker containers the adapters touch; enough for inspect/run/create/start/stop/update/rm/network connect. */
export class DockerSim {
  ctrs = new Map<string, Ctr>();
  /** name → health JSON answered by `docker exec <name> curl … /api/v1/health` while the container runs */
  health = new Map<string, string>();
  images: string[] = [];
  /** stdout of `docker logs … <name>` (e.g. the front's JSON access log lines) */
  logs = new Map<string, string>();
  /** URL → body answered by `docker exec <slot> curl … <url>` for URLs other than the health route */
  pages = new Map<string, string>([['http://127.0.0.1:4190/api/v1/auth/hello', '{"firstEver":false}']]);

  add(name: string, c: Partial<Ctr> = {}) {
    this.ctrs.set(name, { running: true, restart: 'unless-stopped', networks: [], image: 'img', logOpts: { 'max-size': '10m', 'max-file': '3' }, ...c });
  }

  handle(c: Call): RunResult | undefined {
    if (c.cmd !== 'docker') return undefined;
    const a = c.args;
    const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '' });
    if (a[0] === 'container' && a[1] === 'inspect') {
      const name = a[a.length - 1];
      const ctr = this.ctrs.get(name);
      if (!ctr) return NO_SUCH(name);
      const fmt = a[3];
      if (fmt === '{{.State.Running}}') return ok(`${ctr.running}\n`);
      if (fmt === '{{json .HostConfig}}') {
        return ok(`${JSON.stringify({ PortBindings: JSON.parse(ctr.ports ?? '{}'), LogConfig: { Type: 'json-file', Config: ctr.logOpts ?? {} } })}\n`);
      }
      if (fmt === '{{.Config.Image}}') return ok(`${ctr.image}\n`);
      return ok('\n');
    }
    if (a[0] === 'run' || a[0] === 'create') {
      const name = a[a.indexOf('--name') + 1];
      if (this.ctrs.has(name)) return { code: 125, stdout: '', stderr: `Conflict. The container name "/${name}" is already in use` };
      const p = a.indexOf('-p');
      const port = p > 0 ? a[p + 1].split(':')[1] : undefined;
      const net = a[a.indexOf('--network') + 1];
      const r = a.indexOf('--restart');
      const logOpts: Record<string, string> = {};
      a.forEach((x, i) => { if (x === '--log-opt') { const [k, v] = a[i + 1].split('='); logOpts[k] = v; } });
      this.add(name, {
        running: a[0] === 'run', restart: r > 0 ? a[r + 1] : 'no', networks: [net], image: runImage(a), logOpts,
        ports: port ? `{"8080/tcp":[{"HostIp":"0.0.0.0","HostPort":"${port}"}]}` : undefined,
      });
      if (a.includes('--rm')) this.ctrs.delete(name);
      return ok(`${name}-id\n`);
    }
    if (a[0] === 'start' || a[0] === 'stop' || a[0] === 'update') {
      const name = a[a.length - 1];
      const ctr = this.ctrs.get(name);
      if (!ctr) return { code: 1, stdout: '', stderr: `Error response from daemon: No such container: ${name}` };
      if (a[0] === 'start') ctr.running = true;
      if (a[0] === 'stop') ctr.running = false;
      if (a[0] === 'update') ctr.restart = a[a.indexOf('--restart') + 1];
      return ok(`${name}\n`);
    }
    if (a[0] === 'rm') {
      for (const n of a.slice(1).filter((x) => !x.startsWith('-'))) this.ctrs.delete(n);
      return ok();
    }
    if (a[0] === 'rename') {
      const ctr = this.ctrs.get(a[1]);
      if (!ctr) return { code: 1, stdout: '', stderr: `Error response from daemon: No such container: ${a[1]}` };
      if (this.ctrs.has(a[2])) return { code: 1, stdout: '', stderr: `Conflict. The container name "/${a[2]}" is already in use` };
      this.ctrs.delete(a[1]);
      this.ctrs.set(a[2], ctr);
      return ok();
    }
    if (a[0] === 'network' && a[1] === 'connect') {
      this.ctrs.get(a[3])?.networks.push(a[2]);
      return ok();
    }
    if (a[0] === 'exec' && a.includes('curl')) {
      const name = a[1];
      const ctr = this.ctrs.get(name);
      if (!ctr || !ctr.running) return { code: 1, stdout: '', stderr: `container ${name} is not running` };
      if (a[a.length - 1].endsWith('/api/v1/health')) {
        const h = this.health.get(name);
        return h === undefined ? { code: 7, stdout: '', stderr: '' } : ok(h);
      }
      if (a.includes('/dev/null')) return ok();
      const page = this.pages.get(a[a.length - 1]);
      return page === undefined ? { code: 22, stdout: '', stderr: '' } : ok(page);
    }
    if (a[0] === 'logs') return ok(this.logs.get(a[a.length - 1]) ?? '');
    if (a[0] === 'ps' && a.includes('--filter')) {
      const f = a[a.indexOf('--filter') + 1];
      if (f.startsWith('ancestor=')) {
        const img = f.slice('ancestor='.length);
        return ok([...this.ctrs].filter(([, c]) => c.image === img).map(([n]) => n).join('\n') + ([...this.ctrs].some(([, c]) => c.image === img) ? '\n' : ''));
      }
    }
    if (a[0] === 'image' && a[1] === 'ls') {
      const repo = a[a.length - 1];
      return ok(this.images.filter((i) => i.startsWith(`${repo}:`)).map((i) => i.slice(repo.length + 1)).join('\n') + '\n');
    }
    if (a[0] === 'image' && a[1] === 'rm') {
      for (const ref of a.slice(2).filter((x) => !x.startsWith('-'))) this.images = this.images.filter((i) => i !== ref);
      return ok();
    }
    return undefined;
  }
}

export function fakeHost(handler?: Handler, sim: DockerSim = new DockerSim()) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const fetches: string[] = [];
  let t = T0;
  let n = 0;
  /** url → answers in order (the last one repeats); a string is a 200 body, an Error is thrown */
  const fetchAnswers = new Map<string, (string | Error | { status: number; body: string })[]>();
  const host: Host = {
    async run(cmd: string, args: string[], opts?: RunOpts): Promise<RunResult> {
      const c: Call = { cmd, args: [...args], ...(opts?.env ? { env: { ...opts.env } } : {}) };
      calls.push(c);
      const r = (await handler?.(c)) ?? sim.handle(c);
      return { code: 0, stdout: '', stderr: '', ...r };
    },
    async fetchText(url: string) {
      fetches.push(url);
      const list = fetchAnswers.get(url);
      if (!list || list.length === 0) throw new Error(`fetch failed: ECONNREFUSED ${url}`);
      const a = list.length > 1 ? list.shift()! : list[0];
      if (a instanceof Error) throw a;
      return typeof a === 'string' ? { status: 200, body: a } : a;
    },
    async sleep(ms: number) { t += ms; },
    now: () => t,
    randomHex: (bytes: number) => (++n).toString(16).padStart(bytes * 2, '0'),
    log: (m: string) => { logs.push(m); },
  };
  const line = (c: Call) => [c.cmd, ...c.args].join(' ');
  return {
    host, calls, logs, fetches, sim, fetchAnswers,
    lines: () => calls.map(line),
    /** calls whose argv (joined) starts with the prefix */
    find: (prefix: string) => calls.filter((c) => line(c).startsWith(prefix)),
    advance: (ms: number) => { t += ms; },
  };
}

export const health = (o: { ok?: boolean; commit?: string | null; leader?: boolean; db?: string }) =>
  JSON.stringify({ ok: o.ok ?? true, db: o.db ?? 'up', version: '0.5.0', commit: o.commit ?? null, leader: o.leader ?? false });
