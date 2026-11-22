import { z } from 'zod';
import { LEDGER_LIMITS as L, STEP_STATUSES } from '../../../shared/contracts/src/ledgers.ts';

/** Strict zod schemas for the two mission ledgers (cycle 39). Bounds come from the shared LEDGER_LIMITS. */
const Text = (max: number) => z.string().trim().min(1, 'Write something').max(max, `At most ${max} characters`);
const Fact = z.object({ text: Text(L.factText), source: z.string().trim().min(1).max(L.factSource).optional() }).strict();
const Facts = z.array(Fact).max(L.factsPerGroup, `At most ${L.factsPerGroup} per group`);
const Step = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,23}$/, 'Lower case letters, digits and dashes, up to 24 characters'),
  text: Text(L.stepText), owner: z.string().trim().min(1).max(L.stepOwner).optional(), status: z.enum(STEP_STATUSES),
}).strict();

const tooBig = (b: unknown, ctx: z.RefinementCtx) => {
  const n = Buffer.byteLength(JSON.stringify(b), 'utf8');
  if (n > L.bodyBytes) ctx.addIssue({ code: 'custom', path: [], message: `Ledger is too large (${n} bytes, at most ${L.bodyBytes}). Shorten some entries.` });
};
export const TaskBodySchema = z.object({
  facts: z.object({ given: Facts, to_look_up: Facts, to_derive: Facts, guesses: Facts }).strict(),
  steps: z.array(Step).max(L.steps, `At most ${L.steps} steps`),
}).strict().superRefine((b, ctx) => {
  const seen = new Set<string>();
  b.steps.forEach((s, i) => { if (seen.has(s.id)) ctx.addIssue({ code: 'custom', path: ['steps', i, 'id'], message: 'Step ids must be unique' }); seen.add(s.id); });
  tooBig(b, ctx);
});
/** What a writer sends. The stall counter is not theirs to set: the server computes it. */
export const ProgressInSchema = z.object({
  satisfied: z.boolean(), looping: z.boolean(), progressing: z.boolean(),
  next_speaker: z.string().trim().min(1).max(L.nextSpeaker).optional(),
  next_instruction: z.string().trim().min(1).max(L.nextInstruction).optional(),
  notes: z.string().trim().max(L.notes).default(''),
}).strict().superRefine(tooBig);
export const WriteEnvelope = z.object({ baseVersion: z.number().int().min(0).max(1_000_000), body: z.unknown() }).strict();
