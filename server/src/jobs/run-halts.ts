/**
 * Phase A (A2): the durable halt source for the c95 caps checker. The table is append-only (migration 0063); a lift is a new row. The newest row
 * (highest id, never a timestamp) of each (scope, target) decides, and the effective halt of one run is read GLOBAL first, then the run's task
 * class, then the run id. A lift at one scope never lifts another scope.
 *
 * `readEffectiveHalt` is ONE statement, so it sees one snapshot. The executor must still call it, and `checkRunStep`, at the moment a step takes
 * effect (c95: "zero accepted steps after a halt" is measured at effect time); the fake store in test/phaseA/durable-store.ts does exactly that.
 * Nothing here executes anything.
 */
import type { Db, Tx } from '../db.ts';
import { HALT_SCOPES, type HaltScope, type RunHaltState } from '../../../shared/contracts/src/index.ts';

export interface HaltRow { id: number; scope: HaltScope; target: string; halted: boolean; reason: string }
export interface EffectiveHalt extends RunHaltState { scope?: HaltScope; target?: string }
export interface HaltQuery { runId: string; taskClass: string }

/** Pure. Rows may come in any order; the id decides. A row that cannot be read (unknown scope, non-boolean flag) is treated as a halt: fail closed. */
export function effectiveHaltOf(rows: readonly HaltRow[], q: HaltQuery): EffectiveHalt {
  const latest = new Map<string, HaltRow>();
  for (const r of rows) {
    const bad = !(HALT_SCOPES as readonly unknown[]).includes(r?.scope) || typeof r.halted !== 'boolean';
    if (bad) return { halted: true, scope: 'global', target: '', reason: 'global: a halt row could not be read' };
    const k = `${r.scope}\u0000${r.target}`;
    const cur = latest.get(k);
    if (!cur || Number(r.id) > Number(cur.id)) latest.set(k, r);
  }
  const targets: Record<HaltScope, string> = { global: '', class: q.taskClass, run: q.runId };
  for (const scope of HALT_SCOPES) {
    const r = latest.get(`${scope}\u0000${targets[scope]}`);
    if (r?.halted) return { halted: true, scope, target: r.target, reason: `${scope}: ${r.reason}` };
  }
  return { halted: false };
}

/** The rows that can matter for one run (every global row, this class's rows, this run's rows), newest of each (scope, target) only, in ONE statement. */
export async function readEffectiveHalt(db: Db | Tx, tenantId: string, q: HaltQuery): Promise<EffectiveHalt> {
  const rows = (await db.query(
    `select distinct on (scope, target) id, scope, target, halted, reason from run_halts
      where tenant_id = $1 and ((scope = 'global') or (scope = 'class' and target = $2) or (scope = 'run' and target = $3))
      order by scope, target, id desc`, [tenantId, q.taskClass, q.runId])).rows;
  return effectiveHaltOf(rows.map((r) => ({ id: Number(r.id), scope: r.scope, target: r.target, halted: r.halted, reason: r.reason })), q);
}

export interface HaltInput { scope: HaltScope; target: string; halted: boolean; reason: string; createdBy: string }
/** Append one halt (or lift) row. The table's own checks refuse a bad scope, target shape or reason. Callers that act for a person audit it (ops/halts.ts). */
export async function recordHalt(db: Db | Tx, tenantId: string, h: HaltInput) {
  const r = (await db.query(
    `insert into run_halts(tenant_id, scope, target, halted, reason, created_by) values ($1,$2,$3,$4,$5,$6) returning id, scope, target, halted, reason, created_by, created_at`,
    [tenantId, h.scope, h.target, h.halted, h.reason, h.createdBy])).rows[0];
  return { id: Number(r.id), scope: r.scope as HaltScope, target: r.target as string, halted: r.halted as boolean, reason: r.reason as string, createdBy: r.created_by as string, createdAt: new Date(r.created_at).toISOString() };
}
