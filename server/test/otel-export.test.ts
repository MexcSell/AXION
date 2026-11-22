import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { makeDataset, addRun } from './eval-fixtures.ts';
import { buildOtlp, validateOtlp, loadMissionRecords, type MissionRecords, type OtlpAttr, type OtlpDoc } from '../src/otel/export.ts';
import { exportMissionToFile, parseExportArgs } from '../src/otel/cli.ts';
import { ALL_PINNED_ATTRIBUTES, CONTENT_ATTRIBUTES } from '../src/otel/pinned.ts';
import { FIELD_MAP, STRUCTURAL_AXION_ATTRIBUTES } from '../src/otel/mapping.ts';

// Improvement cycle 60 (Phase 2, R2-8), item 3: a local OTLP-JSON export of stored task and trace records for one mission.
// Content is off by default (pointers instead), the output is checked against the pinned attribute list, and nothing touches a network.
const S = { title: 'SENTINEL-TITLE', crit: 'SENTINEL-CRITERIA', label: 'SENTINEL-LABEL', note: 'SENTINEL-NOTE', input: 'SENTINEL-INPUT', output: 'SENTINEL-OUTPUT', err: 'SENTINEL-ERROR boom happened' };
const T0 = Date.parse('2026-11-20T10:00:00Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

/** Hand-made records covering every record kind, including a step of an unknown kind and a failure tag with two different attributions. */
function fixture(): MissionRecords {
  return {
    tenantId: 't-1', missionId: 'M-1',
    instances: [
      { id: 'M-1:gm', agent_id: 'gm', agent_name: 'General Manager', agent_version_id: 'v-1', manager_instance_id: null, run_id: 7, state: 'working', task_label: S.label, progress: 40, task_count: 2, pending: 0, simulated: true, created_at: at(0), ended_at: null, seq: 1, tenant_id: 't-1', mission_id: 'M-1' },
      { id: 'M-1:dev', agent_id: 'dev', agent_name: 'Developer', agent_version_id: 'v-2', manager_instance_id: 'M-1:gm', run_id: 7, state: 'done', task_label: '', progress: 100, task_count: 1, pending: 0, simulated: true, created_at: at(1), ended_at: at(30), seq: 2, tenant_id: 't-1', mission_id: 'M-1' },
    ],
    tasks: [
      { id: 'T-1', tenant_id: 't-1', mission_id: 'M-1', run_id: 7, title: S.title, status: 'failed', owner_agent: 'dev', created_at: at(2), owner_instance_id: 'M-1:dev', weight: 2, criteria: [{ text: S.crit }], evidence: 1, col: 0, row: 0, simulated: true },
      { id: 'T-2', tenant_id: 't-1', mission_id: 'M-1', run_id: null, title: 'Second', status: 'passed', owner_agent: null, created_at: at(3), owner_instance_id: null, weight: 1, criteria: [], evidence: 0, col: 1, row: 0, simulated: false },
    ],
    attempts: [
      { id: '11', task_id: 'T-1', attempt_no: 1, started_at: at(4), finished_at: at(9), result: 'failed', evidence_ref: 'evidence://u/1' },
      { id: '12', task_id: 'T-1', attempt_no: 2, started_at: null, finished_at: null, result: null, evidence_ref: null },
    ],
    evalResults: [{
      run_id: 'R-1', dataset_id: 'D-1', subject_version_id: 'v-2', k: 1, judge_model_family: 'claude-judge', case_id: 'c01', attempt: 1, score: '55', cost_units: '1.5', recorded_at: at(20),
      trace: { steps: [
        { kind: 'plan', input: S.input, output: S.output },
        { kind: 'tool', name: 'search', input: { q: S.input }, output: { hits: [S.output] }, startMs: T0 + 21 * 60_000, endMs: T0 + 22 * 60_000 },
        { kind: 'tool', name: 'write', error: 'timeout', input: 'x' },
        { kind: 'tool', name: 'bad', error: S.err },
        { kind: 'tool', error: 'no_name' },
        { kind: 'think', input: 'unknown kind' },
        'not an object',
      ] },
    }],
    tags: [
      { id: 'FT-1', subject_kind: 'task', subject_id: 'T-1', mode_id: 'FM-1.3', taxonomy_version: 'mast-arxiv-2503.13657v3', note: S.note, tagged_by: 'u-secret-person', tagged_by_kind: 'user', status: 'confirmed', self_confirmed: false, created_at: at(10), decided_by: 'u-other-person', mission_id: 'M-1' },
      { id: 'FT-2', subject_kind: 'mission', subject_id: 'M-1', mode_id: 'FM-3.1', taxonomy_version: 'mast-arxiv-2503.13657v3', note: null, tagged_by: 'M-1:gm', tagged_by_kind: 'agent', status: 'proposed', self_confirmed: false, created_at: at(11), decided_by: null, mission_id: 'M-1' },
      { id: 'FT-3', subject_kind: 'task_attempt', subject_id: '11', mode_id: 'FM-2.6', taxonomy_version: 'mast-arxiv-2503.13657v3', note: null, tagged_by: 'u-secret-person', tagged_by_kind: 'user', status: 'proposed', self_confirmed: false, created_at: at(12), decided_by: null, mission_id: 'M-1' },
    ],
    attributions: [
      { id: 'FA-1', tag_id: 'FT-1', agent_id: 'dev', step_ref: 'step-2', full_trace_available: true, attributed_by: 'u-secret-person', attributed_by_kind: 'user', created_at: at(13) },
      { id: 'FA-2', tag_id: 'FT-1', agent_id: 'gm', step_ref: null, full_trace_available: false, attributed_by: 'u-other-person', attributed_by_kind: 'user', created_at: at(14) },
    ],
  };
}

const spansOf = (d: OtlpDoc) => d.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans));
const keysOf = (d: OtlpDoc) => {
  const k = new Set<string>();
  for (const r of d.resourceSpans) {
    for (const a of r.resource.attributes) k.add(a.key);
    for (const s of r.scopeSpans) for (const sp of s.spans) { for (const a of sp.attributes) k.add(a.key); for (const ev of sp.events) for (const a of ev.attributes) k.add(a.key); }
  }
  return k;
};
const attr = (sp: { attributes: OtlpAttr[] }, key: string) => {
  const a = sp.attributes.find((x) => x.key === key); if (!a) return undefined;
  const v = a.value; return 'stringValue' in v ? v.stringValue : 'intValue' in v ? Number(v.intValue) : 'doubleValue' in v ? v.doubleValue : v.boolValue;
};

describe('the default export (content off)', () => {
  const doc = buildOtlp(fixture());
  const spans = spansOf(doc);
  const text = JSON.stringify(doc);

  it('validates against the pinned attribute list, with no problem', () => {
    expect(validateOtlp(doc, { includeContent: false })).toEqual([]);
  });
  it('has the span tree: mission, instances, tasks, attempts, trace steps, with the pinned span names', () => {
    const names = spans.map((s) => s.name).sort();
    expect(names).toEqual(['axion.mission', 'execute_tool bad', 'execute_tool search', 'execute_tool write', 'invoke_agent', 'invoke_agent Developer', 'invoke_agent Developer', 'invoke_agent Developer', 'invoke_agent Developer', 'invoke_agent Developer', 'invoke_agent General Manager', 'plan Developer'].sort());
    const byName = (n: string) => spans.filter((s) => s.name === n);
    const root = byName('axion.mission')[0];
    expect(root.parentSpanId).toBe('');
    expect(new Set(spans.map((s) => s.traceId)).size).toBe(1);
    // T-1 is owned by the Developer instance; its attempts are its children; T-2 has no owner and hangs under the mission span
    const t1 = spans.find((s) => attr(s, 'axion.task.id') === 'T-1')!, t2 = spans.find((s) => attr(s, 'axion.task.id') === 'T-2')!;
    const dev = spans.find((s) => attr(s, 'axion.instance.id') === 'M-1:dev')!;
    expect(t1.parentSpanId).toBe(dev.spanId); expect(t2.parentSpanId).toBe(root.spanId); expect(dev.parentSpanId).toBe(root.spanId);
    expect(spans.filter((s) => attr(s, 'axion.attempt.id') && s.parentSpanId === t1.spanId)).toHaveLength(2);
    expect(attr(t2, 'gen_ai.agent.name')).toBeUndefined();
    expect(t2.name).toBe('invoke_agent');
  });
  it('a failed task and a failed attempt are span status ERROR with a short error.type and no message', () => {
    const t1 = spans.find((s) => attr(s, 'axion.task.id') === 'T-1')!;
    expect(t1.status).toEqual({ code: 2 }); expect(attr(t1, 'error.type')).toBe('task_failed');
    const a1 = spans.find((s) => attr(s, 'axion.attempt.id') === '11')!;
    expect(a1.status).toEqual({ code: 2 }); expect(attr(a1, 'error.type')).toBe('attempt_failed');
    expect(attr(spans.find((s) => attr(s, 'axion.attempt.id') === '12')!, 'error.type')).toBeUndefined();
  });
  it('contains zero content attributes and none of the sentinel text; a _ref pointer stands in for each text', () => {
    for (const k of keysOf(doc)) expect(CONTENT_ATTRIBUTES.has(k), k).toBe(false);
    expect(text).not.toMatch(/SENTINEL/);
    const t1 = spans.find((s) => attr(s, 'axion.task.id') === 'T-1')!;
    expect(attr(t1, 'axion.task.title_ref')).toBe('axion://tasks/T-1#title');
    expect(attr(t1, 'axion.task.criteria_ref')).toBe('axion://tasks/T-1#criteria');
    expect(attr(spans.find((s) => attr(s, 'axion.instance.id') === 'M-1:gm')!, 'axion.instance.task_label_ref')).toBe('axion://agent_instances/M-1:gm#task_label');
    const search = spans.find((s) => s.name === 'execute_tool search')!;
    expect(attr(search, 'axion.step.input_ref')).toBe('axion://eval_results/R-1/c01/1#steps/1/input');
    expect(attr(search, 'axion.step.output_ref')).toBe('axion://eval_results/R-1/c01/1#steps/1/output');
    expect(attr(spans.find((s) => s.name === 'execute_tool bad')!, 'axion.step.error_ref')).toBe('axion://eval_results/R-1/c01/1#steps/3/error');
    const ev = spans.find((s) => attr(s, 'axion.task.id') === 'T-1')!.events.find((e) => e.name === 'axion.failure_tag')!;
    expect(attr(ev, 'axion.failure.note_ref')).toBe('axion://failure_tags/FT-1#note');
  });
  it('a step error class becomes error.type, free text becomes _OTHER; steps it cannot map are counted, not dropped silently', () => {
    expect(attr(spans.find((s) => s.name === 'execute_tool write')!, 'error.type')).toBe('timeout');
    expect(attr(spans.find((s) => s.name === 'execute_tool bad')!, 'error.type')).toBe('_OTHER');
    const res = spans.find((s) => attr(s, 'axion.eval.run_id') === 'R-1' && s.name.startsWith('invoke_agent'))!;
    expect(attr(res, 'axion.export.unmapped_steps')).toBe(3); // unknown kind, tool without a name, a step that is not an object
    expect(attr(res, 'axion.eval.score')).toBe(55);
    expect(res.parentSpanId).toBe(spans.find((s) => attr(s, 'axion.instance.id') === 'M-1:dev')!.spanId); // linked by the pinned agent version
  });
  it('failure tags and attributions are span events on the tagged subject; both views and the kinds are there, no person id is', () => {
    const t1 = spans.find((s) => attr(s, 'axion.task.id') === 'T-1')!;
    expect(t1.events.map((e) => e.name)).toEqual(['axion.failure_tag', 'axion.failure_attribution', 'axion.failure_attribution']);
    expect(t1.events.filter((e) => e.name === 'axion.failure_attribution').map((e) => [attr(e, 'axion.failure.attributed_agent_id'), attr(e, 'axion.failure.attributed_step_ref')])).toEqual([['dev', 'step-2'], ['gm', undefined]]);
    expect(spans.find((s) => attr(s, 'axion.attempt.id') === '11')!.events).toHaveLength(1);
    expect(spans.find((s) => s.name === 'axion.mission')!.events.map((e) => attr(e, 'axion.failure.mode_id'))).toEqual(['FM-3.1']);
    expect(text).not.toMatch(/u-secret-person|u-other-person/);
  });
  it('is reproducible: the same records give the same bytes', () => {
    expect(JSON.stringify(buildOtlp(fixture()))).toBe(text);
  });
  it('states what it is: resource attributes name the spec pin and that content is off', () => {
    const r = doc.resourceSpans[0].resource.attributes;
    expect(r.find((a) => a.key === 'service.name')!.value).toEqual({ stringValue: 'axion' });
    expect(attr({ attributes: r }, 'axion.export.include_content')).toBe(false);
    expect(attr({ attributes: r }, 'axion.export.semconv_tag')).toBe('v0.1.0');
    expect(attr({ attributes: r }, 'axion.export.semconv_status')).toBe('Development');
  });
});

describe('the export with content on', () => {
  const doc = buildOtlp(fixture(), { includeContent: true });
  const text = JSON.stringify(doc);
  it('carries the text in the Opt-In attributes (or an axion.* one), and validates as a content export', () => {
    for (const s of Object.values(S)) expect(text, s).toContain(s);
    expect(validateOtlp(doc, { includeContent: true })).toEqual([]);
    const search = spansOf(doc).find((s) => s.name === 'execute_tool search')!;
    expect(attr(search, 'gen_ai.tool.call.arguments')).toBe(JSON.stringify({ q: S.input }));
    expect(attr(search, 'axion.step.input_ref')).toBeUndefined(); // the pointer is replaced, not duplicated
    expect(attr(spansOf(doc).find((s) => s.name === 'plan Developer')!, 'axion.step.input')).toBe(S.input);
  });
  it('does not pass as a default export', () => {
    expect(validateOtlp(doc, { includeContent: false }).some((p) => /content attribute/.test(p))).toBe(true);
  });
});

describe('the validator is not vacuous (RED proof against the pinned list)', () => {
  const clone = () => JSON.parse(JSON.stringify(buildOtlp(fixture()))) as OtlpDoc;
  const mutate = (f: (spans: OtlpDoc['resourceSpans'][0]['scopeSpans'][0]['spans']) => void, o = { includeContent: false }) => { const d = clone(); f(spansOf(d)); return validateOtlp(d, o); };
  const sv = (key: string, v: string) => ({ key, value: { stringValue: v } });
  it('rejects an attribute that is not in the pinned table of its span', () => {
    expect(mutate((s) => s.find((x) => x.name === 'plan Developer')!.attributes.push(sv('gen_ai.tool.name', 'x'))).join('\n')).toMatch(/gen_ai\.tool\.name.*not in the pinned/);
    expect(mutate((s) => s.find((x) => x.name === 'execute_tool search')!.attributes.push(sv('gen_ai.made_up', 'x'))).join('\n')).toMatch(/gen_ai\.made_up/);
  });
  it('rejects a missing required attribute, a wrong span name, a foreign namespace, a dangling parent and a bad time', () => {
    expect(mutate((s) => { const x = s.find((y) => y.name === 'execute_tool search')!; x.attributes = x.attributes.filter((a) => a.key !== 'gen_ai.tool.name'); }).join('\n')).toMatch(/required.*gen_ai\.tool\.name/);
    expect(mutate((s) => { s.find((y) => y.name === 'execute_tool search')!.name = 'run search'; }).join('\n')).toMatch(/span name/);
    expect(mutate((s) => s[1].attributes.push(sv('foo.bar', 'x'))).join('\n')).toMatch(/foo\.bar/);
    expect(mutate((s) => { s[1].parentSpanId = 'ffffffffffffffff'; }).join('\n')).toMatch(/parent/);
    expect(mutate((s) => { s[1].endTimeUnixNano = '1'; }).join('\n')).toMatch(/end before start|time/);
    expect(mutate((s) => { s[1].attributes.push(s[1].attributes[0]); }).join('\n')).toMatch(/duplicate/);
  });
  it('rejects an Opt-In content attribute in a default export', () => {
    expect(mutate((s) => s.find((x) => x.name === 'execute_tool search')!.attributes.push(sv('gen_ai.tool.call.arguments', '{}'))).join('\n')).toMatch(/content attribute.*gen_ai\.tool\.call\.arguments/);
    expect(mutate((s) => s[0].attributes.push(sv('axion.task.title', 'x'))).join('\n')).toMatch(/content attribute/);
  });
});

describe('every attribute the export can write is in the pinned list or documented in the mapping', () => {
  it('both modes', () => {
    const documented = new Set<string>([...STRUCTURAL_AXION_ATTRIBUTES, ...Object.values(FIELD_MAP).flatMap((e) => [e.to.kind === 'axion' ? e.to.key : '', ...(e.content ? [e.content.refKey, e.content.inlineKey] : [])]).filter(Boolean)]);
    for (const includeContent of [false, true]) {
      for (const k of keysOf(buildOtlp(fixture(), { includeContent }))) {
        if (k === 'service.name') continue;
        expect(ALL_PINNED_ATTRIBUTES.has(k) || documented.has(k), `${k} (content ${includeContent})`).toBe(true);
      }
    }
  });
});

describe('offline: no network, no collector', () => {
  it('the export code imports no network module and calls no fetch or socket', () => {
    const files = [...readdirSync(join(__dirname, '../src/otel')).map((f) => join(__dirname, '../src/otel', f)), join(__dirname, '../src/cli/otlp-export.ts')];
    expect(files.length).toBeGreaterThan(4);
    for (const f of files) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\b|node:(http|https|http2|net|dgram|dns|tls|child_process)|from '(undici|axios|node-fetch|@opentelemetry[^']*)'/);
    }
  });
});

describe('from stored records (database) to a file', () => {
  let t: TestApp; let dir = '';
  const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);
  beforeAll(async () => {
    t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000 });
    const w = await withAdmin(t.app);
    dir = mkdtempSync(join(tmpdir(), 'axion-otlp-'));
    for (const id of ['M-E1', 'M-E2']) {
      await q(`insert into missions(id, tenant_id, owner_id, shared, status, demo) values ($1,'t-1',$2,false,'running',false)`, [id, w.adminId]);
      await q(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, created_by) values ($1,1,$1,'data','normal','x',$2)`, [id, w.adminId]);
    }
    await q(`insert into agent_instances(id, tenant_id, mission_id, agent_id, agent_version_id, simulated) select 'M-E1:gm','t-1','M-E1', d.id, d.active_version_id, false from agent_definitions d where d.id='gm'`);
    await q(`insert into agent_instances(id, tenant_id, mission_id, agent_id, agent_version_id, simulated) select 'M-E2:gm','t-1','M-E2', d.id, d.active_version_id, false from agent_definitions d where d.id='gm'`);
    await q(`insert into tasks(id, tenant_id, mission_id, title, status, owner_instance_id) values ('T-E1','t-1','M-E1','SENTINEL-DB-TITLE','failed','M-E1:gm'), ('T-E2','t-1','M-E2','Other mission','passed','M-E2:gm')`);
    await q(`insert into task_attempts(task_id, attempt_no, result, started_at, finished_at) values ('T-E1',1,'failed', now() - interval '2 hour', now() - interval '1 hour')`);
    const tag = (await w.admin.req('POST', '/failure-tags', { subjectKind: 'task', subjectId: 'T-E1', modeId: 'FM-1.1', note: 'SENTINEL-DB-NOTE', attribution: { agentId: 'gm', stepRef: 'step-1', fullTraceAvailable: true } }, { 'idempotency-key': 'oe1' })).body.tag;
    expect(tag.attributions).toHaveLength(1);
    const v = (await q(`select active_version_id v from agent_definitions where id='gm'`)).rows[0].v;
    await makeDataset(t.pool, { id: 'D-E', cases: 2 });
    await addRun(t.pool, { id: 'R-E', datasetId: 'D-E', versionId: v, scores: [], finish: false });
    await q(`insert into eval_results(run_id, case_id, attempt, score, cost_units, trace) values ('R-E','c01',1,80,2,$1)`, [JSON.stringify({ steps: [{ kind: 'tool', name: 'search', input: 'SENTINEL-DB-INPUT' }] })]);
  });
  afterAll(async () => { await t?.close(); });

  it('there is no route: the app registers nothing about OTLP or export', () => {
    for (const r of t.app.printRoutes({ commonPrefix: false }).split('\n')) expect(r).not.toMatch(/otlp|otel|export/i);
  });
  it('loads one mission only (another mission and its tasks are not in the export) and validates', async () => {
    const rec = await loadMissionRecords(t.app.db, 't-1', 'M-E1');
    expect(rec.tasks.map((x) => x.id)).toEqual(['T-E1']);
    expect(rec.instances.map((x) => x.id)).toEqual(['M-E1:gm']);
    expect(rec.instances[0].agent_name).toBeTruthy();
    expect(rec.tags).toHaveLength(1); expect(rec.attributions).toHaveLength(1);
    expect(rec.evalResults).toHaveLength(1); // linked through the pinned agent version of the instance
    const doc = buildOtlp(rec);
    expect(validateOtlp(doc, { includeContent: false })).toEqual([]);
    expect(JSON.stringify(doc)).not.toMatch(/SENTINEL|Other mission/);
    expect(spansOf(doc).some((s) => attr(s, 'axion.task.id') === 'T-E2')).toBe(false);
    const ev = spansOf(doc).find((s) => attr(s, 'axion.task.id') === 'T-E1')!.events.find((e) => e.name === 'axion.failure_attribution')!;
    expect(attr(ev, 'axion.failure.attributed_agent_id')).toBe('gm'); expect(attr(ev, 'axion.failure.full_trace_available')).toBe(true);
  });
  it('an unknown mission, another tenant\'s mission and a deleted mission are refused', async () => {
    await expect(loadMissionRecords(t.app.db, 't-1', 'M-NOPE')).rejects.toThrow(/No such mission/);
    await expect(loadMissionRecords(t.app.db, 't-other', 'M-E1')).rejects.toThrow(/No such mission/);
  });
  it('writes a file, refuses to overwrite it, and content stays off unless asked', async () => {
    const out = join(dir, 'a.otlp.json');
    const r = await exportMissionToFile(t.app.db, { tenant: 't-1', missionId: 'M-E1', out, includeContent: false, force: false });
    expect(r.spans).toBeGreaterThan(3); expect(r.out).toBe(out);
    const written = JSON.parse(readFileSync(out, 'utf8')) as OtlpDoc;
    expect(validateOtlp(written, { includeContent: false })).toEqual([]);
    expect(readFileSync(out, 'utf8')).not.toMatch(/SENTINEL/);
    await expect(exportMissionToFile(t.app.db, { tenant: 't-1', missionId: 'M-E1', out, includeContent: false, force: false })).rejects.toThrow(/already exists/);
    const out2 = join(dir, 'b.otlp.json');
    await exportMissionToFile(t.app.db, { tenant: 't-1', missionId: 'M-E1', out: out2, includeContent: true, force: false });
    expect(readFileSync(out2, 'utf8')).toMatch(/SENTINEL-DB-TITLE/);
    expect(validateOtlp(JSON.parse(readFileSync(out2, 'utf8')), { includeContent: true })).toEqual([]);
    writeFileSync(join(dir, 'c.json'), 'x');
    await exportMissionToFile(t.app.db, { tenant: 't-1', missionId: 'M-E1', out: join(dir, 'c.json'), includeContent: false, force: true });
    expect(existsSync(join(dir, 'c.json'))).toBe(true);
  });
  it('parses the command line: content is opt-in, a mission id is required, unknown flags are refused', () => {
    expect(parseExportArgs(['M-1'])).toMatchObject({ missionId: 'M-1', includeContent: false, force: false });
    expect(parseExportArgs(['M-1', '--include-content', '--out', 'x.json', '--tenant', 't-2', '--force'])).toMatchObject({ includeContent: true, out: 'x.json', tenant: 't-2', force: true });
    expect(() => parseExportArgs([])).toThrow(/mission id/);
    expect(() => parseExportArgs(['M-1', '--endpoint', 'http://x'])).toThrow(/Unknown option/);
  });
});
