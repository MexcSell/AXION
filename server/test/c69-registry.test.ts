import { describe, it, expect } from 'vitest';
import { scanWrites } from './contracts/writability.ts';
import { METRICS, METRIC_BY_ID, INPUT_FIELD_IDS, WRITE_SITES, guardRows, writabilityOf, registryProblems, PROCESS_KEYS } from '../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 69, item 2: every process metric is a registry row (c66): a counter-metric or an explicit "none" with a reason, the quality
 * dimensions it does not cover, its inputs. Whether it is gameable is DERIVED from the writability inventory, never typed on the row.
 */
const ids = PROCESS_KEYS.map((k) => `process.${k}`);
describe('c69 process rows in the c66 registry', () => {
  it('has an entry for every process cell, of kind process, and registryProblems finds nothing', () => {
    for (const id of ids) expect(METRIC_BY_ID.get(id)?.kind, id).toBe('process');
    expect(METRICS.filter((m) => m.kind === 'process').map((m) => m.id)).toEqual(ids);
  });
  it('every process row names a counter-metric that is a real row, or an explicit none with a reason; uncovered is never empty', () => {
    for (const m of METRICS.filter((x) => x.kind === 'process')) {
      expect('none' in m.counter ? m.counter.none.length : m.counter.why.length, m.id).toBeGreaterThanOrEqual(25);
      if ('ref' in m.counter) expect(METRIC_BY_ID.has(m.counter.ref), m.id).toBe(true);
      expect(m.uncovered.length, m.id).toBeGreaterThan(0);
    }
    expect(registryProblems(METRICS, METRICS.map((m) => m.id), INPUT_FIELD_IDS)).toEqual([]);
  });
  it('F7: a row that reads no input (an unmeasured cell) covers no quality dimension: `covers` is a promise it cannot keep', () => {
    for (const m of METRICS.filter((x) => x.kind === 'process' && x.inputs.length === 0)) expect([m.id, m.covers], m.id).toEqual([m.id, []]);
  });
  it('the inventory classifies every input of every process row, and gameable is derived (pinned: a change is a reviewed decision)', () => {
    const rows = guardRows().filter((g) => g.kind === 'process');
    for (const m of METRICS.filter((x) => x.kind === 'process')) for (const f of m.inputs) expect(INPUT_FIELD_IDS, `${m.id} reads ${f}`).toContain(f);
    for (const m of METRICS.filter((x) => x.kind === 'process')) expect(rows.find((r) => r.id === m.id)!.gameable, m.id).toBe(writabilityOf(m.inputs).agentWritable);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.gameable]))).toEqual({
      'process.rework_rate': true, 'process.first_pass_acceptance': true, 'process.duplicate_delegation': true, 'process.reassign_churn': false,
      'process.handoff_wait_h': true, 'process.approval_decision_h': false, 'process.cost': false,
    });
  });
  it('task_owner_history is written only by a database trigger: the c66 source scan (insert, update, delete, merge, truncate, copy, quoted, schema-qualified, templated) finds no writer in server/src', () => {
    expect([...scanWrites({ 'task_owner_history.owner': { what: 'the owner history', tables: ['task_owner_history'] } })]).toEqual([]);
    // the history changes exactly where tasks.owner does: the sites that write tasks.owner also list the history field
    for (const [id, s] of Object.entries(WRITE_SITES)) expect(s.writes.includes('tasks.owner'), id).toBe(s.writes.includes('task_owner_history.owner'));
  });
});
