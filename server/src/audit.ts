import type { Tx, Db } from './db.ts';

const SECRET_KEYS = /pass|password|token|secret|csrf|hash|cookie/i;
/** Drop any field that could hold a secret (axor rule: secrets are never logged). */
export function redact(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (SECRET_KEYS.test(k)) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? redact(v as Record<string, unknown>) : v;
  }
  return out;
}

export interface AuditInput { tenantId: string; actor: string; action: string; subject: string; result: 'ok' | 'denied' | 'error'; correlationId: string; detail?: Record<string, unknown> }
export async function audit(c: Tx | Db, a: AuditInput) {
  await c.query(
    'insert into audit_events(tenant_id, actor, action, subject, result, correlation_id, detail) values ($1,$2,$3,$4,$5,$6,$7)',
    [a.tenantId, a.actor, a.action, a.subject, a.result, a.correlationId, JSON.stringify(redact(a.detail ?? {}))],
  );
}
