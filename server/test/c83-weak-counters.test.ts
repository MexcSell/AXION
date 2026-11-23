import { describe, it, expect } from 'vitest';
import { METRICS, METRIC_BY_ID, INPUT_FIELD_IDS, registryProblems, sharedInputColumns, guardRows, PROMOTION_NOTE, type MetricMeta } from '../../shared/contracts/src/index.ts';
import * as V from './contracts/validators.ts';

/**
 * c83 item 4: a counter-metric that reads the same input column as its primary cannot expose gaming of that input. The shared columns are COMPUTED from the
 * declared columns (item 3 verifies them against the loaders' SQL), never hand-listed. Each such row either has a counter with independent inputs or is marked
 * `counter.weak` with a reason, and the scorecard popover shows the state through the existing `counter.why` field (no DTO field is added).
 */
const live = () => METRICS.map((m) => m.id);
const sharedRows = () => METRICS.filter((m) => 'ref' in m.counter).map((m) => ({ m, shared: sharedInputColumns(m, METRIC_BY_ID.get((m.counter as { ref: string }).ref)!) })).filter((x) => x.shared.length);

describe('counter-metrics with independent inputs', () => {
  it('no registry row has a counter-metric that shares an input column unless it is marked weak with a reason, and no row is marked weak without sharing', () => {
    expect(registryProblems(METRICS, live(), INPUT_FIELD_IDS)).toEqual([]);
  });

  it('the weak rows are exactly the computed shared-input rows, and each carries a reason; context_loss is among them', () => {
    const shared = sharedRows().map((x) => x.m.id).sort();
    const weak = METRICS.filter((m) => 'ref' in m.counter && m.counter.weak !== undefined).map((m) => m.id).sort();
    expect(weak).toEqual(shared);
    expect(weak).toContain('dimension.cognitive.context_loss');
    expect(weak.length, 'weak is the exception: most rows have an independent counter').toBeLessThan(METRICS.filter((m) => 'ref' in m.counter).length / 2);
  });

  it('the scorecard shows the weak state through the existing counter.why field, and the DTO shape is unchanged (the c50 validator still accepts it)', () => {
    const rows = guardRows();
    const ctx = rows.find((g) => g.id === 'dimension.cognitive.context_loss')!;
    expect(ctx.counter.kind === 'metric' && ctx.counter.why).toMatch(/^weak counter-metric, it shares an input with this row/);
    for (const g of rows) if (g.counter.kind === 'metric') expect(/^weak counter-metric/.test(g.counter.why), g.id).toBe(sharedRows().some((x) => x.m.id === g.id));
    const audit = { n: 0, disagreements: 0, metricOver: 0, auditOver: 0, divergence: null, bar: 15, minN: 100, state: 'none', flagged: false, lastAuditedAt: null };
    const e: string[] = []; V.metricGuard({ rows: rows.map((g) => ({ ...g, audit })), promotionNote: PROMOTION_NOTE }, '$', e);
    expect(e).toEqual([]);
  });

  it('RED proof: a new row whose counter shares an input fails unless it is marked weak with a reason', () => {
    const base = METRIC_BY_ID.get('scorecard.finished')!;
    const row = (counter: MetricMeta['counter']): MetricMeta => ({ ...base, id: 'scorecard.zz_new', label: 'New', counter });
    const problems = (m: MetricMeta) => registryProblems([...METRICS, m], [...live(), m.id], INPUT_FIELD_IDS);
    // scorecard.failure_rate reads the same events columns as the new row's primary (a copy of "finished")
    const sharing = { ref: 'scorecard.failure_rate', why: 'finishing by failing missions raises the new count and the failure rate' };
    expect(problems(row(sharing)).join('\n')).toMatch(/scorecard\.zz_new: its counter-metric scorecard\.failure_rate shares input column\(s\) events\./);
    expect(problems(row({ ...sharing, weak: 'both read the same mission events, and nothing else stored tells them apart' }))).toEqual([]);
    expect(problems(row({ ...sharing, weak: 'too short' })).join('\n')).toMatch(/needs a stated reason/);
    // an independent counter passes, and marking it weak is reported (the list must stay computed, not hand-kept)
    const independent = { ref: 'scorecard.tasks_verified_by_review', why: 'finishing without real work leaves the independently accepted reviews flat' };
    expect(problems(row(independent))).toEqual([]);
    expect(problems(row({ ...independent, weak: 'a reason that is long enough to count as stated' })).join('\n')).toMatch(/marked weak but shares no input column/);
  });

  it('the shared columns are computed from the declared reads: context and scope-only columns do not count, and a star overlaps its table', () => {
    expect(sharedInputColumns({ reads: ['tasks.id', 'tasks.tenant_id', 'tasks.mission_id', 'agent_definitions.dept', 'tasks.simulated'] }, { reads: ['tasks.id', 'tasks.tenant_id', 'tasks.mission_id', 'agent_definitions.dept', 'tasks.simulated'] })).toEqual([]);
    expect(sharedInputColumns({ reads: ['missions.*'] }, { reads: ['missions.status'] })).toEqual(['missions.status']);
    expect(sharedInputColumns({ reads: ['tasks.status'] }, { reads: ['task_reviews.verdict'] })).toEqual([]);
  });
});
