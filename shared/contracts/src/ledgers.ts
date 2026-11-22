/**
 * Mission ledgers (improvement cycle 39, Phase 2 / O1).
 *
 * The shape follows the Orchestrator of Magentic-One (Fourney et al., 2024, https://arxiv.org/abs/2411.04468): one ledger
 * for what the team believes and plans, one for whether the work is moving. The wording is AXION's own.
 *   - Task ledger: facts in four groups (given, to look up, to derive, guesses) and a plan of steps.
 *   - Progress ledger: is the request satisfied, is the team looping, is progress being made, who speaks next and with
 *     what instruction, plus a stall counter.
 * A ledger is never edited: every save is a new version (the database refuses updates and deletes).
 */
export const LEDGER_KINDS = ['task', 'progress'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
export const STEP_STATUSES = ['todo', 'doing', 'done', 'blocked'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];
export const FACT_GROUPS = ['given', 'to_look_up', 'to_derive', 'guesses'] as const;
export type FactGroup = (typeof FACT_GROUPS)[number];

/** Bounds, shared by the server schema and the editor. */
export const LEDGER_LIMITS = Object.freeze({
  factText: 400, factSource: 200, factsPerGroup: 30, steps: 30, stepText: 400, stepOwner: 64, stepId: 24,
  /** whole serialized body, UTF-8 bytes: below the database CHECK (64 kB on the stored jsonb) */ bodyBytes: 49_152, versionsPerKind: 500, pageSize: 100,
  nextSpeaker: 64, nextInstruction: 600, notes: 2000,
});

/** Frozen policy: when does a run of entries count as a stall (the paper re-plans once its counter passes 2; here: 3 entries). */
export const STALL_POLICY = Object.freeze({ nonProgressing: 3, loopingInARow: 2 });

export interface Fact { text: string; source?: string }
export interface Step { id: string; text: string; owner?: string; status: StepStatus }
export interface TaskBody { facts: Record<FactGroup, Fact[]>; steps: Step[] }
export interface ProgressBody {
  satisfied: boolean; looping: boolean; progressing: boolean;
  next_speaker?: string; next_instruction?: string; notes: string;
  /** set by the server on every save: the run of non-progressing entries ending here */
  stall: number;
}
export type LedgerBody = TaskBody | ProgressBody;

export interface LedgerVersionDto { version: number; authorId: string; authorName: string; authorKind: 'human' | 'agent' | 'system'; createdAt: string; demo: boolean }
export interface LedgerDto<B = LedgerBody> extends LedgerVersionDto { id: string; missionId: string; kind: LedgerKind; body: B }
export interface StallResult { stalled: boolean; counter: number; reason: 'no-progress' | 'looping' | null }
export interface LedgerVersionPageDto { versions: LedgerVersionDto[]; next: number | null }
export interface LedgersDto {
  ledgers: { task: LedgerDto<TaskBody> | null; progress: LedgerDto<ProgressBody> | null };
  versions: { task: LedgerVersionDto[]; progress: LedgerVersionDto[] };
  /** cursor for the next older page (pass as ?before=) per kind, or null when the list is complete */
  moreVersions: { task: number | null; progress: number | null };
  stall: StallResult; policy: typeof STALL_POLICY; canEdit: boolean; demo: boolean;
}

type Flags = Pick<ProgressBody, 'satisfied' | 'looping' | 'progressing'>;

/**
 * Pure. `history` is oldest first. An entry is non-progressing when it says progress is not being made or that the team
 * is looping. The counter is the run of such entries at the end (a progressing entry resets it, a satisfied latest entry
 * ends it). Stalled: at least STALL_POLICY.nonProgressing in that run, or STALL_POLICY.loopingInARow looping entries in a row.
 */
export function stallCheck(history: readonly Flags[]): StallResult {
  const last = history[history.length - 1];
  if (!last || last.satisfied) return { stalled: false, counter: 0, reason: null };
  let counter = 0, loops = 0;
  for (let i = history.length - 1; i >= 0 && (!history[i].progressing || history[i].looping) && !history[i].satisfied; i--) counter++;
  for (let i = history.length - 1; i >= 0 && history[i].looping && !history[i].satisfied; i--) loops++;
  if (loops >= STALL_POLICY.loopingInARow) return { stalled: true, counter, reason: 'looping' };
  if (counter >= STALL_POLICY.nonProgressing) return { stalled: true, counter, reason: 'no-progress' };
  return { stalled: false, counter, reason: null };
}

export interface LedgerChange { change: 'added' | 'removed' | 'changed'; label: string; from?: string; to?: string }
export const FACT_LABEL: Record<FactGroup, string> = { given: 'Given facts', to_look_up: 'To look up', to_derive: 'To derive', guesses: 'Guesses' };
const yn = (b: boolean) => (b ? 'yes' : 'no');

/** Pure. What changed from version `a` to version `b` of one kind of ledger, in reading order. */
export function diffLedgers(kind: 'task', a: TaskBody, b: TaskBody): LedgerChange[];
export function diffLedgers(kind: 'progress', a: ProgressBody, b: ProgressBody): LedgerChange[];
export function diffLedgers(kind: LedgerKind, a: LedgerBody, b: LedgerBody): LedgerChange[];
export function diffLedgers(kind: LedgerKind, a: LedgerBody, b: LedgerBody): LedgerChange[] {
  const out: LedgerChange[] = [];
  if (kind === 'task') {
    const x = a as TaskBody, y = b as TaskBody;
    for (const g of FACT_GROUPS) {
      const before = (x.facts[g] ?? []).map((f) => f.text), after = (y.facts[g] ?? []).map((f) => f.text);
      for (const t of after) if (!before.includes(t)) out.push({ change: 'added', label: FACT_LABEL[g], to: t });
      for (const t of before) if (!after.includes(t)) out.push({ change: 'removed', label: FACT_LABEL[g], from: t });
    }
    const bs = new Map(x.steps.map((s) => [s.id, s])), as = new Map(y.steps.map((s) => [s.id, s]));
    for (const s of y.steps) {
      const o = bs.get(s.id);
      if (!o) { out.push({ change: 'added', label: `Step ${s.id}`, to: s.text }); continue; }
      if (o.text !== s.text) out.push({ change: 'changed', label: `Step ${s.id} text`, from: o.text, to: s.text });
      if (o.status !== s.status) out.push({ change: 'changed', label: `Step ${s.id} status`, from: o.status, to: s.status });
      if ((o.owner ?? '') !== (s.owner ?? '')) out.push({ change: 'changed', label: `Step ${s.id} owner`, from: o.owner ?? '', to: s.owner ?? '' });
    }
    for (const s of x.steps) if (!as.has(s.id)) out.push({ change: 'removed', label: `Step ${s.id}`, from: s.text });
    return out;
  }
  const x = a as ProgressBody, y = b as ProgressBody;
  const flag = (label: string, p: boolean, q: boolean) => { if (p !== q) out.push({ change: 'changed', label, from: yn(p), to: yn(q) }); };
  flag('Request satisfied', x.satisfied, y.satisfied); flag('Looping', x.looping, y.looping); flag('Making progress', x.progressing, y.progressing);
  const txt = (label: string, p = '', q = '') => { if (p !== q) out.push({ change: 'changed', label, from: p, to: q }); };
  txt('Next speaker', x.next_speaker, y.next_speaker); txt('Next instruction', x.next_instruction, y.next_instruction); txt('Notes', x.notes, y.notes);
  if (x.stall !== y.stall) out.push({ change: 'changed', label: 'Stall counter', from: String(x.stall), to: String(y.stall) });
  return out;
}
