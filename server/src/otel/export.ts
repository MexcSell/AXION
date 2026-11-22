import { createHash } from 'node:crypto';
import type { Db, Tx } from '../db.ts';
import { ALL_PINNED_ATTRIBUTES, CONTENT_ATTRIBUTES, OTEL_GENAI_SPEC, PINNED_SPANS, type PinnedSpan } from './pinned.ts';
import { FIELD_MAP } from './mapping.ts';

/**
 * Improvement cycle 60 (R2-8): export of stored task and trace records of ONE mission to OTLP JSON (the OpenTelemetry protocol's JSON
 * encoding of traces), written to a local file by the CLI (cli.ts). Records only: nothing is sent anywhere, no collector is involved,
 * nothing here executes anything. Which AXION field goes where is the table in mapping.ts (and web/docs/improve/phase2/otel-mapping.md);
 * every attribute written is checked against the pinned spec (pinned.ts) by `validateOtlp`.
 * Content (text a person or an agent wrote) is OFF: a pointer "axion://table/id#field" replaces it unless `includeContent` is set.
 */
type Row = Record<string, any>;
export interface MissionRecords {
  tenantId: string; missionId: string;
  instances: Row[]; tasks: Row[]; attempts: Row[]; evalResults: Row[]; tags: Row[]; attributions: Row[];
}
export interface OtlpValue { stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean }
export interface OtlpAttr { key: string; value: OtlpValue }
export interface OtlpEvent { timeUnixNano: string; name: string; attributes: OtlpAttr[] }
export interface OtlpSpan {
  traceId: string; spanId: string; parentSpanId: string; name: string; kind: number; startTimeUnixNano: string; endTimeUnixNano: string;
  attributes: OtlpAttr[]; events: OtlpEvent[]; status: { code?: number };
}
export interface OtlpDoc { resourceSpans: { resource: { attributes: OtlpAttr[] }; scopeSpans: { scope: { name: string; version: string }; spans: OtlpSpan[] }[] }[] }
export interface ExportOptions { includeContent?: boolean }

/** One transaction for all reads: REPEATABLE READ (one snapshot) and READ ONLY, with default_transaction_read_only on for its length (SET LOCAL, so a pooled connection is not left read-only). */
export async function withReadOnlySnapshot<T>(db: Db, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      await c.query('SET LOCAL default_transaction_read_only = on');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  } finally { c.release(); }
}

/**
 * Reads the stored records of one mission (tenant-checked) in ONE read-only snapshot: a REPEATABLE READ READ ONLY transaction on one connection
 * (so the records agree with each other, and a write could not succeed). A missing, deleted or other-tenant mission is the same error.
 */
export async function loadMissionRecords(db: Db, tenantId: string, missionId: string): Promise<MissionRecords>;
export async function loadMissionRecords(db: Db, tenantId: string, missionId: string, withDatabase: true): Promise<{ rec: MissionRecords; database: string }>;
export async function loadMissionRecords(db: Db, tenantId: string, missionId: string, withDatabase?: boolean): Promise<MissionRecords | { rec: MissionRecords; database: string }> {
  const out = await withReadOnlySnapshot(db, async (c) => {
    const database = String((await c.query('select current_database() as d')).rows[0].d);
    const m = (await c.query(`select id from missions where id=$1 and tenant_id=$2 and deleted_at is null`, [missionId, tenantId])).rows[0];
    if (!m) throw new Error(`No such mission "${missionId}" in tenant "${tenantId}".`);
    const rows = async (sql: string, p: unknown[]) => (await c.query(sql, p)).rows as Row[];
    const instances = await rows(`select i.*, d.name as agent_name from agent_instances i join agent_definitions d on d.id=i.agent_id where i.mission_id=$1 and i.tenant_id=$2 order by i.seq`, [missionId, tenantId]);
    const tasks = await rows(`select * from tasks where mission_id=$1 and tenant_id=$2 order by created_at, id`, [missionId, tenantId]);
    const attempts = await rows(`select a.* from task_attempts a join tasks t on t.id=a.task_id where t.mission_id=$1 and t.tenant_id=$2 order by a.task_id, a.attempt_no`, [missionId, tenantId]);
    // evaluation results are not stored per mission: those of runs whose subject version one of the mission's instances pinned are the mission's
    const evalResults = await rows(`select res.run_id, ru.dataset_id, ru.subject_version_id, ru.k, ru.judge_model_family, res.case_id, res.attempt, res.score, res.cost_units, res.recorded_at, res.trace
          from eval_results res join eval_runs ru on ru.id=res.run_id
          where ru.tenant_id=$1 and ru.subject_version_id in (select agent_version_id from agent_instances where mission_id=$2 and tenant_id=$1)
          order by res.recorded_at, res.run_id, res.case_id, res.attempt`, [tenantId, missionId]);
    const tags = await rows(`select * from failure_tags where mission_id=$1 and tenant_id=$2 order by created_at, id`, [missionId, tenantId]);
    const attributions = await rows(`select * from failure_attributions where mission_id=$1 and tenant_id=$2 order by created_at, id`, [missionId, tenantId]);
    return { rec: { tenantId, missionId, instances, tasks, attempts, evalResults, tags, attributions } as MissionRecords, database };
  });
  return withDatabase ? out : out.rec;
}

const ms = (x: unknown): number | null => { if (x === null || x === undefined) return null; const n = new Date(x as string).getTime(); return Number.isFinite(n) ? n : null; };
const nano = (millis: number) => (BigInt(millis) * 1_000_000n).toString();
const hex = (s: string, n: number) => createHash('sha256').update(s).digest('hex').slice(0, n);
const val = (v: string | number | boolean): OtlpValue => typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { boolValue: v } : Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
type Attrs = Map<string, string | number | boolean>;
const toAttrs = (a: Attrs): OtlpAttr[] => [...a.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([key, v]) => ({ key, value: val(v) }));
const num = (x: unknown): number | null => { if (x === null || x === undefined || x === '') return null; const n = Number(x); return Number.isFinite(n) ? n : null; };
const asText = (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x));
const present = (x: unknown) => x !== null && x !== undefined && x !== '' && !(Array.isArray(x) && x.length === 0);
/** error.type values AXION will write from a stored error: a fixed vocabulary; anything else is "_OTHER" (the OpenTelemetry convention for an unknown value). */
export const ERROR_TYPES: ReadonlySet<string> = new Set(['timeout', 'rate_limit', 'not_found', 'permission_denied', 'invalid_input', 'unavailable', 'cancelled', 'internal_error']);
const SECRET_SHAPE = /^(sk|pk|rk)[-_.]|^(ghp|gho|ghs|xox[a-z]|AKIA|eyJ)/i; // defence in depth; the character class is the real guard
/** Untrusted text that must be a plain identifier to be exported (tool names, case ids...). Anything else is "_OTHER". */
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.]{0,47}$/;
const ident = (x: unknown, re: RegExp = /^[A-Za-z0-9][A-Za-z0-9_.:\/-]{0,63}$/): string => (typeof x === 'string' && re.test(x) && !SECRET_SHAPE.test(x) ? x : '_OTHER');
const toolName = (x: string) => ident(x, TOOL_NAME);
const agentName = (x: string) => ident(x, /^[A-Za-z0-9][A-Za-z0-9 _.:-]{0,63}$/);

interface Node { key: string; parent: string | null; name: string; start: number; end: number | null; attrs: Attrs; events: { at: number; name: string; attrs: Attrs }[]; error: boolean; kids: Node[] }

export function buildOtlp(rec: MissionRecords, opts: ExportOptions = {}): OtlpDoc {
  const inc = opts.includeContent === true;
  const trace = hex(`axion-otlp|trace|${rec.tenantId}|${rec.missionId}`, 32);
  const nodes = new Map<string, Node>();
  const add = (key: string, parent: string | null, name: string, start: number, end: number | null, attrs: Attrs, error = false): Node => {
    const n: Node = { key, parent, name, start, end, attrs, events: [], error, kids: [] };
    nodes.set(key, n); return n;
  };
  /** A content field: the pointer by default, the text (under the inline key) only with includeContent. */
  const content = (attrs: Attrs, fieldKey: string, ref: string, value: unknown, inlineOverride?: string) => {
    const c = FIELD_MAP[fieldKey]?.content; if (!c || !present(value)) return;
    if (inc) attrs.set(inlineOverride ?? c.inlineKey, asText(value)); else attrs.set(c.refKey, ref);
  };
  const first = Math.min(...[...rec.instances, ...rec.tasks].map((r) => ms(r.created_at) ?? Infinity), ...rec.evalResults.map((r) => ms(r.recorded_at) ?? Infinity), ...rec.tags.map((r) => ms(r.created_at) ?? Infinity));
  const t0 = Number.isFinite(first) ? first : 0;
  const rootKey = 'mission';
  add(rootKey, null, 'axion.mission', t0, null, new Map<string, string | number | boolean>([['axion.mission.id', rec.missionId]]));

  const agentNameOf = new Map<string, string>(); // instance id -> agent name
  for (const i of rec.instances) {
    const rawName = typeof i.agent_name === 'string' && i.agent_name.trim() ? i.agent_name.trim() : '';
    const name = rawName ? agentName(rawName) : '';
    if (name) agentNameOf.set(i.id, name);
    const a: Attrs = new Map<string, string | number | boolean>([['gen_ai.operation.name', 'invoke_agent'], ['gen_ai.conversation.id', rec.missionId], ['axion.instance.id', i.id], ['axion.agent.id', i.agent_id], ['axion.agent.version_id', String(i.agent_version_id)], ['axion.instance.state', i.state], ['axion.simulated', !!i.simulated]]);
    if (name) a.set('gen_ai.agent.name', name);
    if (inc && rawName && rawName !== name) a.set('axion.agent.name_raw', rawName);
    if (i.run_id !== null && i.run_id !== undefined) a.set('axion.instance.run_id', Number(i.run_id));
    if (i.manager_instance_id) a.set('axion.instance.manager_id', i.manager_instance_id);
    content(a, 'agent_instances.task_label', `axion://agent_instances/${i.id}#task_label`, i.task_label);
    add(`instance:${i.id}`, rootKey, name ? `invoke_agent ${name}` : 'invoke_agent', ms(i.created_at) ?? t0, ms(i.ended_at), a);
  }
  const instanceOf = (id: unknown) => (typeof id === 'string' && nodes.has(`instance:${id}`) ? `instance:${id}` : null);
  const nameSuffix = (parentKey: string | null) => { const n = parentKey ? nodes.get(parentKey)?.attrs.get('gen_ai.agent.name') : undefined; return typeof n === 'string' ? n : ''; };

  for (const t of rec.tasks) {
    const owner = instanceOf(t.owner_instance_id);
    const agent = owner ? nameSuffix(owner) : '';
    const failed = t.status === 'failed';
    const a: Attrs = new Map<string, string | number | boolean>([['gen_ai.operation.name', 'invoke_agent'], ['gen_ai.conversation.id', rec.missionId], ['axion.task.id', t.id], ['axion.task.status', t.status], ['axion.task.weight', Number(t.weight ?? 1)], ['axion.task.evidence_count', Number(t.evidence ?? 0)], ['axion.simulated', !!t.simulated]]);
    if (agent) a.set('gen_ai.agent.name', agent);
    if (t.run_id !== null && t.run_id !== undefined) a.set('axion.task.run_id', Number(t.run_id));
    content(a, 'tasks.owner_agent', `axion://tasks/${t.id}#owner_agent`, t.owner_agent);
    if (failed) a.set('error.type', 'task_failed');
    content(a, 'tasks.title', `axion://tasks/${t.id}#title`, t.title);
    content(a, 'tasks.criteria', `axion://tasks/${t.id}#criteria`, t.criteria);
    add(`task:${t.id}`, owner ?? rootKey, agent ? `invoke_agent ${agent}` : 'invoke_agent', ms(t.created_at) ?? t0, null, a, failed);
  }
  for (const at of rec.attempts) {
    const task = nodes.get(`task:${at.task_id}`); if (!task) continue;
    const agent = typeof task.attrs.get('gen_ai.agent.name') === 'string' ? (task.attrs.get('gen_ai.agent.name') as string) : '';
    const failed = at.result === 'failed';
    const a: Attrs = new Map<string, string | number | boolean>([['gen_ai.operation.name', 'invoke_agent'], ['gen_ai.conversation.id', rec.missionId], ['axion.attempt.id', String(at.id)], ['axion.attempt.no', Number(at.attempt_no)]]);
    if (agent) a.set('gen_ai.agent.name', agent);
    if (at.result) a.set('axion.attempt.result', at.result);
    content(a, 'task_attempts.evidence_ref', `axion://task_attempts/${at.id}#evidence_ref`, at.evidence_ref);
    if (failed) a.set('error.type', 'attempt_failed');
    const start = ms(at.started_at) ?? task.start;
    add(`attempt:${at.id}`, task.key, agent ? `invoke_agent ${agent}` : 'invoke_agent', start, ms(at.finished_at), a, failed);
  }

  for (const r of rec.evalResults) {
    const inst = rec.instances.find((i) => String(i.agent_version_id) === String(r.subject_version_id));
    const parent = inst ? `instance:${inst.id}` : rootKey;
    const agent = inst ? nameSuffix(parent) : '';
    const caseId = ident(r.case_id); // written by a dataset author: only a plain identifier leaves
    const rkey = `result:${r.run_id}/${r.case_id}/${r.attempt}`;
    const base = ms(r.recorded_at) ?? t0;
    const steps: unknown[] = Array.isArray(r.trace?.steps) ? r.trace.steps : [];
    const a: Attrs = new Map<string, string | number | boolean>([['gen_ai.operation.name', 'invoke_agent'], ['gen_ai.conversation.id', rec.missionId], ['axion.eval.run_id', r.run_id], ['axion.eval.dataset_id', ident(r.dataset_id)], ['axion.eval.case_id', caseId], ['axion.eval.attempt', Number(r.attempt)], ['axion.agent.version_id', String(r.subject_version_id)]]);
    if (agent) a.set('gen_ai.agent.name', agent);
    if (r.k !== null && r.k !== undefined) a.set('axion.eval.k', Number(r.k));
    if (r.judge_model_family) a.set('axion.eval.judge_model_family', ident(r.judge_model_family));
    const score = num(r.score); if (score !== null) a.set('axion.eval.score', score);
    const cost = num(r.cost_units); if (cost !== null) a.set('axion.eval.cost_units', cost);
    a.set('axion.export.linked_by', 'agent_version'); // not stored per mission: linked through the agent version an instance of the mission pinned
    add(rkey, parent, agent ? `invoke_agent ${agent}` : 'invoke_agent', base, null, a);
    let unmapped = 0;
    steps.forEach((raw, i) => {
      const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Row) : null;
      const kind = s?.kind;
      const rawTool = kind === 'tool' && typeof s?.name === 'string' && s.name.trim() ? (s.name as string).trim() : '';
      if (!s || (kind !== 'plan' && !rawTool)) { unmapped++; return; }
      const tool = rawTool ? toolName(rawTool) : '';
      const ref = (f: string) => `axion://eval_results/${r.run_id}/${caseId}/${r.attempt}#steps/${i}/${f}`;
      const sa: Attrs = new Map<string, string | number | boolean>();
      if (kind === 'tool') { sa.set('gen_ai.operation.name', 'execute_tool'); sa.set('gen_ai.tool.name', tool); sa.set('gen_ai.conversation.id', rec.missionId); }
      else sa.set('gen_ai.operation.name', 'plan');
      if (agent) sa.set('gen_ai.agent.name', agent);
      if (rawTool && tool !== rawTool) content(sa, 'eval_results.trace.steps[].name', ref('name'), rawTool);
      content(sa, 'eval_results.trace.steps[].input', ref('input'), s.input, kind === 'tool' ? undefined : 'axion.step.input');
      content(sa, 'eval_results.trace.steps[].output', ref('output'), s.output, kind === 'tool' ? undefined : 'axion.step.output');
      const hasError = present(s.error);
      if (hasError) {
        sa.set('error.type', typeof s.error === 'string' && ERROR_TYPES.has(s.error) ? s.error : '_OTHER');
        content(sa, 'eval_results.trace.steps[].error', ref('error'), s.error);
      }
      const st = typeof s.startMs === 'number' && Number.isFinite(s.startMs) ? s.startMs : base;
      const en = typeof s.endMs === 'number' && Number.isFinite(s.endMs) && s.endMs >= st ? s.endMs : st;
      add(`${rkey}#${i}`, rkey, kind === 'tool' ? `execute_tool ${tool}` : agent ? `plan ${agent}` : 'plan', st, en, sa, hasError);
    });
    if (unmapped) nodes.get(rkey)!.attrs.set('axion.export.unmapped_steps', unmapped);
  }

  // failure tags and attributions: events on the span of the tagged subject (the mission span for a mission or a message)
  for (const g of rec.tags) {
    const key = g.subject_kind === 'task' && nodes.has(`task:${g.subject_id}`) ? `task:${g.subject_id}` : g.subject_kind === 'task_attempt' && nodes.has(`attempt:${g.subject_id}`) ? `attempt:${g.subject_id}` : rootKey;
    const n = nodes.get(key)!;
    const at = ms(g.created_at) ?? n.start;
    const a: Attrs = new Map<string, string | number | boolean>([['axion.failure.tag_id', g.id], ['axion.failure.subject_kind', g.subject_kind], ['axion.failure.taxonomy_version', g.taxonomy_version], ['axion.failure.mode_id', g.mode_id], ['axion.failure.tagged_by_kind', g.tagged_by_kind], ['axion.failure.status', g.status], ['axion.failure.self_confirmed', !!g.self_confirmed]]);
    content(a, 'failure_tags.note', `axion://failure_tags/${g.id}#note`, g.note);
    n.events.push({ at, name: 'axion.failure_tag', attrs: a });
    for (const x of rec.attributions.filter((y) => y.tag_id === g.id)) {
      const b: Attrs = new Map<string, string | number | boolean>([['axion.failure.attribution_id', x.id], ['axion.failure.tag_id', g.id], ['axion.failure.full_trace_available', !!x.full_trace_available], ['axion.failure.attributed_by_kind', x.attributed_by_kind]]);
      content(b, 'failure_attributions.agent_id', `axion://failure_attributions/${x.id}#agent_id`, x.agent_id);
      content(b, 'failure_attributions.step_ref', `axion://failure_attributions/${x.id}#step_ref`, x.step_ref);
      n.events.push({ at: ms(x.created_at) ?? at, name: 'axion.failure_attribution', attrs: b });
    }
  }

  // wire the tree, then close every open end at the latest end among its own start, its events and its children
  for (const n of nodes.values()) if (n.parent) nodes.get(n.parent)?.kids.push(n);
  const close = (n: Node): number => {
    let end = Math.max(n.end ?? n.start, n.start, ...n.events.map((e) => e.at));
    for (const k of n.kids) end = Math.max(end, close(k));
    n.end = n.end === null ? end : Math.max(n.end, end);
    return n.end;
  };
  close(nodes.get(rootKey)!);
  const sid = (k: string) => hex(`axion-otlp|span|${rec.tenantId}|${rec.missionId}|${k}`, 16);
  const spans: OtlpSpan[] = [...nodes.values()].map((n) => ({
    traceId: trace, spanId: sid(n.key), parentSpanId: n.parent ? sid(n.parent) : '', name: n.name, kind: 1,
    startTimeUnixNano: nano(n.start), endTimeUnixNano: nano(n.end as number), attributes: toAttrs(n.attrs),
    events: n.events.map((e) => ({ timeUnixNano: nano(e.at), name: e.name, attributes: toAttrs(e.attrs) })), status: n.error ? { code: 2 } : {},
  }));
  const res: Attrs = new Map<string, string | number | boolean>([['service.name', 'axion'], ['axion.mission.id', rec.missionId], ['axion.export.include_content', inc], ['axion.export.semconv_repository', OTEL_GENAI_SPEC.repository], ['axion.export.semconv_tag', OTEL_GENAI_SPEC.tag], ['axion.export.semconv_commit', OTEL_GENAI_SPEC.commit], ['axion.export.semconv_status', OTEL_GENAI_SPEC.status]]);
  return { resourceSpans: [{ resource: { attributes: toAttrs(res) }, scopeSpans: [{ scope: { name: 'axion.otlp-export', version: '1' }, spans }] }] };
}

/**
 * Checks an OTLP document: structure, then every attribute against the pinned spec. Returns a list of problems (empty = valid).
 * A span with a gen_ai.operation.name of a pinned span type may carry only the attributes of that span's table (Opt-In ones only when
 * `includeContent`), must carry its Required attributes and must have its name format. Other attributes must be in the `axion.` namespace.
 * With `includeContent: false`, no content attribute may appear anywhere (resource, spans, events).
 */
export function validateOtlp(doc: OtlpDoc, o: { includeContent: boolean }): string[] {
  const out: string[] = [];
  const spans: OtlpSpan[] = [];
  const checkAttrs = (where: string, attrs: OtlpAttr[], span?: PinnedSpan) => {
    const seen = new Set<string>();
    for (const a of attrs) {
      if (seen.has(a.key)) out.push(`${where}: duplicate attribute key ${a.key}`);
      seen.add(a.key);
      const kinds = Object.keys(a.value ?? {});
      if (kinds.length !== 1 || !['stringValue', 'intValue', 'doubleValue', 'boolValue'].includes(kinds[0])) out.push(`${where}: attribute ${a.key} has no single typed value`);
      if (!o.includeContent && CONTENT_ATTRIBUTES.has(a.key)) out.push(`${where}: content attribute ${a.key} in a default export`);
      if (a.key.startsWith('axion.') || a.key === 'service.name') continue;
      if (!(a.key.startsWith('gen_ai.') || a.key === 'error.type')) { out.push(`${where}: attribute ${a.key} is not gen_ai.*, error.type or axion.*`); continue; }
      if (!ALL_PINNED_ATTRIBUTES.has(a.key)) { out.push(`${where}: attribute ${a.key} is not in the pinned spec ${OTEL_GENAI_SPEC.tag}`); continue; }
      if (span && !(a.key in span.attributes)) out.push(`${where}: attribute ${a.key} is not in the pinned table of ${span.operation} spans`);
    }
    return seen;
  };
  for (const r of doc.resourceSpans ?? []) { checkAttrs('resource', r.resource?.attributes ?? []); for (const s of r.scopeSpans ?? []) spans.push(...(s.spans ?? [])); }
  const ids = new Set(spans.map((s) => s.spanId));
  const traces = new Set(spans.map((s) => s.traceId));
  if (traces.size > 1) out.push('spans of more than one trace');
  for (const s of spans) {
    const w = `span "${s.name}"`;
    if (!/^[0-9a-f]{32}$/.test(s.traceId) || !/^[0-9a-f]{16}$/.test(s.spanId)) out.push(`${w}: bad trace or span id`);
    if (s.parentSpanId && !ids.has(s.parentSpanId)) out.push(`${w}: parent span ${s.parentSpanId} not found`);
    if (s.kind !== 1) out.push(`${w}: kind must be INTERNAL (1)`);
    if (!/^\d+$/.test(s.startTimeUnixNano) || !/^\d+$/.test(s.endTimeUnixNano)) out.push(`${w}: bad time`);
    else if (BigInt(s.endTimeUnixNano) < BigInt(s.startTimeUnixNano)) out.push(`${w}: end before start`);
    if (s.status && ('message' in s.status || ![undefined, 0, 1, 2].includes(s.status.code))) out.push(`${w}: status must be a code only (no message)`);
    const op = s.attributes.find((a) => a.key === 'gen_ai.operation.name')?.value.stringValue;
    const pinned = op ? (PINNED_SPANS as Record<string, PinnedSpan>)[op] : undefined;
    const keys = checkAttrs(w, s.attributes, pinned);
    if (op && !pinned) out.push(`${w}: gen_ai.operation.name ${op} is not one of the pinned span types`);
    if (!op && s.name !== 'axion.mission') out.push(`${w}: a span without gen_ai.operation.name must be the axion.mission span`);
    if (!op && [...keys].some((k) => !k.startsWith('axion.'))) out.push(`${w}: the mission span may carry only axion.* attributes`);
    if (pinned) {
      for (const [k, lvl] of Object.entries(pinned.attributes)) if (lvl === 'Required' && !keys.has(k)) out.push(`${w}: required attribute ${k} is missing`);
      const agent = s.attributes.find((a) => a.key === 'gen_ai.agent.name')?.value.stringValue;
      const tool = s.attributes.find((a) => a.key === 'gen_ai.tool.name')?.value.stringValue;
      const want = op === 'execute_tool' ? `execute_tool ${tool}` : agent ? `${op} ${agent}` : String(op);
      if (s.name !== want) out.push(`${w}: span name does not match ${pinned.nameFormat} (expected "${want}")`);
    }
    for (const ev of s.events ?? []) {
      if (!/^\d+$/.test(ev.timeUnixNano)) out.push(`${w}: event ${ev.name} has a bad time`);
      if (!ev.name.startsWith('axion.')) out.push(`${w}: event ${ev.name} is not in the axion. namespace`);
      checkAttrs(`${w} event ${ev.name}`, ev.attributes);
      for (const a of ev.attributes) if (!a.key.startsWith('axion.')) out.push(`${w} event ${ev.name}: attribute ${a.key} must be in the axion. namespace`);
    }
  }
  return out;
}
