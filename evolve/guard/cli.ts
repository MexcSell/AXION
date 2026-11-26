// axion-guard: the Guard's command line (evolve step 1). Installed as /usr/local/bin/axion-guard (evolve/bin/axion-guard),
// running the Guard's own copy under <root>/guard; agents never write there.
//
//   axion-guard deploy <ref> [--approve <sha> [--approve-base <sha>]] [--watch <s>=600] [--front-port <port>] [--database <name>]
//                            [--no-expect-leader] [--drain <s>=5]
//   axion-guard status | rollback | revert | history [n=20] | front-port <port>
//
// revert: go back to the previous commit after a deploy that passed its watch (the previous slot is started again, the
// front switched to it, evolve/main moved back by compare-and-swap). Only when nothing is deploying and a previous
// image and commit are kept; a second revert says there is nothing to revert.
//
// --front-port (>= 1024) defaults to the port kept in state.json (first time 5290); --database defaults to axion, and a deploy
// without --database is refused while the live slot uses another database. A deploy writes both to state.json as `pending`
// before the core runs; they become the stored ones once it is live (the port also after a rollback; `front-port` stores
// directly). --approve-base defaults to the live commit at invocation.
// The checks' test-count floor is the larger of baseline.json and the passed count of the live commit's checks
// (state.json lastChecksPassed, written when a deploy goes live), so it rises with the suite.
// Candidate images are pruned after every deploy outcome (active and previous kept; never one a container uses).
// Exit codes: 0 live / done, 1 rejected / rolled back / error, 2 usage, 3 needs the owner's approval, 4 busy (lock held).

import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Busy, deploy, STEPS } from './deploy.ts';
import type { Effects, HistoryEntry, Slot } from './deploy.ts';
import { parseRules } from './classify.ts';
import { readState, writeState } from './state.ts';
import type { GuardState } from './state.ts';
import { loadConfig } from './config.ts';
import type { GuardConfig } from './config.ts';
import { realHost } from './host.ts';
import type { Host } from './host.ts';
import { acquireLock, makeEffects } from './effects.ts';
import type { DeployContext, GuardEffects } from './effects.ts';
import { isPlainRef } from './effects-git.ts';

export class UsageError extends Error {}

export type Command =
  | { cmd: 'help' }
  | { cmd: 'status' }
  | { cmd: 'rollback' }
  | { cmd: 'revert' }
  | { cmd: 'history'; n: number }
  | { cmd: 'front-port'; port: number }
  | {
    cmd: 'deploy'; ref: string; approve?: string; approveBase?: string; watchS: number; frontPort?: number; database?: string;
    expectLeader: boolean; drainS: number;
  };

export const USAGE = `usage: axion-guard <command>
  axion-guard deploy <ref> [--approve <sha> [--approve-base <sha>]] [--watch <seconds>=600] [--front-port <port>]
                           [--database <name>] [--no-expect-leader] [--drain <seconds>=5]
  axion-guard status
  axion-guard rollback
  axion-guard revert             (back to the previous commit after a deploy went live)
  axion-guard history [n=20]
  axion-guard front-port <port>
--front-port defaults to state.json's (first time 5290); --database defaults to axion and must be given while the live slot
uses another database; --approve-base defaults to the live commit now.
exit codes: 0 live/done, 1 rejected/rolled back/error, 2 usage, 3 needs the owner's approval, 4 another axion-guard holds the lock`;

const SHA_RE = /^[0-9a-f]{40}$/;
const DB_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const other = (s: Slot): Slot => (s === 'blue' ? 'green' : 'blue');
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function int(v: string | undefined, what: string, min: number, max: number): number {
  if (v === undefined || !/^\d+$/.test(v)) throw new UsageError(`${what} must be a whole number, got ${JSON.stringify(v ?? '')}`);
  const n = Number(v);
  if (n < min || n > max) throw new UsageError(`${what} must be from ${min} to ${max}, got ${n}`);
  return n;
}

function sha(v: string | undefined, what: string): string {
  if (v === undefined || !SHA_RE.test(v)) throw new UsageError(`${what} needs a full 40-char lowercase commit sha, got ${JSON.stringify(v ?? '')}`);
  return v;
}

function parseDeploy(args: string[]): Command {
  const seen = new Set<string>();
  const o: Record<string, unknown> = {};
  let ref: string | undefined;
  let expectLeader = true;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('-')) {
      if (ref !== undefined) throw new UsageError(`deploy takes one ref, got ${ref} and ${a}`);
      if (!isPlainRef(a)) throw new UsageError(`not a plain ref or sha: ${JSON.stringify(a)}`);
      ref = a;
      continue;
    }
    if (seen.has(a)) throw new UsageError(`${a} given twice`);
    seen.add(a);
    const val = () => {
      const v = args[++i];
      if (v === undefined) throw new UsageError(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case '--approve': o.approve = sha(val(), a); break;
      case '--approve-base': o.approveBase = sha(val(), a); break;
      case '--watch': o.watchS = int(val(), a, 1, 86_400); break;
      case '--front-port': o.frontPort = int(val(), a, 1024, 65_535); break;
      case '--drain': o.drainS = int(val(), a, 0, 600); break;
      case '--database': {
        const v = val();
        if (!DB_RE.test(v)) throw new UsageError(`--database must be a lowercase PostgreSQL name (a-z, 0-9, _), got ${JSON.stringify(v)}`);
        o.database = v;
        break;
      }
      case '--no-expect-leader': expectLeader = false; break;
      default: throw new UsageError(`unknown option ${a}`);
    }
  }
  if (ref === undefined) throw new UsageError('deploy needs a ref (e.g. evolve/main or a commit sha)');
  if (o.approveBase !== undefined && o.approve === undefined) throw new UsageError('--approve-base needs --approve');
  return {
    cmd: 'deploy', ref,
    ...(o.approve !== undefined ? { approve: o.approve as string } : {}),
    ...(o.approveBase !== undefined ? { approveBase: o.approveBase as string } : {}),
    watchS: (o.watchS as number | undefined) ?? 600,
    ...(o.frontPort !== undefined ? { frontPort: o.frontPort as number } : {}),
    ...(o.database !== undefined ? { database: o.database as string } : {}),
    expectLeader,
    drainS: (o.drainS as number | undefined) ?? 5,
  };
}

export function parseArgs(argv: string[]): Command {
  const [cmd, ...rest] = argv;
  const none = () => { if (rest.length) throw new UsageError(`${cmd} takes no arguments`); };
  switch (cmd) {
    case undefined: case 'help': case '--help': case '-h': return { cmd: 'help' };
    case 'status': none(); return { cmd: 'status' };
    case 'rollback': none(); return { cmd: 'rollback' };
    case 'revert': none(); return { cmd: 'revert' };
    case 'history':
      if (rest.length > 1) throw new UsageError('history takes at most one number');
      return { cmd: 'history', n: rest.length ? int(rest[0], 'history n', 1, 100_000) : 20 };
    case 'front-port':
      if (rest.length !== 1) throw new UsageError('front-port needs exactly one port');
      return { cmd: 'front-port', port: int(rest[0], 'port', 1024, 65_535) };
    case 'deploy': return parseDeploy(rest);
    default: throw new UsageError(`unknown command ${JSON.stringify(cmd)}`);
  }
}

const portOf = (s: GuardState | null): number | undefined => (typeof s?.frontPort === 'number' ? s.frontPort : undefined);
const dbOf = (s: GuardState | null): string | undefined => (typeof s?.database === 'string' ? s.database : undefined);

export function formatStatus(s: GuardState | null, defaults = { frontPort: 5290, database: 'axion' }): string {
  const lines: string[] = [];
  if (!s || s.activeImage === null) {
    lines.push('no active slot');
  } else {
    lines.push(`active slot: ${s.active}`, `  image:    ${s.activeImage}`, `  commit:   ${s.activeSha ?? 'unknown'}`,
      ...(typeof s.lastChecksPassed === 'number' ? [`  checks:   ${s.lastChecksPassed} passed (the next deploy's test floor, unless baseline.json is higher)`] : []),
      s.previousImage !== null ? `previous:   ${s.previousImage} (commit ${s.previousSha ?? 'unknown'})` : 'previous:   none');
  }
  const port = portOf(s);
  const db = dbOf(s);
  lines.push(port !== undefined ? `front port: ${port}` : `front port: ${defaults.frontPort} (default)`);
  lines.push(db !== undefined ? `database:   ${db}` : `database:   ${defaults.database} (default)`);
  const d = s?.deploying;
  const p = s ? pendingOf(s) : {};
  if (p.frontPort !== undefined || p.database !== undefined) {
    lines.push(`pending (deploy in progress): front port ${p.frontPort ?? '?'}, database ${p.database ?? '?'}`);
  }
  lines.push(d ? `UNFINISHED DEPLOY of ${d.sha} at step ${d.step} (started ${d.startedAt}): run \`axion-guard rollback\`` : 'no deploy in progress');
  return lines.join('\n');
}

type Pending = { frontPort?: number; database?: string };

/** the front port and database of a deploy in progress (state.json `pending`, written by the CLI before the core runs) */
function pendingOf(s: GuardState): Pending {
  const p = s.pending as Record<string, unknown> | undefined;
  return {
    ...(typeof p?.frontPort === 'number' ? { frontPort: p.frontPort } : {}),
    ...(typeof p?.database === 'string' ? { database: p.database } : {}),
  };
}

/** state.json with the deploy resolved: no `deploying`, no `pending` */
function settled(s: GuardState): GuardState {
  const { deploying: _d, pending: _p, ...rest } = s;
  return rest as GuardState;
}

/**
 * `axion-guard rollback`: resolves an unfinished deploy left in state.json, by `deploying.step`, exactly as the table
 * in deploy.ts's header says. A throw leaves `deploying` on disk, so it can be run again. Returns what it did.
 */
export async function rollback(fx: Pick<Effects, 'switchTo' | 'stopSlot' | 'liveSha' | 'record'>, stateDir: string): Promise<string> {
  const s = await readState(stateDir);
  const d = s?.deploying;
  if (!s || !d) return 'nothing to do: state.json shows no unfinished deploy';
  const active = s.active;
  const idle = other(active);
  const note = (outcome: 'rolled_back' | 'live', reason: string) => fx.record({
    at: new Date().toISOString(), sha: d.sha, step: d.step, event: 'outcome', outcome,
    ...(outcome === 'rolled_back' ? { failedStep: d.step } : {}), reason: `axion-guard rollback: ${reason}`,
  });

  if (STEPS.indexOf(d.step) < STEPS.indexOf('switch')) {
    await fx.stopSlot(idle);
    await writeState(stateDir, settled(s));
    const what = `stopped the candidate slot ${idle}; ${active} unchanged`;
    await note('rolled_back', what);
    return `rolled back the unfinished deploy of ${d.sha} (step ${d.step}): ${what}`;
  }
  if (d.step === 'switch') {
    if (s.activeImage !== null) await fx.switchTo(active);
    await fx.stopSlot(idle);
    await writeState(stateDir, settled(s));
    const what = s.activeImage !== null ? `the front is back on ${active}; stopped ${idle}` : `nothing was live; stopped ${idle}`;
    await note('rolled_back', what);
    return `rolled back the unfinished deploy of ${d.sha} (step switch): ${what}`;
  }
  if (d.step === 'record' && (await fx.liveSha()) === d.sha) {
    // the deploy did go live: its front port and database become the stored ones
    await writeState(stateDir, { ...settled(s), ...pendingOf(s) });
    await note('live', `evolve/main is already at ${d.sha}; only cleared the unfinished-deploy marker`);
    return `already live: evolve/main is at ${d.sha}; cleared the unfinished-deploy marker (${active} stays active)`;
  }
  // watch, or record before evolve/main moved: active names the candidate; go back to the previous slot
  if (s.previousImage !== null) await fx.switchTo(idle);
  await fx.stopSlot(active);
  await writeState(stateDir, {
    ...settled(s), active: idle, activeImage: s.previousImage, activeSha: s.previousSha, previousImage: null, previousSha: null,
    lastChecksPassed: s.previousChecksPassed ?? null, previousChecksPassed: null,
  });
  const what = s.previousImage !== null ? `the front is back on ${idle} (${s.previousImage}); stopped ${active}` : `nothing to go back to; stopped ${active}`;
  await note('rolled_back', what);
  return `rolled back the unfinished deploy of ${d.sha} (step ${d.step}): ${what}`;
}

export type RevertEffects = Pick<GuardEffects, 'switchTo' | 'stopSlot' | 'startSlot' | 'liveSha' | 'record' | 'slotImage' | 'moveMain'>;

/**
 * `axion-guard revert` (I5): back to the previous commit after a deploy passed its watch. Call under the lock. Returns
 * { code, message }: 0 reverted or nothing to revert, 1 refused. The steps reuse the rollback table's markers, so a
 * killed or failed revert is resolved by `axion-guard rollback`:
 *   1. refuse unless nothing is deploying, something is live, a previous image + commit are kept, evolve/main == activeSha
 *   2. state: deploying {sha: previous, step: switch} (active unchanged; rollback = front back on active, stop the other)
 *   3. the other slot must hold the previous image (a later rejected deploy may have replaced it): else startSlot(previous
 *      image) there; then switchTo(other, previousSha) (restarts it, health must report previousSha, retires active)
 *   4. state: active = other, the pairs swapped, deploying {step: record} (rollback: evolve/main moved → clear; else back)
 *   5. evolve/main: compare-and-swap activeSha → previousSha
 *   6. state: previous image/commit/count cleared (a second revert has nothing to revert), no deploying; history
 */
export async function revert(fx: RevertEffects, stateDir: string, appRef: (tag: string) => string): Promise<{ code: number; message: string }> {
  const s = await readState(stateDir);
  if (s?.deploying) {
    return { code: 1, message: `refused: state.json shows an unfinished deploy of ${s.deploying.sha} (step ${s.deploying.step}); run \`axion-guard rollback\` first` };
  }
  if (!s || s.activeImage === null || s.activeSha === null) return { code: 1, message: 'refused: nothing is live through the Guard' };
  if (s.previousImage === null || s.previousSha === null) {
    return { code: 0, message: `nothing to revert: no previous image and commit are kept (live: ${s.activeSha} in ${s.active})` };
  }
  const live = await fx.liveSha();
  if (live !== s.activeSha) {
    return { code: 1, message: `refused: evolve/main is at ${live}, state.json says the live commit is ${s.activeSha}` };
  }
  const cur = s.active;
  const prev = other(cur);
  const [curImage, curSha, prevImage, prevSha] = [s.activeImage, s.activeSha, s.previousImage, s.previousSha];
  const startedAt = new Date().toISOString();
  const rec = (e: Omit<HistoryEntry, 'at' | 'sha'>) => fx.record({ at: new Date().toISOString(), sha: prevSha, ...e });
  await rec({ step: 'switch', event: 'start', detail: `axion-guard revert: from ${curSha} (${curImage}) in ${cur} to ${prevSha} (${prevImage}) in ${prev}` });
  const base = settled(s);
  await writeState(stateDir, { ...base, deploying: { sha: prevSha, step: 'switch', startedAt } });
  /** a failed step: resolve the marker like `axion-guard rollback` would; if that fails too the marker stays for it */
  const undo = async (e: unknown): Promise<never> => {
    let done: string;
    try {
      done = await rollback(fx, stateDir);
    } catch (re) {
      throw new Error(`revert failed (${msg(e)}) and resolving it failed too (${msg(re)}); state.json keeps the marker: run \`axion-guard rollback\``);
    }
    throw new Error(`revert failed (${msg(e)}); ${done}`);
  };
  try {
    const has = await fx.slotImage(prev);
    if (has !== appRef(prevImage)) await fx.startSlot(prev, prevImage);
    await fx.switchTo(prev, prevSha);
  } catch (e) {
    return await undo(e);
  }
  const swapped: GuardState = {
    ...base, active: prev, activeImage: prevImage, activeSha: prevSha, previousImage: curImage, previousSha: curSha,
    lastChecksPassed: s.previousChecksPassed ?? null, previousChecksPassed: s.lastChecksPassed ?? null,
  };
  await writeState(stateDir, { ...swapped, deploying: { sha: prevSha, step: 'record', startedAt } });
  try {
    await fx.moveMain(prevSha, curSha);
  } catch (e) {
    // same rule as the deploy's advance: if the ref is at prevSha anyway it moved; if it cannot be read, keep the marker
    let now: string;
    try { now = await fx.liveSha(); } catch (le) {
      throw new Error(`revert: moving evolve/main failed (${msg(e)}) and reading it failed (${msg(le)}); run \`axion-guard rollback\``);
    }
    if (now !== prevSha) return await undo(e);
  }
  await writeState(stateDir, { ...swapped, previousImage: null, previousSha: null, previousChecksPassed: null });
  const what = `reverted: ${prev} serves ${prevSha} (${prevImage}) again; ${cur} (${curSha}) is stopped; evolve/main moved back`;
  await rec({ step: 'record', event: 'outcome', outcome: 'reverted', reason: `axion-guard revert: ${what}`, image: prevImage });
  return { code: 0, message: what };
}

/** the checks' test-count floor: baseline.json, raised to the live commit's passed count once one is known */
export function checksFloor(baseline: number, s: GuardState | null): number {
  const last = s?.lastChecksPassed;
  return typeof last === 'number' && Number.isInteger(last) && last > baseline ? last : baseline;
}

function formatHistoryLine(line: string): string {
  let e: Record<string, unknown>;
  try { e = JSON.parse(line) as Record<string, unknown>; } catch { return line; }
  const parts = [String(e.at), String(e.sha ?? '').slice(0, 12), String(e.step), String(e.event)];
  if (e.event === 'outcome') {
    parts.push(String(e.outcome));
    if (e.failedStep) parts.push(`(failed at ${String(e.failedStep)})`);
    if (e.reason) parts.push(String(e.reason));
  } else {
    if (e.ok === true) parts.push('ok');
    if (e.ok === false) parts.push('FAILED');
    if (e.detail) parts.push(String(e.detail));
  }
  return parts.join(' ');
}

export type MainDeps = {
  env?: Record<string, string | undefined>;
  host?: Host;
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** the installed evolve/ directory (default: the one this file lives in) */
  evolveDir?: string;
};

async function locked<T>(cfg: GuardConfig, host: Host, fn: () => Promise<T>): Promise<T> {
  const release = await acquireLock(cfg.lockFile, host);
  try {
    return await fn();
  } finally {
    await release();
  }
}

const initialState = (): GuardState => ({ active: 'blue', activeImage: null, activeSha: null, previousImage: null, previousSha: null });

export async function main(argv: string[], deps: MainDeps = {}): Promise<number> {
  const out = deps.out ?? ((s: string) => { process.stdout.write(`${s}\n`); });
  const err = deps.err ?? ((s: string) => { process.stderr.write(`${s}\n`); });
  let cmd: Command;
  try {
    cmd = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    err(`axion-guard: ${e.message}`);
    err(USAGE);
    return 2;
  }
  if (cmd.cmd === 'help') { out(USAGE); return 0; }
  const host = deps.host ?? realHost;
  try {
    const cfg = loadConfig(deps.env ?? process.env, deps.evolveDir);
    const defaults = { frontPort: cfg.defaultFrontPort, database: cfg.defaultDatabase };
    const ctxOf = (s: GuardState | null): DeployContext => ({ frontPort: portOf(s) ?? defaults.frontPort, database: dbOf(s) ?? defaults.database });

    switch (cmd.cmd) {
      case 'status':
        out(formatStatus(await readState(cfg.stateDir), defaults));
        return 0;

      case 'history': {
        let text: string;
        try {
          text = await readFile(cfg.historyFile, 'utf8');
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
          text = '';
        }
        const lines = text.split('\n').filter((l) => l.trim() !== '');
        if (lines.length === 0) out('no history yet');
        for (const l of lines.slice(-cmd.n)) out(formatHistoryLine(l));
        return 0;
      }

      case 'rollback':
        return await locked(cfg, host, async () => {
          const s = await readState(cfg.stateDir);
          out(await rollback(makeEffects(cfg, host, ctxOf(s)), cfg.stateDir));
          return 0;
        });

      case 'revert':
        return await locked(cfg, host, async () => {
          const s = await readState(cfg.stateDir);
          const r = await revert(makeEffects(cfg, host, ctxOf(s)), cfg.stateDir, (tag) => `${cfg.prefix}-app:${tag}`);
          (r.code === 0 ? out : err)(r.code === 0 ? r.message : `axion-guard: ${r.message}`);
          return r.code;
        });

      case 'front-port': {
        const port = cmd.port;
        return await locked(cfg, host, async () => {
          const s = await readState(cfg.stateDir);
          if (s?.deploying) { err('axion-guard: state.json shows an unfinished deploy; run `axion-guard rollback` first'); return 1; }
          if (s && s.activeImage !== null) {
            // switching to the slot already served, with the new port: recreates the front on it and checks health there
            await makeEffects(cfg, host, { ...ctxOf(s), frontPort: port }).switchTo(s.active);
          }
          await writeState(cfg.stateDir, { ...(s ?? initialState()), frontPort: port });
          out(s && s.activeImage !== null ? `the front now listens on port ${port} (serving ${s.active})` : `front port ${port} stored (nothing live yet)`);
          return 0;
        });
      }

      case 'deploy': {
        const c = cmd;
        return await locked(cfg, host, async () => {
          const s = await readState(cfg.stateDir);
          if (s?.deploying) {
            err(`axion-guard: state.json shows an unfinished deploy of ${s.deploying.sha} (step ${s.deploying.step}); run \`axion-guard rollback\` first`);
            return 1;
          }
          const liveDb = s && s.activeImage !== null ? dbOf(s) : undefined;
          if (c.database === undefined && liveDb !== undefined && liveDb !== defaults.database) {
            // never move a site off its database silently: the default (axion) differs from the live slot's
            err(`axion-guard: the live slot uses database ${liveDb}; pass --database explicitly (--database ${liveDb} to stay on it)`);
            return 1;
          }
          const ctx: DeployContext = {
            frontPort: c.frontPort ?? portOf(s) ?? defaults.frontPort,
            database: c.database ?? defaults.database,
            expectLeader: c.expectLeader,
            drainMs: c.drainS * 1000,
          };
          if (liveDb !== undefined && ctx.database !== liveDb) {
            err(`axion-guard: warning: the live slot uses database ${liveDb}, this deploy uses ${ctx.database} (a rollback goes back to ${liveDb})`);
          }
          const fx = makeEffects(cfg, host, ctx);
          // no other Guard runs (we hold the lock): whatever a killed one left behind goes now
          try {
            const swept = await fx.sweepLeftovers();
            if (swept.length) out(`removed leftovers of an earlier run: ${swept.join(', ')}`);
          } catch (e) {
            err(`axion-guard: warning: sweeping leftovers failed: ${msg(e)}`);
          }
          const target = await fx.resolve(c.ref);
          ctx.sha = target;
          let approvedBase = c.approveBase;
          if (c.approve !== undefined && approvedBase === undefined) {
            approvedBase = await fx.liveSha();
            out(`approval of ${c.approve} bound to base ${approvedBase} (the live commit now)`);
          }
          const rules = parseRules(await readFile(join(cfg.evolveDir, 'protected.txt'), 'utf8'));
          const baseline = (JSON.parse(await readFile(join(cfg.evolveDir, 'baseline.json'), 'utf8')) as { serverTestsPassed?: unknown }).serverTestsPassed;
          if (!Number.isInteger(baseline)) throw new Error(`${join(cfg.evolveDir, 'baseline.json')} has no integer serverTestsPassed`);
          const active: Slot = s?.active ?? 'blue';
          const floor = checksFloor(baseline as number, s && s.activeImage !== null ? s : null);
          out(`deploying ${target} (${c.ref}) into ${cfg.prefix}-${other(active)}; front port ${ctx.frontPort}, database ${ctx.database}; `
            + `test floor ${floor}${floor !== baseline ? ` (live commit's checks; baseline ${String(baseline)})` : ' (baseline)'}`);
          // the deploy's port and database are on disk before the core runs, so `axion-guard rollback` after a kill knows them
          await writeState(cfg.stateDir, { ...(s ?? initialState()), pending: { frontPort: ctx.frontPort, database: ctx.database } });
          /** resolves `pending` once the core returned: dropped, or promoted (all or only the port) */
          const finish = async (keep: Pending) => {
            const now = await readState(cfg.stateDir);
            if (now) await writeState(cfg.stateDir, { ...settled(now), ...(now.deploying ? { deploying: now.deploying } : {}), ...keep });
            return now;
          };
          // the CLI already holds the lock (taken before reading state.json); the core's lock() is a no-op here
          const result = await deploy({ ...fx, lock: async () => async () => {} }, {
            sha: target, approvedSha: c.approve, approvedBase, watchMs: c.watchS * 1000, baselinePassed: floor,
            active, stateDir: cfg.stateDir, rules,
          });
          out(JSON.stringify(result));
          // rolled back: the switch back ran with this deploy's front port (switchTo moves the front to it)
          const now = result.outcome === 'live'
            ? await finish({ frontPort: ctx.frontPort, database: ctx.database })
            : await finish(result.outcome === 'rolled_back' ? { frontPort: ctx.frontPort } : {});
          // I7: after every outcome, not only after a success: rejected and rolled-back candidates go too
          try {
            const p = await fx.pruneImages(now?.activeImage ?? null, now?.previousImage ?? null);
            if (p.removed.length) out(`removed images: ${p.removed.join(', ')}`);
            for (const w of p.warnings) err(`axion-guard: warning: image not removed: ${w}`);
          } catch (e) {
            err(`axion-guard: warning: image retention failed: ${msg(e)}`);
          }
          if (result.outcome === 'needs_owner') {
            out(`needs the owner's approval: protected paths changed: ${(result.hits ?? []).join(', ')}`);
            out(`to approve: axion-guard deploy ${target} --approve ${target} --approve-base ${result.base ?? ''}`);
            return 3;
          }
          if (result.outcome !== 'live') {
            out(`${result.outcome} at ${result.failedStep ?? '?'}: ${result.reason ?? ''}`);
            return 1;
          }
          out(`live: ${target} (${result.image ?? ''}) in ${cfg.prefix}-${now?.active ?? other(active)}${result.reason ? `; ${result.reason}` : ''}`);
          return 0;
        });
      }
    }
  } catch (e) {
    if (e instanceof Busy) { err(`axion-guard: busy: ${e.message}`); return 4; }
    err(`axion-guard: ${msg(e)}`);
    return 1;
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
    (e: unknown) => { process.stderr.write(`axion-guard: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exitCode = 1; },
  );
}
