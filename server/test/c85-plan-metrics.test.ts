import { describe, it, expect } from 'vitest';
import { METRICS, INPUT_FIELDS, type InputFieldId } from '../../shared/contracts/src/index.ts';
import { UNITS, METRIC_UNIT, NOT_COUNTABLE, PLANNABLE, whyNotPlannable, type ObservationUnit } from '../src/organization/plan-metrics.ts';

/**
 * c85 item 3/4: the metrics a plan may name come from the c66 registry, and every read the readout makes is DECLARED there.
 *  - every registry id is either mapped to an observation unit or listed in NOT_COUNTABLE with a reason (a new registry row fails the day it is added);
 *  - a unit reads only tables that its metric's declared inputs name, plus filter-only support tables;
 *  - the SQL of a unit is a read: it names no write verb.
 */
const SUPPORT_OK = ['missions', 'tasks', 'approval_requests'];
/** Fields whose "table" is a log or a trigger-written table named by the field itself (see INPUT_FIELDS: no `tables`). */
const FIELD_TABLES: Record<string, string[]> = { 'events.mission_state_changed': ['events'], 'audit_events.agent_rollback': ['audit_events'], 'task_owner_history.owner': ['task_owner_history'] };
const tablesOf = (inputs: readonly InputFieldId[]) => new Set(inputs.flatMap((i) => [...(INPUT_FIELDS[i].tables as readonly string[]), ...(FIELD_TABLES[i] ?? [])]));

export function mappingProblems(metrics = METRICS, units: Record<string, ObservationUnit> = UNITS, map: Record<string, string> = METRIC_UNIT, notCountable: Record<string, string> = NOT_COUNTABLE): string[] {
  const out: string[] = [];
  const ids = new Set(metrics.map((m) => m.id));
  for (const m of metrics) {
    const mapped = m.id in map, nc = m.id in notCountable;
    if (!mapped && !nc) { out.push(`${m.id}: neither mapped to an observation unit nor listed in NOT_COUNTABLE`); continue; }
    if (mapped && nc) out.push(`${m.id}: both mapped and listed as not countable`);
    if (nc && notCountable[m.id].trim().length < 20) out.push(`${m.id}: NOT_COUNTABLE needs a real reason`);
    if (!mapped) continue;
    const u = units[map[m.id]];
    if (!u) { out.push(`${m.id}: unit ${map[m.id]} does not exist`); continue; }
    if (m.inputs.length === 0) out.push(`${m.id}: reads no input, so it has no observations to count`);
    const declared = tablesOf(m.inputs);
    for (const tb of u.tables) if (!declared.has(tb)) out.push(`${m.id}: unit ${u.id} reads table ${tb}, which none of its declared inputs names`);
    for (const tb of u.support) if (!SUPPORT_OK.includes(tb)) out.push(`${m.id}: unit ${u.id} joins ${tb}, which is not a filter-only support table`);
  }
  for (const k of [...Object.keys(map), ...Object.keys(notCountable)]) if (!ids.has(k)) out.push(`${k}: mapped but not a registry row (renamed or removed?)`);
  for (const u of Object.values(units)) {
    if (/\b(insert\s+into|update\s+\w+\s+set|delete\s+from|truncate|alter|drop|create)\b/i.test(u.sql)) out.push(`unit ${u.id}: its SQL contains a write or schema verb`);
    for (const tb of [...u.tables, ...u.support]) if (!new RegExp(`\\b(from|join)\\s+${tb}\\b|\\(\\s*select[^)]*\\bfrom\\s+${tb}\\b`, 'i').test(u.sql)) out.push(`unit ${u.id}: declares table ${tb} but its SQL does not read it`);
    for (const m of u.sql.matchAll(/\b(?:from|join)\s+([a-z_]+)\b/gi)) if (![...u.tables, ...u.support].includes(m[1])) out.push(`unit ${u.id}: reads table ${m[1]} that it does not declare`);
    if (!u.sql.includes('$1')) out.push(`unit ${u.id}: is not tenant-scoped ($1)`);
    if (!/\bas ts\b/i.test(u.sql)) out.push(`unit ${u.id}: returns no ts column`);
  }
  return out;
}

describe('the plan metrics are registry rows with declared reads', () => {
  it('every registry row is mapped or explicitly not countable, and every unit reads only declared tables', () => {
    expect(mappingProblems()).toEqual([]);
    expect(PLANNABLE.length).toBeGreaterThanOrEqual(30);
  });

  it('RED proof: an unmapped row, an undeclared table, a write verb, a stale entry and a missing reason are each reported', () => {
    const extra = [...METRICS, { ...METRICS[0], id: 'scorecard.zz_new_row' }];
    expect(mappingProblems(extra)).toEqual([expect.stringContaining('scorecard.zz_new_row: neither mapped')]);
    expect(mappingProblems(METRICS, UNITS, { ...METRIC_UNIT, 'scorecard.started': 'review' }).join('\n')).toContain('reads table task_reviews, which none of its declared inputs names');
    const bad = { ...UNITS, run: { ...UNITS.run, sql: UNITS.run.sql + ' ; delete from missions' } };
    expect(mappingProblems(METRICS, bad).join('\n')).toContain('contains a write or schema verb');
    expect(mappingProblems(METRICS, { ...UNITS, run: { ...UNITS.run, sql: UNITS.run.sql.replace('mission_runs', 'tasks') } }).join('\n')).toContain('reads table tasks that it does not declare');
    expect(mappingProblems(METRICS, UNITS, { ...METRIC_UNIT, 'zz.gone': 'run' }).join('\n')).toContain('zz.gone: mapped but not a registry row');
    expect(mappingProblems(METRICS, UNITS, METRIC_UNIT, { ...NOT_COUNTABLE, 'kpi.approvals': 'short' }).join('\n')).toContain('needs a real reason');
  });

  it('a metric outside the registry, or without observations, is refused with a plain reason', () => {
    expect(whyNotPlannable('my own made-up metric')).toMatch(/not a metric of the registry/);
    expect(whyNotPlannable('process.cost')).toMatch(/Stage 9/);
    expect(whyNotPlannable('scorecard.started')).toBeNull();
  });
});
