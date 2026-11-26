// The Guard's only way to the outside world: run a program with an argument array (never a shell string), fetch a URL,
// sleep, read the clock, make random ids, log. The real implementation is below; tests use testing.ts (a recording fake).

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

export type RunResult = { code: number; stdout: string; stderr: string };
export type RunOpts = {
  /** added to the inherited environment; used to hand secrets to `docker run -e NAME` without putting them in argv */
  env?: Record<string, string>;
  timeoutMs?: number;
};

export interface Host {
  /** Runs `cmd` with `args`. Resolves with the exit code (non-zero is not an error); rejects only if it cannot run or times out. */
  run(cmd: string, args: string[], opts?: RunOpts): Promise<RunResult>;
  fetchText(url: string, timeoutMs: number): Promise<{ status: number; body: string }>;
  sleep(ms: number): Promise<void>;
  now(): number;
  randomHex(bytes: number): string;
  log(msg: string): void;
}

/** Output kept per stream; beyond this only the tail is kept (docker build and the checks are chatty). */
const MAX_OUTPUT = 16 * 1024 * 1024;

function collector() {
  const chunks: Buffer[] = [];
  let size = 0;
  let dropped = false;
  return {
    add(b: Buffer) {
      chunks.push(b);
      size += b.length;
      while (size > MAX_OUTPUT && chunks.length > 1) { size -= chunks.shift()!.length; dropped = true; }
    },
    text: () => (dropped ? '[…output truncated…]\n' : '') + Buffer.concat(chunks).toString('utf8'),
  };
}

export const realHost: Host = {
  run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        shell: false,
      });
      const out = collector();
      const err = collector();
      child.stdout.on('data', (b: Buffer) => out.add(b));
      child.stderr.on('data', (b: Buffer) => err.add(b));
      let timedOut = false;
      const timer = opts.timeoutMs
        ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
        }, opts.timeoutMs)
        : null;
      child.on('error', (e) => { if (timer) clearTimeout(timer); reject(new Error(`${cmd}: ${e.message}`)); });
      child.on('close', (code, signal) => {
        if (timer) clearTimeout(timer);
        if (timedOut) { reject(new Error(`${cmd} ${args[0] ?? ''} timed out after ${opts.timeoutMs} ms`)); return; }
        resolve({ code: code ?? (signal ? 128 : 1), stdout: out.text(), stderr: err.text() });
      });
    });
  },
  async fetchText(url, timeoutMs) {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    return { status: res.status, body: await res.text() };
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  randomHex: (bytes) => randomBytes(bytes).toString('hex'),
  log: (msg) => { process.stderr.write(`axion-guard: ${msg}\n`); },
};
