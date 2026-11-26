// Test helpers for the Guard adapters (R13): a fake Host that records every argv and answers from a small Docker/git
// simulator, a fake clock (sleep advances now), deterministic random ids, and scripted fetch answers. No real process runs.

import type { Host, RunOpts, RunResult } from './host.ts';

export type Call = { cmd: string; args: string[]; env?: Record<string, string> };
type Answer = Partial<RunResult> | undefined;
export type Handler = (c: Call) => Answer | Promise<Answer>;

export type Ctr = { running: boolean; restart: string; ports?: string; networks: string[]; image: string };

export const T0 = Date.parse('2026-11-26T12:00:00.000Z');
const NO_SUCH = (name: string): RunResult => ({ code: 1, stdout: '', stderr: `Error: No such container: ${name}\n` });

/** A tiny model of the Docker containers the adapters touch; enough for inspect/run/create/start/stop/update/rm/network connect. */
export class DockerSim {
  ctrs = new Map<string, Ctr>();
  /** name → health JSON answered by `docker exec <name> curl … /api/v1/health` while the container runs */
  health = new Map<string, string>();
  images: string[] = [];

  add(name: string, c: Partial<Ctr> = {}) {
    this.ctrs.set(name, { running: true, restart: 'unless-stopped', networks: [], image: 'img', ...c });
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
      if (fmt === '{{json .HostConfig.PortBindings}}') return ok(`${ctr.ports ?? '{}'}\n`);
      return ok('\n');
    }
    if (a[0] === 'run' || a[0] === 'create') {
      const name = a[a.indexOf('--name') + 1];
      if (this.ctrs.has(name)) return { code: 125, stdout: '', stderr: `Conflict. The container name "/${name}" is already in use` };
      const p = a.indexOf('-p');
      const port = p > 0 ? a[p + 1].split(':')[1] : undefined;
      const net = a[a.indexOf('--network') + 1];
      const r = a.indexOf('--restart');
      this.add(name, {
        running: a[0] === 'run', restart: r > 0 ? a[r + 1] : 'no', networks: [net],
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
      return ok();
    }
    if (a[0] === 'image' && a[1] === 'ls') {
      const repo = a[a.length - 1];
      return ok(this.images.filter((i) => i.startsWith(`${repo}:`)).map((i) => i.slice(repo.length + 1)).join('\n') + '\n');
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
