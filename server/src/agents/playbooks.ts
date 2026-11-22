import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { tx, type Tx } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError, notFound, badRequest } from '../errors.ts';
import { requireUser, requireAdmin, type Ctx } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { idempotent } from '../idempotency.ts';
import { emit } from '../events/hooks.ts';
import { getVisibleRow } from '../missions/service.ts';
import type { LessonCandidateDto, LessonConflict, PlaybookDiff, PlaybookDto, PlaybookItem, PlaybookVersionRow, SkillDto, SourceRef } from '../../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 41: reviewed playbooks and a skill library (ExpeL, ACE, Voyager, Agent Workflow Memory; spec Stage 9 knowledge:
 * sources, hashes, trust level, expiry, contradiction flags). RECORDS ONLY: nothing executes and no agent reads a playbook yet.
 *
 * Rules, all server-side:
 *  - A lesson candidate needs at least one source and never becomes active without a human decision.
 *  - The decider is never the proposer (nor the person who filed an agent's proposal). An agent can propose (service function
 *    proposeLesson, kind 'agent') but agents have no session, so they can never decide; the route is requireAdmin.
 *  - Accepting appends a NEW playbook version under a per-agent lock and a compare-and-set on baseVersion (gap-free: the table
 *    itself checks version = base_version + 1). Rollback is also a new version, equal to an older version's items.
 *  - A new item whose text conflicts with an item already in the playbook (findConflicts, deterministic) is accepted only with an
 *    explicit override note; the item is stored flagged `contradiction`.
 *  - review_by: past it (database clock) an item reports needsReReview.
 *  - Skills are QUOTED DATA that is never executed. They have a closed structure (enumerated step kinds, bounded text, a character
 *    allow-list, no URLs except a validated https `origin` on a navigate step). That limits what can be stored; it is not a
 *    security barrier against instruction injection, so any consumer must show or pass skill text as quoted data only. The old
 *    keyword filter stays as defence in depth. Lesson text follows the same character rule.
 *  - A rollback that would re-activate a lesson the actor proposed is refused (decider != proposer); lessons it removes become
 *    `superseded` (withdrawn_in_version).
 * Visibility (fail closed): administrators see every candidate and draft; others see accepted lessons, approved/retired skills and
 * their own proposals. Anything else is 404, as is a `mission` or `task` source the proposer cannot see. Members never receive
 * rollback notes, override notes or decision notes, and private (mission/task) source ids become a hidden chip.
 * Every write and every refused decision on an existing record is audited; events carry ids only (lesson text stays in audit).
 */
const Str = z.string().trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (d: string) => !Number.isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
/** Plain text: squashed, NFC, letters/marks/digits/space and common punctuation only (no backtick < > { } $ \\ | ~ ^, no control or zero-width characters), no links. */
const BAD_CHARS = /[^\p{L}\p{M}\p{N} .,;:!?'"()\-_/&%+=@#*[\]]/u;
const URLISH = /:\/\/|\bwww\./i;
const plain = (min: number, max: number) => z.string().transform((x) => squash(x).normalize('NFC'))
  .pipe(z.string().min(min).max(max).refine((x) => !BAD_CHARS.test(x) && !URLISH.test(x), 'Plain text only: letters, digits and common punctuation. No links, code characters or hidden characters.'));
/** The only way a URL gets into a skill: plain https, lower-case ASCII host with a dot, optional port, no path, no userinfo, no IDN (xn-- refused too). c36's origin normaliser is not in this tree, so this is the fail-closed subset. */
export function validOrigin(o: string): boolean {
  const m = /^https:\/\/((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?)(?::([0-9]{1,5}))?$/.exec(o);
  if (!m || o.length > 260 || m[1].split('.').some((l) => l.startsWith('xn--') || l.length > 63)) return false;
  return m[2] === undefined || Number(m[2]) <= 65535;
}
const Source = z.object({ kind: z.enum(['mission', 'failure_tag', 'review', 'task', 'note']), id: z.string().trim().regex(/^[A-Za-z0-9._:-]{1,80}$/, 'An id: letters, digits and . _ : -'), note: plain(1, 200).optional() }).strict();
const Sources = z.array(Source).min(1, 'At least one source is required').max(10);
const ProposeIn = z.object({ text: plain(1, 600), sources: Sources, reviewBy: z.string().regex(DATE, 'Use a date like 2026-12-31').refine(realDate, 'Not a real date').optional() }).strict();
const DecisionIn = z.object({ decision: z.enum(['accept', 'reject']), baseVersion: z.number().int().min(0).max(1_000_000).optional(), note: Str.max(1000).optional(), overrideNote: Str.min(1).max(1000).optional() }).strict();
const RollbackIn = z.object({ toVersion: z.number().int().min(1).max(1_000_000), baseVersion: z.number().int().min(0).max(1_000_000), why: Str.min(1).max(1000) }).strict();
const StepKind = z.enum(['navigate', 'observe', 'fill', 'click', 'check', 'ask_human', 'note']);
const Step = z.object({ kind: StepKind, target: plain(1, 80).optional(), detail: plain(1, 300), origin: z.string().refine(validOrigin, 'An origin is plain https://host (lower-case ASCII, no path, no IDN)').optional() }).strict()
  .refine((x) => x.origin === undefined || x.kind === 'navigate', { message: 'Only a navigate step takes an origin', path: ['origin'] });
const SkillIn = z.object({ name: plain(1, 80), description: plain(1, 500), steps: z.array(Step).min(1).max(20), preconditions: z.array(plain(1, 300)).max(10).default([]), sources: Sources }).strict();
const NoteIn = z.object({ note: Str.max(1000).optional() }).strict();
const VersionQ = z.object({ from: z.coerce.number().int().min(0), to: z.coerce.number().int().min(1) });
const ListQ = z.object({ agentId: Str.max(64).optional(), status: z.enum(['proposed', 'accepted', 'rejected', 'superseded']).optional() });

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const squash = (s: string) => s.trim().replace(/\s+/g, ' ');
const sha = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');

/* ---------- contradiction check (pure, deterministic) ---------- */
const NEG = new Set(['not', 'never', 'no', 'dont', 'cannot', 'cant', 'shouldnt', 'mustnt', 'wont', 'without', 'avoid', 'stop', 'nothing', 'none', 'neither']);
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'at', 'by', 'with', 'is', 'are', 'be', 'it', 'this', 'that', 'do', 'does', 'always', 'must', 'should', 'please', 'any', 'all', 'before', 'after', 'when', 'then', 'if', 'you', 'your', 'we', 'our', 'can', 'will', 'from', 'as', 'its', 'ever', 'only', 'use']);
const stem = (w: string) => (w.length > 5 && w.endsWith('ing') ? w.slice(0, -3) : w.length > 4 && w.endsWith('ed') ? w.slice(0, -2) : w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
/** Words of a lesson: negation flag and the content keywords (stop words and negations dropped, light stemming). */
export function lessonTerms(text: string): { negated: boolean; keys: Set<string> } {
  const words = text.toLowerCase().replace(/n['’]t\b/g, 'nt').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  let neg = 0;
  const keys = new Set<string>();
  for (const w of words) {
    if (NEG.has(w)) { neg++; continue; }
    if (STOP.has(w) || w.length < 3) continue;
    keys.add(stem(w));
  }
  return { negated: neg % 2 === 1, keys };
}
/** Two lessons conflict when they are about the same thing (most content keywords shared) and exactly one of them is negated. */
export function conflicts(a: string, b: string): boolean {
  const x = lessonTerms(a), y = lessonTerms(b);
  if (x.negated === y.negated) return false;
  const shared = [...x.keys].filter((k) => y.keys.has(k)).length;
  const small = Math.min(x.keys.size, y.keys.size);
  return small > 0 && shared >= Math.min(2, small) && shared / small >= 0.6;
}
export const findConflicts = (text: string, items: { lessonId: string; text: string }[]): LessonConflict[] =>
  items.filter((i) => conflicts(text, i.text)).map((i) => ({ lessonId: i.lessonId, text: i.text }));

/** Code-like text is refused in skills: a skill is a declarative description, never something to run. */
const CODE = /\bfunction\b|=>|\beval\b|<\s*script|\$\{|`{3}|\bexec\s*\(|\brequire\s*\(|\bimport\s+[\w{*]/i;
export const looksLikeCode = (s: string) => CODE.test(s);

/* ---------- reads ---------- */
const PLAYBOOK_SELECT = `select p.*, a.name as agent_name, u.name as created_by_name,
    (select coalesce(jsonb_agg(i.item || jsonb_build_object('needsReReview', coalesce((i.item->>'reviewBy')::date < current_date, false)) order by i.ord), '[]'::jsonb)
       from jsonb_array_elements(p.items) with ordinality as i(item, ord)) as items_x
  from playbooks p join agent_definitions a on a.id = p.agent_id left join users u on u.id = p.created_by`;
/** Only mission and task sources are checked against the tree (at propose time); the other kinds are typed strings and are flagged unverified. */
const shapeSource = (s: SourceRef, seeAll: boolean): SourceRef => {
  const verified = s.kind === 'mission' || s.kind === 'task';
  return !seeAll && verified ? { kind: s.kind, id: '', hidden: true, verified } : { ...s, verified };
};
/** What a person may read of an item: members get no override note and no private source ids. */
const itemView = (i: PlaybookItem, admin: boolean): PlaybookItem => ({ ...i, sources: i.sources.map((x) => shapeSource(x, admin)), overrideNote: admin ? i.overrideNote : null });
const playbookDto = (r: any, agent: { id: string; name: string; role: string }, admin: boolean): PlaybookDto => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  agentId: agent.id, agentName: agent.name, role: agent.role, version: r ? r.version : 0, items: r ? (r.items_x as PlaybookItem[]).map((i) => itemView(i, admin)) : [],
  kind: r?.kind ?? null, createdBy: r?.created_by ?? null, createdByName: r ? (r.created_by_name ?? r.created_by) : null, createdAt: r ? iso(r.created_at) : null,
  rollbackTo: r?.rollback_to ?? null, note: admin ? (r?.note ?? null) : null,
});
const agentOf = async (c: Tx, tenantId: string, id: string) => {
  const a = (await c.query('select id, name, role from agent_definitions where id=$1 and tenant_id=$2', [id, tenantId])).rows[0] as { id: string; name: string; role: string } | undefined;
  if (!a) throw notFound('No such agent.');
  return a;
};
const versionRow = async (c: Tx, tenantId: string, agentId: string, v: number | null) =>
  (await c.query(`${PLAYBOOK_SELECT} where p.tenant_id=$1 and p.agent_id=$2 ${v === null ? 'order by p.version desc' : 'and p.version=$3'} limit 1`, v === null ? [tenantId, agentId] : [tenantId, agentId, v])).rows[0];
const playbookLock = (c: Tx, tenantId: string, agentId: string) => c.query('select pg_advisory_xact_lock(hashtext($1))', [`playbook:${tenantId}:${agentId}`]);

const CAND_SELECT = `select c.*, to_char(c.review_by, 'YYYY-MM-DD') as review_text, a.name as agent_name,
    coalesce(pu.name, pa.name, c.proposed_by) as proposed_name, coalesce(du.name, c.decided_by) as decided_name
  from lesson_candidates c join agent_definitions a on a.id = c.agent_id
  left join users pu on pu.id = c.proposed_by and c.proposed_by_kind = 'human'
  left join agent_definitions pa on pa.id = c.proposed_by and c.proposed_by_kind = 'agent'
  left join users du on du.id = c.decided_by`;
const mine = (c: { proposed_by: string; submitted_by: string | null }, userId: string) => c.proposed_by === userId || c.submitted_by === userId;
/** The viewer's own rows, accepted lessons, and everything for an administrator. */
const visible = (ctx: Ctx, c: { proposed_by: string; submitted_by: string | null; status: string }) => ctx.user.role === 'admin' || c.status === 'accepted' || mine(c, ctx.user.id);

function candidateDto(r: any, ctx: Ctx, conflictsNow: LessonConflict[]): LessonCandidateDto { // eslint-disable-line @typescript-eslint/no-explicit-any
  const admin = ctx.user.role === 'admin';
  const self = mine(r, ctx.user.id);
  const proposed = r.status === 'proposed';
  return {
    id: r.id, agentId: r.agent_id, agentName: r.agent_name, role: r.role, text: r.text, sources: (r.sources as SourceRef[]).map((x) => shapeSource(x, admin || self)),
    proposedBy: r.proposed_by, proposedByName: r.proposed_name, proposedByKind: r.proposed_by_kind, submittedBy: r.submitted_by,
    status: r.status, sha256: r.sha256, reviewBy: r.review_text, createdAt: iso(r.created_at)!,
    decidedBy: r.decided_by, decidedByName: r.decided_by ? r.decided_name : null, decidedAt: iso(r.decided_at), decisionNote: admin ? r.decision_note : null, overrideNote: admin ? r.override_note : null,
    acceptedInVersion: r.accepted_in_version, withdrawnInVersion: r.withdrawn_in_version, conflicts: proposed ? conflictsNow : [],
    canDecide: proposed && admin && !self,
    cannotDecideWhy: !proposed ? null : !admin ? 'Only administrators decide.' : self ? 'You proposed this lesson. Another administrator must decide it.' : null,
  };
}
async function candidates(c: Tx, ctx: Ctx, where: string, params: unknown[]): Promise<LessonCandidateDto[]> {
  const n = params.length + 2; // the visibility rule is in the SQL, so the limit never drops a row this person may see
  const rows = (await c.query(`${CAND_SELECT} where c.tenant_id=$1 and ${where} and ($${n}::boolean or c.status='accepted' or c.proposed_by=$${n + 1} or c.submitted_by=$${n + 1}) order by c.created_at desc, c.id limit 200`,
    [ctx.tenantId, ...params, ctx.user.role === 'admin', ctx.user.id])).rows.filter((r) => visible(ctx, r));
  const items = new Map<string, { lessonId: string; text: string }[]>();
  for (const id of new Set(rows.filter((r) => r.status === 'proposed').map((r) => r.agent_id as string)))
    items.set(id, ((await versionRow(c, ctx.tenantId, id, null))?.items ?? []) as { lessonId: string; text: string }[]);
  return rows.map((r) => candidateDto(r, ctx, r.status === 'proposed' ? findConflicts(r.text, items.get(r.agent_id) ?? []) : []));
}

/* ---------- writes shared by the route and by an agent's proposal ---------- */
export interface ProposeArgs { tenantId: string; agentId: string; proposedBy: string; kind: 'human' | 'agent'; submittedBy?: string; text: string; sources: SourceRef[]; reviewBy?: string; correlationId: string }
/** Records a candidate. For kind 'agent', proposedBy is the agent and submittedBy the person who filed it: neither can decide it. */
export async function proposeLesson(c: Tx, a: ProposeArgs): Promise<string> {
  const agent = await agentOf(c, a.tenantId, a.agentId);
  if (a.reviewBy && (await c.query('select $1::date < current_date as past', [a.reviewBy])).rows[0].past)
    throw new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors: { reviewBy: 'The review date is already past.' } });
  const text = squash(a.text);
  const id = 'LC-' + randomBytes(16).toString('hex').toUpperCase(); // 128-bit
  await c.query(
    `insert into lesson_candidates(id, tenant_id, agent_id, role, text, sources, proposed_by, proposed_by_kind, submitted_by, sha256, review_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, a.tenantId, a.agentId, agent.role, text, JSON.stringify(a.sources), a.proposedBy, a.kind, a.submittedBy ?? null, sha([a.agentId, text, a.sources, a.reviewBy ?? null]), a.reviewBy ?? null]);
  const actor = a.submittedBy ?? a.proposedBy;
  await audit(c, { tenantId: a.tenantId, actor, action: 'playbook.propose', subject: id, result: 'ok', correlationId: a.correlationId, detail: { agentId: a.agentId, kind: a.kind, proposedBy: a.proposedBy, sources: a.sources.length, text } });
  await emit(c, { tenantId: a.tenantId, actor: a.proposedBy, actorKind: a.kind, correlationId: a.correlationId, type: 'playbook.lessonProposed', subject: a.agentId, subjectKind: 'agent', payload: { lessonId: id } });
  return id;
}

/** Every `mission` source must be a mission this person can see (404 otherwise, the same as opening it). */
async function checkSources(c: Tx, ctx: Ctx, sources: SourceRef[]) {
  for (const s of sources) {
    if (s.kind === 'mission') await getVisibleRow(c, ctx, s.id);
    if (s.kind === 'task') {
      const t = (await c.query('select mission_id from tasks where id=$1 and tenant_id=$2', [s.id, ctx.tenantId])).rows[0];
      if (!t) throw notFound('No such task.');
      await getVisibleRow(c, ctx, t.mission_id); // a task of a mission this person cannot see is the same 404
    }
  }
}
const codeFields = (b: { name: string; description: string; steps: { target?: string; detail: string }[]; preconditions: string[]; sources: SourceRef[] }) => {
  const bad: Record<string, string> = {};
  const msg = 'This looks like code. Skills are plain descriptions of steps and are never run.';
  if (looksLikeCode(b.name)) bad.name = msg;
  if (looksLikeCode(b.description)) bad.description = msg;
  if (b.steps.some((x) => looksLikeCode(x.detail) || looksLikeCode(x.target ?? ''))) bad.steps = msg;
  if (b.preconditions.some(looksLikeCode)) bad.preconditions = msg;
  if (b.sources.some((x) => looksLikeCode(x.id) || looksLikeCode(x.note ?? ''))) bad.sources = msg;
  return bad;
};

const SKILL_SELECT = `select s.*, coalesce(pu.name, s.proposed_by) as proposed_name, au.name as approved_name from skills s
  left join users pu on pu.id = s.proposed_by and s.proposed_by_kind = 'human' left join users au on au.id = s.approved_by`;
function skillDto(r: any, ctx: Ctx): SkillDto { // eslint-disable-line @typescript-eslint/no-explicit-any
  const self = mine(r, ctx.user.id), draft = r.status === 'draft', admin = ctx.user.role === 'admin';
  return {
    id: r.id, name: r.name, version: r.version, description: r.description, steps: r.steps, preconditions: r.preconditions, sources: (r.sources as SourceRef[]).map((x) => shapeSource(x, admin || self)), status: r.status,
    proposedBy: r.proposed_by, proposedByName: r.proposed_name, createdAt: iso(r.created_at)!,
    approvedBy: r.approved_by, approvedByName: r.approved_by ? (r.approved_name ?? r.approved_by) : null, approvedAt: iso(r.approved_at), retiredBy: r.retired_by, retiredAt: iso(r.retired_at), retireNote: admin ? r.retire_note : null,
    canDecide: draft && admin && !self, cannotDecideWhy: !draft ? null : !admin ? 'Only administrators approve.' : self ? 'You proposed this skill. Another administrator must approve it.' : null,
  };
}
const skillVisible = (ctx: Ctx, r: { proposed_by: string; submitted_by: string | null; status: string }) => ctx.user.role === 'admin' || r.status !== 'draft' || mine(r, ctx.user.id);
/** The lock key folds case in SQL, the same way the unique index does (lower()), so JS and SQL can never disagree on a name. */
const skillLock = (c: Tx, tenantId: string, name: string) => c.query(`select pg_advisory_xact_lock(hashtext('skill:' || $1 || ':' || lower($2)))`, [tenantId, name]);

export default async function playbookRoutes(app: FastifyInstance) {
  /** A refusal on an existing record is audited and the transaction still commits; the error is thrown after commit. */
  const refuse = async (c: Tx, ctx: Ctx, action: string, id: string, err: ApiError) => {
    await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action, subject: id, result: 'denied', correlationId: ctx.correlationId, detail: { code: err.code } });
    return { err };
  };

  /* ----- playbooks ----- */
  app.get('/agents/:id/playbook', async (req) => {
    const ctx = await requireUser(req);
    const { id } = req.params as { id: string };
    return tx(app.db, async (c) => {
      const agent = await agentOf(c, ctx.tenantId, id);
      const cur = await versionRow(c, ctx.tenantId, id, null);
      const versions = (await c.query(
        `select p.version, p.kind, jsonb_array_length(p.items)::int as n, p.created_by, coalesce(u.name, p.created_by) as by_name, p.created_at, p.rollback_to, p.note, p.lesson_id
           from playbooks p left join users u on u.id = p.created_by where p.tenant_id=$1 and p.agent_id=$2 order by p.version desc limit 200`, [ctx.tenantId, id])).rows;
      const history: PlaybookVersionRow[] = versions.map((v) => ({ version: v.version, kind: v.kind, items: v.n, createdBy: v.created_by, createdByName: v.by_name, createdAt: iso(v.created_at)!, rollbackTo: v.rollback_to, note: ctx.user.role === 'admin' ? v.note : null, lessonId: v.lesson_id }));
      return { playbook: playbookDto(cur, agent, ctx.user.role === 'admin'), versions: history };
    });
  });

  app.get('/agents/:id/playbook/versions/:v', async (req) => {
    const ctx = await requireUser(req);
    const { id, v } = req.params as { id: string; v: string };
    return tx(app.db, async (c) => {
      const agent = await agentOf(c, ctx.tenantId, id);
      const row = /^\d{1,7}$/.test(v) ? await versionRow(c, ctx.tenantId, id, Number(v)) : undefined;
      if (!row) throw notFound('No such playbook version.');
      return { playbook: playbookDto(row, agent, ctx.user.role === 'admin') };
    });
  });

  app.get('/agents/:id/playbook/diff', async (req) => {
    const ctx = await requireUser(req);
    const { id } = req.params as { id: string };
    const q = parse(VersionQ, req.query ?? {});
    return tx(app.db, async (c) => {
      await agentOf(c, ctx.tenantId, id);
      const get = async (n: number) => (n === 0 ? [] : ((await versionRow(c, ctx.tenantId, id, n))?.items_x as PlaybookItem[] | undefined));
      const a = await get(q.from), b = await get(q.to);
      if (!a || !b) throw notFound('No such playbook version.');
      const inB = new Set(b.map((i) => i.lessonId)), inA = new Set(a.map((i) => i.lessonId));
      const adm = ctx.user.role === 'admin';
      const diff: PlaybookDiff = { from: q.from, to: q.to, added: b.filter((i) => !inA.has(i.lessonId)).map((i) => itemView(i, adm)), removed: a.filter((i) => !inB.has(i.lessonId)).map((i) => itemView(i, adm)), kept: b.filter((i) => inA.has(i.lessonId)).length };
      return { diff };
    });
  });

  app.get('/lessons', async (req) => {
    const ctx = await requireUser(req);
    const q = parse(ListQ, req.query ?? {});
    return tx(app.db, async (c) => {
      const where: string[] = ['true'];
      const params: unknown[] = [];
      if (q.agentId) { params.push(q.agentId); where.push(`c.agent_id=$${params.length + 1}`); }
      if (q.status) { params.push(q.status); where.push(`c.status=$${params.length + 1}`); }
      return { lessons: await candidates(c, ctx, where.join(' and '), params) };
    });
  });

  app.get('/lessons/:lid', async (req) => {
    const ctx = await requireUser(req);
    const { lid } = req.params as { lid: string };
    return tx(app.db, async (c) => {
      const l = (await candidates(c, ctx, 'c.id=$2', [lid]))[0]; // not visible to this person = the same 404 as no such lesson
      if (!l) throw notFound('No such lesson.');
      return { lesson: l };
    });
  });

  app.post('/agents/:id/lessons', async (req, reply) => {
    const ctx = await requireUser(req);
    const { id } = req.params as { id: string };
    const b = parse(ProposeIn, req.body);
    const out = await idempotent(app.db, req, ctx, async (c) => {
      await agentOf(c, ctx.tenantId, id);
      await checkSources(c, ctx, b.sources);
      const lid = await proposeLesson(c, { tenantId: ctx.tenantId, agentId: id, proposedBy: ctx.user.id, kind: 'human', text: b.text, sources: b.sources, reviewBy: b.reviewBy, correlationId: ctx.correlationId });
      return { status: 201, body: { lesson: (await candidates(c, ctx, 'c.id=$2', [lid]))[0] } };
    });
    return reply.status(out.status).send(out.body);
  });

  app.post('/lessons/:lid/decision', async (req) => {
    const ctx = await requireAdmin(req);
    const { lid } = req.params as { lid: string };
    const b = parse(DecisionIn, req.body);
    const A = 'playbook.decide';
    const out = await tx(app.db, async (c): Promise<{ err: ApiError } | { lesson: LessonCandidateDto; playbook: PlaybookDto | null }> => {
      const head = (await c.query('select agent_id from lesson_candidates where id=$1 and tenant_id=$2', [lid, ctx.tenantId])).rows[0];
      if (!head) return refuse(c, ctx, A, lid, notFound('No such lesson.'));
      await playbookLock(c, ctx.tenantId, head.agent_id); // the lock first, as its own statement; then read
      const l = (await c.query(`select *, to_char(review_by, 'YYYY-MM-DD') as review_text from lesson_candidates where id=$1 and tenant_id=$2 for update`, [lid, ctx.tenantId])).rows[0];
      if (mine(l, ctx.user.id)) return refuse(c, ctx, A, lid, new ApiError('SELF_APPROVAL', 403, 'You proposed this lesson. Another administrator must decide it.'));
      if (l.status !== 'proposed') return refuse(c, ctx, A, lid, new ApiError('PROPOSAL_NOT_PENDING', 409, `This lesson is already ${l.status}.`));
      const agent = await agentOf(c, ctx.tenantId, l.agent_id);
      const note = b.note || null;
      if (b.decision === 'reject') {
        await c.query(`update lesson_candidates set status='rejected', decided_by=$2, decided_at=now(), decision_note=$3 where id=$1`, [lid, ctx.user.id, note]);
        await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: A, subject: lid, result: 'ok', correlationId: ctx.correlationId, detail: { decision: 'reject', agentId: l.agent_id, note } });
        await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'playbook.lessonDecided', subject: l.agent_id, subjectKind: 'agent', payload: { lessonId: lid, status: 'rejected' } });
        return { lesson: (await candidates(c, ctx, 'c.id=$2', [lid]))[0], playbook: null };
      }
      const cur = await versionRow(c, ctx.tenantId, l.agent_id, null);
      const curVersion: number = cur?.version ?? 0;
      if (b.baseVersion === undefined) throw badRequest('Some fields are not valid.', { baseVersion: 'Send the playbook version you reviewed.' });
      if (b.baseVersion !== curVersion)
        return refuse(c, ctx, A, lid, new ApiError('CONFLICT', 409, `The playbook changed meanwhile (version ${curVersion} is current, you reviewed ${b.baseVersion}). Reload it and decide again.`));
      const items = (cur?.items ?? []) as PlaybookItem[];
      if (items.some((i) => squash(i.text).toLowerCase() === squash(l.text).toLowerCase()))
        return refuse(c, ctx, A, lid, new ApiError('DUPLICATE_PROPOSAL', 409, 'The playbook already holds this lesson. Reject this candidate.'));
      const clash = findConflicts(l.text, items);
      if (clash.length && !b.overrideNote)
        return refuse(c, ctx, A, lid, new ApiError('CONFLICT', 409, `This lesson seems to contradict ${clash.length === 1 ? 'an item' : clash.length + ' items'} already in the playbook. Accept it only with an override note that says why both can stand.`, { fieldErrors: { overrideNote: 'An override note is required: this contradicts an existing item.' } }));
      const version = curVersion + 1;
      const item: PlaybookItem = {
        lessonId: lid, text: l.text, trust: 'reviewed', addedInVersion: version, sources: l.sources, sha256: l.sha256, reviewBy: l.review_text,
        contradiction: clash.length > 0, contradicts: clash.map((x) => x.lessonId), overrideNote: clash.length ? b.overrideNote! : null, needsReReview: false,
      };
      const stored = { ...item } as Partial<PlaybookItem>;
      delete stored.needsReReview; // computed on read, on the database clock
      const pid = 'PB-' + randomBytes(16).toString('hex').toUpperCase();
      await c.query('savepoint pb_insert'); // a unique violation aborts the transaction; the savepoint lets the refusal still be audited
      try {
        await c.query(`insert into playbooks(id, tenant_id, agent_id, role, version, base_version, items, kind, lesson_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,'accept',$8,$9)`,
          [pid, ctx.tenantId, l.agent_id, agent.role, version, curVersion, JSON.stringify([...items.map((i) => { const x = { ...i } as Partial<PlaybookItem>; delete x.needsReReview; return x; }), stored]), lid, ctx.user.id]);
      } catch (e) {
        if ((e as { code?: string }).code === '23505') {
          await c.query('rollback to savepoint pb_insert');
          return refuse(c, ctx, A, lid, new ApiError('CONFLICT', 409, 'The playbook changed meanwhile. Reload it and decide again.'));
        }
        throw e;
      }
      await c.query('release savepoint pb_insert');
      await c.query(`update lesson_candidates set status='accepted', decided_by=$2, decided_at=now(), decision_note=$3, override_note=$4, accepted_in_version=$5 where id=$1`, [lid, ctx.user.id, note, item.overrideNote, version]);
      // another proposal with the very same text is now redundant: closed by the system, never silently dropped
      const dup = (await c.query(
        `update lesson_candidates set status='superseded', decided_by='system', decided_at=now(), decision_note=$3
          where tenant_id=$1 and agent_id=$2 and status='proposed' and id <> $4 and lower(regexp_replace(btrim(text), '\\s+', ' ', 'g')) = $5 returning id`,
        [ctx.tenantId, l.agent_id, 'Same text as ' + lid, lid, squash(l.text).toLowerCase()])).rows.map((r) => r.id as string);
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: A, subject: lid, result: 'ok', correlationId: ctx.correlationId, detail: { decision: 'accept', agentId: l.agent_id, version, fromVersion: curVersion, contradicts: item.contradicts, overrideNote: item.overrideNote, note, superseded: dup } });
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'playbook.lessonDecided', subject: l.agent_id, subjectKind: 'agent', payload: { lessonId: lid, status: 'accepted', version } });
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'playbook.versionCreated', subject: l.agent_id, subjectKind: 'agent', payload: { version, lessonId: lid } });
      return { lesson: (await candidates(c, ctx, 'c.id=$2', [lid]))[0], playbook: playbookDto(await versionRow(c, ctx.tenantId, l.agent_id, version), agent, true) };
    });
    if ('err' in out) throw out.err;
    return out;
  });

  app.post('/agents/:id/playbook/rollback', async (req) => {
    const ctx = await requireAdmin(req);
    const { id } = req.params as { id: string };
    const b = parse(RollbackIn, req.body);
    const A = 'playbook.rollback';
    const out = await tx(app.db, async (c): Promise<{ err: ApiError } | { playbook: PlaybookDto; versions: number }> => {
      const agent = await agentOf(c, ctx.tenantId, id);
      await playbookLock(c, ctx.tenantId, id);
      const cur = await versionRow(c, ctx.tenantId, id, null);
      if (!cur) return refuse(c, ctx, A, id, new ApiError('NOTHING_TO_ROLL_BACK', 422, 'This playbook has no version yet.'));
      if (b.baseVersion !== cur.version) return refuse(c, ctx, A, id, new ApiError('CONFLICT', 409, `The playbook changed meanwhile (version ${cur.version} is current, you saw ${b.baseVersion}). Reload it and try again.`));
      if (b.toVersion === cur.version) return refuse(c, ctx, A, id, new ApiError('ALREADY_ACTIVE', 422, `Version ${cur.version} is already the current one.`));
      const target = b.toVersion < cur.version ? await versionRow(c, ctx.tenantId, id, b.toVersion) : undefined;
      if (!target) return refuse(c, ctx, A, id, notFound('No such playbook version.'));
      if (JSON.stringify(target.items) === JSON.stringify(cur.items)) return refuse(c, ctx, A, id, new ApiError('SAME_CONFIG', 422, `Version ${cur.version} already holds the same items as version ${target.version}.`));
      // decider != proposer holds for a rollback too: it must not put back a lesson the actor proposed
      const curIds = new Set((cur.items as PlaybookItem[]).map((i) => i.lessonId)), tgtIds = new Set((target.items as PlaybookItem[]).map((i) => i.lessonId));
      const back = [...tgtIds].filter((x) => !curIds.has(x)), gone = [...curIds].filter((x) => !tgtIds.has(x));
      if (back.length && (await c.query('select 1 from lesson_candidates where id = any($1) and (proposed_by=$2 or submitted_by=$2)', [back, ctx.user.id])).rowCount)
        return refuse(c, ctx, A, id, new ApiError('SELF_APPROVAL', 403, 'This rollback would put back a lesson you proposed. Another administrator must do it.'));
      const version = cur.version + 1;
      const pid = 'PB-' + randomBytes(16).toString('hex').toUpperCase();
      await c.query('savepoint pb_insert');
      try {
        await c.query(`insert into playbooks(id, tenant_id, agent_id, role, version, base_version, items, kind, rollback_to, note, created_by) values ($1,$2,$3,$4,$5,$6,$7,'rollback',$8,$9,$10)`,
          [pid, ctx.tenantId, id, agent.role, version, cur.version, JSON.stringify(target.items), target.version, b.why, ctx.user.id]); // the target's items, verbatim
      } catch (e) {
        if ((e as { code?: string }).code === '23505') {
          await c.query('rollback to savepoint pb_insert');
          return refuse(c, ctx, A, id, new ApiError('CONFLICT', 409, 'The playbook changed meanwhile. Reload it and try again.'));
        }
        throw e;
      }
      await c.query('release savepoint pb_insert');
      if (gone.length) await c.query(`update lesson_candidates set status='superseded', withdrawn_in_version=$2 where id = any($1) and status='accepted'`, [gone, version]); // withdrawn by this rollback
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: A, subject: id, result: 'ok', correlationId: ctx.correlationId, detail: { why: b.why, fromVersion: cur.version, toVersion: target.version, newVersion: version, withdrawn: gone, restored: back } });
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'playbook.versionCreated', subject: id, subjectKind: 'agent', payload: { version, rollbackTo: target.version } }); // the reason stays in the audit row
      return { playbook: playbookDto(await versionRow(c, ctx.tenantId, id, version), agent, true), versions: version };
    });
    if ('err' in out) throw out.err;
    return out;
  });

  /* ----- skills ----- */
  app.get('/skills', async (req) => {
    const ctx = await requireUser(req);
    return tx(app.db, async (c) => {
      const rows = (await c.query(`${SKILL_SELECT} where s.tenant_id=$1 and ($2::boolean or s.status <> 'draft' or s.proposed_by=$3 or s.submitted_by=$3) order by lower(s.name), s.version desc limit 300`,
        [ctx.tenantId, ctx.user.role === 'admin', ctx.user.id])).rows.filter((r) => skillVisible(ctx, r));
      return { skills: rows.map((r) => skillDto(r, ctx)) };
    });
  });

  app.get('/skills/:sid', async (req) => {
    const ctx = await requireUser(req);
    const { sid } = req.params as { sid: string };
    return tx(app.db, async (c) => {
      const r = (await c.query(`${SKILL_SELECT} where s.id=$1 and s.tenant_id=$2`, [sid, ctx.tenantId])).rows[0];
      if (!r || !skillVisible(ctx, r)) throw notFound('No such skill.');
      return { skill: skillDto(r, ctx) };
    });
  });

  app.post('/skills', async (req, reply) => {
    const ctx = await requireUser(req);
    const b = parse(SkillIn, req.body);
    const bad = codeFields(b);
    if (Object.keys(bad).length) throw badRequest('Skills hold plain steps, never code.', bad);
    const out = await idempotent(app.db, req, ctx, async (c) => {
      await checkSources(c, ctx, b.sources);
      await skillLock(c, ctx.tenantId, b.name); // b.name is already squashed and NFC (the schema), the same value that is stored
      const version = ((await c.query('select coalesce(max(version), 0)::int as v from skills where tenant_id=$1 and lower(name)=lower($2)', [ctx.tenantId, b.name])).rows[0].v as number) + 1;
      const id = 'SK-' + randomBytes(16).toString('hex').toUpperCase();
      await c.query(`insert into skills(id, tenant_id, name, version, description, steps, preconditions, sources, proposed_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, ctx.tenantId, b.name, version, b.description, JSON.stringify(b.steps), JSON.stringify(b.preconditions), JSON.stringify(b.sources), ctx.user.id]);
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'skill.propose', subject: id, result: 'ok', correlationId: ctx.correlationId, detail: { name: b.name, version, steps: b.steps.length, sources: b.sources.length } });
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'skill.proposed', subject: id, subjectKind: 'skill', payload: { skillId: id, version } });
      return { status: 201, body: { skill: skillDto((await c.query(`${SKILL_SELECT} where s.id=$1`, [id])).rows[0], ctx) } };
    });
    return reply.status(out.status).send(out.body);
  });

  const decideSkill = (action: 'approve' | 'retire') => async (req: import('fastify').FastifyRequest) => {
    const ctx = await requireAdmin(req);
    const { sid } = req.params as { sid: string };
    const b = parse(NoteIn, req.body);
    const A = 'skill.' + action;
    const out = await tx(app.db, async (c): Promise<{ err: ApiError } | { skill: SkillDto }> => {
      const head = (await c.query('select name from skills where id=$1 and tenant_id=$2', [sid, ctx.tenantId])).rows[0];
      if (!head) return refuse(c, ctx, A, sid, notFound('No such skill.'));
      await skillLock(c, ctx.tenantId, head.name);
      const s = (await c.query('select * from skills where id=$1 and tenant_id=$2 for update', [sid, ctx.tenantId])).rows[0];
      if (action === 'approve') {
        if (mine(s, ctx.user.id)) return refuse(c, ctx, A, sid, new ApiError('SELF_APPROVAL', 403, 'You proposed this skill. Another administrator must approve it.'));
        if (s.status !== 'draft') return refuse(c, ctx, A, sid, new ApiError('PROPOSAL_NOT_PENDING', 409, `This skill is already ${s.status}.`));
        // one approved version per name: the previous one is retired, never edited or deleted
        const old = (await c.query(`update skills set status='retired', retired_by=$3, retired_at=now(), retire_note=$4 where tenant_id=$1 and lower(name)=lower($2) and status='approved' returning id`,
          [ctx.tenantId, s.name, ctx.user.id, `Replaced by version ${s.version}`])).rows.map((r) => r.id as string);
        await c.query(`update skills set status='approved', approved_by=$2, approved_at=now() where id=$1`, [sid, ctx.user.id]);
        await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: A, subject: sid, result: 'ok', correlationId: ctx.correlationId, detail: { name: s.name, version: s.version, retired: old } });
      } else {
        if (s.status === 'retired') return refuse(c, ctx, A, sid, new ApiError('PROPOSAL_NOT_PENDING', 409, 'This skill is already retired.'));
        await c.query(`update skills set status='retired', retired_by=$2, retired_at=now(), retire_note=$3 where id=$1`, [sid, ctx.user.id, b.note || null]);
        await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: A, subject: sid, result: 'ok', correlationId: ctx.correlationId, detail: { name: s.name, version: s.version, note: b.note || null } });
      }
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'skill.decided', subject: sid, subjectKind: 'skill', payload: { skillId: sid, status: action === 'approve' ? 'approved' : 'retired' } });
      return { skill: skillDto((await c.query(`${SKILL_SELECT} where s.id=$1`, [sid])).rows[0], ctx) };
    });
    if ('err' in out) throw out.err;
    return out;
  };
  app.post('/skills/:sid/approve', decideSkill('approve'));
  app.post('/skills/:sid/retire', decideSkill('retire'));
}
