import type { Db, Tx } from '../db.ts';
import { ApiError } from '../errors.ts';
import { parseSampleRef, type SampleRefKind } from '../../../shared/contracts/src/index.ts';

/**
 * c83 (M2b): the one place that writes or removes `metric_audit_labels`. No migration: the table keeps its free-text column, so the typing is enforced here.
 *
 * - Write: every sample reference must parse (`parseSampleRef`: a kind from a closed set plus an id) and must name a record of this tenant. Free text is refused.
 * - Purge: a demo purge (clearDemo) deletes every label whose reference resolves to a record of a demo mission, before the missions go, so no label
 *   outlives the data it points at. The table is append-only; the purge runs inside clearDemo's transaction, which sets axion.purge_demo.
 * Each kind maps to a table that carries `mission_id` (the mission itself for 'mission'), which is how a record is tied to a demo mission.
 */
const KIND_TABLE: Record<SampleRefKind, { table: string; mission: string }> = {
  mission: { table: 'missions', mission: 'id' },
  task: { table: 'tasks', mission: 'mission_id' },
  review: { table: 'task_reviews', mission: 'mission_id' },
  approval: { table: 'approval_requests', mission: 'mission_id' },
  failure_tag: { table: 'failure_tags', mission: 'mission_id' },
};

export interface AuditLabelIn { sampleRef: string; metricLabel: boolean; auditLabel: boolean; note?: string }

/** The references that are not typed, or that name no record of the tenant (empty = all good). */
export async function badSampleRefs(c: Db | Tx, tenantId: string, refs: readonly string[]): Promise<string[]> {
  const bad: string[] = [];
  const byKind = new Map<SampleRefKind, Set<string>>();
  for (const r of refs) {
    const p = parseSampleRef(r);
    if (!p) { bad.push(r); continue; }
    byKind.set(p.kind, (byKind.get(p.kind) ?? new Set()).add(p.id));
  }
  for (const [kind, ids] of byKind) {
    const { table } = KIND_TABLE[kind];
    const found = new Set((await c.query(`select id from ${table} where tenant_id=$1 and id = any($2::text[])`, [tenantId, [...ids]])).rows.map((r) => r.id as string));
    for (const id of ids) if (!found.has(id)) bad.push(`${kind}:${id}`);
  }
  return bad;
}

export async function insertAuditLabels(c: Db | Tx, a: { tenantId: string; metricId: string; auditedBy: string; samples: readonly AuditLabelIn[] }): Promise<void> {
  const bad = await badSampleRefs(c, a.tenantId, a.samples.map((s) => s.sampleRef));
  if (bad.length) throw new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors: { samples: `A sample must be <kind>:<id> naming a stored record of yours (kinds: mission, task, review, approval, failure_tag). Not accepted: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ` and ${bad.length - 3} more` : ''}.` } });
  for (const s of a.samples) {
    await c.query(`insert into metric_audit_labels(tenant_id, metric_id, sample_ref, metric_label, audit_label, audited_by, note) values ($1,$2,$3,$4,$5,$6,$7)`,
      [a.tenantId, a.metricId, s.sampleRef, s.metricLabel, s.auditLabel, a.auditedBy, s.note ?? null]);
  }
}

/** Called by clearDemo inside its transaction (axion.purge_demo is on), before the demo missions are deleted. Returns how many labels went. */
export async function purgeDemoAuditLabels(c: Tx, tenantId: string): Promise<number> {
  const resolves = (Object.entries(KIND_TABLE) as [SampleRefKind, { table: string; mission: string }][]).map(([kind, { table, mission }]) =>
    `(split_part(l.sample_ref, ':', 1) = '${kind}' and exists (select 1 from ${table} x join missions m on m.id = x.${mission} where x.id = substr(l.sample_ref, ${kind.length + 2}) and m.tenant_id = $1 and m.demo))`);
  const r = await c.query(`delete from metric_audit_labels l where l.tenant_id = $1 and (${resolves.join(' or ')})`, [tenantId]);
  return r.rowCount ?? 0;
}
