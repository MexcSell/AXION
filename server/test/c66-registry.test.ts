import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeSchema } from './helpers.ts';
import { METRICS, METRIC_BY_ID, INPUT_FIELDS, INPUT_FIELD_IDS, writabilityOf, guardOf, guardRows, registryProblems, type MetricMeta } from '../../shared/contracts/src/index.ts';
import { computeScorecard } from '../src/company/scorecard.ts';
import { computeDimensions, type DimInput } from '../src/company/dimensions.ts';
import { loaderTables } from './contracts/writability.ts';

/**
 * Improvement cycle 66, item 1: every scorecard row, KPI tile and six-dimension cell declares a counter-metric (or an explicit
 * "none" with a reason), the quality dimensions it does not cover, and its inputs. Coverage is taken from the LIVE row sets
 * (the pure functions' output and the command center's tiles), so a new row without an entry fails on the day it is added.
 */
const empty = (): DimInput => ({ admin: true, agents: [], missions: [], instances: [], tasks: [], reviews: [], ledgers: [], approvals: [], delegations: [], briefs: [], grants: [], tags: [], lessons: [], playbooks: [], promotions: [], rollbacks: [], verdicts: [], orgRevisions: [], orgChanges: [] });
const now = new Date('2026-06-01T00:00:00Z');
const from = new Date(now.getTime() - 30 * 86_400_000);

function liveIds(): string[] {
  const sc = computeScorecard({ missions: [], runs: [], transitions: [], tasks: [], attempts: [], decisions: [], delegations: [] }, { window: '30d', from, to: now, includeDemo: false }).rows.map((r) => `scorecard.${r.key}`);
  const dims = computeDimensions(empty(), { window: '30d', from, to: now, department: null }).dimensions.flatMap((d) => d.cells.map((c) => `dimension.${c.key}`));
  // the weekly throughput chart is part of the scorecard panel but has no row key; its help key is scorecard.throughput
  const cc = readFileSync(join(__dirname, '../../web/src/components/layout/CommandCenter.tsx'), 'utf8');
  const throughput = /HelpTrigger k="scorecard\.throughput"/.test(cc) ? ['scorecard.throughput'] : [];
  return [...sc, ...throughput, ...dims, ...kpiIds()];
}
/** KPI tiles that show a measured number: every `help: 'kpi.*'` in the command center except the DEMO-only tiles, which show invented numbers. */
const DEMO_ONLY_KPI = ['kpi.success', 'kpi.activeAgents', 'kpi.tokens'];
function kpiIds(): string[] {
  const cc = readFileSync(join(__dirname, '../../web/src/components/layout/CommandCenter.tsx'), 'utf8');
  return [...new Set([...cc.matchAll(/help: '(kpi\.[A-Za-z.]+)'/g)].map((m) => m[1]))].filter((k) => !DEMO_ONLY_KPI.includes(k));
}

describe('the row registry covers every live row', () => {
  it('has an entry for every scorecard row, KPI tile and dimension cell, and no entry for a row that is gone', () => {
    const ids = liveIds();
    expect(ids.length, 'the live row sets were read').toBeGreaterThanOrEqual(30);
    expect(registryProblems(METRICS, ids, INPUT_FIELD_IDS)).toEqual([]);
  });

  it('RED proof: a live row without an entry, a bad declaration and a hand-typed writability flag are each reported', () => {
    const ids = [...liveIds(), 'scorecard.zz_new_row'];
    expect(registryProblems(METRICS, ids, INPUT_FIELD_IDS)).toEqual([expect.stringContaining('scorecard.zz_new_row: a live row with no registry entry')]);
    const m = (over: Partial<MetricMeta> & Record<string, unknown>): MetricMeta => ({ ...METRICS[0], ...over }) as MetricMeta;
    const bad = (x: MetricMeta) => registryProblems([...METRICS.filter((r) => r.id !== x.id), x], liveIds(), INPUT_FIELD_IDS).join('\n');
    expect(bad(m({ counter: { none: 'unknown' } }))).toContain('needs a real reason');
    expect(bad(m({ counter: { ref: 'scorecard.nope', why: 'it would rise if the number were gamed somehow' } }))).toContain('is not a registered row');
    expect(bad(m({ counter: { ref: METRICS[0].id, why: 'it would rise if the number were gamed somehow' } }))).toContain('cannot be its own counter-metric');
    expect(bad(m({ uncovered: [] }))).toContain('declares no uncovered quality dimension');
    expect(bad(m({ covers: ['timeliness'], uncovered: ['timeliness'] }))).toContain('both covered and uncovered');
    expect(bad(m({ inputs: ['tasks.nope' as never] }))).toContain('not in the writability inventory');
    expect(bad(m({ inputs: [] }))).toContain('needs inputsNote');
    expect(bad(m({ gameable: true }))).toContain('must not be declared on the row');
  });

  it('every counter-metric is a real row with a stated reason; "none" is explicit, never empty filler', () => {
    const none = METRICS.filter((m) => 'none' in m.counter);
    const refs = METRICS.filter((m) => 'ref' in m.counter);
    expect(refs.length + none.length).toBe(METRICS.length);
    expect(none.length, 'some rows honestly have no counter-metric').toBeGreaterThan(0);
    for (const m of refs) expect(METRIC_BY_ID.has((m.counter as { ref: string }).ref), m.id).toBe(true);
  });

  it('writability is derived: no row declares it, and guardOf equals writabilityOf over the declared inputs', () => {
    for (const m of METRICS) {
      expect(Object.keys(m), m.id).not.toContain('gameable');
      const g = guardOf(m);
      expect(g.gameable, m.id).toBe(writabilityOf(m.inputs).agentWritable);
      expect(g.inputs.map((i) => i.id)).toEqual([...m.inputs]);
    }
    expect(guardRows().length).toBe(METRICS.length);
    // S2: the verified rule reads verifies edges, and no agent-reachable site writes that edge kind (joinMission writes delegated edges only)
    for (const id of ['scorecard.verified_success_rate', 'scorecard.completed_unverified', 'kpi.success.api']) expect(guardRows().find((g) => g.id === id)!.gameable, id).toBe(false);
    expect(guardRows().filter((g) => g.gameable).length).toBe(11);
    // the rows an agent identity can reach today, by the inventory (a change here is a reviewed decision)
    expect(guardRows().filter((g) => g.gameable).map((g) => g.id).sort()).toMatchSnapshot();
  });
});

describe('the row inputs match what the loaders read', () => {
  it('every table a company loader reads is the table of a declared input, or is explained as context', async () => {
    const CONTEXT: Record<string, string> = {
      users: 'who decided: a person or not (the loader joins it, it is not a measured input)',
    };
    const s = await makeSchema();
    try {
      const real = new Set((await s.pool.query(`select table_name from information_schema.tables where table_schema = current_schema()`)).rows.map((r) => r.table_name as string));
      const read = loaderTables().filter((t) => real.has(t));
      const declared = new Set([...METRICS.flatMap((m) => m.inputs.flatMap((i) => [...INPUT_FIELDS[i].tables, i.split('.')[0]])), ...Object.keys(CONTEXT)]);
      expect(read.filter((t) => !declared.has(t)), 'tables read by a loader that no row declares as an input').toEqual([]);
    } finally { await s.drop(); }
  });
});
