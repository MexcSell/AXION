import type { Db, Tx } from '../db.ts';
import { modelFamily } from '../tasks/review-rules.ts';
import { policyProblem, type ModelEntry, type RoutingPolicy, type RoutingRule } from './route.ts';

/** c77 (G1): store functions for the model registry and routing policies. Records only: nothing in src/ calls them and nothing calls a model. */
type Q = Db | Tx;
export interface ModelInput { tenantId: string; model: string; family: string; version: string; capabilities: string[]; status: ModelEntry['status'] }

export async function addModelEntry(c: Q, i: ModelInput) {
  if (modelFamily(i.model) !== i.family) throw new Error(`family "${i.family}" is not the vendor-table family of "${i.model}" (unknown names fail closed)`);
  const caps = [...new Set(i.capabilities)].sort();
  const r = await c.query(`insert into model_entries(tenant_id, model, family, version, capabilities, status) values ($1,$2,$3,$4,$5,$6) returning *`,
    [i.tenantId, i.model, i.family, i.version, caps, i.status]);
  return r.rows[0];
}

/** The newest row of each model. */
export async function latestModels(c: Q, tenantId: string): Promise<(ModelEntry & { id: string })[]> {
  const r = await c.query(`select distinct on (model) id, model, family, version, capabilities, status from model_entries where tenant_id=$1 order by model, id desc`, [tenantId]);
  return r.rows;
}

export async function setRoutingPolicy(c: Q, i: { tenantId: string; name: string; rules: RoutingRule[] }) {
  const bad = policyProblem({ name: i.name, version: 1, rules: i.rules });
  if (bad) throw new Error('invalid policy: ' + bad);
  const r = await c.query(
    `insert into routing_policies(tenant_id, name, version, rules) select $1,$2, coalesce(max(version),0)+1, $3 from routing_policies where tenant_id=$1 and name=$2 returning *`,
    [i.tenantId, i.name, JSON.stringify(i.rules)]);
  return r.rows[0];
}

export async function latestPolicy(c: Q, tenantId: string, name: string): Promise<RoutingPolicy | null> {
  const r = await c.query(`select name, version, rules from routing_policies where tenant_id=$1 and name=$2 order by version desc limit 1`, [tenantId, name]);
  return r.rows[0] ?? null;
}
