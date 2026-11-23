import type { Db, Tx } from '../db.ts';

/**
 * c77 (M2): store functions for the append-only usage ledger. Nothing in src/ calls them: no route writes usage and nothing meters real usage.
 * Tests feed them from a fake meter that lives only under the test folder. A mistake is a correction row (a signed delta), never an update.
 */
export const LEDGER_UNITS = ['tokens_in', 'tokens_out', 'requests', 'seconds'] as const;
export interface UsageInput { tenantId: string; subject: string; unit: string; quantity: number; costMicros: number; source: string }
export interface CorrectionInput { tenantId: string; correctionOf: number; quantity: number; costMicros: number; source: string }
type Q = Db | Tx;

const whole = (n: number, what: string) => { if (!Number.isSafeInteger(n)) throw new Error(`${what} must be a whole number (fixed-point, never a float)`); };

export async function recordUsage(c: Q, i: UsageInput) {
  whole(i.quantity, 'quantity'); whole(i.costMicros, 'costMicros');
  const r = await c.query(
    `insert into usage_ledger(tenant_id, subject, unit, quantity, cost_micros, source) values ($1,$2,$3,$4,$5,$6) returning *`,
    [i.tenantId, i.subject, i.unit, i.quantity, i.costMicros, i.source]);
  return r.rows[0];
}

/** The correction copies tenant, subject and unit from its original (read in the same tenant), so it cannot name a different one. */
export async function recordCorrection(c: Q, i: CorrectionInput) {
  whole(i.quantity, 'quantity'); whole(i.costMicros, 'costMicros'); whole(i.correctionOf, 'correctionOf');
  const o = (await c.query('select subject, unit from usage_ledger where id=$1 and tenant_id=$2', [i.correctionOf, i.tenantId])).rows[0];
  if (!o) throw new Error('no such original usage row in this tenant');
  const r = await c.query(
    `insert into usage_ledger(tenant_id, subject, unit, quantity, cost_micros, source, correction_of) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [i.tenantId, o.subject, o.unit, i.quantity, i.costMicros, i.source, i.correctionOf]);
  return r.rows[0];
}

/** Originals plus corrections, per unit, for one subject. Totals are summed in SQL and returned as numbers (checked to be safe integers). */
export async function netUsage(c: Q, tenantId: string, subject: string): Promise<{ unit: string; quantity: number; costMicros: number }[]> {
  const r = await c.query(
    `select unit, sum(quantity)::text as q, sum(cost_micros)::text as c from usage_ledger where tenant_id=$1 and subject=$2 group by unit order by unit`, [tenantId, subject]);
  return r.rows.map((x) => { const quantity = Number(x.q), costMicros = Number(x.c); whole(quantity, 'total quantity'); whole(costMicros, 'total cost'); return { unit: x.unit, quantity, costMicros }; });
}
