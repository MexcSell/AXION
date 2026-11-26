// The Guard's deploy run: the pure core. Every side effect goes through `Effects` (real adapters: Task 6), except
// state.json, which is written here through state.ts (atomic tmp + rename) so the order "state before/after switch" is
// owned by the core.
//
// lock → classify → base → build → checks → boot → backup → migrate → start → smoke → drain → switch → watch → record
//
// - A protected hit needs an approval bound to exactly this commit AND this base (approvedSha === sha and
//   approvedBase === the live sha), else `needs_owner` (with `hits` and `base`). If either moves, the approval is void.
// - Any failure before the switch → `rejected`; the live slot is never stopped or switched; a started candidate is stopped.
// - Any failure from the switch on (switch, watch, record before advance returned) → switch back to the previous slot,
//   stop the candidate, `rolled_back`. If the switch back itself fails, deploy throws and state.json keeps `deploying`
//   for `axion-guard rollback`. If only stopping the candidate fails, it is still `rolled_back` (the error is in `reason`).
// - `advance(sha)` (evolve/main) happens only after the watch passed; once it returned, nothing rolls back.
// - The old slot is never stopped by the core: `switchTo(slot)` owns "target serves, the other is retired", and a
//   `switchTo(previous)` during rollback must bring the previous slot back.
// - First deploy (state.json missing or activeImage null = nothing live through the Guard): `drain` is skipped (no old
//   slot) and a rollback has nothing to switch back to: it only stops the candidate, so the front is left pointing at a
//   stopped slot (502) until the next deploy. Acceptable because on a first deploy the site is not yet served by the front.
//
// state.json during a deploy (`deploying.step` is the step in progress; `active` names the slot state.json considers live):
//   lock … drain   active = old slot, untouched. (lock writes nothing.)
//   switch         active = old slot; the proxy may already point at either slot (switchTo may be half done).
//   watch          active = candidate (written right after switchTo returned), previous* = the old slot.
//   record         same as watch; advance(sha) runs while this is on disk, then `deploying` is cleared.
//
// `axion-guard rollback` (Task 6) must do, by `deploying.step` (no `deploying` → "nothing to do"):
//   lock … drain   stopSlot(other(active)) (idempotent); clear `deploying`.
//   switch         if activeImage !== null: switchTo(active), then stopSlot(other(active)); else stopSlot(other(active)).
//                  Clear `deploying`; active* unchanged.
//   watch          if previousImage !== null: switchTo(other(active)); then stopSlot(active). Write active = other(active),
//                  activeImage = previousImage, activeSha = previousSha, previousImage = previousSha = null, no `deploying`.
//   record         if liveSha() === deploying.sha (advance happened): only clear `deploying`. Otherwise as for `watch`.

import { classify, touches } from './classify.ts';
import type { ChangeStatus } from './classify.ts';
import { readState, writeState, STEPS } from './state.ts';
import type { GuardState, Slot, Step } from './state.ts';

export { STEPS };
export type { Step, Slot, GuardState, ChangeStatus };

export class Busy extends Error {
  constructor(message = 'a deploy is already running') {
    super(message);
    this.name = 'Busy';
  }
}

export type Change = { path: string; status: ChangeStatus; oldPath?: string };
export type Outcome = 'live' | 'rejected' | 'rolled_back' | 'needs_owner';

/** One line of evolve history: a step's start/end, or the deploy's outcome (event 'outcome'). */
export type HistoryEntry = {
  at: string;
  sha: string;
  step: Step;
  event: 'start' | 'end' | 'outcome';
  ok?: boolean;
  detail?: string;
  outcome?: Outcome;
  failedStep?: Step;
  reason?: string;
  image?: string;
  hits?: string[];
  base?: string;
};

export interface Effects {
  /** Acquire the single deploy lock; throws `Busy` when held; returns the release function. */
  lock(): Promise<() => Promise<void>>;
  /**
   * The commit that is live: the head of `evolve/main` in the Guard's repository (full 40-char lowercase sha).
   * Must equal state.json `activeSha` whenever something is live (the base step refuses otherwise).
   */
  liveSha(): Promise<string>;
  /**
   * Changed paths from `base` to `sha`, e.g. `git diff --name-status -z -M <base> <sha>`.
   * Paths are repo-relative, NUL-separated (`-z`, so never C-quoted), no leading `./` or `/`.
   * Renames are reported as status R with `oldPath`; any other status (C, T, U, X…) may be passed through as is:
   * classify treats every non-A status as a modification and any non-canonical path as a protected hit (fail closed).
   */
  diff(base: string, sha: string): Promise<Change[]>;
  /** true when commit `a` is an ancestor of (or equal to) commit `b`. */
  isAncestor(a: string, b: string): Promise<boolean>;
  /** Builds the app image for `sha` with the Guard's trusted Dockerfiles (R7); returns the image tag `<sha12>-<utc>`. */
  build(sha: string): Promise<string>;
  /** Runs the checks in no-network containers with the Guard's trusted scripts (R7). `passed` = integer test count. */
  checks(image: string): Promise<{ ok: boolean; passed: number; log: string }>;
  /** Starts the image with no network and empty data; true when /api/v1/health answered. */
  bootOffline(image: string): Promise<boolean>;
  /** Backs up the live DB (and data dir); returns the backup path. */
  backup(): Promise<string>;
  /** Runs the image's migrations against the live DB (only ever called for approved changes). */
  migrate(image: string): Promise<void>;
  /** Starts `image` in `slot` (replacing whatever stopped container was there), on the live DB, without the leader lock. */
  startSlot(slot: Slot, image: string): Promise<void>;
  /** Smoke checks against `slot`; `commit` = the full sha the slot's /api/v1/health reports (null if none). */
  smoke(slot: Slot): Promise<{ ok: boolean; commit: string | null }>;
  /** Bounded wait for in-flight requests/answers on the live `slot`. Must only wait (never stop it); no-op for a missing slot. */
  drain(slot: Slot): Promise<void>;
  /**
   * Routes the front to `slot`. Owns the slot lifecycle: if `slot` is stopped it is started again (restart policy back
   * to unless-stopped) and must be healthy before routing; afterwards the other slot is retired (`docker update
   * --restart no` + `docker stop`). Idempotent: switching to the slot already served is safe.
   */
  switchTo(slot: Slot): Promise<void>;
  /** Stops `slot` (restart policy no). Idempotent: a stopped or missing slot is not an error. */
  stopSlot(slot: Slot): Promise<void>;
  /** Watches `slot` through the front for `ms`; ok=false with a reason on failure. */
  watch(slot: Slot, ms: number): Promise<{ ok: boolean; reason?: string }>;
  /** Appends one history line (evolve history.jsonl). */
  record(entry: HistoryEntry): Promise<void>;
  /** Moves `evolve/main` to `sha` (a fast-forward: `sha` contains the live commit). */
  advance(sha: string): Promise<void>;
}

export type DeployRequest = {
  /** full 40-char lowercase commit sha (never a ref name) */
  sha: string;
  /** owner approval: counts only when approvedSha === sha AND approvedBase === the live sha */
  approvedSha?: string;
  approvedBase?: string;
  /** positive integer */
  watchMs: number;
  /** non-negative integer: the checks' passed count may not drop below it */
  baselinePassed: number;
  active: Slot;
  /** directory holding state.json (/srv/axion-evolve) */
  stateDir: string;
  /** protected-path rules, parsed from the Guard's own installed protected.txt (never the candidate's) */
  rules: string[];
};

export type DeployResult = {
  outcome: Outcome;
  failedStep?: Step;
  reason?: string;
  image?: string;
  /** needs_owner: the protected paths hit */
  hits?: string[];
  /** needs_owner: the live sha the approval must be bound to (approvedBase) */
  base?: string;
};

const MIGRATIONS = 'server/migrations/**';
const SHA_RE = /^[0-9a-f]{40}$/;

class StepFailed extends Error {
  step: Step;
  constructor(step: Step, reason: string) {
    super(reason);
    this.step = step;
  }
}

/** a business failure inside a step body (the step wrapper attaches the step name) */
class Fail extends Error {}
const fail = (reason: string): never => { throw new Fail(reason); };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const other = (s: Slot): Slot => (s === 'blue' ? 'green' : 'blue');
const now = () => new Date().toISOString();
const tail = (s: unknown, n = 600) => {
  const t = String(s ?? '');
  return t.length > n ? `…${t.slice(-n)}` : t;
};
const isSha = (v: unknown): v is string => typeof v === 'string' && SHA_RE.test(v);

function withoutDeploying(s: GuardState): GuardState {
  const { deploying: _d, ...rest } = s;
  return rest as GuardState;
}

function compact<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

/** Problems with the request itself; empty when it is well-formed. */
export function requestProblems(req: DeployRequest): string[] {
  const p: string[] = [];
  const r = req as Record<string, unknown>;
  if (!isSha(r.sha)) p.push(`sha must be a full 40-char lowercase commit sha, got ${JSON.stringify(r.sha)}`);
  for (const k of ['approvedSha', 'approvedBase']) {
    if (r[k] !== undefined && !isSha(r[k])) p.push(`${k} must be a full 40-char lowercase commit sha, got ${JSON.stringify(r[k])}`);
  }
  if (r.active !== 'blue' && r.active !== 'green') p.push(`active must be blue or green, got ${JSON.stringify(r.active)}`);
  if (!Number.isInteger(r.watchMs) || (r.watchMs as number) <= 0) p.push(`watchMs must be a positive integer, got ${String(r.watchMs)}`);
  if (!Number.isInteger(r.baselinePassed) || (r.baselinePassed as number) < 0) {
    p.push(`baselinePassed must be a non-negative integer, got ${String(r.baselinePassed)}`);
  }
  if (typeof r.stateDir !== 'string' || r.stateDir === '') p.push('stateDir must be a non-empty string');
  if (!Array.isArray(r.rules) || !r.rules.every((x) => typeof x === 'string')) p.push('rules must be a list of strings');
  return p;
}

export async function deploy(fx: Effects, req: DeployRequest): Promise<DeployResult> {
  // Acquire first: when the lock is held, Busy propagates and no other effect (not even record) is called.
  const release = await fx.lock();
  try {
    // A malformed request fails closed before any other effect: no record, no state write.
    const problems = requestProblems(req);
    if (problems.length > 0) return { outcome: 'rejected', failedStep: 'lock', reason: `invalid request: ${problems.join('; ')}` };
    return await run(fx, req);
  } finally {
    await release();
  }
}

async function run(fx: Effects, req: DeployRequest): Promise<DeployResult> {
  const { sha } = req;
  const active = req.active;
  const idle = other(active);
  const startedAt = now();
  const log = (e: Omit<HistoryEntry, 'at' | 'sha'>) => fx.record(compact({ at: now(), sha, ...e }));

  let before: GuardState | null = null; // state as found (no deploying); restored on rejected/rolled_back
  let current: GuardState | null = null; // what state.json holds now (set only after a successful write)
  let image: string | undefined;
  let started = false; // candidate slot start was attempted
  let switched = false; // switchTo(candidate) was attempted
  let advanced = false; // evolve/main moved: past the point of no return, nothing may roll back any more

  const save = async (s: GuardState) => {
    await writeState(req.stateDir, s);
    current = s;
  };

  const step = async <T>(name: Step, body: () => Promise<T>, detail?: (v: T) => string | undefined): Promise<T> => {
    try {
      if (current) await save({ ...current, deploying: { sha, step: name, startedAt } });
      await log({ step: name, event: 'start' });
      const v = await body();
      await log({ step: name, event: 'end', ok: true, detail: detail?.(v) });
      return v;
    } catch (e) {
      const reason = e instanceof Fail ? e.message : `${name}: ${msg(e)}`;
      try { await log({ step: name, event: 'end', ok: false, detail: reason }); } catch { /* reported via the outcome */ }
      throw new StepFailed(name, reason);
    }
  };

  let result: DeployResult;
  try {
    await step('lock', async () => {
      const found = await readState(req.stateDir);
      if (found?.deploying) {
        fail(`state.json shows an unfinished deploy of ${found.deploying.sha} (step ${found.deploying.step}); `
          + 'run `axion-guard rollback` first');
      }
      if (found && found.activeImage !== null && found.active !== active) {
        fail(`state.json says the active slot is ${found.active}, the request says ${active}`);
      }
      before = found && found.activeImage !== null
        ? found
        : { ...(found ?? { activeImage: null, activeSha: null, previousImage: null, previousSha: null }), active };
      current = before;
    });
    const base = before as unknown as GuardState;
    const hadLive = base.activeImage !== null;

    const { live, changes, hits } = await step('classify', async () => {
      const live = await fx.liveSha();
      if (!isSha(live)) fail(`liveSha() returned ${JSON.stringify(live)}, not a full commit sha`);
      const changes = await fx.diff(live, sha);
      return { live, changes, hits: classify(changes, req.rules).hits };
    }, (v) => (v.hits.length ? `protected: ${v.hits.join(', ')}` : `${v.changes.length} changed paths, none protected`));

    // the owner's approval is bound to this commit on this base; if either moved, it is void
    const approved = req.approvedSha === sha && req.approvedBase === live;
    if (hits.length > 0 && !approved) {
      result = {
        outcome: 'needs_owner', hits, base: live,
        reason: `protected paths changed (${hits.join(', ')}); needs the owner's approval of commit ${sha} on base ${live}`,
      };
      await save(withoutDeploying(base));
    } else {
      await step('base', async () => {
        if (base.activeSha !== null && base.activeSha !== live) {
          fail(`live commit ${live} differs from state.json activeSha ${base.activeSha}`);
        }
        if ((await fx.isAncestor(live, sha)) !== true) fail(`${sha} does not contain the live commit ${live}`);
      });
      const img = await step('build', () => fx.build(sha), (v) => v);
      image = img;
      await step('checks', async () => {
        const r = await fx.checks(img);
        if (r?.ok !== true) fail(`checks failed: ${tail(r?.log)}`);
        if (!Number.isInteger(r.passed)) fail(`checks reported no valid passed-test count (${String(r.passed)})`);
        if (r.passed < req.baselinePassed) fail(`passed tests ${r.passed} below the baseline ${req.baselinePassed}`);
        return r;
      }, (r) => `passed ${r.passed} (baseline ${req.baselinePassed})`);
      await step('boot', async () => {
        if ((await fx.bootOffline(img)) !== true) fail('offline boot failed (no healthy /api/v1/health without network)');
      });
      await step('backup', () => fx.backup(), (v) => v);
      await step('migrate', async () => {
        const has = touches(changes, MIGRATIONS);
        if (!has) return 'skipped: no migrations in the diff';
        if (!approved) return 'skipped: not approved';
        await fx.migrate(img);
        return 'ran';
      }, (v) => v);
      await step('start', async () => {
        started = true;
        await fx.startSlot(idle, img);
      });
      await step('smoke', async () => {
        const s = await fx.smoke(idle);
        if (s?.ok !== true) fail('smoke checks failed');
        if (s.commit !== sha) fail(`candidate reports commit ${s.commit ?? 'none'}, expected ${sha}`);
      });
      await step('drain', async () => {
        if (!hadLive) return 'skipped: nothing live (first deploy)';
        await fx.drain(active);
        return undefined;
      }, (v) => v);
      await step('switch', async () => {
        switched = true;
        await fx.switchTo(idle);
        // from here state.json names the candidate as active; the step shown is the next one (watch)
        await save({
          ...base, active: idle, activeImage: img, activeSha: sha, previousImage: base.activeImage, previousSha: base.activeSha,
          deploying: { sha, step: 'watch', startedAt },
        });
      });
      await step('watch', async () => {
        const w = await fx.watch(idle, req.watchMs);
        if (w?.ok !== true) fail(`watch failed: ${w?.reason ?? 'no reason given'}`);
      });
      await step('record', async () => {
        // `deploying: {step:'record'}` stays on disk while advance runs: a Guard killed here is resolved by
        // `axion-guard rollback` comparing liveSha() with deploying.sha.
        await fx.advance(sha);
        advanced = true;
        await save(withoutDeploying(current as GuardState));
      });
      result = { outcome: 'live', image: img };
    }
  } catch (e) {
    if (!(e instanceof StepFailed)) throw e;
    // a failure after advance (e.g. clearing `deploying`, recording the record step's end) must not switch back:
    // live == evolve/main now
    result = advanced
      ? { outcome: 'live', image, reason: `live, but after advance: ${e.message}${clearedNote()}` }
      : await undo(e);
  }

  await log({
    step: 'record', event: 'outcome', outcome: result.outcome, failedStep: result.failedStep, reason: result.reason,
    image: result.image, hits: result.hits, base: result.base,
  });
  return result;

  function clearedNote(): string {
    const d = (current as GuardState | null)?.deploying;
    return d ? `; state.json still shows deploying step ${d.step} (\`axion-guard rollback\` sees evolve/main at ${sha} and only clears it)` : '';
  }

  async function undo(f: StepFailed): Promise<DeployResult> {
    const prev = before as GuardState | null;
    if (!switched) {
      let reason = f.message;
      if (started) {
        try { await fx.stopSlot(idle); } catch (e) { reason += `; stopping candidate ${idle} failed: ${msg(e)}`; }
      }
      if (prev && current) await save(withoutDeploying(prev));
      return compact<DeployResult>({ outcome: 'rejected', failedStep: f.step, reason, image });
    }
    // From the switch on: back to the previous slot (if there was one), then retire the candidate.
    let reason = f.message;
    if (prev!.activeImage !== null) {
      try {
        await fx.switchTo(active);
      } catch (e) {
        const d = (current as GuardState | null)?.deploying;
        const kept = d
          ? `state.json keeps deploying step ${d.step} (active ${(current as GuardState).active}) for \`axion-guard rollback\``
          : 'state.json has no deploying marker';
        const why = `rollback failed: switching back to ${active} failed: ${msg(e)} (after ${f.step} failed: ${f.message}); ${kept}`;
        try {
          await log({ step: f.step, event: 'outcome', ok: false, failedStep: f.step, reason: why, image });
        } catch { /* the throw below carries it */ }
        throw new Error(why);
      }
    }
    try {
      await fx.stopSlot(idle);
    } catch (e) {
      const back = prev!.activeImage !== null ? `switched back to ${active}, but ` : 'nothing to switch back to; ';
      reason += `; ${back}stopping candidate ${idle} failed: ${msg(e)}`;
    }
    await save(withoutDeploying(prev!));
    return compact<DeployResult>({ outcome: 'rolled_back', failedStep: f.step, reason, image });
  }
}
