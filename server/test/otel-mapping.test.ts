import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTestApp, type TestApp } from './helpers.ts';
import { OTEL_GENAI_SPEC, PINNED_SPANS, ALL_PINNED_ATTRIBUTES, CONTENT_ATTRIBUTES } from '../src/otel/pinned.ts';
import { FIELD_MAP, MAPPED_TABLES, TRACE_STEP_FIELDS, renderMappingMarkdown } from '../src/otel/mapping.ts';

// Improvement cycle 60 (Phase 2, R2-8), item 2: the mapping table from AXION trace and task fields to the OpenTelemetry GenAI agent
// conventions, against a pinned spec version. The spec status is "Development": the pin is the only thing that makes this checkable.
const DOCS = join(__dirname, '../../web/docs/improve/phase2');
const SPEC_DIR = join(DOCS, 'otel-spec-v0.1.0');
const sha = (f: string) => createHash('sha256').update(readFileSync(join(SPEC_DIR, f))).digest('hex');
let t: TestApp;
beforeAll(async () => { t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000 }); });
afterAll(async () => { await t?.close(); });

type Levels = Record<string, string>;
/** Attribute rows of one span's table: `| [`key`](link) | stability | `Level` ...`, between two line numbers of a pinned page. */
function parseTable(file: string, startMarker: string, endMarker: string): Levels {
  const text = readFileSync(join(SPEC_DIR, file), 'utf8');
  const from = text.indexOf(startMarker), to = text.indexOf(endMarker, from + startMarker.length);
  expect(from, startMarker).toBeGreaterThanOrEqual(0);
  const out: Levels = {};
  for (const l of text.slice(from, to < 0 ? undefined : to).split('\n')) {
    const m = /^\| \[`([^`]+)`\]\([^)]*\) \| ![^|]*\| `(Required|Conditionally Required|Recommended|Opt-In)`/.exec(l);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

describe('the pinned spec', () => {
  it('names the repository, tag, commit, status and the SHA-256 of each page used', () => {
    expect(OTEL_GENAI_SPEC.repository).toBe('https://github.com/open-telemetry/semantic-conventions-genai');
    expect(OTEL_GENAI_SPEC.tag).toBe('v0.1.0');
    expect(OTEL_GENAI_SPEC.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(OTEL_GENAI_SPEC.status).toBe('Development');
    expect(Object.keys(OTEL_GENAI_SPEC.pages).sort()).toEqual(['docs/gen-ai/execute-tool.md', 'docs/gen-ai/gen-ai-agent-spans.md']);
    for (const p of Object.values(OTEL_GENAI_SPEC.pages)) expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('the stored copies hash to the pinned values (an edited or replaced page fails here)', () => {
    expect(sha('gen-ai-agent-spans.md')).toBe(OTEL_GENAI_SPEC.pages['docs/gen-ai/gen-ai-agent-spans.md'].sha256);
    expect(sha('execute-tool.md')).toBe(OTEL_GENAI_SPEC.pages['docs/gen-ai/execute-tool.md'].sha256);
  });
  it('the pinned attribute lists equal the tables parsed from the stored pages', () => {
    const agent = 'gen-ai-agent-spans.md';
    expect(PINNED_SPANS.invoke_agent.attributes).toEqual(parseTable(agent, '### Invoke agent internal span', '#### Event: `gen_ai.invoke_agent.exception`'));
    expect(PINNED_SPANS.plan.attributes).toEqual(parseTable(agent, '### Plan span', '## Execute tool span'));
    expect(PINNED_SPANS.execute_tool.attributes).toEqual(parseTable('execute-tool.md', '## Span: `gen_ai.execute_tool`', '## Specialized tool call spans'));
    expect(PINNED_SPANS.invoke_agent.nameFormat).toBe('{gen_ai.operation.name} {gen_ai.agent.name}');
    expect(PINNED_SPANS.execute_tool.nameFormat).toBe('execute_tool {gen_ai.tool.name}');
    expect(PINNED_SPANS.plan.nameFormat).toBe('plan {gen_ai.agent.name}');
  });
  it('the content attributes are exactly the Opt-In ones of the pinned spans', () => {
    const optIn = new Set(Object.values(PINNED_SPANS).flatMap((s) => Object.entries(s.attributes).filter(([, l]) => l === 'Opt-In').map(([k]) => k)));
    expect([...CONTENT_ATTRIBUTES].filter((k) => !k.startsWith('axion.')).sort()).toEqual([...optIn].sort());
    expect(ALL_PINNED_ATTRIBUTES.has('gen_ai.tool.call.arguments')).toBe(true);
  });
});

describe('the mapping table', () => {
  it('lists every column of every trace and task table, and nothing that does not exist', async () => {
    const cols = (await t.pool.query(`select table_name, column_name from information_schema.columns where table_schema = current_schema() and table_name = any($1)`, [MAPPED_TABLES])).rows
      .map((r) => `${r.table_name}.${r.column_name}`).sort();
    expect(cols.length).toBeGreaterThan(60);
    const listed = Object.keys(FIELD_MAP).filter((k) => !k.includes('.trace.steps[]')).sort();
    expect(listed).toEqual(cols);
    expect(Object.keys(FIELD_MAP).filter((k) => k.includes('.trace.steps[]')).sort()).toEqual(TRACE_STEP_FIELDS.map((f) => `eval_results.trace.steps[].${f}`).sort());
  });
  it('every entry is mapped to a pinned attribute, an AXION extension attribute, a span property, or is "no equivalent" with a reason', () => {
    for (const [k, e] of Object.entries(FIELD_MAP)) {
      if (e.to.kind === 'gen_ai') expect(ALL_PINNED_ATTRIBUTES.has(e.to.key) || e.to.key === 'error.type', `${k} -> ${e.to.key}`).toBe(true);
      else if (e.to.kind === 'axion') expect(e.to.key, k).toMatch(/^axion\.[a-z_.]+$/);
      else if (e.to.kind === 'span') expect(['start_time', 'end_time', 'parent', 'status', 'name', 'event'], k).toContain(e.to.what);
      else { expect(e.to.kind, k).toBe('none'); expect(e.note.length, `${k} needs a reason`).toBeGreaterThan(15); }
      if (e.content) expect(e.content.refKey, k).toMatch(/_ref$/);
    }
    expect(Object.values(FIELD_MAP).filter((e) => e.to.kind === 'none').length).toBeGreaterThan(5);
    expect(Object.values(FIELD_MAP).filter((e) => e.to.kind === 'gen_ai').length).toBeGreaterThan(3);
  });
  it('no content field is ever mapped to an inline attribute by default (a `_ref` pointer replaces the text)', () => {
    for (const [k, e] of Object.entries(FIELD_MAP)) {
      if (!e.content) continue;
      expect(e.to.kind === 'none', k).toBe(false);
      if (e.to.kind === 'axion') expect(e.to.key, k).toBe(e.content.refKey); // the default target of a content field is its pointer
      expect(CONTENT_ATTRIBUTES.has(e.content.refKey), `${k} ref is not content`).toBe(false);
      expect(CONTENT_ATTRIBUTES.has(e.content.inlineKey), `${k} ${e.content.inlineKey}`).toBe(true);
    }
  });
  it('the Markdown file is generated from the table, so it cannot drift, and it names the pinned version and hashes', () => {
    const md = readFileSync(join(DOCS, 'otel-mapping.md'), 'utf8');
    expect(md).toBe(renderMappingMarkdown());
    expect(md).toContain(OTEL_GENAI_SPEC.tag);
    expect(md).toContain(OTEL_GENAI_SPEC.commit);
    for (const p of Object.values(OTEL_GENAI_SPEC.pages)) expect(md).toContain(p.sha256);
    expect(md).toMatch(/Development/);
    expect(md).toMatch(/no equivalent/i);
  });
});
