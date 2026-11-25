/**
 * Phase A (A1): the two policy decisions recorded for every step, in ONE place that both the (fake) executor and the replay verifier use, so that "replay
 * reproduces the decision" means the same deterministic code gives the same answer from the same recorded inputs. Pure: no I/O, no clock. Nothing executes.
 *
 *   profile  the c94 request decider (server/src/exec-profile/decider.ts) for the tools that make a request: browse (args.url, args.redirects),
 *            read_file and write_file (args.path). Any other tool has no request: null. With no execution profile, those three tools are denied (`no_profile`).
 *   caps     the c95 checker (server/src/jobs/run-caps.ts), with the halt flag and fencing tokens that were recorded as inputs of the step.
 *
 * After a step ran, its outcome counts its ACTUAL cost and tokens; where the executor reported none (null) it counts the ESTIMATE, so an unknown actual never
 * lowers what the caps believe was spent. (The run's recorded cost stays "unknown"; this is only what the caps check assumes.)
 */
import type { ExecProfile } from '../../../shared/contracts/src/exec-profile.ts';
import type { RunCaps, RunClassBreaker, RunCounters, RunStepOutcome, RunStepProposal, StepDecision, StepInputs } from '../../../shared/contracts/src/index.ts';
import { decideRequests } from '../exec-profile/decider.ts';
import { originOfUrl } from '../browser/schema.ts';
import { checkRunStep } from '../jobs/run-caps.ts';

export const REQUEST_TOOLS = ['browse', 'read_file', 'write_file'] as const;
export interface DecideCtx { profile: ExecProfile | null; caps: RunCaps | null; breaker: RunClassBreaker; counters: RunCounters }
/** `atMs` is milliseconds since the run started (the counters' own clock starts at 0). */
export interface DecideIn { tool: string; args: unknown; atMs: number; inputs: StepInputs }

const asObject = (a: unknown): Record<string, unknown> => (a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>) : {});

function profileDecision(profile: ExecProfile | null, tool: string, args: unknown): StepDecision['profile'] {
  if (!(REQUEST_TOOLS as readonly string[]).includes(tool)) return null;
  if (!profile) return { allowed: false, reason: 'no_profile' };
  const a = asObject(args);
  const req = tool === 'browse'
    ? { urls: [{ url: a.url, ...(a.redirects === undefined ? {} : { redirects: a.redirects }) }] }
    : { paths: [{ path: a.path, access: tool === 'write_file' ? 'write' : 'read' }] };
  const d = decideRequests(profile, req);
  const reason = d.items.find((i) => !i.allow)?.reason ?? (d.allowed ? 'allowed' : 'request_malformed');
  return { allowed: d.allowed, reason };
}

export function decideStep(ctx: DecideCtx, i: DecideIn): { decision: StepDecision; proposal: RunStepProposal } {
  const a = asObject(i.args);
  const o = i.tool === 'browse' ? originOfUrl(a.url) : null;
  const proposal: RunStepProposal = { tool: i.tool, origin: o && o.ok ? o.origin : null, atMs: i.atMs, estMoneyMicros: i.inputs.estMoneyMicros, estTokens: i.inputs.estTokens, fencingToken: i.inputs.fencingToken };
  const c = checkRunStep({ caps: ctx.caps, breaker: ctx.breaker, counters: ctx.counters, step: proposal, halt: { halted: i.inputs.halted }, currentFencingToken: i.inputs.currentFencingToken });
  return { decision: { profile: profileDecision(ctx.profile, i.tool, i.args), caps: c.action === 'continue' ? { action: 'continue', reason: null } : { action: 'stop', reason: c.reason } }, proposal };
}

export const isExecuted = (d: StepDecision): boolean => (d.profile === null || d.profile.allowed) && d.caps.action === 'continue';

export function outcomeOf(s: { ok: boolean; toolCostMicros: number | null; tokens: number | null }, inputs: Pick<StepInputs, 'estMoneyMicros' | 'estTokens'>): RunStepOutcome {
  return { ok: s.ok, actualMoneyMicros: s.toolCostMicros ?? inputs.estMoneyMicros, actualTokens: s.tokens ?? inputs.estTokens };
}
