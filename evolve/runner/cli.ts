// axion-evolve: the runner's command line (evolution step 2). Installed as /usr/local/bin/axion-evolve (evolve/bin/axion-evolve),
// running the Guard's own installed copy under <root>/guard; agents never write there.
//
//   axion-evolve run                      the service (axion-evolve.service): startup (sweep, reconcile, recover), then poll every 30 s
//   axion-evolve once [--inject-failure]  startup and at most one change, then exit; --inject-failure (Claude Code's exit demo
//                                         only) adds the failure commit the Guard's watch must roll back. Never from `run`.
//   axion-evolve approve <mission>        deploy the change held for the owner (Claude Code / the owner only)
//   axion-evolve status                   PAUSED, locks, day count, rollback streak, the last history lines
//   axion-evolve pause [reason…]          write PAUSED (a running change stops at its next step, `failed`)
//   axion-evolve resume                   remove PAUSED (also ends a rollback streak)
//   axion-evolve sweep                    remove the Workshop and typecheck containers (the unit's ExecStopPost); skipped while
//                                         a live runner holds runner.lock; never touches the Guard
//   axion-evolve file --owner <name> --text <text>   file an owner request (an `improve` mission of that administrator,
//                                         staffed to the end) through the mission CLI in the live image; prints its id (M6).
//                                         The text is not secret (argv is fine), at most 20000 characters
// run, once and approve: the first SIGTERM/SIGINT stops after the current step and removes the Workshop and typecheck
// containers at once (the Workshop holds TOKEN1; its 30 min wall lives in the runner); a second one exits now. A Guard
// deploy runs detached in its own session and is never signalled.
// Exit codes: 0 live / done, 1 the change or approval ended otherwise (or an error), 2 usage, 3 needs the owner's approval,
// 4 busy (the runner lock is held), 5 nothing claimed (idle, paused, halted or the day cap). `once` prints one JSON line.

import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { approve, claimsToday, once, rollbackStreak, runForever } from './loop.ts';
import type { RunnerEffects, TickResult } from './loop.ts';
import { makeEffects } from './effects.ts';
import { CAPS, runnerPaths } from './config.ts';
import type { RunnerPaths } from './config.ts';

export const USAGE = `usage: axion-evolve <command>
  axion-evolve run                      (the service: loop forever, poll 30 s)
  axion-evolve once [--inject-failure]  (one change, then exit; --inject-failure: Claude Code's exit demo only)
  axion-evolve approve <mission>        (deploy the change held for the owner's approval)
  axion-evolve status
  axion-evolve pause [reason…]
  axion-evolve resume
  axion-evolve sweep                    (remove the Workshop/typecheck containers; the unit's ExecStopPost)
  axion-evolve file --owner <name> --text <text>   (file an owner request: an improve mission; prints its id)
exit codes: 0 live/done, 1 failed/refused/error, 2 usage, 3 needs the owner's approval, 4 busy, 5 nothing claimed`;

export type Command =
  | { cmd: 'help' } | { cmd: 'run' } | { cmd: 'once'; inject: boolean } | { cmd: 'approve'; mission: string }
  | { cmd: 'status' } | { cmd: 'pause'; reason: string } | { cmd: 'resume' } | { cmd: 'sweep' }
  | { cmd: 'file'; owner: string; text: string };

/** M6: the mission CLI's own cap (server CAPS.missionText) */
export const FILE_TEXT_MAX = 20_000;
const OWNER_RE = /^[^\s\-\p{Cc}][^\p{Cc}]{0,63}$/u;

export class UsageError extends Error {}

export function parseArgs(argv: string[]): Command {
  const [cmd, ...rest] = argv;
  const none = () => { if (rest.length) throw new UsageError(`${cmd} takes no arguments`); };
  switch (cmd) {
    case undefined: case 'help': case '--help': case '-h': return { cmd: 'help' };
    // the service never injects: `run --inject-failure` is a usage error like any other argument
    case 'run': none(); return { cmd: 'run' };
    case 'once':
      if (rest.length > 1 || (rest.length === 1 && rest[0] !== '--inject-failure')) throw new UsageError('once takes only --inject-failure');
      return { cmd: 'once', inject: rest[0] === '--inject-failure' };
    case 'approve':
      if (rest.length !== 1) throw new UsageError('approve takes one mission id');
      return { cmd: 'approve', mission: rest[0] };
    case 'status': none(); return { cmd: 'status' };
    case 'pause': return { cmd: 'pause', reason: rest.join(' ').replace(/\s+/g, ' ').trim().slice(0, 300) };
    case 'resume': none(); return { cmd: 'resume' };
    case 'sweep': none(); return { cmd: 'sweep' };
    case 'file': {
      const o: Record<string, string> = {};
      for (let i = 0; i < rest.length; i += 2) {
        const k = rest[i];
        if ((k !== '--owner' && k !== '--text') || rest[i + 1] === undefined || k.slice(2) in o) throw new UsageError('file takes --owner <name> --text <text>, each once');
        o[k.slice(2)] = rest[i + 1];
      }
      if (o.owner === undefined || o.text === undefined) throw new UsageError('file takes --owner <name> --text <text>');
      if (!OWNER_RE.test(o.owner)) throw new UsageError('file: --owner must be a user name (1-64 characters, no control characters, not starting with - or a space)');
      if (o.text.trim() === '') throw new UsageError('file: --text is empty');
      if (o.text.length > FILE_TEXT_MAX) throw new UsageError(`file: --text is longer than ${FILE_TEXT_MAX} characters`);
      if (o.text.includes('\u0000')) throw new UsageError('file: --text contains a NUL character');
      return { cmd: 'file', owner: o.owner, text: o.text };
    }
    default: throw new UsageError(`unknown command ${JSON.stringify(cmd)}`);
  }
}

export function onceCode(r: TickResult): number {
  if (r.kind === 'busy') return 4;
  if (r.kind !== 'change') return 5;
  return r.outcome.outcome === 'live' ? 0 : r.outcome.outcome === 'needs_owner' ? 3 : 1;
}

async function status(fx: RunnerEffects, paths: RunnerPaths): Promise<string> {
  const h = await fx.readHistory();
  const paused = await fx.paused();
  const lock = await readFile(paths.lock, 'utf8').then((t) => t.split('\n')[0].trim(), () => null);
  const lines = [
    `paused: ${paused === null ? 'no' : `YES (${paused})`}`,
    `runner lock: ${lock ? `held by pid ${lock}` : 'free'}`,
    `guard: ${(await fx.guardBusy()) ? 'deploying (its lock is held)' : 'idle'}`,
    `changes today (UTC): ${claimsToday(h, fx.now())} of ${CAPS.changesPerDay}`,
    `rolled back in a row: ${rollbackStreak(h)} (pauses at ${CAPS.rollbacksToPause})`,
    'last entries of runner-history.jsonl:',
    ...h.slice(-12).map((e) => `  ${e.at} ${e.event}${e.mission ? ` ${e.mission}` : ''}${e.attempt ? ` a${e.attempt}` : ''}${e.outcome ? ` ${e.outcome}` : ''}${e.commit ? ` ${e.commit.slice(0, 12)}` : ''}${e.reason ? ` — ${e.reason}` : ''}`),
  ];
  return lines.join('\n');
}

export type MainDeps = {
  env?: Record<string, string | undefined>;
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** tests: the effects to use instead of the real ones */
  effects?: (o: { paths: RunnerPaths; stopping: () => boolean; signal: AbortSignal }) => RunnerEffects;
  /** tests: no process signal handlers */
  noSignals?: boolean;
  /** tests: receives the stop handler instead of process.on */
  onSignal?: (handler: (sig: string) => void) => void;
  exit?: (code: number) => void;
};

export async function main(argv: string[], deps: MainDeps = {}): Promise<number> {
  const out = deps.out ?? ((s: string) => { process.stdout.write(`${s}\n`); });
  const err = deps.err ?? ((s: string) => { process.stderr.write(`${s}\n`); });
  let c: Command;
  try {
    c = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    err(`axion-evolve: ${e.message}`);
    err(USAGE);
    return 2;
  }
  if (c.cmd === 'help') { out(USAGE); return 0; }
  const env = deps.env ?? process.env;
  const paths = runnerPaths(env);
  const ac = new AbortController();
  let stopping = false;
  const stopping_ = () => stopping;
  const fx = deps.effects
    ? deps.effects({ paths, stopping: stopping_, signal: ac.signal })
    : makeEffects({ paths, stopping: stopping_, signal: ac.signal, prefix: env.AXION_GUARD_PREFIX?.trim() || 'axion' });
  if ((c.cmd === 'run' || c.cmd === 'once' || c.cmd === 'approve') && !deps.noSignals) {
    let seen = 0;
    const stop = (sig: string) => {
      if (++seen > 1) { err(`axion-evolve: ${sig} again: exiting now (a running Guard deploy goes on by itself)`); (deps.exit ?? process.exit)(130); return; }
      err(`axion-evolve: ${sig}: stopping after the current step; removing this runner's Workshop and typecheck containers (never the Guard)`);
      stopping = true;
      ac.abort();
      // only this process's own workers: a process that does not hold runner.lock (waiting for it, or approve before it
      // got it) must not remove the containers of the runner that does
      if (!fx.holdsLock()) { err('axion-evolve: not holding runner.lock: no containers removed'); return; }
      void fx.killWorkers().then((k) => { if (k.length) err(`axion-evolve: removed ${k.join(', ')}`); }, (e: unknown) => err(`axion-evolve: removing the workers failed: ${e instanceof Error ? e.message : String(e)}`));
    };
    if (deps.onSignal) deps.onSignal(stop);
    else { process.on('SIGTERM', () => stop('SIGTERM')); process.on('SIGINT', () => stop('SIGINT')); }
  }
  switch (c.cmd) {
    case 'run':
      err('axion-evolve: the runner starts');
      await runForever(fx);
      err('axion-evolve: the runner stopped');
      return 0;
    case 'once': {
      const r = await once(fx, { inject: c.inject });
      out(JSON.stringify(r.kind === 'change' ? { kind: 'change', ...r.outcome, ...(c.inject ? { injected: true } : {}) } : r));
      return onceCode(r);
    }
    case 'approve': {
      const r = await approve(fx, c.mission);
      (r.code === 0 ? out : err)(`axion-evolve approve ${c.mission}: ${r.message}`);
      return r.code;
    }
    case 'status':
      out(await status(fx, paths));
      return 0;
    case 'pause': {
      const why = `paused by the owner at ${new Date(fx.now()).toISOString()}${c.reason ? `: ${c.reason}` : ''}`;
      await fx.writePaused(why);
      await fx.appendHistory({ event: 'pause', reason: why });
      out(`axion-evolve: ${why} (a running change stops at its next step; resume with: axion-evolve resume)`);
      return 0;
    }
    case 'sweep': {
      // never under a live runner: its own containers are its business (it removes them on a stop signal)
      const release = await fx.lock();
      if (!release) { out('axion-evolve sweep: a live runner holds runner.lock; nothing removed'); return 0; }
      try {
        const k = await fx.killWorkers();
        out(`axion-evolve sweep: ${k.length ? `removed ${k.join(', ')}` : 'nothing to remove'}`);
      } finally { await release(); }
      return 0;
    }
    case 'file': {
      const r = await fx.missions.file(c.owner, c.text);
      out(JSON.stringify({ id: r.id }));
      return 0;
    }
    case 'resume': {
      const was = await fx.clearPaused();
      await fx.appendHistory({ event: 'resume', reason: was ? 'PAUSED removed' : 'nothing was paused' });
      out(`axion-evolve: ${was ? 'resumed (PAUSED removed; the rollback streak starts over)' : 'was not paused'}`);
      return 0;
    }
  }
}

function isMain(): boolean {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (e: unknown) => { process.stderr.write(`axion-evolve: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exitCode = 1; },
  );
}
