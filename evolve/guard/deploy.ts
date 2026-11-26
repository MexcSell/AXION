// The Guard's deploy run: the pure core. Every side effect goes through `Effects` (real adapters: Task 6), except
// state.json, which is written here through state.ts (atomic tmp + rename) so the order "state before/after switch" is
// owned by the core.
//
// lock → classify → base → build → checks → boot → backup → migrate → start → smoke → drain → switch → watch → record
//
// - A protected hit needs an approval bound to exactly this commit (approvedSha === sha), else `needs_owner`.
// - Any failure before the switch → `rejected`; the live slot is never stopped or switched; a started candidate is stopped.
// - Any failure from the switch on (switch, watch, record/advance) → switch back to the previous slot, stop the candidate,
//   `rolled_back`. If the switch back itself fails, deploy throws and state.json keeps `deploying` for `axion-guard rollback`.
// - `advance(sha)` (evolve/main) happens only after the watch passed.
// - The old slot is never stopped by the core: `switchTo(slot)` owns "target serves, the other is retired", and a
//   `switchTo(previous)` during rollback must bring the previous slot back.

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

/** One line of evolve history: a step's start/end, or the deploy's outcome (event 'outcome', step 'record'). */
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
};

export interface Effects {
  /** acquire the single deploy lock; throws Busy when held; returns the release function */
  lock(): Promise<() => Promise<void>>;
  liveSha(): Promise<string>;
  diff(base: string, sha: string): Promise<Change[]>;
  isAncestor(a: string, b: string): Promise<boolean>;
  /** returns the image tag `<sha12>-<utc>` */
  build(sha: string): Promise<string>;
  checks(image: string): Promise<{ ok: boolean; passed: number; log: string }>;
  bootOffline(image: string): Promise<boolean>;
  backup(): Promise<string>;
  migrate(image: string): Promise<void>;
  startSlot(slot: Slot, image: string): Promise<void>;
  smoke(slot: Slot): Promise<{ ok: boolean; commit: string | null }>;
  drain(slot: Slot): Promise<void>;
  switchTo(slot: Slot): Promise<void>;
  stopSlot(slot: Slot): Promise<void>;
  watch(slot: Slot, ms: number): Promise<{ ok: boolean; reason?: string }>;
  record(entry: HistoryEntry): Promise<void>;
  advance(sha: string): Promise<void>;
}

export type DeployRequest = {
  sha: string;
  approvedSha?: string;
  watchMs: number;
  baselinePassed: number;
  active: Slot;
  /** directory holding state.json (/srv/axion-evolve) */
  stateDir: string;
  /** protected-path rules, parsed from the Guard's own installed protected.txt (never the candidate's) */
  rules: string[];
};

export type DeployResult = { outcome: Outcome; failedStep?: Step; reason?: string; image?: string; hits?: string[] };

const MIGRATIONS = 'server/migrations/**';

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
const tail = (s: string, n = 600) => (s.length > n ? `…${s.slice(-n)}` : s);

function withoutDeploying(s: GuardState): GuardState {
  const { deploying: _d, ...rest } = s;
  return rest as GuardState;
}

function compact<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

export async function deploy(fx: Effects, req: DeployRequest): Promise<DeployResult> {
  // Acquire first: when the lock is held, Busy propagates and no other effect (not even record) is called.
  const release = await fx.lock();
  try {
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
  let current: GuardState | null = null; // what state.json holds now
  let image: string | undefined;
  let started = false; // candidate slot start was attempted
  let switched = false; // switchTo(candidate) was attempted
  let advanced = false; // evolve/main moved: past the point of no return, nothing may roll back any more

  const save = async (s: GuardState) => {
    current = s;
    await writeState(req.stateDir, s);
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
      before = found ?? { active, activeImage: null, activeSha: null, previousImage: null, previousSha: null };
      if (found === null || found.activeImage === null) before = { ...before, active };
      current = before;
    });
    const base = before as unknown as GuardState;

    const { live, changes, hits } = await step('classify', async () => {
      const live = await fx.liveSha();
      const changes = await fx.diff(live, sha);
      return { live, changes, hits: classify(changes, req.rules).hits };
    }, (v) => (v.hits.length ? `protected: ${v.hits.join(', ')}` : `${v.changes.length} changed paths, none protected`));

    const approved = req.approvedSha === sha;
    if (hits.length > 0 && !approved) {
      result = {
        outcome: 'needs_owner', hits,
        reason: `protected paths changed (${hits.join(', ')}); needs the owner's approval of commit ${sha}`,
      };
      await save(withoutDeploying(base));
    } else {
      await step('base', async () => {
        if (base.activeSha !== null && base.activeSha !== live) {
          fail(`live commit ${live} differs from state.json activeSha ${base.activeSha}`);
        }
        if (!(await fx.isAncestor(live, sha))) fail(`${sha} does not contain the live commit ${live}`);
      });
      const img = await step('build', () => fx.build(sha), (v) => v);
      image = img;
      await step('checks', async () => {
        const r = await fx.checks(img);
        if (!r.ok) fail(`checks failed: ${tail(r.log)}`);
        if (r.passed < req.baselinePassed) fail(`passed tests ${r.passed} below the baseline ${req.baselinePassed}`);
        return r;
      }, (r) => `passed ${r.passed} (baseline ${req.baselinePassed})`);
      await step('boot', async () => {
        if (!(await fx.bootOffline(img))) fail('offline boot failed (no healthy /api/v1/health without network)');
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
        if (!s.ok) fail('smoke checks failed');
        if (s.commit !== sha) fail(`candidate reports commit ${s.commit ?? 'none'}, expected ${sha}`);
      });
      await step('drain', () => fx.drain(active));
      await step('switch', async () => {
        switched = true;
        await fx.switchTo(idle);
        await save({
          ...base, active: idle, activeImage: img, activeSha: sha, previousImage: base.activeImage, previousSha: base.activeSha,
          deploying: { sha, step: 'switch', startedAt },
        });
      });
      await step('watch', async () => {
        const w = await fx.watch(idle, req.watchMs);
        if (!w.ok) fail(`watch failed: ${w.reason ?? 'no reason given'}`);
      });
      await step('record', async () => {
        // state first: if the Guard dies between the two, the next deploy's base check sees evolve/main != activeSha
        await save(withoutDeploying(current as GuardState));
        await fx.advance(sha);
        advanced = true;
      });
      result = { outcome: 'live', image: img };
    }
  } catch (e) {
    if (!(e instanceof StepFailed)) throw e;
    // a failure after advance (e.g. recording the record step's end) must not switch back: live == evolve/main now
    result = advanced ? { outcome: 'live', image, reason: `live, but after advance: ${e.message}` } : await undo(e);
  }

  await log({
    step: 'record', event: 'outcome', outcome: result.outcome, failedStep: result.failedStep, reason: result.reason,
    image: result.image, hits: result.hits,
  });
  return result;

  async function undo(f: StepFailed): Promise<DeployResult> {
    const base = before as GuardState | null;
    if (!switched) {
      let reason = f.message;
      if (started) {
        try { await fx.stopSlot(idle); } catch (e) { reason += `; stopping candidate ${idle} failed: ${msg(e)}`; }
      }
      if (base && current) await save(withoutDeploying(base));
      return compact<DeployResult>({ outcome: 'rejected', failedStep: f.step, reason, image });
    }
    // From the switch on: back to the previous slot, then retire the candidate.
    try {
      if (base!.activeImage !== null) await fx.switchTo(active);
      await fx.stopSlot(idle);
    } catch (e) {
      const why = `rollback failed: ${msg(e)} (after ${f.step} failed: ${f.message}); state.json keeps the unfinished deploy`;
      try {
        await log({ step: f.step, event: 'outcome', ok: false, failedStep: f.step, reason: why, image });
      } catch { /* the throw below carries it */ }
      throw new Error(why);
    }
    await save(withoutDeploying(base!));
    return compact<DeployResult>({ outcome: 'rolled_back', failedStep: f.step, reason: f.message, image });
  }
}
