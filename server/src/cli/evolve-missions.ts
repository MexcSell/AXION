/**
 * Evolution step 2: the host runner's door into AXION missions (protected: evolve/protected.txt).
 *
 *   node --import tsx server/src/cli/evolve-missions.ts <command> [args]     (only DATABASE_URL is needed in the environment)
 *
 * Prints exactly ONE JSON line on stdout. Exit 0 = ok, 1 = refused or failed (`{"error": <code>, ...}`), 2 = usage or bad input.
 *
 *   halted                         → {halted:false} | {halted:true, reason}   (run_halts: global, or class `evolution`)
 *   recover                        → {recovered: [ids]}   evolve.state claimed|working|checking|deploying → failed, "interrupted (runner restarted)"
 *   next                           → {mission:null} | {mission:null, halted:true, reason} | {mission:{id,title,text,criteria,owner}}   (claims it: evolve.state claimed)
 *   progress <id>   stdin {by, text, evolve}          → {ok:true, id, state}
 *   finish <id>     stdin {outcome, text, evolve}     → {ok:true, id, status, state}   completed: verify+complete; failed: fail; needs_owner: requestApproval
 *   approved <id>                  → {ok:true, id, status:'running', state:'deploying'}   (waiting_approval → approvalDone → running)
 *   file --owner <name> --text <text> → {id}   an `improve` mission created as POST /missions would for that administrator, staffed to the end
 *
 * Texts from the runner and the agents are stored verbatim (never interpreted), cut to fixed lengths (see CAPS). Every write takes the
 * mission row lock first (`select … for update`) and merges into the row it read; state changes use system actions only.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { makePool, tx, type Db, type Tx } from '../db.ts';
import { emit } from '../events/hooks.ts';
import { audit } from '../audit.ts';
import { transition, type MissionAction, type MissionStatus } from '../missions/machine.ts';
import { createMission } from '../missions/service.ts';
import { staffingStep } from '../missions/staffing-sim.ts';
import { readEffectiveHalt } from '../jobs/run-halts.ts';
import { normalizeName } from '../auth/names.ts';
import type { EvolveInfo, EvolveState } from '../../../web/src/data/types.ts';

const TENANT = 't-1';
const ACTOR = 'axion-evolve';
export const CAPS = { text: 4000, by: 40, lastEvent: 200, logTail: 200, missionText: 20_000, stdinBytes: 1_000_000,
  long: 12_000, medium: 8000, short: 80, path: 400, list: 500 } as const;
/** a change in flight: what `recover` fails after a runner restart */
const IN_FLIGHT: EvolveState[] = ['claimed', 'working', 'checking', 'deploying'];
/** what `progress` may set; the end states come only from `finish` (and `approved` sets deploying after the owner's yes) */
const PROGRESS_STATES = ['claimed', 'working', 'checking', 'deploying', 'rejected'] as const;
/** the change is over: progress and finish refuse */
const FINISHED: EvolveState[] = ['live', 'rolled_back', 'needs_owner', 'failed'];
const FAILABLE: MissionStatus[] = ['planning', 'running', 'waiting_approval', 'verifying'];
const RECOVER_REASON = 'interrupted (runner restarted)';

export interface CliIo { pool: Db; stdin?: () => Promise<string>; now?: () => number }
export interface CliResult { code: 0 | 1 | 2; out: Record<string, unknown> }

class Refusal extends Error { constructor(public code: 1 | 2, public out: Record<string, unknown>) { super(String(out.error)); } }
const usage = (detail: string) => new Refusal(2, { error: 'usage', detail });
const badInput = (detail: string) => new Refusal(2, { error: 'bad_input', detail: detail.slice(0, 500) });
const refuse = (out: Record<string, unknown>) => new Refusal(1, out);

const cut = (n: number) => z.string().transform((s) => s.slice(0, n));
const list = z.array(cut(CAPS.path)).transform((a) => a.slice(0, CAPS.list));
const sha = z.string().regex(/^[0-9a-f]{7,64}$/, 'a lowercase hex commit id');
/** Partial<EvolveInfo>, field for field (`satisfies` fails tsc when a key is missing or extra); unknown keys are refused. */
const EVOLVE_SHAPE = {
  state: z.enum(PROGRESS_STATES),
  attempt: z.number().int().min(0).max(99),
  updatedAt: z.string().max(40), // always replaced by the time of the write
  commit: sha, base: sha,
  filesChanged: list, hits: list,
  diffStat: cut(CAPS.medium), checks: cut(CAPS.medium), report: cut(CAPS.long),
  guard: z.object({ outcome: cut(CAPS.short), failedStep: cut(CAPS.short).optional(), reason: cut(CAPS.text).optional() }).strict(),
} satisfies Record<keyof EvolveInfo, z.ZodType>;
const EvolvePatch = z.object(EVOLVE_SHAPE).partial().strict();
// `finish` sets the end state itself (the outcome decides); a given rejected/rolled_back state of a failed change is kept
const FinishEvolve = EvolvePatch.extend({ state: z.enum(['claimed', 'working', 'checking', 'deploying', 'rejected', 'rolled_back', 'failed', 'live', 'needs_owner']).optional() }).strict();
type _Fits = [z.infer<typeof EvolvePatch>, z.infer<typeof FinishEvolve>] extends [Partial<EvolveInfo>, Partial<EvolveInfo>] ? true : never;
const _fits: _Fits = true; void _fits;
const line = (n: number) => z.string().min(1).transform((s) => s.slice(0, n));
const ProgressIn = z.object({ by: line(CAPS.by), text: line(CAPS.text), evolve: EvolvePatch }).strict();
const FinishIn = z.object({ outcome: z.enum(['completed', 'failed', 'needs_owner']), text: line(CAPS.text), evolve: FinishEvolve }).strict();
type Patch = Partial<EvolveInfo>;

async function readJson<T>(io: CliIo, schema: z.ZodType<T>): Promise<T> {
  const raw = io.stdin ? await io.stdin() : '';
  if (Buffer.byteLength(raw) > CAPS.stdinBytes) throw badInput(`stdin is larger than ${CAPS.stdinBytes} bytes`);
  let v: unknown;
  try { v = JSON.parse(raw); } catch { throw badInput('stdin is not one JSON object'); }
  const r = schema.safeParse(v);
  if (!r.success) throw badInput(r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '));
  return r.data;
}

const missionId = (argv: string[], cmd: string) => {
  const id = argv[1];
  if (!id) throw usage(`${cmd} <mission id>`);
  if (!/^M-\d{1,9}$/.test(id)) throw usage(`not a mission id: ${id.slice(0, 40)}`);
  return id;
};

/** The mission row with its current revision, owner and the revision's author, locked (`for update` of the mission row). */
async function lockMission(c: Tx, id: string) {
  return (await c.query(
    `select m.*, r.kind, r.title, r.text, r.criteria, r.created_by, u.role as owner_role, u.status as owner_status, u.name as owner_name, cb.role as editor_role
       from missions m
       join mission_revisions r on r.mission_id = m.id and r.revision = m.current_revision
       join users u on u.id = m.owner_id
       left join users cb on cb.id = r.created_by
      where m.id = $1 and m.tenant_id = $2 and m.deleted_at is null
      for update of m`, [id, TENANT])).rows[0] as Record<string, any> | undefined;
}
type Row = Record<string, any>;

/** Merge one progress line into the locked row: staffing log (bounded tail), evolve, summary, lastEvent; the status may change in the same write. */
async function write(c: Tx, r: Row, o: { by: string; text: string; evolve: Patch; status?: MissionStatus; extra?: Record<string, unknown>; now: number }) {
  const p = (r.presentation ?? {}) as Record<string, any>;
  const evolve = { attempt: 0, ...(p.evolve ?? {}), ...o.evolve, updatedAt: new Date(o.now).toISOString() } as EvolveInfo;
  const st = (p.staffing ?? { stage: 'working', joined: 0, plan: [], log: [] }) as { stage?: string; joined?: number; log?: unknown[] };
  const log = [...(st.log ?? []), { at: o.now, by: o.by, text: o.text }].slice(-CAPS.logTail);
  const lastEvent = o.text.split('\n')[0].slice(0, CAPS.lastEvent);
  const pres = { evolve, staffing: { ...st, log }, summary: o.text, summaryAt: o.now, lastEvent, lastEventAt: o.now, ...(o.extra ?? {}) };
  const u = await c.query(`update missions set presentation = presentation || $2::jsonb, status=$3, row_version=row_version+1, updated_at=now()
      where id=$1 and row_version=$4 and status=$5 returning id`, [r.id, JSON.stringify(pres), o.status ?? r.status, r.row_version, r.status]);
  if (!u.rowCount) throw refuse({ error: 'conflict' }); // cannot happen under the row lock; never a silent overwrite
  await emit(c, { tenantId: r.tenant_id, type: 'staffing.progressed', subject: r.id, missionId: r.id, actor: ACTOR, actorKind: 'system',
    payload: { simulated: false, stage: String(st.stage ?? 'working'), joined: Number(st.joined ?? 0), agentId: o.by, text: lastEvent, evolve: true } });
  return evolve;
}

/** System actions, in order, from the locked status (machine.ts decides every edge). */
function plan(from: MissionStatus, actions: MissionAction[]) {
  const steps: [MissionStatus, MissionAction, MissionStatus][] = [];
  let s = from;
  for (const a of actions) { const to = transition(s, a); steps.push([s, a, to]); s = to; }
  return { to: s, steps };
}
/** One audit row and one mission.stateChanged {from,to,action,by} per step; an ended mission ends its open run. */
async function recordSteps(c: Tx, r: Row, steps: [MissionStatus, MissionAction, MissionStatus][], correlationId: string) {
  for (const [from, action, to] of steps) {
    await audit(c, { tenantId: r.tenant_id, actor: ACTOR, action: `mission.${action}`, subject: r.id, result: 'ok', correlationId, detail: { from, to } });
    await emit(c, { tenantId: r.tenant_id, type: 'mission.stateChanged', subject: r.id, missionId: r.id, actor: ACTOR, actorKind: 'system', correlationId, payload: { from, to, action, by: 'system' } });
  }
  const last = steps.at(-1)?.[2];
  if (last === 'completed' || last === 'failed') await c.query(`update mission_runs set ended_at=now(), status=$2 where mission_id=$1 and ended_at is null`, [r.id, last]);
}

/** progress/finish: the mission must still be the runner's running change. Anything else stops that change (exit 1, nothing written). */
function assertRunningChange(r: Row | undefined): asserts r is Row {
  if (!r) throw refuse({ error: 'no_such_mission' });
  if (r.kind !== 'improve') throw refuse({ error: 'not_improve' });
  if (r.status !== 'running') throw refuse({ error: 'mission_not_running', status: r.status });
  const e = r.presentation?.evolve as EvolveInfo | undefined;
  if (!e) throw refuse({ error: 'not_claimed' });
  if (FINISHED.includes(e.state)) throw refuse({ error: 'change_finished', state: e.state });
}

async function halted(db: Db | Tx) {
  // the newest row of global, then class `evolution`, decides; an unreadable row counts as a halt (fails closed). No run row can have
  // an empty target (table check), so runId '' adds nothing.
  const h = await readEffectiveHalt(db, TENANT, { runId: '', taskClass: 'evolution' });
  return h.halted ? { halted: true, reason: h.reason ?? 'halted' } : { halted: false };
}

async function next(io: CliIo) {
  const now = io.now?.() ?? Date.now();
  return tx(io.pool, async (c) => {
    const h = await halted(c);
    if (h.halted) return { mission: null, ...h };
    // the oldest eligible mission; a row another runner holds is skipped, and every clause is checked again on the locked row
    const cand = (await c.query(
      `select m.id from missions m
         join mission_revisions r on r.mission_id = m.id and r.revision = m.current_revision
         join users u on u.id = m.owner_id
         join users cb on cb.id = r.created_by
        where m.tenant_id = $1 and m.deleted_at is null and m.status = 'running' and r.kind = 'improve'
          and u.role = 'admin' and u.status = 'approved' and cb.role = 'admin'
          and not (m.presentation ? 'evolve') and m.presentation->'staffing'->>'stage' = 'working'
        order by m.created_at, m.id
        limit 1
        for update of m skip locked`, [TENANT])).rows[0];
    if (!cand) return { mission: null };
    const r = await lockMission(c, cand.id);
    const p = r?.presentation ?? {};
    if (!r || r.status !== 'running' || r.kind !== 'improve' || r.owner_role !== 'admin' || r.owner_status !== 'approved' || r.editor_role !== 'admin'
      || p.evolve || p.staffing?.stage !== 'working') return { mission: null };
    await write(c, r, { by: ACTOR, text: 'The runner picked up this change.', evolve: { state: 'claimed', attempt: 0 }, now });
    return { mission: { id: r.id as string, title: r.title as string, text: r.text as string,
      criteria: ((r.criteria ?? []) as { text: string }[]).map((x) => String(x.text)), owner: r.owner_name as string } };
  });
}

async function progress(argv: string[], io: CliIo) {
  const id = missionId(argv, 'progress');
  const b = await readJson(io, ProgressIn);
  return tx(io.pool, async (c) => {
    const r = await lockMission(c, id);
    assertRunningChange(r);
    const e = await write(c, r, { by: b.by, text: b.text, evolve: b.evolve, now: io.now?.() ?? Date.now() });
    return { ok: true, id, state: e.state };
  });
}

async function finish(argv: string[], io: CliIo) {
  const id = missionId(argv, 'finish');
  const b = await readJson(io, FinishIn);
  return tx(io.pool, async (c) => {
    const r = await lockMission(c, id);
    assertRunningChange(r);
    const state: EvolveState = b.outcome === 'completed' ? 'live' : b.outcome === 'needs_owner' ? 'needs_owner'
      : b.evolve.state === 'rejected' || b.evolve.state === 'rolled_back' ? b.evolve.state : 'failed';
    const actions: MissionAction[] = b.outcome === 'completed' ? ['verify', 'complete'] : b.outcome === 'needs_owner' ? ['requestApproval'] : ['fail'];
    const { to, steps } = plan(r.status, actions);
    await write(c, r, { by: ACTOR, text: b.text, evolve: { ...b.evolve, state }, status: to, extra: b.outcome === 'completed' ? { progress: 100 } : undefined, now: io.now?.() ?? Date.now() });
    await recordSteps(c, r, steps, `evolve-${id}`);
    return { ok: true, id, status: to, state };
  });
}

async function approved(argv: string[], io: CliIo) {
  const id = missionId(argv, 'approved');
  return tx(io.pool, async (c) => {
    const r = await lockMission(c, id);
    if (!r) throw refuse({ error: 'no_such_mission' });
    if (r.kind !== 'improve') throw refuse({ error: 'not_improve' });
    if (r.status !== 'waiting_approval') throw refuse({ error: 'mission_not_waiting', status: r.status });
    const e = r.presentation?.evolve as EvolveInfo | undefined;
    if (e?.state !== 'needs_owner') throw refuse({ error: 'not_needs_owner', state: e?.state ?? null });
    const { to, steps } = plan(r.status, ['approvalDone']);
    await write(c, r, { by: ACTOR, text: 'The owner approved the change; it is being deployed.', evolve: { state: 'deploying' }, status: to, now: io.now?.() ?? Date.now() });
    await recordSteps(c, r, steps, `evolve-${id}`);
    return { ok: true, id, status: to, state: 'deploying' };
  });
}

async function recover(io: CliIo) {
  const ids = (await io.pool.query(`select id from missions where tenant_id=$1 and deleted_at is null and presentation->'evolve'->>'state' = any($2::text[]) order by created_at, id`,
    [TENANT, IN_FLIGHT])).rows.map((x) => x.id as string);
  const recovered: string[] = [];
  for (const id of ids) {
    // one transaction per mission: never a second mission row lock after an event was written
    const done = await tx(io.pool, async (c) => {
      const r = await lockMission(c, id);
      if (!r || !IN_FLIGHT.includes(r.presentation?.evolve?.state)) return false;
      // a paused or canceled mission has no `fail` edge: its change is marked failed and its status is left as it is
      const { to, steps } = FAILABLE.includes(r.status) ? plan(r.status, ['fail']) : { to: r.status as MissionStatus, steps: [] };
      await write(c, r, { by: ACTOR, text: RECOVER_REASON, evolve: { state: 'failed' }, status: to, now: io.now?.() ?? Date.now() });
      await recordSteps(c, r, steps, `evolve-${id}`);
      return true;
    });
    if (done) recovered.push(id);
  }
  return { recovered };
}

function flag(argv: string[], name: string) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

async function file(argv: string[], io: CliIo) {
  const owner = flag(argv, '--owner'), text = flag(argv, '--text');
  if (!owner || text === undefined) throw usage('file --owner <user name> --text <mission text>');
  if (!text.trim()) throw usage('the mission text is empty');
  if (text.length > CAPS.missionText) throw badInput(`the mission text is longer than ${CAPS.missionText} characters`);
  const u = (await io.pool.query('select id, name, role, status from users where tenant_id=$1 and name_key=$2', [TENANT, normalizeName(owner).key])).rows[0];
  if (!u) throw refuse({ error: 'no_such_owner' });
  if (u.role !== 'admin' || u.status !== 'approved') throw refuse({ error: 'owner_not_admin' });
  const id = await tx(io.pool, (c) => createMission(c, { tenantId: TENANT, owner: { id: u.id, name: u.name }, text, files: [], shared: false, improve: true,
    actor: 'claude-code', actorKind: 'system', correlationId: `evolve-file-${Date.now()}`, presentation: { filedBy: 'claude-code' } }));
  // the API's staffing simulation never hears of this mission: take its steps here, one transaction each, no delay
  for (let i = 0; i < 64 && await tx(io.pool, (c) => staffingStep(c, id)); i++) { /* next step */ }
  const r = (await io.pool.query('select status, presentation from missions where id=$1', [id])).rows[0];
  if (r?.status !== 'running' || r?.presentation?.staffing?.stage !== 'working') throw refuse({ error: 'staffing_unfinished', id, status: r?.status });
  return { id };
}

const COMMANDS = 'halted | recover | next | progress <id> | finish <id> | approved <id> | file --owner <name> --text <text>';

/** The whole CLI without the process: tests call it in-process with their own pool. */
export async function runCli(argv: string[], io: CliIo): Promise<CliResult> {
  try {
    const cmd = argv[0];
    let out: Record<string, unknown>;
    if (cmd === 'halted') out = await halted(io.pool);
    else if (cmd === 'recover') out = await recover(io);
    else if (cmd === 'next') out = await next(io);
    else if (cmd === 'progress') out = await progress(argv, io);
    else if (cmd === 'finish') out = await finish(argv, io);
    else if (cmd === 'approved') out = await approved(argv, io);
    else if (cmd === 'file') out = await file(argv, io);
    else throw usage(`commands: ${COMMANDS}`);
    return { code: 0, out };
  } catch (e) {
    if (e instanceof Refusal) return { code: e.code, out: e.out };
    const code = String((e as { code?: unknown })?.code ?? (e as Error)?.name ?? 'ERROR');
    return { code: 1, out: { error: 'failed', code, message: String((e as Error)?.message ?? e).slice(0, 300) } };
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const ch of process.stdin) {
    size += (ch as Buffer).length;
    if (size > CAPS.stdinBytes) return ' '.repeat(CAPS.stdinBytes + 1); // refused by readJson; reading stops here
    chunks.push(ch as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const print = (o: unknown) => new Promise<void>((done) => process.stdout.write(JSON.stringify(o) + '\n', () => done()));
  const url = process.env.DATABASE_URL;
  if (!url) { await print({ error: 'no_database_url' }); process.exitCode = 1; return; }
  let r: CliResult;
  const pool = makePool(url, process.env.DATABASE_SCHEMA || undefined, 2);
  try {
    // only progress and finish read stdin (the runner always passes -i; another command never waits on it)
    const cmd = process.argv[2];
    r = await runCli(process.argv.slice(2), { pool, stdin: cmd === 'progress' || cmd === 'finish' ? readStdin : undefined });
  } finally { await pool.end().catch(() => {}); }
  await print(r.out);
  process.exitCode = r.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main();
