// The runner loop (evolution step 2): one owner request (an `improve` mission) becomes one change, end to end. Pure: every
// effect (mission CLI, git, Workshop, typecheck, Guard, files, clock) comes in through RunnerEffects (effects.ts).
//
// One change, under the runner lock (R24; held for the whole change):
//   kill switches → claim (`next`) → for attempt 1..3:
//     export evolve/main (one sha per attempt) → engineer (web-dev-01, Workshop) → commit built by the runner (parent = that
//     sha) → no diff ⇒ failed "no change" → [once --inject-failure only: the failure commit on top] → gates on the whole
//     diff: secret ⇒ failed, the scratch objects and tree deleted, nothing shown; protected or flags ⇒ needs_owner (commit
//     held at incoming/evolve-<id>-a<n>, the approve command in the mission) → typecheck (fail ⇒ next attempt, the errors
//     as feedback) → reviewer (tester-01; not ok ⇒ next attempt, the concerns as feedback) → push incoming/evolve-<id>-a<n>
//     → `axion-guard deploy` (release-01 mirrors its steps; busy ⇒ wait 60 s, retry, max 30 min) → live ⇒ completed;
//     rejected at build/checks ⇒ next attempt with the reason; rolled_back ⇒ failed (2 in a row ⇒ PAUSED); other ⇒ failed.
//     An engineer run that times out, errors or gives no report ⇒ the next attempt with the reason (R29); a container that
//     could not be confirmed gone ⇒ the change stops.
// After the Guard answered, its real outcome goes to runner-history FIRST, then the mission's finish; a finish that throws
// leaves an `unsettled` line, so the next start settles the mission from the Guard's history (never a second, other finish).
// `once --inject-failure` (Claude Code's exit demo): the injected commit is never held for approval (a hit or a Guard
// exit 3 ends the change failed, and approve refuses an injected entry), and if it ever goes live that is an alarm: the
// mission fails, PAUSED is written, the remedy (axion-guard revert) is logged.
// Kill switches (PAUSED, a run halt, a stopping runner) are checked before every step; a tripped one ends the change
// `failed` with the reason. A refused mission write (the mission left `running`: paused, canceled) stops the change at
// once and is never retried; the runner-history keeps the truth. Every text that reaches the mission is redacted with every
// form of every secret, and nothing the engineer produced (report, file names, diffstat) is shown before the gates pass.

import { gates, redactSecrets } from './gates.ts';
import type { Mission } from './prompts.ts';
import type { EngineerResult } from './workshop.ts';
import type { ClassifyInput } from '../guard/classify.ts';
import { AGENTS, CAPS, FEEDBACK_LINES, REF_PREFIX, TIMING } from './config.ts';

export type Refusal = { error: string; [k: string]: unknown };
export type WriteResult = { ok: true } | { ok: false; refusal: Refusal };
type Guard = { outcome: string; failedStep?: string; reason?: string };
/** what `progress` accepts in `evolve` (Task 2: never an end state; a retried attempt is working/checking + guard) */
export type EvolvePatch = {
  state?: 'claimed' | 'working' | 'checking' | 'deploying';
  attempt?: number; commit?: string; base?: string; filesChanged?: string[]; diffStat?: string; checks?: string;
  guard?: Guard; report?: string; hits?: string[];
};
export type FinishEvolve = Omit<EvolvePatch, 'state'> & { state?: 'rejected' | 'rolled_back' | 'failed' };
export type ProgressBody = { by: string; text: string; evolve: EvolvePatch };
export type FinishBody = { outcome: 'completed' | 'failed' | 'needs_owner'; text: string; evolve: FinishEvolve };

/** server/src/cli/evolve-missions.ts through the live image (effects.ts). Exit 1 refusals come back as { ok: false }. */
export interface MissionCli {
  /** any failure of the check itself counts as halted (fail closed) */
  halted(): Promise<{ halted: boolean; reason?: string }>;
  recover(): Promise<string[]>;
  next(): Promise<Mission | null>;
  progress(id: string, body: ProgressBody): Promise<WriteResult>;
  finish(id: string, body: FinishBody): Promise<WriteResult>;
  approved(id: string): Promise<WriteResult>;
}

/** one line of runner-history.jsonl: outcomes and pointers only, never a diff, a report or a secret */
export type HistoryEntry = {
  at: string;
  /** retry: the Guard rejected an attempt at build/checks and the change goes on (closes that attempt's deploy line);
   *  unsettled: the Guard answered and the end line was written, but the mission's finish threw: reopens the deploy for
   *  the next start's reconcile (`since` = when that deploy started) */
  event: 'claim' | 'deploy' | 'retry' | 'held' | 'end' | 'unsettled' | 'pause' | 'resume' | 'note';
  mission?: string; attempt?: number; commit?: string; base?: string; ref?: string;
  outcome?: string; reason?: string; injected?: boolean; by?: string; since?: string;
};
export type GuardStep = { step: string; event: 'start' | 'end'; ok?: boolean; detail?: string };
export type GuardResult = { outcome: string; failedStep?: string; reason?: string; image?: string; hits?: string[]; base?: string };
/**
 * `axion-guard deploy`: exit 0 live, 1 rejected/rolled back/error, 2 usage, 3 needs owner, 4 busy. `result` is the first JSON
 * line of its stdout: display only (a candidate's test output can reach the Guard's output). `recorded` is the Guard's own
 * history.jsonl outcome for this sha since this deploy started (deployMirrored fills it): with the exit code, the authority.
 */
export type DeployAnswer = { code: number; result: GuardResult | null; stderr: string; recorded?: GuardResult | null };
export type Diff = { text: string; files: ClassifyInput[]; stat: string };

export interface RunnerEffects {
  missions: MissionCli;
  /** the values of secrets/*.env (≥ 12 characters), read now; empty = refuse to work */
  secrets(): Promise<string[]>;
  /** the PAUSED file's text, or null */
  paused(): Promise<string | null>;
  writePaused(reason: string): Promise<void>;
  clearPaused(): Promise<boolean>;
  readHistory(): Promise<HistoryEntry[]>;
  appendHistory(e: Omit<HistoryEntry, 'at'>): Promise<void>;
  /** the runner lock (R24); null = another runner process (an approve) holds it */
  lock(): Promise<(() => Promise<void>) | null>;
  /** at start, under the lock: leftovers of a killed runner (containers, change trees) */
  sweep(): Promise<string[]>;
  /** removes the runner's Workshop and typecheck containers now (never the Guard); on a stop signal and ExecStopPost */
  killWorkers(): Promise<string[]>;
  /** this process holds runner.lock now (its stop handler removes the Workshop containers only then: they are its own) */
  holdsLock(): boolean;
  /** evolve/main in the Guard's repository */
  liveSha(): Promise<string>;
  /** `git archive <base>` into <changeDir>/tree, owned by uid 1000; returns changeDir */
  exportTree(id: string, attempt: number, base: string): Promise<string>;
  engineer(o: { changeDir: string; mission: Mission; attempt: number; feedback?: string }): Promise<EngineerResult>;
  /** the tree as a commit on `parent` (scratch objects, hooks off); null when the tree equals the parent's */
  commit(o: { changeDir: string; parent: string; message: string }): Promise<string | null>;
  /** `once --inject-failure` only: a commit on `parent` that fails the Guard's watch */
  injectFailure(o: { changeDir: string; parent: string }): Promise<string>;
  diff(changeDir: string, base: string, sha: string): Promise<Diff>;
  /** after the secret gate passed: the scratch objects into the Guard's repository */
  importObjects(changeDir: string, base: string, sha: string): Promise<void>;
  typecheck(o: { changeDir: string; sha: string; name: string }): Promise<{ ok: boolean; log: string }>;
  reviewer(o: { mission: Mission; diff: string; attempt: number }): Promise<{ ok: boolean; concerns: string[] }>;
  resolveRef(ref: string): Promise<string | null>;
  setRef(ref: string, sha: string): Promise<void>;
  deleteRef(ref: string): Promise<void>;
  removeChange(id: string): Promise<void>;
  /** runs the Guard; `onStep` gets its history.jsonl step lines for `sha` while it runs */
  deploy(o: { ref: string; sha: string; approve?: { sha: string; base: string } }, onStep: (s: GuardStep) => void): Promise<DeployAnswer>;
  /** the Guard's recorded outcome for `sha` (history.jsonl, at or after `since`), or null */
  guardOutcome(sha: string, since?: string): Promise<GuardResult | null>;
  /** a live axion-guard holds the Guard lock */
  guardBusy(): Promise<boolean>;
  now(): number;
  sleep(ms: number): Promise<void>;
  log(msg: string): void;
  /** SIGTERM/SIGINT seen */
  stopping(): boolean;
}

export type ChangeOutcome = {
  mission: string;
  /** inject_live: the injected failure went live (an alarm, never a success) */
  outcome: 'live' | 'needs_owner' | 'rejected' | 'rolled_back' | 'failed' | 'stopped' | 'gone' | 'error' | 'inject_live';
  attempt: number; commit?: string; reason: string;
};
export type TickResult =
  | { kind: 'busy' } | { kind: 'paused'; reason: string } | { kind: 'halted'; reason: string }
  | { kind: 'cap'; count: number } | { kind: 'idle' } | { kind: 'change'; outcome: ChangeOutcome };

class Stop extends Error {}
/** startup could not settle a deploy (the Guard still runs after the reconcile cap): neither reconcile nor recover now */
export class StillDeploying extends Error {}
class Gone extends Error {
  refusal: Refusal;
  constructor(r: Refusal) { super(`mission write refused: ${r.error}`); this.refusal = r; }
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,40}$/;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const short = (sha: string) => sha.slice(0, 12);
export const refName = (id: string, attempt: number) => `${REF_PREFIX}${id}-a${attempt}`;
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/** the mission CLI refuses NUL and lone surrogates (exit 2): replace them, never fail a write over a cut log */
export const storable = (s: string) => s.replace(/\u0000/g, '�').replace(LONE, '�');
export const lastLines = (s: string, n = FEEDBACK_LINES) => s.replace(/\s+$/, '').split('\n').slice(-n).join('\n');

/** UTC-day claims in the runner's own history (the day cap) */
export function claimsToday(h: HistoryEntry[], now: number): number {
  const day = new Date(now).toISOString().slice(0, 10);
  return h.filter((e) => e.event === 'claim' && typeof e.at === 'string' && e.at.slice(0, 10) === day).length;
}

/**
 * Consecutive rolled-back changes, newest first: counts change ends that went through a slot switch (live or rolled_back)
 * until a live one or a `resume`; ends that never reached the watch (failed, rejected, needs_owner, gone) are skipped.
 */
export function rollbackStreak(h: HistoryEntry[]): number {
  let n = 0;
  for (let i = h.length - 1; i >= 0; i--) {
    const e = h[i];
    if (e.event === 'resume') break;
    if (e.event !== 'end') continue;
    if (e.outcome === 'live') break;
    if (e.outcome === 'rolled_back') n++;
  }
  return n;
}

function deepRedact<T>(v: T, red: (s: string) => string): T {
  if (typeof v === 'string') return red(v) as T;
  if (Array.isArray(v)) return v.map((x) => deepRedact(x, red)) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepRedact(x, red)])) as T;
  return v;
}

/** the mission writes of one change, redacted; a refusal marks the mission gone (no write is ever retried) */
function writer(fx: RunnerEffects, id: string, secrets: string[]) {
  const red = (s: string) => storable(redactSecrets(s, secrets));
  const w = {
    gone: null as Refusal | null,
    red,
    async say(by: string, text: string, evolve: EvolvePatch): Promise<void> {
      if (w.gone) throw new Gone(w.gone);
      const r = await fx.missions.progress(id, { by, text: red(text), evolve: deepRedact(evolve, red) });
      if (!r.ok) {
        w.gone = r.refusal;
        fx.log(`${id}: progress refused (${r.refusal.error}); the change stops here`);
        throw new Gone(r.refusal);
      }
    },
    /** the end of the change; a refusal is logged (the history keeps the outcome) */
    async finish(outcome: FinishBody['outcome'], text: string, evolve: FinishEvolve): Promise<boolean> {
      if (w.gone) return false;
      const r = await fx.missions.finish(id, { outcome, text: red(text), evolve: deepRedact(evolve, red) });
      if (!r.ok) { w.gone = r.refusal; fx.log(`${id}: finish refused (${r.refusal.error})`); return false; }
      return true;
    },
  };
  return w;
}

async function stopReason(fx: RunnerEffects): Promise<string | null> {
  if (fx.stopping()) return 'the runner is stopping';
  const p = await fx.paused();
  if (p !== null) return `the runner is paused (PAUSED: ${p.trim().slice(0, 200)})`;
  const h = await fx.missions.halted();
  if (h.halted) return `a run halt is active (${h.reason ?? 'halted'})`;
  return null;
}

type DeployCtx = { fx: RunnerEffects; w: ReturnType<typeof writer>; id: string; attempt: number };

/** the Guard, with busy retries and its steps mirrored into the mission by release-01 */
async function deployMirrored(c: DeployCtx, o: { ref: string; sha: string; approve?: { sha: string; base: string } }): Promise<DeployAnswer> {
  const { fx, w } = c;
  const t0 = fx.now();
  const since = new Date(t0).toISOString();
  let chain: Promise<void> = Promise.resolve();
  const onStep = (s: GuardStep) => {
    const what = s.event === 'start' ? 'started' : s.ok === false ? 'failed' : 'passed';
    const text = `Guard: ${s.step} ${what}${s.detail ? `: ${s.detail}` : ''}`;
    chain = chain.then(() => w.say(AGENTS.release, text, { state: 'deploying', attempt: c.attempt })).catch(() => { /* gone: logged by say */ });
  };
  let saidBusy = false;
  for (;;) {
    const a = await fx.deploy(o, onStep);
    await chain;
    // the decision's authority: the Guard's own outcome record for this sha, written after this deploy started
    if (a.code !== 4) return { ...a, recorded: await fx.guardOutcome(o.sha, since).catch(() => null) };
    if (fx.now() - t0 + TIMING.busyWaitMs > TIMING.busyMaxMs) {
      return { code: 4, result: null, stderr: `the Guard stayed busy for ${Math.round(TIMING.busyMaxMs / 60_000)} min (another deploy held its lock)` };
    }
    if (!saidBusy && !w.gone) {
      await w.say(AGENTS.release, `The Guard is busy (another deploy holds its lock); trying again every ${TIMING.busyWaitMs / 1000} s for up to ${TIMING.busyMaxMs / 60_000} min.`, { state: 'deploying', attempt: c.attempt });
      saidBusy = true;
    }
    await fx.sleep(TIMING.busyWaitMs);
    const why = await stopReason(fx);
    if (why) throw new Stop(`${why} (while waiting for the busy Guard)`);
  }
}

const unclearText = (a: DeployAnswer) => `the Guard's outcome is unclear (exit ${a.code}, its history records ${a.recorded?.outcome ?? 'no outcome'} for this commit since the deploy started); treated as failed, never live`;
const guardText = (a: DeployAnswer) => {
  if (guardKind(a) === 'unclear') return `${unclearText(a)}: ${lastLines(a.stderr, 10)}`;
  const r = a.recorded ?? a.result;
  if (!r) return `the Guard gave no result (exit ${a.code}): ${lastLines(a.stderr, 10)}`;
  return `${r.outcome}${r.failedStep ? ` at ${r.failedStep}` : ''}${r.reason ? `: ${r.reason}` : ''}`;
};
/** display fields: the history record first, the stdout line only as a fallback; the outcome is the decided one */
const guardInfo = (a: DeployAnswer): Guard => {
  const k = guardKind(a);
  const r = a.recorded ?? a.result;
  return {
    outcome: k,
    ...(r?.failedStep ? { failedStep: r.failedStep } : {}),
    reason: (k === 'unclear' ? unclearText(a) : r?.reason ?? lastLines(a.stderr, 20)).slice(-3900),
  };
};


/**
 * The Guard's outcome: its exit code AND its own history.jsonl record (`recorded`) must agree. live only with exit 0 and a
 * live record; needs_owner only with exit 3; rejected/rolled_back only with exit 1. Anything else (a disagreement, no
 * record, an exit 2) is `unclear`, which is handled as failed and never as live. The stdout line never decides.
 */
function guardKind(a: DeployAnswer): 'live' | 'rolled_back' | 'rejected' | 'needs_owner' | 'busy' | 'unclear' {
  if (a.code === 4) return 'busy';
  const rec = a.recorded?.outcome;
  if (a.code === 0 && rec === 'live') return 'live';
  if (a.code === 3 && rec === 'needs_owner') return 'needs_owner';
  if (a.code === 1 && (rec === 'rejected' || rec === 'rolled_back')) return rec;
  return 'unclear';
}

const SECRET_TEXT = 'The change was refused before anything was pushed: it contained a secret value or a credential marker. '
  + 'The tree and the commit were deleted; nothing from it is shown.';

/** the text of the inject alarm (the injected failure went live) */
export const injectAlarmText = (sha: string, id: string) => `ALARM: the injected failure commit ${sha} of ${id} went LIVE: the Guard's watch `
  + 'did not roll it back, so evolve/main carries the 503 health hook of `axion-evolve once --inject-failure`. The runner paused itself. '
  + 'Remedy: axion-guard revert (back to the previous commit), check axion-guard status, then axion-evolve resume.';

async function raiseAlarm(fx: RunnerEffects, sha: string, id: string): Promise<void> {
  const t = injectAlarmText(sha, id);
  await fx.writePaused(t);
  await fx.appendHistory({ event: 'pause', mission: id, reason: t.slice(0, 300) });
  fx.log(t);
}

async function pauseOnStreak(fx: RunnerEffects, id: string): Promise<void> {
  if (rollbackStreak(await fx.readHistory()) < CAPS.rollbacksToPause) return;
  const why = `${CAPS.rollbacksToPause} consecutive changes were rolled back (last: ${id}); paused by the runner at ${new Date(fx.now()).toISOString()}. `
    + 'Remove with: axion-evolve resume';
  await fx.writePaused(why);
  await fx.appendHistory({ event: 'pause', reason: why });
  fx.log(why);
}

type Deployed = { ref: string; sha: string; base: string; since: string };

/** One claimed mission, start to end. Never throws (a runner error ends the mission `failed`, unless the Guard had answered). */
export async function runChange(fx: RunnerEffects, m: Mission, opts: { inject: boolean }): Promise<ChangeOutcome> {
  const secrets = await fx.secrets().catch(() => [] as string[]);
  const w = writer(fx, m.id, secrets);
  const red = w.red;
  let attempt = 1;
  let commit: string | undefined;
  let heldRef: string | null = null;
  /** the Guard gave this change its final answer: from here on nothing may finish the mission with another outcome */
  let answered = false;
  const pushed: string[] = [];
  const hist = (e: Omit<HistoryEntry, 'at'>) => fx.appendHistory({ mission: m.id, ...e, ...(opts.inject ? { injected: true } : {}) });
  /** the end line (the truth), then the pause rule */
  const done = async (o: ChangeOutcome): Promise<ChangeOutcome> => {
    const reason = red(o.reason).slice(0, 300);
    await hist({ event: 'end', attempt: o.attempt, outcome: o.outcome, ...(o.commit ? { commit: o.commit } : {}), reason });
    if (o.outcome === 'rolled_back') await pauseOnStreak(fx, m.id);
    return { ...o, reason };
  };
  /** the end line first, then the mission's finish; after a Guard answer a finish that throws leaves an `unsettled` line */
  const end = async (outcome: FinishBody['outcome'], kind: ChangeOutcome['outcome'], text: string, evolve: FinishEvolve, deployed?: Deployed): Promise<ChangeOutcome> => {
    const r = await done({ mission: m.id, outcome: kind, attempt, ...(evolve.commit ? { commit: evolve.commit } : {}), reason: text.split('\n')[0] });
    try {
      await w.finish(outcome, text, { attempt, ...evolve });
    } catch (e) {
      fx.log(`${m.id}: finish ${outcome} failed (${red(msg(e)).slice(0, 200)}); ${deployed ? 'the next start settles it from the Guard\'s history' : 'recover at the next start ends it'}`);
      if (deployed) await hist({ event: 'unsettled', attempt, ref: deployed.ref, commit: deployed.sha, base: deployed.base, since: deployed.since });
    }
    return r;
  };
  const checkpoint = async (before: string) => {
    const why = await stopReason(fx);
    if (why) throw new Stop(`Stopped before ${before}: ${why}.`);
  };

  try {
    if (secrets.length === 0) return await end('failed', 'error', 'The runner could not read its secrets (secrets/*.env); it refuses to work without redaction.', { state: 'failed' });
    let feedback: string | undefined;
    let lastRejected: { text: string; evolve: FinishEvolve } | null = null;
    for (attempt = 1; attempt <= CAPS.attempts; attempt++) {
      await checkpoint(`attempt ${attempt}`);
      const base = await fx.liveSha();
      await w.say(AGENTS.gm, attempt === 1
        ? `The GM handed the change to ${AGENTS.engineer} (attempt 1 of ${CAPS.attempts}, on evolve/main ${short(base)}).`
        : `Attempt ${attempt} of ${CAPS.attempts}: back to ${AGENTS.engineer} with the feedback (on evolve/main ${short(base)}).`,
      { state: 'working', attempt, base });
      const changeDir = await fx.exportTree(m.id, attempt, base);

      // ---- engineer (nothing it produced is shown before the gates) ----
      const eng = await fx.engineer({ changeDir, mission: m, attempt, ...(feedback !== undefined ? { feedback } : {}) });
      if (eng.containerAlive) {
        return await end('failed', 'failed', `The engineer's container could not be confirmed gone, so its tree was not used (nothing committed): ${eng.error ?? ''}`, { state: 'failed' });
      }
      if (!eng.ok) {
        // R29: a timeout, a CLI error or a missing report is retried within the attempt cap, with the reason as feedback
        const why = eng.timedOut
          ? `The engineer's run of attempt ${attempt} hit the ${Math.round(CAPS.engineerMs / 60_000)} min wall cap and was stopped; nothing was committed.`
          : `The engineer's run of attempt ${attempt} did not finish properly (${red(eng.error ?? 'no report')}); nothing was committed.`;
        feedback = `${why} Start again on a fresh tree: make a smaller, focused change and end your answer with the <report> block.`;
        lastRejected = { text: why, evolve: { state: 'failed' } };
        if (attempt < CAPS.attempts) { await w.say(AGENTS.gm, `${why} Back to ${AGENTS.engineer}.`, { state: 'working', attempt }); continue; }
        break;
      }
      await w.say(AGENTS.engineer, `${AGENTS.engineer} finished attempt ${attempt}; the runner builds the commit and runs the diff gates.`, { state: 'checking', attempt });

      // ---- commit + gates ----
      await checkpoint('the commit');
      const message = `evolve(${m.id}): ${m.title.replace(/\s+/g, ' ').trim().slice(0, 60)}\n\nAttempt ${attempt}, written by ${AGENTS.engineer} in the Workshop.\n`;
      const engSha = await fx.commit({ changeDir, parent: base, message });
      if (engSha === null) return await end('failed', 'failed', 'No change: the engineer changed no file, so nothing was committed or deployed.', { state: 'failed', base });
      const sha = opts.inject ? await fx.injectFailure({ changeDir, parent: engSha }) : engSha;
      const d = await fx.diff(changeDir, base, sha);
      const g = gates({ diff: d.text, files: d.files, secrets, report: eng.report, message });
      if (g.secretHits.length > 0) {
        await fx.removeChange(m.id);
        fx.log(`${m.id}: secret gate hit (${g.secretHits.length}); tree and scratch objects deleted`);
        return await end('failed', 'failed', SECRET_TEXT, { state: 'failed' });
      }
      await fx.importObjects(changeDir, base, sha);
      commit = sha;
      const files = d.files.map((f) => (f.oldPath ? `${f.status} ${f.oldPath} -> ${f.path}` : `${f.status} ${f.path}`));
      const shown = { attempt, commit: sha, base, filesChanged: files, diffStat: d.stat, report: eng.report };
      const hits = [...g.protectedHits.map((p) => `protected: ${p}`), ...g.flags.map((f) => `flag: ${f}`)];
      if (hits.length > 0) {
        if (opts.inject) {
          return await end('failed', 'failed', `inject-failure run: the engineer's change needs the owner (${hits.length}: ${hits.slice(0, 5).join('; ')}). `
            + 'An injected commit is never held for approval, so nothing was kept or deployed.', { ...shown, state: 'failed', hits });
        }
        const ref = refName(m.id, attempt);
        await fx.setRef(ref, sha);
        heldRef = ref;
        await hist({ event: 'held', attempt, ref, commit: sha, base });
        const text = [
          `This change needs the owner's approval: it touches protected paths or raised flags (${hits.length}):`,
          ...hits.slice(0, 40).map((h) => `- ${h}`),
          `Nothing was deployed. The commit ${short(sha)} is kept at ${ref} on evolve/main ${short(base)}.`,
          `To deploy it (Claude Code or the owner only): axion-evolve approve ${m.id}`,
        ].join('\n');
        return await end('needs_owner', 'needs_owner', text, { ...shown, hits });
      }
      await w.say(AGENTS.reviewer, `Diff gates passed (${files.length} file${files.length === 1 ? '' : 's'}, no protected path, no flag, no secret). Typecheck next.`, { state: 'checking', ...shown });

      // ---- typecheck (agent code runs only here: no network, no token) ----
      await checkpoint('the typecheck');
      const tc = await fx.typecheck({ changeDir, sha, name: `${m.id}-a${attempt}` });
      if (!tc.ok) {
        const errors = lastLines(red(tc.log));
        const text = `The typecheck (tsc --noEmit, server and web) failed on attempt ${attempt}.`;
        feedback = `${text} The last ${FEEDBACK_LINES} lines:\n${errors}`;
        lastRejected = { text: feedback, evolve: { state: 'rejected', commit: sha, base, checks: errors } };
        if (attempt < CAPS.attempts) { await w.say(AGENTS.reviewer, `${text} Back to the engineer.`, { state: 'working', attempt, checks: errors }); continue; }
        break;
      }
      await w.say(AGENTS.reviewer, 'Typecheck passed (server and web). The reviewer reads the diff.', { state: 'checking', attempt, checks: 'typecheck: server ok, web ok' });

      // ---- reviewer (the engineer's diff; an injected failure commit is not the engineer's work) ----
      await checkpoint('the review');
      const reviewDiff = sha === engSha ? d.text : (await fx.diff(changeDir, base, engSha)).text;
      const rv = await fx.reviewer({ mission: m, diff: reviewDiff, attempt });
      if (!rv.ok) {
        const concerns = rv.concerns.length ? rv.concerns : ['(no reason given)'];
        const text = `The reviewer (${AGENTS.reviewer}) did not accept attempt ${attempt}:\n${concerns.map((x) => `- ${x}`).join('\n')}`;
        feedback = text;
        lastRejected = { text, evolve: { state: 'rejected', commit: sha, base } };
        if (attempt < CAPS.attempts) { await w.say(AGENTS.reviewer, `${text}\nBack to the engineer.`, { state: 'working', attempt }); continue; }
        break;
      }
      await w.say(AGENTS.reviewer, `The reviewer accepted the change.${rv.concerns.length ? ` Notes: ${rv.concerns.join('; ')}` : ''}`, { state: 'checking', attempt });

      // ---- the Guard ----
      await checkpoint('the deploy');
      const ref = refName(m.id, attempt);
      await fx.setRef(ref, sha);
      pushed.push(ref);
      const since = new Date(fx.now()).toISOString();
      await hist({ event: 'deploy', attempt, ref, commit: sha, base, since });
      await w.say(AGENTS.release, `Handed ${ref} (${short(sha)}) to the Guard: axion-guard deploy ${ref}.`, { state: 'deploying', attempt });
      const a = await deployMirrored({ fx, w, id: m.id, attempt }, { ref, sha });
      answered = true;
      const deployed: Deployed = { ref, sha, base, since };
      const kind = guardKind(a);
      const gi = guardInfo(a);
      // decisions and the fields they use come from the Guard's history record only
      const r = a.recorded ?? null;
      if (w.gone) {
        // the mission refused a write while the Guard ran: record what the Guard really did, write nothing more
        const real: ChangeOutcome['outcome'] = kind === 'live' && opts.inject ? 'inject_live' : kind === 'busy' || kind === 'unclear' ? 'failed' : kind;
        const o = await done({ mission: m.id, outcome: real, attempt, commit: sha, reason: `the Guard answered ${guardText(a)}; the mission refused writes (${w.gone.error})` });
        if (real === 'inject_live') await raiseAlarm(fx, sha, m.id);
        return o;
      }
      if (kind === 'live') {
        if (opts.inject) {
          const o = await end('failed', 'inject_live', injectAlarmText(sha, m.id), { ...shown, state: 'failed', guard: gi }, deployed);
          await raiseAlarm(fx, sha, m.id);
          return o;
        }
        return await end('completed', 'live', `Live: ${short(sha)} passed the Guard (build, checks, boot, smoke, switch, watch) and evolve/main is at it.`, { ...shown, guard: gi }, deployed);
      }
      if (kind === 'needs_owner') {
        const gh = r?.hits ?? [];
        if (opts.inject) {
          return await end('failed', 'failed', `inject-failure run: the Guard asks for the owner's approval (protected paths: ${gh.join(', ') || '?'}). `
            + 'An injected commit is never held for approval, so nothing was kept or deployed.', { ...shown, state: 'failed', guard: gi }, deployed);
        }
        pushed.pop();
        heldRef = ref;
        await hist({ event: 'held', attempt, ref, commit: sha, base });
        return await end('needs_owner', 'needs_owner', [`The Guard asks for the owner's approval (protected paths: ${gh.join(', ') || '?'}). Nothing was deployed.`,
          `The commit ${short(sha)} is kept at ${ref}. To deploy it (Claude Code or the owner only): axion-evolve approve ${m.id}`].join('\n'),
        { ...shown, hits: gh.map((h) => `protected: ${h}`), guard: gi }, deployed);
      }
      if (kind === 'rolled_back') {
        return await end('failed', 'rolled_back', `Rolled back: the Guard switched to ${short(sha)}, then ${r?.failedStep ?? 'a step'} failed and the previous version is live again (${r?.reason ?? ''}).`, { ...shown, state: 'rolled_back', guard: gi }, deployed);
      }
      if (kind === 'rejected' && (r?.failedStep === 'build' || r?.failedStep === 'checks')) {
        const text = `The Guard rejected attempt ${attempt} at ${r.failedStep}.`;
        feedback = `${text} Its reason (the Guard keeps only the tail of the failing log):\n${lastLines(red(r.reason ?? ''))}`;
        lastRejected = { text: feedback, evolve: { ...shown, state: 'rejected', guard: gi } };
        await fx.deleteRef(ref);
        pushed.pop();
        await hist({ event: 'retry', attempt, commit: sha, outcome: 'rejected', reason: `${r.failedStep}`.slice(0, 40) });
        answered = false; // the change goes on
        if (attempt < CAPS.attempts) { await w.say(AGENTS.release, `${text} Back to the engineer with the reason.`, { state: 'working', attempt, guard: gi }); continue; }
        break;
      }
      const why = kind === 'busy' ? gi.reason ?? 'busy' : guardText(a);
      if (kind === 'unclear') fx.log(`${m.id}: ${red(unclearText(a))}`);
      return await end('failed', kind === 'rejected' ? 'rejected' : 'failed', `The Guard did not deploy the change: ${why}`, { ...shown, state: kind === 'rejected' ? 'rejected' : 'failed', guard: gi }, deployed);
    }
    attempt = Math.min(attempt, CAPS.attempts);
    const last = lastRejected ?? { text: 'no attempt passed', evolve: {} };
    const kind = last.evolve.state === 'failed' ? 'failed' : 'rejected';
    return await end('failed', kind, `Failed after ${CAPS.attempts} attempts. The last one: ${last.text}`, { ...last.evolve, state: kind });
  } catch (e) {
    if (e instanceof Gone) {
      return done({ mission: m.id, outcome: 'gone', attempt, ...(commit ? { commit } : {}), reason: `the mission left running (${e.refusal.error}${typeof e.refusal.status === 'string' ? `: ${e.refusal.status}` : ''}); the change stopped` });
    }
    if (e instanceof Stop) {
      await w.finish('failed', e.message, { attempt, state: 'failed' }).catch((x) => fx.log(`${m.id}: finish failed: ${red(msg(x))}`));
      return done({ mission: m.id, outcome: 'stopped', attempt, reason: e.message });
    }
    const text = `The runner hit an error and stopped this change: ${red(msg(e)).slice(0, 500)}`;
    fx.log(`${m.id}: ${text}`);
    if (answered) {
      // never a second, different finish after the Guard answered: the next start reconciles from the Guard's history
      fx.log(`${m.id}: the Guard had already answered; the mission is left to the next start (reconcile, then recover)`);
      return { mission: m.id, outcome: 'error', attempt, ...(commit ? { commit } : {}), reason: text.slice(0, 300) };
    }
    await w.finish('failed', text, { attempt, state: 'failed' }).catch((x) => fx.log(`${m.id}: finish failed: ${red(msg(x))}`));
    return done({ mission: m.id, outcome: 'error', attempt, reason: text }).catch(() => ({ mission: m.id, outcome: 'error' as const, attempt, reason: text.slice(0, 300) }));
  } finally {
    for (const ref of pushed) if (ref !== heldRef) await fx.deleteRef(ref).catch((x) => fx.log(`deleteRef ${ref}: ${msg(x)}`));
    await fx.removeChange(m.id).catch((x) => fx.log(`removeChange ${m.id}: ${msg(x)}`));
  }
}

/** Kill switches, day cap, claim, one change. The caller holds the runner lock. */
async function tickLocked(fx: RunnerEffects, inject: boolean): Promise<TickResult> {
  const p = await fx.paused();
  if (p !== null) return { kind: 'paused', reason: p.trim() };
  const h = await fx.missions.halted();
  if (h.halted) return { kind: 'halted', reason: h.reason ?? 'halted' };
  if (fx.stopping()) return { kind: 'idle' };
  const count = claimsToday(await fx.readHistory(), fx.now());
  if (count >= CAPS.changesPerDay) return { kind: 'cap', count };
  const m = await fx.missions.next();
  if (!m) return { kind: 'idle' };
  if (!ID_RE.test(m.id)) {
    fx.log(`claimed a mission with an unusable id ${JSON.stringify(m.id)}; ending it`);
    await fx.missions.finish(m.id, { outcome: 'failed', text: 'The runner cannot use this mission id.', evolve: { state: 'failed' } }).catch(() => null);
    return { kind: 'idle' };
  }
  await fx.appendHistory({ event: 'claim', mission: m.id });
  return { kind: 'change', outcome: await runChange(fx, m, { inject }) };
}

/**
 * Deploys a killed runner left open: a `deploy` line with no later `end`/`retry` for its mission, or an `unsettled`
 * line (the Guard answered, the end line was written, the mission's finish threw).
 */
function openDeploys(h: HistoryEntry[]): HistoryEntry[] {
  const open = new Map<string, HistoryEntry>();
  for (const e of h) {
    if (!e.mission) continue;
    if (e.event === 'deploy' || e.event === 'unsettled') open.set(e.mission, e);
    else if (e.event === 'end' || e.event === 'retry') open.delete(e.mission);
  }
  return [...open.values()];
}

/**
 * At runner start, under the lock: remove a killed runner's leftovers; settle every open deploy with the Guard's recorded
 * outcome (waiting while a Guard still runs); then `recover` fails whatever is still in flight. A stop signal while
 * waiting returns without writing anything; a Guard still busy after the reconcile cap throws StillDeploying (nothing
 * reconciled, no recover: the mission must not be failed while the Guard may still make it live).
 */
export async function startup(fx: RunnerEffects): Promise<void> {
  const swept = await fx.sweep();
  if (swept.length) fx.log(`removed leftovers of an earlier run: ${swept.join(', ')}`);
  const secrets = await fx.secrets().catch(() => [] as string[]);
  if (secrets.length === 0) throw new Error('startup: the secrets (secrets/*.env) cannot be read; the runner refuses to write anything unredacted');
  for (const d of openDeploys(await fx.readHistory())) {
    if (!d.mission || !d.commit) continue;
    const t0 = fx.now();
    while (await fx.guardBusy()) {
      if (fx.stopping()) return;
      if (fx.now() - t0 > TIMING.reconcileMaxMs) {
        throw new StillDeploying(`the Guard is still deploying after ${Math.round(TIMING.reconcileMaxMs / 3_600_000)} h (commit ${d.commit} of ${d.mission}); `
          + 'nothing was reconciled or recovered now. See axion-guard status; start the runner again later.');
      }
      fx.log(`waiting for the Guard (deploy of ${d.commit} for ${d.mission} by an earlier runner)`);
      await fx.sleep(TIMING.pollMs);
    }
    if (fx.stopping()) return;
    const out = await fx.guardOutcome(d.commit, d.since ?? d.at);
    const w = writer(fx, d.mission, secrets);
    const note = ' (settled after a runner restart, from the Guard\'s history)';
    const evolve = { attempt: d.attempt ?? 1, commit: d.commit, ...(d.base ? { base: d.base } : {}) };
    const gi = out ? { outcome: out.outcome, ...(out.failedStep ? { failedStep: out.failedStep } : {}), reason: out.reason ?? '' } : undefined;
    let outcome = 'interrupted';
    let fin: [FinishBody['outcome'], string, FinishEvolve] | null = null;
    if (out?.outcome === 'live' && d.injected) { outcome = 'inject_live'; fin = ['failed', `${injectAlarmText(d.commit, d.mission)}${note}`, { ...evolve, state: 'failed', guard: gi }]; }
    else if (out?.outcome === 'live') { outcome = 'live'; fin = ['completed', `Live: ${short(d.commit)}${note}.`, { ...evolve, guard: gi }]; }
    else if (out?.outcome === 'rolled_back') { outcome = 'rolled_back'; fin = ['failed', `Rolled back at ${out.failedStep ?? '?'}: ${out.reason ?? ''}${note}`, { ...evolve, state: 'rolled_back', guard: gi }]; }
    else if (out?.outcome === 'rejected') { outcome = 'rejected'; fin = ['failed', `The Guard rejected it at ${out.failedStep ?? '?'}: ${out.reason ?? ''}${note}`, { ...evolve, state: 'rejected', guard: gi }]; }
    else if (out?.outcome === 'needs_owner' && d.ref && !d.injected) {
      outcome = 'needs_owner';
      fin = ['needs_owner', `The Guard asks for the owner's approval${note}. To deploy it: axion-evolve approve ${d.mission}`, { ...evolve, hits: (out.hits ?? []).map((x) => `protected: ${x}`) }];
    } else if (out?.outcome === 'needs_owner') { outcome = 'failed'; fin = ['failed', `inject-failure run: the Guard asked for the owner's approval; an injected commit is never held${note}.`, { ...evolve, state: 'failed', guard: gi }]; }
    const unsettled = d.event === 'unsettled';
    // the truth first; an `unsettled` line was already ended once, so its second end does not count again for the streak
    await fx.appendHistory({ event: 'end', mission: d.mission, attempt: d.attempt, commit: d.commit, outcome: unsettled ? 'settled' : outcome,
      ...(d.injected ? { injected: true } : {}), reason: `startup reconcile: ${out ? out.outcome : 'no Guard outcome recorded (recover fails it)'}` });
    if (fin) {
      try {
        await w.finish(fin[0], fin[1], fin[2]);
      } catch (e) {
        fx.log(`${d.mission}: finish during reconcile failed (${w.red(msg(e)).slice(0, 200)}); the next start tries again`);
        await fx.appendHistory({ event: 'unsettled', mission: d.mission, attempt: d.attempt, ref: d.ref, commit: d.commit, base: d.base, since: d.since ?? d.at, ...(d.injected ? { injected: true } : {}) });
      }
    }
    if (outcome === 'needs_owner') await fx.appendHistory({ event: 'held', mission: d.mission, attempt: d.attempt, ref: d.ref, commit: d.commit, base: d.base });
    else if (d.ref) await fx.deleteRef(d.ref).catch(() => {});
    if (outcome === 'rolled_back' && !unsettled) await pauseOnStreak(fx, d.mission);
    if (outcome === 'inject_live') await raiseAlarm(fx, d.commit, d.mission);
  }
  if (fx.stopping()) return;
  const rec = await fx.missions.recover();
  if (rec.length) {
    fx.log(`recovered (failed as interrupted): ${rec.join(', ')}`);
    await fx.appendHistory({ event: 'note', reason: `recover: ${rec.join(', ')}`.slice(0, 300) });
  }
}

/** `axion-evolve once`: startup and one tick under one hold of the lock */
export async function once(fx: RunnerEffects, o: { inject: boolean }): Promise<TickResult> {
  const release = await fx.lock();
  if (!release) return { kind: 'busy' };
  try {
    await startup(fx);
    if (fx.stopping()) return { kind: 'idle' };
    return await tickLocked(fx, o.inject);
  } finally {
    await release();
  }
}

/** `axion-evolve run` (the service): startup once, then poll. It never injects a failure. */
export async function runForever(fx: RunnerEffects, o: { maxTicks?: number } = {}): Promise<void> {
  for (;;) {
    if (fx.stopping()) return;
    const release = await fx.lock();
    if (release) {
      try { await startup(fx); } finally { await release(); }
      break;
    }
    fx.log('the runner lock is held (an approve?); waiting to start');
    await fx.sleep(TIMING.pollMs);
  }
  let last = '';
  for (let i = 0; o.maxTicks === undefined || i < o.maxTicks; i++) {
    if (fx.stopping()) return;
    let r: TickResult;
    const release = await fx.lock();
    if (!release) r = { kind: 'busy' };
    else {
      try {
        r = await tickLocked(fx, false);
      } catch (e) {
        const s = await fx.secrets().catch(() => [] as string[]);
        fx.log(s.length ? `tick failed: ${storable(redactSecrets(msg(e), s)).slice(0, 500)}` : 'tick failed (details withheld: the secrets to redact them with cannot be read)');
        r = { kind: 'idle' };
      } finally { await release(); }
    }
    const what = r.kind === 'change' ? `change ${r.outcome.mission}: ${r.outcome.outcome}` : r.kind === 'paused' || r.kind === 'halted' ? `${r.kind}: ${r.reason}` : r.kind;
    if (what !== last || r.kind === 'change') fx.log(what);
    last = what;
    if (r.kind !== 'change') await fx.sleep(TIMING.pollMs);
  }
}

/**
 * `axion-evolve approve <mission>` (Claude Code / the owner only), under the runner lock: the change the runner holds for the
 * mission (runner-history `held`, never an injected one) must still be at its ref and on the live commit; then `approved`
 * → Guard deploy --approve <sha> --approve-base <live> → end line → finish. Exit codes: 0 live, 1 refused/failed, 2 usage,
 * 3 needs owner, 4 busy.
 */
export async function approve(fx: RunnerEffects, id: string): Promise<{ code: number; message: string }> {
  if (!ID_RE.test(id)) return { code: 2, message: `not a mission id: ${JSON.stringify(id)}` };
  const release = await fx.lock();
  if (!release) return { code: 4, message: 'the runner lock is held (a change or another approve is running); try again later' };
  try {
    const h = await fx.readHistory();
    const held = [...h].reverse().find((e) => e.event === 'held' && e.mission === id);
    if (!held || !held.ref || !held.commit || !held.base) return { code: 1, message: `no change is held for ${id} (runner-history has no held entry)` };
    if (held.injected) return { code: 1, message: `the held entry of ${id} comes from an inject-failure run; an injected commit is never approved` };
    const later = h.slice(h.lastIndexOf(held) + 1);
    if (later.some((e) => e.mission === id && (e.event === 'claim' || (e.event === 'end' && e.ref === held.ref)))) {
      return { code: 1, message: `the held change ${held.ref} of ${id} was already handled or replaced by a newer claim` };
    }
    const at = await fx.resolveRef(held.ref);
    if (at !== held.commit) return { code: 1, message: `${held.ref} is at ${at ?? 'nothing'}, not the held commit ${held.commit}; nothing deployed` };
    const live = await fx.liveSha();
    if (live !== held.base) {
      return { code: 1, message: `evolve/main moved from ${held.base} to ${live} since this change was built; it cannot be deployed as is (Retry the mission for a fresh change)` };
    }
    const why = await stopReason(fx);
    if (why) return { code: 1, message: `refused: ${why}` };
    const secrets = await fx.secrets().catch(() => [] as string[]);
    if (secrets.length === 0) return { code: 1, message: 'refused: the secrets (secrets/*.env) cannot be read, so nothing could be redacted; nothing deployed' };
    const ok = await fx.missions.approved(id);
    if (!ok.ok) {
      const hint = ok.refusal.error === 'mission_not_waiting'
        ? ` (status ${String(ok.refusal.status ?? '?')}: the mission is not waiting for approval; a pause/resume may have reopened the gate, so it sits running with needs_owner and nothing deploys it)`
        : '';
      return { code: 1, message: `the mission refused the approval: ${ok.refusal.error}${hint}; nothing deployed` };
    }
    const attempt = held.attempt ?? 1;
    const w = writer(fx, id, secrets);
    const since = new Date(fx.now()).toISOString();
    await fx.appendHistory({ event: 'deploy', mission: id, attempt, ref: held.ref, commit: held.commit, base: held.base, by: 'approve', since });
    let a: DeployAnswer;
    // a refusal here (the mission left running right after `approved`) means: deploy nothing
    await w.say(AGENTS.release, `The owner approved ${short(held.commit)}; the Guard deploys it: axion-guard deploy ${held.ref} --approve ${held.commit} --approve-base ${live}.`, { state: 'deploying', attempt })
      .catch(() => { /* w.gone is set */ });
    if (w.gone) {
      await fx.appendHistory({ event: 'end', mission: id, attempt, ref: held.ref, commit: held.commit, outcome: 'gone', reason: `mission write refused: ${w.gone.error}` });
      return { code: 1, message: `the mission refused a write right after the approval (${w.gone.error}); nothing deployed` };
    }
    try {
      a = await deployMirrored({ fx, w, id, attempt }, { ref: held.ref, sha: held.commit, approve: { sha: held.commit, base: live } });
    } catch (e) {
      const text = e instanceof Stop ? e.message : `the approve stopped: ${w.red(msg(e))}`;
      await w.finish('failed', text, { attempt, state: 'failed' }).catch(() => false);
      await fx.appendHistory({ event: 'end', mission: id, attempt, ref: held.ref, commit: held.commit, outcome: 'stopped', reason: text.slice(0, 300) });
      return { code: 1, message: text };
    }
    const gi = guardInfo(a);
    const r = a.recorded ?? null;
    const kind = guardKind(a);
    const evolve = { attempt, commit: held.commit, base: held.base, guard: gi };
    let code = 1;
    let outcome: string = kind === 'busy' || kind === 'unclear' ? 'failed' : kind;
    let fin: [FinishBody['outcome'], string, FinishEvolve];
    if (kind === 'live') {
      code = 0;
      fin = ['completed', `Live (approved by the owner): ${short(held.commit)} passed the Guard.`, evolve];
    } else if (kind === 'needs_owner') {
      code = 3;
      fin = ['needs_owner', `The Guard still asks for the owner's approval: ${guardText(a)}\nTo try again: axion-evolve approve ${id}`, { ...evolve, hits: (r?.hits ?? []).map((x) => `protected: ${x}`) }];
    } else {
      outcome = kind === 'rolled_back' || kind === 'rejected' ? kind : 'failed';
      fin = ['failed', `The approved change did not go live: ${guardText(a)}`, { ...evolve, state: outcome === 'rolled_back' ? 'rolled_back' : outcome === 'rejected' ? 'rejected' : 'failed' }];
    }
    // the truth first, then the mission (a finish that throws leaves the deploy for the next start's reconcile)
    await fx.appendHistory({ event: 'end', mission: id, attempt, ref: held.ref, commit: held.commit, outcome, reason: w.red(fin[1]).slice(0, 300), by: 'approve' });
    try {
      await w.finish(fin[0], fin[1], fin[2]);
    } catch (e) {
      fx.log(`${id}: finish failed (${w.red(msg(e)).slice(0, 200)}); the next runner start settles it from the Guard's history`);
      await fx.appendHistory({ event: 'unsettled', mission: id, attempt, ref: held.ref, commit: held.commit, base: held.base, since });
    }
    // still held (after the end line, so a later approve finds it as the newest held entry)
    if (outcome === 'needs_owner') await fx.appendHistory({ event: 'held', mission: id, attempt, ref: held.ref, commit: held.commit, base: live });
    else await fx.deleteRef(held.ref).catch(() => {});
    if (outcome === 'rolled_back') await pauseOnStreak(fx, id);
    return { code, message: w.red(fin[1].split('\n')[0]) };
  } finally {
    await release();
  }
}
